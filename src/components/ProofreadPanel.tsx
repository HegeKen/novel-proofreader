// ============================================================
// 右侧校对区（带按行检测 + 采纳动画）
// ============================================================
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useAppStore } from "../stores/appStore";
import { useProofreadStore } from "../stores/proofreadStore";
import { useAICheck } from "../hooks/useAICheck";
import { buildParagraphIndexMap } from "../utils/formatters";
import { EmptyState } from "./EmptyState";
import { splitParagraphs } from "../utils/chapterSplit";
import { Icons } from "./Icons";
import { Select } from "./Select";
import { IgnoredWordsManager } from "./IgnoredWordsManager";
import { ToastContainer } from "./Toast";
import type { ToastMessage } from "./Toast";
import type { CheckGranularity, ProofreadError } from "../types";


const ERROR_TYPE_LABELS: Record<string, { icon: keyof typeof Icons; label: string }> = {
	typo: { icon: "typo", label: "错别字" },
	format: { icon: "grammar", label: "排版" },
	grammar: { icon: "grammar", label: "病句" },
	punctuation: { icon: "punctuation", label: "标点" },
};

const ERROR_TYPE_COLORS: Record<string, string> = {
	typo: "#ff4d4f",
	format: "#faad14",
	grammar: "#1677ff",
	punctuation: "#52c41a",
};

/** 采纳动画时长（ms） */
const ANIM_OLD_MS = 600;
const ANIM_REPLACE_MS = 300;
const ANIM_NEW_MS = 1200;

