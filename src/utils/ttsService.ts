import type { TTSConfig } from "../stores/configStore";
import { logger } from "./logger";
import { useAppMetaStore } from "../stores/appMetaStore";

interface AudioCacheEntry {
	audioBuffer: ArrayBuffer;
	timestamp: number;
}

interface PersistedAudioCacheEntry {
	audioData: string;
	timestamp: number;
}

class AudioCacheManager {
	private cache: Map<string, AudioCacheEntry> = new Map();
	private maxCacheSize: number = 50;
	private maxCacheAge: number = 30 * 60 * 1000; // 30分钟
	private storageKey: string = "novel-proofreader-audio-cache";
	private metaKey: string = "novel-proofreader-audio-cache-meta";
	private isPersistent: boolean = false;

	constructor() {
		this.loadPersistentSetting();
		this.loadFromStorage();
	}

	private loadPersistentSetting(): void {
		try {
			const meta = localStorage.getItem(this.metaKey);
			if (meta) {
				const data = JSON.parse(meta);
				this.isPersistent = data.isPersistent || false;
				logger.tts(`Loaded persistent setting: ${this.isPersistent}`);
			}
		} catch (e) {
			logger.errorGeneric("Failed to load audio cache meta", { error: e });
		}
	}

	private savePersistentSetting(): void {
		try {
			localStorage.setItem(this.metaKey, JSON.stringify({ isPersistent: this.isPersistent }));
		} catch (e) {
			logger.errorGeneric("Failed to save audio cache meta", { error: e });
		}
	}

	setPersistent(enabled: boolean): void {
		logger.tts(`Setting persistent: ${enabled} (was: ${this.isPersistent})`);
		this.isPersistent = enabled;
		this.savePersistentSetting();
		if (enabled) {
			this.saveToStorage();
		}
	}

	getPersistent(): boolean {
		return this.isPersistent;
	}

	generateKey(text: string, config: TTSConfig, voice?: string): string {
		const effectiveVoice = voice || config.voice || "";
		return `${text}:${effectiveVoice}:${config.speed}:${config.volume}`;
	}

	get(key: string, config: TTSConfig): ArrayBuffer | undefined {
		if (!config.audioCacheEnabled) return undefined;

		const entry = this.cache.get(key);
		if (!entry) return undefined;

		// 检查缓存是否过期
		if (Date.now() - entry.timestamp > this.maxCacheAge) {
			this.cache.delete(key);
			this.saveToStorage();
			return undefined;
		}

		return entry.audioBuffer;
	}

	set(key: string, audioBuffer: ArrayBuffer, config: TTSConfig): void {
		if (!config.audioCacheEnabled) {
			logger.tts("Audio cache disabled, skipping cache set", { key: key.slice(0, 30) });
			return;
		}

		logger.tts("Setting audio cache", { 
			key: key.slice(0, 50), 
			bufferSize: audioBuffer.byteLength, 
			isPersistent: this.isPersistent,
			currentCacheSize: this.cache.size 
		});

		// 如果缓存已满，删除最旧的条目
		if (this.cache.size >= this.maxCacheSize) {
			const oldestKey = Array.from(this.cache.entries())
				.sort((a, b) => a[1].timestamp - b[1].timestamp)[0]?.[0];
			if (oldestKey) {
				logger.tts("Cache full, removing oldest entry", { key: oldestKey.slice(0, 30) });
				this.cache.delete(oldestKey);
			}
		}

		this.cache.set(key, {
			audioBuffer,
			timestamp: Date.now(),
		});

		if (this.isPersistent) {
			logger.tts("Persistent enabled, saving to storage", { cacheSize: this.cache.size });
			this.saveToStorage();
		} else {
			logger.tts("Persistent not enabled, skipping storage save", { cacheSize: this.cache.size });
		}
	}

	clear(): void {
		this.cache.clear();
		if (this.isPersistent) {
			localStorage.removeItem(this.storageKey);
		}
	}

	getSize(): number {
		return this.cache.size;
	}

	private loadFromStorage(): void {
		try {
			const stored = localStorage.getItem(this.storageKey);
			if (stored) {
				const data: Record<string, PersistedAudioCacheEntry> = JSON.parse(stored);
				const now = Date.now();

				for (const [key, entry] of Object.entries(data)) {
					// 检查过期时间
					if (now - entry.timestamp <= this.maxCacheAge) {
						try {
							const binaryString = atob(entry.audioData);
							const bytes = new Uint8Array(binaryString.length);
							for (let i = 0; i < binaryString.length; i++) {
								bytes[i] = binaryString.charCodeAt(i);
							}
							this.cache.set(key, {
								audioBuffer: bytes.buffer as ArrayBuffer,
								timestamp: entry.timestamp,
							});
						} catch (e) {
							logger.warn("Failed to decode cached audio data", { key, error: e });
						}
					}
				}
				logger.tts(`Loaded ${this.cache.size} audio entries from storage`);
			}
		} catch (e) {
			logger.errorGeneric("Failed to load audio cache from storage", { error: e });
		}
	}

	private saveToStorage(): void {
		if (!this.isPersistent) return;

		try {
			const data: Record<string, PersistedAudioCacheEntry> = {};

			this.cache.forEach((entry, key) => {
				const bytes = new Uint8Array(entry.audioBuffer);
				let binaryString = "";
				for (let i = 0; i < bytes.length; i++) {
					binaryString += String.fromCharCode(bytes[i]);
				}
				data[key] = {
					audioData: btoa(binaryString),
					timestamp: entry.timestamp,
				};
			});

			localStorage.setItem(this.storageKey, JSON.stringify(data));
			logger.tts(`Saved ${this.cache.size} audio entries to storage`);
		} catch (e) {
			logger.errorGeneric("Failed to save audio cache to storage", { error: e });
		}
	}
}

