// ============================================================
// AI 校对统一管线：定位 → 过滤 → 解析 → 结果合并
// 段落 / 双段落 / 章节三种校对模式共用同一套错误处理逻辑，
// 消除原先散落在 useAICheck 中的三处重复过滤实现
// ============================================================
import type { MergeSuggestion, ProofreadError } from "../types";
import { processAnomalyError } from "./punctuationCheck";
import { findWhitespaceInsensitive } from "./textSearch";
import { diffChars } from "./textDiff";
import { extractJSON, normalizeErrors } from "./aiClient";
import { useProofreadStore } from "../stores/proofreadStore";
import { logger } from "./logger";

/** 在段落文本中定位 AI 返回的错误位置 */
export function locateTextInParagraph(
	para: string,
	matchText: string,
	column?: number,
): { start: number; end: number } | null {
	const normalizeWhitespace = (s: string) => s.replace(/\s+/g, '');

	// 1. column 定位（1-based，Prompt 要求 AI 返回此字段）
	if (column !== undefined && column > 0 && column <= para.length) {
		const endIdx = column - 1 + matchText.length;
		if (endIdx <= para.length && para.slice(column - 1, endIdx) === matchText) {
			return { start: column - 1, end: endIdx };
		} else if (endIdx <= para.length) {
			const actualText = para.slice(column - 1, endIdx);
			if (normalizeWhitespace(actualText) === normalizeWhitespace(matchText)) {
				return { start: column - 1, end: endIdx };
			}
		}
	}

	// 2. 精确匹配
	const exactIdx = para.indexOf(matchText);
	if (exactIdx >= 0) return { start: exactIdx, end: exactIdx + matchText.length };

	// 3. 空白不敏感精确匹配
	const wsInsensitive = findWhitespaceInsensitive(para, matchText);
	if (wsInsensitive) return wsInsensitive;

	// 4. 模糊匹配：若 AI 补充的上下文与原文略有出入，渐进缩短 find 再试
	if (matchText.length > 4) {
		let shortened = matchText;
		while (shortened.length >= 4) {
			shortened = shortened.slice(1, -1);
			const idx = para.indexOf(shortened);
			if (idx >= 0) return { start: idx, end: idx + shortened.length };

			const wsShortened = findWhitespaceInsensitive(para, shortened);
			if (wsShortened) return wsShortened;
		}
	}

	logger.proofread(`[locateTextInParagraph] 定位失败: matchText="${matchText.slice(0, 20)}${matchText.length > 20 ? '...' : ''}", para="${para.slice(0, 30)}${para.length > 30 ? '...' : ''}", column=${column}`);
	return null;
}

/** 跨段落 fallback 定位：在当前段落找不到时，搜索前后 radius 段范围内 */
export function locateTextWithFallback(
	paragraphs: string[],
	currentIndex: number,
	matchText: string,
	column?: number,
	radius: number = 3,
): { start: number; end: number; paragraphIndex: number } | null {
	// 1. 先在当前段落尝试
	const currentPara = paragraphs[currentIndex];
	if (currentPara !== undefined) {
		const located = locateTextInParagraph(currentPara, matchText, column);
		if (located) {
			return { ...located, paragraphIndex: currentIndex };
		}
	}

	// 2. 在前后 radius 段内搜索
	const searchOrder = buildNeighborIndices(currentIndex, paragraphs.length, radius);

	for (const idx of searchOrder) {
		const para = paragraphs[idx];
		if (!para || para.trim() === "") continue;
		const located = locateTextInParagraph(para, matchText, column);
		if (located) {
			logger.proofread(`[fallback] 文本在邻段找到: 目标段落=${currentIndex}, 实际段落=${idx}, matchText="${matchText.slice(0, 20)}"`);
			return { ...located, paragraphIndex: idx };
		}
	}

	return null;
}

