# ============================================================
# 小说校对工具容器镜像
# 多阶段构建：Linux 可执行文件 + Xvfb / x11vnc / noVNC 网页访问
# 默认启用 local-llm 内置推理；可用 WITH_LOCAL_LLM=0 关闭
# ============================================================

# ---------- 构建阶段 ----------
FROM ubuntu:22.04 AS builder

ARG DEBIAN_FRONTEND=noninteractive
ARG WITH_LOCAL_LLM=1
ARG NODE_MAJOR=24
ARG PNPM_VERSION=12.18.0

ENV CARGO_TERM_COLOR=never

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git gnupg build-essential pkg-config \
    libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libgtk-3-dev \
    cmake file \
    && rm -rf /var/lib/apt/lists/*

# Node.js + pnpm
RUN curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && corepack prepare "pnpm@${PNPM_VERSION}" --activate

# Rust（版本由仓库内 rust-toolchain.toml 固定）
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
ENV PATH="/root/.cargo/bin:${PATH}"

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

COPY . .

# --no-bundle 只产出可执行文件，容器内直接运行，无需 deb / AppImage
RUN if [ "${WITH_LOCAL_LLM}" = "1" ]; then \
      pnpm exec tauri build --no-bundle --features local-llm; \
    else \
      pnpm exec tauri build --no-bundle; \
    fi

# ---------- 运行阶段 ----------
FROM ubuntu:22.04 AS runtime

ARG DEBIAN_FRONTEND=noninteractive
ARG APP_UID=1000
ARG APP_GID=1000

ENV LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    DISPLAY=:99 \
    RESOLUTION=1600x1000x24 \
    NOVNC_PORT=6080 \
    TZ=Asia/Shanghai \
    WEBKIT_DISABLE_COMPOSITING_MODE=1 \
    WEBKIT_DISABLE_DMABUF_RENDERER=1 \
    LIBGL_ALWAYS_SOFTWARE=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl tini \
    libwebkit2gtk-4.1-0 libgtk-3-0 libappindicator3-1 librsvg2-2 libxdo3 \
    libgl1 libglx-mesa0 libgomp1 \
    xvfb x11vnc novnc websockify openbox x11-utils \
    dbus-x11 pulseaudio pulseaudio-utils \
    fonts-noto-cjk fonts-dejavu-core fontconfig \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd -g "${APP_GID}" app \
    && useradd -m -u "${APP_UID}" -g app -s /bin/bash app \
    && mkdir -p /home/app/.local/share /home/app/.config \
    && chown -R app:app /home/app

COPY --from=builder /app/src-tauri/target/release/proofreader /usr/local/bin/proofreader
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/proofreader /usr/local/bin/entrypoint.sh

USER app
WORKDIR /home/app

EXPOSE 6080
VOLUME ["/home/app/.local/share", "/home/app/.config"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:6080/vnc.html" || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
