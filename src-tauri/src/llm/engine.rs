// ============================================================
// 本地 LLM 推理引擎（基于 llama.cpp，feature "local-llm" 门控）
// ============================================================
use std::path::PathBuf;

/// 推理配置
/// 注：context_size / gpu_layers / temperature / max_tokens 仅在 feature "local-llm"
/// 开启后的真实推理路径中使用，默认构建（降级存根）下会报 dead_code，故条件豁免
#[derive(Debug, Clone)]
#[cfg_attr(not(feature = "local-llm"), allow(dead_code))]
pub struct InferenceConfig {
    pub model_path: String,
    pub context_size: u32,
    pub gpu_layers: i32,
    pub temperature: f32,
    pub max_tokens: u32,
    /// 是否静默 llama.cpp 的详细日志（默认开启，仅保留 [LLM] 标记的业务日志）
    pub silent_llama_logs: bool,
}

/// 本地推理引擎。
/// 持有已加载的模型；每次推理创建独立上下文（校对场景请求间无关联，无需复用 KV 缓存）。
pub struct LLMEngine {
    #[cfg(feature = "local-llm")]
    model: Option<llama_cpp_2::model::LlamaModel>,
    #[cfg(feature = "local-llm")]
    backend: Option<llama_cpp_2::llama_backend::LlamaBackend>,
    config: Option<InferenceConfig>,
}

impl LLMEngine {
    pub fn new() -> Self {
        Self {
            #[cfg(feature = "local-llm")]
            model: None,
            #[cfg(feature = "local-llm")]
            backend: None,
            config: None,
        }
    }

    /// 加载模型
    pub fn load_model(&mut self, config: InferenceConfig) -> Result<(), String> {
        let path = PathBuf::from(&config.model_path);
        if !path.exists() {
            return Err(format!("模型文件不存在: {}", config.model_path));
        }

        #[cfg(feature = "local-llm")]
        {
            use llama_cpp_2::llama_backend::LlamaBackend;
            use llama_cpp_2::model::params::LlamaModelParams;
            use llama_cpp_2::model::LlamaModel;

            // 根据配置控制 llama.cpp 日志输出
            llama_cpp_2::send_logs_to_tracing(
                llama_cpp_2::LogOptions::default().with_logs_enabled(!config.silent_llama_logs),
            );

            let backend = match &self.backend {
                Some(_) => None, // 已初始化则复用
                None => Some(
                    LlamaBackend::init().map_err(|e| format!("初始化推理后端失败: {}", e))?,
                ),
            };

            // gpu_layers < 0 表示全部层 offload 到 GPU
            let gpu_layers = if config.gpu_layers < 0 {
                u32::MAX
            } else {
                config.gpu_layers as u32
            };
            let model_params = LlamaModelParams::default().with_n_gpu_layers(gpu_layers);
            let model = LlamaModel::load_from_file(
                self.backend.as_ref().or(backend.as_ref()).unwrap(),
                &path,
                &model_params,
            )
            .map_err(|e| format!("模型加载失败: {}", e))?;

            if let Some(b) = backend {
                self.backend = Some(b);
            }
            self.model = Some(model);
        }

        self.config = Some(config);
        Ok(())
    }

    /// 卸载模型
    pub fn unload_model(&mut self) {
        #[cfg(feature = "local-llm")]
        {
            self.model = None;
        }
        self.config = None;
    }

    /// 检查是否已加载模型
    pub fn is_loaded(&self) -> bool {
        #[cfg(feature = "local-llm")]
        {
            return self.model.is_some();
        }
        #[cfg(not(feature = "local-llm"))]
        {
            self.config.is_some()
        }
    }

    /// 非流式推理
    pub fn inference(&self, prompt: &str) -> Result<String, String> {
        let mut output = String::new();
        self.generate(prompt, |piece| {
            output.push_str(&piece);
            true
        })?;
        Ok(output)
    }

