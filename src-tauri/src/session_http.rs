use super::*;

#[cfg(all(test, unix))]
#[path = "session_http_tests.rs"]
mod tests;

pub(super) fn definition() -> Value {
    json!({"type":"function","name":"chista_http_request",
        "description":"Make an HTTP(S) API request using local curl. Use for curl/API requests. Chista asks the user to approve the exact method, URL, headers and body before execution, and sanitizes the response before returning it. No shell commands, local file inputs or automatic redirects are supported. Never retry a denied or failed request without explicit user instruction.",
        "inputSchema":{"type":"object","properties":{
            "url":{"type":"string"},"method":{"type":"string","enum":["GET","HEAD","POST","PUT","PATCH","DELETE","OPTIONS"]},
            "headers":{"type":"object","additionalProperties":{"type":"string"}},"body":{"type":"string"}
        },"required":["url"],"additionalProperties":false}})
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
    if event["params"]["tool"] != "chista_http_request" {
        return Ok(false);
    }
    let call = event["params"]["callId"]
        .as_str()
        .filter(|id| id.len() <= 200)
        .ok_or("Invalid HTTP tool call ID.")?;
    let key = format!("{request_id}:{call}");
    let input = event["params"]["arguments"].clone();
    if let Err(error) = http_request::validate(&input) {
        return finish(pipe, event, &error, false);
    }
    let approved = approvals.exchange(events, format!("{key}:approve"),
        json!({"type":"tool_approval","kind":"http","callId":key,"server":"HTTP","tool":"request","arguments":input}),cancelled,closed)?;
    if approved["approved"] != true {
        events.send(json!({"type":"tool_progress","callId":key,"server":"HTTP","tool":"request","state":"denied"})).map_err(|_| "Chat closed.")?;
        return finish(
            pipe,
            event,
            "The user denied this HTTP request. Do not retry without a new explicit request.",
            false,
        );
    }
    events.send(json!({"type":"tool_progress","callId":key,"server":"HTTP","tool":"request","state":"running"})).map_err(|_| "Chat closed.")?;
    let result = http_request::execute(&approved["arguments"], cancelled, closed);
    let success = result.is_ok();
    let text = match result {
        Ok(value) => value.to_string(),
        Err(error) => json!({"error":error}).to_string(),
    };
    let safe = approvals.exchange(events,format!("{key}:result"),
        json!({"type":"tool_result","kind":"http","callId":key,"server":"HTTP","tool":"request","success":success,"result":{"content":[{"type":"text","text":text}]}}),cancelled,closed)?;
    finish(
        pipe,
        event,
        safe["content"]
            .as_str()
            .ok_or("Sanitized HTTP result missing.")?,
        success && safe["success"] != false,
    )
}

fn finish(pipe: &Pipe, event: &Value, text: &str, success: bool) -> Result<bool, String> {
    pipe.send(json!({"id":event["id"],"result":{"contentItems":[{"type":"inputText","text":text}],"success":success}}))?;
    Ok(true)
}
