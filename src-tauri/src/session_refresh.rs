use super::*;

#[tauri::command]
pub async fn refresh_agent_mcp(
    session_key: Option<String>,
    agent: String,
    executable_path: String,
    server: Option<String>,
    sessions: tauri::State<'_, Sessions>,
) -> Result<Value, String> {
    if !["claude", "codex"].contains(&agent.as_str()) {
        return Err("Choose Claude Code or Codex.".into());
    }
    if server
        .as_ref()
        .is_some_and(|server| server.len() > 200 || server.chars().any(char::is_control))
    {
        return Err("Invalid MCP server name.".into());
    }
    let binary = resolve_cli(&executable_path, &agent)?;
    let entry = session_key
        .as_ref()
        .and_then(|key| sessions.0.lock().unwrap().get(key).cloned());
    tauri::async_runtime::spawn_blocking(move || {
        let cancelled = AtomicBool::new(false);
        if let Some(entry) = entry {
            if entry.agent != agent || entry.binary != binary {
                return Err("Agent settings changed. Refresh connections again.".into());
            }
            let mut guard = entry.session.try_lock().map_err(|_| {
                "Wait for the current response to finish before refreshing MCP connections."
            })?;
            if let Some(native) = guard.as_mut() {
                return native
                    .refresh_mcp(server.as_deref(), &cancelled, &entry.closed)
                    .map(|statuses| json!(statuses));
            }
        }
        // No live conversation: inspect a temporary native connection without
        // submitting a user prompt or changing the chat's delivered history.
        let closed = AtomicBool::new(false);
        let mut native = Session::start(
            binary,
            &agent,
            "Connection status only. Never run inference.",
            &cancelled,
            &closed,
        )?;
        native
            .refresh_mcp(server.as_deref(), &cancelled, &closed)
            .map(|statuses| json!(statuses))
    })
    .await
    .map_err(|_| "MCP refresh stopped.".to_string())?
}

fn claude_rpc(
    pipe: &Pipe,
    request_id: &str,
    request: Value,
    cancelled: &AtomicBool,
    closed: &AtomicBool,
) -> Result<Value, String> {
    pipe.send(json!({"type":"control_request","request_id":request_id,"request":request}))?;
    let started = Instant::now();
    let mut total = 0;
    loop {
        let frame = pipe.next(cancelled, closed, started, &mut total)?;
        if frame["type"] == "control_response" && frame["response"]["request_id"] == request_id {
            if frame["response"]["subtype"] != "success" {
                return Err("Could not refresh MCP connections. Finish native sign-in, then try Refresh connections again.".into());
            }
            return Ok(frame["response"]["response"].clone());
        }
        if frame["type"] == "control_request" && !claude_tools::bootstrap(pipe, &frame)? {
            return Err("Unexpected tool request while refreshing MCP connections.".into());
        }
    }
}

pub(super) fn claude_statuses(value: &Value) -> Result<Vec<Value>, String> {
    Ok(value["mcpServers"].as_array().ok_or("Claude returned no MCP connection inventory.")?.iter().filter(|server| server["name"] != claude_tools::SERVER).map(|server| {
        let state = server["status"].as_str().unwrap_or("failed");
        json!({"name":server["name"],"available":state=="connected" && server["tools"].as_array().is_none_or(|tools| !tools.is_empty()),"failed":state=="failed","authStatus":if state=="needs-auth" {"notLoggedIn"} else if state=="connected" {"loggedIn"} else {"unsupported"}})
    }).collect())
}

