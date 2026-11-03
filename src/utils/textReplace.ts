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
		// 容忍用户录入时误带的前后空格
		const from = original.trim();
		const to = replacement.trim();
		if (from && to && from !== to) {
			result = result.split(from).join(to);
		}
	}

	return result;
}

/** 当前替换规则指纹：规则变化时使 TTS 音频缓存失效 */
export function getWordReplacementFingerprint(): string {
	return useWordReplacementStore
		.getState()
		.replacements
		.map((r) => `${r.original.trim()}\u0001${r.replacement.trim()}`)
		.join("\u0002");
}
