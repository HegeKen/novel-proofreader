import { useState } from "react";
import { useAppStore } from "../stores/appStore";
import { useAICheck } from "../hooks/useAICheck";
import { Icons } from "./Icons";
import { generateChapterTitle } from "../utils/aiClient";

export function ProofreadQueuePanel() {
	const queue = useAppStore((s) => s.proofreadQueue);
	const currentTaskId = useAppStore((s) => s.currentProofreadingTaskId);
	const currentNovelId = useAppStore((s) => s.currentNovelId);
	const chapters = useAppStore((s) => s.chapters);
	const currentChapterIndex = useAppStore((s) => s.currentChapterIndex);
	const addToQueue = useAppStore((s) => s.addToProofreadQueue);
	const removeFromQueue = useAppStore((s) => s.removeFromProofreadQueue);
	const updateQueueItemStatus = useAppStore((s) => s.updateQueueItemStatus);
	const clearQueue = useAppStore((s) => s.clearProofreadQueue);
	const setCurrentProofreadingTaskId = useAppStore((s) => s.setCurrentProofreadingTaskId);
	const setCurrentChapterIndex = useAppStore((s) => s.setCurrentChapterIndex);

	const [selectedChapters, setSelectedChapters] = useState<number[]>([]);
	const [isRunning, setIsRunning] = useState(false);
	const aiConfig = useAppStore((s) => s.aiConfig);

	// 章节名推荐状态
	const [suggestingChapterIndex, setSuggestingChapterIndex] = useState<number | null>(null);
	const [chapterTitleSuggestions, setChapterTitleSuggestions] = useState<string[]>([]);
	const [suggestingChapterId, setSuggestingChapterId] = useState<number | null>(null);

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

	// 章节名推荐处理函数
	const handleSuggestChapterTitle = async (chapterIndex: number) => {
		if (suggestingChapterIndex === chapterIndex) return;

		const chapter = chapters[chapterIndex];
		if (!chapter) return;

		setSuggestingChapterIndex(chapterIndex);
		setSuggestingChapterId(chapter.id);
		setChapterTitleSuggestions([]);

		try {
			// 收集前几章的章节名和内容
			const previousChapters: Record<string, string> = {};
			for (let i = Math.max(0, chapterIndex - 5); i < chapterIndex; i++) {
				const prevChapter = chapters[i];
				if (prevChapter && prevChapter.title) {
					previousChapters[prevChapter.title] = prevChapter.content.slice(0, 200);
				}
			}

			const suggestions = await generateChapterTitle(
				chapter.content,
				previousChapters,
				chapterIndex + 1,
				aiConfig
			);
			setChapterTitleSuggestions(suggestions);
		} catch (error) {
			console.error("Failed to generate chapter title:", error);
			alert("生成章节名失败，请检查AI配置");
		} finally {
			setSuggestingChapterIndex(null);
		}
	};

	// 应用推荐的章节名
	const handleApplyChapterTitle = (chapterIndex: number, title: string) => {
		const chapter = chapters[chapterIndex];
		if (!chapter) return;

		// 更新章节标题
		const updatedChapters = [...chapters];
		updatedChapters[chapterIndex] = { ...chapter, title };
		useAppStore.getState().setChapters(updatedChapters);

		// 清除推荐状态
		setChapterTitleSuggestions([]);
		setSuggestingChapterId(null);
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
				// 切换到对应章节
				const chapterIndex = chapters.findIndex((ch) => ch.id === item.chapterId);
				if (chapterIndex >= 0) {
					setCurrentChapterIndex(chapterIndex);
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
			<div className="config-section queue-section">
				<div className="queue-section-header">
					<div className="queue-section-icon">
						<Icons.listTodo size={18} />
					</div>
					<span className="queue-section-title">批量校对</span>
					<span className="queue-section-subtitle">
						{pendingCount > 0 ? `待处理 ${pendingCount} 章` : "无可处理任务"}
					</span>
				</div>
				<div className="queue-actions">
					<button
						onClick={clearQueue}
						disabled={queue.length === 0}
						className="btn-clear-queue"
					>
						<Icons.trash2 size={16} />
						清空队列
					</button>
					<button
						onClick={processQueue}
						disabled={pendingCount === 0 || isRunning}
						className={`btn-start-queue ${isRunning ? "running" : ""}`}
					>
						<Icons.play size={16} />
						{isRunning ? "正在校对..." : `开始校对 (${pendingCount})`}
					</button>
				</div>
			</div>

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
					<button
						onClick={handleAddToQueue}
						disabled={selectedChapters.length === 0}
						className="btn-add-selected"
					>
						<Icons.plus size={16} />
						添加选中 ({selectedChapters.length})
					</button>
				</div>

				<div className="chapter-list">
					{chapters.map((chapter, index) => {
						const hasNoTitle = !chapter.title || /^第[\d一二三四五六七八九十]+[章回]$/.test(chapter.title);
						const isSuggesting = suggestingChapterIndex === index;
						const showSuggestions = suggestingChapterId === chapter.id && chapterTitleSuggestions.length > 0;

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
											onClick={() => handleSuggestChapterTitle(index)}
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
												onClick={() => {
													setChapterTitleSuggestions([]);
													setSuggestingChapterId(null);
												}}
											>
												<Icons.x size={14} />
											</button>
										</div>
										{chapterTitleSuggestions.map((title, idx) => (
											<button
												key={idx}
												className="suggestion-item"
												onClick={() => handleApplyChapterTitle(index, title)}
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
		</div>
	);
}