// ============================================================
// Web 版运行配置：监听地址、静态资源目录、允许浏览的小说目录
// 全部来自环境变量，便于 Docker 部署时调整
// ============================================================

use std::path::PathBuf;

/// 监听地址，默认 0.0.0.0:8080
pub fn listen_addr() -> String {
    std::env::var("PROOFREADER_LISTEN")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "0.0.0.0:8080".to_string())
}

/// 前端构建产物目录（dist），默认 ./dist
pub fn web_root() -> PathBuf {
    std::env::var("PROOFREADER_WEB_ROOT")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("./dist"))
}

/// 允许浏览的小说目录列表
/// 支持 `PROOFREADER_NOVELS_DIRS`（用 `:` 或 `,` 分隔）与单值 `PROOFREADER_NOVELS_DIR`
pub fn novels_dirs() -> Vec<PathBuf> {
    let raw = std::env::var("PROOFREADER_NOVELS_DIRS")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .or_else(|| std::env::var("PROOFREADER_NOVELS_DIR").ok().filter(|v| !v.trim().is_empty()));

    match raw {
        Some(raw) => raw
            .split([':', ','])
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(PathBuf::from)
            .collect(),
        None => vec![crate::paths::data_dir().join("novels")],
    }
}

/// 单次读取文件上限（200MB）
pub const MAX_READ_BYTES: u64 = 200 * 1024 * 1024;
