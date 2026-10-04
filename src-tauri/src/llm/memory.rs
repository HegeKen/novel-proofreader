// ============================================================
// 系统信息检测：内存、磁盘空间、模型推荐
// ============================================================
use serde::Serialize;

/// 系统资源信息
#[derive(Debug, Clone, Serialize)]
pub struct SystemInfo {
    /// 物理内存总量（MB）
    pub total_memory_mb: u64,
    /// 模型目录所在磁盘可用空间（MB）
    pub disk_available_mb: u64,
    /// 根据内存推荐的预置模型 id
    pub recommended_model_id: String,
}

/// 获取物理内存总量（MB）
pub fn get_total_memory_mb() -> u64 {
    #[cfg(target_os = "macos")]
    {
        let mut size: u64 = 0;
        let mut len = std::mem::size_of::<u64>();
        let name = std::ffi::CString::new("hw.memsize").unwrap();
        let ok = unsafe {
            libc::sysctlbyname(
                name.as_ptr(),
                &mut size as *mut _ as *mut libc::c_void,
                &mut len,
                std::ptr::null_mut(),
                0,
            )
        };
        if ok == 0 {
            return size / 1024 / 1024;
        }
        0
    }

    #[cfg(target_os = "linux")]
    {
        // 解析 /proc/meminfo 的 MemTotal（单位 kB）
        if let Ok(meminfo) = std::fs::read_to_string("/proc/meminfo") {
            for line in meminfo.lines() {
                if let Some(rest) = line.strip_prefix("MemTotal:") {
                    if let Some(kb) = rest.trim().split_whitespace().next() {
                        if let Ok(v) = kb.parse::<u64>() {
                            return v / 1024;
                        }
                    }
                }
            }
        }
        0
    }

    #[cfg(target_os = "windows")]
    {
        let mut status: libc::MEMORYSTATUSEX = unsafe { std::mem::zeroed() };
        status.dwLength = std::mem::size_of::<libc::MEMORYSTATUSEX>() as u32;
        let ok = unsafe { libc::GlobalMemoryStatusEx(&mut status) };
        if ok != 0 {
            return (status.ullTotalPhys / 1024 / 1024) as u64;
        }
        0
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows", target_os = "android")))]
    {
        0
    }

    #[cfg(target_os = "android")]
    {
        // Android 基于 Linux 内核，直接读取 /proc/meminfo
        if let Ok(meminfo) = std::fs::read_to_string("/proc/meminfo") {
            for line in meminfo.lines() {
                if let Some(rest) = line.strip_prefix("MemTotal:") {
                    if let Some(kb) = rest.trim().split_whitespace().next() {
                        if let Ok(v) = kb.parse::<u64>() {
                            return v / 1024;
                        }
                    }
                }
            }
        }
        0
    }
}

/// 获取指定路径所在磁盘的可用空间（MB）
pub fn get_disk_available_mb(path: &std::path::Path) -> u64 {
    #[cfg(unix)]
    {
        let c_path = match std::ffi::CString::new(path.to_string_lossy().as_bytes()) {
            Ok(p) => p,
            Err(_) => {
                eprintln!("[Memory] 路径转换失败: {}", path.display());
                return 0;
            }
        };
        let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
        let ok = unsafe { libc::statvfs(c_path.as_ptr(), &mut stat) };
        if ok == 0 {
            // f_bavail * f_frsize = 非 root 用户可用字节数
            let mb = (stat.f_bavail as u64 * stat.f_frsize as u64) / 1024 / 1024;
            return mb;
        }
        eprintln!("[Memory] statvfs 失败: {} (errno: {})", path.display(), std::io::Error::last_os_error());
        0
    }

    #[cfg(not(unix))]
    {
        let _ = path;
        0
    }
}

/// 根据物理内存推荐预置模型
pub fn recommend_model_id(total_memory_mb: u64) -> &'static str {
    if total_memory_mb >= 16384 {
        "qwen2.5-7b-instruct-q3_k_m" // 16GB+ 推荐 7B
    } else {
        "chinese-text-correction-1.5b-q4_k_m" // 其余推荐轻量纠错模型
    }
}

/// 汇总系统信息（磁盘空间基于模型存储目录）
pub fn get_system_info() -> SystemInfo {
    let total_memory_mb = get_total_memory_mb();
    let models_dir = crate::llm::model_manager::get_models_dir();
    // 目录可能不存在，向上找到已存在的父目录再测磁盘
    let mut probe = models_dir.as_path();
    while !probe.exists() {
        match probe.parent() {
            Some(p) => probe = p,
            None => break,
        }
    }
    SystemInfo {
        total_memory_mb,
        disk_available_mb: get_disk_available_mb(probe),
        recommended_model_id: recommend_model_id(total_memory_mb).to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_memory_detection_nonzero_on_desktop() {
        // 桌面平台应能检测到内存（CI 容器也支持）
        let mb = get_total_memory_mb();
        assert!(mb > 0, "内存检测应返回非零值");
    }

    #[test]
    fn test_recommend_model_by_memory() {
        assert_eq!(recommend_model_id(32768), "qwen2.5-7b-instruct-q3_k_m");
        assert_eq!(recommend_model_id(16384), "qwen2.5-7b-instruct-q3_k_m");
        assert_eq!(recommend_model_id(8192), "chinese-text-correction-1.5b-q4_k_m");
        assert_eq!(recommend_model_id(0), "chinese-text-correction-1.5b-q4_k_m");
    }

    #[test]
    fn test_disk_space_nonzero_for_existing_dir() {
        let mb = get_disk_available_mb(std::path::Path::new("/"));
        assert!(mb > 0, "根目录磁盘空间应可检测");
    }
}
