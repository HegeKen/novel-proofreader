// ============================================================
// 跨小说全文搜索组件
// ============================================================
import { useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useAppStore } from "../stores/appStore";
import { useProofreadStore } from "../stores/proofreadStore";
import { useMobile } from "../hooks/useMobile";
import { splitParagraphs } from "../utils/chapterSplit";
import { Icons } from "./Icons";

export interface SearchResult {
	novelId: string;
	novelName: string;
	chapterIndex: number;
	chapterTitle: string;
	paragraphIndex: number;
	lineNumber: number;
	text: string;
	matchStart: number;
	matchEnd: number;
}

export function GlobalSearch() {
	const [showSearch, setShowSearch] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
	const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);

	const novels = useAppStore((s) => s.novels);
	const selectNovel = useAppStore((s) => s.selectNovel);
	const setChapters = useAppStore((s) => s.setChapters);
	const setCurrentChapterIndex = useAppStore((s) => s.setCurrentChapterIndex);
	const setReadingMode = useAppStore((s) => s.setReadingMode);
	const setHighlightedParagraph = useProofreadStore((s) => s.setHighlightedParagraph);

	// 执行跨小说搜索
	const performSearch = useCallback((query: string) => {
		if (!query.trim()) {
			setSearchResults([]);
			return;
		}

		const results: SearchResult[] = [];
		const lowerQuery = query.toLowerCase();

		novels.forEach((novel) => {
			if (!novel.fullText) return;

			// 分割章节
			const chapters = novel.fullText.split(/第[零一二三四五六七八九十百千]+章/).filter((c) => c.trim());
			
			chapters.forEach((chapterContent, chapterIndex) => {
				const paragraphs = splitParagraphs(chapterContent);
				const chapterTitle = `第${chapterIndex + 1}章`;

				let cumulativeLineNumber = 0; // 累计行号（从章节开始计算）

				paragraphs.forEach((para, paraIndex) => {
					const lowerPara = para.toLowerCase();
					const matchIndex = lowerPara.indexOf(lowerQuery);
					if (matchIndex >= 0) {
						// 计算匹配位置在当前段落中的行号（基于换行符）
						const textBeforeMatch = para.slice(0, matchIndex);
						const linesBeforeMatch = (textBeforeMatch.match(/\n/g) || []).length;
						const lineNumber = cumulativeLineNumber + linesBeforeMatch + 1; // +1 是因为行号从1开始

						// 提取上下文
						const contextStart = Math.max(0, matchIndex - 30);
						const contextEnd = Math.min(para.length, matchIndex + query.length + 30);
						const contextText = (contextStart > 0 ? "..." : "") +
							para.slice(contextStart, contextEnd) +
							(contextEnd < para.length ? "..." : "");

						results.push({
							novelId: novel.id,
							novelName: novel.name,
							chapterIndex,
							chapterTitle,
							paragraphIndex: paraIndex,
							lineNumber,
							text: contextText,
							matchStart: contextStart > 0 ? matchIndex - contextStart : matchIndex,
							matchEnd: matchIndex - contextStart + query.length,
						});
					}

					// 更新累计行号
					cumulativeLineNumber += (para.match(/\n/g) || []).length + 1;
				});
			});
		});

		setSearchResults(results);
		setCurrentMatchIndex(0);
	}, [novels]);

	// 处理搜索结果点击
	const handleResultClick = useCallback((result: SearchResult) => {
		// 选择小说
		selectNovel(result.novelId);

		// 加载章节
		const novel = novels.find((n) => n.id === result.novelId);
		if (novel && novel.fullText) {
			const chapters = novel.fullText.split(/第[零一二三四五六七八九十百千]+章/).filter((c) => c.trim());
			const chapterTitles = chapters.map((_, i) => `第${i + 1}章`);
			
			setChapters(
				chapters.map((content, i) => ({
					id: i,
					title: chapterTitles[i],
					startIndex: 0,
					endIndex: content.length,
					content,
				}))
			);

			// 设置当前章节
			setCurrentChapterIndex(result.chapterIndex);

			// 设置高亮段落索引（这会触发 ReaderPanel 的滚动）
			setHighlightedParagraph(result.paragraphIndex);

			// 确保关闭搜索后页面已渲染完成再滚动
			setTimeout(() => {
				setHighlightedParagraph(result.paragraphIndex);
			}, 100);

			// 切换到校对模式（非阅读模式）以显示高亮效果
			setReadingMode(false);
			setShowSearch(false);
		}
	}, [novels, selectNovel, setChapters, setCurrentChapterIndex, setReadingMode, setHighlightedParagraph]);

	// 快捷键处理
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === "f") {
				e.preventDefault();
				setShowSearch(true);
			}
			if (e.key === "Escape" && showSearch) {
				setShowSearch(false);
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [showSearch]);

	// 自动聚焦
	useEffect(() => {
		if (showSearch && inputRef.current) {
			inputRef.current.focus();
		}
	}, [showSearch]);

	const { isMobile } = useMobile();

	return (
		<>
			<button
				className={isMobile ? "btn-mobile" : "btn"}
				onClick={() => setShowSearch(true)}
				title="跨小说搜索 (Ctrl+F)"
			>
				<Icons.search size={18} />
				{!isMobile && <span>全局搜索</span>}
			</button>

			{showSearch && createPortal(
				<div className="global-search-overlay" onClick={() => setShowSearch(false)}>
					<div className="config-modal" onClick={(e) => e.stopPropagation()}>
						<div className="config-header">
							<div className="config-title">
								<Icons.search size={18} />
								<span>跨小说全文搜索</span>
							</div>
							<button
								className="close-btn"
								onClick={() => setShowSearch(false)}
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

						<div className="global-search-input-wrapper">
							<Icons.search size={16} className="search-icon" />
							<input
								ref={inputRef}
								type="text"
								className="global-search-input"
								placeholder="搜索所有已导入的小说..."
								value={searchQuery}
								onChange={(e) => {
									setSearchQuery(e.target.value);
									performSearch(e.target.value);
								}}
							/>
							{searchQuery && (
								<button
									className="global-search-clear"
									onClick={() => {
										setSearchQuery("");
										performSearch("");
									}}
								>
									<Icons.x size={14} />
								</button>
							)}
						</div>

						<div className="global-search-stats">
							找到 {searchResults.length} 个匹配结果
						</div>

						<div className="global-search-results">
							{searchResults.length === 0 ? (
								<div className="global-search-empty">
									<Icons.search size={48} />
									<span>{searchQuery ? "未找到匹配结果" : "输入关键词开始搜索"}</span>
								</div>
							) : (
								searchResults.map((result, index) => (
									<div
										key={index}
										className={`global-search-result${index === currentMatchIndex ? " current" : ""}`}
										onClick={() => handleResultClick(result)}
									>
										<div className="result-novel">📚 {result.novelName}</div>
										<div className="result-chapter">
											<Icons.book size={14} />
											{result.chapterTitle}
											<span className="result-line-number">行 {result.lineNumber}</span>
										</div>
										<div className="result-text">
											{result.text.slice(0, result.matchStart)}
											<span className="match-highlight">
												{result.text.slice(result.matchStart, result.matchEnd)}
											</span>
											{result.text.slice(result.matchEnd)}
										</div>
									</div>
								))
							)}
						</div>

						{searchResults.length > 0 && (
							<div className="global-search-nav">
								<button
									className="nav-btn"
									onClick={() => {
										if (currentMatchIndex > 0) {
											setCurrentMatchIndex(currentMatchIndex - 1);
										}
									}}
									disabled={currentMatchIndex === 0}
								>
									<Icons.chevronUp size={16} />
								</button>
								<span className="nav-info">
									{currentMatchIndex + 1} / {searchResults.length}
								</span>
								<button
									className="nav-btn"
									onClick={() => {
										if (currentMatchIndex < searchResults.length - 1) {
											setCurrentMatchIndex(currentMatchIndex + 1);
										}
									}}
									disabled={currentMatchIndex === searchResults.length - 1}
								>
									<Icons.chevronDown size={16} />
								</button>
							</div>
						)}
					</div>
				</div>
				, document.body
			)}
		</>
	);
}