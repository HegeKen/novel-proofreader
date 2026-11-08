# Docker 部署指南

将小说校对工具以 Linux 可执行文件的形式运行在容器中，通过浏览器（noVNC）访问完整桌面界面，并在镜像内启用本地 llama.cpp 推理。

> 本方案把 **Tauri 桌面应用** 跑在虚拟显示里，不是纯 Web 版。因此浏览器中可以使用全部功能（文件选择器、本地模型、TTS、角色分析等），但音频不会回传到浏览器，详见「已知限制」。
>
> 如需**纯 Web 版**（浏览器直接访问、无 VNC、镜像更小），见文末「Web 版打包（无 VNC）」。

## 架构

```
浏览器 ──HTTP/WebSocket──> noVNC (6080)
                              │
                              ▼
                          x11vnc (5900)
                              │
                              ▼
     Xvfb 虚拟显示 (:99) + openbox
                              │
                              ▼
        Proof Reader（Tauri + WebKitGTK）
          ├─ 内置 llama.cpp 推理（local-llm）
          ├─ 本地模型目录 / 本地 TTS 运行时
          └─ 小说库与配置（持久化到数据卷）
```

- 构建阶段：Ubuntu 22.04 + Node 24 + pnpm 12.18.0 + Rust，`pnpm tauri build --no-bundle`
- 运行阶段：Ubuntu 22.04 + WebKitGTK + Xvfb + x11vnc + noVNC + PulseAudio 虚拟声卡
- 默认编译 `local-llm` feature（内置 llama.cpp 推理）

## 前置条件

| 项目 | 要求 |
|---|---|
| Docker | 20.10+，建议启用 BuildKit |
| Docker Compose | v2（`docker compose` 命令） |
| 内存 | 构建建议 ≥ 8 GB；运行建议 ≥ 4 GB |
| 磁盘 | 构建缓存 + 镜像约 3–6 GB（启用 local-llm 时更大） |
| 架构 | 推荐 `linux/amd64`；`arm64` 可运行，但 VoiceDesign 本地运行时仅提供 x86_64 包 |

## 快速开始

```bash
# 1. 构建并启动（首次构建包含 llama.cpp，耗时会明显更长）
docker compose up -d --build

# 2. 查看启动日志
docker compose logs -f proofreader

# 3. 浏览器访问
#    http://127.0.0.1:6080/vnc.html?autoconnect=true&resize=scale
```

首次进入后按应用内的「首次启动引导」配置 AI：

- **内置模型**：设置 → 模型 → 下载预置模型（约 1.1 GB）。模型保存在数据卷中，重建容器不会丢失。
- **云端 API**：在设置中填写 API Key。
- **本地 TTS / VoiceDesign**：首次使用时会下载运行时与模型到数据卷，需要容器可访问外网。

## 环境变量

在 `docker-compose.yml` 的 `environment` 中配置，或 `docker run -e` 传入：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `RESOLUTION` | `1600x1000x24` | 虚拟屏幕分辨率，可按需调整 |
| `NOVNC_PORT` | `6080` | 容器内 noVNC 端口，配合端口映射使用 |
| `VNC_PASSWORD` | 空 | 设置后 noVNC 连接需要密码；**对外暴露时必须设置** |
| `TZ` | `Asia/Shanghai` | 容器时区 |
| `WITH_LOCAL_LLM` | `1` | 构建参数：`1` 编译内置推理，`0` 仅云端/外部推理（镜像更小、构建更快） |

修改 `WITH_LOCAL_LLM` 后必须重新构建：

```bash
WITH_LOCAL_LLM=0 docker compose build --no-cache
```

## 数据持久化

容器内数据位置：

| 路径 | 内容 |
|---|---|
| `/home/app/.local/share` | 小说库、WebView 本地存储、内置模型、本地 TTS 运行时与日志 |
| `/home/app/.config` | GTK / WebKit / 应用配置 |

`docker-compose.yml` 默认使用命名卷 `proofreader-data` 与 `proofreader-config`。

备份与恢复：

```bash
# 备份
docker run --rm -v proofreader-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/proofreader-data.tgz -C /data .

# 恢复（先停止容器）
docker compose down
docker run --rm -v proofreader-data:/data -v "$PWD":/backup alpine \
  tar xzf /backup/proofreader-data.tgz -C /data
docker compose up -d
```

如需改用宿主机目录（例如便于直接管理小说文件），把 compose 中的卷改为绑定挂载，并确保目录属主为 UID 1000：

