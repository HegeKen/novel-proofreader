// ============================================================
// 本地 TTS（Qwen3-TTS GGUF + llama-server）前端调用层
//
// llama-server 由 Rust 侧按需拉起并常驻；前端只负责：
//   1. 查询模型 / mmproj / 运行时状态
//   2. 首次合成前确保服务已就绪（同一配置复用同一实例）
//   3. 调用 /tts 合成并把 base64 WAV 解码成 ArrayBuffer
// ============================================================
import type { TTSConfig } from "../types";
import { logger } from "./logger";
import { applyWordReplacements } from "./textReplace";

export interface LocalTtsStatus {
	binary_path: string | null;
	model_path: string | null;
	mmproj_path: string | null;
	speaker_ref_path: string | null;
	server_running: boolean;
	server_port: number | null;
	server_model_path: string | null;
	server_started_secs: number | null;
	models_dir: string;
	tools_dir: string;
	log_path: string;
	platform: string;
	error: string | null;
	mmproj_filename: string;
	mmproj_url: string;
}

export interface LocalTtsServerInfo {
	port: number;
	model_path: string;
	mmproj_path: string;
	binary_path: string;
	started_secs: number;
}

export interface LocalTtsDownloadProgress {
	kind: "mmproj" | "runtime";
	downloaded: number;
	total: number;
}

export interface VoiceDesignStatus {
	binary_path: string | null;
	model_path: string | null;
	codec_path: string | null;
	server_running: boolean;
	server_port: number | null;
	server_model_path: string | null;
	models_dir: string;
	tools_dir: string;
	log_path: string;
	platform: string;
	error: string | null;
	talker_filename: string;
	codec_filename: string;
}

export interface VoiceDesignServerInfo {
	port: number;
	model_path: string;
	codec_path: string;
	binary_path: string;
	started_secs: number;
}

export interface VoiceDesignDownloadProgress {
	kind: "vd-talker" | "vd-codec" | "crispasr";
	downloaded: number;
	total: number;
}

/** 是否运行在 Tauri 环境 */
export function isTauriRuntime(): boolean {
	return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
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

/** 查询本地朗读环境状态（路径留空时后端会自动在模型/下载目录中探测） */
export async function getLocalTtsStatus(config: TTSConfig): Promise<LocalTtsStatus | null> {
	if (!isTauriRuntime()) return null;
	try {
		return await invoke<LocalTtsStatus>("tts_local_status", {
			binaryPath: config.localBinaryPath || null,
			modelPath: config.localModelPath || null,
			mmprojPath: config.localMmprojPath || null,
			speakerRefPath: config.localSpeakerRefPath || null,
		});
	} catch (err) {
		logger.warn("[LocalTTS] 查询状态失败", errorMessage(err));
		return null;
	}
}

let serverPromise: Promise<LocalTtsServerInfo> | null = null;
let serverKey = "";

function currentServerKey(config: TTSConfig): string {
	return [
		config.localModelPath,
		config.localMmprojPath,
		config.localBinaryPath,
		config.localGpuLayers,
	].join("|");
}

/** 确保本地朗读服务已启动（同一模型/运行时复用常驻 llama-server） */
export async function ensureLocalTtsServer(config: TTSConfig): Promise<LocalTtsServerInfo> {
	if (!isTauriRuntime()) {
		throw new Error("本地朗读仅支持桌面客户端（Tauri）");
	}
	const key = currentServerKey(config);
	if (serverPromise && serverKey === key) {
		return serverPromise;
	}
	// 两种本地引擎各自占用数 GB 内存，切换时先停掉另一种
	await stopVoiceDesignServer();
	serverKey = key;
	const promise = invoke<LocalTtsServerInfo>("tts_local_start_server", {
		binaryPath: config.localBinaryPath || null,
		modelPath: config.localModelPath || null,
		mmprojPath: config.localMmprojPath || null,
		gpuLayers: config.localGpuLayers ?? -1,
		contextSize: 8192,
	});
	serverPromise = promise;
	try {
		const info = await promise;
		logger.tts("[LocalTTS] 服务就绪", { port: info.port, model: info.model_path });
		return info;
	} catch (err) {
		if (serverPromise === promise) {
			serverPromise = null;
			serverKey = "";
		}
		throw new Error(errorMessage(err));
	}
}

function resetServerCache(): void {
	serverPromise = null;
	serverKey = "";
}

/** 停止常驻服务 */
export async function stopLocalTtsServer(): Promise<void> {
	if (!isTauriRuntime()) return;
	serverPromise = null;
	serverKey = "";
	try {
		await invoke("tts_local_stop_server");
	} catch (err) {
		logger.warn("[LocalTTS] 停止服务失败", errorMessage(err));
	}
}

/** 等待 Promise，但可被 AbortSignal 提前打断 */
function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
	if (!signal) return promise;
	if (signal.aborted) {
		return Promise.reject(new DOMException("Aborted", "AbortError"));
	}
	return new Promise<T>((resolve, reject) => {
		const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
		signal.addEventListener("abort", onAbort, { once: true });
		promise.then(
			(value) => {
				signal.removeEventListener("abort", onAbort);
				resolve(value);
			},
			(err) => {
				signal.removeEventListener("abort", onAbort);
				reject(err);
			},
		);
	});
}