const audioCache = new AudioCacheManager();

export { audioCache };

export interface TTSSentence {
	index: number;
	paragraphIndex: number;
	text: string;
	audioUrl?: string;
	audioBuffer?: ArrayBuffer;
	isPlaying: boolean;
	isCompleted: boolean;
}

const MIMO_TTS_MODEL = "mimo-v2.5-tts";
const MIMO_VOICEDESIGN_MODEL = "mimo-v2.5-tts-voicedesign";

interface MiMoAudioObject {
	id: string;
	data: string;
	expires_at: string | null;
	transcript: string | null;
}

interface MiMoMessage {
	content: string;
	role: string;
	audio: MiMoAudioObject;
}

interface MiMoChoice {
	finish_reason: string;
	index: number;
	message: MiMoMessage;
	tool_calls: unknown;
}

interface MiMoTTSResponse {
	id: string;
	choices: MiMoChoice[];
	created: number;
	model: string;
	object: string;
	usage: unknown;
	error?: {
		message: string;
		type: string;
		code: string;
	};
}

export async function synthesizeSpeech(
	text: string,
	config: TTSConfig,
	voiceDesignPrompt?: string
): Promise<ArrayBuffer> {
	const apiKey = config.apiKey;
	const voice = config.voice;
	const speed = config.speed;
	const volume = config.volume;

	if (!apiKey) {
		throw new Error("TTS API Key 未配置，请在 TTS 设置中配置 MiMo API Key");
	}

	const baseUrl = config.baseUrl.replace(/\/$/, "");
	const url = `${baseUrl}/chat/completions`;

	// 判断是否使用音色设计模型
	const useVoiceDesign = !!voiceDesignPrompt;
	const model = useVoiceDesign ? MIMO_VOICEDESIGN_MODEL : MIMO_TTS_MODEL;

	// 构建请求体
	const messages: Array<{ role: string; content: string }> = [
		{ role: "assistant", content: text },
	];

	if (useVoiceDesign) {
		// 使用音色设计模型时，user消息中的文本就是音色设计描述
		messages.push({
			role: "user",
			content: voiceDesignPrompt,
		});
	} else {
		messages.push({
			role: "user",
			content: `语速：${speed}（1最慢，10最快）\n音量：${volume}（1最低，10最高）\n你是专业小说有声书演播大神...`,
		});
	}

	const requestBody: Record<string, unknown> = {
		model,
		messages,
		max_completion_tokens: 1024,
	};

	// 只有在不使用音色设计模型时才添加audio.voice
	if (!useVoiceDesign) {
		(requestBody as Record<string, unknown>).audio = { voice: voice };
	}

	logger.tts("发起 TTS 请求", { text: text.slice(0, 50) + "...", voice, speed, volume });
	const startTime = Date.now();

	const response = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify(requestBody),
	});

	const elapsed = Date.now() - startTime;

	if (!response.ok) {
		const errorText = await response.text();
		logger.errorGeneric("TTS API 请求失败", { status: response.status, error: errorText, elapsed });
		useAppMetaStore.getState().incrementAPIUsage("mimo", false);
		throw new Error(`TTS API 错误: ${response.status} - ${errorText}`);
	}

	const data: MiMoTTSResponse = await response.json();
	logger.tts("TTS 请求成功", {
		status: response.status,
		elapsed,
		response: {
			id: data.id,
			model: data.model,
			choicesCount: data.choices?.length,
			hasAudio: !!data.choices?.[0]?.message?.audio?.data,
			audioDataLength: data.choices?.[0]?.message?.audio?.data?.length,
			audioExpiresAt: data.choices?.[0]?.message?.audio?.expires_at,
			transcript: data.choices?.[0]?.message?.audio?.transcript,
			error: data.error,
		},
	});

	if (data.error) {
		logger.errorGeneric("TTS 错误", { error: data.error });
		useAppMetaStore.getState().incrementAPIUsage("mimo", false);
		throw new Error(`TTS 错误: ${data.error.message}`);
	}

	const audioData = data.choices?.[0]?.message?.audio?.data;
	if (!audioData) {
		logger.warn("TTS 响应缺少 audio 字段");
		useAppMetaStore.getState().incrementAPIUsage("mimo", false);
		throw new Error("TTS 响应中缺少 audio 字段");
	}

	useAppMetaStore.getState().incrementAPIUsage("mimo", true);

	logger.tts("TTS 音频数据", { audioDataLength: audioData.length });
	const binaryString = atob(audioData);
	const bytes = new Uint8Array(binaryString.length);
	for (let i = 0; i < binaryString.length; i++) {
		bytes[i] = binaryString.charCodeAt(i);
	}
	return bytes.buffer as ArrayBuffer;
}

