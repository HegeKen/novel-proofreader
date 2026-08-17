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
import { sendChatCompletion, buildRoleplayMultiSystemPrompt, parseMultiRoleplayResponse, buildRequestConfig, isBracketOnlyContent } from "../utils/aiClient";
import type { ChatMessage, MultiRoleplaySegment } from "../utils/aiClient";
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

/** 清理 AI 返回的角色名：去掉「」"" '' 《》 等包裹符号与空白 */
function cleanRoleName(name: string): string {
	return name.replace(/[「」""''《》【】()（）]/g, "").trim();
}

/** 按姓名或别名匹配角色（多角色气泡解析用；AI 可能用别名/简称/带标点，做宽容匹配） */
function matchCharacterByName(name: string, characters: CharacterInfo[]): CharacterInfo | null {
	const target = cleanRoleName(name);
	if (!target) return null;
	// 精确匹配姓名
	let hit = characters.find((c) => c.name === target);
	if (hit) return hit;
	// 匹配别名（含清理后的别名）
	hit = characters.find((c) => c.aliases?.some((a) => cleanRoleName(a) === target));
	if (hit) return hit;
	// 名称包含（AI 可能加"「」"或轻微改写）
	hit = characters.find((c) => c.name.includes(target) || target.includes(c.name));
	if (hit) return hit;
	return null;
}

