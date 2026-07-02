import React, { useState, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useCharacterStore } from "../stores/characterStore";
import type { NovelEvent } from "../types";
import { Icons } from "./Icons";
import { useAppMetaStore } from "../stores/appMetaStore";

interface NovelEventModalProps {
	novelId: string | null;
	show: boolean;
	onClose: () => void;
}

interface EventFormData {
	title: string;
	description: string;
	timeOrder: number;
	involvedCharacterIds: string[];
}

const emptyForm: EventFormData = {
	title: "",
	description: "",
	timeOrder: 1,
	involvedCharacterIds: [],
};

export const NovelEventModal: React.FC<NovelEventModalProps> = ({ novelId, show, onClose }) => {
	const novelEventsMap = useCharacterStore((s) => s.novelEvents);
	const storeEvents = useMemo(() => (novelId ? novelEventsMap[novelId] ?? [] : []), [novelEventsMap, novelId]);
	const addEvent = useCharacterStore((s) => s.addEvent);
	const updateEvent = useCharacterStore((s) => s.updateEvent);
	const removeEvent = useCharacterStore((s) => s.removeEvent);
	const novelCharactersMap = useCharacterStore((s) => s.novelCharacters);
	const characters = useMemo(() => (novelId ? novelCharactersMap[novelId] ?? [] : []), [novelCharactersMap, novelId]);

	const [editingId, setEditingId] = useState<string | null>(null);
	const [formData, setFormData] = useState<EventFormData>(emptyForm);
	const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);

	const sortedEvents = [...storeEvents].sort((a, b) => a.timeOrder - b.timeOrder);

	const handleAdd = useCallback(() => {
		setEditingId("__new__");
		const nextOrder = sortedEvents.length > 0 ? Math.max(...sortedEvents.map((e) => e.timeOrder)) + 1 : 1;
		setFormData({ title: "", description: "", timeOrder: nextOrder, involvedCharacterIds: [] });
	}, [sortedEvents]);

	const handleEdit = useCallback((evt: NovelEvent) => {
		setEditingId(evt.id);
		setFormData({
			title: evt.title,
			description: evt.description,
			timeOrder: evt.timeOrder,
			involvedCharacterIds: [...evt.involvedCharacterIds],
		});
	}, []);

	const handleCancelEdit = useCallback(() => {
		setEditingId(null);
		setFormData(emptyForm);
	}, []);

	const handleSave = useCallback(() => {
		if (!novelId) return;
		if (!formData.title.trim()) {
			useAppMetaStore.getState().showToast("请输入事件标题", "warning");
			return;
		}
		if (editingId === "__new__") {
			addEvent(novelId, formData);
		} else if (editingId) {
			updateEvent(novelId, editingId, formData);
		}
		setEditingId(null);
		setFormData(emptyForm);
		useAppMetaStore.getState().showToast(
			editingId === "__new__" ? "大事记已添加" : "大事记已更新",
			"success",
		);
	}, [novelId, editingId, formData, addEvent, updateEvent]);

	const handleDelete = useCallback(
		(eventId: string) => {
			if (!novelId) return;
			removeEvent(novelId, eventId);
			setShowDeleteConfirm(null);
			useAppMetaStore.getState().showToast("大事记已删除", "success");
		},
		[novelId, removeEvent],
	);

	const toggleCharacter = useCallback((charId: string) => {
		setFormData((prev) => ({
			...prev,
			involvedCharacterIds: prev.involvedCharacterIds.includes(charId)
				? prev.involvedCharacterIds.filter((id) => id !== charId)
				: [...prev.involvedCharacterIds, charId],
		}));
	}, []);

	if (!show || !novelId) return null;

	return createPortal(
		<div className="modal-overlay" onClick={onClose}>
			<div className="config-modal novel-event-modal" onClick={(e) => e.stopPropagation()}>
				<div className="config-header">
					<div className="config-title">
						<Icons.list size={18} />
						<span>小说大事记</span>
					</div>
					<button className="close-btn" onClick={onClose}>
						<Icons.x size={16} />
					</button>
				</div>

				<div className="config-body">
					{/* 编辑/添加表单 */}
					{editingId !== null && (
						<div className="event-edit-form">
							<h4 className="event-edit-title">
								{editingId === "__new__" ? "添加大事记" : "编辑大事记"}
							</h4>
							<div className="form-field">
								<label>事件标题</label>
								<input
									type="text"
									className="config-input"
									value={formData.title}
									onChange={(e) => setFormData({ ...formData, title: e.target.value })}
									placeholder="如：青云门拜师"
								/>
							</div>
							<div className="form-field">
								<label>时间顺序</label>
								<input
									type="number"
									className="config-input"
									style={{ width: 100 }}
									value={formData.timeOrder}
									onChange={(e) =>
										setFormData({ ...formData, timeOrder: Math.max(1, parseInt(e.target.value) || 1) })
									}
									min={1}
								/>
							</div>
							<div className="form-field">
								<label>事件描述</label>
								<textarea
									className="config-input"
									value={formData.description}
									onChange={(e) => setFormData({ ...formData, description: e.target.value })}
									placeholder="描述事件的具体经过..."
									rows={3}
								/>
							</div>
							<div className="form-field event-characters-field">
								<label>涉及角色（{formData.involvedCharacterIds.length} 个）</label>
								<div className="event-characters-list">
									{characters.length === 0 && (
										<span className="event-no-characters">暂无可选角色</span>
									)}
									{characters.map((ch) => (
										<label key={ch.id} className="event-character-item">
											<input
												type="checkbox"
												checked={formData.involvedCharacterIds.includes(ch.id)}
												onChange={() => toggleCharacter(ch.id)}
											/>
											<span className="event-character-name">
												{ch.name}
												{ch.role && <span className="event-character-role">（{ch.role}）</span>}
											</span>
										</label>
									))}
								</div>
							</div>
							<div className="event-edit-actions">
								<button className="btn" onClick={handleCancelEdit}>
									<Icons.x size={14} />
									<span>取消</span>
								</button>
								<button className="btn btn-primary" onClick={handleSave}>
									<Icons.saveIcon size={14} />
									<span>保存</span>
								</button>
							</div>
						</div>
					)}

					{/* 大事记列表 */}
					<div className="event-list">
						<div className="event-list-header">
							<span className="event-list-count">共 {sortedEvents.length} 个事件</span>
							<button className="btn btn-sm" onClick={handleAdd} disabled={editingId !== null}>
								<Icons.plus size={14} />
								<span>新增</span>
							</button>
						</div>
						{sortedEvents.length === 0 && (
							<div className="event-list-empty">
								<Icons.list size={24} />
								<p>暂无大事记，点击"新增"添加</p>
							</div>
						)}
						{sortedEvents.map((evt, idx) => (
							<div key={evt.id} className="event-item">
								<div className="event-item-order">{idx + 1}</div>
								<div className="event-item-body">
									<div className="event-item-title">{evt.title}</div>
									{evt.description && (
										<div className="event-item-desc">{evt.description}</div>
									)}
									{evt.involvedCharacterIds.length > 0 && (
										<div className="event-item-characters">
											{evt.involvedCharacterIds.map((cid) => {
												const ch = characters.find((c) => c.id === cid);
												return ch ? (
													<span key={cid} className="event-item-character-tag">
														{ch.name}
													</span>
												) : null;
											})}
										</div>
									)}
								</div>
								<div className="event-item-actions">
									<button
										className="event-item-btn"
										title="编辑"
										onClick={() => handleEdit(evt)}
										disabled={editingId !== null}
									>
										<Icons.edit size={14} />
									</button>
									<button
										className="event-item-btn event-item-btn-danger"
										title="删除"
										onClick={() => setShowDeleteConfirm(evt.id)}
										disabled={editingId !== null}
									>
										<Icons.trash2 size={14} />
									</button>
								</div>

								{/* 删除确认 */}
								{showDeleteConfirm === evt.id && (
									<div className="event-delete-confirm">
										<span>确定删除「{evt.title}」？</span>
										<div className="event-delete-confirm-actions">
											<button className="btn btn-sm" onClick={() => setShowDeleteConfirm(null)}>
												取消
											</button>
											<button className="btn btn-sm btn-danger" onClick={() => handleDelete(evt.id)}>
												删除
											</button>
										</div>
									</div>
								)}
							</div>
						))}
					</div>
				</div>
			</div>
		</div>,
		document.body,
	);
};
