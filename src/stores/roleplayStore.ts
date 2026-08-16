// ============================================================
// 角色扮演会话 Store — 按小说管理会话与消息，持久化到本地
// ============================================================
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { RoleplayMessage, RoleplaySession } from "../types";
import { generateId, filterRecordByKeys } from "../utils/id";

export interface RoleplayState {
	/** 每部小说的会话列表（key 为 novelId） */
	sessions: Record<string, RoleplaySession[]>;
	/** 每部小说当前激活的会话 ID（key 为 novelId） */
	activeSessionId: Record<string, string | null>;

	createSession: (
		novelId: string,
		session: Pick<RoleplaySession, "characterId" | "chapterIndex" | "title" | "userCharacterId">,
	) => RoleplaySession;
	deleteSession: (novelId: string, sessionId: string) => void;
	addMessage: (
		novelId: string,
		sessionId: string,
		message: Omit<RoleplayMessage, "id" | "timestamp">,
	) => void;
	clearMessages: (novelId: string, sessionId: string) => void;
	setActiveSession: (novelId: string, sessionId: string | null) => void;
	updateSession: (
		novelId: string,
		sessionId: string,
		updates: Partial<Pick<RoleplaySession, "characterId" | "chapterIndex" | "title" | "userCharacterId">>,
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
			partialize: (state) => ({
				sessions: state.sessions,
				activeSessionId: state.activeSessionId,
			}),
		},
	),
);