/** 生成前后 radius 段的候选索引（先近后远，先前后后） */
function buildNeighborIndices(currentIndex: number, length: number, radius: number): number[] {
	const order: number[] = [];
	for (let offset = 1; offset <= radius; offset++) {
		if (currentIndex - offset >= 0) order.push(currentIndex - offset);
		if (currentIndex + offset < length) order.push(currentIndex + offset);
	}
	return order;
}

// ============================================================
// AI 错误项字段提取与基础工具
// ============================================================

/** AI 返回错误项的提取字段 */
interface ExtractedErrorFields {
	lineNumber?: number;
	find: string;
	replace: string;
	orig: string;
	corr: string;
	errType: string;
	suggest: string;
	aiColumn?: number;
	anomalyNo?: number;
	matchText: string;
	correctText: string;
}

/** 从 AI 返回的错误项中提取统一字段 */
function extractErrorFields(item: unknown): ExtractedErrorFields | null {
	if (typeof item !== "object" || item === null) return null;
	const o = item as Record<string, unknown>;

	let lineNumber: number | undefined;
	if (o.lineNumber !== undefined) {
		lineNumber = typeof o.lineNumber === 'string' ? parseInt(o.lineNumber, 10) : Number(o.lineNumber);
	} else if (o.line !== undefined) {
		lineNumber = typeof o.line === 'string' ? parseInt(o.line, 10) : Number(o.line);
	}

	const find = String(o.find ?? "");
	const replace = String(o.replace ?? "");
	const orig = String(o.original ?? o.original_text ?? "");
	const corr = String(o.corrected ?? o.corrected_text ?? "");
	const errType = String(o.type ?? o.error_type ?? "");
	const suggest = String(o.reason ?? o.suggestion ?? "");
	const aiColumn = o.column !== undefined ? Number(o.column) : undefined;
	const anomalyNo = o.anomaly_no !== undefined && o.anomaly_no !== null ? Number(o.anomaly_no) : undefined;

	return {
		lineNumber,
		find,
		replace,
		orig,
		corr,
		errType,
		suggest,
		aiColumn,
		anomalyNo,
		matchText: find || orig,
		correctText: replace || corr,
	};
}

/** "无错误"标记类型集合 */
const NO_ERROR_TYPES = ['无错误', 'none', 'no_error', 'no-error', 'noerror', 'nil', 'null', ''];

/** 是否为"无错误"标记 */
function isNoErrorType(errType: string): boolean {
	return NO_ERROR_TYPES.includes(errType.toLowerCase());
}

/** 统一错误 ID 生成 */
function makeErrorId(chapterId: number, paraIdx: number, seq: number): string {
	return `err-${chapterId}-${paraIdx}-${seq}`;
}

/** 统一网络错误对象 */
export function makeNetworkError(chapterId: number, paraIdx: number, msg: string, text: string): ProofreadError {
	return {
		id: `err-${chapterId}-${paraIdx}-network-${Date.now()}`,
		startIndex: 0,
		endIndex: 0,
		errorType: "network",
		suggestion: msg.includes("Failed to fetch") ? "网络请求失败，请检查网络连接或API配置" : msg,
		originalText: text.slice(0, 50),
		correctedText: "",
		applied: false,
		skipped: false,
	};
}

/** 按 err.id 中解析出的段落索引分组错误（无法解析时归入 fallbackIndex） */
function groupErrorsByParagraph(errors: ProofreadError[], fallbackIndex: number): Map<number, ProofreadError[]> {
	const groupedErrors = new Map<number, ProofreadError[]>();
	for (const err of errors) {
		// 从 id 中解析段落索引: err-{chapterId}-{paragraphIndex}-...
		const parts = err.id.split('-');
		if (parts.length >= 3) {
			const paraIdx = parseInt(parts[2], 10);
			if (!isNaN(paraIdx)) {
				if (!groupedErrors.has(paraIdx)) groupedErrors.set(paraIdx, []);
				groupedErrors.get(paraIdx)!.push(err);
				continue;
			}
		}
		if (!groupedErrors.has(fallbackIndex)) groupedErrors.set(fallbackIndex, []);
		groupedErrors.get(fallbackIndex)!.push(err);
	}
	return groupedErrors;
}

