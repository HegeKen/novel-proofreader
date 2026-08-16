// ============================================================
// 章节识别与分割（支持分卷小说）
// ============================================================
import type { Chapter } from "../types";
import { logger } from "./logger";
import { normalizeCJKVariants } from "./normalizeCJK";

/** 空白字符类（包含半角空格、制表符、全角空格、不间断空格等 CJK 常用空白） */
const WS = '[ \\t\\u3000\\u00A0]';
const WS_PLUS = `${WS}+`;
const WS_OPT = `${WS}*`;

/** 卷名正则 */
const VOLUME_PATTERNS = [
	new RegExp(`(?:^|\\n)\\s*(第[一二三四五六七八九十百千万零\\d]+卷(?:${WS_PLUS}[^\\n]+)?)`, 'g'),
	new RegExp(`(?:^|\\n)\\s*(卷[一二三四五六七八九十百千万零\\d]+(?:${WS_PLUS}[^\\n]+)?)`, 'g'),
	new RegExp(`(?:^|\\n)\\s*(Vol\\.?\\s*\\d+(?:${WS_PLUS}[^\\n]+)?)`, 'gi'),
	new RegExp(`(?:^|\\n)\\s*(Volume\\s*\\d+(?:${WS_PLUS}[^\\n]+)?)`, 'gi'),
];

/** 章节名正则 */
// 支持的数字字符：普通数字、汉字数字、全角数字、康熙部首数字变体、古文数字
// 使用 Unicode 转义序列确保编码正确：
// \u2F00=一 \u2F02=二 \u2F03=三 \u2F04=亖(四) \u2F05=五 \u2F06=六 \u2F07=七 \u2F08=八 \u2F09=九 \u2F0A=十 \u2F0B=亻(被用作八) \u2F17=二十
// \u5EFF=廿(二十) \u5341=卅(三十) \u534C=卌(四十)
const KANGXI_DIGITS = '\\u2F00\\u2F02\\u2F03\\u2F04\\u2F05\\u2F06\\u2F07\\u2F08\\u2F09\\u2F0A\\u2F0B\\u2F17';
const ARCHAIC_DIGITS = '廿卅卌';
/** 章节号可用数字字符（普通数字、汉字数字、全角数字、康熙部首数字变体、古文数字） */
const CHAPTER_DIGITS = `\\d一二三四五六七八九十百千万零０１２３４５６７８９${KANGXI_DIGITS}${ARCHAIC_DIGITS}`;
/** "首位汉字数字"模式用：第一位允许汉字数字（不含"一"，避免"一章"等误判），其后任意 */
const CHAPTER_DIGITS_LEAD = `\\d二三四五六七八九十百千万零０１２３４５６７８９\\u2F02\\u2F03\\u2F04\\u2F05\\u2F06\\u2F07\\u2F08\\u2F09\\u2F0A\\u2F0B\\u2F17${ARCHAIC_DIGITS}`;
/** 章节后缀字（含"话"，兼容"第X话"；不带"第"的裸数字模式不含"话"，避免"二话不说"等误判） */
const CHAPTER_SUFFIX = '章回节部篇话話';

