//! 本地 LLM 命令模块：状态查询 / 模型管理 / 推理 / 下载
//!
//! 引擎实现与模型管理见 [`crate::llm`]，本模块只承担 Tauri 命令层的参数装配、
//! 全局状态（引擎实例 / 已加载模型 id）与事件推送。

use crate::llm::engine::{InferenceConfig, LLMEngine};
use crate::llm::{memory, model_manager};
use serde::Serialize;
use std::sync::{Mutex, OnceLock};
use tauri::command;
use tauri::Emitter;

/// 全局推理引擎实例（跨命令共享）
static ENGINE: OnceLock<Mutex<LLMEngine>> = OnceLock::new();
/// 当前已加载的模型 id
static LOADED_MODEL_ID: OnceLock<Mutex<Option<String>>> = OnceLock::new();

fn engine() -> &'static Mutex<LLMEngine> {
    ENGINE.get_or_init(|| Mutex::new(LLMEngine::new()))
}

fn loaded_model_id() -> &'static Mutex<Option<String>> {
    LOADED_MODEL_ID.get_or_init(|| Mutex::new(None))
}

/// LLM 状态信息
#[derive(Debug, Clone, Serialize)]
pub struct LLMStatus {
    pub loaded: bool,
    pub model_id: Option<String>,
    pub engine_ready: bool,
    pub downloaded_models: Vec<model_manager::ModelInfo>,
    pub preset_models: Vec<model_manager::ModelInfo>,
    pub system: memory::SystemInfo,
    /// 模型存储目录的完整路径（用于 UI 展示和打开）
    pub models_dir: String,
}

/// 获取本地 LLM 状态
#[command]
pub fn llm_get_status() -> Result<LLMStatus, String> {
    println!("[LLM] 获取状态");
    let engine = engine().lock().map_err(|e| {
        eprintln!("[LLM ERROR] 获取引擎锁失败: {}", e);
        e.to_string()
    })?;
    let loaded_id = loaded_model_id().lock().map_err(|e| {
        eprintln!("[LLM ERROR] 获取模型ID锁失败: {}", e);
        e.to_string()
    })?;
    let status = LLMStatus {
        loaded: engine.is_loaded(),
        model_id: loaded_id.clone(),
        engine_ready: cfg!(feature = "local-llm"),
        downloaded_models: model_manager::get_downloaded_models(),
        preset_models: model_manager::get_preset_models(),
        system: memory::get_system_info(),
        models_dir: model_manager::get_models_dir().to_string_lossy().to_string(),
    };
    println!("[LLM] 状态: loaded={}, model_id={:?}, engine_ready={}, models_dir={}",
        status.loaded, status.model_id, status.engine_ready, status.models_dir);
    Ok(status)
}

/// 扫描模型目录中所有可用模型（含预置 + 用户导入）
#[command]
pub fn llm_scan_models() -> Vec<model_manager::ModelInfo> {
    model_manager::scan_available_models()
}

/// 导入外部 GGUF 模型文件
#[command]
pub fn llm_import_model(path: String) -> Result<model_manager::ModelInfo, String> {
    println!("[LLM] 导入模型请求: {}", path);
    let result = model_manager::import_model(std::path::Path::new(&path));
    match &result {
        Ok(m) => println!("[LLM] 导入成功: {} ({} MB)", m.filename, m.size_mb),
        Err(e) => eprintln!("[LLM ERROR] 导入失败: {}", e),
    }
    result
}

/// 加载本地模型（支持预置和用户导入）
#[command]
pub fn llm_load_model(
    model_id: String,
    context_size: Option<u32>,
    gpu_layers: Option<i32>,
    silent_llama_logs: Option<bool>,
) -> Result<(), String> {
    let path = model_manager::get_model_path_by_id(&model_id)
        .ok_or_else(|| format!("模型不存在或尚未下载: {}", model_id))?;

    let config = InferenceConfig {
        model_path: path.to_string_lossy().to_string(),
        context_size: context_size.unwrap_or(4096),
        gpu_layers: gpu_layers.unwrap_or(-1),
        temperature: 0.3,
        max_tokens: 8192,
        silent_llama_logs: silent_llama_logs.unwrap_or(true),
    };

    let mut engine = engine().lock().map_err(|e| e.to_string())?;
    engine.load_model(config)?;
    *loaded_model_id().lock().map_err(|e| e.to_string())? = Some(model_id);
    Ok(())
}

/// 卸载本地模型
#[command]
pub fn llm_unload_model() -> Result<(), String> {
    let mut engine = engine().lock().map_err(|e| e.to_string())?;
    engine.unload_model();
    *loaded_model_id().lock().map_err(|e| e.to_string())? = None;
    Ok(())
}

