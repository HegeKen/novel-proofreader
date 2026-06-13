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
	buildProofreadUserPrompt,
	buildProofreadSystemPrompt,
	extractJSON,
} from "../utils/aiClient";
import { logger } from "../utils/logger";
import { startProofreadService, stopProofreadService } from "../utils/androidService";
import type {
	ParagraphResult,
	ProofreadError,
	CheckGranularity,
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
	// 1. column 定位（1-based，Prompt 要求 AI 返回此字段）
	if (column !== undefined && column > 0 && column <= para.length) {
		const endIdx = column - 1 + matchText.length;
		if (endIdx <= para.length && para.slice(column - 1, endIdx) === matchText) {
			return { start: column - 1, end: endIdx };
		}
	}

	// 2. 精确匹配
	const exactIdx = para.indexOf(matchText);
	if (exactIdx >= 0) return { start: exactIdx, end: exactIdx + matchText.length };

	// 3. 模糊匹配：若 AI 补充的上下文与原文略有出入，渐进缩短 find 再试
	if (matchText.length > 4) {
		let shortened = matchText;
		while (shortened.length >= 4) {
			shortened = shortened.slice(1, -1);
			const idx = para.indexOf(shortened);
			if (idx >= 0) return { start: idx, end: idx + shortened.length };
		}
	}

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

		const matchText = find || orig;
		const correctText = replace || corr;
		if (!matchText) continue;

		const needsReplacement = errType === "typo" || errType === "grammar" || errType === "format";
		if (needsReplacement && (matchText === correctText || matchText.replace(/\s/g, '') === correctText.replace(/\s/g, ''))) continue;

		const isIgnored = ignoredWords.some(word => word && (matchText.includes(word) || word.includes(matchText)));
		if (isIgnored) continue;

		const located = locateTextInParagraph(paragraph, matchText, aiColumn);
		if (!located) continue;

		errors.push({
			id: `err-${chapterId}-${paragraphIndex}-${errors.length}`,
			startIndex: located.start,
			endIndex: located.end,
			errorType: (errType as ProofreadError["errorType"]) || "typo",
			suggestion: suggest,
			originalText: matchText,
			correctedText: correctText,
			applied: false,
			skipped: false,
		});
	}
	return errors;
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
						// 只处理该批次内的错误
						for (const item of raw) {
							if (typeof item !== "object" || item === null) continue;
							const obj = item as Record<string, unknown>;

							let lineNumber = obj.line !== undefined ? Number(obj.line) :
								(obj.lineNumber !== undefined ? Number(obj.lineNumber) : -1);

							const find = String(obj.find ?? "");
							const replace = String(obj.replace ?? "");
							const orig = String(obj.original ?? obj.original_text ?? "");
							const corr = String(obj.corrected ?? obj.corrected_text ?? "");
							const errType = String(obj.type ?? obj.error_type ?? "");
							const suggest = String(obj.reason ?? obj.suggestion ?? "");
							const aiColumn = obj.column !== undefined ? Number(obj.column) : undefined;

							const matchText = find || orig;
							const correctText = replace || corr;
							if (!matchText) continue;

							const needsReplacement = errType === "typo" || errType === "grammar" || errType === "format";
							if (needsReplacement && (matchText === correctText || matchText.replace(/\s/g, '') === correctText.replace(/\s/g, ''))) continue;

							// 检查行号是否在该批次范围内
							if (lineNumber < batch.start || lineNumber >= batch.end) {
								const foundLine = paragraphs.findIndex((p, idx) =>
									idx >= batch.start && idx < batch.end && locateTextInParagraph(p, matchText, aiColumn) !== null
								);
								if (foundLine < 0) continue;
								lineNumber = foundLine;
							}

							const targetPara = paragraphs[lineNumber];
							const located = locateTextInParagraph(targetPara, matchText, aiColumn);
							if (!located) continue;

							errorsByLine[lineNumber].push({
								id: `err-${chapter.id}-${lineNumber}-${errorsByLine[lineNumber].length}`,
								startIndex: located.start,
								endIndex: located.end,
								errorType: (errType as ProofreadError["errorType"]) || "typo",
								suggestion: suggest,
								originalText: matchText,
								correctedText: correctText,
								applied: false,
								skipped: false,
							});
						}

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
				let activeCount = 0;
				const results: Promise<void>[] = [];
				for (const batch of batches) {
					if (controller.signal.aborted) break;
					// 等待直到有空闲槽位
					while (activeCount >= maxConcurrent) {
						await new Promise(resolve => setTimeout(resolve, 100));
					}
					activeCount++;
					const promise = processBatch(batch).finally(() => {
						activeCount--;
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

				// 多线程并发处理段落
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

						// 添加 5 秒超时
						const timeoutPromise = new Promise<never>((_, reject) => {
							setTimeout(() => reject(new Error('PROOFREAD_TIMEOUT')), 10000);
						});

						let reply: string;
						try {
							reply = await Promise.race([
								sendChatCompletion(messages, aiConfig, controller.signal),
								timeoutPromise
							]);
						} catch (timeoutErr) {
							if ((timeoutErr as Error).message === 'PROOFREAD_TIMEOUT') {
								const currentItem = filteredItems[filteredIdx] || "";
								const timeoutError: ProofreadError = {
									id: `err-${chapter.id}-${originalIndex}-timeout-${Date.now()}`,
									startIndex: 0,
									endIndex: 0,
									errorType: "timeout",
									suggestion: "请求超时（10秒），已跳过此段落",
									originalText: currentItem.slice(0, 50),
									correctedText: "",
									applied: false,
									skipped: false,
								};
								updateParagraphResult(chapter.id, originalIndex, {
									errors: [timeoutError],
									status: "error",
									errorMessage: "请求超时（10秒）",
								});
								return;
							}
							throw timeoutErr;
						}
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

				// 使用 Promise 池实现多线程并发处理
				let activeCount = 0;
				const paragraphTasks: Promise<void>[] = [];
				for (let i = startFrom; i < filteredItems.length; i++) {
					if (controller.signal.aborted) break;
					while (activeCount >= maxConcurrent) {
						await new Promise(resolve => setTimeout(resolve, 100));
					}
					activeCount++;
					const promise = processParagraphItem(i).finally(() => {
						activeCount--;
					});
					paragraphTasks.push(promise);
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
		) => {
			const chapter = chapters[currentChapterIndex];
			if (!chapter) return;

			// 获取所有段落（包含空段落）
			const allParagraphs = splitParagraphs(chapter.content);

			// 验证原始索引是否有效
			if (originalIndex < 0 || originalIndex >= allParagraphs.length) {
				setSingleCheckingLine(null);
				return;
			}

			const lineText = allParagraphs[originalIndex];

			// 如果是空段落，直接返回
			if (lineText.trim() === "") {
				setSingleCheckingLine(null);
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
