// ============================================================
// 全局应用状态（AI 配置 + 小说列表持久化到 localStorage）
// ============================================================
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Novel, Chapter, AIConfig, AIProvider, AppTab, ProofreadQueueItem, ProofreadProgress, APIUsage, NovelCategory, CharacterInfo, CharacterRelationship } from "../types";
import { setLoggerEnabled, logger } from "../utils/logger";
import { saveNovelToStorage, saveCharacterConfigToStorage, getCharacterConfigFileName } from "../utils/fileExport";

// 剧本改编结果类型
interface ScriptResult {
	chapterId: number;
	segments: {
		chapterTitle: string;
		content: string;
		originalText: string;
	}[];
}

interface AppState {
	// 小说列表（持久化）
	novels: Novel[];
	// 当前选中的小说 ID
	currentNovelId: string | null;
	// 当前小说的章节（从 fullText 解析）
	chapters: Chapter[];
	currentChapterIndex: number;
	// 下一本新书的 bookId（按导入顺序分配）
	nextBookId: number;

	// 已校对状态记录（chapterId -> 是否已校对）
	proofreadStatus: Record<number, boolean>;

	// AI 配置
	aiConfig: AIConfig;
	// 按提供商分别存储的 API Key
	apiKeyMap: Partial<Record<AIProvider, string>>;

	// UI
	activeTab: AppTab;
	configModalOpen: boolean;
	showCharacterSettings: string | null; // 当前显示角色设置的小说ID
	fontSize: number;
	theme: "light" | "dark";
	readingMode: boolean;
	lineSpacing: number; // 行间距（px，16-80）
	paragraphIndent: number; // 首行缩进（0-4字符，整数）
	readingBackground:
		| "white"
		| "cream"
		| "sepia"
		| "mint"
		| "sky"
		| "lavender"
		| "peach"
		| "sage"
		| "slate"
		| "dark"
		| "custom"
		| "image"; // 阅读背景
	customTextColor: string; // 自定义文字颜色
	customBgColor: string; // 自定义背景颜色
	bgImageUrl: string; // 背景图片URL
	setReadingBackground: (
		background:
			| "white"
			| "cream"
			| "sepia"
			| "mint"
			| "sky"
			| "lavender"
			| "peach"
			| "sage"
			| "slate"
			| "dark"
			| "custom"
			| "image",
	) => void;
	setCustomColors: (textColor: string, bgColor: string) => void;
	setBgImageUrl: (url: string) => void;

	// 剧本改编结果缓存（按章节存储）
	scriptResults: Record<number, ScriptResult>;

	// 手动缓存保存时间戳
	lastCacheSaveTime: number | null;

	// 忽略单词列表（按小说存储）
	ignoredWords: Record<string, string[]>;

	// 忽略角色名列表（按小说存储，扫描检测时跳过）
	ignoredCharacterNames: Record<string, string[]>;

	// 校对任务队列
	proofreadQueue: ProofreadQueueItem[];
	// 当前正在执行的任务ID
	currentProofreadingTaskId: string | null;

	// 校对进度记录（按小说存储）
	proofreadProgress: Record<string, Record<number, ProofreadProgress>>;

	// API 使用统计
	apiUsage: APIUsage;

	// 小说分类（按小说ID存储）
	novelCategories: Record<string, NovelCategory>;

	// 阅读进度记录（按小说ID存储）
	readingProgress: Record<string, {
		currentChapterIndex: number;
		currentParagraphIndex: number;
		readingStartTime: number;
		totalReadingTime: number;
	}>;

	// 阅读时长提醒设置
	readingReminderEnabled: boolean;
	readingReminderMinutes: number;

	// UI 状态 - 隐藏已校对章节
	hideProofread: boolean;

	// Actions — 阅读进度
	saveReadingProgress: (novelId: string, chapterIndex: number, paragraphIndex: number) => void;
	getReadingProgress: (novelId: string) => {
		currentChapterIndex: number;
		currentParagraphIndex: number;
		readingStartTime: number;
		totalReadingTime: number;
	} | undefined;
	updateReadingTime: (novelId: string, elapsedTime: number) => void;

	// Actions — 阅读时长提醒
	setReadingReminderEnabled: (enabled: boolean) => void;
	setReadingReminderMinutes: (minutes: number) => void;

	// Actions — 隐藏已校对章节
	setHideProofread: (hide: boolean) => void;

	// Actions — 小说管理
	addNovel: (novel: Novel) => void;
	removeNovel: (id: string) => void;
	selectNovel: (id: string | null) => void;

