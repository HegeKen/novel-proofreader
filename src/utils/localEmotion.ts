// ============================================================
// 本地情感分析（RoBERTa 多标签）前端调用层
//
// 模型由 Rust 侧（candle）在本地 CPU 推理，不依赖任何云端服务：
//   1. 查询模型是否已下载 / 已加载
//   2. 首次使用前下载 config.json / tokenizer.json / model.safetensors
//   3. 调用 emotion_local_analyze 获取 31 维情感概率
// ============================================================
import { formatBytes, isTauriRuntime } from "./localTts";
import { logger } from "./logger";

/** 与 Rust `EmotionStatus` 对应 */
export interface LocalEmotionStatus {
	model_dir: string;
	model_path: string;
	downloaded: boolean;
	model_size: number;
	loaded: boolean;
	error: string | null;
}

/** 与 Rust `EmotionDownloadProgress` 对应 */
export interface LocalEmotionDownloadProgress {
	file: string;
	downloaded: number;
	total: number;
}

/** 与 Rust `EmotionImportProgress` 对应 */
export interface LocalEmotionImportProgress {
	file: string;
	copied: number;
	total: number;
}

/** 单个标签的 sigmoid 概率 */
export interface EmotionLabelScore {
	label: string;
	probability: number;
}

/** 与 Rust `EmotionPrediction` 对应 */
export interface EmotionPrediction {
	labels: EmotionLabelScore[];
	top_label: string;
	top_probability: number;
	tone_label: string;
	tone_probability: number;
	tokens: number;
	elapsed_ms: number;
}

function errorMessage(err: unknown): string {
	if (err instanceof Error) return err.message;
	if (typeof err === "string") return err;
	return JSON.stringify(err);
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
	const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
	return tauriInvoke<T>(command, args);
}

/** 查询本地情感模型状态（非 Tauri 环境返回 null） */
export async function getLocalEmotionStatus(): Promise<LocalEmotionStatus | null> {
	if (!isTauriRuntime()) return null;
	try {
		return await invoke<LocalEmotionStatus>("emotion_local_status");
	} catch (err) {
		logger.warn("[LocalEmotion] 查询状态失败", errorMessage(err));
		return null;
	}
}

/** 是否已下载完整模型 */
export async function isLocalEmotionReady(): Promise<boolean> {
	const status = await getLocalEmotionStatus();
	return !!status?.downloaded;
}

/** 下载模型文件（约 390MB，支持镜像回退） */
export async function downloadLocalEmotionModel(): Promise<LocalEmotionStatus> {
	if (!isTauriRuntime()) {
		throw new Error("本地情感分析仅支持桌面客户端（Tauri）");
	}
	return invoke<LocalEmotionStatus>("emotion_local_download");
}

/**
 * 手动导入本地模型目录（目录内需包含 config.json / tokenizer.json / model.safetensors）。
 * 文件会被复制到应用模型目录，成功后即可离线使用。
 */
export async function importLocalEmotionModel(sourceDir: string): Promise<LocalEmotionStatus> {
	if (!isTauriRuntime()) {
		throw new Error("本地情感分析仅支持桌面客户端（Tauri）");
	}
	return invoke<LocalEmotionStatus>("emotion_local_import_dir", { sourceDir });
}

/** 释放已加载的模型内存 */
export async function unloadLocalEmotionModel(): Promise<LocalEmotionStatus | null> {
	if (!isTauriRuntime()) return null;
	return invoke<LocalEmotionStatus>("emotion_local_unload");
}

/** 监听下载进度 */
export async function listenLocalEmotionDownloadProgress(
	callback: (progress: LocalEmotionDownloadProgress) => void,
): Promise<() => void> {
	if (!isTauriRuntime()) return () => {};
	const { listen } = await import("@tauri-apps/api/event");
	return listen<LocalEmotionDownloadProgress>("emotion-download-progress", (event) => {
		callback(event.payload);
	});
}

/** 监听手动导入进度 */
export async function listenLocalEmotionImportProgress(
	callback: (progress: LocalEmotionImportProgress) => void,
): Promise<() => void> {
	if (!isTauriRuntime()) return () => {};
	const { listen } = await import("@tauri-apps/api/event");
	return listen<LocalEmotionImportProgress>("emotion-import-progress", (event) => {
		callback(event.payload);
	});
}

/**
 * 对文本做本地情感分析。
 * @param text 当前段落
 * @param context 上文（可为空；模型训练时使用「上文 + 当前段落」双句输入）
 */
export async function analyzeEmotionLocal(text: string, context = ""): Promise<EmotionPrediction> {
	if (!isTauriRuntime()) {
		throw new Error("本地情感分析仅支持桌面客户端（Tauri）");
	}
	if (!text.trim()) {
		throw new Error("待分析文本为空");
	}
	return invoke<EmotionPrediction>("emotion_local_analyze", {
		text,
		context: context.trim() || null,
	});
}

/** 人类可读的模型大小 */
export function formatEmotionModelSize(status: LocalEmotionStatus | null): string {
	if (!status || status.model_size <= 0) return "未下载";
	return formatBytes(status.model_size);
}

/** 人类可读的字节数（下载进度用） */
export function formatEmotionBytes(bytes: number): string {
	return formatBytes(bytes);
}
