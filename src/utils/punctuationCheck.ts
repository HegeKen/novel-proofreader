// ============================================================
// 标点异常编号定义 + 本地验证/修复函数
// AI 校对返回异常编号 → 本地验证 → 采纳时本地自动修复
// ============================================================
import { logger } from "./logger";

// ============================================================
// 异常编号定义
// ============================================================

/** 左双引号 U+201C */
const LDQ = "\u201C";
/** 右双引号 U+201D */
const RDQ = "\u201D";
/** 左单引号 U+2018 */
const LSQ = "\u2018";
/** 右单引号 U+2019 */
const RSQ = "\u2019";

/** 异常编号 → 异常信息 */
export const ANOMALY_TYPES: Record<number, { name: string; description: string }> = {
	1: { name: "缺失右引号", description: `中文双引号${LDQ}${RDQ}不配对，缺少右引号${RDQ}` },
	2: { name: "缺失左引号", description: `中文双引号${LDQ}${RDQ}不配对，缺少左引号${LDQ}` },
	3: { name: "缺失句末标点", description: "段落末尾缺少句号/问号/感叹号等" },
	4: { name: "缺失右单引号", description: `中文单引号${LSQ}${RSQ}不配对，缺少右单引号${RSQ}` },
	5: { name: "缺失左单引号", description: `中文单引号${LSQ}${RSQ}不配对，缺少左单引号${LSQ}` },
	6: { name: "缺失右角引号", description: "角引号「」不配对，缺少右角引号」" },
	7: { name: "缺失左角引号", description: "角引号「」不配对，缺少左角引号「" },
};

/** 用于注入 AI prompt 的异常编号说明 */
export const ANOMALY_PROMPT_TEXT = `异常编号（如发现以下异常，在错误对象中添加"anomaly_no"字段返回对应数字编号）：
1=缺失右引号${RDQ}，2=缺失左引号${LDQ}，3=缺失句末标点，4=缺失右单引号${RSQ}，5=缺失左单引号${LSQ}，6=缺失右角引号」，7=缺失左角引号「
注意：anomaly_no 与 find/replace 独立，find 仍需提供错误所在原文片段，replace 可留空（由本地修复）。`;

// ============================================================
// 本地验证 + 修复
// ============================================================

/** 句末合法结束字符 */
const VALID_END_CHARS = new Set([
	"\u3002", "\uFF01", "\uFF1F", "\u2026", "\uFF5E", // 。！？…～
	"\u300D", "\u300F", "\u201D", "\u2019", "\uFF09",   // 」』"'）
	"\u2014", "\u3011", "\u300B",                       // —】》
	".", "!", "?", ")", "\"", "'",                       // 西文标点
]);

/** 判断段落是否应该跳过句末标点检查 */
function shouldSkipEndCheck(para: string): boolean {
	const trimmed = para.trim();
	if (trimmed.length === 0) return true;
	if (trimmed.length < 4) return true;
	return false;
}

/**
 * 本地验证指定异常编号是否属实
 * @param para 段落原文
 * @param anomalyNo 异常编号
 * @returns 验证通过返回修复信息，不通过返回 null
 */
export function verifyAnomaly(
	para: string,
	anomalyNo: number,
): { verified: boolean; fixText?: string; description?: string } {
	const trimmed = para.trim();

	switch (anomalyNo) {
		case 1: {
			// 缺失右引号 U+201D
			const openCount = (para.match(/\u201C/g) ?? []).length;
			const closeCount = (para.match(/\u201D/g) ?? []).length;
			if (openCount > closeCount) {
				return {
					verified: true,
					fixText: trimmed + RDQ,
					description: `缺失右引号${RDQ}（${LDQ}多出${openCount - closeCount}个）`,
				};
			}
			return { verified: false };
		}
		case 2: {
			// 缺失左引号 U+201C
			const openCount = (para.match(/\u201C/g) ?? []).length;
			const closeCount = (para.match(/\u201D/g) ?? []).length;
			if (closeCount > openCount) {
				return {
					verified: true,
					fixText: LDQ + trimmed,
					description: `缺失左引号${LDQ}（${RDQ}多出${closeCount - openCount}个）`,
				};
			}
			return { verified: false };
		}
		case 3: {
			// 缺失句末标点
			if (shouldSkipEndCheck(trimmed)) return { verified: false };
			const lastChar = trimmed[trimmed.length - 1];
			if (!VALID_END_CHARS.has(lastChar)) {
				return {
					verified: true,
					fixText: trimmed + "\u3002",
					description: "段落末尾缺少句末标点",
				};
			}
			return { verified: false };
		}
		case 4: {
			// 缺失右单引号 U+2019
			const openCount = (para.match(/\u2018/g) ?? []).length;
			const closeCount = (para.match(/\u2019/g) ?? []).length;
			if (openCount > closeCount) {
				return {
					verified: true,
					fixText: trimmed + RSQ,
					description: `缺失右单引号${RSQ}（${LSQ}多出${openCount - closeCount}个）`,
				};
			}
			return { verified: false };
		}
		case 5: {
			// 缺失左单引号 U+2018
			const openCount = (para.match(/\u2018/g) ?? []).length;
			const closeCount = (para.match(/\u2019/g) ?? []).length;
			if (closeCount > openCount) {
				return {
					verified: true,
					fixText: LSQ + trimmed,
					description: `缺失左单引号${LSQ}（${RSQ}多出${closeCount - openCount}个）`,
				};
			}
			return { verified: false };
		}
		case 6: {
			// 缺失右角引号 」
			const openCount = (para.match(/\u300C/g) ?? []).length;
			const closeCount = (para.match(/\u300D/g) ?? []).length;
			if (openCount > closeCount) {
				return {
					verified: true,
					fixText: trimmed + "\u300D",
					description: `缺失右角引号」（「多出${openCount - closeCount}个）`,
				};
			}
			return { verified: false };
		}
		case 7: {
			// 缺失左角引号 「
			const openCount = (para.match(/\u300C/g) ?? []).length;
			const closeCount = (para.match(/\u300D/g) ?? []).length;
			if (closeCount > openCount) {
				return {
					verified: true,
					fixText: "\u300C" + trimmed,
					description: `缺失左角引号「（」多出${closeCount - openCount}个）`,
				};
			}
			return { verified: false };
		}
		default:
			return { verified: false };
	}
}

/**
 * 处理 AI 返回的带 anomaly_no 的错误：
 * 本地验证 → 验证通过则用本地修复文本覆盖 correctedText
 * @param paraText 段落原文
 * @param anomalyNo 异常编号
 * @returns 验证通过返回修复后的字段，不通过返回 null
 */
export function processAnomalyError(
	paraText: string,
	anomalyNo: number,
): { correctedText: string; description: string } | null {
	const result = verifyAnomaly(paraText, anomalyNo);
	if (!result.verified || !result.fixText) {
		logger.proofread(`[异常验证] 编号${anomalyNo} 验证未通过`);
		return null;
	}
	logger.proofread(`[异常验证] 编号${anomalyNo} 验证通过：${result.description}`);
	return {
		correctedText: result.fixText,
		description: result.description ?? ANOMALY_TYPES[anomalyNo]?.description ?? "",
	};
}
