// ============================================================
// 本地情感分析（RoBERTa 多标签，离线推理）
//
// 模型：liudev/roberta-multilabel-28-3-classes
//   - 中文 RoBERTa（BERT 架构，102M 参数，F32 约 390MB）
//   - 28 种细粒度情感 + 3 种情感基调（positive / negative / neutral）
//   - 训练时使用「上文 + 当前段落」双句输入，推理时保持一致
//
// 架构：
//   - 使用 candle（纯 Rust）加载 safetensors 并做 CPU 推理，不依赖 Python / ONNX Runtime
//   - 模型文件按需下载到应用模型目录（models/emotion-roberta-28-3-classes/）
//   - 前端通过 emotion_local_analyze 获取 31 维 sigmoid 概率，再映射为朗读情绪标签
// ============================================================

use candle_core::{DType, Device, Tensor};
use candle_nn::VarBuilder;
use candle_transformers::models::bert::{BertModel, Config};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;
use tauri::{command, AppHandle, Emitter};
use tokenizers::Tokenizer;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::llm::model_manager;

/// HuggingFace 仓库
const REPO: &str = "liudev/roberta-multilabel-28-3-classes";
/// 模型目录名（位于应用模型根目录下）
const MODEL_DIR_NAME: &str = "emotion-roberta-28-3-classes";
/// 推理时的最大 token 数（与模型 README 一致）
const MAX_TOKENS: usize = 256;
/// 权重文件小于该值时视为未下载完成（避免半成品）
const MIN_MODEL_BYTES: u64 = 300 * 1024 * 1024;

const FILES: [&str; 3] = ["config.json", "tokenizer.json", "model.safetensors"];

fn log_info(msg: &str) {
    println!("[Emotion] {}", msg);
}

fn log_error(msg: &str) {
    eprintln!("[Emotion ERROR] {}", msg);
}

fn models_dir() -> PathBuf {
    model_manager::get_models_dir().join(MODEL_DIR_NAME)
}

fn file_url(name: &str) -> String {
    format!("https://huggingface.co/{REPO}/resolve/main/{name}")
}

fn file_path(name: &str) -> PathBuf {
    models_dir().join(name)
}

fn file_ok(path: &Path) -> bool {
    match std::fs::metadata(path) {
        Ok(meta) => {
            if !meta.is_file() {
                return false;
            }
            if path.file_name().and_then(|n| n.to_str()) == Some("model.safetensors") {
                meta.len() >= MIN_MODEL_BYTES
            } else {
                meta.len() > 0
            }
        }
        Err(_) => false,
    }
}

fn model_downloaded() -> bool {
    FILES.iter().all(|name| file_ok(&file_path(name)))
}

// ------------------------------------------------------------
// 推理状态
// ------------------------------------------------------------

/// 已加载的模型（只在真正分析时加载，避免仅查询状态就占用内存）
struct LoadedEmotion {
    bert: BertModel,
    tokenizer: Tokenizer,
    pooler_w: Tensor,
    pooler_b: Tensor,
    classifier_w: Tensor,
    classifier_b: Tensor,
    labels: Vec<String>,
    device: Device,
}

static MODEL: OnceLock<Mutex<Option<Arc<LoadedEmotion>>>> = OnceLock::new();
/// 推理串行锁：避免多段并发布尔推理把 CPU 打满
static INFER_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
/// 下载串行锁：避免重复下载同一批文件
static DOWNLOAD_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();

fn model_slot() -> &'static Mutex<Option<Arc<LoadedEmotion>>> {
    MODEL.get_or_init(|| Mutex::new(None))
}

fn infer_lock() -> &'static tokio::sync::Mutex<()> {
    INFER_LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

fn download_lock() -> &'static tokio::sync::Mutex<()> {
    DOWNLOAD_LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

fn is_loaded() -> bool {
    model_slot()
        .lock()
        .map(|slot| slot.is_some())
        .unwrap_or(false)
}

// ------------------------------------------------------------
// 状态 / 下载
// ------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct EmotionStatus {
    pub model_dir: String,
    pub model_path: String,
    pub downloaded: bool,
    pub model_size: u64,
    pub loaded: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EmotionDownloadProgress {
    pub file: String,
    pub downloaded: u64,
    pub total: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct EmotionImportProgress {
    pub file: String,
    pub copied: u64,
    pub total: u64,
}

fn build_status() -> EmotionStatus {
    let dir = models_dir();
    let model_path = file_path("model.safetensors");
    let model_size = std::fs::metadata(&model_path).map(|m| m.len()).unwrap_or(0);
    EmotionStatus {
        model_dir: dir.to_string_lossy().to_string(),
        model_path: model_path.to_string_lossy().to_string(),
        downloaded: model_downloaded(),
        model_size,
        loaded: is_loaded(),
        error: None,
    }
}

fn build_http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .use_rustls_tls()
        .connect_timeout(std::time::Duration::from_secs(30))
        .timeout(std::time::Duration::from_secs(3600))
        .build()
        .map_err(|e| format!("构建 HTTP 客户端失败: {e}"))
}

