// Preserve the CLI's provider connection without importing tool permissions,
// hooks or plugins into Chista's reviewed chat session.
use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
};

pub(crate) fn user_directory() -> Result<PathBuf, String> {
    if let Some(directory) = std::env::var_os("CLAUDE_CONFIG_DIR").filter(|s| !s.is_empty()) {
        return Ok(PathBuf::from(directory));
    }
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .ok_or("Cannot locate Claude user settings.")?;
    Ok(PathBuf::from(home).join(".claude"))
}

fn connection_settings(source: &Path) -> Result<Value, String> {
    let mut bytes = Vec::new();
    match std::fs::File::open(source) {
        Ok(file) => {
            file.take(1_000_001)
                .read_to_end(&mut bytes)
                .map_err(|_| "Cannot read Claude connection settings.")?;
            if bytes.len() > 1_000_000 {
                return Err("Claude user settings are too large.".into());
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(json!({})),
        Err(_) => return Err("Cannot read Claude connection settings.".into()),
    }
    let value: Value = serde_json::from_slice(&bytes)
        .map_err(|_| "Invalid Claude user settings JSON. Check your Claude settings file.")?;
    if !value.is_object() {
        return Err("Invalid Claude user settings object.".into());
    }
    let mut settings = serde_json::Map::new();
    for key in [
        "model",
        "modelOverrides",
        "availableModels",
        "apiKeyHelper",
        "awsAuthRefresh",
        "awsCredentialExport",
        "forceLoginMethod",
        "forceLoginOrgUUID",
        "disableClaudeAiConnectors",
        "allowedMcpServers",
        "deniedMcpServers",
    ] {
        if let Some(value) = value.get(key) {
            settings.insert(key.into(), value.clone());
        }
    }
    if let Some(env) = value.get("env") {
        let env = env
            .as_object()
            .ok_or("Invalid Claude provider environment settings.")?;
        let mut provider_env = serde_json::Map::new();
        for (name, value) in env {
            if name.starts_with("ANTHROPIC_")
                || name.starts_with("AWS_")
                || name.starts_with("GOOGLE_")
                || name.starts_with("AZURE_")
                || matches!(
                    name.as_str(),
                    "CLAUDE_CODE_USE_BEDROCK"
                        | "CLAUDE_CODE_USE_VERTEX"
                        | "CLAUDE_CODE_USE_FOUNDRY"
                        | "CLOUD_ML_REGION"
                        | "HTTP_PROXY"
                        | "HTTPS_PROXY"
                        | "ALL_PROXY"
                        | "NO_PROXY"
                        | "http_proxy"
                        | "https_proxy"
                        | "all_proxy"
                        | "no_proxy"
                        | "NODE_EXTRA_CA_CERTS"
                        | "SSL_CERT_FILE"
                        | "SSL_CERT_DIR"
                        | "CLAUDE_CODE_CLIENT_CERT"
                        | "CLAUDE_CODE_CLIENT_KEY"
                        | "CLAUDE_CODE_CLIENT_KEY_PASSPHRASE"
                        | "ENABLE_CLAUDEAI_MCP_SERVERS"
                        | "ENABLE_TOOL_SEARCH"
                )
            {
                if !value.is_string() {
                    return Err("Claude provider environment values must be strings.".into());
                }
                provider_env.insert(name.clone(), value.clone());
            }
        }
        settings.insert("env".into(), Value::Object(provider_env));
    }
    Ok(Value::Object(settings))
}

pub(crate) fn user_settings() -> Result<tempfile::NamedTempFile, String> {
    settings_file(&user_directory()?.join("settings.json"))
}
fn settings_file(source: &Path) -> Result<tempfile::NamedTempFile, String> {
    let settings = connection_settings(source)?;
    // NamedTempFile is private (0600 on Unix); keep credentials out of argv.
    let mut file =
        tempfile::NamedTempFile::new().map_err(|_| "Cannot prepare Claude connection settings.")?;
    file.write_all(settings.to_string().as_bytes())
        .map_err(|_| "Cannot prepare Claude connection settings.")?;
    Ok(file)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_connector_policy_and_native_discovery_preferences() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("settings.json");
        let policy = json!({
            "disableClaudeAiConnectors": true,
            "deniedMcpServers": [{"serverName":"claude.ai Disabled"}],
            "env": {"ENABLE_CLAUDEAI_MCP_SERVERS":"false", "ENABLE_TOOL_SEARCH":"auto:5"}
        });
        std::fs::write(&source, policy.to_string()).unwrap();
        assert_eq!(connection_settings(&source).unwrap(), policy);
    }
    #[test]
    fn preserves_provider_and_auth_configuration_without_loading_hooks_or_permissions() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("settings.json");
        std::fs::write(&source, json!({"model":"custom-model","apiKeyHelper":"configured-auth-helper","env":{"ANTHROPIC_BASE_URL":"https://provider.example","ANTHROPIC_AUTH_TOKEN":"native-only-secret","HTTPS_PROXY":"http://proxy.example","CLAUDE_CODE_USE_VERTEX":"1","CLAUDE_CODE_SAFE_MODE":"1","UNRELATED":"ignored"},"hooks":{"SessionStart":["never-run"]},"permissions":{"allow":["Bash"]},"enabledPlugins":{"unsafe":true}}).to_string()).unwrap();
        let file = settings_file(&source).unwrap();
        let text = std::fs::read_to_string(file.path()).unwrap();
        let value: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(value["model"], "custom-model");
        assert_eq!(value["apiKeyHelper"], "configured-auth-helper");
        assert_eq!(value["env"]["ANTHROPIC_AUTH_TOKEN"], "native-only-secret");
        assert_eq!(value["env"]["HTTPS_PROXY"], "http://proxy.example");
        assert!(value.get("hooks").is_none());
        assert!(value.get("permissions").is_none());
        assert!(value.get("enabledPlugins").is_none());
        assert!(value["env"].get("CLAUDE_CODE_SAFE_MODE").is_none());
        assert!(value["env"].get("UNRELATED").is_none());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                file.as_file().metadata().unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }
    #[test]
    fn missing_settings_are_optional_but_invalid_settings_report_a_safe_error() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("settings.json");
        assert_eq!(connection_settings(&source).unwrap(), json!({}));
        for invalid in ["private@example.com broken JSON", "[]", r#"{"env":[]}"#] {
            std::fs::write(&source, invalid).unwrap();
            let error = connection_settings(&source).unwrap_err();
            assert!(!error.contains("private@example.com"));
        }
    }
}
