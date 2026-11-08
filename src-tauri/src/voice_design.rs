// ============================================================
// 本地 TTS：Qwen3-TTS VoiceDesign（CrispASR 后端）
//
// VoiceDesign 用量产的自然语言「音色描述」代替参考音频：
//   crispasr --server --backend qwen3-tts-1.7b-voicedesign \
//     -m <talker.gguf> --codec-model <tokenizer.gguf> --port <port>
// 前端逐句 POST /v1/audio/speech，请求体里的 instructions 即音色描述。
//
// 与 Base 模式的区别：
//   - 运行时是 CrispASR（不是 llama-server）
//   - 需要 talker GGUF + 独立的 tokenizer/codec GGUF
//   - 不需要参考音频，音色由文字描述控制
// ============================================================

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::command;

use crate::events::{EventSink, TauriSink};
use crate::llm::model_manager;
use crate::local_tts::download_file;

const TALKER_Q8_FILENAME: &str = "qwen3-tts-12hz-1.7b-voicedesign-q8_0.gguf";
const TALKER_Q8_URL: &str = "https://huggingface.co/cstr/qwen3-tts-1.7b-voicedesign-GGUF/resolve/main/qwen3-tts-12hz-1.7b-voicedesign-q8_0.gguf";
const CODEC_FILENAME: &str = "qwen3-tts-tokenizer-12hz.gguf";
const CODEC_URL: &str = "https://huggingface.co/cstr/qwen3-tts-tokenizer-12hz-GGUF/resolve/main/qwen3-tts-tokenizer-12hz.gguf";
const GITHUB_RELEASES_API: &str = "https://api.github.com/repos/CrispStrobe/CrispASR/releases/latest";
const BACKEND_NAME: &str = "qwen3-tts-1.7b-voicedesign";

struct RunningServer {
    child: Child,
    port: u16,
    model_path: PathBuf,
    codec_path: PathBuf,
    binary_path: PathBuf,
    log_path: PathBuf,
    started_at: Instant,
}

static SERVER: OnceLock<tokio::sync::Mutex<Option<RunningServer>>> = OnceLock::new();
static SERVER_PID: AtomicU32 = AtomicU32::new(0);
static LAST_ERROR: OnceLock<Mutex<Option<String>>> = OnceLock::new();

fn server_slot() -> &'static tokio::sync::Mutex<Option<RunningServer>> {
    SERVER.get_or_init(|| tokio::sync::Mutex::new(None))
}

fn last_error_slot() -> &'static Mutex<Option<String>> {
    LAST_ERROR.get_or_init(|| Mutex::new(None))
}

fn set_last_error(msg: Option<String>) {
    if let Ok(mut slot) = last_error_slot().lock() {
        *slot = msg;
    }
}

fn get_last_error() -> Option<String> {
    last_error_slot().lock().ok().and_then(|g| g.clone())
}

fn tools_dir() -> PathBuf {
    crate::paths::tools_dir()
}

fn logs_dir() -> PathBuf {
    crate::paths::logs_dir()
}

fn log_info(tag: &str, msg: &str) {
    println!("[{}] {}", tag, msg);
}

fn log_error(tag: &str, msg: &str) {
    eprintln!("[{} ERROR] {}", tag, msg);
}

fn non_empty(value: Option<String>) -> Option<PathBuf> {
    value
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
}

fn find_binary_named(dir: &Path, name: &str, depth: usize) -> Option<PathBuf> {
    if depth > 4 || !dir.is_dir() {
        return None;
    }
    let entries = std::fs::read_dir(dir).ok()?;
    let mut subdirs = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            subdirs.push(path);
            continue;
        }
        let filename = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
        if filename == name || filename == format!("{}.exe", name) {
            return Some(path);
        }
    }
    for sub in subdirs {
        if let Some(found) = find_binary_named(&sub, name, depth + 1) {
            return Some(found);
        }
    }
    None
}

fn find_in_path(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        for candidate in [name.to_string(), format!("{}.exe", name)] {
            let path = dir.join(candidate);
            if path.is_file() {
                return Some(path);
            }
        }
    }
    None
}

