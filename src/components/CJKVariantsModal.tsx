// ============================================================
// CJK 变体字 / 繁体字扫描与替换弹窗
// ============================================================
import { useState, useCallback, useMemo } from "react";
import { useNovelStore } from "../stores/novelStore";
import { useAppMetaStore } from "../stores/appMetaStore";
import { Icons } from "./Icons";
import { Modal } from "./Modal";
import { scanCJKVariants, normalizeCJKVariants, type CJKVariantEntry } from "../utils/normalizeCJK";
import { scanTraditionalChars, convertTraditionalToSimplified, type TraditionalEntry } from "../utils/traditionalToSimplified";
import { splitChapters } from "../utils/chapterSplit";
import { logger } from "../utils/logger";

interface Props {
	open: boolean;
	onClose: () => void;
}

type TabKey = "variant" | "traditional";

export function CJKVariantsModal({ open, onClose }: Props) {
	const novels = useNovelStore((s) => s.novels);
	const currentNovelId = useNovelStore((s) => s.currentNovelId);
	const setChapters = useNovelStore((s) => s.setChapters);
	const [tab, setTab] = useState<TabKey>("variant");
	const [scanning, setScanning] = useState(false);
	const [replacing, setReplacing] = useState(false);
	const [variantEntries, setVariantEntries] = useState<CJKVariantEntry[]>([]);
	const [tradEntries, setTradEntries] = useState<TraditionalEntry[]>([]);

	const currentNovel = useMemo(() => novels.find(n => n.id === currentNovelId), [novels, currentNovelId]);

	const isVariantTab = tab === "variant";
	const entries = isVariantTab ? variantEntries : tradEntries;
	const totalCount = useMemo(() => entries.reduce((sum, e) => sum + e.count, 0), [entries]);
	const blockLabels: Record<string, string> = {
		"kangxi": "康熙部首",
		"cjk-supplement": "CJK 部首补充",
		"width": "半角字符",
	};

	/** 切换 Tab 时重置扫描状态与结果 */
	const switchTab = useCallback((next: TabKey) => {
		if (next === tab) return;
		setTab(next);
		setScanning(false);
		setReplacing(false);
	}, [tab]);

	const handleScan = useCallback(() => {
		if (!currentNovel) return;
		setScanning(true);
		if (isVariantTab) setVariantEntries([]); else setTradEntries([]);
		setTimeout(() => {
			// 从 original fullText 扫描（章节内容已在加载时被标准化，原始文本保留在 novel.fullText 中）
			if (isVariantTab) {
				const result = scanCJKVariants(currentNovel.fullText);
				setVariantEntries(result);
				setScanning(false);
				if (result.length === 0) {
					useAppMetaStore.getState().showToast("未发现变体字", "success");
				}
			} else {
				const result = scanTraditionalChars(currentNovel.fullText);
				setTradEntries(result);
				setScanning(false);
				if (result.length === 0) {
					useAppMetaStore.getState().showToast("未发现繁体字", "success");
				}
			}
		}, 50);
	}, [currentNovel, isVariantTab]);

	/** 通用替换处理：应用文本转换函数并更新 store */
	const handleApplyTransform = useCallback((transform: (text: string) => string, tag: string, doneMsg: string) => {
		if (!currentNovel) return;
		setReplacing(true);
		setTimeout(() => {
			try {
				const transformedText = transform(currentNovel.fullText);
				const newChapters = splitChapters(transformedText);
				setChapters(newChapters);
				// 同步更新 novels 中的 fullText，确保下次扫描基于替换后的文本
				useNovelStore.setState((state) => {
					const novels = state.novels.map(n => {
						if (n.id !== currentNovel.id) return n;
						return { ...n, fullText: transformedText };
					});
					return { novels };
				});
				if (isVariantTab) setVariantEntries([]); else setTradEntries([]);
				logger.info(tag, `全文替换完成，共 ${totalCount} 处`);
				useAppMetaStore.getState().showToast(doneMsg, "success");
			} catch (err) {
				logger.errorGeneric(tag, '替换失败:', err);
				useAppMetaStore.getState().showToast("替换失败", "error");
			} finally {
				setReplacing(false);
				onClose();
			}
		}, 50);
	}, [currentNovel, setChapters, totalCount, isVariantTab, onClose]);

	const handleReplaceVariants = useCallback(() => {
		handleApplyTransform(normalizeCJKVariants, '[CJKVariantsModal]', `已替换 ${totalCount} 处变体字`);
	}, [handleApplyTransform, totalCount]);

	const handleConvertTraditional = useCallback(() => {
		handleApplyTransform(convertTraditionalToSimplified, '[TraditionalConvert]', `已转换 ${totalCount} 处繁体字`);
	}, [handleApplyTransform, totalCount]);

	if (!open) return null;

	return (
		<Modal
			open={open}
			onClose={onClose}
			title="变体字 & 繁体字检查"
			icon={<Icons.search size={16} />}
			className="cjk-variants-modal"
		>
			<div className="cjk-variants-tabs">
				<button
					className={`cjk-variants-tab ${isVariantTab ? "active" : ""}`}
					onClick={() => switchTab("variant")}
				>
					<Icons.sparkle size={14} />
					变体字检查
				</button>
				<button
					className={`cjk-variants-tab ${isVariantTab ? "" : "active"}`}
					onClick={() => switchTab("traditional")}
				>
					<Icons.typo size={14} />
					繁体转简体
				</button>
			</div>
			<div className="cjk-variants-body">
					{entries.length === 0 && !scanning && (
						<div className="cjk-variants-empty">
							<Icons.search size={48} className="empty-icon" />
							{isVariantTab ? (
								<p>点击"开始扫描"检查整本小说中的康熙变体字及半角字母/数字/符号</p>
							) : (
								<p>点击"开始扫描"检查整本小说中的繁体字，可一键转换为简体</p>
							)}
							{!currentNovel && <p className="text-muted">请先导入小说</p>}
							<button
								className="btn"
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
								{isVariantTab ? (
									<>共发现 <strong>{entries.length}</strong> 种变体字，
									总计 <strong>{totalCount}</strong> 处</>
								) : (
									<>共发现 <strong>{entries.length}</strong> 个繁体字，
									总计 <strong>{totalCount}</strong> 处</>
								)}
							</div>
							<div className="cjk-variants-table">
								<div className="cjk-variants-table-header">
									<span className="col-variant">{isVariantTab ? "变体字" : "繁体字"}</span>
									<span className="col-codepoint">码点</span>
									<span className="col-standard">{isVariantTab ? "标准字" : "简体字"}</span>
									<span className="col-count">次数</span>
									{isVariantTab && <span className="col-block">区块</span>}
								</div>
								{entries.map((entry, idx) => (
									<div key={idx} className="cjk-variants-table-row">
										<span className="col-variant variant-char">{entry.variant}</span>
										<span className="col-codepoint code">{entry.codePoint}</span>
										<span className="col-standard standard-char">{entry.standard}</span>
										<span className="col-count count-num">{entry.count}</span>
										{isVariantTab && (
											<span className="col-block block-tag">
												{blockLabels[(entry as CJKVariantEntry).block] || (entry as CJKVariantEntry).block}
											</span>
										)}
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
							className="btn"
							onClick={isVariantTab ? handleReplaceVariants : handleConvertTraditional}
							disabled={replacing}
						>
							{replacing ? (
								<><Icons.loader2 size={16} className="spin" /> 处理中...</>
							) : isVariantTab ? (
								<><Icons.checkCircle size={16} /> 一键替换全部 ({totalCount} 处)</>
							) : (
								<><Icons.checkCircle size={16} /> 一键转为简体 ({totalCount} 处)</>
							)}
						</button>
					</div>
				)}
		</Modal>
	);
}
