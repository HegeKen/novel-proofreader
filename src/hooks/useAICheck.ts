// ============================================================
// AI 校对检测 Hook
// ============================================================
import { useCallback, useRef } from "react";
import { useAppStore } from "../stores/appStore";
import { useProofreadStore } from "../stores/proofreadStore";
import { splitParagraphs } from "../utils/chapterSplit";
import {
	sendChatCompletion,
	PROOFREAD_SYSTEM_PROMPT,
	PROOFREAD_SYSTEM_PROMPT_CHAPTER,
	buildProofreadUserPrompt,
	extractJSON,
} from "../utils/aiClient";
import { logger } from "../utils/logger";
import type {
	ParagraphResult,
	ProofreadError,
	CheckGranularity,
} from "../types";

export function useAICheck() {
	const aiConfig = useAppStore((s) => s.aiConfig);
	const chapters = useAppStore((s) => s.chapters);
	const currentChapterIndex = useAppStore((s) => s.currentChapterIndex);
	const currentNovelId = useAppStore((s) => s.currentNovelId);
	const getIgnoredWords = useAppStore((s) => s.getIgnoredWords);
	const getCharacters = useAppStore((s) => s.getCharacters);
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

			console.log(`[useAICheck] checkChapter 开始: chapterIndex=${currentChapterIndex + 1}, granularity=${granularity}, startFrom=${startFrom} (第 ${startFrom + 1} 段)`);
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
				console.log(`[useAICheck] 段落分割完成: 总段落数=${paragraphs.length}, startFrom=${startFrom}`);
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

				console.log(`[useAICheck] 批次构建完成: 总批次数=${batches.length}, 批次详情:`, batches.map((b, idx) => `批次${idx+1}: ${b.start}-${b.end}`).join(', '));
				logger.proofread(`共分为 ${batches.length} 批处理`);

				// 逐批处理
				for (const batch of batches) {
					if (controller.signal.aborted) break;

					console.log(`[useAICheck] 处理批次: start=${batch.start}, end=${batch.end}`);

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

						console.log(`[useAICheck] 发送请求给大模型: textByLine 行号列表=[${Object.keys(textByLine).join(', ')}], 字符总数=${JSON.stringify(textByLine).length}`);

						const messages = [
							{ role: "system" as const, content: PROOFREAD_SYSTEM_PROMPT_CHAPTER },
							{
								role: "user" as const,
								content: buildProofreadUserPrompt(JSON.stringify(textByLine), ignoredWords),
							},
						];

						console.log(`[useAICheck] 发送请求: 批次 ${batch.start}-${batch.end}, 发送的行号:`, Object.keys(textByLine));

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

							// 优先使用新格式的 find/replace，其次使用旧格式的 original/corrected
							const matchText = find || orig;
							const correctText = replace || corr;

							console.log(`[useAICheck] 解析错误: matchText="${matchText}", correctText="${correctText}", lineNumber=${lineNumber}, aiStart=${aiStart}, aiEnd=${aiEnd}`);

							if (!matchText) continue;

							// 校验：对于 typo/grammar/format 类型，matchText 和 correctText 必须不同
							// 但 punctuation 类型可能只是提示标点问题，不一定需要替换
							const needsReplacement = errType === "typo" || errType === "grammar" || errType === "format";
							if (needsReplacement && (matchText === correctText || matchText.replace(/\s/g, '') === correctText.replace(/\s/g, ''))) {
								continue;
							}

							// 检查行号是否在该批次范围内
							if (lineNumber < batch.start || lineNumber >= batch.end) {
								// 行号不在该批次，可能是全局行号或其他原因，尝试查找该批次内是否包含
								const foundLine = paragraphs.findIndex((p, idx) => 
									idx >= batch.start && idx < batch.end && p.includes(matchText)
								);
								console.log(`[useAICheck] 行号检查: lineNumber=${lineNumber}, batch=${batch.start}-${batch.end}, foundLine=${foundLine}`);
								if (foundLine < 0) {
									console.warn(`[useAICheck] 批次 ${batch.start}-${batch.end} 中无法找到包含 "${matchText}" 的段落`);
									continue;
								}
								lineNumber = foundLine;
							}

							// 确定错误在段落内的位置
							let startIdx: number;
							let endIdx: number;
							const targetPara = paragraphs[lineNumber];

							// 如果 AI 返回了 start/end（全局字符索引），需要转换为段落内索引
							if (aiStart >= 0 && aiEnd > aiStart) {
								// 先尝试将全局索引转换为段落索引和段落内索引
								let charCount = 0;
								let foundParaIdx = -1;
								let paraStartIdx = -1;
								
								for (let i = 0; i < paragraphs.length; i++) {
									const para = paragraphs[i];
									// 检查全局索引是否在当前段落范围内
									if (charCount <= aiStart && aiStart < charCount + para.length) {
										foundParaIdx = i;
										paraStartIdx = aiStart - charCount;
										break;
									}
									charCount += para.length;
								}
								
								console.log(`[useAICheck] 全局索引转换: aiStart=${aiStart}, aiEnd=${aiEnd}, foundParaIdx=${foundParaIdx}, paraStartIdx=${paraStartIdx}`);
								
								// 如果找到对应的段落且与当前行号匹配
								if (foundParaIdx === lineNumber && paraStartIdx >= 0) {
									const paraEndIdx = paraStartIdx + (aiEnd - aiStart);
									// 验证位置处的文本是否与 matchText 匹配
									if (paraEndIdx <= targetPara.length) {
										const actualText = targetPara.slice(paraStartIdx, paraEndIdx);
										if (actualText === matchText) {
											startIdx = paraStartIdx;
											endIdx = paraEndIdx;
										} else {
											// 位置不匹配，降级使用 indexOf
											console.log(`[useAICheck] 全局索引位置不匹配: 期望 "${matchText}"，实际 "${actualText}"，降级使用 indexOf`);
											const idx = targetPara.indexOf(matchText);
											if (idx < 0) {
												console.warn(`[useAICheck] 段落 ${lineNumber} 中找不到 "${matchText}"`);
												continue;
											}
											startIdx = idx;
											endIdx = startIdx + matchText.length;
										}
									} else {
										// 位置超出段落范围，降级使用 indexOf
										console.log(`[useAICheck] 全局索引超出段落范围: paraEndIdx=${paraEndIdx}, paraLength=${targetPara.length}`);
										const idx = targetPara.indexOf(matchText);
										if (idx < 0) {
											console.warn(`[useAICheck] 段落 ${lineNumber} 中找不到 "${matchText}"`);
											continue;
										}
										startIdx = idx;
										endIdx = startIdx + matchText.length;
									}
								} else {
									// 全局索引转换失败或段落不匹配，降级使用 indexOf
									console.log(`[useAICheck] 全局索引转换失败: foundParaIdx=${foundParaIdx}, lineNumber=${lineNumber}`);
									const idx = targetPara.indexOf(matchText);
									if (idx < 0) {
										console.warn(`[useAICheck] 段落 ${lineNumber} 中找不到 "${matchText}"`);
										continue;
									}
									startIdx = idx;
									endIdx = startIdx + matchText.length;
								}
							} else {
								// 没有有效的位置信息，使用 indexOf 查找
								if (!targetPara.includes(matchText)) {
									console.warn(`[useAICheck] 段落 ${lineNumber} 中找不到 "${matchText}"`);
									continue;
								}
								const idx = targetPara.indexOf(matchText);
								startIdx = idx;
								endIdx = startIdx + matchText.length;
							}

							errorsByLine[lineNumber].push({
								id: `err-${chapter.id}-${lineNumber}-${errorsByLine[lineNumber].length}`,
								startIndex: startIdx,
								endIndex: endIdx,
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
						if (err instanceof DOMException && err.name === "AbortError") break;
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
				}
			} else {
				// 按段落 或 按行检测
				const allLines = splitParagraphs(text);
				const filteredItems = allLines.filter((p) => p.trim() !== "");
				console.log(`[useAICheck] 非chapter粒度: 总行数=${allLines.length}, 过滤后行数=${filteredItems.length}, startFrom=${startFrom}`);
				// 建立过滤后索引到原始索引的映射
				const indexMap: number[] = [];
				allLines.forEach((line, i) => {
					if (line.trim() !== "") {
						indexMap.push(i);
					}
				});
				console.log(`[useAICheck] 索引映射: indexMap前20项=[${indexMap.slice(0, 20).join(', ')}]...`);
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

					console.log(`[useAICheck] 检测第 ${i + 1} 项: filteredIndex=${i}, originalIndex=${originalIndex}, startFrom=${startFrom}`);

					updateParagraphResult(chapter.id, originalIndex, { status: "checking" });

					try {
						const item = filteredItems[i];
						// 如果太短，跳过
						if (item.trim().length < 5) {
							updateParagraphResult(chapter.id, originalIndex, { status: "done" });
							continue;
						}

						console.log(`[useAICheck] 发送请求: filteredIndex=${i}, originalIndex=${originalIndex}, 文本长度=${item.length}`);

						const messages = [
							{ role: "system" as const, content: PROOFREAD_SYSTEM_PROMPT },
							{
								role: "user" as const,
								content: buildProofreadUserPrompt(item, ignoredWords),
							},
						];
						const reply = await sendChatCompletion(
							messages,
							aiConfig,
							controller.signal,
						);
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
							const aiStart = o.start !== undefined ? Number(o.start) : -1;
							const aiEnd = o.end !== undefined ? Number(o.end) : -1;

							// 优先使用新格式的 find/replace，其次使用旧格式的 original/corrected
							const matchText = find || orig;
							const correctText = replace || corr;

							if (!matchText) continue;

							// 校验：matchText 和 correctText 必须不同（去除空白字符后也不能相同）
							if (matchText === correctText || matchText.replace(/\s/g, '') === correctText.replace(/\s/g, '')) continue;

							// 优先使用AI返回的位置，否则用indexOf查找
							let startIdx: number;
							let endIdx: number;

							if (aiStart >= 0 && aiEnd > aiStart) {
								// 使用AI返回的精确位置
								startIdx = aiStart;
								endIdx = aiEnd;
							} else {
								// 降级使用indexOf查找
								if (!item.includes(matchText)) continue;
								const idx = item.indexOf(matchText);
								startIdx = idx;
								endIdx = startIdx + matchText.length;
							}

							errors.push({
								id: `err-${chapter.id}-${originalIndex}-${errors.length}`,
								startIndex: startIdx,
								endIndex: endIdx,
								errorType:
									(errType as ProofreadError["errorType"]) || "typo",
								suggestion: suggest,
								originalText: matchText,
								correctedText: correctText,
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
		],
	);

	const cancelCheck = useCallback(() => {
		console.log(`[useAICheck] cancelCheck 被调用，立即中断所有请求`);
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
			console.log(`[useAICheck] 已将所有段落状态重置为 pending`);
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
				const messages = [
					{ role: "system" as const, content: PROOFREAD_SYSTEM_PROMPT },
					{
						role: "user" as const,
						content: buildProofreadUserPrompt(lineText, ignoredWords),
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
					const aiStart = o.start !== undefined ? Number(o.start) : -1;
					const aiEnd = o.end !== undefined ? Number(o.end) : -1;

					// 优先使用新格式的 find/replace，其次使用旧格式的 original/corrected
					const matchText = find || orig;
					const correctText = replace || corr;

					if (!matchText) continue;
					
					// 校验：对于 typo/grammar/format 类型，matchText 和 correctText 必须不同
					// 但 punctuation 类型可能只是提示标点问题，不一定需要替换
					const needsReplacement = errType === "typo" || errType === "grammar" || errType === "format";
					if (needsReplacement && matchText === correctText) continue;

					// 优先使用AI返回的位置，否则用indexOf查找
					let startIdx: number;
					let endIdx: number;

					if (aiStart >= 0 && aiEnd > aiStart) {
						startIdx = aiStart;
						endIdx = aiEnd;
					} else {
						if (!lineText.includes(matchText)) continue;
						const idx = lineText.indexOf(matchText);
						startIdx = idx;
						endIdx = startIdx + matchText.length;
					}

					errors.push({
						id: `err-${chapter.id}-${originalIndex}-${errors.length}`,
						startIndex: startIdx,
						endIndex: endIdx,
						errorType: (errType as ProofreadError["errorType"]) || "typo",
						suggestion: suggest,
						originalText: matchText,
						correctedText: correctText,
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
		],
	);


	return { checkChapter, cancelCheck, checkSingleLine };
}
