// ============================================================
// 服务端文件选择弹窗（Web 版）：浏览挂载目录并选择文件/文件夹
// 由 filePickerStore 命令式唤起，桌面端不会渲染
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { Icons } from "./Icons";
import { completeServerSelection, useFilePickerStore, type FilePickerOptions } from "../stores/filePickerStore";
import { listServerDir, listServerRoots, type ServerEntry, type ServerRoot } from "../lib/backend/serverFiles";
import { logger } from "../utils/logger";

const EMPTY_ENTRIES: ServerEntry[] = [];

export function ServerFilePickerModal() {
	const options = useFilePickerStore((s) => s.options);
	if (!options) return null;
	// 关闭时卸载、重开时全新挂载，选择/路径等状态自动重置
	return <ServerFilePickerContent options={options} />;
}

interface ContentProps {
	options: FilePickerOptions;
}

function ServerFilePickerContent({ options }: ContentProps) {
	// 请求结果携带其对应的路径，loading/error/entries 全部由结果派生，
	// 避免在 effect 体内同步 setState（react-hooks/set-state-in-effect）
	const [rootsResult, setRootsResult] = useState<{ roots?: ServerRoot[]; error?: string }>({});
	const [currentPath, setCurrentPath] = useState("");
	const [dirResult, setDirResult] = useState<{ path: string; entries?: ServerEntry[]; error?: string } | null>(null);
	const [selected, setSelected] = useState<string[]>([]);

	const isDirectoryMode = !!options.directory;
	const multiple = !!options.multiple;

	// 挂载时加载根目录，默认定位到第一个根目录或 defaultPath
	useEffect(() => {
		let cancelled = false;
		listServerRoots()
			.then((list) => {
				if (cancelled) return;
				setRootsResult({ roots: list });
				setCurrentPath(options.defaultPath || list[0]?.path || "");
			})
			.catch((err: unknown) => {
				if (cancelled) return;
				logger.errorGeneric("[ServerFilePicker] 获取根目录失败:", err);
				setRootsResult({ error: err instanceof Error ? err.message : String(err) });
			});
		return () => {
			cancelled = true;
		};
	}, [options.defaultPath]);

	// 目录变化时加载内容
	useEffect(() => {
		if (!currentPath) return;
		let cancelled = false;
		listServerDir(currentPath)
			.then((list) => {
				if (cancelled) return;
				setDirResult({ path: currentPath, entries: list });
			})
			.catch((err: unknown) => {
				if (cancelled) return;
				logger.errorGeneric("[ServerFilePicker] 读取目录失败:", err);
				setDirResult({ path: currentPath, error: err instanceof Error ? err.message : String(err) });
			});
		return () => {
			cancelled = true;
		};
	}, [currentPath]);

	// Esc 关闭
	useEffect(() => {
		const handleKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") completeServerSelection(null);
		};
		window.addEventListener("keydown", handleKey);
		return () => window.removeEventListener("keydown", handleKey);
	}, []);

	const roots = rootsResult.roots ?? [];
	const isCurrentDir = dirResult?.path === currentPath;
	const entries = isCurrentDir ? dirResult?.entries ?? EMPTY_ENTRIES : EMPTY_ENTRIES;
	const dirError = isCurrentDir ? dirResult?.error ?? null : null;
	const loading = (!rootsResult.roots && !rootsResult.error) || (currentPath !== "" && !isCurrentDir);
	const error = rootsResult.error ?? dirError;

	const allowedExtensions = useMemo(() => {
		const list = options.filters?.flatMap((filter) => filter.extensions) ?? [];
		return list.map((ext) => ext.toLowerCase());
	}, [options.filters]);

	const visibleEntries = useMemo(() => {
		return entries.filter((entry) => {
			if (entry.isDir) return true;
			if (allowedExtensions.length === 0) return true;
			const ext = entry.name.split(".").pop()?.toLowerCase() ?? "";
			return allowedExtensions.includes(ext);
		});
	}, [entries, allowedExtensions]);

	const handleEntry = (entry: ServerEntry) => {
		if (entry.isDir) {
			setCurrentPath(entry.path);
			setSelected([]);
			return;
		}
		if (multiple) {
			setSelected((prev) =>
				prev.includes(entry.path)
					? prev.filter((item) => item !== entry.path)
					: [...prev, entry.path],
			);
		} else {
			setSelected([entry.path]);
		}
	};

	const handleConfirm = () => {
		if (isDirectoryMode) {
			completeServerSelection(currentPath || null);
			return;
		}
		if (multiple) {
			completeServerSelection(selected.length > 0 ? selected : null);
		} else {
			completeServerSelection(selected[0] ?? null);
		}
	};

	const goUp = () => {
		const parent = currentPath.replace(/[\\/][^\\/]+$/, "");
		if (parent && parent !== currentPath && roots.some((root) => currentPath.startsWith(root.path))) {
			setCurrentPath(parent);
			setSelected([]);
		}
	};

	const title = options.title ?? (isDirectoryMode ? "选择服务器目录" : "选择服务器文件");

	return (
		<div
			className="modal-overlay"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) completeServerSelection(null);
			}}
		>
			<div className="config-modal server-picker-modal" role="dialog" aria-modal="true">
				<div className="config-header">
					<h2 className="config-title">
						<span className="title-icon"><Icons.server size={18} /></span>
						{title}
					</h2>
					<button className="close-btn" onClick={() => completeServerSelection(null)} title="关闭">
						<Icons.close size={18} />
					</button>
				</div>
				<div className="config-body">
					{roots.length > 0 && (
						<div className="server-picker-roots">
							{roots.map((root) => (
								<button
									key={root.path}
									className={`server-picker-root ${currentPath === root.path ? "active" : ""}`}
									onClick={() => {
										setCurrentPath(root.path);
										setSelected([]);
									}}
									title={root.path}
								>
									<Icons.import size={14} />
									{root.name}
								</button>
							))}
						</div>
					)}

					<div className="server-picker-path">
						<button className="server-picker-up" onClick={goUp} title="上一级">
							<Icons.arrowLeft size={16} />
						</button>
						<span className="server-picker-path-text">{currentPath || "未选择目录"}</span>
					</div>

					<div className="server-picker-list">
						{loading && <div className="server-picker-hint">加载中…</div>}
						{!loading && error && <div className="server-picker-error">{error}</div>}
						{!loading && !error && visibleEntries.length === 0 && (
							<div className="server-picker-hint">该目录为空</div>
						)}
						{!loading && !error && visibleEntries.map((entry) => (
							<button
								key={entry.path}
								className={`server-picker-item ${selected.includes(entry.path) ? "selected" : ""}`}
								onClick={() => handleEntry(entry)}
								onDoubleClick={() => {
									handleEntry(entry);
									if (!entry.isDir && !isDirectoryMode) {
										completeServerSelection(entry.path);
									}
								}}
								title={entry.path}
							>
								<span className="server-picker-item-icon">
									{entry.isDir ? <Icons.import size={16} /> : <Icons.file size={16} />}
								</span>
								<span className="server-picker-item-name">{entry.name}</span>
								{entry.isDir && <Icons.chevronRight size={14} />}
								{!entry.isDir && selected.includes(entry.path) && <Icons.check size={14} />}
							</button>
						))}
					</div>

					<div className="server-picker-footer">
						<button className="btn btn-secondary" onClick={() => completeServerSelection(null)}>
							取消
						</button>
						<button className="btn btn-primary" onClick={handleConfirm}>
							{isDirectoryMode ? "选择此目录" : "导入所选"}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
