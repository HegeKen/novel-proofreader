# Web 版部署方案（同仓库双模式）

## Context

当前 `Dockerfile` 构建的是 Tauri 桌面程序：容器内跑 Xvfb + openbox + x11vnc + noVNC，浏览器看到的是「远程桌面」，不是网站。用户希望把 novel-proofreader 作为真正的 Web 应用部署在 Docker Ubuntu 容器里，浏览器直接访问界面，并且本地 LLM 在校对时仍然可用。

已确认的决策：
- 无鉴权，局域网自用，监听 `0.0.0.0:8080`
- 小说文件来自**服务端挂载目录**，网页内浏览选择（新增目录浏览 API + 选择弹窗）
- **保留桌面版**，同一仓库双模式：前端按运行时自动切换 Tauri IPC / HTTP
- 首版覆盖**全部功能**：AI 校对（云端 + 本地 llama.cpp）、本地 TTS、VoiceDesign、情感分析、角色管理、文本对比
- 现有 noVNC 部署链路（`Dockerfile`、`docker-compose.yml`、`docker-example.yml`）保持不动

规模事实：`lib.rs` 通过 `generate_handler!` 注册 **36 个 command**（桌面/Android 6、LLM 12、本地 TTS 6、VoiceDesign 6、外部 TTS 1、情感 5）；前端约 17 个文件依赖 `@tauri-apps/*`。

## 核心设计

```
React (Vite 构建的 SPA) → src/lib/backend 统一适配层
   ├─ Tauri 模式：@tauri-apps IPC
   └─ Web 模式：fetch POST /api/rpc + EventSource /api/events
                    ↓
   Tauri #[command] 薄层        axum RPC 薄层（src-tauri/src/web/）
                    ↓
        平台无关服务层：llm/、local_tts、voice_design、emotion、external_tts、paths
```

原则：业务逻辑只保留一份；把 `AppHandle.emit` 抽象成 `EventSink`（桌面走 `app.emit`，Web 走 SSE 广播），command 拆成「服务层函数 + 两个薄适配层」。

### 后端

新增：
- `src-tauri/src/paths.rs`：`data_dir/models_dir/tools_dir/logs_dir/tts_dir`，支持 `PROOFREADER_DATA_DIR`、`PROOFREADER_MODELS_DIR`；`model_manager::set_models_dir` 改为调用 `paths::set_data_dir(app_data.join("novel-proofreader"))`，桌面布局不变
- `src-tauri/src/events.rs`：`trait EventSink { fn emit(&self, event: &str, payload: Value) -> bool }`；返回 false 表示订阅端断开（沿用「emit 失败即中断流式生成」的现有语义）
- `src-tauri/src/llm/service.rs`：从 `commands/llm.rs` 迁出引擎全局状态与业务函数
- `src-tauri/src/commands/{tts,voice_design,emotion,external_tts}.rs`：Tauri 薄包装
- `src-tauri/src/web/{mod,rpc,events,fs,config}.rs`：axum 装配、RPC 分发、SSE 广播、文件浏览、环境变量
- `src-tauri/src/bin/proofreader-web.rs`：Web 入口
- `Cargo.toml`：`web-server` feature（`axum 0.8`、`tower-http`、`tokio-stream`）与 `[[bin]]`

接口：
- `POST /api/rpc`：`{ "command": "llm_load_model", "args": { "modelId": ... } }` → 裸 JSON 返回值；失败返回 `{ "error": "..." }`。参数名与现有 `invoke` 完全一致
- `GET /api/events`：SSE，迁移现有 6 个事件（`llm-stream-token`、`llm-download-progress`、`tts-local-download-progress`、`tts-voice-design-download-progress`、`emotion-download-progress`、`emotion-import-progress`），带心跳与 `X-Accel-Buffering: no`
- `POST /api/llm/stream`：独立 SSE，`llm-stream-token/-done/-error`；断开即停止生成
- `GET /api/fs/roots`、`GET /api/fs/list?path=`、`GET /api/fs/read?path=`；路径 `canonicalize` 后必须落在允许根内，读取上限 200MB
- `GET /api/health`
- 静态托管 `PROOFREADER_WEB_ROOT` 下的 `dist`，SPA fallback 到 `index.html`