fn emit_progress(app: &AppHandle, file: &str, downloaded: u64, total: u64) {
    let _ = app.emit(
        "emotion-download-progress",
        EmotionDownloadProgress {
            file: file.to_string(),
            downloaded,
            total,
        },
    );
}

fn emit_import_progress(app: &AppHandle, file: &str, copied: u64, total: u64) {
    let _ = app.emit(
        "emotion-import-progress",
        EmotionImportProgress {
            file: file.to_string(),
            copied,
            total,
        },
    );
}

/// 下载单个文件（流式写入 .download 临时文件，完成后原子重命名）
async fn download_file(
    app: &AppHandle,
    client: &reqwest::Client,
    name: &str,
    expected_bytes: u64,
) -> Result<(), String> {
    let dir = models_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建模型目录失败: {e}"))?;

    let dest = file_path(name);
    if file_ok(&dest) {
        log_info(&format!("{name} 已存在，跳过下载"));
        return Ok(());
    }

    let tmp = dir.join(format!("{name}.download"));
    let mut urls = vec![file_url(name)];
    urls.push(urls[0].replace("huggingface.co", "hf-mirror.com"));

    let mut last_error = String::new();
    for (index, url) in urls.iter().enumerate() {
        let _ = std::fs::remove_file(&tmp);
        log_info(&format!("下载 {name}（源 {}）: {}", index + 1, url));

        let response = match client.get(url).send().await {
            Ok(resp) if resp.status().is_success() => resp,
            Ok(resp) => {
                last_error = format!("HTTP {}", resp.status());
                log_error(&format!("{name} 下载失败: {}", last_error));
                continue;
            }
            Err(err) => {
                last_error = err.to_string();
                log_error(&format!("{name} 请求失败: {}", last_error));
                continue;
            }
        };

        let declared_total = response.content_length();
        let total = declared_total.unwrap_or(expected_bytes);
        let mut file = match std::fs::File::create(&tmp) {
            Ok(f) => f,
            Err(err) => return Err(format!("创建临时文件失败: {err}")),
        };

        let mut downloaded: u64 = 0;
        let mut last_emit = Instant::now();
        emit_progress(app, name, 0, total);
        let mut stream = response.bytes_stream();
        let mut failed: Option<String> = None;

        while let Some(chunk) = stream.next().await {
            let chunk = match chunk {
                Ok(c) => c,
                Err(err) => {
                    failed = Some(format!("下载中断: {err}"));
                    break;
                }
            };
            if let Err(err) = std::io::Write::write_all(&mut file, &chunk) {
                failed = Some(format!("写入文件失败: {err}"));
                break;
            }
            downloaded += chunk.len() as u64;
            // 控制事件频率：约每 200ms 或下载完成时上报一次
            if last_emit.elapsed().as_millis() >= 200 || downloaded == total {
                emit_progress(app, name, downloaded, total);
                last_emit = Instant::now();
            }
        }
        drop(file);

        if let Some(err) = failed {
            last_error = err;
            let _ = std::fs::remove_file(&tmp);
            continue;
        }

        // 有 Content-Length 时要求大小一致；没有时只校验非空
        if let Some(declared) = declared_total {
            if downloaded != declared {
                last_error = format!("文件大小不一致（{downloaded}/{declared}）");
                let _ = std::fs::remove_file(&tmp);
                continue;
            }
        }
        if downloaded == 0 {
            last_error = "下载内容为空".to_string();
            let _ = std::fs::remove_file(&tmp);
            continue;
        }
        if name == "model.safetensors" && downloaded < MIN_MODEL_BYTES {
            last_error = format!("权重文件过小（{downloaded} bytes）");
            let _ = std::fs::remove_file(&tmp);
            continue;
        }

        // Windows 上 rename 不能覆盖已存在的文件；先清掉旧文件
        let _ = std::fs::remove_file(&dest);
        if let Err(err) = std::fs::rename(&tmp, &dest) {
            return Err(format!("保存 {name} 失败: {err}"));
        }
        log_info(&format!("{name} 下载完成（{downloaded} bytes）"));
        emit_progress(app, name, downloaded, total.max(downloaded));
        return Ok(());
    }

    Err(format!("下载 {name} 失败: {last_error}"))
}

/// 查询本地情感模型状态
#[command]
pub fn emotion_local_status() -> EmotionStatus {
    build_status()
}