function decodeBase64Wav(base64: string): ArrayBuffer {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes.buffer;
}

// ── VoiceDesign（CrispASR）──────────────────────────────────────

let vdServerPromise: Promise<VoiceDesignServerInfo> | null = null;
let vdServerKey = "";

function voiceDesignServerKey(config: TTSConfig): string {
	return [
		config.voiceDesignModelPath,
		config.voiceDesignCodecPath,
		config.voiceDesignBinaryPath,
	].join("|");
}

export async function getVoiceDesignStatus(config: TTSConfig): Promise<VoiceDesignStatus | null> {
	if (!isTauriRuntime()) return null;
	try {
		return await invoke<VoiceDesignStatus>("tts_voice_design_status", {
			binaryPath: config.voiceDesignBinaryPath || null,
			modelPath: config.voiceDesignModelPath || null,
			codecPath: config.voiceDesignCodecPath || null,
		});
	} catch (err) {
		logger.warn("[VoiceDesign] 查询状态失败", errorMessage(err));
		return null;
	}
}

export async function ensureVoiceDesignServer(config: TTSConfig): Promise<VoiceDesignServerInfo> {
	if (!isTauriRuntime()) {
		throw new Error("本地朗读仅支持桌面客户端（Tauri）");
	}
	const key = voiceDesignServerKey(config);
	if (vdServerPromise && vdServerKey === key) {
		return vdServerPromise;
	}
	// 两种本地引擎各自占用数 GB 内存，切换时先停掉另一种
	await stopLocalTtsServer();
	vdServerKey = key;
	const promise = invoke<VoiceDesignServerInfo>("tts_voice_design_start_server", {
		binaryPath: config.voiceDesignBinaryPath || null,
		modelPath: config.voiceDesignModelPath || null,
		codecPath: config.voiceDesignCodecPath || null,
	});
	vdServerPromise = promise;
	try {
		const info = await promise;
		logger.tts("[VoiceDesign] 服务就绪", { port: info.port, model: info.model_path });
		return info;
	} catch (err) {
		if (vdServerPromise === promise) {
			vdServerPromise = null;
			vdServerKey = "";
		}
		throw new Error(errorMessage(err));
	}
}

export async function stopVoiceDesignServer(): Promise<void> {
	if (!isTauriRuntime()) return;
	vdServerPromise = null;
	vdServerKey = "";
	try {
		await invoke("tts_voice_design_stop_server");
	} catch (err) {
		logger.warn("[VoiceDesign] 停止服务失败", errorMessage(err));
	}
}

async function synthesizeVoiceDesignSpeech(
	text: string,
	config: TTSConfig,
	instructions: string | undefined,
	signal?: AbortSignal,
): Promise<ArrayBuffer> {
	const instruct = applyWordReplacements(
		(instructions || config.voiceDesignInstruct || "").trim(),
	);
	if (!instruct) {
		throw new Error("VoiceDesign 需要填写音色描述（设置 → TTS → 音色描述）");
	}
	await withAbort(ensureVoiceDesignServer(config), signal);
	if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

	const callSynthesize = () =>
		withAbort(
			invoke<string>("tts_voice_design_synthesize", {
				input: text,
				instructions: instruct,
				language: config.localLanguage || "zh",
				seed: 42,
			}),
			signal,
		);

	logger.tts("[VoiceDesign] 合成请求", {
		chars: text.length,
		language: config.localLanguage,
		instruct: instruct.slice(0, 80),
	});
	const started = Date.now();
	let base64: string;
	try {
		base64 = await callSynthesize();
	} catch (err) {
		const msg = errorMessage(err);
		if (msg.includes("未启动") || msg.includes("请求 VoiceDesign 服务失败")) {
			logger.warn("[VoiceDesign] 服务不可用，尝试重启", msg);
			vdServerPromise = null;
			vdServerKey = "";
			await withAbort(ensureVoiceDesignServer(config), signal);
			base64 = await callSynthesize();
		} else {
			throw err;
		}
	}
	const buffer = decodeBase64Wav(base64);
	logger.tts("[VoiceDesign] 合成完成", {
		kb: Math.round(buffer.byteLength / 1024),
		elapsedMs: Date.now() - started,
	});
	return buffer;
}

