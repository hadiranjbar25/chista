use serde_json::{json, Value};
use std::{
    io::Read,
    process::{Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};

use std::net::{IpAddr, ToSocketAddrs};

const MAX_HEADER_BYTES: u64 = 16_384;
const MAX_RESPONSE_BYTES: usize = 1_000_000;
const TIMEOUT: Duration = Duration::from_secs(35);

#[cfg(test)]
#[path = "http_request_tests.rs"]
mod integration_tests;

// Conservative public-address policy, including IPv4-mapped IPv6 and special ranges.
fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, c, _] = ip.octets();
            !(a == 0
                || a == 10
                || a == 127
                || a >= 224
                || (a == 100 && (64..=127).contains(&b))
                || (a == 169 && b == 254)
                || (a == 172 && (16..=31).contains(&b))
                || (a == 192 && (b == 168 || b == 0 || (b == 88 && c == 99)))
                || (a == 198 && (b == 18 || b == 19 || (b == 51 && c == 100)))
                || (a == 203 && b == 0 && c == 113))
        }
        IpAddr::V6(ip) => {
            if let Some(v4) = ip.to_ipv4_mapped() {
                return public_ip(IpAddr::V4(v4));
            }
            let segments = ip.segments();
            // Global unicast only; reject transition/documentation/special-purpose space.
            (segments[0] & 0xe000) == 0x2000
                && segments[0] != 0x2001
                && segments[0] != 0x2002
                && !(segments[0] == 0x3fff && segments[1] < 0x1000)
        }
    }
}
fn destination(url: &tauri::Url) -> Result<IpAddr, String> {
    let host = url
        .host_str()
        .ok_or("Missing HTTP host.")?
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_string();
    let port = url.port_or_known_default().ok_or("Missing HTTP port.")?;
    let approved = crate::security::current()
        .origins
        .contains(&url.origin().ascii_serialization());
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let result = (host.as_str(), port)
            .to_socket_addrs()
            .map(|a| a.map(|s| s.ip()).collect::<Vec<_>>());
        let _ = tx.send(result);
    });
    let addresses = rx
        .recv_timeout(Duration::from_secs(5))
        .map_err(|_| "DNS lookup timed out.")?
        .map_err(|_| "Cannot resolve HTTP destination.")?;
    if addresses.is_empty() || (!approved && addresses.iter().any(|ip| !public_ip(*ip))) {
        return Err("Private, loopback, link-local, metadata or special-use destination blocked. Approve its exact origin in workspace security for local debugging.".into());
    }
    Ok(addresses[0])
}

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
        if headers
            .iter()
            .map(|(k, v)| k.len() + v.as_str().map(str::len).unwrap_or(0) + 4)
            .sum::<usize>()
            > MAX_HEADER_BYTES as usize
        {
            return Err("HTTP headers exceed 16 KB.".into());
        }
        for (key, value) in headers {
            let value = value
                .as_str()
                .filter(|v| v.len() <= 8192 && !v.contains(['\r', '\n']))
                .ok_or("Invalid HTTP header value.")?;
            if [
                "host",
                "connection",
                "content-length",
                "transfer-encoding",
                "proxy-authorization",
                "proxy-connection",
                "upgrade",
                "trailer",
                "te",
            ]
            .contains(&key.to_ascii_lowercase().as_str())
                || key.is_empty()
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
    let url = tauri::Url::parse(arguments["url"].as_str().unwrap()).map_err(|_| "Invalid URL.")?;
    let ip = destination(&url)?;
    let headers_file =
        tempfile::NamedTempFile::new().map_err(|_| "Cannot prepare response headers.")?;
    let host = url.host_str().unwrap();
    let pinned = match ip {
        IpAddr::V4(ip) => ip.to_string(),
        IpAddr::V6(ip) => format!("[{ip}]"),
    };
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
            "--noproxy",
            "*",
            "--proxy",
            "",
            "--max-redirs",
            "0",
            "--proto-redir",
            "=http,https",
            "--max-filesize",
            "1000000",
            "--request",
        ])
        .arg(arguments["method"].as_str().unwrap_or("GET"))
        .arg("--url")
        .arg(arguments["url"].as_str().unwrap());
    // Literal IP URLs already fix the connection address; --resolve is for DNS names.
    if host
        .trim_start_matches('[')
        .trim_end_matches(']')
        .parse::<IpAddr>()
        .is_err()
    {
        command.arg("--resolve").arg(format!(
            "{host}:{}:{pinned}",
            url.port_or_known_default().unwrap()
        ));
    }
    command.arg("--dump-header").arg(headers_file.path());
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
        } else if headers_file
            .as_file()
            .metadata()
            .map(|m| m.len() > MAX_HEADER_BYTES)
            .unwrap_or(true)
        {
            Some("HTTP response headers exceeded 16 KB.")
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
    if headers_file
        .as_file()
        .metadata()
        .map(|m| m.len() > MAX_HEADER_BYTES)
        .unwrap_or(true)
    {
        return Err("HTTP response headers exceeded 16 KB.".into());
    }
    if output.len() > MAX_RESPONSE_BYTES {
        return Err("HTTP response exceeded the 1 MB limit.".into());
    }
    if status.code() == Some(63) {
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
    if (300..400).contains(&status) {
        return Err(
            "HTTP redirects are disabled. Review and approve the destination URL separately."
                .into(),
        );
    }
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
