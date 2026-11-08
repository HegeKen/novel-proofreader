// ============================================================
// Web 端 RPC 分发：POST /api/rpc
//
// 请求：{"command": "llm_get_status", "args": {...}}
// 成功：裸 JSON 返回值；失败：{"error": "..."}
// 参数名与前端 invoke 完全一致（camelCase）。
// ============================================================

use crate::emotion;
use crate::external_tts;
use crate::llm::service as llm_service;
use crate::local_tts;
use crate::voice_design;
use crate::web::events::{SseSink, ChannelSink};
use axum::extract::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;

#[derive(Debug, Deserialize)]
pub struct RpcRequest {
    pub command: String,
    #[serde(default)]
    pub args: Value,
}

/// RPC 主入口
pub async fn rpc_handler(Json(request): Json<RpcRequest>) -> Json<Value> {
    let args = if request.args.is_null() {
        Value::Object(Default::default())
    } else {
        request.args
    };
    match dispatch(&request.command, &args).await {
        Ok(value) => Json(value),
        Err(error) => Json(json!({ "error": error })),
    }
}

/// 按命令名分发到服务层
async fn dispatch(command: &str, args: &Value) -> Result<Value, String> {
    match command {
        // Android / 桌面专用服务：Web 端直接视为成功
        "start_tts_service"
        | "stop_tts_service"
        | "update_tts_notification"
        | "start_proofread_service"
        | "stop_proofread_service" => Ok(Value::Null),
        "macos_open_full_disk_access_settings" => Err("仅 macOS 桌面版支持该设置".to_string()),

        // ---------------- 本地 LLM ----------------
        "llm_get_status" => blocking(llm_service::get_status).await,
        "llm_scan_models" => vec_to_json(llm_service::scan_models()),
        "llm_import_model" => {
            let path = str_arg(args, &["path"])?;
            blocking(move || llm_service::import_model(path)).await
        }
        "llm_load_model" => {
            let model_id = str_arg(args, &["modelId", "model_id"])?;
            let context_size = opt_u32(args, &["contextSize", "context_size"]);
            let gpu_layers = opt_i32(args, &["gpuLayers", "gpu_layers"]);
            let silent = opt_bool(args, &["silentLlamaLogs", "silent_llama_logs"]);
            blocking(move || {
                llm_service::load_model(model_id, context_size, gpu_layers, silent)
            })
            .await
        }
        "llm_unload_model" => blocking(llm_service::unload_model).await,
        "llm_inference" => {
            let prompt = str_arg(args, &["prompt"])?;
            // 忙时立即失败，避免打满 blocking 线程池
            match tokio::task::spawn_blocking(move || llm_service::try_inference(&prompt)).await {
                Ok(result) => value(result),
                Err(e) => Err(format!("推理任务执行失败: {e}")),
            }
        }
        "llm_inference_stream" => {
            let prompt = str_arg(args, &["prompt"])?;
            let prompt_for_log = prompt.chars().take(500).collect::<String>();
            println!("[LLM] Web 流式推理，prompt 前500字: {}", prompt_for_log);
            tokio::task::spawn_blocking(move || {
                llm_service::inference_stream(&prompt, &SseSink)
            })
            .await
            .map_err(|e| format!("推理任务执行失败: {e}"))??;
            Ok(Value::Null)
        }
        "llm_download_model" => {
            let model_id = str_arg(args, &["modelId", "model_id"])?;
            llm_service::download_model(model_id, Arc::new(SseSink)).await?;
            Ok(Value::Null)
        }
        "llm_delete_model" => {
            let model_id = str_arg(args, &["modelId", "model_id"])?;
            blocking(move || llm_service::delete_model(model_id)).await
        }
        "llm_get_system_info" => json_value(llm_service::get_system_info()),
        "llm_open_models_dir" => Ok(Value::String(
            llm_service::models_dir().to_string_lossy().to_string(),
        )),
        "llm_debug_log" => Ok(Value::String(llm_service::debug_log())),

        // ---------------- 本地 TTS（Qwen3-TTS Base） ----------------
        "tts_local_status" => {
            let status = local_tts::tts_local_status(
                opt_string(args, &["binaryPath", "binary_path"]),
                opt_string(args, &["modelPath", "model_path"]),
                opt_string(args, &["mmprojPath", "mmproj_path"]),
                opt_string(args, &["speakerRefPath", "speaker_ref_path"]),
            )
            .await;
            json_value(status)
        }
        "tts_local_start_server" => {
            let result = local_tts::tts_local_start_server(
                opt_string(args, &["binaryPath", "binary_path"]),
                opt_string(args, &["modelPath", "model_path"]),
                opt_string(args, &["mmprojPath", "mmproj_path"]),
                opt_i32(args, &["gpuLayers", "gpu_layers"]),
                opt_u32(args, &["contextSize", "context_size"]),
            )
            .await;
            value(result)
        }
        "tts_local_stop_server" => {
            local_tts::tts_local_stop_server().await?;
            Ok(Value::Null)
        }
        "tts_local_synthesize" => {
            let input = str_arg(args, &["input"])?;
            let result = local_tts::tts_local_synthesize(
                input,
                opt_string(args, &["lang"]),
                opt_string(args, &["speakerRefPath", "speaker_ref_path"]),
                opt_u32(args, &["nPredict", "n_predict"]),
                opt_i32(args, &["topK", "top_k"]),
                opt_f32(args, &["topP", "top_p"]),
                opt_f32(args, &["repeatPenalty", "repeat_penalty"]),
                opt_i64(args, &["seed"]),
            )
            .await;
            value(result)
        }
        "tts_local_download_mmproj" => {
            let path = local_tts::download_mmproj(&SseSink).await?;
            Ok(Value::String(path))
        }
        "tts_local_install_runtime" => {
            let path = local_tts::install_runtime(&SseSink).await?;
            Ok(Value::String(path))
        }

        // ---------------- VoiceDesign（CrispASR） ----------------
        "tts_voice_design_status" => {
            let status = voice_design::tts_voice_design_status(
                opt_string(args, &["binaryPath", "binary_path"]),
                opt_string(args, &["modelPath", "model_path"]),
                opt_string(args, &["codecPath", "codec_path"]),
            )
            .await;
            json_value(status)
        }
        "tts_voice_design_start_server" => {
            let result = voice_design::tts_voice_design_start_server(
                opt_string(args, &["binaryPath", "binary_path"]),
                opt_string(args, &["modelPath", "model_path"]),
                opt_string(args, &["codecPath", "codec_path"]),
            )
            .await;
            value(result)
        }
        "tts_voice_design_stop_server" => {
            voice_design::tts_voice_design_stop_server().await?;
            Ok(Value::Null)
        }
        "tts_voice_design_synthesize" => {
            let input = str_arg(args, &["input"])?;
            let result = voice_design::tts_voice_design_synthesize(
                input,
                opt_string(args, &["instructions"]),
                opt_string(args, &["language"]),
                opt_i64(args, &["seed"]),
            )
            .await;
            value(result)
        }
        "tts_voice_design_download_model" => {
            let kind = str_arg(args, &["kind"])?;
            let path = voice_design::download_model(&SseSink, kind).await?;
            Ok(Value::String(path))
        }
        "tts_voice_design_install_runtime" => {
            let path = voice_design::install_runtime(&SseSink).await?;
            Ok(Value::String(path))
        }

        // ---------------- 外部 OpenAI 兼容 TTS ----------------
        "tts_external_synthesize" => {
            let url = str_arg(args, &["url"])?;
            let api_key = opt_string(args, &["apiKey", "api_key"]);
            let body = args.get("body").cloned().unwrap_or(Value::Null);
            let result = external_tts::tts_external_synthesize(url, api_key, body).await;
            value(result)
        }

        // ---------------- 本地情感分析 ----------------
        "emotion_local_status" => json_value(emotion::emotion_local_status()),
        "emotion_local_download" => {
            let status = emotion::download(&SseSink).await?;
            json_value(status)
        }
        "emotion_local_import_dir" => {
            let source_dir = str_arg(args, &["sourceDir", "source_dir"])?;
            let status = emotion::import_dir(&SseSink, source_dir).await?;
            json_value(status)
        }
        "emotion_local_analyze" => {
            let text = str_arg(args, &["text"])?;
            let context = opt_string(args, &["context"]);
            let result = emotion::emotion_local_analyze(text, context).await;
            value(result)
        }
        "emotion_local_unload" => json_value(emotion::emotion_local_unload()),

        other => Err(format!("Web 端暂不支持的命令: {other}")),
    }
}

