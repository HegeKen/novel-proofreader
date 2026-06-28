import { useState, useCallback } from "react";
import { Icons } from "./Icons";
import { ConfirmModal } from "./config/ConfirmModal";
import { useWordReplacementStore, type WordReplacement } from "../stores/wordReplacementStore";

interface Props {
	open: boolean;
	onClose: () => void;
}

export function WordReplacementModal({ open, onClose }: Props) {
	const { replacements, addReplacement, removeReplacement, updateReplacement, clearAllReplacements } = useWordReplacementStore();
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editOriginal, setEditOriginal] = useState("");
	const [editReplacement, setEditReplacement] = useState("");
	const [newOriginal, setNewOriginal] = useState("");
	const [newReplacement, setNewReplacement] = useState("");
	const [confirmModal, setConfirmModal] = useState<{
		show: boolean;
		message: string;
		onConfirm: () => void;
	}>({ show: false, message: "", onConfirm: () => {} });

	const handleStartEdit = useCallback((item: WordReplacement) => {
		setEditingId(item.id);
		setEditOriginal(item.original);
		setEditReplacement(item.replacement);
	}, []);

	const handleSaveEdit = useCallback(() => {
		if (editingId && editOriginal && editReplacement) {
			updateReplacement(editingId, editOriginal, editReplacement);
			setEditingId(null);
			setEditOriginal("");
			setEditReplacement("");
		}
	}, [editingId, editOriginal, editReplacement, updateReplacement]);

	const handleCancelEdit = useCallback(() => {
		setEditingId(null);
		setEditOriginal("");
		setEditReplacement("");
	}, []);

	const handleAdd = useCallback(() => {
		if (newOriginal && newReplacement) {
			addReplacement(newOriginal, newReplacement);
			setNewOriginal("");
			setNewReplacement("");
		}
	}, [newOriginal, newReplacement, addReplacement]);

	const handleClearAll = useCallback(() => {
		setConfirmModal({
			show: true,
			message: "确定要清空所有替换词组吗？",
			onConfirm: () => {
				clearAllReplacements();
				setConfirmModal(prev => ({ ...prev, show: false }));
			},
		});
	}, [clearAllReplacements]);

	if (!open) return null;

	return (
		<div className="modal-overlay" onClick={onClose}>
			<div className="config-modal" onClick={(e) => e.stopPropagation()}>
				<div className="config-header">
					<div className="config-title">
						<span className="title-icon"><Icons.punctuation size={16} /></span>
						<span>敏感词替换</span>
					</div>
					<button className="close-btn" onClick={onClose}>
						<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
							<path d="M3 3L13 13M13 3L3 13" />
						</svg>
					</button>
				</div>
				<div className="config-body">
					{/* 新增词组 */}
					<div className="config-section">
						<div className="section-label">添加替换规则</div>
						<div className="word-replacement-add-row">
							<input
								type="text"
								className="config-input"
								placeholder="原始词组"
								value={newOriginal}
								onChange={(e) => setNewOriginal(e.target.value)}
							/>
							<div className="word-replacement-arrow">
								<Icons.chevronRight size={16} />
							</div>
							<input
								type="text"
								className="config-input"
								placeholder="替换词组"
								value={newReplacement}
								onChange={(e) => setNewReplacement(e.target.value)}
							/>
							<button
								className="btn"
								onClick={handleAdd}
								disabled={!newOriginal || !newReplacement}
							>
								<Icons.plus size={14} />添加
							</button>
						</div>
					</div>

					{/* 词组列表 */}
					<div className="config-section">
						<div className="section-header">
							<div className="section-label">替换规则列表</div>
							<span className="section-count">{replacements.length} 条</span>
						</div>
						<div className="word-replacement-list">
							{replacements.length === 0 ? (
								<div className="empty-state">
									<Icons.punctuation size={48} className="empty-icon" />
									<p>暂无替换规则</p>
									<p className="hint">添加敏感词替换规则，避免 TTS 生成被拒绝</p>
								</div>
							) : (
								<div className="word-replacement-table">
									<div className="word-replacement-table-header">
										<span>原始词组</span>
										<span className="table-arrow"></span>
										<span>替换词组</span>
										<span className="table-actions">操作</span>
									</div>
									<div className="word-replacement-table-body">
										{replacements.map((item) => (
											<div key={item.id} className="word-replacement-row">
												{editingId === item.id ? (
													<>
														<input
															type="text"
															className="config-input edit-input"
															value={editOriginal}
															onChange={(e) => setEditOriginal(e.target.value)}
														/>
														<div className="word-replacement-arrow">
															<Icons.chevronRight size={14} />
														</div>
														<input
															type="text"
															className="config-input edit-input"
															value={editReplacement}
															onChange={(e) => setEditReplacement(e.target.value)}
														/>
														<div className="word-replacement-row-actions edit">
															<button className="btn" onClick={handleSaveEdit} title="保存">
																<Icons.check size={14} />
															</button>
															<button className="btn" onClick={handleCancelEdit} title="取消">
																<Icons.x size={14} />
															</button>
														</div>
													</>
												) : (
													<>
														<span className="word-original">{item.original}</span>
														<div className="word-replacement-arrow">
															<Icons.chevronRight size={14} />
														</div>
														<span className="word-replacement">{item.replacement}</span>
														<div className="word-replacement-row-actions">
															<button className="btn" onClick={() => handleStartEdit(item)} title="编辑">
																<Icons.edit size={14} />
															</button>
															<button className="btn danger" onClick={() => removeReplacement(item.id)} title="删除">
																<Icons.trash2 size={14} />
															</button>
														</div>
													</>
												)}
											</div>
										))}
									</div>
								</div>
							)}
						</div>
					</div>

					{/* 说明 */}
					<div className="config-section">
						<div className="section-label"><Icons.sparkle size={14} />使用说明</div>
						<ul className="word-replacement-tips">
							<li>在请求 TTS 大模型前，系统会自动将文本中的敏感词替换为指定词组</li>
							<li>替换规则按添加顺序依次执行</li>
							<li>支持中英文词组替换</li>
						</ul>
					</div>
				</div>
				<div className="character-actions-fab-wrapper">
					{replacements.length > 0 && (
						<button className="btn" onClick={handleClearAll}>
							<Icons.trash2 size={18} />
							<span>清空全部</span>
						</button>
					)}
					<button className="btn" onClick={onClose}>
						<Icons.checkCircle size={18} />
						<span>完成</span>
					</button>
				</div>

				<ConfirmModal
					show={confirmModal.show}
					title="清空替换词组"
					message={confirmModal.message}
					danger
					confirmText="确定"
					cancelText="取消"
					onConfirm={confirmModal.onConfirm}
					onCancel={() => setConfirmModal(prev => ({ ...prev, show: false }))}
				/>
			</div>
		</div>
	);
}