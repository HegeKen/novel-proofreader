import { useRef, useEffect, useCallback, useState, useMemo } from "react";
import { useNovelStore } from "../stores/novelStore";
import { useUIStore } from "../stores/uiStore";
import { useCharacterStore } from "../stores/characterStore";
import { useProofreadStore } from "../stores/proofreadStore";
import { useConfigStore } from "../stores/configStore";
import { useAppMetaStore } from "../stores/appMetaStore";
import { splitParagraphs } from "../utils/chapterSplit";
import { buildParagraphIndexMap, buildOriginalToFilteredMap } from "../utils/formatters";
import { useTTS } from "../hooks/useTTS";
import { useSearch } from "../hooks/useSearch";
import { useReadingProgress } from "../hooks/useReadingProgress";
import { useChapterTitleSuggestion } from "../hooks/useChapterTitleSuggestion";
import { EmptyState } from "./EmptyState";
import { Icons } from "./Icons";
import { Select } from "./Select";
import { logger } from "../utils/logger";

export function ReaderPanel({
	showReadingModeToggle = false,
	isMobile = false,
}: { showReadingModeToggle?: boolean; isMobile?: boolean } = {}) {
	const chapters = useNovelStore((s) => s.chapters);
	const currentChapterIndex = useNovelStore((s) => s.currentChapterIndex);
	const currentNovelId = useNovelStore((s) => s.currentNovelId);
	const setCurrentChapterIndex = useNovelStore((s) => s.setCurrentChapterIndex);
	const replaceLine = useNovelStore((s) => s.replaceLine);
	const fontSize = useUIStore((s) => s.fontSize);
	const setFontSize = useUIStore((s) => s.setFontSize);
	const readingMode = useUIStore((s) => s.readingMode);
	const setReadingMode = useUIStore((s) => s.setReadingMode);
	const lineSpacing = useUIStore((s) => s.lineSpacing);
	const setLineSpacing = useUIStore((s) => s.setLineSpacing);
	const paragraphIndent = useUIStore((s) => s.paragraphIndent);
	const setParagraphIndent = useUIStore((s) => s.setParagraphIndent);
	const readingBackground = useUIStore((s) => s.readingBackground);
	const setReadingBackground = useUIStore((s) => s.setReadingBackground);
	const customTextColor = useUIStore((s) => s.customTextColor);
	const customBgColor = useUIStore((s) => s.customBgColor);
	const setCustomColors = useUIStore((s) => s.setCustomColors);
	const bgImageUrl = useUIStore((s) => s.bgImageUrl);
	const setBgImageUrl = useUIStore((s) => s.setBgImageUrl);
	const addCharacter = useCharacterStore((s) => s.addCharacter);
	const highlightedParagraph = useProofreadStore((s) => s.highlightedParagraph);
	const setHighlightedParagraph = useProofreadStore((s) => s.setHighlightedParagraph);
	const applyAnimation = useProofreadStore((s) => s.applyAnimation);
	const startLine = useProofreadStore((s) => s.startLine);
	const setStartLine = useProofreadStore((s) => s.setStartLine);
	const readingReminderEnabled = useAppMetaStore((s) => s.readingReminderEnabled);
	const setReadingReminderEnabled = useAppMetaStore((s) => s.setReadingReminderEnabled);
	const readingReminderMinutes = useAppMetaStore((s) => s.readingReminderMinutes);
	const setReadingReminderMinutes = useAppMetaStore((s) => s.setReadingReminderMinutes);
	const ttsConfig = useConfigStore((s) => s.ttsConfig);
	const updateTTSConfig = useConfigStore((s) => s.updateTTSConfig);

	const tts = useTTS();
	const readingProgress = useReadingProgress();
	const chapterTitleSuggestion = useChapterTitleSuggestion();

	const setTtsPlaying = useProofreadStore((s) => s.setTtsPlaying);
	const setTtsHighlightedPara = useProofreadStore((s) => s.setTtsHighlightedPara);

	useEffect(() => {
		setTtsPlaying(tts.ttsPlaying || tts.isStreamTTSPlaying);
	}, [tts.ttsPlaying, tts.isStreamTTSPlaying, setTtsPlaying]);

	useEffect(() => {
		setTtsHighlightedPara(tts.ttsHighlightedPara);
	}, [tts.ttsHighlightedPara, setTtsHighlightedPara]);

	const containerRef = useRef<HTMLDivElement>(null);
	const paragraphRefs = useRef<(HTMLDivElement | null)[]>([]);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const chapterListContentRef = useRef<HTMLDivElement>(null);
	const activeChapterItemRef = useRef<HTMLDivElement>(null);

	const chapter = chapters[currentChapterIndex];
	const paragraphs = useMemo(() => {
		return chapter ? splitParagraphs(chapter.content).filter((p) => p.trim() !== "") : [];
	}, [chapter]);

	const paragraphIndexMap = useMemo(() => {
		return chapter ? buildParagraphIndexMap(chapter.content) : [];
	}, [chapter]);

	const search = useSearch(paragraphs, paragraphIndexMap);

	const originalToFilteredMap = useMemo(() => {
		return chapter ? buildOriginalToFilteredMap(chapter.content) : {};
	}, [chapter]);

	const readingTextColor = useMemo(() => {
		if (!readingMode) return undefined;
		switch (readingBackground) {
			case "dark":
				return "#E0E0E0";
			case "mint":
				return "#2E4A3E";
			case "sky":
				return "#1565C0";
			case "lavender":
				return "#6A1B9A";
			case "peach":
				return "#B71C1C";
			case "sage":
				return "#4E342E";
			case "slate":
				return "#37474F";
			case "custom":
				return customTextColor;
			default:
				return "#333333";
		}
	}, [readingMode, readingBackground, customTextColor]);

	useEffect(() => {
		const container = containerRef.current;
		if (container && readingMode) {
			container.style.setProperty('--line-height', `${lineSpacing}px`);
			container.style.setProperty('--font-size', `${fontSize}px`);
			container.style.setProperty('--text-indent', `${paragraphIndent}em`);
			container.style.setProperty('--text-color', readingTextColor || '#333333');
		}
	}, [lineSpacing, fontSize, paragraphIndent, readingTextColor, readingMode]);

	const touchStartY = useRef(0);
	const touchStartX = useRef(0);
	const touchStartScrollTop = useRef(0);
	const isDragging = useRef(false);
	const isScrolling = useRef(false);

	const [editingIndex, setEditingIndex] = useState<number | null>(null);
	const [editValue, setEditValue] = useState("");
	const [showReadingSettings, setShowReadingSettings] = useState(false);
	const [showChapterList, setShowChapterList] = useState(false);
	const [showTTSPanel, setShowTTSPanel] = useState(false);
	const [pageFlipping, setPageFlipping] = useState<'none' | 'next' | 'prev'>('none');
	const [showPageShadow, setShowPageShadow] = useState(false);
	const [detectedNewCharacters, setDetectedNewCharacters] = useState<string[]>([]);
	const [showNewCharacterModal, setShowNewCharacterModal] = useState(false);

	const {
		ttsPlaying, ttsHighlightedPara, isStreamTTSPlaying, enhancedTTSPreparing,
		isStreamTTSWaitingForStart, currentPlayingCharacter, remainingSeconds,
		handleTTSToggle, handleTTSPrev, handleTTSNext, handleTTSStop,
		startTTSFromParagraph, handleEnterStreamTTSSelectionMode, handleEnhancedChapterTTS,
		setIsStreamTTSWaitingForStart, setParagraphEmotionCache,
	} = tts;

	const {
		showSearch, setShowSearch, searchQuery, setSearchQuery,
		searchResults, currentMatchIndex, performSearch,
		prevMatch, nextMatch, handleSearchResultClick, closeSearch,
	} = search;

	const {
		setCurrentParagraphIndex,
		readingTimeElapsed,
		showReadingReminder, setShowReadingReminder,
		readingProgressPercent, estimatedRemainingMinutes,
		startReadingTimer, stopReadingTimer,
	} = readingProgress;

	const {
		suggestingChapterId: suggestingId, chapterTitleSuggestions,
		handleSuggestChapterTitle, handleApplyChapterTitle,
	} = chapterTitleSuggestion;

	// 当章节列表弹窗打开时，滚动到 active 项并居中
	useEffect(() => {
		if (showChapterList && activeChapterItemRef.current && chapterListContentRef.current) {
			setTimeout(() => {
				if (activeChapterItemRef.current && chapterListContentRef.current) {
					const container = chapterListContentRef.current;
					const activeItem = activeChapterItemRef.current;
					const containerRect = container.getBoundingClientRect();
					const itemRect = activeItem.getBoundingClientRect();
					const relativeTop = itemRect.top - containerRect.top;
					const targetScrollTop = container.scrollTop + relativeTop - container.offsetHeight / 2 + itemRect.height / 2;
					container.scrollTo({ top: Math.max(0, targetScrollTop), behavior: 'smooth' });
				}
			}, 50);
		}
	}, [showChapterList]);

	const handleAddNewCharacters = useCallback((names: string[]) => {
		if (!currentNovelId) return;
		names.forEach(name => {
			addCharacter(currentNovelId, { name, gender: "other", notes: "自动检测创建", voice: "", aliases: [], relationTerms: [] });
		});
		setShowNewCharacterModal(false);
		setDetectedNewCharacters([]);
	}, [currentNovelId, addCharacter]);

	/** 进入编辑模式 */
	const startEditing = useCallback((index: number, currentText: string) => {
		setEditingIndex(index);
		setEditValue(currentText);
	}, []);

	/** 保存编辑 */
	const saveEditing = useCallback(() => {
		if (editingIndex === null || !chapter) return;
		const originalIndex = paragraphIndexMap[editingIndex];
		if (editValue !== paragraphs[editingIndex]) {
			replaceLine(chapter.id, originalIndex, editValue);
		}
		setEditingIndex(null);
	}, [
		editingIndex,
		editValue,
		chapter,
		paragraphs,
		replaceLine,
		paragraphIndexMap,
	]);



	/** textarea 键盘事件：Ctrl+Enter 保存，Escape 取消 */
	const cancelEditing = useCallback(() => {
		setEditingIndex(null);
	}, []);

	// 编辑模式下自动聚焦并调整 textarea 高度
	useEffect(() => {
		if (editingIndex !== null && textareaRef.current) {
			const ta = textareaRef.current;
			ta.focus();
			ta.selectionStart = ta.value.length;
			// 自动撑高
			ta.style.height = "auto";
			ta.style.height = ta.scrollHeight + "px";
		}
	}, [editingIndex]);

	// 阅读计时器
	useEffect(() => {
		if (readingMode) {
			startReadingTimer(readingReminderEnabled, readingReminderMinutes);
		}

		return () => {
			stopReadingTimer();
		};
	}, [readingMode, readingReminderEnabled, readingReminderMinutes, startReadingTimer, stopReadingTimer]);

	/** textarea 内容变化时自动撑高 */
	const handleTextareaInput = useCallback(
		(e: React.ChangeEvent<HTMLTextAreaElement>) => {
			setEditValue(e.target.value);
			const ta = e.target;
			ta.style.height = "auto";
			ta.style.height = ta.scrollHeight + "px";
		},
		[],
	);

	/** textarea 键盘事件：Ctrl+Enter 保存，Escape 取消 */
	const handleTextareaKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
			if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				saveEditing();
			} else if (e.key === "Escape") {
				e.preventDefault();
				cancelEditing();
			}
		},
		[saveEditing, cancelEditing],
	);

	/** 程序化滚动到指定段落 */
	const scrollToParagraph = useCallback((index: number) => {
		const el = paragraphRefs.current[index];
		const container = containerRef.current;

		if (!el || !container) {
			logger.ui(
				`scrollToParagraph failed: el=${!!el}, container=${!!container}, index=${index}`,
			);
			return;
		}

		logger.proofread(`scrollToParagraph: index=${index}`);

		// 计算元素相对于容器的位置
		const containerRect = container.getBoundingClientRect();
		const elementRect = el.getBoundingClientRect();
		
		// 计算元素相对于容器顶部的偏移
		const elementOffsetTop = elementRect.top - containerRect.top + container.scrollTop;
		
		// 计算滚动目标位置，使元素居中
		const scrollTarget = elementOffsetTop - (containerRect.height / 2) + (elementRect.height / 2);
		
		// 使用平滑滚动
		container.scrollTo({
			top: scrollTarget,
			behavior: "smooth"
		});
	}, []);

	useEffect(() => {
		if (highlightedParagraph !== null) {
			logger.proofread(`highlightedParagraph changed: ${highlightedParagraph}`);
			// 使用 setTimeout 确保 DOM 已经渲染完成
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
			// 将过滤后的索引转换为原始索引
			const originalIndex = paragraphIndexMap[ttsHighlightedPara];
			logger.tts(
				`highlighted original index: ${originalIndex}`,
			);
			if (originalIndex !== undefined) {
				setTimeout(() => {
					scrollToParagraph(originalIndex);
				}, 50);
			}
		}
	}, [ttsHighlightedPara, scrollToParagraph, paragraphIndexMap]);

	// 当切换章节时，重置高亮段落
	useEffect(() => {
		setHighlightedParagraph(null);
	}, [currentChapterIndex, setHighlightedParagraph]);

	useEffect(() => {
		if (applyAnimation) {
			scrollToParagraph(applyAnimation.paragraphIndex);
		}
	}, [applyAnimation, scrollToParagraph]);



	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		container.scrollTop = 0;
		paragraphRefs.current = [];
		// 清除段落情感缓存，避免不同章节之间的缓存混淆
		setParagraphEmotionCache(new Map());
		logger.tts("切换章节，清除段落情感缓存");
	}, [currentChapterIndex, setParagraphEmotionCache]);

	// 阅读模式下，监听滚动自动更新阅读进度
	useEffect(() => {
		if (!readingMode) return;

		const container = containerRef.current;
		if (!container) return;

		// 创建 Intersection Observer，检测进入视口的段落
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						const paragraphEl = entry.target as HTMLElement;
						// 获取段落索引（从元素的 data 属性）
						const originalIndex = parseInt(paragraphEl.getAttribute('data-original-index') || '-1');
						if (originalIndex >= 0) {
							// 找到对应的过滤后索引
							const filteredIndex = paragraphIndexMap.indexOf(originalIndex);
							if (filteredIndex >= 0) {
								setCurrentParagraphIndex(filteredIndex);
							}
						}
					}
				}
			},
			{
				root: container,
				rootMargin: '0px 0px -50% 0px',
				threshold: 0.3,
			}
		);

		// 等待 DOM 更新后再观察段落
		const observerTimer = setTimeout(() => {
			const paragraphEls = container.querySelectorAll('.reader-paragraph');
			paragraphEls.forEach((el) => {
				observer.observe(el);
			});
		}, 100);

		return () => {
			clearTimeout(observerTimer);
			observer.disconnect();
		};
	}, [readingMode, currentChapterIndex, paragraphIndexMap, setCurrentParagraphIndex]);

	// 滑动翻页功能
	const handleTouchStart = useCallback((e: React.TouchEvent) => {
		touchStartY.current = e.touches[0].clientY;
		touchStartX.current = e.touches[0].clientX;
		const container = containerRef.current;
		if (container) {
			touchStartScrollTop.current = container.scrollTop;
		}
		isDragging.current = true;
		isScrolling.current = false;
	}, []);

	// 触发翻页动画
	const triggerPageFlip = useCallback((direction: 'next' | 'prev') => {
		setShowPageShadow(true);
		setPageFlipping(direction);
		setTimeout(() => {
			setPageFlipping('none');
			setShowPageShadow(false);
		}, 400);
	}, []);

	const handleTouchMove = useCallback(
		(e: React.TouchEvent) => {
			if (!isDragging.current) return;

			const container = containerRef.current;
			if (!container) return;

			const currentY = e.touches[0].clientY;
			const currentX = e.touches[0].clientX;
			const deltaY = currentY - touchStartY.current;
			const deltaX = currentX - touchStartX.current;

			// 如果移动超过一定阈值，认为是滚动操作，不是点击
			if (!isScrolling.current && (Math.abs(deltaY) > 10 || Math.abs(deltaX) > 10)) {
				isScrolling.current = true;
			}

			// 检测是否到达顶部或底部
			const isAtTop = touchStartScrollTop.current === 0;
			const isAtBottom =
				container.scrollHeight - container.scrollTop <=
				container.clientHeight + 10;

			// 在顶部下滑（deltaY > 0），进入上一章并定位到底部
			if (isAtTop && deltaY > 50 && currentChapterIndex > 0) {
				isDragging.current = false;
				triggerPageFlip('prev');
				setTimeout(() => {
					setCurrentChapterIndex(currentChapterIndex - 1);
				}, 200);
				setTimeout(() => {
					const newContainer = containerRef.current;
					if (newContainer) {
						newContainer.scrollTop = newContainer.scrollHeight;
					}
				}, 300);
			}
			// 在底部上滑（deltaY < 0），进入下一章并定位到顶部
			else if (
				isAtBottom &&
				deltaY < -50 &&
				currentChapterIndex < chapters.length - 1
			) {
				isDragging.current = false;
				triggerPageFlip('next');
				setTimeout(() => {
					setCurrentChapterIndex(currentChapterIndex + 1);
				}, 200);
			}
		},
		[currentChapterIndex, chapters.length, setCurrentChapterIndex, triggerPageFlip],
	);

	const handleTouchEnd = useCallback(() => {
		isDragging.current = false;
	}, []);

	if (!chapter) {
		return (
			<div className="reader-panel empty">
				<EmptyState icon={<Icons.book size={48} />} message="请导入 TXT 小说文件开始阅读" />
			</div>
		);
	}

	return (
		<div className="reader-panel">
			<div className="reader-toolbar">
				<span
					className="chapter-title"
					onClick={() => setShowChapterList(true)}
				>
					{chapter.title || ""}
					<Icons.chevronDown size={14} className="chapter-dropdown-icon" />
				</span>
				{showReadingModeToggle && (
					<div className="reading-mode-toggle">
						<span className="toggle-label">
							<Icons.book size={14} />
							阅读模式
						</span>
						<label className="toggle-switch">
							<input
								type="checkbox"
								checked={readingMode}
								onChange={(e) => setReadingMode(e.target.checked)}
							/>
							<span className="toggle-slider"></span>
						</label>
					</div>
				)}
				<button
					className={isMobile ? "btn-mobile" : "btn"}
					onClick={() => setShowSearch(true)}
				>
					<Icons.search size={18} />
					{!isMobile && <span>搜索</span>}
				</button>
			</div>
			<div className="reader-progress-bar">
				<div 
					className="reader-progress-fill" 
					style={{ width: `${readingProgressPercent}%` }}
				></div>
			</div>
			<div
				className={`reader-content${readingMode ? " reading-mode" : ""}${pageFlipping !== 'none' ? ` flipping-${pageFlipping}` : ''}`}
				ref={containerRef}
				onTouchStart={handleTouchStart}
				onTouchMove={handleTouchMove}
				onTouchEnd={handleTouchEnd}
				onClick={(e) => {
					if (!showReadingSettings) return;
					const target = e.target as HTMLElement;
					if (
						target.closest(".reading-settings-panel") ||
						target.closest(".reading-settings-toggle")
					) {
						return;
					}
					setShowReadingSettings(false);
				}}
				style={{
					...(readingMode && {
						backgroundColor:
							readingBackground === "white"
								? "#FFFFFF"
								: readingBackground === "cream"
									? "#FDF6E3"
									: readingBackground === "sepia"
										? "#F4E4BC"
										: readingBackground === "mint"
											? "#E8F5E9"
											: readingBackground === "sky"
												? "#E3F2FD"
												: readingBackground === "lavender"
													? "#F3E5F5"
													: readingBackground === "peach"
														? "#FFEBEE"
														: readingBackground === "sage"
															? "#EFEBE9"
															: readingBackground === "slate"
																? "#ECEFF1"
																: readingBackground === "dark"
																	? "#2C2C2C"
																	: readingBackground === "custom"
																		? customBgColor
																		: undefined,
						backgroundImage:
							readingBackground === "image" ? `url(${bgImageUrl})` : undefined,
						backgroundSize: readingBackground === "image" ? "cover" : undefined,
						backgroundPosition:
							readingBackground === "image" ? "center" : undefined,
					}),
				}}
			>
				{/* 翻页阴影效果 */}
				{showPageShadow && (
					<div className="reader-page-overlay active">
						<div className={`reader-page-shadow-${pageFlipping === 'next' ? 'left' : 'right'}`}></div>
					</div>
				)}
				{/* 流式AI情感增强 - 等待选择段落提示 */}
				{isStreamTTSWaitingForStart && (
					<div className="tts-selection-hint">
						<div className="tts-selection-hint-content">
							<Icons.volume size={20} />
							<span>情感朗读模式：请点击想要开始朗读的段落</span>
						</div>
						<button
							className="tts-selection-hint-cancel"
							onClick={() => setIsStreamTTSWaitingForStart(false)}
						>
							<Icons.close size={16} />
						</button>
					</div>
				)}
				{paragraphs.map((para, filteredIndex) => {
					// 获取原始段落索引（与校对区一致）
					const originalIndex = paragraphIndexMap[filteredIndex];
					
					const isAnimTarget =
						!readingMode &&
						applyAnimation?.chapterId === chapter.id &&
						applyAnimation?.paragraphIndex === originalIndex;
					const animClass = isAnimTarget
						? ` anim-${applyAnimation!.phase}`
						: "";
					const isEditing = editingIndex === filteredIndex;

					// 如果是动画目标，提取需要高亮的文本片段
					const getHighlightInfo = () => {
						if (!isAnimTarget || applyAnimation!.startIndex === undefined) {
							return null;
						}

						const isOldPhase =
							applyAnimation!.phase === "highlight-old" ||
							applyAnimation!.phase === "replacing";

						// 旧文本高亮：使用原始索引
						if (isOldPhase) {
							const highlight = para.slice(
								applyAnimation!.startIndex,
								applyAnimation!.endIndex,
							);
							logger.proofread(
								`anim-highlight-old:`,
								`\n  phase: ${applyAnimation!.phase}`,
								`\n  paragraphIndex: ${applyAnimation!.paragraphIndex}`,
								`\n  startIndex: ${applyAnimation!.startIndex}`,
								`\n  endIndex: ${applyAnimation!.endIndex}`,
								`\n  originalText: "${applyAnimation!.originalText}"`,
								`\n  correctedText: "${applyAnimation!.correctedText}"`,
								`\n  paragraph snippet: "${para.slice(Math.max(0, applyAnimation!.startIndex - 5), Math.min(para.length, (applyAnimation!.endIndex ?? applyAnimation!.startIndex + (applyAnimation!.originalText?.length ?? 0)) + 5))}"`,
								`\n  highlight: "${highlight}"`,
							);
							return {
								before: para.slice(0, applyAnimation!.startIndex),
								highlight: highlight,
								after: para.slice(applyAnimation!.endIndex),
								isOld: true,
							};
						}

						// 新文本高亮：使用精确的起始位置和新文本长度
						const newText = applyAnimation!.correctedText;
						if (!newText) {
							logger.warn('ReaderPanel - correctedText is undefined');
							return null;
						}

						// 使用精确的起始位置，避免在多个相同字符中找错位置
						// 替换后新文本的起始位置与原始位置相同
						const startIdx = applyAnimation!.startIndex;
						const endIdx = startIdx + newText.length;

						// 验证位置处的文本是否与新文本匹配
						const actualText = para.slice(startIdx, endIdx);
						logger.proofread(
							`anim-highlight-new:`,
							`\n  phase: ${applyAnimation!.phase}`,
							`\n  paragraphIndex: ${applyAnimation!.paragraphIndex}`,
							`\n  startIndex: ${applyAnimation!.startIndex}`,
							`\n  endIndex (original): ${applyAnimation!.endIndex}`,
							`\n  originalText: "${applyAnimation!.originalText}"`,
							`\n  correctedText: "${newText}"`,
							`\n  newText.length: ${newText.length}`,
							`\n  calculated endIdx: ${endIdx}`,
							`\n  actualText at position: "${actualText}"`,
							`\n  paragraph snippet: "${para.slice(Math.max(0, startIdx - 5), Math.min(para.length, endIdx + 5))}"`,
						);

						if (actualText === newText) {
							// 位置匹配，使用精确位置
							logger.proofread(`anim-highlight-new: 位置匹配，使用精确位置`);
							return {
								before: para.slice(0, startIdx),
								highlight: newText,
								after: para.slice(endIdx),
								isOld: false,
							};
						} else {
							// 降级：只在预期位置附近搜索（避免错误地匹配到段落中其他相同的文本）
							let foundIdx = -1;
							// 在预期位置前后各5个字符范围内搜索
							const searchStart = Math.max(0, startIdx - 5);
							const searchEnd = Math.min(para.length, startIdx + newText.length + 5);
							const searchRange = para.slice(searchStart, searchEnd);
							const relativeIdx = searchRange.indexOf(newText);
							if (relativeIdx >= 0) {
								foundIdx = searchStart + relativeIdx;
							}
							
							logger.proofread(`anim-highlight-new: 位置不匹配，在预期位置附近搜索，foundIdx: ${foundIdx}`);
							if (foundIdx >= 0) {
								return {
									before: para.slice(0, foundIdx),
									highlight: newText,
									after: para.slice(foundIdx + newText.length),
									isOld: false,
								};
							} else {
								logger.warn(`ReaderPanel - 新文本 "${newText}" 未在段落中找到，使用原始索引`);
								return {
									before: para.slice(0, startIdx),
									highlight: para.slice(startIdx, endIdx),
									after: para.slice(endIdx),
									isOld: false,
								};
							}
						}
					};
					const highlightInfo = getHighlightInfo();

					// 检测空段落（连续换行），直接跳过不渲染
					const isEmptyParagraph = para.trim() === "";
					if (isEmptyParagraph) {
						return null;
					}

					const isTTSHighlighted = readingMode && ttsHighlightedPara !== -1 && paragraphIndexMap[ttsHighlightedPara] === originalIndex;

					return (
						<div
							key={originalIndex}
							data-original-index={originalIndex}
							ref={(el) => {
								paragraphRefs.current[originalIndex] = el;
							}}
							className={`reader-paragraph${readingMode ? " reading-mode" : ""}${highlightedParagraph === originalIndex && !readingMode ? " highlighted" : ""}${isTTSHighlighted ? " tts-highlighted" : ""}${animClass}${isEditing ? " editing" : ""}${isStreamTTSWaitingForStart && readingMode ? " clickable-para" : ""}`}
							onClick={() => {
								if (isScrolling.current) return;
								if (!isEditing) {
									if (readingMode) {
										if (isStreamTTSWaitingForStart) {
											const filteredParaIndex = originalToFilteredMap[originalIndex] ?? 0;
											handleEnhancedChapterTTS(filteredParaIndex);
										} else {
											startTTSFromParagraph(originalIndex);
										}
									} else {
										setHighlightedParagraph(originalIndex);
									}
								}
								readingProgress.handleParagraphClick(filteredIndex);
							}}
							onDoubleClick={() => {
								if (!isEditing && !readingMode) startEditing(filteredIndex, para);
							}}
						>
							{!readingMode && (
								<span
									className={`line-number${startLine === originalIndex ? " start-line" : ""}`}
									onClick={(e) => {
										e.stopPropagation();
										setStartLine(startLine === originalIndex ? null : originalIndex);
									}}
									title={startLine === originalIndex ? "取消起始行" : "设为校对起始行"}
								>
									{originalIndex + 1}
								</span>
							)}
							{isEditing ? (
								<textarea
									ref={textareaRef}
									className="line-edit-textarea"
									value={editValue}
									onChange={handleTextareaInput}
									onKeyDown={handleTextareaKeyDown}
									onBlur={saveEditing}
									rows={1}
								/>
							) : highlightInfo ? (
								<span className="line-text">
									{highlightInfo.before}
									<span
										className={`text-highlight ${highlightInfo.isOld ? "highlight-old" : "highlight-new"}`}
									>
										{highlightInfo.highlight}
									</span>
									{highlightInfo.after}
								</span>
							) : (
								<span className="line-text">{para}</span>
							)}
						</div>
					);
				})}
			</div>

			{/* 上一章 / 下一章 导航按钮（仅桌面端） */}
			{!isMobile && !readingMode && chapters.length > 1 && (
				<div className="chapter-nav-buttons">
					<button
						className="btn"
						disabled={currentChapterIndex <= 0}
						onClick={() => setCurrentChapterIndex(currentChapterIndex - 1)}
					>
						<Icons.skipBack size={16} />
						<span>{currentChapterIndex > 0 ? (chapters[currentChapterIndex - 1]?.title || `第 ${currentChapterIndex} 章`) : "已是第一章"}</span>
					</button>
					<button
						className="btn"
						disabled={currentChapterIndex >= chapters.length - 1}
						onClick={() => setCurrentChapterIndex(currentChapterIndex + 1)}
					>
						<span>{currentChapterIndex < chapters.length - 1 ? (chapters[currentChapterIndex + 1]?.title || `第 ${currentChapterIndex + 2} 章`) : "已是最后一章"}</span>
						<Icons.skipForward size={16} />
					</button>
				</div>
			)}

			{/* 阅读模式下显示悬浮设置按钮和面板 */}
			{readingMode && (
				<>
					{/* 阅读设置面板（显示在按钮上方） */}
					{showReadingSettings && (
						<div
							className="reading-settings-panel glass-panel"
							onClick={(e) => e.stopPropagation()}
						>
							<div className="glass-panel-header">
								<div className="glass-panel-title">
									<Icons.book size={16} />
									<span>阅读设置</span>
								</div>
								<button
									className="close-btn"
									onClick={() => setShowReadingSettings(false)}
								>
									<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
										<path d="M3 3L13 13M13 3L3 13" />
									</svg>
								</button>
							</div>

							<div className="panel-body">
								{/* 行间距设置 */}
								<div className="setting-item">
									<span className="setting-label">行间距</span>
									<div className="setting-control">
										<input
											type="range"
											min="12"
											max="40"
											step="1"
											value={lineSpacing}
											onChange={(e) => setLineSpacing(parseInt(e.target.value))}
										/>
										<span className="setting-value">{lineSpacing}px</span>
									</div>
								</div>

								{/* 字体大小设置 */}
								<div className="setting-item">
									<span className="setting-label">字体大小</span>
									<div className="setting-control">
										<input
											type="range"
											min="12"
											max="28"
											step="1"
											value={fontSize}
											onChange={(e) => setFontSize(parseInt(e.target.value))}
										/>
										<span className="setting-value">{fontSize}px</span>
									</div>
								</div>

								{/* 首行缩进设置（整数选项） */}
								<div className="setting-item">
									<span className="setting-label">首行缩进</span>
									<div className="setting-control">
										<input
											type="range"
											min="0"
											max="4"
											step="1"
											value={paragraphIndent}
											onChange={(e) =>
												setParagraphIndent(parseInt(e.target.value))
											}
										/>
										<span className="setting-value">{paragraphIndent}字符</span>
									</div>
								</div>

								{/* 阅读背景设置 */}
							<div className="setting-item">
								<span className="setting-label">阅读背景</span>
								<div className="setting-control background-options">
									{[
										{
											value: "white",
											label: "白底",
											color: "#FFFFFF",
											textColor: "#333333",
										},
										{
											value: "cream",
											label: "护眼",
											color: "#FDF6E3",
											textColor: "#5C4A32",
										},
										{
											value: "sepia",
											label: "棕黄",
											color: "#F4E4BC",
											textColor: "#5C4033",
										},
										{
											value: "mint",
											label: "薄荷",
											color: "#E8F5E9",
											textColor: "#2E4A3E",
										},
										{
											value: "sky",
											label: "淡蓝",
											color: "#E3F2FD",
											textColor: "#1565C0",
										},
										{
											value: "lavender",
											label: "薰衣草",
											color: "#F3E5F5",
											textColor: "#6A1B9A",
										},
										{
											value: "peach",
											label: "桃色",
											color: "#FFEBEE",
											textColor: "#B71C1C",
										},
										{
											value: "sage",
											label: "鼠尾草",
											color: "#EFEBE9",
											textColor: "#4E342E",
										},
										{
											value: "slate",
											label: "石板",
											color: "#ECEFF1",
											textColor: "#37474F",
										},
										{
											value: "dark",
											label: "深色",
											color: "#2C2C2C",
											textColor: "#E0E0E0",
										},
									].map((bg) => (
										<button
											key={bg.value}
											className={`background-option${readingBackground === bg.value ? " active" : ""}`}
											style={{ backgroundColor: bg.color }}
											onClick={() =>
												setReadingBackground(
													bg.value as
														| "white"
														| "cream"
														| "sepia"
														| "mint"
														| "sky"
														| "lavender"
														| "peach"
														| "sage"
														| "slate"
														| "dark",
												)
											}
											title={bg.label}
										>
											{readingBackground === bg.value && "✓"}
										</button>
									))}
								</div>
							</div>

							{/* 自定义颜色选项 */}
							<div className="setting-item">
								<span className="setting-label">自定义颜色</span>
								<div className="setting-control color-options">
									<div className="color-input-group">
										<label>文字</label>
										<input
											type="color"
											value={customTextColor}
											onChange={(e) =>
												setCustomColors(e.target.value, customBgColor)
											}
										/>
									</div>
									<div className="color-input-group">
										<label>背景</label>
										<input
											type="color"
											value={customBgColor}
											onChange={(e) =>
												setCustomColors(customTextColor, e.target.value)
											}
										/>
									</div>
									<button
										className={`background-option custom-color-btn${readingBackground === "custom" ? " active" : ""}`}
										style={
											{
												"--custom-bg": customBgColor,
												"--custom-text": customTextColor,
											} as React.CSSProperties
										}
										onClick={() => setReadingBackground("custom")}
										title="应用自定义颜色"
									></button>
								</div>
							</div>

							{/* 图片背景选项 */}
							<div className="setting-item">
								<span className="setting-label">图片背景</span>
								<div className="setting-control image-options">
									<input
										type="file"
										accept="image/*"
										id="bg-image-upload"
										style={{ display: "none" }}
										onChange={(e) => {
											const file = e.target.files?.[0];
											if (file) {
												const reader = new FileReader();
												reader.onload = (ev) => {
													const url = ev.target?.result as string;
													setBgImageUrl(url);
													setReadingBackground("image");
												};
												reader.readAsDataURL(file);
											}
										}}
									/>
									<label htmlFor="bg-image-upload" className="image-upload-btn">
										📷 选择图片
									</label>
									{readingBackground === "image" && bgImageUrl && (
										<button
											className="image-remove-btn"
											onClick={() => {
												setBgImageUrl("");
												setReadingBackground("cream");
											}}
										>
											✕
										</button>
									)}
								</div>
							</div>

							{/* 阅读时长提醒 */}
							<div className="setting-item">
								<span className="setting-label">阅读提醒</span>
								<div className="setting-control reminder-options">
									<label className="toggle-label-inline">
										<div className="toggle-switch-small">
											<input
												type="checkbox"
												checked={readingReminderEnabled}
												onChange={(e) => setReadingReminderEnabled(e.target.checked)}
											/>
											<span className="toggle-slider-small"></span>
										</div>
										<span className="toggle-text-small">启用提醒</span>
									</label>
									{readingReminderEnabled && (
										<div className="reminder-interval">
											<span>间隔</span>
											<input
												type="number"
												min="5"
												max="120"
												step="5"
												value={readingReminderMinutes}
												onChange={(e) => setReadingReminderMinutes(parseInt(e.target.value) || 30)}
												className="reminder-input"
											/>
											<span>分钟</span>
										</div>
									)}
								</div>
							</div>
							</div>
						</div>
					)}

					{/* TTS 面板 */}
					{showTTSPanel && readingMode && (
						<div className="tts-panel glass-panel">
							<div className="glass-panel-header">
								<div className="glass-panel-title">
									<Icons.volume size={16} />
									<span>语音朗读设置</span>
								</div>
								<button
									className="close-btn"
									onClick={() => setShowTTSPanel(false)}
								>
									<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
										<path d="M3 3L13 13M13 3L3 13" />
									</svg>
								</button>
							</div>
							<div className="glass-panel-body">
								<div className="tts-setting-item">
									<label>音色</label>
									<Select
										value={ttsConfig.voice}
										onChange={(value) => updateTTSConfig({ voice: value })}
										options={[
											{ value: "冰糖", label: "冰糖" },
											{ value: "茉莉", label: "茉莉" },
											{ value: "苏打", label: "苏打" },
											{ value: "白桦", label: "白桦" },
											{ value: "Mia", label: "Mia" },
											{ value: "Chloe", label: "Chloe" },
											{ value: "Milo", label: "Milo" },
											{ value: "Dean", label: "Dean" }
										]}
									/>
								</div>
								<div className="tts-setting-item">
									<label>语速</label>
									<div className="tts-slider-group">
										<input
											type="range"
											min="1"
											max="10"
											value={ttsConfig.speed}
											onChange={(e) => updateTTSConfig({ speed: parseInt(e.target.value) })}
										/>
										<span className="tts-value">{ttsConfig.speed}</span>
									</div>
								</div>
								<div className="tts-setting-item">
									<label>音量</label>
									<div className="tts-slider-group">
										<input
											type="range"
											min="1"
											max="10"
											value={ttsConfig.volume}
											onChange={(e) => updateTTSConfig({ volume: parseInt(e.target.value) })}
										/>
										<span className="tts-value">{ttsConfig.volume}</span>
									</div>
								</div>
							</div>
						</div>
					)}


			{/* 阅读模式底部工具栏 */}
			{readingMode && (
				<div className="desktop-reader-bar">
					{/* 播放控制条 - 放在 actions 上方 */}
					{(ttsPlaying || isStreamTTSPlaying || enhancedTTSPreparing) && (
						<div className="desktop-tts-playback-controls">
							{currentPlayingCharacter && (
								<div className="current-speaker">
									<Icons.user size={14} />
									<span>{currentPlayingCharacter}</span>
								</div>
							)}
							{(ttsPlaying || isStreamTTSPlaying) && remainingSeconds > 0 && (
								<div className="tts-remaining-time">
									<Icons.clock size={14} />
									<span>{Math.floor(remainingSeconds / 60).toString().padStart(2, '0')}:{(remainingSeconds % 60).toString().padStart(2, '0')}</span>
								</div>
							)}
							<button
								className="tts-playback-btn"
								onClick={handleTTSPrev}
								title="上一条"
							>
								<Icons.skipBack size={18} />
							</button>
							<button
								className="tts-playback-btn play-pause"
								onClick={handleTTSToggle}
								title={ttsPlaying ? "暂停" : "播放"}
							>
								{ttsPlaying ? <Icons.pause size={22} /> : <Icons.play size={22} />}
							</button>
							<button
								className="tts-playback-btn"
								onClick={handleTTSNext}
								title="下一条"
							>
								<Icons.skipForward size={18} />
							</button>
							<button
								className="tts-playback-btn stop"
								onClick={handleTTSStop}
								title="停止并退出"
							>
								<Icons.x size={18} />
							</button>
						</div>
					)}
					<div className="desktop-reader-bar-actions">
						<button
							className={`desktop-reader-bar-btn ${ttsPlaying ? "playing" : ""}`}
							onClick={handleTTSToggle}
							title="朗读"
						>
							<Icons.bookHeadphones size={16} />
							<span>朗读</span>
						</button>
						<button
							className={`desktop-reader-bar-btn ${enhancedTTSPreparing ? "preparing" : ""} ${isStreamTTSWaitingForStart ? "waiting-selection" : ""}`}
							onClick={handleEnterStreamTTSSelectionMode}
							disabled={enhancedTTSPreparing}
							title={isStreamTTSWaitingForStart ? "取消选择段落" : "情感朗读"}
						>
							{enhancedTTSPreparing ? (
								<>
									<span className="spinner"></span>
									<span>AI增强中...</span>
								</>
							) : isStreamTTSWaitingForStart ? (
								<>
									<Icons.close size={16} />
									<span>取消选择</span>
								</>
							) : (
								<>
									<Icons.volume size={16} />
									<span>情感朗读</span>
								</>
							)}
						</button>
						<button
							className={`desktop-reader-bar-btn ${showTTSPanel ? "active" : ""}`}
							onClick={() => {
								if (showTTSPanel) {
									setShowTTSPanel(false);
								} else {
									setShowTTSPanel(true);
									setShowReadingSettings(false);
								}
							}}
						>
							<Icons.bookAudio size={16} />
							<span>语音设置</span>
						</button>
						<button
							className={`desktop-reader-bar-btn ${showReadingSettings ? "active" : ""}`}
							onClick={() => {
								if (showReadingSettings) {
									setShowReadingSettings(false);
								} else {
									setShowReadingSettings(true);
									setShowTTSPanel(false);
								}
							}}
						>
							<Icons.lineStyle size={16} />
							<span>阅读设置</span>
						</button>
					</div>
					<div className="reading-progress">
						<div className="progress-info">
							<span className="progress-label">阅读进度</span>
							<span className="progress-value">{readingProgressPercent}%</span>
						</div>
						<div className="progress-bar">
							<div className="progress-fill" style={{ width: `${readingProgressPercent}%` }}></div>
						</div>
						<div className="time-info">
							<span className="time-label">预计剩余</span>
							<span className="time-value">{estimatedRemainingMinutes > 0 ? `${estimatedRemainingMinutes} 分钟` : '--'}</span>
						</div>
					</div>
				</div>
			)}

					{/* 章节列表弹窗 */}
					{showChapterList && (
						<div
							className="chapter-list-overlay"
							onClick={() => {
								setShowChapterList(false);
								setShowReadingSettings(false);
							}}
						>
							<div className="chapter-list-modal modal-container" onClick={(e) => e.stopPropagation()}>
								<div className="config-header">
									<div className="config-title">
										<Icons.list size={18} />
										<span>目录</span>
									</div>
									<button
										className="close-btn"
										onClick={() => setShowChapterList(false)}
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
								<div className="chapter-list-content" ref={chapterListContentRef}>
									{chapters.map((ch, index) => {
										const isActive = index === currentChapterIndex;
										const hasNoTitle = !ch.title || /^第[\d一二三四五六七八九十]+[章回]$/.test(ch.title);
										const isSuggestingLocal = suggestingId === ch.id;
										const showSuggestionsLocal = suggestingId === ch.id && (chapterTitleSuggestions[ch.id]?.length ?? 0) > 0;

										return (
											<div key={ch.id}>
												<div
													ref={isActive ? activeChapterItemRef : null}
													className={`chapter-list-item${isActive ? " active" : ""}`}
													onClick={() => {
														setCurrentChapterIndex(index);
														setShowChapterList(false);
													}}
												>
													<span className="chapter-index">{index + 1}</span>
													<span className="chapter-name">
														{ch.title || `第 ${index + 1} 章`}
													</span>
													{hasNoTitle && (
														<button
															className="suggest-title-btn"
															onClick={(e) => {
																e.stopPropagation();
																handleSuggestChapterTitle(ch.id, index);
															}}
															disabled={isSuggestingLocal}
														>
															<Icons.sparkle size={14} />
														</button>
													)}
												</div>
												{showSuggestionsLocal && (
													<div className="chapter-title-suggestions">
														<div className="suggestions-header">
															<span>AI推荐章节名</span>
															<button
																className="close-suggestions"
																onClick={(e) => {
																	e.stopPropagation();
																	chapterTitleSuggestion.handleCloseSuggestions(ch.id);
																}}
															>
																<Icons.x size={14} />
															</button>
														</div>
														{(chapterTitleSuggestions[ch.id] || []).map((title, idx) => (
															<button
																key={idx}
																className="suggestion-item"
																onClick={(e) => {
																	e.stopPropagation();
																	handleApplyChapterTitle(ch.id, title);
																}}
															>
																{title}
															</button>
														))}
													</div>
												)}
											</div>
										);
									})}
								</div>
							</div>
						</div>
					)}
				</>
			)}

			{/* 搜索弹窗 */}
			{showSearch && (
				<div className="chapter-list-overlay" onClick={closeSearch}>
					<div className="config-modal" onClick={(e) => e.stopPropagation()}>
						<div className="config-header">
							<div className="config-title">
								<Icons.search size={18} />
								<span>搜索</span>
							</div>
							<button className="close-btn" onClick={closeSearch}>
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
						<div className="search-input-row">
							<div className="search-input-wrapper">
								<Icons.search size={16} className="search-input-icon" />
								<input
									type="text"
									className="search-input"
									placeholder="输入搜索内容..."
									value={searchQuery}
									onChange={(e) => {
										setSearchQuery(e.target.value);
										performSearch(e.target.value);
									}}
									onKeyDown={(e) => {
										if (e.key === "Enter") {
											const idx = nextMatch();
											if (idx !== null) setHighlightedParagraph(idx);
										} else if (e.key === "Escape") {
											closeSearch();
										}
									}}
									autoFocus
								/>
								{searchQuery && (
									<button
										className="search-clear-btn"
										onClick={() => {
											setSearchQuery("");
											performSearch("");
										}}
									>
										<Icons.close size={14} />
									</button>
								)}
							</div>
							<span className="search-count">
								{searchResults.length > 0 ? `${currentMatchIndex + 1}/${searchResults.length}` : searchQuery ? "无匹配" : ""}
							</span>
						</div>
								<div className="search-nav">
							<button className="search-nav-btn" onClick={() => {
								const idx = prevMatch();
								if (idx !== null) setHighlightedParagraph(idx);
							}} disabled={searchResults.length === 0} title="上一个">
								<Icons.chevronUp size={16} />
							</button>
							<button className="search-nav-btn" onClick={() => {
								const idx = nextMatch();
								if (idx !== null) setHighlightedParagraph(idx);
							}} disabled={searchResults.length === 0} title="下一个">
								<Icons.chevronDown size={16} />
							</button>
						</div>
						<div className="search-results-list">
							{searchResults.map((result, index) => (
								<div
									key={index}
									className={`search-result-item${index === currentMatchIndex ? " current" : ""}`}
									onClick={() => {
										const idx = handleSearchResultClick(index);
										if (idx !== null) setHighlightedParagraph(idx);
									}}
								>
									{result.text}
								</div>
							))}
						</div>
					</div>
				</div>
			)}

			{/* 阅读时长提醒弹窗 */}
			{showReadingReminder && (
				<div className="modal-overlay" onClick={() => setShowReadingReminder(false)}>
					<div className="config-modal" onClick={(e) => e.stopPropagation()}>
						<div className="config-header">
							<div className="config-title">
								<span className="title-icon"><Icons.eye size={16} /></span>
								<span>温馨提醒</span>
							</div>
							<button className="close-btn" onClick={() => setShowReadingReminder(false)}>
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
						<div className="config-body">
							<div className="config-section">
								<p className="modal-description" style={{ textAlign: "center", fontSize: "14px", margin: "16px 0" }}>
									您已阅读 {Math.floor(readingTimeElapsed / 60000)} 分钟，请注意休息，保护眼睛！
								</p>
							</div>
						</div>
						<div className="character-actions-fab-wrapper">
							<button className="btn" onClick={() => {
								setShowReadingReminder(false);
								setReadingMode(false);
							}}>
								<Icons.x size={18} />
								<span>退出阅读模式</span>
							</button>
							<button className="btn" onClick={() => setShowReadingReminder(false)}>
								<Icons.eye size={18} />
								<span>继续阅读</span>
							</button>
						</div>
					</div>
				</div>
			)}

			{/* 检测到新角色弹窗 */}
			{showNewCharacterModal && detectedNewCharacters.length > 0 && (
				<div className="modal-overlay" onClick={() => setShowNewCharacterModal(false)}>
					<div className="config-modal" onClick={(e) => e.stopPropagation()}>
						<div className="config-header">
							<div className="config-title">
								<span className="title-icon"><Icons.userRoundPlus size={16} /></span>
								<span>检测到新角色</span>
							</div>
							<button className="close-btn" onClick={() => setShowNewCharacterModal(false)}>
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
						<div className="config-body">
							<div className="config-section">
								<p className="modal-description">
									情感朗读时检测到 {detectedNewCharacters.length} 个新角色，是否添加到角色列表？
								</p>
							</div>
							<div className="config-section">
								<div className="new-character-list">
									{detectedNewCharacters.map((name) => (
										<div key={name} className="new-character-item">
											<Icons.user size={16} />
											<span>{name}</span>
										</div>
									))}
								</div>
							</div>
						</div>
						<div className="character-actions-fab-wrapper">
							<button className="btn" onClick={() => setShowNewCharacterModal(false)}>
								<Icons.x size={18} />
								<span>稍后再说</span>
							</button>
							<button className="btn" onClick={() => handleAddNewCharacters(detectedNewCharacters)}>
								<Icons.userRoundPlus size={18} />
								<span>全部添加</span>
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
