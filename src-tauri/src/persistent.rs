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
#[path = "claude_mcp.rs"]
mod claude_mcp;
#[path = "claude_tools.rs"]
mod claude_tools;
#[path = "session_http.rs"]
mod http;
#[path = "http_request.rs"]
mod http_request;
#[path = "session_interrupt.rs"]
mod interrupt;
#[path = "session_mcp.rs"]
pub mod mcp;
#[path = "agent_models.rs"]
pub mod models;
#[path = "session_refresh.rs"]
pub mod refresh;

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
    model: Option<String>,
    system_prompt: Option<String>,
    payload: String,
    on_event: Channel<Value>,
    sessions: tauri::State<'_, Sessions>,
    processes: tauri::State<'_, ChatProcesses>,
    approvals: tauri::State<'_, mcp::Approvals>,
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
    let model = model.unwrap_or_default().trim().to_string();
    models::validate_model(&model)?;
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
    let approvals = approvals.inner().clone();
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
        if let Some(native) = session.as_mut() {
            native.retain_after_error = false;
            native.failure_detail = None;
        }
        let mut result = (|| {
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
            session.as_mut().unwrap().turn_with_model(
                &payload,
                &on_event,
                &cancelled,
                &entry.closed,
                &approvals,
                &request_id,
                &model,
            )
        })();
        if result.is_err()
            && cancelled.load(Ordering::SeqCst)
            && !entry.closed.load(Ordering::SeqCst)
        {
            if let Some(native) = session
                .as_mut()
                .filter(|native| native.active_request.is_some() && !native.pending_tool)
            {
                result = native.interrupt(&entry.closed);
            }
        }
        if result.is_ok() && cancelled.load(Ordering::SeqCst) {
            result =
                Err("Request cancelled. The conversation is ready for your next message.".into());
        }
        // Keep only a live process with a fully consumed turn boundary. Tool
        // cancellation may leave connector RPCs pending, so it reconnects.
        let retained = result.is_err()
            && !entry.closed.load(Ordering::SeqCst)
            && session.as_mut().is_some_and(|native| {
                native.retain_after_error
                    && native
                        .pipe
                        .child
                        .try_wait()
                        .is_ok_and(|status| status.is_none())
            });
        let detail = session.as_ref().and_then(|native| native.failure_detail.clone());
        if retained || (result.is_err() && detail.is_some()) {
            // Carry retention in the final IPC error, not only an asynchronous
            // event that could arrive after the promise has already rejected.
            result = result.map_err(|message| {
                json!({"code":if retained {"session_retained"} else {"session_ended"},"message":message,"detail":detail}).to_string()
            });
        }
        if result.is_err() && !retained {
            *session = None;
        }
        drop(session);
        processes.0.lock().unwrap().remove(&request_id);
        if result.is_err() && !retained {
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
        self.next_with_timeout(cancelled, closed, started, total, Duration::from_secs(120))
    }
    fn next_with_timeout(
        &self,
        cancelled: &AtomicBool,
        closed: &AtomicBool,
        started: Instant,
        total: &mut usize,
        timeout: Duration,
    ) -> Result<Value, String> {
        loop {
            if cancelled.load(Ordering::SeqCst) || closed.load(Ordering::SeqCst) {
                return Err("Request cancelled.".into());
            }
            if started.elapsed() > timeout {
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
    mcp: Option<mcp::Connector>,
    _claude_settings: Option<tempfile::NamedTempFile>,
    model: String,
    default_model: Option<String>,
    active_request: Option<u64>,
    active_turn: Option<String>,
    retain_after_error: bool,
    pending_tool: bool,
    failure_detail: Option<Value>,
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
            let settings = crate::claude_settings::user_settings()?;
            command.arg("--settings").arg(settings.path());
            command.args([
                "-p",
                "--input-format",
                "stream-json",
                "--output-format",
                "stream-json",
                "--verbose",
                "--include-partial-messages",
                "--tools",
                "ToolSearch,WaitForMcpServers",
                "--permission-prompt-tool",
                "stdio",
                "--disable-slash-commands",
                "--setting-sources",
                "",
                "--no-session-persistence",
                "--system-prompt",
                instructions,
            ]);
            let config = claude_mcp::config_file(directory.path())?;
            // Keep native account/company connector discovery. Strict mode
            // suppresses those connectors, even when the CLI can use them.
            command.arg("--mcp-config").arg(config);
            command.env_remove("CLAUDE_CODE_SAFE_MODE");
            let pipe = Pipe::spawn(&mut command)?;
            claude_mcp::initialize(&pipe, cancelled, closed)?;
            return Ok(Self {
                pipe,
                _directory: directory,
                thread: None,
                next_id: 10,
                mcp: None,
                _claude_settings: Some(settings),
                model: String::new(),
                default_model: None,
                active_request: None,
                active_turn: None,
                retain_after_error: false,
                pending_tool: false,
                failure_detail: None,
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
        let mut mcp = None;
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
                    mcp = mcp::Connector::start(
                        &pipe,
                        &event["result"]["config"],
                        directory.path(),
                        cancelled,
                        closed,
                    )?;
                    let config = mcp::analysis_config(&event["result"]["config"])?;
                    let mut tools = mcp.as_ref().map(|c| c.definitions()).unwrap_or_default();
                    tools.push(http::definition());
                    pipe.send(json!({"id":3,"method":"thread/start","params":{"cwd":directory.path(),"ephemeral":true,"approvalPolicy":"never","permissions":"chista","environments":[],"config":config,"baseInstructions":instructions,"dynamicTools":tools,"model":Value::Null}}))?;
                }
                Some(3) => {
                    break (
                        event["result"]["thread"]["id"]
                            .as_str()
                            .filter(|s| !s.is_empty())
                            .ok_or("Codex returned no thread ID.")?
                            .to_string(),
                        event["result"]["model"].as_str().map(str::to_string),
                    )
                }
                _ => {}
            }
        };
        Ok(Self {
            pipe,
            _directory: directory,
            thread: Some(thread.0),
            next_id: 10,
            mcp,
            _claude_settings: None,
            model: String::new(),
            default_model: thread.1,
            active_request: None,
            active_turn: None,
            retain_after_error: false,
            pending_tool: false,
            failure_detail: None,
        })
    }
    #[cfg(test)]
    fn turn(
        &mut self,
        payload: &str,
        events: &Channel<Value>,
        cancelled: &AtomicBool,
        closed: &AtomicBool,
    ) -> Result<String, String> {
        self.turn_with_tools(
            payload,
            events,
            cancelled,
            closed,
            &mcp::Approvals::default(),
            "test",
        )
    }
    #[cfg(test)]
    fn turn_with_tools(
        &mut self,
        payload: &str,
        events: &Channel<Value>,
        cancelled: &AtomicBool,
        closed: &AtomicBool,
        approvals: &mcp::Approvals,
        request_id: &str,
    ) -> Result<String, String> {
        self.turn_with_model(
            payload, events, cancelled, closed, approvals, request_id, "",
        )
    }
    fn turn_with_model(
        &mut self,
        payload: &str,
        events: &Channel<Value>,
        cancelled: &AtomicBool,
        closed: &AtomicBool,
        approvals: &mcp::Approvals,
        request_id: &str,
        model: &str,
    ) -> Result<String, String> {
        self.retain_after_error = false;
        self.failure_detail = None;
        self.pending_tool = false;
        if cancelled.load(Ordering::SeqCst) || closed.load(Ordering::SeqCst) {
            return Err("Request cancelled.".into());
        }
        if let Some(mcp) = &self.mcp {
            events
                .send(json!({"type":"mcp_status","servers":mcp.statuses}))
                .map_err(|_| "Chat closed.")?;
        }
        if self.thread.is_none() && self.model != model {
            if self.default_model.is_none() {
                self.default_model = Some(claude_mcp::current_model(
                    &self.pipe,
                    self.next_id,
                    cancelled,
                    closed,
                )?);
            }
            let selected = if model.is_empty() {
                self.default_model.as_deref().unwrap()
            } else {
                model
            };
            claude_mcp::set_model(&self.pipe, selected, self.next_id, cancelled, closed)?;
        }
        self.model = model.to_string();
        let id = self.next_id;
        self.next_id += 1;
        self.active_request = Some(id);
        self.active_turn = None;
        if let Some(thread) = &self.thread {
            self.pipe.send(json!({"id":id,"method":"turn/start","params":{"threadId":thread,"input":[{"type":"text","text":payload}],"environments":[],"model":if model.is_empty() {self.default_model.as_deref()} else {Some(model)}}}))?;
        } else {
            self.pipe.send(json!({"type":"user","message":{"role":"user","content":payload},"parent_tool_use_id":null,"session_id":""}))?;
        }
        let mut started = Instant::now();
        let mut total = 0;
        let mut text = String::new();
        let mut item = String::new();
        let mut turn_id = String::new();
        let mut seen_calls = std::collections::HashSet::new();
        let mut claude_pending = HashMap::new();
        loop {
            let event = self.pipe.next(cancelled, closed, started, &mut total)?;
            if self.thread.is_none() {
                claude_mcp::status(&event, events)?;
                if event["type"] == "control_request" {
                    self.pending_tool = true;
                    let failure = claude_mcp::control(
                        &self.pipe,
                        &event,
                        events,
                        approvals,
                        request_id,
                        cancelled,
                        closed,
                        &mut claude_pending,
                        &mut seen_calls,
                    )?;
                    self.pending_tool = false;
                    if let Some(message) = failure {
                        // Interrupt at the outstanding failure hook instead of
                        // destroying the process and replaying the conversation.
                        if claude_pending.is_empty() {
                            let _ = self.interrupt(closed);
                        }
                        return Err(message);
                    }
                    started = Instant::now();
                    continue;
                }
                if let Some(delta) = stream_delta(&event) {
                    events
                        .send(json!({"type":"delta","text":delta}))
                        .map_err(|_| "Chat closed.")?;
                }
                if event["type"] == "result" {
                    if !claude_pending.is_empty() {
                        return Err("Claude completed without sanitizing an MCP result.".into());
                    }
                    self.active_request = None;
                    self.retain_after_error = true;
                    if event["is_error"] == true || event["subtype"] != "success" {
                        self.failure_detail = Some(
                            json!({"errors":event["errors"],"error":event["error"],"result":event["result"]}),
                        );
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
            if event["method"] == "item/tool/call"
                && event["params"]["threadId"].as_str() == self.thread.as_deref()
                && event["params"]["turnId"].as_str() == Some(&turn_id)
                && !turn_id.is_empty()
            {
                self.pending_tool = true;
                if !seen_calls.insert(event["params"]["callId"].to_string()) {
                    return Err("Duplicate MCP tool call rejected.".into());
                }
                if http::call(
                    &self.pipe, &event, events, approvals, request_id, cancelled, closed,
                )? {
                    self.pending_tool = false;
                    started = Instant::now();
                    continue;
                }
                if let Some(mcp) = &self.mcp {
                    if mcp.call(
                        &self.pipe, &event, events, approvals, request_id, cancelled, closed,
                    )? {
                        self.pending_tool = false;
                        started = Instant::now();
                        continue;
                    }
                }
                self.pending_tool = false;
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
                self.active_turn = Some(turn_id.clone());
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
                    self.active_request = None;
                    self.active_turn = None;
                    self.retain_after_error = true;
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
Path(__file__).with_suffix('.args').write_text(json.dumps(args))
assert '--safe-mode' not in args if mode=='claude' else '--strict-config' in args
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
  if f['type']=='control_request':
   if f['request']['subtype']=='get_context_usage':
    emit({'type':'control_response','response':{'subtype':'success','request_id':f['request_id'],'response':{'model':'fixture-default'}}})
    continue
   if f['request']['subtype']=='set_model':
    emit({'type':'control_response','response':{'subtype':'success','request_id':f['request_id'],'response':{}}})
    continue
   assert f['request']['subtype']=='initialize'
   assert 'PostToolUse' in f['request']['hooks']
   emit({'type':'control_response','response':{'subtype':'success','request_id':f['request_id'],'response':{'hooks_applied':True}}})
   continue
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
  assert f['params']['config']['mcp_servers']['inherited']['enabled']==False
  assert any(t['name']=='chista_http_request' for t in f['params']['dynamicTools'])
  emit({'id':f['id'],'result':{'thread':{'id':'thread'},'model':'fixture-default'}})
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
    fn changes_models_and_restores_default_without_restarting_or_replaying() {
        for agent in ["claude", "codex"] {
            let (_dir, binary) = fixture(agent);
            let cancelled = AtomicBool::new(false);
            let closed = AtomicBool::new(false);
            let mut session =
                Session::start(binary.clone(), agent, "FORMAT_ONCE", &cancelled, &closed).unwrap();
            for (index, model) in ["fixture-one", "fixture-two", ""].iter().enumerate() {
                assert_eq!(
                    session
                        .turn_with_model(
                            if index == 0 { "first" } else { "next" },
                            &Channel::new(|_| Ok(())),
                            &cancelled,
                            &closed,
                            &mcp::Approvals::default(),
                            "test",
                            model
                        )
                        .unwrap(),
                    format!("{}:first", index + 1)
                );
            }
            let frames: Vec<Value> = std::fs::read_to_string(binary.with_extension("frames"))
                .unwrap()
                .lines()
                .map(|line| serde_json::from_str(line).unwrap())
                .collect();
            if agent == "claude" {
                let models: Vec<_> = frames
                    .iter()
                    .filter(|frame| frame["request"]["subtype"] == "set_model")
                    .map(|frame| frame["request"]["model"].clone())
                    .collect();
                assert_eq!(
                    models,
                    vec![
                        json!("fixture-one"),
                        json!("fixture-two"),
                        json!("fixture-default")
                    ]
                );
                assert_eq!(
                    frames
                        .iter()
                        .filter(|frame| frame["request"]["subtype"] == "initialize")
                        .count(),
                    1
                );
                let prompts: Vec<_> = frames
                    .iter()
                    .filter(|frame| frame["type"] == "user")
                    .map(|frame| frame["message"]["content"].clone())
                    .collect();
                assert_eq!(prompts, vec![json!("first"), json!("next"), json!("next")]);
            } else {
                assert_eq!(
                    frames
                        .iter()
                        .filter(|frame| frame["method"] == "thread/start")
                        .count(),
                    1
                );
                let models: Vec<_> = frames
                    .iter()
                    .filter(|frame| frame["method"] == "turn/start")
                    .map(|frame| frame["params"]["model"].clone())
                    .collect();
                assert_eq!(
                    models,
                    vec![
                        json!("fixture-one"),
                        json!("fixture-two"),
                        json!("fixture-default")
                    ]
                );
            }
        }
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
                assert_eq!(frames.lines().count(), 3);
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
