import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Novel, Chapter } from "../types";
import { saveNovelToStorage } from "../utils/fileExport";
import { normalizeCJKVariants } from "../utils/normalizeCJK";
import { logger } from "../utils/logger";

interface ScriptResult {
	chapterId: number;
	segments: { chapterTitle: string; content: string; originalText: string }[];
}

export interface NovelState {
	novels: Novel[];
	currentNovelId: string | null;
	chapters: Chapter[];
	currentChapterIndex: number;
	nextBookId: number;
	proofreadStatus: Record<number, boolean>;
	scriptResults: Record<number, ScriptResult>;
	lastCacheSaveTime: number | null;

	addNovel: (novel: Novel) => void;
	removeNovel: (id: string) => void;
	selectNovel: (id: string | null) => void;
	setChapters: (chapters: Chapter[]) => void;
	setCurrentChapter: (index: number) => void;
	setCurrentChapterIndex: (index: number) => void;
	clearFile: () => void;
	toggleProofreadStatus: (chapterId: number) => void;

	replaceParagraphText: (
		chapterId: number,
		paragraphIndex: number,
		oldText: string,
		newText: string,
		startIndex?: number,
		endIndex?: number,
	) => boolean;
	replaceParagraphTextBatch: (
		chapterId: number,
		paragraphIndex: number,
		errors: Array<{ oldText: string; newText: string; startIndex: number; endIndex: number }>,
	) => number;
	replaceLine: (chapterId: number, lineIndex: number, newLine: string) => void;

	/** 追加内容到指定章节末尾（用于AI续写） */
	appendToChapter: (chapterIndex: number, content: string) => void;

	setScriptResult: (chapterId: number, segments: ScriptResult["segments"]) => void;
	getScriptResult: (chapterId: number) => ScriptResult | undefined;
	clearScriptResults: () => void;

	saveCache: () => void;
	clearAllCache: () => void;
}

function syncNovelsFromChapters(chapters: Chapter[], novels: Novel[], novelId: string | null): Novel[] {
	if (!novelId) return novels;
	return novels.map((n) => {
		if (n.id !== novelId) return n;
		return { ...n, fullText: chapters.map((ch) => ch.content).join("") };
	});
}

function saveCurrentNovel(state: { currentNovelId: string | null; novels: Novel[] }): void {
	const novel = state.novels.find(n => n.id === state.currentNovelId);
	if (novel) {
		void saveNovelToStorage(`${novel.name}.txt`, novel.fullText);
	}
}

