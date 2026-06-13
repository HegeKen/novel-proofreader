import { useState, useCallback } from "react";
import { useNovelStore } from "../stores/novelStore";
import { useAIConfigStore } from "../stores/aiConfigStore";
import { generateChapterTitle } from "../utils/aiClient";
import { logger } from "../utils/logger";

export function useChapterTitleSuggestion() {
	const chapters = useNovelStore((s) => s.chapters);
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
			const suggestions = await generateChapterTitle(chapter.content, previousChapters, chapterIndex + 1, aiConfig);
			setChapterTitleSuggestions(prev => ({ ...prev, [chapterId]: suggestions }));
		} catch (error) {
			logger.errorGeneric('Failed to generate chapter title:', error);
		} finally {
			setSuggestingChapterId(null);
		}
	}, [chapters, aiConfig, suggestingChapterId]);

	const handleApplyChapterTitle = useCallback((chapterId: number, title: string) => {
		const chapterIndexInChapters = chapters.findIndex(ch => ch.id === chapterId);
		if (chapterIndexInChapters < 0) return;
		const chapter = chapters[chapterIndexInChapters];
		const newTitle = chapter.title ? `${chapter.title} ${title}` : title;
		const newContent = chapter.title ? chapter.content.replace(chapter.title, newTitle) : chapter.content;
		const updatedChapters = [...chapters];
		updatedChapters[chapterIndexInChapters] = { ...chapter, title: newTitle, content: newContent };
		setChapters(updatedChapters);
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
