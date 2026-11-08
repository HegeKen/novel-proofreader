// ============================================================
// 本地 TTS（Qwen3-TTS GGUF）命令模块
//
// 架构：按需拉起一个常驻的 llama-server 子进程（加载主 GGUF + mmproj），
// 前端逐句调用 POST /tts 取回 WAV。相比每句调用 llama-tts CLI，
// 模型只加载一次，朗读延迟和内存占用都更可控。
//
// 依赖：
//   - llama-server（可自动从 llama.cpp nightly 安装，也支持 Homebrew/手动路径）
//   - 主模型 *Qwen3-TTS*.gguf（用户自行下载）
//   - 配套 mmproj-*.gguf（必需，可在此自动下载）
// ============================================================

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use futures_util::StreamExt;
use serde::Serialize;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::command;

use crate::events::{EventSink, TauriSink};
use crate::llm::model_manager;

const MMPROJ_FILENAME: &str = "mmproj-Qwen3-TTS-12Hz-1.7B-Base-Q8_0.gguf";
const MMPROJ_URL: &str = "https://huggingface.co/NANI-Nithin/Qwen3-TTS-12Hz-1.7B-Base-GGUF/resolve/main/mmproj-Qwen3-TTS-12Hz-1.7B-Base-Q8_0.gguf";
const GITHUB_RELEASES_API: &str = "https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=10";

/// 后台 llama-server 实例
struct RunningServer {
    child: Child,
    port: u16,
    model_path: PathBuf,
    mmproj_path: PathBuf,
    binary_path: PathBuf,
    log_path: PathBuf,
    started_at: Instant,
}

/// 全局服务实例（tokio Mutex：启动过程需要跨 await 持有）
static SERVER: OnceLock<tokio::sync::Mutex<Option<RunningServer>>> = OnceLock::new();
/// 最近一次错误（服务异常退出时用于界面提示）
static LAST_ERROR: OnceLock<Mutex<Option<String>>> = OnceLock::new();
/// 自动参考音色生成锁（避免并发请求重复生成）
static REFERENCE_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
/// 子进程 PID（退出时即使拿不到异步锁也能结束服务）
static SERVER_PID: AtomicU32 = AtomicU32::new(0);

fn server_slot() -> &'static tokio::sync::Mutex<Option<RunningServer>> {
    SERVER.get_or_init(|| tokio::sync::Mutex::new(None))
}

fn last_error_slot() -> &'static Mutex<Option<String>> {
    LAST_ERROR.get_or_init(|| Mutex::new(None))
}

fn reference_lock() -> &'static tokio::sync::Mutex<()> {
    REFERENCE_LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

fn set_last_error(msg: Option<String>) {
    if let Ok(mut slot) = last_error_slot().lock() {
        *slot = msg;
    }
}

fn get_last_error() -> Option<String> {
    last_error_slot().lock().ok().and_then(|g| g.clone())
}

// ------------------------------------------------------------
// 路径与自动检测
// ------------------------------------------------------------

