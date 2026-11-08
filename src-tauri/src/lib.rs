pub mod commands;
pub mod emotion;
pub mod events;
pub mod external_tts;
pub mod llm;
pub mod local_tts;
pub mod paths;
pub mod voice_design;

#[cfg(feature = "web-server")]
pub mod web;

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
            commands::macos_open_full_disk_access_settings,
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
            // 本地 TTS（Qwen3-TTS GGUF）命令
            local_tts::tts_local_status,
            local_tts::tts_local_start_server,
            local_tts::tts_local_stop_server,
            local_tts::tts_local_synthesize,
            local_tts::tts_local_download_mmproj,
            local_tts::tts_local_install_runtime,
            // 本地 TTS：Qwen3-TTS VoiceDesign（CrispASR）命令
            voice_design::tts_voice_design_status,
            voice_design::tts_voice_design_start_server,
            voice_design::tts_voice_design_stop_server,
            voice_design::tts_voice_design_synthesize,
            voice_design::tts_voice_design_download_model,
            voice_design::tts_voice_design_install_runtime,
            // 外部 OpenAI 兼容 TTS（Rust 侧请求，绕过 WebView CORS）
            external_tts::tts_external_synthesize,
            // 本地情感分析（RoBERTa 多标签，离线）
            emotion::emotion_local_status,
            emotion::emotion_local_download,
            emotion::emotion_local_import_dir,
            emotion::emotion_local_analyze,
            emotion::emotion_local_unload,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            // 应用退出时结束 llama-server 子进程，避免残留占用内存/端口
            if let tauri::RunEvent::Exit = event {
                local_tts::shutdown();
                voice_design::shutdown();
            }
        });
}
