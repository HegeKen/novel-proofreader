import { useState, useRef, useCallback, useEffect } from "react";
import { useAppStore } from "../stores/appStore";
import { splitChapters } from "../utils/chapterSplit";
import { decodeTextBuffer } from "../utils/decodeText";
import { formatFileSize, formatDateTime } from "../utils/formatters";
import { exportToFile, saveNovelToStorage, deleteNovelFromStorage } from "../utils/fileExport";
import { EmptyState } from "./EmptyState";
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

	const [contextMenu, setContextMenu] = useState<{
		x: number;
		y: number;
		novel: Novel;
	} | null>(null);
	const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
				chapters: [],
			};
			addNovel(novel);

			await saveNovelToStorage(`${novel.name}.txt`, text);

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

	const handleContextMenu = (e: React.MouseEvent, novel: Novel) => {
		e.preventDefault();
		e.stopPropagation();
		setContextMenu({ x: e.clientX, y: e.clientY, novel });
	};

	const handleTouchStart = (novel: Novel) => {
		longPressTriggered.current = false;
		longPressTimer.current = setTimeout(() => {
			longPressTriggered.current = true;
			setContextMenu({ x: window.innerWidth / 2, y: window.innerHeight / 2, novel });
		}, 500);
	};

	const handleTouchEnd = () => {
		if (longPressTimer.current) {
			clearTimeout(longPressTimer.current);
			longPressTimer.current = null;
		}
	};

	const handleExport = useCallback(async (novel: Novel) => {
		setContextMenu(null);
		await exportToFile(novel.fullText, `${novel.name}.txt`);
	}, []);

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
				<span className="novel-list-title">📚 小说库</span>
				<button
					className="btn-import-novel"
					onClick={handleImport}
					title="导入新小说"
				>
					+
				</button>
			</div>
			<div className="novel-list-items">
				{novels.length === 0 ? (
					<EmptyState
						icon="📚"
						message="暂无小说"
						hint="点击 + 导入 TXT 文件"
					/>
				) : (
					novels.map((novel) => (
						<div
							key={novel.id}
							className={`novel-item ${currentNovelId === novel.id ? "active" : ""}`}
							onClick={() => handleSelect(novel)}
							onContextMenu={(e) => handleContextMenu(e, novel)}
							onTouchStart={() => handleTouchStart(novel)}
							onTouchEnd={handleTouchEnd}
							onTouchMove={handleTouchEnd}
						>
							<div className="novel-item-name">{novel.name}</div>
							<div className="novel-item-meta">
								<span>{formatFileSize(novel.fullText)}</span>
								<span>{formatDateTime(novel.lastSavedAt ?? novel.importedAt)}</span>
							</div>
							<button
								className="novel-item-remove"
								onClick={(e) => handleRemove(e, novel.id)}
								title="删除"
							>
								×
							</button>
						</div>
					))
				)}
			</div>

			{contextMenu && (
				<div
					className="context-menu"
					style={{ left: contextMenu.x, top: contextMenu.y }}
					onClick={(e) => e.stopPropagation()}
				>
					<div
						className="context-menu-item"
						onClick={() => handleExport(contextMenu.novel)}
					>
						📤 导出
					</div>
				</div>
			)}
		</div>
	);
}