36 个 command 处置：
- 直接复用：LLM 12 个（`llm_open_models_dir` 在 Web 改为返回路径、不调文件管理器；`llm_inference` 用 `spawn_blocking`；`llm_import_model`/`llm_delete_model` 加路径校验）
- 去 `AppHandle` → `EventSink`：`llm_inference_stream`、`llm_download_model`、`tts_local_*download*`、`tts_voice_design_*`、`emotion_local_download/import_dir`
- 依赖 Tauri runtime：`emotion_local_analyze` 的 `tauri::async_runtime::spawn_blocking` 改 `tokio::task::spawn_blocking`
- Web no-op：`start_tts_service`、`stop_tts_service`、`update_tts_notification`、`start_proofread_service`、`stop_proofread_service`；`macos_open_full_disk_access_settings` 返回「仅 macOS」
- 外部 TTS：服务端代理，原样复用（顺带绕过浏览器 CORS）

并发与 GPU：Web 默认 `PROOFREADER_LLM_GPU_LAYERS=0`（容器无 GPU，且前端默认 -1 会触发无效 offload）；推理互斥用 `try_lock`，忙时返回 409，避免打满 blocking 线程池。

### 前端

新增 `src/lib/backend/`：`runtime.ts`（`isTauri()`/`isBackendAvailable()`）、`invoke.ts`（Tauri `invoke` 或 `fetch /api/rpc`）、`events.ts`（`@tauri-apps/api/event` 或单例 `EventSource` + Map 分发）、`files.ts`（`openFilePicker`、`saveFile`、`listServerDir`、`readServerFile`）。

新增 `src/components/ServerFilePickerModal.tsx`（`lazy()`，挂载在 `App.tsx` 根节点），沿用 `.modal-overlay` + `.config-modal` + `.config-header/.config-body` 结构；`src/stores/filePickerStore.ts` 提供命令式 `request(opts)`。

替换模式（代表性文件）：
- `src/stores/localModelStore.ts`：动态 `invoke`/`listen` → 适配层；`isTauri()` 判断改为「后端可用」，否则 Web 端整块功能被跳过
- `src/utils/localTts.ts`、`src/utils/localEmotion.ts`、`src/utils/aiClient.ts`、`src/utils/androidService.ts`、`src/utils/systemPermissions.ts`、`src/hooks/useTTS.ts`
- `src/components/LocalModelSettings.tsx`、`src/components/config/{LocalTTS,VoiceDesignTTS,LocalEmotion}ConfigSection.tsx`：`plugin-dialog` → `openFilePicker`
- `src/components/NovelList.tsx`：新增「从服务器目录导入」，`openFilePicker({purpose:"novel"})` → `readServerFile` → 复用现有 `decodeTextBuffer` / epub 解析
- `src/utils/fileExport.ts`、`characterConfigStorage.ts`、`notifications.ts` 已有浏览器回退，首版不改

构建：`vite.config.ts` 的 `base` 支持 `PROOFREADER_WEB_BASE`（Web 构建用 `/`，桌面保持 `./`）；开发时 Vite `server.proxy` 把 `/api` 转到 `127.0.0.1:8080`。

### 环境变量

`PROOFREADER_DATA_DIR=/data`、`PROOFREADER_MODELS_DIR=$DATA/models`、`PROOFREADER_NOVELS_DIRS=/novels`、`PROOFREADER_WEB_ROOT=/app/web`、`PROOFREADER_LISTEN=0.0.0.0:8080`、`PROOFREADER_LLM_GPU_LAYERS=0`、`PROOFREADER_LLAMA_SERVER`、`CRISPASR_BIN`。

### Docker

新增 `Dockerfile.web`（独立文件，避免改动桌面链路）：builder 复用现有 Ubuntu 22.04 + Node 24 + pnpm + Rust + apt 镜像源参数，先 `pnpm build`（`generate_context!` 编译期需要 `../dist`），再 `cargo build --release --features local-llm,web-server --bin proofreader-web`；runtime 仅需 `ca-certificates tini tar libgomp1 curl tzdata` + uid 1000 的 app 用户，`EXPOSE 8080`，`HEALTHCHECK /api/health`，`tini` 收尾。不需要 Xvfb/VNC/音频库。

