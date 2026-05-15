// ============================================================
// 角色设置组件
// ============================================================
import { useState, useCallback, useMemo, useRef } from "react";
import { useAppStore } from "../stores/appStore";
import { useConfigStore } from "../stores/configStore";
import type { CharacterInfo } from "../types";
import { synthesizeSpeechWithVoice } from "../utils/ttsService";
import { Icons } from "./Icons";
import { Select } from "./Select";
import { logger } from "../utils/logger";

interface CharacterSettingsProps {
	novelId: string;
	onClose: () => void;
}

export function CharacterSettings({ novelId, onClose }: CharacterSettingsProps) {
	const novelCharacters = useAppStore((s) => s.novelCharacters);
	const characters = useMemo(() => novelCharacters[novelId] ?? [], [novelCharacters, novelId]);
	const addCharacter = useAppStore((s) => s.addCharacter);
	const updateCharacter = useAppStore((s) => s.updateCharacter);
	const removeCharacter = useAppStore((s) => s.removeCharacter);

	// 编辑状态
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editForm, setEditForm] = useState<Partial<CharacterInfo>>({
		name: "",
		gender: "other",
		notes: "",
		voice: "",
		aliases: [],
		relationTerms: [],
	});
	const [showAddForm, setShowAddForm] = useState(false);
	const [newAlias, setNewAlias] = useState("");
	const [newRelationTerm, setNewRelationTerm] = useState("");
	
	// TTS 功能状态
	const [playingNoteCharacterId, setPlayingNoteCharacterId] = useState<string | null>(null);
	const audioRef = useRef<HTMLAudioElement | null>(null);
	const cancelPlayRef = useRef<(() => void) | null>(null);
	const ttsConfig = useConfigStore((s) => s.ttsConfig);

	const voiceOptions = [
		{ value: "冰糖", label: "冰糖 (女)" },
		{ value: "茉莉", label: "茉莉 (女)" },
		{ value: "苏打", label: "苏打 (男)" },
		{ value: "白桦", label: "白桦 (男)" },
		{ value: "Mia", label: "Mia (女)" },
		{ value: "Chloe", label: "Chloe (女)" },
		{ value: "Milo", label: "Milo (男)" },
		{ value: "Dean", label: "Dean (男)" },
	];

	const startEdit = useCallback((char: CharacterInfo) => {
		setEditingId(char.id);
		setEditForm({ ...char });
	}, []);

	const saveEdit = useCallback(() => {
		if (editingId) {
			updateCharacter(novelId, editingId, editForm);
			setEditingId(null);
		}
	}, [editingId, novelId, editForm, updateCharacter]);

	const cancelEdit = useCallback(() => {
		setEditingId(null);
		setNewAlias("");
		setNewRelationTerm("");
	}, []);

	const addAlias = useCallback(() => {
		if (!newAlias.trim()) return;
		setEditForm(prev => ({
			...prev,
			aliases: [...(prev.aliases || []), newAlias.trim()]
		}));
		setNewAlias("");
	}, [newAlias]);

	const removeAlias = useCallback((index: number) => {
		setEditForm(prev => ({
			...prev,
			aliases: (prev.aliases || []).filter((_, i) => i !== index)
		}));
	}, []);

	const addRelationTerm = useCallback(() => {
		if (!newRelationTerm.trim()) return;
		setEditForm(prev => ({
			...prev,
			relationTerms: [...(prev.relationTerms || []), newRelationTerm.trim()]
		}));
		setNewRelationTerm("");
	}, [newRelationTerm]);

	const removeRelationTerm = useCallback((index: number) => {
		setEditForm(prev => ({
			...prev,
			relationTerms: (prev.relationTerms || []).filter((_, i) => i !== index)
		}));
	}, []);

	const handleAdd = useCallback(() => {
		if (!editForm.name?.trim()) return;
		addCharacter(novelId, {
			name: editForm.name.trim(),
			gender: editForm.gender || "other",
			notes: editForm.notes,
			voice: editForm.voice,
			aliases: editForm.aliases || [],
			relationTerms: editForm.relationTerms || [],
		});
		setShowAddForm(false);
		setEditForm({ name: "", gender: "other", notes: "", voice: "", aliases: [], relationTerms: [] });
		setNewAlias("");
		setNewRelationTerm("");
	}, [editForm, novelId, addCharacter]);

	const handleDelete = useCallback((id: string) => {
		if (confirm("确定要删除这个角色吗？")) {
			removeCharacter(novelId, id);
		}
	}, [novelId, removeCharacter]);

	// 播放备注
	const handlePlayNote = useCallback(async (character: CharacterInfo) => {
		if (!character.notes) return;
		
		// 如果正在播放当前角色的备注，停止播放
		if (playingNoteCharacterId === character.id) {
			// 停止播放
			if (audioRef.current) {
				audioRef.current.pause();
				audioRef.current = null;
			}
			if (cancelPlayRef.current) {
				cancelPlayRef.current();
				cancelPlayRef.current = null;
			}
			setPlayingNoteCharacterId(null);
			return;
		}
		
		// 停止之前的播放
		if (audioRef.current) {
			audioRef.current.pause();
			audioRef.current = null;
		}
		if (cancelPlayRef.current) {
			cancelPlayRef.current();
			cancelPlayRef.current = null;
		}
		
		setPlayingNoteCharacterId(character.id);
		
		let cancelled = false;
		cancelPlayRef.current = () => {
			cancelled = true;
		};
		
		try {
			// 确定使用的音色
			const voice = character.voice || ttsConfig.voice || "冰糖";
			// 构建播放文本：角色名 + 备注
			const playText = `${character.name}。${character.notes}`;
			
			logger.tts("播放角色备注", { character: character.name, voice, text: playText.slice(0, 50) + "..." });
			
			// 合成音频
			const audioBuffer = await synthesizeSpeechWithVoice(playText, ttsConfig, voice);
			
			if (cancelled) {
				logger.tts("播放已取消", { character: character.name });
				return;
			}
			
			// 播放音频
			const blob = new Blob([audioBuffer], { type: "audio/mp3" });
			const url = URL.createObjectURL(blob);
			const audio = new Audio();
			audioRef.current = audio;
			
			audio.onended = () => {
				URL.revokeObjectURL(url);
				setPlayingNoteCharacterId(null);
				audioRef.current = null;
			};
			
			audio.onerror = (e) => {
				URL.revokeObjectURL(url);
				logger.errorGeneric("播放备注失败", { error: e });
				setPlayingNoteCharacterId(null);
				audioRef.current = null;
			};
			
			audio.src = url;
			audio.load();
			audio.play().catch((error) => {
				logger.errorGeneric("开始播放失败", { error });
				setPlayingNoteCharacterId(null);
				audioRef.current = null;
			});
		} catch (error) {
			logger.errorGeneric("播放备注失败", { error });
			setPlayingNoteCharacterId(null);
		}
	}, [playingNoteCharacterId, ttsConfig]);

	return (
		<div className="modal-overlay" onClick={onClose}>
			<div className="character-settings-modal" onClick={(e) => e.stopPropagation()}>
				<div className="config-header">
					<div className="config-title">
						<span className="title-icon"><Icons.user size={16} /></span>
						<span>角色设置</span>
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
						<div className="section-label">
							<Icons.plus size={14} />
							添加角色
						</div>

						{/* 添加角色表单 */}
						{showAddForm ? (
							<div className="space-y-3">
								<div className="form-field">
									<label>角色名</label>
									<div className="input-wrapper">
										<input
											type="text"
											value={editForm.name}
											onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
											placeholder="请输入角色名"
											className="config-input"
										/>
									</div>
								</div>
								<div className="form-field">
									<label>性别</label>
									<Select
										value={editForm.gender || "other"}
										onChange={(v) => setEditForm({ ...editForm, gender: v as "male" | "female" | "other" })}
										options={[
											{ value: "male", label: "男" },
											{ value: "female", label: "女" },
											{ value: "other", label: "其他" },
										]}
									/>
								</div>

								{/* 别称 */}
								<div className="form-field">
									<label>别称 <span className="text-xs text-neutral-500">(如：我、主角等)</span></label>
									<div className="flex gap-2 mb-2">
										<input
											type="text"
											value={newAlias}
											onChange={(e) => setNewAlias(e.target.value)}
											onKeyPress={(e) => e.key === "Enter" && (e.preventDefault(), addAlias())}
											placeholder="输入别称后按回车添加"
											className="config-input flex-1"
										/>
										<button
											type="button"
											className="px-3 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm text-white transition-all"
											onClick={addAlias}
										>
											<Icons.plus size={14} />
										</button>
									</div>
									{(editForm.aliases || []).length > 0 && (
										<div className="flex flex-wrap gap-2">
											{(editForm.aliases || []).map((alias, index) => (
												<span key={index} className="alias-tag">
													{alias}
													<button
														type="button"
														className="remove-btn"
														onClick={() => removeAlias(index)}
													>
														×
													</button>
												</span>
											))}
										</div>
									)}
								</div>

								{/* 关系代称 */}
								<div className="form-field">
									<label>关系代称 <span className="text-xs text-neutral-500">(如：老婆、老公等)</span></label>
									<div className="flex gap-2 mb-2">
										<input
											type="text"
											value={newRelationTerm}
											onChange={(e) => setNewRelationTerm(e.target.value)}
											onKeyPress={(e) => e.key === "Enter" && (e.preventDefault(), addRelationTerm())}
											placeholder="输入关系代称后按回车添加"
											className="config-input flex-1"
										/>
										<button
											type="button"
											className="px-3 py-2 bg-purple-600 hover:bg-purple-500 rounded text-sm text-white transition-all"
											onClick={addRelationTerm}
										>
											<Icons.plus size={14} />
										</button>
									</div>
									{(editForm.relationTerms || []).length > 0 && (
										<div className="flex flex-wrap gap-2">
											{(editForm.relationTerms || []).map((term, index) => (
												<span key={index} className="relation-tag">
													{term}
													<button
														type="button"
														className="remove-btn"
														onClick={() => removeRelationTerm(index)}
													>
														×
													</button>
												</span>
											))}
										</div>
									)}
								</div>

								<div className="form-field">
									<label>指定音色</label>
									<Select
										value={editForm.voice || ""}
										onChange={(v) => setEditForm({ ...editForm, voice: v })}
										options={[{ value: "", label: "自动选择" }, ...voiceOptions]}
									/>
								</div>
								<div className="form-field">
									<label>备注</label>
									<textarea
										value={editForm.notes || ""}
										onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
										placeholder="可选的备注信息"
										className="config-input"
										style={{ minHeight: "60px" }}
									/>
								</div>
								<div className="flex gap-2 pt-2">
								<button
									className="reader-search-btn flex-1 justify-center"
									onClick={handleAdd}
								>
									<Icons.plus size={14} />
									添加
								</button>
								<button
									className="reader-search-btn"
									onClick={() => {
										setShowAddForm(false);
										setEditForm({ name: "", gender: "other", notes: "", voice: "", aliases: [], relationTerms: [] });
										setNewAlias("");
										setNewRelationTerm("");
									}}
								>
									取消
								</button>
							</div>
							</div>
						) : (
							<button
								className="w-full px-4 py-3 border-2 border-dashed border-neutral-600 hover:border-neutral-500 rounded flex items-center justify-center gap-2 text-neutral-400 hover:text-neutral-300 transition-all"
								onClick={() => setShowAddForm(true)}
							>
								<Icons.plus size={16} />
								添加新角色
							</button>
						)}
					</div>

					{/* 角色列表 */}
					{characters.length > 0 && (
						<div className="config-section">
							<div className="section-label">
								<Icons.user size={14} />
								角色列表 ({characters.length})
							</div>

							<div className="space-y-4">
								{characters.map((char) => (
									<div key={char.id} className="character-card">
										{editingId === char.id ? (
											<div className="space-y-3">
												<div className="form-field">
													<label>角色名</label>
													<input
														type="text"
														value={editForm.name || ""}
														onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
														className="config-input"
													/>
												</div>
												<div className="grid grid-cols-2 gap-3">
													<div className="form-field">
														<label>性别</label>
														<Select
															value={editForm.gender || "other"}
															onChange={(v) => setEditForm({ ...editForm, gender: v as "male" | "female" | "other" })}
															options={[
																{ value: "male", label: "男" },
																{ value: "female", label: "女" },
																{ value: "other", label: "其他" },
															]}
														/>
													</div>
													<div className="form-field">
														<label>音色</label>
														<Select
															value={editForm.voice || ""}
															onChange={(v) => setEditForm({ ...editForm, voice: v })}
															options={[{ value: "", label: "自动选择" }, ...voiceOptions]}
														/>
													</div>
												</div>

												{/* 别称 */}
												<div className="form-field">
													<label className="text-xs">别称</label>
													<div className="flex gap-2 mb-2">
														<input
															type="text"
															value={newAlias}
															onChange={(e) => setNewAlias(e.target.value)}
															onKeyPress={(e) => e.key === "Enter" && (e.preventDefault(), addAlias())}
															placeholder="输入后按回车"
															className="config-input flex-1"
														/>
														<button
															type="button"
															className="px-2 py-1 bg-blue-600 hover:bg-blue-500 rounded text-xs text-white"
															onClick={addAlias}
														>
															<Icons.plus size={12} />
														</button>
													</div>
													{(editForm.aliases || []).length > 0 && (
														<div className="flex flex-wrap gap-1">
															{(editForm.aliases || []).map((alias, index) => (
																<span key={index} className="alias-tag text-xs">
																	{alias}
																	<button
																		type="button"
																		className="remove-btn"
																		onClick={() => removeAlias(index)}
																	>
																		×
																	</button>
																</span>
															))}
														</div>
													)}
												</div>

												{/* 关系代称 */}
												<div className="form-field">
													<label className="text-xs">关系代称</label>
													<div className="flex gap-2 mb-2">
														<input
															type="text"
															value={newRelationTerm}
															onChange={(e) => setNewRelationTerm(e.target.value)}
															onKeyPress={(e) => e.key === "Enter" && (e.preventDefault(), addRelationTerm())}
															placeholder="输入后按回车"
															className="config-input flex-1"
														/>
														<button
															type="button"
															className="px-2 py-1 bg-purple-600 hover:bg-purple-500 rounded text-xs text-white"
															onClick={addRelationTerm}
														>
															<Icons.plus size={12} />
														</button>
													</div>
													{(editForm.relationTerms || []).length > 0 && (
														<div className="flex flex-wrap gap-1">
															{(editForm.relationTerms || []).map((term, index) => (
																<span key={index} className="relation-tag text-xs">
																	{term}
																	<button
																		type="button"
																		className="remove-btn"
																		onClick={() => removeRelationTerm(index)}
																	>
																		×
																	</button>
																</span>
															))}
														</div>
													)}
												</div>

												<div className="form-field">
													<label>备注</label>
													<textarea
														value={editForm.notes || ""}
														onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
														className="config-input"
													/>
												</div>
												<div className="flex gap-2 pt-2">
									<button
										className="reader-search-btn flex-1 justify-center"
										onClick={saveEdit}
									>
										<Icons.saveIcon size={14} />
										保存
									</button>
									<button
										className="reader-search-btn"
										onClick={cancelEdit}
									>
										取消
									</button>
								</div>
											</div>
										) : (
											<div className="character-card-content">
												{/* 主要信息区域 */}
												<div className="character-main-section">
													{/* 头像区域 */}
													<div className="character-avatar">
														<div className={`avatar-circle ${char.gender}`}>
															<span className="avatar-text">{char.name.charAt(0)}</span>
														</div>
													</div>

													{/* 信息区域 */}
													<div className="character-info">
														<div className="character-header">
															<h3 className="character-name">{char.name}</h3>
															<span className={`gender-badge ${char.gender}`}>
																{char.gender === "male" ? "男" : char.gender === "female" ? "女" : "其他"}
															</span>
														</div>

														<div className="character-details">
															<div className="detail-item">
																<Icons.volume size={14} />
																<span className="detail-label">音色:</span>
																<span className="detail-value">
																	{char.voice ? voiceOptions.find(o => o.value === char.voice)?.label || char.voice : "自动选择"}
																</span>
															</div>
															{(char.aliases && char.aliases.length > 0) && (
																<div className="detail-item aliases">
																	<Icons.edit size={14} />
																	<span className="detail-label">别称:</span>
																	<div className="tags-list">
																		{char.aliases.map((alias, index) => (
																			<span key={index} className="alias-badge">{alias}</span>
																		))}
																	</div>
																</div>
															)}
															{(char.relationTerms && char.relationTerms.length > 0) && (
																<div className="detail-item relations">
																	<Icons.sparkle size={14} />
																	<span className="detail-label">代称:</span>
																	<div className="tags-list">
																		{char.relationTerms.map((term, index) => (
																			<span key={index} className="relation-badge">{term}</span>
																		))}
																	</div>
																</div>
															)}
														</div>
													</div>

													{/* 操作按钮 */}
													<div className="character-actions">
														<button
															className="action-btn edit"
															onClick={() => startEdit(char)}
															title="编辑"
														>
															<Icons.edit size={16} />
														</button>
														<button
															className="action-btn delete"
															onClick={() => handleDelete(char.id)}
															title="删除"
														>
															<Icons.trash2 size={16} />
														</button>
													</div>
												</div>

												{/* 备注信息区域 - 单独展示 */}
												{char.notes && (
													<div className="character-notes-section">
														<div className="notes-label">
															<Icons.punctuation size={14} />
															备注
															<button
																className={`notes-play-btn ${playingNoteCharacterId === char.id ? 'playing' : ''}`}
																onClick={(e) => {
																	e.stopPropagation();
																	handlePlayNote(char);
																}}
																title={playingNoteCharacterId === char.id ? '停止播放' : '播放备注'}
															>
																{playingNoteCharacterId === char.id ? (
																	<Icons.pause size={14} />
																) : (
																	<Icons.volume size={14} />
																)}
															</button>
														</div>
														<div className="notes-content">{char.notes}</div>
													</div>
												)}
											</div>
										)}
									</div>
								))}
							</div>
						</div>
					)}

					{/* 空状态 */}
					{characters.length === 0 && !showAddForm && (
						<div className="text-center py-12">
							<div className="w-16 h-16 mx-auto mb-4 bg-neutral-700 rounded-full flex items-center justify-center">
								<Icons.user size={32} className="text-neutral-500" />
							</div>
							<p className="text-neutral-400 text-lg mb-2">还没有添加角色</p>
							<p className="text-neutral-500 text-sm">点击上方按钮添加第一个角色</p>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
