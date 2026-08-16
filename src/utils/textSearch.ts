// ============================================================
// 文本搜索工具 — 空白不敏感定位，供校对定位/文本替换共用
// ============================================================

/** 去除所有空白字符（用于空白不敏感比较） */
export function normalizeWhitespace(s: string): string {
	return s.replace(/\s+/g, '');
}

/** 空白不敏感定位：在 para 中查找与 needle（忽略空白后）匹配的子串 */
export function findWhitespaceInsensitive(para: string, needle: string): { start: number; end: number } | null {
	const normalizedPara = normalizeWhitespace(para);
	const normalizedNeedle = normalizeWhitespace(needle);
	const matchStart = normalizedPara.indexOf(normalizedNeedle);
	if (matchStart < 0) return null;

	let charCount = 0;
	let realStart = -1;
	for (let j = 0; j < para.length && charCount <= matchStart; j++) {
		if (!/\s/.test(para[j])) {
			if (charCount === matchStart) realStart = j;
			charCount++;
		}
	}
	if (realStart < 0) return null;

	let realEnd = realStart;
	let remaining = normalizedNeedle.length;
	while (realEnd < para.length && remaining > 0) {
		if (!/\s/.test(para[realEnd])) remaining--;
		realEnd++;
	}
	return { start: realStart, end: realEnd };
}
