use crate::claude::{claude_failure, codex_config_args, resolve_cli, stream_delta, ChatProcesses};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read, Write},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};
use tauri::ipc::Channel;

#[derive(Default, Clone)]
pub struct Sessions(Arc<Mutex<HashMap<String, Arc<Entry>>>>);
struct Entry {
    agent: String,
    binary: PathBuf,
    closed: AtomicBool,
    session: Mutex<Option<Session>>,
}
impl Sessions {
    pub fn close_all(&self) {
        let entries = std::mem::take(&mut *self.0.lock().unwrap());
        for entry in entries.values() {
            entry.closed.store(true, Ordering::SeqCst);
        }
        // Wait for active turns to observe cancellation and reap children before
        // the window/app exits. Do not hold the registry lock while waiting.
        for entry in entries.values() {
            if let Ok(mut session) = entry.session.lock() {
                *session = None;
            }
        }
    }

    fn close(&self, key: &str) {
        if let Some(entry) = self.0.lock().unwrap().remove(key) {
            entry.closed.store(true, Ordering::SeqCst);
        }
    }
}
#[tauri::command]
pub fn close_agent_session(session_key: String, sessions: tauri::State<'_, Sessions>) {
    sessions.close(&session_key);
}
#[tauri::command]
pub async fn agent_session_chat(
    request_id: String,
    session_key: String,
    agent: String,
    executable_path: String,
    system_prompt: Option<String>,
    payload: String,
    on_event: Channel<Value>,
    sessions: tauri::State<'_, Sessions>,
    processes: tauri::State<'_, ChatProcesses>,
) -> Result<String, String> {
    if !["claude", "codex"].contains(&agent.as_str())
        || session_key.is_empty()
        || session_key.len() > 100
        || request_id.len() > 100
        || payload.len() > 1_000_000
        || system_prompt.as_ref().is_some_and(|s| s.len() > 100_000)
    {
        return Err("Invalid agent session request.".into());
    }
    let binary = resolve_cli(&executable_path, &agent)?;
    let sessions = sessions.inner().clone();
    let entry = {
        let mut entries = sessions.0.lock().unwrap();
        if let Some(entry) = entries.get(&session_key) {
            if entry.agent != agent || entry.binary != binary || system_prompt.is_some() {
                return Err(
                    "Session configuration changed. Send again to start a fresh session.".into(),
                );
            }
            entry.clone()
        } else {
            if system_prompt.is_none() {
                return Err(
                    "Agent session ended. Send again to reconnect with your conversation.".into(),
                );
            }
            if entries.len() >= 8 {
                return Err(
                    "Close an unused session before starting another agent connection.".into(),
                );
            }
            let entry = Arc::new(Entry {
                agent: agent.clone(),
                binary: binary.clone(),
                closed: AtomicBool::new(false),
                session: Mutex::new(None),
            });
            entries.insert(session_key.clone(), entry.clone());
            entry
        }
    };
    let cancelled = Arc::new(AtomicBool::new(false));
    let processes = processes.inner().clone();
    {
        let mut requests = processes.0.lock().unwrap();
        if requests.contains_key(&request_id) || requests.len() >= 4 {
            if system_prompt.is_some() {
                sessions.close(&session_key);
            }
            return Err("Too many active requests or duplicate request ID.".into());
        }
        requests.insert(request_id.clone(), cancelled.clone());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut session = match entry.session.try_lock() {
            Ok(session) => session,
            Err(_) => {
                processes.0.lock().unwrap().remove(&request_id);
                return Err("This agent session is busy.".into());
            }
        };
        let result = (|| {
            on_event
                .send(json!({"type":"started"}))
                .map_err(|_| "Chat closed.")?;
            if cancelled.load(Ordering::SeqCst) || entry.closed.load(Ordering::SeqCst) {
                return Err("Request cancelled.".into());
            }
            if session.is_none() {
                let instructions = system_prompt
                    .as_deref()
                    .ok_or("Agent session is not ready.")?;
                *session = Some(Session::start(
                    binary,
                    &agent,
                    instructions,
                    &cancelled,
                    &entry.closed,
                )?);
            }
            session
                .as_mut()
                .unwrap()
                .turn(&payload, &on_event, &cancelled, &entry.closed)
        })();
        if result.is_err() {
            *session = None;
        }
        drop(session);
        processes.0.lock().unwrap().remove(&request_id);
        if result.is_err() {
            sessions.close(&session_key);
        }
        result
    })
    .await
    .map_err(|_| "Agent session worker stopped.".to_string())?
}