impl Session {
    pub(super) fn refresh_mcp(
        &mut self,
        server: Option<&str>,
        cancelled: &AtomicBool,
        closed: &AtomicBool,
    ) -> Result<Vec<Value>, String> {
        if self.active_request.is_some() {
            return Err(
                "Wait for the response to finish before refreshing MCP connections.".into(),
            );
        }
        if self.thread.is_some() {
            let statuses = self
                .mcp
                .as_mut()
                .map(|connector| connector.refresh(&self.pipe, cancelled, closed))
                .unwrap_or_else(|| Ok(Vec::new()))?;
            if server.is_some_and(|selected| !statuses.iter().any(|item| item["name"] == selected))
            {
                return Err("This MCP server is not in the active CLI configuration.".into());
            }
            return Ok(statuses);
        }
        let id = self.next_id;
        self.next_id += 1;
        let inventory = claude_rpc(
            &self.pipe,
            &format!("mcp-before-{id}"),
            json!({"subtype":"mcp_status"}),
            cancelled,
            closed,
        )?;
        let names: Vec<_> = inventory["mcpServers"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|item| item["name"].as_str())
            .filter(|name| {
                *name != claude_tools::SERVER && server.is_none_or(|selected| selected == *name)
            })
            .map(str::to_string)
            .collect();
        if server.is_some() && names.is_empty() {
            return Err("This MCP server is not in the active connection inventory. Check its CLI configuration.".into());
        }
        for (index, name) in names.iter().enumerate() {
            claude_rpc(
                &self.pipe,
                &format!("mcp-reconnect-{id}-{index}"),
                json!({"subtype":"mcp_reconnect","serverName":name}),
                cancelled,
                closed,
            )?;
        }
        let inventory = claude_rpc(
            &self.pipe,
            &format!("mcp-after-{id}"),
            json!({"subtype":"mcp_status"}),
            cancelled,
            closed,
        )?;
        claude_statuses(&inventory)
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn fixture(agent: &str) -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let binary = dir.path().join("agent.py");
        let code = r#"#!/usr/bin/env python3
import sys,json
from pathlib import Path
agent=AGENT
auth=False
count=0
first=''
def emit(v):print(json.dumps(v),flush=True)
def inventory():
 return {'data':[{'name':'fixture','authStatus':'loggedIn' if auth else 'notLoggedIn','runtimeStatus':'ready' if auth else 'authenticationRequired','tools':{'lookup':{'name':'lookup','inputSchema':{'type':'object'}}} if auth else {},'toolsError':None}],'nextCursor':None}
def answer():
 emit({'method':'item/agentMessage/delta','params':{'threadId':'analysis','turnId':'turn-'+str(count),'itemId':'answer','delta':str(count)+':'+first}})
 emit({'method':'turn/completed','params':{'threadId':'analysis','turn':{'id':'turn-'+str(count),'status':'completed'}}})
for line in sys.stdin:
 f=json.loads(line)
 with Path(__file__).with_suffix('.frames').open('a') as out:out.write(json.dumps(f)+'\n')
 if agent=='claude':
  if f['type']=='control_request':
   r=f['request'];kind=r['subtype'];result={}
   if kind=='initialize':result={'hooks_applied':True}
   elif kind=='mcp_reconnect':assert r['serverName']=='fixture';auth=True
   elif kind=='mcp_status':result={'mcpServers':[{'name':'fixture','status':'connected' if auth else 'needs-auth','tools':[{'name':'lookup'}] if auth else []}]}
   else:raise Exception('Unexpected control')
   emit({'type':'control_response','response':{'subtype':'success','request_id':f['request_id'],'response':result}})
  elif f['type']=='user':
   count+=1;first=first or f['message']['content'];emit({'type':'result','subtype':'success','is_error':False,'result':str(count)+':'+first})
 else:
  m=f.get('method')
  if m=='initialize':emit({'id':f['id'],'result':{}})
  elif m=='config/read':emit({'id':f['id'],'result':{'config':{'mcp_servers':{'fixture':{'url':'https://fixture.example/mcp'}}}}})
  elif m=='thread/start':
   connector=f['params']['baseInstructions'].startswith('Connector-only')
   if not connector:assert any(t['name']=='chista_mcp_call' for t in f['params']['dynamicTools'])
   emit({'id':f['id'],'result':{'thread':{'id':'connector' if connector else 'analysis'},'model':'default'}})
  elif m=='mcpServerStatus/list':
   assert f['params']['threadId']=='connector'
   emit({'id':f['id'],'result':inventory()})
  elif m=='config/mcpServer/reload':auth=True;emit({'id':f['id'],'result':{}})
  elif m=='turn/start':
   count+=1;first=first or f['params']['input'][0]['text']
   emit({'id':f['id'],'result':{'turn':{'id':'turn-'+str(count)}}})
   if count==1:answer()
   else:emit({'id':'dynamic','method':'item/tool/call','params':{'threadId':'analysis','turnId':'turn-'+str(count),'callId':'lookup','tool':'chista_mcp_call','arguments':{'server':'fixture','tool':'lookup','arguments':{'query':'masked'}}}})
  elif m=='mcpServer/tool/call':
   assert auth and f['params']['server']=='fixture' and f['params']['tool']=='lookup'
   assert f['params']['arguments']=={'query':'masked'}
   emit({'id':f['id'],'result':{'content':[{'type':'text','text':'private@example.com'}]}})
  elif f.get('id')=='dynamic' and 'result' in f:
   assert 'SANITIZED' in json.dumps(f) and 'private@example.com' not in json.dumps(f)
   answer()
"#.replace("AGENT", &format!("{agent:?}"));
        std::fs::write(&binary, code).unwrap();
        std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o700)).unwrap();
        (dir, binary)
    }

    #[test]
    #[ignore = "Requires installed CLIs; local MCP fixtures only, no inference"]
    fn installed_cli_refreshes_without_sending_chat() {
        fn quote(value: &str) -> String {
            format!("'{}'", value.replace('\'', "'\\''"))
        }
        for agent in ["claude", "codex"] {
            let dir = tempfile::tempdir().unwrap();
            let marker = dir.path().join("ready");
            let fixture = dir.path().join("fixture.py");
            std::fs::write(&fixture,r#"import sys,json
from pathlib import Path
for line in sys.stdin:
 f=json.loads(line);method=f.get('method');result=None
 if method=='initialize':result={'protocolVersion':'2024-11-05','capabilities':{'tools':{}},'serverInfo':{'name':'fixture','version':'1'}}
 if method=='tools/list':result={'tools':[{'name':'lookup','description':'local fixture','inputSchema':{'type':'object','properties':{}}}] if Path(sys.argv[1]).exists() else []}
 if result is not None:print(json.dumps({'jsonrpc':'2.0','id':f['id'],'result':result}),flush=True)
"#).unwrap();
            let real = resolve_cli("", agent).unwrap();
            let wrapper = dir.path().join("cli-wrapper");
            let args = json!([fixture, marker]).to_string();
            let extra = if agent == "codex" {
                format!(
                    "-c {} -c {}",
                    quote("mcp_servers.fixture.command=\"python3\""),
                    quote(&format!("mcp_servers.fixture.args={args}"))
                )
            } else {
                let config = dir.path().join("fixture.json");
                std::fs::write(
                    &config,
                    json!({"mcpServers":{"fixture":{"command":"python3","args":[fixture,marker]}}})
                        .to_string(),
                )
                .unwrap();
                format!("--mcp-config {}", quote(&config.to_string_lossy()))
            };
            std::fs::write(
                &wrapper,
                format!(
                    "#!/bin/sh\nexec {} \"$@\" {}\n",
                    quote(&real.to_string_lossy()),
                    extra
                ),
            )
            .unwrap();
            std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o700)).unwrap();
            let cancelled = AtomicBool::new(false);
            let closed = AtomicBool::new(false);
            let mut session = Session::start(
                wrapper,
                agent,
                "Status only. No inference.",
                &cancelled,
                &closed,
            )
            .unwrap();
            let thread = session.thread.clone();
            std::fs::write(&marker, "ready").unwrap();
            let statuses = session
                .refresh_mcp(Some("fixture"), &cancelled, &closed)
                .unwrap();
            assert!(
                statuses
                    .iter()
                    .any(|server| server["name"] == "fixture" && server["available"] == true),
                "{agent}: {statuses:?}"
            );
            assert_eq!(session.thread, thread);
            assert!(session.active_request.is_none());
            println!("{agent}: live MCP refresh succeeded without a chat request");
        }
    }

    #[test]
    fn reconnects_after_auth_without_replaying_chat_and_new_codex_tools_remain_reviewed() {
        for agent in ["claude", "codex"] {
            let (_dir, binary) = fixture(agent);
            let cancelled = AtomicBool::new(false);
            let closed = AtomicBool::new(false);
            let mut session =
                Session::start(binary.clone(), agent, "FORMAT", &cancelled, &closed).unwrap();
            let approvals = mcp::Approvals::default();
            let replies = approvals.clone();
            let channel = Channel::new(move |body| {
                if let tauri::ipc::InvokeResponseBody::Json(text) = body {
                    let event: Value = serde_json::from_str(&text).unwrap();
                    if event["type"] == "tool_approval" {
                        replies
                            .respond(
                                event["id"].as_str().unwrap(),
                                json!({"approved":true,"arguments":event["arguments"]}),
                            )
                            .unwrap();
                    }
                    if event["type"] == "tool_result" {
                        replies
                            .respond(
                                event["id"].as_str().unwrap(),
                                json!({"content":"SANITIZED"}),
                            )
                            .unwrap();
                    }
                }
                Ok(())
            });
            assert_eq!(
                session
                    .turn_with_tools("first", &channel, &cancelled, &closed, &approvals, "first")
                    .unwrap(),
                "1:first"
            );
            let thread = session.thread.clone();
            let statuses = session
                .refresh_mcp(Some("fixture"), &cancelled, &closed)
                .unwrap();
            assert_eq!(statuses[0]["available"], true);
            assert_eq!(statuses[0]["authStatus"], "loggedIn");
            assert_eq!(session.thread, thread);
            assert_eq!(
                session
                    .turn_with_tools("next", &channel, &cancelled, &closed, &approvals, "next")
                    .unwrap(),
                "2:first"
            );
            let frames = std::fs::read_to_string(binary.with_extension("frames")).unwrap();
            assert_eq!(
                frames
                    .lines()
                    .filter(|line| line.contains("FORMAT"))
                    .count(),
                usize::from(agent == "codex")
            );
        }
    }
}
