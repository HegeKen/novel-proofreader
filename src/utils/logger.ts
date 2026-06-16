// ============================================================
// 调试日志工具 — 支持生产环境日志持久化
// ============================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
	id: string;
	timestamp: number;
	level: LogLevel;
	category: string;
	message: string;
	data?: unknown[];
}

let enabled = false;
let minLevel: LogLevel = 'warn';
const logHistory: LogEntry[] = [];
const MAX_LOG_ENTRIES = 500;

const LEVEL_PRIORITY: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
};

const isDev = import.meta.env?.DEV ?? true;

export function setLoggerEnabled(v: boolean) {
	enabled = v;
}

export function setMinLogLevel(level: LogLevel) {
	minLevel = level;
}

export function isLoggerEnabled() {
	return enabled;
}

function addLogEntry(level: LogLevel, category: string, message: string, data?: unknown[]) {
	const entry: LogEntry = {
		id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
		timestamp: Date.now(),
		level,
		category,
		message,
		data,
	};
	logHistory.unshift(entry);
	if (logHistory.length > MAX_LOG_ENTRIES) {
		logHistory.pop();
	}
}

export function getLogHistory(): LogEntry[] {
	return [...logHistory];
}

export function clearLogHistory(): void {
	logHistory.length = 0;
}

function shouldLog(level: LogLevel): boolean {
	if (level === 'error' || level === 'warn') return true;
	if (!enabled) return false;
	return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[minLevel];
}

function ts(): string {
	return new Date().toLocaleTimeString("zh-CN", { hour12: false });
}

function formatMsg(category: string, label: string): string {
	return `[${category}] ${ts()} ${label}`;
}

export const logger = {
	request(url: string, headers: Record<string, string>, body: unknown) {
		if (!shouldLog('debug')) return;
		addLogEntry('debug', 'AI', `请求: ${url}`);
		console.groupCollapsed(
			`%c[AI →] ${ts()} ${url}`,
			"color:#2196F3;font-weight:bold",
		);
		if (isDev) {
			console.log("Headers:", { ...headers, Authorization: headers.Authorization ? "***已隐藏***" : "(无)" });
			console.log("Body:", body);
		}
		console.groupEnd();
	},

	response(url: string, status: number, data: unknown, elapsed: number) {
		if (!shouldLog('debug')) return;
		addLogEntry('debug', 'AI', `响应: ${url} ${status} (${elapsed}ms)`);
		console.groupCollapsed(
			`%c[AI ←] ${ts()} ${url} ${status} (${elapsed}ms)`,
			"color:#4CAF50;font-weight:bold",
		);
		if (isDev) console.log("Response:", data);
		console.groupEnd();
	},

	error(url: string, status: number, body: string, elapsed: number) {
		if (!shouldLog('error')) return;
		addLogEntry('error', 'AI', `错误: ${url} ${status} (${elapsed}ms)`);
		console.groupCollapsed(
			`%c[AI ✗] ${ts()} ${url} ${status} (${elapsed}ms)`,
			"color:#F44336;font-weight:bold",
		);
		console.log("Error body:", body);
		console.groupEnd();
	},

	info(label: string, ...args: unknown[]) {
		if (!shouldLog('info')) return;
		addLogEntry('info', 'INFO', label, args.length > 0 ? args : undefined);
		console.log(`%c${formatMsg('INFO', label)}`, "color:#9C27B0;font-weight:bold", ...args);
	},

	debug(label: string, ...args: unknown[]) {
		if (!shouldLog('debug')) return;
		addLogEntry('debug', 'DEBUG', label, args.length > 0 ? args : undefined);
		console.log(`%c${formatMsg('DEBUG', label)}`, "color:#607D8B;font-weight:normal", ...args);
	},

	warn(label: string, ...args: unknown[]) {
		addLogEntry('warn', 'WARN', label, args.length > 0 ? args : undefined);
		console.warn(`%c${formatMsg('WARN', label)}`, "color:#FF9800;font-weight:bold", ...args);
	},

	errorGeneric(label: string, ...args: unknown[]) {
		addLogEntry('error', 'ERROR', label, args.length > 0 ? args : undefined);
		console.error(`%c${formatMsg('ERROR', label)}`, "color:#F44336;font-weight:bold", ...args);
	},

	proofread(label: string, ...args: unknown[]) {
		if (!shouldLog('debug')) return;
		addLogEntry('debug', '校对', label, args.length > 0 ? args : undefined);
		console.log(`%c${formatMsg('校对', label)}`, "color:#7C4DFF;font-weight:bold", ...args);
	},

	search(label: string, ...args: unknown[]) {
		if (!shouldLog('debug')) return;
		addLogEntry('debug', '搜索', label, args.length > 0 ? args : undefined);
		console.log(`%c${formatMsg('搜索', label)}`, "color:#00BCD4;font-weight:bold", ...args);
	},

	tts(label: string, ...args: unknown[]) {
		if (!shouldLog('debug')) return;
		addLogEntry('debug', 'TTS', label, args.length > 0 ? args : undefined);
		console.log(`%c${formatMsg('TTS', label)}`, "color:#FF5722;font-weight:bold", ...args);
	},

	file(label: string, ...args: unknown[]) {
		if (!shouldLog('info')) return;
		addLogEntry('info', '文件', label, args.length > 0 ? args : undefined);
		console.log(`%c${formatMsg('文件', label)}`, "color:#4CAF50;font-weight:bold", ...args);
	},

	ui(label: string, ...args: unknown[]) {
		if (!shouldLog('debug')) return;
		addLogEntry('debug', 'UI', label, args.length > 0 ? args : undefined);
		console.log(`%c${formatMsg('UI', label)}`, "color:#E91E63;font-weight:bold", ...args);
	},
};
