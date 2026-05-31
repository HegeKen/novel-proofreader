// ============================================================
// 章节导航侧栏（支持分卷小说）
// ============================================================
import { useEffect, useRef, forwardRef, useState, useCallback, useMemo } from "react";
import { useAppStore } from "../stores/appStore";
import { EmptyState } from "./EmptyState";
import { Icons } from "./Icons";
import { useSwipeGesture } from "../hooks/useSwipeGesture";
import type { Chapter } from "../types";
import { logger } from "../utils/logger";

const ChapterItem = forwardRef<HTMLButtonElement, {
	chapter: Chapter;
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

const VolumeItem = ({
	volume,
	chapters,
	currentChapterIndex,
	isExpanded,
	onToggleExpand,
	onChapterSelect,
	directChapters,
}: {
	volume: Chapter;
	chapters: Chapter[];
	currentChapterIndex: number;
	isExpanded: boolean;
	onToggleExpand: () => void;
	onChapterSelect?: () => void;
	directChapters?: Chapter[];
}) => {
	const setCurrentChapterIndex = useAppStore((s) => s.setCurrentChapterIndex);
	const proofreadStatus = useAppStore((s) => s.proofreadStatus);

	const volumeChapters = directChapters ?? chapters.filter(ch => ch.parentId === volume.id && !ch.isVolume);
	const allProofread = volumeChapters.length > 0 && volumeChapters.every(ch => proofreadStatus[ch.id]);
	logger.ui(`[VolumeItem] volume.id=${volume.id}, volume.title=${volume.title}, isVolume=${volume.isVolume}, chapters.length=${chapters.length}, directChapters?.length=${directChapters?.length}, volumeChapters.length=${volumeChapters.length}, isExpanded=${isExpanded}`);
	logger.ui(`[VolumeItem] volumeChapters:`, volumeChapters.map(ch => ({id: ch.id, title: ch.title, parentId: ch.parentId, isVolume: ch.isVolume})));

	return (
		<div className="volume-group">
			<button
				className={`volume-item ${allProofread ? "proofread" : ""}`}
				onClick={onToggleExpand}
				title={`${volume.title}${allProofread ? " (全部已校对)" : ""}`}
			>
				<Icons.chevronRight
					size={16}
					className={`volume-chevron ${isExpanded ? "expanded" : ""}`}
				/>
				<span className="volume-title">{volume.title}</span>
				{allProofread && (
					<Icons.circleCheckBig size={16} className="proofread-icon" />
				)}
			</button>
			{!isExpanded && (
				<div className="volume-chapters">
					{volumeChapters.map((ch) => {
						const isActive = ch.id === currentChapterIndex;
						return (
							<ChapterItem
								key={ch.id}
								chapter={ch}
								index={ch.id}
								isActive={isActive}
								onSelect={() => {
									setCurrentChapterIndex(ch.id);
									if (onChapterSelect) {
										onChapterSelect();
									}
								}}
							/>
						);
					})}
				</div>
			)}
		</div>
	);
};

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

	const [userCollapsedVolumes, setUserCollapsedVolumes] = useState<Set<number>>(new Set());

	const proofreadCount = Object.values(proofreadStatus).filter(Boolean).length;

	// 计算当前章节所属的卷
	const currentVolumeId = useMemo(() => {
		const currentChapter = chapters.find(ch => ch.id === currentChapterIndex);
		const volId = currentChapter?.parentId;
		logger.proofread(`[ChapterNav] currentVolumeId useMemo: currentChapterIndex=${currentChapterIndex}, currentChapter id=${currentChapter?.id}, parentId=${volId}`);
		return volId;
	}, [chapters, currentChapterIndex]);

	// 计算每个卷是否应该展开（用户未折叠 且 当前章节所属的卷）
	const getVolumeExpandedState = useCallback((volumeId: number): boolean => {
		// 如果用户手动折叠过，保持折叠状态
		if (userCollapsedVolumes.has(volumeId)) {
			logger.proofread(`[ChapterNav] getVolumeExpandedState: volumeId=${volumeId}, 用户已手动折叠, 返回 false`);
			return false;
		}
		// 默认展开，或者当前章节属于这个卷
		logger.proofread(`[ChapterNav] getVolumeExpandedState: volumeId=${volumeId}, userCollapsedVolumes=${Array.from(userCollapsedVolumes)}, currentVolumeId=${currentVolumeId}, 返回 true`);
		return true;
	}, [userCollapsedVolumes, currentVolumeId]);

	// 切换卷展开状态
	const toggleVolumeExpand = useCallback((volumeId: number) => {
		logger.proofread(`[ChapterNav] toggleVolumeExpand: volumeId=${volumeId}, userCollapsedVolumes before:`, Array.from(userCollapsedVolumes));
		setUserCollapsedVolumes(prev => {
			const newSet = new Set(prev);
			if (newSet.has(volumeId)) {
				newSet.delete(volumeId);
				logger.proofread(`[ChapterNav] toggleVolumeExpand: 展开卷 ${volumeId}`);
			} else {
				newSet.add(volumeId);
				logger.proofread(`[ChapterNav] toggleVolumeExpand: 折叠卷 ${volumeId}`);
			}
			logger.proofread(`[ChapterNav] toggleVolumeExpand: userCollapsedVolumes after:`, Array.from(newSet));
			return newSet;
		});
	}, [userCollapsedVolumes]);

	// 当当前章节变化时，滚动到 active 项并居中
	useEffect(() => {
		if (activeItemRef.current && chapterListRef.current) {
			const container = chapterListRef.current;
			const activeItem = activeItemRef.current;

			const containerRect = container.getBoundingClientRect();
			const itemRect = activeItem.getBoundingClientRect();

			const relativeTop = itemRect.top - containerRect.top;
			const targetScrollTop = container.scrollTop + relativeTop - container.offsetHeight / 2 + itemRect.height / 2;

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

	// 获取所有卷名
	const volumes = chapters.filter(ch => ch.isVolume);
	// 获取没有父卷的章节（前言或独立章节）
	const standaloneChapters = chapters.filter(ch => !ch.isVolume && ch.parentId === undefined);

	// 是否存在分卷
	const hasVolumes = volumes.length > 0;

	// 根据 hideProofread 过滤
	const filteredVolumes = hideProofread
		? volumes.filter(vol => {
			const volumeChapters = chapters.filter(ch => ch.parentId === vol.id && !ch.isVolume);
			return !volumeChapters.every(ch => proofreadStatus[ch.id]);
		})
		: volumes;

	const filteredStandalone = hideProofread
		? standaloneChapters.filter(ch => !proofreadStatus[ch.id])
		: standaloneChapters;

	// 所有章节（用于无分卷时的直接显示）
	const allNonVolumeChapters = chapters.filter(ch => !ch.isVolume);
	const filteredAllChapters = hideProofread
		? allNonVolumeChapters.filter(ch => !proofreadStatus[ch.id])
		: allNonVolumeChapters;

	// 计算显示的章节总数
	const totalDisplayed = hasVolumes
		? filteredStandalone.length + filteredVolumes.reduce((acc, vol) => {
			return acc + chapters.filter(ch => ch.parentId === vol.id && !ch.isVolume).length;
		}, 0)
		: filteredAllChapters.length;

	return (
		<div className="chapter-nav">
			<div className="nav-header">
				<h3>
					<Icons.list size={16} />
					章节
				</h3>
				<div className="nav-header-actions">
					<span className="chapter-count">{totalDisplayed}/{chapters.length} 章</span>
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
				{hasVolumes ? (
					<>
						{/* 独立章节放入虚拟卷（前言等） */}
						{filteredStandalone.length > 0 && (
							<VolumeItem
								key={0}
								volume={{ id: 0, title: "前言/序章", startIndex: 0, endIndex: 0, content: "", isVolume: true }}
								chapters={[]}
								currentChapterIndex={currentChapterIndex}
								isExpanded={getVolumeExpandedState(0)}
								onToggleExpand={() => toggleVolumeExpand(0)}
								onChapterSelect={onChapterSelect}
								directChapters={filteredStandalone}
							/>
						)}
						{/* 分卷章节 */}
						{filteredVolumes.map((vol) => {
							const chaptersToPass = hideProofread ? chapters.filter(ch => !proofreadStatus[ch.id]) : chapters;
							logger.ui(`[VolumeItem] 渲染 volume ${vol.id} "${vol.title}", chaptersToPass.length=${chaptersToPass.length}, hideProofread=${hideProofread}`);
							logger.ui(`[VolumeItem] chaptersToPass 中的章节:`, chaptersToPass.map(ch => ({id: ch.id, title: ch.title, parentId: ch.parentId, isVolume: ch.isVolume})));
							return (
							<VolumeItem
								key={vol.id}
								volume={vol}
								chapters={chaptersToPass}
								currentChapterIndex={currentChapterIndex}
								isExpanded={getVolumeExpandedState(vol.id)}
								onToggleExpand={() => toggleVolumeExpand(vol.id)}
								onChapterSelect={onChapterSelect}
							/>
							);
						})}
					</>
				) : (
					/* 无分卷时直接显示章节列表 */
					filteredAllChapters.map((ch, index) => {
						const isActive = ch.id === currentChapterIndex;
						return (
							<ChapterItem
								key={ch.id}
								ref={isActive ? activeItemRef : undefined}
								chapter={ch}
								index={index}
								isActive={isActive}
								onSelect={() => {
									setCurrentChapterIndex(ch.id);
									if (onChapterSelect) {
										onChapterSelect();
									}
								}}
							/>
						);
					})
				)}
			</div>
		</div>
	);
}