export async function downloadVoiceDesignModel(kind: "talker" | "codec"): Promise<string> {
	return invoke<string>("tts_voice_design_download_model", { kind });
}

export async function installCrispAsrRuntime(): Promise<string> {
	return invoke<string>("tts_voice_design_install_runtime");
}

export async function listenVoiceDesignDownloadProgress(
	callback: (progress: VoiceDesignDownloadProgress) => void,
): Promise<() => void> {
	if (!isTauriRuntime()) return () => {};
	const { listen } = await import("@tauri-apps/api/event");
	return listen<VoiceDesignDownloadProgress>("tts-voice-design-download-progress", (event) => {
		callback(event.payload);
	});
}

// ── 外部 OpenAI 兼容 TTS 服务 ────────────────────────────────

function externalSpeechEndpoint(baseUrl: string): string {
	const base = baseUrl.trim().replace(/\/+$/, "");
	if (!base) throw new Error("外部 TTS 服务地址为空");
	if (/\/audio\/speech$/.test(base)) return base;
	return `${base}/audio/speech`;
}

/** 调用外部 OpenAI 兼容 /v1/audio/speech 接口 */
export interface LocalSynthOptions {
	/** _synthesizeSpeech 已经在入口处做过替换时置 true，避免重复执行 */
	skipWordReplacements?: boolean;
	/** 外部服务：覆盖请求中的 voice（角色音色） */
	voice?: string;
}

/** 去掉 <laugh>、<sigh> 等尖括号标签（本地模型不支持时会按字面朗读） */
function stripAngleTags(text: string): string {
	return text.replace(/<[^<>]{1,32}>/g, "").replace(/\s{2,}/g, " ").trim();
}

/** 把常见的括号情绪提示转换为情感标签（仅在外部服务开启情感标签时使用） */
function convertEmotionCuesToTags(text: string): string {
	const rules: Array<[RegExp, string]> = [
		[/[\[（(](?:大笑|笑)[\]）)]/g, "<laugh>"],
		[/[\[（(](?:轻笑|偷笑|嗤笑)[\]）)]/g, "<chuckle>"],
		[/[\[（(](?:叹气|叹息)[\]）)]/g, "<sigh>"],
		[/[\[（(]咳嗽[\]）)]/g, "<cough>"],
		[/[\[（(](?:抽泣|吸鼻子)[\]）)]/g, "<sniffle>"],
		[/[\[（(]呻吟[\]）)]/g, "<groan>"],
		[/[\[（(]哈欠[\]）)]/g, "<yawn>"],
		[/[\[（(](?:倒吸一口气|惊呼)[\]）)]/g, "<gasp>"],
	];
	let result = text;
	for (const [pattern, tag] of rules) {
		result = result.replace(pattern, tag);
	}
	return result;
}

export async function synthesizeExternalSpeech(
	text: string,
	config: TTSConfig,
	signal?: AbortSignal,
	instructionsOverride?: string,
	options?: LocalSynthOptions,
): Promise<ArrayBuffer> {
	const replacedText = options?.skipWordReplacements ? text : applyWordReplacements(text);
	const preparedText = config.externalTtsEmotionTags
		? convertEmotionCuesToTags(replacedText)
		: stripAngleTags(replacedText);
	const preparedInstructions = instructionsOverride
		? applyWordReplacements(instructionsOverride)
		: undefined;
	const endpoint = externalSpeechEndpoint(config.externalTtsBaseUrl);
	const body: Record<string, unknown> = {
		input: preparedText,
		response_format: "wav",
	};
	if (config.externalTtsModel.trim()) body.model = config.externalTtsModel.trim();
	const voice = (options?.voice || config.externalTtsVoice).trim();
	if (voice) body.voice = voice;
	const instructions = (
		preparedInstructions || applyWordReplacements(config.externalTtsInstructions)
	).trim();
	if (instructions) body.instructions = instructions;
	if (config.externalTtsLanguage.trim()) body.language = config.externalTtsLanguage.trim();

	const apiKey = config.externalTtsApiKey.trim();
	logger.tts("[ExternalTTS] 合成请求", {
		endpoint,
		chars: preparedText.length,
		model: config.externalTtsModel || "(服务默认)",
		voice: voice || "(服务默认)",
	});
	const started = Date.now();

	// 桌面端走 Rust reqwest：第三方 TTS 服务通常没有 CORS 头，
	// WebView 直接 fetch 会报 "Load failed"。
	if (isTauriRuntime()) {
		const base64 = await withAbort(
			invoke<string>("tts_external_synthesize", {
				url: endpoint,
				apiKey: apiKey || null,
				body,
			}),
			signal,
		);
		const buffer = decodeBase64Wav(base64);
		logger.tts("[ExternalTTS] 合成完成（Rust 代理）", {
			kb: Math.round(buffer.byteLength / 1024),
			elapsedMs: Date.now() - started,
		});
		return buffer;
	}

	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (apiKey) {
		headers.Authorization = `Bearer ${apiKey}`;
	}
	const timeoutSignal = AbortSignal.timeout(120000);
	const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
	const response = await fetch(endpoint, {
		method: "POST",
		headers,
		body: JSON.stringify(body),
		signal: combined,
	});

	if (!response.ok) {
		const detail = await response.text().catch(() => "");
		throw new Error(`外部 TTS 服务错误（HTTP ${response.status}）：${detail.slice(0, 500)}`);
	}
	const contentType = response.headers.get("content-type") || "";
	const buffer = await response.arrayBuffer();
	if (buffer.byteLength === 0) {
		throw new Error("外部 TTS 服务返回了空音频");
	}
	if (contentType.includes("json")) {
		const detail = new TextDecoder().decode(buffer);
		throw new Error(`外部 TTS 服务未返回音频：${detail.slice(0, 500)}`);
	}
	logger.tts("[ExternalTTS] 合成完成（fetch）", {
		kb: Math.round(buffer.byteLength / 1024),
		contentType,
		elapsedMs: Date.now() - started,
	});
	return buffer;
}

