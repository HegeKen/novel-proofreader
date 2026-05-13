// ============================================================
// 调试日志工具 — 通过 AIConfig.enableLogging 控制开关
// ============================================================

let enabled = false;

export function setLoggerEnabled(v: boolean) {
	enabled = v;
}

export function isLoggerEnabled() {
	return enabled;
}

function ts(): string {
	return new Date().toLocaleTimeString("zh-CN", { hour12: false });
}

export const logger = {
	/** AI 请求发起 */
	request(url: string, headers: Record<string, string>, body: unknown) {
		if (!enabled) return;
		console.groupCollapsed(
			`%c[AI →] ${ts()} ${url}`,
			"color:#2196F3;font-weight:bold",
		);
		console.log("Headers:", {
			...headers,
			Authorization: headers.Authorization ? "***已隐藏***" : "(无)",
		});
		console.log("Body:", body);
		console.groupEnd();
	},

	/** AI 响应成功 */
	response(url: string, status: number, data: unknown, elapsed: number) {
		if (!enabled) return;
		console.groupCollapsed(
			`%c[AI ←] ${ts()} ${url} ${status} (${elapsed}ms)`,
			"color:#4CAF50;font-weight:bold",
		);
		console.log("Response:", data);
		console.groupEnd();
	},

	/** AI 请求失败 */
	error(url: string, status: number, body: string, elapsed: number) {
		if (!enabled) return;
		console.groupCollapsed(
			`%c[AI ✗] ${ts()} ${url} ${status} (${elapsed}ms)`,
			"color:#F44336;font-weight:bold",
		);
		console.log("Error body:", body);
		console.groupEnd();
	},

	/** 通用信息 */
	info(label: string, ...args: unknown[]) {
		if (!enabled) return;
		console.log(
			`%c[${label}] ${ts()}`,
			"color:#9C27B0;font-weight:bold",
			...args,
		);
	},

	/** 调试信息 */
	debug(label: string, ...args: unknown[]) {
		if (!enabled) return;
		console.log(
			`%c[${label}] ${ts()}`,
			"color:#607D8B;font-weight:normal",
			...args,
		);
	},

	/** 警告信息 */
	warn(label: string, ...args: unknown[]) {
		if (!enabled) return;
		console.warn(
			`%c[${label}] ${ts()}`,
			"color:#FF9800;font-weight:bold",
			...args,
		);
	},

	/** 错误信息 */
	errorGeneric(label: string, ...args: unknown[]) {
		if (!enabled) return;
		console.error(
			`%c[${label}] ${ts()}`,
			"color:#F44336;font-weight:bold",
			...args,
		);
	},

	/** 校对功能日志 */
	proofread(label: string, ...args: unknown[]) {
		if (!enabled) return;
		console.log(
			`%c[校对] ${ts()} ${label}`,
			"color:#7C4DFF;font-weight:bold",
			...args,
		);
	},

	/** 搜索功能日志 */
	search(label: string, ...args: unknown[]) {
		if (!enabled) return;
		console.log(
			`%c[搜索] ${ts()} ${label}`,
			"color:#00BCD4;font-weight:bold",
			...args,
		);
	},

	/** TTS 功能日志 */
	tts(label: string, ...args: unknown[]) {
		if (!enabled) return;
		console.log(
			`%c[TTS] ${ts()} ${label}`,
			"color:#FF5722;font-weight:bold",
			...args,
		);
	},

	/** 文件操作日志 */
	file(label: string, ...args: unknown[]) {
		if (!enabled) return;
		console.log(
			`%c[文件] ${ts()} ${label}`,
			"color:#4CAF50;font-weight:bold",
			...args,
		);
	},

	/** UI 交互日志 */
	ui(label: string, ...args: unknown[]) {
		if (!enabled) return;
		console.log(
			`%c[UI] ${ts()} ${label}`,
			"color:#E91E63;font-weight:bold",
			...args,
		);
	},
};
