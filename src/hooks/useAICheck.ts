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
import { buildParagraphIndexMap } from "../utils/chapterSplit";
import {
	sendChatCompletionAuto,
	isLocalModel,
	PROOFREAD_SYSTEM_PROMPT,
	PROOFREAD_SYSTEM_PROMPT_CHAPTER,
	PROOFREAD_SYSTEM_PROMPT_DUAL,
	LOCAL_PROOFREAD_SYSTEM_PROMPT,
	buildProofreadUserPrompt,
	buildProofreadSystemPrompt,
	buildDualParagraphUserPrompt,
	extractJSON,
	normalizeErrors,
} from "../utils/aiClient";
import type { ChatMessage } from "../utils/aiClient";
import {
	makeNetworkError,
	parseChapterErrors,
	parseDualParagraphErrors,
	resolveProofreadReply,
	mergeErrorsIntoStore,
} from "../utils/proofreadPipeline";
import { logger } from "../utils/logger";
import { startProofreadService, stopProofreadService } from "../utils/androidService";
import { Semaphore } from "../utils/concurrent";
import type {
	AIConfig,
	Chapter,
	LocalModelConfig,
	ParagraphResult,
	ProofreadError,
	CheckGranularity,
} from "../types";
import type { PromptConfig } from "../components/config/promptConfig";

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

/** 构建单段落校对请求消息（本地小模型使用简化版 Prompt，提高指令遵循稳定性） */
function buildSingleParagraphMessages(
	text: string,
	ignoredWords: string[],
	localModelConfig: LocalModelConfig,
	promptConfig: Pick<PromptConfig, "proofread">,
): ChatMessage[] {
	const useLocalPrompt = isLocalModel(localModelConfig);
	const basePrompt = useLocalPrompt
		? LOCAL_PROOFREAD_SYSTEM_PROMPT
		: promptConfig.proofread || PROOFREAD_SYSTEM_PROMPT;
	return [
		{ role: "system", content: buildProofreadSystemPrompt(basePrompt, ignoredWords) },
		{
			role: "user",
			content: buildProofreadUserPrompt(text, ignoredWords),
		},
	];
}

/** 一次章节校对运行的公共上下文（章节模式 / 段落模式共用） */
interface ProofreadRunOptions {
	chapter: Chapter;
	currentNovelId: string | null;
	aiConfig: AIConfig;
	localModelConfig: LocalModelConfig;
	promptConfig: PromptConfig;
	ignoredWords: string[];
	controller: AbortController;
	maxConcurrent: number;
	startFrom: number;
	onLineChecking?: (filteredIndex: number | null) => void;
}

// ============================================================
// 章节模式：按 ~450 字分批，云端批量 JSON / 内置模型逐段
// ============================================================