	// Actions — 章节
	setChapters: (chapters: Chapter[]) => void;
	setCurrentChapter: (index: number) => void;
	setCurrentChapterIndex: (index: number) => void;

	// Actions — 文本替换（采纳修改），返回是否成功替换
	replaceParagraphText: (
		chapterId: number,
		paragraphIndex: number,
		oldText: string,
		newText: string,
		startIndex?: number,
		endIndex?: number,
	) => boolean;

	// Actions — 批量文本替换（采纳修改），返回替换成功数量
	replaceParagraphTextBatch: (
		chapterId: number,
		paragraphIndex: number,
		errors: Array<{
			oldText: string;
			newText: string;
			startIndex: number;
			endIndex: number;
		}>,
	) => number;

	// Actions — 直接替换整行（双击编辑）
	replaceLine: (chapterId: number, lineIndex: number, newLine: string) => void;

	// Actions — 剧本改编
	setScriptResult: (
		chapterId: number,
		segments: ScriptResult["segments"],
	) => void;
	getScriptResult: (chapterId: number) => ScriptResult | undefined;
	clearScriptResults: () => void;

	// Actions — 忽略单词
	addIgnoredWord: (novelId: string, word: string) => void;
	removeIgnoredWord: (novelId: string, word: string) => void;
	getIgnoredWords: (novelId: string) => string[];
	setIgnoredWords: (novelId: string, words: string[]) => void;
	clearIgnoredWords: (novelId: string) => void;

	// Actions — 忽略角色名
	addIgnoredCharacterName: (novelId: string, name: string) => void;
	getIgnoredCharacterNames: (novelId: string) => string[];
	setIgnoredCharacterNames: (novelId: string, names: string[]) => void;

	// Actions — 校对队列
	addToProofreadQueue: (items: Omit<ProofreadQueueItem, "id" | "status" | "startTime" | "endTime">[]) => void;
	removeFromProofreadQueue: (itemId: string) => void;
	updateQueueItemStatus: (itemId: string, status: ProofreadQueueItem["status"], errorMessage?: string) => void;
	clearProofreadQueue: () => void;
	setCurrentProofreadingTaskId: (taskId: string | null) => void;

	// Actions — 校对进度
	saveProofreadProgress: (novelId: string, chapterId: number, lastParagraphIndex: number, completed: boolean) => void;
	getProofreadProgress: (novelId: string, chapterId: number) => ProofreadProgress | undefined;
	setProofreadProgress: (novelId: string, progress: Record<number, ProofreadProgress>) => void;
	clearProofreadProgress: (novelId: string, chapterId?: number) => void;

	// Actions — API 使用统计
	incrementAPIUsage: (provider: string, success: boolean, tokens?: number) => void;
	resetAPIUsage: () => void;

	// Actions — 小说分类
	setNovelCategory: (novelId: string, category: NovelCategory) => void;
	getNovelCategory: (novelId: string) => NovelCategory | undefined;

	// Actions — 其他
	clearFile: () => void;
	setAIConfig: (config: Partial<AIConfig>) => void;
	setApiKeyForProvider: (provider: AIProvider, key: string) => void;
	getApiKeyForProvider: (provider: AIProvider) => string;
	setActiveTab: (tab: AppTab) => void;
	setConfigModalOpen: (open: boolean) => void;
	setShowCharacterSettings: (novelId: string | null) => void;
	setFontSize: (size: number) => void;
	setTheme: (theme: "light" | "dark") => void;
	setReadingMode: (enabled: boolean) => void;
	setLineSpacing: (spacing: number) => void;
	setParagraphIndent: (indent: number) => void;
	toggleProofreadStatus: (chapterId: number) => void;

	// 角色信息（按小说ID存储）
	novelCharacters: Record<string, CharacterInfo[]>;

	// Actions — 角色管理
	addCharacter: (novelId: string, character: Omit<CharacterInfo, "id">) => void;
	updateCharacter: (novelId: string, characterId: string, character: Partial<Omit<CharacterInfo, "id">>) => void;
	removeCharacter: (novelId: string, characterId: string) => void;
	getCharacters: (novelId: string) => CharacterInfo[];
	setCharactersForNovel: (novelId: string, characters: CharacterInfo[]) => void;

	// 人物关系（按小说ID存储）
	characterRelationships: Record<string, CharacterRelationship[]>;

