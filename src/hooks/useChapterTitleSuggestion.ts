import { useState, useCallback } from "react";
import { useNovelStore } from "../stores/novelStore";
import { useCharacterStore } from "../stores/characterStore";
import { useAIConfigStore } from "../stores/aiConfigStore";
import { useUIStore } from "../stores/uiStore";
import { generateChapterTitle } from "../utils/aiClient";
import { isDefaultChapterTitle } from "../utils/chapterSplit";
import { logger } from "../utils/logger";

/** 从大事记中筛选与指定章节相关的事件（按 chapter 字段匹配章节标题，或 timeInfo 提及章节） */
interface ChapterEventRef {
	title: string;
	description: string;
	chapter: string;
	timeInfo: string;
	volume?: string;
}

function filterEventsForChapter(
	events: ChapterEventRef[],
	chapterTitle: string,
): ChapterEventRef[] {
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
			// 收集当前章节前后最近的"有标题"章节（跳过"第X章"默认标题与卷名），作为标题风格参考
			const referenceTitles = new Map<number, string>();
			for (let offset = 1; offset < chapters.length; offset++) {
				if (chapterIndex - offset < 0 && chapterIndex + offset >= chapters.length) break;
				for (const idx of [chapterIndex - offset, chapterIndex + offset]) {
					if (idx < 0 || idx >= chapters.length || referenceTitles.has(idx)) continue;
					const refChapter = chapters[idx];
					if (!refChapter?.title || refChapter.isVolume) continue;
					if (isDefaultChapterTitle(refChapter.title)) continue;
					referenceTitles.set(idx, refChapter.title);
				}
				if (referenceTitles.size >= 8) break;
			}
			// 按章节顺序输出，供 AI 学习已有标题的命名风格
			const previousChapters: Record<string, string> = {};
			[...referenceTitles.entries()]
				.sort((a, b) => a[0] - b[0])
				.forEach(([, title]) => { previousChapters[title] = ""; });
			// 有小说大事记时，同步推送该章节涉及的大事记作为参考
			const allEvents = currentNovelId ? getEvents(currentNovelId) : [];
			const relatedEvents = filterEventsForChapter(
				allEvents.map((evt) => ({
					title: evt.title,
					description: evt.description,
					chapter: evt.chapter,
					timeInfo: evt.timeInfo,
					volume: evt.volume,
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
			useUIStore.getState().showToast("生成章节名失败，请检查AI配置", "error");
			// 失败时清除加载状态；成功时保留 suggestingChapterId，供面板显示候选标题弹窗
			setSuggestingChapterId(null);
			setChapterTitleSuggestions(prev => {
				const next = { ...prev };
				delete next[chapterId];
				return next;
			});
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