fn resolve_binary(configured: Option<String>) -> Result<PathBuf, String> {
    if let Some(path) = non_empty(configured) {
        if path.is_file() {
            return Ok(path);
        }
        return Err(format!("指定的 crispasr 不存在: {}", path.display()));
    }
    if let Some(path) = std::env::var_os("CRISPASR_BIN")
        .map(PathBuf::from)
        .filter(|p| p.is_file())
    {
        return Ok(path);
    }
    if let Some(found) = find_binary_named(&tools_dir(), "crispasr", 0) {
        return Ok(found);
    }
    if let Some(found) = find_in_path("crispasr") {
        return Ok(found);
    }
    #[cfg(target_os = "macos")]
    {
        for candidate in ["/opt/homebrew/bin/crispasr", "/usr/local/bin/crispasr"] {
            let path = PathBuf::from(candidate);
            if path.is_file() {
                return Ok(path);
            }
        }
    }
    Err(
        "未找到 crispasr。可在设置中指定路径，或点击「自动安装 CrispASR 运行时」。"
            .to_string(),
    )
}

fn is_talker_file(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    name.ends_with(".gguf") && name.contains("voicedesign")
}

fn is_codec_file(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    name.ends_with(".gguf")
        && (name.contains("tokenizer") || name.contains("codec"))
        && name.contains("12hz")
}

fn search_roots(model: Option<&Path>) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Some(parent) = model.and_then(|p| p.parent()) {
        roots.push(parent.to_path_buf());
    }
    let models = model_manager::get_models_dir();
    roots.push(models.join("qwen3-tts-voicedesign"));
    roots.push(models);
    // 不自动扫描 ~/Downloads：避免 macOS 反复请求下载目录权限
    let mut seen = std::collections::HashSet::new();
    roots.into_iter().filter(|p| seen.insert(p.clone())).collect()
}

fn detect_talker(configured: Option<String>) -> Option<PathBuf> {
    if let Some(path) = non_empty(configured) {
        if path.is_file() {
            return Some(path);
        }
    }
    let mut candidates = Vec::new();
    for root in search_roots(None) {
        let Ok(entries) = std::fs::read_dir(&root) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() && is_talker_file(&path) {
                candidates.push(path);
            }
        }
    }
    candidates.sort_by(|a, b| {
        let a_name = a.file_name().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
        let b_name = b.file_name().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
        let a_q8 = a_name.contains("q8_0");
        let b_q8 = b_name.contains("q8_0");
        let a_f16 = a_name.contains("f16");
        let b_f16 = b_name.contains("f16");
        b_q8.cmp(&a_q8).then_with(|| b_f16.cmp(&a_f16)).then_with(|| {
            let a_size = std::fs::metadata(a).map(|m| m.len()).unwrap_or(0);
            let b_size = std::fs::metadata(b).map(|m| m.len()).unwrap_or(0);
            b_size.cmp(&a_size)
        })
    });
    candidates.into_iter().next()
}

fn detect_codec(configured: Option<String>, model: Option<&Path>) -> Option<PathBuf> {
    if let Some(path) = non_empty(configured) {
        if path.is_file() {
            return Some(path);
        }
    }
    let mut candidates = Vec::new();
    for root in search_roots(model) {
        let Ok(entries) = std::fs::read_dir(&root) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() && is_codec_file(&path) {
                candidates.push(path);
            }
        }
    }
    candidates.sort_by(|a, b| {
        let a_name = a.file_name().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
        let b_name = b.file_name().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
        // tokenizer 指定文件优先，其次非 q8 的 F16 版本
        let a_exact = a_name == CODEC_FILENAME;
        let b_exact = b_name == CODEC_FILENAME;
        b_exact.cmp(&a_exact).then_with(|| {
            let a_q8 = a_name.contains("q8_0");
            let b_q8 = b_name.contains("q8_0");
            a_q8.cmp(&b_q8)
        })
    });
    candidates.into_iter().next()
}

fn resolve_talker(configured: Option<String>) -> Result<PathBuf, String> {
    if let Some(path) = non_empty(configured) {
        if path.is_file() {
            return Ok(path);
        }
        return Err(format!("talker 模型不存在: {}", path.display()));
    }
    detect_talker(None)
        .ok_or_else(|| "未找到 VoiceDesign talker GGUF（文件名需包含 voicedesign）".to_string())
}