export async function synthesizeSpeechWithVoice(
	text: string,
	config: TTSConfig,
	voice: string,
	voiceDesignPrompt?: string
): Promise<ArrayBuffer> {
	const apiKey = config.apiKey;
	const speed = config.speed;
	const volume = config.volume;

	if (!apiKey) {
		throw new Error("TTS API Key 未配置，请在 TTS 设置中配置 MiMo API Key");
	}

	const baseUrl = config.baseUrl.replace(/\/$/, "");
	const url = `${baseUrl}/chat/completions`;

	// 判断是否使用音色设计模型
	const useVoiceDesign = !!voiceDesignPrompt;
	const model = useVoiceDesign ? MIMO_VOICEDESIGN_MODEL : MIMO_TTS_MODEL;

	// 构建请求体
	const messages: Array<{ role: string; content: string }> = [
		{ role: "assistant", content: text },
	];

	if (useVoiceDesign) {
		// 使用音色设计模型时，user消息中的文本就是音色设计描述
		messages.push({
			role: "user",
			content: voiceDesignPrompt,
		});
	} else {
		messages.push({
			role: "user",
			content: `语速：${speed}（1最慢，10最快）\n音量：${volume}（1最低，10最高）\n你是专业小说有声书演播大神...`,
		});
	}

	const requestBody: Record<string, unknown> = {
		model,
		messages,
		max_completion_tokens: 1024,
	};

	// 只有在不使用音色设计模型时才添加audio.voice
	if (!useVoiceDesign) {
		(requestBody as Record<string, unknown>).audio = { voice: voice };
	}

	logger.tts("发起 TTS 请求（角色配音）", { text: text.slice(0, 50) + "...", voice, speed, volume });
	const startTime = Date.now();

	const response = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify(requestBody),
	});

	const elapsed = Date.now() - startTime;

	if (!response.ok) {
		const errorText = await response.text();
		logger.errorGeneric("TTS API 请求失败", { status: response.status, error: errorText, elapsed });
		useAppMetaStore.getState().incrementAPIUsage("mimo", false);
		throw new Error(`TTS API 错误: ${response.status} - ${errorText}`);
	}

	const data: MiMoTTSResponse = await response.json();
	logger.tts("TTS 请求成功", {
		status: response.status,
		elapsed,
		response: {
			id: data.id,
			model: data.model,
			choicesCount: data.choices?.length,
			hasAudio: !!data.choices?.[0]?.message?.audio?.data,
			audioDataLength: data.choices?.[0]?.message?.audio?.data?.length,
			audioExpiresAt: data.choices?.[0]?.message?.audio?.expires_at,
			transcript: data.choices?.[0]?.message?.audio?.transcript,
			error: data.error,
		},
	});

	if (data.error) {
		logger.errorGeneric("TTS 错误", { error: data.error });
		useAppMetaStore.getState().incrementAPIUsage("mimo", false);
		throw new Error(`TTS 错误: ${data.error.message}`);
	}

	const audioData = data.choices?.[0]?.message?.audio?.data;
	if (!audioData) {
		logger.warn("TTS 响应缺少 audio 字段");
		useAppMetaStore.getState().incrementAPIUsage("mimo", false);
		throw new Error("TTS 响应中缺少 audio 字段");
	}

	useAppMetaStore.getState().incrementAPIUsage("mimo", true);

	logger.tts("TTS 音频数据", { audioDataLength: audioData.length });
	const binaryString = atob(audioData);
	const bytes = new Uint8Array(binaryString.length);
	for (let i = 0; i < binaryString.length; i++) {
		bytes[i] = binaryString.charCodeAt(i);
	}
	return bytes.buffer as ArrayBuffer;
}

export function playAudio(arrayBuffer: ArrayBuffer, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new DOMException("Aborted", "AbortError"));
			return;
		}

		const blob = new Blob([arrayBuffer], { type: "audio/mp3" });
		const url = URL.createObjectURL(blob);
		const audio = new Audio();
		let cleaned = false;

		const cleanup = () => {
			if (!cleaned) {
				cleaned = true;
				URL.revokeObjectURL(url);
			}
		};

		const onAbort = () => {
			audio.pause();
			audio.src = "";
			cleanup();
			reject(new DOMException("Aborted", "AbortError"));
		};
		signal?.addEventListener("abort", onAbort, { once: true });

		const startPlayback = () => {
			if (signal?.aborted) {
				cleanup();
				signal?.removeEventListener("abort", onAbort);
				reject(new DOMException("Aborted", "AbortError"));
				return;
			}
			audio.currentTime = 0;
			audio.play().catch((error) => {
				cleanup();
				signal?.removeEventListener("abort", onAbort);
				reject(error);
			});
		};

		audio.onloadedmetadata = () => {
			startPlayback();
		};

		audio.oncanplay = () => {
			if (audio.currentTime > 0) {
				audio.currentTime = 0;
			}
		};

		audio.onended = () => {
			cleanup();
			signal?.removeEventListener("abort", onAbort);
			resolve();
		};

		audio.onerror = (e) => {
			cleanup();
			signal?.removeEventListener("abort", onAbort);
			reject(new Error(`音频播放失败: ${e}`));
		};

		audio.src = url;
		audio.load();
	});
}

export function splitTextIntoSentences(text: string): string[] {
	const sentenceEndings = /([。！？；\n]+)/;
	const sentences: string[] = [];

	const parts = text.split(sentenceEndings);

	for (let i = 0; i < parts.length; i += 2) {
		const content = parts[i] || "";
		const punctuation = parts[i + 1] || "";

		if (content.trim()) {
			sentences.push(content.trim() + punctuation);
		}
	}

	return sentences.filter((s) => s.trim().length > 0);
}

export class TTSPlayer {
	private config: TTSConfig;
	private sentences: TTSSentence[] = [];
	private currentIndex: number = 0;
	private isPlaying: boolean = false;
	private isPaused: boolean = false;

	getPaused(): boolean {
		return this.isPaused;
	}
	private onUpdate?: (sentences: TTSSentence[]) => void;
	private onComplete?: () => void;
	private cancelCurrentAudio: (() => void) | null = null;
	private abortController: AbortController | null = null;

	constructor(config: TTSConfig) {
		this.config = config;
	}

	updateConfig(config: TTSConfig) {
		this.config = config;
	}

	setOnUpdate(callback: (sentences: TTSSentence[]) => void) {
		this.onUpdate = callback;
	}

	setOnComplete(callback: () => void) {
		this.onComplete = callback;
	}