// ============================================================
// 统一错误过滤 + 定位管线（三处解析器共用）
// ============================================================

/** 过滤定位后命中的错误及其实际段落索引 */
interface LocatedError {
	error: ProofreadError;
	paragraphIndex: number;
}

/** 单项错误过滤与定位参数 */
interface FilterAndLocateOptions {
	/** 全部可搜索段落 */
	paragraphs: string[];
	/** 首选段落索引 */
	preferredIndex: number;
	/** 首选段落定位失败后的候选段落索引（按优先级） */
	fallbackIndices?: number[];
	ignoredWords: string[];
	/** 序号，参与错误 ID 生成 */
	seq: number;
	/** 基于实际段落索引生成错误 ID */
	makeId: (actualParaIdx: number, seq: number) => string;
	/** 过滤日志标签 */
	logTag?: string;
}

/**
 * 处理单个 AI 错误项：字段校验 → 无错误/空文本/相同文本/忽略词过滤
 * → 段落定位（首选段 + 候选段 fallback）→ anomaly_no 本地验证
 * 通过则返回标准 ProofreadError，否则返回 null
 */
function filterAndLocateError(
	item: unknown,
	opts: FilterAndLocateOptions,
): LocatedError | null {
	const fields = extractErrorFields(item);
	if (!fields) return null;
	const { errType, matchText, correctText, aiColumn, anomalyNo, suggest } = fields;
	const {
		paragraphs,
		preferredIndex,
		fallbackIndices = [],
		ignoredWords,
		seq,
		makeId,
		logTag = "[过滤]",
	} = opts;

	// 过滤条件1：无错误标记
	if (isNoErrorType(errType)) {
		logger.proofread(`${logTag} 错误类型为无错误: type="${errType}"`);
		return null;
	}

	// 过滤条件2：matchText 为空
	if (!matchText) {
		logger.proofread(`${logTag} matchText 为空`);
		return null;
	}

	// 过滤条件3：原文本和修改内容完全相同（有 anomaly_no 时跳过，交由本地规则验证）
	if (!anomalyNo && matchText === correctText) {
		logger.proofread(`${logTag} 原文本和修改内容完全相同: "${matchText}"`);
		return null;
	}

	// 过滤条件4：忽略词列表
	const isIgnored = ignoredWords.some(word => word && (matchText.includes(word) || word.includes(matchText)));
	if (isIgnored) {
		logger.proofread(`${logTag} 在忽略词列表中: "${matchText}"`);
		return null;
	}

	// 定位：首选段落 → 候选段落依次尝试
	let located = locateTextInParagraph(paragraphs[preferredIndex] ?? "", matchText, aiColumn);
	let actualParagraphIndex = preferredIndex;
	if (!located) {
		for (const idx of fallbackIndices) {
			if (idx === preferredIndex) continue;
			const para = paragraphs[idx];
			if (para === undefined || para.trim() === "") continue;
			const fallbackLocated = locateTextInParagraph(para, matchText, aiColumn);
			if (fallbackLocated) {
				logger.proofread(`${logTag} 文本在候选段落找到: 首选=${preferredIndex}, 实际=${idx}`);
				located = fallbackLocated;
				actualParagraphIndex = idx;
				break;
			}
		}
	}

	// 过滤条件5：无法定位
	if (!located) {
		const preferredPara = paragraphs[preferredIndex] ?? "";
		logger.proofread(`${logTag} 无法定位文本: matchText="${matchText.slice(0, 30)}${matchText.length > 30 ? '...' : ''}", 首选段落=${preferredIndex}, 段落="${preferredPara.slice(0, 50)}${preferredPara.length > 50 ? '...' : ''}"`);
		return null;
	}

	const actualParagraph = paragraphs[actualParagraphIndex] ?? "";

	// 如果 AI 返回了 anomaly_no，本地验证并覆盖修复文本
	let finalCorrectText = correctText;
	if (anomalyNo) {
		const anomalyResult = processAnomalyError(actualParagraph, anomalyNo);
		if (!anomalyResult) {
			logger.proofread(`${logTag} anomaly_no=${anomalyNo} 本地验证未通过，跳过`);
			return null;
		}
		finalCorrectText = anomalyResult.correctedText;
	}

	logger.proofread(`[成功] 添加错误: matchText="${matchText.slice(0, 30)}", correctText="${finalCorrectText.slice(0, 30)}", type="${errType}", 段落索引=${actualParagraphIndex}${anomalyNo ? `, anomaly_no=${anomalyNo}` : ''}`);

	return {
		paragraphIndex: actualParagraphIndex,
		error: {
			id: makeId(actualParagraphIndex, seq),
			startIndex: located.start,
			endIndex: located.end,
			errorType: (errType as ProofreadError["errorType"]) || "typo",
			suggestion: suggest,
			originalText: actualParagraph.slice(located.start, located.end),
			correctedText: finalCorrectText,
			applied: false,
			skipped: false,
		},
	};
}

