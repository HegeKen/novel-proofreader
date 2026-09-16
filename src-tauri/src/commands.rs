use tauri::command;

/// Android 侧 Kotlin 插件句柄，用于调用 ProofreadPlugin
#[cfg(target_os = "android")]
pub struct ProofreadPluginHandle(pub tauri::plugin::PluginHandle<tauri::Wry>);

#[command]
pub fn start_tts_service() -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        android_service::start_tts_service().map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(())
    }
}

#[command]
pub fn stop_tts_service() -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        android_service::stop_tts_service().map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(())
    }
}

#[command]
pub fn update_tts_notification(_title: String, _is_playing: bool) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        android_service::update_tts_notification(_title, _is_playing).map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(())
    }
}

#[command]
pub async fn start_proofread_service(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        let handle = app.state::<ProofreadPluginHandle>().0.clone();
        handle
            .run_mobile_plugin_async::<()>("start", ())
            .await
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(())
    }
}

#[command]
pub async fn stop_proofread_service(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        let handle = app.state::<ProofreadPluginHandle>().0.clone();
        handle
            .run_mobile_plugin_async::<()>("stop", ())
            .await
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(())
    }
}

#[cfg(target_os = "android")]
mod android_service {
    pub fn start_tts_service() -> Result<(), Box<dyn std::error::Error>> {
        Ok(())
    }

    pub fn stop_tts_service() -> Result<(), Box<dyn std::error::Error>> {
        Ok(())
    }

    pub fn update_tts_notification(_title: String, _is_playing: bool) -> Result<(), Box<dyn std::error::Error>> {
        Ok(())
    }
}