/// 应用数据目录（models 的上一级）
#[allow(dead_code)]
fn app_dir() -> PathBuf {
    crate::paths::data_dir()
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

/// 在目录中查找 llama-server 可执行文件（最多递归 3 层）
fn find_llama_server(dir: &Path, depth: usize) -> Option<PathBuf> {
    if depth > 3 || !dir.is_dir() {
        return None;
    }
    let entries = std::fs::read_dir(dir).ok()?;
    let mut dirs = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            dirs.push(path);
            continue;
        }
        let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
        if name == "llama-server" || name == "llama-server.exe" {
            return Some(path);
        }
    }
    for sub in dirs {
        if let Some(found) = find_llama_server(&sub, depth + 1) {
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

/// 解析 llama-server 可执行文件
fn resolve_binary(configured: Option<String>) -> Result<PathBuf, String> {
    if let Some(path) = non_empty(configured) {
        if path.is_file() {
            return Ok(path);
        }
        return Err(format!("指定的 llama-server 不存在: {}", path.display()));
    }
    if let Some(path) = std::env::var_os("PROOFREADER_LLAMA_SERVER")
        .map(PathBuf::from)
        .filter(|p| p.is_file())
    {
        return Ok(path);
    }
    if let Some(found) = find_llama_server(&tools_dir(), 0) {
        return Ok(found);
    }
    if let Some(found) = find_in_path("llama-server") {
        return Ok(found);
    }
    #[cfg(target_os = "macos")]
    {
        for candidate in [
            "/opt/homebrew/bin/llama-server",
            "/usr/local/bin/llama-server",
        ] {
            let path = PathBuf::from(candidate);
            if path.is_file() {
                return Ok(path);
            }
        }
    }
    Err(
        "未找到 llama-server。可在设置中指定路径，或点击「自动安装本地朗读运行时」下载。"
            .to_string(),
    )
}

/// 判断文件是否是 Qwen3-TTS 主模型（排除 mmproj）
fn is_tts_main_model(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    name.ends_with(".gguf")
        && name.contains("qwen3-tts")
        && !name.starts_with("mmproj")
        && !name.contains("voicedesign")
}

fn is_mmproj_file(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    name.ends_with(".gguf") && name.starts_with("mmproj")
}

/// 在模型目录 / 下载目录中自动寻找 Qwen3-TTS 主模型
fn detect_main_model() -> Option<PathBuf> {
    // 只扫描应用自己的模型目录：不自动访问 ~/Downloads，
    // 否则 macOS 会反复弹出「访问下载文件夹」的 TCC 授权框。
    let roots = vec![model_manager::get_models_dir()];

    let mut candidates: Vec<PathBuf> = Vec::new();
    for root in roots {
        let Ok(entries) = std::fs::read_dir(&root) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() && is_tts_main_model(&path) {
                candidates.push(path);
            }
        }
    }
    // 优先 Q8_0 / 更大的文件（通常量化更高）
    candidates.sort_by(|a, b| {
        let a_name = a.file_name().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
        let b_name = b.file_name().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
        let a_q8 = a_name.contains("q8_0");
        let b_q8 = b_name.contains("q8_0");
        b_q8.cmp(&a_q8).then_with(|| {
            let a_size = std::fs::metadata(a).map(|m| m.len()).unwrap_or(0);
            let b_size = std::fs::metadata(b).map(|m| m.len()).unwrap_or(0);
            b_size.cmp(&a_size)
        })
    });
    candidates.into_iter().next()
}

/// 在主模型同目录、模型目录、下载目录中寻找 mmproj
fn detect_mmproj(model: Option<&Path>) -> Option<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Some(parent) = model.and_then(|p| p.parent()) {
        roots.push(parent.to_path_buf());
    }
    roots.push(model_manager::get_models_dir());

    for root in &roots {
        let Ok(entries) = std::fs::read_dir(root) else {
            continue;
        };
        let mut candidates: Vec<PathBuf> = entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.is_file() && is_mmproj_file(p))
            .collect();
        candidates.sort_by(|a, b| {
            let a_name = a.file_name().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
            let b_name = b.file_name().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
            // Qwen3-TTS 专用 mmproj 优先
            let a_qwen = a_name.contains("qwen3-tts");
            let b_qwen = b_name.contains("qwen3-tts");
            b_qwen.cmp(&a_qwen)
        });
        if let Some(found) = candidates.into_iter().next() {
            return Some(found);
        }
    }
    None
}

fn resolve_model(configured: Option<String>) -> Result<PathBuf, String> {
    if let Some(path) = non_empty(configured) {
        if path.is_file() {
            return Ok(path);
        }
        return Err(format!("模型文件不存在: {}", path.display()));
    }
    detect_main_model().ok_or_else(|| {
        "未找到 Qwen3-TTS 主模型。请选择 Qwen3-TTS-12Hz-1.7B-Base-*.gguf 文件。".to_string()
    })
}

