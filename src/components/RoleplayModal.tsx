// ============================================================
// 角色扮演（AI Roleplay）弹窗 — 与小说角色沉浸式对话
// ============================================================
import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useNovelStore } from "../stores/novelStore";
import { useCharacterStore } from "../stores/characterStore";
import { useRoleplayStore } from "../stores/roleplayStore";
import { useAIConfigStore } from "../stores/aiConfigStore";
import { useConfigStore } from "../stores/configStore";
import { useAppMetaStore } from "../stores/appMetaStore";
import { sendChatCompletion, buildRoleplaySystemPrompt, buildRequestConfig } from "../utils/aiClient";
import type { ChatMessage } from "../utils/aiClient";
import { synthesizeSpeechWithVoice, playAudio } from "../utils/ttsService";
import { Icons } from "./Icons";
import { Select } from "./Select";
import { RoleplayProfileModal } from "./RoleplayProfileModal";
import { logger } from "../utils/logger";
import { formatDateTime } from "../utils/formatters";
import { getRoleName } from "../utils/characterRoles";
import type { CharacterInfo, CharacterRelationship, RoleplayMessage, RoleplaySession } from "../types";

interface RoleplayModalProps {
	novelId: string;
	novelName: string;
	show: boolean;
	isMobile: boolean;
	onClose: () => void;
}

