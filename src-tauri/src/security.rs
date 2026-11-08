//! Trusted application policy. Agent messages never modify this state.
use serde_json::{json, Value};
use std::{cell::RefCell, collections::HashMap, sync::Mutex};

#[derive(Clone, Default)]
pub struct Policy {
    pub origins: Vec<String>,
    pub servers: Vec<String>,
}
#[derive(Default)]
pub struct Policies(pub Mutex<HashMap<String, Policy>>);
thread_local! { static CURRENT: RefCell<Policy> = RefCell::new(Policy::default()); }
pub fn enter(policy: Policy) {
    CURRENT.with(|p| *p.borrow_mut() = policy);
}
pub fn current() -> Policy {
    CURRENT.with(|p| p.borrow().clone())
}
thread_local! { static AGENT: RefCell<String> = RefCell::new(String::new()); }
pub fn agent(name: &str) {
    AGENT.with(|a| *a.borrow_mut() = name.to_string());
}
pub fn server_allowed(name: &str) -> bool {
    AGENT.with(|a| {
        let a = a.borrow();
        let key = if a.is_empty() {
            name.to_string()
        } else {
            format!("{a}:{name}")
        };
        current().servers.contains(&key)
    })
}

#[tauri::command]
pub fn configure_workspace_security(
    workspace_id: String,
    origins: Vec<String>,
    servers: Vec<String>,
    policies: tauri::State<'_, Policies>,
    sessions: tauri::State<'_, crate::persistent::Sessions>,
) -> Result<(), String> {
    if workspace_id.is_empty()
        || workspace_id.len() > 100
        || origins.len() > 20
        || servers.len() > 20
    {
        return Err("Invalid workspace policy.".into());
    }
    let origins = origins
        .iter()
        .map(|origin| {
            let url = tauri::Url::parse(origin).map_err(|_| "Invalid debugging origin.")?;
            if !["http", "https"].contains(&url.scheme())
                || url.host_str().is_none()
                || !url.username().is_empty()
                || url.password().is_some()
                || url.query().is_some()
                || url.fragment().is_some()
                || url.path() != "/"
            {
                return Err("Use exact HTTP(S) origins without paths or credentials.".into());
            }
            Ok(url.origin().ascii_serialization())
        })
        .collect::<Result<Vec<_>, String>>()?;
    if servers
        .iter()
        .any(|s| s.is_empty() || s.len() > 200 || s.chars().any(char::is_control))
    {
        return Err("Invalid MCP server name.".into());
    }
    let snapshots = PREVIEWS
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| "Preview unavailable.")?;
    let approved: HashMap<String, Value> = servers
        .iter()
        .map(|name| {
            snapshots
                .get(&workspace_id)
                .and_then(|s| s.get(name))
                .cloned()
                .map(|value| (name.clone(), value))
                .ok_or_else(|| {
                    "Preview every selected connector before approving workspace permissions."
                        .to_string()
                })
        })
        .collect::<Result<_, _>>()?;
    APPROVED
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| "Policy unavailable.")?
        .insert(workspace_id.clone(), approved);
    policies
        .0
        .lock()
        .map_err(|_| "Policy unavailable.")?
        .insert(workspace_id, Policy { origins, servers });
    sessions.close_all();
    Ok(())
}