fn resolve_mmproj(configured: Option<String>, model: &Path) -> Result<PathBuf, String> {
    if let Some(path) = non_empty(configured) {
        if path.is_file() {
            return Ok(path);
        }
        return Err(format!("mmproj 文件不存在: {}", path.display()));
    }
    detect_mmproj(Some(model)).ok_or_else(|| {
        format!(
            "缺少配套 mmproj 文件（必需）。请下载 {} 并放到模型同目录，或在设置中点击下载。",
            MMPROJ_FILENAME
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

// ------------------------------------------------------------
// 状态
// ------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct LocalTtsStatus {
    pub binary_path: Option<String>,
    pub model_path: Option<String>,
    pub mmproj_path: Option<String>,
    pub speaker_ref_path: Option<String>,
    pub server_running: bool,
    pub server_port: Option<u16>,
    pub server_model_path: Option<String>,
    pub server_started_secs: Option<u64>,
    pub models_dir: String,
    pub tools_dir: String,
    pub log_path: String,
    pub platform: String,
    pub error: Option<String>,
    pub mmproj_filename: String,
    pub mmproj_url: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct LocalTtsServerInfo {
    pub port: u16,
    pub model_path: String,
    pub mmproj_path: String,
    pub binary_path: String,
    pub started_secs: u64,
}

/// 检查子进程状态，已退出则清理并记录错误
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
        let tail = log_tail(&log_path, 3000);
        let msg = format!("llama-server 已退出（{}）。日志尾部：\n{}", status, tail);
        log_error("LocalTTS", &msg);
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
    mmproj: Option<PathBuf>,
    server: Option<&RunningServer>,
    error: Option<String>,
) -> LocalTtsStatus {
    LocalTtsStatus {
        binary_path: binary.map(|p| p.to_string_lossy().to_string()),
        model_path: model.map(|p| p.to_string_lossy().to_string()),
        mmproj_path: mmproj.map(|p| p.to_string_lossy().to_string()),
        speaker_ref_path: None,
        server_running: server.is_some(),
        server_port: server.map(|s| s.port),
        server_model_path: server.map(|s| s.model_path.to_string_lossy().to_string()),
        server_started_secs: server.map(|s| s.started_at.elapsed().as_secs()),
        models_dir: model_manager::get_models_dir().to_string_lossy().to_string(),
        tools_dir: tools_dir().to_string_lossy().to_string(),
        log_path: server
            .map(|s| s.log_path.to_string_lossy().to_string())
            .unwrap_or_else(|| logs_dir().join("llama-server.log").to_string_lossy().to_string()),
        platform: format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH),
        error,
        mmproj_filename: MMPROJ_FILENAME.to_string(),
        mmproj_url: MMPROJ_URL.to_string(),
    }
}

/// 查询本地 TTS 环境与服务状态。
/// 传入空路径时自动在模型目录 / 下载目录中查找。
#[command]
pub async fn tts_local_status(
    binary_path: Option<String>,
    model_path: Option<String>,
    mmproj_path: Option<String>,
    speaker_ref_path: Option<String>,
) -> LocalTtsStatus {
    let binary = resolve_binary(binary_path.clone()).ok();
    let model = resolve_model(model_path.clone()).ok();
    let mmproj = resolve_mmproj(mmproj_path.clone(), model.as_deref().unwrap_or(Path::new(""))).ok();

    let mut guard = server_slot().lock().await;
    reap_if_exited(&mut guard).await;
    let mut status = status_from(binary, model, mmproj, guard.as_ref(), get_last_error());
    status.speaker_ref_path = non_empty(speaker_ref_path)
        .filter(|p| p.is_file())
        .map(|p| p.to_string_lossy().to_string());
    status
}

// ------------------------------------------------------------
// 服务启停
// ------------------------------------------------------------

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
    mmproj: &Path,
    port: u16,
    gpu_layers: i32,
    context_size: u32,
) -> Result<RunningServer, String> {
    std::fs::create_dir_all(logs_dir()).map_err(|e| format!("创建日志目录失败: {}", e))?;
    let log_path = logs_dir().join("llama-server.log");
    let log = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&log_path)
        .map_err(|e| format!("创建 llama-server 日志失败: {}", e))?;
    let log_err = log
        .try_clone()
        .map_err(|e| format!("复制日志句柄失败: {}", e))?;

    let mut command = Command::new(binary);
    command
        .arg("-m")
        .arg(model)
        .arg("-mm")
        .arg(mmproj)
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string())
        .arg("-ngl")
        .arg(gpu_layers.to_string())
        .arg("-c")
        .arg(context_size.to_string())
        .arg("-np")
        .arg("1")
        .arg("--no-webui")
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_err));

    log_info(
        "LocalTTS",
        &format!(
            "启动 llama-server: {} -m {} -mm {} --port {} -ngl {} -c {}",
            binary.display(),
            model.display(),
            mmproj.display(),
            port,
            gpu_layers,
            context_size
        ),
    );

    let child = command
        .spawn()
        .map_err(|e| format!("启动 llama-server 失败: {}（{}）", e, binary.display()))?;
    SERVER_PID.store(child.id(), Ordering::SeqCst);

    Ok(RunningServer {
        child,
        port,
        model_path: model.to_path_buf(),
        mmproj_path: mmproj.to_path_buf(),
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

    // 1.8GB Q8 + 0.46GB mmproj 在机械硬盘/首次加载时可能需要较长时间
    for _ in 0..360 {
        if let Ok(Some(status)) = server.child.try_wait() {
            let tail = log_tail(&server.log_path, 3000);
            let _ = server.child.kill();
            SERVER_PID.store(0, Ordering::SeqCst);
            return Err(format!(
                "llama-server 启动后立即退出（{}）。日志尾部：\n{}",
                status, tail
            ));
        }
        if let Ok(resp) = client.get(&url).send().await {
            if resp.status().is_success() {
                log_info(
                    "LocalTTS",
                    &format!("llama-server 就绪，端口 {}，耗时 {}ms", server.port, server.started_at.elapsed().as_millis()),
                );
                return Ok(());
            }
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }

    let tail = log_tail(&server.log_path, 3000);
    let _ = server.child.kill();
    SERVER_PID.store(0, Ordering::SeqCst);
    Err(format!(
        "等待 llama-server 就绪超时（180 秒）。日志尾部：\n{}",
        tail
    ))
}

fn stop_child(server: &mut RunningServer) {
    let _ = server.child.kill();
    let _ = server.child.wait();
    SERVER_PID.store(0, Ordering::SeqCst);
}

/// 启动本地 TTS 服务（幂等：相同模型/运行时已运行时直接复用）
#[command]
pub async fn tts_local_start_server(
    binary_path: Option<String>,
    model_path: Option<String>,
    mmproj_path: Option<String>,
    gpu_layers: Option<i32>,
    context_size: Option<u32>,
) -> Result<LocalTtsServerInfo, String> {
    let binary = resolve_binary(binary_path)?;
    let model = resolve_model(model_path)?;
    let mmproj = resolve_mmproj(mmproj_path, &model)?;

    if !model.is_file() {
        return Err(format!("模型文件不存在: {}", model.display()));
    }
    if !mmproj.is_file() {
        return Err(format!("mmproj 文件不存在: {}", mmproj.display()));
    }

    set_last_error(None);
    let mut guard = server_slot().lock().await;
    reap_if_exited(&mut guard).await;

    if let Some(existing) = guard.as_ref() {
        if existing.model_path == model && existing.mmproj_path == mmproj && existing.binary_path == binary {
            return Ok(LocalTtsServerInfo {
                port: existing.port,
                model_path: existing.model_path.to_string_lossy().to_string(),
                mmproj_path: existing.mmproj_path.to_string_lossy().to_string(),
                binary_path: existing.binary_path.to_string_lossy().to_string(),
                started_secs: existing.started_at.elapsed().as_secs(),
            });
        }
    }

    if let Some(mut old) = guard.take() {
        log_info("LocalTTS", "模型或运行时已变化，重启 llama-server");
        stop_child(&mut old);
    }

    let port = free_port()?;
    let mut server = spawn_server(
        &binary,
        &model,
        &mmproj,
        port,
        gpu_layers.unwrap_or(-1),
        context_size.unwrap_or(8192),
    )?;

    if let Err(e) = wait_until_ready(&mut server).await {
        stop_child(&mut server);
        set_last_error(Some(e.clone()));
        return Err(e);
    }

    let info = LocalTtsServerInfo {
        port: server.port,
        model_path: server.model_path.to_string_lossy().to_string(),
        mmproj_path: server.mmproj_path.to_string_lossy().to_string(),
        binary_path: server.binary_path.to_string_lossy().to_string(),
        started_secs: 0,
    };
    *guard = Some(server);
    Ok(info)
}

/// 停止本地 TTS 服务
#[command]
pub async fn tts_local_stop_server() -> Result<(), String> {
    let mut guard = server_slot().lock().await;
    if let Some(mut server) = guard.take() {
        log_info("LocalTTS", "停止 llama-server");
        stop_child(&mut server);
    }
    Ok(())
}

/// 应用退出时同步结束子进程，避免残留 llama-server
pub fn shutdown() {
    // 即使异步锁被正在加载的服务占用，也先按 PID 结束子进程
    let pid = SERVER_PID.swap(0, Ordering::SeqCst);
    if pid != 0 {
        log_info("LocalTTS", "应用退出，停止 llama-server");
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

// ------------------------------------------------------------
// 语音合成
// ------------------------------------------------------------

fn read_file_base64(path: &Path) -> Result<String, String> {
    let meta = std::fs::metadata(path).map_err(|e| format!("读取参考音频信息失败: {}", e))?;
    if meta.len() > 25 * 1024 * 1024 {
        return Err("参考音频过大（上限 25MB）".to_string());
    }
    let bytes = std::fs::read(path).map_err(|e| format!("读取参考音频失败: {}", e))?;
    Ok(BASE64.encode(bytes))
}

/// 调用 /tts 并校验返回的是 WAV
async fn post_tts(
    client: &reqwest::Client,
    port: u16,
    body: &serde_json::Map<String, serde_json::Value>,
) -> Result<Vec<u8>, String> {
    let url = format!("http://127.0.0.1:{}/tts", port);
    let resp = client
        .post(&url)
        .json(body)
        .send()
        .await
        .map_err(|e| format!("请求本地朗读服务失败: {}", e))?;

    let status = resp.status();
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("读取本地朗读音频失败: {}", e))?;

    if !status.is_success() {
        let text = String::from_utf8_lossy(&bytes);
        let msg = format!(
            "本地朗读失败（HTTP {}）：{}",
            status,
            text.chars().take(800).collect::<String>()
        );
        set_last_error(Some(msg.clone()));
        return Err(msg);
    }
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" {
        let text = String::from_utf8_lossy(&bytes);
        return Err(format!(
            "本地朗读未返回 WAV 音频：{}",
            text.chars().take(800).collect::<String>()
        ));
    }
    Ok(bytes.to_vec())
}

fn lang_for_reference(body: &serde_json::Map<String, serde_json::Value>) -> String {
    body.get("lang")
        .and_then(|v| v.as_str())
        .unwrap_or("zh")
        .to_string()
}

/// 自动生成默认参考音频并落盘；失败时返回 None（不阻塞朗读）
async fn ensure_default_reference(
    client: &reqwest::Client,
    port: u16,
    lang: String,
) -> Option<PathBuf> {
    let dir = app_dir().join("tts");
    let lang_tag = if lang.starts_with("zh") { "zh" } else { "en" };
    let path = dir.join(format!("voice-reference-{}.wav", lang_tag));
    if std::fs::metadata(&path).map(|m| m.len() > 10_000).unwrap_or(false) {
        return Some(path);
    }

    let _guard = reference_lock().lock().await;
    if std::fs::metadata(&path).map(|m| m.len() > 10_000).unwrap_or(false) {
        return Some(path);
    }

    let (text, req_lang) = if lang_tag == "zh" {
        (
            "这是一段用于固定音色的参考音频，请保持自然、清晰、平稳的语调。",
            "zh",
        )
    } else {
        (
            "This is a reference recording used to keep the voice consistent. Please speak naturally and clearly.",
            "en",
        )
    };

    let mut body = serde_json::Map::new();
    body.insert("input".to_string(), serde_json::Value::String(text.to_string()));
    body.insert("lang".to_string(), serde_json::Value::String(req_lang.to_string()));
    body.insert(
        "response_format".to_string(),
        serde_json::Value::String("wav".to_string()),
    );
    body.insert("n_predict".to_string(), serde_json::json!(320));
    body.insert("repeat_penalty".to_string(), serde_json::json!(1.05));
    body.insert("seed".to_string(), serde_json::json!(42));

    match post_tts(client, port, &body).await {
        Ok(bytes) => {
            if let Err(e) = std::fs::create_dir_all(&dir) {
                log_error("LocalTTS", &format!("创建参考音色目录失败: {}", e));
                return None;
            }
            match std::fs::write(&path, &bytes) {
                Ok(()) => {
                    log_info(
                        "LocalTTS",
                        &format!("已生成默认参考音色: {}（{} KB）", path.display(), bytes.len() / 1024),
                    );
                    Some(path)
                }
                Err(e) => {
                    log_error("LocalTTS", &format!("保存参考音色失败: {}", e));
                    None
                }
            }
        }
        Err(e) => {
            log_error("LocalTTS", &format!("生成默认参考音色失败，将不带参考朗读: {}", e));
            None
        }
    }
}

/// 调用常驻 llama-server 的 /tts 生成语音，返回 base64 WAV。
#[command]
pub async fn tts_local_synthesize(
    input: String,
    lang: Option<String>,
    speaker_ref_path: Option<String>,
    n_predict: Option<u32>,
    top_k: Option<i32>,
    top_p: Option<f32>,
    repeat_penalty: Option<f32>,
    seed: Option<i64>,
) -> Result<String, String> {
    let text = input.trim();
    if text.is_empty() {
        return Err("待合成文本为空".to_string());
    }

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
                    .unwrap_or("qwen3-tts")
                    .to_string(),
            ),
            None => {
                return Err(
                    "本地朗读服务未启动，请先点击「启动服务」或重试朗读。".to_string(),
                )
            }
        }
    };

    let mut body = serde_json::Map::new();
    body.insert("input".to_string(), serde_json::Value::String(text.to_string()));
    body.insert(
        "lang".to_string(),
        serde_json::Value::String(lang.unwrap_or_else(|| "zh".to_string())),
    );
    body.insert(
        "response_format".to_string(),
        serde_json::Value::String("wav".to_string()),
    );
    // 12Hz 音频帧：按字数预估上限，避免长句被服务端默认 512 帧截断
    let frame_budget = if let Some(n) = n_predict {
        n
    } else {
        let chars = text.chars().count() as u32;
        (chars * 2 + 96).clamp(256, 1536)
    };
    body.insert("n_predict".to_string(), serde_json::json!(frame_budget));
    if let Some(k) = top_k {
        body.insert("top_k".to_string(), serde_json::json!(k));
    }
    if let Some(p) = top_p {
        body.insert("top_p".to_string(), serde_json::json!(p));
    }
    if let Some(rp) = repeat_penalty {
        body.insert("repeat_penalty".to_string(), serde_json::json!(rp));
    }
    if let Some(s) = seed {
        body.insert("seed".to_string(), serde_json::json!(s));
    }
    if let Some(path) = non_empty(speaker_ref_path) {
        if path.is_file() {
            body.insert(
                "speaker_ref_b64".to_string(),
                serde_json::Value::String(read_file_base64(&path)?),
            );
        } else {
            return Err(format!("参考音频不存在: {}", path.display()));
        }
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| format!("创建请求客户端失败: {}", e))?;
    let started = Instant::now();

    // 未提供参考音频时，首次朗读自动生成并保存一段固定参考音色，
    // 避免逐句随机换声（Qwen3-TTS Base 无参考时音色不稳定）。
    if !body.contains_key("speaker_ref_b64") {
        if let Some(reference) = ensure_default_reference(&client, port, lang_for_reference(&body)).await {
            if let Ok(b64) = read_file_base64(&reference) {
                body.insert("speaker_ref_b64".to_string(), serde_json::Value::String(b64));
            }
        }
    }

    let bytes = post_tts(&client, port, &body).await?;

    set_last_error(None);
    log_info(
        "LocalTTS",
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
// mmproj / llama-server 运行时下载
// ------------------------------------------------------------

async fn fetch_release_asset(
    client: &reqwest::Client,
) -> Result<(String, String), String> {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    let suffix = "bin-macos-arm64.tar.gz";
    #[cfg(all(target_os = "macos", not(target_arch = "aarch64")))]
    let suffix = "bin-macos-x64.tar.gz";
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    let suffix = "bin-ubuntu-arm64.tar.gz";
    #[cfg(all(target_os = "linux", not(target_arch = "aarch64")))]
    let suffix = "bin-ubuntu-x64.tar.gz";
    #[cfg(all(target_os = "windows", target_arch = "aarch64"))]
    let suffix = "bin-win-cpu-arm64.zip";
    #[cfg(all(target_os = "windows", not(target_arch = "aarch64")))]
    let suffix = "bin-win-cpu-x64.zip";
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    let suffix = "bin-ubuntu-x64.tar.gz";

    let resp = client
        .get(GITHUB_RELEASES_API)
        .header("User-Agent", "novel-proofreader")
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("获取 llama.cpp 版本列表失败: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("获取 llama.cpp 版本列表失败: HTTP {}", resp.status()));
    }
    let releases: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("解析 llama.cpp 版本列表失败: {}", e))?;
    let list = releases
        .as_array()
        .ok_or_else(|| "llama.cpp 版本列表格式异常".to_string())?;

    for release in list {
        let tag = release["tag_name"].as_str().unwrap_or("");
        let Some(assets) = release["assets"].as_array() else {
            continue;
        };
        for asset in assets {
            let name = asset["name"].as_str().unwrap_or("");
            let Some(url) = asset["browser_download_url"].as_str() else {
                continue;
            };
            if name.starts_with("llama-") && name.ends_with(suffix) {
                return Ok((tag.to_string(), url.to_string()));
            }
        }
    }
    Err(format!(
        "未在 llama.cpp 最近版本中找到当前平台的运行时（{}）",
        suffix
    ))
}

