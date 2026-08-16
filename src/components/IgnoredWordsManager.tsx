import { useState, useRef } from "react";
import { useNovelStore } from "../stores/novelStore";
import { useProofreadMetaStore } from "../stores/proofreadMetaStore";
import { Icons } from "./Icons";
import { Modal } from "./Modal";
import { EmptyState } from "./EmptyState";
import { ConfirmModal } from "./config/ConfirmModal";

interface IgnoredWordsManagerProps {
	onClose: () => void;
}

export function IgnoredWordsManager({ onClose }: IgnoredWordsManagerProps) {
	const currentNovelId = useNovelStore((s) => s.currentNovelId);
	const novels = useNovelStore((s) => s.novels);
	const addIgnoredWord = useProofreadMetaStore((s) => s.addIgnoredWord);
	const removeIgnoredWord = useProofreadMetaStore((s) => s.removeIgnoredWord);
	const clearIgnoredWords = useProofreadMetaStore((s) => s.clearIgnoredWords);
	const ignoredWordsMap = useProofreadMetaStore((s) => s.ignoredWords);

	const [newWord, setNewWord] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);
	const [confirmModal, setConfirmModal] = useState<{
		show: boolean;
		message: string;
		onConfirm: () => void;
	}>({ show: false, message: "", onConfirm: () => {} });

	if (!currentNovelId) return null;

	const novel = novels.find((n) => n.id === currentNovelId);
	const ignoredWords = ignoredWordsMap[currentNovelId] ?? [];

	const handleAddWord = () => {
		const word = newWord.trim();
		if (word && !ignoredWords.includes(word)) {
			addIgnoredWord(currentNovelId, word);
			setNewWord("");
			inputRef.current?.focus();
		}
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter") {
			handleAddWord();
		}
	};

	const handleClearAll = () => {
		setConfirmModal({
			show: true,
			message: "确定要清空所有忽略单词吗？",
			onConfirm: () => {
				clearIgnoredWords(currentNovelId);
				setConfirmModal(prev => ({ ...prev, show: false }));
			},
		});
	};

	return (
		<Modal
			open
			onClose={onClose}
			title="忽略单词管理"
			icon={<Icons.settings size={16} />}
		>
			<div className="config-body">
					<div className="config-section">
						<div className="section-label">说明</div>
						<p className="modal-description">
							管理小说《{novel?.name ?? "未知"}》的忽略单词列表。AI 校对时将跳过这些词。
						</p>
					</div>

					<div className="config-section">
						<div className="section-label">添加忽略单词</div>
						<div style={{ display: "flex", gap: "8px" }}>
							<input
								ref={inputRef}
								type="text"
								value={newWord}
								onChange={(e) => setNewWord(e.target.value)}
								onKeyDown={handleKeyDown}
								placeholder="输入要忽略的单词..."
								className="config-input"
								style={{ flex: 1 }}
							/>
							<button
								onClick={handleAddWord}
								disabled={!newWord.trim()}
								className="btn"
							>
								<Icons.plus size={14} />添加
							</button>
						</div>
					</div>

					{ignoredWords.length > 0 ? (
						<div className="config-section">
							<div className="section-header">
								<div className="section-label">已忽略的单词 ({ignoredWords.length})</div>
							</div>
							<div className="words-grid">
								{ignoredWords.map((word) => (
									<div key={word} className="word-tag">
										<span className="word-text">{word}</span>
										<button
											className="word-remove"
											onClick={() => removeIgnoredWord(currentNovelId, word)}
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
								message="暂无忽略的单词"
								hint="添加一些单词，让 AI 在校对整本小说时跳过它们"
							/>
						</div>
					)}
				</div>

				<div className="character-actions-fab-wrapper">
					<button className="btn" onClick={handleClearAll} disabled={ignoredWords.length === 0}>
						<Icons.trash2 size={18} />
						<span>清空全部</span>
					</button>
					<button className="btn" onClick={onClose}>
						<Icons.x size={18} />
						<span>关闭</span>
					</button>
				</div>

				<ConfirmModal
					show={confirmModal.show}
					title="清空忽略单词"
					message={confirmModal.message}
					danger
					confirmText="确定"
					cancelText="取消"
					onConfirm={confirmModal.onConfirm}
					onCancel={() => setConfirmModal(prev => ({ ...prev, show: false }))}
				/>
		</Modal>
	);
}