// Preview explicitly starts only a CLI configuration query, never an MCP server.
#[tauri::command]
pub async fn preview_mcp_configuration(
    workspace_id: String,
    agent: String,
    executable_path: String,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let config = if agent == "claude" {
            use std::io::Read;
            let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).ok_or("Cannot locate configuration.")?;
            let path = std::env::var_os("CLAUDE_CONFIG_DIR").map(std::path::PathBuf::from).map(|p| p.join(".claude.json")).unwrap_or_else(|| std::path::PathBuf::from(home).join(".claude.json"));
            let file = std::fs::File::open(path).map_err(|_| "Cannot read MCP configuration.")?;
            let mut bytes = Vec::new();
            file.take(4_000_001).read_to_end(&mut bytes).map_err(|_| "Cannot read MCP configuration.")?;
            if bytes.len() > 4_000_000 { return Err("Configuration too large.".into()); }
            let value: Value = serde_json::from_slice(&bytes).map_err(|_| "Invalid configuration.")?;
            value["mcpServers"].clone()
        } else if agent == "codex" {
            use std::{io::Read, process::{Command, Stdio}, time::{Duration, Instant}};
            let binary = crate::claude::resolve_cli(&executable_path, "codex")?;
            let mut child = Command::new(binary).args(["mcp", "list", "--json"]).stdin(Stdio::null()).stderr(Stdio::null()).stdout(Stdio::piped()).spawn().map_err(|_| "Cannot inspect Codex MCP configuration.")?;
            let stdout = child.stdout.take().ok_or("Cannot inspect Codex output.")?;
            let reader = std::thread::spawn(move || { let mut bytes = Vec::new(); let _ = stdout.take(4_000_001).read_to_end(&mut bytes); bytes });
            let start = Instant::now();
            loop {
                match child.try_wait() {
                    Ok(Some(status)) if status.success() => break,
                    Ok(None) if start.elapsed() < Duration::from_secs(10) => std::thread::sleep(Duration::from_millis(10)),
                    _ => { let _ = child.kill(); let _ = child.wait(); let _ = reader.join(); return Err("MCP configuration query failed or timed out.".into()); }
                }
            }
            let bytes = reader.join().map_err(|_| "Cannot inspect MCP output.")?;
            if bytes.len() > 4_000_000 { return Err("Configuration too large.".into()); }
            serde_json::from_slice::<Value>(&bytes).map_err(|_| "Invalid MCP configuration response.")?
        } else { return Err("Choose a supported agent.".into()); };
        // Do not return environment/header values, query strings, or embedded credentials.
        fn preview(name: &str, value: &Value) -> Value {
            let transport = value.get("transport").unwrap_or(value);
            let url = transport["url"].as_str().and_then(|s| tauri::Url::parse(s).ok()).map(|u| format!("{}{}", u.origin().ascii_serialization(), u.path()));
            json!({"serverName":name,"command":transport["command"],"arguments":transport["args"],"endpoint":url,"workingDirectory":transport["cwd"],"environmentVariableNames":transport["env_vars"],
                "environmentKeys":transport["env"].as_object().map(|v| v.keys().collect::<Vec<_>>()),
                "headerKeys":transport.get("http_headers").or_else(|| transport.get("headers")).and_then(Value::as_object).map(|v| v.keys().collect::<Vec<_>>())})
        }
        let mut snapshots = PREVIEWS.get_or_init(Default::default).lock().unwrap();
        let workspace = snapshots.entry(workspace_id).or_default();
        if let Some(map) = config.as_object() {
            for (name, value) in map { workspace.insert(format!("{agent}:{name}"), identity(value)); }
        } else if let Some(rows) = config.as_array() {
            for row in rows { if let Some(name) = row["name"].as_str() { workspace.insert(format!("{agent}:{name}"), identity(row)); } }
        }
        let rows = if let Some(map) = config.as_object() { map.iter().map(|(n,v)| preview(n,v)).collect::<Vec<_>>() }
            else { config.as_array().into_iter().flatten().map(|v| preview(v["name"].as_str().unwrap_or("MCP"),v)).collect() };
        Ok(json!({"servers":rows}))
    }).await.map_err(|_| "MCP configuration query stopped.".to_string())?
}

pub fn connector_secrets(server: &str) -> Result<Value, String> {
    WORKSPACE.with(|workspace| crate::credentials::mcp_secrets(&workspace.borrow(), server))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn default_policy_denies_connectors_and_thread_permissions_do_not_leak() {
        enter(Policy::default());
        assert!(!server_allowed("fixture"));
        enter(Policy {
            origins: vec!["http://localhost:8080".into()],
            servers: vec!["fixture".into()],
        });
        assert!(server_allowed("fixture"));
        assert!(!server_allowed("other"));
        std::thread::spawn(|| {
            assert!(!server_allowed("fixture"));
            assert!(current().origins.is_empty());
        })
        .join()
        .unwrap();
        enter(Policy::default());
        assert!(!server_allowed("fixture"));
    }
}

thread_local! { static WORKSPACE: RefCell<String> = RefCell::new(String::new()); }
pub fn scope(workspace: &str) {
    WORKSPACE.with(|w| *w.borrow_mut() = workspace.to_string());
}
static AUDIT: std::sync::OnceLock<Mutex<HashMap<String, Vec<Value>>>> = std::sync::OnceLock::new();
pub fn audit(kind: &str, state: &str) {
    let time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    WORKSPACE.with(|workspace| {
        let mut audit = AUDIT.get_or_init(Default::default).lock().unwrap();
        let rows = audit.entry(workspace.borrow().clone()).or_default();
        let sequence = rows
            .last()
            .and_then(|r| r["sequence"].as_u64())
            .unwrap_or(0)
            + 1;
        rows.push(json!({"sequence":sequence,"time":time,"kind":kind,"state":state}));
        if rows.len() > 2000 {
            rows.remove(0);
        }
    });
}
#[tauri::command]
pub fn read_audit_history(workspace_id: String) -> Vec<Value> {
    AUDIT
        .get_or_init(Default::default)
        .lock()
        .unwrap()
        .get(&workspace_id)
        .cloned()
        .unwrap_or_default()
}