export function ProofreadPanel() {
	const chapters = useAppStore((s) => s.chapters);
	const currentChapterIndex = useAppStore((s) => s.currentChapterIndex);
	const replaceParagraphText = useAppStore((s) => s.replaceParagraphText);
	const replaceParagraphTextBatch = useAppStore((s) => s.replaceParagraphTextBatch);
	const results = useProofreadStore((s) => s.results);
	const setResults = useProofreadStore((s) => s.setResults);
	const highlightedParagraph = useProofreadStore((s) => s.highlightedParagraph);
	const setHighlightedParagraph = useProofreadStore(
		(s) => s.setHighlightedParagraph,
	);
	const toggleErrorApplied = useProofreadStore((s) => s.toggleErrorApplied);
	const applyAllErrors = useProofreadStore((s) => s.applyAllErrors);
	const toggleErrorSkipped = useProofreadStore((s) => s.toggleErrorSkipped);
	const setApplyAnimation = useProofreadStore((s) => s.setApplyAnimation);

	const startLine = useProofreadStore((s) => s.startLine);
	const setStartLine = useProofreadStore((s) => s.setStartLine);

	const { checkChapter, cancelCheck, checkSingleLine } = useAICheck();
	const [granularity, setGranularity] = useState<CheckGranularity>("paragraph");
	const [checking, setChecking] = useState(false);
	const [singleCheckingLine, setSingleCheckingLine] = useState<number | null>(
		null,
	);
	const [showIgnoredWordsModal, setShowIgnoredWordsModal] = useState(false);
	const [toastMessages, setToastMessages] = useState<ToastMessage[]>([]);
	// 动画互斥：防止快速连续点击"采纳"
	const animatingRef = useRef(false);
	// 滚动容器 ref
	const proofreadContentRef = useRef<HTMLDivElement>(null);

	const addToast = useCallback((type: ToastMessage["type"], message: string) => {
		const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		setToastMessages((prev) => [...prev, { id, type, message }]);
	}, []);

	const removeToast = useCallback((id: string) => {
		setToastMessages((prev) => prev.filter((msg) => msg.id !== id));
	}, []);
	const paragraphRefs = useRef<(HTMLDivElement | null)[]>([]);

	const chapter = chapters[currentChapterIndex];
	const chapterResults = useMemo(() => {
		return chapter ? (results[chapter.id] ?? []) : [];
	}, [chapter, results]);
	const totalLines = chapter
		? splitParagraphs(chapter.content).filter((p) => p.trim() !== "").length
		: 0;

	// 建立过滤后索引到原始索引的映射
	const paragraphIndexMap = useMemo(() => {
		return chapter ? buildParagraphIndexMap(chapter.content) : [];
	}, [chapter]);

	// 确保始终有段落列表用于高亮匹配（与阅读区保持同步）
	const displayResults = useMemo(() => {
		if (!chapter) return [];

		// 获取过滤后的段落列表（与阅读区一致）
		const paragraphs = splitParagraphs(chapter.content).filter(
			(p) => p.trim() !== "",
		);

		// 关键修复：基于 paragraphIndexMap 构建显示结果
		// 确保每个段落的 paragraphIndex 都是原始索引
		return paragraphs.map((p, filteredIndex) => {
			const originalIndex = paragraphIndexMap[filteredIndex];

			// 从 chapterResults 中查找对应的结果（使用原始索引匹配）
			const existing = chapterResults.find(
				(r) => r.paragraphIndex === originalIndex,
			);

			if (existing) {
				// 使用已有的结果，但更新文本为最新内容
				return {
					...existing,
					originalText: p,
				};
			}

			// 如果没有已有结果，创建新的 pending 状态
			return {
				paragraphIndex: originalIndex,
				originalText: p,
				errors: [],
				status: "pending" as const,
			};
		});
	}, [chapter, chapterResults, paragraphIndexMap]);

	// 切换章节时，自动把段落列表以"待校对"状态渲染出来（如果没有已有结果）
	const lastChapterIdRef = useRef<number | null>(null);
	useEffect(() => {
		if (!chapter) {
			lastChapterIdRef.current = null;
			return;
		}
		if (lastChapterIdRef.current === chapter.id) return;
		lastChapterIdRef.current = chapter.id;
		// 切换章节时重置起始行
		setStartLine(null);
		// 如果该章节还没有校对结果，初始化为待校对列表（过滤掉空段落）
		const existing = useProofreadStore.getState().results[chapter.id];
		if (!existing || existing.length === 0) {
			const paragraphs = splitParagraphs(chapter.content).filter(
				(p) => p.trim() !== "",
			);
			const initial = paragraphs.map((p, filteredIndex) => ({
				paragraphIndex: paragraphIndexMap[filteredIndex],
				originalText: p,
				errors: [],
				status: "pending" as const,
			}));
			setResults(chapter.id, initial);
		}
	}, [chapter?.id, paragraphIndexMap, chapter, setResults, setStartLine]);



	const handleStartCheck = async () => {
		setChecking(true);
		await checkChapter(granularity, startLine ?? 0);
		setChecking(false);
	};

	const handleSingleLineCheck = async (originalIndex: number, filteredIndex: number) => {
		if (checking || singleCheckingLine !== null) return;
		setSingleCheckingLine(filteredIndex);
		await checkSingleLine(originalIndex, () => setSingleCheckingLine(null));
	};

	// 滚动到指定段落
	const scrollToParagraph = useCallback((index: number) => {
		const el = paragraphRefs.current[index];
		const container = proofreadContentRef.current;

		if (!el || !container) {
			console.log(
				`[ProofreadPanel] scrollToParagraph failed: el=${!!el}, container=${!!container}, index=${index}`,
			);
			return;
		}

		console.log(`[ProofreadPanel] scrollToParagraph: index=${index}`);

		// 强制滚动，不检查是否在可视区域内
		el.scrollIntoView({ behavior: "smooth", block: "center" });
	}, []);

	// 监听 highlightedParagraph 变化，自动滚动到对应段落
	useEffect(() => {
		if (highlightedParagraph !== null) {
			console.log(
				`[ProofreadPanel] highlightedParagraph changed: ${highlightedParagraph}`,
			);
			// 使用 setTimeout 确保 DOM 已经渲染完成
			setTimeout(() => {
				scrollToParagraph(highlightedParagraph);
			}, 50);
		}
	}, [highlightedParagraph, scrollToParagraph]);

	/** 采纳单个错误：高亮旧文本 → 替换 → 高亮新文本 */
	const handleApply = useCallback(
		(
			paraResult: (typeof chapterResults)[number],
			err: ProofreadError,
		) => {
			// 动画互斥：上一个动画还没结束时禁止操作
			if (animatingRef.current) return;

			// 通过 getState() 获取最新 chapter，避免闭包过期
			const state = useAppStore.getState();
			const currentChapter = state.chapters[state.currentChapterIndex];
			if (!currentChapter) return;
			const chapterId = currentChapter.id;
			const paraIndex = paraResult.paragraphIndex;

			// 如果已采纳则撤销（把文本换回去）
			if (err.applied) {
				const ok = replaceParagraphText(
					chapterId,
					paraIndex,
					err.correctedText,
					err.originalText,
				);
				toggleErrorApplied(chapterId, paraIndex, err.id); // 使用原始段落索引
				if (!ok) {
					// 撤销失败（原文已被修改），显示错误提示
					addToast("error", "撤销失败：原文已被修改");
				} else {
					addToast("success", "已撤销修改");
				}
				return;
			}

			animatingRef.current = true;

			// 阶段 1：高亮旧文本（精确到错误位置）
			setApplyAnimation({
				chapterId,
				paragraphIndex: paraIndex, // 使用原始段落索引，与阅读区保持一致
				phase: "highlight-old",
				errorId: err.id,
				originalText: err.originalText,
				correctedText: err.correctedText,
				startIndex: err.startIndex,
				endIndex: err.endIndex,
			});
			setHighlightedParagraph(paraIndex);

			setTimeout(() => {
				// 阶段 2：替换文本
				setApplyAnimation({
					chapterId,
					paragraphIndex: paraIndex, // 使用原始段落索引，与阅读区保持一致
					phase: "replacing",
					errorId: err.id,
					originalText: err.originalText,
					correctedText: err.correctedText,
					startIndex: err.startIndex,
					endIndex: err.endIndex,
				});

				const replaced = replaceParagraphText(
					chapterId,
					paraIndex,
					err.originalText,
					err.correctedText,
					err.startIndex,
					err.endIndex,
				);
				toggleErrorApplied(chapterId, paraIndex, err.id); // 使用原始段落索引

				if (!replaced) {
					// AI 返回的文本在段落中找不到，显示错误提示
					addToast("error", `采纳失败："${err.originalText}" 不在当前段落中`);
				} else {
					addToast("success", "已采纳修改");
				}

				setTimeout(() => {
					// 阶段 3：高亮新文本（精确到替换后的位置）
					// 替换后新文本的位置应该重新计算，因为新文本长度可能与原文本不同
					const newStartIndex = err.startIndex;
					const newEndIndex = err.startIndex + err.correctedText.length;

					setApplyAnimation({
						chapterId,
						paragraphIndex: paraIndex, // 使用原始段落索引，与阅读区保持一致
						phase: "highlight-new",
						errorId: err.id,
						originalText: err.originalText,
						correctedText: err.correctedText,
						startIndex: newStartIndex,
						endIndex: newEndIndex,
					});

					setTimeout(() => {
						// 动画结束，解锁
						setApplyAnimation(null);
						animatingRef.current = false;
					}, ANIM_NEW_MS);
				}, ANIM_REPLACE_MS);
			}, ANIM_OLD_MS);
		},
		[
			replaceParagraphText,
			toggleErrorApplied,
			setApplyAnimation,
			setHighlightedParagraph,
			addToast,
		],
	);

	/** 批量采纳当前段落的所有错误（从后往前处理避免位置偏移） */
	const handleApplyAll = useCallback(
		(paraResult: (typeof chapterResults)[number]) => {
			// 动画互斥
			if (animatingRef.current) return;

			const state = useAppStore.getState();
			const currentChapter = state.chapters[state.currentChapterIndex];
			if (!currentChapter) return;
			const chapterId = currentChapter.id;
			const paraIndex = paraResult.paragraphIndex;

			// 过滤出未采纳且未跳过的错误
			const pendingErrors = paraResult.errors.filter(
				(e) => !e.applied && !e.skipped,
			);
			if (pendingErrors.length === 0) {
				addToast("info", "没有可采纳的错误");
				return;
			}

			animatingRef.current = true;

			// 批量替换（内部已按位置从后往前排序）
			const errorsToReplace = pendingErrors.map((e) => ({
				oldText: e.originalText,
				newText: e.correctedText,
				startIndex: e.startIndex,
				endIndex: e.endIndex,
			}));

			const replacedCount = replaceParagraphTextBatch(
				chapterId,
				paraIndex,
				errorsToReplace,
			);

			// 更新所有错误状态为已采纳（使用原始段落索引）
			applyAllErrors(chapterId, paraIndex);

			if (replacedCount === pendingErrors.length) {
				addToast("success", `已采纳全部 ${replacedCount} 处错误`);
			} else if (replacedCount > 0) {
				addToast("warning", `部分采纳：成功 ${replacedCount}/${pendingErrors.length} 处`);
			} else {
				addToast("error", "批量采纳失败：所有错误均无法匹配");
			}

			animatingRef.current = false;
		},
		[replaceParagraphTextBatch, applyAllErrors, addToast],
	);

	/** 跳过/取消跳过单个错误 */
	const handleSkip = useCallback(
		(paraResult: (typeof chapterResults)[number], err: ProofreadError) => {
			const state = useAppStore.getState();
			const currentChapter = state.chapters[state.currentChapterIndex];
			if (!currentChapter) {
				addToast("error", "无法跳过：未找到当前章节");
				return;
			}

			toggleErrorSkipped(currentChapter.id, paraResult.paragraphIndex, err.id);

			if (err.skipped) {
				addToast("success", "已取消跳过");
			} else {
				addToast("info", "已跳过此错误");
			}
		},
		[toggleErrorSkipped, addToast],
	);
	if (!chapter) {
		return (
			<div className="proofread-panel empty">
				<EmptyState icon={<Icons.search size={48} />} message="导入文件后可进行校对检测" />
			</div>
		);
	}

	const totalErrors = chapterResults.reduce(
		(sum, r) => sum + r.errors.length,
		0,
	);
	const remainingErrors = chapterResults.reduce(
		(sum, r) =>
			sum + r.errors.filter((e) => !e.applied && !e.skipped).length,
		0,
	);

	return (
		<div className="proofread-panel">
			<div className="proofread-toolbar">
				<div className="toolbar-left">
					<label className="granularity-select">
						检测项：
						<div className="w-32">
							<Select
								value={granularity}
								onChange={(value) => setGranularity(value as CheckGranularity)}
								options={[
									{ value: 'paragraph', label: '按段落' },
									{ value: 'chapter', label: '按章节' },
								]}
							/>
						</div>
					</label>
					{granularity !== "chapter" && totalLines > 0 && (
						<label className="start-line-select">
							起始行：
							<div className="w-32">
								<Select
									value={String(startLine ?? 0)}
									onChange={(value) => {
										const v = Number(value);
										setStartLine(v === 0 ? null : v);
									}}
									options={[
										{ value: '0', label: '从头开始' },
										...Array.from(
											{ length: Math.min(totalLines, 500) },
											(_, i) => i + 1,
										)
											.filter((n) => n < totalLines)
											.map((n) => ({
												value: String(n),
												label: `第 ${n + 1} 行`,
											})),
									]}
								/>
							</div>
						</label>
					)}
				</div>
				<div className="toolbar-right">
					{totalErrors > 0 && (
						<span className="error-count">
							发现 <strong>{totalErrors}</strong> 个问题
							{remainingErrors < totalErrors && (
								<span className="remaining-count">
									，剩余 <strong>{remainingErrors}</strong> 个未处理
								</span>
							)}
						</span>
					)}
					<button
						className="btn-ignored-words"
						onClick={() => setShowIgnoredWordsModal(true)}
						title="管理忽略单词"
					>
						<Icons.settings size={16} />
					</button>
					{checking ? (
						<button className="btn-cancel" onClick={cancelCheck}>
							取消检测
						</button>
					) : (
						<button className="btn-check" onClick={handleStartCheck}>
							开始检测
						</button>
					)}
				</div>
			</div>

			{/* 忽略单词管理弹窗 */}
			{showIgnoredWordsModal && (
				<IgnoredWordsManager onClose={() => setShowIgnoredWordsModal(false)} />
			)}

			<div className="proofread-content" ref={proofreadContentRef}>
				{displayResults.length === 0 ? (
					<EmptyState
						icon={<Icons.search size={48} />}
						message="点击「开始检测」对当前章节进行 AI 校对"
					/>
				) : (
					displayResults.map((paraResult, i) => (
						<div
							key={paraResult.paragraphIndex}
							ref={(el) => {
								paragraphRefs.current[i] = el;
							}}
							className={`proofread-paragraph ${highlightedParagraph === paraResult.paragraphIndex ? "highlighted" : ""
								}`}
							onClick={() => {
								setHighlightedParagraph(paraResult.paragraphIndex);
								// 点击段落时自动切换起始行到该段落
								if (!checking) {
									setStartLine(paraResult.paragraphIndex === 0 ? null : paraResult.paragraphIndex);
								}
							}}
						>
							<div className="para-original">
								<span className="para-index">
									#{paraResult.paragraphIndex + 1}
								</span>
								{paraResult.originalText.length > 200
									? paraResult.originalText.slice(0, 200) + "…"
									: paraResult.originalText}
								<button
									className="btn-single-check"
									onClick={(e) => {
										e.stopPropagation();
										handleSingleLineCheck(paraResult.paragraphIndex, i);
									}}
									disabled={
										checking ||
										singleCheckingLine !== null ||
										paraResult.status === "checking"
									}
									title="检测此行"
								>
									{singleCheckingLine === i ? "检测中…" : <><Icons.search size={14} /> 检测</>}
								</button>
							</div>

							{paraResult.status === "checking" && (
								<div className="para-status checking">
									<span className="spinner" /> 检测中…
								</div>
							)}
							{paraResult.status === "error" && (
								<div className="para-status error">
									<Icons.error size={14} /> 检测失败：{paraResult.errorMessage}
								</div>
							)}
							{paraResult.status === "done" &&
								paraResult.errors.length === 0 && (
									<div className="para-status success"><Icons.check size={14} /> 未发现问题</div>
								)}
							{paraResult.errors.length > 0 && (
								<div className="para-errors">
									{/* 批量采纳按钮 */}
									<button
										className="btn-apply-all"
										onClick={(e) => {
											e.stopPropagation();
											handleApplyAll(paraResult);
										}}
									>
										<Icons.checkAll size={14} />
										采纳全部 ({paraResult.errors.filter(e => !e.applied && !e.skipped).length})
									</button>
									{paraResult.errors.map((err: ProofreadError) => {
										const typeInfo = ERROR_TYPE_LABELS[err.errorType];
										const IconComponent = typeInfo ? Icons[typeInfo.icon] : null;
										return (
											<div
												key={err.id}
												className={`error-item ${err.applied ? "applied" : ""} ${err.skipped ? "skipped" : ""}`}
											>
												<div className="error-header">
													<span
														className="error-type-badge"
														style={{
															backgroundColor: ERROR_TYPE_COLORS[err.errorType],
														}}
													>
														{IconComponent && <IconComponent size={12} />}
														{typeInfo ? ` ${typeInfo.label}` : err.errorType}
													</span>
													<span className="error-location">
														位置 {err.startIndex}–{err.endIndex}
													</span>
													{err.applied && (
														<span className="applied-badge">已采纳</span>
													)}
													{err.skipped && (
														<span className="skipped-badge">已跳过</span>
													)}
												</div>
												<div className="error-detail">
													<span className="error-original">
														「{err.originalText}」
													</span>
													<span className="error-arrow">→</span>
													<span className="error-suggestion">
														{err.correctedText}
													</span>
												</div>
												{err.suggestion && (
													<div className="error-suggestion-note">
														<Icons.sparkle size={14} /> {err.suggestion}
													</div>
												)}
												<button
													className="btn-apply"
													onClick={(e) => {
														e.stopPropagation();
														handleApply(paraResult, err);
													}}
												>
													{err.applied ? "撤销" : "采纳修改"}
												</button>
												<button
													className="btn-skip"
													onClick={(e) => {
														e.stopPropagation();
														handleSkip(paraResult, err);
													}}
												>
													{err.skipped ? "取消跳过" : "跳过"}
												</button>
											</div>
										);
									})}
								</div>
							)}
						</div>
					))
				)}
			</div>

			{/* Toast 消息提示 */}
			<ToastContainer messages={toastMessages} onClose={removeToast} />
		</div>
	);
}