	// Actions — 人物关系管理
	addRelationship: (novelId: string, relationship: Omit<CharacterRelationship, "id" | "novelId">) => void;
	updateRelationship: (novelId: string, relationshipId: string, relationship: Partial<Omit<CharacterRelationship, "id" | "novelId">>) => void;
	removeRelationship: (novelId: string, relationshipId: string) => void;
	removeRelationshipsForCharacter: (novelId: string, characterId: string) => void;
	getRelationshipsForNovel: (novelId: string) => CharacterRelationship[];
	setRelationshipsForNovel: (novelId: string, relationships: CharacterRelationship[]) => void;

	// 角色图谱节点位置（按小说ID存储）
	nodePositions: Record<string, Record<string, { x: number; y: number }>>;

	// Actions — 节点位置管理
	setNodePositions: (novelId: string, positions: Record<string, { x: number; y: number }>) => void;
	clearNodePositions: (novelId: string) => void;

	// Actions — 缓存管理
	saveCache: () => void;
}

const DEFAULT_AI_CONFIG: AIConfig = {
	baseURL: "https://api.deepseek.com/v1",
	apiKey: "",
	model: "deepseek-chat",
	customHeaders: {},
	maxCharsPerRequest: 2000,
	enableLogging: true,
};

export const useAppStore = create<AppState>()(
	persist(
		(set, get) => ({
			novels: [],
			currentNovelId: null,
			chapters: [],
			currentChapterIndex: 0,
			nextBookId: 1,
			aiConfig: DEFAULT_AI_CONFIG,
			apiKeyMap: {},
			activeTab: "proofread",
			configModalOpen: false,
			showCharacterSettings: null,
			fontSize: 16,
			theme: "dark",
			readingMode: false,
			lineSpacing: 32,
			paragraphIndent: 2,
			readingBackground: "cream",
			customTextColor: "#333333",
			customBgColor: "#FDF6E3",
			bgImageUrl: "",
			scriptResults: {},
			lastCacheSaveTime: null,
			proofreadStatus: {},
			ignoredWords: {},
			ignoredCharacterNames: {},
			proofreadQueue: [],
			currentProofreadingTaskId: null,
			proofreadProgress: {},
			apiUsage: {
				totalRequests: 0,
				successfulRequests: 0,
				failedRequests: 0,
				totalTokens: 0,
				lastReset: Date.now(),
				providerStats: {},
			},
			novelCategories: {},
			novelCharacters: {},
			characterRelationships: {},
			nodePositions: {},
			readingProgress: {},
			readingReminderEnabled: true,
			readingReminderMinutes: 30,
			hideProofread: false,

			addNovel: (novel) =>
				set((state) => {
					const bookId = state.nextBookId;
					const novelWithBookId = { ...novel, bookId };
					return {
						novels: [...state.novels, novelWithBookId],
						currentNovelId: novel.id,
						nextBookId: state.nextBookId + 1,
					};
				}),

			removeNovel: (id) =>
				set((state) => {
					const novels = state.novels.filter((n) => n.id !== id);
					return {
						novels,
						currentNovelId:
							state.currentNovelId === id
								? (novels[0]?.id ?? null)
								: state.currentNovelId,
					};
				}),

			selectNovel: (id) => set({ currentNovelId: id }),

			setChapters: (chapters) => set({ chapters, currentChapterIndex: 0 }),

			clearFile: () =>
				set({ chapters: [], currentChapterIndex: 0, scriptResults: {}, proofreadStatus: {} }),

			// 剧本改编结果操作
			setScriptResult: (
				chapterId: number,
				segments: ScriptResult["segments"],
			) =>
				set((state) => ({
					scriptResults: {
						...state.scriptResults,
						[chapterId]: { chapterId, segments },
					},
				})),

			getScriptResult: (chapterId: number) => {
				const state = get();
				return state.scriptResults[chapterId];
			},

			clearScriptResults: () => set({ scriptResults: {} }),

			// 忽略单词操作
			addIgnoredWord: (novelId, word) =>
				set((state) => {
					const currentWords = state.ignoredWords[novelId] ?? [];
					if (currentWords.includes(word)) {
						return state;
					}
					return {
						ignoredWords: {
							...state.ignoredWords,
							[novelId]: [...currentWords, word],
						},
					};
				}),

			removeIgnoredWord: (novelId, word) =>
				set((state) => {
					const currentWords = state.ignoredWords[novelId] ?? [];
					return {
						ignoredWords: {
							...state.ignoredWords,
							[novelId]: currentWords.filter((w) => w !== word),
						},
					};
				}),

			getIgnoredWords: (novelId) => {
				return get().ignoredWords[novelId] ?? [];
			},

			setIgnoredWords: (novelId, words) =>
				set((state) => ({
					ignoredWords: {
						...state.ignoredWords,
						[novelId]: words,
					},
				})),

			clearIgnoredWords: (novelId) =>
				set((state) => {
					const newIgnoredWords = { ...state.ignoredWords };
					delete newIgnoredWords[novelId];
					return { ignoredWords: newIgnoredWords };
				}),

			// 忽略角色名操作
			addIgnoredCharacterName: (novelId, name) =>
				set((state) => {
					const currentNames = state.ignoredCharacterNames[novelId] ?? [];
					if (currentNames.includes(name)) {
						return state;
					}
					return {
						ignoredCharacterNames: {
							...state.ignoredCharacterNames,
							[novelId]: [...currentNames, name],
						},
					};
				}),

			getIgnoredCharacterNames: (novelId) => {
				return get().ignoredCharacterNames[novelId] ?? [];
			},

			setIgnoredCharacterNames: (novelId, names) =>
				set((state) => ({
					ignoredCharacterNames: {
						...state.ignoredCharacterNames,
						[novelId]: names,
					},
				})),

			// 校对队列操作
			addToProofreadQueue: (items) =>
				set((state) => {
					const newItems: ProofreadQueueItem[] = items.map((item) => ({
						...item,
						id: `${item.novelId}-${item.chapterId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
						status: "pending",
					}));
					return {
						proofreadQueue: [...state.proofreadQueue, ...newItems],
					};
				}),

			removeFromProofreadQueue: (itemId) =>
				set((state) => ({
					proofreadQueue: state.proofreadQueue.filter((item) => item.id !== itemId),
				})),

			updateQueueItemStatus: (itemId, status, errorMessage) =>
				set((state) => ({
					proofreadQueue: state.proofreadQueue.map((item) => {
						if (item.id !== itemId) return item;
						return {
							...item,
							status,
							errorMessage,
							startTime: status === "running" ? Date.now() : item.startTime,
							endTime: status === "done" || status === "error" ? Date.now() : item.endTime,
						};
					}),
				})),

			clearProofreadQueue: () => set({ proofreadQueue: [] }),

			setCurrentProofreadingTaskId: (taskId) => set({ currentProofreadingTaskId: taskId }),

			// 校对进度操作
			saveProofreadProgress: (novelId, chapterId, lastParagraphIndex, completed) =>
				set((state) => ({
					proofreadProgress: {
						...state.proofreadProgress,
						[novelId]: {
							...state.proofreadProgress[novelId],
							[chapterId]: {
								novelId,
								chapterId,
								lastParagraphIndex,
								completed,
								updatedAt: Date.now(),
							},
						},
					},
				})),

			getProofreadProgress: (novelId, chapterId) => {
				const state = get();
				return state.proofreadProgress[novelId]?.[chapterId];
			},

			setProofreadProgress: (novelId, progress) =>
				set((state) => ({
					proofreadProgress: {
						...state.proofreadProgress,
						[novelId]: progress,
					},
				})),

			clearProofreadProgress: (novelId, chapterId) =>
				set((state) => {
					const newProgress = { ...state.proofreadProgress };
					if (chapterId !== undefined) {
						if (newProgress[novelId]) {
							delete newProgress[novelId][chapterId];
						}
					} else {
						delete newProgress[novelId];
					}
					return { proofreadProgress: newProgress };
				}),

			// API 使用统计
			incrementAPIUsage: (provider, success, tokens = 0) =>
				set((state) => {
					const providerStats = { ...state.apiUsage.providerStats };
					providerStats[provider] = {
						requests: (providerStats[provider]?.requests || 0) + 1,
						success: (providerStats[provider]?.success || 0) + (success ? 1 : 0),
						failure: (providerStats[provider]?.failure || 0) + (success ? 0 : 1),
						tokens: (providerStats[provider]?.tokens || 0) + tokens,
					};
					return {
						apiUsage: {
							...state.apiUsage,
							totalRequests: state.apiUsage.totalRequests + 1,
							successfulRequests: state.apiUsage.successfulRequests + (success ? 1 : 0),
							failedRequests: state.apiUsage.failedRequests + (success ? 0 : 1),
							totalTokens: state.apiUsage.totalTokens + tokens,
							providerStats,
						},
					};
				}),

			resetAPIUsage: () =>
				set({
					apiUsage: {
						totalRequests: 0,
						successfulRequests: 0,
						failedRequests: 0,
						totalTokens: 0,
						lastReset: Date.now(),
						providerStats: {},
					},
				}),

			// 小说分类操作
			setNovelCategory: (novelId, category) =>
				set((state) => ({
					novelCategories: {
						...state.novelCategories,
						[novelId]: category,
					},
				})),

			getNovelCategory: (novelId) => {
				const state = get();
				return state.novelCategories[novelId];
			},

			// 阅读进度操作
			saveReadingProgress: (novelId, chapterIndex, paragraphIndex) =>
				set((state) => ({
					readingProgress: {
						...state.readingProgress,
						[novelId]: {
							...state.readingProgress[novelId],
							currentChapterIndex: chapterIndex,
							currentParagraphIndex: paragraphIndex,
							readingStartTime: Date.now(),
						},
					},
				})),

			getReadingProgress: (novelId) => {
				const state = get();
				return state.readingProgress[novelId];
			},

			updateReadingTime: (novelId, elapsedTime) =>
				set((state) => ({
					readingProgress: {
						...state.readingProgress,
						[novelId]: {
							...state.readingProgress[novelId],
							totalReadingTime: (state.readingProgress[novelId]?.totalReadingTime || 0) + elapsedTime,
						},
					},
				})),

			// 阅读时长提醒设置
			setReadingReminderEnabled: (enabled) => set({ readingReminderEnabled: enabled }),
			setReadingReminderMinutes: (minutes) => set({ readingReminderMinutes: minutes }),

			// 隐藏已校对章节设置
			setHideProofread: (hide) => set({ hideProofread: hide }),

			setCurrentChapter: (index) => set({ currentChapterIndex: index }),

			setCurrentChapterIndex: (index) => set({ currentChapterIndex: index }),

			replaceParagraphText: (chapterId, paragraphIndex, oldText, newText, startIndex?: number, endIndex?: number) => {
				let replaced = false;
				set((state) => {
					// 更新章节内容（分割逻辑与 splitParagraphs 保持一致）
					const chapters = state.chapters.map((ch) => {
						if (ch.id !== chapterId) return ch;

						// 与 splitParagraphs 一致：严格按 \n 分行
						const paragraphs = ch.content.split("\n");

						if (paragraphIndex < paragraphs.length) {
							let para = paragraphs[paragraphIndex];
							const original = para;

							// 如果 oldText 和 newText 相同，不需要替换
							if (oldText === newText) {
								logger.debug(`[appStore] replaceParagraphText skip: oldText === newText, chapterId=${chapterId}, paragraphIndex=${paragraphIndex}`);
								return ch;
							}

							// 1. 优先使用精确位置替换（如果提供了有效位置）
							if (startIndex !== undefined && endIndex !== undefined && startIndex >= 0 && endIndex > startIndex && endIndex <= para.length) {
								// 验证位置处的文本是否与 oldText 匹配
								const actualText = para.slice(startIndex, endIndex);
								if (actualText === oldText) {
									const before = para.slice(0, startIndex);
									const after = para.slice(endIndex);
									const newPara = before + newText + after;
									logger.debug(`[appStore] replaceParagraphText (exact position): paragraphIndex=${paragraphIndex}, startIndex=${startIndex}, endIndex=${endIndex}, oldText="${oldText}", newText="${newText}"`);
									para = newPara;
									replaced = true;
								} else {
									logger.debug(`[appStore] replaceParagraphText position mismatch: expected "${oldText}", actual "${actualText}"`);
									// 位置不匹配，降级使用 indexOf 查找
								}
							}

							// 2. 如果没有精确位置或位置不匹配，使用智能查找
							if (!replaced) {
								let foundIdx = -1;
								
								// 优先在预期位置附近搜索（考虑到前面的修改可能影响位置）
								if (startIndex !== undefined) {
									// 在预期位置前后各5个字符范围内搜索
									const searchStart = Math.max(0, startIndex - 5);
									const searchEnd = Math.min(para.length, startIndex + oldText.length + 5);
									const searchRange = para.slice(searchStart, searchEnd);
									const relativeIdx = searchRange.indexOf(oldText);
									if (relativeIdx >= 0) {
										foundIdx = searchStart + relativeIdx;
									}
								}
								
								// 【重要】如果预期位置附近找不到，不使用全局indexOf
								// 避免错误地匹配到段落中其他相同的文本
								logger.debug(`[appStore] replaceParagraphText: paragraphIndex=${paragraphIndex}, oldText="${oldText}", newText="${newText}", foundIdx=${foundIdx}, expectedStart=${startIndex}, para length=${para.length}`);
								if (foundIdx >= 0) {
									const before = para.slice(0, foundIdx);
									const after = para.slice(foundIdx + oldText.length);
									const newPara = before + newText + after;
									logger.debug(`[appStore] replaceParagraphText: before="${before.slice(-20)}", after="${after.slice(0, 20)}", newPara length=${newPara.length}`);
									para = newPara;
									replaced = true;
								} else {
									// 如果预期位置附近找不到，不进行替换
									// 避免错误地匹配到段落中其他相同的文本
									logger.debug(`[appStore] replaceParagraphText not found near expected position: oldText="${oldText}", newText="${newText}", chapterId=${chapterId}, paragraphIndex=${paragraphIndex}, expectedStart=${startIndex}`);
								}
							}

							if (para !== original) {
								paragraphs[paragraphIndex] = para;
							} else if (replaced) {
								// 如果 replaced 为 true 但段落没变，说明 oldText === newText
								replaced = false;
							}
							return { ...ch, content: paragraphs.join("\n") };
						}
						return ch;
					});

					// 同步更新 novels 中的 fullText
					const novelId = state.currentNovelId;
					let novels = state.novels;
					if (novelId) {
						novels = novels.map((n) => {
							if (n.id !== novelId) return n;
							// 用 chapters 重建 fullText
							const fullText = chapters.map((ch) => ch.content).join("");
							return { ...n, fullText };
						});
					}

					return { chapters, novels };
				});
				if (replaced) {
					const state = get();
					const novel = state.novels.find(n => n.id === state.currentNovelId);
					logger.file('[appStore] replaceParagraphText saving, novel:', novel?.name, 'fullText length:', novel?.fullText?.length);
					if (novel) {
						void saveNovelToStorage(`${novel.name}.txt`, novel.fullText);
					}
				}
				return replaced;
			},

			/** 批量替换段落中的多个错误（从后往前处理，避免位置偏移） */
			replaceParagraphTextBatch: (chapterId: number, paragraphIndex: number, errors: Array<{
				oldText: string;
				newText: string;
				startIndex: number;
				endIndex: number;
			}>) => {
				let replacedCount = 0;
				set((state) => {
					// 更新章节内容
					const chapters = state.chapters.map((ch) => {
						if (ch.id !== chapterId) return ch;

						const paragraphs = ch.content.split("\n");
						if (paragraphIndex >= paragraphs.length) return ch;

						let para = paragraphs[paragraphIndex];
						const original = para;

						// 关键优化：从后往前排序错误，避免替换后位置偏移
						const sortedErrors = [...errors].sort((a, b) => b.startIndex - a.startIndex);

						for (const err of sortedErrors) {
							// 重新在当前段落中查找 oldText 的准确位置
							// 这样可以避免因 AI 返回位置不准确导致的替换失败
							const foundIdx = para.indexOf(err.oldText);
							if (foundIdx >= 0) {
								const actualStart = foundIdx;
								const actualEnd = foundIdx + err.oldText.length;
								para = para.slice(0, actualStart) + err.newText + para.slice(actualEnd);
								replacedCount++;
							} else {
								// 尝试模糊匹配（去除空白字符后）
								const normalize = (s: string) => s.replace(/\s+/g, "");
								const normPara = normalize(para);
								const normOld = normalize(err.oldText);
								const fuzzyIdx = normPara.indexOf(normOld);
								if (fuzzyIdx >= 0) {
									// 反向定位真实字符位置
									let charCount = 0;
									let realStart = -1;
									let realEnd = -1;
									for (let j = 0; j < para.length; j++) {
										if (!/\s/.test(para[j])) {
											if (charCount === fuzzyIdx) realStart = j;
											if (charCount === fuzzyIdx + normOld.length - 1) {
												realEnd = j + 1;
												break;
											}
											charCount++;
										}
									}
									if (realStart >= 0 && realEnd > realStart) {
										para = para.slice(0, realStart) + err.newText + para.slice(realEnd);
										replacedCount++;
									} else {
										console.warn(`[appStore] 批量替换模糊匹配失败: "${err.oldText}"`);
									}
								} else {
									console.warn(`[appStore] 批量替换找不到文本: "${err.oldText}"`);
								}
							}
						}

						if (para !== original) {
							paragraphs[paragraphIndex] = para;
						}
						return { ...ch, content: paragraphs.join("\n") };
					});

					// 同步更新 novels 中的 fullText
					const novelId = state.currentNovelId;
					let novels = state.novels;
					if (novelId) {
						novels = novels.map((n) => {
							if (n.id !== novelId) return n;
							const fullText = chapters.map((ch) => ch.content).join("");
							return { ...n, fullText };
						});
					}

					return { chapters, novels };
				});
				if (replacedCount > 0) {
					const state = get();
					const novel = state.novels.find(n => n.id === state.currentNovelId);
					logger.file('[appStore] replaceParagraphTextBatch saving, replaced:', replacedCount, 'novel:', novel?.name);
					if (novel) {
						void saveNovelToStorage(`${novel.name}.txt`, novel.fullText);
					}
				}
				return replacedCount;
			},

			replaceLine: (chapterId, lineIndex, newLine) => {
				set((state) => {
					const chapters = state.chapters.map((ch) => {
						if (ch.id !== chapterId) return ch;
						const lines = ch.content.split("\n");
						if (lineIndex >= lines.length) return ch;
						lines[lineIndex] = newLine;
						return { ...ch, content: lines.join("\n") };
					});

					const novelId = state.currentNovelId;
					let novels = state.novels;
					if (novelId) {
						novels = novels.map((n) => {
							if (n.id !== novelId) return n;
							const fullText = chapters.map((ch) => ch.content).join("");
							return { ...n, fullText };
						});
					}

					return { chapters, novels };
				});
				const state = get();
				const novel = state.novels.find(n => n.id === state.currentNovelId);
				if (novel) {
					void saveNovelToStorage(`${novel.name}.txt`, novel.fullText);
				}
			},

			setAIConfig: (config) =>
				set((state) => {
					const next = { ...state.aiConfig, ...config };
					setLoggerEnabled(next.enableLogging);
					return { aiConfig: next };
				}),

			setApiKeyForProvider: (provider, key) =>
				set((state) => ({
					apiKeyMap: { ...state.apiKeyMap, [provider]: key },
				})),

			getApiKeyForProvider: (provider) => {
				return get().apiKeyMap[provider] ?? "";
			},

			setActiveTab: (tab) => set({ activeTab: tab }),

			setConfigModalOpen: (open) => set({ configModalOpen: open }),

			setShowCharacterSettings: (novelId) => set({ showCharacterSettings: novelId }),

			setFontSize: (size) => set({ fontSize: size }),

			setTheme: (theme) => set({ theme }),

			setReadingMode: (enabled) => set({ readingMode: enabled }),

			setLineSpacing: (spacing) => set({ lineSpacing: spacing }),

			setParagraphIndent: (indent) => set({ paragraphIndent: indent }),

			setReadingBackground: (background) =>
				set({ readingBackground: background }),

			setCustomColors: (textColor, bgColor) =>
				set({ customTextColor: textColor, customBgColor: bgColor }),

			setBgImageUrl: (url) => set({ bgImageUrl: url }),

			toggleProofreadStatus: (chapterId) =>
				set((state) => ({
					proofreadStatus: {
						...state.proofreadStatus,
						[chapterId]: !state.proofreadStatus[chapterId],
					},
				})),

			// 角色管理 - 持久化到文件系统
			addCharacter: (novelId, character) => {
				const newCharacter = { ...character, id: `char-${Date.now()}-${Math.random().toString(36).substr(2, 9)}` };
				set((state) => {
					const updatedCharacters = [
						...(state.novelCharacters[novelId] ?? []),
						newCharacter
					];
					// 异步保存到文件系统
					const novel = state.novels.find(n => n.id === novelId);
					if (novel) {
						const fileName = getCharacterConfigFileName(novel.name);
						saveCharacterConfigToStorage(fileName, JSON.stringify(updatedCharacters, null, 2)).catch(err => {
							console.error('[appStore] Failed to save character config:', err);
						});
					}
					return {
						novelCharacters: {
							...state.novelCharacters,
							[novelId]: updatedCharacters
						}
					};
				});
			},

			updateCharacter: (novelId, characterId, character) =>
				set((state) => {
					const updatedCharacters = (state.novelCharacters[novelId] ?? []).map((ch) =>
						ch.id === characterId ? { ...ch, ...character } : ch
					);
					// 异步保存到文件系统
					const novel = state.novels.find(n => n.id === novelId);
					if (novel) {
						const fileName = getCharacterConfigFileName(novel.name);
						saveCharacterConfigToStorage(fileName, JSON.stringify(updatedCharacters, null, 2)).catch(err => {
							console.error('[appStore] Failed to save character config:', err);
						});
					}
					return {
						novelCharacters: {
							...state.novelCharacters,
							[novelId]: updatedCharacters
						}
					};
				}),

			removeCharacter: (novelId, characterId) =>
				set((state) => {
					const updatedCharacters = (state.novelCharacters[novelId] ?? []).filter((ch) => ch.id !== characterId);
					// 异步保存到文件系统
					const novel = state.novels.find(n => n.id === novelId);
					if (novel) {
						const fileName = getCharacterConfigFileName(novel.name);
						saveCharacterConfigToStorage(fileName, JSON.stringify(updatedCharacters, null, 2)).catch(err => {
							console.error('[appStore] Failed to save character config:', err);
						});
					}
					return {
						novelCharacters: {
							...state.novelCharacters,
							[novelId]: updatedCharacters
						}
					};
				}),

			getCharacters: (novelId) => get().novelCharacters[novelId] ?? [],

			setCharactersForNovel: (novelId, characters) =>
				set((state) => ({
					novelCharacters: {
						...state.novelCharacters,
						[novelId]: characters
					}
				})),

			addRelationship: (novelId, relationship) => {
				const newRelationship: CharacterRelationship = {
					...relationship,
					id: `rel-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
					novelId,
				};
				set((state) => ({
					characterRelationships: {
						...state.characterRelationships,
						[novelId]: [...(state.characterRelationships[novelId] ?? []), newRelationship]
					}
				}));
			},

			updateRelationship: (novelId, relationshipId, relationship) =>
				set((state) => ({
					characterRelationships: {
						...state.characterRelationships,
						[novelId]: (state.characterRelationships[novelId] ?? []).map((r) =>
							r.id === relationshipId ? { ...r, ...relationship } : r
						)
					}
				})),

			removeRelationship: (novelId, relationshipId) =>
				set((state) => ({
					characterRelationships: {
						...state.characterRelationships,
						[novelId]: (state.characterRelationships[novelId] ?? []).filter((r) => r.id !== relationshipId)
					}
				})),

			removeRelationshipsForCharacter: (novelId, characterId) =>
				set((state) => ({
					characterRelationships: {
						...state.characterRelationships,
						[novelId]: (state.characterRelationships[novelId] ?? []).filter(
							(r) => r.sourceId !== characterId && r.targetId !== characterId
						)
					}
				})),

			getRelationshipsForNovel: (novelId) => get().characterRelationships[novelId] ?? [],

			setRelationshipsForNovel: (novelId: string, relationships: CharacterRelationship[]) =>
				set((state) => ({
					characterRelationships: {
						...state.characterRelationships,
						[novelId]: relationships
					}
				})),

			setNodePositions: (novelId, positions) =>
				set((state) => ({
					nodePositions: {
						...state.nodePositions,
						[novelId]: positions,
					}
				})),

			clearNodePositions: (novelId) =>
				set((state) => {
					const updated = { ...state.nodePositions };
					delete updated[novelId];
					return { nodePositions: updated };
				}),

			saveCache: () => {
				const now = Date.now();
				set((state) => {
					// 更新当前小说的 lastCacheSaveTime
					const novels = state.novels.map((n) => {
						if (n.id === state.currentNovelId) {
							return { ...n, lastCacheSaveTime: now };
						}
						return n;
					});
					return {
						novels,
						lastCacheSaveTime: now,
					};
				});
			},
		}),
		{
			name: "novel-proofreader-store",
			partialize: (state) => ({
				aiConfig: state.aiConfig,
				apiKeyMap: state.apiKeyMap,
				fontSize: state.fontSize,
				novels: state.novels,
				currentNovelId: state.currentNovelId,
				currentChapterIndex: state.currentChapterIndex,
				theme: state.theme,
				lastCacheSaveTime: state.lastCacheSaveTime,
				scriptResults: state.scriptResults,
				nextBookId: state.nextBookId,
				proofreadStatus: state.proofreadStatus,
				ignoredWords: state.ignoredWords,
				ignoredCharacterNames: state.ignoredCharacterNames,
				proofreadProgress: state.proofreadProgress,
				apiUsage: state.apiUsage,
				novelCategories: state.novelCategories,
				novelCharacters: state.novelCharacters,
				characterRelationships: state.characterRelationships,
				nodePositions: state.nodePositions,
				hideProofread: state.hideProofread,
			}),
			onRehydrateStorage: () => (state) => {
				if (state) {
					setLoggerEnabled(state.aiConfig.enableLogging);
				}
			},
		},
	),
);
