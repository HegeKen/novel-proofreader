// ============================================================
// 角色扮演会话 Store — 按小说管理会话与消息，持久化到本地
// ============================================================
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { RoleplayMessage, RoleplaySession } from "../types";
import { generateId } from "../utils/id";
import { filterRecordByKeys } from "../utils/record";

interface RoleplayState {
	/** 每部小说的会话列表（key 为 novelId） */
	sessions: Record<string, RoleplaySession[]>;
	/** 每部小说当前激活的会话 ID（key 为 novelId） */
	activeSessionId: Record<string, string | null>;

	createSession: (
		novelId: string,
		session: Pick<RoleplaySession, "characterId" | "chapterIndex" | "title" | "userCharacterId"> &
			Partial<Pick<RoleplaySession, "presentCharacterIds">>,
	) => RoleplaySession;
	deleteSession: (novelId: string, sessionId: string) => void;
	addMessage: (
		novelId: string,
		sessionId: string,
		message: Omit<RoleplayMessage, "id" | "timestamp">,
	) => void;
	/** 编辑一条消息的内容；若内容变化且首次编辑，把旧内容保存到 originalContent 用于查看修改前后 */
	updateMessage: (novelId: string, sessionId: string, messageId: string, content: string) => void;
	/** 截断指定消息之后的所有消息（用于编辑后重新生成，保留指定消息及其之前的内容）；
	 *  若 saveRemoved 为 true，被删除的旧回复链会保存到该消息的 originalReplies（供查看修改前的完整对话） */
	truncateMessagesAfter: (novelId: string, sessionId: string, messageId: string, saveRemoved?: boolean) => void;
	/** 编辑用户消息并创建新分支：当前分支状态入档，消息内容替换为新内容并截断后续，激活新分支 */
	editMessageBranch: (novelId: string, sessionId: string, messageId: string, newContent: string) => void;
	/** 重新生成当前分支：当前分支回复链入档，截断后续消息，激活新分支（内容不变）。
	 *  newBranch 为 false 时原地重新生成：不产生新分支，仅截断后续消息（用于编辑后内容未变的场景） */
	regenerateBranch: (novelId: string, sessionId: string, messageId: string, newBranch?: boolean) => void;
	/** 切换用户消息的激活分支（连同后续回复链一起切换） */
	switchBranch: (novelId: string, sessionId: string, messageId: string, branchIndex: number) => void;
	clearMessages: (novelId: string, sessionId: string) => void;
	setActiveSession: (novelId: string, sessionId: string | null) => void;
	updateSession: (
		novelId: string,
		sessionId: string,
		updates: Partial<Pick<RoleplaySession, "characterId" | "chapterIndex" | "title" | "userCharacterId" | "presentCharacterIds">>,
	) => void;
	getSessions: (novelId: string) => RoleplaySession[];
	getSession: (novelId: string, sessionId: string) => RoleplaySession | null;

	clearNovelData: (novelId: string) => void;
	rebuildStatistics: (validNovelIds: string[]) => void;
}

