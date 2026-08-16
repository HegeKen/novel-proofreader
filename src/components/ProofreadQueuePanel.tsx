import { useState } from "react";
import { useNovelStore } from "../stores/novelStore";
import { useProofreadMetaStore } from "../stores/proofreadMetaStore";
import { useAICheck } from "../hooks/useAICheck";
import { useChapterTitleSuggestion } from "../hooks/useChapterTitleSuggestion";
import { Icons } from "./Icons";
import { isDefaultChapterTitle } from "../utils/chapterSplit";

export function ProofreadQueuePanel() {
	const queue = useProofreadMetaStore((s) => s.proofreadQueue);
	const currentTaskId = useProofreadMetaStore((s) => s.currentProofreadingTaskId);
	const currentNovelId = useNovelStore((s) => s.currentNovelId);
	const chapters = useNovelStore((s) => s.chapters);
	const currentChapterIndex = useNovelStore((s) => s.currentChapterIndex);
	const addToQueue = useProofreadMetaStore((s) => s.addToProofreadQueue);
	const removeFromQueue = useProofreadMetaStore((s) => s.removeFromProofreadQueue);
	const updateQueueItemStatus = useProofreadMetaStore((s) => s.updateQueueItemStatus);
	const clearQueue = useProofreadMetaStore((s) => s.clearProofreadQueue);
	const setCurrentProofreadingTaskId = useProofreadMetaStore((s) => s.setCurrentProofreadingTaskId);

	const [selectedChapters, setSelectedChapters] = useState<number[]>([]);
	const [isRunning, setIsRunning] = useState(false);

	// 章节名推荐（复用共享 hook）
	const {
		suggestingChapterId,
		chapterTitleSuggestions,
		handleSuggestChapterTitle,
		handleApplyChapterTitle,
		handleCloseSuggestions,
	} = useChapterTitleSuggestion();

	const { checkChapter } = useAICheck();

	// 选择/取消选择章节
	const toggleChapterSelection = (chapterId: number) => {
		setSelectedChapters((prev) =>
			prev.includes(chapterId)
				? prev.filter((id) => id !== chapterId)
				: [...prev, chapterId]
		);
	};

	// 全选/取消全选
	const toggleSelectAll = () => {
		if (selectedChapters.length === chapters.length) {
			setSelectedChapters([]);
		} else {
			setSelectedChapters(chapters.map((ch) => ch.id));
		}
	};

	// 添加选中章节到队列
	const handleAddToQueue = () => {
		if (selectedChapters.length === 0) return;
		const items = selectedChapters
			.map((chapterId) => {
				const chapter = chapters.find((ch) => ch.id === chapterId);
				return chapter
					? {
							chapterId: chapter.id,
							chapterTitle: chapter.title,
							novelId: currentNovelId || "",
					  }
					: null;
			})
			.filter((item): item is { chapterId: number; chapterTitle: string; novelId: string } => item !== null);
		addToQueue(items);
		setSelectedChapters([]);
	};

	// 处理队列中的任务
	const processQueue = async () => {
		if (isRunning || queue.length === 0) return;
		setIsRunning(true);

		for (const item of queue) {
			if (item.status !== "pending") continue;

			setCurrentProofreadingTaskId(item.id);
			updateQueueItemStatus(item.id, "running");

			try {
				// 从 store 实时读取章节列表，避免闭包捕获过期快照
				const latestChapters = useNovelStore.getState().chapters;
				// 切换到对应章节
				const chapterIndex = latestChapters.findIndex((ch) => ch.id === item.chapterId);
				if (chapterIndex >= 0) {
					useNovelStore.getState().setCurrentChapterIndex(chapterIndex);
					await new Promise((resolve) => setTimeout(resolve, 500));
				}

				// 执行校对
				await checkChapter("chapter", 0);
				updateQueueItemStatus(item.id, "done");
			} catch (error) {
				updateQueueItemStatus(item.id, "error", error instanceof Error ? error.message : "Unknown error");
			}
		}

		setCurrentProofreadingTaskId(null);
		setIsRunning(false);
	};

	// 获取队列统计
	const pendingCount = queue.filter((item) => item.status === "pending").length;
	const runningCount = queue.filter((item) => item.status === "running").length;
	const doneCount = queue.filter((item) => item.status === "done").length;
	const errorCount = queue.filter((item) => item.status === "error").length;

	return (
		<div className="proofread-queue-panel">
			<div className="queue-stats">
				<div className="usage-stat-card">
					<div className="usage-stat-header">
						<div className="usage-stat-icon">
							<Icons.clock size={16} />
						</div>
					</div>
					<div className="usage-stat-value">{pendingCount}</div>
					<div className="usage-stat-label">待处理</div>
				</div>

				<div className="usage-stat-card running">
					<div className="usage-stat-header">
						<div className="usage-stat-icon">
							<Icons.loader2 size={16} />
						</div>
					</div>
					<div className="usage-stat-value">{runningCount}</div>
					<div className="usage-stat-label">进行中</div>
				</div>

				<div className="usage-stat-card success">
					<div className="usage-stat-header">
						<div className="usage-stat-icon">
							<Icons.checkCircle size={16} />
						</div>
					</div>
					<div className="usage-stat-value">{doneCount}</div>
					<div className="usage-stat-label">已完成</div>
				</div>

				<div className="usage-stat-card failed">
					<div className="usage-stat-header">
						<div className="usage-stat-icon">
							<Icons.alertCircle size={16} />
						</div>
					</div>
					<div className="usage-stat-value">{errorCount}</div>
					<div className="usage-stat-label">失败</div>
				</div>
			</div>

			<div className="chapter-selection">
				<div className="selection-header">
					<label className="select-all">
						<input
							type="checkbox"
							checked={selectedChapters.length === chapters.length && chapters.length > 0}
							onChange={toggleSelectAll}
						/>
						<span>全选</span>
					</label>
				</div>

				<div className="chapter-list">
					{chapters.map((chapter, index) => {
						const hasNoTitle = isDefaultChapterTitle(chapter.title);
						const isSuggesting = suggestingChapterId === chapter.id;
						const suggestions = chapterTitleSuggestions[chapter.id] ?? [];
						const showSuggestions = suggestingChapterId === chapter.id && suggestions.length > 0;

						return (
							<div key={chapter.id}>
								<div
									className={`chapter-item ${selectedChapters.includes(chapter.id) ? "selected" : ""} ${index === currentChapterIndex ? "current" : ""}`}
								>
									<input
										type="checkbox"
										checked={selectedChapters.includes(chapter.id)}
										onChange={() => toggleChapterSelection(chapter.id)}
									/>
									<span className="chapter-index">{index + 1}</span>
									<span className="chapter-title-text">{chapter.title}</span>
									{index === currentChapterIndex && (
										<Icons.check size={14} className="current-indicator" />
									)}
									{hasNoTitle && (
										<button
											className="suggest-title-btn"
											onClick={() => handleSuggestChapterTitle(chapter.id, index)}
											disabled={isSuggesting}
										>
											<Icons.sparkle size={14} />
										</button>
									)}
								</div>
								{showSuggestions && (
									<div className="chapter-title-suggestions">
										<div className="suggestions-header">
											<span>AI推荐章节名</span>
											<button
												className="close-suggestions"
												onClick={() => handleCloseSuggestions(chapter.id)}
											>
												<Icons.x size={14} />
											</button>
										</div>
										{suggestions.map((title, idx) => (
											<button
												key={idx}
												className="suggestion-item"
												onClick={() => handleApplyChapterTitle(chapter.id, title)}
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

			{queue.length > 0 && (
				<div className="queue-list">
					<div className="queue-list-header">任务队列</div>
					{queue.map((item) => (
						<div
							key={item.id}
							className={`queue-item ${item.status} ${currentTaskId === item.id ? "current" : ""}`}
						>
							<div className="queue-item-status">
								{item.status === "pending" && <Icons.circle size={14} />}
								{item.status === "running" && <Icons.loader2 size={14} className="spin" />}
								{item.status === "done" && <Icons.checkCircle size={14} />}
								{item.status === "error" && <Icons.alertTriangle size={14} />}
							</div>
							<div className="queue-item-title">{item.chapterTitle}</div>
							<button
								onClick={() => removeFromQueue(item.id)}
								className="queue-item-remove"
							>
								<Icons.x size={14} />
							</button>
							{item.status === "error" && (
								<span className="queue-item-error">{item.errorMessage}</span>
							)}
						</div>
					))}
				</div>
			)}

			<div className="character-actions-fab-wrapper">
				<button
					onClick={clearQueue}
					disabled={queue.length === 0}
					className="btn"
				>
					<Icons.trash2 size={18} />
					<span>清空队列</span>
				</button>
				<button
					onClick={handleAddToQueue}
					disabled={selectedChapters.length === 0}
					className="btn"
				>
					<Icons.plus size={18} />
					<span>添加选中 ({selectedChapters.length})</span>
				</button>
				<button
					onClick={processQueue}
					disabled={pendingCount === 0 || isRunning}
					className="btn"
				>
					<Icons.play size={18} />
					<span>{isRunning ? "正在校对..." : `开始校对 (${pendingCount})`}</span>
				</button>
			</div>
		</div>
	);
}