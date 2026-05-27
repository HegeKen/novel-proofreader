// ============================================================
// 章节导航侧栏
// ============================================================
import { useEffect, useRef, forwardRef } from "react";
import { useAppStore } from "../stores/appStore";
import { EmptyState } from "./EmptyState";
import { Icons } from "./Icons";
import { useSwipeGesture } from "../hooks/useSwipeGesture";

const ChapterItem = forwardRef<HTMLButtonElement, {
	chapter: { id: number; title: string };
	index: number;
	isActive: boolean;
	onSelect: () => void;
}>(({ chapter, index, isActive, onSelect }, ref) => {
	const proofreadStatus = useAppStore((s) => s.proofreadStatus);
	const toggleProofreadStatus = useAppStore((s) => s.toggleProofreadStatus);
	const isProofread = proofreadStatus[chapter.id] ?? false;

	const swipeHandlers = useSwipeGesture({
		onSwipeLeft: () => toggleProofreadStatus(chapter.id),
		onSwipeRight: () => toggleProofreadStatus(chapter.id),
		threshold: 60,
	});

	return (
		<button
			ref={ref}
			className={`chapter-item ${isActive ? "active" : ""} ${isProofread ? "proofread" : ""}`}
			onClick={onSelect}
			onTouchStart={swipeHandlers.onTouchStart}
			onTouchMove={swipeHandlers.onTouchMove}
			onTouchEnd={swipeHandlers.onTouchEnd}
			title={`${chapter.title}${isProofread ? " (已校对)" : ""}`}
		>
			<span className="chapter-number">{index + 1}</span>
			<span className="chapter-title">{chapter.title}</span>
			{isProofread && (
				<Icons.circleCheckBig size={16} className="proofread-icon" />
			)}
		</button>
	);
});

export function ChapterNav({
	onChapterSelect,
}: { onChapterSelect?: () => void } = {}) {
	const chapters = useAppStore((s) => s.chapters);
	const currentChapterIndex = useAppStore((s) => s.currentChapterIndex);
	const setCurrentChapterIndex = useAppStore((s) => s.setCurrentChapterIndex);
	const proofreadStatus = useAppStore((s) => s.proofreadStatus);
	const hideProofread = useAppStore((s) => s.hideProofread);
	const setHideProofread = useAppStore((s) => s.setHideProofread);
	const chapterListRef = useRef<HTMLDivElement>(null);
	const activeItemRef = useRef<HTMLButtonElement>(null);

	const proofreadCount = Object.values(proofreadStatus).filter(Boolean).length;

	// 当当前章节变化时，滚动到 active 项并居中
	useEffect(() => {
		if (activeItemRef.current && chapterListRef.current) {
			const container = chapterListRef.current;
			const activeItem = activeItemRef.current;
			
			const containerRect = container.getBoundingClientRect();
			const itemRect = activeItem.getBoundingClientRect();
			
			// 计算元素相对于容器的位置
			const relativeTop = itemRect.top - containerRect.top;
			
			// 计算目标滚动位置，使元素在容器中垂直居中
			const targetScrollTop = container.scrollTop + relativeTop - container.offsetHeight / 2 + itemRect.height / 2;
			
			// 平滑滚动
			container.scrollTo({
				top: Math.max(0, targetScrollTop),
				behavior: 'smooth'
			});
		}
	}, [currentChapterIndex]);

	if (chapters.length === 0) {
		return (
			<div className="chapter-nav empty">
				<div className="nav-header">
					<h3>
						<Icons.list size={16} />
						章节
					</h3>
				</div>
				<EmptyState icon={<Icons.list size={48} />} message="导入 TXT 文件后" hint="章节将在此列出" />
			</div>
		);
	}

	const displayedChapters = hideProofread
		? chapters.filter((ch) => !proofreadStatus[ch.id])
		: chapters;

	return (
		<div className="chapter-nav">
			<div className="nav-header">
				<h3>
					<Icons.list size={16} />
					章节
				</h3>
				<div className="nav-header-actions">
					<span className="chapter-count">{displayedChapters.length}/{chapters.length} 章</span>
					{proofreadCount > 0 && (
						<button
							className={`btn-hide-proofread ${hideProofread ? "active" : ""}`}
							onClick={() => setHideProofread(!hideProofread)}
							title={hideProofread ? "显示已校对章节" : "隐藏已校对章节"}
						>
							<Icons.circleCheckBig size={14} />
							{hideProofread ? "显示" : "隐藏"}已校对
						</button>
					)}
				</div>
			</div>
			<div className="chapter-list" ref={chapterListRef}>
				{displayedChapters.map((ch) => {
					const originalIndex = chapters.indexOf(ch);
					const isActive = originalIndex === currentChapterIndex;
					return (
						<ChapterItem
							key={ch.id}
							ref={isActive ? activeItemRef : null}
							chapter={ch}
							index={originalIndex}
							isActive={isActive}
							onSelect={() => {
								setCurrentChapterIndex(originalIndex);
								if (onChapterSelect) {
									onChapterSelect();
								}
							}}
						/>
					);
				})}
			</div>
		</div>
	);
}