/** 移动端会话列表时间：当天显示 HH:mm，否则显示 MM-DD */
function formatSessionTime(ts: number): string {
	const d = new Date(ts);
	const now = new Date();
	if (d.toDateString() === now.toDateString()) {
		return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
	}
	return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 角色头像：与角色卡片一致的性别渐变 + 名字首字；角色缺失时显示占位文字 */
const CharacterAvatar: React.FC<{
	character?: CharacterInfo | null;
	className: string;
	fallback?: string;
	onClick?: (e: React.MouseEvent) => void;
}> = ({ character, className, fallback = "?", onClick }) => (
	<span
		className={`${className} ${character ? character.gender : "outer"}${onClick ? " clickable" : ""}`}
		onClick={onClick}
	>
		<span className="roleplay-avatar-text">
			{character ? character.name.charAt(0) : fallback}
		</span>
	</span>
);

/** 渲染角色消息文本：括号包裹的状态描述（如（轻轻叹了口气））用斜体区分 */
function renderRoleplayText(text: string): React.ReactNode {
	const parts = text.split(/([（(][^（）()]*[)）])/g);
	return parts.map((part, i) =>
		part && part.startsWith("（") || part.startsWith("(")
			? <em key={i} className="roleplay-msg-em">{part}</em>
			: <span key={i}>{part}</span>,
	);
}

/** 移除括号内的状态描述（如（轻轻叹了口气）），TTS 朗读时跳过背景提示 */
function stripRoleplayStateText(text: string): string {
	const cleaned = text.replace(/[（(][^（）()]*[)）]/g, "").replace(/\n{3,}/g, "\n\n").trim();
	return cleaned || text;
}

/** MiMo 有效音色列表（与 ttsService 保持一致，用于音色校验与性别兜底） */
const VALID_TTS_VOICES = new Set(["mimo_default", "冰糖", "茉莉", "苏打", "白桦", "Mia", "Chloe", "Milo", "Dean"]);

/** 推荐音色：角色指定了有效音色则优先使用；否则按性别推荐；局外人/性别未知用兜底 */
function recommendVoice(character: CharacterInfo | null | undefined, fallback: string): string {
	if (character?.voice && VALID_TTS_VOICES.has(character.voice)) return character.voice;
	if (character) {
		if (character.gender === "male") return "苏打";
		if (character.gender === "female") return "冰糖";
	}
	// 兜底：校验 fallback 是否为有效音色，避免无效音色导致男/女声混乱
	const safeFallback = VALID_TTS_VOICES.has(fallback) ? fallback : "";
	return safeFallback || "冰糖";
}

/** 模块级常量：避免 selector 每次返回新引用导致无限渲染 */
const EMPTY_SESSIONS: RoleplaySession[] = [];
const EMPTY_CHARACTERS: CharacterInfo[] = [];
const EMPTY_RELATIONSHIPS: CharacterRelationship[] = [];

export const RoleplayModal: React.FC<RoleplayModalProps> = ({ novelId, novelName, show, isMobile, onClose }) => {
	const chapters = useNovelStore((s) => s.chapters);
	const currentChapterIndex = useNovelStore((s) => s.currentChapterIndex);
	const characters = useCharacterStore((s) => s.novelCharacters[novelId] ?? EMPTY_CHARACTERS);
	const relationships = useCharacterStore((s) => s.characterRelationships[novelId] ?? EMPTY_RELATIONSHIPS);
	const worldbuilding = useCharacterStore((s) => s.worldbuilding[novelId] ?? null);
	const aiConfig = useAIConfigStore((s) => s.aiConfig);
	const ttsConfig = useConfigStore((s) => s.ttsConfig);

	const sessions = useRoleplayStore((s) => s.sessions[novelId] ?? EMPTY_SESSIONS);
	const activeSessionId = useRoleplayStore((s) => s.activeSessionId[novelId] ?? null);
	const createSession = useRoleplayStore((s) => s.createSession);
	const deleteSession = useRoleplayStore((s) => s.deleteSession);
	const addMessage = useRoleplayStore((s) => s.addMessage);
	const setActiveSession = useRoleplayStore((s) => s.setActiveSession);
	const updateSession = useRoleplayStore((s) => s.updateSession);

	const activeSession = useMemo(
		() => sessions.find((s) => s.id === activeSessionId) ?? null,
		[sessions, activeSessionId],
	);

	const [input, setInput] = useState("");
	const [isSending, setIsSending] = useState(false);
	// 角色个人主页弹窗（点击消息头像/聊天头部角色区打开）
	const [profileCharacter, setProfileCharacter] = useState<CharacterInfo | null>(null);
	// 新建会话的角色选择视图
	const [showCharacterPicker, setShowCharacterPicker] = useState(false);
	// 移动端全屏视图：会话列表 / 角色选择 / 聊天
	const [mobileView, setMobileView] = useState<"sessions" | "picker" | "chat">("sessions");
	// 用户扮演的角色 ID（空 = 局外人/旁观者）
	const [userCharacterId, setUserCharacterId] = useState("");
	const [playingMsgId, setPlayingMsgId] = useState<string | null>(null);
	const abortRef = useRef<AbortController | null>(null);
	const ttsAbortRef = useRef<AbortController | null>(null);
	const messagesEndRef = useRef<HTMLDivElement>(null);

	// 打开时重置状态（弹窗由外部 show 控制，打开瞬间同步重置内部表单状态是合理的初始化）
	useEffect(() => {
		/* eslint-disable react-hooks/set-state-in-effect */
		if (show) {
			setInput("");
			setIsSending(false);
			if (isMobile) {
				// 移动端：有会话先进会话列表，否则直接进入角色选择
				setMobileView(sessions.length === 0 ? "picker" : "sessions");
			} else {
				setShowCharacterPicker(sessions.length === 0);
			}
		}
		/* eslint-enable react-hooks/set-state-in-effect */
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [show]);

	// 组件卸载时中止请求
	useEffect(() => {
		return () => {
			abortRef.current?.abort();
			ttsAbortRef.current?.abort();
		};
	}, []);

	// 新消息时滚动到底部
	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [activeSession?.messages.length, isSending]);

	const activeCharacter = useMemo(
		() => characters.find((c) => c.id === activeSession?.characterId) ?? null,
		[characters, activeSession],
	);

	const sortedSessions = useMemo(
		() => [...sessions].sort((a, b) => b.updatedAt - a.updatedAt),
		[sessions],
	);

	/** 创建新会话并进入对话 */
	const handleCreateSession = useCallback(
		(character: CharacterInfo) => {
			createSession(novelId, {
				characterId: character.id,
				userCharacterId: userCharacterId || undefined,
				chapterIndex: currentChapterIndex,
				title: "",
			});
			setShowCharacterPicker(false);
			setMobileView("chat");
			const identity = userCharacterId
				? characters.find((c) => c.id === userCharacterId)?.name ?? "自己"
				: "旁观者";
			useAppMetaStore.getState().showToast(
				`开始与「${character.name}」对话（${identity}视角）`,
				"success",
			);
		},
		[novelId, createSession, currentChapterIndex, userCharacterId, characters],
	);

	/** 删除会话 */
	const handleDeleteSession = useCallback(
		(e: React.MouseEvent, session: RoleplaySession) => {
			e.stopPropagation();
			deleteSession(novelId, session.id);
			useAppMetaStore.getState().showToast("会话已删除", "success");
		},
		[novelId, deleteSession],
	);

	/** 移动端聊天界面：删除当前会话并返回列表 */
	const handleDeleteActiveSession = useCallback(() => {
		if (!activeSession) return;
		deleteSession(novelId, activeSession.id);
		useAppMetaStore.getState().showToast("会话已删除", "success");
		setMobileView("sessions");
	}, [activeSession, novelId, deleteSession]);

	/** 发送消息并请求 AI 回复 */
	const handleSend = useCallback(async () => {
		const text = input.trim();
		if (!text || isSending || !activeSession) return;

		if (!aiConfig.apiKey || !aiConfig.baseURL) {
			useAppMetaStore.getState().showToast("请先在设置中配置 AI 模型", "warning");
			return;
		}
		const character = characters.find((c) => c.id === activeSession.characterId);
		if (!character) return;

		// 追加用户消息
		addMessage(novelId, activeSession.id, { role: "user", content: text });
		setInput("");
		// 首次发送时自动生成会话标题
		if (!activeSession.title) {
			updateSession(novelId, activeSession.id, { title: text.slice(0, 20) });
		}

		setIsSending(true);
		const abort = new AbortController();
		abortRef.current = abort;

		try {
			// 拼装上下文：角色设定 + 关系 + 世界观 + 当前剧情
			const related = relationships.filter(
				(r) => r.sourceId === character.id || r.targetId === character.id,
			);
			const chapter = chapters[activeSession.chapterIndex];
			const userCharacter = activeSession.userCharacterId
				? characters.find((c) => c.id === activeSession.userCharacterId)
				: null;
			const systemPrompt = buildRoleplaySystemPrompt({
				character,
				relatedRelationships: related,
				allCharacters: characters,
				worldbuilding,
				currentChapterTitle: chapter?.title ?? "",
				recentPlot: chapter ? chapter.content.slice(0, 800) : "",
				userCharacter,
			});

			// 历史消息（保留最近 20 条，控制 token）
			const history: ChatMessage[] = activeSession.messages
				.slice(-20)
				.map((m) => ({ role: m.role, content: m.content }));
			const messages: ChatMessage[] = [
				{ role: "system", content: systemPrompt },
				...history,
				{ role: "user", content: text },
			];

			const config = buildRequestConfig(aiConfig, { enableLogging: aiConfig.enableLogging });

			logger.info("[Roleplay]", `向「${character.name}」发送对话, 历史 ${history.length} 条`);
			const reply = await sendChatCompletion(messages, config, abort.signal);
			addMessage(novelId, activeSession.id, {
				role: "assistant",
				characterId: character.id,
				content: reply,
			});
		} catch (err) {
			if (err instanceof Error && err.name !== "AbortError") {
				logger.errorGeneric("[Roleplay]", "AI 回复失败", err);
				useAppMetaStore.getState().showToast(
					"获取回复失败: " + (err instanceof Error ? err.message : String(err)),
					"error",
				);
			}
		} finally {
			setIsSending(false);
			abortRef.current = null;
		}
	}, [
		input,
		isSending,
		activeSession,
		characters,
		relationships,
		worldbuilding,
		chapters,
		aiConfig,
		novelId,
		addMessage,
		updateSession,
	]);

	/** 停止生成 */
	const handleStop = useCallback(() => {
		abortRef.current?.abort();
		setIsSending(false);
	}, []);

	/** 播放 / 停止角色消息语音 */
	const handlePlayMessage = useCallback(
		async (msg: RoleplayMessage) => {
			if (!ttsConfig.apiKey) {
				useAppMetaStore.getState().showToast("请先在设置中配置 TTS API Key", "warning");
				return;
			}
			if (playingMsgId === msg.id) {
				ttsAbortRef.current?.abort();
				setPlayingMsgId(null);
				return;
			}
			// 解析消息对应的角色：用户消息取扮演角色（未选定则为局外人），AI 消息取消息所属角色
			const character =
				msg.role === "user"
					? activeSession?.userCharacterId
						? characters.find((c) => c.id === activeSession.userCharacterId) ?? null
						: null
					: characters.find((c) => c.id === msg.characterId) ?? null;
			const voice = recommendVoice(character, ttsConfig.voice);
			const voiceDesignPrompt = character?.voiceDesignPrompt
				? character.dialect
					? `${character.voiceDesignPrompt}，说${character.dialect}`
					: character.voiceDesignPrompt
				: undefined;

			const abort = new AbortController();
			ttsAbortRef.current = abort;
			setPlayingMsgId(msg.id);
			try {
				// 朗读时移除括号内的状态描述（背景提示不朗读）
				const ttsText = stripRoleplayStateText(msg.content);
				const audio = await synthesizeSpeechWithVoice(ttsText, ttsConfig, voice, voiceDesignPrompt);
				await playAudio(audio, abort.signal);
			} catch (err) {
				if (err instanceof DOMException && err.name === "AbortError") return;
				logger.errorGeneric("[Roleplay]", "TTS 播放失败", err);
				useAppMetaStore.getState().showToast("语音播放失败", "error");
			} finally {
				setPlayingMsgId(null);
				ttsAbortRef.current = null;
			}
		},
		[ttsConfig, characters, playingMsgId, activeSession],
	);

	/** 会话信息栏：章节位置切换 */
	const handleChapterChange = useCallback(
		(value: string) => {
			if (!activeSession) return;
			updateSession(novelId, activeSession.id, { chapterIndex: Number(value) });
		},
		[activeSession, novelId, updateSession],
	);

	/** 会话信息栏：切换用户身份 */
	const handleIdentityChange = useCallback(
		(value: string) => {
			if (!activeSession) return;
			updateSession(novelId, activeSession.id, {
				userCharacterId: value || undefined,
			});
		},
		[activeSession, novelId, updateSession],
	);

	const chatHeader = activeSession && activeCharacter && (
		<div className="roleplay-chat-header">
			<div
				className="roleplay-actor"
				onClick={() => setProfileCharacter(activeCharacter)}
				title="查看个人主页"
			>
				<CharacterAvatar character={activeCharacter} className="roleplay-actor-avatar" />
				<div className="roleplay-actor-info">
					<span className="roleplay-actor-name">{activeCharacter.name}</span>
					<span className="roleplay-actor-desc">
						{activeCharacter.role ? `${getRoleName(activeCharacter.role)} · ` : ""}
						{activeCharacter.personality ?? ""}
					</span>
				</div>
			</div>
			<div className="roleplay-header-actions">
				<div className="roleplay-identity-select">
					<Icons.userRound size={14} />
					<Select
						value={activeSession.userCharacterId ?? ""}
						onChange={handleIdentityChange}
						options={[
							{ value: "", label: "旁观者" },
							...characters.map((c) => ({ value: c.id, label: `扮演 ${c.name}` })),
						]}
					/>
				</div>
				<div className="roleplay-chapter-select">
					<Icons.book size={14} />
					<Select
						value={String(activeSession.chapterIndex)}
						onChange={handleChapterChange}
						options={chapters.map((ch, i) => ({
							value: String(i),
							label: ch.title || `第 ${i + 1} 章`,
						}))}
					/>
				</div>
			</div>
		</div>
	);

	// 移动端聊天头部：顶部居中显示对话对象名称
	const mobileChatHeader = activeSession && activeCharacter && (
		<div className="roleplay-mobile-header">
			<button
				className="roleplay-mobile-icon-btn"
				onClick={() => setMobileView("sessions")}
				aria-label="返回会话列表"
			>
				<Icons.arrowLeft size={20} />
			</button>
			<div
				className="roleplay-mobile-chat-title"
				onClick={() => setProfileCharacter(activeCharacter)}
				title="查看个人主页"
			>
				<span className="roleplay-mobile-chat-name">{activeCharacter.name}</span>
				{activeCharacter.role && (
					<span className="roleplay-mobile-chat-sub">{getRoleName(activeCharacter.role)}</span>
				)}
			</div>
			<button
				className="roleplay-mobile-icon-btn"
				onClick={handleDeleteActiveSession}
				aria-label="删除会话"
			>
				<Icons.trash2 size={18} />
			</button>
		</div>
	);

	// 对话内容（头部 + 消息区 + 输入栏），桌面端与移动端复用
	const chatContent = activeSession ? (
		<>
			{isMobile ? mobileChatHeader : chatHeader}
			<div className="roleplay-messages">
				{activeSession.messages.length === 0 && (
					<div className="roleplay-empty">
						<Icons.messageSquare size={40} />
						<p>与「{activeCharacter?.name ?? "角色"}」开始对话吧</p>
						<p className="roleplay-empty-hint">试试问问他 / 她此刻的想法</p>
					</div>
				)}
				{activeSession.messages.map((msg) => {
					const isUser = msg.role === "user";
					// 用户消息头像：选定的扮演角色；旁观者显示局外人默认头像
					// AI 消息头像：消息对应的角色
					const speaker = isUser
						? activeSession.userCharacterId
							? characters.find((c) => c.id === activeSession.userCharacterId) ?? null
							: null
						: characters.find((c) => c.id === msg.characterId) ?? null;
					return (
						<div
							key={msg.id}
							className={`roleplay-msg ${isUser ? "user" : "assistant"}`}
						>
							<CharacterAvatar
							character={speaker}
							className="roleplay-msg-avatar"
							fallback={isUser ? "旁" : "?"}
							onClick={
								speaker
									? (e) => {
											e.stopPropagation();
											setProfileCharacter(speaker);
										}
									: undefined
							}
							/>
							<div className="roleplay-msg-body">
							<div className="roleplay-msg-meta">
								<span className="roleplay-msg-name">
									{speaker?.name ?? (isUser ? "局外人" : "角色")}
								</span>
								<button
									className="roleplay-msg-tts"
									onClick={() => handlePlayMessage(msg)}
									title={playingMsgId === msg.id ? "停止播放" : "播放语音"}
								>
									{playingMsgId === msg.id ? (
										<Icons.pause size={13} />
									) : (
										<Icons.volume size={13} />
									)}
								</button>
							</div>
							<div className="roleplay-msg-bubble">{renderRoleplayText(msg.content)}</div>
								<span className="roleplay-msg-time">
									{formatDateTime(msg.timestamp)}
								</span>
							</div>
						</div>
					);
				})}
				{isSending && (
					<div className="roleplay-msg assistant">
						<CharacterAvatar character={activeCharacter} className="roleplay-msg-avatar" />
						<div className="roleplay-msg-body">
							<div className="roleplay-msg-meta">
								<span className="roleplay-msg-name">
									{activeCharacter?.name ?? "角色"}
								</span>
							</div>
							<div className="roleplay-msg-bubble typing">
								<span className="typing-dot"></span>
								<span className="typing-dot"></span>
								<span className="typing-dot"></span>
							</div>
						</div>
					</div>
				)}
				<div ref={messagesEndRef} />
			</div>
			<div className="roleplay-input-bar">
				<textarea
					className="roleplay-input"
					placeholder={`对「${activeCharacter?.name ?? "角色"}」说点什么...`}
					value={input}
					onChange={(e) => setInput(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault();
							void handleSend();
						}
					}}
					rows={2}
				/>
				<div className="roleplay-input-actions">
					{isSending ? (
						<button className="btn btn-secondary" onClick={handleStop}>
							<Icons.x size={16} />
							<span>停止</span>
						</button>
					) : (
						<button
							className="btn btn-primary"
							onClick={handleSend}
							disabled={!input.trim()}
						>
							<Icons.send size={16} />
							<span>发送</span>
						</button>
					)}
				</div>
		</div>
		</>
	) : null;

	// 角色个人主页弹窗（通过 portal 渲染到 body，桌面/移动端通用）
	const profileModal = profileCharacter && (
		<RoleplayProfileModal
			character={profileCharacter}
			isMobile={isMobile}
			onClose={() => setProfileCharacter(null)}
		/>
	);

	// 移动端：全屏聊天 APP 风格
	if (isMobile) {
		return (
			<>
				{createPortal(
					show && (
						<div className="modal-overlay roleplay-mobile-overlay" onClick={onClose}>
							<div className="roleplay-mobile" onClick={(e) => e.stopPropagation()}>
								{mobileView === "sessions" && (
									<>
										<div className="roleplay-mobile-header">
											<button
												className="roleplay-mobile-icon-btn"
												onClick={onClose}
												aria-label="关闭"
											>
												<Icons.x size={20} />
											</button>
											<span className="roleplay-mobile-title">角色扮演</span>
											<button
												className="roleplay-mobile-icon-btn"
												onClick={() => setMobileView("picker")}
												disabled={characters.length === 0}
												aria-label="新建会话"
											>
												<Icons.plus size={20} />
											</button>
										</div>
										<div className="roleplay-mobile-sessions">
											{sortedSessions.length === 0 ? (
												<div className="roleplay-mobile-empty">
													<Icons.messageSquare size={44} />
													<p>还没有会话</p>
													<p className="roleplay-empty-hint">
														选择一个角色，开始沉浸式对话
													</p>
													<button
														className="btn btn-primary"
														onClick={() => setMobileView("picker")}
														disabled={characters.length === 0}
													>
														<Icons.plus size={16} />
														<span>新建会话</span>
													</button>
												</div>
											) : (
												sortedSessions.map((s) => {
													const char = characters.find((c) => c.id === s.characterId);
													const lastMsg = s.messages[s.messages.length - 1];
													return (
														<div
															key={s.id}
															className="roleplay-mobile-session"
															onClick={() => {
																setActiveSession(novelId, s.id);
																setMobileView("chat");
															}}
														>
															<CharacterAvatar character={char} className="roleplay-mobile-session-avatar" />
															<div className="roleplay-mobile-session-info">
																<div className="roleplay-mobile-session-line">
																	<span className="roleplay-mobile-session-name">
																		{s.title ||
																			`与「${char?.name ?? "未知角色"}」的对话`}
																	</span>
																	<span className="roleplay-mobile-session-time">
																		{formatSessionTime(s.updatedAt)}
																	</span>
																</div>
																<div className="roleplay-mobile-session-line">
																	<span className="roleplay-mobile-session-preview">
																		{lastMsg ? lastMsg.content : "开始对话吧"}
																	</span>
																	<button
																		className="roleplay-mobile-session-del"
																		onClick={(e) => handleDeleteSession(e, s)}
																		aria-label="删除会话"
																	>
																		<Icons.trash2 size={15} />
																	</button>
																</div>
															</div>
														</div>
													);
												})
											)}
										</div>
									</>
								)}
								{mobileView === "picker" && (
									<>
										<div className="roleplay-mobile-header">
											<button
												className="roleplay-mobile-icon-btn"
												onClick={() => setMobileView("sessions")}
												aria-label="返回"
											>
												<Icons.arrowLeft size={20} />
											</button>
											<span className="roleplay-mobile-title">选择角色</span>
											<span className="roleplay-mobile-header-spacer" />
										</div>
										<div className="roleplay-mobile-picker">
											<div className="roleplay-picker-identity">
												<span className="roleplay-picker-identity-label">
													我的身份
												</span>
												<Select
													value={userCharacterId}
													onChange={setUserCharacterId}
													options={[
														{ value: "", label: "旁观者（局外人）" },
														...characters.map((c) => ({ value: c.id, label: `扮演 ${c.name}` })),
													]}
												/>
												<span className="roleplay-picker-identity-hint">
													{userCharacterId
														? "你将扮演该角色与对方对话"
														: "以读者视角与角色对话"}
												</span>
											</div>
											<div className="roleplay-mobile-picker-list">
												{characters.length === 0 && (
													<div className="roleplay-mobile-empty">
														<p>暂无角色</p>
														<p className="roleplay-empty-hint">
															请先在小说设置中创建角色
														</p>
													</div>
												)}
												{characters.map((c) => (
													<button
														key={c.id}
														className="roleplay-mobile-picker-item"
														onClick={() => handleCreateSession(c)}
													>
														<CharacterAvatar character={c} className="roleplay-mobile-picker-avatar" />
														<div className="roleplay-mobile-picker-info">
															<span className="roleplay-mobile-picker-name">
																{c.name}
															</span>
															<span className="roleplay-mobile-picker-desc">
																{getRoleName(c.role)}
																{c.personality ? ` · ${c.personality}` : ""}
															</span>
														</div>
														<Icons.chevronRight size={16} />
													</button>
												))}
											</div>
										</div>
									</>
								)}
								{mobileView === "chat" && activeSession && chatContent}
							</div>
						</div>
					),
					document.body,
				)}
			{profileModal}
		</>
	);
	}

	return (
		<>
			{createPortal(
				show && (
					<div className="modal-overlay" onClick={onClose}>
						<div className="roleplay-modal" onClick={(e) => e.stopPropagation()}>
							<div className="config-header">
								<div className="config-title">
									<span className="title-icon">
										<Icons.messageSquare size={16} />
									</span>
									<span>角色扮演</span>
									{novelName && <span className="title-novel-name">《{novelName}》</span>}
								</div>
								<button className="close-btn" onClick={onClose}>
									<Icons.close size={16} />
								</button>
							</div>
		
							<div className="roleplay-body">
								{/* 左侧：会话列表 */}
								<div className="roleplay-sidebar">
									<button
										className="roleplay-new-btn"
										onClick={() => setShowCharacterPicker(true)}
										disabled={characters.length === 0}
										title={characters.length === 0 ? "请先在小说设置中创建角色" : "新建会话"}
									>
										<Icons.plus size={16} />
										<span>新建会话</span>
									</button>
									<div className="roleplay-session-list">
										{sortedSessions.length === 0 && (
											<div className="roleplay-session-empty">暂无会话</div>
										)}
										{sortedSessions.map((s) => {
											const char = characters.find((c) => c.id === s.characterId);
											const isActive = s.id === activeSessionId;
											return (
												<div
													key={s.id}
													className={`roleplay-session-item${isActive ? " active" : ""}`}
													onClick={() => {
														setActiveSession(novelId, s.id);
														setShowCharacterPicker(false);
													}}
												>
													<span className="roleplay-session-name">
														{s.title || `与「${char?.name ?? "未知角色"}」的对话`}
													</span>
													<span className="roleplay-session-time">
														{formatDateTime(s.updatedAt)}
													</span>
													<button
														className="roleplay-session-del"
														onClick={(e) => handleDeleteSession(e, s)}
														title="删除会话"
													>
														<Icons.trash2 size={14} />
													</button>
												</div>
											);
										})}
									</div>
								</div>
		
								{/* 右侧：角色选择 / 对话区 */}
								<div className="roleplay-main">
									{showCharacterPicker ? (
										<div className="roleplay-picker">
											<div className="roleplay-picker-title">选择要对话的角色</div>
											<div className="roleplay-picker-identity">
												<span className="roleplay-picker-identity-label">
													我的身份
												</span>
												<Select
													value={userCharacterId}
													onChange={setUserCharacterId}
													options={[
														{ value: "", label: "旁观者（局外人）" },
														...characters.map((c) => ({ value: c.id, label: `扮演 ${c.name}` })),
													]}
												/>
												<span className="roleplay-picker-identity-hint">
													{userCharacterId
														? "你将扮演该角色与对方对话"
														: "以读者视角与角色对话"}
												</span>
											</div>
											<div className="roleplay-picker-grid">
												{characters.map((c) => (
													<button
														key={c.id}
														className="roleplay-picker-card"
														onClick={() => handleCreateSession(c)}
													>
														<CharacterAvatar character={c} className="roleplay-picker-avatar" />
														<span className="roleplay-picker-name">{c.name}</span>
														<span className="roleplay-picker-role">
															{getRoleName(c.role)}
														</span>
														<span className="roleplay-picker-desc">
															{c.personality ?? c.background ?? c.identity ?? ""}
														</span>
													</button>
												))}
											</div>
										</div>
									) : activeSession ? (
										chatContent
									) : (
										<div className="roleplay-empty">
											<Icons.messageSquare size={40} />
											<p>选择或创建一个会话，与角色对话</p>
											<button className="btn btn-primary" onClick={() => setShowCharacterPicker(true)}>
												<Icons.plus size={16} />
												<span>新建会话</span>
											</button>
										</div>
									)}
								</div>
							</div>
						</div>
					</div>
					),
					document.body,
				)}
			{profileModal}
		</>
	);
};
