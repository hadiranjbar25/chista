use super::*;

pub(super) fn validate_model(model: &str) -> Result<(), String> {
    if model.len() > 200
        || model.starts_with('-')
        || !model
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_.:/@[]".contains(c))
    {
        return Err("Enter a model ID using letters, numbers or - _ . : / @ [ ].".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn agent_models(agent: String, executable_path: String) -> Result<Value, String> {
    if !["claude", "codex"].contains(&agent.as_str()) {
        return Err("Choose Claude Code or Codex.".into());
    }
    let binary = resolve_cli(&executable_path, &agent)?;
    tauri::async_runtime::spawn_blocking(move || list(binary, &agent))
        .await
        .map_err(|_| "Model discovery stopped.".to_string())?
}

fn choices(value: &Value, agent: &str) -> Result<Value, String> {
    let entries = value
        .as_array()
        .ok_or("The CLI returned no model catalog. Update it or enter a custom model ID.")?;
    let mut seen = std::collections::HashSet::new();
    let models: Vec<_> = entries
        .iter()
        .filter_map(|entry| {
            let id = entry[if agent == "claude" { "value" } else { "model" }].as_str()?;
            if id.is_empty() || validate_model(id).is_err() || !seen.insert(id.to_string()) {
                return None;
            }
            let label = entry["displayName"]
                .as_str()
                .unwrap_or(id)
                .chars()
                .filter(|c| !c.is_control())
                .take(160)
                .collect::<String>();
            Some(json!({"id":id,"label":label}))
        })
        .collect();
    Ok(json!(models))
}

fn list(binary: PathBuf, agent: &str) -> Result<Value, String> {
    let directory =
        tempfile::tempdir().map_err(|_| "Cannot prepare model discovery.".to_string())?;
    let mut command = Command::new(binary);
    command.current_dir(directory.path());
    let cancelled = AtomicBool::new(false);
    let closed = AtomicBool::new(false);
    if agent == "claude" {
        let settings = crate::claude_settings::user_settings()?;
        command.arg("--settings").arg(settings.path()).args([
            "-p",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--verbose",
            "--tools",
            "",
            "--setting-sources",
            "",
            "--strict-mcp-config",
            "--mcp-config",
            "{\"mcpServers\":{}}",
            "--disable-slash-commands",
            "--no-session-persistence",
        ]);
        command.env_remove("CLAUDE_CODE_SAFE_MODE");
        let pipe = Pipe::spawn(&mut command)?;
        let initialized = claude_mcp::initialize(&pipe, &cancelled, &closed)?;
        return choices(&initialized["models"], agent);
    }
    command
        .args(["app-server", "--stdio", "--strict-config"])
        .args(codex_config_args());
    let pipe = Pipe::spawn(&mut command)?;
    pipe.send(json!({"id":1,"method":"initialize","params":{"clientInfo":{"name":"chista","version":"0.1.0"},"capabilities":{"experimentalApi":true}}}))?;
    let started = Instant::now();
    let mut total = 0;
    let mut all = Vec::new();
    let mut request = 2;
    loop {
        let frame = pipe.next(&cancelled, &closed, started, &mut total)?;
        if pipe.reject_tool(&frame)? {
            continue;
        }
        if frame.get("error").is_some() {
            return Err("Could not load models. Check the CLI installation and sign-in, or enter a custom model ID.".into());
        }
        if frame["id"] == 1 && frame.get("method").is_none() {
            pipe.send(json!({"method":"initialized","params":{}}))?;
            pipe.send(json!({"id":request,"method":"model/list","params":{"limit":100,"includeHidden":false}}))?;
        } else if frame["id"] == request && frame.get("method").is_none() {
            let entries = frame["result"]["data"]
                .as_array()
                .ok_or("Invalid CLI model catalog.")?;
            all.extend(entries.iter().cloned());
            if frame["result"]["nextCursor"].is_null() {
                return choices(&json!(all), agent);
            }
            request += 1;
            if request > 12 {
                return Err("CLI model catalog is too large.".into());
            }
            pipe.send(json!({"id":request,"method":"model/list","params":{"limit":100,"includeHidden":false,"cursor":frame["result"]["nextCursor"]}}))?;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "Requires installed Claude and Codex CLIs; catalog lookup only, no inference"]
    fn installed_cli_catalogs() {
        for agent in ["claude", "codex"] {
            let models = list(resolve_cli("", agent).unwrap(), agent).unwrap();
            assert!(
                !models.as_array().unwrap().is_empty(),
                "{agent} returned an empty catalog"
            );
            println!(
                "{agent}: {} model choices, no inference",
                models.as_array().unwrap().len()
            );
        }
    }
    #[test]
    fn accepts_native_model_identifiers_and_rejects_flags_or_controls() {
        for id in [
            "",
            "sonnet",
            "opus[1m]",
            "provider/model-v1",
            "arn:aws:bedrock:model",
        ] {
            validate_model(id).unwrap();
        }
        for id in ["--unsafe", "model\nother", "a b", "$(secret)"] {
            assert!(validate_model(id).is_err());
        }
    }
    #[test]
    fn normalizes_native_catalogs_without_exposing_extra_account_fields() {
        let claude = choices(&json!([{"value":"sonnet","displayName":"Sonnet","account":"private"},{"value":"sonnet"},{"value":"--unsafe"}]), "claude").unwrap();
        assert_eq!(claude, json!([{"id":"sonnet","label":"Sonnet"}]));
        let codex = choices(
            &json!([{"model":"fixture-model","displayName":"Fixture","secret":"private"}]),
            "codex",
        )
        .unwrap();
        assert_eq!(codex, json!([{"id":"fixture-model","label":"Fixture"}]));
    }
}
