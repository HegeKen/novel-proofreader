import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { APIUsage, NovelCategory } from "../types";
import type { ToastMessage } from "../components/Toast";
import { generateId } from "../utils/id";

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

	incrementAPIUsage: (provider: string, success: boolean, inputTokens?: number, outputTokens?: number, duration?: number) => void;
	resetAPIUsage: () => void;

	setNovelCategory: (novelId: string, category: NovelCategory) => void;

	saveReadingProgress: (novelId: string, chapterIndex: number, paragraphIndex: number) => void;
	getReadingProgress: (novelId: string) => {
		currentChapterIndex: number;
		currentParagraphIndex: number;
		readingStartTime: number;
		totalReadingTime: number;
	} | undefined;

	setReadingReminderEnabled: (enabled: boolean) => void;
	setReadingReminderMinutes: (minutes: number) => void;

	showToast: (message: string, type?: ToastMessage["type"], duration?: number) => void;
	hideToast: (id: string) => void;
}

export const useAppMetaStore = create<AppMetaState>()(
	persist(
		(set, get) => ({
			apiUsage: {
				totalRequests: 0,
				successfulRequests: 0,
				failedRequests: 0,
				totalTokens: 0,
				inputTokens: 0,
				outputTokens: 0,
				totalDuration: 0,
				minDuration: 0,
				maxDuration: 0,
				lastReset: Date.now(),
				providerStats: {},
				dailyStats: {},
			},
			novelCategories: {},
			readingProgress: {},
			readingReminderEnabled: true,
			readingReminderMinutes: 30,
			toastMessages: [],

			incrementAPIUsage: (provider, success, inputTokens = 0, outputTokens = 0, duration = 0) =>
				set((state) => {
					const totalTokens = inputTokens + outputTokens;
					const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

					// 确保旧数据兼容（补充缺失字段）
					const currentInputTokens = state.apiUsage.inputTokens || 0;
					const currentOutputTokens = state.apiUsage.outputTokens || 0;
					const currentDailyStats = state.apiUsage.dailyStats || {};
					const currentTotalDuration = state.apiUsage.totalDuration || 0;
					const currentMinDuration = state.apiUsage.minDuration || 0;
					const currentMaxDuration = state.apiUsage.maxDuration || 0;

					// 计算总耗时统计
					const newTotalDuration = currentTotalDuration + duration;
					let newMinDuration = currentMinDuration;
					let newMaxDuration = currentMaxDuration;
					if (duration > 0) {
						newMinDuration = currentMinDuration === 0 ? duration : Math.min(currentMinDuration, duration);
						newMaxDuration = currentMaxDuration === 0 ? duration : Math.max(currentMaxDuration, duration);
					}

					// 更新提供商统计
					const providerStats = { ...state.apiUsage.providerStats };
					const prevProvider = providerStats[provider];
					const prevProviderDuration = prevProvider?.duration || 0;
					const prevProviderMin = prevProvider?.minDuration || 0;
					const prevProviderMax = prevProvider?.maxDuration || 0;
					let newProviderMin = prevProviderMin;
					let newProviderMax = prevProviderMax;
					if (duration > 0) {
						newProviderMin = prevProviderMin === 0 ? duration : Math.min(prevProviderMin, duration);
						newProviderMax = prevProviderMax === 0 ? duration : Math.max(prevProviderMax, duration);
					}
					providerStats[provider] = {
						requests: (prevProvider?.requests || 0) + 1,
						success: (prevProvider?.success || 0) + (success ? 1 : 0),
						failure: (prevProvider?.failure || 0) + (success ? 0 : 1),
						tokens: (prevProvider?.tokens || 0) + totalTokens,
						inputTokens: (prevProvider?.inputTokens || 0) + inputTokens,
						outputTokens: (prevProvider?.outputTokens || 0) + outputTokens,
						duration: prevProviderDuration + duration,
						minDuration: newProviderMin,
						maxDuration: newProviderMax,
					};

					// 更新每日统计
					const dailyStats = { ...currentDailyStats };
					if (!dailyStats[today]) {
						dailyStats[today] = {
							requests: 0,
							success: 0,
							failure: 0,
							inputTokens: 0,
							outputTokens: 0,
							duration: 0,
							minDuration: 0,
							maxDuration: 0,
							providerStats: {},
						};
					}
					const prevDaily = dailyStats[today];
					let newDailyMin = prevDaily.minDuration;
					let newDailyMax = prevDaily.maxDuration;
					if (duration > 0) {
						newDailyMin = prevDaily.minDuration === 0 ? duration : Math.min(prevDaily.minDuration, duration);
						newDailyMax = prevDaily.maxDuration === 0 ? duration : Math.max(prevDaily.maxDuration, duration);
					}
					const prevDailyProvider = prevDaily.providerStats[provider];
					const prevDailyProviderDuration = prevDailyProvider?.duration || 0;
					const prevDailyProviderMin = prevDailyProvider?.minDuration || 0;
					const prevDailyProviderMax = prevDailyProvider?.maxDuration || 0;
					let newDailyProviderMin = prevDailyProviderMin;
					let newDailyProviderMax = prevDailyProviderMax;
					if (duration > 0) {
						newDailyProviderMin = prevDailyProviderMin === 0 ? duration : Math.min(prevDailyProviderMin, duration);
						newDailyProviderMax = prevDailyProviderMax === 0 ? duration : Math.max(prevDailyProviderMax, duration);
					}
					dailyStats[today] = {
						...prevDaily,
						requests: prevDaily.requests + 1,
						success: prevDaily.success + (success ? 1 : 0),
						failure: prevDaily.failure + (success ? 0 : 1),
						inputTokens: prevDaily.inputTokens + inputTokens,
						outputTokens: prevDaily.outputTokens + outputTokens,
						duration: prevDaily.duration + duration,
						minDuration: newDailyMin,
						maxDuration: newDailyMax,
						providerStats: {
							...prevDaily.providerStats,
							[provider]: {
								requests: (prevDailyProvider?.requests || 0) + 1,
								success: (prevDailyProvider?.success || 0) + (success ? 1 : 0),
								failure: (prevDailyProvider?.failure || 0) + (success ? 0 : 1),
								inputTokens: (prevDailyProvider?.inputTokens || 0) + inputTokens,
								outputTokens: (prevDailyProvider?.outputTokens || 0) + outputTokens,
								duration: prevDailyProviderDuration + duration,
								minDuration: newDailyProviderMin,
								maxDuration: newDailyProviderMax,
							},
						},
					};

					return {
						apiUsage: {
							...state.apiUsage,
							totalRequests: state.apiUsage.totalRequests + 1,
							successfulRequests: state.apiUsage.successfulRequests + (success ? 1 : 0),
							failedRequests: state.apiUsage.failedRequests + (success ? 0 : 1),
							totalTokens: state.apiUsage.totalTokens + totalTokens,
							inputTokens: currentInputTokens + inputTokens,
							outputTokens: currentOutputTokens + outputTokens,
							totalDuration: newTotalDuration,
							minDuration: newMinDuration,
							maxDuration: newMaxDuration,
							providerStats,
							dailyStats,
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
						inputTokens: 0,
						outputTokens: 0,
						totalDuration: 0,
						minDuration: 0,
						maxDuration: 0,
						lastReset: Date.now(),
						providerStats: {},
						dailyStats: {},
					},
				}),

			setNovelCategory: (novelId, category) =>
				set((state) => ({
					novelCategories: { ...state.novelCategories, [novelId]: category },
				})),

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

			setReadingReminderEnabled: (enabled) => set({ readingReminderEnabled: enabled }),
			setReadingReminderMinutes: (minutes) => set({ readingReminderMinutes: minutes }),

			showToast: (message, type = "info", duration = 3000) => {
				const id = generateId("toast");
				set((state) => ({
					toastMessages: [...state.toastMessages, { id, type, message, duration }],
				}));
			},

			hideToast: (id) =>
				set((state) => ({
					toastMessages: state.toastMessages.filter((msg) => msg.id !== id),
				})),
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