struct Pipe {
    child: Child,
    send: Option<mpsc::Sender<Value>>,
    receive: Option<mpsc::Receiver<Result<(Value, usize), String>>>,
    writer: Option<JoinHandle<()>>,
    reader: Option<JoinHandle<()>>,
}
impl Pipe {
    fn spawn(command: &mut Command) -> Result<Self, String> {
        let mut child = command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| "Could not start agent session.")?;
        let mut input = child.stdin.take().unwrap();
        let output = child.stdout.take().unwrap();
        let (send, writes) = mpsc::channel::<Value>();
        let writer = std::thread::spawn(move || {
            for frame in writes {
                if writeln!(input, "{frame}")
                    .and_then(|_| input.flush())
                    .is_err()
                {
                    break;
                }
            }
        });
        let (tx, receive) = mpsc::sync_channel(16);
        let reader = std::thread::spawn(move || {
            let mut output = BufReader::new(output);
            loop {
                let mut line = String::new();
                let frame = match output.by_ref().take(1_048_577).read_line(&mut line) {
                    Ok(0) => break,
                    Ok(_) if line.len() <= 1_048_576 => serde_json::from_str(&line)
                        .map(|value| (value, line.len()))
                        .map_err(|_| "Invalid agent stream.".to_string()),
                    _ => Err("Invalid or oversized agent stream.".into()),
                };
                let failed = frame.is_err();
                if tx.send(frame).is_err() || failed {
                    break;
                }
            }
        });
        Ok(Self {
            child,
            send: Some(send),
            receive: Some(receive),
            writer: Some(writer),
            reader: Some(reader),
        })
    }
    fn send(&self, frame: Value) -> Result<(), String> {
        self.send
            .as_ref()
            .unwrap()
            .send(frame)
            .map_err(|_| "Agent input closed.".into())
    }
    fn next(
        &self,
        cancelled: &AtomicBool,
        closed: &AtomicBool,
        started: Instant,
        total: &mut usize,
    ) -> Result<Value, String> {
        loop {
            if cancelled.load(Ordering::SeqCst) || closed.load(Ordering::SeqCst) {
                return Err("Request cancelled.".into());
            }
            if started.elapsed() > Duration::from_secs(120) {
                return Err("Agent timed out.".into());
            }
            match self
                .receive
                .as_ref()
                .unwrap()
                .recv_timeout(Duration::from_millis(25))
            {
                Ok(frame) => {
                    let (frame, bytes) = frame?;
                    *total += bytes;
                    if *total > 8_000_000 {
                        return Err("Agent response exceeded size limit.".into());
                    }
                    return Ok(frame);
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(_) => return Err(
                    "Agent session closed before completion. Check native sign-in and CLI version."
                        .into(),
                ),
            }
        }
    }
    fn reject_tool(&self, event: &Value) -> Result<bool, String> {
        if event.get("id").is_some() && event.get("method").is_some() {
            self.send(json!({"id":event["id"],"error":{"code":-32601,"message":"Agent tools are disabled in Chista chat."}}))?;
            return Ok(true);
        }
        Ok(false)
    }
}
impl Drop for Pipe {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        self.send.take();
        self.receive.take();
        if let Some(writer) = self.writer.take() {
            let _ = writer.join();
        }
        if let Some(reader) = self.reader.take() {
            let _ = reader.join();
        }
    }
}
struct Session {
    pipe: Pipe, // Reap the child before deleting its isolated directory.
    _directory: tempfile::TempDir,
    thread: Option<String>,
    next_id: u64,
}
impl Session {
    fn start(
        binary: PathBuf,
        agent: &str,
        instructions: &str,
        cancelled: &AtomicBool,
        closed: &AtomicBool,
    ) -> Result<Self, String> {
        let directory =
            tempfile::tempdir().map_err(|_| "Cannot create isolated agent directory.")?;
        let mut command = Command::new(binary);
        command.current_dir(directory.path());
        if agent == "claude" {
            command.args([
                "-p",
                "--input-format",
                "stream-json",
                "--output-format",
                "stream-json",
                "--verbose",
                "--include-partial-messages",
                "--safe-mode",
                "--tools",
                "",
                "--disallowedTools",
                "*",
                "--strict-mcp-config",
                "--mcp-config",
                "{\"mcpServers\":{}}",
                "--setting-sources",
                "",
                "--settings",
                "{\"disableAllHooks\":true}",
                "--no-session-persistence",
                "--system-prompt",
                instructions,
            ]);
            return Ok(Self {
                pipe: Pipe::spawn(&mut command)?,
                _directory: directory,
                thread: None,
                next_id: 10,
            });
        }
        let file = directory.path().join("instructions.md");
        std::fs::write(&file, instructions).map_err(|_| "Cannot prepare agent instructions.")?;
        command.args(["app-server", "--stdio", "--strict-config"]);
        command.args(codex_config_args());
        command.args([
            "-c",
            "model_provider=\"openai\"",
            "-c",
            "developer_instructions=\"\"",
            "-c",
            "notify=[]",
        ]);
        command
            .arg("-c")
            .arg(format!("model_instructions_file={}", json!(file)));
        let pipe = Pipe::spawn(&mut command)?;
        pipe.send(json!({"id":1,"method":"initialize","params":{"clientInfo":{"name":"chista","version":"0.1.0"},"capabilities":{"experimentalApi":true}}}))?;
        let started = Instant::now();
        let mut total = 0;
        let thread = loop {
            let event = pipe.next(cancelled, closed, started, &mut total)?;
            if pipe.reject_tool(&event)? {
                continue;
            }
            if event.get("error").is_some() {
                return Err("Could not initialize Codex session. Check CLI configuration.".into());
            }
            match event["id"].as_u64() {
                Some(1) => {
                    pipe.send(json!({"method":"initialized","params":{}}))?;
                    pipe.send(json!({"id":2,"method":"config/read","params":{"cwd":directory.path(),"includeLayers":false}}))?;
                }
                Some(2) => {
                    let config = crate::codex_stream::disabled_servers(&event["result"]["config"])?;
                    pipe.send(json!({"id":3,"method":"thread/start","params":{"cwd":directory.path(),"ephemeral":true,"approvalPolicy":"never","permissions":"chista","environments":[],"config":config,"baseInstructions":instructions}}))?;
                }
                Some(3) => {
                    break event["result"]["thread"]["id"]
                        .as_str()
                        .filter(|s| !s.is_empty())
                        .ok_or("Codex returned no thread ID.")?
                        .to_string()
                }
                _ => {}
            }
        };
        Ok(Self {
            pipe,
            _directory: directory,
            thread: Some(thread),
            next_id: 10,
        })
    }
    fn turn(
        &mut self,
        payload: &str,
        events: &Channel<Value>,
        cancelled: &AtomicBool,
        closed: &AtomicBool,
    ) -> Result<String, String> {
        if cancelled.load(Ordering::SeqCst) || closed.load(Ordering::SeqCst) {
            return Err("Request cancelled.".into());
        }
        let id = self.next_id;
        self.next_id += 1;
        if let Some(thread) = &self.thread {
            self.pipe.send(json!({"id":id,"method":"turn/start","params":{"threadId":thread,"input":[{"type":"text","text":payload}],"environments":[]}}))?;
        } else {
            self.pipe.send(json!({"type":"user","message":{"role":"user","content":payload},"parent_tool_use_id":null,"session_id":""}))?;
        }
        let started = Instant::now();
        let mut total = 0;
        let mut text = String::new();
        let mut item = String::new();
        let mut turn_id = String::new();
        loop {
            let event = self.pipe.next(cancelled, closed, started, &mut total)?;
            if self.thread.is_none() {
                if event["type"] == "control_request" {
                    self.pipe.send(json!({"type":"control_response","response":{"subtype":"error","request_id":event["request_id"],"error":"Agent tools are disabled in Chista chat."}}))?;
                }
                if let Some(delta) = stream_delta(&event) {
                    events
                        .send(json!({"type":"delta","text":delta}))
                        .map_err(|_| "Chat closed.")?;
                }
                if event["type"] == "result" {
                    if event["is_error"] == true || event["subtype"] != "success" {
                        return Err(claude_failure(&event));
                    }
                    return event["result"]
                        .as_str()
                        .filter(|s| !s.is_empty())
                        .map(str::to_owned)
                        .ok_or("Agent returned no answer.".into());
                }
                continue;
            }
            if self.pipe.reject_tool(&event)? {
                continue;
            }
            if event["id"].as_u64() == Some(id) && event.get("method").is_none() {
                if event.get("error").is_some() {
                    return Err(
                        "Codex could not start this turn. Check native sign-in and configuration."
                            .into(),
                    );
                }
                turn_id = event["result"]["turn"]["id"]
                    .as_str()
                    .ok_or("Codex returned no turn ID.")?
                    .to_string();
                continue;
            }
            let params = &event["params"];
            if params["threadId"].as_str() != self.thread.as_deref() || turn_id.is_empty() {
                continue;
            }
            if params.get("turnId").is_some() && params["turnId"].as_str() != Some(&turn_id) {
                continue;
            }
            match event["method"].as_str() {
                Some("item/agentMessage/delta") => {
                    let new_item = params["itemId"]
                        .as_str()
                        .ok_or("Codex message ID missing.")?;
                    if item != new_item {
                        item = new_item.into();
                        text.clear();
                        events
                            .send(json!({"type":"replace","text":""}))
                            .map_err(|_| "Chat closed.")?;
                    }
                    if let Some(delta) = params["delta"].as_str() {
                        text.push_str(delta);
                        events
                            .send(json!({"type":"delta","text":delta}))
                            .map_err(|_| "Chat closed.")?;
                    }
                }
                Some("item/completed") if params["item"]["type"] == "agentMessage" => {
                    if let Some(value) = params["item"]["text"].as_str() {
                        text = value.into();
                        events
                            .send(json!({"type":"replace","text":text}))
                            .map_err(|_| "Chat closed.")?;
                    }
                }
                Some("turn/completed") if params["turn"]["id"].as_str() == Some(&turn_id) => {
                    if params["turn"]["status"] != "completed" {
                        return Err("Codex turn failed or was interrupted. Check its native account status.".into());
                    }
                    if text.is_empty() {
                        return Err("Codex returned no answer.".into());
                    }
                    return Ok(text);
                }
                _ => {}
            }
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    fn fixture(agent: &str) -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("agent.py");
        let code=r#"#!/usr/bin/env python3
import sys,json
from pathlib import Path
mode=MODE
frames=Path(__file__).with_suffix('.frames')
def emit(value): print(json.dumps(value),flush=True)
args=sys.argv[1:]
assert '--safe-mode' in args if mode=='claude' else '--strict-config' in args
if mode=='claude':
 assert args[args.index('--input-format')+1]=='stream-json'
 assert '--no-session-persistence' in args
 assert args[args.index('--system-prompt')+1]=='FORMAT_ONCE'
else:
 assert 'features.shell_tool=false' in args
 assert 'features.plugins=false' in args
count=0
first=''
for line in sys.stdin:
 f=json.loads(line)
 with frames.open('a') as log: log.write(json.dumps(f)+'\n')
 if mode=='claude':
  assert f['type']=='user'
  count+=1
  first=first or f['message']['content']
  emit({'type':'stream_event','event':{'delta':{'type':'text_delta','text':str(count)}}})
  if f['message']['content']=='hang':
   while True: pass
  emit({'type':'result','subtype':'success','is_error':False,'result':str(count)+':'+first})
 elif f.get('method')=='initialize': emit({'id':f['id'],'result':{}})
 elif f.get('method')=='config/read': emit({'id':f['id'],'result':{'config':{'mcp_servers':{'inherited':{'url':'secret-url'}}}}})
 elif f.get('method')=='thread/start':
  assert f['params']['ephemeral'] and f['params']['baseInstructions']=='FORMAT_ONCE'
  assert f['params']['config']['mcp_servers']['inherited']=={'enabled':False}
  emit({'id':f['id'],'result':{'thread':{'id':'thread'}}})
 elif f.get('method')=='turn/start':
  count+=1
  assert 'baseInstructions' not in f['params']
  assert f['params']['threadId']=='thread'
  first=first or f['params']['input'][0]['text']
  turn='turn-'+str(count)
  emit({'id':f['id'],'result':{'turn':{'id':turn}}})
  emit({'method':'item/agentMessage/delta','params':{'threadId':'other','turnId':turn,'itemId':'wrong','delta':'PRIVATE'}})
  emit({'method':'item/agentMessage/delta','params':{'threadId':'thread','turnId':'old-turn','itemId':'wrong','delta':'PRIVATE'}})
  emit({'id':'deny-me','method':'item/tool/call','params':{'threadId':'thread'}})
  emit({'method':'item/agentMessage/delta','params':{'threadId':'thread','turnId':turn,'itemId':'answer','delta':str(count)}})
  if f['params']['input'][0]['text']=='hang':
   while True: pass
  emit({'method':'item/completed','params':{'threadId':'thread','turnId':turn,'item':{'type':'agentMessage','text':str(count)+':'+first}}})
  emit({'method':'turn/completed','params':{'threadId':'thread','turn':{'id':turn,'status':'completed'}}})
"#.replace("MODE",&format!("{agent:?}"));
        std::fs::write(&path, code).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
        (dir, path)
    }
    #[test]
    fn both_agents_keep_memory_and_send_initialization_only_once() {
        for agent in ["claude", "codex"] {
            let (_dir, binary) = fixture(agent);
            let cancelled = AtomicBool::new(false);
            let closed = AtomicBool::new(false);
            let mut session =
                Session::start(binary.clone(), agent, "FORMAT_ONCE", &cancelled, &closed).unwrap();
            let directory = session._directory.path().to_path_buf();
            let received = Arc::new(Mutex::new(Vec::new()));
            let copy = received.clone();
            let channel = Channel::new(move |body| {
                if let tauri::ipc::InvokeResponseBody::Json(text) = body {
                    copy.lock().unwrap().push(text);
                }
                Ok(())
            });
            assert_eq!(
                session
                    .turn("first", &channel, &cancelled, &closed)
                    .unwrap(),
                "1:first"
            );
            assert_eq!(
                session
                    .turn("second", &channel, &cancelled, &closed)
                    .unwrap(),
                "2:first"
            );
            assert!(!received.lock().unwrap().join("\n").contains("PRIVATE"));
            drop(session);
            assert!(!directory.exists());
            let frames = std::fs::read_to_string(binary.with_extension("frames")).unwrap();
            if agent == "codex" {
                assert_eq!(frames.matches("FORMAT_ONCE").count(), 1);
                assert_eq!(frames.matches("thread/start").count(), 1);
                assert_eq!(frames.matches("turn/start").count(), 2);
                assert!(frames.contains("-32601"));
            } else {
                assert!(!frames.contains("FORMAT_ONCE"));
                assert_eq!(frames.lines().count(), 2);
            }
        }
    }
    #[test]
    fn processes_are_isolated_and_close_reaps_idle_connections() {
        let (_dir, binary) = fixture("claude");
        let cancelled = AtomicBool::new(false);
        let closed = AtomicBool::new(false);
        let mut first =
            Session::start(binary.clone(), "claude", "FORMAT_ONCE", &cancelled, &closed).unwrap();
        let mut second =
            Session::start(binary.clone(), "claude", "FORMAT_ONCE", &cancelled, &closed).unwrap();
        assert_ne!(first.pipe.child.id(), second.pipe.child.id());
        assert_eq!(
            first
                .turn("one", &Channel::new(|_| Ok(())), &cancelled, &closed)
                .unwrap(),
            "1:one"
        );
        assert_eq!(
            second
                .turn("two", &Channel::new(|_| Ok(())), &cancelled, &closed)
                .unwrap(),
            "1:two"
        );
        let directory = first._directory.path().to_path_buf();
        let entries = Sessions::default();
        entries.0.lock().unwrap().insert(
            "session".into(),
            Arc::new(Entry {
                agent: "claude".into(),
                binary,
                closed: AtomicBool::new(false),
                session: Mutex::new(Some(first)),
            }),
        );
        entries.close_all();
        assert!(!directory.exists());
    }
    #[test]
    fn cancellation_after_partial_output_ends_the_turn_without_reuse() {
        for agent in ["claude", "codex"] {
            let (_dir, binary) = fixture(agent);
            let cancelled = Arc::new(AtomicBool::new(false));
            let closed = AtomicBool::new(false);
            let mut session =
                Session::start(binary, agent, "FORMAT_ONCE", &cancelled, &closed).unwrap();
            let cancel = cancelled.clone();
            let stopped = Arc::new(Mutex::new(None));
            let stop_time = stopped.clone();
            let channel = Channel::new(move |body| {
                if let tauri::ipc::InvokeResponseBody::Json(text) = body {
                    if text.contains("delta") {
                        *stop_time.lock().unwrap() = Some(Instant::now());
                        cancel.store(true, Ordering::SeqCst);
                    }
                }
                Ok(())
            });
            assert_eq!(
                session
                    .turn("hang", &channel, &cancelled, &closed)
                    .unwrap_err(),
                "Request cancelled."
            );
            drop(session);
            assert!(stopped.lock().unwrap().unwrap().elapsed() < Duration::from_secs(3));
        }
    }
}

#[cfg(all(test, unix))]
mod shutdown_tests {
    use super::*;
    #[test]
    fn close_all_waits_for_active_sessions_to_release_their_lock() {
        let sessions = Sessions::default();
        let entry = Arc::new(Entry {
            agent: "claude".into(),
            binary: PathBuf::new(),
            closed: AtomicBool::new(false),
            session: Mutex::new(None),
        });
        sessions
            .0
            .lock()
            .unwrap()
            .insert("busy".into(), entry.clone());
        let (ready, wait) = mpsc::channel();
        let running = entry.clone();
        let worker = std::thread::spawn(move || {
            let _lock = running.session.lock().unwrap();
            ready.send(()).unwrap();
            while !running.closed.load(Ordering::SeqCst) {
                std::thread::sleep(Duration::from_millis(5));
            }
        });
        wait.recv().unwrap();
        sessions.close_all();
        worker.join().unwrap();
        assert!(entry.closed.load(Ordering::SeqCst));
        assert!(sessions.0.lock().unwrap().is_empty());
    }
}
