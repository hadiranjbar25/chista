mod claude;
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .manage(claude::ChatProcesses::default())
        .invoke_handler(tauri::generate_handler![
            claude::claude_status,
            claude::claude_auth_status,
            claude::claude_sign_in,
            claude::launch_claude,
            claude::claude_chat,
            claude::cancel_agent_chat,
            claude::codex_status,
            claude::launch_codex,
            claude::codex_chat
        ])
        .run(tauri::generate_context!())
        .expect("error while running Chista");
}
