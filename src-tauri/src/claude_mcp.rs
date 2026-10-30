// Claude's native stream-json control channel. SDK hook callbacks run before
// permissions and before MCP output enters the next model request.
use super::*;

// Load only MCP definitions. Loading all user settings would also execute
// unrelated user hooks/plugins before Chista can review them.
pub(super) fn config_file(directory: &std::path::Path) -> Result<PathBuf, String> {
    let source = if let Some(config) = std::env::var_os("CLAUDE_CONFIG_DIR") {
        PathBuf::from(config).join(".claude.json")
    } else {
        PathBuf::from(std::env::var_os("HOME").ok_or("Cannot locate Claude user configuration.")?)
            .join(".claude.json")
    };
    write_config(&source, directory)
}
fn write_config(source: &std::path::Path, directory: &std::path::Path) -> Result<PathBuf, String> {
    let config = match std::fs::File::open(source) {
        Ok(file) => {
            let mut bytes = Vec::new();
            file.take(4_000_001)
                .read_to_end(&mut bytes)
                .map_err(|_| "Cannot read Claude MCP configuration.")?;
            if bytes.len() > 4_000_000 {
                return Err("Claude MCP configuration is too large.".into());
            }
            serde_json::from_slice::<Value>(&bytes)
                .map_err(|_| "Invalid Claude MCP configuration.")?
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => json!({}),
        Err(_) => return Err("Cannot read Claude MCP configuration.".into()),
    };
    let mut servers = config
        .get("mcpServers")
        .cloned()
        .unwrap_or_else(|| json!({}));
    if !servers.is_object() {
        return Err("Invalid Claude MCP server definitions.".into());
    }
    if servers.get(claude_tools::SERVER).is_some() {
        return Err("The MCP server name chista_internal is reserved for Chista tools.".into());
    }
    servers[claude_tools::SERVER] = json!({"type":"sdk","name":claude_tools::SERVER});
    let target = directory.join("claude-mcp.json");
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&target)
        .map_err(|_| "Cannot prepare Claude MCP configuration.")?;
    file.write_all(json!({"mcpServers":servers}).to_string().as_bytes())
        .map_err(|_| "Cannot prepare Claude MCP configuration.")?;
    Ok(target)
}

pub(super) fn initialize(
    pipe: &Pipe,
    cancelled: &AtomicBool,
    closed: &AtomicBool,
) -> Result<Value, String> {
    pipe.send(json!({"type":"control_request","request_id":"chista-init","request":{
        "subtype":"initialize","hooks":{
            "PreToolUse":[{"matcher":"","hookCallbackIds":["chista-pre"],"timeout":360}],
            "PostToolUse":[{"matcher":"","hookCallbackIds":["chista-post"],"timeout":360}],
            "PostToolUseFailure":[{"matcher":"","hookCallbackIds":["chista-failure"],"timeout":360}]
        }
    }}))?;
    let mut total = 0;
    let started = Instant::now();
    loop {
        let event = pipe.next(cancelled, closed, started, &mut total)?;
        if event["type"] == "control_response" && event["response"]["request_id"] == "chista-init" {
            return if event["response"]["subtype"] == "success"
                && event["response"]["response"]["hooks_applied"] == true
            {
                Ok(event["response"]["response"].clone())
            } else {
                Err("Claude could not initialize MCP tool callbacks. Update Claude Code and try again.".into())
            };
        }
        if event["type"] == "control_request" {
            if claude_tools::bootstrap(pipe, &event)? {
                continue;
            }
            return Err("Unexpected tool request before Claude initialization.".into());
        }
    }
}

fn reply(pipe: &Pipe, event: &Value, response: Value) -> Result<(), String> {
    pipe.send(json!({"type":"control_response","response":{"subtype":"success","request_id":event["request_id"],"response":response}}))
}

pub(super) fn status(event: &Value, events: &Channel<Value>) -> Result<(), String> {
    if event["type"] == "system" && event["subtype"] == "init" {
        let servers: Vec<_> = event["mcp_servers"].as_array().into_iter().flatten().filter(|server| server["name"] != claude_tools::SERVER).map(|server| {
            let status = server["status"].as_str().unwrap_or("failed");
            json!({"name":server["name"],"available":status=="connected","failed":status=="failed",
                "authStatus":if status=="needs-auth" {"notLoggedIn"} else {"unsupported"}})
        }).collect();
        events
            .send(json!({"type":"mcp_status","servers":servers}))
            .map_err(|_| "Chat closed.")?;
    }
    Ok(())
}

