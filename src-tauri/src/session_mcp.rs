// MCP is a connector-only thread: it never runs inference. The analysis thread
// gets dynamic tools and can receive only locally sanitized tool results.
use super::*;
type Reply = mpsc::Sender<Value>;
#[derive(Default, Clone)]
pub struct Approvals(Arc<Mutex<HashMap<String, Reply>>>);
#[tauri::command]
pub fn respond_agent_tool(
    id: String,
    response: Value,
    approvals: tauri::State<'_, Approvals>,
) -> Result<(), String> {
    if response.to_string().len() > 1_000_000 {
        return Err("Tool response is too large.".into());
    }
    let sender = approvals
        .0
        .lock()
        .unwrap()
        .remove(&id)
        .ok_or("This tool request has expired.")?;
    sender
        .send(response)
        .map_err(|_| "This tool request has ended.".into())
}
impl Approvals {
    fn exchange(
        &self,
        events: &Channel<Value>,
        id: String,
        mut event: Value,
        cancelled: &AtomicBool,
        closed: &AtomicBool,
    ) -> Result<Value, String> {
        let (tx, rx) = mpsc::channel();
        self.0.lock().unwrap().insert(id.clone(), tx);
        event["id"] = json!(id);
        let result = (|| {
            events.send(event).map_err(|_| "Chat closed.")?;
            let start = Instant::now();
            loop {
                if cancelled.load(Ordering::SeqCst) || closed.load(Ordering::SeqCst) {
                    return Err("Request cancelled.".into());
                }
                if start.elapsed() > Duration::from_secs(300) {
                    return Err("Tool approval timed out.".into());
                }
                match rx.recv_timeout(Duration::from_millis(25)) {
                    Ok(value) => return Ok(value),
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                    Err(_) => return Err("Tool approval closed.".into()),
                }
            }
        })();
        self.0.lock().unwrap().remove(&id);
        result
    }
}
#[derive(Clone)]
struct Tool {
    server: String,
    name: String,
}
pub(super) struct Connector {
    thread: String,
    tools: HashMap<String, Tool>,
    pub statuses: Vec<Value>,
}

