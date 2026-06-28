// ============================================================
// CJK 变体字扫描与替换弹窗
// ============================================================
import { useState, useCallback, useMemo } from "react";
import { useNovelStore } from "../stores/novelStore";
import { useAppMetaStore } from "../stores/appMetaStore";
import { Icons } from "./Icons";
import { scanCJKVariants, normalizeCJKVariants, type CJKVariantEntry } from "../utils/normalizeCJK";
import { splitChapters } from "../utils/chapterSplit";
import { logger } from "../utils/logger";

interface Props {
	open: boolean;
	onClose: () => void;
}

export function CJKVariantsModal({ open, onClose }: Props) {
	const novels = useNovelStore((s) => s.novels);
	const currentNovelId = useNovelStore((s) => s.currentNovelId);
	const setChapters = useNovelStore((s) => s.setChapters);
	const [scanning, setScanning] = useState(false);
	const [replacing, setReplacing] = useState(false);
	const [entries, setEntries] = useState<CJKVariantEntry[]>([]);

	const currentNovel = useMemo(() => novels.find(n => n.id === currentNovelId), [novels, currentNovelId]);

	const totalCount = useMemo(() => entries.reduce((sum, e) => sum + e.count, 0), [entries]);
	const blockLabels: Record<string, string> = {
		"kangxi": "康熙部首",
		"cjk-supplement": "CJK 部首补充",
	};

	const handleScan = useCallback(() => {
		if (!currentNovel) return;
		setScanning(true);
		setEntries([]);
		setTimeout(() => {
			// 从 original fullText 扫描（章节内容已在加载时被标准化，原始文本保留在 novel.fullText 中）
			const result = scanCJKVariants(currentNovel.fullText);
			setEntries(result);
			setScanning(false);
			if (result.length === 0) {
				useAppMetaStore.getState().showToast("未发现变体字", "success");
			}
		}, 50);
	}, [currentNovel]);

	const handleReplaceAll = useCallback(() => {
		if (!currentNovel || entries.length === 0) return;
		setReplacing(true);
		setTimeout(() => {
			try {
				const normalizedText = normalizeCJKVariants(currentNovel.fullText);
				const newChapters = splitChapters(normalizedText);
				setChapters(newChapters);
				// 同步更新 novels 中的 fullText，确保下次扫描基于替换后的文本
				useNovelStore.setState((state) => {
					const novels = state.novels.map(n => {
						if (n.id !== currentNovel.id) return n;
						return { ...n, fullText: normalizedText };
					});
					return { novels };
				});
				setEntries([]);
				logger.info('[CJKVariantsModal]', `全文变体字替换完成，共替换 ${totalCount} 处`);
				useAppMetaStore.getState().showToast(`已替换 ${totalCount} 处变体字`, "success");
			} catch (err) {
				logger.errorGeneric('[CJKVariantsModal]', '替换失败:', err);
				useAppMetaStore.getState().showToast("替换失败", "error");
			} finally {
				setReplacing(false);
				onClose();
			}
		}, 50);
	}, [entries, currentNovel, setChapters, totalCount, onClose]);

	if (!open) return null;

	return (
		<div className="modal-overlay" onClick={onClose}>
			<div className="cjk-variants-modal" onClick={(e) => e.stopPropagation()}>
				<div className="config-header">
					<div className="config-title">
						<span className="title-icon">
							<Icons.search size={16} />
						</span>
						<span>康熙变体字检查</span>
					</div>
					<button className="close-btn" onClick={onClose}>
						<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
							<path d="M3 3L13 13M13 3L3 13" />
						</svg>
					</button>
				</div>

				<div className="cjk-variants-body">
					{entries.length === 0 && !scanning && (
						<div className="cjk-variants-empty">
							<Icons.search size={48} className="empty-icon" />
							<p>点击"开始扫描"检查整本小说中的康熙变体字</p>
							{!currentNovel && <p className="text-muted">请先导入小说</p>}
							<button
								className="btn btn-primary"
								onClick={handleScan}
								disabled={!currentNovel}
							>
								<Icons.search size={16} />
								开始扫描
							</button>
						</div>
					)}

					{scanning && (
						<div className="cjk-variants-scanning">
							<Icons.loader2 size={32} className="spin" />
							<p>正在扫描...</p>
						</div>
					)}

					{entries.length > 0 && !scanning && (
						<>
							<div className="cjk-variants-summary">
								共发现 <strong>{entries.length}</strong> 种变体字，
								总计 <strong>{totalCount}</strong> 处
							</div>
							<div className="cjk-variants-table">
								<div className="cjk-variants-table-header">
									<span className="col-variant">变体字</span>
									<span className="col-codepoint">码点</span>
									<span className="col-standard">标准字</span>
									<span className="col-count">次数</span>
									<span className="col-block">区块</span>
								</div>
								{entries.map((entry, idx) => (
									<div key={idx} className="cjk-variants-table-row">
										<span className="col-variant variant-char">{entry.variant}</span>
										<span className="col-codepoint code">{entry.codePoint}</span>
										<span className="col-standard standard-char">{entry.standard}</span>
										<span className="col-count count-num">{entry.count}</span>
										<span className="col-block block-tag">{blockLabels[entry.block] || entry.block}</span>
									</div>
								))}
							</div>
						</>
					)}
				</div>

				{entries.length > 0 && !scanning && (
					<div className="config-footer">
						<button className="btn" onClick={handleScan} disabled={scanning}>
							<Icons.refreshCw size={16} />
							重新扫描
						</button>
						<button
							className="btn btn-primary"
							onClick={handleReplaceAll}
							disabled={replacing}
						>
							{replacing ? (
								<><Icons.loader2 size={16} className="spin" /> 替换中...</>
							) : (
								<><Icons.checkCircle size={16} /> 一键替换全部 ({totalCount} 处)</>
							)}
						</button>
					</div>
				)}
			</div>
		</div>
	);
}
