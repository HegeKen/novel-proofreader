// ============================================================
// AI 校对检测 Hook
// ============================================================
import { useCallback, useRef } from "react";
import { useNovelStore } from "../stores/novelStore";
import { useAIConfigStore } from "../stores/aiConfigStore";
import { useCharacterStore } from "../stores/characterStore";
import { useProofreadMetaStore } from "../stores/proofreadMetaStore";
import { useProofreadStore } from "../stores/proofreadStore";
import { useConfigStore } from "../stores/configStore";
import { splitParagraphs } from "../utils/chapterSplit";
import {
	sendChatCompletion,
	PROOFREAD_SYSTEM_PROMPT,
	PROOFREAD_SYSTEM_PROMPT_CHAPTER,
	PROOFREAD_SYSTEM_PROMPT_DUAL,
	buildProofreadUserPrompt,
	buildProofreadSystemPrompt,
	buildDualParagraphUserPrompt,
	extractJSON,
} from "../utils/aiClient";
import { logger } from "../utils/logger";
import { startProofreadService, stopProofreadService } from "../utils/androidService";
import { Semaphore } from "../utils/concurrent";
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

/** 在段落文本中定位 AI 返回的错误位置 */
function locateTextInParagraph(
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
	const normalizedPara = normalizeWhitespace(para);
	const normalizedMatch = normalizeWhitespace(matchText);
	if (normalizedPara.includes(normalizedMatch)) {
		let charCount = 0;
		let realStart = -1;
		for (let j = 0; j < para.length && charCount <= normalizedPara.indexOf(normalizedMatch); j++) {
			if (!/\s/.test(para[j])) {
				if (charCount === normalizedPara.indexOf(normalizedMatch)) realStart = j;
				charCount++;
			}
		}
		if (realStart >= 0) {
			let realEnd = realStart;
			let remaining = normalizedMatch.length;
			while (realEnd < para.length && remaining > 0) {
				if (!/\s/.test(para[realEnd])) remaining--;
				realEnd++;
			}
			return { start: realStart, end: realEnd };
		}
	}

	// 4. 模糊匹配：若 AI 补充的上下文与原文略有出入，渐进缩短 find 再试
	if (matchText.length > 4) {
		let shortened = matchText;
		while (shortened.length >= 4) {
			shortened = shortened.slice(1, -1);
			const idx = para.indexOf(shortened);
			if (idx >= 0) return { start: idx, end: idx + shortened.length };
			
			const normalizedShortened = normalizeWhitespace(shortened);
			if (normalizedPara.includes(normalizedShortened)) {
				let charCount = 0;
				let realStart = -1;
				for (let j = 0; j < para.length && charCount <= normalizedPara.indexOf(normalizedShortened); j++) {
					if (!/\s/.test(para[j])) {
						if (charCount === normalizedPara.indexOf(normalizedShortened)) realStart = j;
						charCount++;
					}
				}
				if (realStart >= 0) {
					let realEnd = realStart;
					let remaining = normalizedShortened.length;
					while (realEnd < para.length && remaining > 0) {
						if (!/\s/.test(para[realEnd])) remaining--;
						realEnd++;
					}
					return { start: realStart, end: realEnd };
				}
			}
		}
	}

	logger.proofread(`[locateTextInParagraph] 定位失败: matchText="${matchText.slice(0, 20)}${matchText.length > 20 ? '...' : ''}", para="${para.slice(0, 30)}${para.length > 30 ? '...' : ''}", column=${column}`);
	return null;
}

