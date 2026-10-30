// Chista's built-in tools use Claude's native in-process MCP transport. The
// HTTP implementation and approval/result events are shared with Codex.
use super::*;

pub(super) const SERVER: &str = "chista_internal";
pub(super) const HTTP_TOOL: &str = "mcp__chista_internal__chista_http_request";

fn response(pipe: &Pipe, event: &Value, result: Value) -> Result<(), String> {
    pipe.send(json!({"type":"control_response","response":{"subtype":"success","request_id":event["request_id"],"response":{"mcp_response":{"jsonrpc":"2.0","id":event["request"]["message"]["id"],"result":result}}}}))
}

pub(super) fn bootstrap(pipe: &Pipe, event: &Value) -> Result<bool, String> {
    let request = &event["request"];
    if request["subtype"] != "mcp_message" || request["server_name"] != SERVER {
        return Ok(false);
    }
    let message = &request["message"];
    let result = match message["method"].as_str() {
        Some("initialize") => {
            json!({"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"Chista","version":"0.1.0"}})
        }
        Some("tools/list") => {
            let definition = http::definition();
            json!({"tools":[{"name":definition["name"],"description":definition["description"],"inputSchema":definition["inputSchema"]}]})
        }
        Some("ping" | "notifications/initialized" | "notifications/cancelled") => json!({}),
        Some("tools/call") => return Ok(false),
        _ => {
            pipe.send(json!({"type":"control_response","response":{"subtype":"success","request_id":event["request_id"],"response":{"mcp_response":{"jsonrpc":"2.0","id":message["id"],"error":{"code":-32601,"message":"Unsupported Chista tool method."}}}}}))?;
            return Ok(true);
        }
    };
    response(pipe, event, result)?;
    Ok(true)
}

pub(super) fn call(
    pipe: &Pipe,
    event: &Value,
    events: &Channel<Value>,
    approvals: &mcp::Approvals,
    request_id: &str,
    cancelled: &AtomicBool,
    closed: &AtomicBool,
) -> Result<bool, String> {
    if bootstrap(pipe, event)? {
        return Ok(true);
    }
    let request = &event["request"];
    if request["subtype"] != "mcp_message" || request["server_name"] != SERVER {
        return Ok(false);
    }
    let message = &request["message"];
    if message["method"] != "tools/call" || message["params"]["name"] != "chista_http_request" {
        response(
            pipe,
            event,
            json!({"content":[{"type":"text","text":"Unknown Chista tool."}],"isError":true}),
        )?;
        return Ok(true);
    }
    let call = format!("http-{}", message["id"]);
    if call.len() > 200 {
        return Err("Invalid Claude HTTP call ID.".into());
    }
    let (text, success) = http::perform(
        message["params"]["arguments"].clone(),
        &call,
        events,
        approvals,
        request_id,
        cancelled,
        closed,
    )?;
    response(
        pipe,
        event,
        json!({"content":[{"type":"text","text":text}],"isError":!success}),
    )?;
    Ok(true)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn native_mcp_handshake_exposes_the_shared_http_schema() {
        let mut command = Command::new("python3");
        command.args([
            "-u",
            "-c",
            "import sys\nfor line in sys.stdin: print(line, end='', flush=True)",
        ]);
        let pipe = Pipe::spawn(&mut command).unwrap();
        let cancelled = AtomicBool::new(false);
        let closed = AtomicBool::new(false);
        let mut total = 0;
        for method in ["initialize", "tools/list", "ping", "unknown"] {
            let event = json!({"type":"control_request","request_id":"bridge","request":{"subtype":"mcp_message","server_name":SERVER,"message":{"jsonrpc":"2.0","id":1,"method":method}}});
            assert!(bootstrap(&pipe, &event).unwrap());
            let reply = pipe
                .next(&cancelled, &closed, Instant::now(), &mut total)
                .unwrap();
            assert_eq!(reply["response"]["request_id"], "bridge");
            let rpc = &reply["response"]["response"]["mcp_response"];
            assert_eq!(rpc["id"], 1);
            match method {
                "initialize" => assert_eq!(rpc["result"]["protocolVersion"], "2024-11-05"),
                "tools/list" => {
                    assert_eq!(
                        rpc["result"]["tools"][0]["name"],
                        http::definition()["name"]
                    );
                    assert_eq!(
                        rpc["result"]["tools"][0]["inputSchema"],
                        http::definition()["inputSchema"]
                    );
                }
                "unknown" => assert_eq!(rpc["error"]["code"], -32601),
                _ => assert_eq!(rpc["result"], json!({})),
            }
        }
    }
}
