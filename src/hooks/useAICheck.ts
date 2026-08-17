// ============================================================
// AI 校对检测 Hook
// ============================================================
import { useCallback, useEffect, useRef } from "react";
import { useNovelStore } from "../stores/novelStore";
import { useAIConfigStore } from "../stores/aiConfigStore";
import { useCharacterStore } from "../stores/characterStore";
import { useProofreadMetaStore } from "../stores/proofreadMetaStore";
import { useProofreadStore } from "../stores/proofreadStore";
import { useConfigStore } from "../stores/configStore";
import { splitParagraphs } from "../utils/chapterSplit";
import { buildParagraphIndexMap } from "../utils/formatters";
import {
	sendChatCompletion,
	PROOFREAD_SYSTEM_PROMPT,
	PROOFREAD_SYSTEM_PROMPT_CHAPTER,
	PROOFREAD_SYSTEM_PROMPT_DUAL,
	buildProofreadUserPrompt,
	buildProofreadSystemPrompt,
	buildDualParagraphUserPrompt,
	extractJSON,
	normalizeErrors,
} from "../utils/aiClient";
import { processAnomalyError } from "../utils/punctuationCheck";
import { logger } from "../utils/logger";
import { startProofreadService, stopProofreadService } from "../utils/androidService";
import { Semaphore } from "../utils/concurrent";
import { findWhitespaceInsensitive } from "../utils/textSearch";
import type {
	ParagraphResult,
	ProofreadError,
	CheckGranularity,
	MergeSuggestion,
} from "../types";

// 从配置中读取并发设置，默认为4
const getMaxConcurrentBatches = (enableParallel: boolean, configuredMax: number): number => {
	if (!enableParallel) return 1;
	return configuredMax > 0 ? configuredMax : 4;
};

/**
 * 模块级共享 AbortController。
 * 所有 useAICheck 实例（主校对面板 + 队列面板）共用同一个进行中的请求，
 * 新请求开始时取消旧请求，避免跨实例并发向同一章节写入结果互相覆盖。
 */
let sharedAbortRef: AbortController | null = null;

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
	const searchOrder: number[] = [];
	for (let offset = 1; offset <= radius; offset++) {
		if (currentIndex - offset >= 0) searchOrder.push(currentIndex - offset);
		if (currentIndex + offset < paragraphs.length) searchOrder.push(currentIndex + offset);
	}

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

