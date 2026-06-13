import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNovelStore } from "../stores/novelStore";
import { useConfigStore } from "../stores/configStore";
import { useCharacterStore } from "../stores/characterStore";
import { useAIConfigStore } from "../stores/aiConfigStore";
import { splitParagraphs } from "../utils/chapterSplit";
import { TTSPlayer, ScriptTTSPlayer, type TTSSentence } from "../utils/ttsService";
import {
	sendChatCompletion,
	READING_MODE_TTS_ENHANCE_SYSTEM_PROMPT,
	buildReadingModeTTSEnhanceUserPrompt,
	type ParagraphEmotionResult,
	type ChatMessage,
} from "../utils/aiClient";
import { logger } from "../utils/logger";
import { startTtsService, stopTtsService, updateTtsNotification } from "../utils/androidService";

export function useTTS() {
	const chapters = useNovelStore((s) => s.chapters);
	const currentChapterIndex = useNovelStore((s) => s.currentChapterIndex);
	const currentNovelId = useNovelStore((s) => s.currentNovelId);
	const getCharacters = useCharacterStore((s) => s.getCharacters);
	const ttsConfig = useConfigStore((s) => s.ttsConfig);
	const promptConfig = useConfigStore((s) => s.promptConfig);
	const aiConfig = useAIConfigStore((s) => s.aiConfig);

	const [ttsPlaying, setTtsPlaying] = useState(false);
	const [ttsHighlightedPara, setTtsHighlightedPara] = useState(-1);
	const [ttsSentences, setTtsSentences] = useState<TTSSentence[]>([]);
	const [isStreamTTSPlaying, setIsStreamTTSPlaying] = useState(false);
	const [enhancedTTSPreparing, setEnhancedTTSPreparing] = useState(false);
	const [isStreamTTSWaitingForStart, setIsStreamTTSWaitingForStart] = useState(false);
	const [currentPlayingCharacter, setCurrentPlayingCharacter] = useState<string | undefined>(undefined);
	const [paragraphEmotionCache, setParagraphEmotionCache] = useState<Map<number, ParagraphEmotionResult>>(new Map());

	const ttsPlayerRef = useRef<TTSPlayer | null>(null);
	const scriptTTSRef = useRef<ScriptTTSPlayer | null>(null);

	const chapter = chapters[currentChapterIndex];
	const paragraphs = useMemo(() => {
		return chapter
			? splitParagraphs(chapter.content).filter((p) => p.trim() !== "")
			: [];
	}, [chapter]);

	const getVoiceForCharacter = useCallback((characterName: string): string => {
		if (!currentNovelId) return ttsConfig.voice || "冰糖";
		const characters = getCharacters(currentNovelId);
		let matched = characters.find((c) => c.name.toLowerCase() === characterName.toLowerCase());
		if (!matched) {
			matched = characters.find((c) => c.aliases?.some(alias => alias.toLowerCase() === characterName.toLowerCase()));
		}
		return matched?.voice || ttsConfig.voice || "冰糖";
	}, [currentNovelId, getCharacters, ttsConfig.voice]);

	const getVoiceDesignPromptForCharacter = useCallback((characterName: string): string | undefined => {
		if (!currentNovelId) return undefined;
		const characters = getCharacters(currentNovelId);
		let matched = characters.find((c) => c.name.toLowerCase() === characterName.toLowerCase());
		if (!matched) {
			matched = characters.find((c) => c.aliases?.some(alias => alias.toLowerCase() === characterName.toLowerCase()));
		}
		return matched?.notes?.trim() || undefined;
	}, [currentNovelId, getCharacters]);

	const analyzeParagraphEmotion = useCallback(async (
		paraIndex: number,
		paraText: string,
		allParagraphs: string[]
	): Promise<ParagraphEmotionResult | null> => {
		if (!aiConfig.apiKey) return null;
		const contextBefore = paraIndex > 0 ? allParagraphs[paraIndex - 1] : '';
		const contextAfter = paraIndex < allParagraphs.length - 1 ? allParagraphs[paraIndex + 1] : '';
		const configuredCharacters = currentNovelId ? getCharacters(currentNovelId).map(c => ({
			name: c.name,
			aliases: c.aliases || [],
			voice: c.voice,
			role: c.role,
			relationTerms: c.relationTerms || []
		})) : [];

		try {
			const messages: ChatMessage[] = [
				{ role: 'system', content: promptConfig.readingModeTts || READING_MODE_TTS_ENHANCE_SYSTEM_PROMPT },
				{ role: 'user', content: buildReadingModeTTSEnhanceUserPrompt(paraText, contextBefore, contextAfter, configuredCharacters) }
			];
			const response = await sendChatCompletion(messages, aiConfig);
			const jsonMatch = response.match(/\{[\s\S]*\}/);
			if (jsonMatch) return JSON.parse(jsonMatch[0]) as ParagraphEmotionResult;
			return null;
		} catch {
			return null;
		}
	}, [aiConfig, currentNovelId, getCharacters, promptConfig.readingModeTts]);

	const handleTTSToggle = useCallback(() => {
		if (ttsPlaying) {
			if (ttsPlayerRef.current) {
				ttsPlayerRef.current.pause();
				setTtsPlaying(false);
				stopTtsService().catch(() => {});
			}
		} else if (isStreamTTSPlaying) {
			if (scriptTTSRef.current) {
				if (scriptTTSRef.current.getIsPaused()) scriptTTSRef.current.resume();
				else scriptTTSRef.current.pause();
			}
		} else {
			if (isStreamTTSWaitingForStart) setIsStreamTTSWaitingForStart(false);
			if (scriptTTSRef.current) {
				scriptTTSRef.current.stop();
				scriptTTSRef.current = null;
				setIsStreamTTSPlaying(false);
				setEnhancedTTSPreparing(false);
			}
			if (!ttsPlayerRef.current) {
				ttsPlayerRef.current = new TTSPlayer(ttsConfig);
				ttsPlayerRef.current.setOnUpdate((sentences) => {
					setTtsSentences(sentences);
					if (ttsPlayerRef.current) {
						setTtsHighlightedPara(ttsPlayerRef.current.getCurrentParagraphIndex());
					}
				});
				ttsPlayerRef.current.setOnComplete(() => {
					setTtsPlaying(false);
					setTtsHighlightedPara(-1);
					stopTtsService().catch(() => {});
				});
				ttsPlayerRef.current.loadText(paragraphs);
				ttsPlayerRef.current.play();
				setTtsPlaying(true);
				startTtsService().catch(() => {});
			} else if (ttsPlayerRef.current.getPaused()) {
				ttsPlayerRef.current.resume();
				setTtsPlaying(true);
				startTtsService().catch(() => {});
			} else {
				ttsPlayerRef.current.updateConfig(ttsConfig);
				ttsPlayerRef.current.loadText(paragraphs);
				ttsPlayerRef.current.play();
				setTtsPlaying(true);
				startTtsService().catch(() => {});
			}
		}
	}, [ttsPlaying, ttsConfig, paragraphs, isStreamTTSWaitingForStart, isStreamTTSPlaying]);

	const handleTTSPrev = useCallback(() => {
		if (ttsPlayerRef.current) ttsPlayerRef.current.skipToPrev();
		else if (scriptTTSRef.current) scriptTTSRef.current.skipToPrev();
	}, []);

	const handleTTSNext = useCallback(() => {
		if (ttsPlayerRef.current) ttsPlayerRef.current.skipToNext();
		else if (scriptTTSRef.current) scriptTTSRef.current.skipToNext();
	}, []);

	const handleTTSStop = useCallback(() => {
		if (scriptTTSRef.current) { scriptTTSRef.current.stop(); scriptTTSRef.current = null; }
		if (ttsPlayerRef.current) { ttsPlayerRef.current.stop(); ttsPlayerRef.current = null; }
		setTtsPlaying(false);
		setTtsHighlightedPara(-1);
		setIsStreamTTSPlaying(false);
		setEnhancedTTSPreparing(false);
		setIsStreamTTSWaitingForStart(false);
		setCurrentPlayingCharacter(undefined);
		stopTtsService().catch(() => {});
	}, []);

	const startTTSFromParagraph = useCallback((startParaIndex: number) => {
		if (!ttsPlayerRef.current) {
			ttsPlayerRef.current = new TTSPlayer(ttsConfig);
			ttsPlayerRef.current.setOnUpdate((sentences) => {
				setTtsSentences(sentences);
				if (ttsPlayerRef.current) setTtsHighlightedPara(ttsPlayerRef.current.getCurrentParagraphIndex());
			});
			ttsPlayerRef.current.setOnComplete(() => { setTtsPlaying(false); setTtsHighlightedPara(-1); stopTtsService().catch(() => {}); });
		}
		ttsPlayerRef.current.updateConfig(ttsConfig);
		ttsPlayerRef.current.loadText(paragraphs, startParaIndex);
		ttsPlayerRef.current.play();
		setTtsPlaying(true);
		startTtsService().catch(() => {});
	}, [ttsConfig, paragraphs]);

	const handleEnterStreamTTSSelectionMode = useCallback(() => {
		if (isStreamTTSWaitingForStart) { setIsStreamTTSWaitingForStart(false); return; }
		if (!ttsConfig.apiKey || !aiConfig.apiKey || !chapter) return;
		if (ttsPlayerRef.current) { ttsPlayerRef.current.stop(); ttsPlayerRef.current = null; setTtsPlaying(false); setTtsHighlightedPara(-1); }
		if (scriptTTSRef.current) { scriptTTSRef.current.stop(); scriptTTSRef.current = null; setIsStreamTTSPlaying(false); setEnhancedTTSPreparing(false); }
		setIsStreamTTSWaitingForStart(true);
	}, [isStreamTTSWaitingForStart, ttsConfig.apiKey, aiConfig.apiKey, chapter]);

	const handleEnhancedChapterTTS = useCallback(async (startFromParagraph?: number) => {
		if (!ttsConfig.apiKey || !aiConfig.apiKey || !chapter) return;
		if (ttsPlayerRef.current && ttsPlaying) { ttsPlayerRef.current.pause(); setTtsPlaying(false); setTtsHighlightedPara(-1); }
		if (scriptTTSRef.current) { scriptTTSRef.current.stop(); scriptTTSRef.current = null; }

		setEnhancedTTSPreparing(true);
		setIsStreamTTSPlaying(true);
		setIsStreamTTSWaitingForStart(false);

		try {
			const startPara = startFromParagraph ?? 0;
			const allParagraphs = splitParagraphs(chapter.content).filter((p) => p.trim() !== "");
			const allCharacters = new Set<string>();
			const newCache = new Map<number, ParagraphEmotionResult>();

			const allNovelCharacters = currentNovelId ? getCharacters(currentNovelId) : [];
			const narratorCharacter = allNovelCharacters.find(c =>
				c.role === 'narrator' ||
				c.aliases?.some(a => a.includes('旁白')) ||
				c.relationTerms?.some(r => r.includes('旁白'))
			);
			const narratorName = narratorCharacter?.name || '旁白';

			const characterVoices: Record<string, string> = { ...ttsConfig.characterVoices };
			const customTTSConfig = { ...ttsConfig, characterVoices };
			const scriptTTS = new ScriptTTSPlayer(customTTSConfig);
			scriptTTSRef.current = scriptTTS;

			scriptTTS.setOnUpdate(() => {
				if (scriptTTSRef.current) {
					const currentPara = scriptTTSRef.current.getCurrentParagraphIndex();
					const currentDialogue = scriptTTSRef.current.getDialogues()[scriptTTSRef.current.getCurrentIndex()];
					setTtsHighlightedPara(currentPara);
					setCurrentPlayingCharacter(currentDialogue?.character);
				}
			});
			scriptTTS.setOnComplete(() => {
				setIsStreamTTSPlaying(false);
				setTtsHighlightedPara(-1);
				setEnhancedTTSPreparing(false);
				setCurrentPlayingCharacter(undefined);
				scriptTTSRef.current = null;
			});

			for (let i = startPara; i < allParagraphs.length; i++) {
				const cachedResult = paragraphEmotionCache.get(i);
				if (cachedResult?.segments?.length) {
					for (const segment of cachedResult.segments) {
						const actualSpeaker = segment.speaker === '旁白' ? narratorName : segment.speaker;
						if (!characterVoices[actualSpeaker]) characterVoices[actualSpeaker] = getVoiceForCharacter(actualSpeaker);
						await scriptTTS.addDialogueStream(actualSpeaker, segment.text, i, getVoiceDesignPromptForCharacter(actualSpeaker));
					}
					cachedResult.characters.forEach(c => allCharacters.add(c));
					newCache.set(i, cachedResult);
					continue;
				}

				const result = await analyzeParagraphEmotion(i, allParagraphs[i], allParagraphs);
				if (result?.segments?.length) {
					for (const segment of result.segments) {
						const actualSpeaker = segment.speaker === '旁白' ? narratorName : segment.speaker;
						if (!characterVoices[actualSpeaker]) characterVoices[actualSpeaker] = getVoiceForCharacter(actualSpeaker);
						await scriptTTS.addDialogueStream(actualSpeaker, segment.text, i, getVoiceDesignPromptForCharacter(actualSpeaker));
					}
					result.characters.forEach(c => allCharacters.add(c));
					if (result.characters.length === 0 && result.segments.length > 0) {
						result.segments.map(s => s.speaker).filter(s => s !== "旁白").forEach(s => allCharacters.add(s));
					}
					newCache.set(i, result);
				} else {
					if (!characterVoices[narratorName]) characterVoices[narratorName] = getVoiceForCharacter(narratorName);
					await scriptTTS.addDialogueStream(narratorName, allParagraphs[i], i);
				}
			}

			setParagraphEmotionCache(newCache);
			scriptTTS.markStreamComplete();

			if (currentNovelId) {
				const existingNames = new Set(getCharacters(currentNovelId).map(c => c.name.toLowerCase()));
				const existingAliases = new Set(getCharacters(currentNovelId).flatMap(c => (c.aliases || []).map(a => a.toLowerCase())));
				const newChars = Array.from(allCharacters).filter(name =>
					!existingNames.has(name.toLowerCase()) && !existingAliases.has(name.toLowerCase()) && name !== narratorName
				);
				if (newChars.length > 0) {
					setIsStreamTTSPlaying(false);
					setEnhancedTTSPreparing(false);
					logger.tts(`检测到 ${newChars.length} 个新角色`);
				}
			}
		} catch {
			setIsStreamTTSPlaying(false);
			setEnhancedTTSPreparing(false);
			scriptTTSRef.current = null;
		}
	}, [chapter, ttsConfig, aiConfig, ttsPlaying, getVoiceForCharacter, paragraphEmotionCache, analyzeParagraphEmotion, getCharacters, currentNovelId, getVoiceDesignPromptForCharacter]);

	// 更新通知栏标题（章节变化时）
	useEffect(() => {
		if (chapter) {
			updateTtsNotification(chapter.title || `第 ${currentChapterIndex + 1} 章`, ttsPlaying).catch(() => {});
		}
	}, [chapter, chapter?.title, currentChapterIndex, ttsPlaying]);

	// 更新通知栏播放状态
	useEffect(() => {
		updateTtsNotification(chapter?.title || `第 ${currentChapterIndex + 1} 章`, ttsPlaying || isStreamTTSPlaying).catch(() => {});
	}, [chapter, chapter?.title, currentChapterIndex, ttsPlaying, isStreamTTSPlaying]);

	return {
		ttsPlaying,
		ttsHighlightedPara,
		ttsSentences,
		isStreamTTSPlaying,
		enhancedTTSPreparing,
		isStreamTTSWaitingForStart,
		currentPlayingCharacter,
		paragraphEmotionCache,
		handleTTSToggle,
		handleTTSPrev,
		handleTTSNext,
		handleTTSStop,
		startTTSFromParagraph,
		handleEnterStreamTTSSelectionMode,
		handleEnhancedChapterTTS,
		setTtsPlaying,
		setTtsHighlightedPara,
		setIsStreamTTSWaitingForStart,
		setParagraphEmotionCache,
		ttsPlayerRef,
		scriptTTSRef,
	};
}
