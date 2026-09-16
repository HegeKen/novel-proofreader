mod commands;

#[cfg(target_os = "android")]
use tauri::plugin::{Builder, TauriPlugin};
#[cfg(target_os = "android")]
use tauri::Manager;

/// 注册 Android 侧校对前台服务插件，用于桥接 Kotlin 的 ProofreadSyncService
#[cfg(target_os = "android")]
fn proofread_service_plugin() -> TauriPlugin<tauri::Wry> {
    Builder::new("proofread-service")
        .setup(|app, api| {
            let handle = api.register_android_plugin("cn.helilab.proofreader", "ProofreadPlugin")?;
            app.manage(commands::ProofreadPluginHandle(handle));
            Ok(())
        })
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init());

    #[cfg(target_os = "android")]
    let builder = builder.plugin(proofread_service_plugin());

    builder
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
