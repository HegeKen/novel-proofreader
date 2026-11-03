// ============================================================
// 外部 OpenAI 兼容 TTS：由 Rust 侧发起 HTTP 请求
//
// 原因：第三方本地 TTS 服务通常不返回 CORS 头，WebView 的 fetch
// 会被同源策略拦截（表现为 "Load failed"）。走 Rust reqwest 可
// 彻底绕过 CORS，同时便于统一超时和错误信息。
// ============================================================
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use std::time::Duration;
use tauri::command;

fn error_detail(bytes: &[u8], limit: usize) -> String {
    String::from_utf8_lossy(bytes)
        .chars()
        .take(limit)
        .collect::<String>()
}

/// 调用外部 OpenAI 兼容 TTS 的 /audio/speech，返回 base64 音频
#[command]
pub async fn tts_external_synthesize(
    url: String,
    api_key: Option<String>,
    body: serde_json::Value,
) -> Result<String, String> {
    let url = url.trim().to_string();
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(format!("外部 TTS 服务地址无效: {}", url));
    }

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| format!("创建外部 TTS 请求客户端失败: {}", e))?;

    let mut request = client.post(&url).json(&body);
    if let Some(key) = api_key.map(|k| k.trim().to_string()).filter(|k| !k.is_empty()) {
        request = request.bearer_auth(key);
    }

    println!("[ExternalTTS] 请求 {}", url);
    let started = std::time::Instant::now();
    let response = request
        .send()
        .await
        .map_err(|e| format!("连接外部 TTS 服务失败: {}", e))?;

    let status = response.status();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("读取外部 TTS 响应失败: {}", e))?;

    if !status.is_success() {
        return Err(format!(
            "外部 TTS 服务错误（HTTP {}）：{}",
            status,
            error_detail(&bytes, 800)
        ));
    }
    if bytes.is_empty() {
        return Err("外部 TTS 服务返回了空响应".to_string());
    }
    if content_type.to_lowercase().contains("json") {
        return Err(format!(
            "外部 TTS 服务未返回音频：{}",
            error_detail(&bytes, 800)
        ));
    }
    if matches!(bytes.first(), Some(b'{') | Some(b'[')) {
        return Err(format!(
            "外部 TTS 服务未返回音频：{}",
            error_detail(&bytes, 800)
        ));
    }

    println!(
        "[ExternalTTS] 完成 {} KB，类型 {}，耗时 {}ms",
        bytes.len() / 1024,
        if content_type.is_empty() { "(未知)" } else { &content_type },
        started.elapsed().as_millis()
    );
    Ok(BASE64.encode(&bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 需要本机外部 TTS 服务运行在 5005。
    /// cargo test external_tts_e2e -- --ignored --nocapture
    #[tokio::test]
    #[ignore = "需要本机外部 OpenAI 兼容 TTS 服务"]
    async fn external_tts_e2e() {
        let body = serde_json::json!({
            "input": "这是一段外部语音服务端到端测试。",
            "voice": "长乐",
            "response_format": "wav"
        });
        let result = tts_external_synthesize(
            "http://127.0.0.1:5005/v1/audio/speech".to_string(),
            None,
            body,
        )
        .await
        .expect("外部 TTS 调用失败");
        let bytes = BASE64.decode(result).expect("返回内容不是 base64");
        assert_eq!(&bytes[0..4], b"RIFF");
        assert!(bytes.len() > 10_000);
    }
}
