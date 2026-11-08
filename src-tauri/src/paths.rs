// ============================================================
// 应用路径统一入口：数据目录 / 模型目录 / 工具目录 / 日志目录 / TTS 缓存
//
// 桌面模式沿用 Tauri app_data_dir（由 lib.rs 调用 set_data_dir 初始化）；
// Web 模式由环境变量 PROOFREADER_DATA_DIR / PROOFREADER_MODELS_DIR 指定，
// 便于在容器中把数据目录挂载到持久化卷。
// ============================================================

use std::path::PathBuf;
use std::sync::OnceLock;

static DATA_DIR: OnceLock<PathBuf> = OnceLock::new();
static MODELS_DIR: OnceLock<PathBuf> = OnceLock::new();

/// 平台默认数据目录（与桌面版历史布局保持一致）
fn default_data_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("novel-proofreader")
}

/// 从环境变量初始化路径（Web 入口启动时调用；桌面端不调用）
pub fn init_from_env() {
    if let Ok(value) = std::env::var("PROOFREADER_DATA_DIR") {
        let path = value.trim();
        if !path.is_empty() {
            let _ = DATA_DIR.set(PathBuf::from(path));
        }
    }
    if let Ok(value) = std::env::var("PROOFREADER_MODELS_DIR") {
        let path = value.trim();
        if !path.is_empty() {
            let _ = MODELS_DIR.set(PathBuf::from(path));
        }
    }
}

/// 设置数据目录（桌面端传 Tauri app_data_dir）
pub fn set_data_dir(dir: PathBuf) {
    let _ = DATA_DIR.set(dir);
}

/// 设置模型目录覆盖（Web 端 PROOFREADER_MODELS_DIR）
pub fn set_models_dir_override(dir: PathBuf) {
    let _ = MODELS_DIR.set(dir);
}

/// 数据根目录
pub fn data_dir() -> PathBuf {
    DATA_DIR.get().cloned().unwrap_or_else(default_data_dir)
}

/// 模型目录
pub fn models_dir() -> PathBuf {
    MODELS_DIR
        .get()
        .cloned()
        .unwrap_or_else(|| data_dir().join("models"))
}

/// 工具目录（llama-server / crispasr 运行时）
pub fn tools_dir() -> PathBuf {
    data_dir().join("tools")
}

/// 日志目录
pub fn logs_dir() -> PathBuf {
    data_dir().join("logs")
}

/// TTS 参考音色缓存目录
pub fn tts_dir() -> PathBuf {
    data_dir().join("tts")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_paths_are_nested_under_data_dir() {
        // 未显式初始化时应能给出可用的默认路径（不依赖具体平台）
        let data = default_data_dir();
        assert!(data.ends_with("novel-proofreader"));
    }

    #[test]
    fn override_is_returned_by_getters() {
        // 使用独立进程内的 OnceLock，仅在未设置时写入，避免影响其它测试
        let base = std::env::temp_dir().join("proofreader-paths-test");
        let _ = MODELS_DIR.set(base.join("models"));
        assert_eq!(models_dir(), base.join("models"));
    }
}