export const RoleplayModal: React.FC<RoleplayModalProps> = ({ novelId, novelName, show, isMobile, onClose }) => {
	const chapters = useNovelStore((s) => s.chapters);
	const currentChapterIndex = useNovelStore((s) => s.currentChapterIndex);
	const characters = useCharacterStore((s) => s.novelCharacters[novelId] ?? EMPTY_CHARACTERS);
	const relationships = useCharacterStore((s) => s.characterRelationships[novelId] ?? EMPTY_RELATIONSHIPS);
	const worldbuilding = useCharacterStore((s) => s.worldbuilding[novelId] ?? null);
	const aiConfig = useAIConfigStore((s) => s.aiConfig);
	const ttsConfig = useConfigStore((s) => s.ttsConfig);
	const promptConfig = useConfigStore((s) => s.promptConfig);

	const sessions = useRoleplayStore((s) => s.sessions[novelId] ?? EMPTY_SESSIONS);
	const activeSessionId = useRoleplayStore((s) => s.activeSessionId[novelId] ?? null);
	const createSession = useRoleplayStore((s) => s.createSession);
	const deleteSession = useRoleplayStore((s) => s.deleteSession);
	const addMessage = useRoleplayStore((s) => s.addMessage);
	const updateMessage = useRoleplayStore((s) => s.updateMessage);
	const truncateMessagesAfter = useRoleplayStore((s) => s.truncateMessagesAfter);
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
	// 正在编辑的用户消息 ID + 编辑中的文本
	const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
	const [editText, setEditText] = useState("");
	// 正在查看"修改前"版本的用户消息 ID（null = 显示当前/修改后版本）
	const [viewingOriginalMsgId, setViewingOriginalMsgId] = useState<string | null>(null);
	const abortRef = useRef<AbortController | null>(null);
	const ttsAbortRef = useRef<AbortController | null>(null);
	const messagesContainerRef = useRef<HTMLDivElement>(null);

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

	// 进入会话 / 切换会话 / 新消息 / 打开聊天视图 / 切换修改前后分支时滚动到底部
	useEffect(() => {
		const container = messagesContainerRef.current;
		if (!container) return;
		// 等待 DOM 布局完成后再滚动；切换会话（id 变化）与新消息（length 变化）都会触发
		requestAnimationFrame(() => {
			container.scrollTop = container.scrollHeight;
		});
	}, [activeSession?.id, activeSession?.messages.length, isSending, mobileView, viewingOriginalMsgId]);

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

	/**
	 * 请求 AI 回复并追加到会话。
	 * @param session 当前会话（用于取上下文：角色/关系/世界观/剧情位置）
	 * @param contextMessages 发给 AI 的完整消息序列（最后一条为本次用户输入，此前为历史对话）
	 * @param userText 本次用户输入（作为最后一条 user 消息发给 AI）
	 */
	const requestReply = useCallback(async (session: RoleplaySession, contextMessages: RoleplayMessage[], userText: string) => {
		if (!aiConfig.apiKey || !aiConfig.baseURL) {
			useAppMetaStore.getState().showToast("请先在设置中配置 AI 模型", "warning");
			return;
		}
		const character = characters.find((c) => c.id === session.characterId);
		if (!character) return;

		setIsSending(true);
		const abort = new AbortController();
		abortRef.current = abort;

		try {
			// 拼装上下文：主角色关系 + 世界观 + 当前剧情
			const related = relationships.filter(
				(r) => r.sourceId === character.id || r.targetId === character.id,
			);
			const chapter = chapters[session.chapterIndex];
			const userCharacter = session.userCharacterId
				? characters.find((c) => c.id === session.userCharacterId)
				: null;
			// 多角色模式：可扮演角色 = 全部角色（AI 可依据输入引入其他角色）
			// 当前在场角色 = 主角 + 历史对话中出现过的角色（去重），
			// 另从本次用户输入中提取点名的角色（如"让林晚过来"），一并视为在场需发言
			const presentIdSet = new Set<string>([character.id]);
			for (const m of contextMessages) {
				if (m.role === "assistant" && m.characterId) presentIdSet.add(m.characterId);
			}
			for (const c of characters) {
				if (c.id === character.id) continue;
				if (c.name && userText.includes(c.name)) presentIdSet.add(c.id);
				else if (c.aliases?.some((a) => a && userText.includes(a))) presentIdSet.add(c.id);
			}
			const presentCharacters = characters.filter((c) => presentIdSet.has(c.id));

			// 发送请求并返回解析后的发言段（失败返回 null）
			const doRequest = async (
				prompt: string,
				present: CharacterInfo[],
				extraUserNote?: string,
				extraHistory?: RoleplayMessage[],
			): Promise<{ segments: MultiRoleplaySegment[]; raw: string } | null> => {
				const systemPrompt = buildRoleplayMultiSystemPrompt({
					character,
					playableCharacters: characters,
					presentCharacters: present,
					relatedRelationships: related,
					allCharacters: characters,
					worldbuilding,
					currentChapterTitle: chapter?.title ?? "",
					recentPlot: chapter ? chapter.content.slice(0, 800) : "",
					userCharacter,
				}, promptConfig.roleplayMulti);
				// 历史消息 = contextMessages 去掉最后一条（最后一条即本次输入）+ 附加上下文，保留最近 20 条；
				// 多角色场景下给 AI 标出每条 assistant 消息来自哪个角色，避免串戏
				const baseHistory: RoleplayMessage[] = [...contextMessages.slice(0, -1), ...(extraHistory ?? [])];
				const history: ChatMessage[] = baseHistory
					.slice(-20)
					.map((m) => {
						if (m.role === "assistant" && m.characterId) {
							const c = characters.find((ch) => ch.id === m.characterId);
							return { role: m.role as "assistant", content: c ? `（${c.name}）${m.content}` : m.content };
						}
						return { role: m.role, content: m.content };
					});
				const messages: ChatMessage[] = [
					{ role: "system", content: systemPrompt },
					...history,
					{ role: "user", content: extraUserNote ? `${prompt}\n\n补充要求：${extraUserNote}` : prompt },
				];

				const config = buildRequestConfig(aiConfig, { enableLogging: aiConfig.enableLogging });
				logger.info("[Roleplay]", `向「${character.name}」请求回复, 历史 ${history.length} 条`);
				const reply = await sendChatCompletion(messages, config, abort.signal);
				return { segments: parseMultiRoleplayResponse(reply) ?? [], raw: reply };
			};

			const first = await doRequest(userText, presentCharacters);
			if (!first) return; // 请求被取消或失败

			// 本轮已正式发言的角色（有括号外实质台词）
			const spokenIds = new Set<string>();
			// 已生成的所有发言（作为后续补齐请求的上下文，避免 AI 重复内容）
			const addedContext: RoleplayMessage[] = [];

			/** 处理一批发言段：只接收"属于目标角色 + 有实质台词 + 尚未发言"的段，并追加为消息 */
			const processSegments = (segs: MultiRoleplaySegment[], targets: CharacterInfo[]): number => {
				const targetIds = new Set(targets.map((t) => t.id));
				let added = 0;
				for (const seg of segs) {
					const target = matchCharacterByName(seg.character, characters) ?? character;
					// 只接收本轮目标角色（补齐轮次只补缺失角色，避免重复已有发言）
					if (!targetIds.has(target.id)) continue;
					// 本地校验：整段仅为一对括号包裹的描写（如"（沉默地看向窗外）"）→ 未正式发言，跳过等待补齐
					if (isBracketOnlyContent(seg.content)) continue;
					// 已发言的角色不再重复追加（AI 可能输出多条同一角色的发言）
					if (spokenIds.has(target.id)) continue;
					spokenIds.add(target.id);
					added += 1;
					addMessage(novelId, session.id, {
						role: "assistant",
						characterId: target.id,
						content: seg.content,
					});
					addedContext.push({
						id: `seg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
						role: "assistant",
						characterId: target.id,
						content: seg.content,
						timestamp: Date.now(),
					});
				}
				return added;
			};

			const round0Added = processSegments(first.segments, presentCharacters);
			if (round0Added > 1) {
				useAppMetaStore.getState().showToast(
					`${round0Added} 位角色加入了对话`,
					"info",
				);
			}

			// 首轮完全没解析出任何发言段 → 模型未按格式输出，直接回退为单角色消息，不做无意义的补齐
			if (first.segments.length === 0) {
				addMessage(novelId, session.id, {
					role: "assistant",
					characterId: character.id,
					content: first.raw,
				});
			} else {
				// 补齐发言：循环请求直到所有在场角色都有实质发言为止（引入只增不减，参与人数不设上限）。
				// 轮数上限仅作防死循环保护（随人数缩放），并非参与人数限制。
				const MAX_FILL_ROUNDS = Math.max(2, Math.min(presentCharacters.length, 6));
				let pending = presentCharacters.filter((c) => !spokenIds.has(c.id));
				let round = 0;
				while (pending.length > 0 && round < MAX_FILL_ROUNDS && !abort.signal.aborted) {
					round += 1;
					const pendingNames = pending.map((c) => c.name).join("、");
					// 第一轮补齐说明具体原因（没发言 / 只写了括号描写），后续轮次仅提示仍有角色未发言
					const note =
						round === 1
							? `角色「${pendingNames}」还没有给出正式发言（可能没有出现在回复中，或只写了括号内的动作/神态描写而没有真正说话）。请以这些角色各自的身份补上他们的发言（每个角色一条，必须是说出口的实质台词，可带少量括号描写辅助）。其他在场角色的发言已在上文给出，不要重复他们的内容。`
							: `仍有角色「${pendingNames}」尚未发言，请再次以这些角色各自的身份补上他们的发言（每个角色一条实质台词）。不要重复任何已说过的内容。`;
					const followUp = await doRequest(userText, pending, note, addedContext);
					if (!followUp) break; // 请求被取消或失败，停止补齐
					processSegments(followUp.segments, pending);
					pending = pending.filter((c) => !spokenIds.has(c.id));
				}

				// 补齐后仍没有任何实质发言 → 回退为单角色消息（AI 未按格式输出时保持原行为）
				if (addedContext.length === 0) {
					addMessage(novelId, session.id, {
						role: "assistant",
						characterId: character.id,
						content: first.raw,
					});
				}
			}
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
	}, [aiConfig, characters, relationships, worldbuilding, chapters, novelId, addMessage, promptConfig]);

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

		await requestReply(activeSession, [...activeSession.messages, { id: "pending", role: "user" as const, content: text, timestamp: Date.now() }], text);
	}, [input, isSending, activeSession, characters, aiConfig, novelId, addMessage, updateSession, requestReply]);

	/** 开始编辑用户消息 */
	const handleStartEdit = useCallback((msg: RoleplayMessage) => {
		setEditingMsgId(msg.id);
		setEditText(msg.content);
	}, []);

	/** 取消编辑 */
	const handleCancelEdit = useCallback(() => {
		setEditingMsgId(null);
		setEditText("");
	}, []);

	/** 保存编辑：更新消息 → 截断其后回复 → 仅以该消息之前的历史 + 修改后的内容重新请求 AI */
	const handleSaveEdit = useCallback(async () => {
		const session = activeSession;
		if (!session || !editingMsgId) return;
		const newText = editText.trim();
		if (!newText) {
			useAppMetaStore.getState().showToast("消息内容不能为空", "warning");
			return;
		}
		// 找到被编辑消息在截断前的位置与原文
		const msgIndex = session.messages.findIndex((m) => m.id === editingMsgId);
		if (msgIndex < 0) return;
		const originalMsg = session.messages[msgIndex];
		if (originalMsg.content === newText) {
			// 内容未变化：直接退出编辑，不触发重新生成
			setEditingMsgId(null);
			return;
		}

		// 1. 更新消息内容（store 内部会记录 originalContent）
		updateMessage(novelId, session.id, editingMsgId, newText);
		// 2. 截断该消息之后的所有消息，并把旧回复链保存到 originalReplies（查看修改前可回放）
		truncateMessagesAfter(novelId, session.id, editingMsgId, true);
		// 3. 以"该消息之前的历史 + 修改后的消息"重新请求 AI
		//    从 store 读取最新消息（updateMessage/truncateMessagesAfter 已同步写入）
		const latest = useRoleplayStore.getState().getSession(novelId, session.id);
		if (latest) {
			const historyBefore = latest.messages.slice(0, latest.messages.length - 1); // 该输入之前
			await requestReply(latest, [...historyBefore, { ...originalMsg, content: newText }], newText);
		}
		setEditingMsgId(null);
		setEditText("");
	}, [activeSession, editingMsgId, editText, novelId, updateMessage, truncateMessagesAfter, requestReply]);

	/** 切换用户消息的显示版本（修改后 ↔ 修改前） */
	const handleToggleMessageVersion = useCallback((msg: RoleplayMessage) => {
		setViewingOriginalMsgId((prev) => (prev === msg.id ? null : msg.id));
	}, []);

	/** 重新生成当前轮次回复：截断最后一条用户消息之后的回复，以"该消息之前的历史 + 该消息"重新请求 AI */
	const handleRegenerate = useCallback(async (msg: RoleplayMessage) => {
		const session = activeSession;
		if (!session || isSending) return;
		if (!aiConfig.apiKey || !aiConfig.baseURL) {
			useAppMetaStore.getState().showToast("请先在设置中配置 AI 模型", "warning");
			return;
		}
		// 该消息必须是会话最后一条用户消息（其后是待替换的回复）
		const lastUserIdx = session.messages.findIndex((m) => m.id === msg.id);
		if (lastUserIdx < 0 || session.messages[lastUserIdx].role !== "user") return;
		// 截断该消息之后的所有回复（重新生成不改变输入，无需保留旧回复链）
		truncateMessagesAfter(novelId, session.id, msg.id, false);
		// 以"该消息之前的历史 + 该消息"重新请求 AI
		const latest = useRoleplayStore.getState().getSession(novelId, session.id);
		if (latest) {
			const historyBefore = latest.messages.slice(0, latest.messages.length - 1);
			await requestReply(latest, [...historyBefore, msg], msg.content);
		}
	}, [activeSession, isSending, aiConfig, novelId, truncateMessagesAfter, requestReply]);

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
			<div className="roleplay-messages" ref={messagesContainerRef}>
				{activeSession.messages.length === 0 && (
					<div className="roleplay-empty">
						<Icons.messageSquare size={40} />
						<p>与「{activeCharacter?.name ?? "角色"}」开始对话吧</p>
						<p className="roleplay-empty-hint">试试问问他 / 她此刻的想法</p>
					</div>
				)}
				{/* 构建显示的消息列表：
				    查看修改前版本时，整条会话流切换为该输入之前的全部历史 + 修改前输入 + 修改前回复链；
				    否则显示当前（修改后）的完整消息流。实现"修改前/修改后"两个完整分支的切换。 */}
				{(() => {
					const viewOriginalMsg = viewingOriginalMsgId
						? activeSession.messages.find((m) => m.id === viewingOriginalMsgId)
						: null;
					const displayMessages =
						viewOriginalMsg?.originalReplies && viewOriginalMsg.originalReplies.length > 0
							? (() => {
									const idx = activeSession.messages.findIndex((m) => m.id === viewOriginalMsg.id);
									const before = idx > 0 ? activeSession.messages.slice(0, idx) : [];
									const originalInput: RoleplayMessage = {
										...viewOriginalMsg,
										content: viewOriginalMsg.originalContent ?? viewOriginalMsg.content,
									};
									return [...before, originalInput, ...viewOriginalMsg.originalReplies!];
								})()
							: activeSession.messages;
					return displayMessages.map((msg) => {
					const isUser = msg.role === "user";
					// 用户消息头像：选定的扮演角色；旁观者显示局外人默认头像
					// AI 消息头像：消息对应的角色
					const speaker = isUser
						? activeSession.userCharacterId
							? characters.find((c) => c.id === activeSession.userCharacterId) ?? null
							: null
						: characters.find((c) => c.id === msg.characterId) ?? null;
					// 多角色气泡视觉区分：assistant 消息按角色性别着色（与头像一致）
					const genderClass = !isUser && speaker
						? ` speaker-${speaker.gender}`
						: "";
					// 该消息是否为正在编辑/正在查看修改前的消息
					const isEditing = isUser && editingMsgId === msg.id;
					// 被编辑过的用户消息：有 originalContent 表示修改过
					const isEdited = isUser && !!msg.originalContent;
					// 是否正处于"查看修改前"分支（viewingOriginalMsgId 指向的这条输入）
					const showingOriginal = viewingOriginalMsgId === msg.id;
					// 当前展示的文本：分支显示时该输入已是 originalContent（由 displayMessages 构造）
					const displayContent = msg.content;
					// 是否为会话最后一条用户消息（重新生成按钮只对该消息显示）
					const isLastUserMsg = isUser &&
						activeSession.messages[activeSession.messages.length - 1]?.id === msg.id;
					return (
						<div
							key={msg.id}
							className={`roleplay-msg ${isUser ? "user" : "assistant"}${genderClass}`}
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
								{isUser && isEdited && !isEditing && (
									<button
										className="roleplay-msg-edit-toggle"
										onClick={() => handleToggleMessageVersion(msg)}
										title={showingOriginal ? "显示修改后" : "显示修改前"}
									>
										{showingOriginal ? (
											<><Icons.chevronRight size={12} />修改后</>
										) : (
											<><Icons.chevronLeft size={12} />修改前</>
										)}
									</button>
								)}
								{isUser && !isEditing && (
									<button
										className="roleplay-msg-edit"
										onClick={() => handleStartEdit(msg)}
										title="编辑这条消息并重新生成回复"
									>
										<Icons.edit size={12} />
									</button>
								)}
								{isUser && isLastUserMsg && !isEditing && (
									<button
										className="roleplay-msg-regenerate"
										onClick={() => void handleRegenerate(msg)}
										disabled={isSending}
										title="重新生成当前轮次的回复"
									>
										<Icons.refreshCw size={12} />
										重新生成
									</button>
								)}
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
							{isEditing ? (
								<div className="roleplay-msg-bubble roleplay-msg-editing">
									<textarea
										className="roleplay-edit-input"
										value={editText}
										onChange={(e) => setEditText(e.target.value)}
										rows={3}
										autoFocus
									/>
									<div className="roleplay-edit-actions">
										<button
											className="btn btn-secondary"
											onClick={handleCancelEdit}
										>
											取消
										</button>
										<button
											className="btn btn-primary"
											onClick={() => void handleSaveEdit()}
											disabled={!editText.trim()}
										>
											保存并重新生成
										</button>
									</div>
								</div>
							) : (
								<div className="roleplay-msg-bubble">
									{renderRoleplayText(displayContent)}
									{showingOriginal && (
										<span className="roleplay-msg-original-tag">修改前</span>
									)}
								</div>
							)}
								<span className="roleplay-msg-time">
									{formatDateTime(msg.timestamp)}
								</span>
							</div>
						</div>
					);
				});
				})()}
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
			</div>
			<div className="roleplay-input-bar">
				<textarea
					className="roleplay-input"
					placeholder={`对「${activeCharacter?.name ?? "角色"}」说点什么...（可输入"叫上某角色一起"引入他人）`}
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