pub(super) fn control(
    pipe: &Pipe,
    event: &Value,
    events: &Channel<Value>,
    approvals: &mcp::Approvals,
    request_id: &str,
    cancelled: &AtomicBool,
    closed: &AtomicBool,
    pending: &mut HashMap<String, String>,
    seen: &mut std::collections::HashSet<String>,
) -> Result<(), String> {
    let bridge = &event["request"];
    if bridge["subtype"] == "mcp_message"
        && bridge["server_name"] == claude_tools::SERVER
        && bridge["message"]["method"] == "tools/call"
    {
        let id = format!("sdk-http:{}", bridge["message"]["id"]);
        if !seen.insert(id) {
            return Err("Duplicate Claude HTTP tool call rejected.".into());
        }
    }
    if claude_tools::call(
        pipe, event, events, approvals, request_id, cancelled, closed,
    )? {
        return Ok(());
    }
    let request = &event["request"];
    if request["subtype"] != "hook_callback" {
        // PreToolUse handles MCP permissions even if CLI settings would allow
        // a tool automatically. Never grant an unreviewed permission fallback.
        return reply(
            pipe,
            event,
            json!({"behavior":"deny","message":"Only MCP tools reviewed by Chista are allowed."}),
        );
    }
    let input = &request["input"];
    let name = input["tool_name"].as_str().unwrap_or("");
    let call = input["tool_use_id"]
        .as_str()
        .filter(|id| !id.is_empty() && id.len() <= 200)
        .ok_or("Invalid Claude tool call ID.")?;
    let key = format!("{request_id}:{call}");
    let callback = request["callback_id"].as_str().unwrap_or("");
    let hook = input["hook_event_name"].as_str().unwrap_or("");
    if callback == "chista-pre" && hook == "PreToolUse" {
        if !seen.insert(call.to_string()) {
            return Err("Duplicate Claude tool call rejected.".into());
        }
        if !name.starts_with("mcp__") || !input["tool_input"].is_object() {
            return reply(
                pipe,
                event,
                json!({"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Only MCP tools are available in Chista chat."}}),
            );
        }
        if name == claude_tools::HTTP_TOOL {
            // The bridge runs the shared HTTP approval/sanitization pipeline.
            pending.insert(call.to_string(), name.to_string());
            return reply(
                pipe,
                event,
                json!({"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}),
            );
        }
        // Native names can contain underscores; display the complete native
        // identifier as the tool name rather than guessing its server boundary.
        let server = name
            .strip_prefix("mcp__")
            .unwrap()
            .split("__")
            .next()
            .unwrap_or("MCP");
        let approved = approvals.exchange(events, format!("{key}:approve"), json!({"type":"tool_approval","callId":key,"server":server,"tool":name,"arguments":input["tool_input"]}), cancelled, closed)?;
        if approved["approved"] != true {
            events.send(json!({"type":"tool_progress","callId":key,"server":server,"tool":name,"state":"denied"})).map_err(|_| "Chat closed.")?;
            return reply(
                pipe,
                event,
                json!({"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"User denied this call. Do not retry without an explicit new request."}}),
            );
        }
        if !approved["arguments"].is_object() {
            return Err("Invalid approved MCP arguments.".into());
        }
        pending.insert(call.to_string(), name.to_string());
        events.send(json!({"type":"tool_progress","callId":key,"server":server,"tool":name,"state":"running"})).map_err(|_| "Chat closed.")?;
        return reply(
            pipe,
            event,
            json!({"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","updatedInput":approved["arguments"]}}),
        );
    }
    if pending.remove(call).as_deref() != Some(name) {
        return Err("Unreviewed Claude tool output rejected.".into());
    }
    if name == claude_tools::HTTP_TOOL
        && matches!(
            (callback, hook),
            ("chista-post", "PostToolUse") | ("chista-failure", "PostToolUseFailure")
        )
    {
        // Only the bridge's already sanitized result can reach these callbacks.
        return reply(pipe, event, json!({}));
    }
    if callback == "chista-failure" && hook == "PostToolUseFailure" {
        // Failure hooks cannot replace the native error text. End this turn
        // before Claude can consume an unsanitized transport/server error.
        return Err("Claude MCP tool failed. Check server access and native MCP sign-in; send a new message to retry.".into());
    }
    if callback != "chista-post" || hook != "PostToolUse" {
        return Err("Unexpected Claude tool callback.".into());
    }
    let result = mcp::filter_result(input["tool_response"].clone());
    let success = result["isError"] != true && result.get("error").is_none();
    let server = name
        .strip_prefix("mcp__")
        .unwrap_or(name)
        .split("__")
        .next()
        .unwrap_or("MCP");
    let safe = approvals.exchange(events, format!("{key}:result"), json!({"type":"tool_result","callId":key,"server":server,"tool":name,"success":success,"result":result}), cancelled, closed)?;
    let content = safe["content"]
        .as_str()
        .ok_or("Sanitized MCP result missing.")?;
    reply(
        pipe,
        event,
        json!({"hookSpecificOutput":{"hookEventName":"PostToolUse","updatedMCPToolOutput":{"content":[{"type":"text","text":content}],"isError":!success || safe["success"]==false}}}),
    )
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn fixture(scenario: &str) -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let binary = dir.path().join("claude.py");
        let script = r#"#!/usr/bin/env python3
import json,sys
scenario=SCENARIO
args=sys.argv[1:]
assert '--safe-mode' not in args and '--strict-mcp-config' in args
assert json.load(open(args[args.index('--mcp-config')+1])).get('mcpServers') is not None
assert args[args.index('--tools')+1]==''
assert args[args.index('--setting-sources')+1]==''
assert args[args.index('--permission-prompt-tool')+1]=='stdio'
assert '--disable-slash-commands' in args
assert 'disableAllHooks' not in ' '.join(args)
def emit(v): print(json.dumps(v),flush=True)
def read(): return json.loads(sys.stdin.readline())
f=read()
assert f['request']['hooks']['PostToolUse'][0]['hookCallbackIds']==['chista-post']
emit({'type':'control_response','response':{'subtype':'success','request_id':f['request_id'],'response':{'hooks_applied':scenario!='unsupported'}}})
if scenario=='unsupported': sys.stdin.read();sys.exit()
assert read()['type']=='user'
emit({'type':'system','subtype':'init','mcp_servers':[{'name':'fixture','status':'connected'}]})
tool='Bash' if scenario=='builtin' else 'mcp__fixture__search'
def hook(callback,event):
 emit({'type':'control_request','request_id':callback,'request':{'subtype':'hook_callback','callback_id':callback,'input':{'hook_event_name':event,'tool_name':tool,'tool_use_id':'call','tool_input':{'query':'original@example.com'},'tool_response':{'content':[{'type':'text','text':'private@example.com'},{'type':'image','data':'PRIVATE_BINARY'}]}}}})
 if scenario=='failure' and event=='PostToolUseFailure':
  sys.stdin.read();sys.exit()
 return read()['response']['response']['hookSpecificOutput']
r=hook('chista-pre','PreToolUse')
assert r['permissionDecision']==('deny' if scenario in ['denied','builtin'] else 'allow')
if scenario not in ['denied','builtin']:
 assert r['updatedInput']=={'query':'SANITIZED ARGUMENT'}
 if scenario=='duplicate':
  hook('chista-pre','PreToolUse');sys.exit(8)
 if scenario=='failure': hook('chista-failure','PostToolUseFailure')
 if scenario=='unreviewed':
  tool='mcp__other__search'
 r=hook('chista-post','PostToolUse')
 assert r['updatedMCPToolOutput']['content']==[{'type':'text','text':'SANITIZED RESULT'}]
 assert 'private@example.com' not in json.dumps(r) and 'PRIVATE_BINARY' not in json.dumps(r)
emit({'type':'result','subtype':'success','is_error':False,'result':'Done'})
sys.stdin.read()
"#.replace("SCENARIO", &format!("{scenario:?}"));
        std::fs::write(&binary, script).unwrap();
        std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o700)).unwrap();
        (dir, binary)
    }

    #[test]
    fn claude_requires_approval_and_replaces_mcp_output_before_inference() {
        for scenario in [
            "allowed",
            "denied",
            "builtin",
            "failure",
            "duplicate",
            "unreviewed",
        ] {
            let (_dir, binary) = fixture(scenario);
            let cancelled = AtomicBool::new(false);
            let closed = AtomicBool::new(false);
            let mut session =
                Session::start(binary, "claude", "FORMAT", &cancelled, &closed).unwrap();
            let approvals = mcp::Approvals::default();
            let replies = approvals.clone();
            let seen = Arc::new(Mutex::new(Vec::<Value>::new()));
            let copy = seen.clone();
            let channel = Channel::new(move |body| {
                if let tauri::ipc::InvokeResponseBody::Json(text) = body {
                    let event: Value = serde_json::from_str(&text).unwrap();
                    copy.lock().unwrap().push(event.clone());
                    if event["type"] == "tool_approval" {
                        replies.respond(event["id"].as_str().unwrap(), json!({"approved":scenario!="denied","arguments":{"query":"SANITIZED ARGUMENT"}})).unwrap();
                    } else if event["type"] == "tool_result" {
                        assert!(event["result"].to_string().contains("private@example.com"));
                        assert!(!event["result"].to_string().contains("PRIVATE_BINARY"));
                        replies
                            .respond(
                                event["id"].as_str().unwrap(),
                                json!({"content":"SANITIZED RESULT"}),
                            )
                            .unwrap();
                    }
                }
                Ok(())
            });
            let result = session.turn_with_tools(
                "Search", &channel, &cancelled, &closed, &approvals, "request",
            );
            if ["failure", "duplicate", "unreviewed"].contains(&scenario) {
                assert!(result.is_err(), "{scenario}");
                assert!(!result.unwrap_err().contains("private@example.com"));
            } else {
                assert_eq!(result.unwrap(), "Done", "{scenario}");
            }
            let seen = seen.lock().unwrap();
            assert!(seen
                .iter()
                .any(|event| event["type"] == "mcp_status"
                    && event["servers"][0]["available"] == true));
            assert_eq!(
                seen.iter()
                    .filter(|event| event["type"] == "tool_approval")
                    .count(),
                usize::from(scenario != "builtin")
            );
            assert_eq!(
                seen.iter()
                    .filter(|event| event["type"] == "tool_result")
                    .count(),
                usize::from(scenario == "allowed")
            );
        }
    }

    #[test]
    fn copies_only_mcp_definitions_into_a_private_session_file() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("user.json");
        let session = tempfile::tempdir().unwrap();
        std::fs::write(&source, json!({"mcpServers":{"fixture":{"command":"fixture","env":{"TOKEN":"native-only-secret"}}},"hooks":{"PreToolUse":["never-run"]},"oauthAccount":{"email":"private@example.com"}}).to_string()).unwrap();
        let target = write_config(&source, session.path()).unwrap();
        let output = std::fs::read_to_string(&target).unwrap();
        let value: Value = serde_json::from_str(&output).unwrap();
        assert_eq!(value.as_object().unwrap().len(), 1);
        assert_eq!(
            value["mcpServers"]["fixture"]["env"]["TOKEN"],
            "native-only-secret"
        );
        assert!(!output.contains("private@example.com"));
        assert!(!output.contains("never-run"));
        assert_eq!(
            std::fs::metadata(target).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }

    #[test]
    fn handles_missing_config_and_rejects_malformed_definitions() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("user.json");
        let session = tempfile::tempdir().unwrap();
        let target = write_config(&source, session.path()).unwrap();
        assert_eq!(
            std::fs::read_to_string(target).unwrap(),
            r#"{"mcpServers":{"chista_internal":{"name":"chista_internal","type":"sdk"}}}"#
        );
        for invalid in [r#"{"mcpServers":[]}"#, "broken JSON"] {
            std::fs::write(&source, invalid).unwrap();
            let session = tempfile::tempdir().unwrap();
            assert!(write_config(&source, session.path()).is_err());
        }
    }

    #[test]
    fn refuses_claude_without_result_sanitization_hooks() {
        let (_dir, binary) = fixture("unsupported");
        let result = Session::start(
            binary,
            "claude",
            "FORMAT",
            &AtomicBool::new(false),
            &AtomicBool::new(false),
        );
        assert!(result.is_err());
    }
}