fn resolve_codec(configured: Option<String>, model: Option<&Path>) -> Result<PathBuf, String> {
    if let Some(path) = non_empty(configured) {
        if path.is_file() {
            return Ok(path);
        }
        return Err(format!("tokenizer/codec 模型不存在: {}", path.display()));
    }
    detect_codec(None, model).ok_or_else(|| {
        format!(
            "未找到配套 tokenizer/codec GGUF。请下载 {} 并放到模型同目录。",
            CODEC_FILENAME
        )
    })
}

fn log_tail(path: &Path, max_chars: usize) -> String {
    let text = std::fs::read_to_string(path).unwrap_or_default();
    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= max_chars {
        text
    } else {
        chars[chars.len() - max_chars..].iter().collect()
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct VoiceDesignStatus {
    pub binary_path: Option<String>,
    pub model_path: Option<String>,
    pub codec_path: Option<String>,
    pub server_running: bool,
    pub server_port: Option<u16>,
    pub server_model_path: Option<String>,
    pub models_dir: String,
    pub tools_dir: String,
    pub log_path: String,
    pub platform: String,
    pub error: Option<String>,
    pub talker_filename: String,
    pub codec_filename: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct VoiceDesignServerInfo {
    pub port: u16,
    pub model_path: String,
    pub codec_path: String,
    pub binary_path: String,
    pub started_secs: u64,
}

async fn reap_if_exited(guard: &mut Option<RunningServer>) {
    let exited = match guard.as_mut() {
        Some(server) => match server.child.try_wait() {
            Ok(Some(status)) => Some((status.to_string(), server.log_path.clone())),
            Ok(None) => None,
            Err(e) => Some((format!("检查进程失败: {}", e), server.log_path.clone())),
        },
        None => None,
    };
    if let Some((status, log_path)) = exited {
        let tail = log_tail(&log_path, 4000);
        let msg = format!("crispasr 已退出（{}）。日志尾部：\n{}", status, tail);
        log_error("VoiceDesign", &msg);
        if let Some(mut server) = guard.take() {
            let _ = server.child.kill();
            let _ = server.child.wait();
            SERVER_PID.store(0, Ordering::SeqCst);
        }
        set_last_error(Some(msg));
    }
}

fn status_from(
    binary: Option<PathBuf>,
    model: Option<PathBuf>,
    codec: Option<PathBuf>,
    server: Option<&RunningServer>,
    error: Option<String>,
) -> VoiceDesignStatus {
    VoiceDesignStatus {
        binary_path: binary.map(|p| p.to_string_lossy().to_string()),
        model_path: model.map(|p| p.to_string_lossy().to_string()),
        codec_path: codec.map(|p| p.to_string_lossy().to_string()),
        server_running: server.is_some(),
        server_port: server.map(|s| s.port),
        server_model_path: server.map(|s| s.model_path.to_string_lossy().to_string()),
        models_dir: model_manager::get_models_dir().to_string_lossy().to_string(),
        tools_dir: tools_dir().to_string_lossy().to_string(),
        log_path: server
            .map(|s| s.log_path.to_string_lossy().to_string())
            .unwrap_or_else(|| logs_dir().join("crispasr.log").to_string_lossy().to_string()),
        platform: format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH),
        error,
        talker_filename: TALKER_Q8_FILENAME.to_string(),
        codec_filename: CODEC_FILENAME.to_string(),
    }
}

/// 查询 VoiceDesign 本地环境与服务状态
#[command]
pub async fn tts_voice_design_status(
    binary_path: Option<String>,
    model_path: Option<String>,
    codec_path: Option<String>,
) -> VoiceDesignStatus {
    let binary = resolve_binary(binary_path.clone()).ok();
    let model = detect_talker(model_path.clone());
    let codec = detect_codec(codec_path.clone(), model.as_deref());

    let mut guard = server_slot().lock().await;
    reap_if_exited(&mut guard).await;
    status_from(binary, model, codec, guard.as_ref(), get_last_error())
}

fn free_port() -> Result<u16, String> {
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0))
        .map_err(|e| format!("分配本地端口失败: {}", e))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("读取本地端口失败: {}", e))?
        .port();
    drop(listener);
    Ok(port)
}

