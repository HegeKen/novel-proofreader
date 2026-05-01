// ============================================================
// 校对结果状态
// ============================================================
import { create } from "zustand";
import type { ParagraphResult, ProofreadError } from "../types";

export interface ApplyAnimation {
	chapterId: number;
	paragraphIndex: number;
	phase: "highlight-old" | "replacing" | "highlight-new" | "undo-highlight" | "undo-replace" | "undo-restore";
	errorId?: string;
	originalText?: string;
	correctedText?: string;
	startIndex?: number;
	endIndex?: number;
	isUndo?: boolean;
}

interface ProofreadState {
	results: Record<number, ParagraphResult[]>;
	highlightedParagraph: number | null;
	startLine: number | null;
	applyAnimation: ApplyAnimation | null;
	setResults: (chapterId: number, results: ParagraphResult[]) => void;
	updateParagraphResult: (chapterId: number, paragraphIndex: number, result: Partial<ParagraphResult>) => void;
	toggleErrorApplied: (chapterId: number, paragraphIndex: number, errorId: string) => void;
	clearResults: (chapterId: number) => void;
	clearAllResults: () => void;
	setHighlightedParagraph: (index: number | null) => void;
	setStartLine: (line: number | null) => void;
	setApplyAnimation: (anim: ApplyAnimation | null) => void;
}

export const useProofreadStore = create<ProofreadState>((set) => ({
	results: {},
	highlightedParagraph: null,
	startLine: null,
	applyAnimation: null,

	setResults: (chapterId, results) =>
		set((state) => ({ results: { ...state.results, [chapterId]: results } })),

	updateParagraphResult: (chapterId, paragraphIndex, result) =>
		set((state) => {
			const chapterResults = state.results[chapterId] ?? [];
			const updated = [...chapterResults];
			if (updated[paragraphIndex]) {
				updated[paragraphIndex] = { ...updated[paragraphIndex], ...result };
			}
			return { results: { ...state.results, [chapterId]: updated } };
		}),

	toggleErrorApplied: (chapterId, paragraphIndex, errorId) =>
		set((state) => {
			const chapterResults = state.results[chapterId] ?? [];
			const updated = [...chapterResults];
			const para = updated[paragraphIndex];
			if (para) {
				updated[paragraphIndex] = {
					...para,
					errors: para.errors.map((e: ProofreadError) =>
						e.id === errorId ? { ...e, applied: !e.applied } : e,
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
}));