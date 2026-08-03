import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Novel, Chapter } from "../types";
import { saveNovelToStorage, loadNovelsFromStorage } from "../utils/fileExport";
import { saveNovelText, getNovelStorageKey } from "../utils/novelStorage";
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

	/** 合并两个相邻段落 */
	mergeParagraphs: (
		chapterId: number,
		firstParagraphIndex: number,
		secondParagraphIndex: number,
		mergedText?: string,
	) => boolean;

	/** 追加内容到指定章节末尾（用于AI续写） */
	appendToChapter: (chapterIndex: number, content: string) => void;

	setScriptResult: (chapterId: number, segments: ScriptResult["segments"]) => void;
	getScriptResult: (chapterId: number) => ScriptResult | undefined;
	clearScriptResults: () => void;

	saveCache: () => void;
	saveCurrentNovel: () => void;
	clearAllCache: () => void;
	refreshNovels: () => Promise<void>;
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
		// 同步到 IndexedDB（防止 localStorage 溢出后数据丢失）
		void saveNovelText(getNovelStorageKey(novel.name), novel.fullText);
	}
}

function normalizeWhitespace(s: string): string {
	return s.replace(/\s+/g, '');
}

function findExactMatch(para: string, oldText: string, startIndex?: number, endIndex?: number): { found: boolean; start: number; end: number } {
	if (startIndex !== undefined && endIndex !== undefined && startIndex >= 0 && endIndex > startIndex && endIndex <= para.length) {
		const actualText = para.slice(startIndex, endIndex);
		if (actualText === oldText) {
			return { found: true, start: startIndex, end: endIndex };
		}
		if (normalizeWhitespace(actualText) === normalizeWhitespace(oldText)) {
			return { found: true, start: startIndex, end: endIndex };
		}
	}
	return { found: false, start: 0, end: 0 };
}

function findLocalMatch(para: string, oldText: string, startIndex?: number): { found: boolean; start: number; end: number } {
	if (startIndex === undefined) {
		return { found: false, start: 0, end: 0 };
	}

	const searchStart = Math.max(0, startIndex - 10);
	const searchEnd = Math.min(para.length, startIndex + oldText.length + 10);
	const searchRange = para.slice(searchStart, searchEnd);

	const relativeIdx = searchRange.indexOf(oldText);
	if (relativeIdx >= 0) {
		const foundIdx = searchStart + relativeIdx;
		return { found: true, start: foundIdx, end: foundIdx + oldText.length };
	}

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
			return { found: true, start: realStart, end: realEnd };
		}
	}

	return { found: false, start: 0, end: 0 };
}

function findGlobalMatch(para: string, oldText: string): { found: boolean; start: number; end: number } {
	const globalIdx = para.indexOf(oldText);
	if (globalIdx >= 0) {
		return { found: true, start: globalIdx, end: globalIdx + oldText.length };
	}

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
			return { found: true, start: realStart, end: realEnd };
		}
	}

	return { found: false, start: 0, end: 0 };
}

function replaceTextInParagraph(para: string, oldText: string, newText: string, startIndex?: number, endIndex?: number): { replaced: boolean; result: string } {
	if (oldText === newText) {
		return { replaced: false, result: para };
	}

	const exactMatch = findExactMatch(para, oldText, startIndex, endIndex);
	if (exactMatch.found) {
		return { replaced: true, result: para.slice(0, exactMatch.start) + newText + para.slice(exactMatch.end) };
	}

	const localMatch = findLocalMatch(para, oldText, startIndex);
	if (localMatch.found) {
		return { replaced: true, result: para.slice(0, localMatch.start) + newText + para.slice(localMatch.end) };
	}

	const globalMatch = findGlobalMatch(para, oldText);
	if (globalMatch.found) {
		return { replaced: true, result: para.slice(0, globalMatch.start) + newText + para.slice(globalMatch.end) };
	}

	return { replaced: false, result: para };
}