/// 下载模型文件（已存在则跳过）；进度通过 `emotion-download-progress` 事件推送
#[command]
pub async fn emotion_local_download(app: AppHandle) -> Result<EmotionStatus, String> {
    let _guard = download_lock().lock().await;
    if model_downloaded() {
        let mut status = build_status();
        status.error = None;
        return Ok(status);
    }

    let client = build_http_client()?;
    // 先小文件后大文件，便于快速失败
    let expected: [(&str, u64); 3] = [
        ("config.json", 4 * 1024),
        ("tokenizer.json", 1024 * 1024),
        ("model.safetensors", 409_189_420),
    ];
    for (name, bytes) in expected {
        download_file(&app, &client, name, bytes)
            .await
            .map_err(|e| {
                format!(
                    "{e}。可在「设置 → 情感分析」中点击「导入本地模型」，选择已下载好的模型目录"
                )
            })?;
    }

    if !model_downloaded() {
        return Err("模型文件下载不完整，请重试".to_string());
    }
    validate_model_file(&file_path("model.safetensors"))?;

    log_info("情感模型下载完成");
    Ok(build_status())
}

// ------------------------------------------------------------
// 手动导入本地模型
// ------------------------------------------------------------

/// 校验源目录中的模型文件，返回缺失/异常说明
fn validate_source_dir(dir: &Path) -> Result<(), String> {
    let missing: Vec<&str> = FILES
        .iter()
        .copied()
        .filter(|name| {
            let path = dir.join(name);
            !path.is_file()
                || std::fs::metadata(&path)
                    .map(|m| m.len() == 0)
                    .unwrap_or(true)
        })
        .collect();
    if !missing.is_empty() {
        return Err(format!(
            "所选目录缺少文件：{}。请把 config.json、tokenizer.json、model.safetensors 放在同一目录中",
            missing.join("、")
        ));
    }

    let model_path = dir.join("model.safetensors");
    let size = std::fs::metadata(&model_path).map(|m| m.len()).unwrap_or(0);
    if size < MIN_MODEL_BYTES {
        return Err(format!(
            "model.safetensors 大小异常（{:.0} MB），请确认文件下载完整（约 390 MB）",
            size as f64 / 1024.0 / 1024.0
        ));
    }
    validate_model_file(&model_path)?;
    Ok(())
}

/// 解析用户选择：既支持目录，也支持直接选中 model.safetensors
fn resolve_source_dir(path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path.trim());
    if path.as_os_str().is_empty() {
        return Err("未选择模型目录".to_string());
    }
    let dir = if path.is_file() {
        path.parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| "无法获取所选文件所在目录".to_string())?
    } else {
        path
    };
    if !dir.is_dir() {
        return Err("所选目录不存在或不可访问".to_string());
    }
    Ok(dir)
}

async fn copy_file_with_progress<F>(
    src: &Path,
    dest: &Path,
    name: &str,
    progress: F,
) -> Result<(), String>
where
    F: Fn(u64, u64),
{
    let total = std::fs::metadata(src)
        .map_err(|e| format!("读取 {name} 失败: {e}"))?
        .len();

    if let Ok(meta) = std::fs::metadata(dest) {
        if meta.is_file() && meta.len() == total {
            return Ok(());
        }
    }
    // 源文件就是目标文件（用户直接选择应用模型目录）时无需复制
    if let (Ok(src_real), Ok(dest_real)) = (std::fs::canonicalize(src), std::fs::canonicalize(dest))
    {
        if src_real == dest_real {
            return Ok(());
        }
    }

    let tmp = dest.with_file_name(format!("{name}.import"));
    let _ = std::fs::remove_file(&tmp);
    let mut reader = tokio::fs::File::open(src)
        .await
        .map_err(|e| format!("打开 {name} 失败: {e}"))?;
    let mut writer = tokio::fs::File::create(&tmp)
        .await
        .map_err(|e| format!("创建临时文件失败: {e}"))?;

    let mut buffer = vec![0u8; 1024 * 1024];
    let mut copied: u64 = 0;
    let mut last_emit = Instant::now();
    progress(0, total);
    loop {
        let read = reader
            .read(&mut buffer)
            .await
            .map_err(|e| format!("读取 {name} 失败: {e}"))?;
        if read == 0 {
            break;
        }
        writer
            .write_all(&buffer[..read])
            .await
            .map_err(|e| format!("写入 {name} 失败: {e}"))?;
        copied += read as u64;
        if last_emit.elapsed().as_millis() >= 200 || copied == total {
            progress(copied, total);
            last_emit = Instant::now();
        }
    }
    writer
        .flush()
        .await
        .map_err(|e| format!("写入 {name} 失败: {e}"))?;
    drop(writer);

    let _ = std::fs::remove_file(dest);
    std::fs::rename(&tmp, dest).map_err(|e| format!("保存 {name} 失败: {e}"))?;
    progress(copied, total.max(copied));
    Ok(())
}