/** 用本地模型合成一句语音，返回 WAV ArrayBuffer */
export async function synthesizeLocalSpeech(
	text: string,
	config: TTSConfig,
	signal?: AbortSignal,
	instructions?: string,
	options?: LocalSynthOptions,
): Promise<ArrayBuffer> {
	const preparedText = stripAngleTags(
		options?.skipWordReplacements ? text : applyWordReplacements(text),
	);
	// VoiceDesign 内部会统一对 instructions 做一次替换
	if (config.localEngine === "qwen3-voicedesign") {
		return synthesizeVoiceDesignSpeech(preparedText, config, instructions, signal);
	}
	await withAbort(ensureLocalTtsServer(config), signal);
	if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

	logger.tts("[LocalTTS] 合成请求", {
		chars: preparedText.length,
		language: config.localLanguage,
		speakerRef: !!config.localSpeakerRefPath,
	});
	const started = Date.now();
	const callSynthesize = () =>
		withAbort(
			invoke<string>("tts_local_synthesize", {
				input: preparedText,
				lang: config.localLanguage || "zh",
				speakerRefPath: config.localSpeakerRefPath || null,
				repeatPenalty: 1.05,
			}),
			signal,
		);

	let base64: string;
	try {
		base64 = await callSynthesize();
	} catch (err) {
		// 常驻服务可能被外部结束/异常退出：重置缓存并重启一次
		const msg = errorMessage(err);
		if (msg.includes("未启动") || msg.includes("请求本地朗读服务失败")) {
			logger.warn("[LocalTTS] 服务不可用，尝试重启", msg);
			resetServerCache();
			await withAbort(ensureLocalTtsServer(config), signal);
			base64 = await callSynthesize();
		} else {
			throw err;
		}
	}
	const buffer = decodeBase64Wav(base64);
	logger.tts("[LocalTTS] 合成完成", {
		kb: Math.round(buffer.byteLength / 1024),
		elapsedMs: Date.now() - started,
	});
	return buffer;
}

/** 下载配套 mmproj（必需），返回保存路径 */
export async function downloadLocalMmproj(): Promise<string> {
	return invoke<string>("tts_local_download_mmproj");
}

/** 自动安装 llama-server 运行时，返回可执行文件路径 */
export async function installLocalRuntime(): Promise<string> {
	return invoke<string>("tts_local_install_runtime");
}

/** 监听下载进度 */
export async function listenLocalTtsDownloadProgress(
	callback: (progress: LocalTtsDownloadProgress) => void,
): Promise<() => void> {
	if (!isTauriRuntime()) return () => {};
	const { listen } = await import("@tauri-apps/api/event");
	return listen<LocalTtsDownloadProgress>("tts-local-download-progress", (event) => {
		callback(event.payload);
	});
}

/** 本地朗读语速：把 1-10 的语义语速映射为音频播放倍率 */
export function localPlaybackRate(speed: number): number {
	const rate = 1 + (speed - 5) * 0.08;
	return Math.min(1.6, Math.max(0.6, Number(rate.toFixed(2))));
}

export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
	const units = ["B", "KB", "MB", "GB"];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}
