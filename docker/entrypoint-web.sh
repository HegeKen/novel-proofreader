#!/bin/sh
# ============================================================
# Web 版容器入口：以 root 启动时修正挂载数据目录属主，再降权运行
# ============================================================
set -e

DATA_DIR="${PROOFREADER_DATA_DIR:-/data}"

if [ "$(id -u)" = "0" ]; then
	mkdir -p "$DATA_DIR"
	# NAS 上挂载目录默认属于 root，不修正会导致模型下载写入失败
	chown -R app:app "$DATA_DIR" 2>/dev/null || true
	exec runuser -u app -- "$@"
fi

exec "$@"
