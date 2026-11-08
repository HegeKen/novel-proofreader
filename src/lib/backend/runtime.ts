// ============================================================
// Web 版运行时标记：让现有 isTauri 能力检测走后端适配层
// 该模块必须在其它模块之前求值（main.tsx 首行 import）
// ============================================================

if (__PROOFREADER_WEB__ && typeof window !== "undefined") {
	const target = window as unknown as { __TAURI_INTERNALS__?: unknown };
	if (!target.__TAURI_INTERNALS__) {
		target.__TAURI_INTERNALS__ = {};
	}
}
