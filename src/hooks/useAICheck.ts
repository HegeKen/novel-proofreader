// ============================================================
// AI 校对检测 Hook
// ============================================================
import { useCallback, useRef } from "react";
import { useAppStore } from "../stores/appStore";
import { useProofreadStore } from "../stores/proofreadStore";
import { splitParagraphs, splitTextChunks } from "../utils/chapterSplit";
import {
	sendChatCompletion,
	PROOFREAD_SYSTEM_PROMPT,
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
	const setResults = useProofreadStore((s) => s.setResults);
	const updateParagraphResult = useProofreadStore(
		(s) => s.updateParagraphResult,
	);
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

			if (granularity === "chapter") {
				// 整章发送
				const initial: ParagraphResult[] = [
					{
						paragraphIndex: 0,
						originalText: text,
						errors: [],
						status: "checking",
					},
				];
				setResults(chapter.id, initial);

				try {
					const chunks = splitTextChunks(text, aiConfig.maxCharsPerRequest);
					const allErrors: ProofreadError[] = [];
					let globalOffset = 0;

					for (let i = 0; i < chunks.length; i++) {
						const chunk = chunks[i];
						const messages = [
							{ role: "system" as const, content: PROOFREAD_SYSTEM_PROMPT },
							{
								role: "user" as const,
								content: buildProofreadUserPrompt(chunk),
							},
						];
						const reply = await sendChatCompletion(
							messages,
							aiConfig,
							controller.signal,
						);
						const raw = extractJSON(reply);

						for (const item of raw) {
							if (typeof item !== "object" || item === null) continue;
							const obj = item as Record<string, unknown>;
							const orig = String(obj.original_text ?? "");
							const corr = String(obj.corrected_text ?? "");
							if (!orig) continue;

							// 校验：original_text 和 corrected_text 必须不同
							if (orig === corr) continue;

							// 校验：original_text 必须是 chunk 中的子串
							if (!chunk.includes(orig)) continue;

							// 在 chunk 中查找 original_text 的位置
							const idx = chunk.indexOf(orig);
							const startIdx = idx + globalOffset;
							const endIdx = startIdx + orig.length;

							allErrors.push({
								id: `err-${chapter.id}-0-${allErrors.length}`,
								startIndex: startIdx,
								endIndex: endIdx,
								errorType:
									(obj.error_type as ProofreadError["errorType"]) || "typo",
								suggestion: String(obj.suggestion ?? ""),
								originalText: orig,
								correctedText: corr,
								applied: false,
								skipped: false,
							});
						}
						globalOffset += chunk.length;
					}

					updateParagraphResult(chapter.id, 0, {
						errors: allErrors,
						status: "done",
					});
				} catch (err: unknown) {
					if (err instanceof DOMException && err.name === "AbortError") return;
					const msg = err instanceof Error ? err.message : String(err);
					updateParagraphResult(chapter.id, 0, {
						status: "error",
						errorMessage: msg,
					});
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

					updateParagraphResult(chapter.id, i, { status: "checking" });

					try {
						const item = filteredItems[i];
						// 如果太短，跳过
						if (item.trim().length < 5) {
							updateParagraphResult(chapter.id, i, { status: "done" });
							continue;
						}

						const messages = [
							{ role: "system" as const, content: PROOFREAD_SYSTEM_PROMPT },
							{
								role: "user" as const,
								content: buildProofreadUserPrompt(item),
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
							const orig = String(o.original_text ?? "");
							const corr = String(o.corrected_text ?? "");
							if (!orig) continue;

							// 校验：original_text 和 corrected_text 必须不同
							if (orig === corr) continue;

							// 校验：original_text 必须是 item 中的子串
							if (!item.includes(orig)) continue;

							// 在原文中查找 original_text 的位置
							const idx = item.indexOf(orig);
							const startIdx = idx;
							const endIdx = startIdx + orig.length;

							errors.push({
								id: `err-${chapter.id}-${i}-${errors.length}`,
								startIndex: startIdx,
								endIndex: endIdx,
								errorType:
									(o.error_type as ProofreadError["errorType"]) || "typo",
								suggestion: String(o.suggestion ?? ""),
								originalText: orig,
								correctedText: corr,
								applied: false,
								skipped: false,
							});
						}

						updateParagraphResult(chapter.id, i, {
							errors,
							status: "done",
						});
					} catch (err: unknown) {
						if (err instanceof DOMException && err.name === "AbortError")
							return;
						const msg = err instanceof Error ? err.message : String(err);
						updateParagraphResult(chapter.id, i, {
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
			aiConfig,
			setResults,
			updateParagraphResult,
		],
	);

	const cancelCheck = useCallback(() => {
		abortRef.current?.abort();
	}, []);

	const checkSingleLine = useCallback(
		async (
			lineIndex: number,
			setSingleCheckingLine: (v: number | null) => void,
		) => {
			const chapter = chapters[currentChapterIndex];
			if (!chapter) return;

			setSingleCheckingLine(lineIndex);

			const lines = splitParagraphs(chapter.content).filter(
				(p) => p.trim() !== "",
			);
			if (lineIndex >= lines.length) {
				setSingleCheckingLine(null);
				return;
			}

			const lineText = lines[lineIndex];

			// 如果该行还没有结果，先初始化
			const existing = useProofreadStore.getState().results[chapter.id];
			if (!existing || existing.length === 0) {
				const initial = lines.map((p, i) => ({
					paragraphIndex: i,
					originalText: p,
					errors: [],
					status: "done" as const,
				}));
				setResults(chapter.id, initial);
			} else {
				// 更新该行的状态
				updateParagraphResult(chapter.id, lineIndex, {
					status: "checking",
					errors: [],
				});
			}

			try {
				const messages = [
					{ role: "system" as const, content: PROOFREAD_SYSTEM_PROMPT },
					{
						role: "user" as const,
						content: buildProofreadUserPrompt(lineText),
					},
				];
				const reply = await sendChatCompletion(messages, aiConfig);
				const raw = extractJSON(reply);

				const errors: ProofreadError[] = [];
				for (const obj of raw) {
					if (typeof obj !== "object" || obj === null) continue;
					const o = obj as Record<string, unknown>;
					const orig = String(o.original_text ?? "");
					const corr = String(o.corrected_text ?? "");
					if (!orig) continue;

					// 校验：original_text 和 corrected_text 必须不同
					if (orig === corr) continue;

					// 校验：original_text 必须是 lineText 中的子串
					if (!lineText.includes(orig)) continue;

					const idx = lineText.indexOf(orig);
					const startIdx = idx;
					const endIdx = startIdx + orig.length;

					errors.push({
						id: `err-${chapter.id}-${lineIndex}-${errors.length}`,
						startIndex: startIdx,
						endIndex: endIdx,
						errorType: (o.error_type as ProofreadError["errorType"]) || "typo",
						suggestion: String(o.suggestion ?? ""),
						originalText: orig,
						correctedText: corr,
						applied: false,
						skipped: false,
					});
				}

				updateParagraphResult(chapter.id, lineIndex, {
					errors,
					status: "done",
				});
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				updateParagraphResult(chapter.id, lineIndex, {
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
			aiConfig,
			setResults,
			updateParagraphResult,
		],
	);

	return { checkChapter, cancelCheck, checkSingleLine };
}
