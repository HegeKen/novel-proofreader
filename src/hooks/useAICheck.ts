// ============================================================
// AI 校对检测 Hook
// ============================================================
import { useCallback, useRef } from "react";
import { useAppStore } from "../stores/appStore";
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
import type {
	ParagraphResult,
	ProofreadError,
	CheckGranularity,
} from "../types";

const MAX_CONCURRENT_BATCHES = 5;

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

/** 当 AI 返回的 find 过长（>20 字）时，或 replace 与原文长度相近时，diff 找出实际差异部分并截取 */
function truncateFind(
	find: string,
	replace: string,
	originalPara?: string,
): { find: string; replace: string } | null {
	const MAX_LEN = 20;
	const CONTEXT = 5;
	const MIN_LEN = 6;

	// 1. 当 replace 与原文长度相近（>70%）时，diff 原文 vs replace 找出实际改动位置
	if (originalPara && originalPara.length > 0 && replace.length > 0) {
		const lengthRatio = Math.min(originalPara.length, replace.length) / Math.max(originalPara.length, replace.length);
		if (lengthRatio > 0.7) {
			const minLen = Math.min(originalPara.length, replace.length);
			let diffStart = 0;
			while (diffStart < minLen && originalPara[diffStart] === replace[diffStart]) diffStart++;
			let diffEndFromEnd = 0;
			while (
				diffEndFromEnd < minLen - diffStart &&
				originalPara[originalPara.length - 1 - diffEndFromEnd] === replace[replace.length - 1 - diffEndFromEnd]
			) diffEndFromEnd++;

			const diffLen = originalPara.length - diffStart - diffEndFromEnd;
			if (diffLen > 0 && diffLen < originalPara.length) {
				const ctxStart = Math.max(0, diffStart - CONTEXT);
				const ctxEnd = originalPara.length - diffEndFromEnd + CONTEXT;
				const newFind = originalPara.slice(ctxStart, ctxEnd);
				const newReplace = replace.slice(ctxStart, ctxEnd);
				if (newFind.length >= MIN_LEN && newFind !== newReplace) {
					find = newFind;
					replace = newReplace;
				}
			}
		}
	}

	// 2. find 和 replace 都在范围内，直接返回（任一超长则继续截取）
	if (find.length <= MAX_LEN && replace.length <= MAX_LEN) return { find, replace };

	// 3. find/replace 仍过长，做字符级 diff 截取
	// 先找出所有独立的 diff 段
	const diffs: { start: number; end: number }[] = [];
	const scanLen = Math.min(find.length, replace.length);
	let inDiff = false;
	let segStart = 0;
	for (let i = 0; i < scanLen; i++) {
		const isDiff = find[i] !== replace[i];
		if (isDiff && !inDiff) { segStart = i; inDiff = true; }
		else if (!isDiff && inDiff) { diffs.push({ start: segStart, end: i }); inDiff = false; }
	}
	if (inDiff) diffs.push({ start: segStart, end: scanLen });

	if (diffs.length === 0) return null;

	// 4. 若外沿范围仍过长，取最长或最具代表性的独立 diff 段
 	if (diffs.length > 1 || (find.slice(diffs[0].start, diffs[0].end).length > MAX_LEN)) {
 		// 优先选差异字符数最多的段
 		const best = diffs.reduce((a, b) => (b.end - b.start) > (a.end - a.start) ? b : a);
		const ctxStart = Math.max(0, best.start - CONTEXT);
		const ctxEnd = Math.min(find.length, best.end + CONTEXT);
		const segFind = find.slice(ctxStart, ctxEnd);
		const segReplace = replace.slice(ctxStart, ctxEnd);
		if (segFind.length >= MIN_LEN && segFind !== segReplace) return { find: segFind, replace: segReplace };
		// 如果最佳段仍超长，递归一次（用更小 CONTEXT）
		if (segFind.length > MAX_LEN) {
			const tightFind = find.slice(best.start, best.end);
			const tightReplace = replace.slice(best.start, best.end);
			if (tightFind.length >= MIN_LEN && tightFind !== tightReplace) return { find: tightFind, replace: tightReplace };
		}
	}

	// 5. 只有一个 diff 段且不长，补两侧上下文
	const diff = diffs[0];
	const ctxStart = Math.max(0, diff.start - CONTEXT);
	const ctxEnd = Math.min(find.length, diff.end + CONTEXT);
	const newFind = find.slice(ctxStart, ctxEnd);
	const newReplace = replace.slice(ctxStart, ctxEnd);
	if (newFind.length < MIN_LEN) return null;
	return { find: newFind, replace: newReplace };
}