// ============================================================
// 模式一：单段落解析（当前段落 + 邻段 radius fallback）
// ============================================================

/** 单段落解析参数 */
interface ParseProofreadParams {
	chapterId: number;
	/** 首选段落索引 */
	paragraphIndex: number;
	/** 全部段落（用于跨段落 fallback 定位） */
	paragraphs: string[];
	ignoredWords: string[];
	/** 跨段落 fallback 搜索半径，默认前后 3 段 */
	neighborRadius?: number;
}

/** 解析段落级 AI 校对响应（JSON 数组），返回标准化的 ProofreadError 数组 */
export function parseProofreadErrors(
	raw: unknown[],
	params: ParseProofreadParams,
): ProofreadError[] {
	const { chapterId, paragraphIndex, paragraphs, ignoredWords, neighborRadius = 3 } = params;
	const fallbackIndices = buildNeighborIndices(paragraphIndex, paragraphs.length, neighborRadius);

	const errors: ProofreadError[] = [];
	let filteredCount = 0;
	for (const item of raw) {
		const located = filterAndLocateError(item, {
			paragraphs,
			preferredIndex: paragraphIndex,
			fallbackIndices,
			ignoredWords,
			seq: errors.length,
			makeId: (idx, seq) => makeErrorId(chapterId, idx, seq),
		});
		if (located) {
			errors.push(located.error);
		} else {
			filteredCount++;
		}
	}

	logger.proofread(`[parseProofreadErrors] 解析完成: 总项数=${raw.length}, 成功=${errors.length}, 过滤=${filteredCount}`);
	return errors;
}

// ============================================================
// 模式二：双段落解析（对象 {errors, merge_suggestion} 或数组）
// ============================================================

/** 双段落解析结果 */
interface DualParagraphResult {
	errors1: ProofreadError[];
	errors2: ProofreadError[];
	mergeSuggestion: MergeSuggestion | null;
}

/**
 * 解析双段落校对响应
 * - 对象格式：按每项 line(1/2) 分配到对应段落，含段落合并建议
 * - 数组格式（AI 未遵循格式）：无行号信息，优先归入第1段，定位失败再尝试第2段
 */
