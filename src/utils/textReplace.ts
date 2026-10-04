// ============================================================
// 文本替换工具 — 基于词组替换表的纯文本处理
// ============================================================
import { useWordReplacementStore } from "../stores/wordReplacementStore";

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
