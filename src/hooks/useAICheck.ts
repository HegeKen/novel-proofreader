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
	const setResults = useProofreadStore((s) => s.setResults);
	const updateParagraphResult = useProofreadStore(
		(s) => s.updateParagraphResult,
	);
	const getIgnoredWords = useProofreadStore((s) => s.getIgnoredWords);
	const abortRef = useRef<AbortController | null>(null);

	const checkChapter = useCallback(
		async (granularity: CheckGranularity, startFrom: number = 0) => {
			const chapter = chapters[currentChapterIndex];
			if (!chapter) return;

			// 取消之前的请求
			abortRef.current?.abort();
			const controller = new AbortController();
			abortRef.current = controller;

			const text = chapter.content;
			// 获取当前小说的忽略单词列表
			const ignoredWords = getIgnoredWords(currentNovelId ?? "");

			if (granularity === "chapter") {
				// 分批次发送（每批字符数不超过550，防止请求过大导致失败）
				// 重要：保留原始段落索引（包含空段落），与阅读区保持一致
				const paragraphs = splitParagraphs(text);
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

				// 逐批处理
				for (const batch of batches) {
					if (controller.signal.aborted) break;

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

						const messages = [
							{ role: "system" as const, content: PROOFREAD_SYSTEM_PROMPT_CHAPTER },
							{
								role: "user" as const,
								content: buildProofreadUserPrompt(JSON.stringify(textByLine), ignoredWords),
							},
						];

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
							let lineNumber = obj.lineNumber !== undefined ? Number(obj.lineNumber) : -1;
							const orig = String(obj.original ?? obj.original_text ?? "");
							const corr = String(obj.corrected ?? obj.corrected_text ?? "");
							const errType = String(obj.type ?? obj.error_type ?? "");
							const suggest = String(obj.reason ?? obj.suggestion ?? "");
							const aiStart = obj.start !== undefined ? Number(obj.start) : -1;
							const aiEnd = obj.end !== undefined ? Number(obj.end) : -1;

							if (!orig) continue;

							// 校验：original 和 corrected 必须不同
							if (orig === corr || orig.replace(/\s/g, '') === corr.replace(/\s/g, '')) continue;

							// 检查行号是否在该批次范围内
							if (lineNumber < batch.start || lineNumber >= batch.end) {
								// 行号不在该批次，可能是全局行号或其他原因，尝试查找该批次内是否包含
								const foundLine = paragraphs.findIndex((p, idx) => 
									idx >= batch.start && idx < batch.end && p.includes(orig)
								);
								if (foundLine < 0) {
									console.warn(`[useAICheck] 批次 ${batch.start}-${batch.end} 中无法找到包含 "${orig}" 的段落`);
									continue;
								}
								lineNumber = foundLine;
							}

							// 确定错误在段落内的位置
							let startIdx: number;
							let endIdx: number;
							const targetPara = paragraphs[lineNumber];

							// 如果 AI 返回了 start/end，验证它们是否有效
							if (aiStart >= 0 && aiEnd > aiStart && aiEnd <= targetPara.length) {
								// 验证位置处的文本是否与 original 匹配
								const actualText = targetPara.slice(aiStart, aiEnd);
								if (actualText === orig) {
									startIdx = aiStart;
									endIdx = aiEnd;
								} else {
									// 位置不匹配，降级使用 indexOf
									const idx = targetPara.indexOf(orig);
									if (idx < 0) {
										console.warn(`[useAICheck] 段落 ${lineNumber} 中找不到 "${orig}"`);
										continue;
									}
									startIdx = idx;
									endIdx = startIdx + orig.length;
								}
							} else {
								// 没有有效的位置信息，使用 indexOf 查找
								if (!targetPara.includes(orig)) {
									console.warn(`[useAICheck] 段落 ${lineNumber} 中找不到 "${orig}"`);
									continue;
								}
								const idx = targetPara.indexOf(orig);
								startIdx = idx;
								endIdx = startIdx + orig.length;
							}

							errorsByLine[lineNumber].push({
								id: `err-${chapter.id}-${lineNumber}-${errorsByLine[lineNumber].length}`,
								startIndex: startIdx,
								endIndex: endIdx,
								errorType: (errType as ProofreadError["errorType"]) || "typo",
								suggestion: suggest,
								originalText: orig,
								correctedText: corr,
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
							updateParagraphResult(chapter.id, lineIdx, {
								status: "error",
								errorMessage: msg,
							});
						}
					}
				}
			} else {
				// 按段落 或 按行检测（过滤掉空段落）
				const allLines = splitParagraphs(text);
				const filteredItems = allLines.filter((p) => p.trim() !== "");
				// 建立过滤后索引到原始索引的映射
				const indexMap: number[] = [];
				allLines.forEach((line, i) => {
					if (line.trim() !== "") {
						indexMap.push(i);
					}
				});
				// 从 startFrom 开始，之前的标记为已跳过
				const initial: ParagraphResult[] = filteredItems.map((p, i) => ({
					paragraphIndex: indexMap[i],
					originalText: p,
					errors: [],
					status: (i < startFrom ? "done" : "pending") as "done" | "pending",
				}));
				setResults(chapter.id, initial);

				// 逐项检测（从 startFrom 开始）
				for (let i = startFrom; i < filteredItems.length; i++) {
					if (controller.signal.aborted) break;

					// 使用原始段落索引（关键修复）
					const originalIndex = indexMap[i];

					updateParagraphResult(chapter.id, originalIndex, { status: "checking" });

					try {
						const item = filteredItems[i];
						// 如果太短，跳过
						if (item.trim().length < 5) {
							updateParagraphResult(chapter.id, originalIndex, { status: "done" });
							continue;
						}

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

							// 兼容新旧两种字段格式
							const orig = String(o.original ?? o.original_text ?? "");
							const corr = String(o.corrected ?? o.corrected_text ?? "");
							const errType = String(o.type ?? o.error_type ?? "");
							const suggest = String(o.reason ?? o.suggestion ?? "");
							const aiStart = o.start !== undefined ? Number(o.start) : -1;
							const aiEnd = o.end !== undefined ? Number(o.end) : -1;

							if (!orig) continue;

							// 校验：original 和 corrected 必须不同（去除空白字符后也不能相同）
							if (orig === corr || orig.replace(/\s/g, '') === corr.replace(/\s/g, '')) continue;

							// 优先使用AI返回的位置，否则用indexOf查找
							let startIdx: number;
							let endIdx: number;

							if (aiStart >= 0 && aiEnd > aiStart) {
								// 使用AI返回的精确位置
								startIdx = aiStart;
								endIdx = aiEnd;
							} else {
								// 降级使用indexOf查找
								if (!item.includes(orig)) continue;
								const idx = item.indexOf(orig);
								startIdx = idx;
								endIdx = startIdx + orig.length;
							}

							errors.push({
								id: `err-${chapter.id}-${originalIndex}-${errors.length}`,
								startIndex: startIdx,
								endIndex: endIdx,
								errorType:
									(errType as ProofreadError["errorType"]) || "typo",
								suggestion: suggest,
								originalText: orig,
								correctedText: corr,
								applied: false,
								skipped: false,
							});
						}

						updateParagraphResult(chapter.id, originalIndex, {
							errors,
							status: "done",
						});
					} catch (err: unknown) {
						if (err instanceof DOMException && err.name === "AbortError")
							return;
						const msg = err instanceof Error ? err.message : String(err);
						updateParagraphResult(chapter.id, originalIndex, {
							status: "error",
							errorMessage: msg,
						});
					}
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
		],
	);

	const cancelCheck = useCallback(() => {
		abortRef.current?.abort();
	}, []);

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

					// 兼容新旧两种字段格式
					const orig = String(o.original ?? o.original_text ?? "");
					const corr = String(o.corrected ?? o.corrected_text ?? "");
					const errType = String(o.type ?? o.error_type ?? "");
					const suggest = String(o.reason ?? o.suggestion ?? "");
					const aiStart = o.start !== undefined ? Number(o.start) : -1;
					const aiEnd = o.end !== undefined ? Number(o.end) : -1;

					if (!orig) continue;
					if (orig === corr) continue;

					// 优先使用AI返回的位置，否则用indexOf查找
					let startIdx: number;
					let endIdx: number;

					if (aiStart >= 0 && aiEnd > aiStart) {
						startIdx = aiStart;
						endIdx = aiEnd;
					} else {
						if (!lineText.includes(orig)) continue;
						const idx = lineText.indexOf(orig);
						startIdx = idx;
						endIdx = startIdx + orig.length;
					}

					errors.push({
						id: `err-${chapter.id}-${originalIndex}-${errors.length}`,
						startIndex: startIdx,
						endIndex: endIdx,
						errorType: (errType as ProofreadError["errorType"]) || "typo",
						suggestion: suggest,
						originalText: orig,
						correctedText: corr,
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
