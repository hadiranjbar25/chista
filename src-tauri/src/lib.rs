mod claude;
mod codex_stream;
mod persistent;
mod repositories;
use tauri::Manager;
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(claude::ChatProcesses::default())
        .manage(persistent::Sessions::default())
        .manage(persistent::mcp::Approvals::default())
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                webview.state::<persistent::Sessions>().close_all();
            }
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                window.state::<persistent::Sessions>().close_all();
            }
        })
        .invoke_handler(tauri::generate_handler![
            repositories::select_repository_folder,
            persistent::mcp::respond_agent_tool,
            claude::codex_mcp_sign_in,
            claude::claude_mcp_sign_in,
            persistent::agent_session_chat,
            persistent::close_agent_session,
            claude::claude_status,
            claude::claude_auth_status,
            claude::claude_sign_in,
            claude::launch_claude,
            claude::claude_chat,
            claude::cancel_agent_chat,
            claude::codex_status,
            claude::codex_auth_status,
            claude::codex_sign_in,
            claude::launch_codex,
            claude::codex_chat
        ])
        .run(tauri::generate_context!())
        .expect("error while running Chista");
}