```yaml
volumes:
  - ./data:/home/app/.local/share
  - ./config:/home/app/.config
  - ./novels:/home/app/novels:ro
```

```bash
mkdir -p data config novels
sudo chown -R 1000:1000 data config
```

应用内的文件选择器可以浏览 `/home/app/novels`，从而导入宿主机上的小说。

## 手动构建与运行

不使用 Compose 时：

```bash
docker build -t novel-proofreader:0.21.0 .

docker run -d \
  --name novel-proofreader \
  -p 6080:6080 \
  -e VNC_PASSWORD='change-me' \
  -e RESOLUTION=1920x1200x24 \
  -v proofreader-data:/home/app/.local/share \
  -v proofreader-config:/home/app/.config \
  --shm-size=1g \
  --restart unless-stopped \
  novel-proofreader:0.21.0
```

指定构建参数：

```bash
docker build \
  --build-arg WITH_LOCAL_LLM=1 \
  --build-arg NODE_VERSION=24.22.2 \
  --build-arg PNPM_VERSION=9 \
  -t novel-proofreader:0.21.0 .
```

## GitHub Actions 自动构建

本机构建受网络（例如 Docker Hub 502）与 CPU 架构（Apple Silicon 通过 QEMU 编译 llama.cpp 很慢）影响时，可交给 GitHub Actions 在原生 x86_64 runner 上构建并推送镜像。

工作流：[`.github/workflows/docker.yml`](.github/workflows/docker.yml)，由 [`build.yml`](.github/workflows/build.yml) 在发布流程中复用。

- **触发**：推送 `v*` 标签时随 Build Release 一同构建；也可在 Actions 页面单独手动运行
- **前置条件**：等待桌面端 `build` 与 `build-local-llm` 成功后才推送，避免发布失败仍产出镜像
- **平台**：`linux/amd64`（VoiceDesign 本地运行时仅提供 x86_64 包）
- **构建参数**：`WITH_LOCAL_LLM=1`
- **缓存**：BuildKit `type=gha`，后续构建会明显加快
- **推送标签**：
  - `ghcr.io/<owner>/<repo>:<version>`
  - `ghcr.io/<owner>/<repo>:sha-<commit>`
  - 标签构建额外推送 `:latest`

使用已推送的镜像：

```bash
# 私有仓库/私有包需先登录；公开包可匿名拉取
docker pull ghcr.io/<owner>/<repo>:0.21.0

PROOFREADER_IMAGE=ghcr.io/<owner>/<repo> \
PROOFREADER_VERSION=0.21.0 \
docker compose up -d --no-build
```

> 首次推送后，在 GitHub 仓库的 Package 设置中把镜像可见性改为 public，匿名 `docker pull` 才能成功。

### 同时推送 Docker Hub

Docker Hub 的自动构建能力只对部分付费账户开放，通用做法是 Actions 构建后推送。在仓库 Secrets 中配置：

| Secret | 说明 |
|---|---|
| `DOCKERHUB_USERNAME` | Docker Hub 用户名 |
| `DOCKERHUB_TOKEN` | Docker Hub Access Token（不要使用账户密码） |

配置后工作流会额外推送 `docker.io/<username>/novel-proofreader:<version>`、`:sha-<commit>`，标签构建时还会推送 `:latest`。

### 只构建不推送 / 其他架构

- 仅验证构建：手动运行该工作流，或本地执行 `docker compose build`
- 需要 arm64 镜像：在 Apple Silicon 本地 `docker compose build`（默认宿主架构），或把工作流中的 `platforms` 改为 `linux/amd64,linux/arm64`（arm64 走 QEMU，构建更慢）

## 反向代理与 HTTPS

对外提供服务时，建议放在 Nginx / Caddy 之后并启用 TLS，同时设置 `VNC_PASSWORD`。

Nginx 示例（noVNC 依赖 WebSocket 升级）：

```nginx
server {
    listen 443 ssl;
    server_name proofreader.example.com;

    ssl_certificate     /etc/nginx/ssl/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:6080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

访问 `https://proofreader.example.com/vnc.html?autoconnect=true&resize=scale`。

> 不要把 6080 端口直接暴露到公网：未设置 `VNC_PASSWORD` 时任何人都能操作容器内的应用与数据。

## 推理方案说明

