// ============================================================
// 本地 LLM 服务层：引擎状态、模型管理与推理
//
// 桌面端（Tauri 命令）与 Web 端（axum RPC）共用本模块，
// 事件推送通过 [`EventSink`] 抽象，避免依赖 Tauri AppHandle。
// ============================================================

use crate::events::EventSink;
use crate::llm::engine::{InferenceConfig, LLMEngine};
use crate::llm::{memory, model_manager};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

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
pub fn get_status() -> Result<LLMStatus, String> {
    println!("[LLM] 获取状态");
    let engine = engine().lock().map_err(|e| {
        eprintln!("[LLM ERROR] 获取引擎锁失败: {}", e);
        e.to_string()
    })?;
    let loaded_id = loaded_model_id().lock().map_err(|e| {
        eprintln!("[LLM ERROR] 获取模型ID锁失败: {}", e);
        e.to_string()
    })?;
    Ok(LLMStatus {
        loaded: engine.is_loaded(),
        model_id: loaded_id.clone(),
        engine_ready: cfg!(feature = "local-llm"),
        downloaded_models: model_manager::get_downloaded_models(),
        preset_models: model_manager::get_preset_models(),
        system: memory::get_system_info(),
        models_dir: model_manager::get_models_dir().to_string_lossy().to_string(),
    })
}

/// 扫描模型目录中所有可用模型（含预置 + 用户导入）
pub fn scan_models() -> Vec<model_manager::ModelInfo> {
    model_manager::scan_available_models()
}

/// 导入外部 GGUF 模型文件
pub fn import_model(path: String) -> Result<model_manager::ModelInfo, String> {
    println!("[LLM] 导入模型请求: {}", path);
    let result = model_manager::import_model(std::path::Path::new(&path));
    match &result {
        Ok(m) => println!("[LLM] 导入成功: {} ({} MB)", m.filename, m.size_mb),
        Err(e) => eprintln!("[LLM ERROR] 导入失败: {}", e),
    }
    result
}

/// 加载本地模型（支持预置和用户导入）
pub fn load_model(
    model_id: String,
    context_size: Option<u32>,
    gpu_layers: Option<i32>,
    silent_llama_logs: Option<bool>,
) -> Result<(), String> {
    let path = model_manager::get_model_path_by_id(&model_id)
        .ok_or_else(|| format!("模型不存在或尚未下载: {}", model_id))?;

    // Web 容器无 GPU 时可通过 PROOFREADER_LLM_GPU_LAYERS=0 指定默认 offload 层数；
    // 前端传 -1（自动）时优先采用该环境变量，避免容器中无效的 GPU offload
    let env_gpu_layers = std::env::var("PROOFREADER_LLM_GPU_LAYERS")
        .ok()
        .and_then(|v| v.trim().parse::<i32>().ok());
    let gpu_layers = match gpu_layers {
        Some(value) if value >= 0 => Some(value),
        other => env_gpu_layers.or(other),
    };

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
pub fn unload_model() -> Result<(), String> {
    let mut engine = engine().lock().map_err(|e| e.to_string())?;
    engine.unload_model();
    *loaded_model_id().lock().map_err(|e| e.to_string())? = None;
    Ok(())
}

/// 非流式推理
pub fn inference(prompt: String) -> Result<String, String> {
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

/// 非阻塞推理：已有推理正在运行时不等待，直接返回忙（Web 端使用）
pub fn try_inference(prompt: &str) -> Result<String, String> {
    let engine = engine()
        .try_lock()
        .map_err(|_| "本地推理正忙，请等待当前请求结束后重试".to_string())?;
    if !engine.is_loaded() {
        return Err("模型未加载，请先加载本地模型".to_string());
    }
    engine.inference(prompt)
}

/// 流式推理（通过 `llm-stream-token` 事件推送文本片段）
pub fn inference_stream(prompt: &str, sink: &dyn EventSink) -> Result<(), String> {
    let engine = engine().lock().map_err(|e| e.to_string())?;
    if !engine.is_loaded() {
        return Err("模型未加载，请先调用 llm_load_model".to_string());
    }
    engine.inference_stream(prompt, |piece| {
        // 事件发送失败（如窗口已关闭 / 订阅端断开）时中断生成
        sink.emit("llm-stream-token", serde_json::Value::String(piece))
    })
}

/// 下载预置模型（通过 llm-download-progress 事件推送进度）
pub async fn download_model(model_id: String, sink: std::sync::Arc<dyn EventSink>) -> Result<(), String> {
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
    let sink_for_progress = sink.clone();
    let result = model_manager::download_model(&model, &move |downloaded, total| {
        let _ = sink_for_progress.emit(
            "llm-download-progress",
            serde_json::json!({ "model_id": id, "downloaded": downloaded, "total": total }),
        );
    })
    .await;

    match &result {
        Ok(path) => println!("[LLM] 下载成功: {}", path.display()),
        Err(e) => eprintln!("[LLM ERROR] 下载失败: {}", e),
    }
    result.map(|_| ())
}

/// 删除已下载的模型（支持预置和用户导入）
pub fn delete_model(model_id: String) -> Result<(), String> {
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
pub fn get_system_info() -> memory::SystemInfo {
    let info = memory::get_system_info();
    println!("[LLM] 系统信息: 内存 {} MB, 磁盘可用 {} MB, 推荐模型: {}",
        info.total_memory_mb, info.disk_available_mb, info.recommended_model_id);
    info
}

/// 模型目录
pub fn models_dir() -> PathBuf {
    model_manager::get_models_dir()
}

/// 调试日志内容（Web 端直接返回文本）
pub fn debug_log() -> String {
    let mut lines = Vec::new();
    lines.push("=== LLM 调试信息 ===".to_string());
    lines.push(format!("模型目录: {}", model_manager::get_models_dir().display()));
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
