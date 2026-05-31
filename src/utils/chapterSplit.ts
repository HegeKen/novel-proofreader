// ============================================================
// 章节识别与分割（支持分卷小说）
// ============================================================
import type { Chapter } from "../types";
import { logger } from "./logger";

/** 卷名正则 */
const VOLUME_PATTERNS = [
	/(?:^|\n)\s*(第[一二三四五六七八九十百千万零\d]+卷(?:[ \t]+[^\n]+)?)/g,
	/(?:^|\n)\s*(卷[一二三四五六七八九十百千万零\d]+(?:[ \t]+[^\n]+)?)/g,
	/(?:^|\n)\s*(Vol\.?\s*\d+(?:[ \t]+[^\n]+)?)/gi,
	/(?:^|\n)\s*(Volume\s*\d+(?:[ \t]+[^\n]+)?)/gi,
];

/** 章节名正则 */
const CHAPTER_PATTERNS = [
	/(?:^|\n)\s*(第[一二三四五六七八九十百千万零\d]+[章回节部篇](?:[ \t]+[^\n]+)?)/g,
	/(?:^|\n)\s*(序章|序言|前言|引子|楔子|尾声|后记|番外(?:[一二三四五六七八九十\d]+)?(?:[ \t]+[^\n]+)?|结局(?:[ \t]+[^\n]+)?)/g,
	/(?:^|\n)\s*(Chapter\s+\d+(?:[ \t]+[^\n]+)?)/gi,
	/(?:^|\n)\s*(PROLOGUE|EPILOGUE|AFTERWORD(?:[ \t]+[^\n]+)?)/gi,
];

/** 按字符数强制分割的阈值 */
const DEFAULT_CHUNK_SIZE = 5000;

interface MatchItem {
	title: string;
	index: number;
	isVolume: boolean;
}

/**
 * 从全文中识别章节并分割（支持分卷小说）
 */
export function splitChapters(
	fullText: string,
	chunkSize = DEFAULT_CHUNK_SIZE,
): Chapter[] {
	const matches: MatchItem[] = [];

	// 收集所有卷名匹配
	for (const pattern of VOLUME_PATTERNS) {
		pattern.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = pattern.exec(fullText)) !== null) {
			matches.push({
				title: m[1].trim(),
				index: m.index,
				isVolume: true,
			});
		}
	}

	// 收集所有章节名匹配
	for (const pattern of CHAPTER_PATTERNS) {
		pattern.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = pattern.exec(fullText)) !== null) {
			matches.push({
				title: m[1].trim(),
				index: m.index,
				isVolume: false,
			});
		}
	}

	// 去重并按位置排序
	const unique = new Map<number, MatchItem>();
	for (const m of matches) {
		if (!unique.has(m.index)) {
			unique.set(m.index, m);
		}
	}
	const sorted = Array.from(unique.values()).sort((a, b) => a.index - b.index);

	// 如果没有匹配到任何章节，按 chunkSize 强制分割
	if (sorted.length === 0) {
		const chapters: Chapter[] = [];
		let start = 0;
		let id = 1;
		while (start < fullText.length) {
			const end = Math.min(start + chunkSize, fullText.length);
			chapters.push({
				id,
				title: `第 ${id} 段`,
				startIndex: start,
				endIndex: end,
				content: fullText.slice(start, end),
			});
			start = end;
			id++;
		}
		return chapters;
	}

	// 构建章节列表，为每个章节找到所属卷
	const chapters: Chapter[] = [];

	for (let i = 0; i < sorted.length; i++) {
		const match = sorted[i];
		const endIdx = i + 1 < sorted.length ? sorted[i + 1].index : fullText.length;

		if (match.isVolume) {
			// 这是一个卷名
			chapters.push({
				id: chapters.length,
				title: match.title,
				startIndex: match.index,
				endIndex: endIdx,
				content: fullText.slice(match.index, endIdx),
				isVolume: true,
			});
		} else {
			// 这是一个章节名，找到所属卷
			let parentId: number | undefined = undefined;

			// 向前查找最近的卷名
			for (let j = i - 1; j >= 0; j--) {
				if (sorted[j].isVolume) {
					// 找到卷名对应的章节 ID
					parentId = chapters.findIndex(ch => ch.startIndex === sorted[j].index && ch.isVolume);
					if (parentId >= 0) {
						parentId = chapters[parentId].id;
					}
					break;
				}
			}

			chapters.push({
				id: chapters.length,
				title: match.title,
				startIndex: match.index,
				endIndex: endIdx,
				content: fullText.slice(match.index, endIdx),
				isVolume: false,
				parentId: parentId,
			});
		}
	}

	// 如果第一个章节之前还有内容，作为"前言"
	if (sorted[0].index > 0) {
		const preamble = fullText.slice(0, sorted[0].index).trim();
		if (preamble.length > 0) {
			chapters.unshift({
				id: 0,
				title: "前言",
				startIndex: 0,
				endIndex: sorted[0].index,
				content: preamble,
				isVolume: false,
			});
		}
	}

	// 重新编号并修复所有 parentId
	chapters.forEach((ch, idx) => (ch.id = idx));
	for (let i = 0; i < chapters.length; i++) {
		const ch = chapters[i];
		if (!ch.isVolume) {
			// 向前查找最近的卷
			let foundParentId: number | undefined = undefined;
			for (let j = i - 1; j >= 0; j--) {
				if (chapters[j].isVolume) {
					foundParentId = chapters[j].id;
					break;
				}
			}
			ch.parentId = foundParentId;
		}
	}

	logger.debug("[splitChapters] 最终章节划分结果:", chapters.map(ch => ({
		id: ch.id,
		title: ch.title,
		isVolume: ch.isVolume,
		parentId: ch.parentId,
		startIndex: ch.startIndex,
		endIndex: ch.endIndex
	})));

	return chapters;
}

/**
 * 将章节内容按原始换行严格分行（保留空行）
 */
export function splitParagraphs(text: string): string[] {
	return text.split("\n");
}

/**
 * 将文本按最大字符数分块（用于 AI 请求）
 */
export function splitTextChunks(text: string, maxChars: number): string[] {
	if (text.length <= maxChars) return [text];

	const chunks: string[] = [];
	const paragraphs = splitParagraphs(text);
	let current = "";

	for (const para of paragraphs) {
		if (current.length + para.length + 2 > maxChars) {
			if (current.length > 0) chunks.push(current);
			if (para.length > maxChars) {
				let offset = 0;
				while (offset < para.length) {
					chunks.push(para.slice(offset, offset + maxChars));
					offset += maxChars;
				}
				current = "";
			} else {
				current = para;
			}
		} else {
			current = current.length > 0 ? current + "\n\n" + para : para;
		}
	}
	if (current.length > 0) chunks.push(current);
	return chunks;
}