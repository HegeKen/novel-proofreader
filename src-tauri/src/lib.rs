mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            commands::start_tts_service,
            commands::stop_tts_service,
            commands::update_tts_notification,
            commands::start_proofread_service,
            commands::stop_proofread_service,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