export function parseDualParagraphErrors(
	input: unknown,
	chapterId: number,
	paragraph1Index: number,
	paragraph2Index: number,
	paragraph1: string,
	paragraph2: string,
	ignoredWords: string[],
): DualParagraphResult {
	const paragraphs = [paragraph1, paragraph2];
	const globalIndices = [paragraph1Index, paragraph2Index];
	const errors1: ProofreadError[] = [];
	const errors2: ProofreadError[] = [];
	let filteredCount = 0;

	// 归一化错误列表
	let errorItems: unknown[] = [];
	let hasLineInfo = false;
	let mergeSuggestion: MergeSuggestion | null = null;

	if (Array.isArray(input)) {
		errorItems = input;
	} else if (input && typeof input === "object") {
		const obj = input as Record<string, unknown>;
		if (Array.isArray(obj.errors)) errorItems = obj.errors as unknown[];
		hasLineInfo = true;

		const mergeRaw = obj.merge_suggestion as Record<string, unknown> | undefined;
		if (mergeRaw && Boolean(mergeRaw.should_merge)) {
			mergeSuggestion = {
				targetParagraphIndex: paragraph2Index,
				reason: String(mergeRaw.reason ?? ""),
				applied: false,
			};
		}
	}

	for (const item of errorItems) {
		// 对象格式按 line 字段（1/2）路由；数组格式无行号，优先第1段
		let targetLineIdx = 0;
		if (hasLineInfo) {
			const fields = extractErrorFields(item);
			const line = fields?.lineNumber ?? 1;
			targetLineIdx = line === 2 ? 1 : 0;
		}

		const makeId = (actualGlobalIdx: number, seq: number) =>
			`err-${chapterId}-${actualGlobalIdx}-${actualGlobalIdx === paragraph2Index ? 'd2' : 'd1'}-${seq}`;

		const located = filterAndLocateError(item, {
			paragraphs,
			preferredIndex: targetLineIdx,
			// 指定段落找不到时，仅在另一个段落中 fallback
			fallbackIndices: [targetLineIdx === 0 ? 1 : 0],
			ignoredWords,
			seq: errors1.length + errors2.length,
			makeId: (actualLineIdx, seq) => makeId(globalIndices[actualLineIdx], seq),
			logTag: "[双段落过滤]",
		});

		if (!located) {
			filteredCount++;
			continue;
		}

		if (located.paragraphIndex === 1) {
			errors2.push(located.error);
		} else {
			errors1.push(located.error);
		}
	}

	logger.proofread(`[parseDualParagraphErrors] 解析完成: 总项=${errorItems.length}, 第1段成功=${errors1.length}, 第2段成功=${errors2.length}, 过滤=${filteredCount}, 合并建议=${mergeSuggestion ? '是' : '否'}`);

	return { errors1, errors2, mergeSuggestion };
}

// ============================================================
// 模式三：章节批次解析（lineNumber 路由 + 批次/全章文本匹配）
// ============================================================

/** 章节批次解析参数 */
interface ParseChapterBatchParams {
	chapterId: number;
	/** 整章全部段落 */
	paragraphs: string[];
	/** 批次起始段落索引（含） */
	batchStart: number;
	/** 批次结束段落索引（不含） */
	batchEnd: number;
	ignoredWords: string[];
}

/**
 * 解析章节批次 AI 响应：按 lineNumber 分组返回每段错误
 * lineNumber 缺失或越界时，依次在批次内、整章内做文本匹配路由；
 * 仍无法定位则过滤
 */
