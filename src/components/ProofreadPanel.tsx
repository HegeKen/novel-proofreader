// ============================================================
// 右侧校对区（带按行检测 + 采纳动画）
// ============================================================
import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { useNovelStore } from "../stores/novelStore";
import { useProofreadStore } from "../stores/proofreadStore";
import { useAICheck } from "../hooks/useAICheck";
import { useMobile } from "../hooks/useMobile";
import { buildParagraphIndexMap } from "../utils/formatters";
import { EmptyState } from "./EmptyState";
import { splitParagraphs } from "../utils/chapterSplit";
import { Icons } from "./Icons";
import { IgnoredWordsManager } from "./IgnoredWordsManager";
import { ToastContainer } from "./Toast";
import { ProofreadQueuePanel } from "./ProofreadQueuePanel";
import { logger } from "../utils/logger";
import type { ToastMessage } from "./Toast";
import type { CheckGranularity, ProofreadError } from "../types";


const ERROR_TYPE_LABELS: Record<string, { icon: keyof typeof Icons; label: string }> = {
	typo: { icon: "typo", label: "错别字" },
	format: { icon: "grammar", label: "排版" },
	grammar: { icon: "grammar", label: "病句" },
	punctuation: { icon: "punctuation", label: "标点" },
	network: { icon: "alertCircle", label: "网络错误" },
};

const ERROR_TYPE_COLORS: Record<string, string> = {
	typo: "#ff4d4f",
	format: "#faad14",
	grammar: "#1677ff",
	punctuation: "#52c41a",
	network: "#722ed1",
};

/** 采纳动画时长（ms） */
const ANIM_OLD_MS = 600;
const ANIM_REPLACE_MS = 300;
const ANIM_NEW_MS = 1200;