fn spawn_server(
    binary: &Path,
    model: &Path,
    codec: &Path,
    port: u16,
) -> Result<RunningServer, String> {
    std::fs::create_dir_all(logs_dir()).map_err(|e| format!("创建日志目录失败: {}", e))?;
    let log_path = logs_dir().join("crispasr.log");
    let log = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&log_path)
        .map_err(|e| format!("创建 crispasr 日志失败: {}", e))?;
    let log_err = log
        .try_clone()
        .map_err(|e| format!("复制日志句柄失败: {}", e))?;

    let mut command = Command::new(binary);
    command
        .arg("--server")
        .arg("--backend")
        .arg(BACKEND_NAME)
        .arg("-m")
        .arg(model)
        .arg("--codec-model")
        .arg(codec)
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_err));
    if let Some(dir) = binary.parent() {
        command.current_dir(dir);
    }

    log_info(
        "VoiceDesign",
        &format!(
            "启动 crispasr: {} --server --backend {} -m {} --codec-model {} --port {}",
            binary.display(),
            BACKEND_NAME,
            model.display(),
            codec.display(),
            port
        ),
    );

    let child = command
        .spawn()
        .map_err(|e| format!("启动 crispasr 失败: {}（{}）", e, binary.display()))?;
    SERVER_PID.store(child.id(), Ordering::SeqCst);

    Ok(RunningServer {
        child,
        port,
        model_path: model.to_path_buf(),
        codec_path: codec.to_path_buf(),
        binary_path: binary.to_path_buf(),
        log_path,
        started_at: Instant::now(),
    })
}

async fn wait_until_ready(server: &mut RunningServer) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(2))
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|e| format!("创建健康检查客户端失败: {}", e))?;
    let url = format!("http://127.0.0.1:{}/health", server.port);

    for _ in 0..360 {
        if let Ok(Some(status)) = server.child.try_wait() {
            let tail = log_tail(&server.log_path, 4000);
            let _ = server.child.kill();
            SERVER_PID.store(0, Ordering::SeqCst);
            return Err(format!(
                "crispasr 启动后立即退出（{}）。日志尾部：\n{}",
                status, tail
            ));
        }
        if let Ok(resp) = client.get(&url).send().await {
            if resp.status().is_success() {
                log_info(
                    "VoiceDesign",
                    &format!(
                        "crispasr 就绪，端口 {}，耗时 {}ms",
                        server.port,
                        server.started_at.elapsed().as_millis()
                    ),
                );
                return Ok(());
            }
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }

    let tail = log_tail(&server.log_path, 4000);
    let _ = server.child.kill();
    SERVER_PID.store(0, Ordering::SeqCst);
    Err(format!(
        "等待 crispasr 就绪超时（180 秒）。日志尾部：\n{}",
        tail
    ))
}

fn stop_child(server: &mut RunningServer) {
    let _ = server.child.kill();
    let _ = server.child.wait();
    SERVER_PID.store(0, Ordering::SeqCst);
}

/// 启动 VoiceDesign 本地服务（相同模型/运行时复用）
#[command]
pub async fn tts_voice_design_start_server(
    binary_path: Option<String>,
    model_path: Option<String>,
    codec_path: Option<String>,
) -> Result<VoiceDesignServerInfo, String> {
    let binary = resolve_binary(binary_path)?;
    let model = resolve_talker(model_path)?;
    let codec = resolve_codec(codec_path, Some(&model))?;

    set_last_error(None);
    let mut guard = server_slot().lock().await;
    reap_if_exited(&mut guard).await;

    if let Some(existing) = guard.as_ref() {
        if existing.model_path == model
            && existing.codec_path == codec
            && existing.binary_path == binary
        {
            return Ok(VoiceDesignServerInfo {
                port: existing.port,
                model_path: existing.model_path.to_string_lossy().to_string(),
                codec_path: existing.codec_path.to_string_lossy().to_string(),
                binary_path: existing.binary_path.to_string_lossy().to_string(),
                started_secs: existing.started_at.elapsed().as_secs(),
            });
        }
    }

    if let Some(mut old) = guard.take() {
        log_info("VoiceDesign", "模型或运行时已变化，重启 crispasr");
        stop_child(&mut old);
    }

    let port = free_port()?;
    let mut server = spawn_server(&binary, &model, &codec, port)?;
    if let Err(e) = wait_until_ready(&mut server).await {
        stop_child(&mut server);
        set_last_error(Some(e.clone()));
        return Err(e);
    }

    let info = VoiceDesignServerInfo {
        port: server.port,
        model_path: server.model_path.to_string_lossy().to_string(),
        codec_path: server.codec_path.to_string_lossy().to_string(),
        binary_path: server.binary_path.to_string_lossy().to_string(),
        started_secs: 0,
    };
    *guard = Some(server);
    Ok(info)
}

