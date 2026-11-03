import { create } from "zustand";
import { persist } from "zustand/middleware";
import { generateId } from "../utils/id";

export interface WordReplacement {
	id: string;
	original: string;   // 原始词组（敏感词）
	replacement: string; // 替换词组
}

interface WordReplacementState {
	replacements: WordReplacement[];
	addReplacement: (original: string, replacement: string) => void;
	removeReplacement: (id: string) => void;
	updateReplacement: (id: string, original: string, replacement: string) => void;
	clearAllReplacements: () => void;
}

export const useWordReplacementStore = create<WordReplacementState>()(
	persist(
		(set) => ({
			replacements: [],

			addReplacement: (original, replacement) => {
				const from = original.trim();
				const to = replacement.trim();
				if (!from || !to) return;
				const id = generateId("replacement", 6);
				set((state) => ({
					replacements: [...state.replacements, { id, original: from, replacement: to }],
				}));
			},

			removeReplacement: (id) => {
				set((state) => ({
					replacements: state.replacements.filter((r) => r.id !== id),
				}));
			},

			updateReplacement: (id, original, replacement) => {
				set((state) => ({
					replacements: state.replacements.map((r) =>
						r.id === id ? { ...r, original: original.trim(), replacement: replacement.trim() } : r
					),
				}));
			},

			clearAllReplacements: () => {
				set({ replacements: [] });
			},
		}),
		{
			name: "novel-proofreader-word-replacement",
			// 迁移旧数据：去掉历史规则中误带的前后空格
			merge: (persisted, current) => {
				const saved = (persisted ?? {}) as Partial<WordReplacementState>;
				return {
					...current,
					...saved,
					replacements: (saved.replacements ?? []).map((r) => ({
						...r,
						original: r.original.trim(),
						replacement: r.replacement.trim(),
					})),
				};
			},
		}
	)
);
