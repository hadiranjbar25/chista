use super::*;
use std::io::{Read, Write};

#[test]
fn executes_a_real_request_and_treats_at_body_as_literal_text() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let address = listener.local_addr().unwrap();
    crate::security::enter(crate::security::Policy {
        origins: vec![format!("http://{address}")],
        servers: vec![],
    });
    let server = std::thread::spawn(move || {
        let start = Instant::now();
        let mut socket = loop {
            if let Ok((socket, _)) = listener.accept() {
                break socket;
            }
            assert!(
                start.elapsed() < Duration::from_secs(5),
                "curl did not connect"
            );
            std::thread::sleep(Duration::from_millis(10));
        };
        socket.set_nonblocking(false).unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut input = Vec::new();
        let mut buffer = [0; 4096];
        while !input.ends_with(b"@/private/file") {
            let size = socket.read(&mut buffer).unwrap();
            if size == 0 {
                break;
            }
            input.extend_from_slice(&buffer[..size]);
        }
        let body = r#"{"id":"record-123","status":"observed"}"#;
        write!(socket,"HTTP/1.1 403 Forbidden\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).unwrap();
        String::from_utf8(input).unwrap()
    });
    let result = execute(
        &json!({"url":format!("http://{address}/api"),"method":"POST","body":"@/private/file"}),
        &AtomicBool::new(false),
        &AtomicBool::new(false),
    )
    .unwrap();
    assert_eq!(result["status"], 403);
    assert_eq!(result["body"]["id"], "record-123");
    let input = server.join().unwrap();
    assert!(input.starts_with("POST /api HTTP/1.1"));
    assert!(input.ends_with("@/private/file"));
}

#[test]
fn cancels_before_starting_a_request() {
    let error = execute(
        &json!({"url":"http://127.0.0.1:1"}),
        &AtomicBool::new(true),
        &AtomicBool::new(false),
    )
    .unwrap_err();
    assert!(error.contains("cancelled"));
}

#[test]
fn stops_an_in_flight_request() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let address = listener.local_addr().unwrap();
    crate::security::enter(crate::security::Policy {
        origins: vec![format!("http://{address}")],
        servers: vec![],
    });
    let cancelled = std::sync::Arc::new(AtomicBool::new(false));
    let signal = cancelled.clone();
    let server = std::thread::spawn(move || {
        let start = Instant::now();
        let _socket = loop {
            if let Ok((socket, _)) = listener.accept() {
                break socket;
            }
            assert!(start.elapsed() < Duration::from_secs(5));
            std::thread::sleep(Duration::from_millis(10));
        };
        signal.store(true, Ordering::SeqCst);
        std::thread::sleep(Duration::from_millis(200));
    });
    let error = execute(
        &json!({"url":format!("http://{address}/slow")}),
        &cancelled,
        &AtomicBool::new(false),
    )
    .unwrap_err();
    assert!(error.contains("cancelled"));
    server.join().unwrap();
}

#[test]
fn rejects_oversized_responses() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let address = listener.local_addr().unwrap();
    crate::security::enter(crate::security::Policy {
        origins: vec![format!("http://{address}")],
        servers: vec![],
    });
    let server = std::thread::spawn(move || {
        let start = Instant::now();
        let mut socket = loop {
            if let Ok((socket, _)) = listener.accept() {
                break socket;
            }
            assert!(start.elapsed() < Duration::from_secs(5));
            std::thread::sleep(Duration::from_millis(10));
        };
        socket.set_nonblocking(false).unwrap();
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
        let body = vec![b'x'; MAX_RESPONSE_BYTES + 1000];
        write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",body.len()).unwrap();
        let _ = socket.write_all(&body);
    });
    let error = execute(
        &json!({"url":format!("http://{address}/large")}),
        &AtomicBool::new(false),
        &AtomicBool::new(false),
    )
    .unwrap_err();
    assert!(
        error.contains("1 MB"),
        "Unexpected size-limit error: {error}"
    );
    server.join().unwrap();
}

#[test]
fn blocks_non_public_addresses_including_mapped_and_metadata() {
    for address in [
        "127.0.0.1",
        "10.0.0.1",
        "169.254.169.254",
        "100.100.100.200",
        "172.16.0.1",
        "192.168.1.1",
        "0.0.0.0",
        "::1",
        "::ffff:127.0.0.1",
        "fe80::1",
        "fc00::1",
        "2002:7f00:1::",
    ] {
        assert!(!public_ip(address.parse().unwrap()), "{address}");
    }
    assert!(public_ip("8.8.8.8".parse().unwrap()));
    crate::security::enter(crate::security::Policy::default());
    assert!(destination(&tauri::Url::parse("http://127.0.0.1").unwrap()).is_err());
}

#[test]
fn never_follows_redirects_even_to_approved_local_origins() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    crate::security::enter(crate::security::Policy {
        origins: vec![format!("http://{address}")],
        servers: vec![],
    });
    let server = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        let mut buffer = [0; 4096];
        let _ = socket.read(&mut buffer);
        socket.write_all(b"HTTP/1.1 302 Found\r\nLocation: http://169.254.169.254/latest/meta-data\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
    });
    assert!(execute(
        &json!({"url":format!("http://{address}")}),
        &AtomicBool::new(false),
        &AtomicBool::new(false)
    )
    .unwrap_err()
    .contains("redirects"));
    server.join().unwrap();
}

#[test]
fn rejects_host_overrides_hop_by_hop_headers_and_aggregate_header_overflow() {
    for header in [
        "Host",
        "Content-Length",
        "Transfer-Encoding",
        "Proxy-Authorization",
        "Connection",
    ] {
        assert!(
            validate(&json!({"url":"https://example.com","headers":{header:"value"}})).is_err()
        );
    }
    assert!(validate(
        &json!({"url":"https://example.com","headers":{"A":"a".repeat(8192),"B":"b".repeat(8192)}})
    )
    .is_err());
}
