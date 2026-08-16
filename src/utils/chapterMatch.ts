import type { Chapter } from "../types";

/**
 * 章节匹配工具：负责事件章节字符串与小说章节结构之间的匹配。
 * 抽为纯函数以便在组件内外复用，并对卷标题不一致（如事件"第2卷" vs 卷标题"第2卷 正文2"）做宽容匹配。
 */

/** 中文数字映射表 */
const chineseNumMap: Record<string, number> = {
	'零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4,
	'五': 5, '六': 6, '七': 7, '八': 8, '九': 9,
};

const unitMap: Record<string, number> = {
	'十': 10, '百': 100, '千': 1000, '万': 10000, '亿': 100000000,
};

/** 中文数字转阿拉伯数字字符串；含非法字符时返回原串 */
export function chineseToArabic(str: string): string {
	if (!str) return str;

	let total = 0;
	let section = 0;
	let current = 0;
	let hasDigit = false;

	for (let i = 0; i < str.length; i++) {
		const char = str[i];

		if (chineseNumMap[char] !== undefined) {
			current = chineseNumMap[char];
			hasDigit = true;
		} else if (unitMap[char] !== undefined) {
			const unitVal = unitMap[char];
			if (unitVal >= 10000) {
				if (current === 0 && !hasDigit) current = 1;
				section = (section + current) * unitVal;
				total += section;
				section = 0;
				current = 0;
				hasDigit = false;
			} else {
				if (current === 0 && !hasDigit && char === '十') current = 1;
				section += current * unitVal;
				current = 0;
			}
		} else {
			return str;
		}
	}

	total += section + current;
	return total.toString();
}

/** 章节标题归一化：将"第X章/节/回/卷"中的中文数字统一为阿拉伯数字 */
export function normalizeChapterTitle(title: string): string {
	if (!title) return title;

	let normalized = title;

	if (/第[零一二三四五六七八九十百千万\d]+[章节回卷]/.test(title)) {
		normalized = title.replace(/第([零一二三四五六七八九十百千万\d]+)([章节回卷])/g, (_, num, suffix) => {
			const arabicNum = chineseToArabic(num);
			const unifiedNum = parseInt(arabicNum, 10).toString();
			return `第${unifiedNum}${suffix}`;
		});
	}

	return normalized;
}

export interface ParsedChapterInfo {
	volumeNum: number;
	chapterNum: number;
	volumeName: string;
	chapterName: string;
}

/** 解析"第X卷·第Y章"等章节字符串，提取卷号/章号/名称片段 */
export function parseChapterInfo(chapterStr: string): ParsedChapterInfo {
	if (!chapterStr) return { volumeNum: 0, chapterNum: 0, volumeName: "", chapterName: "" };

	let volumeNum = 0;
	let chapterNum = 0;
	let volumeName = "";
	let chapterName = "";

	const numPattern = '[零一二三四五六七八九十百千万\\d]+';

	const dotIndex = chapterStr.indexOf("·");
	if (dotIndex > 0) {
		const part1 = chapterStr.slice(0, dotIndex).trim();
		const part2 = chapterStr.slice(dotIndex + 1).trim();

		const volumeMatch = part1.match(new RegExp(`第(${numPattern})卷`));
		if (volumeMatch) {
			volumeNum = parseInt(chineseToArabic(volumeMatch[1]), 10) || 0;
			volumeName = part1;
		} else {
			const chapterMatch = part1.match(new RegExp(`第(${numPattern})[章节回]`));
			if (chapterMatch) {
				chapterNum = parseInt(chineseToArabic(chapterMatch[1]), 10) || 0;
				chapterName = part1;
			}
		}

		const chapterMatch2 = part2.match(new RegExp(`第(${numPattern})[章节回]`));
		if (chapterMatch2) {
			chapterNum = parseInt(chineseToArabic(chapterMatch2[1]), 10) || 0;
			chapterName = part2;
		} else if (!chapterName) {
			chapterName = part2;
		}

		if (!volumeName) {
			volumeName = part1;
		}
	} else {
		const volumeMatch = chapterStr.match(new RegExp(`第(${numPattern})卷`));
		const chapterMatch = chapterStr.match(new RegExp(`第(${numPattern})[章节回]`));

		if (volumeMatch) {
			volumeNum = parseInt(chineseToArabic(volumeMatch[1]), 10) || 0;
			volumeName = chapterStr;
		}
		if (chapterMatch) {
			chapterNum = parseInt(chineseToArabic(chapterMatch[1]), 10) || 0;
			chapterName = chapterStr;
		}
	}

	return { volumeNum, chapterNum, volumeName, chapterName };
}

/**
 * 在章节列表中查找与事件章节字符串匹配的章节。
 * - chapterStr：事件章节字符串（可为纯章节名或含卷前缀，如"第1章"、"第2卷·第1章"）
 * - volumeStr：事件所属卷标题（可为空；卷标题与结构中的卷标题不一致时做宽容匹配）
 */