// Freeze connector startup configuration at review time. A later native config
// edit requires a fresh preview and approval, including changes to env/headers.
static PREVIEWS: std::sync::OnceLock<Mutex<HashMap<String, HashMap<String, Value>>>> =
    std::sync::OnceLock::new();
static APPROVED: std::sync::OnceLock<Mutex<HashMap<String, HashMap<String, Value>>>> =
    std::sync::OnceLock::new();
fn identity(value: &Value) -> Value {
    let value = value.get("transport").unwrap_or(value);
    json!({"command":value["command"],"args":value.get("args").filter(|v| !v.is_null()).cloned().unwrap_or_else(|| json!([])),
        "url":value["url"],"env":value.get("env").filter(|v| !v.is_null()).cloned().unwrap_or_else(|| json!({})),
        "headers":value.get("http_headers").or_else(|| value.get("headers")).filter(|v| !v.is_null()).cloned().unwrap_or_else(|| json!({})),
        "bearer_token_env_var":value["bearer_token_env_var"],"cwd":value["cwd"],
        "env_vars":value.get("env_vars").filter(|v| !v.is_null()).cloned().unwrap_or_else(|| json!([])),
        "env_http_headers":value.get("env_http_headers").filter(|v| !v.is_null()).cloned().unwrap_or_else(|| json!({}))})
}
pub fn configuration_allowed(name: &str, config: &Value) -> bool {
    if !server_allowed(name) {
        return false;
    }
    WORKSPACE.with(|workspace| {
        let workspace = workspace.borrow();
        if workspace.is_empty() {
            return true;
        } // CLI fixture/unit-test sessions have no workspace.
        AGENT.with(|agent| {
            APPROVED
                .get_or_init(Default::default)
                .lock()
                .unwrap()
                .get(&*workspace)
                .and_then(|approved| approved.get(&format!("{}:{name}", agent.borrow())))
                .is_some_and(|approved| *approved == identity(config))
        })
    })
}

#[cfg(test)]
mod policy_review_tests {
    use super::*;
    #[test]
    fn workspace_and_agent_bind_reviewed_connector_configuration() {
        let workspace = "permission-test-workspace";
        let config =
            json!({"command":"project-mcp","args":["--read-only"],"env":{"PROJECT":"one"}});
        enter(Policy {
            origins: vec![],
            servers: vec!["codex:tools".into()],
        });
        scope(workspace);
        agent("codex");
        assert!(!configuration_allowed("tools", &config));
        APPROVED
            .get_or_init(Default::default)
            .lock()
            .unwrap()
            .entry(workspace.into())
            .or_default()
            .insert("codex:tools".into(), identity(&config));
        assert!(configuration_allowed("tools", &config));
        assert!(!configuration_allowed(
            "tools",
            &json!({"command":"project-mcp","args":["--write"],"env":{"PROJECT":"one"}})
        ));
        scope("other-workspace");
        assert!(!configuration_allowed("tools", &config));
        scope(workspace);
        agent("claude");
        assert!(!configuration_allowed("tools", &config));
        scope("");
        agent("");
        enter(Policy::default());
    }
    #[test]
    fn audit_has_only_metadata_and_is_scoped_read_only() {
        scope("audit-test-workspace");
        audit("http", "approval-requested");
        audit("http", "denied");
        let rows = read_audit_history("audit-test-workspace".into());
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["sequence"], 1);
        assert_eq!(rows[1]["state"], "denied");
        assert_eq!(rows[0].as_object().unwrap().len(), 4);
        assert!(read_audit_history("other-audit-workspace".into()).is_empty());
        scope("");
    }
}

#[tauri::command]
pub fn read_workspace_security(
    workspace_id: String,
    policies: tauri::State<'_, Policies>,
) -> Result<Value, String> {
    let policies = policies.0.lock().map_err(|_| "Policy unavailable.")?;
    let policy = policies.get(&workspace_id).cloned().unwrap_or_default();
    Ok(json!({"origins":policy.origins,"servers":policy.servers}))
}
