// ============================================================
// Web 端事件推送：全局 SSE 广播
//
// 所有需要推送进度/流式结果的服务层都通过 EventSink 发到这里，
// 浏览器端用单个 EventSource 订阅 /api/events，按事件名分发。
// ============================================================

use crate::events::EventSink;
use axum::response::sse::{Event, KeepAlive, Sse};
use futures_util::StreamExt;
use serde_json::Value;
use std::convert::Infallible;
use std::sync::OnceLock;
use tokio::sync::broadcast;
use tokio_stream::wrappers::BroadcastStream;

static EVENT_TX: OnceLock<broadcast::Sender<String>> = OnceLock::new();

fn sender() -> &'static broadcast::Sender<String> {
    EVENT_TX.get_or_init(|| broadcast::channel(1024).0)
}

/// 事件信封：`{"event": "名称", "payload": ...}`
fn envelope(event: &str, payload: Value) -> String {
    serde_json::json!({ "event": event, "payload": payload }).to_string()
}

/// 广播事件到所有 SSE 订阅者
pub fn broadcast(event: &str, payload: Value) -> bool {
    sender().send(envelope(event, payload)).is_ok()
}

/// 全局广播 sink
pub struct SseSink;

impl EventSink for SseSink {
    fn emit(&self, event: &str, payload: Value) -> bool {
        broadcast(event, payload)
    }
}

/// 单请求通道 sink（用于 /api/llm/stream，断开即停止生成）
#[derive(Clone)]
pub struct ChannelSink(pub tokio::sync::mpsc::UnboundedSender<String>);

impl EventSink for ChannelSink {
    fn emit(&self, event: &str, payload: Value) -> bool {
        self.0.send(envelope(event, payload)).is_ok()
    }
}

/// GET /api/events：SSE 订阅入口
pub async fn sse_handler() -> Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>> {
    let rx = sender().subscribe();
    let stream = BroadcastStream::new(rx).filter_map(|message| async move {
        match message {
            Ok(text) => Some(Ok(Event::default().data(text))),
            // 订阅者过慢导致消息丢弃时跳过，不影响后续事件
            Err(_) => None,
        }
    });
    Sse::new(stream).keep_alive(KeepAlive::default())
}