/// 手动导入本地模型目录（复制到应用模型目录）；适用于 HuggingFace 下载失败的用户
#[command]
pub async fn emotion_local_import_dir(
    app: AppHandle,
    source_dir: String,
) -> Result<EmotionStatus, String> {
    let _guard = download_lock().lock().await;
    let src = resolve_source_dir(&source_dir)?;
    validate_source_dir(&src)?;

    let dest_dir = models_dir();
    if let (Ok(src_real), Ok(dest_real)) = (
        std::fs::canonicalize(&src),
        std::fs::canonicalize(&dest_dir),
    ) {
        if src_real == dest_real {
            return Ok(build_status());
        }
    }

    // 覆盖应用目录中的模型前先释放 mmap，避免 Windows 上文件被占用
    let _infer_guard = infer_lock().lock().await;
    if let Ok(mut slot) = model_slot().lock() {
        if slot.take().is_some() {
            log_info("导入模型前释放已加载的情感模型");
        }
    }
    std::fs::create_dir_all(&dest_dir).map_err(|e| format!("创建模型目录失败: {e}"))?;

    for name in FILES {
        copy_file_with_progress(
            &src.join(name),
            &dest_dir.join(name),
            name,
            |copied, total| {
                emit_import_progress(&app, name, copied, total);
            },
        )
        .await?;
    }

    if !model_downloaded() {
        return Err("导入完成但模型文件校验失败，请检查源文件是否完整".to_string());
    }
    validate_model_file(&dest_dir.join("model.safetensors"))?;
    log_info(&format!("本地情感模型导入完成: {}", src.display()));
    Ok(build_status())
}

// ------------------------------------------------------------
// 模型加载 / 推理
// ------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct LabelConfig {
    id2label: HashMap<String, String>,
}

fn label_names(dir: &Path) -> Result<Vec<String>, String> {
    let raw = std::fs::read_to_string(dir.join("config.json"))
        .map_err(|e| format!("读取 config.json 失败: {e}"))?;
    let config: LabelConfig =
        serde_json::from_str(&raw).map_err(|e| format!("解析 config.json 失败: {e}"))?;
    let mut entries: Vec<(usize, String)> = config
        .id2label
        .into_iter()
        .filter_map(|(id, label)| id.parse::<usize>().ok().map(|id| (id, label)))
        .collect();
    if entries.is_empty() {
        return Err("config.json 中缺少 id2label 标签映射".to_string());
    }
    entries.sort_by_key(|(id, _)| *id);
    Ok(entries.into_iter().map(|(_, label)| label).collect())
}

fn load_model() -> Result<Arc<LoadedEmotion>, String> {
    if let Ok(slot) = model_slot().lock() {
        if let Some(model) = slot.as_ref() {
            return Ok(model.clone());
        }
    }

    let dir = models_dir();
    if !model_downloaded() {
        return Err("本地情感模型未下载，请先在设置中下载模型".to_string());
    }

    let loaded = load_from_dir(&dir)?;
    if let Ok(mut slot) = model_slot().lock() {
        *slot = Some(loaded.clone());
    }
    Ok(loaded)
}

/// 读取 safetensors 头部，返回键名与预期文件总长度
fn safetensors_info(path: &Path) -> Result<(Vec<String>, u64), String> {
    use std::io::Read;
    let mut file = std::fs::File::open(path).map_err(|e| format!("打开模型文件失败: {e}"))?;
    let mut len_buf = [0u8; 8];
    file.read_exact(&mut len_buf)
        .map_err(|e| format!("读取模型头失败: {e}"))?;
    let len = u64::from_le_bytes(len_buf) as usize;
    if len == 0 || len > 16 * 1024 * 1024 {
        return Err("模型头长度异常，文件可能不完整".to_string());
    }
    let mut header = vec![0u8; len];
    file.read_exact(&mut header)
        .map_err(|e| format!("读取模型头失败: {e}"))?;
    let value: serde_json::Value =
        serde_json::from_slice(&header).map_err(|e| format!("解析模型头失败: {e}"))?;
    let obj = value
        .as_object()
        .ok_or_else(|| "模型头格式异常".to_string())?;

    let mut keys = Vec::new();
    let mut max_end = 0u64;
    for (key, tensor) in obj {
        if key == "__metadata__" {
            continue;
        }
        keys.push(key.clone());
        if let Some(offsets) = tensor.get("data_offsets").and_then(|v| v.as_array()) {
            if offsets.len() == 2 {
                if let Some(end) = offsets[1].as_u64() {
                    max_end = max_end.max(end);
                }
            }
        }
    }
    let expected_len = 8 + len as u64 + max_end;
    Ok((keys, expected_len))
}

fn model_key_sample(path: &Path) -> Vec<String> {
    safetensors_info(path)
        .map(|(keys, _)| keys.into_iter().take(12).collect())
        .unwrap_or_default()
}