/// 非流式推理
#[command]
pub fn llm_inference(prompt: String) -> Result<String, String> {
    println!("[LLM] === 推理请求开始 ===");
    println!("[LLM] 输入 prompt (前500字): {}", &prompt.chars().take(500).collect::<String>());
    println!("[LLM] prompt 总长度: {} 字符", prompt.chars().count());
    let engine = engine().lock().map_err(|e| e.to_string())?;
    if !engine.is_loaded() {
        println!("[LLM] 错误: 模型未加载");
        return Err("模型未加载，请先调用 llm_load_model".to_string());
    }
    match engine.inference(&prompt) {
        Ok(output) => {
            println!("[LLM] 模型输出 (前1000字): {}", &output.chars().take(1000).collect::<String>());
            println!("[LLM] 输出总长度: {} 字符", output.chars().count());
            println!("[LLM] === 推理请求结束 ===");
            Ok(output)
        }
        Err(e) => {
            println!("[LLM] 推理失败: {}", e);
            Err(e)
        }
    }
}

/// 流式推理（通过 llm-stream-token 事件推送文本片段）
#[command]
pub fn llm_inference_stream(app: tauri::AppHandle, prompt: String) -> Result<(), String> {
    let engine = engine().lock().map_err(|e| e.to_string())?;
    if !engine.is_loaded() {
        return Err("模型未加载，请先调用 llm_load_model".to_string());
    }
    engine.inference_stream(&prompt, |piece| {
        // 事件发送失败（如窗口已关闭）时中断生成
        app.emit("llm-stream-token", piece).is_ok()
    })
}

/// 下载进度事件负载
#[derive(Debug, Clone, Serialize)]
struct DownloadProgress {
    model_id: String,
    downloaded: u64,
    total: u64,
}

/// 下载预置模型（通过 llm-download-progress 事件推送进度）
#[command]
pub async fn llm_download_model(app: tauri::AppHandle, model_id: String) -> Result<(), String> {
    println!("[LLM] 下载模型请求: {}", model_id);

    let model = model_manager::get_preset_models()
        .into_iter()
        .find(|m| m.id == model_id)
        .ok_or_else(|| {
            eprintln!("[LLM ERROR] 未知模型: {}", model_id);
            format!("未知模型: {}", model_id)
        })?;

    if model_manager::is_model_downloaded(&model) {
        println!("[LLM] 模型已下载: {}", model_id);
        return Ok(()); // 已下载，幂等返回
    }

    println!("[LLM] 开始下载: {} -> {}", model.name, model.url);
    let id = model.id.clone();
    let result = model_manager::download_model(&model, &move |downloaded, total| {
        let _ = app.emit(
            "llm-download-progress",
            DownloadProgress {
                model_id: id.clone(),
                downloaded,
                total,
            },
        );
    })
    .await;

    match &result {
        Ok(path) => println!("[LLM] 下载成功: {}", path.display()),
        Err(e) => eprintln!("[LLM ERROR] 下载失败: {}", e),
    }
    result?;
    Ok(())
}

/// 删除已下载的模型（支持预置和用户导入）
#[command]
pub fn llm_delete_model(model_id: String) -> Result<(), String> {
    let model = model_manager::find_model_by_id(&model_id)
        .ok_or_else(|| format!("未知模型: {}", model_id))?;

    // 删除前若已加载则先卸载
    let loaded_id = loaded_model_id().lock().map_err(|e| e.to_string())?.clone();
    if loaded_id.as_deref() == Some(model_id.as_str()) {
        let mut engine = engine().lock().map_err(|e| e.to_string())?;
        engine.unload_model();
        *loaded_model_id().lock().map_err(|e| e.to_string())? = None;
    }

    model_manager::delete_model(&model)
}

/// 获取系统资源信息（内存 / 磁盘空间 / 推荐模型）
#[command]
pub fn llm_get_system_info() -> memory::SystemInfo {
    let info = memory::get_system_info();
    println!("[LLM] 系统信息: 内存 {} MB, 磁盘可用 {} MB, 推荐模型: {}",
        info.total_memory_mb, info.disk_available_mb, info.recommended_model_id);
    info
}

/// 在系统文件管理器中打开模型存储目录
#[command]
pub fn llm_open_models_dir() -> Result<(), String> {
    let dir = model_manager::get_models_dir();
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
    let mut lines = Vec::new();
    lines.push(format!("=== LLM 调试信息 ==="));
    lines.push(format!("模型目录: {}", model_manager::get_models_dir().display()));
    lines.push(format!("数据目录: {:?}", dirs::data_dir()));
    lines.push(format!("引擎就绪: {}", cfg!(feature = "local-llm")));
    let sys = memory::get_system_info();
    lines.push(format!("内存: {} MB", sys.total_memory_mb));
    lines.push(format!("磁盘可用: {} MB", sys.disk_available_mb));
    lines.push(format!("推荐模型: {}", sys.recommended_model_id));
    let downloaded = model_manager::get_downloaded_models();
    lines.push(format!("已下载模型数: {}", downloaded.len()));
    for m in &downloaded {
        lines.push(format!("  - {} ({})", m.name, m.filename));
    }
    let scanned = model_manager::scan_available_models();
    lines.push(format!("目录扫描模型数: {}", scanned.len()));
    for m in &scanned {
        lines.push(format!("  - {} ({}) [{}]", m.name, m.filename, m.description));
    }
    let output = lines.join("\n");
    println!("{}", output);
    output
}
