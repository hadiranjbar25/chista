mod claude;
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![claude::claude_status, claude::launch_claude])
        .run(tauri::generate_context!())
        .expect("error while running Chista");
}