/// 校验权重文件确实是本应用使用的情感模型（容忍 bert./roberta./model. 前缀）
fn validate_model_file(path: &Path) -> Result<(), String> {
    let (keys, expected_len) = safetensors_info(path)?;
    let actual_len = std::fs::metadata(path).map(|meta| meta.len()).unwrap_or(0);
    if actual_len < expected_len {
        return Err(format!(
            "model.safetensors 不完整（{:.0} MB，应为 {:.0} MB），请重新下载或导入完整文件",
            actual_len as f64 / 1024.0 / 1024.0,
            expected_len as f64 / 1024.0 / 1024.0
        ));
    }
    let has_embeddings = keys
        .iter()
        .any(|key| key.ends_with("embeddings.word_embeddings.weight"));
    let has_classifier = keys.iter().any(|key| key == "classifier.weight");
    if !has_embeddings || !has_classifier {
        return Err(
            "model.safetensors 不是 roberta-multilabel-28-3-classes 的权重（缺少 embeddings/classifier），请确认文件来源和完整性"
                .to_string(),
        );
    }
    Ok(())
}

/// BERT 权重可能带 `bert.` / `roberta.` / `model.` 前缀，也可能没有前缀。
/// 逐个尝试，避免依赖 `contains_tensor`（部分平台/文件上表现不一致）。
fn load_bert(
    vb: &VarBuilder,
    config: &Config,
    weights: &Path,
) -> Result<(BertModel, &'static str), String> {
    let mut errors = Vec::new();
    for prefix in ["bert", "roberta", "model", ""] {
        let candidate = if prefix.is_empty() {
            vb.clone()
        } else {
            vb.pp(prefix)
        };
        match BertModel::load(candidate, config) {
            Ok(model) => {
                log_info(&format!(
                    "BERT 权重加载成功，前缀: {}",
                    if prefix.is_empty() { "<无>" } else { prefix }
                ));
                return Ok((model, prefix));
            }
            Err(err) => errors.push(format!(
                "{}: {err}",
                if prefix.is_empty() {
                    "<无前缀>"
                } else {
                    prefix
                }
            )),
        }
    }

    let keys = model_key_sample(weights);
    let keys_hint = if keys.is_empty() {
        "（无法读取键名，文件可能不完整）".to_string()
    } else {
        keys.join(", ")
    };
    Err(format!(
        "构建 BERT 模型失败：权重前缀不匹配。{}。模型文件键示例：{}。请确认导入的是 roberta-multilabel-28-3-classes 的完整 model.safetensors",
        errors.join("；"),
        keys_hint
    ))
}

fn load_from_dir(dir: &Path) -> Result<Arc<LoadedEmotion>, String> {
    log_info("开始加载本地情感模型（首次约 1–2 秒）");
    let started = Instant::now();
    let device = Device::Cpu;

    let config_raw = std::fs::read_to_string(dir.join("config.json"))
        .map_err(|e| format!("读取 config.json 失败: {e}"))?;
    let config: Config =
        serde_json::from_str(&config_raw).map_err(|e| format!("解析模型配置失败: {e}"))?;
    let labels = label_names(dir)?;

    let tokenizer = Tokenizer::from_file(dir.join("tokenizer.json"))
        .map_err(|e| format!("加载 tokenizer 失败: {e}"))?;

    let weights = dir.join("model.safetensors");
    // 官方用法即为 mmap 加载；文件不会在推理期间被修改
    let vb = unsafe {
        VarBuilder::from_mmaped_safetensors(&[weights.clone()], DType::F32, &device)
            .map_err(|e| format!("加载模型权重失败: {e}"))?
    };

    let (bert, prefix) = load_bert(&vb, &config, &weights)?;
    let hidden = config.hidden_size;
    let num_labels = labels.len();
    let prefixed = |suffix: &str| {
        if prefix.is_empty() {
            suffix.to_string()
        } else {
            format!("{prefix}.{suffix}")
        }
    };

    // pooler 通常跟随 BERT 前缀；兼容 bert./roberta./model./无前缀
    let pooler_w = vb
        .get((hidden, hidden), &prefixed("pooler.dense.weight"))
        .or_else(|_| vb.get((hidden, hidden), "bert.pooler.dense.weight"))
        .or_else(|_| vb.get((hidden, hidden), "pooler.dense.weight"))
        .map_err(|e| format!("加载 pooler 权重失败: {e}"))?;
    let pooler_b = vb
        .get(hidden, &prefixed("pooler.dense.bias"))
        .or_else(|_| vb.get(hidden, "bert.pooler.dense.bias"))
        .or_else(|_| vb.get(hidden, "pooler.dense.bias"))
        .map_err(|e| format!("加载 pooler 偏置失败: {e}"))?;
    // 分类头通常位于顶层
    let classifier_w = vb
        .get((num_labels, hidden), "classifier.weight")
        .or_else(|_| vb.get((num_labels, hidden), &prefixed("classifier.weight")))
        .map_err(|e| format!("加载分类头权重失败: {e}"))?;
    let classifier_b = vb
        .get(num_labels, "classifier.bias")
        .or_else(|_| vb.get(num_labels, &prefixed("classifier.bias")))
        .map_err(|e| format!("加载分类头偏置失败: {e}"))?;

    let loaded = Arc::new(LoadedEmotion {
        bert,
        tokenizer,
        pooler_w,
        pooler_b,
        classifier_w,
        classifier_b,
        labels,
        device,
    });

    log_info(&format!(
        "情感模型加载完成，用时 {} ms",
        started.elapsed().as_millis()
    ));
    Ok(loaded)
}