| 方式 | 说明 |
|---|---|
| 内置 llama.cpp | 默认已编译进镜像。在设置中选择「内置模型」并下载 GGUF 即可，完全离线推理（CPU） |
| 云端 API | 开箱可用，需要容器能访问对应 API 域名 |
| 外部本地服务（Ollama / LM Studio / vLLM） | 需运行在**同一个容器网络且地址为 `127.0.0.1`**，或使用 HTTPS 地址。应用 CSP 只放行 `localhost`、`127.0.0.1`、`[::1]` 与 HTTPS，`host.docker.internal` 会被拦截 |
| 本地 TTS / VoiceDesign | 首次使用时自动下载运行时到数据卷；`linux/arm64` 下 VoiceDesign 运行时不可用 |

启用内置推理会显著增加构建时间与镜像体积。若只需要云端 AI：

```bash
WITH_LOCAL_LLM=0 docker compose build
```

## 已知限制

- **浏览器端没有声音**：noVNC 不回传音频，TTS 朗读会播放到容器内的虚拟声卡（PulseAudio null sink）。如需听到声音，请使用桌面版，或自行将运行阶段替换为支持音频的 Web VNC 方案。
- **纯软件渲染**：容器使用 `WEBKIT_DISABLE_COMPOSITING_MODE=1`、`WEBKIT_DISABLE_DMABUF_RENDERER=1` 与 llvmpipe，复杂页面滚动可能不如桌面版流畅。
- **文件导入**：浏览器无法使用宿主机的拖拽上传；请通过挂载目录 + 应用内文件选择器导入。
- **镜像较大**：WebKitGTK、字体、VNC、llama.cpp 与构建工具链会让镜像达到数 GB。
- **仅 x86_64 完整体验**：CrispASR 的 VoiceDesign 运行时不提供 arm64 包。

## 故障排查

```bash
# 容器状态与健康检查
docker compose ps
docker inspect --format '{{json .State.Health}}' novel-proofreader

# 应用与各服务日志
docker compose logs -f proofreader
docker exec novel-proofreader cat /tmp/xvfb.log
docker exec novel-proofreader cat /tmp/x11vnc.log
docker exec novel-proofreader cat /tmp/novnc.log

# 确认 VNC 端口已监听
docker exec novel-proofreader bash -c 'ss -lntp | grep -E "5900|6080"'
```

常见问题：

| 现象 | 处理 |
|---|---|
| 网页空白 / WebKit 崩溃 | 增大 `shm_size`（≥ 1 GB），确认内存充足；查看应用日志 |
| noVNC 能打开但连不上 | 检查 `x11vnc` 是否启动、5900 是否监听 |
| 中文显示为方块 | 镜像已内置 `fonts-noto-cjk`，若自行改基础镜像需补装中文字体 |
| 数据卷权限错误 | 使用命名卷则无此问题；绑定挂载需 `chown -R 1000:1000` |
| 构建时内存不足 | 降低并发：`docker build --build-arg ...` 前设置 `CARGO_BUILD_JOBS=2`，或使用 `WITH_LOCAL_LLM=0` |
| 模型反复重新下载 | 确认 `/home/app/.local/share` 已持久化挂载 |
| 端口被占用 | 修改 compose 中 `"${NOVNC_PORT:-6080}:6080"` 的宿主机端口 |

## Web 版打包（无 VNC）

前文方案把 Tauri 桌面应用跑在虚拟显示里；Web 版是纯浏览器应用——Vite 构建的 SPA + axum 服务端（`proofreader-web`），浏览器直接访问 `http://<host>:8080`，无需 Xvfb/VNC/WebKitGTK，镜像更小、界面即为本地渲染。

- 前端：`PROOFREADER_WEB=1 pnpm build`（Vite alias 把 `@tauri-apps/*` 替换为 HTTP/浏览器适配层，产物在 `dist/`）
- 服务端：`cargo build --release --features web-server --bin proofreader-web`（叠加 `local-llm` 启用内置推理），静态托管 `dist`，API 走 `/api/*`
- 相关文件：`Dockerfile.web`、`docker-compose.web.yml`、`src-tauri/src/web/`

### Compose 构建启动

```bash
docker compose -f docker-compose.web.yml up -d --build

# 查看日志 / 健康检查
docker compose -f docker-compose.web.yml logs -f proofreader-web
curl http://127.0.0.1:8080/api/health
```

浏览器访问 `http://127.0.0.1:8080`。

> Web 版**无鉴权**，默认面向局域网自用；对外暴露时请放在带鉴权的反向代理之后，并为 SSE 关闭代理缓冲（Nginx 加 `proxy_buffering off;`），否则流式输出会被攒批。

