import type { TTSConfig } from "../stores/configStore";

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
	const response = await fetch(`${baseUrl}/chat/completions`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({
			model: MIMO_TTS_MODEL,
			messages: [
				{
					role: "assistant",
					content: text,
				},
				{
					role: "user",
					content: `语速：${speed}（1最慢，10最快）
音量：${volume}（1最低，10最高）
你是专业小说有声书演播大神，真人级声线，全程沉浸式有声书演绎朗读。 1. 旁白：温柔沉稳、节奏舒缓、叙事感强，平稳顺滑； 2. 男性角色：声线压低、低沉磁性、语气贴合人物性格； 3. 女性角色：声线灵动自然、情绪饱满，甜而不腻； 4. 随剧情自动切换情绪：悲伤、温柔、紧张、开心、冷淡自由切换； 5. 语速贴合剧情节奏，对话有停顿、有语气、有呼吸感， 杜绝机械AI朗读，带真人自然呼吸、语气起伏、抑扬顿挫， 标准普通话，分角色清晰区分旁白与人物台词，生动代入，完整流畅读完全文。`,
				},
			],
			audio: {
				voice: voice,
			},
			max_completion_tokens: 1024,
		}),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`TTS API 错误: ${response.status} - ${errorText}`);
	}

	const data: MiMoTTSResponse = await response.json();

	if (data.error) {
		throw new Error(`TTS 错误: ${data.error.message}`);
	}

	const audioData = data.choices?.[0]?.message?.audio?.data;
	if (!audioData) {
		throw new Error("TTS 响应中缺少 audio 字段");
	}

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
		this.notifyUpdate();
	}

	async play() {
		if (this.sentences.length === 0) return;

		this.isPlaying = true;
		this.isPaused = false;

		while (this.currentIndex < this.sentences.length && this.isPlaying) {
			if (this.isPaused) {
				await this.waitForResume();
			}

			if (!this.isPlaying) break;

			await this.playSentence(this.currentIndex);

			if (this.isPlaying) {
				this.currentIndex++;
			}
		}

		if (this.currentIndex >= this.sentences.length) {
			this.isPlaying = false;
			this.onComplete?.();
		}

		this.notifyUpdate();
	}

	pause() {
		this.isPaused = true;
		this.isPlaying = false;
		this.notifyUpdate();
	}

	resume() {
		if (this.isPaused) {
			this.isPaused = false;
			this.play();
		}
	}

	stop() {
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
			this.skipTo(nextParaFirstSentence);
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
		if (!sentence) return;

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
			if (cancelled || !this.isPlaying) return;

			try {
				const audioBuffer = await synthesizeSpeech(sentence.text, this.config);

				if (cancelled || !this.isPlaying) return;

				await playAudio(audioBuffer);

				if (cancelled || !this.isPlaying) return;

				this.sentences = this.sentences.map((s, i) => ({
					...s,
					isCompleted: i <= index && i !== index ? s.isCompleted : i === index,
				}));
				this.notifyUpdate();
				this.cancelCurrentAudio = null;
				return;
			} catch (error) {
				if (cancelled || !this.isPlaying) return;

				const errorMsg = error instanceof Error ? error.message : String(error);

				if (errorMsg.includes("TTS 响应中缺少 audio 字段")) {
					if (attempt === 0) {
						console.warn(`句子 ${index} 获取音频失败，0.1秒后重试...`);
						await new Promise((resolve) => setTimeout(resolve, 100));
						continue;
					}
				}

				console.error(`播放句子 ${index} 失败:`, error);
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