export const useRoleplayStore = create<RoleplayState>()(
	persist(
		(set, get) => ({
			sessions: {},
			activeSessionId: {},

			createSession: (novelId, session) => {
				const newSession: RoleplaySession = {
					...session,
					// 缺省仅主角色在场（群聊创建时由调用方传入完整在场列表）
					presentCharacterIds: session.presentCharacterIds?.length
						? session.presentCharacterIds
						: [session.characterId],
					id: generateId("rp"),
					novelId,
					messages: [],
					createdAt: Date.now(),
					updatedAt: Date.now(),
				};
				set((state) => ({
					sessions: {
						...state.sessions,
						[novelId]: [...(state.sessions[novelId] ?? []), newSession],
					},
					activeSessionId: { ...state.activeSessionId, [novelId]: newSession.id },
				}));
				return newSession;
			},

			deleteSession: (novelId, sessionId) =>
				set((state) => {
					const updated = (state.sessions[novelId] ?? []).filter((s) => s.id !== sessionId);
					return {
						sessions: { ...state.sessions, [novelId]: updated },
						activeSessionId: {
							...state.activeSessionId,
							[novelId]: state.activeSessionId[novelId] === sessionId ? null : state.activeSessionId[novelId],
						},
					};
				}),

			addMessage: (novelId, sessionId, message) => {
				const now = Date.now();
				const newMessage: RoleplayMessage = { ...message, id: generateId("rpm"), timestamp: now };
				set((state) => ({
					sessions: {
						...state.sessions,
						[novelId]: (state.sessions[novelId] ?? []).map((s) =>
							s.id === sessionId
								? { ...s, messages: [...s.messages, newMessage], updatedAt: now }
								: s,
						),
					},
				}));
			},

			updateMessage: (novelId, sessionId, messageId, content) =>
				set((state) => ({
					sessions: {
						...state.sessions,
						[novelId]: (state.sessions[novelId] ?? []).map((s) => {
							if (s.id !== sessionId) return s;
							const messages = s.messages.map((m) => {
								if (m.id !== messageId) return m;
								// 内容未变化则不动
								if (m.content === content) return m;
								// 首次编辑：记录原始内容
								const originalContent = m.originalContent ?? m.content;
								return { ...m, content, originalContent };
							});
							return { ...s, messages, updatedAt: Date.now() };
						}),
					},
				})),

			truncateMessagesAfter: (novelId, sessionId, messageId, saveRemoved) =>
				set((state) => ({
					sessions: {
						...state.sessions,
						[novelId]: (state.sessions[novelId] ?? []).map((s) => {
							if (s.id !== sessionId) return s;
							const idx = s.messages.findIndex((m) => m.id === messageId);
							if (idx < 0) return s;
							// 被删除的旧回复链（该消息之后的所有消息）
							const removed = s.messages.slice(idx + 1);
							let messages = s.messages.slice(0, idx + 1);
							if (saveRemoved && removed.length > 0) {
								// 把旧回复链保存到被编辑消息的 originalReplies（首次编辑时保留已有链）
								messages = messages.map((m) =>
									m.id === messageId
										? { ...m, originalReplies: m.originalReplies ?? removed }
										: m,
								);
							}
							return { ...s, messages, updatedAt: Date.now() };
						}),
					},
				})),

			/* 将消息的当前分支状态（内容 + 后续回复链）写入 branches[activeBranch] 的内部辅助 */
			// 说明：messages 列表中该消息之后的所有消息即当前分支的回复链
			editMessageBranch: (novelId, sessionId, messageId, newContent) =>
				set((state) => ({
					sessions: {
						...state.sessions,
						[novelId]: (state.sessions[novelId] ?? []).map((s) => {
							if (s.id !== sessionId) return s;
							const idx = s.messages.findIndex((m) => m.id === messageId);
							if (idx < 0) return s;
							const msg = s.messages[idx];
							const tail = s.messages.slice(idx + 1);
							// 既有分支归档当前激活分支，否则先建档原分支
							const branches = [...(msg.branches ?? [])];
							const activeIdx = msg.activeBranch ?? 0;
							const currentSnapshot = {
								content: msg.content,
								replies: tail,
								createdAt: branches[activeIdx]?.createdAt ?? msg.timestamp,
							};
							if (branches.length === 0) {
								branches.push(currentSnapshot);
							} else {
								branches[activeIdx] = currentSnapshot;
							}
							// 新分支：新内容 + 空回复链（等待 AI 重新生成）
							branches.push({ content: newContent, replies: [], createdAt: Date.now() });
							const newMsg = {
								...msg,
								content: newContent,
								branches,
								activeBranch: branches.length - 1,
							};
							return {
								...s,
								messages: [...s.messages.slice(0, idx), newMsg],
								updatedAt: Date.now(),
							};
						}),
					},
				})),

			regenerateBranch: (novelId, sessionId, messageId, newBranch = true) =>
				set((state) => ({
					sessions: {
						...state.sessions,
						[novelId]: (state.sessions[novelId] ?? []).map((s) => {
							if (s.id !== sessionId) return s;
							const idx = s.messages.findIndex((m) => m.id === messageId);
							if (idx < 0) return s;
							// 原地重新生成：不产生新分支，仅截断后续回复链
							if (!newBranch) {
								return {
									...s,
									messages: s.messages.slice(0, idx + 1),
									updatedAt: Date.now(),
								};
							}
							const msg = s.messages[idx];
							const tail = s.messages.slice(idx + 1);
							const branches = [...(msg.branches ?? [])];
							const activeIdx = msg.activeBranch ?? 0;
							const currentSnapshot = {
								content: msg.content,
								replies: tail,
								createdAt: branches[activeIdx]?.createdAt ?? msg.timestamp,
							};
							if (branches.length === 0) {
								branches.push(currentSnapshot);
							} else {
								branches[activeIdx] = currentSnapshot;
							}
							// 新分支：内容不变 + 空回复链
							branches.push({ content: msg.content, replies: [], createdAt: Date.now() });
							const newMsg = { ...msg, branches, activeBranch: branches.length - 1 };
							return {
								...s,
								messages: [...s.messages.slice(0, idx), newMsg],
								updatedAt: Date.now(),
							};
						}),
					},
				})),

			switchBranch: (novelId, sessionId, messageId, branchIndex) =>
				set((state) => ({
					sessions: {
						...state.sessions,
						[novelId]: (state.sessions[novelId] ?? []).map((s) => {
							if (s.id !== sessionId) return s;
							const idx = s.messages.findIndex((m) => m.id === messageId);
							if (idx < 0) return s;
							const msg = s.messages[idx];
							const branches = [...(msg.branches ?? [])];
							if (branchIndex < 0 || branchIndex >= branches.length) return s;
							const activeIdx = msg.activeBranch ?? 0;
							if (branchIndex === activeIdx) return s;
							// 先把当前激活分支的最新状态（含 AI 已生成的回复）归档
							branches[activeIdx] = {
								content: msg.content,
								replies: s.messages.slice(idx + 1),
								createdAt: branches[activeIdx]?.createdAt ?? msg.timestamp,
							};
							const target = branches[branchIndex];
							const newMsg = { ...msg, content: target.content, branches, activeBranch: branchIndex };
							return {
								...s,
								messages: [...s.messages.slice(0, idx), newMsg, ...target.replies],
								updatedAt: Date.now(),
							};
						}),
					},
				})),

			clearMessages: (novelId, sessionId) =>
				set((state) => ({
					sessions: {
						...state.sessions,
						[novelId]: (state.sessions[novelId] ?? []).map((s) =>
							s.id === sessionId ? { ...s, messages: [], updatedAt: Date.now() } : s,
						),
					},
				})),

			setActiveSession: (novelId, sessionId) =>
				set((state) => ({
					activeSessionId: { ...state.activeSessionId, [novelId]: sessionId },
				})),

			updateSession: (novelId, sessionId, updates) =>
				set((state) => ({
					sessions: {
						...state.sessions,
						[novelId]: (state.sessions[novelId] ?? []).map((s) =>
							s.id === sessionId ? { ...s, ...updates, updatedAt: Date.now() } : s,
						),
					},
				})),

			getSessions: (novelId) => get().sessions[novelId] ?? [],
			getSession: (novelId, sessionId) => get().sessions[novelId]?.find((s) => s.id === sessionId) ?? null,

			clearNovelData: (novelId) =>
				set((state) => {
					const updatedSessions = { ...state.sessions };
					delete updatedSessions[novelId];
					const updatedActive = { ...state.activeSessionId };
					delete updatedActive[novelId];
					return { sessions: updatedSessions, activeSessionId: updatedActive };
				}),

			rebuildStatistics: (validNovelIds) => {
				set((state) => ({
					sessions: filterRecordByKeys(state.sessions, validNovelIds),
					activeSessionId: filterRecordByKeys(state.activeSessionId, validNovelIds),
				}));
			},
		}),
		{
			name: "novel-proofreader-roleplay",
			// v1：会话新增 presentCharacterIds（群聊在场角色列表），旧数据从历史消息扫描重建
			version: 1,
			migrate: (persisted, version) => {
				const state = persisted as {
					sessions?: Record<string, RoleplaySession[]>;
					activeSessionId?: Record<string, string | null>;
				};
				if (version < 1 && state.sessions) {
					for (const list of Object.values(state.sessions)) {
						for (const s of list) {
							if (!Array.isArray(s.presentCharacterIds) || s.presentCharacterIds.length === 0) {
								const ids = new Set<string>([s.characterId]);
								for (const m of s.messages ?? []) {
									if (m.role === "assistant" && m.characterId) ids.add(m.characterId);
								}
								s.presentCharacterIds = [...ids];
							}
						}
					}
				}
				return state;
			},
			partialize: (state) => ({
				sessions: state.sessions,
				activeSessionId: state.activeSessionId,
			}),
		},
	),
);