### 环境变量与构建参数

| 变量 | 默认值 | 说明 |
|---|---|---|
| `WEB_PORT` | `8080` | 宿主机访问端口（映射到容器 8080） |
| `PROOFREADER_LISTEN` | `0.0.0.0:8080` | 容器内监听地址 |
| `PROOFREADER_DATA_DIR` | `/data` | 数据目录（配置、日志、本地 TTS 运行时） |
| `PROOFREADER_MODELS_DIR` | `/data/models` | 模型目录 |
| `PROOFREADER_NOVELS_DIRS` | `/novels` | 网页文件选择器可浏览的目录，多个用 `:` 或 `,` 分隔 |
| `PROOFREADER_LLM_GPU_LAYERS` | `0` | 内置推理 GPU 层数；容器无 GPU 时保持 0（纯 CPU） |
| `WITH_LOCAL_LLM` | `1` | 构建参数：`1` 编译内置 llama.cpp，`0` 仅云端/外部推理 |
| `PROOFREADER_WEB_IMAGE` / `PROOFREADER_VERSION` | `novel-proofreader-web` / 当前版本 | 镜像名与标签 |

`UBUNTU_MIRROR`、`CARGO_BUILD_JOBS`、`RUSTUP_DIST_SERVER` 等构建参数与桌面版一致。

### 数据持久化

| 挂载 | 内容 |
|---|---|
| `proofreader-web-data` → `/data` | 应用数据（配置、日志、本地 TTS 运行时） |
| `proofreader-web-models` → `/data/models` | 模型文件（单独挂载便于备份，或直接在宿主机放模型） |
| `./novels` → `/novels:ro` | 宿主机小说目录（只读），网页内「从服务器目录导入」即可浏览选择 |

改用绑定挂载时无需手动 `chown`：入口脚本 `docker/entrypoint-web.sh` 会在 root 启动时把数据目录属主修正为 UID 1000，再降权运行。

### 手动构建与运行

```bash
docker build -f Dockerfile.web -t novel-proofreader-web:0.21.0 .

docker run -d \
  --name novel-proofreader-web \
  -p 8080:8080 \
  -v proofreader-web-data:/data \
  -v proofreader-web-models:/data/models \
  -v "$PWD/novels":/novels:ro \
  --restart unless-stopped \
  novel-proofreader-web:0.21.0
```

### 不使用 Docker 的本地打包

需本机具备 Tauri 编译依赖（WebKitGTK 等，清单见 `Dockerfile.web` builder 阶段）：

```bash
# 1. 构建前端（必须先于服务端构建：generate_context! 编译期读取 ../dist）
PROOFREADER_WEB=1 pnpm build

# 2. 构建 Web 服务端
cargo build --manifest-path src-tauri/Cargo.toml --release \
  --features local-llm,web-server --bin proofreader-web

# 3. 运行（默认监听 0.0.0.0:8080）
PROOFREADER_WEB_ROOT=./dist ./src-tauri/target/release/proofreader-web
```

开发调试可分开跑：`PROOFREADER_WEB=1 pnpm dev`（Vite 把 `/api` 代理到 `127.0.0.1:8080`，可用 `PROOFREADER_API_TARGET` 改目标）+ 本地运行的 `proofreader-web`。

## 升级

```bash
git pull

# 桌面版镜像（默认构建当前机器架构，Apple Silicon 为 arm64）
docker compose build

# 需要 x86_64 镜像（例如使用 VoiceDesign 本地运行时）
DOCKER_DEFAULT_PLATFORM=linux/amd64 docker compose build
docker compose up -d

# Web 版镜像
docker compose -f docker-compose.web.yml up -d --build
DOCKER_DEFAULT_PLATFORM=linux/amd64 docker compose -f docker-compose.web.yml up -d --build

# 导出镜像
docker save novel-proofreader:0.21.0 -o novel-proofreader-0.21.0.tar
docker save novel-proofreader-web:0.21.0 -o novel-proofreader-web-0.21.0.tar
```

> `docker compose build` 本身不支持 `--platform` 参数；指定目标架构请使用 `DOCKER_DEFAULT_PLATFORM` 环境变量，或直接执行 `docker build --platform linux/amd64 -t novel-proofreader:0.21.0 .`。

命名卷会保留小说库、配置、模型与本地 TTS 运行时。升级后应用版本号与镜像标签可在 `docker-compose.yml` / `docker-compose.web.yml` 的 `PROOFREADER_VERSION` 中调整。