export function parseChapterErrors(
	raw: unknown[],
	params: ParseChapterBatchParams,
): ProofreadError[][] {
	const { chapterId, paragraphs, batchStart, batchEnd, ignoredWords } = params;
	const errorsByLine: ProofreadError[][] = paragraphs.map(() => []);
	let filteredCount = 0;

	for (const item of raw) {
		const fields = extractErrorFields(item);
		if (!fields) continue;
		const { errType, matchText, aiColumn } = fields;

		// 提取行号（支持 string 和 number 类型），验证是否在该批次范围内
		let lineNumber = fields.lineNumber ?? -1;
		let isValidLineNumber = lineNumber >= batchStart && lineNumber < batchEnd;

		if (!isValidLineNumber) {
			logger.proofread(`[章节模式] 行号 ${lineNumber} 不在批次范围 ${batchStart}-${batchEnd}，尝试文本匹配定位`);

			// 先在批次内搜索
			const foundInBatch = paragraphs.findIndex((p, idx) =>
				idx >= batchStart && idx < batchEnd && locateTextInParagraph(p, matchText, aiColumn) !== null
			);

			if (foundInBatch >= 0) {
				lineNumber = foundInBatch;
				isValidLineNumber = true;
				logger.proofread(`[章节模式] 在批次内找到匹配段落: ${lineNumber}`);
			} else {
				// 在整个章节范围内搜索
				const foundInChapter = paragraphs.findIndex((p) =>
					locateTextInParagraph(p, matchText, aiColumn) !== null
				);
				if (foundInChapter >= 0) {
					lineNumber = foundInChapter;
					isValidLineNumber = true;
					logger.proofread(`[章节模式] 在章节范围内找到匹配段落: ${lineNumber}`);
				} else {
					logger.proofread(`[章节模式-过滤] 无法定位错误: matchText="${matchText.slice(0, 30)}${matchText.length > 30 ? '...' : ''}", lineNumber=${lineNumber}`);
					filteredCount++;
					continue;
				}
			}
		}

		// 统一过滤管线：无错误标记、空文本、相同文本、忽略词、精确定位、anomaly_no 验证
		const located = filterAndLocateError(item, {
			paragraphs,
			preferredIndex: lineNumber,
			fallbackIndices: [],
			ignoredWords,
			seq: errorsByLine[lineNumber].length,
			makeId: (idx, seq) => makeErrorId(chapterId, idx, seq),
			logTag: "[章节模式-过滤]",
		});

		if (!located) {
			filteredCount++;
			continue;
		}

		logger.proofread(`[章节模式-成功] 添加错误: lineNumber=${located.paragraphIndex}, matchText="${matchText.slice(0, 30)}", correctText="${located.error.correctedText.slice(0, 30)}", type="${errType}"`);
		errorsByLine[located.paragraphIndex].push(located.error);
	}

	logger.proofread(`[章节模式] 批次 ${batchStart}-${batchEnd} 解析完成: 总项数=${raw.length}, 成功=${errorsByLine.reduce((sum, arr) => sum + arr.length, 0)}, 过滤=${filteredCount}`);
	return errorsByLine;
}

// ============================================================
// 内置纠错模型：纠正后句子 → diff 错误列表
// ============================================================

/**
 * 将内置纠错模型输出的"纠正后句子"与原文 diff，生成 ProofreadError 列表
 * 适用于 ChineseErrorCorrector 等专用纠错模型（输出纠正后全文而非 JSON）
 */
export function buildErrorsFromCorrectedText(
	original: string,
	corrected: string,
	chapterId: number,
	paragraphIndex: number,
): ProofreadError[] {
	const errors: ProofreadError[] = [];
	if (!corrected || corrected.trim() === original.trim()) return errors;

	// 剥离模型可能输出的 <think>...</think> 思考过程标签
	const cleanCorrected = corrected
		.replace(/<think>[\s\S]*?<\/think>/g, "")
		.replace(/<\/?think>/g, "")
		.trim();
	if (!cleanCorrected || cleanCorrected === original.trim()) return errors;

	const parts = diffChars(original, cleanCorrected);

	// 防护：纠错模型输出应与原文高度重合（只改少量错字）。
	// 若重合度过低，说明模型未遵循指令（如蒸馏模型复述指令、输出解释性文字），
	// 直接丢弃输出，避免把整段原文误报为错误
	const equalChars = parts
		.filter((p) => p.type === "equal")
		.reduce((sum, p) => sum + p.text.length, 0);
	const equalRatio = equalChars / Math.max(original.length, cleanCorrected.length, 1);
	if (equalRatio < 0.3) {
		logger.proofread(
			`[buildErrorsFromCorrectedText] 输出与原文重合度过低(${(equalRatio * 100).toFixed(0)}%)，判定模型未遵循纠错指令，丢弃输出`,
		);
		return [];
	}

	let cursor = 0; // 当前在原文中的位置
	let removed = "";
	let added = "";
	let removedStart = -1;

	const flush = () => {
		if (removed && added && removed !== added) {
			// 判断错误类型
			let errorType: ProofreadError["errorType"] = "typo";
			if (removed.includes("的") || removed.includes("地") || removed.includes("得") ||
				added.includes("的") || added.includes("地") || added.includes("得")) {
				errorType = "grammar";
			}
			errors.push({
				id: `err-${chapterId}-${paragraphIndex}-${removedStart}-${cursor}`,
				startIndex: removedStart,
				endIndex: cursor,
				errorType,
				suggestion: added,
				originalText: removed,
				correctedText: added,
				applied: false,
				skipped: false,
			});
		}
		removed = "";
		added = "";
		removedStart = -1;
	};

	for (const part of parts) {
		if (part.type === "equal") {
			flush();
			cursor += part.text.length;
		} else if (part.type === "removed") {
			if (removedStart < 0) removedStart = cursor;
			removed += part.text;
			cursor += part.text.length;
		} else if (part.type === "added") {
			added += part.text;
		}
	}
	flush();

	logger.proofread(
		`[buildErrorsFromCorrectedText] 原文=${original.length}字, 纠正后(清洗后)=${cleanCorrected.length}字, 生成错误=${errors.length}`,
	);
	return errors;
}