    /// 流式推理：callback 收到每个文本片段，返回 false 可中断生成
    pub fn inference_stream<F>(&self, prompt: &str, callback: F) -> Result<(), String>
    where
        F: FnMut(String) -> bool,
    {
        self.generate(prompt, callback)
    }

    /// 推理主流程（feature 开启时的真实实现）
    #[cfg(feature = "local-llm")]
    fn generate<F>(&self, prompt: &str, mut on_piece: F) -> Result<(), String>
    where
        F: FnMut(String) -> bool,
    {
        use llama_cpp_2::context::params::LlamaContextParams;
        use llama_cpp_2::llama_batch::LlamaBatch;
        use llama_cpp_2::sampling::LlamaSampler;
        use std::num::NonZeroU32;

        let model = self.model.as_ref().ok_or("模型未加载")?;
        let backend = self.backend.as_ref().ok_or("推理后端未初始化")?;
        let config = self.config.as_ref().ok_or("推理配置缺失")?;

        let ctx_params = LlamaContextParams::default()
            .with_n_ctx(NonZeroU32::new(config.context_size));
        let mut ctx = model
            .new_context(backend, ctx_params)
            .map_err(|e| format!("创建推理上下文失败: {}", e))?;

        let vocab = model.vocab();
        let tokens = vocab.tokenize(prompt.as_bytes(), true, true);
        if tokens.is_empty() {
            return Err("提示词 tokenize 结果为空".to_string());
        }

        let n_ctx = ctx.n_ctx() as usize;
        if tokens.len() >= n_ctx {
            return Err(format!(
                "提示词超出上下文长度（{} > {}），请缩短输入或增大 context_size",
                tokens.len(),
                n_ctx
            ));
        }

        let mut sampler = LlamaSampler::chain_simple([
            LlamaSampler::temp(config.temperature),
            LlamaSampler::dist(42),
        ]);

        // 送入 prompt（最后一个 token 产出 logits）
        let mut batch = LlamaBatch::new(n_ctx.min(tokens.len().max(512)), 1);
        let last = tokens.len() - 1;
        for (i, token) in tokens.iter().enumerate() {
            batch
                .add(*token, i as i32, &[0], i == last)
                .map_err(|e| format!("构造 batch 失败: {}", e))?;
        }
        ctx.decode(&mut batch)
            .map_err(|e| format!("prompt 编码失败: {}", e))?;
        sampler.accept_many(tokens.iter().copied());

        // 逐 token 生成
        let max_tokens = (config.max_tokens as usize).min(n_ctx - tokens.len());
        let mut n_cur = tokens.len();
        for _ in 0..max_tokens {
            let token = sampler.sample(&ctx, -1);
            sampler.accept(token);
            if vocab.is_eog(token) {
                break;
            }

            let piece = vocab.token_to_piece(token, true, None);
            match String::from_utf8(piece) {
                Ok(text) => {
                    if !on_piece(text) {
                        break; // 上层请求中断
                    }
                }
                Err(_) => continue, // 跳过不完整 UTF-8 片段（多字节 token 边界）
            }

            batch.clear();
            batch
                .add(token, n_cur as i32, &[0], true)
                .map_err(|e| format!("构造生成 batch 失败: {}", e))?;
            ctx.decode(&mut batch)
                .map_err(|e| format!("推理失败: {}", e))?;
            n_cur += 1;
        }

        Ok(())
    }

    /// 推理主流程（feature 关闭时的降级提示）
    #[cfg(not(feature = "local-llm"))]
    fn generate<F>(&self, _prompt: &str, _on_piece: F) -> Result<(), String>
    where
        F: FnMut(String) -> bool,
    {
        Err(
            "当前构建未启用本地推理引擎（需以 --features local-llm 编译）。\
             请改用「本地外部服务」模式（Ollama / LM Studio）。"
                .to_string(),
        )
    }
}

impl Default for LLMEngine {
    fn default() -> Self {
        Self::new()
    }
}