新增 `docker-compose.web.yml`（命名卷）与 `docker-compose.web-example.yml`（NAS 绑定挂载示例）：端口 `${WEB_PORT:-8080}:8080`，卷 `/data`（models/tools/logs）、`/novels:ro`，`restart: unless-stopped`。

## 实施阶段（每阶段可独立验证）

0. **平台无关化（不改功能）**：新增 `paths.rs`、`events.rs`；剥离 `AppHandle`；command 改薄包装。验证：`cargo test` 全绿；`pnpm tauri dev` 下模型下载/导入、TTS、情感分析行为不变。
1. **axum 骨架 + 静态托管**：`web/*`、`bin/proofreader-web.rs`、Cargo feature；先只接 `llm_get_status`。验证：`cargo build --features local-llm,web-server --bin proofreader-web`；curl `/api/health`、`/api/rpc`；浏览器打开 8080 能看到界面。
2. **文件浏览 + 前端适配层**：`web/fs.rs` 三个接口；`src/lib/backend/*`、`ServerFilePickerModal`、`NovelList` 服务器导入。验证：curl roots/list/read；浏览器从挂载目录导入 txt/epub 并解析。
3. **LLM 全量**：12 个命令 + 下载进度广播 + `/api/llm/stream`。验证：curl 走通 status/scan/load/inference；`curl -N` 看到逐 token；设置页下载/加载/卸载模型；校对使用本地模型。
4. **TTS / VoiceDesign / 情感 / 外部 TTS**：其余命令与事件；前端调用点全部切到适配层。验证：curl 合成返回 base64 WAV、浏览器朗读出声、情感分析返回概率；桌面端回归。
5. **Docker / 部署**：`Dockerfile.web`、两份 web compose。验证：`docker compose -f docker-compose.web.yml up -d --build`；浏览器完成「导入小说 → AI 校对 → TTS 朗读」；重启后 `/data` 数据保留；`docker compose logs` 无 panic。

## 验证清单

```bash
npx vitest run                                   # 前端（含新增适配层单测：invoke 成功/错误、listen 分发/退订）
cargo test                                       # 后端
cargo build --features local-llm,web-server --bin proofreader-web
PROOFREADER_DATA_DIR=/tmp/pr-data PROOFREADER_WEB_ROOT=./dist PROOFREADER_NOVELS_DIRS=/tmp/novels \
  ./src-tauri/target/debug/proofreader-web
curl -fsS 127.0.0.1:8080/api/health
curl -s -X POST 127.0.0.1:8080/api/rpc -H 'content-type: application/json' \
  -d '{"command":"llm_get_status","args":{}}'
curl -N 127.0.0.1:8080/api/events
docker compose -f docker-compose.web.yml up -d --build
```

回归基线：`pnpm tauri build` 必须成功且不引入 `web-server` 依赖，确保桌面版不受影响。

## 风险与注意事项

- 无 GPU 时纯 CPU 推理较慢；Web 默认 `gpu_layers=0`，UI 显示耗时
- SSE 需禁用缓冲（`X-Accel-Buffering: no` + 心跳），不要套压缩层；模型下载等长请求需调大反代超时
- 无鉴权且监听 `0.0.0.0`：只挂载必要目录，文件 API 严格 canonicalize 校验，勿把宿主机敏感目录加入 `PROOFREADER_NOVELS_DIRS`
- 自动下载的 `llama-server` 依赖容器 glibc 与 `libgomp1`；`tools/` 必须对 app 用户可写
- 同一模型并发下载会冲突，Web 层按 model_id 加互斥
- 小说全文与配置存在浏览器 IndexedDB/localStorage，换端口/清缓存会丢失（首版可接受，文档说明）
- Web 二进制仍链接 tauri crate，builder 需要现有 webkit 开发包，但 runtime 不需要，镜像仍可瘦身

## 暂不实现

访问鉴权、多用户、服务端配置持久化 API、Web 版 CI 发布（可后续在现有 `docker.yml` 增加一个 job）。
