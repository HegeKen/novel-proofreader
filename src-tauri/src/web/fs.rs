// ============================================================
// Web 端文件浏览 API：只允许访问 PROOFREADER_NOVELS_DIRS 内路径
//
// 所有路径先 canonicalize 再做前缀校验，防止 ../ 越权与符号链接逃逸。
// ============================================================

use crate::web::config;
use axum::extract::Query;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
struct RootEntry {
    name: String,
    path: String,
}

#[derive(Debug, Clone, Serialize)]
struct FileEntry {
    name: String,
    path: String,
    #[serde(rename = "isDir")]
    is_dir: bool,
    size: u64,
}

/// 解析可用根目录（canonicalize 后去重）
/// 包含用户配置的小说目录与应用数据目录（后者用于导入本地模型文件）
fn allowed_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    let mut candidates = config::novels_dirs();
    candidates.push(crate::paths::data_dir());
    for dir in candidates {
        if let Ok(real) = std::fs::canonicalize(&dir) {
            if real.is_dir() && !roots.contains(&real) {
                roots.push(real);
            }
        }
    }
    roots
}

/// 校验请求路径落在允许根目录内，返回真实路径
fn ensure_allowed(raw: &str) -> Result<PathBuf, String> {
    if raw.trim().is_empty() {
        return Err("缺少 path 参数".to_string());
    }
    let real = std::fs::canonicalize(raw).map_err(|e| format!("路径不可访问: {}（{}）", raw, e))?;
    let roots = allowed_roots();
    if roots.is_empty() {
        return Err("未配置可访问的小说目录（PROOFREADER_NOVELS_DIRS）".to_string());
    }
    if roots.iter().any(|root| real.starts_with(root)) {
        Ok(real)
    } else {
        Err("路径不在允许的小说目录内".to_string())
    }
}

/// GET /api/fs/roots
pub async fn roots() -> Json<serde_json::Value> {
    let roots: Vec<RootEntry> = allowed_roots()
        .into_iter()
        .map(|path| RootEntry {
            name: path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("目录")
                .to_string(),
            path: path.to_string_lossy().to_string(),
        })
        .collect();
    Json(serde_json::json!({ "roots": roots }))
}

/// GET /api/fs/list?path=...
pub async fn list(
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let raw = params.get("path").map(String::as_str).unwrap_or_default();
    let target = if raw.trim().is_empty() {
        match allowed_roots().into_iter().next() {
            Some(root) => root,
            None => return Err(error_response("未配置可访问的小说目录")),
        }
    } else {
        ensure_allowed(raw).map_err(|e| error_response(&e))?
    };

    if !target.is_dir() {
        return Err(error_response("指定路径不是目录"));
    }

    let mut entries: Vec<FileEntry> = Vec::new();
    let read_dir = std::fs::read_dir(&target)
        .map_err(|e| error_response(&format!("读取目录失败 {}: {}", target.display(), e)))?;
    for entry in read_dir.flatten() {
        let path = entry.path();
        let is_dir = path.is_dir();
        let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
        let name = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        entries.push(FileEntry {
            name,
            path: path.to_string_lossy().to_string(),
            is_dir,
            size,
        });
    }
    // 目录优先，其次按名称排序
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.cmp(&b.name)));

    Ok(Json(serde_json::json!({
        "path": target.to_string_lossy(),
        "entries": entries,
    })))
}

/// GET /api/fs/read?path=...
pub async fn read(
    Query(params): Query<HashMap<String, String>>,
) -> Result<Response, (StatusCode, Json<serde_json::Value>)> {
    let raw = params.get("path").map(String::as_str).unwrap_or_default();
    let target = ensure_allowed(raw).map_err(|e| error_response(&e))?;
    if !target.is_file() {
        return Err(error_response("指定路径不是文件"));
    }
    let size = std::fs::metadata(&target)
        .map(|m| m.len())
        .map_err(|e| error_response(&format!("读取文件信息失败: {}", e)))?;
    if size > config::MAX_READ_BYTES {
        return Err(error_response("文件超过 200MB 上限，请改用桌面版导入"));
    }
    let bytes =
        std::fs::read(&target).map_err(|e| error_response(&format!("读取文件失败: {}", e)))?;
    let name = target
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("novel");

    Ok((
        [
            (header::CONTENT_TYPE, "application/octet-stream".to_string()),
            (header::CONTENT_LENGTH, bytes.len().to_string()),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{}\"", name.replace('"', "")),
            ),
        ],
        bytes,
    )
        .into_response())
}

fn error_response(message: &str) -> (StatusCode, Json<serde_json::Value>) {
    (
        StatusCode::BAD_REQUEST,
        Json(serde_json::json!({ "error": message })),
    )
}

/// 判断文件是否可读（供测试与其它模块复用）
#[allow(dead_code)]
pub fn is_readable_file(path: &Path) -> bool {
    path.is_file() && ensure_allowed(&path.to_string_lossy()).is_ok()
}