#[command]
pub async fn tts_voice_design_stop_server() -> Result<(), String> {
    let mut guard = server_slot().lock().await;
    if let Some(mut server) = guard.take() {
        log_info("VoiceDesign", "停止 crispasr");
        stop_child(&mut server);
    }
    Ok(())
}

/// 应用退出时结束 crispasr
pub fn shutdown() {
    let pid = SERVER_PID.swap(0, Ordering::SeqCst);
    if pid != 0 {
        log_info("VoiceDesign", "应用退出，停止 crispasr");
        #[cfg(unix)]
        unsafe {
            libc::kill(pid as i32, libc::SIGTERM);
        }
        #[cfg(windows)]
        {
            let _ = Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/F"])
                .status();
        }
    }
    if let Ok(mut guard) = server_slot().try_lock() {
        guard.take();
    }
}

/// 调用 CrispASR /v1/audio/speech 生成语音，返回 base64 WAV
#[command]
pub async fn tts_voice_design_synthesize(
    input: String,
    instructions: Option<String>,
    language: Option<String>,
    seed: Option<i64>,
) -> Result<String, String> {
    let text = input.trim();
    if text.is_empty() {
        return Err("待合成文本为空".to_string());
    }
    let instruct = instructions
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "VoiceDesign 需要音色描述（instructions）".to_string())?;

    let (port, model_name) = {
        let mut guard = server_slot().lock().await;
        reap_if_exited(&mut guard).await;
        match guard.as_ref() {
            Some(server) => (
                server.port,
                server
                    .model_path
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or("qwen3-tts-voicedesign")
                    .to_string(),
            ),
            None => {
                return Err(
                    "VoiceDesign 本地朗读服务未启动，请先点击「启动服务」或重试朗读。"
                        .to_string(),
                )
            }
        }
    };

    let mut body = serde_json::Map::new();
    body.insert("input".to_string(), serde_json::Value::String(text.to_string()));
    body.insert(
        "instructions".to_string(),
        serde_json::Value::String(instruct),
    );
    body.insert(
        "response_format".to_string(),
        serde_json::Value::String("wav".to_string()),
    );
    if let Some(lang) = language.filter(|s| !s.is_empty()) {
        body.insert("language".to_string(), serde_json::Value::String(lang));
    }
    body.insert(
        "seed".to_string(),
        serde_json::json!(seed.unwrap_or(42)),
    );

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| format!("创建请求客户端失败: {}", e))?;
    let url = format!("http://127.0.0.1:{}/v1/audio/speech", port);
    let started = Instant::now();

    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("请求 VoiceDesign 服务失败: {}", e))?;
    let status = resp.status();
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("读取 VoiceDesign 音频失败: {}", e))?;

    if !status.is_success() {
        let text = String::from_utf8_lossy(&bytes);
        let msg = format!(
            "VoiceDesign 合成失败（HTTP {}）：{}",
            status,
            text.chars().take(800).collect::<String>()
        );
        set_last_error(Some(msg.clone()));
        return Err(msg);
    }
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" {
        let text = String::from_utf8_lossy(&bytes);
        return Err(format!(
            "VoiceDesign 未返回 WAV 音频：{}",
            text.chars().take(800).collect::<String>()
        ));
    }

    set_last_error(None);
    log_info(
        "VoiceDesign",
        &format!(
            "合成完成: {} 字 -> {} KB，耗时 {}ms，模型 {}",
            text.chars().count(),
            bytes.len() / 1024,
            started.elapsed().as_millis(),
            model_name
        ),
    );
    Ok(BASE64.encode(bytes))
}

