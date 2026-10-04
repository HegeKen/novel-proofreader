// ============================================================
// 校对结果状态
// ============================================================
import { create } from "zustand";
import type { ParagraphResult, ProofreadError } from "../types";

/** 采纳动画阶段 */
interface ApplyAnimation {
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
	skipAllErrors: (chapterId: number) => void;
	clearResults: (chapterId: number) => void;
	clearAllResults: () => void;
	setHighlightedParagraph: (index: number | null) => void;
	setStartLine: (line: number | null) => void;
	setApplyAnimation: (anim: ApplyAnimation | null) => void;
	updateErrorIndices: (chapterId: number, paragraphIndex: number, startIndex: number, lengthDiff: number) => void;
}

/** 获取章节结果副本，自动扩展数组长度 */
function getChapterResults(results: Record<number, ParagraphResult[]>, chapterId: number, paragraphIndex: number): ParagraphResult[] {
	const arr = [...(results[chapterId] ?? [])];
	while (arr.length <= paragraphIndex) {
		arr.push({ paragraphIndex: arr.length, originalText: "", errors: [], status: "pending" as const });
	}
	return arr;
}

export const useProofreadStore = create<ProofreadState>((set) => ({
	results: {},
	highlightedParagraph: null,
	startLine: null,
	applyAnimation: null,

	setResults: (chapterId, results) =>
		set((state) => ({
			results: { ...state.results, [chapterId]: results },
		})),

	updateParagraphResult: (chapterId, paragraphIndex, result) =>
		set((state) => {
			const updated = getChapterResults(state.results, chapterId, paragraphIndex);
			updated[paragraphIndex] = {
				...updated[paragraphIndex],
				...result,
				paragraphIndex,
			};
			return { results: { ...state.results, [chapterId]: updated } };
		}),

	toggleErrorApplied: (chapterId, paragraphIndex, errorId) =>
		set((state) => {
			const updated = getChapterResults(state.results, chapterId, paragraphIndex);
			const para = updated[paragraphIndex];
			if (para) {
				updated[paragraphIndex] = {
					...para,
					paragraphIndex,
					errors: para.errors.map((e: ProofreadError) =>
						e.id === errorId ? { ...e, applied: !e.applied } : e,
					),
				};
			}
			return { results: { ...state.results, [chapterId]: updated } };
		}),

	applyAllErrors: (chapterId: number, paragraphIndex: number) =>
		set((state) => {
			const updated = getChapterResults(state.results, chapterId, paragraphIndex);
			const para = updated[paragraphIndex];
			if (para) {
				updated[paragraphIndex] = {
					...para,
					paragraphIndex,
					errors: para.errors.map((e: ProofreadError) => ({
						...e,
						applied: true,
						skipped: false,
					})),
				};
			}
			return { results: { ...state.results, [chapterId]: updated } };
		}),

	// 批量忽略章节内所有未处理错误（已采纳的不动）
	skipAllErrors: (chapterId) =>
		set((state) => {
			const chapterResults = state.results[chapterId] ?? [];
			let changed = false;
			const updated = chapterResults.map((para) => {
				if (!para.errors.some((e) => !e.applied && !e.skipped)) return para;
				changed = true;
				return {
					...para,
					errors: para.errors.map((e) =>
						!e.applied && !e.skipped ? { ...e, skipped: true } : e,
					),
				};
			});
			return changed ? { results: { ...state.results, [chapterId]: updated } } : state;
		}),

	toggleErrorSkipped: (chapterId, paragraphIndex, errorId) =>
		set((state) => {
			const updated = getChapterResults(state.results, chapterId, paragraphIndex);
			const para = updated[paragraphIndex];
			if (para) {
				updated[paragraphIndex] = {
					...para,
					paragraphIndex,
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

	/** 更新段落中剩余错误的索引（当文本被修改后） */
	updateErrorIndices: (chapterId: number, paragraphIndex: number, startIndex: number, lengthDiff: number) =>
		set((state) => {
			const chapterResults = state.results[chapterId] ?? [];
			const updated = [...chapterResults];
			const para = updated[paragraphIndex];
			if (para) {
				updated[paragraphIndex] = {
					...para,
					errors: para.errors.map((e: ProofreadError) => {
						if (e.startIndex > startIndex) {
							return {
								...e,
								startIndex: e.startIndex + lengthDiff,
								endIndex: e.endIndex + lengthDiff,
							};
						}
						return e;
					}),
				};
			}
			return { results: { ...state.results, [chapterId]: updated } };
		}),
}));
