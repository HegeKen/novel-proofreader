// ============================================================
// 文本对比弹窗 - 精确到单字符高亮差异
// ============================================================
import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useNovelStore } from "../stores/novelStore";
import { useAppMetaStore } from "../stores/appMetaStore";
import { Icons } from "./Icons";
import { diffLines, diffLinesFine, getDiffStats, type DiffLine } from "../utils/textDiff";
import { decodeTextBuffer } from "../utils/decodeText";
import { logger } from "../utils/logger";

interface Props {
	open: boolean;
	onClose: () => void;
}


export function DiffModal({ open, onClose }: Props) {
	const novels = useNovelStore((s) => s.novels);
	const currentNovelId = useNovelStore((s) => s.currentNovelId);

	const [text1, setText1] = useState("");
	const [text2, setText2] = useState("");
	const [name1, setName1] = useState("文本1");
	const [name2, setName2] = useState("文本2");
	const [diffLines1, setDiffLines1] = useState<DiffLine[]>([]);
	const [diffLines2, setDiffLines2] = useState<DiffLine[]>([]);
	const [comparing, setComparing] = useState(false);
	const [showDiffOnly, setShowDiffOnly] = useState(false);
	const [fineMode, setFineMode] = useState(false);
	const [source1, setSource1] = useState<"file" | "novel" | "">("");
	const [source2, setSource2] = useState<"file" | "novel" | "">("");
	const [novel1Id, setNovel1Id] = useState<string>("");
	const [novel2Id, setNovel2Id] = useState<string>("");
	const [isPasting1, setIsPasting1] = useState(false);
	const [isPasting2, setIsPasting2] = useState(false);
	const [inputCollapsed, setInputCollapsed] = useState(false);

	const fileInput1Ref = useRef<HTMLInputElement>(null);
	const fileInput2Ref = useRef<HTMLInputElement>(null);
	const pasteArea1Ref = useRef<HTMLDivElement>(null);
	const pasteArea2Ref = useRef<HTMLDivElement>(null);
	const diffLeftRef = useRef<HTMLDivElement>(null);
	const diffRightRef = useRef<HTMLDivElement>(null);
	const isSyncingScroll = useRef(false);

	// 初始化默认选中当前小说（弹窗首次打开时同步设置初始选择，是合法的初始化场景）
	useEffect(() => {
		/* eslint-disable react-hooks/set-state-in-effect */
		if (open && currentNovelId && !novel1Id && novels.length > 0) {
			setNovel1Id(currentNovelId);
			setSource1("novel");
			const n = novels.find((nv) => nv.id === currentNovelId);
			if (n) {
				setText1(n.fullText || "");
				setName1(n.name);
			}
		}
		/* eslint-enable react-hooks/set-state-in-effect */
	}, [open, currentNovelId, novels, novel1Id]);

	const stats = useMemo(
		() => getDiffStats([...diffLines1, ...diffLines2]),
		[diffLines1, diffLines2],
	);

	/** 按目标侧（1/2）批量更新输入状态，消除四个 handler 中的重复分支 */
	const setSide = useCallback((target: 1 | 2, patch: {
		text?: string;
		name?: string;
		source?: "file" | "novel" | "";
		novelId?: string;
		isPasting?: boolean;
	}) => {
		const setters = target === 1
			? [setText1, setName1, setSource1, setNovel1Id, setIsPasting1]
			: [setText2, setName2, setSource2, setNovel2Id, setIsPasting2];
		// 顺序：text / name / source / novelId / isPasting
		if (patch.text !== undefined) (setters[0] as (v: string) => void)(patch.text);
		if (patch.name !== undefined) (setters[1] as (v: string) => void)(patch.name);
		if (patch.source !== undefined) (setters[2] as (v: "file" | "novel" | "") => void)(patch.source);
		if (patch.novelId !== undefined) (setters[3] as (v: string) => void)(patch.novelId);
		if (patch.isPasting !== undefined) (setters[4] as (v: boolean) => void)(patch.isPasting);
	}, []);

	const handleFileLoad = useCallback(
		async (file: File, target: 1 | 2) => {
			try {
				const buffer = await file.arrayBuffer();
				const text = decodeTextBuffer(buffer);
				setSide(target, {
					text,
					name: file.name.replace(/\.txt$/i, ""),
					source: "file",
					isPasting: false,
				});
			} catch (err) {
				logger.errorGeneric("[DiffModal]", "文件加载失败:", err);
				useAppMetaStore.getState().showToast("文件加载失败", "error");
			}
		},
		[setSide],
	);

	const handlePaste = useCallback((e: React.ClipboardEvent, target: 1 | 2) => {
		e.preventDefault();
		const text = e.clipboardData.getData("text/plain");
		setSide(target, {
			text,
			name: `文本 ${target}`,
			source: "",
			novelId: "",
			isPasting: false,
		});
	}, [setSide]);

	const handleClear = useCallback((target: 1 | 2) => {
		setSide(target, {
			text: "",
			name: `文本 ${target}`,
			source: "",
			novelId: "",
			isPasting: false,
		});
	}, [setSide]);

	const handleNovelSelect = useCallback(
		(novelId: string, target: 1 | 2) => {
			const novel = novels.find((n) => n.id === novelId);
			if (!novel) return;
			setSide(target, {
				novelId,
				text: novel.fullText || "",
				name: novel.name,
				source: "novel",
			});
		},
		[novels, setSide],
	);

	/** 将 diff 结果拆分为左右两列，保持行对齐 */
	const splitDiffColumns = useCallback((lines: DiffLine[]): { left: DiffLine[]; right: DiffLine[] } => {
		const left: DiffLine[] = [];
		const right: DiffLine[] = [];
		const placeholder = (): DiffLine => ({
			lineNumberOld: null,
			lineNumberNew: null,
			parts: [],
			type: "placeholder",
		});

		for (const line of lines) {
			if (line.type === "equal") {
				left.push(line);
				right.push(line);
			} else if (line.type === "removed") {
				left.push(line);
				right.push(placeholder());
			} else if (line.type === "added") {
				left.push(placeholder());
				right.push(line);
			} else if (line.type === "modified") {
				// 左侧：只保留 removed + equal 片段
				left.push({
					...line,
					parts: line.parts.filter((p) => p.type !== "added"),
					type: "modified",
				});
				// 右侧：只保留 added + equal 片段
				right.push({
					...line,
					parts: line.parts.filter((p) => p.type !== "removed"),
					type: "modified",
				});
			}
		}
		return { left, right };
	}, []);

	const runCompare = useCallback((mode: "normal" | "fine") => {
		if (!text1 || !text2) {
			useAppMetaStore.getState().showToast("请先加载两段文本", "error");
			return;
		}
		setComparing(true);
		setFineMode(mode === "fine");
		setTimeout(() => {
			const lines = mode === "fine" ? diffLinesFine(text1, text2) : diffLines(text1, text2);
			const { left, right } = splitDiffColumns(lines);
			setDiffLines1(left);
			setDiffLines2(right);
			setComparing(false);
			// 有结果时自动折叠输入区
			setInputCollapsed(true);
		}, 50);
	}, [text1, text2, splitDiffColumns]);

	const handleSwap = useCallback(() => {
		setText1(text2);
		setText2(text1);
		setName1(name2);
		setName2(name1);
		setSource1(source2);
		setSource2(source1);
		setNovel1Id(novel2Id);
		setNovel2Id(novel1Id);
		setDiffLines1([]);
		setDiffLines2([]);
	}, [text1, text2, name1, name2, source1, source2, novel1Id, novel2Id]);

	const hasResult = diffLines1.length > 0 || diffLines2.length > 0;

	// 同步滚动处理
	const handleSyncScroll = useCallback((side: "left" | "right") => {
		if (isSyncingScroll.current) return;
		isSyncingScroll.current = true;

		const source = side === "left" ? diffLeftRef.current : diffRightRef.current;
		const target = side === "left" ? diffRightRef.current : diffLeftRef.current;
		if (source && target) {
			target.scrollTop = source.scrollTop;
		}

		requestAnimationFrame(() => {
			isSyncingScroll.current = false;
		});
	}, []);

	const { filteredLines1, filteredLines2 } = useMemo(() => {
		if (!showDiffOnly) return { filteredLines1: diffLines1, filteredLines2: diffLines2 };

		// 两侧按索引对齐，同步过滤：仅当两侧都为 equal 时跳过
		const left: DiffLine[] = [];
		const right: DiffLine[] = [];
		for (let i = 0; i < diffLines1.length; i++) {
			const l1 = diffLines1[i];
			const l2 = diffLines2[i];
			if (l1.type !== "equal" || l2.type !== "equal") {
				left.push(l1);
				right.push(l2);
			}
		}
		return { filteredLines1: left, filteredLines2: right };
	}, [diffLines1, diffLines2, showDiffOnly]);

	if (!open) return null;

	return (
		<div className="diff-overlay">
			<div className="diff-modal">
				<div className="config-header">
					<div className="config-title">
						<span className="title-icon">
							<Icons.compare size={16} />
						</span>
						<span>文本对比</span>
					</div>
					<button className="close-btn" onClick={onClose}>
						<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
							<path d="M3 3L13 13M13 3L3 13" />
						</svg>
					</button>
				</div>

				<div
					className="diff-body">
					{/* 输入区 - 有结果时折叠 */}
					{inputCollapsed ? (
						<div className="diff-input-collapsed">
							<div className="diff-collapsed-info">
								<span className="diff-collapsed-label">{name1}</span>
								{text1 && <span className="diff-collapsed-meta">{text1.length} 字</span>}
							</div>
							<div className="diff-swap-btn collapsed">
								<button onClick={handleSwap} title="交换文本">
									<Icons.chevronRight size={14} />
								</button>
							</div>
							<div className="diff-collapsed-info">
								<span className="diff-collapsed-label">{name2}</span>
								{text2 && <span className="diff-collapsed-meta">{text2.length} 字</span>}
							</div>
							<button
								className="diff-collapse-toggle"
								onClick={() => setInputCollapsed(false)}
								title="展开输入区"
							>
								<Icons.chevronDown size={16} />
							</button>
						</div>
					) : (
						<div className="diff-input-section">
						<TextInputPanel
							text={text1}
							name={name1}
							source={source1}
							novelId={novel1Id}
							novels={novels}
							isPasting={isPasting1}
							onPasteToggle={() => setIsPasting1(!isPasting1)}
							onFileLoad={(file) => handleFileLoad(file, 1)}
							onNovelSelect={(id) => handleNovelSelect(id, 1)}
							onPaste={(e) => handlePaste(e, 1)}
						onClear={() => handleClear(1)}
						fileRef={fileInput1Ref}
							pasteRef={pasteArea1Ref}
						/>

						<div className="diff-swap-btn">
							<button onClick={handleSwap} title="交换文本">
								<Icons.chevronRight size={16} />
							</button>
						</div>

						<TextInputPanel
							text={text2}
							name={name2}
							source={source2}
							novelId={novel2Id}
							novels={novels}
							isPasting={isPasting2}
							onPasteToggle={() => setIsPasting2(!isPasting2)}
							onFileLoad={(file) => handleFileLoad(file, 2)}
							onNovelSelect={(id) => handleNovelSelect(id, 2)}
							onPaste={(e) => handlePaste(e, 2)}
						onClear={() => handleClear(2)}
						fileRef={fileInput2Ref}
							pasteRef={pasteArea2Ref}
						/>
						</div>
					)}

					{/* 操作按钮 */}
					<div className="diff-actions">
						<button
							className={`btn ${fineMode ? "" : "active"}`}
							onClick={() => runCompare("normal")}
							disabled={comparing || !text1 || !text2}
						>
							{comparing ? (
								<><Icons.refreshCw size={16} className="spin" /> 对比中...</>
							) : (
								<><Icons.search size={16} /> 开始对比</>
							)}
						</button>
						<button
							className={`btn ${fineMode ? "active" : ""}`}
							onClick={() => runCompare("fine")}
							disabled={comparing || !text1 || !text2}
							title="对所有有变化的段落逐字比对，精确到单字、标点"
						>
							<Icons.zoomIn size={16} /> 精细对比
						</button>
						{hasResult && (
							<label className="diff-filter-toggle">
								<input
									type="checkbox"
									checked={showDiffOnly}
									onChange={(e) => setShowDiffOnly(e.target.checked)}
								/>
								<span>仅显示差异行</span>
							</label>
						)}
						{hasResult && (
							<div className="diff-stats">
								<span className="diff-stat-added">+{stats.added} 字</span>
								<span className="diff-stat-removed">-{stats.removed} 字</span>
								<span className="diff-stat-modified">{stats.modifiedLines} 行差异</span>
							</div>
						)}
					</div>

					{/* 结果区 */}
					{hasResult && (
						<div className="diff-result">
							<div className="diff-result-header">
								<span className="diff-result-name">{name1}</span>
								<span className="diff-result-name">{name2}</span>
							</div>
							<div className="diff-result-content">
								<div
									ref={diffLeftRef}
									className="diff-result-col diff-result-left"
									onScroll={() => handleSyncScroll("left")}
								>
									{filteredLines1.map((line, idx) => (
										<DiffLineView key={idx} line={line} side="left" />
									))}
								</div>
								<div
									ref={diffRightRef}
									className="diff-result-col diff-result-right"
									onScroll={() => handleSyncScroll("right")}
								>
									{filteredLines2.map((line, idx) => (
										<DiffLineView key={idx} line={line} side="right" />
									))}
								</div>
							</div>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

/** 渲染单行 diff */
function DiffLineView({ line, side }: { line: DiffLine; side: "left" | "right" }) {
	// 占位行：渲染为空行，保持两侧行高一致
	if (line.type === "placeholder") {
		return <div className="diff-line diff-line-placeholder" />;
	}

	const lineClass = `diff-line diff-line-${line.type}`;

	return (
		<div className={lineClass}>
			<span className="diff-line-number">
				{side === "left" ? (line.lineNumberOld ?? "") : (line.lineNumberNew ?? "")}
			</span>
			<span className="diff-line-content">
				{line.parts.map((part, idx) => (
					<span key={idx} className={`diff-char diff-char-${part.type}`}>
						{part.text === "" ? " " : part.text}
					</span>
				))}
			</span>
		</div>
	);
}

/** 文本输入面板 - 使用 line-text 段落展示 */
interface TextInputPanelProps {
	text: string;
	name: string;
	source: string;
	novelId: string;
	novels: Array<{ id: string; name: string }>;
	isPasting: boolean;
	onPasteToggle: () => void;
	onFileLoad: (file: File) => void;
	onNovelSelect: (id: string) => void;
	onPaste: (e: React.ClipboardEvent) => void;
	onClear: () => void;
	fileRef: React.RefObject<HTMLInputElement | null>;
	pasteRef: React.RefObject<HTMLDivElement | null>;
}

function TextInputPanel({
	text,
	name,
	source,
	novelId,
	novels,
	isPasting,
	onPasteToggle,
	onFileLoad,
	onNovelSelect,
	onPaste,
	onClear,
	fileRef,
	pasteRef,
}: TextInputPanelProps) {
	const lines = text.split("\n");
	const isEmpty = !text.trim();

	return (
		<div className="diff-input-panel">
			<div className="diff-input-header">
				<span className="diff-input-label">{name}</span>
				<div className="diff-input-actions">
					<button
						className={`diff-source-btn ${source === "novel" ? "active" : ""}`}
						onClick={() => fileRef.current?.click()}
						title="从文件导入"
					>
						<Icons.import size={14} />
						文件
					</button>
					<select
						className="diff-novel-select"
						value={novelId}
						onChange={(e) => onNovelSelect(e.target.value)}
					>
						<option value="">从小说库选择...</option>
						{novels.map((n) => (
							<option key={n.id} value={n.id}>
								{n.name}
							</option>
						))}
					</select>
					<button
						className={`diff-source-btn ${isPasting ? "active" : ""}`}
						onClick={onPasteToggle}
						title="粘贴文本"
					>
						<Icons.file size={14} />
						粘贴
					</button>
					{!isEmpty && (
						<button className="diff-clear-btn" onClick={onClear} title="清空">
							<Icons.trash2 size={14} />
						</button>
					)}
				</div>
			</div>

			{isPasting ? (
				<div
					ref={pasteRef}
					className="diff-text-display paste-mode"
					onPaste={onPaste}
					onKeyDown={(e) => {
						if (e.key === "Escape") onPasteToggle();
					}}
				>
					<textarea
						className="diff-paste-textarea"
						placeholder="在此粘贴文本，粘贴完成后自动退出，或按 Esc 键取消"
						autoFocus
					/>
				</div>
			) : (
				<div className={`diff-text-display ${isEmpty ? "empty" : ""}`}>
					{isEmpty ? (
						<div className="diff-text-placeholder">
							<Icons.file size={24} />
							<span>点击上方「粘贴」按钮导入文本，或使用「文件」按钮导入文件</span>
						</div>
					) : (
						<div className="diff-text-paragraphs">
							{lines.map((line, idx) => (
								<div key={idx} className="diff-text-paragraph">
									<span className="line-text">{line || "\u00A0"}</span>
								</div>
							))}
						</div>
					)}
				</div>
			)}

			<input
				ref={fileRef}
				type="file"
				accept=".txt"
				className="hidden-file-input"
				onChange={(e) => {
					const file = (e.target as HTMLInputElement).files?.[0];
					if (file) onFileLoad(file);
				}}
			/>
		</div>
	);
}
