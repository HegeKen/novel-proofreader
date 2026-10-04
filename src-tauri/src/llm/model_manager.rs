// ============================================================
// 本地模型管理器：模型下载、校验、路径管理
// ============================================================
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::OnceLock;

/// 打印日志到控制台（Android 上可通过 logcat 查看）
fn log_info(tag: &str, msg: &str) {
    println!("[{}] {}", tag, msg);
}

fn log_error(tag: &str, msg: &str) {
    eprintln!("[{} ERROR] {}", tag, msg);
}

fn log_warn(msg: &str) {
    eprintln!("[Download WARN] {}", msg);
}

/// 递归格式化错误链，便于定位 reqwest/hyper 底层失败原因
fn format_error_chain(e: &dyn std::error::Error) -> String {
    let mut parts = vec![e.to_string()];
    let mut source = e.source();
    while let Some(s) = source {
        parts.push(format!("caused by: {}", s));
        source = s.source();
    }
    parts.join(" | ")
}

/// 构建全局复用的 reqwest 客户端
/// - 显式启用 rustls（纯 Rust TLS，不依赖系统 OpenSSL）
/// - 设置超时，避免 Android 上无限等待
fn build_http_client() -> Result<reqwest::Client, reqwest::Error> {
    reqwest::Client::builder()
        .use_rustls_tls()
        .connect_timeout(std::time::Duration::from_secs(30))
        .timeout(std::time::Duration::from_secs(600))
        .build()
}

/// 模型目录覆盖（由 Tauri app setup 初始化，确保 Android 使用正确的 app_data_dir）
static MODELS_DIR_OVERRIDE: OnceLock<PathBuf> = OnceLock::new();

/// 设置模型存储根目录（应在应用启动时调用一次）
pub fn set_models_dir(base: PathBuf) {
    let dir = base.join("novel-proofreader").join("models");
    log_info("ModelManager", &format!("设置模型目录: {}", dir.display()));
    let _ = MODELS_DIR_OVERRIDE.set(dir);
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub filename: String,
    pub url: String,
    pub size_mb: u64,
    pub sha256: String,
    pub description: String,
    pub recommended: bool,
}

/// 预置模型列表
pub fn get_preset_models() -> Vec<ModelInfo> {
    vec![
        ModelInfo {
            id: "qwen2.5-1.5b-q8_0".to_string(),
            name: "Qwen 2.5 1.5B (Q8_0)".to_string(),
            filename: "qwen2.5-1.5b-instruct-q8_0.gguf".to_string(),
            url: "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q8_0.gguf".to_string(),
            size_mb: 1024,
            sha256: "".to_string(),
            description: "轻量快速，适合简单错别字检测".to_string(),
            recommended: true,
        },
        ModelInfo {
            id: "qwen2.5-7b-instruct-q3_k_m".to_string(),
            name: "Qwen 2.5 7B (Q3_K_M)".to_string(),
            filename: "qwen2.5-7b-instruct-q3_k_m.gguf".to_string(),
            url: "https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/main/qwen2.5-7b-instruct-q3_k_m.gguf".to_string(),
            size_mb: 4100,
            sha256: "".to_string(),
            description: "中文校对首选，平衡性能与精度".to_string(),
            recommended: false,
        },
        ModelInfo {
            id: "chinese-text-correction-1.5b-q4_k_m".to_string(),
            name: "Chinese Text Correction 1.5B (Q4_K_M)".to_string(),
            filename: "chinese-text-correction-1.5b.Q4_K_M.gguf".to_string(),
            url: "https://huggingface.co/QuantFactory/chinese-text-correction-1.5b-GGUF/resolve/main/chinese-text-correction-1.5b.Q4_K_M.gguf".to_string(),
            size_mb: 1100,
            sha256: "".to_string(),
            description: "中文文本纠错专用模型，擅长语法和语义纠错".to_string(),
            recommended: true,
        },
        ModelInfo {
            id: "qwen3.8-4b-distill-q6_k".to_string(),
            name: "Qwen3.8 4B Distill (Q6_K)".to_string(),
            filename: "Qwen3.8-4B-Q6_K.gguf".to_string(),
            url: "https://huggingface.co/empero-ai/Qwen3.8-4B-Distill-GGUF/resolve/main/Qwen3.8-4B-Q6_K.gguf".to_string(),
            size_mb: 4200,
            sha256: "".to_string(),
            description: "Qwen3.8 蒸馏版 4B 模型，通用能力强，适合综合校对".to_string(),
            recommended: false,
        },
    ]
}