	async loadText(text: string, startParaIndex?: number): Promise<void>;
	async loadText(paragraphs: string[], startParaIndex?: number): Promise<void>;
	async loadText(textOrParagraphs: string | string[], startParaIndex: number = 0): Promise<void> {
		if (typeof textOrParagraphs === "string") {
			const rawSentences = splitTextIntoSentences(textOrParagraphs);
			this.sentences = rawSentences.map((text, index) => ({
				index,
				paragraphIndex: 0,
				text,
				isPlaying: false,
				isCompleted: false,
			}));
			this.currentIndex = startParaIndex === 0 ? 0 : Math.min(startParaIndex, this.sentences.length - 1);
		} else {
			const paragraphs = textOrParagraphs;
			const sentences: TTSSentence[] = [];
			let sentenceIndex = 0;
			for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
				const para = paragraphs[pIdx];
				const rawSentences = splitTextIntoSentences(para);
				for (const text of rawSentences) {
					sentences.push({
						index: sentenceIndex++,
						paragraphIndex: pIdx,
						text,
						isPlaying: false,
						isCompleted: false,
					});
				}
			}
			this.sentences = sentences;
			if (startParaIndex > 0) {
				this.currentIndex = sentences.findIndex(s => s.paragraphIndex >= startParaIndex);
				if (this.currentIndex < 0) this.currentIndex = 0;
			} else {
				this.currentIndex = 0;
			}
		}
		this.isPlaying = false;
		this.isPaused = false;
		logger.tts("加载文本", { sentenceCount: this.sentences.length, type: typeof textOrParagraphs === "string" ? "string" : "paragraphs" });
		this.notifyUpdate();
	}

	async play() {
		if (this.sentences.length === 0) {
			logger.warn("TTS 播放失败: 句子列表为空");
			return;
		}

		logger.tts("开始播放", { currentIndex: this.currentIndex, totalSentences: this.sentences.length });
		this.isPlaying = true;
		this.isPaused = false;

		while (this.currentIndex < this.sentences.length && this.isPlaying) {
			if (this.isPaused) {
				await this.waitForResume();
			}

			if (!this.isPlaying) break;

			try {
				await this.playSentence(this.currentIndex);

				if (this.isPlaying) {
					this.currentIndex++;
				}
			} catch (error) {
				logger.errorGeneric("播放句子失败", { index: this.currentIndex, error });
				// 遇到错误时继续播放下一句，而不是中断整个播放
				if (this.isPlaying) {
					this.currentIndex++;
				}
			}
		}

		if (this.currentIndex >= this.sentences.length) {
			logger.tts("播放完成", { finalIndex: this.currentIndex });
			this.isPlaying = false;
			this.onComplete?.();
		}

		this.notifyUpdate();
	}

	pause() {
		logger.tts("暂停播放", { pausedAtIndex: this.currentIndex });
		if (this.abortController) {
			this.abortController.abort();
			this.abortController = null;
		}
		if (this.cancelCurrentAudio) {
			this.cancelCurrentAudio();
			this.cancelCurrentAudio = null;
		}
		this.isPaused = true;
		this.isPlaying = false;
		this.notifyUpdate();
	}

	resume() {
		if (this.isPaused) {
			logger.tts("恢复播放", { resumeFromIndex: this.currentIndex });
			this.isPaused = false;
			this.play();
		}
	}

	stop() {
		logger.tts("停止播放", { stoppedAtIndex: this.currentIndex });
		if (this.abortController) {
			this.abortController.abort();
			this.abortController = null;
		}
		if (this.cancelCurrentAudio) {
			this.cancelCurrentAudio();
			this.cancelCurrentAudio = null;
		}
		this.isPlaying = false;
		this.isPaused = false;
		this.currentIndex = 0;
		this.sentences = this.sentences.map((s) => ({
			...s,
			isPlaying: false,
			isCompleted: false,
		}));
		this.notifyUpdate();
	}

	skipTo(index: number) {
		if (index >= 0 && index < this.sentences.length) {
			if (this.abortController) {
				this.abortController.abort();
				this.abortController = null;
			}
			if (this.cancelCurrentAudio) {
				this.cancelCurrentAudio();
				this.cancelCurrentAudio = null;
			}
			this.currentIndex = index;
			this.sentences = this.sentences.map((s, i) => ({
				...s,
				isPlaying: i === index,
				isCompleted: i < index,
			}));
			logger.tts("跳转到句子", { index, paragraphIndex: this.sentences[index]?.paragraphIndex });
			this.notifyUpdate();
		}
	}

	skipToPrevParagraph() {
		if (this.sentences.length === 0) return;
		const currentParaIdx = this.getCurrentParagraphIndex();
		const firstSentenceOfCurrentPara = this.sentences.findIndex(
			(s) => s.paragraphIndex === currentParaIdx,
		);
		if (firstSentenceOfCurrentPara > 0) {
			const prevParaFirstSentence = this.sentences.findLastIndex(
				(s) => s.paragraphIndex === currentParaIdx - 1,
			);
			if (prevParaFirstSentence >= 0) {
				logger.tts("跳转到上一段", { fromParagraph: currentParaIdx, toParagraph: currentParaIdx - 1 });
				this.skipTo(prevParaFirstSentence);
			}
		}
	}

	skipToNextParagraph() {
		if (this.sentences.length === 0) return;
		const currentParaIdx = this.getCurrentParagraphIndex();
		const nextParaFirstSentence = this.sentences.findIndex(
			(s) => s.paragraphIndex === currentParaIdx + 1,
		);
		if (nextParaFirstSentence >= 0) {
			logger.tts("跳转到下一段", { fromParagraph: currentParaIdx, toParagraph: currentParaIdx + 1 });
			this.skipTo(nextParaFirstSentence);
		}
	}

	skipToPrev() {
		if (this.sentences.length === 0) return;
		if (this.currentIndex > 0) {
			logger.tts("跳转到上一条", { fromIndex: this.currentIndex, toIndex: this.currentIndex - 1 });
			this.skipTo(this.currentIndex - 1);
		}
	}

	skipToNext() {
		if (this.sentences.length === 0) return;
		if (this.currentIndex < this.sentences.length - 1) {
			logger.tts("跳转到下一条", { fromIndex: this.currentIndex, toIndex: this.currentIndex + 1 });
			this.skipTo(this.currentIndex + 1);
		}
	}

	findSentenceIndexByParagraph(paragraphIndex: number): number {
		return this.sentences.findIndex((s) => s.paragraphIndex === paragraphIndex);
	}

	getSentences() {
		return this.sentences;
	}

	getCurrentIndex() {
		return this.currentIndex;
	}

	getIsPlaying() {
		return this.isPlaying;
	}

	getIsPaused() {
		return this.isPaused;
	}

	getCurrentParagraphIndex(): number {
		if (this.currentIndex >= 0 && this.currentIndex < this.sentences.length) {
			return this.sentences[this.currentIndex].paragraphIndex;
		}
		return -1;
	}

	private async playSentence(index: number): Promise<void> {
		const sentence = this.sentences[index];
		if (!sentence) {
			logger.warn("播放句子失败: 句子不存在", { index });
			return;
		}

		logger.tts("播放句子", { index, paragraphIndex: sentence.paragraphIndex, text: sentence.text.slice(0, 30) + "..." });

		// 创建新的 AbortController 用于取消本次播放
		this.abortController = new AbortController();

		let cancelled = false;
		const audioRef = { current: null as HTMLAudioElement | null };
		const cancelFn = () => {
			cancelled = true;
			if (audioRef.current) {
				audioRef.current.pause();
				audioRef.current.src = "";
			}
		};
		this.cancelCurrentAudio = cancelFn;

		this.sentences = this.sentences.map((s, i) => ({
			...s,
			isPlaying: i === index,
		}));
		this.notifyUpdate();

		for (let attempt = 0; attempt < 2; attempt++) {
			// 使用 this.abortController.signal 而不是缓存的 signal，确保检查最新的中止状态
			if (cancelled || !this.isPlaying || this.abortController?.signal.aborted) {
				logger.tts("句子播放被取消或停止", { index, cancelled, isPlaying: this.isPlaying });
				return;
			}

			try {
				let audioBuffer = sentence.audioBuffer;

				if (!audioBuffer && this.config.audioCacheEnabled) {
					// 尝试从全局缓存获取
					const cacheKey = audioCache.generateKey(sentence.text, this.config);
					audioBuffer = audioCache.get(cacheKey, this.config);

					if (!audioBuffer) {
						// 需要生成音频
						logger.tts("生成句子音频", { index, fromCache: false });
						audioBuffer = await synthesizeSpeech(sentence.text, this.config);
						// 缓存到全局和本地
						audioCache.set(cacheKey, audioBuffer, this.config);
						this.sentences[index] = { ...this.sentences[index], audioBuffer };
					} else {
						logger.tts("使用缓存音频", { index, fromCache: true, cacheSize: audioCache.getSize() });
						// 更新本地缓存
						this.sentences[index] = { ...this.sentences[index], audioBuffer };
					}
				} else if (!audioBuffer) {
					// 缓存未启用，直接生成音频
					logger.tts("生成句子音频（缓存未启用）", { index, fromCache: false });
					audioBuffer = await synthesizeSpeech(sentence.text, this.config);
				} else {
					logger.tts("使用本地缓存音频", { index, fromCache: true });
				}

				if (cancelled || !this.isPlaying || this.abortController?.signal.aborted) {
					logger.tts("句子播放被取消或停止（音频合成后）", { index, cancelled, isPlaying: this.isPlaying });
					return;
				}

				await playAudio(audioBuffer, this.abortController?.signal);

				if (cancelled || !this.isPlaying || this.abortController?.signal.aborted) {
					logger.tts("句子播放被取消或停止（音频播放后）", { index, cancelled, isPlaying: this.isPlaying });
					return;
				}

				this.sentences = this.sentences.map((s, i) => ({
					...s,
					isCompleted: i <= index && i !== index ? s.isCompleted : i === index,
				}));
				logger.tts("句子播放完成", { index, paragraphIndex: sentence.paragraphIndex });
				this.notifyUpdate();
				this.cancelCurrentAudio = null;
				this.abortController = null;
				return;
			} catch (error) {
				if (error instanceof DOMException && error.name === "AbortError") {
					logger.tts("句子播放被中断（AbortError）", { index });
					return;
				}
				if (cancelled || !this.isPlaying) {
					logger.tts("句子播放被取消或停止（异常捕获）", { index, cancelled, isPlaying: this.isPlaying });
					return;
				}

				const errorMsg = error instanceof Error ? error.message : String(error);

				if (errorMsg.includes("TTS 响应中缺少 audio 字段")) {
					if (attempt === 0) {
						logger.warn("句子音频获取失败，准备重试", { index, attempt, error: errorMsg });
						await new Promise((resolve) => setTimeout(resolve, 100));
						continue;
					}
				}

				logger.errorGeneric("句子播放失败", { index, attempt, error: errorMsg });
				break;
			}
		}

		this.cancelCurrentAudio = null;
		this.abortController = null;
		this.sentences = this.sentences.map((s) => ({
			...s,
			isPlaying: false,
		}));
		this.notifyUpdate();
	}

	private waitForResume(): Promise<void> {
		return new Promise((resolve) => {
			const check = () => {
				if (!this.isPaused) {
					resolve();
				} else {
					setTimeout(check, 100);
				}
			};
			check();
		});
	}

	private notifyUpdate() {
		this.onUpdate?.([...this.sentences]);
	}
}