export function findMatchedChapter(chapters: Chapter[], chapterStr: string, volumeStr?: string): Chapter | undefined {
	if (!chapterStr) return undefined;

	const chapterInfo = parseChapterInfo(chapterStr);
	const normalizedSearch = normalizeChapterTitle(chapterStr);

	const nonVolumeChapters = chapters.filter(ch => !ch.isVolume);

	// 若提供了所属卷，先确定卷下章节范围，提升匹配精度
	// 卷名做宽容匹配：精确 / 包含 / 卷号一致（事件中可能是"第2卷"，卷标题可能是"第2卷 正文2"）
	let scopedChapters = nonVolumeChapters;
	const volumeKey = volumeStr || (chapterInfo.volumeNum > 0 ? `第${chapterInfo.volumeNum}卷` : "");
	if (volumeKey) {
		const volume = chapters.find(v => v.isVolume && (
			v.title === volumeKey ||
			v.title.includes(volumeKey) ||
			volumeKey.includes(v.title) ||
			(chapterInfo.volumeNum > 0 && parseChapterInfo(v.title).volumeNum === chapterInfo.volumeNum)
		));
		if (volume) {
			scopedChapters = nonVolumeChapters.filter(ch => ch.parentId === volume.id);
		}
	}

	let matchedChapter = scopedChapters.find(ch => {
		const normalizedChapter = normalizeChapterTitle(ch.title);

		if (ch.title === chapterStr) return true;
		if (normalizedChapter === normalizedSearch) return true;

		const chInfo = parseChapterInfo(ch.title);

		if (chapterInfo.volumeNum > 0 && chapterInfo.chapterNum > 0) {
			if (chInfo.volumeNum > 0 && chInfo.chapterNum > 0) {
				if (chapterInfo.volumeNum === chInfo.volumeNum && chapterInfo.chapterNum === chInfo.chapterNum) {
					return true;
				}
			}
		}

		if (chapterStr.length >= 3 && ch.title.includes(chapterStr)) return true;
		if (chapterStr.length >= 3 && normalizedChapter.includes(normalizedSearch)) return true;
		if (chapterStr.length >= 3 && chapterStr.includes(ch.title)) return true;

		if (chapterInfo.chapterName && ch.title.includes(chapterInfo.chapterName)) return true;
		if (chapterInfo.chapterNum > 0) {
			const chapterPattern = new RegExp(`第${chapterInfo.chapterNum}[章节回]`);
			if (chapterPattern.test(ch.title)) return true;
		}

		return false;
	});

	// 兜底匹配：按章节序号匹配（忽略分卷；若指定了卷，仍需同卷）
	if (!matchedChapter && chapterInfo.chapterNum > 0) {
		matchedChapter = scopedChapters.find(ch => {
			const chInfo = parseChapterInfo(ch.title);
			if (chInfo.chapterNum === chapterInfo.chapterNum) {
				if (chapterInfo.volumeNum > 0 && chInfo.volumeNum > 0) {
					return chapterInfo.volumeNum === chInfo.volumeNum;
				}
				return true;
			}
			return false;
		});
	}

	// 卷内无匹配时，回退到全章节匹配（兼容 chapter 字符串本身已含卷前缀的情况）
	if (!matchedChapter && volumeStr && scopedChapters.length !== nonVolumeChapters.length) {
		matchedChapter = nonVolumeChapters.find(ch => {
			const normalizedChapter = normalizeChapterTitle(ch.title);
			if (ch.title === chapterStr) return true;
			if (normalizedChapter === normalizedSearch) return true;
			if (chapterStr.length >= 3 && ch.title.includes(chapterStr)) return true;
			if (chapterStr.length >= 3 && normalizedChapter.includes(normalizedSearch)) return true;
			if (chapterStr.length >= 3 && chapterStr.includes(ch.title)) return true;
			return false;
		});
	}

	return matchedChapter;
}

export interface NormalizedEventChapter {
	/** 拆分后的纯章节名（如"第1章"） */
	chapter: string;
	/** 所属卷标题（无卷时为空字符串） */
	volume: string;
	/** 是否匹配到了章节结构 */
	matched: boolean;
}

/**
 * 将事件章节信息归一化为新格式：chapter 存纯章节名、volume 单独存卷标题。
 * 优先通过章节结构匹配（取结构中的真实章节标题与卷标题）；
 * 匹配不到但 chapter 含卷前缀（如"第2卷·第1章"）时，退回按解析结果拆分；
 * 均不满足时原样返回。用于导入老数据 / 手动同步时适配新格式。
 */
export function normalizeEventChapter(
	chapters: Chapter[],
	chapterStr: string,
	volumeStr?: string,
): NormalizedEventChapter {
	const empty = { chapter: chapterStr, volume: volumeStr ?? "", matched: false };
	if (!chapterStr) return empty;

	const matched = findMatchedChapter(chapters, chapterStr, volumeStr);
	if (matched) {
		const volume = matched.parentId
			? chapters.find(v => v.id === matched.parentId && v.isVolume)
			: null;
		return {
			chapter: matched.title,
			volume: volume ? volume.title : (volumeStr ?? ""),
			matched: true,
		};
	}

	// 未匹配到章节结构：若 chapter 含卷前缀（"第2卷·第1章"），拆出纯章节名与卷名
	const info = parseChapterInfo(chapterStr);
	if (info.volumeNum > 0 && info.chapterNum > 0) {
		return {
			chapter: `第${info.chapterNum}章`,
			volume: info.volumeName || volumeStr || "",
			matched: false,
		};
	}

	return empty;
}