pub fn safe_servers(config: &Value) -> Result<(Value, Vec<String>), String> {
    let mut overrides = crate::codex_stream::disabled_servers(config)?;
    let mut names = Vec::new();
    if let Some(servers) = config["mcp_servers"].as_object() {
        for (name, value) in servers {
            // Keep effective transports valid even for disabled CLI overrides.
            // These values stay inside the CLI and never enter model messages.
            overrides["mcp_servers"][name] = Value::Object(
                value
                    .as_object()
                    .ok_or("Invalid MCP server configuration.")?
                    .iter()
                    .filter(|(_, v)| !v.is_null())
                    .map(|(k, v)| (k.clone(), v.clone()))
                    .collect(),
            );
            overrides["mcp_servers"][name]["enabled"] = json!(false);

            let allowed = value["enabled"] != false
                && value.get("command").is_none()
                && value["url"]
                    .as_str()
                    .and_then(|url| tauri::Url::parse(url).ok())
                    .is_some_and(|url| {
                        (url.scheme() == "https"
                            || (url.scheme() == "http"
                                && matches!(
                                    url.host_str(),
                                    Some("localhost") | Some("127.0.0.1") | Some("[::1]")
                                )))
                            && url.username().is_empty()
                            && url.password().is_none()
                    });
            if allowed {
                overrides["mcp_servers"][name]["enabled"] = json!(true);
                names.push(name.clone());
            }
        }
    }
    // Wait for the configured servers' startup before taking the tool snapshot.
    overrides["mcp_optional_startup_grace_ms"] = json!(0);
    Ok((overrides, names))
}
pub(super) fn analysis_config(config: &Value) -> Result<Value, String> {
    let (mut config, _) = safe_servers(config)?;
    if let Some(servers) = config["mcp_servers"].as_object_mut() {
        for server in servers.values_mut() {
            server["enabled"] = json!(false);
        }
    }
    Ok(config)
}
fn rpc(
    pipe: &Pipe,
    id: u64,
    method: &str,
    params: Value,
    cancelled: &AtomicBool,
    closed: &AtomicBool,
) -> Result<Value, String> {
    pipe.send(json!({"id":id,"method":method,"params":params}))?;
    let start = Instant::now();
    let mut total = 0;
    loop {
        let event = pipe.next(cancelled, closed, start, &mut total)?;
        if pipe.reject_tool(&event)? {
            continue;
        }
        if event["id"].as_u64() == Some(id) {
            if event.get("error").is_some() {
                return Err(
                    "MCP connection failed. Check the configured server and native sign-in.".into(),
                );
            }
            return Ok(event["result"].clone());
        }
    }
}
impl Connector {
    pub(super) fn start(
        pipe: &Pipe,
        config: &Value,
        directory: &std::path::Path,
        cancelled: &AtomicBool,
        closed: &AtomicBool,
    ) -> Result<Option<Self>, String> {
        let (safe, names) = safe_servers(config)?;
        if names.is_empty() {
            return Ok(None);
        }
        let result = rpc(
            pipe,
            40,
            "thread/start",
            json!({"cwd":directory,"ephemeral":true,"approvalPolicy":"never","permissions":"chista","environments":[],"config":safe,"baseInstructions":"Connector-only thread. Never run inference."}),
            cancelled,
            closed,
        )?;
        let thread = result["thread"]["id"]
            .as_str()
            .ok_or("MCP connector thread missing.")?
            .to_string();
        let mut tools = HashMap::new();
        let mut statuses = Vec::new();
        let mut cursor = Value::Null;
        let mut request = 41;
        loop {
            let result = rpc(
                pipe,
                request,
                "mcpServerStatus/list",
                json!({"threadId":thread,"cursor":cursor,"limit":100,"detail":"toolsAndAuthOnly"}),
                cancelled,
                closed,
            )?;
            request += 1;
            for server in result["data"]
                .as_array()
                .ok_or("MCP inventory unavailable. Update Codex CLI.")?
            {
                let Some(name) = server["name"]
                    .as_str()
                    .filter(|name| names.iter().any(|n| n == *name))
                else {
                    continue;
                };
                statuses.push(json!({"name":name,"authStatus":if server["runtimeStatus"]=="authenticationRequired" {json!("notLoggedIn")}else{server["authStatus"].clone()},"available":server["tools"].as_object().is_some_and(|t|!t.is_empty()),"failed":!server["toolsError"].is_null()}));
                if let Some(entries) = server["tools"].as_object() {
                    for (tool, _) in entries {
                        if tools.len() >= 100 {
                            return Err("MCP catalog exceeds 100 tools. Limit enabled tools in Codex configuration.".into());
                        }
                        tools.insert(
                            format!("chista_mcp_{}", tools.len()),
                            Tool {
                                server: name.into(),
                                name: tool.clone(),
                            },
                        );
                    }
                }
            }
            cursor = result["nextCursor"].clone();
            if cursor.is_null() {
                break;
            }
            if request > 50 {
                return Err("MCP inventory has too many pages.".into());
            }
        }
        Ok(Some(Self {
            thread,
            tools,
            statuses,
        }))
    }
    pub(super) fn definitions(&self) -> Vec<Value> {
        // A generic object allows arguments to be reviewed and sanitized before
        // the connector applies the MCP server's own schema validation.
        let mut tools:Vec<_>=self.tools.iter().map(|(alias,tool)|json!({
            "type":"function","name":alias,"description":format!("Call MCP server {}, tool {}. Only use after consulting chista_mcp_catalog for its input schema. Chista requires approval for each call.",tool.server,tool.name),
            "inputSchema":{"type":"object","properties":{"arguments":{"type":"object","additionalProperties":true}},"required":["arguments"],"additionalProperties":false}
        })).collect();
        tools.push(json!({"type":"function","name":"chista_mcp_catalog","description":"Inspect configured MCP server names, availability and tool input schemas. Use this when asked to connect to an MCP server.","inputSchema":{"type":"object","properties":{},"additionalProperties":false}}));
        tools
    }
    pub(super) fn call(
        &self,
        pipe: &Pipe,
        event: &Value,
        events: &Channel<Value>,
        approvals: &Approvals,
        request_id: &str,
        cancelled: &AtomicBool,
        closed: &AtomicBool,
    ) -> Result<bool, String> {
        let alias = event["params"]["tool"].as_str().unwrap_or("");
        if alias != "chista_mcp_catalog" && !self.tools.contains_key(alias) {
            return Ok(false);
        }
        let call = event["params"]["callId"]
            .as_str()
            .ok_or("Tool call ID missing.")?;
        if call.len() > 200 {
            return Err("Invalid tool call ID.".into());
        }
        let call_key = format!("{request_id}:{call}");
        let tool_info = self.tools.get(alias);
        let result = if alias == "chista_mcp_catalog" {
            rpc(
                pipe,
                60,
                "mcpServerStatus/list",
                json!({"threadId":self.thread,"limit":100,"detail":"toolsAndAuthOnly"}),
                cancelled,
                closed,
            )?
        } else {
            let tool = &self.tools[alias];
            let input = event["params"]["arguments"]["arguments"].clone();
            if !input.is_object() {
                return Err("MCP arguments must be an object.".into());
            }
            let approved=approvals.exchange(events,format!("{request_id}:{call}:approve"),json!({"type":"tool_approval","callId":call_key,"server":tool.server,"tool":tool.name,"arguments":input}),cancelled,closed)?;
            if approved["approved"] != true {
                events.send(json!({"type":"tool_progress","callId":call_key,"server":tool.server,"tool":tool.name,"state":"denied"})).map_err(|_| "Chat closed.")?;
                return self.finish(
                    pipe,
                    event,
                    json!({"error":"User denied this tool call."}),
                    false,
                );
            }
            if !approved["arguments"].is_object() {
                return Err("Invalid approved tool arguments.".into());
            }
            events.send(json!({"type":"tool_progress","callId":call_key,"server":tool.server,"tool":tool.name,"state":"running"})).map_err(|_| "Chat closed.")?;
            match rpc(
                pipe,
                61,
                "mcpServer/tool/call",
                json!({"threadId":self.thread,"server":tool.server,"tool":tool.name,"arguments":approved["arguments"]}),
                cancelled,
                closed,
            ) {
                Ok(result) => result,
                Err(_) => {
                    json!({"error":"MCP tool failed. Check server access and native MCP sign-in. Do not retry automatically."})
                }
            }
        };
        // The catalog also crosses the local sanitizer before reaching AI.
        let success = result["isError"] != true && result.get("error").is_none();
        let filtered = filter_result(result);
        let safe = approvals.exchange(
            events,
            format!("{request_id}:{call}:result"),
            json!({"type":"tool_result","callId":call_key,"server":tool_info.map(|tool|&tool.server),"tool":tool_info.map(|tool|&tool.name),"success":success,"result":filtered}),
            cancelled,
            closed,
        )?;
        let content = safe["content"]
            .as_str()
            .ok_or("Sanitized MCP result missing.")?;
        self.finish(
            pipe,
            event,
            json!({"text":content}),
            success && safe["success"] != false,
        )
    }
    fn finish(
        &self,
        pipe: &Pipe,
        event: &Value,
        result: Value,
        success: bool,
    ) -> Result<bool, String> {
        let text = result["text"]
            .as_str()
            .map(str::to_string)
            .unwrap_or_else(|| result.to_string());
        pipe.send(json!({"id":event["id"],"result":{"contentItems":[{"type":"inputText","text":text}],"success":success}}))?;
        Ok(true)
    }
}
fn filter_result(mut result: Value) -> Value {
    if let Some(content) = result["content"].as_array_mut() {
        *content = content
            .iter()
            .filter(|part| part["type"] == "text")
            .map(|part| json!({"type":"text","text":part["text"]}))
            .collect();
    }
    // Never expose binary image/audio/resource data or opaque metadata.
    if result.get("content").is_some() {
        return json!({"content":result["content"],"structuredContent":result["structuredContent"],"isError":result["isError"]});
    }
    // Catalog may contain remote URLs and metadata. Keep names, schemas and tool
    // descriptions only, without server URLs, auth tokens or resource bodies.
    if let Some(servers) = result["data"].as_array() {
        return json!({"servers":servers.iter().map(|s|{
            let tools:serde_json::Map<String,Value>=s["tools"].as_object().map(|tools|tools.iter().map(|(name,t)|(name.clone(),json!({"name":t["name"],"description":t["description"],"inputSchema":t["inputSchema"]}))).collect()).unwrap_or_default();
            json!({"name":s["name"],"authStatus":s["authStatus"],"connectionStatus":s["runtimeStatus"],"connectionFailed":!s["toolsError"].is_null(),"tools":tools})
        }).collect::<Vec<_>>()});
    }
    result
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_configured_https_or_loopback_servers_can_start() {
        let (config, names) = safe_servers(&json!({"mcp_servers":{
            "remote":{"url":"https://example.com/mcp","headers":{"secret":"private"},"tool_timeout_sec":null},
            "local":{"command":"cat","args":["/private/file"]},
            "loopback":{"url":"http://localhost:123/mcp"},
            "insecure":{"url":"http://example.com/mcp"},
            "disabled":{"url":"https://example.com","enabled":false}
        }}))
        .unwrap();
        assert_eq!(names, vec!["loopback", "remote"]);
        assert!(config["mcp_servers"]["remote"]
            .get("tool_timeout_sec")
            .is_none());
        let analysis = analysis_config(&config).unwrap();
        assert_eq!(analysis["mcp_servers"]["remote"]["enabled"], false);
        assert_eq!(config["mcp_servers"]["local"]["enabled"], false);
        assert_eq!(config["mcp_servers"]["local"]["enabled"], false);
        assert_eq!(
            config["mcp_servers"]["remote"]["url"],
            "https://example.com/mcp"
        );
    }
    #[test]
    fn result_drops_binary_and_metadata() {
        let result = filter_result(
            json!({"content":[{"type":"image","data":"SECRET"},{"type":"text","text":"sample","_meta":{"token":"SECRET"}}],"_meta":{"token":"SECRET"}}),
        );
        assert!(!result.to_string().contains("SECRET"));
        assert_eq!(result["content"].as_array().unwrap().len(), 1);
    }
    #[test]
    fn cancelling_approval_releases_the_pending_reply() {
        let approvals = Approvals::default();
        let cancelled = Arc::new(AtomicBool::new(false));
        let copy = cancelled.clone();
        let channel = Channel::new(move |_| {
            copy.store(true, Ordering::SeqCst);
            Ok(())
        });
        assert!(approvals
            .exchange(
                &channel,
                "one".into(),
                json!({"type":"tool_approval"}),
                &cancelled,
                &AtomicBool::new(false)
            )
            .is_err());
        assert!(approvals.0.lock().unwrap().is_empty());
    }
    #[cfg(unix)]
    #[test]
    fn proxy_requires_approval_and_only_returns_sanitized_results_to_analysis() {
        use std::os::unix::fs::PermissionsExt;
        for (allowed, sanitized) in [(true, true), (false, true), (true, false)] {
            let dir = tempfile::tempdir().unwrap();
            let binary = dir.path().join("agent.py");
            let code = r#"#!/usr/bin/env python3
import json,sys
from pathlib import Path
frames=Path(__file__).with_suffix('.frames')
def emit(x): print(json.dumps(x),flush=True)
for line in sys.stdin:
 f=json.loads(line)
 with frames.open('a') as out: out.write(json.dumps(f)+'\n')
 m=f.get('method')
 if m=='initialize': emit({'id':f['id'],'result':{}})
 elif m=='config/read': emit({'id':f['id'],'result':{'config':{'mcp_servers':{'fixture':{'url':'https://fixture.example/mcp'}}}}})
 elif m=='thread/start':
  connector=f['id']==40
  assert f['params']['config']['mcp_servers']['fixture']['enabled']==connector
  if not connector: assert len(f['params']['dynamicTools'])==2
  emit({'id':f['id'],'result':{'thread':{'id':'connector' if connector else 'analysis'}}})
 elif m=='mcpServerStatus/list':
  emit({'id':f['id'],'result':{'data':[{'name':'fixture','authStatus':'oAuth','tools':{'search':{'name':'search','inputSchema':{'type':'object'}}}}],'nextCursor':None}})
 elif m=='turn/start':
  emit({'id':f['id'],'result':{'turn':{'id':'turn'}}})
  emit({'id':'call','method':'item/tool/call','params':{'threadId':'analysis','turnId':'turn','callId':'lookup','tool':'chista_mcp_0','arguments':{'arguments':{'query':'[EMAIL_1]'}}}})
 elif m=='mcpServer/tool/call':
  assert f['params']['threadId']=='connector'
  assert f['params']['arguments']=={'query':'[EMAIL_1]'}
  emit({'id':f['id'],'result':{'content':[{'type':'text','text':'alex@example.com'},{'type':'image','data':'BINARY'}]}})
 elif f.get('id')=='call' and 'result' in f:
  assert 'alex@example.com' not in json.dumps(f)
  assert 'BINARY' not in json.dumps(f)
  assert f['result']['success'] == EXPECTED_SUCCESS
  emit({'method':'item/completed','params':{'threadId':'analysis','turnId':'turn','item':{'type':'agentMessage','text':'Completed'}}})
  emit({'method':'turn/completed','params':{'threadId':'analysis','turn':{'id':'turn','status':'completed'}}})
"#;
            std::fs::write(
                &binary,
                code.replace(
                    "EXPECTED_SUCCESS",
                    if allowed && sanitized {
                        "True"
                    } else {
                        "False"
                    },
                ),
            )
            .unwrap();
            std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o700)).unwrap();
            let cancelled = AtomicBool::new(false);
            let closed = AtomicBool::new(false);
            let mut session =
                Session::start(binary.clone(), "codex", "Instructions", &cancelled, &closed)
                    .unwrap();
            let approvals = Approvals::default();
            let copy = approvals.clone();
            let observed = Arc::new(Mutex::new(Vec::new()));
            let observed_copy = observed.clone();
            let channel = Channel::new(move |body| {
                if let tauri::ipc::InvokeResponseBody::Json(text) = body {
                    let event: Value = serde_json::from_str(&text).unwrap();
                    match event["type"].as_str() {
                        Some("tool_approval") => {
                            assert_eq!(event["callId"], "request:lookup");
                            observed_copy.lock().unwrap().push("approval".to_string());
                        }
                        Some("tool_progress") => observed_copy
                            .lock()
                            .unwrap()
                            .push(event["state"].as_str().unwrap().to_string()),
                        Some("tool_result") => {
                            assert_eq!(event["server"], "fixture");
                            assert_eq!(event["tool"], "search");
                            assert_eq!(event["success"], true);
                            observed_copy.lock().unwrap().push("result".to_string());
                        }
                        _ => {}
                    }
                    let reply = match event["type"].as_str() {
                        Some("tool_approval") => {
                            Some(json!({"approved":allowed,"arguments":event["arguments"]}))
                        }
                        Some("tool_result") => {
                            assert!(!event.to_string().contains("BINARY"));
                            Some(if sanitized {
                                json!({"content":"[EMAIL_1]"})
                            } else {
                                json!({"content":"MCP result could not be sanitized.","success":false})
                            })
                        }
                        _ => None,
                    };
                    if let Some(reply) = reply {
                        copy.0
                            .lock()
                            .unwrap()
                            .remove(event["id"].as_str().unwrap())
                            .unwrap()
                            .send(reply)
                            .unwrap();
                    }
                }
                Ok(())
            });
            assert_eq!(
                session
                    .turn_with_tools(
                        "Inspect", &channel, &cancelled, &closed, &approvals, "request"
                    )
                    .unwrap(),
                "Completed"
            );
            assert_eq!(
                *observed.lock().unwrap(),
                if allowed {
                    vec!["approval", "running", "result"]
                } else {
                    vec!["approval", "denied"]
                }
            );
            drop(session);
            let frames = std::fs::read_to_string(binary.with_extension("frames")).unwrap();
            assert_eq!(frames.contains("mcpServer/tool/call"), allowed);
            assert!(!frames.contains("alex@example.com"));
            assert!(approvals.0.lock().unwrap().is_empty());
        }
    }
}