export interface ScriptDialogue {
	index: number;
	character: string;
	text: string;
	voice: string;
	voiceDesignPrompt?: string; // 音色设计描述，用于 mimo-v2.5-tts-voicedesign 模型
	audioBuffer?: ArrayBuffer;
	isPlaying: boolean;
	isCompleted: boolean;
	paragraphIndex?: number;
}

export function parseScriptContent(content: string): { characters: string[]; dialogues: ScriptDialogue[] } {
	const characters = new Set<string>();
	const dialogues: ScriptDialogue[] = [];

	const lines = content.split("\n");
	let dialogueIndex = 0;

	for (const line of lines) {
		const trimmedLine = line.trim();
		if (!trimmedLine) continue;

		const characterMatch = trimmedLine.match(/^【?(.*?)】?：/);
		if (characterMatch) {
			const character = characterMatch[1];
			const text = trimmedLine.substring(characterMatch[0].length).trim();

			if (character && text && !["动作", "场景", "转场", "内心独白"].includes(character)) {
				characters.add(character);
				dialogues.push({
					index: dialogueIndex++,
					character,
					text,
					voice: "",
					isPlaying: false,
					isCompleted: false,
				});
			}
		}
	}

	return {
		characters: Array.from(characters).sort(),
		dialogues,
	};
}