// ------------------------------------------------------------
// 模型 / 运行时下载
// ------------------------------------------------------------

/// 下载 VoiceDesign 的 talker 或 codec（kind = "talker" | "codec"）
#[command]
pub async fn tts_voice_design_download_model(
    app: tauri::AppHandle,
    kind: String,
) -> Result<String, String> {
    download_model(&TauriSink::new(app), kind).await
}

/// 服务层实现：下载 VoiceDesign 模型（Web 与桌面共用）
pub async fn download_model(sink: &dyn EventSink, kind: String) -> Result<String, String> {
    let dir = model_manager::ensure_models_dir()?.join("qwen3-tts-voicedesign");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建模型目录失败: {}", e))?;

    let (filename, url, progress_kind) = match kind.as_str() {
        "talker" => (TALKER_Q8_FILENAME, TALKER_Q8_URL, "vd-talker"),
        "codec" => (CODEC_FILENAME, CODEC_URL, "vd-codec"),
        _ => return Err(format!("未知的下载类型: {}", kind)),
    };
    let dest = dir.join(filename);
    if dest.is_file() {
        return Ok(dest.to_string_lossy().to_string());
    }

    log_info("VoiceDesign", &format!("开始下载 {}: {}", filename, url));
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(3600))
        .build()
        .map_err(|e| format!("创建下载客户端失败: {}", e))?;
    let mirror = url.replace("https://huggingface.co", "https://hf-mirror.com");
    let urls = vec![url.to_string(), mirror];
    download_file(&client, &urls, &dest, &|downloaded, total| {
        let _ = sink.emit(
            "tts-voice-design-download-progress",
            serde_json::json!({ "kind": progress_kind, "downloaded": downloaded, "total": total }),
        );
    })
    .await?;

    let size_mb = std::fs::metadata(&dest).map(|m| m.len() / 1024 / 1024).unwrap_or(0);
    log_info("VoiceDesign", &format!("下载完成: {} ({} MB)", dest.display(), size_mb));
    Ok(dest.to_string_lossy().to_string())
}

fn release_asset_suffix() -> &'static str {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        "crispasr-macos-arm64.tar.gz"
    }
    #[cfg(all(target_os = "macos", not(target_arch = "aarch64")))]
    {
        "crispasr-macos-x86_64.tar.gz"
    }
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    {
        "crispasr-linux-arm64.tar.gz"
    }
    #[cfg(all(target_os = "linux", not(target_arch = "aarch64")))]
    {
        "crispasr-linux-x86_64.tar.gz"
    }
    #[cfg(all(target_os = "windows", target_arch = "aarch64"))]
    {
        "crispasr-windows-x86_64-cpu.zip"
    }
    #[cfg(all(target_os = "windows", not(target_arch = "aarch64")))]
    {
        "crispasr-windows-x86_64-cpu.zip"
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        "crispasr-linux-x86_64.tar.gz"
    }
}

/// 自动下载并解压 CrispASR 运行时
#[command]
#[cfg_attr(target_os = "android", allow(unreachable_code))]
pub async fn tts_voice_design_install_runtime(app: tauri::AppHandle) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        let _ = app;
        return Err("Android 端暂不支持 VoiceDesign 本地朗读，请使用桌面版".to_string());
    }
    install_runtime(&TauriSink::new(app)).await
}