export const useNovelStore = create<NovelState>()(
	persist(
		(set, get) => ({
			novels: [],
			currentNovelId: null,
			chapters: [],
			currentChapterIndex: 0,
			nextBookId: 1,
			proofreadStatus: {},
			scriptResults: {},
			lastCacheSaveTime: null,

			addNovel: (novel) =>
				set((state) => {
					const bookId = state.nextBookId;
					logger.info('[novelStore]', `添加小说: name=${novel.name}, id=${novel.id}, bookId=${bookId}`);
					return {
						novels: [...state.novels, { ...novel, bookId }],
						currentNovelId: novel.id,
						nextBookId: state.nextBookId + 1,
					};
				}),

			removeNovel: (id) =>
				set((state) => {
					logger.info('[novelStore]', `删除小说: id=${id}`);
					const novels = state.novels.filter((n) => n.id !== id);
					return {
						novels,
						currentNovelId: state.currentNovelId === id ? (novels[0]?.id ?? null) : state.currentNovelId,
					};
				}),

			selectNovel: (id) => {
				logger.info('[novelStore]', `选择小说: ${id ?? 'null'}`);
				set({ currentNovelId: id });
			},

			setChapters: (chapters) => {
				logger.info('[novelStore]', `设置章节: 共 ${chapters.length} 章`);
				set((state) => {
					// 标准化 CJK 变体字/部首字
					const normalized = chapters.map(ch => ({
						...ch,
						content: normalizeCJKVariants(ch.content),
					}));
					return { chapters: normalized, currentChapterIndex: state.currentChapterIndex };
				});
			},

			setCurrentChapter: (index) => {
				logger.info('[novelStore]', `设置当前章节: ${index}`);
				set({ currentChapterIndex: index });
			},

			setCurrentChapterIndex: (index) => {
				logger.info('[novelStore]', `设置章节索引: ${index}`);
				set({ currentChapterIndex: index });
			},

			clearFile: () => {
				logger.info('[novelStore]', '清空文件状态');
				set({ chapters: [], currentChapterIndex: 0, scriptResults: {}, proofreadStatus: {} });
			},

			toggleProofreadStatus: (chapterId) =>
				set((state) => ({
					proofreadStatus: { ...state.proofreadStatus, [chapterId]: !state.proofreadStatus[chapterId] },
				})),

			replaceParagraphText: (chapterId, paragraphIndex, oldText, newText, startIndex?: number, endIndex?: number) => {
				logger.info('[novelStore]', `替换段落文本: chapterId=${chapterId}, paragraphIndex=${paragraphIndex}, oldText="${oldText.slice(0, 20)}${oldText.length > 20 ? '...' : ''}", newText="${newText.slice(0, 20)}${newText.length > 20 ? '...' : ''}"`);
				let replaced = false;
				set((state) => {
					const chapters = state.chapters.map((ch) => {
						if (ch.id !== chapterId) return ch;
						const paragraphs = ch.content.split("\n");
						
						if (paragraphIndex >= paragraphs.length) {
							logger.warn('[novelStore]', `段落索引越界: paragraphIndex=${paragraphIndex}, total=${paragraphs.length}`);
							return ch;
						}

						let para = paragraphs[paragraphIndex];
						const original = para;

						if (oldText === newText) return ch;

						const normalizeWhitespace = (s: string) => s.replace(/\s+/g, '');

						if (startIndex !== undefined && endIndex !== undefined && startIndex >= 0 && endIndex > startIndex && endIndex <= para.length) {
							const actualText = para.slice(startIndex, endIndex);
							if (actualText === oldText) {
								para = para.slice(0, startIndex) + newText + para.slice(endIndex);
								replaced = true;
								logger.info('[novelStore]', '替换成功: 精确索引匹配');
							} else if (normalizeWhitespace(actualText) === normalizeWhitespace(oldText)) {
								para = para.slice(0, startIndex) + newText + para.slice(endIndex);
								replaced = true;
								logger.info('[novelStore]', '替换成功: 空白不敏感索引匹配');
							}
						}

						if (!replaced && startIndex !== undefined) {
							const searchStart = Math.max(0, startIndex - 10);
							const searchEnd = Math.min(para.length, startIndex + oldText.length + 10);
							const searchRange = para.slice(searchStart, searchEnd);
							const relativeIdx = searchRange.indexOf(oldText);
							if (relativeIdx >= 0) {
								const foundIdx = searchStart + relativeIdx;
								para = para.slice(0, foundIdx) + newText + para.slice(foundIdx + oldText.length);
								replaced = true;
								logger.info('[novelStore]', `替换成功: 局部搜索匹配 (偏移=${foundIdx - startIndex})`);
							} else {
								const normalizedSearchRange = normalizeWhitespace(searchRange);
								const normalizedOldText = normalizeWhitespace(oldText);
								const relativeIdxNormalized = normalizedSearchRange.indexOf(normalizedOldText);
								if (relativeIdxNormalized >= 0) {
									let charCount = 0;
									let realStart = -1;
									for (let j = searchStart; j < searchEnd && charCount <= relativeIdxNormalized; j++) {
										if (!/\s/.test(para[j])) {
											if (charCount === relativeIdxNormalized) realStart = j;
											charCount++;
										}
									}
									if (realStart >= 0) {
										let realEnd = realStart;
										let remaining = oldText.length;
										while (realEnd < para.length && remaining > 0) {
											if (!/\s/.test(para[realEnd])) remaining--;
											realEnd++;
										}
										para = para.slice(0, realStart) + newText + para.slice(realEnd);
										replaced = true;
										logger.info('[novelStore]', '替换成功: 局部空白不敏感匹配');
									}
								}
							}
						}

						if (!replaced) {
							const globalIdx = para.indexOf(oldText);
							if (globalIdx >= 0) {
								para = para.slice(0, globalIdx) + newText + para.slice(globalIdx + oldText.length);
								replaced = true;
								logger.info('[novelStore]', `替换成功: 全局搜索匹配 (位置=${globalIdx})`);
							} else {
								const normalizedPara = normalizeWhitespace(para);
								const normalizedOldText = normalizeWhitespace(oldText);
								const fuzzyIdx = normalizedPara.indexOf(normalizedOldText);
								if (fuzzyIdx >= 0) {
									let charCount = 0;
									let realStart = -1;
									for (let j = 0; j < para.length && charCount <= fuzzyIdx; j++) {
										if (!/\s/.test(para[j])) {
											if (charCount === fuzzyIdx) realStart = j;
											charCount++;
										}
									}
									if (realStart >= 0) {
										let realEnd = realStart;
										let remaining = normalizedOldText.length;
										while (realEnd < para.length && remaining > 0) {
											if (!/\s/.test(para[realEnd])) remaining--;
											realEnd++;
										}
										para = para.slice(0, realStart) + newText + para.slice(realEnd);
										replaced = true;
										logger.info('[novelStore]', '替换成功: 全局空白不敏感匹配');
									}
								}
							}
						}

						if (!replaced) {
							logger.warn('[novelStore]', `替换失败: 在段落中找不到 "${oldText.slice(0, 30)}${oldText.length > 30 ? '...' : ''}"`);
						}

						if (para !== original) paragraphs[paragraphIndex] = para;
						else if (replaced) replaced = false;

						return { ...ch, content: paragraphs.join("\n") };
					});

					const novels = syncNovelsFromChapters(chapters, state.novels, state.currentNovelId);
					return { chapters, novels };
				});
				if (replaced) saveCurrentNovel(get());
				return replaced;
			},

			replaceParagraphTextBatch: (chapterId, paragraphIndex, errors) => {
				let replacedCount = 0;
				set((state) => {
					const chapters = state.chapters.map((ch) => {
						if (ch.id !== chapterId) return ch;
						const paragraphs = ch.content.split("\n");
						if (paragraphIndex >= paragraphs.length) return ch;

						let para = paragraphs[paragraphIndex];
						const original = para;
						const sortedErrors = [...errors].sort((a, b) => b.startIndex - a.startIndex);

						for (const err of sortedErrors) {
							const foundIdx = para.indexOf(err.oldText);
							if (foundIdx >= 0) {
								para = para.slice(0, foundIdx) + err.newText + para.slice(foundIdx + err.oldText.length);
								replacedCount++;
							} else {
								const normalize = (s: string) => s.replace(/\s+/g, "");
								const fuzzyIdx = normalize(para).indexOf(normalize(err.oldText));
								if (fuzzyIdx >= 0) {
									let charCount = 0;
									let realStart = -1;
									let realEnd = -1;
									for (let j = 0; j < para.length; j++) {
										if (!/\s/.test(para[j])) {
											if (charCount === fuzzyIdx) realStart = j;
											if (charCount === fuzzyIdx + normalize(err.oldText).length - 1) {
												realEnd = j + 1;
												break;
											}
											charCount++;
										}
									}
									if (realStart >= 0 && realEnd > realStart) {
										para = para.slice(0, realStart) + err.newText + para.slice(realEnd);
										replacedCount++;
									}
								}
							}
						}

						if (para !== original) paragraphs[paragraphIndex] = para;
						return { ...ch, content: paragraphs.join("\n") };
					});

					const novels = syncNovelsFromChapters(chapters, state.novels, state.currentNovelId);
					return { chapters, novels };
				});
				if (replacedCount > 0) saveCurrentNovel(get());
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
					const novels = syncNovelsFromChapters(chapters, state.novels, state.currentNovelId);
					return { chapters, novels };
				});
				saveCurrentNovel(get());
			},

			appendToChapter: (chapterIndex, content) => {
				logger.info('[novelStore]', `追加内容到章节: chapterIndex=${chapterIndex}, 新增 ${content.length} 字符`);
				set((state) => {
					if (chapterIndex < 0 || chapterIndex >= state.chapters.length) return state;
					const chapters = state.chapters.map((ch, i) => {
						if (i !== chapterIndex) return ch;
						return { ...ch, content: ch.content + "\n" + content };
					});
					const novels = syncNovelsFromChapters(chapters, state.novels, state.currentNovelId);
					return { chapters, novels };
				});
				saveCurrentNovel(get());
			},

			setScriptResult: (chapterId, segments) =>
				set((state) => ({
					scriptResults: { ...state.scriptResults, [chapterId]: { chapterId, segments } },
				})),

			getScriptResult: (chapterId) => get().scriptResults[chapterId],

			clearScriptResults: () => set({ scriptResults: {} }),

			saveCache: () => {
				const now = Date.now();
				set((state) => ({
					novels: state.novels.map((n) => n.id === state.currentNovelId ? { ...n, lastCacheSaveTime: now } : n),
					lastCacheSaveTime: now,
				}));
			},

			clearAllCache: () =>
				set({
					novels: [],
					currentNovelId: null,
					chapters: [],
					currentChapterIndex: 0,
					nextBookId: 1,
					proofreadStatus: {},
					scriptResults: {},
				}),
		}),
		{
			name: "novel-proofreader-novels",
			version: 0,
			migrate: (persistedState) => persistedState as NovelState,
		},
	),
);