#[derive(Debug, Clone, Serialize)]
pub struct EmotionScore {
    pub label: String,
    pub probability: f32,
}

#[derive(Debug, Clone, Serialize)]
pub struct EmotionPrediction {
    pub labels: Vec<EmotionScore>,
    pub top_label: String,
    pub top_probability: f32,
    pub tone_label: String,
    pub tone_probability: f32,
    pub tokens: usize,
    pub elapsed_ms: u64,
}

/// 把 BERT 双句输入裁剪到模型上限：优先保留当前段落，其次保留上文末尾。
/// 输入格式：`[CLS] 上文 [SEP] 当前段落 [SEP]`
fn assemble_inputs(ids: &[u32], types: &[u32]) -> Result<(Vec<u32>, Vec<u32>), String> {
    const CLS: u32 = 101;
    const SEP: u32 = 102;

    let sep = ids
        .iter()
        .position(|&id| id == SEP)
        .ok_or_else(|| "分词结果缺少 [SEP]".to_string())?;
    if ids.last() != Some(&SEP) || ids.len() < sep + 2 {
        return Err("分词结果格式异常".to_string());
    }
    let context_ids = &ids[1..sep];
    let text_ids = &ids[sep + 1..ids.len() - 1];

    let mut out_ids = Vec::with_capacity(MAX_TOKENS);
    let mut out_types = Vec::with_capacity(MAX_TOKENS);
    out_ids.push(CLS);
    out_types.push(0);

    if text_ids.len() + 3 <= MAX_TOKENS {
        // 当前段落完整保留，剩余预算给上文末尾（越靠近当前段落越重要）
        let budget = MAX_TOKENS - 3 - text_ids.len();
        let start = context_ids.len().saturating_sub(budget);
        out_ids.extend_from_slice(&context_ids[start..]);
        out_types.extend(std::iter::repeat(0).take(context_ids.len() - start));
        out_ids.push(SEP);
        out_types.push(0);
        out_ids.extend_from_slice(text_ids);
        out_types.extend(std::iter::repeat(1).take(text_ids.len()));
        out_ids.push(SEP);
        out_types.push(1);
    } else {
        // 当前段落本身超长：丢弃上文，保留当前段落开头（与常规截断策略一致）
        out_ids.push(SEP);
        out_types.push(0);
        let take = MAX_TOKENS - 3;
        let text_slice = &text_ids[..take.min(text_ids.len())];
        out_ids.extend_from_slice(text_slice);
        out_types.extend(std::iter::repeat(1).take(text_slice.len()));
        out_ids.push(SEP);
        out_types.push(1);
    }

    // type_ids 长度兜底（正常分词不会出现，防御性处理）
    if types.len() != ids.len() || out_types.len() != out_ids.len() {
        out_types = vec![0; out_ids.len()];
    }

    Ok((out_ids, out_types))
}

fn predict(model: &LoadedEmotion, text: &str, context: &str) -> Result<EmotionPrediction, String> {
    let started = Instant::now();
    // 模型始终使用「上文 + 当前段落」双句输入；没有上文时传空字符串，
    // 与模型 README 的 `"\n".join([])` 用法一致（单句编码会明显偏离训练分布）。
    let context = context.trim();
    let encoding = model
        .tokenizer
        .encode((context, text), true)
        .map_err(|e| format!("分词失败: {e}"))?;

    let raw_ids = encoding.get_ids();
    let raw_types = encoding.get_type_ids();
    if raw_ids.is_empty() {
        return Err("文本为空".to_string());
    }
    let (ids, type_ids) = assemble_inputs(raw_ids, raw_types)?;

    let input_ids = Tensor::new(ids.as_slice(), &model.device)
        .and_then(|t| t.unsqueeze(0))
        .map_err(|e| format!("构建输入张量失败: {e}"))?;
    let token_type_ids = Tensor::new(type_ids.as_slice(), &model.device)
        .and_then(|t| t.unsqueeze(0))
        .map_err(|e| format!("构建 token_type_ids 失败: {e}"))?;

    let hidden = model
        .bert
        .forward(&input_ids, &token_type_ids, None)
        .map_err(|e| format!("模型推理失败: {e}"))?;
    let cls = hidden
        .narrow(1, 0, 1)
        .and_then(|t| t.squeeze(1))
        .map_err(|e| format!("提取 [CLS] 向量失败: {e}"))?;
    let pooled = cls
        .matmul(&model.pooler_w.t().map_err(|e| e.to_string())?)
        .and_then(|t| t.broadcast_add(&model.pooler_b))
        .and_then(|t| t.tanh())
        .map_err(|e| format!("pooler 计算失败: {e}"))?;
    let logits = pooled
        .matmul(&model.classifier_w.t().map_err(|e| e.to_string())?)
        .and_then(|t| t.broadcast_add(&model.classifier_b))
        .map_err(|e| format!("分类头计算失败: {e}"))?;
    let probs = candle_nn::ops::sigmoid(&logits)
        .map_err(|e| format!("sigmoid 计算失败: {e}"))?
        .squeeze(0)
        .and_then(|t| t.to_vec1::<f32>())
        .map_err(|e| format!("读取概率失败: {e}"))?;

    let mut scores: Vec<EmotionScore> = model
        .labels
        .iter()
        .zip(probs.iter())
        .map(|(label, &probability)| EmotionScore {
            label: label.clone(),
            probability,
        })
        .collect();
    scores.sort_by(|a, b| b.probability.total_cmp(&a.probability));

    let top = scores.first().cloned().unwrap_or(EmotionScore {
        label: "neutral".to_string(),
        probability: 0.0,
    });
    let tone = scores
        .iter()
        .filter(|s| s.label.starts_with("tone_"))
        .max_by(|a, b| a.probability.total_cmp(&b.probability))
        .cloned()
        .unwrap_or(EmotionScore {
            label: "tone_neutral".to_string(),
            probability: 0.0,
        });

    Ok(EmotionPrediction {
        labels: scores,
        top_label: top.label,
        top_probability: top.probability,
        tone_label: tone.label,
        tone_probability: tone.probability,
        tokens: ids.len(),
        elapsed_ms: started.elapsed().as_millis() as u64,
    })
}