export { normalizeWhitespace, findExactMatch, findLocalMatch, findGlobalMatch, replaceTextInParagraph };

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

						const para = paragraphs[paragraphIndex];
						const { replaced: resultReplaced, result: newPara } = replaceTextInParagraph(para, oldText, newText, startIndex, endIndex);

						if (resultReplaced) {
							replaced = true;
							logger.info('[novelStore]', '替换成功');
							paragraphs[paragraphIndex] = newPara;
						} else {
							logger.warn('[novelStore]', `替换失败: 在段落中找不到 "${oldText.slice(0, 30)}${oldText.length > 30 ? '...' : ''}"`);
						}

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

			mergeParagraphs: (chapterId, firstParagraphIndex, secondParagraphIndex, mergedText) => {
				logger.info('[novelStore]', `合并段落: chapterId=${chapterId}, firstIndex=${firstParagraphIndex}, secondIndex=${secondParagraphIndex}`);
				let success = false;
				set((state) => {
					const chapters = state.chapters.map((ch) => {
						if (ch.id !== chapterId) return ch;
						const paragraphs = ch.content.split("\n");

						// 验证索引有效性
						if (firstParagraphIndex < 0 || firstParagraphIndex >= paragraphs.length) return ch;
						if (secondParagraphIndex < 0 || secondParagraphIndex >= paragraphs.length) return ch;

						// 确保 secondParagraphIndex > firstParagraphIndex
						if (secondParagraphIndex <= firstParagraphIndex) return ch;

						// 构建合并后的文本
						const firstText = paragraphs[firstParagraphIndex];
						const secondText = paragraphs[secondParagraphIndex];
						const merged = mergedText || `${firstText}${secondText.startsWith('\n') ? '' : '\n'}${secondText}`;

						// 替换第一个段落为合并文本，移除第二个段落
						paragraphs.splice(firstParagraphIndex, 1, merged);
						paragraphs.splice(secondParagraphIndex - 1, 1); // -1 因为已删除一个

						success = true;
						return { ...ch, content: paragraphs.join("\n") };
					});

					if (success) {
						const novels = syncNovelsFromChapters(chapters, state.novels, state.currentNovelId);
						return { chapters, novels };
					}
					return state;
				});

				if (success) {
					logger.info('[novelStore]', '段落合并成功');
					saveCurrentNovel(get());
				} else {
					logger.warn('[novelStore]', '段落合并失败');
				}
				return success;
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

			saveCurrentNovel: () => {
				saveCurrentNovel(get());
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

			refreshNovels: async () => {
				logger.info('[novelStore]', '刷新小说列表');
				const storedFileNames = await loadNovelsFromStorage();
				const existingNovels = get().novels;
				const existingNovelId = get().currentNovelId;

				if (storedFileNames.length === 0) {
					set({ novels: [], currentNovelId: null, chapters: [], currentChapterIndex: 0 });
					return;
				}

				const loadedNovels: Novel[] = [];
				for (const fileName of storedFileNames) {
					const name = fileName.replace(/\.txt$/i, '');
					const existingNovel = existingNovels.find((n) => n.name === name);
					loadedNovels.push({
						id: existingNovel?.id ?? `novel-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
						name,
						fullText: existingNovel?.fullText ?? '',
						importedAt: existingNovel?.importedAt ?? Date.now(),
						chapters: existingNovel?.chapters ?? [],
					});
				}

				if (loadedNovels.length > 0) {
					let selectedId = existingNovelId;
					if (!loadedNovels.find((n) => n.id === existingNovelId)) {
						selectedId = loadedNovels[0].id;
					}
					set({
						novels: loadedNovels,
						currentNovelId: selectedId,
					});
				} else {
					set({ novels: [], currentNovelId: null, chapters: [], currentChapterIndex: 0 });
				}
			},
		}),
		{
			name: "novel-proofreader-novels",
			version: 1,
			migrate: (persistedState) => persistedState as NovelState,
			// 排除 fullText 和 chapters content，避免 localStorage 溢出
			// 大文本通过 IndexedDB / Tauri FS 单独存储
			partialize: (state) => ({
				...state,
				// 清空 novels 中的 fullText，只保留元数据
				novels: state.novels.map(n => ({
					...n,
					fullText: "",
					chapters: n.chapters.map(ch => ({
						title: ch.title,
						content: "",
					})),
				})),
				// 清空当前章节内容，只保留结构
				chapters: state.chapters.map(ch => ({
					...ch,
					content: "",
				})),
			}),
		},
	),
);