/// 获取模型存储目录
/// 优先使用 Tauri app_data_dir（Android 上正确），否则回退到 dirs::data_dir（桌面端）
pub fn get_models_dir() -> PathBuf {
    MODELS_DIR_OVERRIDE
        .get()
        .cloned()
        .unwrap_or_else(|| {
            let base = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
            base.join("novel-proofreader").join("models")
        })
}

/// 检查模型是否已下载
pub fn is_model_downloaded(model: &ModelInfo) -> bool {
    let path = get_models_dir().join(&model.filename);
    if !path.exists() {
        return false;
    }

    // 若配置了 SHA256 则校验
    if !model.sha256.is_empty() {
        if let Ok(hash) = compute_sha256(&path) {
            return hash == model.sha256;
        }
        return false;
    }

    true
}

/// 获取已下载的模型路径
pub fn get_model_path(model: &ModelInfo) -> Option<PathBuf> {
    let path = get_models_dir().join(&model.filename);
    if path.exists() {
        Some(path)
    } else {
        None
    }
}

/// 计算文件 SHA256
fn compute_sha256(path: &PathBuf) -> Result<String, std::io::Error> {
    use sha2::{Sha256, Digest};
    use std::io::Read;

    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 8192];
    loop {
        let n = file.read(&mut buffer)?;
        if n == 0 { break; }
        hasher.update(&buffer[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// 确保模型目录存在
pub fn ensure_models_dir() -> Result<PathBuf, String> {
    let dir = get_models_dir();
    log_info("ModelManager", &format!("确保模型目录存在: {}", dir.display()));
    if let Err(e) = std::fs::create_dir_all(&dir) {
        log_error("ModelManager", &format!("创建模型目录失败: {} (路径: {})", e, dir.display()));
        return Err(format!("创建模型目录失败: {}", e));
    }
    log_info("ModelManager", "模型目录已就绪");
    Ok(dir)
}

/// 获取所有已下载的模型
pub fn get_downloaded_models() -> Vec<ModelInfo> {
    get_preset_models()
        .into_iter()
        .filter(|m| is_model_downloaded(m))
        .collect()
}

/// 扫描模型目录中所有 .gguf 文件，返回可用模型列表（含预置 + 用户导入）
pub fn scan_available_models() -> Vec<ModelInfo> {
    let dir = get_models_dir();
    let presets: Vec<ModelInfo> = get_preset_models();
    let mut models: Vec<ModelInfo> = Vec::new();

    // 先加入已下载的预置模型
    for p in &presets {
        if is_model_downloaded(p) {
            models.push(p.clone());
        }
    }

    // 扫描目录中所有 .gguf 文件，将非预置的文件作为用户导入模型
    let preset_filenames: std::collections::HashSet<&str> =
        presets.iter().map(|m| m.filename.as_str()).collect();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(filename) = path.file_name().and_then(|s| s.to_str()) {
                if filename.ends_with(".gguf") && !preset_filenames.contains(filename) {
                    // 忽略临时下载文件
                    if filename.ends_with(".download") {
                        continue;
                    }
                    let size_mb = match std::fs::metadata(&path) {
                        Ok(meta) => meta.len() / 1024 / 1024,
                        Err(_) => 0,
                    };
                    models.push(ModelInfo {
                        id: format!("user-imported-{}", filename),
                        name: filename.replace(".gguf", "").replace('_', " "),
                        filename: filename.to_string(),
                        url: String::new(),
                        size_mb,
                        sha256: String::new(),
                        description: "用户导入模型".to_string(),
                        recommended: false,
                    });
                }
            }
        }
    }

    models
}

/// 导入外部 GGUF 模型文件到模型目录
pub fn import_model(src_path: &std::path::Path) -> Result<ModelInfo, String> {
    log_info("Import", &format!("开始导入模型: {}", src_path.display()));

    if !src_path.exists() {
        log_error("Import", &format!("源文件不存在: {}", src_path.display()));
        return Err("源文件不存在".to_string());
    }
    let filename = src_path
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or("无效的文件路径")?;
    log_info("Import", &format!("文件名: {}", filename));
    if !filename.ends_with(".gguf") {
        log_error("Import", &format!("文件格式不支持: {}", filename));
        return Err("仅支持导入 .gguf 格式的模型文件".to_string());
    }

    let dir = ensure_models_dir()?;
    let dest = dir.join(filename);
    // 若已存在同名文件则重命名（加数字后缀）
    let final_dest = if dest.exists() {
        let stem = std::path::Path::new(filename)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("model");
        let ext = ".gguf";
        let mut i = 1;
        loop {
            let alt = dir.join(format!("{}_{}{}", stem, i, ext));
            if !alt.exists() {
                break alt;
            }
            i += 1;
            if i > 999 {
                log_error("Import", "文件名冲突过多");
                return Err("文件名冲突过多".to_string());
            }
        }
    } else {
        dest
    };

    log_info("Import", &format!("复制到: {}", final_dest.display()));
    if let Err(e) = std::fs::copy(src_path, &final_dest) {
        log_error("Import", &format!("复制模型文件失败: {} ({} -> {})", e, src_path.display(), final_dest.display()));
        return Err(format!("复制模型文件失败: {}", e));
    }

    let size_mb = match std::fs::metadata(&final_dest) {
        Ok(meta) => meta.len() / 1024 / 1024,
        Err(_) => 0,
    };
    let final_filename = final_dest
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(filename)
        .to_string();

    log_info("Import", &format!("导入成功: {} ({} MB)", final_filename, size_mb));

    Ok(ModelInfo {
        id: format!("user-imported-{}", final_filename),
        name: final_filename.replace(".gguf", "").replace('_', " "),
        filename: final_filename,
        url: String::new(),
        size_mb,
        sha256: String::new(),
        description: "用户导入模型".to_string(),
        recommended: false,
    })
}

/// 按 id 查找可用模型（优先预置列表，再扫描目录）
pub fn find_model_by_id(model_id: &str) -> Option<ModelInfo> {
    get_preset_models()
        .into_iter()
        .find(|m| m.id == model_id)
        .or_else(|| scan_available_models().into_iter().find(|m| m.id == model_id))
}

/// 获取模型文件的完整路径（支持预置和用户导入）
pub fn get_model_path_by_id(model_id: &str) -> Option<PathBuf> {
    if let Some(m) = find_model_by_id(model_id) {
        get_model_path(&m)
    } else {
        None
    }
}

/// 下载进度回调
pub type ProgressFn = dyn Fn(u64, u64) + Send + Sync;

/// 尝试下载指定 URL 的内容到 tmp_path，返回 HTTP 响应
/// 供 download_model 内部使用，支持多 URL 重试
async fn download_from_url(
    client: &reqwest::Client,
    url: &str,
    tmp_path: &std::path::Path,
    expected_size: u64,
    progress: &ProgressFn,
) -> Result<u64, String> {
    use futures_util::StreamExt;

    log_info("Download", &format!("尝试下载 URL: {}", url));
    let resp = match client.get(url).send().await {
        Ok(r) => {
            log_info("Download", &format!("HTTP 响应状态: {}", r.status()));
            r
        }
        Err(e) => {
            log_error("Download", &format!("请求失败: {} (URL: {})", format_error_chain(&e), url));
            return Err(format!("下载请求失败: {}", e));
        }
    };
    if !resp.status().is_success() {
        log_error("Download", &format!("下载失败: HTTP {} (URL: {})", resp.status(), url));
        return Err(format!("下载失败: HTTP {}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(expected_size);
    log_info("Download", &format!("文件总大小: {} bytes", total));

    let mut file = match std::fs::File::create(tmp_path) {
        Ok(f) => f,
        Err(e) => {
            log_error("Download", &format!("创建临时文件失败: {} (路径: {})", e, tmp_path.display()));
            return Err(format!("创建临时文件失败: {}", e));
        }
    };
    let mut downloaded: u64 = 0;
    let mut stream = resp.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = match chunk {
            Ok(c) => c,
            Err(e) => {
                log_error("Download", &format!("下载中断: {}", format_error_chain(&e)));
                return Err(format!("下载中断: {}", e));
            }
        };
        if let Err(e) = std::io::Write::write_all(&mut file, &chunk) {
            log_error("Download", &format!("写入文件失败: {} (已下载: {} bytes)", e, downloaded));
            return Err(format!("写入文件失败: {}", e));
        }
        downloaded += chunk.len() as u64;
        progress(downloaded, total);
    }
    drop(file);
    log_info("Download", &format!("下载完成，共 {} bytes", downloaded));
    Ok(downloaded)
}

/// 下载模型到模型目录（流式写入，progress 回调 (已下载字节, 总字节)）
/// 支持 HuggingFace 镜像站回退：主站失败时自动尝试 hf-mirror.com
pub async fn download_model(model: &ModelInfo, progress: &ProgressFn) -> Result<PathBuf, String> {
    log_info("Download", &format!("开始下载模型: {} -> {}", model.name, model.url));

    let dir = ensure_models_dir()?;
    let final_path = dir.join(&model.filename);
    // 下载到临时文件，完成后原子重命名，避免半成品被误认为已下载
    let tmp_path = dir.join(format!("{}.download", model.filename));

    log_info("Download", &format!("临时文件路径: {}", tmp_path.display()));

    let client = match build_http_client() {
        Ok(c) => c,
        Err(e) => {
            log_error("Download", &format!("构建 HTTP 客户端失败: {}", format_error_chain(&e)));
            return Err(format!("构建 HTTP 客户端失败: {}", e));
        }
    };

    // 构建候选 URL 列表：主 URL + 镜像回退
    let mut urls = vec![model.url.clone()];
    if model.url.contains("huggingface.co") {
        let mirror_url = model.url.replace("huggingface.co", "hf-mirror.com");
        urls.push(mirror_url);
    }

    let expected_size = model.size_mb * 1024 * 1024;
    let mut last_error = String::new();

    for url in &urls {
        // 清理上次失败的临时文件
        let _ = std::fs::remove_file(&tmp_path);

        match download_from_url(&client, url, &tmp_path, expected_size, progress).await {
            Ok(downloaded) => {
                // 完整性校验：配置 SHA256 时校验，否则至少校验文件非空
                if !model.sha256.is_empty() {
                    log_info("Download", "校验 SHA256...");
                    let hash = match compute_sha256(&tmp_path) {
                        Ok(h) => h,
                        Err(e) => {
                            log_error("Download", &format!("校验失败: {}", e));
                            last_error = format!("校验失败: {}", e);
                            continue;
                        }
                    };
                    if hash != model.sha256 {
                        let _ = std::fs::remove_file(&tmp_path);
                        log_error("Download", "SHA256 校验不匹配");
                        last_error = "模型文件校验失败（SHA256 不匹配）".to_string();
                        continue;
                    }
                    log_info("Download", "SHA256 校验通过");
                } else if downloaded == 0 {
                    let _ = std::fs::remove_file(&tmp_path);
                    log_error("Download", "下载内容为空");
                    last_error = "下载内容为空".to_string();
                    continue;
                }

                if let Err(e) = std::fs::rename(&tmp_path, &final_path) {
                    log_error("Download", &format!("保存模型文件失败: {} ({} -> {})", e, tmp_path.display(), final_path.display()));
                    return Err(format!("保存模型文件失败: {}", e));
                }
                log_info("Download", &format!("模型已保存: {}", final_path.display()));
                return Ok(final_path);
            }
            Err(e) => {
                last_error = e.clone();
                log_warn(&format!("该 URL 下载失败，尝试下一个候选 URL（如有）: {}", e));
                continue;
            }
        }
    }

    // 所有 URL 均失败
    let _ = std::fs::remove_file(&tmp_path);
    log_error("Download", &format!("所有下载源均失败，最后错误: {}", last_error));
    Err(format!("下载失败: {}", last_error))
}

/// 删除已下载的模型文件
pub fn delete_model(model: &ModelInfo) -> Result<(), String> {
    let path = get_models_dir().join(&model.filename);
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("删除模型失败: {}", e))?;
    }
    // 同时清理可能残留的临时下载文件
    let tmp = get_models_dir().join(format!("{}.download", model.filename));
    if tmp.exists() {
        let _ = std::fs::remove_file(&tmp);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_model_path_generation() {
        let dir = get_models_dir();
        assert!(dir.to_string_lossy().contains("novel-proofreader"));
        assert!(dir.to_string_lossy().contains("models"));
    }

    #[test]
    fn test_preset_models_not_empty() {
        let models = get_preset_models();
        assert!(!models.is_empty());
        for m in &models {
            assert!(!m.id.is_empty());
            assert!(m.filename.ends_with(".gguf"));
            assert!(m.url.starts_with("https://"));
            assert!(m.size_mb > 0);
        }
    }

    #[test]
    fn test_preset_model_ids_unique() {
        let models = get_preset_models();
        let mut ids: Vec<&str> = models.iter().map(|m| m.id.as_str()).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), models.len(), "预置模型 id 必须唯一");
    }

    #[test]
    fn test_undownloaded_model_not_detected() {
        let ghost = ModelInfo {
            id: "ghost".to_string(),
            name: "不存在的模型".to_string(),
            filename: "__ghost_model_never_exists__.gguf".to_string(),
            url: "https://example.com/x.gguf".to_string(),
            size_mb: 1,
            sha256: String::new(),
            description: String::new(),
            recommended: false,
        };
        assert!(!is_model_downloaded(&ghost));
        assert!(get_model_path(&ghost).is_none());
    }
}