// ------------------------------------------------------------
// 参数与返回值辅助
// ------------------------------------------------------------

fn raw<'a>(args: &'a Value, names: &[&str]) -> Option<&'a Value> {
    names
        .iter()
        .find_map(|name| args.get(*name))
        .filter(|value| !value.is_null())
}

fn str_arg(args: &Value, names: &[&str]) -> Result<String, String> {
    raw(args, names)
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
        .ok_or_else(|| format!("缺少参数: {}", names[0]))
}

fn opt_string(args: &Value, names: &[&str]) -> Option<String> {
    raw(args, names)
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
}

fn opt_u32(args: &Value, names: &[&str]) -> Option<u32> {
    raw(args, names).and_then(|value| value.as_u64()).map(|v| v as u32)
}

fn opt_i32(args: &Value, names: &[&str]) -> Option<i32> {
    raw(args, names).and_then(|value| value.as_i64()).map(|v| v as i32)
}

fn opt_i64(args: &Value, names: &[&str]) -> Option<i64> {
    raw(args, names).and_then(|value| value.as_i64())
}

fn opt_f32(args: &Value, names: &[&str]) -> Option<f32> {
    raw(args, names).and_then(|value| value.as_f64()).map(|v| v as f32)
}

fn opt_bool(args: &Value, names: &[&str]) -> Option<bool> {
    raw(args, names).and_then(|value| value.as_bool())
}

