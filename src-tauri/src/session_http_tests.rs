use super::*;
use std::io::Write;

#[test]
fn denies_http_without_execution_and_returns_only_sanitized_results() {
    for (agent, allowed) in [
        ("claude", false),
        ("claude", true),
        ("codex", false),
        ("codex", true),
    ] {
        let directory = tempfile::tempdir().unwrap();
        let recorded = directory.path().join("reply.json");
        let code = r#"import json,sys
from pathlib import Path
frame=json.loads(sys.stdin.readline())
Path(sys.argv[1]).write_text(json.dumps(frame))
print(json.dumps({'received':True}),flush=True)
sys.stdin.read()
"#;
        let mut command = Command::new("python3");
        command.args(["-u", "-c", code]).arg(&recorded);
        let pipe = Pipe::spawn(&mut command).unwrap();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let server = if allowed {
            Some(std::thread::spawn(move || {
                let start = Instant::now();
                let mut socket = loop {
                    if let Ok((socket, _)) = listener.accept() {
                        break socket;
                    }
                    assert!(start.elapsed() < Duration::from_secs(5));
                    std::thread::sleep(Duration::from_millis(10));
                };
                // Consume the request headers before closing the connection.
                socket
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut input = Vec::new();
                let mut byte = [0; 1];
                while !input.ends_with(b"\r\n\r\n") {
                    if socket.read(&mut byte).unwrap() == 0 {
                        break;
                    }
                    input.push(byte[0]);
                }
                let body = r#"{"email":"private@example.com","account_id":"private-record"}"#;
                write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).unwrap();
            }))
        } else {
            drop(listener);
            None
        };
        let approvals = mcp::Approvals::default();
        let replies = approvals.clone();
        let received_result = Arc::new(AtomicBool::new(false));
        let seen = received_result.clone();
        let channel = Channel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(text) = body {
                let event: Value = serde_json::from_str(&text).unwrap();
                if event["type"] == "tool_approval" {
                    assert_eq!(event["kind"], "http");
                    replies
                        .respond(
                            event["id"].as_str().unwrap(),
                            json!({"approved":allowed,"arguments":event["arguments"]}),
                        )
                        .unwrap();
                } else if event["type"] == "tool_result" {
                    seen.store(true, Ordering::SeqCst);
                    assert!(event["result"].to_string().contains("private@example.com"));
                    replies
                        .respond(
                            event["id"].as_str().unwrap(),
                            json!({"content":"SANITIZED HTTP RESPONSE"}),
                        )
                        .unwrap();
                }
            }
            Ok(())
        });
        let cancelled = AtomicBool::new(false);
        let closed = AtomicBool::new(false);
        let input = json!({"url":format!("http://{address}/api")});
        if agent == "claude" {
            crate::persistent::claude_tools::call(&pipe, &json!({"type":"control_request","request_id":"http-call","request":{"subtype":"mcp_message","server_name":"chista_internal","message":{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"chista_http_request","arguments":input}}}}), &channel, &approvals, "request", &cancelled, &closed).unwrap();
        } else {
            call(&pipe, &json!({"id":"http-call","params":{"tool":"chista_http_request","callId":"call","arguments":input}}), &channel, &approvals, "request", &cancelled, &closed).unwrap();
        }
        let mut total = 0;
        assert_eq!(
            pipe.next(&cancelled, &closed, Instant::now(), &mut total)
                .unwrap()["received"],
            true
        );
        let result = std::fs::read_to_string(&recorded).unwrap();
        assert!(!result.contains("private@example.com"));
        assert!(!result.contains("private-record"));
        assert_eq!(received_result.load(Ordering::SeqCst), allowed);
        assert!(result.contains(if allowed {
            "SANITIZED HTTP RESPONSE"
        } else {
            "denied"
        }));
        if let Some(server) = server {
            server.join().unwrap();
        }
    }
}