// ============================================================
// AI 错误项解析共享工具 — 三处解析器（段落/双段落/章节批次）复用
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
function makeNetworkError(chapterId: number, paraIdx: number, msg: string, text: string): ProofreadError {
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

/** 解析 AI 校对响应，返回标准化的 ProofreadError 数组 */
function parseAIProofreadResponse(
	raw: unknown[],
	chapterId: number,
	paragraphIndex: number,
	paragraph: string,
	ignoredWords: string[],
	allParagraphs?: string[],
): ProofreadError[] {
	const errors: ProofreadError[] = [];
	let filteredCount = 0;
	
	for (const item of raw) {
		const fields = extractErrorFields(item);
		if (!fields) continue;
		const { errType, matchText, correctText, aiColumn, anomalyNo, suggest } = fields;

		// 过滤条件1：无错误标记
		if (isNoErrorType(errType)) {
			logger.proofread(`[过滤] 错误类型为无错误: type="${errType}"`);
			filteredCount++;
			continue;
		}
		
		// 过滤条件2：matchText 为空
		if (!matchText) {
			logger.proofread(`[过滤] matchText 为空`);
			filteredCount++;
			continue;
		}

		// 过滤条件3：原文本和修改内容完全相同（放宽条件：仅当完全一致时过滤；有 anomaly_no 时跳过此过滤）
		if (!anomalyNo && matchText === correctText) {
			logger.proofread(`[过滤] 原文本和修改内容完全相同: "${matchText}"`);
			filteredCount++;
			continue;
		}
		
		// 过滤条件4：去除空格后相同（保留大小写差异；有 anomaly_no 时跳过此过滤）
		if (!anomalyNo && matchText.replace(/\s/g, '') === correctText.replace(/\s/g, '') && matchText === correctText) {
			logger.proofread(`[过滤] 去除空格后且原文相同: "${matchText}" vs "${correctText}"`);
			filteredCount++;
			continue;
		}

		// 过滤条件5：忽略词列表
		const isIgnored = ignoredWords.some(word => word && (matchText.includes(word) || word.includes(matchText)));
		if (isIgnored) {
			logger.proofread(`[过滤] 在忽略词列表中: "${matchText}"`);
			filteredCount++;
			continue;
		}

		// 尝试在当前段落定位
		let located = locateTextInParagraph(paragraph, matchText, aiColumn);
		let actualParagraph = paragraph;
		let actualParagraphIndex = paragraphIndex;

		// 当前段落找不到时，跨段落 fallback 搜索
		if (!located && allParagraphs) {
			const fallbackResult = locateTextWithFallback(allParagraphs, paragraphIndex, matchText, aiColumn);
			if (fallbackResult) {
				located = { start: fallbackResult.start, end: fallbackResult.end };
				actualParagraphIndex = fallbackResult.paragraphIndex;
				actualParagraph = allParagraphs[fallbackResult.paragraphIndex];
			}
		}
		
		// 过滤条件6：无法定位
		if (!located) {
			logger.proofread(`[过滤] 无法定位文本: matchText="${matchText.slice(0, 30)}${matchText.length > 30 ? '...' : ''}", paragraph="${paragraph.slice(0, 50)}${paragraph.length > 50 ? '...' : ''}"`);
			filteredCount++;
			continue;
		}

		// 成功添加错误
		// 如果 AI 返回了 anomaly_no，本地验证并覆盖修复文本
		let finalCorrectText = correctText;
		if (anomalyNo) {
			const anomalyResult = processAnomalyError(actualParagraph, anomalyNo);
			if (!anomalyResult) {
				logger.proofread(`[过滤] anomaly_no=${anomalyNo} 本地验证未通过，跳过`);
				filteredCount++;
				continue;
			}
			finalCorrectText = anomalyResult.correctedText;
		}

		logger.proofread(`[成功] 添加错误: matchText="${matchText.slice(0, 30)}", correctText="${finalCorrectText.slice(0, 30)}", type="${errType}", 段落索引=${actualParagraphIndex}${anomalyNo ? `, anomaly_no=${anomalyNo}` : ''}`);
		errors.push({
			id: makeErrorId(chapterId, actualParagraphIndex, errors.length),
			startIndex: located.start,
			endIndex: located.end,
			errorType: (errType as ProofreadError["errorType"]) || "typo",
			suggestion: suggest,
			originalText: actualParagraph.slice(located.start, located.end),
			correctedText: finalCorrectText,
			applied: false,
			skipped: false,
		});
	}
	
	logger.proofread(`[parseAIProofreadResponse] 解析完成: 总项数=${raw.length}, 成功=${errors.length}, 过滤=${filteredCount}`);
	return errors;
}

/** 解析双段落校对响应，返回两个段落各自的错误列表和合并建议 */
function parseDualParagraphResponse(
	raw: Record<string, unknown>,
	chapterId: number,
	paragraph1Index: number,
	paragraph2Index: number,
	paragraph1: string,
	paragraph2: string,
	ignoredWords: string[],
): {
	errors1: ProofreadError[];
	errors2: ProofreadError[];
	mergeSuggestion: MergeSuggestion | null;
} {
	const errors1: ProofreadError[] = [];
	const errors2: ProofreadError[] = [];
	let filteredCount = 0;

	// 构建双段落文本数组用于 fallback
	const dualParagraphs = [paragraph1, paragraph2];
	const dualIndices = [paragraph1Index, paragraph2Index];

	// 解析错误列表
	const errorList = raw.errors;
	if (Array.isArray(errorList)) {
		for (const item of errorList) {
			const fields = extractErrorFields(item);
			if (!fields) continue;
			const { errType, matchText, correctText, aiColumn, anomalyNo, suggest } = fields;

			const line = fields.lineNumber ?? 1;

			// 过滤1：无错误标记
			if (isNoErrorType(errType)) {
				filteredCount++;
				continue;
			}

			// 过滤2：matchText 为空
			if (!matchText) {
				filteredCount++;
				continue;
			}

			// 过滤3：原文本和修改内容完全相同（有 anomaly_no 时跳过）
			if (!anomalyNo && matchText === correctText) {
				filteredCount++;
				continue;
			}

			const targetLineIdx = line === 2 ? 1 : 0;
			const targetParagraph = dualParagraphs[targetLineIdx];

			// 过滤4：忽略词
			const isIgnored = ignoredWords.some(word => word && (matchText.includes(word) || word.includes(matchText)));
			if (isIgnored) {
				filteredCount++;
				continue;
			}

			// 先在指定段落尝试定位
			let located = locateTextInParagraph(targetParagraph, matchText, aiColumn);
			let actualLineIdx = targetLineIdx;

			// 如果指定段落找不到，在另一个段落中 fallback 搜索
			if (!located) {
				const otherLineIdx = targetLineIdx === 0 ? 1 : 0;
				const otherParagraph = dualParagraphs[otherLineIdx];
				if (otherParagraph) {
					const fallbackLocated = locateTextInParagraph(otherParagraph, matchText, aiColumn);
					if (fallbackLocated) {
						logger.proofread(`[双段落fallback] line=${line}的文本在另一段落找到，将分配给第${otherLineIdx + 1}段`);
						located = fallbackLocated;
						actualLineIdx = otherLineIdx;
					}
				}
			}

			// 过滤5：无法定位
			if (!located) {
				logger.proofread(`[双段落过滤] 无法定位: line=${line}, matchText="${matchText.slice(0, 30)}", 段落长度=${targetParagraph.length}`);
				filteredCount++;
				continue;
			}

			const actualParagraph = dualParagraphs[actualLineIdx];
			const actualGlobalIdx = dualIndices[actualLineIdx];

			// 如果 AI 返回了 anomaly_no，本地验证并覆盖修复文本
			let finalCorrectText = correctText;
			if (anomalyNo) {
				const anomalyResult = processAnomalyError(actualParagraph, anomalyNo);
				if (!anomalyResult) {
					logger.proofread(`[双段落过滤] anomaly_no=${anomalyNo} 本地验证未通过，跳过`);
					filteredCount++;
					continue;
				}
				finalCorrectText = anomalyResult.correctedText;
			}

			const error: ProofreadError = {
				id: `err-${chapterId}-${actualGlobalIdx}-${actualLineIdx === 1 ? 'd2' : 'd1'}-${errors1.length + errors2.length}`,
				startIndex: located.start,
				endIndex: located.end,
				errorType: (errType as ProofreadError["errorType"]) || "typo",
				suggestion: suggest,
				originalText: actualParagraph.slice(located.start, located.end),
				correctedText: finalCorrectText,
				applied: false,
				skipped: false,
			};

			if (actualLineIdx === 1) {
				errors2.push(error);
			} else {
				errors1.push(error);
			}
		}
	}

	// 解析合并建议
	let mergeSuggestion: MergeSuggestion | null = null;
	const mergeRaw = raw.merge_suggestion as Record<string, unknown> | undefined;
	if (mergeRaw) {
		const shouldMerge = Boolean(mergeRaw.should_merge);
		if (shouldMerge) {
			mergeSuggestion = {
				targetParagraphIndex: paragraph2Index,
				reason: String(mergeRaw.reason ?? ""),
				applied: false,
			};
		}
	}

	logger.proofread(`[parseDualParagraphResponse] 解析完成: 总项=${Array.isArray(errorList) ? errorList.length : 0}, 第1段成功=${errors1.length}, 第2段成功=${errors2.length}, 过滤=${filteredCount}, 合并建议=${mergeSuggestion ? '是' : '否'}`);

	return { errors1, errors2, mergeSuggestion };
}

export function useAICheck() {
	const aiConfig = useAIConfigStore((s) => s.aiConfig);
	const currentNovelId = useNovelStore((s) => s.currentNovelId);
	const currentChapterIndex = useNovelStore((s) => s.currentChapterIndex);
	const getIgnoredWords = useProofreadMetaStore((s) => s.getIgnoredWords);
	const getCharacters = useCharacterStore((s) => s.getCharacters);
	const promptConfig = useConfigStore((s) => s.promptConfig);
	const proofreadConfig = useConfigStore((s) => s.proofreadConfig);
	const saveProofreadProgress = useProofreadMetaStore((s) => s.saveProofreadProgress);
	const setResults = useProofreadStore((s) => s.setResults);
	const updateParagraphResult = useProofreadStore(
		(s) => s.updateParagraphResult,
	);
	// 模块级共享 AbortController：主面板与队列面板并发校对时，新请求会取消旧请求，
	// 避免两个 hook 实例同时向同一章节写入结果互相覆盖
	const abortRef = useRef<AbortController | null>(sharedAbortRef);

	// 切换章节时自动取消进行中的检查，避免旧章节残留永久 checking 状态
	useEffect(() => {
		abortRef.current?.abort();
		sharedAbortRef = null;
		abortRef.current = null;
	}, [currentChapterIndex]);

	// 组件卸载时取消进行中的请求，避免卸载后继续写 store
	useEffect(() => {
		return () => {
			abortRef.current?.abort();
		};
	}, []);

	const checkChapter = useCallback(
		async (
			granularity: CheckGranularity,
			startFrom: number = 0,
			onLineChecking?: (filteredIndex: number | null) => void,
		) => {
			// 从 store 实时读取最新章节，避免闭包捕获过期快照（批量队列场景下
			// processQueue 持有的 checkChapter 引用可能早于 setCurrentChapterIndex）
			const { chapters: latestChapters, currentChapterIndex: latestChapterIndex } = useNovelStore.getState();
			const chapter = latestChapters[latestChapterIndex];
			if (!chapter) return;

			startProofreadService().catch(() => {});

			// 获取并发配置
			const maxConcurrent = getMaxConcurrentBatches(
				proofreadConfig.enableParallelProcessing,
				proofreadConfig.maxConcurrentBatches
			);

			logger.proofread(`checkChapter 开始: chapterIndex=${latestChapterIndex + 1}, granularity=${granularity}, startFrom=${startFrom} (第 ${startFrom + 1} 段)`);
			logger.proofread(`并发模式: ${proofreadConfig.enableParallelProcessing ? '启用' : '禁用'}, 最大并发数: ${maxConcurrent}`);

			// 取消之前的请求（共享 controller：队列与主面板互斥）
			sharedAbortRef?.abort();
			const controller = new AbortController();
			sharedAbortRef = controller;
			abortRef.current = controller;

			const text = chapter.content;
			// 获取当前小说的忽略单词列表
			const ignoredWordsList = getIgnoredWords(currentNovelId ?? "");
			// 获取当前小说的角色名和别称，添加到忽略列表
			const characterNames = currentNovelId ? getCharacters(currentNovelId).flatMap(c => [c.name, ...(c.aliases || [])]) : [];
			// 合并忽略词列表（去重）
			const ignoredWords = Array.from(new Set([...ignoredWordsList, ...characterNames]));
			logger.proofread(`忽略单词列表: ${ignoredWords.join(", ") || "无"}`);
			logger.proofread(`角色名称已自动加入忽略词: ${characterNames.join(", ") || "无"}`);

			if (granularity === "chapter") {
				// 分批次发送（每批字符数不超过550，防止请求过大导致失败）
				// 重要：保留原始段落索引（包含空段落），与阅读区保持一致
				const paragraphs = splitParagraphs(text);
				logger.proofread(`段落分割完成: 总段落数=${paragraphs.length}, startFrom=${startFrom}`);
				const MAX_CHARS_PER_BATCH = 450;

				// 初始化每个段落的结果（保留原始索引）
				const initial: ParagraphResult[] = paragraphs.map((p, i) => ({
					paragraphIndex: i,
					originalText: p,
					errors: [],
					status: p.trim() === "" ? "done" : "pending", // 空段落直接标记为完成
				}));
				setResults(chapter.id, initial);

				// 将段落分成多个批次（基于字符数而非段落数）
				const batches: { start: number; end: number }[] = [];
				let batchStart = 0;
				let currentCharCount = 0;

				for (let i = 0; i < paragraphs.length; i++) {
					const para = paragraphs[i];
					// 跳过空段落，不计入字符数
					if (para.trim() === "") continue;

					currentCharCount += para.length;

					// 如果超过限制，从当前位置切分
					if (currentCharCount > MAX_CHARS_PER_BATCH && batchStart < i) {
						batches.push({ start: batchStart, end: i });
						batchStart = i;
						currentCharCount = para.length;
					}
				}

				// 处理最后一批
				if (batchStart < paragraphs.length) {
					batches.push({ start: batchStart, end: paragraphs.length });
				}

				logger.proofread(`批次构建完成: 总批次数=${batches.length}, 批次详情:`, batches.map((b, idx) => `批次${idx+1}: ${b.start}-${b.end}`).join(', '));
				logger.proofread(`共分为 ${batches.length} 批处理`);

				// 多线程并发处理批次（限制最大并发数为 MAX_CONCURRENT_BATCHES）
				const processBatch = async (batch: { start: number; end: number }) => {
					if (controller.signal.aborted) return;

					logger.proofread(`处理批次: start=${batch.start}, end=${batch.end}`);

					// 更新该批次段落的状态为 checking
					for (let i = batch.start; i < batch.end; i++) {
						if (paragraphs[i].trim() !== "") {
							updateParagraphResult(chapter.id, i, { status: "checking" });
						}
					}

					try {
						// 构建该批次的 textByLine（只包含非空段落，但保留原始索引）
						const textByLine: Record<number, string> = {};
						for (let i = batch.start; i < batch.end; i++) {
							if (paragraphs[i].trim() !== "") {
								textByLine[i] = paragraphs[i];
							}
						}

						logger.proofread(`发送请求给大模型: textByLine 行号列表=[${Object.keys(textByLine).join(', ')}], 字符总数=${JSON.stringify(textByLine).length}`);

						const messages = [
							{ role: "system" as const, content: promptConfig.proofreadChapter || PROOFREAD_SYSTEM_PROMPT_CHAPTER },
							{
								role: "user" as const,
								content: buildProofreadUserPrompt(JSON.stringify(textByLine), ignoredWords),
							},
						];

						logger.proofread(`发送请求: 批次 ${batch.start}-${batch.end}, 发送的行号:`, Object.keys(textByLine));

						const reply = await sendChatCompletion(
							messages,
							aiConfig,
							controller.signal,
						);
						const raw = normalizeErrors(extractJSON(reply));

						// 收集该批次所有错误，按原始行号分组
						const errorsByLine: ProofreadError[][] = paragraphs.map(() => []);
						let filteredCount = 0;
						
						// 只处理该批次内的错误
						for (const item of raw) {
							const fields = extractErrorFields(item);
							if (!fields) continue;
							const { errType, matchText, correctText, aiColumn, suggest } = fields;

							// 提取行号（支持 string 和 number 类型）
							let lineNumber = fields.lineNumber ?? -1;

							// 过滤条件1：无错误标记
							if (isNoErrorType(errType)) {
								logger.proofread(`[章节模式-过滤] 错误类型为无错误: type="${errType}"`);
								filteredCount++;
								continue;
							}

							// 过滤条件2：matchText 为空
							if (!matchText) {
								logger.proofread(`[章节模式-过滤] matchText 为空`);
								filteredCount++;
								continue;
							}
							
							// 过滤条件3：原文本和修改内容完全相同（放宽条件）
							if (matchText === correctText) {
								logger.proofread(`[章节模式-过滤] 原文本和修改内容完全相同: "${matchText}"`);
								filteredCount++;
								continue;
							}
							
							// 过滤条件4：去除空格后相同（保留大小写差异）
							if (matchText.replace(/\s/g, '') === correctText.replace(/\s/g, '') && matchText === correctText) {
								logger.proofread(`[章节模式-过滤] 去除空格后且原文相同: "${matchText}" vs "${correctText}"`);
								filteredCount++;
								continue;
							}

							// 检查行号是否在该批次范围内
							let isValidLineNumber = lineNumber >= batch.start && lineNumber < batch.end;
							
							if (!isValidLineNumber) {
								logger.proofread(`[章节模式] 行号 ${lineNumber} 不在批次范围 ${batch.start}-${batch.end}，尝试文本匹配定位`);
								
								// 先在批次内搜索
								const foundInBatch = paragraphs.findIndex((p, idx) =>
									idx >= batch.start && idx < batch.end && locateTextInParagraph(p, matchText, aiColumn) !== null
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

							const targetPara = paragraphs[lineNumber];
							const located = locateTextInParagraph(targetPara, matchText, aiColumn);
							if (!located) {
								logger.proofread(`[章节模式-过滤] 定位失败: matchText="${matchText.slice(0, 30)}${matchText.length > 30 ? '...' : ''}", paragraph=${lineNumber}`);
								filteredCount++;
								continue;
							}

							// 成功添加错误
							logger.proofread(`[章节模式-成功] 添加错误: lineNumber=${lineNumber}, matchText="${matchText.slice(0, 30)}", correctText="${correctText.slice(0, 30)}", type="${errType}"`);
							errorsByLine[lineNumber].push({
								id: makeErrorId(chapter.id, lineNumber, errorsByLine[lineNumber].length),
								startIndex: located.start,
								endIndex: located.end,
								errorType: (errType as ProofreadError["errorType"]) || "typo",
								suggestion: suggest,
								originalText: paragraphs[lineNumber].slice(located.start, located.end),
								correctedText: correctText,
								applied: false,
								skipped: false,
							});
						}

						logger.proofread(`[章节模式] 批次 ${batch.start}-${batch.end} 解析完成: 总项数=${raw.length}, 成功=${errorsByLine.reduce((sum, arr) => sum + arr.length, 0)}, 过滤=${filteredCount}`);

						// 更新该批次每个段落的结果（基于原始索引）
						for (let lineIdx = batch.start; lineIdx < batch.end; lineIdx++) {
							if (paragraphs[lineIdx].trim() === "") continue; // 跳过空段落
							updateParagraphResult(chapter.id, lineIdx, {
								errors: errorsByLine[lineIdx],
								status: "done",
							});
						}
					} catch (err: unknown) {
						if (err instanceof DOMException && err.name === "AbortError") return;
						const msg = err instanceof Error ? err.message : String(err);
						// 更新该批次非空段落为错误状态
						for (let lineIdx = batch.start; lineIdx < batch.end; lineIdx++) {
							if (paragraphs[lineIdx].trim() === "") continue; // 跳过空段落
							// 将网络错误添加到错误清单
							const networkError = makeNetworkError(chapter.id, lineIdx, msg, paragraphs[lineIdx]);
							updateParagraphResult(chapter.id, lineIdx, {
								errors: [networkError],
								status: "error",
								errorMessage: msg,
							});
						}
					}
				};

				// 使用 Promise 池实现多线程并发处理
				const semaphore = new Semaphore(maxConcurrent);
				const results: Promise<void>[] = [];
				for (const batch of batches) {
					if (controller.signal.aborted) break;
					await semaphore.acquire();
					const promise = processBatch(batch).finally(() => {
						semaphore.release();
					});
					results.push(promise);
				}
				// 等待所有批次完成
				await Promise.all(results);
			} else {
				// 按段落 或 按行检测
				const allLines = splitParagraphs(text);
				const filteredItems = allLines.filter((p) => p.trim() !== "");
				logger.proofread(`非chapter粒度: 总行数=${allLines.length}, 过滤后行数=${filteredItems.length}, startFrom=${startFrom}`);
				// 建立过滤后索引到原始索引的映射
				const indexMap = buildParagraphIndexMap(text);
				logger.proofread(`索引映射: indexMap前20项=[${indexMap.slice(0, 20).join(', ')}]...`);
				// 关键修复：初始化所有段落（包括空段落），确保数组索引与原始段落索引一致
				const initial: ParagraphResult[] = allLines.map((p, originalIndex) => {
					// 找到该段落在过滤后的索引
					const filteredIndex = indexMap.indexOf(originalIndex);
					// 如果是有效段落且在 startFrom 之前，标记为已跳过
					if (filteredIndex >= 0 && filteredIndex < startFrom) {
						return {
							paragraphIndex: originalIndex,
							originalText: p,
							errors: [],
							status: "done" as const,
						};
					}
					// 空段落直接标记为完成
					if (p.trim() === "") {
						return {
							paragraphIndex: originalIndex,
							originalText: p,
							errors: [],
							status: "done" as const,
						};
					}
					// 其他情况标记为待检测
					return {
						paragraphIndex: originalIndex,
						originalText: p,
						errors: [],
						status: "pending" as const,
					};
				});
				setResults(chapter.id, initial);

				// 多线程并发处理段落（双段落合并请求）
				const processParagraphItem = async (filteredIdx: number) => {
					if (controller.signal.aborted) return;

					const originalIndex = indexMap[filteredIdx];

					logger.proofread(`检测第 ${filteredIdx + 1} 项: filteredIndex=${filteredIdx}, originalIndex=${originalIndex}, startFrom=${startFrom}`);

					updateParagraphResult(chapter.id, originalIndex, { status: "checking" });
					// 同步当前检测行（供 handleStartCheck 等调用方展示单行检测状态）
					onLineChecking?.(filteredIdx);

					try {
						const item = filteredItems[filteredIdx];
						// 如果太短，跳过
						if (item.trim().length < 5) {
							updateParagraphResult(chapter.id, originalIndex, { status: "done" });
							return;
						}

						logger.proofread(`发送请求: filteredIndex=${filteredIdx}, originalIndex=${originalIndex}, 文本长度=${item.length}`);

						// 只传输当前段落实际包含的 ignoredWords，减少 token 消耗
						const relevantIgnoredWords = ignoredWords.filter(word => word && item.includes(word));
						logger.proofread(`段落包含的 ignoredWords: ${relevantIgnoredWords.length}/${ignoredWords.length} - ${relevantIgnoredWords.join('、')}`);

						const systemPrompt = buildProofreadSystemPrompt(
							promptConfig.proofread || PROOFREAD_SYSTEM_PROMPT,
							relevantIgnoredWords,
						);
						const messages = [
							{ role: "system" as const, content: systemPrompt },
							{
								role: "user" as const,
								content: buildProofreadUserPrompt(item, relevantIgnoredWords),
							},
						];

						const reply = await sendChatCompletion(messages, aiConfig, controller.signal);
						const raw = normalizeErrors(extractJSON(reply));

						const errors = parseAIProofreadResponse(raw, chapter.id, originalIndex, item, relevantIgnoredWords, allLines);

						// 将 errors 按实际段落索引分组，分配到正确的段落
						const groupedErrors = groupErrorsByParagraph(errors, originalIndex);

						// 更新当前段落（标记为完成），合并已有错误
						const state = useProofreadStore.getState();
						const existingForCurrent = state.results[chapter.id]?.[originalIndex];
						const newErrorsForCurrent = groupedErrors.get(originalIndex) ?? [];
						const existingIdsForCurrent = new Set((existingForCurrent?.errors ?? []).map(e => e.id));
						const mergedCurrentErrors = [
							...(existingForCurrent?.errors ?? []),
							...newErrorsForCurrent.filter(e => !existingIdsForCurrent.has(e.id))
						];
						state.updateParagraphResult(chapter.id, originalIndex, {
							errors: mergedCurrentErrors,
							status: "done",
						});

						// 将跨段落 errors 合并到对应段落（保留已有错误）
						for (const [paraIdx, paraErrors] of groupedErrors) {
							if (paraIdx === originalIndex) continue;
							const existingResult = state.results[chapter.id]?.[paraIdx];
							const existingIds = new Set((existingResult?.errors ?? []).map(e => e.id));
							const mergedErrors = [
								...(existingResult?.errors ?? []),
								...paraErrors.filter(e => !existingIds.has(e.id))
							];
							state.updateParagraphResult(chapter.id, paraIdx, {
								errors: mergedErrors,
							});
						}

						// 保存校对进度
						if (currentNovelId) {
							saveProofreadProgress(currentNovelId, chapter.id, filteredIdx, false);
						}
					} catch (err: unknown) {
						if (err instanceof DOMException && err.name === "AbortError")
							return;
						const msg = err instanceof Error ? err.message : String(err);
						// 获取当前段落文本
						const currentItem = filteredItems[filteredIdx] || "";
						// 将网络错误添加到错误清单
						const networkError = makeNetworkError(chapter.id, originalIndex, msg, currentItem);
						updateParagraphResult(chapter.id, originalIndex, {
							errors: [networkError],
							status: "error",
							errorMessage: msg,
						});
					}
				};

				// 处理双段落配对请求
				const processParagraphPair = async (idx1: number, idx2: number) => {
					if (controller.signal.aborted) return;

					const origIdx1 = indexMap[idx1];
					const origIdx2 = indexMap[idx2];

					const item1 = filteredItems[idx1];
					const item2 = filteredItems[idx2];

					// 检查两个段落的长度是否适合合并请求
					const combinedLength = item1.length + item2.length;
					if (combinedLength > 8000) {
						// 如果太长，分别处理
						logger.proofread(`双段落总长度=${combinedLength} 超过8000，改为分别处理`);
						await processParagraphItem(idx1);
						if (!controller.signal.aborted) {
							await processParagraphItem(idx2);
						}
						return;
					}

					logger.proofread(`双段落检测: idx1=${idx1}(orig=${origIdx1}, len=${item1.length}), idx2=${idx2}(orig=${origIdx2}, len=${item2.length})`);

					updateParagraphResult(chapter.id, origIdx1, { status: "checking" });
					updateParagraphResult(chapter.id, origIdx2, { status: "checking" });
					// 同步当前检测行（以配对的第一行为代表）
					onLineChecking?.(idx1);

					try {
						// 如果任一段落太短，改为分别处理
						if (item1.trim().length < 5 || item2.trim().length < 5) {
							logger.proofread(`双段落中有段落过短，改为分别处理`);
							if (item1.trim().length < 5) {
								updateParagraphResult(chapter.id, origIdx1, { status: "done" });
							} else {
								await processParagraphItem(idx1);
							}
							if (!controller.signal.aborted) {
								if (item2.trim().length < 5) {
									updateParagraphResult(chapter.id, origIdx2, { status: "done" });
								} else {
									await processParagraphItem(idx2);
								}
							}
							return;
						}

						// 合并两个段落的忽略词
						const combinedIgnoredWords = ignoredWords.filter(
							word => word && (item1.includes(word) || item2.includes(word))
						);

						const systemPrompt = buildProofreadSystemPrompt(
							promptConfig.dualProofread || PROOFREAD_SYSTEM_PROMPT_DUAL,
							combinedIgnoredWords,
						);

						const userPrompt = buildDualParagraphUserPrompt(item1, item2, combinedIgnoredWords);

						logger.proofread(`发送双段落请求: 总长度=${combinedLength}`);

						const messages = [
							{ role: "system" as const, content: systemPrompt },
							{ role: "user" as const, content: userPrompt },
						];

						const reply = await sendChatCompletion(messages, aiConfig, controller.signal);
						logger.proofread(`双段落AI原始返回: ${reply.slice(0, 500)}${reply.length > 500 ? '...' : ''}`);
						const parsed = extractJSON(reply);
						logger.proofread(`双段落解析结果: ${Array.isArray(parsed) ? `数组[${parsed.length}]` : `对象 keys=${parsed ? Object.keys(parsed).join(',') : 'null'}`}`);

						// 解析双段落响应
					let result: ReturnType<typeof parseDualParagraphResponse>;
					if (parsed && !Array.isArray(parsed)) {
						result = parseDualParagraphResponse(
							parsed as Record<string, unknown>,
							chapter.id,
							origIdx1,
							origIdx2,
							item1,
							item2,
							combinedIgnoredWords,
						);
						} else {
							// AI 返回数组格式（单段落格式），尝试按文本匹配分配到对应段落
							logger.proofread(`AI 返回数组格式，尝试按文本匹配分配到两个段落`);
							const errorArray = Array.isArray(parsed) ? parsed : [];
							// 构建双段落的 allParagraphs 用于 fallback
							const dualParagraphs = [item1, item2];
							const rawErrors: ProofreadError[] = parseAIProofreadResponse(
								errorArray,
								chapter.id,
								0,
								item1,
								combinedIgnoredWords,
								dualParagraphs,
							);
							// 根据 originalText 实际在哪个段落中来重新分配，并修正 id 中的全局索引
							const errors1: ProofreadError[] = [];
							const errors2: ProofreadError[] = [];
							for (const err of rawErrors) {
								const inPara1 = locateTextInParagraph(item1, err.originalText);
								const inPara2 = locateTextInParagraph(item2, err.originalText);
								if (inPara1 && !inPara2) {
									errors1.push({ ...err, id: `err-${chapter.id}-${origIdx1}-d1-${errors1.length}` });
								} else if (inPara2 && !inPara1) {
									errors2.push({ ...err, id: `err-${chapter.id}-${origIdx2}-d2-${errors2.length}` });
								} else {
									errors1.push({ ...err, id: `err-${chapter.id}-${origIdx1}-d1-${errors1.length}` });
								}
							}
							result = { errors1, errors2, mergeSuggestion: null };
						}

						// 更新两个段落的结果
						const result1: ParagraphResult = {
							paragraphIndex: origIdx1,
							originalText: item1,
							errors: result.errors1,
							status: "done",
						};

						// 如果有合并建议，存储在第一个段落的 mergeSuggestion 中
						if (result.mergeSuggestion) {
							result1.mergeSuggestion = result.mergeSuggestion;
						}

						updateParagraphResult(chapter.id, origIdx1, result1);
						updateParagraphResult(chapter.id, origIdx2, {
							paragraphIndex: origIdx2,
							originalText: item2,
							errors: result.errors2,
							status: "done",
						});

						// 保存校对进度
						if (currentNovelId) {
							saveProofreadProgress(currentNovelId, chapter.id, idx2, false);
						}
					} catch (err: unknown) {
						if (err instanceof DOMException && err.name === "AbortError")
							return;
						const msg = err instanceof Error ? err.message : String(err);
						logger.proofread(`双段落检测失败: ${msg}, 改为分别处理`);

						// 失败时回退为分别处理
						updateParagraphResult(chapter.id, origIdx1, { status: "pending", errors: [] });
						updateParagraphResult(chapter.id, origIdx2, { status: "pending", errors: [] });
						await processParagraphItem(idx1);
						if (!controller.signal.aborted) {
							await processParagraphItem(idx2);
						}
					}
				};

				// 使用 Promise 池实现多线程并发处理（双段落配对）
				const semaphore = new Semaphore(maxConcurrent);
				const paragraphTasks: Promise<void>[] = [];

				// 从 startFrom 开始处理，确保不会跳过或重复处理段落
				let i = startFrom;
				// 如果 startFrom 是奇数，先单独处理这个段落，然后从下一个偶数索引开始配对
				if (startFrom % 2 !== 0 && i < filteredItems.length) {
					if (controller.signal.aborted) {
						// aborted, skip
					} else {
						await semaphore.acquire();
						const promise = processParagraphItem(i).finally(() => {
							semaphore.release();
						});
						paragraphTasks.push(promise);
					}
					i++;
				}
				for (; i < filteredItems.length; i += 2) {
					if (controller.signal.aborted) break;

					const hasPartner = i + 1 < filteredItems.length;
					if (hasPartner) {
						// 双段落配对
						await semaphore.acquire();
						const promise = processParagraphPair(i, i + 1).finally(() => {
							semaphore.release();
						});
						paragraphTasks.push(promise);
					} else {
						// 最后一个段落没有配对，单独处理
						await semaphore.acquire();
						const promise = processParagraphItem(i).finally(() => {
							semaphore.release();
						});
						paragraphTasks.push(promise);
					}
				}
				await Promise.all(paragraphTasks);
				// 全部处理完成，清除单行检测状态
				onLineChecking?.(null);

				// 章节校对完成，标记为完成
				if (currentNovelId) {
					saveProofreadProgress(currentNovelId, chapter.id, filteredItems.length, true);
				}
			}

			stopProofreadService().catch(() => {});
		},
		[
			currentNovelId,
			aiConfig,
			setResults,
			updateParagraphResult,
			getIgnoredWords,
			getCharacters,
			saveProofreadProgress,
			promptConfig.proofread,
			promptConfig.proofreadChapter,
			proofreadConfig,
		],
	);

	const cancelCheck = useCallback(() => {
		logger.proofread(`cancelCheck 被调用，立即中断所有请求`);
		sharedAbortRef?.abort();
		sharedAbortRef = null;
		abortRef.current = null;
		
		// 立即更新所有正在检查的段落状态为 pending
		const { chapters: latestChapters, currentChapterIndex: latestChapterIndex } = useNovelStore.getState();
		const chapter = latestChapters[latestChapterIndex];
		if (chapter) {
			const paragraphs = splitParagraphs(chapter.content);
			paragraphs.forEach((para, index) => {
				if (para.trim() !== "") {
					updateParagraphResult(chapter.id, index, { status: "pending" });
				}
			});
			logger.proofread(`已将所有段落状态重置为 pending`);
		}

		stopProofreadService().catch(() => {});
	}, [updateParagraphResult]);

	const checkSingleLine = useCallback(
		async (
			originalIndex: number,
			setSingleCheckingLine: (v: number | null) => void,
			onComplete?: () => void,
		) => {
			// 从 store 获取最新章节，避免闭包过期（如合并段落后 chapters 已更新但 useCallback 未刷新）
			const latestState = useNovelStore.getState();
			const chapter = latestState.chapters[latestState.currentChapterIndex];
			if (!chapter) {
				onComplete?.();
				return;
			}

			// 获取所有段落（包含空段落）
			const allParagraphs = splitParagraphs(chapter.content);

			// 验证原始索引是否有效
			if (originalIndex < 0 || originalIndex >= allParagraphs.length) {
				setSingleCheckingLine(null);
				onComplete?.();
				return;
			}

			const lineText = allParagraphs[originalIndex];

			// 如果是空段落，直接返回
			if (lineText.trim() === "") {
				setSingleCheckingLine(null);
				onComplete?.();
				return;
			}

			// 获取当前小说的忽略单词列表
			const ignoredWords = getIgnoredWords(currentNovelId ?? "");

			// 如果该行还没有结果或结果数组长度不足，先初始化
			const existing = useProofreadStore.getState().results[chapter.id];
			if (!existing || existing.length === 0 || existing.length < allParagraphs.length) {
				// 创建与原始段落数相同长度的数组（保持索引对齐）
				const initial: ParagraphResult[] = allParagraphs.map((p, i) => {
					// 如果有现有结果且索引有效，保留现有数据
					if (existing && i < existing.length) {
						return {
							...existing[i],
							paragraphIndex: i,
							originalText: p,
						};
					}
					return {
						paragraphIndex: i,
						originalText: p,
						errors: [],
						status: p.trim() === "" ? "done" : "pending",
					};
				});
				setResults(chapter.id, initial);
			}

			// 更新该行的状态为检测中（使用原始索引）
			updateParagraphResult(chapter.id, originalIndex, {
				status: "checking",
				errors: [],
			});

			try {
				// 只传输当前段落实际包含的 ignoredWords，减少 token 消耗
				const relevantIgnoredWords = ignoredWords.filter(word => word && lineText.includes(word));
				logger.proofread(`段落包含的 ignoredWords: ${relevantIgnoredWords.length}/${ignoredWords.length} - ${relevantIgnoredWords.join('、')}`);
				
				const systemPrompt = buildProofreadSystemPrompt(
					promptConfig.proofread || PROOFREAD_SYSTEM_PROMPT,
					relevantIgnoredWords,
				);
				const messages = [
					{ role: "system" as const, content: systemPrompt },
					{
						role: "user" as const,
						content: buildProofreadUserPrompt(lineText, relevantIgnoredWords),
					},
				];

				// 传入共享 signal，使其可被切章/取消/卸载中断
				const reply = await sendChatCompletion(messages, aiConfig, sharedAbortRef?.signal);
				const raw = normalizeErrors(extractJSON(reply));

				const errors = parseAIProofreadResponse(raw, chapter.id, originalIndex, lineText, ignoredWords, allParagraphs);

				// 将 errors 按实际段落索引分组，分配到正确的段落
				const groupedErrors = groupErrorsByParagraph(errors, originalIndex);

				// 更新当前段落（合并已有错误）
				const state = useProofreadStore.getState();
				const existingForCurrent = state.results[chapter.id]?.[originalIndex];
				const newErrorsForCurrent = groupedErrors.get(originalIndex) ?? [];
				const existingIdsForCurrent = new Set((existingForCurrent?.errors ?? []).map(e => e.id));
				const mergedCurrentErrors = [
					...(existingForCurrent?.errors ?? []),
					...newErrorsForCurrent.filter(e => !existingIdsForCurrent.has(e.id))
				];
				state.updateParagraphResult(chapter.id, originalIndex, {
					errors: mergedCurrentErrors,
					status: "done",
				});

				// 将跨段落 errors 合并到对应段落
				for (const [paraIdx, paraErrors] of groupedErrors) {
					if (paraIdx === originalIndex) continue;
					const existingResult = state.results[chapter.id]?.[paraIdx];
					const existingIds = new Set((existingResult?.errors ?? []).map(e => e.id));
					const mergedErrors = [
						...(existingResult?.errors ?? []),
						...paraErrors.filter(e => !existingIds.has(e.id))
					];
					state.updateParagraphResult(chapter.id, paraIdx, {
						errors: mergedErrors,
					});
				}
		} catch (err: unknown) {
			// 取消时不写错误状态
			if (err instanceof DOMException && err.name === "AbortError") {
				updateParagraphResult(chapter.id, originalIndex, { status: "pending" });
			} else {
				const msg = err instanceof Error ? err.message : String(err);
				updateParagraphResult(chapter.id, originalIndex, {
					status: "error",
					errorMessage: msg,
				});
			}
		} finally {
			setSingleCheckingLine(null);
			onComplete?.();
		}
		},
		[
			currentNovelId,
			aiConfig,
			setResults,
			updateParagraphResult,
			getIgnoredWords,
			promptConfig.proofread,
		],
	);


	return { checkChapter, cancelCheck, checkSingleLine };
}
