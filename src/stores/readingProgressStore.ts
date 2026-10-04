// ============================================================
// 阅读进度与阅读提醒状态管理
// ============================================================
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ReadingProgressEntry {
	currentChapterIndex: number;
	currentParagraphIndex: number;
	readingStartTime: number;
	totalReadingTime: number;
}

interface ReadingProgressState {
	readingProgress: Record<string, ReadingProgressEntry>;
	readingReminderEnabled: boolean;
	readingReminderMinutes: number;

	saveReadingProgress: (novelId: string, chapterIndex: number, paragraphIndex: number) => void;
	getReadingProgress: (novelId: string) => ReadingProgressEntry | undefined;
	setReadingReminderEnabled: (enabled: boolean) => void;
	setReadingReminderMinutes: (minutes: number) => void;
}

// 从旧版 appMetaStore（persist key: novel-proofreader-meta）一次性迁移阅读数据。
// persist 默认浅合并：新 key 已有数据时以新数据为准，无数据时保留此处的迁移值。
function loadLegacyState(): Partial<Pick<ReadingProgressState, "readingProgress" | "readingReminderEnabled" | "readingReminderMinutes">> {
	try {
		const raw = localStorage.getItem("novel-proofreader-meta");
		if (!raw) return {};
		const state = JSON.parse(raw)?.state;
		if (!state) return {};
		return {
			readingProgress: state.readingProgress,
			readingReminderEnabled: state.readingReminderEnabled,
			readingReminderMinutes: state.readingReminderMinutes,
		};
	} catch {
		return {};
	}
}

const legacy = loadLegacyState();

export const useReadingProgressStore = create<ReadingProgressState>()(
	persist(
		(set, get) => ({
			readingProgress: legacy.readingProgress ?? {},
			readingReminderEnabled: legacy.readingReminderEnabled ?? true,
			readingReminderMinutes: legacy.readingReminderMinutes ?? 30,

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
		}),
		{
			name: "novel-proofreader-reading",
		},
	),
);