/// 流式下载（支持断点续传），progress 回调 (已下载, 总大小)
pub(crate) async fn download_file(
    client: &reqwest::Client,
    urls: &[String],
    dest: &Path,
    on_progress: &(dyn Fn(u64, u64) + Send + Sync),
) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建下载目录失败: {}", e))?;
    }
    let tmp = dest.with_extension(format!(
        "{}download",
        dest.extension()
            .and_then(|s| s.to_str())
            .map(|s| format!("{}.", s))
            .unwrap_or_default()
    ));

    let mut last_err = String::new();
    for url in urls {
        let mut existing = std::fs::metadata(&tmp).map(|m| m.len()).unwrap_or(0);
        let mut request = client.get(url);
        if existing > 0 {
            request = request.header("Range", format!("bytes={}-", existing));
        }
        let resp = match request.send().await {
            Ok(r) => r,
            Err(e) => {
                last_err = format!("下载请求失败: {}", e);
                continue;
            }
        };
        if !resp.status().is_success() && resp.status().as_u16() != 206 {
            last_err = format!("下载失败: HTTP {}", resp.status());
            continue;
        }

        let mut file = if existing > 0 && resp.status().as_u16() == 206 {
            std::fs::OpenOptions::new()
                .append(true)
                .open(&tmp)
                .map_err(|e| format!("打开临时文件失败: {}", e))?
        } else {
            existing = 0;
            std::fs::File::create(&tmp).map_err(|e| format!("创建临时文件失败: {}", e))?
        };

        let total = existing + resp.content_length().unwrap_or(0);
        let mut downloaded = existing;
        on_progress(downloaded, total);
        let mut stream = resp.bytes_stream();
        let mut last_emit = Instant::now();

        while let Some(chunk) = stream.next().await {
            let chunk = match chunk {
                Ok(c) => c,
                Err(e) => {
                    last_err = format!("下载中断: {}", e);
                    break;
                }
            };
            if let Err(e) = file.write_all(&chunk) {
                return Err(format!("写入下载文件失败: {}", e));
            }
            downloaded += chunk.len() as u64;
            if last_emit.elapsed() >= Duration::from_millis(300) {
                on_progress(downloaded, total);
                last_emit = Instant::now();
            }
        }
        let _ = file.flush();
        drop(file);

        if total > 0 && downloaded < total {
            let reason = if last_err.is_empty() { "连接提前结束".to_string() } else { last_err.clone() };
            last_err = format!(
                "下载不完整（{}/{} 字节，{}），可重试续传",
                downloaded, total, reason
            );
            continue;
        }
        if downloaded == 0 {
            last_err = "下载内容为空".to_string();
            continue;
        }

        on_progress(downloaded, downloaded.max(total));
        std::fs::rename(&tmp, dest).map_err(|e| format!("保存下载文件失败: {}", e))?;
        return Ok(());
    }

    Err(if last_err.is_empty() {
        "下载失败".to_string()
    } else {
        last_err
    })
}