/// 对一段文本做情感分析；`context` 为上文（可空），与训练时的双句输入一致
#[command]
pub async fn emotion_local_analyze(
    text: String,
    context: Option<String>,
) -> Result<EmotionPrediction, String> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("待分析文本为空".to_string());
    }
    let context = context.unwrap_or_default();

    let _guard = infer_lock().lock().await;
    let model = tauri::async_runtime::spawn_blocking(load_model)
        .await
        .map_err(|e| format!("加载模型任务失败: {e}"))??;

    tauri::async_runtime::spawn_blocking(move || predict(&model, &text, &context))
        .await
        .map_err(|e| format!("推理任务失败: {e}"))?
}

/// 释放已加载的模型，归还内存
#[command]
pub fn emotion_local_unload() -> EmotionStatus {
    if let Ok(mut slot) = model_slot().lock() {
        if slot.take().is_some() {
            log_info("已释放本地情感模型");
        }
    }
    build_status()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_budget_keeps_current_text() {
        // [CLS] ctx(3) [SEP] text(2) [SEP]
        let ids = [101, 200, 201, 202, 102, 300, 301, 102];
        let types = [0, 0, 0, 0, 0, 1, 1, 1];
        let (out_ids, out_types) = assemble_inputs(&ids, &types).unwrap();
        assert_eq!(out_ids, ids);
        assert_eq!(out_types, types);

        // 上文很长时只保留末尾，当前段落完整保留
        let mut long_ctx = vec![101u32];
        long_ctx.extend(std::iter::repeat(200).take(400));
        long_ctx.push(102);
        long_ctx.extend_from_slice(&[300, 301, 302]);
        long_ctx.push(102);
        let long_types = vec![0u32; 402]
            .into_iter()
            .chain(std::iter::repeat(1).take(4))
            .collect::<Vec<_>>();
        let (out_ids, out_types) = assemble_inputs(&long_ctx, &long_types).unwrap();
        assert_eq!(out_ids.len(), MAX_TOKENS);
        assert_eq!(out_types.len(), MAX_TOKENS);
        assert_eq!(&out_ids[out_ids.len() - 5..], &[102, 300, 301, 302, 102]);

        // 当前段落超过预算时丢弃上文，保留当前段落前 253 个 token
        let mut huge_text = vec![101u32, 102];
        huge_text.extend(std::iter::repeat(300).take(400));
        huge_text.push(102);
        let huge_types = vec![0u32; 2]
            .into_iter()
            .chain(std::iter::repeat(1).take(401))
            .collect::<Vec<_>>();
        let (out_ids, _) = assemble_inputs(&huge_text, &huge_types).unwrap();
        assert_eq!(out_ids.len(), MAX_TOKENS);
        assert_eq!(out_ids[1], 102);
        assert_eq!(out_ids[2], 300);
        assert_eq!(out_ids[MAX_TOKENS - 1], 102);
    }

    #[test]
    fn copy_file_overwrites_and_reports_progress() {
        let dir = std::env::temp_dir().join("emotion-copy-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("src.bin");
        let dest = dir.join("dest.bin");
        std::fs::write(&dest, b"old").unwrap();
        let payload = vec![7u8; 2 * 1024 * 1024];
        std::fs::write(&src, &payload).unwrap();

        let calls = Mutex::new(Vec::<(u64, u64)>::new());
        let runtime = tokio::runtime::Runtime::new().unwrap();
        runtime
            .block_on(copy_file_with_progress(
                &src,
                &dest,
                "src.bin",
                |copied, total| {
                    calls.lock().unwrap().push((copied, total));
                },
            ))
            .unwrap();

        assert_eq!(std::fs::read(&dest).unwrap(), payload);
        let calls = calls.into_inner().unwrap();
        assert_eq!(calls.first().copied(), Some((0, payload.len() as u64)));
        assert_eq!(
            calls.last().copied(),
            Some((payload.len() as u64, payload.len() as u64))
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolve_source_accepts_file_or_dir() {
        let dir = std::env::temp_dir().join("emotion-resolve-test");
        let _ = std::fs::create_dir_all(&dir);
        let file = dir.join("model.safetensors");
        std::fs::write(&file, b"x").unwrap();
        assert_eq!(resolve_source_dir(dir.to_str().unwrap()).unwrap(), dir);
        assert_eq!(resolve_source_dir(file.to_str().unwrap()).unwrap(), dir);
        assert!(resolve_source_dir("").is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn validate_source_reports_missing_files() {
        let dir = std::env::temp_dir().join("emotion-validate-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let err = validate_source_dir(&dir).unwrap_err();
        assert!(err.contains("config.json"));
        assert!(err.contains("model.safetensors"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn write_fake_safetensors(path: &Path, header: &str) {
        use std::io::Write;
        let mut file = std::fs::File::create(path).unwrap();
        file.write_all(&(header.len() as u64).to_le_bytes())
            .unwrap();
        file.write_all(header.as_bytes()).unwrap();
    }

    #[test]
    fn model_file_validation_checks_required_keys() {
        let dir = std::env::temp_dir().join("emotion-keys-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let good = dir.join("good.safetensors");
        write_fake_safetensors(
            &good,
            r#"{"bert.embeddings.word_embeddings.weight":{},"classifier.weight":{},"classifier.bias":{}}"#,
        );
        assert!(validate_model_file(&good).is_ok());
        assert!(model_key_sample(&good)
            .iter()
            .any(|k| k.contains("word_embeddings")));

        let bad = dir.join("bad.safetensors");
        write_fake_safetensors(&bad, r#"{"foo.weight":{}}"#);
        assert!(validate_model_file(&bad).is_err());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn label_order_is_parsed_from_config() {
        let dir = std::env::temp_dir().join("emotion-label-test");
        let _ = std::fs::create_dir_all(&dir);
        std::fs::write(
            dir.join("config.json"),
            r#"{"id2label":{"0":"anger","1":"joy","2":"tone_positive"}}"#,
        )
        .unwrap();
        let labels = label_names(&dir).unwrap();
        assert_eq!(labels, vec!["anger", "joy", "tone_positive"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    #[ignore = "需要本地模型文件：EMOTION_MODEL_DIR=/path/to/model cargo test -- --ignored"]
    fn inference_matches_reference() {
        let dir = match std::env::var("EMOTION_MODEL_DIR") {
            Ok(dir) => PathBuf::from(dir),
            Err(_) => return,
        };
        validate_model_file(&dir.join("model.safetensors")).unwrap();
        let model = load_from_dir(&dir).unwrap();
        let prediction = predict(&model, "他猛地拍案而起，怒吼道：“你给我滚出去！”", "").unwrap();
        assert_eq!(prediction.labels.len(), 31);
        let anger = prediction
            .labels
            .iter()
            .find(|score| score.label == "anger")
            .unwrap();
        assert!(anger.probability > 0.9, "anger={}", anger.probability);
        assert_eq!(prediction.top_label, "anger");
    }

    #[test]
    #[ignore = "需要模型目录：EMOTION_TEST_APP_DATA=/path/to/app-data cargo test -- --ignored"]
    fn command_analyze_end_to_end() {
        let base = match std::env::var("EMOTION_TEST_APP_DATA") {
            Ok(base) => PathBuf::from(base),
            Err(_) => return,
        };
        model_manager::set_models_dir(base);
        let status = build_status();
        assert!(status.downloaded, "模型未就绪：{}", status.model_dir);
        let prediction = tauri::async_runtime::block_on(emotion_local_analyze(
            "他猛地拍案而起，怒吼道：“你给我滚出去！”".to_string(),
            None,
        ))
        .unwrap();
        assert_eq!(prediction.labels.len(), 31);
        assert_eq!(prediction.labels[0].label, "anger");
        assert!(prediction.labels[0].probability > 0.9);
        assert!(status.model_size > crate::emotion::MIN_MODEL_BYTES);
    }

    #[test]
    fn status_reports_missing_model() {
        let status = build_status();
        assert!(status.model_dir.contains(MODEL_DIR_NAME));
        assert!(!status.model_path.is_empty());
    }
}
