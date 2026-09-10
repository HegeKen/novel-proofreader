// ============================================================
// 繁体字 → 简体字转换与扫描
// 基于 chinese-conv 库（纯本地、零依赖，sify 将繁体转为简体）
// ============================================================
import { sify } from "chinese-conv";

/** 扫描结果中的一条繁体字记录 */
export interface TraditionalEntry {
	/** 繁体字符 */
	variant: string;
	/** 对应的简体字符 */
	standard: string;
	/** 在文本中出现的次数 */
	count: number;
	/** Unicode 码点 */
	codePoint: string;
}

/**
 * 将文本中的繁体字转换为简体字
 * @param text 原始文本
 * @returns 转换后的简体文本
 */
export function convertTraditionalToSimplified(text: string): string {
	if (!text) return text;
	return sify(text);
}

/**
 * 扫描文本中的所有繁体字，返回统计信息（按出现次数降序）
 * 通过 sify 全文转换后逐字符对比，找出发生变化的字符
 * @param text 原始文本
 * @returns 繁体字统计列表
 */
export function scanTraditionalChars(text: string): TraditionalEntry[] {
	if (!text) return [];

	const simplified = sify(text);
	const countMap = new Map<string, { count: number; standard: string }>();

	// 繁→简转换通常为 1:1；若长度不一致（极端情况）则回退为逐字符判断，避免错位
	if (simplified.length !== text.length) {
		for (const original of text) {
			const converted = sify(original);
			if (original === converted) continue;
			const existing = countMap.get(original);
			if (existing) {
				existing.count++;
			} else {
				countMap.set(original, { count: 1, standard: converted });
			}
		}
	} else {
		for (let i = 0; i < text.length; i++) {
			const original = text[i];
			if (original === simplified[i]) continue;
			const existing = countMap.get(original);
			if (existing) {
				existing.count++;
			} else {
				countMap.set(original, { count: 1, standard: simplified[i] });
			}
		}
	}

	// 转成数组排序（出现次数降序）
	return Array.from(countMap.entries())
		.map(([variant, data]) => ({
			variant,
			standard: data.standard,
			count: data.count,
			codePoint: `U+${variant.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`,
		}))
		.sort((a, b) => b.count - a.count);
}