async function runChapterCheck(opts: ProofreadRunOptions): Promise<void> {
	const {
		chapter,
		aiConfig,
		localModelConfig,
		promptConfig,
		ignoredWords,
		controller,
		maxConcurrent,
	} = opts;
	const chapterId = chapter.id;
	const { setResults, updateParagraphResult } = useProofreadStore.getState();

	// 分批次发送（每批字符数不超过450，防止请求过大导致失败）
	// 重要：保留原始段落索引（包含空段落），与阅读区保持一致
	const paragraphs = splitParagraphs(chapter.content);
	logger.proofread(`段落分割完成: 总段落数=${paragraphs.length}`);
	const MAX_CHARS_PER_BATCH = 450;

	// 初始化每个段落的结果（保留原始索引）
	const initial: ParagraphResult[] = paragraphs.map((p, i) => ({
		paragraphIndex: i,
		originalText: p,
		errors: [],
		status: p.trim() === "" ? "done" : "pending", // 空段落直接标记为完成
	}));
	setResults(chapterId, initial);

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

	logger.proofread(`批次构建完成: 总批次数=${batches.length}, 批次详情:`, batches.map((b, idx) => `批次${idx + 1}: ${b.start}-${b.end}`).join(', '));

	const isBuiltinModel = localModelConfig.modelSource === "local-builtin";

	// 处理单个批次
	const processBatch = async (batch: { start: number; end: number }) => {
		if (controller.signal.aborted) return;

		logger.proofread(`处理批次: start=${batch.start}, end=${batch.end}`);

		// 更新该批次段落的状态为 checking
		for (let i = batch.start; i < batch.end; i++) {
			if (paragraphs[i].trim() !== "") {
				updateParagraphResult(chapterId, i, { status: "checking" });
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

			// 内置纠错模型不支持章节级 JSON 输入，改为逐段处理
			if (isBuiltinModel) {
				const errorsByLine: ProofreadError[][] = paragraphs.map(() => []);
				for (const lineIdxStr of Object.keys(textByLine)) {
					const lineIdx = parseInt(lineIdxStr, 10);
					const item = paragraphs[lineIdx];
					const messages = buildSingleParagraphMessages(item, ignoredWords, localModelConfig, promptConfig);
					const reply = await sendChatCompletionAuto(messages, aiConfig, localModelConfig, controller.signal);
					errorsByLine[lineIdx] = resolveProofreadReply(reply, {
						chapterId,
						paragraphIndex: lineIdx,
						paragraphs,
						ignoredWords,
						correctedTextMode: true,
					});
				}
				// 更新该批次每个段落的结果
				for (let lineIdx = batch.start; lineIdx < batch.end; lineIdx++) {
					if (paragraphs[lineIdx].trim() === "") continue;
					updateParagraphResult(chapterId, lineIdx, {
						errors: errorsByLine[lineIdx],
						status: "done",
					});
				}
				return;
			}

			logger.proofread(`发送请求给大模型: textByLine 行号列表=[${Object.keys(textByLine).join(', ')}], 字符总数=${JSON.stringify(textByLine).length}`);

			const messages = [
				{ role: "system" as const, content: promptConfig.proofreadChapter || PROOFREAD_SYSTEM_PROMPT_CHAPTER },
				{
					role: "user" as const,
					content: buildProofreadUserPrompt(JSON.stringify(textByLine), ignoredWords),
				},
			];

			const reply = await sendChatCompletionAuto(
				messages,
				aiConfig,
				localModelConfig,
				controller.signal,
			);
			const raw = normalizeErrors(extractJSON(reply));
			const errorsByLine = parseChapterErrors(raw, {
				chapterId,
				paragraphs,
				batchStart: batch.start,
				batchEnd: batch.end,
				ignoredWords,
			});

			// 更新该批次每个段落的结果（基于原始索引）
			for (let lineIdx = batch.start; lineIdx < batch.end; lineIdx++) {
				if (paragraphs[lineIdx].trim() === "") continue; // 跳过空段落
				updateParagraphResult(chapterId, lineIdx, {
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
				const networkError = makeNetworkError(chapterId, lineIdx, msg, paragraphs[lineIdx]);
				updateParagraphResult(chapterId, lineIdx, {
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
}

// ============================================================
// 段落模式：非空段落两两配对，一次请求校对两段
// ============================================================

async function runParagraphCheck(opts: ProofreadRunOptions): Promise<void> {
	const {
		chapter,
		currentNovelId,
		aiConfig,
		localModelConfig,
		promptConfig,
		ignoredWords,
		controller,
		maxConcurrent,
		startFrom,
		onLineChecking,
	} = opts;
	const chapterId = chapter.id;
	const { setResults, updateParagraphResult } = useProofreadStore.getState();
	const { saveProofreadProgress } = useProofreadMetaStore.getState();

	const allLines = splitParagraphs(chapter.content);
	const filteredItems = allLines.filter((p) => p.trim() !== "");
	logger.proofread(`段落模式: 总行数=${allLines.length}, 过滤后行数=${filteredItems.length}, startFrom=${startFrom}`);
	// 建立过滤后索引到原始索引的映射
	const indexMap = buildParagraphIndexMap(chapter.content);

	// 关键：初始化所有段落（包括空段落），确保数组索引与原始段落索引一致
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
	setResults(chapterId, initial);

	const isBuiltinModel = localModelConfig.modelSource === "local-builtin";

	// 处理单个段落
	const processParagraphItem = async (filteredIdx: number) => {
		if (controller.signal.aborted) return;

		const originalIndex = indexMap[filteredIdx];

		logger.proofread(`检测第 ${filteredIdx + 1} 项: filteredIndex=${filteredIdx}, originalIndex=${originalIndex}, startFrom=${startFrom}`);

		updateParagraphResult(chapterId, originalIndex, { status: "checking" });
		// 同步当前检测行（供 handleStartCheck 等调用方展示单行检测状态）
		onLineChecking?.(filteredIdx);

		try {
			const item = filteredItems[filteredIdx];
			// 如果太短，跳过
			if (item.trim().length < 5) {
				updateParagraphResult(chapterId, originalIndex, { status: "done" });
				return;
			}

			// 只传输当前段落实际包含的 ignoredWords，减少 token 消耗
			const relevantIgnoredWords = ignoredWords.filter(word => word && item.includes(word));
			logger.proofread(`段落包含的 ignoredWords: ${relevantIgnoredWords.length}/${ignoredWords.length} - ${relevantIgnoredWords.join('、')}`);

			const messages = buildSingleParagraphMessages(item, relevantIgnoredWords, localModelConfig, promptConfig);

			const reply = await sendChatCompletionAuto(messages, aiConfig, localModelConfig, controller.signal);

			// JSON 错误列表 / 内置模型纠正后句子，统一由管线解析
			const errors = resolveProofreadReply(reply, {
				chapterId,
				paragraphIndex: originalIndex,
				paragraphs: allLines,
				ignoredWords: relevantIgnoredWords,
				correctedTextMode: isBuiltinModel,
			});

			// 主段落合并去重 + 跨段落错误分发
			mergeErrorsIntoStore(chapterId, originalIndex, errors);

			// 保存校对进度
			if (currentNovelId) {
				saveProofreadProgress(currentNovelId, chapterId, filteredIdx, false);
			}
		} catch (err: unknown) {
			if (err instanceof DOMException && err.name === "AbortError") return;
			const msg = err instanceof Error ? err.message : String(err);
			// 获取当前段落文本
			const currentItem = filteredItems[filteredIdx] || "";
			// 将网络错误添加到错误清单
			const networkError = makeNetworkError(chapterId, originalIndex, msg, currentItem);
			updateParagraphResult(chapterId, originalIndex, {
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

		updateParagraphResult(chapterId, origIdx1, { status: "checking" });
		updateParagraphResult(chapterId, origIdx2, { status: "checking" });
		// 同步当前检测行（以配对的第一行为代表）
		onLineChecking?.(idx1);

		try {
			// 如果任一段落太短，改为分别处理
			if (item1.trim().length < 5 || item2.trim().length < 5) {
				logger.proofread(`双段落中有段落过短，改为分别处理`);
				if (item1.trim().length < 5) {
					updateParagraphResult(chapterId, origIdx1, { status: "done" });
				} else {
					await processParagraphItem(idx1);
				}
				if (!controller.signal.aborted) {
					if (item2.trim().length < 5) {
						updateParagraphResult(chapterId, origIdx2, { status: "done" });
					} else {
						await processParagraphItem(idx2);
					}
				}
				return;
			}

			// 内置纠错模型不支持双段落 JSON 输入，改为逐段处理
			if (isBuiltinModel) {
				logger.proofread(`内置模型双段落改为逐段处理`);
				await processParagraphItem(idx1);
				if (!controller.signal.aborted) {
					await processParagraphItem(idx2);
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

			const messages = [
				{ role: "system" as const, content: systemPrompt },
				{ role: "user" as const, content: userPrompt },
			];

			const reply = await sendChatCompletionAuto(messages, aiConfig, localModelConfig, controller.signal);
			logger.proofread(`双段落AI原始返回: ${reply.slice(0, 500)}${reply.length > 500 ? '...' : ''}`);
			const parsed = extractJSON(reply);

			// 统一解析：对象格式（含合并建议）或数组格式（按文本归属分配）
			const result = parseDualParagraphErrors(
				parsed,
				chapterId,
				origIdx1,
				origIdx2,
				item1,
				item2,
				combinedIgnoredWords,
			);

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

			updateParagraphResult(chapterId, origIdx1, result1);
			updateParagraphResult(chapterId, origIdx2, {
				paragraphIndex: origIdx2,
				originalText: item2,
				errors: result.errors2,
				status: "done",
			});

			// 保存校对进度
			if (currentNovelId) {
				saveProofreadProgress(currentNovelId, chapterId, idx2, false);
			}
		} catch (err: unknown) {
			if (err instanceof DOMException && err.name === "AbortError") return;
			const msg = err instanceof Error ? err.message : String(err);
			logger.proofread(`双段落检测失败: ${msg}, 改为分别处理`);

			// 失败时回退为分别处理
			updateParagraphResult(chapterId, origIdx1, { status: "pending", errors: [] });
			updateParagraphResult(chapterId, origIdx2, { status: "pending", errors: [] });
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
		if (!controller.signal.aborted) {
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
		await semaphore.acquire();
		const promise = hasPartner
			? processParagraphPair(i, i + 1)
			: processParagraphItem(i);
		paragraphTasks.push(promise.finally(() => {
			semaphore.release();
		}));
	}
	await Promise.all(paragraphTasks);
	// 全部处理完成，清除单行检测状态
	onLineChecking?.(null);

	// 章节校对完成，标记为完成
	if (currentNovelId) {
		saveProofreadProgress(currentNovelId, chapterId, filteredItems.length, true);
	}
}

export function useAICheck() {
	const aiConfig = useAIConfigStore((s) => s.aiConfig);
	const localModelConfig = useAIConfigStore((s) => s.localModelConfig);
	const currentNovelId = useNovelStore((s) => s.currentNovelId);
	const currentChapterIndex = useNovelStore((s) => s.currentChapterIndex);
	const getIgnoredWords = useProofreadMetaStore((s) => s.getIgnoredWords);
	const getCharacters = useCharacterStore((s) => s.getCharacters);
	const promptConfig = useConfigStore((s) => s.promptConfig);
	const proofreadConfig = useConfigStore((s) => s.proofreadConfig);
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

			// 熄屏模式：启动 Android 前台服务并持有 WakeLock，避免锁屏后检测被冻结
			if (proofreadConfig.keepAwakeOnScreenOff) {
				startProofreadService().catch(() => {});
			}

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

			// 获取当前小说的忽略单词列表
			const ignoredWordsList = getIgnoredWords(currentNovelId ?? "");
			// 获取当前小说的角色名和别称，添加到忽略列表
			const characterNames = currentNovelId ? getCharacters(currentNovelId).flatMap(c => [c.name, ...(c.aliases || [])]) : [];
			// 合并忽略词列表（去重）
			const ignoredWords = Array.from(new Set([...ignoredWordsList, ...characterNames]));
			logger.proofread(`忽略单词列表: ${ignoredWords.join(", ") || "无"}`);
			logger.proofread(`角色名称已自动加入忽略词: ${characterNames.join(", ") || "无"}`);

			const runOptions: ProofreadRunOptions = {
				chapter,
				currentNovelId,
				aiConfig,
				localModelConfig,
				promptConfig,
				ignoredWords,
				controller,
				maxConcurrent,
				startFrom,
				onLineChecking,
			};

			try {
				if (granularity === "chapter") {
					await runChapterCheck(runOptions);
				} else {
					// paragraph（双段落配对）与 line（单段落）共用同一路径
					await runParagraphCheck(runOptions);
				}
			} finally {
				stopProofreadService().catch(() => {});
			}
		},
		[
			currentNovelId,
			aiConfig,
			localModelConfig,
			promptConfig,
			proofreadConfig,
			setResults,
			updateParagraphResult,
			getIgnoredWords,
			getCharacters,
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

				const messages = buildSingleParagraphMessages(lineText, relevantIgnoredWords, localModelConfig, promptConfig);

				// 传入共享 signal，使其可被切章/取消/卸载中断
				const reply = await sendChatCompletionAuto(messages, aiConfig, localModelConfig, sharedAbortRef?.signal);

				// JSON 错误列表 / 内置模型纠正后句子，统一由管线解析
				const errors = resolveProofreadReply(reply, {
					chapterId: chapter.id,
					paragraphIndex: originalIndex,
					paragraphs: allParagraphs,
					ignoredWords,
					correctedTextMode: localModelConfig.modelSource === "local-builtin",
				});

				// 主段落合并去重 + 跨段落错误分发
				mergeErrorsIntoStore(chapter.id, originalIndex, errors);
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
			localModelConfig,
			promptConfig,
			setResults,
			updateParagraphResult,
			getIgnoredWords,
		],
	);

	return { checkChapter, cancelCheck, checkSingleLine };
}
