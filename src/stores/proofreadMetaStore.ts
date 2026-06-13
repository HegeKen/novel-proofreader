import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ProofreadQueueItem, ProofreadProgress } from "../types";

export interface ProofreadMetaState {
	ignoredWords: Record<string, string[]>;
	proofreadQueue: ProofreadQueueItem[];
	currentProofreadingTaskId: string | null;
	proofreadProgress: Record<string, Record<number, ProofreadProgress>>;

	addIgnoredWord: (novelId: string, word: string) => void;
	removeIgnoredWord: (novelId: string, word: string) => void;
	getIgnoredWords: (novelId: string) => string[];
	setIgnoredWords: (novelId: string, words: string[]) => void;
	clearIgnoredWords: (novelId: string) => void;

	addToProofreadQueue: (items: Omit<ProofreadQueueItem, "id" | "status" | "startTime" | "endTime">[]) => void;
	removeFromProofreadQueue: (itemId: string) => void;
	updateQueueItemStatus: (itemId: string, status: ProofreadQueueItem["status"], errorMessage?: string) => void;
	clearProofreadQueue: () => void;
	setCurrentProofreadingTaskId: (taskId: string | null) => void;

	saveProofreadProgress: (novelId: string, chapterId: number, lastParagraphIndex: number, completed: boolean) => void;
	getProofreadProgress: (novelId: string, chapterId: number) => ProofreadProgress | undefined;
	setProofreadProgress: (novelId: string, progress: Record<number, ProofreadProgress>) => void;
	clearProofreadProgress: (novelId: string, chapterId?: number) => void;
}

export const useProofreadMetaStore = create<ProofreadMetaState>()(
	persist(
		(set, get) => ({
			ignoredWords: {},
			proofreadQueue: [],
			currentProofreadingTaskId: null,
			proofreadProgress: {},

			addIgnoredWord: (novelId, word) =>
				set((state) => {
					const currentWords = state.ignoredWords[novelId] ?? [];
					if (currentWords.includes(word)) return state;
					return {
						ignoredWords: { ...state.ignoredWords, [novelId]: [...currentWords, word] },
					};
				}),

			removeIgnoredWord: (novelId, word) =>
				set((state) => ({
					ignoredWords: {
						...state.ignoredWords,
						[novelId]: (state.ignoredWords[novelId] ?? []).filter((w) => w !== word),
					},
				})),

			getIgnoredWords: (novelId) => get().ignoredWords[novelId] ?? [],

			setIgnoredWords: (novelId, words) =>
				set((state) => ({
					ignoredWords: { ...state.ignoredWords, [novelId]: words },
				})),

			clearIgnoredWords: (novelId) =>
				set((state) => {
					const newIgnoredWords = { ...state.ignoredWords };
					delete newIgnoredWords[novelId];
					return { ignoredWords: newIgnoredWords };
				}),

			addToProofreadQueue: (items) =>
				set((state) => {
					const newItems: ProofreadQueueItem[] = items.map((item) => ({
						...item,
						id: `${item.novelId}-${item.chapterId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
						status: "pending",
					}));
					return { proofreadQueue: [...state.proofreadQueue, ...newItems] };
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

			getProofreadProgress: (novelId, chapterId) => get().proofreadProgress[novelId]?.[chapterId],

			setProofreadProgress: (novelId, progress) =>
				set((state) => ({
					proofreadProgress: { ...state.proofreadProgress, [novelId]: progress },
				})),

			clearProofreadProgress: (novelId, chapterId) =>
				set((state) => {
					const newProgress = { ...state.proofreadProgress };
					if (chapterId !== undefined) {
						if (newProgress[novelId]) delete newProgress[novelId][chapterId];
					} else {
						delete newProgress[novelId];
					}
					return { proofreadProgress: newProgress };
				}),
		}),
		{
			name: "novel-proofreader-proofread-meta",
			partialize: (state) => ({
				ignoredWords: state.ignoredWords,
				proofreadProgress: state.proofreadProgress,
			}),
		},
	),
);
