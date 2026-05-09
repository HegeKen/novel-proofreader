// ============================================================
// 全局应用状态（AI 配置 + 小说列表持久化到 localStorage）
// ============================================================
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Novel, Chapter, AIConfig, AIProvider, AppTab } from "../types";
import { setLoggerEnabled } from "../utils/logger";
import { saveNovelToStorage } from "../utils/fileExport";

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

	// Actions — 其他
	clearFile: () => void;
	setAIConfig: (config: Partial<AIConfig>) => void;
	setApiKeyForProvider: (provider: AIProvider, key: string) => void;
	getApiKeyForProvider: (provider: AIProvider) => string;
	setActiveTab: (tab: AppTab) => void;
	setConfigModalOpen: (open: boolean) => void;
	setFontSize: (size: number) => void;
	setTheme: (theme: "light" | "dark") => void;
	setReadingMode: (enabled: boolean) => void;
	setLineSpacing: (spacing: number) => void;
	setParagraphIndent: (indent: number) => void;
	toggleProofreadStatus: (chapterId: number) => void;

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

							// 1. 优先使用位置参数进行精确替换
							if (startIndex !== undefined && endIndex !== undefined && 
								startIndex >= 0 && endIndex > startIndex && 
								endIndex <= para.length) {
								// 验证位置处的文本是否匹配 oldText
								const actualText = para.slice(startIndex, endIndex);
								if (actualText === oldText) {
									para = para.slice(0, startIndex) + newText + para.slice(endIndex);
								} else {
									// 位置不匹配，降级到文本匹配
									console.warn(`[appStore] 位置不匹配，降级到文本匹配: 期望 "${oldText}"，实际 "${actualText}"`);
								}
							}

							// 2. 文本匹配替换（如果位置替换未成功）
							if (para === original && para.includes(oldText)) {
								para = para.replace(oldText, newText);
							} else if (para === original) {
								// 3. 容错匹配：去除所有空白字符后模糊查找
								const normalize = (s: string) => s.replace(/\s+/g, "");
								const normPara = normalize(para);
								const normOld = normalize(oldText);

								const fuzzyIdx = normPara.indexOf(normOld);
								if (fuzzyIdx >= 0) {
									// 反向定位：在原文中找到第 fuzzyIdx 个非空白字符的位置
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
										para =
											para.slice(0, realStart) + newText + para.slice(realEnd);
									}
								}
								// 4. 都找不到 → 不替换，保持原样
							}

							if (para !== original) {
								replaced = true;
								paragraphs[paragraphIndex] = para;
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
					console.log('[appStore] replaceParagraphText saving, novel:', novel?.name, 'fullText length:', novel?.fullText?.length);
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
							// 验证位置有效性
							if (err.startIndex >= 0 && err.endIndex > err.startIndex && 
								err.endIndex <= para.length) {
								const actualText = para.slice(err.startIndex, err.endIndex);
								if (actualText === err.oldText) {
									para = para.slice(0, err.startIndex) + err.newText + para.slice(err.endIndex);
									replacedCount++;
								} else {
									console.warn(`[appStore] 批量替换位置不匹配: 期望 "${err.oldText}"，实际 "${actualText}"`);
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
					console.log('[appStore] replaceParagraphTextBatch saving, replaced:', replacedCount, 'novel:', novel?.name);
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
				scriptResults: state.scriptResults,
				nextBookId: state.nextBookId,
				proofreadStatus: state.proofreadStatus,
			}),
			onRehydrateStorage: () => (state) => {
				if (state) setLoggerEnabled(state.aiConfig.enableLogging);
			},
		},
	),
);
