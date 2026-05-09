import { useState, useRef } from "react";
import { useAppStore } from "../stores/appStore";
import { useProofreadStore } from "../stores/proofreadStore";
import { Icons } from "./Icons";

interface IgnoredWordsManagerProps {
	onClose: () => void;
}

export function IgnoredWordsManager({ onClose }: IgnoredWordsManagerProps) {
	const currentNovelId = useAppStore((s) => s.currentNovelId);
	const novels = useAppStore((s) => s.novels);
	const addIgnoredWord = useProofreadStore((s) => s.addIgnoredWord);
	const removeIgnoredWord = useProofreadStore((s) => s.removeIgnoredWord);
	const ignoredWordsMap = useProofreadStore((s) => s.ignoredWords);

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

	return (
		<div className="ignored-words-modal">
			<div className="modal-overlay" onClick={onClose} />
			<div className="modal-content">
				<div className="modal-header">
					<h3>
						<Icons.settings size={18} />
						忽略单词管理
					</h3>
					<button className="modal-close" onClick={onClose}>
						<Icons.close size={20} />
					</button>
				</div>

				<div className="modal-body">
					<p className="modal-description">
						管理小说《{novel?.name ?? "未知"}》的忽略单词列表。AI 校对时将跳过这些词。
					</p>

					<div className="add-word-form">
						<input
							ref={inputRef}
							type="text"
							value={newWord}
							onChange={(e) => setNewWord(e.target.value)}
							onKeyDown={handleKeyDown}
							placeholder="输入要忽略的单词..."
							className="word-input"
						/>
						<button
							onClick={handleAddWord}
							disabled={!newWord.trim()}
							className="btn-add-word"
						>
							<Icons.plus size={16} />
							添加
						</button>
					</div>

					{ignoredWords.length > 0 ? (
						<div className="ignored-words-list">
							<div className="list-header">
								<span>已忽略的单词 ({ignoredWords.length})</span>
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
											<Icons.close size={14} />
										</button>
									</div>
								))}
							</div>
						</div>
					) : (
						<div className="empty-state">
							<Icons.search size={32} />
							<p>暂无忽略的单词</p>
							<p className="hint">添加一些单词，让 AI 在校对整本小说时跳过它们</p>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
