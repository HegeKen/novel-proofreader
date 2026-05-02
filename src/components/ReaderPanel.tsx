// ============================================================
// 左侧阅读区（带行号 + 采纳动画 + 双击编辑）
// ============================================================
import { useRef, useEffect, useCallback, useState, useMemo } from "react";
import { useAppStore } from "../stores/appStore";
import { useProofreadStore } from "../stores/proofreadStore";
import { splitParagraphs } from "../utils/chapterSplit";
import { buildParagraphIndexMap } from "../utils/formatters";
import { scrollToElement, ScrollLock } from "../utils/scrollUtils";
import { EmptyState } from "./EmptyState";

export function ReaderPanel({
	showReadingModeToggle = false,
}: { showReadingModeToggle?: boolean } = {}) {
	const chapters = useAppStore((s) => s.chapters);
	const currentChapterIndex = useAppStore((s) => s.currentChapterIndex);
	const setCurrentChapterIndex = useAppStore((s) => s.setCurrentChapterIndex);
	const fontSize = useAppStore((s) => s.fontSize);
	const readingMode = useAppStore((s) => s.readingMode);
	const setReadingMode = useAppStore((s) => s.setReadingMode);
	const lineSpacing = useAppStore((s) => s.lineSpacing);
	const setLineSpacing = useAppStore((s) => s.setLineSpacing);
	const paragraphIndent = useAppStore((s) => s.paragraphIndent);
	const setParagraphIndent = useAppStore((s) => s.setParagraphIndent);
	const paragraphSpacing = useAppStore((s) => s.paragraphSpacing);
	const setParagraphSpacing = useAppStore((s) => s.setParagraphSpacing);
	const readingBackground = useAppStore((s) => s.readingBackground);
	const setReadingBackground = useAppStore((s) => s.setReadingBackground);
	const customTextColor = useAppStore((s) => s.customTextColor);
	const customBgColor = useAppStore((s) => s.customBgColor);
	const setCustomColors = useAppStore((s) => s.setCustomColors);
	const bgImageUrl = useAppStore((s) => s.bgImageUrl);
	const setBgImageUrl = useAppStore((s) => s.setBgImageUrl);
	const replaceLine = useAppStore((s) => s.replaceLine);
	const highlightedParagraph = useProofreadStore((s) => s.highlightedParagraph);
	const setHighlightedParagraph = useProofreadStore(
		(s) => s.setHighlightedParagraph,
	);
	const applyAnimation = useProofreadStore((s) => s.applyAnimation);
	const startLine = useProofreadStore((s) => s.startLine);
	const setStartLine = useProofreadStore((s) => s.setStartLine);

	const containerRef = useRef<HTMLDivElement>(null);
	const paragraphRefs = useRef<(HTMLDivElement | null)[]>([]);
	const scrollLock = useRef(new ScrollLock());

	// 滑动翻页相关
	const touchStartY = useRef(0);
	const touchStartScrollTop = useRef(0);
	const isDragging = useRef(false);

	// 双击编辑状态：正在编辑的行索引
	const [editingIndex, setEditingIndex] = useState<number | null>(null);
	const [editValue, setEditValue] = useState("");

	// 阅读设置面板状态
	const [showReadingSettings, setShowReadingSettings] = useState(false);

	// 章节列表弹窗状态
	const [showChapterList, setShowChapterList] = useState(false);
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	// 搜索功能状态
	const [showSearch, setShowSearch] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const [searchResults, setSearchResults] = useState<{ paraIndex: number; matchStart: number; matchEnd: number; text: string }[]>([]);
	const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

	const chapter = chapters[currentChapterIndex];
	const paragraphs = useMemo(() => {
		return chapter
			? splitParagraphs(chapter.content).filter((p) => p.trim() !== "")
			: [];
	}, [chapter]);

	// 建立过滤后索引到原始索引的映射
	const paragraphIndexMap = useMemo(() => {
		return chapter ? buildParagraphIndexMap(chapter.content) : [];
	}, [chapter]);

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

	/** 取消编辑 */
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

	/** 程序化滚动到指定段落（带锁） */
	const scrollToParagraph = useCallback((index: number) => {
		if (!scrollLock.current.acquire()) return;
		scrollToElement(containerRef, paragraphRefs, index);
	}, []);

	useEffect(() => {
		if (highlightedParagraph !== null) {
			scrollToParagraph(highlightedParagraph);
		}
	}, [highlightedParagraph, scrollToParagraph]);

	useEffect(() => {
		if (applyAnimation) {
			scrollToParagraph(applyAnimation.paragraphIndex);
		}
	}, [applyAnimation, scrollToParagraph]);

	/** 执行搜索 */
	const performSearch = useCallback((query: string) => {
		if (!query.trim()) {
			setSearchResults([]);
			return;
		}
		const results: typeof searchResults = [];
		const lowerQuery = query.toLowerCase();
		paragraphs.forEach((para, paraIndex) => {
			let startIndex = 0;
			const lowerPara = para.toLowerCase();
			while (startIndex < lowerPara.length) {
				const matchIndex = lowerPara.indexOf(lowerQuery, startIndex);
				if (matchIndex === -1) break;
				results.push({
					paraIndex,
					matchStart: matchIndex,
					matchEnd: matchIndex + query.length,
					text: para.slice(Math.max(0, matchIndex - 20), matchIndex) + "【" + para.slice(matchIndex, matchIndex + query.length) + "】" + para.slice(matchIndex + query.length, Math.min(para.length, matchIndex + query.length + 20)),
				});
				startIndex = matchIndex + 1;
			}
		});
		setSearchResults(results);
		setCurrentMatchIndex(results.length > 0 ? 0 : -1);
	}, [paragraphs]);

	/** 点击搜索结果：跳转并关闭 */
	const handleSearchResultClick = useCallback((index: number) => {
		setCurrentMatchIndex(index);
		const match = searchResults[index];
		if (match) {
			setHighlightedParagraph(match.paraIndex);
		}
		setShowSearch(false);
		setSearchResults([]);
		setCurrentMatchIndex(0);
		setSearchQuery("");
	}, [searchResults, setHighlightedParagraph]);

	/** 搜索导航：上一个 */
	const prevMatch = useCallback(() => {
		if (searchResults.length === 0) return;
		setCurrentMatchIndex((prev) => {
			const newIndex = prev > 0 ? prev - 1 : searchResults.length - 1;
			setHighlightedParagraph(searchResults[newIndex].paraIndex);
			return newIndex;
		});
	}, [searchResults]);

	/** 搜索导航：下一个 */
	const nextMatch = useCallback(() => {
		if (searchResults.length === 0) return;
		setCurrentMatchIndex((prev) => {
			const newIndex = prev < searchResults.length - 1 ? prev + 1 : 0;
			setHighlightedParagraph(searchResults[newIndex].paraIndex);
			return newIndex;
		});
	}, [searchResults]);

	/** 关闭搜索 */
	const closeSearch = useCallback(() => {
		setShowSearch(false);
		setSearchResults([]);
		setCurrentMatchIndex(0);
		setSearchQuery("");
	}, []);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		container.scrollTop = 0;
	}, [currentChapterIndex]);

	const handleScroll = useCallback(() => {
		if (scrollLock.current.isLocked()) return;
		const container = containerRef.current;
		if (!container) return;

		const containerRect = container.getBoundingClientRect();
		const midY = containerRect.top + containerRect.height / 2;

		for (let i = 0; i < paragraphRefs.current.length; i++) {
			const el = paragraphRefs.current[i];
			if (!el) continue;
			const rect = el.getBoundingClientRect();
			if (rect.top <= midY && rect.bottom >= midY) {
				setHighlightedParagraph(i);
				break;
			}
		}
	}, [setHighlightedParagraph]);

	// 滑动翻页功能
	const handleTouchStart = useCallback((e: React.TouchEvent) => {
		touchStartY.current = e.touches[0].clientY;
		const container = containerRef.current;
		if (container) {
			touchStartScrollTop.current = container.scrollTop;
		}
		isDragging.current = true;
	}, []);

	const handleTouchMove = useCallback(
		(e: React.TouchEvent) => {
			if (!isDragging.current) return;

			const container = containerRef.current;
			if (!container) return;

			const currentY = e.touches[0].clientY;
			const deltaY = currentY - touchStartY.current;

			// 检测是否到达顶部或底部
			const isAtTop = touchStartScrollTop.current === 0;
			const isAtBottom =
				container.scrollHeight - container.scrollTop <=
				container.clientHeight + 10;

			// 在顶部下滑（deltaY > 0），进入上一章并定位到底部
			if (isAtTop && deltaY > 50 && currentChapterIndex > 0) {
				isDragging.current = false;
				setCurrentChapterIndex(currentChapterIndex - 1);
				setTimeout(() => {
					const newContainer = containerRef.current;
					if (newContainer) {
						newContainer.scrollTop = newContainer.scrollHeight;
					}
				}, 100);
			}
			// 在底部上滑（deltaY < 0），进入下一章并定位到顶部
			else if (
				isAtBottom &&
				deltaY < -50 &&
				currentChapterIndex < chapters.length - 1
			) {
				isDragging.current = false;
				setCurrentChapterIndex(currentChapterIndex + 1);
			}
		},
		[currentChapterIndex, chapters.length, setCurrentChapterIndex],
	);

	const handleTouchEnd = useCallback(() => {
		isDragging.current = false;
	}, []);

	if (!chapter) {
		return (
			<div className="reader-panel empty">
				<EmptyState icon="📖" message="请导入 TXT 小说文件开始阅读" />
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
					<span className="chapter-dropdown-icon">▼</span>
				</span>
				{showReadingModeToggle && (
					<div className="reading-mode-toggle">
						<span className="toggle-label">📖 阅读模式</span>
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
				{!readingMode && (
					<button className="reader-search-btn" onClick={() => setShowSearch(true)} title="搜索">
						🔍
					</button>
				)}
			</div>
			<div
				className={`reader-content${readingMode ? " reading-mode" : ""}`}
				ref={containerRef}
				onScroll={handleScroll}
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
						lineHeight: lineSpacing,
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
				{paragraphs.map((para, i) => {
					const isAnimTarget =
						!readingMode &&
						applyAnimation?.chapterId === chapter.id &&
						applyAnimation?.paragraphIndex === i;
					const animClass = isAnimTarget
						? ` anim-${applyAnimation!.phase}`
						: "";
					const isEditing = editingIndex === i;

					// 如果是动画目标，提取需要高亮的文本片段
					const highlightInfo =
						isAnimTarget && applyAnimation!.startIndex !== undefined
							? {
									before: para.slice(0, applyAnimation!.startIndex),
									highlight: para.slice(
										applyAnimation!.startIndex,
										applyAnimation!.endIndex,
									),
									after: para.slice(applyAnimation!.endIndex),
									isOld:
										applyAnimation!.phase === "highlight-old" ||
										applyAnimation!.phase === "replacing",
								}
							: null;

					// 检测空段落（连续换行），直接跳过不渲染
					const isEmptyParagraph = para.trim() === "";
					if (isEmptyParagraph) {
						return null;
					}

					return (
						<div
							key={i}
							ref={(el) => {
								paragraphRefs.current[i] = el;
							}}
							className={`reader-paragraph${readingMode ? " reading-mode" : ""}${highlightedParagraph === i && !readingMode ? " highlighted" : ""}${animClass}${isEditing ? " editing" : ""}`}
							style={{
								fontSize: `${fontSize}px`,
								marginBottom: readingMode
									? `${Math.max(4, paragraphSpacing * 0.5)}px`
									: `${paragraphSpacing}px`,
								...(readingMode && {
									textIndent: `${paragraphIndent}em`,
									color:
										readingBackground === "dark"
											? "#E0E0E0"
											: readingBackground === "mint"
												? "#2E4A3E"
												: readingBackground === "sky"
													? "#1565C0"
													: readingBackground === "lavender"
														? "#6A1B9A"
														: readingBackground === "peach"
															? "#B71C1C"
															: readingBackground === "sage"
																? "#4E342E"
																: readingBackground === "slate"
																	? "#37474F"
																	: readingBackground === "custom"
																		? customTextColor
																		: "#333333",
								}),
							}}
							onClick={() => {
								if (!isEditing) setHighlightedParagraph(i);
							}}
							onDoubleClick={() => {
								if (!isEditing && !readingMode) startEditing(i, para);
							}}
						>
							{!readingMode && (
								<span
									className={`line-number${startLine === i ? " start-line" : ""}`}
									onClick={(e) => {
										e.stopPropagation();
										setStartLine(startLine === i ? null : i);
									}}
									title={startLine === i ? "取消起始行" : "设为校对起始行"}
								>
									{i + 1}
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
									style={{ fontSize: `${fontSize}px` }}
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

			{/* 阅读模式下显示悬浮设置按钮和面板 */}
			{readingMode && (
				<>
					{/* 阅读设置面板（显示在按钮上方） */}
					{showReadingSettings && (
						<div
							className="reading-settings-panel"
							onClick={(e) => e.stopPropagation()}
						>
							<div className="settings-title">阅读设置</div>

							{/* 行间距设置 */}
							<div className="setting-item">
								<span className="setting-label">行间距</span>
								<div className="setting-control">
									<input
										type="range"
										min="1.0"
										max="4.0"
										step="0.1"
										value={lineSpacing}
										onChange={(e) => setLineSpacing(parseFloat(e.target.value))}
									/>
									<span className="setting-value">{lineSpacing}x</span>
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

							{/* 段间距设置 */}
							<div className="setting-item">
								<span className="setting-label">段间距</span>
								<div className="setting-control">
									<input
										type="range"
										min="0"
										max="80"
										step="2"
										value={paragraphSpacing}
										onChange={(e) =>
											setParagraphSpacing(parseInt(e.target.value))
										}
									/>
									<span className="setting-value">{paragraphSpacing}px</span>
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
						</div>
					)}

					{/* 阅读设置悬浮按钮 */}
					<button
						className="reading-settings-toggle"
						onClick={() => setShowReadingSettings(!showReadingSettings)}
					>
						⚙️
					</button>

					{/* 章节列表弹窗 */}
					{showChapterList && (
						<>
							<div
								className="chapter-list-overlay"
								onClick={() => {
									setShowChapterList(false);
									setShowReadingSettings(false);
								}}
							/>
							<div className="chapter-list-modal">
								<div className="chapter-list-header">
									<span>目录</span>
									<button
										className="chapter-list-close"
										onClick={() => setShowChapterList(false)}
									>
										✕
									</button>
								</div>
								<div className="chapter-list-content">
									{chapters.map((ch, index) => (
										<div
											key={ch.id}
											className={`chapter-list-item${index === currentChapterIndex ? " active" : ""}`}
											onClick={() => {
												setCurrentChapterIndex(index);
												setShowChapterList(false);
											}}
										>
											<span className="chapter-index">{index + 1}</span>
											<span className="chapter-name">
												{ch.title || `第 ${index + 1} 章`}
											</span>
										</div>
									))}
								</div>
							</div>
						</>
					)}
				</>
			)}

			{/* 搜索弹窗 */}
			{showSearch && (
				<>
					<div className="chapter-list-overlay" onClick={closeSearch} />
					<div className="search-modal">
						<div className="search-header">
							<span>搜索</span>
							<button className="chapter-list-close" onClick={closeSearch}>✕</button>
						</div>
						<div className="search-input-row">
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
										nextMatch();
									} else if (e.key === "Escape") {
										closeSearch();
									}
								}}
								autoFocus
							/>
							<span className="search-count">
								{searchResults.length > 0 ? `${currentMatchIndex + 1}/${searchResults.length}` : searchQuery ? "无匹配" : ""}
							</span>
						</div>
						<div className="search-nav">
							<button className="search-nav-btn" onClick={prevMatch} disabled={searchResults.length === 0}>▲</button>
							<button className="search-nav-btn" onClick={nextMatch} disabled={searchResults.length === 0}>▼</button>
						</div>
						<div className="search-results-list">
							{searchResults.map((result, index) => (
								<div
									key={index}
									className={`search-result-item${index === currentMatchIndex ? " current" : ""}`}
									onClick={() => handleSearchResultClick(index)}
								>
									{result.text}
								</div>
							))}
						</div>
					</div>
				</>
			)}
		</div>
	);
}
