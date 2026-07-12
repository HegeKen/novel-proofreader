import React, { useState, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useCharacterStore } from "../stores/characterStore";
import { useNovelStore } from "../stores/novelStore";
import type { NovelEvent } from "../types";
import { Icons } from "./Icons";
import { useAppMetaStore } from "../stores/appMetaStore";
import { generateNovelEvents } from "../utils/aiClient";
import { useAIConfigStore } from "../stores/aiConfigStore";
import { logger } from "../utils/logger";

interface NovelEventModalProps {
	novelId: string | null;
	show: boolean;
	onClose: () => void;
}

interface EventFormData {
	title: string;
	description: string;
	timeOrder: number;
	timeInfo: string;
	chapter: string;
	involvedCharacterIds: string[];
}

const emptyForm: EventFormData = {
	title: "",
	description: "",
	timeOrder: 1,
	timeInfo: "",
	chapter: "",
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

	const chapters = useNovelStore((s) => s.chapters);
	const aiConfig = useAIConfigStore((s) => s.aiConfig);

	const [editingId, setEditingId] = useState<string | null>(null);
	const [formData, setFormData] = useState<EventFormData>(emptyForm);
	const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
	const [isGenerating, setIsGenerating] = useState(false);
	const [generationProgress, setGenerationProgress] = useState({ current: 0, total: 1 });
	const [generationPhase, setGenerationPhase] = useState<string>("");
	const [generationStatus, setGenerationStatus] = useState<"success" | "error" | "info" | null>(null);
	const [generationMessage, setGenerationMessage] = useState("");

	const sortedEvents = [...storeEvents].sort((a, b) => a.timeOrder - b.timeOrder);

	const handleAdd = useCallback(() => {
		setEditingId("__new__");
		const nextOrder = sortedEvents.length > 0 ? Math.max(...sortedEvents.map((e) => e.timeOrder)) + 1 : 1;
		setFormData({ title: "", description: "", timeOrder: nextOrder, timeInfo: "", chapter: "", involvedCharacterIds: [] });
	}, [sortedEvents]);

	const handleEdit = useCallback((evt: NovelEvent) => {
		setEditingId(evt.id);
		setFormData({
			title: evt.title,
			description: evt.description,
			timeOrder: evt.timeOrder,
			timeInfo: evt.timeInfo,
			chapter: evt.chapter,
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

	const handleGenerateWithAI = useCallback(async () => {
		if (!novelId || !chapters.length || isGenerating) return;

		setIsGenerating(true);
		setGenerationProgress({ current: 0, total: 1 });
		setGenerationPhase("分析中");
		setGenerationStatus("info");
		setGenerationMessage("正在分析小说内容生成大事记...");
		logger.proofread("[NovelEventModal] 开始 AI 生成大事记");

		try {
			const novelContent = chapters.map((ch) => `${ch.title}\n${ch.content}`).join("\n\n");
			const characterNames = characters.map((ch) => ch.name).join("、");

			const result = await generateNovelEvents(
				novelContent,
				characterNames,
				aiConfig,
				(current, total, phase) => {
					const phaseText = phase === "analyze" ? "分析中" : "合并中";
					setGenerationProgress({ current, total });
					setGenerationPhase(phaseText);
					setGenerationMessage(`${phaseText} ${current}/${total}`);
				}
			);

			if (!result || !Array.isArray(result.events) || result.events.length === 0) {
				setGenerationStatus("error");
				setGenerationMessage("未生成任何事件，请重试");
				return;
			}

			const nextOrder = sortedEvents.length > 0 ? Math.max(...sortedEvents.map((e) => e.timeOrder)) : 0;
			let addedCount = 0;

			for (let i = 0; i < result.events.length; i++) {
				const evt = result.events[i];
				if (!evt.title) continue;

				const involvedCharacterIds: string[] = [];
				if (evt.involvedCharacterNames && Array.isArray(evt.involvedCharacterNames)) {
					for (const charName of evt.involvedCharacterNames) {
						const matchedChar = characters.find((ch) =>
							ch.name.includes(charName) || charName.includes(ch.name)
						);
						if (matchedChar) {
							involvedCharacterIds.push(matchedChar.id);
						}
					}
				}

				addEvent(novelId, {
					title: evt.title,
					description: evt.description || "",
					timeOrder: (evt.timeOrder || i + 1) + nextOrder,
					timeInfo: evt.timeInfo || "",
					chapter: evt.chapter || "",
					involvedCharacterIds,
				});
				addedCount++;
			}

			setGenerationStatus("success");
			setGenerationMessage(`成功生成 ${addedCount} 个大事记`);
			logger.proofread(`[NovelEventModal] AI 生成成功，添加了 ${addedCount} 个事件`);
		} catch (err) {
			logger.errorGeneric("[NovelEventModal] AI 生成失败:", err);
			const errorMessage = err instanceof Error ? err.message : "生成失败";
			let message: string;
			if (errorMessage.includes("网络") || errorMessage.includes("network") || errorMessage.includes("fetch")) {
				message = "生成失败，请检查网络连接";
			} else if (errorMessage.includes("配置")) {
				message = "生成失败，请检查 AI 配置";
			} else if (errorMessage.includes("401")) {
				message = "生成失败，API Key 无效";
			} else if (errorMessage.includes("402")) {
				message = "生成失败，账户余额不足";
			} else if (errorMessage.includes("429")) {
				message = "生成失败，请求频率超限，请稍后重试";
			} else {
				message = `生成失败：${errorMessage.slice(0, 50)}`;
			}
			setGenerationStatus("error");
			setGenerationMessage(message);
		} finally {
			setIsGenerating(false);
		}
	}, [novelId, chapters, characters, aiConfig, addEvent, sortedEvents, isGenerating]);

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
					{(isGenerating || generationStatus) && (
						<div className={`generation-progress ${generationStatus || "info"}`}>
							<div className="generation-progress-header">
								<Icons.brain size={16} />
								<span className="generation-progress-phase">{generationPhase}</span>
								{isGenerating && (
									<Icons.loader2 size={14} className="generation-spinner" />
								)}
								{!isGenerating && generationStatus && (
									<button
										className="generation-progress-close"
										onClick={() => {
											setGenerationStatus(null);
											setGenerationMessage("");
											setGenerationProgress({ current: 0, total: 1 });
										}}
									>
										<Icons.x size={14} />
									</button>
								)}
							</div>
							<div className="generation-progress-bar">
								<div
									className="generation-progress-fill"
									style={{ width: `${(generationProgress.current / generationProgress.total) * 100}%` }}
								/>
							</div>
							<div className="generation-progress-footer">
								<span className="generation-progress-message">{generationMessage}</span>
								{generationProgress.total > 1 && (
									<span className="generation-progress-counter">{generationProgress.current}/{generationProgress.total}</span>
								)}
							</div>
						</div>
					)}

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
								<label>发生章节</label>
								<input
									type="text"
									className="config-input"
									value={formData.chapter}
									onChange={(e) => setFormData({ ...formData, chapter: e.target.value })}
									placeholder="如：第1章、第一章"
								/>
							</div>
							<div className="form-field">
								<label>时间信息</label>
								<input
									type="text"
									className="config-input"
									value={formData.timeInfo}
									onChange={(e) => setFormData({ ...formData, timeInfo: e.target.value })}
									placeholder="如：三年后、清晨、某日傍晚"
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
						</div>
						{sortedEvents.length === 0 && (
							<div className="event-list-empty">
								<Icons.list size={24} />
								<p>暂无大事记，点击下方"新增"添加</p>
							</div>
						)}
						{sortedEvents.map((evt, idx) => (
							<div key={evt.id} className="event-item">
								<div className="event-item-order">{idx + 1}</div>
								<div className="event-item-body">
									<div className="event-item-title">{evt.title}</div>
									<div className="event-item-meta">
										{evt.chapter && (
											<span className="event-item-chapter">{evt.chapter}</span>
										)}
										{evt.timeInfo && (
											<span className="event-item-time-info">{evt.timeInfo}</span>
										)}
									</div>
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

				{/* 底部操作按钮 */}
				<div className="character-actions-fab-wrapper">
					<button
						className="btn"
						onClick={handleAdd}
						disabled={editingId !== null}
						title="新增大事记"
					>
						<Icons.plus size={16} />
						<span>新增</span>
					</button>
					<button
						className="btn"
						onClick={handleGenerateWithAI}
						disabled={editingId !== null || isGenerating || !chapters.length}
						title="AI 分析小说内容生成大事记"
					>
						<Icons.brain size={16} />
						<span>{isGenerating ? "生成中..." : "AI 生成"}</span>
					</button>
				</div>
			</div>
		</div>,
		document.body,
	);
};
