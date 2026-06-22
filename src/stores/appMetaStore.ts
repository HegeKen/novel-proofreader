import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { APIUsage, NovelCategory } from "../types";
import type { ToastMessage } from "../components/Toast";

export interface AppMetaState {
	apiUsage: APIUsage;
	novelCategories: Record<string, NovelCategory>;
	readingProgress: Record<string, {
		currentChapterIndex: number;
		currentParagraphIndex: number;
		readingStartTime: number;
		totalReadingTime: number;
	}>;
	readingReminderEnabled: boolean;
	readingReminderMinutes: number;
	toastMessages: ToastMessage[];

	incrementAPIUsage: (provider: string, success: boolean, tokens?: number) => void;
	resetAPIUsage: () => void;

	setNovelCategory: (novelId: string, category: NovelCategory) => void;
	getNovelCategory: (novelId: string) => NovelCategory | undefined;

	saveReadingProgress: (novelId: string, chapterIndex: number, paragraphIndex: number) => void;
	getReadingProgress: (novelId: string) => {
		currentChapterIndex: number;
		currentParagraphIndex: number;
		readingStartTime: number;
		totalReadingTime: number;
	} | undefined;
	updateReadingTime: (novelId: string, elapsedTime: number) => void;

	setReadingReminderEnabled: (enabled: boolean) => void;
	setReadingReminderMinutes: (minutes: number) => void;

	showToast: (message: string, type?: ToastMessage["type"], duration?: number) => void;
	hideToast: (id: string) => void;
	clearToasts: () => void;
}

export const useAppMetaStore = create<AppMetaState>()(
	persist(
		(set, get) => ({
			apiUsage: {
				totalRequests: 0,
				successfulRequests: 0,
				failedRequests: 0,
				totalTokens: 0,
				lastReset: Date.now(),
				providerStats: {},
			},
			novelCategories: {},
			readingProgress: {},
			readingReminderEnabled: true,
			readingReminderMinutes: 30,
			toastMessages: [],

			incrementAPIUsage: (provider, success, tokens = 0) =>
				set((state) => {
					const providerStats = { ...state.apiUsage.providerStats };
					providerStats[provider] = {
						requests: (providerStats[provider]?.requests || 0) + 1,
						success: (providerStats[provider]?.success || 0) + (success ? 1 : 0),
						failure: (providerStats[provider]?.failure || 0) + (success ? 0 : 1),
						tokens: (providerStats[provider]?.tokens || 0) + tokens,
					};
					return {
						apiUsage: {
							...state.apiUsage,
							totalRequests: state.apiUsage.totalRequests + 1,
							successfulRequests: state.apiUsage.successfulRequests + (success ? 1 : 0),
							failedRequests: state.apiUsage.failedRequests + (success ? 0 : 1),
							totalTokens: state.apiUsage.totalTokens + tokens,
							providerStats,
						},
					};
				}),

			resetAPIUsage: () =>
				set({
					apiUsage: {
						totalRequests: 0,
						successfulRequests: 0,
						failedRequests: 0,
						totalTokens: 0,
						lastReset: Date.now(),
						providerStats: {},
					},
				}),

			setNovelCategory: (novelId, category) =>
				set((state) => ({
					novelCategories: { ...state.novelCategories, [novelId]: category },
				})),

			getNovelCategory: (novelId) => get().novelCategories[novelId],

			saveReadingProgress: (novelId, chapterIndex, paragraphIndex) =>
				set((state) => ({
					readingProgress: {
						...state.readingProgress,
						[novelId]: {
							...state.readingProgress[novelId],
							currentChapterIndex: chapterIndex,
							currentParagraphIndex: paragraphIndex,
							readingStartTime: Date.now(),
						},
					},
				})),

			getReadingProgress: (novelId) => get().readingProgress[novelId],

			updateReadingTime: (novelId, elapsedTime) =>
				set((state) => ({
					readingProgress: {
						...state.readingProgress,
						[novelId]: {
							...state.readingProgress[novelId],
							totalReadingTime: (state.readingProgress[novelId]?.totalReadingTime || 0) + elapsedTime,
						},
					},
				})),

			setReadingReminderEnabled: (enabled) => set({ readingReminderEnabled: enabled }),
			setReadingReminderMinutes: (minutes) => set({ readingReminderMinutes: minutes }),

			showToast: (message, type = "info", duration = 3000) => {
				const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
				set((state) => ({
					toastMessages: [...state.toastMessages, { id, type, message, duration }],
				}));
			},

			hideToast: (id) =>
				set((state) => ({
					toastMessages: state.toastMessages.filter((msg) => msg.id !== id),
				})),

			clearToasts: () => set({ toastMessages: [] }),
		}),
		{
			name: "novel-proofreader-meta",
			partialize: (state) => ({
				apiUsage: state.apiUsage,
				novelCategories: state.novelCategories,
				readingProgress: state.readingProgress,
				readingReminderEnabled: state.readingReminderEnabled,
				readingReminderMinutes: state.readingReminderMinutes,
			}),
		},
	),
);
