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
				const id = generateId("replacement", 6);
				set((state) => ({
					replacements: [...state.replacements, { id, original, replacement }],
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
						r.id === id ? { ...r, original, replacement } : r
					),
				}));
			},

			clearAllReplacements: () => {
				set({ replacements: [] });
			},
		}),
		{
			name: "novel-proofreader-word-replacement",
		}
	)
);

/**
 * 对文本进行词组替换
 * @param text 要处理的文本
 * @returns 替换后的文本
 */
export function applyWordReplacements(text: string): string {
	const replacements = useWordReplacementStore.getState().replacements;
	let result = text;

	for (const { original, replacement } of replacements) {
		if (original && replacement && original !== replacement) {
			result = result.split(original).join(replacement);
		}
	}

	return result;
}
