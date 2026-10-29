use serde_json::{json, Value};
use std::{
    io::Read,
    process::{Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};

const MAX_RESPONSE_BYTES: usize = 1_000_000;
const TIMEOUT: Duration = Duration::from_secs(35);

#[cfg(test)]
#[path = "http_request_tests.rs"]
mod integration_tests;

pub(super) fn validate(arguments: &Value) -> Result<(), String> {
    let input = arguments
        .as_object()
        .ok_or("HTTP arguments must be an object.")?;
    if input
        .keys()
        .any(|key| !["url", "method", "headers", "body"].contains(&key.as_str()))
    {
        return Err("Unsupported HTTP argument.".into());
    }
    let url = input
        .get("url")
        .and_then(Value::as_str)
        .filter(|s| s.len() <= 8192)
        .ok_or("Enter an HTTP URL.")?;
    let parsed = tauri::Url::parse(url).map_err(|_| "Enter a valid HTTP URL.")?;
    if !["http", "https"].contains(&parsed.scheme())
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("Only HTTP(S) URLs without embedded credentials are supported.".into());
    }
    if input
        .get("method")
        .is_some_and(|method| !method.is_string())
    {
        return Err("Invalid HTTP method.".into());
    }
    let method = input.get("method").and_then(Value::as_str).unwrap_or("GET");
    if !["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].contains(&method) {
        return Err("Unsupported HTTP method.".into());
    }
    if let Some(headers) = input.get("headers") {
        let headers = headers
            .as_object()
            .filter(|h| h.len() <= 30)
            .ok_or("Use at most 30 HTTP headers.")?;
        for (key, value) in headers {
            let value = value
                .as_str()
                .filter(|v| v.len() <= 8192 && !v.contains(['\r', '\n']))
                .ok_or("Invalid HTTP header value.")?;
            if key.is_empty()
                || key.len() > 100
                || !key.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
                || value.contains('\0')
            {
                return Err("Invalid HTTP header.".into());
            }
        }
    }
    if let Some(body) = input.get("body") {
        if !body.is_string()
            || body
                .as_str()
                .is_some_and(|b| b.len() > 100_000 || b.contains('\0'))
        {
            return Err("HTTP body must be text of at most 100,000 bytes.".into());
        }
    }
    Ok(())
}

// Structured curl arguments only: no shell, curl config, file inputs, redirects,
// or inherited CLI tools. The caller gates execution on one explicit approval.
pub(super) fn execute(
    arguments: &Value,
    cancelled: &AtomicBool,
    closed: &AtomicBool,
) -> Result<Value, String> {
    validate(arguments)?;
    if cancelled.load(Ordering::SeqCst) || closed.load(Ordering::SeqCst) {
        return Err("HTTP request cancelled.".into());
    }
    let mut command = Command::new(if cfg!(windows) { "curl.exe" } else { "curl" });
    command
        .args([
            "--disable",
            "--silent",
            "--show-error",
            "--connect-timeout",
            "10",
            "--max-time",
            "30",
            "--proto",
            "=http,https",
            "--request",
        ])
        .arg(arguments["method"].as_str().unwrap_or("GET"))
        .arg("--url")
        .arg(arguments["url"].as_str().unwrap());
    if arguments["method"] == "HEAD" {
        command.arg("--head");
    }
    if let Some(headers) = arguments["headers"].as_object() {
        for (key, value) in headers {
            command
                .arg("--header")
                .arg(format!("{key}: {}", value.as_str().unwrap()));
        }
    }
    if let Some(body) = arguments["body"].as_str() {
        // --data-raw never treats a leading @ as a filename.
        command.arg("--data-raw").arg(body);
    }
    command
        .args(["--write-out", "\n%{http_code}\t%{content_type}"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = command
        .spawn()
        .map_err(|_| "curl is unavailable. Install curl and restart Chista.")?;
    let stdout = child.stdout.take().ok_or("Cannot read curl output.")?;
    let oversized = std::sync::Arc::new(AtomicBool::new(false));
    let signal = oversized.clone();
    let reader = std::thread::spawn(move || {
        let mut output = Vec::new();
        let result = stdout
            .take((MAX_RESPONSE_BYTES + 1) as u64)
            .read_to_end(&mut output);
        signal.store(output.len() > MAX_RESPONSE_BYTES, Ordering::SeqCst);
        result.map(|_| output)
    });
    let start = Instant::now();
    let status = loop {
        let error = if cancelled.load(Ordering::SeqCst) || closed.load(Ordering::SeqCst) {
            Some("HTTP request cancelled.")
        } else if oversized.load(Ordering::SeqCst) {
            Some("HTTP response exceeded the 1 MB limit.")
        } else if start.elapsed() > TIMEOUT {
            Some("HTTP request timed out.")
        } else {
            None
        };
        if let Some(error) = error {
            let _ = child.kill();
            let _ = child.wait();
            let _ = reader.join();
            return Err(error.into());
        }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => std::thread::sleep(Duration::from_millis(10)),
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = reader.join();
                return Err("Could not wait for curl.".into());
            }
        }
    };
    let output = reader
        .join()
        .map_err(|_| "Could not read HTTP response.")?
        .map_err(|_| "Could not read HTTP response.")?;
    if output.len() > MAX_RESPONSE_BYTES {
        return Err("HTTP response exceeded the 1 MB limit.".into());
    }
    if !status.success() {
        return Err(format!("curl could not complete the request (exit code {}). Check the URL, network access, and TLS certificate. No automatic retry was made.", status.code().map(|code| code.to_string()).unwrap_or_else(|| "unknown".into())));
    }
    let text = String::from_utf8_lossy(&output);
    let (body, metadata) = text
        .rsplit_once('\n')
        .ok_or("Missing HTTP response status.")?;
    let (status, content_type) = metadata
        .split_once('\t')
        .ok_or("Missing HTTP response metadata.")?;
    let status: u16 = status
        .parse()
        .map_err(|_| "Invalid HTTP response status.")?;
    let body = if arguments["method"] == "HEAD" {
        json!("")
    } else if body.contains('\0')
        || !(content_type.is_empty()
            || content_type.starts_with("text/")
            || content_type.contains("json")
            || content_type.contains("xml"))
    {
        json!("Non-text response omitted.")
    } else {
        serde_json::from_str::<Value>(body).unwrap_or_else(|_| json!(body))
    };
    Ok(json!({"status":status,"contentType":content_type,"body":body}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_shell_file_and_header_injection() {
        for input in [
            json!({"url":"file:///etc/passwd"}),
            json!({"url":"https://u:p@example.com"}),
            json!({"url":"https://example.com","method":"GET; echo bad"}),
            json!({"url":"https://example.com","output":"/tmp/file"}),
            json!({"url":"https://example.com","headers":{"X-Test":"a\r\nInjected: true"}}),
        ] {
            assert!(validate(&input).is_err());
        }
        assert!(validate(
            &json!({"url":"http://localhost:8080/api","method":"POST","body":"@/private/file"})
        )
        .is_ok());
    }
}