export class ScriptTTSPlayer {
	private config: TTSConfig;
	private dialogues: ScriptDialogue[] = [];
	private currentIndex: number = 0;
	private isPlaying: boolean = false;
	private isPaused: boolean = false;
	private onUpdate?: (dialogues: ScriptDialogue[]) => void;
	private onComplete?: () => void;
	private cancelCurrentAudio: (() => void) | null = null;
	private abortController: AbortController | null = null;
	private audioQueue: { buffer: ArrayBuffer; dialogueIndex: number }[] = [];
	private isProcessingQueue: boolean = false;
	private isStreamComplete: boolean = false;

	constructor(config: TTSConfig) {
		this.config = config;
	}

	updateConfig(config: TTSConfig) {
		this.config = config;
	}

	setOnUpdate(callback: (dialogues: ScriptDialogue[]) => void) {
		this.onUpdate = callback;
	}

	setOnComplete(callback: () => void) {
		this.onComplete = callback;
	}

	loadScript(content: string) {
		const { characters, dialogues } = parseScriptContent(content);

		const voiceMap: Record<string, string> = this.config.characterVoices || {};
		const defaultVoice = this.config.voice || "冰糖";

		this.dialogues = dialogues.map((d) => ({
			...d,
			voice: voiceMap[d.character] || defaultVoice,
		}));

		this.currentIndex = 0;
		this.isPlaying = false;
		this.isPaused = false;
		logger.tts("加载剧本", { characterCount: characters.length, dialogueCount: this.dialogues.length, characters });
		this.notifyUpdate();
	}

	async play() {
		if (this.dialogues.length === 0) {
			logger.warn("剧本播放失败: 对话列表为空");
			return;
		}

		logger.tts("开始播放剧本", { currentIndex: this.currentIndex, totalDialogues: this.dialogues.length });
		this.isPlaying = true;
		this.isPaused = false;

		while (this.currentIndex < this.dialogues.length && this.isPlaying) {
			if (this.isPaused) {
				await this.waitForResume();
			}

			if (!this.isPlaying) break;

			await this.playDialogue(this.currentIndex);

			if (this.isPlaying) {
				this.currentIndex++;
			}
		}

		if (this.currentIndex >= this.dialogues.length) {
			logger.tts("剧本播放完成", { finalIndex: this.currentIndex });
			this.isPlaying = false;
			this.onComplete?.();
		}

		this.notifyUpdate();
	}

	pause() {
		logger.tts("暂停剧本播放", { pausedAtIndex: this.currentIndex });
		this.isPaused = true;
		this.isPlaying = false;
		if (this.abortController) {
			this.abortController.abort();
			this.abortController = null;
		}
		if (this.cancelCurrentAudio) {
			this.cancelCurrentAudio();
			this.cancelCurrentAudio = null;
		}
		this.notifyUpdate();
	}

	resume() {
		if (this.isPaused) {
			logger.tts("恢复剧本播放", { resumeFromIndex: this.currentIndex });
			this.isPaused = false;
			this.play();
		}
	}

	stop() {
		logger.tts("停止剧本播放", { stoppedAtIndex: this.currentIndex });
		if (this.abortController) {
			this.abortController.abort();
			this.abortController = null;
		}
		if (this.cancelCurrentAudio) {
			this.cancelCurrentAudio();
			this.cancelCurrentAudio = null;
		}
		this.isPlaying = false;
		this.isPaused = false;
		this.currentIndex = 0;
		this.audioQueue = [];
		this.isProcessingQueue = false;
		this.isStreamComplete = false;
		this.dialogues = this.dialogues.map((d) => ({
			...d,
			isPlaying: false,
			isCompleted: false,
		}));
		this.notifyUpdate();
	}

	skipTo(index: number) {
		if (index >= 0 && index < this.dialogues.length) {
			if (this.abortController) {
				this.abortController.abort();
				this.abortController = null;
			}
			if (this.cancelCurrentAudio) {
				this.cancelCurrentAudio();
				this.cancelCurrentAudio = null;
			}
			// 清空音频队列，避免播放旧的音频
			this.audioQueue = [];
			this.currentIndex = index;
			this.dialogues = this.dialogues.map((d, i) => ({
				...d,
				isPlaying: i === index,
				isCompleted: i < index,
			}));
			logger.tts("跳转到对话", { index, character: this.dialogues[index]?.character });
			this.notifyUpdate();
		}
	}