export function ProofreadPanel() {
	const { isMobile } = useMobile();
	
	const chapters = useNovelStore((s) => s.chapters);
	const currentChapterIndex = useNovelStore((s) => s.currentChapterIndex);
	const setCurrentChapterIndex = useNovelStore((s) => s.setCurrentChapterIndex);
	const replaceParagraphText = useNovelStore((s) => s.replaceParagraphText);
	const results = useProofreadStore((s) => s.results);
	const setResults = useProofreadStore((s) => s.setResults);
	const highlightedParagraph = useProofreadStore((s) => s.highlightedParagraph);
	const setHighlightedParagraph = useProofreadStore(
		(s) => s.setHighlightedParagraph,
	);
	const toggleErrorApplied = useProofreadStore((s) => s.toggleErrorApplied);
	const toggleErrorSkipped = useProofreadStore((s) => s.toggleErrorSkipped);
	const setApplyAnimation = useProofreadStore((s) => s.setApplyAnimation);
	const updateErrorIndices = useProofreadStore((s) => s.updateErrorIndices);

	const startLine = useProofreadStore((s) => s.startLine);
	const setStartLine = useProofreadStore((s) => s.setStartLine);
	const ttsPlaying = useProofreadStore((s) => s.ttsPlaying);
	const ttsHighlightedPara = useProofreadStore((s) => s.ttsHighlightedPara);

	const { checkChapter, cancelCheck, checkSingleLine } = useAICheck();
	const [granularity, setGranularity] = useState<CheckGranularity>("paragraph");
	const [checking, setChecking] = useState(false);
	const [singleCheckingLine, setSingleCheckingLine] = useState<number | null>(
		null,
	);
	const [showIgnoredWordsModal, setShowIgnoredWordsModal] = useState(false);
	const [showQueuePanel, setShowQueuePanel] = useState(false);
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
	
	// 计算已检测完成的段落数
	const checkedLines = useMemo(() => {
		return chapterResults.filter((r) => r.status === "done" || r.status === "error").length;
	}, [chapterResults]);
	
	// 计算进度百分比
	const progressPercent = useMemo(() => {
		if (totalLines === 0) return 0;
		return Math.round((checkedLines / totalLines) * 100);
	}, [checkedLines, totalLines]);

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
		// 将原始索引转换为过滤后索引
		const filteredStartLine = startLine !== null ? paragraphIndexMap.indexOf(startLine) : -1;
		const actualStartLine = filteredStartLine >= 0 ? filteredStartLine : 0;
		logger.proofread(`handleStartCheck 开始检测: granularity=${granularity}, startLine(原始)=${startLine ?? 0}, filteredStartLine=${actualStartLine}, totalLines=${totalLines}`);
		await checkChapter(granularity, actualStartLine);
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

		logger.proofread(`scrollToParagraph: index=${index}, el=${!!el}, container=${!!container}`);
		
		if (!el || !container) {
			logger.ui(
				`scrollToParagraph failed: el=${!!el}, container=${!!container}, index=${index}`,
			);
			return;
		}

		// 使用 scrollIntoView 方法，这是最可靠的方式
		logger.proofread(`scrollToParagraph: calling scrollIntoView`);
		el.scrollIntoView({
			behavior: 'smooth',
			block: 'center',
			inline: 'nearest'
		});
	}, []);

	// 监听 highlightedParagraph 变化，自动滚动到对应段落
	useEffect(() => {
		if (highlightedParagraph !== null) {
			logger.proofread(`highlightedParagraph changed: ${highlightedParagraph}`);
			setTimeout(() => {
				scrollToParagraph(highlightedParagraph);
			}, 50);
		}
	}, [highlightedParagraph, scrollToParagraph]);

	// TTS 高亮段落变化时自动滚动
	useEffect(() => {
		if (ttsHighlightedPara !== -1) {
			logger.tts(
				`highlighted paragraph changed: ${ttsHighlightedPara}`,
			);
			setTimeout(() => {
				scrollToParagraph(ttsHighlightedPara);
			}, 50);
		}
	}, [ttsHighlightedPara, scrollToParagraph]);

	// 当切换章节时，重置高亮段落
	useEffect(() => {
		setHighlightedParagraph(null);
	}, [currentChapterIndex, setHighlightedParagraph]);

	// 切换章节时滚动到顶部
	useEffect(() => {
		const container = proofreadContentRef.current;
		if (container) {
			container.scrollTop = 0;
		}
	}, [currentChapterIndex]);

	/** 采纳单个错误：高亮旧文本 → 替换 → 高亮新文本 */
	const handleApply = useCallback(
		(
			paraResult: (typeof chapterResults)[number],
			err: ProofreadError,
		) => {
			// 动画互斥：上一个动画还没结束时禁止操作
			if (animatingRef.current) return;

			// 通过 getState() 获取最新 chapter，避免闭包过期
			const state = useNovelStore.getState();
			const currentChapter = state.chapters[state.currentChapterIndex];
			if (!currentChapter) return;
			const chapterId = currentChapter.id;
			const paraIndex = paraResult.paragraphIndex;

			// 记录采纳前状态
			const beforeState = {
				currentNovelId: state.currentNovelId,
				currentChapterIndex: state.currentChapterIndex,
				chaptersLength: state.chapters.length,
				chapterId,
				paraIndex,
				action: err.applied ? '撤销' : '采纳',
				errorId: err.id,
				timestamp: Date.now()
			};
			console.log('[handleApply] 采纳前状态:', JSON.stringify(beforeState, null, 2));

			// 如果已采纳则撤销（把文本换回去）
			if (err.applied) {
				const ok = replaceParagraphText(
					chapterId,
					paraIndex,
					err.correctedText,
					err.originalText,
					err.startIndex,
					err.endIndex,
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
				logger.proofread(`采纳修改: chapterId=${chapterId}, paraIndex=${paraIndex}, original="${err.originalText}", corrected="${err.correctedText}", success=${replaced}`);
				toggleErrorApplied(chapterId, paraIndex, err.id); // 使用原始段落索引

				// 记录采纳后状态
				const afterState = useNovelStore.getState();
				console.log('[handleApply] 采纳后状态:', JSON.stringify({
					currentNovelId: afterState.currentNovelId,
					currentChapterIndex: afterState.currentChapterIndex,
					chaptersLength: afterState.chapters.length,
					replaced,
					timestamp: Date.now()
				}, null, 2));

				// 更新同段落中剩余错误的索引（每次替换后都要更新，确保位置准确）
				if (replaced) {
					const lengthDiff = err.correctedText.length - err.originalText.length;
					updateErrorIndices(chapterId, paraIndex, err.startIndex, lengthDiff);
				}

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
			updateErrorIndices,
		],
	);

	/** 忽略/取消忽略单个错误 */
	const handleSkip = useCallback(
		(paraResult: (typeof chapterResults)[number], err: ProofreadError) => {
			const state = useNovelStore.getState();
			const currentChapter = state.chapters[state.currentChapterIndex];
			if (!currentChapter) {
				addToast("error", "无法忽略：未找到当前章节");
				return;
			}

			toggleErrorSkipped(currentChapter.id, paraResult.paragraphIndex, err.id);

			if (err.skipped) {
				addToast("success", "已取消忽略");
			} else {
				addToast("info", "已忽略此错误");
			}
		},
		[toggleErrorSkipped, addToast],
	);

	// 查找第一个未处理错误所在的段落索引
	const findFirstUnhandledErrorParagraph = useCallback(() => {
		if (!chapter) {
			logger.proofread(`findFirstUnhandledErrorParagraph: chapter is null`);
			return null;
		}
		logger.proofread(`findFirstUnhandledErrorParagraph: checking ${chapterResults.length} results`);
		for (const result of chapterResults) {
			const hasUnhandledError = result.errors.some(
				(e) => !e.applied && !e.skipped,
			);
			if (hasUnhandledError) {
				logger.proofread(`findFirstUnhandledErrorParagraph: found at index ${result.paragraphIndex}`);
				return result.paragraphIndex;
			}
		}
		logger.proofread(`findFirstUnhandledErrorParagraph: no unhandled errors found`);
		return null;
	}, [chapter, chapterResults]);

	// 点击错误计数时跳转到第一个未处理错误的段落
	const handleErrorCountClick = useCallback(() => {
		logger.proofread(`handleErrorCountClick triggered`);
		const firstUnhandledIndex = findFirstUnhandledErrorParagraph();
		logger.proofread(`handleErrorCountClick: firstUnhandledIndex = ${firstUnhandledIndex}`);
		if (firstUnhandledIndex !== null) {
			logger.proofread(`handleErrorCountClick: calling setHighlightedParagraph(${firstUnhandledIndex})`);
			setHighlightedParagraph(firstUnhandledIndex);
		}
	}, [findFirstUnhandledErrorParagraph, setHighlightedParagraph]);

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
			<div className="proofread-header">
				<div className="proofread-toolbar">
					<div className="toolbar-row toolbar-row-1">
						<div className="toolbar-row-left">
							<label className="granularity-select">
								检测项：
								<div className="detection-options">
									<label className="detection-option">
										<input
											type="checkbox"
											checked={granularity === 'chapter'}
											onChange={() => setGranularity(granularity === 'chapter' ? 'paragraph' : 'chapter')}
										/>
										<span>按章节</span>
									</label>
								</div>
							</label>
							{granularity !== "chapter" && totalLines > 0 && (
								<label className="start-line-display">
									起始行：
									<span className="start-line-value">
										{startLine !== null ? `第 ${startLine + 1} 行` : '从头开始'}
									</span>
								</label>
							)}
						</div>
						<div className="toolbar-row-right">
							{chapters.length > 1 && (
								<>
									<button
										className={isMobile ? "btn-mobile" : "btn"}
										disabled={currentChapterIndex <= 0}
										onClick={() => setCurrentChapterIndex(currentChapterIndex - 1)}
										title={currentChapterIndex > 0 ? (chapters[currentChapterIndex - 1]?.title || `第 ${currentChapterIndex} 章`) : "已是第一章"}
									>
										<Icons.skipBack size={16} />
									</button>
									<button
										className={isMobile ? "btn-mobile" : "btn"}
										disabled={currentChapterIndex >= chapters.length - 1}
										onClick={() => setCurrentChapterIndex(currentChapterIndex + 1)}
										title={currentChapterIndex < chapters.length - 1 ? (chapters[currentChapterIndex + 1]?.title || `第 ${currentChapterIndex + 2} 章`) : "已是最后一章"}
									>
										<Icons.skipForward size={16} />
									</button>
								</>
							)}
						</div>
					</div>
					<div className="toolbar-row toolbar-row-2">
						<div className="toolbar-row-left">
							{totalErrors > 0 && (
								<span
									className={`error-count${remainingErrors > 0 ? " clickable" : ""}`}
									onClick={handleErrorCountClick}
								>
									发现 <strong>{totalErrors}</strong> 个问题
									{remainingErrors < totalErrors && (
										<span className="remaining-count">
											，剩余 <strong>{remainingErrors}</strong> 个未处理
										</span>
									)}
								</span>
							)}
						</div>
						<div className="toolbar-row-right">
							<button
								className={isMobile ? "btn-mobile" : "btn"}
								onClick={() => setShowQueuePanel(!showQueuePanel)}
								title="批量校对队列"
							>
								<Icons.listTodo size={16} />
							</button>
							<button
								className={isMobile ? "btn-mobile" : "btn"}
								onClick={() => setShowIgnoredWordsModal(true)}
								title="管理忽略单词"
							>
								<Icons.settings size={16} />
							</button>
							{checking ? (
								<button className={isMobile ? "btn-mobile" : "btn"} onClick={cancelCheck}>
									<Icons.close size={16} />
								</button>
							) : (
								<button className={isMobile ? "btn-mobile" : "btn"} onClick={handleStartCheck}>
									<Icons.play size={16} />
								</button>
							)}
						</div>
					</div>
				</div>

			{/* 校对进度条 - 放在 toolbar 下面 */}
			{(checking || checkedLines > 0) && (
				<div className="proofread-progress-bar">
					<div 
						className="progress-fill" 
						style={{ width: `${progressPercent}%` }}
					></div>
				</div>
			)}
		</div>

		{/* 忽略单词管理弹窗 */}
		{showIgnoredWordsModal && (
			<IgnoredWordsManager onClose={() => setShowIgnoredWordsModal(false)} />
		)}

		{/* 批量校对队列面板 */}
		{showQueuePanel && (
				<div className="queue-panel-overlay" onClick={() => setShowQueuePanel(false)}>
					<div className="queue-panel" onClick={(e) => e.stopPropagation()}>
						<div className="config-header">
							<div className="config-title">
								<Icons.listTodo size={18} />
								<span>批量校对队列</span>
							</div>
							<button
								className="close-btn"
								onClick={() => setShowQueuePanel(false)}
							>
								<svg
									width="16"
									height="16"
									viewBox="0 0 16 16"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
								>
									<path d="M3 3L13 13M13 3L3 13" />
								</svg>
							</button>
						</div>
						<ProofreadQueuePanel />
					</div>
				</div>
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
								paragraphRefs.current[paraResult.paragraphIndex] = el;
							}}
							className={`proofread-paragraph ${ttsPlaying && ttsHighlightedPara === paraResult.paragraphIndex ? "tts-highlighted" : highlightedParagraph === paraResult.paragraphIndex ? "highlighted" : ""}`}
							onClick={() => {
								setHighlightedParagraph(paraResult.paragraphIndex);
								// 点击段落时自动切换起始行到该段落
								if (!checking) {
									// 设置原始段落索引（ReaderPanel 使用原始索引进行比较）
									setStartLine(paraResult.paragraphIndex);
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
														<span className="skipped-badge">已忽略</span>
													)}
												</div>
												<div className="error-detail">
													<span className="error-original">
														{err.originalText}
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
													{err.skipped ? "取消忽略" : "忽略"}
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