/** 解析 AI 校对响应，返回标准化的 ProofreadError 数组 */
function parseAIProofreadResponse(
	raw: unknown[],
	chapterId: number,
	paragraphIndex: number,
	paragraph: string,
	ignoredWords: string[],
): ProofreadError[] {
	const errors: ProofreadError[] = [];
	let filteredCount = 0;
	
	for (const item of raw) {
		if (typeof item !== "object" || item === null) continue;
		const o = item as Record<string, unknown>;

		const find = String(o.find ?? "");
		const replace = String(o.replace ?? "");
		const orig = String(o.original ?? o.original_text ?? "");
		const corr = String(o.corrected ?? o.corrected_text ?? "");
		const errType = String(o.type ?? o.error_type ?? "");
		const suggest = String(o.reason ?? o.suggestion ?? "");
		const aiColumn = o.column !== undefined ? Number(o.column) : undefined;

		// 过滤条件1：无错误标记
		if (['无错误', 'none', 'no_error', 'no-error', 'noerror', 'nil', 'null', ''].includes(errType.toLowerCase())) {
			logger.proofread(`[过滤] 错误类型为无错误: type="${errType}"`);
			filteredCount++;
			continue;
		}

		const matchText = find || orig;
		const correctText = replace || corr;
		
		// 过滤条件2：matchText 为空
		if (!matchText) {
			logger.proofread(`[过滤] matchText 为空`);
			filteredCount++;
			continue;
		}

		// 过滤条件3：原文本和修改内容完全相同（放宽条件：仅当完全一致时过滤）
		if (matchText === correctText) {
			logger.proofread(`[过滤] 原文本和修改内容完全相同: "${matchText}"`);
			filteredCount++;
			continue;
		}
		
		// 过滤条件4：去除空格后相同（保留大小写差异）
		if (matchText.replace(/\s/g, '') === correctText.replace(/\s/g, '') && matchText === correctText) {
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

		const located = locateTextInParagraph(paragraph, matchText, aiColumn);
		
		// 过滤条件6：无法定位
		if (!located) {
			logger.proofread(`[过滤] 无法定位文本: matchText="${matchText.slice(0, 30)}${matchText.length > 30 ? '...' : ''}", paragraph="${paragraph.slice(0, 50)}${paragraph.length > 50 ? '...' : ''}"`);
			filteredCount++;
			continue;
		}

		// 成功添加错误
		logger.proofread(`[成功] 添加错误: matchText="${matchText.slice(0, 30)}", correctText="${correctText.slice(0, 30)}", type="${errType}"`);
		errors.push({
			id: `err-${chapterId}-${paragraphIndex}-${errors.length}`,
			startIndex: located.start,
			endIndex: located.end,
			errorType: (errType as ProofreadError["errorType"]) || "typo",
			suggestion: suggest,
			originalText: paragraph.slice(located.start, located.end),
			correctedText: correctText,
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

	// 解析错误列表
	const errorList = raw.errors;
	if (Array.isArray(errorList)) {
		for (const item of errorList) {
			if (typeof item !== "object" || item === null) continue;
			const o = item as Record<string, unknown>;

			const line = Number(o.line) || 1;
			const find = String(o.find ?? "");
			const replace = String(o.replace ?? "");
			const errType = String(o.type ?? "");
			const suggest = String(o.reason ?? "");

			if (!find || find === replace) continue;

			const paragraph = line === 2 ? paragraph2 : paragraph1;
			const paragraphIndex = line === 2 ? paragraph2Index : paragraph1Index;

			// 过滤忽略词
			const isIgnored = ignoredWords.some(word => word && (find.includes(word) || word.includes(find)));
			if (isIgnored) continue;

			const located = locateTextInParagraph(paragraph, find);
			if (!located) continue;

			const error: ProofreadError = {
				id: `err-${chapterId}-${paragraphIndex}-${line === 2 ? 'd2' : 'd1'}-${errors1.length + errors2.length}`,
				startIndex: located.start,
				endIndex: located.end,
				errorType: (errType as ProofreadError["errorType"]) || "typo",
				suggestion: suggest,
				originalText: paragraph.slice(located.start, located.end),
				correctedText: replace,
				applied: false,
				skipped: false,
			};

			if (line === 2) {
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
				mergedText: mergeRaw.merged_text ? String(mergeRaw.merged_text) : undefined,
				applied: false,
			};
		}
	}

	logger.proofread(`[parseDualParagraphResponse] 解析完成: 第1段错误=${errors1.length}, 第2段错误=${errors2.length}, 合并建议=${mergeSuggestion ? '是' : '否'}`);

	return { errors1, errors2, mergeSuggestion };
}

export function useAICheck() {
	const aiConfig = useAIConfigStore((s) => s.aiConfig);
	const chapters = useNovelStore((s) => s.chapters);
	const currentChapterIndex = useNovelStore((s) => s.currentChapterIndex);
	const currentNovelId = useNovelStore((s) => s.currentNovelId);
	const getIgnoredWords = useProofreadMetaStore((s) => s.getIgnoredWords);
	const getCharacters = useCharacterStore((s) => s.getCharacters);
	const promptConfig = useConfigStore((s) => s.promptConfig);
	const proofreadConfig = useConfigStore((s) => s.proofreadConfig);
	const saveProofreadProgress = useProofreadMetaStore((s) => s.saveProofreadProgress);
	const setResults = useProofreadStore((s) => s.setResults);
	const updateParagraphResult = useProofreadStore(
		(s) => s.updateParagraphResult,
	);
	const abortRef = useRef<AbortController | null>(null);

	const checkChapter = useCallback(
		async (granularity: CheckGranularity, startFrom: number = 0) => {
			const chapter = chapters[currentChapterIndex];
			if (!chapter) return;

			startProofreadService().catch(() => {});

			// 获取并发配置
			const maxConcurrent = getMaxConcurrentBatches(
				proofreadConfig.enableParallelProcessing,
				proofreadConfig.maxConcurrentBatches
			);

			logger.proofread(`checkChapter 开始: chapterIndex=${currentChapterIndex + 1}, granularity=${granularity}, startFrom=${startFrom} (第 ${startFrom + 1} 段)`);
			logger.proofread(`开始校对第 ${currentChapterIndex + 1} 章, 粒度: ${granularity}, 从第 ${startFrom + 1} 段开始`);
			logger.proofread(`并发模式: ${proofreadConfig.enableParallelProcessing ? '启用' : '禁用'}, 最大并发数: ${maxConcurrent}`);

			// 取消之前的请求
			abortRef.current?.abort();
			const controller = new AbortController();
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
						const raw = extractJSON(reply);

						// 收集该批次所有错误，按原始行号分组
						const errorsByLine: ProofreadError[][] = paragraphs.map(() => []);
						let filteredCount = 0;
						
						// 只处理该批次内的错误
						for (const item of raw) {
							if (typeof item !== "object" || item === null) continue;
							const obj = item as Record<string, unknown>;

							// 提取行号（支持 string 和 number 类型）
							let lineNumber = -1;
							if (obj.lineNumber !== undefined) {
								lineNumber = typeof obj.lineNumber === 'string' ? parseInt(obj.lineNumber, 10) : Number(obj.lineNumber);
							} else if (obj.line !== undefined) {
								lineNumber = typeof obj.line === 'string' ? parseInt(obj.line, 10) : Number(obj.line);
							}

							const find = String(obj.find ?? "");
							const replace = String(obj.replace ?? "");
							const orig = String(obj.original ?? obj.original_text ?? "");
							const corr = String(obj.corrected ?? obj.corrected_text ?? "");
							const errType = String(obj.type ?? obj.error_type ?? "");
							const suggest = String(obj.reason ?? obj.suggestion ?? "");
							const aiColumn = obj.column !== undefined ? Number(obj.column) : undefined;

							// 过滤条件1：无错误标记
							if (['无错误', 'none', 'no_error', 'no-error', 'noerror', 'nil', 'null', ''].includes(errType.toLowerCase())) {
								logger.proofread(`[章节模式-过滤] 错误类型为无错误: type="${errType}"`);
								filteredCount++;
								continue;
							}

							const matchText = find || orig;
							const correctText = replace || corr;
							
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
								id: `err-${chapter.id}-${lineNumber}-${errorsByLine[lineNumber].length}`,
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
							const networkError: ProofreadError = {
								id: `err-${chapter.id}-${lineIdx}-network-${Date.now()}`,
								startIndex: 0,
								endIndex: 0,
								errorType: "network",
								suggestion: msg.includes("Failed to fetch") ? "网络请求失败，请检查网络连接或API配置" : msg,
								originalText: paragraphs[lineIdx].slice(0, 50),
								correctedText: "",
								applied: false,
								skipped: false,
							};
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
				const indexMap: number[] = [];
				allLines.forEach((line, i) => {
					if (line.trim() !== "") {
						indexMap.push(i);
					}
				});
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
						const raw = extractJSON(reply);

						const errors = parseAIProofreadResponse(raw, chapter.id, originalIndex, item, ignoredWords);

						updateParagraphResult(chapter.id, originalIndex, {
							errors,
							status: "done",
						});

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
						const networkError: ProofreadError = {
							id: `err-${chapter.id}-${originalIndex}-network-${Date.now()}`,
							startIndex: 0,
							endIndex: 0,
							errorType: "network",
							suggestion: msg.includes("Failed to fetch") ? "网络请求失败，请检查网络连接或API配置" : msg,
							originalText: currentItem.slice(0, 50),
							correctedText: "",
							applied: false,
							skipped: false,
						};
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
							PROOFREAD_SYSTEM_PROMPT_DUAL,
							combinedIgnoredWords,
						);

						const userPrompt = buildDualParagraphUserPrompt(item1, item2, combinedIgnoredWords);

						logger.proofread(`发送双段落请求: 总长度=${combinedLength}`);

						const messages = [
							{ role: "system" as const, content: systemPrompt },
							{ role: "user" as const, content: userPrompt },
						];

						const reply = await sendChatCompletion(messages, aiConfig, controller.signal);
						const parsed = extractJSON(reply);

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
								ignoredWords,
							);
						} else {
							// 如果 AI 返回的是数组格式，按单段落解析处理
							logger.proofread(`AI 返回数组格式，分别解析两个段落`);
							const errors1 = parseAIProofreadResponse(
								Array.isArray(parsed) ? parsed : [],
								chapter.id,
								origIdx1,
								item1,
								ignoredWords,
							);
							const errors2 = parseAIProofreadResponse(
								[], // 没有第二段的错误
								chapter.id,
								origIdx2,
								item2,
								ignoredWords,
							);
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

				// 章节校对完成，标记为完成
				if (currentNovelId) {
					saveProofreadProgress(currentNovelId, chapter.id, filteredItems.length, true);
				}
			}

			stopProofreadService().catch(() => {});
		},
		[
			chapters,
			currentChapterIndex,
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
		abortRef.current?.abort();
		
		// 立即更新所有正在检查的段落状态为 pending
		const chapter = chapters[currentChapterIndex];
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
	}, [chapters, currentChapterIndex, updateParagraphResult]);

	const checkSingleLine = useCallback(
		async (
			originalIndex: number,
			setSingleCheckingLine: (v: number | null) => void,
			onComplete?: () => void,
		) => {
			const chapter = chapters[currentChapterIndex];
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

				const reply = await sendChatCompletion(messages, aiConfig);
				const raw = extractJSON(reply);

				const errors = parseAIProofreadResponse(raw, chapter.id, originalIndex, lineText, ignoredWords);

				updateParagraphResult(chapter.id, originalIndex, {
				errors,
				status: "done",
			});
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			updateParagraphResult(chapter.id, originalIndex, {
				status: "error",
				errorMessage: msg,
			});
		} finally {
			setSingleCheckingLine(null);
			onComplete?.();
		}
		},
		[
			chapters,
			currentChapterIndex,
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