	skipToNext() {
		if (this.currentIndex < this.dialogues.length - 1) {
			this.skipTo(this.currentIndex + 1);
		}
	}

	skipToPrev() {
		if (this.currentIndex > 0) {
			this.skipTo(this.currentIndex - 1);
		}
	}

	getIsPlaying() {
		return this.isPlaying;
	}

	getIsPaused() {
		return this.isPaused;
	}

	getCurrentIndex() {
		return this.currentIndex;
	}

	getCurrentParagraphIndex(): number {
		if (this.currentIndex >= 0 && this.currentIndex < this.dialogues.length) {
			return this.dialogues[this.currentIndex].paragraphIndex ?? this.currentIndex;
		}
		return -1;
	}

	getDialogues() {
		return this.dialogues;
	}

	/**
	 * 流式添加对话并立即开始生成音频
	 * 用于边分析边播放的场景
	 */
	async addDialogueStream(character: string, text: string, paragraphIndex?: number, voiceDesignPrompt?: string): Promise<void> {
		const voiceMap: Record<string, string> = this.config.characterVoices || {};
		const defaultVoice = this.config.voice || "冰糖";
		const voice = voiceMap[character] || defaultVoice;

		const newDialogue: ScriptDialogue = {
			index: this.dialogues.length,
			character,
			text,
			voice,
			voiceDesignPrompt,
			isPlaying: false,
			isCompleted: false,
			paragraphIndex,
		};

		this.dialogues.push(newDialogue);
		logger.tts("流式添加对话", { index: newDialogue.index, character, voice, voiceDesign: !!voiceDesignPrompt, paragraphIndex, text: text.slice(0, 30) + "..." });
		this.notifyUpdate();

		await this.generateAndQueueAudio(newDialogue);
	}

	/**
	 * 根据段落索引跳转到对应的对话
	 */
	skipToParagraph(paragraphIndex: number): boolean {
		const dialogueIndex = this.dialogues.findIndex(d => d.paragraphIndex === paragraphIndex);
		if (dialogueIndex >= 0) {
			this.skipTo(dialogueIndex);
			logger.tts("跳转到段落", { paragraphIndex, dialogueIndex });
			return true;
		}
		return false;
	}

	/**
	 * 根据段落索引找到对应的对话索引
	 */
	findDialogueIndexByParagraph(paragraphIndex: number): number {
		return this.dialogues.findIndex(d => d.paragraphIndex === paragraphIndex);
	}

	/**
	 * 标记流式添加完成
	 */
	markStreamComplete(): void {
		this.isStreamComplete = true;
		logger.tts("流式添加完成标记", { totalDialogues: this.dialogues.length });
	}

	/**
	 * 生成音频并加入播放队列
	 */
	private async generateAndQueueAudio(dialogue: ScriptDialogue): Promise<void> {
		try {
			logger.tts("开始生成音频", { index: dialogue.index, character: dialogue.character, voiceDesign: !!dialogue.voiceDesignPrompt });
			const audioBuffer = await synthesizeSpeechWithVoice(dialogue.text, this.config, dialogue.voice, dialogue.voiceDesignPrompt);
			
			this.audioQueue.push({ buffer: audioBuffer, dialogueIndex: dialogue.index });
			logger.tts("音频生成完成并加入队列", { index: dialogue.index, queueLength: this.audioQueue.length });
			
			if (!this.isProcessingQueue) {
				this.processAudioQueue();
			}
		} catch (error) {
			logger.errorGeneric("生成音频失败", { index: dialogue.index, error });
		}
	}

	/**
	 * 处理音频队列
	 */
	private async processAudioQueue(): Promise<void> {
		if (this.isProcessingQueue) return;
		this.isProcessingQueue = true;

		logger.tts("开始处理音频队列", { queueLength: this.audioQueue.length, currentIndex: this.currentIndex });

		if (!this.isPlaying) {
			this.isPlaying = true;
			this.isPaused = false;
		}

		this.abortController = new AbortController();
		const signal = this.abortController.signal;

		while (this.isPlaying && !this.isPaused && !signal.aborted) {
			if (this.audioQueue.length === 0) {
				if (this.isStreamComplete && this.currentIndex >= this.dialogues.length) {
					logger.tts("所有对话播放完成");
					break;
				}
				await new Promise(resolve => setTimeout(resolve, 100));
				continue;
			}

			const queueItem = this.audioQueue.shift();
			if (!queueItem) continue;

			const { buffer: audioBuffer, dialogueIndex } = queueItem;
			
			// 如果队列中的音频对应的对话索引与当前索引不匹配，跳过这个音频
			if (dialogueIndex !== this.currentIndex) {
				logger.tts("跳过过期音频", { queueDialogueIndex: dialogueIndex, currentIndex: this.currentIndex });
				continue;
			}

			const currentDialogue = this.dialogues[this.currentIndex];
			if (!currentDialogue) break;

			this.dialogues = this.dialogues.map((d, i) => ({
				...d,
				isPlaying: i === this.currentIndex,
				isCompleted: i < this.currentIndex,
			}));
			this.notifyUpdate();

			try {
				logger.tts("播放队列音频", { index: this.currentIndex, character: currentDialogue.character, bufferSize: audioBuffer.byteLength });
				await playAudio(audioBuffer, signal);
				
				if (!this.isPlaying || this.isPaused || signal.aborted) break;

				this.dialogues = this.dialogues.map((d, i) => ({
					...d,
					isCompleted: i <= this.currentIndex,
					isPlaying: false,
				}));
				this.currentIndex++;
				this.notifyUpdate();
			} catch (error) {
				if (error instanceof DOMException && error.name === "AbortError") {
					logger.tts("队列音频播放被中断（AbortError）");
					break;
				}
				logger.errorGeneric("播放队列音频失败", { index: this.currentIndex, character: currentDialogue.character, error });
				this.dialogues = this.dialogues.map((d, i) => ({
					...d,
					isCompleted: i <= this.currentIndex,
					isPlaying: false,
				}));
				this.currentIndex++;
				this.notifyUpdate();
			}
		}

		this.isProcessingQueue = false;
		this.abortController = null;
		logger.tts("音频队列处理完成", { currentIndex: this.currentIndex, totalDialogues: this.dialogues.length, streamComplete: this.isStreamComplete });

		if (this.isStreamComplete && this.currentIndex >= this.dialogues.length && this.isPlaying) {
			this.isPlaying = false;
			this.onComplete?.();
		}
	}

