import type { TTSConfig } from "../stores/configStore";
import { logger } from "./logger";
import { useAppStore } from "../stores/appStore";

export interface TTSSentence {
	index: number;
	paragraphIndex: number;
	text: string;
	audioUrl?: string;
	isPlaying: boolean;
	isCompleted: boolean;
}

const MIMO_TTS_MODEL = "mimo-v2.5-tts";

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
	config: TTSConfig
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

	const requestBody = {
		model: MIMO_TTS_MODEL,
		messages: [
			{ role: "assistant", content: text },
			{
				role: "user",
				content: `语速：${speed}（1最慢，10最快）\n音量：${volume}（1最低，10最高）\n你是专业小说有声书演播大神...`,
			},
		],
		audio: { voice: voice },
		max_completion_tokens: 1024,
	};

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
		useAppStore.getState().incrementAPIUsage("mimo", false);
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
		useAppStore.getState().incrementAPIUsage("mimo", false);
		throw new Error(`TTS 错误: ${data.error.message}`);
	}

	const audioData = data.choices?.[0]?.message?.audio?.data;
	if (!audioData) {
		logger.warn("TTS 响应缺少 audio 字段");
		useAppStore.getState().incrementAPIUsage("mimo", false);
		throw new Error("TTS 响应中缺少 audio 字段");
	}

	useAppStore.getState().incrementAPIUsage("mimo", true);

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
	voice: string
): Promise<ArrayBuffer> {
	const apiKey = config.apiKey;
	const speed = config.speed;
	const volume = config.volume;

	if (!apiKey) {
		throw new Error("TTS API Key 未配置，请在 TTS 设置中配置 MiMo API Key");
	}

	const baseUrl = config.baseUrl.replace(/\/$/, "");
	const url = `${baseUrl}/chat/completions`;

	const requestBody = {
		model: MIMO_TTS_MODEL,
		messages: [
			{ role: "assistant", content: text },
			{
				role: "user",
				content: `语速：${speed}（1最慢，10最快）\n音量：${volume}（1最低，10最高）\n你是专业小说有声书演播大神...`,
			},
		],
		audio: { voice: voice },
		max_completion_tokens: 1024,
	};

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
		useAppStore.getState().incrementAPIUsage("mimo", false);
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
		useAppStore.getState().incrementAPIUsage("mimo", false);
		throw new Error(`TTS 错误: ${data.error.message}`);
	}

	const audioData = data.choices?.[0]?.message?.audio?.data;
	if (!audioData) {
		logger.warn("TTS 响应缺少 audio 字段");
		useAppStore.getState().incrementAPIUsage("mimo", false);
		throw new Error("TTS 响应中缺少 audio 字段");
	}

	useAppStore.getState().incrementAPIUsage("mimo", true);

	logger.tts("TTS 音频数据", { audioDataLength: audioData.length });
	const binaryString = atob(audioData);
	const bytes = new Uint8Array(binaryString.length);
	for (let i = 0; i < binaryString.length; i++) {
		bytes[i] = binaryString.charCodeAt(i);
	}
	return bytes.buffer as ArrayBuffer;
}

export function playAudio(arrayBuffer: ArrayBuffer): Promise<void> {
	return new Promise((resolve, reject) => {
		const blob = new Blob([arrayBuffer], { type: "audio/mp3" });
		const url = URL.createObjectURL(blob);
		const audio = new Audio();

		const startPlayback = () => {
			audio.currentTime = 0;
			audio.play().catch(reject);
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
			URL.revokeObjectURL(url);
			resolve();
		};

		audio.onerror = (e) => {
			URL.revokeObjectURL(url);
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

	async loadText(text: string): Promise<void>;
	async loadText(paragraphs: string[]): Promise<void>;
	async loadText(textOrParagraphs: string | string[]): Promise<void> {
		if (typeof textOrParagraphs === "string") {
			const rawSentences = splitTextIntoSentences(textOrParagraphs);
			this.sentences = rawSentences.map((text, index) => ({
				index,
				paragraphIndex: 0,
				text,
				isPlaying: false,
				isCompleted: false,
			}));
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
		}
		this.currentIndex = 0;
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

		let cancelled = false;
		const cancelFn = () => {
			cancelled = true;
		};
		this.cancelCurrentAudio = cancelFn;

		this.sentences = this.sentences.map((s, i) => ({
			...s,
			isPlaying: i === index,
		}));
		this.notifyUpdate();

		for (let attempt = 0; attempt < 2; attempt++) {
			if (cancelled || !this.isPlaying) {
				logger.tts("句子播放被取消或停止", { index, cancelled, isPlaying: this.isPlaying });
				return;
			}

			try {
				const audioBuffer = await synthesizeSpeech(sentence.text, this.config);

				if (cancelled || !this.isPlaying) {
					logger.tts("句子播放被取消或停止（音频合成后）", { index, cancelled, isPlaying: this.isPlaying });
					return;
				}

				await playAudio(audioBuffer);

				if (cancelled || !this.isPlaying) {
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
				return;
			} catch (error) {
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
	isPlaying: boolean;
	isCompleted: boolean;
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
		this.isPlaying = false;
		this.isPaused = false;
		this.currentIndex = 0;
		this.dialogues = this.dialogues.map((d) => ({
			...d,
			isPlaying: false,
			isCompleted: false,
		}));
		this.notifyUpdate();
	}

	skipTo(index: number) {
		if (index >= 0 && index < this.dialogues.length) {
			if (this.cancelCurrentAudio) {
				this.cancelCurrentAudio();
				this.cancelCurrentAudio = null;
			}
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

	getDialogues() {
		return this.dialogues;
	}

	private async playDialogue(index: number): Promise<void> {
		const dialogue = this.dialogues[index];
		if (!dialogue) {
			logger.warn("播放对话失败: 对话不存在", { index });
			return;
		}

		logger.tts("播放对话", { index, character: dialogue.character, voice: dialogue.voice, text: dialogue.text.slice(0, 30) + "..." });

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
			if (cancelled || !this.isPlaying) {
				logger.tts("对话播放被取消或停止", { index, cancelled, isPlaying: this.isPlaying });
				return;
			}

			try {
				const audioBuffer = await synthesizeSpeechWithVoice(dialogue.text, this.config, dialogue.voice);

				if (cancelled || !this.isPlaying) {
					logger.tts("对话播放被取消或停止（音频合成后）", { index, cancelled, isPlaying: this.isPlaying });
					return;
				}

				await playAudio(audioBuffer);

				if (cancelled || !this.isPlaying) {
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
				return;
			} catch (error) {
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
