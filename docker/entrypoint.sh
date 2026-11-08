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
