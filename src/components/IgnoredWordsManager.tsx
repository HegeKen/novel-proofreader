import { useState, useRef } from "react";
import { useNovelStore } from "../stores/novelStore";
import { useProofreadMetaStore } from "../stores/proofreadMetaStore";
import { Icons } from "./Icons";

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
		if (window.confirm("确定要清空所有忽略单词吗？")) {
			clearIgnoredWords(currentNovelId);
		}
	};

	return (
		<div className="modal-overlay" onClick={onClose}>
			<div className="config-modal" onClick={(e) => e.stopPropagation()}>
				<div className="config-header">
					<div className="config-title">
						<span className="title-icon"><Icons.settings size={16} /></span>
						<span>忽略单词管理</span>
					</div>
					<button className="close-btn" onClick={onClose}>
						<svg
							width="16"
							height="16"
							viewBox="0 0 16 16"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
						>
							<path d="M3 3L13 13M13 3L3 13" />
						</svg>
					</button>
				</div>

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
							<div className="empty-state">
								<Icons.search size={48} className="empty-icon" />
								<p>暂无忽略的单词</p>
								<p className="hint">添加一些单词，让 AI 在校对整本小说时跳过它们</p>
							</div>
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
			</div>
		</div>
	);
}
