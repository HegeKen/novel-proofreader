// ============================================================
// 事件出口抽象：桌面端走 Tauri 事件，Web 端走 SSE 广播
//
// 现有语义：emit 返回 false 表示订阅端已断开，调用方应中断流式生成。
// ============================================================

use serde_json::Value;

/// 事件接收端
pub trait EventSink: Send + Sync {
    /// 发送事件；返回 false 表示订阅端已断开
    fn emit(&self, event: &str, payload: Value) -> bool;
}

/// 桌面端适配：转发到 Tauri 事件系统（Web 构建下未被调用）
#[allow(dead_code)]
pub struct TauriSink(pub tauri::AppHandle);

impl EventSink for TauriSink {
    fn emit(&self, event: &str, payload: Value) -> bool {
        use tauri::Emitter;
        self.0.emit(event, payload).is_ok()
    }
}

#[allow(dead_code)]
impl TauriSink {
    pub fn new(app: tauri::AppHandle) -> Self {
        Self(app)
    }
}

/// 无接收端：用于不需要推送进度的场景（如 Web 无订阅者）
pub struct NoopSink;

impl EventSink for NoopSink {
    fn emit(&self, _event: &str, _payload: Value) -> bool {
        true
    }
}
