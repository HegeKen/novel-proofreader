// ============================================================
// CJK 变体字 / 繁体字扫描与替换弹窗
// ============================================================
import { useState, useCallback, useMemo } from "react";
import { useNovelStore } from "../stores/novelStore";
import { useUIStore } from "../stores/uiStore";
import { Icons } from "./Icons";
import { Modal } from "./Modal";
import { scanCJKVariants, type CJKVariantEntry } from "../utils/normalizeCJK";
import { scanTraditionalChars, type TraditionalEntry } from "../utils/traditionalToSimplified";
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
	/** 勾选要替换的异常字（key 为变体/繁体字符） */
	const [selected, setSelected] = useState<Set<string>>(new Set());

	const currentNovel = useMemo(() => novels.find(n => n.id === currentNovelId), [novels, currentNovelId]);

	const isVariantTab = tab === "variant";
	const entries = isVariantTab ? variantEntries : tradEntries;
	const totalCount = useMemo(() => entries.reduce((sum, e) => sum + e.count, 0), [entries]);
	/** 勾选项的总出现次数 */
	const selectedTotal = useMemo(
		() => entries.filter((e) => selected.has(e.variant)).reduce((sum, e) => sum + e.count, 0),
		[entries, selected],
	);
	const allSelected = entries.length > 0 && selected.size === entries.length;
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
		setSelected(new Set());
	}, [tab]);

	/** 勾选 / 取消勾选单个异常字 */
	const toggleEntry = useCallback((variant: string) => {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(variant)) next.delete(variant); else next.add(variant);
			return next;
		});
	}, []);

	/** 全选 / 全不选 */
	const toggleAll = useCallback(() => {
		setSelected((prev) => (prev.size === entries.length ? new Set() : new Set(entries.map((e) => e.variant))));
	}, [entries]);

	const handleScan = useCallback(() => {
		if (!currentNovel) return;
		setScanning(true);
		setSelected(new Set());
		if (isVariantTab) setVariantEntries([]); else setTradEntries([]);
		setTimeout(() => {
			// 从 original fullText 扫描（章节内容已在加载时被标准化，原始文本保留在 novel.fullText 中）
			if (isVariantTab) {
				const result = scanCJKVariants(currentNovel.fullText);
				setVariantEntries(result);
				setSelected(new Set(result.map((e) => e.variant)));
				setScanning(false);
				if (result.length === 0) {
					useUIStore.getState().showToast("未发现变体字", "success");
				}
			} else {
				const result = scanTraditionalChars(currentNovel.fullText);
				setTradEntries(result);
				setSelected(new Set(result.map((e) => e.variant)));
				setScanning(false);
				if (result.length === 0) {
					useUIStore.getState().showToast("未发现繁体字", "success");
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
				useUIStore.getState().showToast(doneMsg, "success");
			} catch (err) {
				logger.errorGeneric(tag, '替换失败:', err);
				useUIStore.getState().showToast("替换失败", "error");
			} finally {
				setReplacing(false);
				onClose();
			}
		}, 50);
	}, [currentNovel, setChapters, totalCount, isVariantTab, onClose]);

	const handleReplaceSelected = useCallback(() => {
		// 仅替换勾选的异常字：构建「异常字 → 目标字」映射，逐字替换
		const replaceMap = new Map<string, string>();
		for (const e of entries) {
			if (selected.has(e.variant)) replaceMap.set(e.variant, e.standard);
		}
		const transform = (text: string) =>
			Array.from(text, (ch) => replaceMap.get(ch) ?? ch).join("");
		const label = isVariantTab ? "变体字" : "繁体字";
		handleApplyTransform(transform, isVariantTab ? '[CJKVariantsModal]' : '[TraditionalConvert]', `已替换 ${selectedTotal} 处${label}`);
	}, [entries, selected, isVariantTab, selectedTotal, handleApplyTransform]);

	if (!open) return null;

	return (
		<Modal
			open={open}
			onClose={onClose}
			title="变体字 & 繁体字检查"
			icon={<Icons.search size={16} />}
			className="cjk-variants-modal"
			bodyClassName="config-body-flush"
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
							<Icons.search size={24} />
							{isVariantTab ? (
								<p>点击下方"开始扫描"检查整本小说中的康熙变体字及半角字母/数字/符号</p>
							) : (
								<p>点击下方"开始扫描"检查整本小说中的繁体字，可勾选后转换为简体</p>
							)}
							{!currentNovel && <p className="text-muted">请先导入小说</p>}
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
									<label className="col-check">
										<input
											type="checkbox"
											checked={allSelected}
											onChange={toggleAll}
											aria-label="全选"
										/>
									</label>
									<span className="col-variant">{isVariantTab ? "变体字" : "繁体字"}</span>
									<span className="col-codepoint">码点</span>
									<span className="col-standard">{isVariantTab ? "标准字" : "简体字"}</span>
									<span className="col-count">次数</span>
									{isVariantTab && <span className="col-block">区块</span>}
								</div>
								{entries.map((entry, idx) => (
									<div key={idx} className="cjk-variants-table-row">
										<label className="col-check">
											<input
												type="checkbox"
												checked={selected.has(entry.variant)}
												onChange={() => toggleEntry(entry.variant)}
											/>
										</label>
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

				<div className="config-footer">
						<button className="btn" onClick={handleScan} disabled={!currentNovel || scanning || replacing}>
							{scanning ? (
								<><Icons.loader2 size={16} className="spin" /> 扫描中...</>
							) : entries.length > 0 ? (
								<><Icons.refreshCw size={16} /> 重新扫描</>
							) : (
								<><Icons.search size={16} /> 开始扫描</>
							)}
						</button>
						{entries.length > 0 && !scanning && (
							<button
								className="btn"
								onClick={handleReplaceSelected}
								disabled={replacing || selected.size === 0}
							>
								{replacing ? (
									<><Icons.loader2 size={16} className="spin" /> 处理中...</>
								) : (
									<><Icons.checkCircle size={16} /> {isVariantTab ? `替换选中 (${selectedTotal} 处)` : `转为简体 (${selectedTotal} 处)`}</>
								)}
							</button>
						)}
					</div>
		</Modal>
	);
}