/**
 * 解析一次校对请求的 AI 响应，统一三种返回形态：
 * 1. JSON 数组/对象 → 标准错误解析
 * 2. 内置纠错模型的纯文本"纠正后句子"（correctedTextMode=true）→ diff 生成
 * 3. 空响应/无法解析 → []
 */
export function resolveProofreadReply(
	reply: string,
	params: ParseProofreadParams & { correctedTextMode?: boolean },
): ProofreadError[] {
	const raw = normalizeErrors(extractJSON(reply));
	if (raw.length > 0) {
		return parseProofreadErrors(raw, params);
	}
	if (params.correctedTextMode && reply.trim()) {
		return buildErrorsFromCorrectedText(
			params.paragraphs[params.paragraphIndex] ?? "",
			reply.trim(),
			params.chapterId,
			params.paragraphIndex,
		);
	}
	return [];
}

// ============================================================
// 结果写入 store：主段落合并去重 + 跨段落错误分发
// ============================================================

/**
 * 将一次校对产生的错误写入 store：
 * - 主段落：与已有错误按 id 去重后合并，标记 done
 * - 经 fallback 定位到邻段的错误：分发合并到对应段落（保留其已有错误）
 */
export function mergeErrorsIntoStore(
	chapterId: number,
	primaryIndex: number,
	errors: ProofreadError[],
): void {
	const state = useProofreadStore.getState();
	const groupedErrors = groupErrorsByParagraph(errors, primaryIndex);

	// 更新主段落（标记为完成），合并已有错误
	const existingForPrimary = state.results[chapterId]?.[primaryIndex];
	const newErrorsForPrimary = groupedErrors.get(primaryIndex) ?? [];
	const existingIdsForPrimary = new Set((existingForPrimary?.errors ?? []).map(e => e.id));
	state.updateParagraphResult(chapterId, primaryIndex, {
		errors: [
			...(existingForPrimary?.errors ?? []),
			...newErrorsForPrimary.filter(e => !existingIdsForPrimary.has(e.id)),
		],
		status: "done",
	});

	// 将跨段落 errors 合并到对应段落（保留已有错误）
	for (const [paraIdx, paraErrors] of groupedErrors) {
		if (paraIdx === primaryIndex) continue;
		const existingResult = state.results[chapterId]?.[paraIdx];
		const existingIds = new Set((existingResult?.errors ?? []).map(e => e.id));
		state.updateParagraphResult(chapterId, paraIdx, {
			errors: [
				...(existingResult?.errors ?? []),
				...paraErrors.filter(e => !existingIds.has(e.id)),
			],
		});
	}
}