// 严格模式：匹配结果直接视为章节标记（"第一章""第1章：标题""【第1章】""Chapter One"等）
const CHAPTER_PATTERNS = [
	// 第X章/回/节/部/篇/话；兼容"第一章：标题""第一章·标题""第一章、标题"等无空格分隔形式，
	// 以及"【第一章】标题"等括号包裹形式
	`(?:^|\\n)\\s*(?:[【\\[]\\s*)?(第[${CHAPTER_DIGITS}]+[${CHAPTER_SUFFIX}](?:${WS_PLUS}[^】\\]\\n]+|[：:、.．·\\-][^】\\]\\n]{0,60})?)(?:\\s*[】\\]])?`,
	// 支持"第 1 章""第 一 章"（章节号与后缀之间有空白）
	`(?:^|\\n)\\s*(?:[【\\[]\\s*)?(第\\s*[${CHAPTER_DIGITS}]+\\s*[${CHAPTER_SUFFIX}](?:${WS_PLUS}[^】\\]\\n]+|[：:、.．·\\-][^】\\]\\n]{0,60})?)(?:\\s*[】\\]])?`,
	// 支持不带"第"字的章节号，如"四十一章"、"四十五章"
	// 注意：对于"回"这个词，要求至少两个数字字符以避免匹配"一回"等日常用语
	`(?:^|\\n)\\s*([${CHAPTER_DIGITS}]{2,}[${CHAPTER_SUFFIX}](?:${WS_PLUS}[^\\n]+)?)`,
	// 首位为汉字数字的章节号，如"二十章"（第二位可为任意数字；不含"话"，避免"二话不说"等误判）
	`(?:^|\\n)\\s*([${CHAPTER_DIGITS_LEAD}][${CHAPTER_DIGITS}]*[章节部篇](?:${WS_PLUS}[^\\n]+)?)`,
	// 支持章节号与"章"之间有空格的情况，如"第四十五 章与虎谋皮"
	`(?:^|\\n)\\s*(第[${CHAPTER_DIGITS}]+)${WS_PLUS}([${CHAPTER_SUFFIX}]${WS_OPT}[^\\n]+)?`,
	`(?:^|\\n)\\s*([${CHAPTER_DIGITS}]{2,})${WS_PLUS}([${CHAPTER_SUFFIX}]${WS_OPT}[^\\n]+)?`,
	// 序章/楔子/番外等
	`(?:^|\\n)\\s*(序章|序言|前言|引子|楔子|尾声|后记|番外(?:[\\d一二三四五六七八九十０１２３４５６７８９${KANGXI_DIGITS}${ARCHAIC_DIGITS}]+)?(?:${WS_PLUS}[^\\n]+)?|结局(?:${WS_PLUS}[^\\n]+)?)`,
	// English：Chapter 1 / Ch.1 / Chapter One / Chapter I（含序章类）
	new RegExp(`(?:^|\\n)\\s*((?:Chapter|Ch\\.?)\\s*(?:\\d+|[IVXLCDM]{1,7}|One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|Eleven|Twelve|Thirteen|Fourteen|Fifteen|Sixteen|Seventeen|Eighteen|Nineteen|Twenty|Thirty|Forty|Fifty|Sixty|Seventy|Eighty|Ninety|Hundred|First|Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth|Ninth|Tenth)(?:${WS_PLUS}[^\\n]+)?)`, 'gi'),
	new RegExp(`(?:^|\\n)\\s*(PROLOGUE|EPILOGUE|AFTERWORD(?:${WS_PLUS}[^\\n]+)?)`, 'gi'),
].map(p => new RegExp(p, 'g'));

/**
 * 宽松模式章节标记：仅当全文没有任何严格章节标记时启用，
 * 且同款标记出现 ≥2 处才视为"明确的断章约定"（防止把正文中的列举行误判为章节）。
 * 覆盖："1. 标题""1、标题""1：标题""一、标题""（一）标题""（1）标题""【1】标题"等常见网文断章格式。
 */
const LENIENT_CHAPTER_PATTERNS = [
	`(?:^|\\n)\\s*(\\d{1,3}(?!\\d)[、.．]\\s*[^\\n]{1,50})`,
	`(?:^|\\n)\\s*(\\d{1,3}(?!\\d)[：:]\\s*[^\\n]{1,50})`,
	`(?:^|\\n)\\s*([一二三四五六七八九十百千万]+[、.．]\\s*[^\\n]{1,50})`,
	`(?:^|\\n)\\s*([（(【][一二三四五六七八九十百千万]+[）)】]\\s*[^\\n]{0,50})`,
	`(?:^|\\n)\\s*([（(【]\\d{1,3}(?!\\d)[）)】]\\s*[^\\n]{0,50})`,
].map(p => new RegExp(p, 'g'));