export function useAICheck() {
	const aiConfig = useAppStore((s) => s.aiConfig);
	const chapters = useAppStore((s) => s.chapters);
	const currentChapterIndex = useAppStore((s) => s.currentChapterIndex);
	const currentNovelId = useAppStore((s) => s.currentNovelId);
	const getIgnoredWords = useAppStore((s) => s.getIgnoredWords);
	const getCharacters = useAppStore((s) => s.getCharacters);
	const promptConfig = useConfigStore((s) => s.promptConfig);
	const saveProofreadProgress = useAppStore((s) => s.saveProofreadProgress);
	const setResults = useProofreadStore((s) => s.setResults);
	const updateParagraphResult = useProofreadStore(
		(s) => s.updateParagraphResult,
	);
	const abortRef = useRef<AbortController | null>(null);

	const checkChapter = useCallback(
		async (granularity: CheckGranularity, startFrom: number = 0) => {
			const chapter = chapters[currentChapterIndex];
			if (!chapter) return;

			logger.proofread(`checkChapter 开始: chapterIndex=${currentChapterIndex + 1}, granularity=${granularity}, startFrom=${startFrom} (第 ${startFrom + 1} 段)`);
			logger.proofread(`开始校对第 ${currentChapterIndex + 1} 章, 粒度: ${granularity}, 从第 ${startFrom + 1} 段开始`);

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

							// 获取行号（核心字段）- 使用原始段落索引
							// 支持新格式的 line 字段和旧格式的 lineNumber 字段
							let lineNumber = obj.line !== undefined ? Number(obj.line) :
								(obj.lineNumber !== undefined ? Number(obj.lineNumber) : -1);

							// 支持新格式：find/replace
							const find = String(obj.find ?? "");
							const replace = String(obj.replace ?? "");

							// 兼容旧格式：original/corrected
							const orig = String(obj.original ?? obj.original_text ?? "");
							const corr = String(obj.corrected ?? obj.corrected_text ?? "");

							const errType = String(obj.type ?? obj.error_type ?? "");
							const suggest = String(obj.reason ?? obj.suggestion ?? "");
							const aiStart = obj.start !== undefined ? Number(obj.start) : -1;
							const aiEnd = obj.end !== undefined ? Number(obj.end) : -1;
							const aiColumn = obj.column !== undefined ? Number(obj.column) : undefined;

							// 优先使用新格式的 find/replace，其次使用旧格式的 original/corrected
							const matchText = find || orig;
							const correctText = replace || corr;

							logger.proofread(`解析错误: matchText="${matchText}", correctText="${correctText}", lineNumber=${lineNumber}, aiStart=${aiStart}, aiEnd=${aiEnd}, column=${aiColumn}`);

							if (!matchText) continue;

							// 校验：对于 typo/grammar/format 类型，matchText 和 correctText 必须不同
							// 但 punctuation 类型可能只是提示标点问题，不一定需要替换
							const needsReplacement = errType === "typo" || errType === "grammar" || errType === "format";
							if (needsReplacement && (matchText === correctText || matchText.replace(/\s/g, '') === correctText.replace(/\s/g, ''))) {
								continue;
							}

							// 检查行号是否在该批次范围内
							if (lineNumber < batch.start || lineNumber >= batch.end) {
								const foundLine = paragraphs.findIndex((p, idx) =>
									idx >= batch.start && idx < batch.end && locateTextInParagraph(p, matchText, aiColumn) !== null
								);
								logger.proofread(`行号检查: lineNumber=${lineNumber}, batch=${batch.start}-${batch.end}, foundLine=${foundLine}`);
								if (foundLine < 0) {
									logger.proofread(`[useAICheck] 批次 ${batch.start}-${batch.end} 中无法找到 "${matchText}"`);
									continue;
								}
								lineNumber = foundLine;
							}

							// 确定错误在段落内的位置
							const targetPara = paragraphs[lineNumber];

							const located = locateTextInParagraph(targetPara, matchText, aiColumn);
							if (!located) {
								logger.proofread(`[useAICheck] 段落 ${lineNumber} 中定位不到 "${matchText}"`);
								continue;
							}
							let startIdx = located.start;
							let endIdx = located.end;
							let finalMatchText = matchText;
							let finalCorrectText = correctText;

							const truncated = truncateFind(finalMatchText, finalCorrectText, targetPara);
							if (truncated) {
								finalMatchText = truncated.find;
								finalCorrectText = truncated.replace;
								const relocated = locateTextInParagraph(targetPara, finalMatchText, aiColumn);
								if (relocated) {
									startIdx = relocated.start;
									endIdx = relocated.end;
								}
							}

							errorsByLine[lineNumber].push({
								id: `err-${chapter.id}-${lineNumber}-${errorsByLine[lineNumber].length}`,
								startIndex: startIdx,
								endIndex: endIdx,
								errorType: (errType as ProofreadError["errorType"]) || "typo",
								suggestion: suggest,
								originalText: finalMatchText,
								correctedText: finalCorrectText,
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
					while (activeCount >= MAX_CONCURRENT_BATCHES) {
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

				// 逐项检测（从 startFrom 开始）
				for (let i = startFrom; i < filteredItems.length; i++) {
					if (controller.signal.aborted) break;

					// 使用原始段落索引（关键修复）
					const originalIndex = indexMap[i];

					logger.proofread(`检测第 ${i + 1} 项: filteredIndex=${i}, originalIndex=${originalIndex}, startFrom=${startFrom}`);

					updateParagraphResult(chapter.id, originalIndex, { status: "checking" });

					try {
						const item = filteredItems[i];
						// 如果太短，跳过
						if (item.trim().length < 5) {
							updateParagraphResult(chapter.id, originalIndex, { status: "done" });
							continue;
						}

						logger.proofread(`发送请求: filteredIndex=${i}, originalIndex=${originalIndex}, 文本长度=${item.length}`);

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
							setTimeout(() => reject(new Error('PROOFREAD_TIMEOUT')), 5000);
						});

						let reply: string;
						try {
							reply = await Promise.race([
								sendChatCompletion(messages, aiConfig, controller.signal),
								timeoutPromise
							]);
						} catch (timeoutErr) {
							if ((timeoutErr as Error).message === 'PROOFREAD_TIMEOUT') {
								const currentItem = filteredItems[i] || "";
								const timeoutError: ProofreadError = {
									id: `err-${chapter.id}-${originalIndex}-timeout-${Date.now()}`,
									startIndex: 0,
									endIndex: 0,
									errorType: "timeout",
									suggestion: "请求超时（5秒），已跳过此段落",
									originalText: currentItem.slice(0, 50),
									correctedText: "",
									applied: false,
									skipped: false,
								};
								updateParagraphResult(chapter.id, originalIndex, {
									errors: [timeoutError],
									status: "error",
									errorMessage: "请求超时（5秒）",
								});
								continue;
							}
							throw timeoutErr;
						}
						const raw = extractJSON(reply);

						const errors: ProofreadError[] = [];
						for (const obj of raw) {
							if (typeof obj !== "object" || obj === null) continue;
							const o = obj as Record<string, unknown>;

							// 支持新格式：find/replace
							const find = String(o.find ?? "");
							const replace = String(o.replace ?? "");
							
							// 兼容旧格式：original/corrected
							const orig = String(o.original ?? o.original_text ?? "");
							const corr = String(o.corrected ?? o.corrected_text ?? "");
							
							const errType = String(o.type ?? o.error_type ?? "");
							const suggest = String(o.reason ?? o.suggestion ?? "");
							const aiColumn = o.column !== undefined ? Number(o.column) : undefined;

							// 优先使用新格式的 find/replace，其次使用旧格式的 original/corrected
							const matchText = find || orig;
							const correctText = replace || corr;

							if (!matchText) continue;

							// 校验：matchText 和 correctText 必须不同（去除空白字符后也不能相同）
							if (matchText === correctText || matchText.replace(/\s/g, '') === correctText.replace(/\s/g, '')) continue;

							// 强约束：忽略词列表中的词语不标记为错误
							const isIgnored = ignoredWords.some(word => {
								if (!word) return false;
								return matchText.includes(word) || word.includes(matchText);
							});
							if (isIgnored) continue;

							const located = locateTextInParagraph(item, matchText, aiColumn);
							if (!located) continue;
							let startIdx = located.start;
							let endIdx = located.end;
							let finalMatchText = matchText;
							let finalCorrectText = correctText;

							const truncated = truncateFind(finalMatchText, finalCorrectText, item);
							if (truncated) {
								finalMatchText = truncated.find;
								finalCorrectText = truncated.replace;
								const relocated = locateTextInParagraph(item, finalMatchText, aiColumn);
								if (relocated) {
									startIdx = relocated.start;
									endIdx = relocated.end;
								}
							}

							errors.push({
								id: `err-${chapter.id}-${originalIndex}-${errors.length}`,
								startIndex: startIdx,
								endIndex: endIdx,
								errorType:
									(errType as ProofreadError["errorType"]) || "typo",
								suggestion: suggest,
								originalText: finalMatchText,
								correctedText: finalCorrectText,
								applied: false,
								skipped: false,
							});
						}

						updateParagraphResult(chapter.id, originalIndex, {
							errors,
							status: "done",
						});

						// 保存校对进度
						if (currentNovelId) {
							saveProofreadProgress(currentNovelId, chapter.id, i, false);
						}
					} catch (err: unknown) {
						if (err instanceof DOMException && err.name === "AbortError")
							return;
						const msg = err instanceof Error ? err.message : String(err);
						// 获取当前段落文本
						const currentItem = filteredItems[i] || "";
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
				}

				// 章节校对完成，标记为完成
				if (currentNovelId) {
					saveProofreadProgress(currentNovelId, chapter.id, filteredItems.length, true);
				}
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
			getCharacters,
			saveProofreadProgress,
			promptConfig.proofread,
			promptConfig.proofreadChapter,
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

				const errors: ProofreadError[] = [];
				for (const obj of raw) {
					if (typeof obj !== "object" || obj === null) continue;
					const o = obj as Record<string, unknown>;

					// 支持新格式：find/replace
					const find = String(o.find ?? "");
					const replace = String(o.replace ?? "");
					
					// 兼容旧格式：original/corrected
					const orig = String(o.original ?? o.original_text ?? "");
					const corr = String(o.corrected ?? o.corrected_text ?? "");
					
					const errType = String(o.type ?? o.error_type ?? "");
					const suggest = String(o.reason ?? o.suggestion ?? "");
					const aiColumn = o.column !== undefined ? Number(o.column) : undefined;

					// 优先使用新格式的 find/replace，其次使用旧格式的 original/corrected
					const matchText = find || orig;
					const correctText = replace || corr;

					if (!matchText) continue;
					
					// 校验：对于 typo/grammar/format 类型，matchText 和 correctText 必须不同
					// 但 punctuation 类型可能只是提示标点问题，不一定需要替换
					const needsReplacement = errType === "typo" || errType === "grammar" || errType === "format";
					if (needsReplacement && matchText === correctText) continue;

					const located = locateTextInParagraph(lineText, matchText, aiColumn);
					if (!located) continue;
					let startIdx = located.start;
					let endIdx = located.end;
					let finalMatchText = matchText;
					let finalCorrectText = correctText;

					const truncated = truncateFind(finalMatchText, finalCorrectText, lineText);
					if (truncated) {
						finalMatchText = truncated.find;
						finalCorrectText = truncated.replace;
						const relocated = locateTextInParagraph(lineText, finalMatchText, aiColumn);
						if (relocated) {
							startIdx = relocated.start;
							endIdx = relocated.end;
						}
					}

					errors.push({
						id: `err-${chapter.id}-${originalIndex}-${errors.length}`,
						startIndex: startIdx,
						endIndex: endIdx,
						errorType: (errType as ProofreadError["errorType"]) || "typo",
						suggestion: suggest,
						originalText: finalMatchText,
						correctedText: finalCorrectText,
						applied: false,
						skipped: false,
					});
				}

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
