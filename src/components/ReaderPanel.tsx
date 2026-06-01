// ============================================================
// 左侧阅读区（带行号 + 采纳动画 + 双击编辑）
// ============================================================
import { useRef, useEffect, useCallback, useState, useMemo } from "react";
import { useAppStore } from "../stores/appStore";
import { useProofreadStore } from "../stores/proofreadStore";
import { useConfigStore } from "../stores/configStore";
import { splitParagraphs } from "../utils/chapterSplit";
import { buildParagraphIndexMap, buildOriginalToFilteredMap } from "../utils/formatters";

import { TTSPlayer, ScriptTTSPlayer, type TTSSentence } from "../utils/ttsService";
import { EmptyState } from "./EmptyState";
import { Icons } from "./Icons";
import { Select } from "./Select";
import { logger } from "../utils/logger";
import { sendChatCompletion, type ChatMessage, generateChapterTitle } from "../utils/aiClient";
import { READING_MODE_TTS_ENHANCE_SYSTEM_PROMPT, buildReadingModeTTSEnhanceUserPrompt, type ParagraphEmotionResult } from "../utils/aiClient";
import type { CharacterInfo } from "../types";

export function ReaderPanel({
	showReadingModeToggle = false,
	isMobile = false,
}: { showReadingModeToggle?: boolean; isMobile?: boolean } = {}) {
	const chapters = useAppStore((s) => s.chapters);
	const currentChapterIndex = useAppStore((s) => s.currentChapterIndex);
	const currentNovelId = useAppStore((s) => s.currentNovelId);
	const getCharacters = useAppStore((s) => s.getCharacters);
	const addCharacter = useAppStore((s) => s.addCharacter);
	const setCurrentChapterIndex = useAppStore((s) => s.setCurrentChapterIndex);
	const fontSize = useAppStore((s) => s.fontSize);
	const setFontSize = useAppStore((s) => s.setFontSize);
	const readingMode = useAppStore((s) => s.readingMode);
	const setReadingMode = useAppStore((s) => s.setReadingMode);
	const lineSpacing = useAppStore((s) => s.lineSpacing);
	const setLineSpacing = useAppStore((s) => s.setLineSpacing);

	const paragraphIndent = useAppStore((s) => s.paragraphIndent);
	const setParagraphIndent = useAppStore((s) => s.setParagraphIndent);
	const readingBackground = useAppStore((s) => s.readingBackground);
	const setReadingBackground = useAppStore((s) => s.setReadingBackground);
	const customTextColor = useAppStore((s) => s.customTextColor);
	const customBgColor = useAppStore((s) => s.customBgColor);
	const setCustomColors = useAppStore((s) => s.setCustomColors);
	const bgImageUrl = useAppStore((s) => s.bgImageUrl);
	const setBgImageUrl = useAppStore((s) => s.setBgImageUrl);
	const replaceLine = useAppStore((s) => s.replaceLine);
	const highlightedParagraph = useProofreadStore((s) => s.highlightedParagraph);
	const setHighlightedParagraph = useProofreadStore(
		(s) => s.setHighlightedParagraph,
	);
	const applyAnimation = useProofreadStore((s) => s.applyAnimation);
	const startLine = useProofreadStore((s) => s.startLine);
	const setStartLine = useProofreadStore((s) => s.setStartLine);

	const containerRef = useRef<HTMLDivElement>(null);
	const paragraphRefs = useRef<(HTMLDivElement | null)[]>([]);

	const readingTextColor = useMemo(() => {
		if (!readingMode) return undefined;
		switch (readingBackground) {
			case "dark":
				return "#E0E0E0";
			case "mint":
				return "#2E4A3E";
			case "sky":
				return "#1565C0";
			case "lavender":
				return "#6A1B9A";
			case "peach":
				return "#B71C1C";
			case "sage":
				return "#4E342E";
			case "slate":
				return "#37474F";
			case "custom":
				return customTextColor;
			default:
				return "#333333";
		}
	}, [readingMode, readingBackground, customTextColor]);

	useEffect(() => {
		const container = containerRef.current;
		if (container && readingMode) {
			container.style.setProperty('--line-height', `${lineSpacing}px`);
			container.style.setProperty('--font-size', `${fontSize}px`);
			container.style.setProperty('--text-indent', `${paragraphIndent}em`);
			container.style.setProperty('--text-color', readingTextColor || '#333333');
		}
	}, [lineSpacing, fontSize, paragraphIndent, readingTextColor, readingMode]);

	// 滑动翻页相关
	const touchStartY = useRef(0);
	const touchStartX = useRef(0);
	const touchStartScrollTop = useRef(0);
	const isDragging = useRef(false);
	const isScrolling = useRef(false);

	// 双击编辑状态：正在编辑的行索引
	const [editingIndex, setEditingIndex] = useState<number | null>(null);
	const [editValue, setEditValue] = useState("");

	// 阅读设置面板状态
	const [showReadingSettings, setShowReadingSettings] = useState(false);

	// 章节列表弹窗状态
	const [showChapterList, setShowChapterList] = useState(false);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const chapterListContentRef = useRef<HTMLDivElement>(null);
	const activeChapterItemRef = useRef<HTMLDivElement>(null);

	// 章节名推荐状态
	const [suggestingChapterIndex, setSuggestingChapterIndex] = useState<number | null>(null);
	const [chapterTitleSuggestions, setChapterTitleSuggestions] = useState<string[]>([]);
	const [suggestingChapterId, setSuggestingChapterId] = useState<number | null>(null);

	// 当章节列表弹窗打开时，滚动到 active 项并居中
	useEffect(() => {
		if (showChapterList && activeChapterItemRef.current && chapterListContentRef.current) {
			// 使用 setTimeout 确保 DOM 已渲染
			setTimeout(() => {
				if (activeChapterItemRef.current && chapterListContentRef.current) {
					const container = chapterListContentRef.current;
					const activeItem = activeChapterItemRef.current;
					
					const containerRect = container.getBoundingClientRect();
					const itemRect = activeItem.getBoundingClientRect();
					
					const relativeTop = itemRect.top - containerRect.top;
					const targetScrollTop = container.scrollTop + relativeTop - container.offsetHeight / 2 + itemRect.height / 2;
					
					container.scrollTo({
						top: Math.max(0, targetScrollTop),
						behavior: 'smooth'
					});
				}
			}, 50);
		}
	}, [showChapterList]);

	// 搜索功能状态
	const [showSearch, setShowSearch] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const [searchResults, setSearchResults] = useState<{ paraIndex: number; matchStart: number; matchEnd: number; text: string }[]>([]);
	const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

	// TTS 功能状态
	const [ttsPlaying, setTtsPlaying] = useState(false);
	const [ttsHighlightedPara, setTtsHighlightedPara] = useState(-1);
	const [showTTSPanel, setShowTTSPanel] = useState(false);
	const [, setTtsSentences] = useState<TTSSentence[]>([]);
	const ttsPlayerRef = useRef<TTSPlayer | null>(null);
	const ttsConfig = useConfigStore((s) => s.ttsConfig);
	const updateTTSConfig = useConfigStore((s) => s.updateTTSConfig);
	const promptConfig = useConfigStore((s) => s.promptConfig);
	const setTtsPlayingGlobal = useProofreadStore((s) => s.setTtsPlaying);
	const setTtsHighlightedParaGlobal = useProofreadStore((s) => s.setTtsHighlightedPara);
	
	// 整章TTS增强功能
	const [enhancedTTSPreparing, setEnhancedTTSPreparing] = useState(false);
	const [paragraphEmotionCache, setParagraphEmotionCache] = useState<Map<number, ParagraphEmotionResult>>(new Map());
	
	// 流式TTS播放状态（用于控制条显示）
	const [isStreamTTSPlaying, setIsStreamTTSPlaying] = useState(false);
	const scriptTTSRef = useRef<ScriptTTSPlayer | null>(null);
	const aiConfig = useAppStore((s) => s.aiConfig);
	
	// 流式AI情感增强TTS等待选择开始段落模式
	const [isStreamTTSWaitingForStart, setIsStreamTTSWaitingForStart] = useState(false);

	// 仿真翻页动画状态
	const [pageFlipping, setPageFlipping] = useState<'none' | 'next' | 'prev'>('none');
	const [showPageShadow, setShowPageShadow] = useState(false);

	// 阅读进度状态
	const [currentParagraphIndex, setCurrentParagraphIndex] = useState(0);
	const [readingTimeElapsed, setReadingTimeElapsed] = useState(0);
	const [showReadingReminder, setShowReadingReminder] = useState(false);
	
	// 切换章节时重置阅读进度
	useEffect(() => {
		queueMicrotask(() => {
			setCurrentParagraphIndex(0);
		});
	}, [currentChapterIndex]);

	// 章节名推荐处理函数
	const handleSuggestChapterTitle = async (chapterIndex: number) => {
		if (suggestingChapterIndex === chapterIndex) return;
		
		const chapter = chapters[chapterIndex];
		if (!chapter) return;

		setSuggestingChapterIndex(chapterIndex);
		setSuggestingChapterId(chapter.id);
		setChapterTitleSuggestions([]);

		try {
			// 收集前几章的章节名和内容
			const previousChapters: Record<string, string> = {};
			for (let i = Math.max(0, chapterIndex - 5); i < chapterIndex; i++) {
				const prevChapter = chapters[i];
				if (prevChapter && prevChapter.title) {
					previousChapters[prevChapter.title] = prevChapter.content.slice(0, 200);
				}
			}

			const suggestions = await generateChapterTitle(
				chapter.content,
				previousChapters,
				chapterIndex + 1,
				aiConfig
			);
			setChapterTitleSuggestions(suggestions);
		} catch (error) {
			console.error("Failed to generate chapter title:", error);
			alert("生成章节名失败，请检查AI配置");
		} finally {
			setSuggestingChapterIndex(null);
		}
	};

	// 应用推荐的章节名
	const handleApplyChapterTitle = (chapterIndex: number, title: string) => {
		const chapter = chapters[chapterIndex];
		if (!chapter) return;

		const newTitle = chapter.title ? `${chapter.title} ${title}` : title;
		const newContent = chapter.title
			? chapter.content.replace(chapter.title, newTitle)
			: chapter.content;

		const updatedChapters = [...chapters];
		updatedChapters[chapterIndex] = { ...chapter, title: newTitle, content: newContent };
		useAppStore.getState().setChapters(updatedChapters);

		// 清除推荐状态
		setChapterTitleSuggestions([]);
		setSuggestingChapterId(null);
	};

	// 检测到的陌生角色状态
	const [detectedNewCharacters, setDetectedNewCharacters] = useState<string[]>([]);
	const [showNewCharacterModal, setShowNewCharacterModal] = useState(false);
	const readingStartTimeRef = useRef<number>(0);
	const readingTimerRef = useRef<number | null>(null);

	// 初始化阅读开始时间
	useEffect(() => {
		readingStartTimeRef.current = Date.now();
	}, []);

	// 同步 TTS 状态到全局 store（供校对区使用）
	useEffect(() => {
		setTtsPlayingGlobal(ttsPlaying);
	}, [ttsPlaying, setTtsPlayingGlobal]);

	useEffect(() => {
		setTtsHighlightedParaGlobal(ttsHighlightedPara);
	}, [ttsHighlightedPara, setTtsHighlightedParaGlobal]);

	const saveReadingProgress = useAppStore((s) => s.saveReadingProgress);
	const readingReminderEnabled = useAppStore((s) => s.readingReminderEnabled);
	const readingReminderMinutes = useAppStore((s) => s.readingReminderMinutes);

	const chapter = chapters[currentChapterIndex];
	const paragraphs = useMemo(() => {
		return chapter
			? splitParagraphs(chapter.content).filter((p) => p.trim() !== "")
			: [];
	}, [chapter]);

	// 计算全书总段落数
	const totalParagraphs = useMemo(() => {
		return chapters.reduce((acc, ch) => {
			if (!ch) return acc;
			return acc + splitParagraphs(ch.content).filter((p) => p.trim() !== "").length;
		}, 0);
	}, [chapters]);

	// 计算当前阅读位置（全书范围）
	const currentGlobalPosition = useMemo(() => {
		let pos = currentParagraphIndex;
		for (let i = 0; i < currentChapterIndex; i++) {
			const chapter = chapters[i];
			if (chapter) {
				pos += splitParagraphs(chapter.content).filter((p) => p.trim() !== "").length;
			}
		}
		return pos;
	}, [currentChapterIndex, currentParagraphIndex, chapters]);

	// 当前章节段落数
	const currentChapterParagraphs = useMemo(() => {
		if (!chapter) return 0;
		return splitParagraphs(chapter.content).filter((p) => p.trim() !== "").length;
	}, [chapter]);

	// 当前章节阅读进度百分比
	const readingProgressPercent = useMemo(() => {
		if (currentChapterParagraphs === 0) return 0;
		return Math.round((currentParagraphIndex / currentChapterParagraphs) * 100);
	}, [currentParagraphIndex, currentChapterParagraphs]);

	// 预计剩余时间（分钟）
	const estimatedRemainingMinutes = useMemo(() => {
		if (readingTimeElapsed === 0 || currentGlobalPosition === 0) return 0;
		const paragraphsPerSecond = currentGlobalPosition / (readingTimeElapsed / 1000);
		const remainingParagraphs = totalParagraphs - currentGlobalPosition;
		return Math.round((remainingParagraphs / paragraphsPerSecond) / 60);
	}, [readingTimeElapsed, currentGlobalPosition, totalParagraphs]);

	// 建立过滤后索引到原始索引的映射
	const paragraphIndexMap = useMemo(() => {
		return chapter ? buildParagraphIndexMap(chapter.content) : [];
	}, [chapter]);

	// 建立原始索引到过滤后索引的反向映射
	const originalToFilteredMap = useMemo(() => {
		return chapter ? buildOriginalToFilteredMap(chapter.content) : {};
	}, [chapter]);

	/** 进入编辑模式 */
	const startEditing = useCallback((index: number, currentText: string) => {
		setEditingIndex(index);
		setEditValue(currentText);
	}, []);

	/** 保存编辑 */
	const saveEditing = useCallback(() => {
		if (editingIndex === null || !chapter) return;
		const originalIndex = paragraphIndexMap[editingIndex];
		if (editValue !== paragraphs[editingIndex]) {
			replaceLine(chapter.id, originalIndex, editValue);
		}
		setEditingIndex(null);
	}, [
		editingIndex,
		editValue,
		chapter,
		paragraphs,
		replaceLine,
		paragraphIndexMap,
	]);

	/** TTS 控制 */
	const handleTTSToggle = useCallback(() => {
		if (ttsPlaying) {
			logger.tts("暂停播放");
			if (ttsPlayerRef.current) {
				ttsPlayerRef.current.pause();
				setTtsPlaying(false);
			}
		} else if (isStreamTTSPlaying) {
			// 情感朗读暂停/恢复
			if (scriptTTSRef.current) {
				if (scriptTTSRef.current.getIsPaused()) {
					scriptTTSRef.current.resume();
				} else {
					scriptTTSRef.current.pause();
				}
			}
		} else {
			// 如果正在等待段落选择模式或流式播放中，先停止
			if (isStreamTTSWaitingForStart) {
				setIsStreamTTSWaitingForStart(false);
			}
			if (scriptTTSRef.current) {
				scriptTTSRef.current.stop();
				scriptTTSRef.current = null;
				setIsStreamTTSPlaying(false);
				setEnhancedTTSPreparing(false);
			}
			logger.tts("开始播放, 段落数: " + paragraphs.length);
			if (!ttsPlayerRef.current) {
				ttsPlayerRef.current = new TTSPlayer(ttsConfig);
				ttsPlayerRef.current.setOnUpdate((sentences) => {
					setTtsSentences(sentences);
					if (ttsPlayerRef.current) {
						const currentPara = ttsPlayerRef.current.getCurrentParagraphIndex();
						setTtsHighlightedPara(currentPara);
					}
				});
				ttsPlayerRef.current.setOnComplete(() => {
					logger.tts("播放完成");
					setTtsPlaying(false);
					setTtsHighlightedPara(-1);
				});
				ttsPlayerRef.current.loadText(paragraphs);
				ttsPlayerRef.current.play();
				setTtsPlaying(true);
			} else if (ttsPlayerRef.current.getPaused()) {
				// 如果是暂停状态，恢复播放
				ttsPlayerRef.current.resume();
				setTtsPlaying(true);
			} else {
				// 重新开始播放
				ttsPlayerRef.current.updateConfig(ttsConfig);
				ttsPlayerRef.current.loadText(paragraphs);
				ttsPlayerRef.current.play();
				setTtsPlaying(true);
			}
		}
	}, [ttsPlaying, ttsConfig, paragraphs, isStreamTTSWaitingForStart, isStreamTTSPlaying]);

	/** TTS 播放过程中实时更新配置（音色、语速、音量） */
	useEffect(() => {
		if (ttsPlaying && ttsPlayerRef.current) {
			ttsPlayerRef.current.updateConfig(ttsConfig);
		}
	}, [ttsConfig, ttsPlaying]);

	/** TTS 上一条 */
	const handleTTSPrev = useCallback(() => {
		logger.tts('handleTTSPrev called');
		logger.tts('ttsPlayerRef exists:', !!ttsPlayerRef.current);
		logger.tts('scriptTTSRef exists:', !!scriptTTSRef.current);
		if (ttsPlayerRef.current) {
			logger.tts('calling ttsPlayerRef.current.skipToPrev()');
			ttsPlayerRef.current.skipToPrev();
		} else if (scriptTTSRef.current) {
			logger.tts('calling scriptTTSRef.current.skipToPrev()');
			scriptTTSRef.current.skipToPrev();
		} else {
			logger.tts('no TTS player available');
		}
	}, []);

	/** TTS 下一条 */
	const handleTTSNext = useCallback(() => {
		logger.tts('handleTTSNext called');
		logger.tts('ttsPlayerRef exists:', !!ttsPlayerRef.current);
		logger.tts('scriptTTSRef exists:', !!scriptTTSRef.current);
		if (ttsPlayerRef.current) {
			logger.tts('calling ttsPlayerRef.current.skipToNext()');
			ttsPlayerRef.current.skipToNext();
		} else if (scriptTTSRef.current) {
			logger.tts('calling scriptTTSRef.current.skipToNext()');
			scriptTTSRef.current.skipToNext();
		} else {
			logger.tts('no TTS player available');
		}
	}, []);

	/** TTS 从指定段落开始播放 */
	const startTTSFromParagraph = useCallback(
		(startParaIndex: number) => {
			if (!ttsPlayerRef.current) {
				ttsPlayerRef.current = new TTSPlayer(ttsConfig);
				ttsPlayerRef.current.setOnUpdate((sentences) => {
					setTtsSentences(sentences);
					if (ttsPlayerRef.current) {
						const currentPara = ttsPlayerRef.current.getCurrentParagraphIndex();
						setTtsHighlightedPara(currentPara);
					}
				});
				ttsPlayerRef.current.setOnComplete(() => {
					setTtsPlaying(false);
					setTtsHighlightedPara(-1);
				});
			}

			ttsPlayerRef.current.updateConfig(ttsConfig);
			ttsPlayerRef.current.loadText(paragraphs);
			const filteredParaIndex = originalToFilteredMap[startParaIndex] ?? 0;
			const startIndex = ttsPlayerRef.current.findSentenceIndexByParagraph(filteredParaIndex);
			if (startIndex >= 0) {
				ttsPlayerRef.current.skipTo(startIndex);
				ttsPlayerRef.current.play();
			} else {
				ttsPlayerRef.current.play();
			}
			setTtsPlaying(true);
		},
		[ttsConfig, paragraphs, originalToFilteredMap],
	);
	
	/** 根据角色信息获取音色 */
	const getVoiceForCharacter = useCallback((characterName: string): string => {
		if (!currentNovelId) return ttsConfig.voice || "冰糖";

		const characters = getCharacters(currentNovelId);
		let matchedCharacter: CharacterInfo | undefined;

		// 首先尝试精确匹配角色名
		matchedCharacter = characters.find(
			(c) => c.name.toLowerCase() === characterName.toLowerCase()
		);

		// 如果没有匹配到，尝试通过别称匹配（特别是"我"）
		if (!matchedCharacter) {
			matchedCharacter = characters.find(
				(c) => c.aliases?.some(alias => alias.toLowerCase() === characterName.toLowerCase())
			);
		}

		// 如果找到匹配的角色且有设置音色，使用该音色
		if (matchedCharacter?.voice) {
			return matchedCharacter.voice;
		}

		// 否则使用默认音色
		return ttsConfig.voice || "冰糖";
	}, [currentNovelId, getCharacters, ttsConfig.voice]);

	/** 分析单个段落的情感 */
	const analyzeParagraphEmotion = useCallback(async (
		paraIndex: number,
		paraText: string,
		allParagraphs: string[]
	): Promise<ParagraphEmotionResult | null> => {
		if (!aiConfig.apiKey) return null;

		// 获取上下文
		const contextBefore = paraIndex > 0 ? allParagraphs[paraIndex - 1] : '';
		const contextAfter = paraIndex < allParagraphs.length - 1 ? allParagraphs[paraIndex + 1] : '';

		// 获取已配置的角色信息
		const configuredCharacters = currentNovelId ? getCharacters(currentNovelId).map(c => ({
			name: c.name,
			aliases: c.aliases || [],
			voice: c.voice
		})) : [];

		try {
			const messages: ChatMessage[] = [
				{ role: 'system', content: promptConfig.readingModeTts || READING_MODE_TTS_ENHANCE_SYSTEM_PROMPT },
				{ role: 'user', content: buildReadingModeTTSEnhanceUserPrompt(paraText, contextBefore, contextAfter, configuredCharacters) }
			];

			const response = await sendChatCompletion(messages, aiConfig);

			// 解析JSON响应
			const jsonMatch = response.match(/\{[\s\S]*\}/);
			if (jsonMatch) {
				const result = JSON.parse(jsonMatch[0]) as ParagraphEmotionResult;
				logger.tts(`段落${paraIndex} AI响应解析结果`, { characters: result.characters, segments: result.segments.map(s => s.speaker) });
				return result;
			} else {
				logger.tts(`段落${paraIndex} AI响应无法解析JSON`, { response: response.slice(0, 100) });
			}
			return null;
		} catch (error) {
			logger.tts(`段落${paraIndex}情感分析失败: ${(error as Error).message}`);
			return null;
		}
	}, [aiConfig, currentNovelId, getCharacters, promptConfig.readingModeTts]);

	/** 添加检测到的新角色到角色列表 */
	const handleAddNewCharacters = useCallback((names: string[]) => {
		if (!currentNovelId) {
			logger.tts("无法添加角色：currentNovelId 为空");
			return;
		}
		logger.tts(`开始添加 ${names.length} 个新角色`, { novelId: currentNovelId, names });
		names.forEach(name => {
			logger.tts(`添加角色: ${name}`, { novelId: currentNovelId });
			addCharacter(currentNovelId, {
				name,
				gender: "other",
				notes: "自动检测创建",
				voice: "",
				aliases: [],
				relationTerms: [],
			});
			logger.tts(`已添加新角色: ${name}`);
		});
		setShowNewCharacterModal(false);
		setDetectedNewCharacters([]);
	}, [currentNovelId, addCharacter]);

	/** 流式TTS增强播放 - 分析完一个段落立即提交TTS */
	const handleEnhancedChapterTTS = useCallback(async (startFromParagraph?: number) => {
		if (!ttsConfig.apiKey) {
			logger.tts("请先配置TTS API Key");
			return;
		}
		if (!aiConfig.apiKey) {
			logger.tts("请先配置AI API Key");
			return;
		}
		if (!chapter) return;

		// 先停止当前播放
		if (ttsPlayerRef.current && ttsPlaying) {
			ttsPlayerRef.current.pause();
			setTtsPlaying(false);
			setTtsHighlightedPara(-1);
		}
		// 停止任何已有的流式播放
		if (scriptTTSRef.current) {
			scriptTTSRef.current.stop();
			scriptTTSRef.current = null;
		}

		setEnhancedTTSPreparing(true);
		setIsStreamTTSPlaying(true);
		setIsStreamTTSWaitingForStart(false);

		try {
			const startPara = startFromParagraph ?? 0;
			logger.tts(`开始流式AI情感增强处理... 起始段落: ${startPara}`);

			// 获取所有段落
			const allParagraphs = splitParagraphs(chapter.content).filter((p) => p.trim() !== "");
			const allCharacters = new Set<string>();
			const newCache = new Map<number, ParagraphEmotionResult>();

			// 为每个角色分配音色
			const characterVoices: Record<string, string> = { ...ttsConfig.characterVoices };

			// 创建 ScriptTTSPlayer 来支持流式角色音色
			const customTTSConfig = {
				...ttsConfig,
				characterVoices,
			};

			const scriptTTS = new ScriptTTSPlayer(customTTSConfig);
			scriptTTSRef.current = scriptTTS;
			scriptTTS.setOnUpdate(() => {
				if (scriptTTSRef.current) {
					const currentDialogueIndex = scriptTTSRef.current.getCurrentIndex();
					const currentPara = scriptTTSRef.current.getCurrentParagraphIndex();
					logger.tts(`[情感朗读] 正在播放对话: ${currentDialogueIndex}, 正在高亮段落: ${currentPara}`);
					setTtsHighlightedPara(currentPara);
				}
			});
			scriptTTS.setOnComplete(() => {
				logger.tts("流式播放完成");
				setIsStreamTTSPlaying(false);
				setTtsHighlightedPara(-1);
				setEnhancedTTSPreparing(false);
				scriptTTSRef.current = null;
			});

			// 逐段分析并流式添加（从指定段落开始）
			for (let i = startPara; i < allParagraphs.length; i++) {
				const paraText = allParagraphs[i];

				// 检查缓存
				const cachedResult = paragraphEmotionCache.get(i);
				if (cachedResult && cachedResult.segments && cachedResult.segments.length > 0) {
					logger.tts(`段落${i}使用缓存`);
					// 流式添加缓存的segments
					for (const segment of cachedResult.segments) {
						// 确保角色有音色
						if (!characterVoices[segment.speaker]) {
							characterVoices[segment.speaker] = getVoiceForCharacter(segment.speaker);
						}
						await scriptTTS.addDialogueStream(segment.speaker, segment.text, i);
					}
					cachedResult.characters.forEach(c => allCharacters.add(c));
					newCache.set(i, cachedResult);
					continue;
				}

				// 分析段落情感
				logger.tts(`分析段落${i}...`);
				const result = await analyzeParagraphEmotion(i, paraText, allParagraphs);

				if (result && result.segments && result.segments.length > 0) {
					logger.tts(`段落${i}情感分析返回`, { characters: result.characters, segmentsCount: result.segments.length });
					// 流式添加segments，立即开始TTS生成
					for (const segment of result.segments) {
						logger.tts(`段落${i}处理segment`, { speaker: segment.speaker });
						// 确保角色有音色
						if (!characterVoices[segment.speaker]) {
							characterVoices[segment.speaker] = getVoiceForCharacter(segment.speaker);
						}
						logger.tts(`段落${i}流式添加对话`, { speaker: segment.speaker, text: segment.text.slice(0, 30) + "..." });
						await scriptTTS.addDialogueStream(segment.speaker, segment.text, i);
						logger.tts(`段落${i}对话添加完成`, { speaker: segment.speaker });
					}
					logger.tts(`段落${i}添加角色到集合`, { before: Array.from(allCharacters), newChars: result.characters });
					result.characters.forEach(c => allCharacters.add(c));
					// 兜底：如果 characters 为空但有 segments，也添加 segments 中的说话者
					if (result.characters.length === 0 && result.segments.length > 0) {
						const speakersFromSegments = result.segments.map(s => s.speaker).filter(s => s !== "旁白");
						speakersFromSegments.forEach(s => allCharacters.add(s));
						logger.tts(`段落${i}从segments兜底添加角色`, { speakers: speakersFromSegments });
					}
					logger.tts(`段落${i}添加后集合`, { after: Array.from(allCharacters) });
					newCache.set(i, result);
				} else {
					// 如果分析失败，使用原文作为旁白
					await scriptTTS.addDialogueStream("旁白", paraText, i);
				}
			}

			// 更新缓存
			setParagraphEmotionCache(newCache);

			// 标记流式添加完成，这样音频队列处理器才知道所有对话都已添加
			scriptTTS.markStreamComplete();

			const detectedChars = Array.from(allCharacters);
			logger.tts("流式AI情感增强完成", {
				totalParagraphs: allParagraphs.length,
				characters: detectedChars
			});

			// 检测陌生角色
			if (currentNovelId && detectedChars.length > 0) {
				const existingCharacters = getCharacters(currentNovelId);
				const existingNames = new Set(existingCharacters.map(c => c.name.toLowerCase()));
				const existingAliases = new Set(existingCharacters.flatMap(c => (c.aliases || []).map(a => a.toLowerCase())));

				const newChars = detectedChars.filter(name => {
					const lowerName = name.toLowerCase();
					return !existingNames.has(lowerName) && !existingAliases.has(lowerName) && name !== "旁白";
				});

				if (newChars.length > 0) {
					logger.tts(`检测到 ${newChars.length} 个新角色`, { newChars });
					setDetectedNewCharacters(newChars);
					setShowNewCharacterModal(true);
				}
			}

		} catch (error) {
			logger.tts("流式TTS增强播放失败: " + (error as Error).message);
			setIsStreamTTSPlaying(false);
			setEnhancedTTSPreparing(false);
			scriptTTSRef.current = null;
		}
	}, [chapter, ttsConfig, aiConfig, ttsPlaying, getVoiceForCharacter, paragraphEmotionCache, analyzeParagraphEmotion, getCharacters, currentNovelId]);

	/** 进入流式AI情感增强的"等待选择段落"模式 */
	const handleEnterStreamTTSSelectionMode = useCallback(() => {
		if (isStreamTTSWaitingForStart) {
			setIsStreamTTSWaitingForStart(false);
			return;
		}
		if (!ttsConfig.apiKey) {
			logger.tts("请先配置TTS API Key");
			return;
		}
		if (!aiConfig.apiKey) {
			logger.tts("请先配置AI API Key");
			return;
		}
		if (!chapter) return;

		// 停止所有正在播放的音频
		if (ttsPlayerRef.current) {
			ttsPlayerRef.current.stop();
			ttsPlayerRef.current = null;
			setTtsPlaying(false);
			setTtsHighlightedPara(-1);
		}
		if (scriptTTSRef.current) {
			scriptTTSRef.current.stop();
			scriptTTSRef.current = null;
			setIsStreamTTSPlaying(false);
			setEnhancedTTSPreparing(false);
		}

		setIsStreamTTSWaitingForStart(true);
		logger.tts("进入情感朗读段落选择模式，请点击段落开始朗读");
	}, [isStreamTTSWaitingForStart, ttsConfig.apiKey, aiConfig.apiKey, chapter, ttsPlayerRef, scriptTTSRef]);

	/** textarea 键盘事件：Ctrl+Enter 保存，Escape 取消 */
	const cancelEditing = useCallback(() => {
		setEditingIndex(null);
	}, []);

	// 编辑模式下自动聚焦并调整 textarea 高度
	useEffect(() => {
		if (editingIndex !== null && textareaRef.current) {
			const ta = textareaRef.current;
			ta.focus();
			ta.selectionStart = ta.value.length;
			// 自动撑高
			ta.style.height = "auto";
			ta.style.height = ta.scrollHeight + "px";
		}
	}, [editingIndex]);

	// 阅读计时器
	useEffect(() => {
		if (readingMode) {
			readingStartTimeRef.current = Date.now();
			readingTimerRef.current = window.setInterval(() => {
				setReadingTimeElapsed((prev) => {
					const newElapsed = prev + 1000;
					// 检查阅读时长提醒
					if (readingReminderEnabled) {
						const minutesElapsed = Math.floor(newElapsed / 60000);
						if (minutesElapsed > 0 && minutesElapsed % readingReminderMinutes === 0) {
							setShowReadingReminder(true);
						}
					}
					return newElapsed;
				});
			}, 1000);
		}

		return () => {
			if (readingTimerRef.current) {
				clearInterval(readingTimerRef.current);
				readingTimerRef.current = null;
			}
		};
	}, [readingMode, readingReminderEnabled, readingReminderMinutes]);

	/** textarea 内容变化时自动撑高 */
	const handleTextareaInput = useCallback(
		(e: React.ChangeEvent<HTMLTextAreaElement>) => {
			setEditValue(e.target.value);
			const ta = e.target;
			ta.style.height = "auto";
			ta.style.height = ta.scrollHeight + "px";
		},
		[],
	);

	/** textarea 键盘事件：Ctrl+Enter 保存，Escape 取消 */
	const handleTextareaKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
			if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				saveEditing();
			} else if (e.key === "Escape") {
				e.preventDefault();
				cancelEditing();
			}
		},
		[saveEditing, cancelEditing],
	);

	/** 程序化滚动到指定段落 */
	const scrollToParagraph = useCallback((index: number) => {
		const el = paragraphRefs.current[index];
		const container = containerRef.current;

		if (!el || !container) {
			logger.ui(
				`scrollToParagraph failed: el=${!!el}, container=${!!container}, index=${index}`,
			);
			return;
		}

		logger.proofread(`scrollToParagraph: index=${index}`);

		// 计算元素相对于容器的位置
		const containerRect = container.getBoundingClientRect();
		const elementRect = el.getBoundingClientRect();
		
		// 计算元素相对于容器顶部的偏移
		const elementOffsetTop = elementRect.top - containerRect.top + container.scrollTop;
		
		// 计算滚动目标位置，使元素居中
		const scrollTarget = elementOffsetTop - (containerRect.height / 2) + (elementRect.height / 2);
		
		// 使用平滑滚动
		container.scrollTo({
			top: scrollTarget,
			behavior: "smooth"
		});
	}, []);

	useEffect(() => {
		if (highlightedParagraph !== null) {
			logger.proofread(`highlightedParagraph changed: ${highlightedParagraph}`);
			// 使用 setTimeout 确保 DOM 已经渲染完成
			setTimeout(() => {
				scrollToParagraph(highlightedParagraph);
			}, 50);
		}
	}, [highlightedParagraph, scrollToParagraph]);

	// TTS 高亮段落变化时自动滚动
	useEffect(() => {
		if (ttsHighlightedPara !== -1) {
			logger.tts(
				`highlighted paragraph changed: ${ttsHighlightedPara}`,
			);
			// 将过滤后的索引转换为原始索引
			const originalIndex = paragraphIndexMap[ttsHighlightedPara];
			logger.tts(
				`highlighted original index: ${originalIndex}`,
			);
			if (originalIndex !== undefined) {
				setTimeout(() => {
					scrollToParagraph(originalIndex);
				}, 50);
			}
		}
	}, [ttsHighlightedPara, scrollToParagraph, paragraphIndexMap]);

	// 当切换章节时，重置高亮段落
	useEffect(() => {
		setHighlightedParagraph(null);
	}, [currentChapterIndex, setHighlightedParagraph]);

	useEffect(() => {
		if (applyAnimation) {
			scrollToParagraph(applyAnimation.paragraphIndex);
		}
	}, [applyAnimation, scrollToParagraph]);

	/** 执行搜索 */
	const performSearch = useCallback((query: string) => {
		if (!query.trim()) {
			setSearchResults([]);
			return;
		}
		logger.search(`搜索: "${query}"`);
		const results: typeof searchResults = [];
		const lowerQuery = query.toLowerCase();
		paragraphs.forEach((para, filteredIndex) => {
			// 获取原始段落索引（用于行号显示和滚动定位）
			const originalIndex = paragraphIndexMap[filteredIndex];
			let startIndex = 0;
			const lowerPara = para.toLowerCase();
			while (startIndex < lowerPara.length) {
				const matchIndex = lowerPara.indexOf(lowerQuery, startIndex);
				if (matchIndex === -1) break;
				results.push({
					paraIndex: originalIndex,
					matchStart: matchIndex,
					matchEnd: matchIndex + query.length,
					text: para.slice(Math.max(0, matchIndex - 20), matchIndex) + "【" + para.slice(matchIndex, matchIndex + query.length) + "】" + para.slice(matchIndex + query.length, Math.min(para.length, matchIndex + query.length + 20)),
				});
				startIndex = matchIndex + 1;
			}
		});
		setSearchResults(results);
		setCurrentMatchIndex(results.length > 0 ? 0 : -1);
		logger.search(`搜索完成, 找到 ${results.length} 个匹配`);
	}, [paragraphs, paragraphIndexMap]);

	/** 点击搜索结果：跳转并关闭 */
	const handleSearchResultClick = useCallback((index: number) => {
		setCurrentMatchIndex(index);
		const match = searchResults[index];
		if (match) {
			setHighlightedParagraph(match.paraIndex);
		}
		setShowSearch(false);
		setSearchResults([]);
		setCurrentMatchIndex(0);
		setSearchQuery("");
	}, [searchResults, setHighlightedParagraph]);

	/** 搜索导航：上一个 */
	const prevMatch = useCallback(() => {
		if (searchResults.length === 0) return;
		setCurrentMatchIndex((prev) => {
			const newIndex = prev > 0 ? prev - 1 : searchResults.length - 1;
			setHighlightedParagraph(searchResults[newIndex].paraIndex);
			return newIndex;
		});
	}, [searchResults, setHighlightedParagraph]);

	/** 搜索导航：下一个 */
	const nextMatch = useCallback(() => {
		if (searchResults.length === 0) return;
		setCurrentMatchIndex((prev) => {
			const newIndex = prev < searchResults.length - 1 ? prev + 1 : 0;
			setHighlightedParagraph(searchResults[newIndex].paraIndex);
			return newIndex;
		});
	}, [searchResults, setHighlightedParagraph]);

	/** 关闭搜索 */
	const closeSearch = useCallback(() => {
		setShowSearch(false);
		setSearchResults([]);
		setCurrentMatchIndex(0);
		setSearchQuery("");
	}, []);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		container.scrollTop = 0;
		paragraphRefs.current = [];
		// 清除段落情感缓存，避免不同章节之间的缓存混淆
		setParagraphEmotionCache(new Map());
		logger.tts("切换章节，清除段落情感缓存");
	}, [currentChapterIndex]);

	// 阅读模式下，监听滚动自动更新阅读进度
	useEffect(() => {
		if (!readingMode) return;

		const container = containerRef.current;
		if (!container) return;

		// 创建 Intersection Observer，检测进入视口的段落
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						const paragraphEl = entry.target as HTMLElement;
						// 获取段落索引（从元素的 data 属性）
						const originalIndex = parseInt(paragraphEl.getAttribute('data-original-index') || '-1');
						if (originalIndex >= 0) {
							// 找到对应的过滤后索引
							const filteredIndex = paragraphIndexMap.indexOf(originalIndex);
							if (filteredIndex >= 0) {
								setCurrentParagraphIndex(filteredIndex);
							}
						}
					}
				}
			},
			{
				root: container,
				rootMargin: '0px 0px -50% 0px',
				threshold: 0.3,
			}
		);

		// 等待 DOM 更新后再观察段落
		const observerTimer = setTimeout(() => {
			const paragraphEls = container.querySelectorAll('.reader-paragraph');
			paragraphEls.forEach((el) => {
				observer.observe(el);
			});
		}, 100);

		return () => {
			clearTimeout(observerTimer);
			observer.disconnect();
		};
	}, [readingMode, currentChapterIndex, paragraphIndexMap]);

	// 滑动翻页功能
	const handleTouchStart = useCallback((e: React.TouchEvent) => {
		touchStartY.current = e.touches[0].clientY;
		touchStartX.current = e.touches[0].clientX;
		const container = containerRef.current;
		if (container) {
			touchStartScrollTop.current = container.scrollTop;
		}
		isDragging.current = true;
		isScrolling.current = false;
	}, []);

	// 触发翻页动画
	const triggerPageFlip = useCallback((direction: 'next' | 'prev') => {
		setShowPageShadow(true);
		setPageFlipping(direction);
		setTimeout(() => {
			setPageFlipping('none');
			setShowPageShadow(false);
		}, 400);
	}, []);

	const handleTouchMove = useCallback(
		(e: React.TouchEvent) => {
			if (!isDragging.current) return;

			const container = containerRef.current;
			if (!container) return;

			const currentY = e.touches[0].clientY;
			const currentX = e.touches[0].clientX;
			const deltaY = currentY - touchStartY.current;
			const deltaX = currentX - touchStartX.current;

			// 如果移动超过一定阈值，认为是滚动操作，不是点击
			if (!isScrolling.current && (Math.abs(deltaY) > 10 || Math.abs(deltaX) > 10)) {
				isScrolling.current = true;
			}

			// 检测是否到达顶部或底部
			const isAtTop = touchStartScrollTop.current === 0;
			const isAtBottom =
				container.scrollHeight - container.scrollTop <=
				container.clientHeight + 10;

			// 在顶部下滑（deltaY > 0），进入上一章并定位到底部
			if (isAtTop && deltaY > 50 && currentChapterIndex > 0) {
				isDragging.current = false;
				triggerPageFlip('prev');
				setTimeout(() => {
					setCurrentChapterIndex(currentChapterIndex - 1);
				}, 200);
				setTimeout(() => {
					const newContainer = containerRef.current;
					if (newContainer) {
						newContainer.scrollTop = newContainer.scrollHeight;
					}
				}, 300);
			}
			// 在底部上滑（deltaY < 0），进入下一章并定位到顶部
			else if (
				isAtBottom &&
				deltaY < -50 &&
				currentChapterIndex < chapters.length - 1
			) {
				isDragging.current = false;
				triggerPageFlip('next');
				setTimeout(() => {
					setCurrentChapterIndex(currentChapterIndex + 1);
				}, 200);
			}
		},
		[currentChapterIndex, chapters.length, setCurrentChapterIndex, triggerPageFlip],
	);

	const handleTouchEnd = useCallback(() => {
		isDragging.current = false;
	}, []);

	if (!chapter) {
		return (
			<div className="reader-panel empty">
				<EmptyState icon={<Icons.book size={48} />} message="请导入 TXT 小说文件开始阅读" />
			</div>
		);
	}

	return (
		<div className="reader-panel">
			<div className="reader-toolbar">
				<span
					className="chapter-title"
					onClick={() => setShowChapterList(true)}
				>
					{chapter.title || ""}
					<Icons.chevronDown size={14} className="chapter-dropdown-icon" />
				</span>
				{showReadingModeToggle && (
					<div className="reading-mode-toggle">
						<span className="toggle-label">
							<Icons.book size={14} />
							阅读模式
						</span>
						<label className="toggle-switch">
							<input
								type="checkbox"
								checked={readingMode}
								onChange={(e) => setReadingMode(e.target.checked)}
							/>
							<span className="toggle-slider"></span>
						</label>
					</div>
				)}
				<button
					className={isMobile ? "btn-mobile" : "btn"}
					onClick={() => setShowSearch(true)}
				>
					<Icons.search size={18} />
					{!isMobile && <span>搜索</span>}
				</button>
			</div>
			<div className="reader-progress-bar">
				<div 
					className="reader-progress-fill" 
					style={{ width: `${readingProgressPercent}%` }}
				></div>
			</div>
			<div
				className={`reader-content${readingMode ? " reading-mode" : ""}${pageFlipping !== 'none' ? ` flipping-${pageFlipping}` : ''}`}
				ref={containerRef}
				onTouchStart={handleTouchStart}
				onTouchMove={handleTouchMove}
				onTouchEnd={handleTouchEnd}
				onClick={(e) => {
					if (!showReadingSettings) return;
					const target = e.target as HTMLElement;
					if (
						target.closest(".reading-settings-panel") ||
						target.closest(".reading-settings-toggle")
					) {
						return;
					}
					setShowReadingSettings(false);
				}}
				style={{
					...(readingMode && {
						backgroundColor:
							readingBackground === "white"
								? "#FFFFFF"
								: readingBackground === "cream"
									? "#FDF6E3"
									: readingBackground === "sepia"
										? "#F4E4BC"
										: readingBackground === "mint"
											? "#E8F5E9"
											: readingBackground === "sky"
												? "#E3F2FD"
												: readingBackground === "lavender"
													? "#F3E5F5"
													: readingBackground === "peach"
														? "#FFEBEE"
														: readingBackground === "sage"
															? "#EFEBE9"
															: readingBackground === "slate"
																? "#ECEFF1"
																: readingBackground === "dark"
																	? "#2C2C2C"
																	: readingBackground === "custom"
																		? customBgColor
																		: undefined,
						backgroundImage:
							readingBackground === "image" ? `url(${bgImageUrl})` : undefined,
						backgroundSize: readingBackground === "image" ? "cover" : undefined,
						backgroundPosition:
							readingBackground === "image" ? "center" : undefined,
					}),
				}}
			>
				{/* 翻页阴影效果 */}
				{showPageShadow && (
					<div className="reader-page-overlay active">
						<div className={`reader-page-shadow-${pageFlipping === 'next' ? 'left' : 'right'}`}></div>
					</div>
				)}
				{/* 流式AI情感增强 - 等待选择段落提示 */}
				{isStreamTTSWaitingForStart && (
					<div className="tts-selection-hint">
						<div className="tts-selection-hint-content">
							<Icons.volume size={20} />
							<span>情感朗读模式：请点击想要开始朗读的段落</span>
						</div>
						<button
							className="tts-selection-hint-cancel"
							onClick={() => setIsStreamTTSWaitingForStart(false)}
						>
							<Icons.close size={16} />
						</button>
					</div>
				)}
				{paragraphs.map((para, filteredIndex) => {
					// 获取原始段落索引（与校对区一致）
					const originalIndex = paragraphIndexMap[filteredIndex];
					
					const isAnimTarget =
						!readingMode &&
						applyAnimation?.chapterId === chapter.id &&
						applyAnimation?.paragraphIndex === originalIndex;
					const animClass = isAnimTarget
						? ` anim-${applyAnimation!.phase}`
						: "";
					const isEditing = editingIndex === filteredIndex;

					// 如果是动画目标，提取需要高亮的文本片段
					const getHighlightInfo = () => {
						if (!isAnimTarget || applyAnimation!.startIndex === undefined) {
							return null;
						}

						const isOldPhase =
							applyAnimation!.phase === "highlight-old" ||
							applyAnimation!.phase === "replacing";

						// 旧文本高亮：使用原始索引
						if (isOldPhase) {
							const highlight = para.slice(
								applyAnimation!.startIndex,
								applyAnimation!.endIndex,
							);
							logger.proofread(
								`anim-highlight-old:`,
								`\n  phase: ${applyAnimation!.phase}`,
								`\n  paragraphIndex: ${applyAnimation!.paragraphIndex}`,
								`\n  startIndex: ${applyAnimation!.startIndex}`,
								`\n  endIndex: ${applyAnimation!.endIndex}`,
								`\n  originalText: "${applyAnimation!.originalText}"`,
								`\n  correctedText: "${applyAnimation!.correctedText}"`,
								`\n  paragraph snippet: "${para.slice(Math.max(0, applyAnimation!.startIndex - 5), Math.min(para.length, (applyAnimation!.endIndex ?? applyAnimation!.startIndex + (applyAnimation!.originalText?.length ?? 0)) + 5))}"`,
								`\n  highlight: "${highlight}"`,
							);
							return {
								before: para.slice(0, applyAnimation!.startIndex),
								highlight: highlight,
								after: para.slice(applyAnimation!.endIndex),
								isOld: true,
							};
						}

						// 新文本高亮：使用精确的起始位置和新文本长度
						const newText = applyAnimation!.correctedText;
						if (!newText) {
							console.warn("[ReaderPanel] correctedText is undefined");
							return null;
						}

						// 使用精确的起始位置，避免在多个相同字符中找错位置
						// 替换后新文本的起始位置与原始位置相同
						const startIdx = applyAnimation!.startIndex;
						const endIdx = startIdx + newText.length;

						// 验证位置处的文本是否与新文本匹配
						const actualText = para.slice(startIdx, endIdx);
						logger.proofread(
							`anim-highlight-new:`,
							`\n  phase: ${applyAnimation!.phase}`,
							`\n  paragraphIndex: ${applyAnimation!.paragraphIndex}`,
							`\n  startIndex: ${applyAnimation!.startIndex}`,
							`\n  endIndex (original): ${applyAnimation!.endIndex}`,
							`\n  originalText: "${applyAnimation!.originalText}"`,
							`\n  correctedText: "${newText}"`,
							`\n  newText.length: ${newText.length}`,
							`\n  calculated endIdx: ${endIdx}`,
							`\n  actualText at position: "${actualText}"`,
							`\n  paragraph snippet: "${para.slice(Math.max(0, startIdx - 5), Math.min(para.length, endIdx + 5))}"`,
						);

						if (actualText === newText) {
							// 位置匹配，使用精确位置
							logger.proofread(`anim-highlight-new: 位置匹配，使用精确位置`);
							return {
								before: para.slice(0, startIdx),
								highlight: newText,
								after: para.slice(endIdx),
								isOld: false,
							};
						} else {
							// 降级：只在预期位置附近搜索（避免错误地匹配到段落中其他相同的文本）
							let foundIdx = -1;
							// 在预期位置前后各5个字符范围内搜索
							const searchStart = Math.max(0, startIdx - 5);
							const searchEnd = Math.min(para.length, startIdx + newText.length + 5);
							const searchRange = para.slice(searchStart, searchEnd);
							const relativeIdx = searchRange.indexOf(newText);
							if (relativeIdx >= 0) {
								foundIdx = searchStart + relativeIdx;
							}
							
							logger.proofread(`anim-highlight-new: 位置不匹配，在预期位置附近搜索，foundIdx: ${foundIdx}`);
							if (foundIdx >= 0) {
								return {
									before: para.slice(0, foundIdx),
									highlight: newText,
									after: para.slice(foundIdx + newText.length),
									isOld: false,
								};
							} else {
								console.warn(
									`[ReaderPanel] 新文本 "${newText}" 未在段落中找到，使用原始索引`,
								);
								return {
									before: para.slice(0, startIdx),
									highlight: para.slice(startIdx, endIdx),
									after: para.slice(endIdx),
									isOld: false,
								};
							}
						}
					};
					const highlightInfo = getHighlightInfo();

					// 检测空段落（连续换行），直接跳过不渲染
					const isEmptyParagraph = para.trim() === "";
					if (isEmptyParagraph) {
						return null;
					}

					const isTTSHighlighted = readingMode && ttsHighlightedPara !== -1 && paragraphIndexMap[ttsHighlightedPara] === originalIndex;

					return (
						<div
							key={originalIndex}
							data-original-index={originalIndex}
							ref={(el) => {
								paragraphRefs.current[originalIndex] = el;
							}}
							className={`reader-paragraph${readingMode ? " reading-mode" : ""}${highlightedParagraph === originalIndex && !readingMode ? " highlighted" : ""}${isTTSHighlighted ? " tts-highlighted" : ""}${animClass}${isEditing ? " editing" : ""}${isStreamTTSWaitingForStart && readingMode ? " clickable-para" : ""}`}
							onClick={() => {
								// 如果是滚动操作，不触发点击事件
								if (isScrolling.current) return;
								if (!isEditing) {
									if (readingMode) {
										if (isStreamTTSWaitingForStart) {
											const filteredParaIndex = originalToFilteredMap[originalIndex] ?? 0;
											handleEnhancedChapterTTS(filteredParaIndex);
										} else {
											startTTSFromParagraph(originalIndex);
										}
									} else {
										setHighlightedParagraph(originalIndex);
									}
								}
								// 更新阅读进度
								setCurrentParagraphIndex(filteredIndex);
								if (currentNovelId) {
									saveReadingProgress(currentNovelId, currentChapterIndex, filteredIndex);
								}
							}}
							onDoubleClick={() => {
								if (!isEditing && !readingMode) startEditing(filteredIndex, para);
							}}
						>
							{!readingMode && (
								<span
									className={`line-number${startLine === originalIndex ? " start-line" : ""}`}
									onClick={(e) => {
										e.stopPropagation();
										setStartLine(startLine === originalIndex ? null : originalIndex);
									}}
									title={startLine === originalIndex ? "取消起始行" : "设为校对起始行"}
								>
									{originalIndex + 1}
								</span>
							)}
							{isEditing ? (
								<textarea
									ref={textareaRef}
									className="line-edit-textarea"
									value={editValue}
									onChange={handleTextareaInput}
									onKeyDown={handleTextareaKeyDown}
									onBlur={saveEditing}
									rows={1}
								/>
							) : highlightInfo ? (
								<span className="line-text">
									{highlightInfo.before}
									<span
										className={`text-highlight ${highlightInfo.isOld ? "highlight-old" : "highlight-new"}`}
									>
										{highlightInfo.highlight}
									</span>
									{highlightInfo.after}
								</span>
							) : (
								<span className="line-text">{para}</span>
							)}
						</div>
					);
				})}
			</div>

			{/* 上一章 / 下一章 导航按钮（仅桌面端） */}
			{!isMobile && !readingMode && chapters.length > 1 && (
				<div className="chapter-nav-buttons">
					<button
						className="btn"
						disabled={currentChapterIndex <= 0}
						onClick={() => setCurrentChapterIndex(currentChapterIndex - 1)}
					>
						<Icons.skipBack size={16} />
						<span>{currentChapterIndex > 0 ? (chapters[currentChapterIndex - 1]?.title || `第 ${currentChapterIndex} 章`) : "已是第一章"}</span>
					</button>
					<button
						className="btn"
						disabled={currentChapterIndex >= chapters.length - 1}
						onClick={() => setCurrentChapterIndex(currentChapterIndex + 1)}
					>
						<span>{currentChapterIndex < chapters.length - 1 ? (chapters[currentChapterIndex + 1]?.title || `第 ${currentChapterIndex + 2} 章`) : "已是最后一章"}</span>
						<Icons.skipForward size={16} />
					</button>
				</div>
			)}

			{/* 阅读模式下显示悬浮设置按钮和面板 */}
			{readingMode && (
				<>
					{/* 阅读设置面板（显示在按钮上方） */}
					{showReadingSettings && (
						<div
							className="reading-settings-panel glass-panel"
							onClick={(e) => e.stopPropagation()}
						>
							<div className="glass-panel-header">
								<div className="glass-panel-title">
									<Icons.book size={16} />
									<span>阅读设置</span>
								</div>
								<button
									className="close-btn"
									onClick={() => setShowReadingSettings(false)}
								>
									<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
										<path d="M3 3L13 13M13 3L3 13" />
									</svg>
								</button>
							</div>

							<div className="panel-body">
								{/* 行间距设置 */}
								<div className="setting-item">
									<span className="setting-label">行间距</span>
									<div className="setting-control">
										<input
											type="range"
											min="12"
											max="40"
											step="1"
											value={lineSpacing}
											onChange={(e) => setLineSpacing(parseInt(e.target.value))}
										/>
										<span className="setting-value">{lineSpacing}px</span>
									</div>
								</div>

								{/* 字体大小设置 */}
								<div className="setting-item">
									<span className="setting-label">字体大小</span>
									<div className="setting-control">
										<input
											type="range"
											min="12"
											max="28"
											step="1"
											value={fontSize}
											onChange={(e) => setFontSize(parseInt(e.target.value))}
										/>
										<span className="setting-value">{fontSize}px</span>
									</div>
								</div>

								{/* 首行缩进设置（整数选项） */}
								<div className="setting-item">
									<span className="setting-label">首行缩进</span>
									<div className="setting-control">
										<input
											type="range"
											min="0"
											max="4"
											step="1"
											value={paragraphIndent}
											onChange={(e) =>
												setParagraphIndent(parseInt(e.target.value))
											}
										/>
										<span className="setting-value">{paragraphIndent}字符</span>
									</div>
								</div>

								{/* 阅读背景设置 */}
							<div className="setting-item">
								<span className="setting-label">阅读背景</span>
								<div className="setting-control background-options">
									{[
										{
											value: "white",
											label: "白底",
											color: "#FFFFFF",
											textColor: "#333333",
										},
										{
											value: "cream",
											label: "护眼",
											color: "#FDF6E3",
											textColor: "#5C4A32",
										},
										{
											value: "sepia",
											label: "棕黄",
											color: "#F4E4BC",
											textColor: "#5C4033",
										},
										{
											value: "mint",
											label: "薄荷",
											color: "#E8F5E9",
											textColor: "#2E4A3E",
										},
										{
											value: "sky",
											label: "淡蓝",
											color: "#E3F2FD",
											textColor: "#1565C0",
										},
										{
											value: "lavender",
											label: "薰衣草",
											color: "#F3E5F5",
											textColor: "#6A1B9A",
										},
										{
											value: "peach",
											label: "桃色",
											color: "#FFEBEE",
											textColor: "#B71C1C",
										},
										{
											value: "sage",
											label: "鼠尾草",
											color: "#EFEBE9",
											textColor: "#4E342E",
										},
										{
											value: "slate",
											label: "石板",
											color: "#ECEFF1",
											textColor: "#37474F",
										},
										{
											value: "dark",
											label: "深色",
											color: "#2C2C2C",
											textColor: "#E0E0E0",
										},
									].map((bg) => (
										<button
											key={bg.value}
											className={`background-option${readingBackground === bg.value ? " active" : ""}`}
											style={{ backgroundColor: bg.color }}
											onClick={() =>
												setReadingBackground(
													bg.value as
														| "white"
														| "cream"
														| "sepia"
														| "mint"
														| "sky"
														| "lavender"
														| "peach"
														| "sage"
														| "slate"
														| "dark",
												)
											}
											title={bg.label}
										>
											{readingBackground === bg.value && "✓"}
										</button>
									))}
								</div>
							</div>

							{/* 自定义颜色选项 */}
							<div className="setting-item">
								<span className="setting-label">自定义颜色</span>
								<div className="setting-control color-options">
									<div className="color-input-group">
										<label>文字</label>
										<input
											type="color"
											value={customTextColor}
											onChange={(e) =>
												setCustomColors(e.target.value, customBgColor)
											}
										/>
									</div>
									<div className="color-input-group">
										<label>背景</label>
										<input
											type="color"
											value={customBgColor}
											onChange={(e) =>
												setCustomColors(customTextColor, e.target.value)
											}
										/>
									</div>
									<button
										className={`background-option custom-color-btn${readingBackground === "custom" ? " active" : ""}`}
										style={
											{
												"--custom-bg": customBgColor,
												"--custom-text": customTextColor,
											} as React.CSSProperties
										}
										onClick={() => setReadingBackground("custom")}
										title="应用自定义颜色"
									></button>
								</div>
							</div>

							{/* 图片背景选项 */}
							<div className="setting-item">
								<span className="setting-label">图片背景</span>
								<div className="setting-control image-options">
									<input
										type="file"
										accept="image/*"
										id="bg-image-upload"
										style={{ display: "none" }}
										onChange={(e) => {
											const file = e.target.files?.[0];
											if (file) {
												const reader = new FileReader();
												reader.onload = (ev) => {
													const url = ev.target?.result as string;
													setBgImageUrl(url);
													setReadingBackground("image");
												};
												reader.readAsDataURL(file);
											}
										}}
									/>
									<label htmlFor="bg-image-upload" className="image-upload-btn">
										📷 选择图片
									</label>
									{readingBackground === "image" && bgImageUrl && (
										<button
											className="image-remove-btn"
											onClick={() => {
												setBgImageUrl("");
												setReadingBackground("cream");
											}}
										>
											✕
										</button>
									)}
								</div>
							</div>
							</div>
						</div>
					)}

					{/* TTS 面板 */}
					{showTTSPanel && readingMode && (
						<div className="tts-panel glass-panel">
							<div className="glass-panel-header">
								<div className="glass-panel-title">
									<Icons.volume size={16} />
									<span>语音朗读设置</span>
								</div>
								<button
									className="close-btn"
									onClick={() => setShowTTSPanel(false)}
								>
									<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
										<path d="M3 3L13 13M13 3L3 13" />
									</svg>
								</button>
							</div>
							<div className="glass-panel-body">
								<div className="tts-setting-item">
									<label>音色</label>
									<Select
										value={ttsConfig.voice}
										onChange={(value) => updateTTSConfig({ voice: value })}
										options={[
											{ value: "冰糖", label: "冰糖" },
											{ value: "茉莉", label: "茉莉" },
											{ value: "苏打", label: "苏打" },
											{ value: "白桦", label: "白桦" },
											{ value: "Mia", label: "Mia" },
											{ value: "Chloe", label: "Chloe" },
											{ value: "Milo", label: "Milo" },
											{ value: "Dean", label: "Dean" }
										]}
									/>
								</div>
								<div className="tts-setting-item">
									<label>语速</label>
									<div className="tts-slider-group">
										<input
											type="range"
											min="1"
											max="10"
											value={ttsConfig.speed}
											onChange={(e) => updateTTSConfig({ speed: parseInt(e.target.value) })}
										/>
										<span className="tts-value">{ttsConfig.speed}</span>
									</div>
								</div>
								<div className="tts-setting-item">
									<label>音量</label>
									<div className="tts-slider-group">
										<input
											type="range"
											min="1"
											max="10"
											value={ttsConfig.volume}
											onChange={(e) => updateTTSConfig({ volume: parseInt(e.target.value) })}
										/>
										<span className="tts-value">{ttsConfig.volume}</span>
									</div>
								</div>
							</div>
						</div>
					)}

			{/* 移动端播放控制条 - 悬浮在阅读栏上方 */}
			{isMobile && readingMode && (ttsPlaying || isStreamTTSPlaying || enhancedTTSPreparing) && (
				<div className="mobile-tts-playback-controls">
					<button
						className="tts-playback-btn"
						onClick={handleTTSPrev}
						title="上一条"
					>
						<Icons.skipBack size={20} />
					</button>
					<button
						className="tts-playback-btn play-pause"
						onClick={handleTTSToggle}
						title={ttsPlaying ? "暂停" : "播放"}
					>
						{ttsPlaying ? <Icons.pause size={24} /> : <Icons.play size={24} />}
					</button>
					<button
						className="tts-playback-btn"
						onClick={handleTTSNext}
						title="下一条"
					>
						<Icons.skipForward size={20} />
					</button>
				</div>
			)}

			{/* 移动端阅读栏 - 依附在 mobile-tab-bar 之上 */}
			{isMobile && readingMode && (
				<div className="mobile-reader-bar">
					<button
							className={`mobile-reader-bar-btn ${ttsPlaying ? "playing" : ""}`}
							onClick={handleTTSToggle}
							title="朗读"
						>
							<Icons.bookHeadphones size={18} />
						</button>
						<button
							className={`mobile-reader-bar-btn ${enhancedTTSPreparing ? "preparing" : ""} ${isStreamTTSWaitingForStart ? "waiting-selection" : ""}`}
							onClick={handleEnterStreamTTSSelectionMode}
							disabled={enhancedTTSPreparing}
							title={isStreamTTSWaitingForStart ? "取消选择段落" : "情感朗读"}
						>
							{enhancedTTSPreparing ? (
								<span className="spinner"></span>
							) : isStreamTTSWaitingForStart ? (
								<Icons.close size={18} />
							) : (
								<Icons.volume size={18} />
							)}
						</button>
						<button
							className={`mobile-reader-bar-btn ${showTTSPanel ? "active" : ""}`}
							onClick={() => {
								if (showTTSPanel) {
									setShowTTSPanel(false);
								} else {
									setShowTTSPanel(true);
									setShowReadingSettings(false);
								}
							}}
						>
							<Icons.bookAudio size={18} />
						</button>
						<button
							className={`mobile-reader-bar-btn ${showReadingSettings ? "active" : ""}`}
							onClick={() => {
								if (showReadingSettings) {
									setShowReadingSettings(false);
								} else {
									setShowReadingSettings(true);
									setShowTTSPanel(false);
								}
							}}
						>
							<Icons.lineStyle size={18} />
						</button>
				</div>
			)}

			{/* 桌面端播放控制条 - 悬浮在阅读栏上方 */}
			{!isMobile && readingMode && (ttsPlaying || isStreamTTSPlaying || enhancedTTSPreparing) && (
				<div className="desktop-tts-playback-controls">
					<button
						className="tts-playback-btn"
						onClick={handleTTSPrev}
						title="上一条"
					>
						<Icons.skipBack size={18} />
					</button>
					<button
						className="tts-playback-btn play-pause"
						onClick={handleTTSToggle}
						title={ttsPlaying ? "暂停" : "播放"}
					>
						{ttsPlaying ? <Icons.pause size={22} /> : <Icons.play size={22} />}
					</button>
					<button
						className="tts-playback-btn"
						onClick={handleTTSNext}
						title="下一条"
					>
						<Icons.skipForward size={18} />
					</button>
				</div>
			)}

			{/* 桌面端阅读栏 - 悬浮在右下角 */}
			{!isMobile && readingMode && (
				<div className="desktop-reader-bar">
					<div className="desktop-reader-bar-actions">
						<button
							className={`desktop-reader-bar-btn ${ttsPlaying ? "playing" : ""}`}
							onClick={handleTTSToggle}
							title="朗读"
						>
							<Icons.bookHeadphones size={16} />
							<span>朗读</span>
						</button>
						<button
							className={`desktop-reader-bar-btn ${enhancedTTSPreparing ? "preparing" : ""} ${isStreamTTSWaitingForStart ? "waiting-selection" : ""}`}
							onClick={handleEnterStreamTTSSelectionMode}
							disabled={enhancedTTSPreparing}
							title={isStreamTTSWaitingForStart ? "取消选择段落" : "情感朗读"}
						>
							{enhancedTTSPreparing ? (
								<>
									<span className="spinner"></span>
									<span>AI增强中...</span>
								</>
							) : isStreamTTSWaitingForStart ? (
								<>
									<Icons.close size={16} />
									<span>取消选择</span>
								</>
							) : (
								<>
									<Icons.volume size={16} />
									<span>情感朗读</span>
								</>
							)}
						</button>
						<button
							className={`desktop-reader-bar-btn ${showTTSPanel ? "active" : ""}`}
							onClick={() => {
								if (showTTSPanel) {
									setShowTTSPanel(false);
								} else {
									setShowTTSPanel(true);
									setShowReadingSettings(false);
								}
							}}
						>
							<Icons.bookAudio size={16} />
							<span>语音设置</span>
						</button>
						<button
							className={`desktop-reader-bar-btn ${showReadingSettings ? "active" : ""}`}
							onClick={() => {
								if (showReadingSettings) {
									setShowReadingSettings(false);
								} else {
									setShowReadingSettings(true);
									setShowTTSPanel(false);
								}
							}}
						>
							<Icons.lineStyle size={16} />
							<span>阅读设置</span>
						</button>
					</div>
					<div className="reading-progress">
						<div className="progress-info">
							<span className="progress-label">阅读进度</span>
							<span className="progress-value">{readingProgressPercent}%</span>
						</div>
						<div className="progress-bar">
							<div className="progress-fill" style={{ width: `${readingProgressPercent}%` }}></div>
						</div>
						<div className="time-info">
							<span className="time-label">预计剩余</span>
							<span className="time-value">{estimatedRemainingMinutes > 0 ? `${estimatedRemainingMinutes} 分钟` : '--'}</span>
						</div>
					</div>
				</div>
			)}

					{/* 章节列表弹窗 */}
					{showChapterList && (
						<div
							className="chapter-list-overlay"
							onClick={() => {
								setShowChapterList(false);
								setShowReadingSettings(false);
							}}
						>
							<div className="chapter-list-modal modal-container" onClick={(e) => e.stopPropagation()}>
								<div className="config-header">
									<div className="config-title">
										<Icons.list size={18} />
										<span>目录</span>
									</div>
									<button
										className="close-btn"
										onClick={() => setShowChapterList(false)}
									>
										<svg
											width="16"
											height="16"
											viewBox="0 0 16 16"
											fill="none"
											stroke="currentColor"
											strokeWidth="2"
										>
											<path d="M3 3L13 13M13 3L3 13" />
										</svg>
									</button>
								</div>
								<div className="chapter-list-content" ref={chapterListContentRef}>
									{chapters.map((ch, index) => {
										const isActive = index === currentChapterIndex;
										const hasNoTitle = !ch.title || /^第[\d一二三四五六七八九十]+[章回]$/.test(ch.title);
										const isSuggesting = suggestingChapterIndex === index;
										const showSuggestions = suggestingChapterId === ch.id && chapterTitleSuggestions.length > 0;
										
										return (
											<div key={ch.id}>
												<div
													ref={isActive ? activeChapterItemRef : null}
													className={`chapter-list-item${isActive ? " active" : ""}`}
													onClick={() => {
														setCurrentChapterIndex(index);
														setShowChapterList(false);
													}}
												>
													<span className="chapter-index">{index + 1}</span>
													<span className="chapter-name">
														{ch.title || `第 ${index + 1} 章`}
													</span>
													{hasNoTitle && (
														<button
															className="suggest-title-btn"
															onClick={(e) => {
																e.stopPropagation();
																handleSuggestChapterTitle(index);
															}}
															disabled={isSuggesting}
														>
															<Icons.sparkle size={14} />
														</button>
													)}
												</div>
												{showSuggestions && (
													<div className="chapter-title-suggestions">
														<div className="suggestions-header">
															<span>AI推荐章节名</span>
															<button
																className="close-suggestions"
																onClick={(e) => {
																	e.stopPropagation();
																	setChapterTitleSuggestions([]);
																	setSuggestingChapterId(null);
																}}
															>
																<Icons.x size={14} />
															</button>
														</div>
														{chapterTitleSuggestions.map((title, idx) => (
															<button
																key={idx}
																className="suggestion-item"
																onClick={(e) => {
																	e.stopPropagation();
																	handleApplyChapterTitle(index, title);
																}}
															>
																{title}
															</button>
														))}
													</div>
												)}
											</div>
										);
									})}
								</div>
							</div>
						</div>
					)}
				</>
			)}

			{/* 搜索弹窗 */}
			{showSearch && (
				<div className="chapter-list-overlay" onClick={closeSearch}>
					<div className="config-modal" onClick={(e) => e.stopPropagation()}>
						<div className="config-header">
							<div className="config-title">
								<Icons.search size={18} />
								<span>搜索</span>
							</div>
							<button className="close-btn" onClick={closeSearch}>
								<svg
									width="16"
									height="16"
									viewBox="0 0 16 16"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
								>
									<path d="M3 3L13 13M13 3L3 13" />
								</svg>
							</button>
						</div>
						<div className="search-input-row">
							<div className="search-input-wrapper">
								<Icons.search size={16} className="search-input-icon" />
								<input
									type="text"
									className="search-input"
									placeholder="输入搜索内容..."
									value={searchQuery}
									onChange={(e) => {
										setSearchQuery(e.target.value);
										performSearch(e.target.value);
									}}
									onKeyDown={(e) => {
										if (e.key === "Enter") {
											nextMatch();
										} else if (e.key === "Escape") {
											closeSearch();
										}
									}}
									autoFocus
								/>
								{searchQuery && (
									<button
										className="search-clear-btn"
										onClick={() => {
											setSearchQuery("");
											performSearch("");
										}}
									>
										<Icons.close size={14} />
									</button>
								)}
							</div>
							<span className="search-count">
								{searchResults.length > 0 ? `${currentMatchIndex + 1}/${searchResults.length}` : searchQuery ? "无匹配" : ""}
							</span>
						</div>
						<div className="search-nav">
							<button className="search-nav-btn" onClick={prevMatch} disabled={searchResults.length === 0} title="上一个">
								<Icons.chevronUp size={16} />
							</button>
							<button className="search-nav-btn" onClick={nextMatch} disabled={searchResults.length === 0} title="下一个">
								<Icons.chevronDown size={16} />
							</button>
						</div>
						<div className="search-results-list">
							{searchResults.map((result, index) => (
								<div
									key={index}
									className={`search-result-item${index === currentMatchIndex ? " current" : ""}`}
									onClick={() => handleSearchResultClick(index)}
								>
									{result.text}
								</div>
							))}
						</div>
					</div>
				</div>
			)}

			{/* 阅读时长提醒弹窗 */}
			{showReadingReminder && (
				<div className="modal-overlay" onClick={() => setShowReadingReminder(false)}>
					<div className="config-modal" onClick={(e) => e.stopPropagation()}>
						<div className="config-header">
							<div className="config-title">
								<Icons.eye size={18} />
								<span>温馨提醒</span>
							</div>
							<button className="close-btn" onClick={() => setShowReadingReminder(false)}>
								<svg
									width="16"
									height="16"
									viewBox="0 0 16 16"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
								>
									<path d="M3 3L13 13M13 3L3 13" />
								</svg>
							</button>
						</div>
						<div className="config-body">
							<div className="reading-reminder-content">
								<div className="reading-reminder-message">
									您已阅读 {Math.floor(readingTimeElapsed / 60000)} 分钟，请注意休息，保护眼睛！
								</div>
								<div className="reading-reminder-actions">
									<button className="action-btn primary" onClick={() => setShowReadingReminder(false)}>
										继续阅读
									</button>
									<button className="action-btn secondary" onClick={() => {
										setShowReadingReminder(false);
										setReadingMode(false);
									}}>
										退出阅读模式
									</button>
								</div>
							</div>
						</div>
					</div>
				</div>
			)}

			{/* 检测到新角色弹窗 */}
			{showNewCharacterModal && detectedNewCharacters.length > 0 && (
				<div className="modal-overlay" onClick={() => setShowNewCharacterModal(false)}>
					<div className="config-modal" onClick={(e) => e.stopPropagation()}>
						<div className="config-header">
							<div className="config-title">
								<Icons.userRoundPlus size={18} />
								<span>检测到新角色</span>
							</div>
							<button className="close-btn" onClick={() => setShowNewCharacterModal(false)}>
								<svg
									width="16"
									height="16"
									viewBox="0 0 16 16"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
								>
									<path d="M3 3L13 13M13 3L3 13" />
								</svg>
							</button>
						</div>
						<div className="config-body">
							<div className="new-character-modal-content">
								<div className="new-character-message">
									情感朗读时检测到 {detectedNewCharacters.length} 个新角色，是否添加到角色列表？
								</div>
								<div className="new-character-list">
									{detectedNewCharacters.map((name) => (
										<div key={name} className="new-character-item">
											<Icons.user size={16} />
											<span>{name}</span>
										</div>
									))}
								</div>
								<div className="new-character-actions">
									<button className="action-btn primary" onClick={() => handleAddNewCharacters(detectedNewCharacters)}>
										全部添加
									</button>
									<button className="action-btn secondary" onClick={() => setShowNewCharacterModal(false)}>
										稍后再说
									</button>
								</div>
							</div>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
