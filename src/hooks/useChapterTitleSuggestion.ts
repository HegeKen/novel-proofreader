import { useState, useCallback } from "react";
import { useNovelStore } from "../stores/novelStore";
import { useCharacterStore } from "../stores/characterStore";
import { useAIConfigStore } from "../stores/aiConfigStore";
import { useAppMetaStore } from "../stores/appMetaStore";
import { generateChapterTitle } from "../utils/aiClient";
import { logger } from "../utils/logger";

/** 从大事记中筛选与指定章节相关的事件（按 chapter 字段匹配章节标题，或 timeInfo 提及章节） */
function filterEventsForChapter(
	events: Array<{ title: string; description: string; chapter: string; timeInfo: string }>,
	chapterTitle: string,
): Array<{ title: string; description: string; chapter: string; timeInfo: string }> {
	const title = chapterTitle?.trim();
	if (!title) return [];
	const titleKey = title.replace(/\s+/g, "").toLowerCase();
	return events.filter((evt) => {
		const evtChapter = (evt.chapter || "").replace(/\s+/g, "").toLowerCase();
		// chapter 字段匹配章节标题（含"第X章"等形式）
		if (evtChapter && (evtChapter.includes(titleKey) || titleKey.includes(evtChapter))) return true;
		// timeInfo 中提及章节（如"第一章""第1章"）
		const timeInfo = (evt.timeInfo || "").replace(/\s+/g, "").toLowerCase();
		if (timeInfo && (timeInfo.includes(titleKey) || titleKey.includes(timeInfo))) return true;
		return false;
	});
}

export function useChapterTitleSuggestion() {
	const chapters = useNovelStore((s) => s.chapters);
	const currentNovelId = useNovelStore((s) => s.currentNovelId);
	const getEvents = useCharacterStore((s) => s.getEvents);
	const aiConfig = useAIConfigStore((s) => s.aiConfig);
	const setChapters = useNovelStore((s) => s.setChapters);

	const [suggestingChapterId, setSuggestingChapterId] = useState<number | null>(null);
	const [chapterTitleSuggestions, setChapterTitleSuggestions] = useState<Record<number, string[]>>({});

	const handleSuggestChapterTitle = useCallback(async (chapterId: number, chapterIndex: number) => {
		if (suggestingChapterId === chapterId) return;
		const chapter = chapters.find(ch => ch.id === chapterId);
		if (!chapter) return;

		setSuggestingChapterId(chapterId);
		setChapterTitleSuggestions(prev => ({ ...prev, [chapterId]: [] }));

		try {
			const previousChapters: Record<string, string> = {};
			for (let i = Math.max(0, chapterIndex - 5); i < chapterIndex; i++) {
				const prevChapter = chapters[i];
				if (prevChapter?.title) previousChapters[prevChapter.title] = prevChapter.content.slice(0, 200);
			}
			// 有小说大事记时，同步推送该章节涉及的大事记作为参考
			const allEvents = currentNovelId ? getEvents(currentNovelId) : [];
			const relatedEvents = filterEventsForChapter(
				allEvents.map((evt) => ({
					title: evt.title,
					description: evt.description,
					chapter: evt.chapter,
					timeInfo: evt.timeInfo,
				})),
				chapter.title,
			);
			const suggestions = await generateChapterTitle(
				chapter.content,
				previousChapters,
				chapterIndex + 1,
				aiConfig,
				undefined,
				relatedEvents,
			);
			setChapterTitleSuggestions(prev => ({ ...prev, [chapterId]: suggestions }));
		} catch (error) {
			logger.errorGeneric('Failed to generate chapter title:', error);
			useAppMetaStore.getState().showToast("生成章节名失败，请检查AI配置", "error");
		} finally {
			setSuggestingChapterId(null);
		}
	}, [chapters, currentNovelId, getEvents, aiConfig, suggestingChapterId]);

	const handleApplyChapterTitle = useCallback((chapterId: number, title: string) => {
		const chapterIndexInChapters = chapters.findIndex(ch => ch.id === chapterId);
		if (chapterIndexInChapters < 0) return;
		const chapter = chapters[chapterIndexInChapters];
		const newTitle = chapter.title ? `${chapter.title} ${title}` : title;
		const newContent = chapter.title ? chapter.content.replace(chapter.title, newTitle) : chapter.content;
		const updatedChapters = [...chapters];
		updatedChapters[chapterIndexInChapters] = { ...chapter, title: newTitle, content: newContent };
		setChapters(updatedChapters);
		// 采纳后立即保存，防止标题丢失
		useNovelStore.getState().saveCurrentNovel();
		setChapterTitleSuggestions(prev => { const n = { ...prev }; delete n[chapterId]; return n; });
		setSuggestingChapterId(null);
	}, [chapters, setChapters]);

	const handleCloseSuggestions = useCallback((chapterId: number) => {
		setChapterTitleSuggestions(prev => { const n = { ...prev }; delete n[chapterId]; return n; });
		setSuggestingChapterId(null);
	}, []);

	return {
		suggestingChapterId,
		chapterTitleSuggestions,
		handleSuggestChapterTitle,
		handleApplyChapterTitle,
		handleCloseSuggestions,
	};
}