/// 下载配套 mmproj 到模型目录（自动尝试 HuggingFace 镜像）
#[command]
pub async fn tts_local_download_mmproj(app: tauri::AppHandle) -> Result<String, String> {
    download_mmproj(&TauriSink::new(app)).await
}

/// 服务层实现：下载 mmproj（Web 与桌面共用）
pub async fn download_mmproj(sink: &dyn EventSink) -> Result<String, String> {
    let dir = model_manager::ensure_models_dir()?;
    let dest = dir.join(MMPROJ_FILENAME);
    if dest.is_file() {
        return Ok(dest.to_string_lossy().to_string());
    }

    log_info("LocalTTS", &format!("开始下载 mmproj: {}", MMPROJ_URL));
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(1800))
        .build()
        .map_err(|e| format!("创建下载客户端失败: {}", e))?;
    let mirror = MMPROJ_URL.replace("https://huggingface.co", "https://hf-mirror.com");
    let urls = vec![MMPROJ_URL.to_string(), mirror];
    download_file(&client, &urls, &dest, &|downloaded, total| {
        let _ = sink.emit(
            "tts-local-download-progress",
            serde_json::json!({ "kind": "mmproj", "downloaded": downloaded, "total": total }),
        );
    })
    .await?;

    let size_mb = std::fs::metadata(&dest).map(|m| m.len() / 1024 / 1024).unwrap_or(0);
    log_info("LocalTTS", &format!("mmproj 下载完成: {} ({} MB)", dest.display(), size_mb));
    Ok(dest.to_string_lossy().to_string())
}

