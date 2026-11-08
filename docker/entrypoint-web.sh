#!/bin/sh
# ============================================================
# Web 版容器入口：以 root 启动时修正挂载数据目录属主，再降权运行
# ============================================================
set -e

DATA_DIR="${PROOFREADER_DATA_DIR:-/data}"

if [ "$(id -u)" = "0" ]; then
	mkdir -p "$DATA_DIR"
	# NAS 挂载点可能属主/权限位异常（如 root 所有或 000），需修正否则 app 无法读写
	FIX_FAILED=0
	chown app:app "$DATA_DIR" 2>/dev/null || FIX_FAILED=1
	chmod u+rwx "$DATA_DIR" 2>/dev/null || FIX_FAILED=1
	# models 内容由用户从宿主机直接放入，属主/权限不可控，需递归修正；
	# 模型目录文件数量少且仅改元数据，开销可忽略
	if [ -d "$DATA_DIR/models" ]; then
		chown -R app:app "$DATA_DIR/models" 2>/dev/null || FIX_FAILED=1
		chmod -R u+rwX "$DATA_DIR/models" 2>/dev/null || FIX_FAILED=1
	fi
	if [ "$FIX_FAILED" = "1" ]; then
		echo "[entrypoint] 警告: 无法完全修正 $DATA_DIR 的属主/权限，挂载目录可能出现权限错误" >&2
	fi
	exec runuser -u app -- "$@"
fi

exec "$@"
