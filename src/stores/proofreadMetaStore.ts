import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ProofreadQueueItem, ProofreadProgress, DictionaryWord } from "../types";

interface ProofreadMetaState {
	// 词典：novelId → 词条列表（忽略词 + 替换词）
	dictionary: Record<string, DictionaryWord[]>;
	proofreadQueue: ProofreadQueueItem[];
	currentProofreadingTaskId: string | null;
	proofreadProgress: Record<string, Record<number, ProofreadProgress>>;

	// 词典操作
	addDictionaryWord: (novelId: string, entry: DictionaryWord) => void;
	removeDictionaryWord: (novelId: string, word: string) => void;
	getDictionary: (novelId: string) => DictionaryWord[];
	setDictionary: (novelId: string, words: DictionaryWord[]) => void;
	clearDictionary: (novelId: string) => void;

	// 兼容旧接口：以字符串列表读写（忽略词）
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
			dictionary: {},
			proofreadQueue: [],
			currentProofreadingTaskId: null,
			proofreadProgress: {},

			addDictionaryWord: (novelId, entry) =>
				set((state) => {
					const current = state.dictionary[novelId] ?? [];
					const idx = current.findIndex((w) => w.word === entry.word);
					const next =
						idx >= 0
							? current.map((w, i) => (i === idx ? entry : w))
							: [...current, entry];
					return { dictionary: { ...state.dictionary, [novelId]: next } };
				}),

			removeDictionaryWord: (novelId, word) =>
				set((state) => ({
					dictionary: {
						...state.dictionary,
						[novelId]: (state.dictionary[novelId] ?? []).filter((w) => w.word !== word),
					},
				})),

			getDictionary: (novelId) => get().dictionary[novelId] ?? [],

			setDictionary: (novelId, words) =>
				set((state) => ({
					dictionary: { ...state.dictionary, [novelId]: words },
				})),

			clearDictionary: (novelId) =>
				set((state) => {
					const newDictionary = { ...state.dictionary };
					delete newDictionary[novelId];
					return { dictionary: newDictionary };
				}),

			// 兼容旧接口：字符串列表（忽略词）
			addIgnoredWord: (novelId, word) =>
				get().addDictionaryWord(novelId, { word, type: "ignore" }),

			removeIgnoredWord: (novelId, word) =>
				get().removeDictionaryWord(novelId, word),

			// 返回全部词条文本（忽略词与替换词均不参与 AI 校对标注）
			getIgnoredWords: (novelId) =>
				(get().dictionary[novelId] ?? []).map((w) => w.word),

			setIgnoredWords: (novelId, words) =>
				set((state) => ({
					dictionary: {
						...state.dictionary,
						[novelId]: words.map((w) => ({ word: w, type: "ignore" as const })),
					},
				})),

			clearIgnoredWords: (novelId) => get().clearDictionary(novelId),

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
			version: 1,
			// 旧版本持久化的是 ignoredWords: Record<string, string[]>，迁移为 dictionary
			migrate: (persisted) => {
				const p = (persisted ?? {}) as Record<string, unknown>;
				const progress =
					(p.proofreadProgress as ProofreadMetaState["proofreadProgress"]) ?? {};
				if (p.dictionary) {
					return {
						dictionary: p.dictionary as ProofreadMetaState["dictionary"],
						proofreadProgress: progress,
					};
				}
				const ignored = (p.ignoredWords as Record<string, string[]> | undefined) ?? {};
				const dictionary: Record<string, DictionaryWord[]> = {};
				for (const [id, words] of Object.entries(ignored)) {
					dictionary[id] = words.map((w) => ({ word: w, type: "ignore" as const }));
				}
				return { dictionary, proofreadProgress: progress };
			},
			partialize: (state) => ({
				dictionary: state.dictionary,
				proofreadProgress: state.proofreadProgress,
			}),
		},
	),
);