/// 自动下载并解压 llama-server 运行时（llama.cpp nightly）
#[command]
#[cfg_attr(target_os = "android", allow(unreachable_code))]
pub async fn tts_local_install_runtime(app: tauri::AppHandle) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        let _ = app;
        return Err("Android 端暂不支持本地 Qwen3-TTS 朗读，请使用桌面版".to_string());
    }
    install_runtime(&TauriSink::new(app)).await
}

/// 服务层实现：安装 llama-server 运行时（Web 与桌面共用）
pub async fn install_runtime(sink: &dyn EventSink) -> Result<String, String> {
    if let Some(found) = find_llama_server(&tools_dir(), 0) {
        return Ok(found.to_string_lossy().to_string());
    }

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(1800))
        .build()
        .map_err(|e| format!("创建下载客户端失败: {}", e))?;
    let (tag, url) = fetch_release_asset(&client).await?;
    log_info("LocalTTS", &format!("下载 llama.cpp {}: {}", tag, url));

    let runtimes = tools_dir().join("runtimes");
    let archive = runtimes.join(format!("llama-{}-download", tag));
    download_file(&client, &[url], &archive, &|downloaded, total| {
        let _ = sink.emit(
            "tts-local-download-progress",
            serde_json::json!({ "kind": "runtime", "downloaded": downloaded, "total": total }),
        );
    })
    .await?;

    let target_dir = runtimes.join(format!("llama-{}", tag));
    std::fs::create_dir_all(&target_dir).map_err(|e| format!("创建运行时目录失败: {}", e))?;
    let status = Command::new("tar")
        .arg("-xf")
        .arg(&archive)
        .arg("-C")
        .arg(&target_dir)
        .status()
        .map_err(|e| format!("解压运行时失败（需要系统 tar）: {}", e))?;
    if !status.success() {
        return Err(format!("解压运行时失败: tar 退出码 {:?}", status.code()));
    }
    let _ = std::fs::remove_file(&archive);

    let binary = find_llama_server(&target_dir, 0)
        .ok_or_else(|| format!("解压完成但未找到 llama-server（{}）", target_dir.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(&binary) {
            let mut perms = meta.permissions();
            perms.set_mode(perms.mode() | 0o755);
            let _ = std::fs::set_permissions(&binary, perms);
        }
    }
    log_info("LocalTTS", &format!("运行时安装完成: {}", binary.display()));
    Ok(binary.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mmproj_and_main_detection() {
        assert!(is_tts_main_model(Path::new(
            "/tmp/Qwen3-TTS-12Hz-1.7B-Base-Q8_0.gguf"
        )));
        assert!(!is_tts_main_model(Path::new("/tmp/mmproj-Qwen3-TTS-Q8_0.gguf")));
        assert!(is_mmproj_file(Path::new("/tmp/mmproj-Qwen3-TTS-Q8_0.gguf")));
        assert!(!is_mmproj_file(Path::new("/tmp/Qwen3-TTS-12Hz-1.7B-Base-Q8_0.gguf")));
    }

    #[test]
    fn free_port_returns_bindable_port() {
        let port = free_port().unwrap();
        assert!(port > 0);
    }

    /// 端到端验证：需要本机已下载 Qwen3-TTS 主模型 + mmproj，并安装 llama-server。
    /// 运行：cargo test local_tts_e2e -- --ignored --nocapture
    #[tokio::test]
    #[ignore = "需要本机模型、mmproj 与 llama-server"]
    async fn local_tts_e2e() {
        let model = std::env::var("LOCAL_TTS_MODEL").ok();
        let mmproj = std::env::var("LOCAL_TTS_MMPROJ").ok();
        let info = tts_local_start_server(None, model, mmproj, Some(-1), Some(8192))
            .await
            .expect("启动本地朗读服务失败");
        assert!(info.port > 0);

        let wav_b64 = tts_local_synthesize(
            "这是一个本地语音朗读端到端测试。".to_string(),
            Some("zh".to_string()),
            None,
            Some(256),
            None,
            None,
            Some(1.05),
            Some(42),
        )
        .await
        .expect("本地语音合成失败");
        let wav = BASE64.decode(wav_b64).expect("base64 解码失败");
        assert_eq!(&wav[0..4], b"RIFF");
        assert!(wav.len() > 10_000);

        tts_local_stop_server().await.expect("停止服务失败");
    }
}
