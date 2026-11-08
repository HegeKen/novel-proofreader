// ============================================================
// Web 版服务端装配：RPC、SSE、文件浏览与前端静态资源托管
// ============================================================

pub mod config;
pub mod events;
pub mod fs;
pub mod rpc;

use axum::extract::{DefaultBodyLimit, Json};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::routing::{get, post};
use axum::Router;
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::json;
use std::convert::Infallible;
use tokio_stream::wrappers::UnboundedReceiverStream;
use tower_http::services::{ServeDir, ServeFile};

use events::ChannelSink;

#[derive(Deserialize)]
struct StreamRequest {
    prompt: String,
}

/// 通过 SSE 执行一次流式推理，前端断开时生成自动中断
async fn llm_stream_handler(
    Json(request): Json<StreamRequest>,
) -> Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>> {
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    let sink = ChannelSink(tx.clone());

    tokio::spawn(async move {
        let result = rpc::stream_inference(request.prompt, sink).await;
        let envelope = match result {
            Ok(()) => json!({ "event": "llm-stream-done", "payload": null }),
            Err(error) => json!({ "event": "llm-stream-error", "payload": error }),
        };
        let _ = tx.send(envelope.to_string());
    });

    let stream = UnboundedReceiverStream::new(rx)
        .map(|text| Ok(Event::default().data(text)));
    Sse::new(stream).keep_alive(KeepAlive::default())
}

/// 健康检查
async fn health() -> Json<serde_json::Value> {
    Json(json!({
        "status": "ok",
        "version": env!("CARGO_PKG_VERSION"),
        "llmEngineReady": cfg!(feature = "local-llm"),
        "commands": rpc::SUPPORTED_COMMANDS.len(),
    }))
}

/// 构造路由
fn app_router(web_root: &std::path::Path) -> Router {
    let index = web_root.join("index.html");
    let static_service = ServeDir::new(web_root.to_path_buf()).fallback(ServeFile::new(index));

    Router::new()
        .route("/api/health", get(health))
        .route("/api/rpc", post(rpc::rpc_handler))
        .route("/api/events", get(events::sse_handler))
        .route("/api/llm/stream", post(llm_stream_handler))
        .route("/api/fs/roots", get(fs::roots))
        .route("/api/fs/list", get(fs::list))
        .route("/api/fs/read", get(fs::read))
        .fallback_service(static_service)
        // 小说原文经 RPC 传入时可能较大，放宽请求体上限
        .layer(DefaultBodyLimit::max(64 * 1024 * 1024))
}

/// 启动 Web 服务（阻塞直到进程退出）
pub async fn run() -> Result<(), String> {
    let addr = config::listen_addr();
    let web_root = config::web_root();
    if !web_root.is_dir() {
        eprintln!(
            "[Web] 警告：静态资源目录不存在: {}（请设置 PROOFREADER_WEB_ROOT 或先执行前端构建）",
            web_root.display()
        );
    }
    println!("[Web] 小说目录: {:?}", config::novels_dirs());
    println!("[Web] 数据目录: {}", crate::paths::data_dir().display());

    let app = app_router(&web_root);
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .map_err(|e| format!("监听 {} 失败: {}", addr, e))?;
    println!("[Web] 已启动: http://{}", addr);

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .map_err(|e| format!("Web 服务异常退出: {}", e))?;

    println!("[Web] 收到退出信号，停止本地子进程");
    crate::local_tts::shutdown();
    crate::voice_design::shutdown();
    Ok(())
}

/// 等待 Ctrl+C 或 SIGTERM（容器 stop 时由 tini 转发）
async fn shutdown_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        let mut terminate = match signal(SignalKind::terminate()) {
            Ok(signal) => signal,
            Err(_) => {
                let _ = tokio::signal::ctrl_c().await;
                return;
            }
        };
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {},
            _ = terminate.recv() => {},
        }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}
