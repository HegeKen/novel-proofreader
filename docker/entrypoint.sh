#!/usr/bin/env bash
# ============================================================
# 容器入口：启动虚拟显示、VNC、noVNC，再拉起 Tauri 应用
# 环境变量：
#   RESOLUTION    虚拟屏幕分辨率，默认 1600x1000x24
#   NOVNC_PORT    noVNC 网页端口，默认 6080
#   VNC_PASSWORD  可选，设置后 noVNC 连接需要密码
# ============================================================
set -euo pipefail

log() {
	printf '[entrypoint] %s\n' "$*"
}

XVFB_PID=""
X11VNC_PID=""
NOVNC_PID=""
OPENBOX_PID=""

cleanup() {
	for pid in "$NOVNC_PID" "$X11VNC_PID" "$OPENBOX_PID"; do
		[ -n "$pid" ] && kill "$pid" 2>/dev/null || true
	done
	[ -n "$XVFB_PID" ] && kill "$XVFB_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

APP_HOME="${APP_HOME:-/home/app}"
APP_UID="${APP_UID:-1000}"
APP_GID="${APP_GID:-1000}"
# 模型目录（与 model_manager::set_models_dir 保持一致：app_data_dir/novel-proofreader/models）
APP_MODELS_DIR="${APP_MODELS_DIR:-$APP_HOME/.local/share/cn.helilab.proofreader/novel-proofreader/models}"

# 0. 权限准备
#   NAS 等环境把宿主机目录挂载到数据目录时，属主往往不是容器内的 app 用户，
#   WebKit 初始化写入数据目录会直接抛 "Permission denied"，因此以 root 启动时
#   先修正属主，再降权为 app 用户运行（docker-example.yml 里配 user: "0:0"）。
prepare_dir() {
	local dir="$1" owner
	mkdir -p "$dir" 2>/dev/null || true
	if [ ! -d "$dir" ]; then
		log "无法创建目录：$dir"
		return
	fi
	owner="$(stat -c '%u:%g' "$dir" 2>/dev/null || echo unknown)"
	if [ "$owner" != "$APP_UID:$APP_GID" ]; then
		if chown -R "$APP_UID:$APP_GID" "$dir" 2>/dev/null; then
			log "已修正目录属主：$dir（$owner -> $APP_UID:$APP_GID）"
		else
			log "无法修正目录属主，请手动执行：chown -R $APP_UID:$APP_GID $dir"
		fi
	fi
}

if [ "$(id -u)" = "0" ]; then
	prepare_dir "$APP_HOME/.local/share"
	prepare_dir "$APP_HOME/.config"
	prepare_dir "$APP_HOME/.cache"
	prepare_dir "$APP_HOME/.vnc"
	prepare_dir "$APP_MODELS_DIR"
	export HOME="$APP_HOME"
	log "以 root 启动，权限修正完成，降权为 $APP_UID:$APP_GID 运行"
	exec setpriv --reuid="$APP_UID" --regid="$APP_GID" --init-groups "$0" "$@"
fi

# 数据目录不可写时给出可操作的提示，避免 Tauri 抛出原始 panic
for dir in "${XDG_DATA_HOME:-$HOME/.local/share}" "${XDG_CONFIG_HOME:-$HOME/.config}"; do
	if ! (mkdir -p "$dir" && touch "$dir/.write_test") 2>/dev/null; then
		log "错误：数据目录不可写：$dir"
		log "该目录通常由宿主机目录挂载而来，请执行 chown -R $APP_UID:$APP_GID <宿主机对应目录> 后重启容器"
		exit 1
	fi
	rm -f "$dir/.write_test"
done

# 1. 虚拟显示
if ! xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then
	log "启动 Xvfb：$DISPLAY（$RESOLUTION）"
	Xvfb "$DISPLAY" -screen 0 "$RESOLUTION" -nolisten tcp -ac >/tmp/xvfb.log 2>&1 &
	XVFB_PID=$!
	for _ in $(seq 1 50); do
		xdpyinfo -display "$DISPLAY" >/dev/null 2>&1 && break
		sleep 0.2
	done
fi

# 2. D-Bus 会话（系统通知等功能需要）
if [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]; then
	eval "$(dbus-launch --sh-syntax)" 2>/dev/null || log "dbus 启动失败（已忽略）"
fi

# 3. 无头音频：TTS 播放写入虚拟声卡，避免容器内无声卡报错
if command -v pulseaudio >/dev/null 2>&1; then
	pulseaudio --start --exit-idle-time=-1 >/tmp/pulseaudio.log 2>&1 || true
	pactl load-module module-null-sink sink_name=virtual_speaker >/dev/null 2>&1 || true
	pactl set-default-sink virtual_speaker >/dev/null 2>&1 || true
fi

# 4. 窗口管理器：保证窗口铺满、可聚焦
log "启动 openbox"
openbox >/tmp/openbox.log 2>&1 &
OPENBOX_PID=$!

# 5. VNC + noVNC
if [ -n "${VNC_PASSWORD:-}" ]; then
	mkdir -p "$HOME/.vnc"
	x11vnc -storepasswd "$VNC_PASSWORD" "$HOME/.vnc/passwd" >/dev/null 2>&1
	chmod 600 "$HOME/.vnc/passwd"
	log "启动 x11vnc（端口 5900，已启用密码）"
	x11vnc -display "$DISPLAY" -forever -shared -rfbport 5900 -quiet \
		-rfbauth "$HOME/.vnc/passwd" >/tmp/x11vnc.log 2>&1 &
else
	log "启动 x11vnc（端口 5900，未设置密码）"
	x11vnc -display "$DISPLAY" -forever -shared -rfbport 5900 -quiet -nopw \
		>/tmp/x11vnc.log 2>&1 &
fi
X11VNC_PID=$!

log "启动 noVNC（端口 ${NOVNC_PORT}）"
websockify --web=/usr/share/novnc "$NOVNC_PORT" 127.0.0.1:5900 >/tmp/novnc.log 2>&1 &
NOVNC_PID=$!

# 6. 应用（前台等待，任一关键进程退出则容器结束）
log "启动 Proof Reader"
/usr/local/bin/proofreader "$@" &
APP_PID=$!

wait -n "$APP_PID" "$X11VNC_PID" "$NOVNC_PID"
