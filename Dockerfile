# ============================================================
# 小说校对工具容器镜像
# 多阶段构建：Linux 可执行文件 + Xvfb / x11vnc / noVNC 网页访问
# 默认启用 local-llm 内置推理；可用 WITH_LOCAL_LLM=0 关闭
# ============================================================

# ---------- 构建阶段 ----------
FROM ubuntu:24.04 AS builder

ARG DEBIAN_FRONTEND=noninteractive
ARG WITH_LOCAL_LLM=1
# Node 版本与下载源：nodesource 的 apt 源无可靠国内镜像，改用官方二进制包走 npmmirror
ARG NODE_VERSION=24.22.2
ARG NODE_MIRROR=https://registry.npmmirror.com/-/binary/node
ARG PNPM_VERSION=12.18.0
# apt 镜像源：默认走阿里云，避免境外源在国内容器构建时只有几十 KB/s
ARG UBUNTU_MIRROR=mirrors.aliyun.com
# 编译并发数：默认 4，避免 Docker VM 内存不足时 cargo 链接阶段 OOM
ARG CARGO_BUILD_JOBS=4
# Rust 工具链下载源：默认国内镜像；如需官方源可传 https://static.rust-lang.org
ARG RUSTUP_DIST_SERVER=https://rsproxy.cn
# rustup-init 本体的下载源（RUSTUP_DIST_SERVER 管不到它，缺省会去 static.rust-lang.org）
ARG RUSTUP_UPDATE_ROOT=https://rsproxy.cn/rustup

ENV CARGO_TERM_COLOR=never \
    CARGO_BUILD_JOBS=${CARGO_BUILD_JOBS} \
    LIBCLANG_PATH=/usr/lib/llvm-18/lib

# 缓存 .deb 安装包：重试构建时无需重复下载
RUN --mount=type=cache,target=/var/cache/apt/archives,sharing=locked \
    if [ -n "${UBUNTU_MIRROR}" ]; then \
      sed -i "s|http://archive.ubuntu.com/ubuntu|http://${UBUNTU_MIRROR}/ubuntu|g; \
              s|http://security.ubuntu.com/ubuntu|http://${UBUNTU_MIRROR}/ubuntu|g" \
              /etc/apt/sources.list.d/ubuntu.sources; \
    fi \
    && apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git gnupg build-essential pkg-config \
    libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libgtk-3-dev \
    cmake file libclang-dev \
    && rm -rf /var/lib/apt/lists/*

# Node.js + pnpm（Node 用 tar.gz 二进制包，避免依赖 xz 与境外 apt 源）
RUN set -eux; \
    case "$(dpkg --print-architecture)" in \
      amd64) NODE_ARCH=x64 ;; \
      arm64) NODE_ARCH=arm64 ;; \
      *) echo "不支持的架构: $(dpkg --print-architecture)" >&2; exit 1 ;; \
    esac; \
    curl -fsSL "${NODE_MIRROR}/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.gz" -o /tmp/node.tar.gz; \
    tar -xzf /tmp/node.tar.gz -C /usr/local --strip-components=1; \
    rm -f /tmp/node.tar.gz; \
    corepack enable; \
    corepack prepare "pnpm@${PNPM_VERSION}" --activate

# Rust（版本由仓库内 rust-toolchain.toml 固定，拉取时走 RUSTUP_DIST_SERVER）
ENV RUSTUP_DIST_SERVER=${RUSTUP_DIST_SERVER} \
    RUSTUP_UPDATE_ROOT=${RUSTUP_UPDATE_ROOT}
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
ENV PATH="/root/.cargo/bin:${PATH}"

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
# 缓存 pnpm 全局存储：依赖变更时只下载缺失的包
RUN --mount=type=cache,target=/root/.local/share/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile

COPY . .

# --no-bundle 只产出可执行文件，容器内直接运行，无需 deb / AppImage
# 缓存 cargo registry 与 target 目录，并把产物复制出缓存挂载点（缓存内容不会进入镜像层）
RUN --mount=type=cache,target=/root/.cargo/registry,sharing=locked \
    --mount=type=cache,target=/root/.cargo/git,sharing=locked \
    --mount=type=cache,target=/app/src-tauri/target,sharing=locked \
    if [ "${WITH_LOCAL_LLM}" = "1" ]; then \
      pnpm exec tauri build --no-bundle --features local-llm; \
    else \
      pnpm exec tauri build --no-bundle; \
    fi \
    && install -D -m 0755 /app/src-tauri/target/release/proofreader /app/bin/proofreader

# ---------- 运行阶段 ----------
FROM ubuntu:24.04 AS runtime

ARG DEBIAN_FRONTEND=noninteractive
ARG APP_UID=1000
ARG APP_GID=1000
ARG UBUNTU_MIRROR=mirrors.aliyun.com

ENV LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    DISPLAY=:99 \
    RESOLUTION=1600x1000x24 \
    NOVNC_PORT=6080 \
    TZ=Asia/Shanghai \
    WEBKIT_DISABLE_COMPOSITING_MODE=1 \
    WEBKIT_DISABLE_DMABUF_RENDERER=1 \
    LIBGL_ALWAYS_SOFTWARE=1

# 与构建阶段一致：优先使用镜像源，并复用 .deb 缓存
RUN --mount=type=cache,target=/var/cache/apt/archives,sharing=locked \
    if [ -n "${UBUNTU_MIRROR}" ]; then \
      sed -i "s|http://archive.ubuntu.com/ubuntu|http://${UBUNTU_MIRROR}/ubuntu|g; \
              s|http://security.ubuntu.com/ubuntu|http://${UBUNTU_MIRROR}/ubuntu|g" \
              /etc/apt/sources.list.d/ubuntu.sources; \
    fi \
    && apt-get update && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends \
    ca-certificates curl tini \
    libwebkit2gtk-4.1-0 libgtk-3-0t64 libappindicator3-1 librsvg2-2 libxdo3 \
    libgl1 libglx-mesa0 libgomp1 \
    xvfb x11vnc novnc websockify openbox x11-utils \
    dbus-x11 pulseaudio pulseaudio-utils \
    fonts-noto-cjk fonts-dejavu-core fontconfig \
    && rm -rf /var/lib/apt/lists/*

# noble 基础镜像自带 UID/GID 1000 的 ubuntu 用户/组，先移除避免与 APP_UID/APP_GID 冲突
RUN userdel -r ubuntu 2>/dev/null || true; \
    groupdel ubuntu 2>/dev/null || true; \
    groupadd -g "${APP_GID}" app \
    && useradd -m -u "${APP_UID}" -g app -s /bin/bash app \
    && mkdir -p /home/app/.local/share /home/app/.config \
       /home/app/.local/share/cn.helilab.proofreader/novel-proofreader/models \
    && chown -R app:app /home/app

COPY --from=builder /app/bin/proofreader /usr/local/bin/proofreader
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/proofreader /usr/local/bin/entrypoint.sh

USER app
WORKDIR /home/app

EXPOSE 6080
VOLUME ["/home/app/.local/share", "/home/app/.config"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:6080/vnc.html" || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
