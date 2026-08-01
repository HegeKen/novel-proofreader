import React, { useState, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useCharacterStore } from "../stores/characterStore";
import { useNovelStore } from "../stores/novelStore";
import type { NovelEvent } from "../types";
import { Icons } from "./Icons";
import { useAppMetaStore } from "../stores/appMetaStore";
import { generateNovelEvents, sendChatCompletion } from "../utils/aiClient";
import { useAIConfigStore } from "../stores/aiConfigStore";
import { logger } from "../utils/logger";

interface NovelEventModalProps {
	novelId: string | null;
	show: boolean;
	onClose: () => void;
}

interface EventFormData {
	title: string;
	description: string;
	timeOrder: number;
	chapterOrder: number;
	timeInfo: string;
	chapter: string;
	involvedCharacterIds: string[];
}

const emptyForm: EventFormData = {
	title: "",
	description: "",
	timeOrder: 1,
	chapterOrder: 1,
	timeInfo: "",
	chapter: "",
	involvedCharacterIds: [],
};

export const NovelEventModal: React.FC<NovelEventModalProps> = ({ novelId, show, onClose }) => {
	const novelEventsMap = useCharacterStore((s) => s.novelEvents);
	const storeEvents = useMemo(() => (novelId ? novelEventsMap[novelId] ?? [] : []), [novelEventsMap, novelId]);
	const addEvent = useCharacterStore((s) => s.addEvent);
	const updateEvent = useCharacterStore((s) => s.updateEvent);
	const removeEvent = useCharacterStore((s) => s.removeEvent);
	const novelCharactersMap = useCharacterStore((s) => s.novelCharacters);
	const characters = useMemo(() => (novelId ? novelCharactersMap[novelId] ?? [] : []), [novelCharactersMap, novelId]);

	const chapters = useNovelStore((s) => s.chapters);
	const aiConfig = useAIConfigStore((s) => s.aiConfig);

	const [editingId, setEditingId] = useState<string | null>(null);
	const [formData, setFormData] = useState<EventFormData>(emptyForm);
	const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
	const [isGenerating, setIsGenerating] = useState(false);
	const [generationProgress, setGenerationProgress] = useState({ current: 0, total: 1 });
	const [generationPhase, setGenerationPhase] = useState<string>("");
	const [generationStatus, setGenerationStatus] = useState<"success" | "error" | "info" | null>(null);
	const [generationMessage, setGenerationMessage] = useState("");

	const [isCompletingMode, setIsCompletingMode] = useState(false);
	const [selectedChapterIds, setSelectedChapterIds] = useState<Set<number>>(new Set());

	type SortMode = 'chapter' | 'time';
	const [sortMode, setSortMode] = useState<SortMode>('chapter');

	const chineseNumMap: Record<string, number> = {
		'零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4,
		'五': 5, '六': 6, '七': 7, '八': 8, '九': 9,
	};
	const unitMap: Record<string, number> = {
		'十': 10, '百': 100, '千': 1000, '万': 10000, '亿': 100000000
	};

	const chineseToArabic = (str: string): string => {
		if (!str) return str;

		let total = 0;
		let section = 0;
		let current = 0;
		let hasDigit = false;

		for (let i = 0; i < str.length; i++) {
			const char = str[i];

			if (chineseNumMap[char] !== undefined) {
				current = chineseNumMap[char];
				hasDigit = true;
			} else if (unitMap[char] !== undefined) {
				const unitVal = unitMap[char];
				if (unitVal >= 10000) {
					if (current === 0 && !hasDigit) current = 1;
					section = (section + current) * unitVal;
					total += section;
					section = 0;
					current = 0;
					hasDigit = false;
				} else {
					if (current === 0 && !hasDigit && char === '十') current = 1;
					section += current * unitVal;
					current = 0;
				}
			} else {
				return str;
			}
		}

		total += section + current;
		return total.toString();
	};

	const normalizeChapterTitle = useCallback((title: string): string => {
		if (!title) return title;
		
		let normalized = title;
		
		if (/第[零一二三四五六七八九十百千万\d]+[章节回卷]/.test(title)) {
			normalized = title.replace(/第([零一二三四五六七八九十百千万\d]+)([章节回卷])/g, (_, num, suffix) => {
				const arabicNum = chineseToArabic(num);
				const unifiedNum = parseInt(arabicNum, 10).toString();
				return `第${unifiedNum}${suffix}`;
			});
		}
		
		return normalized;
	}, []);

	const parseChapterInfo = useCallback((chapterStr: string): { volumeNum: number; chapterNum: number; volumeName: string; chapterName: string } => {
		if (!chapterStr) return { volumeNum: 0, chapterNum: 0, volumeName: "", chapterName: "" };
		
		let volumeNum = 0;
		let chapterNum = 0;
		let volumeName = "";
		let chapterName = "";
		
		const numPattern = '[零一二三四五六七八九十百千万\\d]+';
		
		const dotIndex = chapterStr.indexOf("·");
		if (dotIndex > 0) {
			const part1 = chapterStr.slice(0, dotIndex).trim();
			const part2 = chapterStr.slice(dotIndex + 1).trim();
			
			const volumeMatch = part1.match(new RegExp(`第(${numPattern})卷`));
			if (volumeMatch) {
				volumeNum = parseInt(chineseToArabic(volumeMatch[1]), 10) || 0;
				volumeName = part1;
			} else {
				const chapterMatch = part1.match(new RegExp(`第(${numPattern})[章节回]`));
				if (chapterMatch) {
					chapterNum = parseInt(chineseToArabic(chapterMatch[1]), 10) || 0;
					chapterName = part1;
				}
			}
			
			const chapterMatch2 = part2.match(new RegExp(`第(${numPattern})[章节回]`));
			if (chapterMatch2) {
				chapterNum = parseInt(chineseToArabic(chapterMatch2[1]), 10) || 0;
				chapterName = part2;
			} else if (!chapterName) {
				chapterName = part2;
			}
			
			if (!volumeName) {
				volumeName = part1;
			}
		} else {
			const volumeMatch = chapterStr.match(new RegExp(`第(${numPattern})卷`));
			const chapterMatch = chapterStr.match(new RegExp(`第(${numPattern})[章节回]`));
			
			if (volumeMatch) {
				volumeNum = parseInt(chineseToArabic(volumeMatch[1]), 10) || 0;
				volumeName = chapterStr;
			}
			if (chapterMatch) {
				chapterNum = parseInt(chineseToArabic(chapterMatch[1]), 10) || 0;
				chapterName = chapterStr;
			}
		}
		
		return { volumeNum, chapterNum, volumeName, chapterName };
	}, []);

	const getChapterOrder = useCallback((event: NovelEvent): number => {
		if (!event.chapter) return Infinity;
		
		const chapterInfo = parseChapterInfo(event.chapter);
		const normalizedSearch = normalizeChapterTitle(event.chapter);
		
		const nonVolumeChapters = chapters.filter(ch => !ch.isVolume);
		
		let matchedChapter = nonVolumeChapters.find(ch => {
			const normalizedChapter = normalizeChapterTitle(ch.title);
			
			if (ch.title === event.chapter) return true;
			if (normalizedChapter === normalizedSearch) return true;
			
			const chInfo = parseChapterInfo(ch.title);
			
			if (chapterInfo.volumeNum > 0 && chapterInfo.chapterNum > 0) {
				if (chInfo.volumeNum > 0 && chInfo.chapterNum > 0) {
					if (chapterInfo.volumeNum === chInfo.volumeNum && chapterInfo.chapterNum === chInfo.chapterNum) {
						return true;
					}
				}
			}
			
			const searchTitle = event.chapter;
			if (searchTitle.length >= 3 && ch.title.includes(searchTitle)) return true;
			if (searchTitle.length >= 3 && normalizedChapter.includes(normalizedSearch)) return true;
			if (searchTitle.length >= 3 && searchTitle.includes(ch.title)) return true;
			
			if (chapterInfo.chapterName && ch.title.includes(chapterInfo.chapterName)) return true;
			if (chapterInfo.chapterNum > 0) {
				const chapterPattern = new RegExp(`第${chapterInfo.chapterNum}[章节回]`);
				if (chapterPattern.test(ch.title)) return true;
			}
			
			return false;
		});
		
		if (!matchedChapter && chapterInfo.chapterNum > 0) {
			matchedChapter = nonVolumeChapters.find(ch => {
				const chInfo = parseChapterInfo(ch.title);
				if (chInfo.chapterNum === chapterInfo.chapterNum) {
					if (chapterInfo.volumeNum > 0 && chInfo.volumeNum > 0) {
						return chapterInfo.volumeNum === chInfo.volumeNum;
					}
					return true;
				}
				return false;
			});
		}
		
		if (!matchedChapter) return Infinity;
		
		return matchedChapter.startIndex;
	}, [chapters, normalizeChapterTitle, parseChapterInfo]);

	const sortedEvents = useMemo(() => {
		const events = [...storeEvents];
		
		if (sortMode === 'chapter') {
			return events.sort((a, b) => a.chapterOrder - b.chapterOrder);
		}
		
		return events.sort((a, b) => a.timeOrder - b.timeOrder);
	}, [storeEvents, sortMode]);

	const getVolumeForChapter = useCallback((chapterTitle: string): string | null => {
		if (!chapterTitle) return null;
		
		let searchTitle = chapterTitle;
		const dotIndex = chapterTitle.indexOf("·");
		if (dotIndex > 0) {
			searchTitle = chapterTitle.slice(dotIndex + 1).trim();
		}
		
		const normalizedSearch = normalizeChapterTitle(searchTitle);
		
		let chapter = chapters.find(ch => 
			!ch.isVolume && 
			(ch.title === searchTitle || normalizeChapterTitle(ch.title) === normalizedSearch)
		);
		
		if (!chapter && searchTitle.length >= 4) {
			chapter = chapters.find(ch => 
				!ch.isVolume && 
				(ch.title.includes(searchTitle) || normalizeChapterTitle(ch.title).includes(normalizedSearch))
			);
		}
		
		if (!chapter && searchTitle.length >= 4) {
			chapter = chapters.find(ch => 
				!ch.isVolume && 
				(searchTitle.includes(ch.title) || normalizedSearch.includes(normalizeChapterTitle(ch.title)))
			);
		}
		
		if (!chapter?.parentId) return null;
		const volume = chapters.find(ch => ch.id === chapter.parentId && ch.isVolume);
		return volume?.title || null;
	}, [chapters, normalizeChapterTitle]);

	const getUncoveredChapters = useMemo(() => {
		const nonBodyKeywords = [
			"前言", "序章", "序", "自序", "引言", "楔子","外传", "附录", "目录",
			"版权声明", "作者简介", "题记", "献辞", "致谢","再版序", "重版序",
			"译序", "前言一", "前言二","序一", "序二", "序三", "写在前面", "编者按",
			"导读", "说明", "序言", "代序", "跋"
		];

		const isNonBodyContent = (title: string): boolean => {
			return nonBodyKeywords.some(keyword => title.includes(keyword));
		};

		const nonVolumeChapters = chapters.filter(ch => !ch.isVolume && !isNonBodyContent(ch.title));
		if (nonVolumeChapters.length === 0) return [];

		const coveredChapterIds = new Set<number>();
		
		for (const event of storeEvents) {
			if (!event.chapter) continue;
			
			let searchTitle = event.chapter;
			const dotIndex = event.chapter.indexOf("·");
			if (dotIndex > 0) {
				searchTitle = event.chapter.slice(dotIndex + 1).trim();
			}
			
			const normalizedSearch = normalizeChapterTitle(searchTitle);
			
			const matchedChapter = nonVolumeChapters.find(ch => {
				const normalizedChapter = normalizeChapterTitle(ch.title);
				return ch.title === searchTitle || 
					   normalizedChapter === normalizedSearch ||
					   (searchTitle.length >= 4 && ch.title.includes(searchTitle)) ||
					   (searchTitle.length >= 4 && normalizedChapter.includes(normalizedSearch)) ||
					   (searchTitle.length >= 4 && searchTitle.includes(ch.title)) ||
					   (searchTitle.length >= 4 && normalizedSearch.includes(normalizedChapter));
			});
			
			if (matchedChapter) {
				coveredChapterIds.add(matchedChapter.id);
			}
		}
		
		return nonVolumeChapters.filter(ch => !coveredChapterIds.has(ch.id));
	}, [chapters, storeEvents, normalizeChapterTitle]);

	const handleAdd = useCallback(() => {
		setEditingId("__new__");
		const nextTimeOrder = sortedEvents.length > 0 ? Math.max(...sortedEvents.map((e) => e.timeOrder)) + 1 : 1;
		const nextChapterOrder = sortedEvents.length > 0 ? Math.max(...sortedEvents.map((e) => e.chapterOrder)) + 1 : 1;
		setFormData({ title: "", description: "", timeOrder: nextTimeOrder, chapterOrder: nextChapterOrder, timeInfo: "", chapter: "", involvedCharacterIds: [] });
	}, [sortedEvents]);

	const handleEdit = useCallback((evt: NovelEvent) => {
		setEditingId(evt.id);
		setFormData({
			title: evt.title,
			description: evt.description,
			timeOrder: evt.timeOrder,
			chapterOrder: evt.chapterOrder,
			timeInfo: evt.timeInfo,
			chapter: evt.chapter,
			involvedCharacterIds: [...evt.involvedCharacterIds],
		});
	}, []);

	const handleCancelEdit = useCallback(() => {
		setEditingId(null);
		setFormData(emptyForm);
	}, []);

	const handleSave = useCallback(() => {
		if (!novelId) return;
		if (!formData.title.trim()) {
			useAppMetaStore.getState().showToast("请输入事件标题", "warning");
			return;
		}
		if (editingId === "__new__") {
			addEvent(novelId, formData);
		} else if (editingId) {
			updateEvent(novelId, editingId, formData);
		}
		setEditingId(null);
		setFormData(emptyForm);
		useAppMetaStore.getState().showToast(
			editingId === "__new__" ? "大事记已添加" : "大事记已更新",
			"success",
		);
	}, [novelId, editingId, formData, addEvent, updateEvent]);

	const handleDelete = useCallback(
		(eventId: string) => {
			if (!novelId) return;
			removeEvent(novelId, eventId);
			setShowDeleteConfirm(null);
			useAppMetaStore.getState().showToast("大事记已删除", "success");
		},
		[novelId, removeEvent],
	);

	const toggleCharacter = useCallback((charId: string) => {
		setFormData((prev) => ({
			...prev,
			involvedCharacterIds: prev.involvedCharacterIds.includes(charId)
				? prev.involvedCharacterIds.filter((id) => id !== charId)
				: [...prev.involvedCharacterIds, charId],
		}));
	}, []);

	const handleCompleteChapters = useCallback(async () => {
		if (!novelId || selectedChapterIds.size === 0 || isGenerating) return;

		setIsGenerating(true);
		setGenerationProgress({ current: 0, total: selectedChapterIds.size });
		setGenerationPhase("补全分析中");
		setGenerationStatus("info");
		setGenerationMessage(`正在分析选中的 ${selectedChapterIds.size} 个章节...`);
		logger.proofread(`[NovelEventModal] 开始补全 ${selectedChapterIds.size} 个章节的大事记`);

		try {
			const selectedChapters = chapters.filter(ch => selectedChapterIds.has(ch.id) && !ch.isVolume);
			
			const novelContent = selectedChapters.map((ch) => {
				const volume = chapters.find(v => v.id === ch.parentId && v.isVolume);
				return volume 
					? `【${volume.title}】${ch.title}\n${ch.content}`
					: `${ch.title}\n${ch.content}`;
			}).join("\n\n");

			const characterNames = characters.map((ch) => ch.name).join("、");

			const existingEventsForAI = storeEvents.map(evt => ({
				title: evt.title,
				description: evt.description,
				timeOrder: evt.timeOrder,
				chapterOrder: evt.chapterOrder,
				chapter: evt.chapter,
				timeInfo: evt.timeInfo,
			}));

			const result = await generateNovelEvents(
				novelContent,
				characterNames,
				aiConfig,
				(current, total, phase) => {
					const phaseText = phase === "analyze" ? "补全分析中" : "合并中";
					setGenerationProgress({ current, total });
					setGenerationPhase(phaseText);
					setGenerationMessage(`${phaseText} ${current}/${total}`);
				},
				true,
				existingEventsForAI
			);

			if (!result || !Array.isArray(result.events) || result.events.length === 0) {
				setGenerationStatus("error");
				setGenerationMessage("未生成任何事件，请重试");
				return;
			}

			const existingEvents = [...storeEvents];
			const newEvents: NovelEvent[] = [];

			for (let i = 0; i < result.events.length; i++) {
				const evt = result.events[i];
				if (!evt.title) continue;

				const involvedCharacterIds: string[] = [];
				if (evt.involvedCharacterNames && Array.isArray(evt.involvedCharacterNames)) {
					for (const charName of evt.involvedCharacterNames) {
						const matchedChar = characters.find((ch) =>
							ch.name.includes(charName) || charName.includes(ch.name)
						);
						if (matchedChar) {
							involvedCharacterIds.push(matchedChar.id);
						}
					}
				}

				newEvents.push({
					title: evt.title,
					description: evt.description || "",
					timeOrder: evt.timeOrder || i + 1,
					chapterOrder: evt.chapterOrder || i + 1,
					timeInfo: evt.timeInfo || "",
					chapter: evt.chapter || "",
					involvedCharacterIds,
					id: `evt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
				});
			}

			if (newEvents.length === 0) {
				setGenerationStatus("error");
				setGenerationMessage("未生成任何有效事件");
				return;
			}

			const allEvents = [...existingEvents, ...newEvents];

			const sortedAllEvents = [...allEvents].sort((a, b) => {
				const orderA = getChapterOrder(a);
				const orderB = getChapterOrder(b);
				if (orderA !== orderB) return orderA - orderB;
				return a.timeOrder - b.timeOrder;
			});

			sortedAllEvents.forEach((evt, idx) => {
				evt.chapterOrder = idx + 1;
			});

			const setEvents = useCharacterStore.getState().setEvents;
			setEvents(novelId, sortedAllEvents);

			setGenerationStatus("success");
			setGenerationMessage(`成功补全 ${newEvents.length} 个大事记`);
			logger.proofread(`[NovelEventModal] 补全成功，添加了 ${newEvents.length} 个事件`);

			setIsCompletingMode(false);
			setSelectedChapterIds(new Set());
		} catch (err) {
			logger.errorGeneric("[NovelEventModal] 补全失败:", err);
			const errorMessage = err instanceof Error ? err.message : "补全失败";
			let message: string;
			if (errorMessage.includes("网络") || errorMessage.includes("network") || errorMessage.includes("fetch")) {
				message = "补全失败，请检查网络连接";
			} else if (errorMessage.includes("配置")) {
				message = "补全失败，请检查 AI 配置";
			} else if (errorMessage.includes("401")) {
				message = "补全失败，API Key 无效";
			} else if (errorMessage.includes("402")) {
				message = "补全失败，账户余额不足";
			} else if (errorMessage.includes("429")) {
				message = "补全失败，请求频率超限，请稍后重试";
			} else {
				message = `补全失败：${errorMessage.slice(0, 50)}`;
			}
			setGenerationStatus("error");
			setGenerationMessage(message);
		} finally {
			setIsGenerating(false);
		}
	}, [novelId, selectedChapterIds, chapters, characters, aiConfig, storeEvents, isGenerating]);

	const handleGenerateWithAI = useCallback(async () => {
		if (!novelId || !chapters.length || isGenerating) return;

		if (storeEvents.length > 0) {
			const confirmed = window.confirm(`当前已有 ${storeEvents.length} 个大事记，重新生成将清除所有现有记录，确定继续吗？`);
			if (!confirmed) {
				return;
			}
			
			const setEvents = useCharacterStore.getState().setEvents;
			setEvents(novelId, []);
		}

		setIsGenerating(true);
		setGenerationProgress({ current: 0, total: 1 });
		setGenerationPhase("分析中");
		setGenerationStatus("info");
		setGenerationMessage("正在分析小说内容生成大事记...");
		logger.proofread("[NovelEventModal] 开始 AI 生成大事记");

		try {
			const novelContent = chapters.map((ch) => {
				if (ch.isVolume) {
					return `【分卷】${ch.title}\n${ch.content}`;
				}
				const volume = chapters.find(v => v.id === ch.parentId && v.isVolume);
				return volume 
					? `【${volume.title}】${ch.title}\n${ch.content}`
					: `${ch.title}\n${ch.content}`;
			}).join("\n\n");
			const characterNames = characters.map((ch) => ch.name).join("、");

			const result = await generateNovelEvents(
				novelContent,
				characterNames,
				aiConfig,
				(current, total, phase) => {
					const phaseText = phase === "analyze" ? "分析中" : "合并中";
					setGenerationProgress({ current, total });
					setGenerationPhase(phaseText);
					setGenerationMessage(`${phaseText} ${current}/${total}`);
				}
			);

			if (!result || !Array.isArray(result.events) || result.events.length === 0) {
				setGenerationStatus("error");
				setGenerationMessage("未生成任何事件，请重试");
				return;
			}

			const nonVolumeChapters = chapters.filter(ch => !ch.isVolume);

			const validatedEvents = result.events.filter(evt => evt.title).map(evt => {
				const involvedCharacterIds: string[] = [];
				if (evt.involvedCharacterNames && Array.isArray(evt.involvedCharacterNames)) {
					for (const charName of evt.involvedCharacterNames) {
						const matchedChar = characters.find((ch) =>
							ch.name.includes(charName) || charName.includes(ch.name)
						);
						if (matchedChar) {
							involvedCharacterIds.push(matchedChar.id);
						}
					}
				}

				const chapterInfo = parseChapterInfo(evt.chapter || "");
				
				let cleanChapter = evt.chapter || "";
				if (chapterInfo.volumeNum > 0 && chapterInfo.chapterNum > 0) {
					cleanChapter = `第${chapterInfo.volumeNum}卷·第${chapterInfo.chapterNum}章`;
				} else if (chapterInfo.volumeNum > 0 && chapterInfo.chapterName) {
					cleanChapter = `第${chapterInfo.volumeNum}卷·${chapterInfo.chapterName}`;
				}

				const matchedChapter = nonVolumeChapters.find(ch => {
					const chInfo = parseChapterInfo(ch.title);
					
					if (ch.title === evt.chapter) return true;
					
					if (chapterInfo.volumeNum > 0 && chapterInfo.chapterNum > 0) {
						if (chInfo.volumeNum > 0 && chInfo.chapterNum > 0) {
							if (chapterInfo.volumeNum === chInfo.volumeNum && chapterInfo.chapterNum === chInfo.chapterNum) {
								return true;
							}
						} else if (chInfo.chapterNum > 0 && chapterInfo.chapterNum === chInfo.chapterNum) {
							return true;
						}
					}

					const normalizedChapter = normalizeChapterTitle(ch.title);
					const normalizedSearch = normalizeChapterTitle(evt.chapter || "");
					if (normalizedChapter === normalizedSearch) return true;

					if (evt.chapter && evt.chapter.length >= 3 && ch.title.includes(evt.chapter)) return true;
					if (evt.chapter && evt.chapter.length >= 3 && normalizedChapter.includes(normalizedSearch)) return true;

					return false;
				});

				return {
					title: evt.title,
					description: evt.description || "",
					timeOrder: evt.timeOrder || 1,
					chapterOrder: evt.chapterOrder || 1,
					timeInfo: evt.timeInfo || "",
					chapter: cleanChapter,
					involvedCharacterIds,
					matchedStartIndex: matchedChapter?.startIndex ?? Infinity,
					volumeNum: chapterInfo.volumeNum,
					chapterNum: chapterInfo.chapterNum,
				};
			});

			validatedEvents.sort((a, b) => {
				if (a.matchedStartIndex !== b.matchedStartIndex && a.matchedStartIndex !== Infinity && b.matchedStartIndex !== Infinity) {
					return a.matchedStartIndex - b.matchedStartIndex;
				}

				if (a.volumeNum !== b.volumeNum) {
					if (a.volumeNum === 0) return 1;
					if (b.volumeNum === 0) return -1;
					return a.volumeNum - b.volumeNum;
				}

				if (a.chapterNum !== b.chapterNum) {
					if (a.chapterNum === 0) return 1;
					if (b.chapterNum === 0) return -1;
					return a.chapterNum - b.chapterNum;
				}

				return a.timeOrder - b.timeOrder;
			});

			let addedCount = 0;
			for (let i = 0; i < validatedEvents.length; i++) {
				const evt = validatedEvents[i];
				addEvent(novelId, {
					title: evt.title,
					description: evt.description,
					timeOrder: evt.timeOrder,
					chapterOrder: i + 1,
					timeInfo: evt.timeInfo,
					chapter: evt.chapter,
					involvedCharacterIds: evt.involvedCharacterIds,
				});
				addedCount++;
			}

			setGenerationStatus("success");
			setGenerationMessage(`成功生成 ${addedCount} 个大事记`);
			logger.proofread(`[NovelEventModal] AI 生成成功，添加了 ${addedCount} 个事件`);
		} catch (err) {
			logger.errorGeneric("[NovelEventModal] AI 生成失败:", err);
			const errorMessage = err instanceof Error ? err.message : "生成失败";
			let message: string;
			if (errorMessage.includes("网络") || errorMessage.includes("network") || errorMessage.includes("fetch")) {
				message = "生成失败，请检查网络连接";
			} else if (errorMessage.includes("配置")) {
				message = "生成失败，请检查 AI 配置";
			} else if (errorMessage.includes("401")) {
				message = "生成失败，API Key 无效";
			} else if (errorMessage.includes("402")) {
				message = "生成失败，账户余额不足";
			} else if (errorMessage.includes("429")) {
				message = "生成失败，请求频率超限，请稍后重试";
			} else {
				message = `生成失败：${errorMessage.slice(0, 50)}`;
			}
			setGenerationStatus("error");
			setGenerationMessage(message);
		} finally {
			setIsGenerating(false);
		}
	}, [novelId, chapters, characters, aiConfig, addEvent, sortedEvents, isGenerating]);

	const handleReorderWithAI = useCallback(async () => {
		if (!novelId || storeEvents.length === 0 || isGenerating) return;

		setIsGenerating(true);
		setGenerationProgress({ current: 0, total: 1 });
		setGenerationPhase("排序中");
		setGenerationStatus("info");
		setGenerationMessage("正在让 AI 重新排序大事记...");
		logger.proofread("[NovelEventModal] 开始 AI 重新排序大事记");

		try {
			const eventsJson = JSON.stringify(storeEvents.map((evt, idx) => ({
				originalIndex: idx + 1,
				title: evt.title,
				description: evt.description,
				timeOrder: evt.timeOrder,
				chapterOrder: evt.chapterOrder,
				timeInfo: evt.timeInfo,
				chapter: evt.chapter,
			})));

			const systemPrompt = `你是小说编辑专家，请根据以下小说大事记的内容，重新分析它们在故事时间线上的先后顺序以及在行文阅读顺序中的位置，然后按正确的顺序排列。

要求：
1. 分析每个事件的时间信息（timeInfo）和发生章节（chapter）
2. 根据故事逻辑重新确定每个事件的 timeOrder（故事时间线顺序）和 chapterOrder（阅读/行文顺序）
3. 确保时间顺序和行文顺序的数值连续，从1开始递增
4. 保持原有的标题、描述、时间信息和章节不变，只调整 timeOrder 和 chapterOrder
5. 直接返回JSON数组，不要包含任何其他文字说明

输出格式：
[{"title": "事件标题", "description": "事件描述", "timeOrder": 1, "chapterOrder": 1, "timeInfo": "时间信息", "chapter": "章节"}]`;

			const userPrompt = `请重新排序以下小说大事记：

${eventsJson}`;

			const messages = [
				{ role: "system" as const, content: systemPrompt },
				{ role: "user" as const, content: userPrompt },
			];

			const response = await sendChatCompletion(messages, aiConfig);

			const jsonMatch = response.match(/\[([\s\S]*)\]/);
			if (!jsonMatch) {
				setGenerationStatus("error");
				setGenerationMessage("AI 返回格式不正确");
				return;
			}

			let reorderedEvents: Array<{ title: string; description: string; timeOrder: number; chapterOrder: number; timeInfo: string; chapter: string }>;
			try {
				reorderedEvents = JSON.parse(`[${jsonMatch[1]}]`);
			} catch {
				setGenerationStatus("error");
				setGenerationMessage("JSON 解析失败");
				return;
			}

			if (!Array.isArray(reorderedEvents) || reorderedEvents.length === 0) {
				setGenerationStatus("error");
				setGenerationMessage("未返回任何事件");
				return;
			}

			const updatedEvents: NovelEvent[] = [];
			for (const reordered of reorderedEvents) {
				const originalEvent = storeEvents.find(e => e.title === reordered.title && e.description === reordered.description);
				if (originalEvent) {
					updatedEvents.push({
						...originalEvent,
						timeOrder: reordered.timeOrder || 1,
						chapterOrder: reordered.chapterOrder || 1,
						timeInfo: reordered.timeInfo || originalEvent.timeInfo,
						chapter: reordered.chapter || originalEvent.chapter,
					});
				}
			}

			const setEvents = useCharacterStore.getState().setEvents;
			setEvents(novelId, updatedEvents);

			setGenerationStatus("success");
			setGenerationMessage(`成功重新排序 ${updatedEvents.length} 个大事记`);
			logger.proofread(`[NovelEventModal] AI 重新排序成功，更新了 ${updatedEvents.length} 个事件`);
		} catch (err) {
			logger.errorGeneric("[NovelEventModal] AI 重新排序失败:", err);
			const errorMessage = err instanceof Error ? err.message : "排序失败";
			let message: string;
			if (errorMessage.includes("网络") || errorMessage.includes("network") || errorMessage.includes("fetch")) {
				message = "排序失败，请检查网络连接";
			} else if (errorMessage.includes("配置")) {
				message = "排序失败，请检查 AI 配置";
			} else if (errorMessage.includes("401")) {
				message = "排序失败，API Key 无效";
			} else if (errorMessage.includes("402")) {
				message = "排序失败，账户余额不足";
			} else if (errorMessage.includes("429")) {
				message = "排序失败，请求频率超限，请稍后重试";
			} else {
				message = `排序失败：${errorMessage.slice(0, 50)}`;
			}
			setGenerationStatus("error");
			setGenerationMessage(message);
		} finally {
			setIsGenerating(false);
		}
	}, [novelId, storeEvents, aiConfig, isGenerating]);

	if (!show || !novelId) return null;

	return createPortal(
		<div className="modal-overlay" onClick={onClose}>
			<div className="config-modal novel-event-modal" onClick={(e) => e.stopPropagation()}>
				<div className="config-header">
					<div className="config-title">
						<Icons.list size={18} />
						<span>小说大事记</span>
					</div>
					<button className="close-btn" onClick={onClose}>
						<Icons.x size={16} />
					</button>
				</div>

				<div className="config-body">
					{(isGenerating || generationStatus) && (
						<div className={`generation-progress ${generationStatus || "info"}`}>
							<div className="generation-progress-header">
								<Icons.brain size={16} />
								<span className="generation-progress-phase">{generationPhase}</span>
								{isGenerating && (
									<Icons.loader2 size={14} className="generation-spinner" />
								)}
								{!isGenerating && generationStatus && (
									<button
										className="generation-progress-close"
										onClick={() => {
											setGenerationStatus(null);
											setGenerationMessage("");
											setGenerationProgress({ current: 0, total: 1 });
										}}
									>
										<Icons.x size={14} />
									</button>
								)}
							</div>
							<div className="generation-progress-bar">
								<div
									className="generation-progress-fill"
									style={{ width: `${(generationProgress.current / generationProgress.total) * 100}%` }}
								/>
							</div>
							<div className="generation-progress-footer">
								<span className="generation-progress-message">{generationMessage}</span>
								{generationProgress.total > 1 && (
									<span className="generation-progress-counter">{generationProgress.current}/{generationProgress.total}</span>
								)}
							</div>
						</div>
					)}

					{/* 编辑/添加表单 */}
					{editingId !== null && (
						<div className="event-edit-form">
							<h4 className="event-edit-title">
								{editingId === "__new__" ? "添加大事记" : "编辑大事记"}
							</h4>
							<div className="form-field">
								<label>事件标题</label>
								<input
									type="text"
									className="config-input"
									value={formData.title}
									onChange={(e) => setFormData({ ...formData, title: e.target.value })}
									placeholder="如：青云门拜师"
								/>
							</div>
							<div className="form-field">
								<label>时间顺序</label>
								<input
									type="number"
									className="config-input"
									style={{ width: 100 }}
									value={formData.timeOrder}
									onChange={(e) =>
										setFormData({ ...formData, timeOrder: Math.max(1, parseInt(e.target.value) || 1) })
									}
									min={1}
								/>
							</div>
							<div className="form-field">
								<label>章节顺序</label>
								<input
									type="number"
									className="config-input"
									style={{ width: 100 }}
									value={formData.chapterOrder}
									onChange={(e) =>
										setFormData({ ...formData, chapterOrder: Math.max(1, parseInt(e.target.value) || 1) })
									}
									min={1}
								/>
							</div>
							<div className="form-field">
								<label>发生章节</label>
								<input
									type="text"
									className="config-input"
									value={formData.chapter}
									onChange={(e) => setFormData({ ...formData, chapter: e.target.value })}
									placeholder="如：第1章、第一章"
								/>
								{formData.chapter && (() => {
									const volume = getVolumeForChapter(formData.chapter);
									return volume ? (
										<span className="chapter-volume-hint">所属分卷：{volume}</span>
									) : null;
								})()}
							</div>
							<div className="form-field">
								<label>时间信息</label>
								<input
									type="text"
									className="config-input"
									value={formData.timeInfo}
									onChange={(e) => setFormData({ ...formData, timeInfo: e.target.value })}
									placeholder="如：三年后、清晨、某日傍晚"
								/>
							</div>
							<div className="form-field">
								<label>事件描述</label>
								<textarea
									className="config-input"
									value={formData.description}
									onChange={(e) => setFormData({ ...formData, description: e.target.value })}
									placeholder="描述事件的具体经过..."
									rows={3}
								/>
							</div>
							<div className="form-field event-characters-field">
								<label>涉及角色（{formData.involvedCharacterIds.length} 个）</label>
								<div className="event-characters-list">
									{characters.length === 0 && (
										<span className="event-no-characters">暂无可选角色</span>
									)}
									{characters.map((ch) => (
										<label key={ch.id} className="event-character-item">
											<input
												type="checkbox"
												checked={formData.involvedCharacterIds.includes(ch.id)}
												onChange={() => toggleCharacter(ch.id)}
											/>
											<span className="event-character-name">
												{ch.name}
												{ch.role && <span className="event-character-role">（{ch.role === "protagonist" ? "男主" : ch.role === "heroine" ? "女主" : ch.role === "antagonist" ? "反派" : ch.role === "supportingMale" ? "男配角" : ch.role === "supportingFemale" ? "女配角" : ch.role === "narrator" ? "旁白" : ch.role}）</span>}
											</span>
										</label>
									))}
								</div>
							</div>
							<div className="event-edit-actions">
								<button className="btn" onClick={handleCancelEdit}>
									<Icons.x size={14} />
									<span>取消</span>
								</button>
								<button className="btn btn-primary" onClick={handleSave}>
									<Icons.saveIcon size={14} />
									<span>保存</span>
								</button>
							</div>
						</div>
					)}

					{/* 补全模式：选择未覆盖章节重新生成 */}
					{isCompletingMode && (
						<div className="chapter-completion-panel">
							<div className="chapter-completion-header">
								<span className="chapter-completion-title">补全大事记</span>
								<button className="chapter-completion-close" onClick={() => {
									setIsCompletingMode(false);
									setSelectedChapterIds(new Set());
								}}>
									<Icons.x size={14} />
								</button>
							</div>
							<div className="chapter-completion-info">
								<p>以下章节尚未在大事记中涉及，请选择需要重新分析的章节：</p>
								<span className="uncovered-count">共 {getUncoveredChapters.length} 个未覆盖章节</span>
							</div>
							<div className="chapter-completion-list">
								{getUncoveredChapters.length === 0 ? (
									<div className="chapter-completion-empty">
										<Icons.checkCircle size={24} />
										<p>所有章节均已被大事记覆盖</p>
									</div>
								) : (
									getUncoveredChapters.map((ch) => {
										const volume = chapters.find(v => v.id === ch.parentId && v.isVolume);
										return (
											<label key={ch.id} className="chapter-completion-item">
												<input
													type="checkbox"
													checked={selectedChapterIds.has(ch.id)}
													onChange={() => {
														setSelectedChapterIds(prev => {
															const newSet = new Set(prev);
															if (newSet.has(ch.id)) {
																newSet.delete(ch.id);
															} else {
																newSet.add(ch.id);
															}
															return newSet;
														});
													}}
												/>
												<span className="chapter-completion-chapter">
													{volume && <span className="chapter-completion-volume">{volume.title} · </span>}
													{ch.title}
												</span>
											</label>
										);
									})
								)}
							</div>
							<div className="chapter-completion-actions">
								<button 
									className="btn"
									onClick={() => setSelectedChapterIds(new Set(getUncoveredChapters.map(ch => ch.id)))}
									disabled={getUncoveredChapters.length === 0}
								>
									<Icons.checkAll size={14} />
									<span>全选</span>
								</button>
								<button 
									className="btn"
									onClick={() => setSelectedChapterIds(new Set())}
									disabled={selectedChapterIds.size === 0}
								>
									<Icons.check size={14} />
									<span>取消全选</span>
								</button>
								<button 
									className="btn btn-primary"
									onClick={handleCompleteChapters}
									disabled={selectedChapterIds.size === 0 || isGenerating}
								>
									<Icons.brain size={14} />
									<span>{isGenerating ? "分析中..." : `分析选中 ${selectedChapterIds.size} 章`}</span>
								</button>
							</div>
						</div>
					)}

					{/* 大事记列表 */}
					<div className="event-list">
						<div className="event-list-header">
							<span className="event-list-count">共 {sortedEvents.length} 个事件</span>
							{getUncoveredChapters.length > 0 && (
								<button 
									className={`event-list-complete-btn ${isCompletingMode ? "active" : ""}`}
									onClick={() => setIsCompletingMode(!isCompletingMode)}
								>
									<Icons.refreshCw size={14} />
									<span>补全（{getUncoveredChapters.length}章缺失）</span>
								</button>
							)}
						</div>
						{sortedEvents.length === 0 && (
							<div className="event-list-empty">
								<Icons.list size={24} />
								<p>暂无大事记，点击下方"新增"添加</p>
							</div>
						)}
						{sortedEvents.map((evt, idx) => (
							<div key={evt.id} className="event-item">
								<div className="event-item-order">{idx + 1}</div>
								<div className="event-item-body">
									<div className="event-item-title">{evt.title}</div>
									<div className="event-item-meta">
										{evt.chapter && (
											<span className="event-item-chapter">
												{(() => {
													if (evt.chapter.includes("·")) {
														return evt.chapter;
													}
													const volume = getVolumeForChapter(evt.chapter);
													return volume 
														? `${evt.chapter}·${volume}`
														: evt.chapter;
												})()}
											</span>
										)}
										{evt.timeInfo && (
											<span className="event-item-time-info">{evt.timeInfo}</span>
										)}
									</div>
									{evt.description && (
										<div className="event-item-desc">{evt.description}</div>
									)}
									{evt.involvedCharacterIds.length > 0 && (
										<div className="event-item-characters">
											{evt.involvedCharacterIds.map((cid) => {
												const ch = characters.find((c) => c.id === cid);
												return ch ? (
													<span key={cid} className="event-item-character-tag">
														{ch.name}
													</span>
												) : null;
											})}
										</div>
									)}
								</div>
								<div className="event-item-actions">
									<button
										className="event-item-btn"
										title="编辑"
										onClick={() => handleEdit(evt)}
										disabled={editingId !== null}
									>
										<Icons.edit size={14} />
									</button>
									<button
										className="event-item-btn event-item-btn-danger"
										title="删除"
										onClick={() => setShowDeleteConfirm(evt.id)}
										disabled={editingId !== null}
									>
										<Icons.trash2 size={14} />
									</button>
								</div>

								{/* 删除确认 */}
								{showDeleteConfirm === evt.id && (
									<div className="event-delete-confirm">
										<span>确定删除「{evt.title}」？</span>
										<div className="event-delete-confirm-actions">
											<button className="btn btn-sm" onClick={() => setShowDeleteConfirm(null)}>
												取消
											</button>
											<button className="btn btn-sm btn-danger" onClick={() => handleDelete(evt.id)}>
												删除
											</button>
										</div>
									</div>
								)}
							</div>
						))}
					</div>
				</div>

				{/* 底部操作按钮 */}
				<div className="character-actions-fab-wrapper">
					<button
						className="btn"
						onClick={handleAdd}
						disabled={editingId !== null}
						title="新增大事记"
					>
						<Icons.plus size={16} />
						<span>新增</span>
					</button>
					<button
						className={`btn ${sortMode === 'time' ? 'btn-primary' : ''}`}
						onClick={() => setSortMode(sortMode === 'chapter' ? 'time' : 'chapter')}
						disabled={editingId !== null || sortedEvents.length === 0}
						title={sortMode === 'chapter' ? "切换为按事件发生时间排序" : "切换为按章节顺序排序"}
					>
						<Icons.listOrdered size={16} />
						<span>{sortMode === 'chapter' ? "按章节" : "按时间"}</span>
					</button>
					<button
						className="btn"
						onClick={handleReorderWithAI}
						disabled={editingId !== null || isGenerating || storeEvents.length === 0}
						title="AI 根据故事逻辑重新排序现有大事记"
					>
						<Icons.refreshCw size={16} />
						<span>{isGenerating ? "排序中..." : "AI 排序"}</span>
					</button>
					<button
						className="btn"
						onClick={handleGenerateWithAI}
						disabled={editingId !== null || isGenerating || !chapters.length}
						title="AI 分析小说内容生成大事记"
					>
						<Icons.brain size={16} />
						<span>{isGenerating ? "生成中..." : "AI 生成"}</span>
					</button>
				</div>
			</div>
		</div>,
		document.body,
	);
};
