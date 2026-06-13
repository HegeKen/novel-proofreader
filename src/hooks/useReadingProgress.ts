import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNovelStore } from "../stores/novelStore";
import { useAppMetaStore } from "../stores/appMetaStore";
import { splitParagraphs } from "../utils/chapterSplit";

export function useReadingProgress() {
	const chapters = useNovelStore((s) => s.chapters);
	const currentChapterIndex = useNovelStore((s) => s.currentChapterIndex);
	const currentNovelId = useNovelStore((s) => s.currentNovelId);
	const saveReadingProgress = useAppMetaStore((s) => s.saveReadingProgress);

	const [currentParagraphIndex, setCurrentParagraphIndex] = useState(0);
	const [readingTimeElapsed, setReadingTimeElapsed] = useState(0);
	const [showReadingReminder, setShowReadingReminder] = useState(false);

	const readingStartTimeRef = useRef<number>(0);
	const readingTimerRef = useRef<number | null>(null);

	const chapter = chapters[currentChapterIndex];

	const totalParagraphs = useMemo(() => {
		return chapters.reduce((acc, ch) => {
			if (!ch) return acc;
			return acc + splitParagraphs(ch.content).filter((p) => p.trim() !== "").length;
		}, 0);
	}, [chapters]);

	const currentGlobalPosition = useMemo(() => {
		let pos = currentParagraphIndex;
		for (let i = 0; i < currentChapterIndex; i++) {
			const ch = chapters[i];
			if (ch) pos += splitParagraphs(ch.content).filter((p) => p.trim() !== "").length;
		}
		return pos;
	}, [currentChapterIndex, currentParagraphIndex, chapters]);

	const currentChapterParagraphs = useMemo(() => {
		if (!chapter) return 0;
		return splitParagraphs(chapter.content).filter((p) => p.trim() !== "").length;
	}, [chapter]);

	const readingProgressPercent = useMemo(() => {
		if (currentChapterParagraphs === 0) return 0;
		return Math.round((currentParagraphIndex / currentChapterParagraphs) * 100);
	}, [currentParagraphIndex, currentChapterParagraphs]);

	const estimatedRemainingMinutes = useMemo(() => {
		if (readingTimeElapsed === 0 || currentGlobalPosition === 0) return 0;
		const paragraphsPerSecond = currentGlobalPosition / (readingTimeElapsed / 1000);
		const remainingParagraphs = totalParagraphs - currentGlobalPosition;
		return Math.round((remainingParagraphs / paragraphsPerSecond) / 60);
	}, [readingTimeElapsed, currentGlobalPosition, totalParagraphs]);

	useEffect(() => {
		queueMicrotask(() => { setCurrentParagraphIndex(0); });
	}, [currentChapterIndex]);

	const startReadingTimer = useCallback((reminderEnabled: boolean, reminderMinutes: number) => {
		readingStartTimeRef.current = Date.now();
		readingTimerRef.current = window.setInterval(() => {
			setReadingTimeElapsed((prev) => {
				const newElapsed = prev + 1000;
				if (reminderEnabled) {
					const minutesElapsed = Math.floor(newElapsed / 60000);
					if (minutesElapsed > 0 && minutesElapsed % reminderMinutes === 0) {
						setShowReadingReminder(true);
					}
				}
				return newElapsed;
			});
		}, 1000);
	}, []);

	const stopReadingTimer = useCallback(() => {
		if (readingTimerRef.current) {
			clearInterval(readingTimerRef.current);
			readingTimerRef.current = null;
		}
	}, []);

	const handleParagraphClick = useCallback((filteredIndex: number) => {
		setCurrentParagraphIndex(filteredIndex);
		if (currentNovelId) {
			saveReadingProgress(currentNovelId, currentChapterIndex, filteredIndex);
		}
	}, [currentNovelId, currentChapterIndex, saveReadingProgress]);

	return {
		currentParagraphIndex,
		setCurrentParagraphIndex,
		readingTimeElapsed,
		setReadingTimeElapsed,
		showReadingReminder,
		setShowReadingReminder,
		totalParagraphs,
		currentGlobalPosition,
		currentChapterParagraphs,
		readingProgressPercent,
		estimatedRemainingMinutes,
		handleParagraphClick,
		startReadingTimer,
		stopReadingTimer,
	};
}
