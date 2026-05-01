import { useRef, useEffect, useCallback, useState, useMemo } from "react";
import { useAppStore } from "../stores/appStore";
import { useProofreadStore } from "../stores/proofreadStore";
import { splitParagraphs } from "../utils/chapterSplit";
import { EmptyState } from "./EmptyState";
import { ReadingSettingsPanel } from "./ReadingSettingsPanel";

const BG_COLORS: Record<string, { bg: string; text: string }> = {
	white: { bg: "#FFFFFF", text: "#333333" },
	cream: { bg: "#FDF6E3", text: "#5C4A32" },
	sepia: { bg: "#F4E4BC", text: "#5C4033" },
	mint: { bg: "#E8F5E9", text: "#2E4A3E" },
	sky: { bg: "#E3F2FD", text: "#1565C0" },
	lavender: { bg: "#F3E5F5", text: "#6A1B9A" },
	peach: { bg: "#FFEBEE", text: "#B71C1C" },
	sage: { bg: "#EFEBE9", text: "#4E342E" },
	slate: { bg: "#ECEFF1", text: "#37474F" },
	dark: { bg: "#2C2C2C", text: "#E0E0E0" },
};

export function ReaderPanel({ showReadingModeToggle = false }: { showReadingModeToggle?: boolean } = {}) {
	const chapters = useAppStore((s) => s.chapters);
	const currentChapterIndex = useAppStore((s) => s.currentChapterIndex);
	const setCurrentChapterIndex = useAppStore((s) => s.setCurrentChapterIndex);
	const fontSize = useAppStore((s) => s.fontSize);
	const readingMode = useAppStore((s) => s.readingMode);
	const setReadingMode = useAppStore((s) => s.setReadingMode);
	const lineSpacing = useAppStore((s) => s.lineSpacing);
	const paragraphSpacing = useAppStore((s) => s.paragraphSpacing);
	const readingBackground = useAppStore((s) => s.readingBackground);
	const customTextColor = useAppStore((s) => s.customTextColor);
	const customBgColor = useAppStore((s) => s.customBgColor);
	const replaceLine = useAppStore((s) => s.replaceLine);
	const saveToCache = useAppStore((s) => s.saveToCache);
	const highlightedParagraph = useProofreadStore((s) => s.highlightedParagraph);
	const setHighlightedParagraph = useProofreadStore((s) => s.setHighlightedParagraph);
	const applyAnimation = useProofreadStore((s) => s.applyAnimation);
	const startLine = useProofreadStore((s) => s.startLine);
	const setStartLine = useProofreadStore((s) => s.setStartLine);

	const containerRef = useRef<HTMLDivElement>(null);
	const paragraphRefs = useRef<(HTMLDivElement | null)[]>([]);
	const touchStartY = useRef(0);
	const touchStartScrollTop = useRef(0);
	const isDragging = useRef(false);

	const [editingIndex, setEditingIndex] = useState<number | null>(null);
	const [editValue, setEditValue] = useState("");
	const [showReadingSettings, setShowReadingSettings] = useState(false);
	const [showChapterList, setShowChapterList] = useState(false);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const [showSearch, setShowSearch] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const [searchResults, setSearchResults] = useState<{ paraIndex: number; matchStart: number; matchEnd: number; text: string }[]>([]);
	const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

	const chapter = chapters[currentChapterIndex];
	const allParagraphs = useMemo(() => chapter ? splitParagraphs(chapter.content) : [], [chapter]);
	const paragraphs = useMemo(() => allParagraphs.filter((p) => p.trim() !== ""), [allParagraphs]);
	// 保存每个可见段落对应的原始索引
	const paragraphToOriginalIndex = useMemo(() => {
		const map: number[] = [];
		allParagraphs.forEach((para, idx) => {
			if (para.trim() !== "") {
				map.push(idx);
			}
		});
		return map;
	}, [allParagraphs]);
	// 保存原始索引到可见段落索引的反向映射
	const originalToParagraphIndex = useMemo(() => {
		const map: Record<number, number> = {};
		paragraphToOriginalIndex.forEach((origIdx, displayIdx) => {
			map[origIdx] = displayIdx;
		});
		return map;
	}, [paragraphToOriginalIndex]);

	const startEditing = useCallback((index: number, currentText: string) => {
		setEditingIndex(index);
		setEditValue(currentText);
	}, []);

	const saveEditing = useCallback(() => {
		if (editingIndex === null || !chapter) return;
		if (editValue !== paragraphs[editingIndex]) {
			replaceLine(chapter.id, paragraphToOriginalIndex[editingIndex], editValue);
			saveToCache();
		}
		setEditingIndex(null);
	}, [editingIndex, editValue, chapter, paragraphs, replaceLine, paragraphToOriginalIndex, saveToCache]);

	const cancelEditing = useCallback(() => setEditingIndex(null), []);

	useEffect(() => {
		if (editingIndex !== null && textareaRef.current) {
			const ta = textareaRef.current;
			ta.focus();
			ta.selectionStart = ta.value.length;
			ta.style.height = "auto";
			ta.style.height = ta.scrollHeight + "px";
		}
	}, [editingIndex]);

	const handleTextareaInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
		setEditValue(e.target.value);
		const ta = e.target;
		ta.style.height = "auto";
		ta.style.height = ta.scrollHeight + "px";
	}, []);

	const handleTextareaKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveEditing(); }
		else if (e.key === "Escape") { e.preventDefault(); cancelEditing(); }
	}, [saveEditing, cancelEditing]);

	const scrollToParagraph = useCallback((originalIndex: number) => {
		requestAnimationFrame(() => {
			const displayIndex = originalToParagraphIndex[originalIndex];
			if (displayIndex !== undefined) {
				const el = paragraphRefs.current[displayIndex];
				if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
			}
		});
	}, [originalToParagraphIndex]);

	useEffect(() => {
		paragraphRefs.current = [];
	}, [chapter]);

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

	const performSearch = useCallback((query: string) => {
		if (!query.trim()) { setSearchResults([]); return; }
		const results: typeof searchResults = [];
		const lowerQuery = query.toLowerCase();
		paragraphs.forEach((para, displayIndex) => {
			let startIndex = 0;
			const lowerPara = para.toLowerCase();
			while (startIndex < lowerPara.length) {
				const matchIndex = lowerPara.indexOf(lowerQuery, startIndex);
				if (matchIndex === -1) break;
				results.push({
					paraIndex: paragraphToOriginalIndex[displayIndex],
					matchStart: matchIndex,
					matchEnd: matchIndex + query.length,
					text: para.slice(Math.max(0, matchIndex - 20), matchIndex) + "【" + para.slice(matchIndex, matchIndex + query.length) + "】" + para.slice(matchIndex + query.length, Math.min(para.length, matchIndex + query.length + 20)),
				});
				startIndex = matchIndex + 1;
			}
		});
		setSearchResults(results);
		setCurrentMatchIndex(results.length > 0 ? 0 : -1);
	}, [paragraphs, paragraphToOriginalIndex]);

	const prevMatch = useCallback(() => {
		if (searchResults.length === 0) return;
		setCurrentMatchIndex((prev) => { const newIndex = prev > 0 ? prev - 1 : searchResults.length - 1; setHighlightedParagraph(searchResults[newIndex].paraIndex); return newIndex; });
	}, [searchResults, setHighlightedParagraph]);

	const nextMatch = useCallback(() => {
		if (searchResults.length === 0) return;
		setCurrentMatchIndex((prev) => { const newIndex = prev < searchResults.length - 1 ? prev + 1 : 0; setHighlightedParagraph(searchResults[newIndex].paraIndex); return newIndex; });
	}, [searchResults, setHighlightedParagraph]);

	const closeSearch = useCallback(() => {
		setShowSearch(false);
		setSearchResults([]);
		setCurrentMatchIndex(0);
		setSearchQuery("");
	}, []);

	useEffect(() => { if (containerRef.current) containerRef.current.scrollTop = 0; }, [currentChapterIndex]);

	const handleTouchStart = useCallback((e: React.TouchEvent) => {
		touchStartY.current = e.touches[0].clientY;
		if (containerRef.current) touchStartScrollTop.current = containerRef.current.scrollTop;
		isDragging.current = true;
	}, []);

	const handleTouchMove = useCallback((e: React.TouchEvent) => {
		if (!isDragging.current || !containerRef.current) return;
		const container = containerRef.current;
		const currentY = e.touches[0].clientY;
		const deltaY = currentY - touchStartY.current;
		const isAtTop = touchStartScrollTop.current === 0;
		const isAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 10;
		if (isAtTop && deltaY > 50 && currentChapterIndex > 0) {
			isDragging.current = false;
			setCurrentChapterIndex(currentChapterIndex - 1);
			setTimeout(() => { if (containerRef.current) containerRef.current.scrollTop = containerRef.current.scrollHeight; }, 100);
		} else if (isAtBottom && deltaY < -50 && currentChapterIndex < chapters.length - 1) {
			isDragging.current = false;
			setCurrentChapterIndex(currentChapterIndex + 1);
		}
	}, [currentChapterIndex, chapters.length, setCurrentChapterIndex]);

	const handleTouchEnd = useCallback(() => { isDragging.current = false; }, []);

	const bgImageUrl = useAppStore((s) => s.bgImageUrl);
	const textColor = useMemo(() => {
		if (readingBackground === "custom") return customTextColor;
		if (readingBackground === "dark") return "#E0E0E0";
		if (readingBackground === "image") return "#333333";
		return BG_COLORS[readingBackground]?.text ?? "#333333";
	}, [readingBackground, customTextColor]);
	const bgStyle = useMemo(() => {
		if (readingBackground === "custom") return { backgroundColor: customBgColor };
		if (readingBackground === "image") return { backgroundImage: `url(${bgImageUrl})`, backgroundSize: "cover", backgroundPosition: "center" };
		if (readingBackground === "dark") return { backgroundColor: "#2C2C2C" };
		return { backgroundColor: BG_COLORS[readingBackground]?.bg };
	}, [readingBackground, customBgColor, bgImageUrl]);

	if (!chapter) return <div className="reader-panel empty"><EmptyState icon="📖" message="请导入 TXT 小说文件开始阅读" /></div>;

	return (
		<div className="reader-panel">
			<div className="reader-toolbar">
				<span className="chapter-title" onClick={() => setShowChapterList(true)}>
					{chapter.title || ""}<span className="chapter-dropdown-icon">▼</span>
				</span>
				{showReadingModeToggle && (
					<div className="reading-mode-toggle">
						<span className="toggle-label">📖 阅读模式</span>
						<label className="toggle-switch">
							<input type="checkbox" checked={readingMode} onChange={(e) => setReadingMode(e.target.checked)} />
							<span className="toggle-slider"></span>
						</label>
					</div>
				)}
				{!readingMode && <button className="reader-search-btn" onClick={() => setShowSearch(true)} title="搜索">🔍</button>}
			</div>

			{showSearch && (
				<div className="search-bar">
					<input className="search-input" value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); performSearch(e.target.value); }} placeholder="搜索…" autoFocus />
					<button className="search-nav" onClick={prevMatch} disabled={searchResults.length === 0}>↑</button>
					<button className="search-nav" onClick={nextMatch} disabled={searchResults.length === 0}>↓</button>
					<span className="search-count">{searchResults.length > 0 ? `${currentMatchIndex + 1}/${searchResults.length}` : ""}</span>
					<button className="search-close" onClick={closeSearch}>✕</button>
				</div>
			)}

			<div className={`reader-content${readingMode ? " reading-mode" : ""}`} ref={containerRef} onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}
				onClick={(e) => { if (showReadingSettings) { const t = e.target as HTMLElement; if (!t.closest(".reading-settings-panel") && !t.closest(".reading-settings-toggle")) setShowReadingSettings(false); } }}
				style={readingMode ? { lineHeight: lineSpacing, ...bgStyle, color: textColor, fontSize: `${fontSize}px`, ["--reader-line-spacing" as string]: lineSpacing, ["--reader-paragraph-spacing" as string]: `${paragraphSpacing}px` } : { fontSize: `${fontSize}px` }}
			>
				{paragraphs.map((para, i) => {
					const originalIndex = paragraphToOriginalIndex[i];
					const isAnimTarget = !readingMode && applyAnimation?.chapterId === chapter.id && applyAnimation?.paragraphIndex === originalIndex;
					const highlightInfo = isAnimTarget && applyAnimation?.startIndex !== undefined ? {
		before: para.slice(0, applyAnimation!.startIndex),
		highlight: para.slice(applyAnimation!.startIndex, applyAnimation!.endIndex),
		after: para.slice(applyAnimation!.endIndex),
		isOld: true,
	} : null;
					const isEditing = editingIndex === i;
					return (
						<div key={i} ref={(el) => { paragraphRefs.current[i] = el; }}
							className={`reader-paragraph${readingMode ? " reading-mode" : ""}${highlightedParagraph === originalIndex && !readingMode ? " highlighted" : ""}${isAnimTarget ? ` anim-${applyAnimation!.phase}` : ""}${isEditing ? " editing" : ""}`}
							onClick={() => { if (!isEditing) setHighlightedParagraph(originalIndex); }}
							onDoubleClick={() => { if (!isEditing && !readingMode) startEditing(i, para); }}
						>
							{!readingMode && (
								<span className={`line-number${startLine === originalIndex ? " start-line" : ""}`} onClick={(e) => { e.stopPropagation(); setStartLine(startLine === originalIndex ? null : originalIndex); }} title={startLine === originalIndex ? "取消起始行" : "设为校对起始行"}>{originalIndex + 1}</span>
							)}
							{isEditing ? (
								<textarea ref={textareaRef} className="line-edit-textarea" value={editValue} onChange={handleTextareaInput} onKeyDown={handleTextareaKeyDown} onBlur={saveEditing} rows={1} style={{ fontSize: `${fontSize}px` }} />
							) : highlightInfo ? (
								<span className="line-text">{highlightInfo.before}<span className={`text-highlight ${highlightInfo.isOld ? "highlight-old" : "highlight-new"}`}>{highlightInfo.highlight}</span>{highlightInfo.after}</span>
							) : (
								<span className="line-text">{para}</span>
							)}
						</div>
					);
				})}
			</div>

			{readingMode && (
				<>
					{showReadingSettings && <ReadingSettingsPanel onClose={() => setShowReadingSettings(false)} />}
					<button className="reading-settings-toggle" onClick={() => setShowReadingSettings(!showReadingSettings)}>⚙️</button>
					{showChapterList && (
						<>
							<div className="chapter-list-overlay" onClick={() => setShowChapterList(false)} />
							<div className="chapter-list-modal">
								<div className="chapter-list-header"><span>目录</span><button className="chapter-list-close" onClick={() => setShowChapterList(false)}>✕</button></div>
								<div className="chapter-list-content">
									{chapters.map((ch, index) => (
										<div key={ch.id} className={`chapter-list-item${index === currentChapterIndex ? " active" : ""}`} onClick={() => { setCurrentChapterIndex(index); setShowChapterList(false); }}>
											<span className="chapter-index">{index + 1}</span>
											<span className="chapter-name">{ch.title || `第 ${index + 1} 章`}</span>
										</div>
									))}
								</div>
							</div>
						</>
					)}
				</>
			)}
		</div>
	);
}
