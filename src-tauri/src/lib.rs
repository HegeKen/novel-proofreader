mod commands;
mod llm;

#[cfg(target_os = "android")]
use tauri::plugin::{Builder, TauriPlugin};
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
        .setup(|app| {
            // 初始化模型存储目录：Android 上使用 Tauri app_data_dir（可写），桌面端回退到 dirs::data_dir
            if let Ok(app_data) = app.path().app_data_dir() {
                llm::model_manager::set_models_dir(app_data);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::start_tts_service,
            commands::stop_tts_service,
            commands::update_tts_notification,
            commands::start_proofread_service,
            commands::stop_proofread_service,
            // 本地 LLM 命令
            commands::llm::llm_get_status,
            commands::llm::llm_load_model,
            commands::llm::llm_unload_model,
            commands::llm::llm_inference,
            commands::llm::llm_inference_stream,
            commands::llm::llm_download_model,
            commands::llm::llm_delete_model,
            commands::llm::llm_get_system_info,
            commands::llm::llm_open_models_dir,
            commands::llm::llm_scan_models,
            commands::llm::llm_import_model,
            commands::llm::llm_debug_log,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