/// 绑定阻塞任务到独立线程，避免占用 axum worker
async fn blocking<T, F>(task: F) -> Result<Value, String>
where
    T: serde::Serialize + Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    match tokio::task::spawn_blocking(task).await {
        Ok(result) => value(result),
        Err(error) => Err(format!("后台任务执行失败: {error}")),
    }
}

fn value<T: serde::Serialize>(result: Result<T, String>) -> Result<Value, String> {
    result.and_then(|value| {
        serde_json::to_value(value).map_err(|error| format!("序列化返回值失败: {error}"))
    })
}

fn json_value<T: serde::Serialize>(value: T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|error| format!("序列化返回值失败: {error}"))
}

fn vec_to_json<T: serde::Serialize>(list: Vec<T>) -> Result<Value, String> {
    serde_json::to_value(list).map_err(|error| format!("序列化返回值失败: {error}"))
}

/// 供 /api/llm/stream 使用：把通道 sink 包装成流式推理
pub async fn stream_inference(
    prompt: String,
    sink: ChannelSink,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        crate::llm::service::inference_stream(&prompt, &sink)
    })
    .await
    .map_err(|e| format!("推理任务执行失败: {e}"))?
}

/// 供 health 检查复用的命令数
pub const SUPPORTED_COMMANDS: &[&str] = &[
    "llm_get_status",
    "llm_scan_models",
    "llm_import_model",
    "llm_load_model",
    "llm_unload_model",
    "llm_inference",
    "llm_inference_stream",
    "llm_download_model",
    "llm_delete_model",
    "llm_get_system_info",
    "llm_open_models_dir",
    "llm_debug_log",
    "tts_local_status",
    "tts_local_start_server",
    "tts_local_stop_server",
    "tts_local_synthesize",
    "tts_local_download_mmproj",
    "tts_local_install_runtime",
    "tts_voice_design_status",
    "tts_voice_design_start_server",
    "tts_voice_design_stop_server",
    "tts_voice_design_synthesize",
    "tts_voice_design_download_model",
    "tts_voice_design_install_runtime",
    "tts_external_synthesize",
    "emotion_local_status",
    "emotion_local_download",
    "emotion_local_import_dir",
    "emotion_local_analyze",
    "emotion_local_unload",
];
