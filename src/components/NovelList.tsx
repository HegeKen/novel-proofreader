// ============================================================
// 最左侧小说列表
// ============================================================
import { useAppStore } from "../stores/appStore";
import { useState, useRef, useCallback, useEffect } from "react";
import { saveNovelToStorage, deleteNovelFromStorage, createCharacterTemplate } from "../utils/fileExport";
import { splitChapters } from "../utils/chapterSplit";
import { decodeTextBuffer } from "../utils/decodeText";
import { formatFileSize, formatDateTime } from "../utils/formatters";
import { EmptyState } from "./EmptyState";
import { Icons } from "./Icons";
import type { Novel } from "../types";

export function NovelList({
	onNovelSelect,
}: { onNovelSelect?: () => void } = {}) {
	const novels = useAppStore((s) => s.novels);
	const currentNovelId = useAppStore((s) => s.currentNovelId);
	const addNovel = useAppStore((s) => s.addNovel);
	const removeNovel = useAppStore((s) => s.removeNovel);
	const selectNovel = useAppStore((s) => s.selectNovel);
	const setChapters = useAppStore((s) => s.setChapters);
	const setShowCharacterSettings = useAppStore((s) => s.setShowCharacterSettings);
	const getReadingProgress = useAppStore((s) => s.getReadingProgress);
	const setCurrentChapterIndex = useAppStore((s) => s.setCurrentChapterIndex);
	const [contextMenu, setContextMenu] = useState<{
		x: number;
		y: number;
		novel: Novel;
	} | null>(null);
	const longPressTriggered = useRef(false);
	const handleImport = async () => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = ".txt";
		input.onchange = async (e) => {
			const file = (e.target as HTMLInputElement).files?.[0];
			if (!file) return;

			const buffer = await file.arrayBuffer();
			const text = decodeTextBuffer(buffer);
			const novel: Novel = {
				id: `novel-${Date.now()}`,
				name: file.name.replace(/\.txt$/i, ""),
				fullText: text,
				importedAt: Date.now(),
				chapters: [], // 添加空的章节数组以满足类型定义
			};
			addNovel(novel);

			// 保存小说到 storage
			await saveNovelToStorage(`${novel.name}.txt`, text);

			// 为新小说创建角色模板文件
			await createCharacterTemplate(novel.name);

			// 解析章节
			const chapters = splitChapters(text);
			setChapters(chapters);
		};
		input.click();
	};

	const handleSelect = (novel: Novel) => {
		if (longPressTriggered.current) {
			longPressTriggered.current = false;
			return;
		}
		selectNovel(novel.id);
		const chapters = splitChapters(novel.fullText);
		setChapters(chapters);

		const progress = getReadingProgress(novel.id);
		if (progress) {
			setCurrentChapterIndex(progress.currentChapterIndex);
		}

		if (onNovelSelect) {
			onNovelSelect();
		}
	};

	const handleRemove = async (e: React.MouseEvent, id: string) => {
		e.stopPropagation();
		const novel = novels.find(n => n.id === id);
		if (novel) {
			await deleteNovelFromStorage(`${novel.name}.txt`);
		}
		removeNovel(id);
	};

	const handleCloseContextMenu = useCallback(() => {
		setContextMenu(null);
	}, []);

	useEffect(() => {
		if (contextMenu) {
			document.addEventListener("click", handleCloseContextMenu);
			return () => document.removeEventListener("click", handleCloseContextMenu);
		}
	}, [contextMenu, handleCloseContextMenu]);
	return (
		<div className="novel-list">
			<div className="novel-list-header">
				<span className="novel-list-title">
					<Icons.library size={14} />
					小说库
				</span>
				<button
					className="btn-import-novel"
					onClick={handleImport}
					title="导入新小说"
				>
					<Icons.import size={18} />
				</button>
			</div>
			<div className="novel-list-items">
				{novels.length === 0 ? (
					<EmptyState
						icon={<Icons.library size={48} />}
						message="暂无小说"
						hint="点击 + 导入 TXT 文件"
					/>
				) : (
					novels.map((novel) => (
						<div
							key={novel.id}
							className={`novel-item ${currentNovelId === novel.id ? "active" : ""}`}
							onClick={() => handleSelect(novel)}
						>
							<div className="novel-item-content">
								<div className="novel-item-name">{novel.name}</div>
								<div className="novel-item-meta">
									<span className="meta-item">
										<Icons.file size={12} /> {formatFileSize(novel.fullText)}
									</span>
									<span className="meta-item">
										<Icons.calendar size={12} /> {formatDateTime(novel.importedAt)}
									</span>
									{novel.lastCacheSaveTime && (
										<span className="cache-indicator" title="已保存缓存">
											<Icons.cache size={12} /> {formatDateTime(novel.lastCacheSaveTime)}
										</span>
									)}
								</div>
							</div>
							<div className="novel-item-actions">
								<button
									className="novel-item-btn novel-item-btn-characters"
									onClick={(e) => {
										e.stopPropagation();
										e.preventDefault();
										setShowCharacterSettings(novel.id);
									}}
									title="角色设置"
								>
									<Icons.settings size={16} />
								</button>
								<button
									className="novel-item-btn novel-item-btn-remove"
									onClick={(e) => handleRemove(e, novel.id)}
									title="删除"
								>
									<Icons.close size={16} />
								</button>
							</div>
						</div>
					))
				)}
			</div>
		</div>
	);
}