/** 按字符数强制分割的阈值 */
const DEFAULT_CHUNK_SIZE = 5000;

/**
 * CJK 感知的 trim：去除首尾空白（含全角空格 U+3000、不间断空格 U+00A0 等）
 */
function trimCJK(str: string): string {
	// \s 已涵盖半角空格、制表、换行等；额外补上 U+3000（全角空格）和 U+00A0（不间断空格）
	return str.replace(/^[\s\u3000\u00A0]+|[\s\u3000\u00A0]+$/g, "");
}

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
	// 标准化 CJK 变体字/部首字（如 ⾯→面, ⽜→牛, ⻘→青）
	fullText = normalizeCJKVariants(fullText);
	const matches: MatchItem[] = [];

	// 收集所有卷名匹配
	for (const pattern of VOLUME_PATTERNS) {
		pattern.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = pattern.exec(fullText)) !== null) {
			matches.push({
				title: trimCJK(m[1]),
				index: m.index,
				isVolume: true,
			});
		}
	}

	// 收集所有章节名匹配（严格模式）
	for (const pattern of CHAPTER_PATTERNS) {
		pattern.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = pattern.exec(fullText)) !== null) {
			// 处理多捕获组的情况（如"第四十五 章"会匹配两个组）
			let title = trimCJK(m[1]);
			if (m[2]) {
				title += trimCJK(m[2]);
			}
			matches.push({
				title: title,
				index: m.index,
				isVolume: false,
			});
		}
	}

	// 全文没有任何严格章节标记时，才尝试宽松模式（"一、标题""1. 标题""（一）标题"等）：
	// 同款标记需出现 ≥2 处，视为"明确的断章约定"——既尊重原有断章、避免按字数截断，
	// 也防止把正文中的列举行误判为章节
	if (!matches.some((m) => !m.isVolume)) {
		for (const pattern of LENIENT_CHAPTER_PATTERNS) {
			pattern.lastIndex = 0;
			const typeMatches: MatchItem[] = [];
			let m: RegExpExecArray | null;
			while ((m = pattern.exec(fullText)) !== null) {
				let title = trimCJK(m[1]);
				if (m[2]) {
					title += trimCJK(m[2]);
				}
				typeMatches.push({
					title: title,
					index: m.index,
					isVolume: false,
				});
			}
			if (typeMatches.length >= 2) {
				matches.push(...typeMatches);
			}
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

	// 如果没有匹配到任何章节，按 chunkSize 强制分割（仅限全文确无任何断章标记的情况）
	if (sorted.length === 0) {
		const chapters: Chapter[] = [];
		let start = 0;
		let id = 0;
		while (start < fullText.length) {
			let end = Math.min(start + chunkSize, fullText.length);

			// 尝试在段落边界处断章，避免在段落中间截断
			if (end < fullText.length) {
				const breakPos = fullText.lastIndexOf('\n', end);
				// 确保断点不会太靠前（至少保留 chunkSize 的一半）
				if (breakPos > start + Math.floor(chunkSize / 2)) {
					end = breakPos + 1; // +1 包含换行符
				}
			}

			chapters.push({
				id,
				title: `第 ${id + 1} 段`,
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
 * 获取章节中的非空段落（去除空白行）
 */
export function getNonEmptyParagraphs(text: string): string[] {
	return splitParagraphs(text).filter((p) => p.trim() !== "");
}

/**
 * 判断章节标题是否为默认生成的"第N章/回"（无自定义标题）
 */
export function isDefaultChapterTitle(title: string): boolean {
	return !title || /^第[\d一二三四五六七八九十]+[章回]$/.test(title);
}

/**
 * 获取章节显示标题（无标题时回退为"第N章"）
 */
export function getChapterDisplayTitle(chapter: { title?: string } | undefined, index: number): string {
	return chapter?.title || `第 ${index + 1} 章`;
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