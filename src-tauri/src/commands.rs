use tauri::command;

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
pub fn start_proofread_service() -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        android_service::start_proofread_service().map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(())
    }
}

#[command]
pub fn stop_proofread_service() -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        android_service::stop_proofread_service().map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
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

    pub fn start_proofread_service() -> Result<(), Box<dyn std::error::Error>> {
        Ok(())
    }

    pub fn stop_proofread_service() -> Result<(), Box<dyn std::error::Error>> {
        Ok(())
    }
}
