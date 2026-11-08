// ============================================================
// Web 版入口：启动 axum 服务，浏览器直接访问前端
// ============================================================

fn main() {
    // 路径与环境变量初始化
    proofreader_lib::paths::init_from_env();

    // 容器通常没有 GPU，默认不 offload 到 GPU（可在 compose 中覆盖）
    if std::env::var_os("PROOFREADER_LLM_GPU_LAYERS").is_none() {
        std::env::set_var("PROOFREADER_LLM_GPU_LAYERS", "0");
    }

    let runtime = match tokio::runtime::Runtime::new() {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("[Web] 创建异步运行时失败: {}", error);
            std::process::exit(1);
        }
    };

    if let Err(error) = runtime.block_on(proofreader_lib::web::run()) {
        eprintln!("[Web] 启动失败: {}", error);
        std::process::exit(1);
    }
}
