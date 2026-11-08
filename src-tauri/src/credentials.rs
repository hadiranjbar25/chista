// Never format backend errors: OS errors may contain identifying information.
fn entry(account: &str) -> Result<keyring::Entry, String> {
    if account.is_empty() || account.len() > 300 || account.chars().any(char::is_control) {
        return Err("Invalid credential identifier.".into());
    }
    keyring::Entry::new("dev.chista.desktop", account)
        .map_err(|_| "OS credential store unavailable.".into())
}
#[tauri::command]
pub fn store_credential(account: String, secret: String) -> Result<(), String> {
    if secret.len() > 100_000 {
        return Err("Credential too large.".into());
    }
    if account.starts_with("mcp:") {
        validate_mcp_secret(&secret)?;
    }
    entry(&account)?
        .set_password(&secret)
        .map_err(|_| "Could not save to OS credential store.".into())
}
#[tauri::command]
pub fn read_credential(account: String) -> Result<Option<String>, String> {
    match entry(&account)?.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("Could not read OS credential store.".into()),
    }
}
#[tauri::command]
pub fn delete_credential(account: String) -> Result<(), String> {
    match entry(&account)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("Could not delete OS credential.".into()),
    }
}

// Optional Chista-owned connector credentials. Native CLI-owned sign-in stays native.
pub(crate) fn mcp_secrets(workspace: &str, server: &str) -> Result<serde_json::Value, String> {
    if workspace.is_empty() {
        return Ok(serde_json::json!({}));
    }
    match read_credential(format!("mcp:{workspace}:{server}"))? {
        Some(text) => {
            serde_json::from_str(&text).map_err(|_| "Invalid stored MCP credential JSON.".into())
        }
        None => Ok(serde_json::json!({})),
    }
}

fn validate_mcp_secret(secret: &str) -> Result<(), String> {
    let value: serde_json::Value =
        serde_json::from_str(secret).map_err(|_| "Invalid MCP credential JSON.")?;
    let fields = value
        .as_object()
        .ok_or("MCP credentials must be an object.")?;
    for (field, values) in fields {
        if !["env", "http_headers"].contains(&field.as_str()) {
            return Err("Unsupported MCP credential field.".into());
        }
        for (key, value) in values
            .as_object()
            .ok_or("MCP credentials must contain string maps.")?
        {
            if !value.is_string() || key.contains(['\r', '\n', '\0']) {
                return Err("Invalid MCP credential value.".into());
            }
            if field == "http_headers" {
                let text = value.as_str().ok_or("Invalid MCP header.")?;
                if key.is_empty()
                    || !key.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
                    || text.contains(['\r', '\n', '\0'])
                    || [
                        "host",
                        "connection",
                        "content-length",
                        "transfer-encoding",
                        "proxy-authorization",
                    ]
                    .contains(&key.to_ascii_lowercase().as_str())
                {
                    return Err("Invalid MCP credential header.".into());
                }
            }
            if field == "env"
                && ![
                    "TOKEN",
                    "KEY",
                    "SECRET",
                    "PASSWORD",
                    "CREDENTIALS",
                    "ACCESS_KEY_ID",
                ]
                .iter()
                .any(|suffix| key.ends_with(suffix))
            {
                return Err("MCP credential environment names must end in TOKEN, KEY, SECRET, PASSWORD, CREDENTIALS or ACCESS_KEY_ID. Configure other environment settings in the reviewed native connector configuration.".into());
            }
        }
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn credential_maps_cannot_override_execution_environment() {
        assert!(validate_mcp_secret(
            r#"{"env":{"API_TOKEN":"opaque"},"http_headers":{"Authorization":"Bearer secret"}}"#
        )
        .is_ok());
        for secret in [
            r#"{"env":{"NODE_OPTIONS":"--require=module"}}"#,
            r#"{"env":{"PATH":"/other"}}"#,
            r#"{"command":"evil"}"#,
            r#"{"http_headers":{"X-Key":false}}"#,
        ] {
            assert!(validate_mcp_secret(secret).is_err());
        }
    }
}
