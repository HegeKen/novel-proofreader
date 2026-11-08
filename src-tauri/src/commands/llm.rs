//! 本地 LLM Tauri 命令层：仅做参数装配，业务实现见 [`crate::llm::service`]

use crate::events::TauriSink;
use crate::llm::service::{self, LLMStatus};
use crate::llm::{memory, model_manager};
use std::sync::Arc;
use tauri::command;

/// 获取本地 LLM 状态
#[command]
pub fn llm_get_status() -> Result<LLMStatus, String> {
    service::get_status()
}

/// 扫描模型目录中所有可用模型（含预置 + 用户导入）
#[command]
pub fn llm_scan_models() -> Vec<model_manager::ModelInfo> {
    service::scan_models()
}

/// 导入外部 GGUF 模型文件
#[command]
pub fn llm_import_model(path: String) -> Result<model_manager::ModelInfo, String> {
    service::import_model(path)
}

/// 加载本地模型（支持预置和用户导入）
#[command]
pub fn llm_load_model(
    model_id: String,
    context_size: Option<u32>,
    gpu_layers: Option<i32>,
    silent_llama_logs: Option<bool>,
) -> Result<(), String> {
    service::load_model(model_id, context_size, gpu_layers, silent_llama_logs)
}

/// 卸载本地模型
#[command]
pub fn llm_unload_model() -> Result<(), String> {
    service::unload_model()
}

/// 非流式推理
#[command]
pub fn llm_inference(prompt: String) -> Result<String, String> {
    service::inference(prompt)
}

/// 流式推理（通过 llm-stream-token 事件推送文本片段）
#[command]
pub fn llm_inference_stream(app: tauri::AppHandle, prompt: String) -> Result<(), String> {
    service::inference_stream(&prompt, &TauriSink::new(app))
}

/// 下载预置模型（通过 llm-download-progress 事件推送进度）
#[command]
pub async fn llm_download_model(app: tauri::AppHandle, model_id: String) -> Result<(), String> {
    service::download_model(model_id, Arc::new(TauriSink::new(app))).await
}

/// 删除已下载的模型（支持预置和用户导入）
#[command]
pub fn llm_delete_model(model_id: String) -> Result<(), String> {
    service::delete_model(model_id)
}

/// 获取系统资源信息（内存 / 磁盘空间 / 推荐模型）
#[command]
pub fn llm_get_system_info() -> memory::SystemInfo {
    service::get_system_info()
}

/// 在系统文件管理器中打开模型存储目录
#[command]
pub fn llm_open_models_dir() -> Result<(), String> {
    let dir = service::models_dir();
    let path = dir.to_string_lossy().to_string();
    println!("[LLM] 打开模型目录: {}", path);

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&dir)
            .spawn()
            .map_err(|e| format!("打开目录失败: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&dir)
            .spawn()
            .map_err(|e| format!("打开目录失败: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&dir)
            .spawn()
            .map_err(|e| format!("打开目录失败: {}", e))?;
    }

    // Android 端无法直接调用系统文件管理器，返回路径由前端 Toast 展示
    #[cfg(target_os = "android")]
    {
        return Err(format!("Android 端请手动前往: {}", path));
    }

    #[cfg(not(target_os = "android"))]
    Ok(())
}

/// 调试日志命令：输出关键路径和环境信息到控制台（Android 可通过 logcat 查看）
#[command]
pub fn llm_debug_log() -> String {
    service::debug_log()
}
