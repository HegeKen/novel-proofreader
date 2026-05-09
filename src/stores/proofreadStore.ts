// ============================================================
// 校对结果状态
// ============================================================
import { create } from "zustand";
import type { ParagraphResult, ProofreadError, ScriptTask } from "../types";

/** 采纳动画阶段 */
export interface ApplyAnimation {
	chapterId: number;
	paragraphIndex: number;
	phase: "highlight-old" | "replacing" | "highlight-new";
	errorId?: string;
	originalText?: string;
	correctedText?: string;
	startIndex?: number;
	endIndex?: number;
}

interface ProofreadState {
	// 每个章节的段落检测结果，key = chapterId
	results: Record<number, ParagraphResult[]>;
	// 当前高亮的段落索引
	highlightedParagraph: number | null;
	// 校对起始行（从 0 开始），null 表示从头开始
	startLine: number | null;
	// 采纳动画
	applyAnimation: ApplyAnimation | null;
	// 剧本转换任务
	scriptTasks: ScriptTask[];
	// 剧本转换进度
	scriptRunning: boolean;
	// 忽略单词列表（按小说存储）
	ignoredWords: Record<string, string[]>;

	// Actions
	setResults: (chapterId: number, results: ParagraphResult[]) => void;
	updateParagraphResult: (
		chapterId: number,
		paragraphIndex: number,
		result: Partial<ParagraphResult>,
	) => void;
	toggleErrorApplied: (
		chapterId: number,
		paragraphIndex: number,
		errorId: string,
	) => void;
	toggleErrorSkipped: (
		chapterId: number,
		paragraphIndex: number,
		errorId: string,
	) => void;
	applyAllErrors: (chapterId: number, paragraphIndex: number) => void;
	clearResults: (chapterId: number) => void;
	clearAllResults: () => void;
	setHighlightedParagraph: (index: number | null) => void;
	setStartLine: (line: number | null) => void;
	setApplyAnimation: (anim: ApplyAnimation | null) => void;

	// Ignored words actions (novel-level)
	addIgnoredWord: (novelId: string, word: string) => void;
	removeIgnoredWord: (novelId: string, word: string) => void;
	getIgnoredWords: (novelId: string) => string[];
	clearIgnoredWords: (novelId: string) => void;

	// Script actions
	addScriptTask: (task: ScriptTask) => void;
	updateScriptTask: (taskId: number, update: Partial<ScriptTask>) => void;
	clearScriptTasks: () => void;
	setScriptRunning: (running: boolean) => void;
}

export const useProofreadStore = create<ProofreadState>((set, get) => ({
	results: {},
	highlightedParagraph: null,
	startLine: null,
	applyAnimation: null,
	scriptTasks: [],
	scriptRunning: false,
	ignoredWords: {},

	setResults: (chapterId, results) =>
		set((state) => ({
			results: { ...state.results, [chapterId]: results },
		})),

	updateParagraphResult: (chapterId, paragraphIndex, result) =>
		set((state) => {
			const chapterResults = state.results[chapterId] ?? [];
			const updated = [...chapterResults];
			// 确保数组长度足够，处理索引超出当前长度的情况
			while (updated.length <= paragraphIndex) {
				const newIndex = updated.length;
				updated.push({
					paragraphIndex: newIndex, // 这里应该使用实际的段落索引，而不是数组索引
					originalText: "",
					errors: [],
					status: "pending" as const,
				});
			}
			if (updated[paragraphIndex]) {
				// 关键修复：确保 paragraphIndex 字段与实际索引一致
				updated[paragraphIndex] = {
					...updated[paragraphIndex],
					...result,
					paragraphIndex: paragraphIndex // 强制使用正确的段落索引
				};
			}
			return { results: { ...state.results, [chapterId]: updated } };
		}),

	toggleErrorApplied: (chapterId, paragraphIndex, errorId) =>
		set((state) => {
			const chapterResults = state.results[chapterId] ?? [];
			const updated = [...chapterResults];
			// 确保数组长度足够
			while (updated.length <= paragraphIndex) {
				const newIndex = updated.length;
				updated.push({
					paragraphIndex: newIndex,
					originalText: "",
					errors: [],
					status: "pending" as const,
				});
			}
			const para = updated[paragraphIndex];
			if (para) {
				updated[paragraphIndex] = {
					...para,
					paragraphIndex: paragraphIndex, // 确保索引正确
					errors: para.errors.map((e: ProofreadError) =>
						e.id === errorId ? { ...e, applied: !e.applied } : e,
					),
				};
			}
			return { results: { ...state.results, [chapterId]: updated } };
		}),

	applyAllErrors: (chapterId: number, paragraphIndex: number) =>
		set((state) => {
			const chapterResults = state.results[chapterId] ?? [];
			const updated = [...chapterResults];
			const para = updated[paragraphIndex];
			if (para) {
				updated[paragraphIndex] = {
					...para,
					paragraphIndex: paragraphIndex, // 确保索引正确
					errors: para.errors.map((e: ProofreadError) => ({
						...e,
						applied: true,
						skipped: false,
					})),
				};
			}
			return { results: { ...state.results, [chapterId]: updated } };
		}),

	toggleErrorSkipped: (chapterId, paragraphIndex, errorId) =>
		set((state) => {
			const chapterResults = state.results[chapterId] ?? [];
			const updated = [...chapterResults];
			const para = updated[paragraphIndex];
			if (para) {
				updated[paragraphIndex] = {
					...para,
					paragraphIndex: paragraphIndex, // 确保索引正确
					errors: para.errors.map((e: ProofreadError) =>
						e.id === errorId ? { ...e, skipped: !e.skipped } : e,
					),
				};
			}
			return { results: { ...state.results, [chapterId]: updated } };
		}),

	clearResults: (chapterId) =>
		set((state) => {
			const newResults = { ...state.results };
			delete newResults[chapterId];
			return { results: newResults };
		}),

	clearAllResults: () => set({ results: {} }),

	setHighlightedParagraph: (index) => set({ highlightedParagraph: index }),

	setStartLine: (line) => set({ startLine: line }),

	setApplyAnimation: (anim) => set({ applyAnimation: anim }),

	addIgnoredWord: (chapterId, word) =>
		set((state) => {
			const currentWords = state.ignoredWords[chapterId] ?? [];
			// 避免重复添加
			if (currentWords.includes(word)) {
				return state;
			}
			return {
				ignoredWords: {
					...state.ignoredWords,
					[chapterId]: [...currentWords, word],
				},
			};
		}),

	removeIgnoredWord: (chapterId, word) =>
		set((state) => {
			const currentWords = state.ignoredWords[chapterId] ?? [];
			return {
				ignoredWords: {
					...state.ignoredWords,
					[chapterId]: currentWords.filter((w) => w !== word),
				},
			};
		}),

	getIgnoredWords: (chapterId) => {
		const state = get();
		return state.ignoredWords[chapterId] ?? [];
	},

	clearIgnoredWords: (chapterId) =>
		set((state) => {
			const newIgnoredWords = { ...state.ignoredWords };
			delete newIgnoredWords[chapterId];
			return { ignoredWords: newIgnoredWords };
		}),

	addScriptTask: (task) =>
		set((state) => ({ scriptTasks: [...state.scriptTasks, task] })),

	updateScriptTask: (taskId, update) =>
		set((state) => ({
			scriptTasks: state.scriptTasks.map((t) =>
				t.id === taskId ? { ...t, ...update } : t,
			),
		})),

	clearScriptTasks: () => set({ scriptTasks: [] }),

	setScriptRunning: (running) => set({ scriptRunning: running }),
}));