	private async playDialogue(index: number): Promise<void> {
		const dialogue = this.dialogues[index];
		if (!dialogue) {
			logger.warn("播放对话失败: 对话不存在", { index });
			return;
		}

		logger.tts("播放对话", { index, character: dialogue.character, voice: dialogue.voice, text: dialogue.text.slice(0, 30) + "..." });

		this.abortController = new AbortController();
		const signal = this.abortController.signal;

		let cancelled = false;
		const cancelFn = () => {
			cancelled = true;
		};
		this.cancelCurrentAudio = cancelFn;

		this.dialogues = this.dialogues.map((d, i) => ({
			...d,
			isPlaying: i === index,
		}));
		this.notifyUpdate();

		for (let attempt = 0; attempt < 2; attempt++) {
			if (cancelled || !this.isPlaying || signal.aborted) {
				logger.tts("对话播放被取消或停止", { index, cancelled, isPlaying: this.isPlaying });
				return;
			}

			try {
				let audioBuffer = dialogue.audioBuffer;

				if (!audioBuffer && this.config.audioCacheEnabled) {
					// 尝试从全局缓存获取
					const cacheKey = audioCache.generateKey(dialogue.text, this.config, dialogue.voice);
					audioBuffer = audioCache.get(cacheKey, this.config);

					if (!audioBuffer) {
						// 需要生成音频
						logger.tts("生成对话音频", { index, character: dialogue.character, fromCache: false });
						audioBuffer = await synthesizeSpeechWithVoice(dialogue.text, this.config, dialogue.voice);
						// 缓存到全局和本地
						audioCache.set(cacheKey, audioBuffer, this.config);
						this.dialogues[index] = { ...this.dialogues[index], audioBuffer };
					} else {
						logger.tts("使用缓存音频", { index, character: dialogue.character, fromCache: true, cacheSize: audioCache.getSize() });
						// 更新本地缓存
						this.dialogues[index] = { ...this.dialogues[index], audioBuffer };
					}
				} else if (!audioBuffer) {
					// 缓存未启用，直接生成音频
					logger.tts("生成对话音频（缓存未启用）", { index, character: dialogue.character, fromCache: false });
					audioBuffer = await synthesizeSpeechWithVoice(dialogue.text, this.config, dialogue.voice);
				} else {
					logger.tts("使用本地缓存音频", { index, character: dialogue.character, fromCache: true });
				}

				if (cancelled || !this.isPlaying || signal.aborted) {
					logger.tts("对话播放被取消或停止（音频合成后）", { index, cancelled, isPlaying: this.isPlaying });
					return;
				}

				await playAudio(audioBuffer, signal);

				if (cancelled || !this.isPlaying || signal.aborted) {
					logger.tts("对话播放被取消或停止（音频播放后）", { index, cancelled, isPlaying: this.isPlaying });
					return;
				}

				this.dialogues = this.dialogues.map((d, i) => ({
					...d,
					isCompleted: i <= index && i !== index ? d.isCompleted : i === index,
				}));
				logger.tts("对话播放完成", { index, character: dialogue.character });
				this.notifyUpdate();
				this.cancelCurrentAudio = null;
				this.abortController = null;
				return;
			} catch (error) {
				if (error instanceof DOMException && error.name === "AbortError") {
					logger.tts("对话播放被中断（AbortError）", { index });
					return;
				}
				if (cancelled || !this.isPlaying) {
					logger.tts("对话播放被取消或停止（异常捕获）", { index, cancelled, isPlaying: this.isPlaying });
					return;
				}

				const errorMsg = error instanceof Error ? error.message : String(error);

				if (errorMsg.includes("TTS 响应中缺少 audio 字段")) {
					if (attempt === 0) {
						logger.warn("对话音频获取失败，准备重试", { index, attempt, error: errorMsg });
						await new Promise((resolve) => setTimeout(resolve, 100));
						continue;
					}
				}

				logger.errorGeneric("对话播放失败", { index, character: dialogue.character, attempt, error: errorMsg });
				break;
			}
		}

		this.cancelCurrentAudio = null;
		this.abortController = null;
		this.dialogues = this.dialogues.map((d) => ({
			...d,
			isPlaying: false,
		}));
		this.notifyUpdate();
	}

	private waitForResume(): Promise<void> {
		return new Promise((resolve) => {
			const check = () => {
				if (!this.isPaused) {
					resolve();
				} else {
					setTimeout(check, 100);
				}
			};
			check();
		});
	}

	private notifyUpdate() {
		this.onUpdate?.([...this.dialogues]);
	}
}
