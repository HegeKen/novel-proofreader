// ============================================================
// 词典管理弹窗：忽略词 + 替换词，支持导入导出与全文应用替换
// ============================================================
import { useState, useRef } from "react";
import { useNovelStore } from "../stores/novelStore";
import { useProofreadMetaStore } from "../stores/proofreadMetaStore";
import { useUIStore } from "../stores/uiStore";
import { Icons } from "./Icons";
import { Modal } from "./Modal";
import { Select } from "./Select";
import { EmptyState } from "./EmptyState";
import { ConfirmModal } from "./config/ConfirmModal";
import { logger } from "../utils/logger";
import type { DictionaryWord } from "../types";

interface IgnoredWordsManagerProps {
	onClose: () => void;
}

export function IgnoredWordsManager({ onClose }: IgnoredWordsManagerProps) {
	const currentNovelId = useNovelStore((s) => s.currentNovelId);
	const novels = useNovelStore((s) => s.novels);
	const replaceAllInChapters = useNovelStore((s) => s.replaceAllInChapters);
	const addDictionaryWord = useProofreadMetaStore((s) => s.addDictionaryWord);
	const removeDictionaryWord = useProofreadMetaStore((s) => s.removeDictionaryWord);
	const clearDictionary = useProofreadMetaStore((s) => s.clearDictionary);
	const setDictionary = useProofreadMetaStore((s) => s.setDictionary);
	const dictionaryMap = useProofreadMetaStore((s) => s.dictionary);

	const [newWord, setNewWord] = useState("");
	const [wordType, setWordType] = useState<DictionaryWord["type"]>("ignore");
	const [replacement, setReplacement] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);
	const importInputRef = useRef<HTMLInputElement>(null);
	const [confirmModal, setConfirmModal] = useState<{
		show: boolean;
		title: string;
		message: string;
		onConfirm: () => void;
	}>({ show: false, title: "", message: "", onConfirm: () => {} });

	if (!currentNovelId) return null;

	const novel = novels.find((n) => n.id === currentNovelId);
	const dictionary = dictionaryMap[currentNovelId] ?? [];
	const replaceWords = dictionary.filter((w) => w.type === "replace" && w.replacement && w.replacement !== w.word);
	const showToast = (type: "success" | "error" | "info" | "warning", message: string) =>
		useUIStore.getState().showToast(message, type);

	const handleAddWord = () => {
		const word = newWord.trim();
		if (!word) return;
		const entry: DictionaryWord = {
			word,
			type: wordType,
			...(wordType === "replace" ? { replacement: replacement.trim() } : {}),
		};
		if (wordType === "replace" && !entry.replacement) {
			showToast("error", "替换词需要填写替换为的内容");
			return;
		}
		if (wordType === "replace" && entry.replacement === word) {
			showToast("error", "替换内容不能与原词相同");
			return;
		}
		addDictionaryWord(currentNovelId, entry);
		setNewWord("");
		setReplacement("");
		inputRef.current?.focus();
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter") {
			handleAddWord();
		}
	};

	const handleClearAll = () => {
		setConfirmModal({
			show: true,
			title: "清空词典",
			message: "确定要清空当前小说的所有词典词条吗？",
			onConfirm: () => {
				clearDictionary(currentNovelId);
				setConfirmModal((prev) => ({ ...prev, show: false }));
			},
		});
	};

	/** 导出词典为 JSON 文件 */
	const handleExport = () => {
		if (dictionary.length === 0) {
			showToast("info", "词典为空，没有可导出的词条");
			return;
		}
		const content = JSON.stringify({ name: novel?.name ?? "dictionary", words: dictionary }, null, 2);
		const blob = new Blob([content], { type: "application/json;charset=utf-8" });
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = `${novel?.name ?? "dictionary"}-词典.json`;
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		URL.revokeObjectURL(url);
		showToast("success", "词典已导出");
	};

	/** 导入词典 JSON（合并到当前词典，同名词条覆盖） */
	const handleImportFile = async (file: File) => {
		try {
			const raw = JSON.parse(await file.text());
			// 支持两种格式：{ words: [...] } 或直接的词条数组 / 字符串数组
			const list: unknown = Array.isArray(raw) ? raw : raw.words;
			if (!Array.isArray(list)) {
				showToast("error", "词典文件格式不正确");
				return;
			}
			const entries: DictionaryWord[] = [];
			for (const item of list) {
				if (typeof item === "string" && item.trim()) {
					entries.push({ word: item.trim(), type: "ignore" });
				} else if (item && typeof item === "object") {
					const w = item as DictionaryWord;
					if (typeof w.word === "string" && w.word.trim() && (w.type === "ignore" || w.type === "replace")) {
						entries.push({
							word: w.word.trim(),
							type: w.type,
							...(w.type === "replace" && typeof w.replacement === "string" ? { replacement: w.replacement } : {}),
						});
					}
				}
			}
			if (entries.length === 0) {
				showToast("error", "未找到有效的词典词条");
				return;
			}
			// 合并：同名词条以导入内容为准
			const merged = [...dictionary];
			for (const entry of entries) {
				const idx = merged.findIndex((w) => w.word === entry.word);
				if (idx >= 0) merged[idx] = entry;
				else merged.push(entry);
			}
			setDictionary(currentNovelId, merged);
			showToast("success", `已导入 ${entries.length} 个词条`);
		} catch (err) {
			logger.errorGeneric('[IgnoredWordsManager]', '词典导入失败:', err);
			showToast("error", "词典文件解析失败");
		}
	};

	/** 将替换词应用到当前小说全文 */
	const handleApplyReplacements = () => {
		if (replaceWords.length === 0) return;
		setConfirmModal({
			show: true,
			title: "应用替换词",
			message: `确定将 ${replaceWords.length} 个替换词应用到小说全文吗？此操作会直接修改正文。`,
			onConfirm: () => {
				const count = replaceAllInChapters(
					replaceWords.map((w) => ({ from: w.word, to: w.replacement as string })),
				);
				setConfirmModal((prev) => ({ ...prev, show: false }));
				if (count > 0) {
					showToast("success", `已替换 ${count} 处文本`);
				} else {
					showToast("info", "全文中未找到需要替换的文本");
				}
			},
		});
	};

	return (
		<Modal
			open
			onClose={onClose}
			title="词典管理"
			icon={<Icons.settings size={16} />}
		>
			<div className="config-body">
					<div className="config-section">
						<div className="section-label">说明</div>
						<p className="modal-description">
							管理小说《{novel?.name ?? "未知"}》的词典。忽略词在校对时跳过；替换词可一键应用到全文。
						</p>
					</div>

					<div className="config-section">
						<div className="section-label">添加词条</div>
						<div className="word-add-row">
							<Select
								value={wordType}
								onChange={(v) => setWordType(v as DictionaryWord["type"])}
								options={[
									{ value: "ignore", label: "忽略词" },
									{ value: "replace", label: "替换词" },
								]}
								className="word-type-select"
							/>
							<input
								ref={inputRef}
								type="text"
								value={newWord}
								onChange={(e) => setNewWord(e.target.value)}
								onKeyDown={handleKeyDown}
								placeholder={wordType === "replace" ? "输入要替换的文本..." : "输入要忽略的单词..."}
								className="config-input word-input-flex"
							/>
							{wordType === "replace" && (
								<input
									type="text"
									value={replacement}
									onChange={(e) => setReplacement(e.target.value)}
									onKeyDown={handleKeyDown}
									placeholder="替换为..."
									className="config-input word-input-flex"
								/>
							)}
							<button
								onClick={handleAddWord}
								disabled={!newWord.trim() || (wordType === "replace" && !replacement.trim())}
								className="btn"
							>
								<Icons.plus size={14} />添加
							</button>
						</div>
					</div>

					{dictionary.length > 0 ? (
						<div className="config-section">
							<div className="section-header">
								<div className="section-label">词条列表 ({dictionary.length})</div>
							</div>
							<div className="words-grid">
							{dictionary.map((entry) => (
								<div key={entry.word} className="word-tag">
									<span
										className={`word-type-badge ${entry.type === "replace" ? "word-type-badge--replace" : ""}`}
										title={entry.type === "ignore" ? "校对时忽略" : "可替换到全文"}
									>
										{entry.type === "replace" ? "替换" : "忽略"}
									</span>
										<span className="word-text">
											{entry.word}
											{entry.type === "replace" && entry.replacement ? ` → ${entry.replacement}` : ""}
										</span>
										<button
											className="word-remove"
											onClick={() => removeDictionaryWord(currentNovelId, entry.word)}
											title="移除"
										>
											<Icons.x size={14} />
										</button>
									</div>
								))}
							</div>
						</div>
					) : (
						<div className="config-section">
							<EmptyState
								icon={<Icons.search size={48} className="empty-icon" />}
								message="词典为空"
								hint="添加忽略词让 AI 校对跳过它们，或添加替换词一键修正全文"
							/>
						</div>
					)}

					<input
						ref={importInputRef}
						type="file"
						accept=".json"
						className="hidden-file-input"
						onChange={(e) => {
							const file = e.target.files?.[0];
							if (file) handleImportFile(file);
							e.target.value = "";
						}}
					/>
				</div>

				<div className="character-actions-fab-wrapper">
					<button
						className="btn"
						onClick={handleApplyReplacements}
						disabled={replaceWords.length === 0}
						title="将所有替换词应用到小说全文"
					>
						<Icons.checkAll size={18} />
						<span>应用替换{replaceWords.length > 0 ? ` (${replaceWords.length})` : ""}</span>
					</button>
					<button className="btn" onClick={() => importInputRef.current?.click()} title="导入词典 JSON 文件">
						<Icons.import size={18} />
						<span>导入</span>
					</button>
					<button className="btn" onClick={handleExport} disabled={dictionary.length === 0} title="导出词典为 JSON 文件">
						<Icons.download size={18} />
						<span>导出</span>
					</button>
					<button className="btn" onClick={handleClearAll} disabled={dictionary.length === 0}>
						<Icons.trash2 size={18} />
						<span>清空</span>
					</button>
					<button className="btn" onClick={onClose}>
						<Icons.x size={18} />
						<span>关闭</span>
					</button>
				</div>

				<ConfirmModal
					show={confirmModal.show}
					title={confirmModal.title}
					message={confirmModal.message}
					danger
					confirmText="确定"
					cancelText="取消"
					onConfirm={confirmModal.onConfirm}
					onCancel={() => setConfirmModal((prev) => ({ ...prev, show: false }))}
				/>
		</Modal>
	);
}