/// 服务层实现：安装 CrispASR 运行时（Web 与桌面共用）
pub async fn install_runtime(sink: &dyn EventSink) -> Result<String, String> {
    if let Some(found) = find_binary_named(&tools_dir(), "crispasr", 0) {
        return Ok(found.to_string_lossy().to_string());
    }

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(1800))
        .build()
        .map_err(|e| format!("创建下载客户端失败: {}", e))?;
    let resp = client
        .get(GITHUB_RELEASES_API)
        .header("User-Agent", "novel-proofreader")
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("获取 CrispASR 版本失败: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("获取 CrispASR 版本失败: HTTP {}", resp.status()));
    }
    let release: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("解析 CrispASR 版本失败: {}", e))?;
    let tag = release["tag_name"].as_str().unwrap_or("latest").to_string();
    let suffix = release_asset_suffix();
    let asset = release["assets"]
        .as_array()
        .and_then(|assets| {
            assets.iter().find_map(|asset| {
                let name = asset["name"].as_str().unwrap_or("");
                if name == suffix {
                    asset["browser_download_url"].as_str().map(|u| u.to_string())
                } else {
                    None
                }
            })
        })
        .ok_or_else(|| format!("CrispASR release 中未找到当前平台资产（{}）", suffix))?;

    log_info("VoiceDesign", &format!("下载 CrispASR {}: {}", tag, asset));
    let runtimes = tools_dir().join("runtimes");
    let archive = runtimes.join(format!("crispasr-{}-download", tag));
    download_file(&client, &[asset], &archive, &|downloaded, total| {
        let _ = sink.emit(
            "tts-voice-design-download-progress",
            serde_json::json!({ "kind": "crispasr", "downloaded": downloaded, "total": total }),
        );
    })
    .await?;

    let target_dir = runtimes.join(format!("crispasr-{}", tag));
    std::fs::create_dir_all(&target_dir).map_err(|e| format!("创建运行时目录失败: {}", e))?;
    let status = Command::new("tar")
        .arg("-xf")
        .arg(&archive)
        .arg("-C")
        .arg(&target_dir)
        .status()
        .map_err(|e| format!("解压 CrispASR 失败（需要系统 tar）: {}", e))?;
    if !status.success() {
        return Err(format!("解压 CrispASR 失败: tar 退出码 {:?}", status.code()));
    }
    let _ = std::fs::remove_file(&archive);

    let binary = find_binary_named(&target_dir, "crispasr", 0)
        .ok_or_else(|| format!("解压完成但未找到 crispasr（{}）", target_dir.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(&binary) {
            let mut perms = meta.permissions();
            perms.set_mode(perms.mode() | 0o755);
            let _ = std::fs::set_permissions(&binary, perms);
        }
    }
    log_info("VoiceDesign", &format!("CrispASR 安装完成: {}", binary.display()));
    Ok(binary.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_detection() {
        assert!(is_talker_file(Path::new(
            "/tmp/qwen3-tts-12hz-1.7b-voicedesign-f16.gguf"
        )));
        assert!(!is_talker_file(Path::new(
            "/tmp/Qwen3-TTS-12Hz-1.7B-Base-Q8_0.gguf"
        )));
        assert!(is_codec_file(Path::new("/tmp/qwen3-tts-tokenizer-12hz.gguf")));
        assert!(!is_codec_file(Path::new(
            "/tmp/mmproj-Qwen3-TTS-12Hz-1.7B-Base-Q8_0.gguf"
        )));
    }

    #[test]
    fn release_suffix_is_nonempty() {
        assert!(!release_asset_suffix().is_empty());
    }

    /// 端到端验证：需要本机 talker + tokenizer/codec + crispasr。
    /// 运行：cargo test voice_design_e2e -- --ignored --nocapture
    #[tokio::test]
    #[ignore = "需要本机 VoiceDesign 模型、codec 与 crispasr"]
    async fn voice_design_e2e() {
        let info = tts_voice_design_start_server(None, None, None)
            .await
            .expect("启动 VoiceDesign 服务失败");
        assert!(info.port > 0);

        let wav_b64 = tts_voice_design_synthesize(
            "这是一段 VoiceDesign 本地语音合成测试。".to_string(),
            Some("温暖、清晰、平稳的叙述声音，语速适中。".to_string()),
            Some("zh".to_string()),
            Some(42),
        )
        .await
        .expect("VoiceDesign 合成失败");
        let wav = BASE64.decode(wav_b64).expect("base64 解码失败");
        assert_eq!(&wav[0..4], b"RIFF");
        assert!(wav.len() > 10_000);

        tts_voice_design_stop_server().await.expect("停止服务失败");
    }
}
