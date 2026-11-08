// ============================================================
// 小说语言检测与英文文本规范化
//
// 英文电子书（尤其 OCR 版 txt）常见三类问题：
//   1. 行首用 ¡¡¡¡ 等符号表示段落缩进（cp1252 的 0xA1）
//   2. 按版面宽度硬换行，一个段落被拆成多行（软换行）
//   3. 章节标题形态多样（CHAPTER ONE / Chapter 1: Title / - CHAPTER ONE -）
// 本模块负责 1、2 的清洗与重排；3 由 chapterSplit 的正则处理。
// ============================================================

export type NovelLanguage = "zh" | "en";

/** CJK 字符（含扩展 A 区与兼容区） */
const CJK_CHAR_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g;
/** 拉丁字母 */
const LATIN_CHAR_RE = /[A-Za-z]/g;
/** 行首缩进标记：电子书常用连续的 ¡（U+00A1）表示首行缩进 */
const INDENT_MARKER_RE = /^[ \t\u3000]*[\u00A1]+[ \t\u3000]*/gm;
/** 章节标题行（用于软换行重排时保护标题，不并入正文段落） */
const CHAPTER_LINE_RE = /^(?:[-\u2013\u2014]\s*)?(?:chapter|ch\.|prologue|epilogue|afterword)\b/i;

/**
 * 按正文字符构成自动判定小说语言。
 *
 * 中文小说中拉丁字母（人名缩写、英文术语）占比通常低于 5%，
 * 因此只要 CJK 字符数达到拉丁字母的 20% 即可判为中文；
 * 英文小说 CJK 字符极少（偶尔出现的中文引文不足以改变判定）。
 */
export function detectNovelLanguage(text: string): NovelLanguage {
	const sample = text.slice(0, 60000);
	const cjk = (sample.match(CJK_CHAR_RE) ?? []).length;
	const latin = (sample.match(LATIN_CHAR_RE) ?? []).length;
	if (cjk === 0) return "en";
	return cjk >= latin * 0.2 ? "zh" : "en";
}

/** 去除行首缩进标记（¡¡¡¡）与其后的空白，正文中的 ¡ 不受影响 */
export function stripIndentMarkers(text: string): string {
	return text.replace(INDENT_MARKER_RE, "");
}

/**
 * 判断文本是否为软换行排版（按行宽硬折行，而非一行一段）。
 *
 * 判据必须同时满足空行比例与行宽中位数，避免把"一行一段 + 空行分隔"的
 * 中文排版误判：中文一行的字数通常远大于 100。
 */
export function needsSoftWrapReflow(text: string): boolean {
	const lines = text.split("\n");
	if (lines.length < 40) return false;
	const nonEmpty = lines.filter((line) => line.trim() !== "");
	const blankRatio = (lines.length - nonEmpty.length) / lines.length;
	if (blankRatio < 0.08) return false;
	const lengths = nonEmpty.map((line) => line.trim().length).sort((a, b) => a - b);
	const median = lengths[Math.floor(lengths.length / 2)] ?? 0;
	return median < 100;
}

/**
 * 把软换行文本重排为"一行一段"。
 *
 * 规则：
 * - 空行作为段落分隔
 * - 连续非空行合并为一段（行尾连字符视为断词，直接拼接）
 * - 章节标题行独立成段，其后的短标题行（如 "The Dark Lord Ascending"）也独立
 * - 合并后压缩连续空行，最多保留一个
 */
export function reflowSoftWrappedText(text: string): string {
	const lines = text.split("\n");
	const out: string[] = [];
	let buffer = "";
	let expectChapterTitle = false;

	const flush = () => {
		if (buffer) {
			out.push(buffer);
			buffer = "";
		}
	};

	const pushBlank = () => {
		if (out.length > 0 && out[out.length - 1] !== "") out.push("");
	};

	for (const raw of lines) {
		const line = raw.trim();
		if (!line) {
			flush();
			expectChapterTitle = false;
			pushBlank();
			continue;
		}
		if (CHAPTER_LINE_RE.test(line)) {
			flush();
			out.push(line);
			expectChapterTitle = true;
			continue;
		}
		if (expectChapterTitle) {
			expectChapterTitle = false;
			// 章节行后紧跟的短标题（不以句末标点结尾）单独成行，不与正文合并
			if (line.length <= 70 && !/[.!?,;]$/.test(line)) {
				out.push(line);
				continue;
			}
		}
		if (!buffer) buffer = line;
		else if (buffer.endsWith("-")) buffer = buffer.slice(0, -1) + line;
		else buffer += ` ${line}`;
	}
	flush();

	return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * 导入文本的统一预处理入口：统一换行符 → 检测语言 → 英文清洗与重排。
 *
 * 只在英文文本上执行缩进清理与软换行重排，中文文本保持原样（仅统一换行符），
 * 避免改变既有中文小说的段落结构。
 */
export function prepareNovelText(
	raw: string,
	options: { reflow?: boolean } = {},
): { text: string; language: NovelLanguage } {
	const normalized = raw.replace(/\r\n?/g, "\n");
	const language = detectNovelLanguage(normalized);
	if (language !== "en") {
		return { text: normalized, language };
	}

	let text = stripIndentMarkers(normalized);
	// EPUB 等已按段落结构化的来源不做软换行重排，避免把正常段落合并
	if (options.reflow !== false && needsSoftWrapReflow(text)) {
		text = reflowSoftWrappedText(text);
	}
	return { text, language };
}
