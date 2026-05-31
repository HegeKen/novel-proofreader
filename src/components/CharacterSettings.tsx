// ============================================================
// 角色设置组件
// ============================================================
import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useAppStore } from "../stores/appStore";
import { useConfigStore } from "../stores/configStore";
import type { CharacterInfo, CharacterRelationship, CharacterRole, NovelCategory, ProofreadProgress } from "../types";
import { synthesizeSpeechWithVoice } from "../utils/ttsService";
import { Icons } from "./Icons";
import { Select } from "./Select";
import { logger } from "../utils/logger";
import { detectCharactersFromText, detectHighFrequencyWords, saveCharacterConfigToStorage, loadCharacterConfigFromStorage, getCharacterConfigFileName } from "../utils/fileExport";
import type { DetectedCharacter, HighFrequencyWord } from "../utils/fileExport";
import { analyzeCharactersInBatches } from "../utils/aiClient";
import { formatDateTime } from "../utils/formatters";
import { RelationshipGraph } from "./RelationshipGraph";

interface CharacterSettingsProps {
	novelId: string;
	novelName: string;
	onClose: () => void;
}

export function CharacterSettings({ novelId, novelName, onClose }: CharacterSettingsProps) {
	const novelCharacters = useAppStore((s) => s.novelCharacters);
	const characters = useMemo(() => novelCharacters[novelId] ?? [], [novelCharacters, novelId]);

	// 角色排序状态 - 按 order 字段排序，未设置的放在最后
	const sortedCharacters = useMemo(() => {
		const sorted = [...characters];
		sorted.sort((a, b) => {
			const aOrder = a.order ?? 9999;
			const bOrder = b.order ?? 9999;
			if (aOrder !== bOrder) {
				return aOrder - bOrder;
			}
			return a.name.localeCompare(b.name, 'zh-CN');
		});
		return sorted;
	}, [characters]);

	// 拖拽排序模式
	const [isDragMode, setIsDragMode] = useState(false);
	const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
	const touchStartIndexRef = useRef<number | null>(null);
	const touchCurrentIndexRef = useRef<number | null>(null);
	const touchStartYRef = useRef(0);
	const touchIsDraggingRef = useRef(false);
	const allRelationships = useAppStore((s) => s.characterRelationships);
	const relationships = useMemo(() => allRelationships[novelId] ?? [], [allRelationships, novelId]);
	const storeNodePositions = useAppStore((s) => s.nodePositions);
	const nodePositions = useMemo(() => storeNodePositions[novelId] ?? {}, [storeNodePositions, novelId]);
	const addCharacter = useAppStore((s) => s.addCharacter);
	const updateCharacter = useAppStore((s) => s.updateCharacter);
	const removeCharacter = useAppStore((s) => s.removeCharacter);
	const setCharactersForNovel = useAppStore((s) => s.setCharactersForNovel);
	const setRelationshipsForNovel = useAppStore((s) => s.setRelationshipsForNovel);
	const getRelationshipsForNovel = useAppStore((s) => s.getRelationshipsForNovel);
	const setNodePositions = useAppStore((s) => s.setNodePositions);
	const setIgnoredWords = useAppStore((s) => s.setIgnoredWords);
	const setProofreadProgress = useAppStore((s) => s.setProofreadProgress);
	const setNovelCategory = useAppStore((s) => s.setNovelCategory);
	const getIgnoredWords = useAppStore((s) => s.getIgnoredWords);
	const addIgnoredCharacterName = useAppStore((s) => s.addIgnoredCharacterName);
	const getIgnoredCharacterNames = useAppStore((s) => s.getIgnoredCharacterNames);
	const setIgnoredCharacterNames = useAppStore((s) => s.setIgnoredCharacterNames);
	const ignoredCharacterNames = useMemo(() => getIgnoredCharacterNames(novelId), [getIgnoredCharacterNames, novelId]);
	const ignoredWords = useMemo(() => getIgnoredWords(novelId), [getIgnoredWords, novelId]);
	const proofreadProgress = useAppStore((s) => s.proofreadProgress[novelId]);
	const novelCategories = useAppStore((s) => s.novelCategories);
	const novelCategory = useMemo(() => novelCategories[novelId], [novelCategories, novelId]);
	const novels = useAppStore((s) => s.novels);
	const currentNovel = useMemo(() => novels.find(n => n.id === novelId), [novels, novelId]);

	// 检测新角色弹窗状态
	const [showDetectModal, setShowDetectModal] = useState(false);
	const [detectedCharacters, setDetectedCharacters] = useState<DetectedCharacter[]>([]);
	const [isScanning, setIsScanning] = useState(false);
	const [detectSearchQuery, setDetectSearchQuery] = useState("");
	
	// 高频词汇检测弹窗状态
	const [showWordsModal, setShowWordsModal] = useState(false);
	const [detectedWords, setDetectedWords] = useState<HighFrequencyWord[]>([]);

	// 角色分析弹窗状态
	const [showAnalyzeModal, setShowAnalyzeModal] = useState(false);
	const [isAnalyzing, setIsAnalyzing] = useState(false);
	const [analyzeProgress, setAnalyzeProgress] = useState({ current: 0, total: 0 });
	const [analyzeError, setAnalyzeError] = useState<string | null>(null);
	
	// 检测结果操作状态：'new' | 'alias' | 'relation'
	type DetectedAction = 'new' | 'alias' | 'relation';
	interface DetectedSelection {
		selected: boolean;
		action: DetectedAction;
		mergeTargetId?: string;
	}
	const [detectedSelections, setDetectedSelections] = useState<Record<string, DetectedSelection>>({});

	// 角色设置标签页状态：'list' | 'graph'
	const [activeTab, setActiveTab] = useState<"list" | "graph">("graph");

	// 检测是否为移动端
	const [isMobile, setIsMobile] = useState(false);
	useEffect(() => {
		const checkMobile = () => {
			setIsMobile(window.innerWidth <= 768);
		};
		checkMobile();
		window.addEventListener("resize", checkMobile);
		return () => window.removeEventListener("resize", checkMobile);
	}, []);

	// 从文件系统加载角色数据
	const loadedRef = useRef(false);
	useEffect(() => {
		if (loadedRef.current) return;
		loadedRef.current = true;
		
		const loadCharactersFromStorage = async () => {
			if (!novelId) return;
			const fileName = getCharacterConfigFileName(novelName);
			const content = await loadCharacterConfigFromStorage(fileName);
			if (content) {
				try {
					const loadedCharacters = JSON.parse(content) as CharacterInfo[];
					// 如果内存中没有角色数据但文件中有，则加载到内存
					if (!novelCharacters[novelId] || novelCharacters[novelId].length === 0) {
						setCharactersForNovel(novelId, loadedCharacters);
					}
					logger.file('Loaded characters from storage:', { novelId, novelName, count: loadedCharacters.length });
				} catch (err) {
					logger.errorGeneric('[CharacterSettings]', 'Failed to parse character config:', err);
				}
			} else {
				logger.file('No character config file found for:', { novelId, novelName });
			}
		};
		loadCharactersFromStorage();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [novelId, novelName]);

	// 编辑状态
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editForm, setEditForm] = useState<Partial<CharacterInfo>>({
		name: "",
		gender: "other",
		role: undefined,
		notes: "",
		voice: "",
		aliases: [],
		relationTerms: [],
	});
	const [showAddForm, setShowAddForm] = useState(false);
	const [newAlias, setNewAlias] = useState("");
	const [newRelationTerm, setNewRelationTerm] = useState("");
	
	// TTS 功能状态
	const [playingNoteCharacterId, setPlayingNoteCharacterId] = useState<string | null>(null);
	const audioRef = useRef<HTMLAudioElement | null>(null);
	const cancelPlayRef = useRef<(() => void) | null>(null);
	const ttsConfig = useConfigStore((s) => s.ttsConfig);
	const aiConfig = useAppStore((s) => s.aiConfig);

	const voiceOptions = [
		{ value: "冰糖", label: "冰糖 (女)" },
		{ value: "茉莉", label: "茉莉 (女)" },
		{ value: "苏打", label: "苏打 (男)" },
		{ value: "白桦", label: "白桦 (男)" },
		{ value: "Mia", label: "Mia (女)" },
		{ value: "Chloe", label: "Chloe (女)" },
		{ value: "Milo", label: "Milo (男)" },
		{ value: "Dean", label: "Dean (男)" },
	];

	const startEdit = useCallback((char: CharacterInfo) => {
		setEditingId(char.id);
		setEditForm({ ...char });
	}, []);

	const saveEdit = useCallback(() => {
		if (editingId) {
			updateCharacter(novelId, editingId, editForm);
			setEditingId(null);
		}
	}, [editingId, novelId, editForm, updateCharacter]);

	const cancelEdit = useCallback(() => {
		setEditingId(null);
		setNewAlias("");
		setNewRelationTerm("");
	}, []);

	const addAlias = useCallback(() => {
		if (!newAlias.trim()) return;
		setEditForm(prev => ({
			...prev,
			aliases: [...(prev.aliases || []), newAlias.trim()]
		}));
		setNewAlias("");
	}, [newAlias]);

	const removeAlias = useCallback((index: number) => {
		setEditForm(prev => ({
			...prev,
			aliases: (prev.aliases || []).filter((_, i) => i !== index)
		}));
	}, []);

	const addRelationTerm = useCallback(() => {
		if (!newRelationTerm.trim()) return;
		setEditForm(prev => ({
			...prev,
			relationTerms: [...(prev.relationTerms || []), newRelationTerm.trim()]
		}));
		setNewRelationTerm("");
	}, [newRelationTerm]);

	const removeRelationTerm = useCallback((index: number) => {
		setEditForm(prev => ({
			...prev,
			relationTerms: (prev.relationTerms || []).filter((_, i) => i !== index)
		}));
	}, []);

	const clearAllAliases = useCallback(() => {
		if ((editForm.aliases || []).length > 0 && confirm("确定要清空所有别称吗？")) {
			setEditForm(prev => ({
				...prev,
				aliases: []
			}));
		}
	}, [editForm.aliases]);

	const clearAllRelationTerms = useCallback(() => {
		if ((editForm.relationTerms || []).length > 0 && confirm("确定要清空所有关系代称吗？")) {
			setEditForm(prev => ({
				...prev,
				relationTerms: []
			}));
		}
	}, [editForm.relationTerms]);

	const handleAdd = useCallback(() => {
		if (!editForm.name?.trim()) return;
		addCharacter(novelId, {
			name: editForm.name.trim(),
			gender: editForm.gender || "other",
			notes: editForm.notes,
			voice: editForm.voice,
			aliases: editForm.aliases || [],
			relationTerms: editForm.relationTerms || [],
		});
		setShowAddForm(false);
		setEditForm({ name: "", gender: "other", notes: "", voice: "", aliases: [], relationTerms: [] });
		setNewAlias("");
		setNewRelationTerm("");
	}, [editForm, novelId, addCharacter, setShowAddForm]);

	const handleDelete = useCallback((id: string) => {
		if (confirm("确定要删除这个角色吗？")) {
			removeCharacter(novelId, id);
		}
	}, [novelId, removeCharacter]);

	// 显示导出结果弹窗
	const [exportModal, setExportModal] = useState<{
		show: boolean;
		success: boolean;
		fileName: string;
		dataStr: string;
		characterCount: number;
		relationshipCount?: number;
	}>({
		show: false,
		success: false,
		fileName: "",
		dataStr: "",
		characterCount: 0,
	});

	// 复制JSON数据到剪贴板
	const copyToClipboard = useCallback(async (data: string) => {
		try {
			await navigator.clipboard.writeText(data);
			alert("已复制到剪贴板！");
		} catch (err) {
			console.error('[CharacterSettings] 复制失败:', err);
			alert("复制失败，请手动选择复制");
		}
	}, []);

	// 导出小说设置（包含角色、关系、忽略词等）
	const handleExportCharacters = useCallback(async () => {
		const exportData = {
			version: "2.0",
			novelId,
			novelName,
			exportTime: formatDateTime(new Date()),
			characters: characters.map(char => ({
				id: char.id,
				name: char.name,
				gender: char.gender,
				role: char.role,
				order: char.order,
				relationTerms: char.relationTerms || [],
				aliases: char.aliases || [],
				notes: char.notes || "",
				voice: char.voice || "",
			})),
			relationships: relationships.map(rel => ({
				id: rel.id,
				sourceId: rel.sourceId,
				targetId: rel.targetId,
				relationType: rel.relationType,
				customRelationType: rel.customRelationType,
				sourceNickname: rel.sourceNickname || [],
				targetNickname: rel.targetNickname || [],
			})),
			nodePositions,
			ignoredWords,
			ignoredCharacterNames,
			proofreadProgress,
			novelCategory,
		};
		
		const dataStr = JSON.stringify(exportData, null, 2);
		// 使用小说名称作为文件名前缀
		const safeName = (novelName || "小说设置").replace(/[\\/:*?"<>|]/g, "_");
		const fileName = `${safeName}-小说设置-${new Date().toISOString().split("T")[0]}.json`;

		if (isMobile) {
			// 移动端：使用 Tauri API 保存到 Android/data/cn.helilab.proofreader/documents/characters/ 目录
			const success = await saveCharacterConfigToStorage(fileName, dataStr);
			logger.file('小说设置导出结果:', { success, fileName, characterCount: characters.length, dataSize: dataStr.length, isMobile });
			setExportModal({
				show: true,
				success,
				fileName,
				dataStr,
				characterCount: characters.length,
				relationshipCount: relationships.length,
			});
		} else {
			// 桌面端：使用浏览器下载
			const blob = new Blob([dataStr], { type: "application/json" });
			const url = URL.createObjectURL(blob);
			const link = document.createElement("a");
			link.href = url;
			link.download = fileName;
			link.click();
			URL.revokeObjectURL(url);
			setExportModal({
				show: true,
				success: true,
				fileName,
				dataStr,
				characterCount: characters.length,
				relationshipCount: relationships.length,
			});
		}
	}, [characters, relationships, novelName, novelId, isMobile, nodePositions, ignoredWords, ignoredCharacterNames, proofreadProgress, novelCategory, setExportModal]);

	// 导入角色
	const handleImportCharacters = useCallback(async () => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = ".json";
		input.onchange = async (e) => {
			const file = (e.target as HTMLInputElement).files?.[0];
			if (!file) return;
			
			const reader = new FileReader();
			reader.onload = async (event) => {
				try {
					const imported = JSON.parse(event.target?.result as string);
					
					let importedChars: CharacterInfo[] = [];
					let importedRelationships: CharacterRelationship[] = [];
					let importedNodePositions: Record<string, { x: number; y: number }> = {};
					let importedIgnoredWords: string[] = [];
					let importedProofreadProgress: Record<number, ProofreadProgress> = {};
					let importedNovelCategory: NovelCategory | null = null;
					let importedIgnoredCharacterNames: string[] = [];

					// 兼容新旧格式
					if (imported.version && Array.isArray(imported.characters)) {
						// 新格式：{ version, characters, relationships, nodePositions, ignoredWords, proofreadProgress, novelCategory, ignoredCharacterNames }
						importedChars = imported.characters;
						importedRelationships = imported.relationships || [];
						importedNodePositions = imported.nodePositions || {};
						importedIgnoredWords = imported.ignoredWords || [];
						importedProofreadProgress = imported.proofreadProgress || {};
						importedNovelCategory = imported.novelCategory || null;
						importedIgnoredCharacterNames = imported.ignoredCharacterNames || [];
					} else if (Array.isArray(imported)) {
						// 旧格式：CharacterInfo[]
						importedChars = imported;
					} else {
						alert("文件格式错误：无法识别的数据格式");
						return;
					}

					// 验证每个角色的格式
					const valid = importedChars.every(char => 
						typeof char.name === "string" &&
						["male", "female", "other"].includes(char.gender)
					);

					if (!valid) {
						alert("文件格式错误：角色数据格式不正确");
						return;
					}

					// --- 导入角色（保留原始ID以确保关系和节点位置能正确关联） ---
					const currentChars = novelCharacters[novelId] ?? [];
					const existingByName = new Map(currentChars.map(c => [c.name, c]));
					const idMapping = new Map<string, string>(); // oldId → resolvedId
					const mergedChars: CharacterInfo[] = [...currentChars];
					const mergedIds = new Set(currentChars.map(c => c.id));
					let addedCount = 0;
					let updatedCount = 0;

					for (const importedChar of importedChars) {
						const existing = existingByName.get(importedChar.name);
						if (existing) {
							// 同名角色已存在，更新属性，保留现有 ID
							updateCharacter(novelId, existing.id, {
								name: importedChar.name,
								gender: importedChar.gender,
								role: importedChar.role,
								order: importedChar.order,
								notes: importedChar.notes || "",
								voice: importedChar.voice || "",
								aliases: importedChar.aliases || [],
								relationTerms: importedChar.relationTerms || [],
							});
							idMapping.set(importedChar.id, existing.id);
							updatedCount++;
						} else {
							// 新角色：使用导出时的原始 ID
							const charWithId: CharacterInfo = {
								...importedChar,
								name: importedChar.name,
								gender: importedChar.gender,
								role: importedChar.role,
								order: importedChar.order,
								notes: importedChar.notes || "",
								voice: importedChar.voice || "",
								aliases: importedChar.aliases || [],
								relationTerms: importedChar.relationTerms || [],
							};
							if (!mergedIds.has(importedChar.id)) {
								mergedChars.push(charWithId);
								mergedIds.add(importedChar.id);
							}
							idMapping.set(importedChar.id, importedChar.id);
							addedCount++;
						}
					}
					setCharactersForNovel(novelId, mergedChars);

					// --- 导入关系（使用ID映射修正 sourceId/targetId） ---
					let importedRelCount = 0;
					if (importedRelationships.length > 0) {
						const resolvedRelationships: CharacterRelationship[] = [];
						for (const rel of importedRelationships) {
							const resolvedSourceId = idMapping.get(rel.sourceId) || rel.sourceId;
							const resolvedTargetId = idMapping.get(rel.targetId) || rel.targetId;
							resolvedRelationships.push({
								...rel,
								id: rel.id || `rel-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
								novelId,
								sourceId: resolvedSourceId,
								targetId: resolvedTargetId,
							});
							importedRelCount++;
						}
						setRelationshipsForNovel(novelId, resolvedRelationships);
					} else {
						setRelationshipsForNovel(novelId, []);
					}

					// --- 导入节点位置（使用ID映射修正 key） ---
					if (Object.keys(importedNodePositions).length > 0) {
						const resolvedPositions: Record<string, { x: number; y: number }> = {};
						for (const [oldId, pos] of Object.entries(importedNodePositions)) {
							const resolvedId = idMapping.get(oldId) || oldId;
							resolvedPositions[resolvedId] = pos;
						}
						setNodePositions(novelId, resolvedPositions);
					}

					// --- 导入忽略词 ---
					if (importedIgnoredWords.length > 0) {
						setIgnoredWords(novelId, importedIgnoredWords);
					}

					// --- 导入校对进度 ---
					if (Object.keys(importedProofreadProgress).length > 0) {
						setProofreadProgress(novelId, importedProofreadProgress);
					}

					// --- 导入小说分类 ---
					if (importedNovelCategory) {
						setNovelCategory(novelId, importedNovelCategory);
					}

					// --- 导入忽略角色名 ---
					if (importedIgnoredCharacterNames.length > 0) {
						setIgnoredCharacterNames(novelId, importedIgnoredCharacterNames);
					}

					const msg = `导入完成！新增 ${addedCount} 个角色，更新 ${updatedCount} 个角色` +
						(importedRelCount > 0 ? `，导入 ${importedRelCount} 条关系` : "") +
						(Object.keys(importedNodePositions).length > 0 ? "，导入节点位置" : "") +
						(importedIgnoredWords.length > 0 ? `，导入 ${importedIgnoredWords.length} 个忽略词` : "") +
						(Object.keys(importedProofreadProgress).length > 0 ? "，导入校对进度" : "") +
						(importedNovelCategory ? "，导入小说分类" : "") +
						(importedIgnoredCharacterNames.length > 0 ? `，导入 ${importedIgnoredCharacterNames.length} 个忽略角色` : "");
					alert(msg);
				} catch (err) {
					alert("文件解析失败：" + (err instanceof Error ? err.message : String(err)));
				}
			};
			reader.readAsText(file);
		};
		input.click();
	}, [novelId, novelCharacters, updateCharacter, setCharactersForNovel, setRelationshipsForNovel, setNodePositions, setIgnoredWords, setProofreadProgress, setNovelCategory, setIgnoredCharacterNames]);

	// 扫描小说检测角色
	const handleScanCharacters = useCallback(async () => {
		if (!currentNovel?.fullText) {
			alert("无法获取小说内容");
			return;
		}
		
		setIsScanning(true);
		try {
			const detected = detectCharactersFromText(currentNovel.fullText, 3);
			
			// 过滤掉已存在的角色和已忽略的角色（但保留用于合并的选项）
			const existingNames = new Set(characters.map(c => c.name.toLowerCase()));
			const existingAliases = new Set(characters.flatMap(c => (c.aliases || []).map(a => a.toLowerCase())));
			const ignoredNames = new Set(getIgnoredCharacterNames(novelId).map(n => n.toLowerCase()));

			const newChars = detected.filter(dc => {
				const lowerName = dc.name.toLowerCase();
				return !existingNames.has(lowerName) && !existingAliases.has(lowerName) && !ignoredNames.has(lowerName);
			});
			
			setDetectedCharacters(newChars.sort((a, b) => b.frequency - a.frequency));
			
			// 初始化选择状态：默认不选中，用户手动选择
			const initialSelections: Record<string, DetectedSelection> = {};
			for (const char of newChars) {
				initialSelections[char.name] = {
					selected: false,
					action: 'new',
				};
			}
			setDetectedSelections(initialSelections);
			setShowDetectModal(true);
		} catch (err) {
			console.error('[CharacterSettings] Scan characters failed:', err);
			alert("扫描失败：" + (err instanceof Error ? err.message : String(err)));
		} finally {
			setIsScanning(false);
		}
	}, [currentNovel, characters, getIgnoredCharacterNames, novelId, setDetectedCharacters, setDetectedSelections, setShowDetectModal]);

	// 扫描高频词汇
	const handleScanHighFrequencyWords = useCallback(async () => {
		if (!currentNovel?.fullText) {
			alert("无法获取小说内容");
			return;
		}
		
		setIsScanning(true);
		try {
			const words = detectHighFrequencyWords(currentNovel.fullText, 10);
			
			const existingNames = new Set(characters.map(c => c.name.toLowerCase()));
			const existingAliases = new Set(characters.flatMap(c => (c.aliases || []).map(a => a.toLowerCase())));
			const existingRelationTerms = new Set(characters.flatMap(c => (c.relationTerms || []).map(r => r.toLowerCase())));
			const ignoredWordSet = new Set(getIgnoredWords(novelId).map(w => w.toLowerCase()));
			const ignoredNameSet = new Set(getIgnoredCharacterNames(novelId).map(n => n.toLowerCase()));
			
			const filteredWords = words.filter(w => {
				const lowerWord = w.word.toLowerCase();
				return !existingNames.has(lowerWord) && !existingAliases.has(lowerWord) && !existingRelationTerms.has(lowerWord) && !ignoredWordSet.has(lowerWord) && !ignoredNameSet.has(lowerWord);
			});
			
			setDetectedWords(filteredWords);
			setShowWordsModal(true);
		} catch (err) {
			console.error('[CharacterSettings] Scan high frequency words failed:', err);
			alert("扫描失败：" + (err instanceof Error ? err.message : String(err)));
		} finally {
			setIsScanning(false);
		}
	}, [currentNovel, characters, getIgnoredWords, getIgnoredCharacterNames, novelId, setDetectedWords, setShowWordsModal]);

	// 使用AI分析整本小说提取角色和关系
	const handleAnalyzeCharacters = async () => {
		if (!currentNovel?.fullText) {
			alert("无法获取小说内容");
			return;
		}

		if (!aiConfig.apiKey || !aiConfig.baseURL) {
			alert("请先在设置中配置AI模型");
			return;
		}

		setIsAnalyzing(true);
		setAnalyzeError(null);
		setAnalyzeProgress({ current: 0, total: 0 });

		const abortController = new AbortController();

		try {
			// 构建AI配置（转换为AIConfig格式）
			const config = {
				baseURL: aiConfig.baseURL,
				apiKey: aiConfig.apiKey,
				model: aiConfig.model,
				customHeaders: {},
				maxCharsPerRequest: 0,
				enableLogging: false,
			};

			const result = await analyzeCharactersInBatches(
				currentNovel.fullText,
				config,
				50000, // 50K字符每批次
				abortController.signal,
				(current, total) => {
					setAnalyzeProgress({ current, total });
				}
			);

			logger.proofread("[CharacterSettings] AI分析完成:", {
				charactersCount: result.characters.length,
				relationshipsCount: result.relationships.length,
			});

			// 将分析结果转换为CharacterInfo格式并添加到角色列表
			const existingNames = new Set(characters.map(c => c.name.toLowerCase()));
			const newCharactersWithIds: Array<{ id: string } & Omit<CharacterInfo, "id">> = [];
			const nameToIdMap = new Map<string, string>();

			// 先为新角色生成ID并建立映射
			for (const char of result.characters) {
				if (!existingNames.has(char.name.toLowerCase())) {
					const charId = `char-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
					nameToIdMap.set(char.name.toLowerCase(), charId);
					newCharactersWithIds.push({
						id: charId,
						name: char.name,
						gender: char.gender,
						role: char.role as CharacterRole,
						notes: char.description,
						voice: "",
						aliases: char.aliases,
						relationTerms: [] as string[],
						order: newCharactersWithIds.length,
					});
					existingNames.add(char.name.toLowerCase());
				}
			}

			// 添加新角色
			for (const char of newCharactersWithIds) {
				// eslint-disable-next-line @typescript-eslint/no-unused-vars
				const { id, ...charWithoutId } = char;
				addCharacter(novelId, charWithoutId);
			}

			// 获取当前关系并添加新关系
			const currentRelationships = getRelationshipsForNovel(novelId);
			const newRelationships: CharacterRelationship[] = [];

			for (const rel of result.relationships) {
				const sourceNameLower = rel.sourceName.toLowerCase();
				const targetNameLower = rel.targetName.toLowerCase();

				// 查找已存在角色的ID
				const matchedSource = characters.find(c => c.name.toLowerCase() === sourceNameLower);
				const matchedTarget = characters.find(c => c.name.toLowerCase() === targetNameLower);

				// 获取新角色的ID
				const newSourceId = nameToIdMap.get(sourceNameLower);
				const newTargetId = nameToIdMap.get(targetNameLower);

				// 确定source和target的ID
				const sourceId = matchedSource?.id || newSourceId;
				const targetId = matchedTarget?.id || newTargetId;

				// 跳过无法匹配的关系
				if (!sourceId || !targetId) continue;

				// 跳过自环关系
				if (sourceId === targetId) continue;

				newRelationships.push({
					id: `rel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
					novelId,
					sourceId,
					targetId,
					relationType: [rel.relationType as import("../types").RelationType],
					customRelationType: rel.customRelationType,
					sourceNickname: rel.sourceNickname,
					targetNickname: rel.targetNickname,
				});
			}

			// 添加新关系
			setRelationshipsForNovel(novelId, [...currentRelationships, ...newRelationships]);

			alert(`分析完成！新增 ${newCharactersWithIds.length} 个角色和 ${newRelationships.length} 条关系`);
			setShowAnalyzeModal(false);
		} catch (err) {
			if (err instanceof Error && err.message === "分析已取消") {
				logger.proofread("[CharacterSettings] 用户取消分析");
			} else {
				logger.warn("[CharacterSettings] AI分析失败:", err);
				setAnalyzeError(err instanceof Error ? err.message : String(err));
			}
		} finally {
			setIsAnalyzing(false);
		}
	};

	// 全选/取消全选
	const handleToggleAll = useCallback((checked: boolean) => {
		const newSelections: Record<string, DetectedSelection> = {};
		for (const char of detectedCharacters) {
			newSelections[char.name] = {
				...detectedSelections[char.name],
				selected: checked,
			};
		}
		setDetectedSelections(newSelections);
	}, [detectedCharacters, detectedSelections, setDetectedSelections]);

	// 添加选中的检测角色
	const handleAddSelectedCharacters = useCallback(() => {
		let addedCount = 0;
		let mergedCount = 0;
		
		for (const char of detectedCharacters) {
			const selection = detectedSelections[char.name];
			if (!selection?.selected) continue;
			
			if (selection.action === 'new') {
			// 添加为新角色
			addCharacter(novelId, {
				name: char.name,
				gender: "other",
				notes: `自动检测到 ${char.frequency} 次，置信度 ${(char.confidence * 100).toFixed(1)}%\n` +
				       `依据：${char.evidence?.join('; ') || '无'}`,
				voice: "",
				aliases: [],
				relationTerms: [],
			});
			addedCount++;
		} else if (selection.action === 'alias' && selection.mergeTargetId) {
				// 添加为别名
				const target = characters.find(c => c.id === selection.mergeTargetId);
				if (target) {
					const newAliases = [...(target.aliases || []), char.name, ...(char.aliases || [])];
					updateCharacter(novelId, target.id, { aliases: newAliases });
					mergedCount++;
				}
			} else if (selection.action === 'relation' && selection.mergeTargetId) {
				// 添加为关系代称
				const target = characters.find(c => c.id === selection.mergeTargetId);
				if (target) {
					const newRelations = [...(target.relationTerms || []), char.name, ...(char.aliases || [])];
					updateCharacter(novelId, target.id, { relationTerms: newRelations });
					mergedCount++;
				}
			}
		}
		
		setShowDetectModal(false);
		
		const messages = [];
		if (addedCount > 0) messages.push(`新增 ${addedCount} 个角色`);
		if (mergedCount > 0) messages.push(`合并 ${mergedCount} 个到已有角色`);
		alert(messages.join('\n'));
	}, [detectedCharacters, detectedSelections, novelId, characters, addCharacter, updateCharacter, setShowDetectModal]);

	
	// 播放备注
	const handlePlayNote = useCallback(async (character: CharacterInfo) => {
		if (!character.notes) return;
		
		// 如果正在播放当前角色的备注，停止播放
		if (playingNoteCharacterId === character.id) {
			// 停止播放
			if (audioRef.current) {
				audioRef.current.pause();
				audioRef.current = null;
			}
			if (cancelPlayRef.current) {
				cancelPlayRef.current();
				cancelPlayRef.current = null;
			}
			setPlayingNoteCharacterId(null);
			return;
		}
		
		// 停止之前的播放
		if (audioRef.current) {
			audioRef.current.pause();
			audioRef.current = null;
		}
		if (cancelPlayRef.current) {
			cancelPlayRef.current();
			cancelPlayRef.current = null;
		}
		
		setPlayingNoteCharacterId(character.id);
		
		let cancelled = false;
		cancelPlayRef.current = () => {
			cancelled = true;
		};
		
		try {
			// 确定使用的音色
			const voice = character.voice || ttsConfig.voice || "冰糖";
			// 构建播放文本：角色名 + 备注
			const playText = `${character.name}。${character.notes}`;
			
			logger.tts("播放角色备注", { character: character.name, voice, text: playText.slice(0, 50) + "..." });
			
			// 合成音频
			const audioBuffer = await synthesizeSpeechWithVoice(playText, ttsConfig, voice);
			
			if (cancelled) {
				logger.tts("播放已取消", { character: character.name });
				return;
			}
			
			// 播放音频
			const blob = new Blob([audioBuffer], { type: "audio/mp3" });
			const url = URL.createObjectURL(blob);
			const audio = new Audio();
			audioRef.current = audio;
			
			audio.onended = () => {
				URL.revokeObjectURL(url);
				setPlayingNoteCharacterId(null);
				audioRef.current = null;
			};
			
			audio.onerror = (e) => {
				URL.revokeObjectURL(url);
				logger.errorGeneric("播放备注失败", { error: e });
				setPlayingNoteCharacterId(null);
				audioRef.current = null;
			};
			
			audio.src = url;
			audio.load();
			audio.play().catch((error) => {
				logger.errorGeneric("开始播放失败", { error });
				setPlayingNoteCharacterId(null);
				audioRef.current = null;
			});
		} catch (error) {
			logger.errorGeneric("播放备注失败", { error });
			setPlayingNoteCharacterId(null);
		}
	}, [playingNoteCharacterId, ttsConfig]);

	return (<>
		<div className="modal-overlay" onClick={onClose}>
			<div className="character-settings-modal" onClick={(e) => e.stopPropagation()}>
				<div className="config-header">
					<div className="config-title">
						<span className="title-icon"><Icons.user size={16} /></span>
						<span>角色设置</span>
					</div>
					<button className="close-btn" onClick={onClose}>
						<svg
							width="16"
							height="16"
							viewBox="0 0 16 16"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
						>
							<path d="M3 3L13 13M13 3L3 13" />
						</svg>
					</button>
				</div>

				<div className="config-tabs">
					<button
						className={`tab-btn ${activeTab === "list" ? "active" : ""}`}
						onClick={() => setActiveTab("list")}
					>
						<Icons.list size={14} />
						角色列表
					</button>
					<button
						className={`tab-btn ${activeTab === "graph" ? "active" : ""}`}
						onClick={() => setActiveTab("graph")}
					>
						<Icons.sparkle size={14} />
						关系图谱
					</button>
				</div>

				<div className={`config-body${draggedIndex !== null ? ' dragging' : ''}`}>
					{activeTab === "graph" && !showAddForm && (
						<RelationshipGraph
							novelId={novelId}
							characters={characters}
						/>
					)}
					{showAddForm && (
						<div className="space-y-3">
							<div className="form-field">
								<label>角色名</label>
								<div className="input-wrapper">
									<input
										type="text"
										value={editForm.name}
										onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
										placeholder="请输入角色名"
										className="config-input"
									/>
								</div>
							</div>
							<div className="form-field">
								<label>性别</label>
								<Select
									value={editForm.gender || "other"}
									onChange={(v) => setEditForm({ ...editForm, gender: v as "male" | "female" | "other" })}
									options={[
										{ value: "male", label: "男" },
										{ value: "female", label: "女" },
										{ value: "other", label: "其他" },
									]}
								/>
							</div>

							<div className="form-field">
								<label>角色类型</label>
								<Select
									value={editForm.role || ""}
									onChange={(v) => setEditForm({ ...editForm, role: v ? (v as CharacterRole) : undefined })}
									options={[
										{ value: "", label: "未设置" },
										{ value: "protagonist", label: "男主" },
										{ value: "heroine", label: "女主" },
										{ value: "antagonist", label: "反派" },
										{ value: "supportingMale", label: "男配" },
										{ value: "supportingFemale", label: "女配" },
										{ value: "mentor", label: "导师" },
										{ value: "rival", label: "对手" },
										{ value: "loveInterest", label: "爱慕对象" },
										{ value: "family", label: "家人" },
										{ value: "friend", label: "朋友" },
										{ value: "npc", label: "NPC" },
									]}
								/>
							</div>

							{/* 别称 */}
							<div className="form-field">
								<label>别称 <span className="text-xs text-neutral-500">(如：我、主角等)</span></label>
								<div className="flex gap-2 mb-2">
									<input
										type="text"
										value={newAlias}
										onChange={(e) => setNewAlias(e.target.value)}
										onKeyPress={(e) => e.key === "Enter" && (e.preventDefault(), addAlias())}
										placeholder="输入别称后按回车添加"
										className="config-input flex-1"
									/>
									<button
										type="button"
										className="px-3 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm text-white transition-all"
										onClick={addAlias}
									>
										<Icons.plus size={14} />
									</button>
								</div>
								{(editForm.aliases || []).length > 0 && (
									<div className="flex flex-wrap gap-2">
										{(editForm.aliases || []).map((alias, index) => (
											<span key={index} className="alias-tag">
												{alias}
												<button
													type="button"
													className="remove-btn"
													onClick={() => removeAlias(index)}
												>
													×
												</button>
											</span>
										))}
									</div>
								)}
							</div>

							{/* 关系代称 */}
							<div className="form-field">
								<label>关系代称 <span className="text-xs text-neutral-500">(如：老婆、老公等)</span></label>
								<div className="flex gap-2 mb-2">
									<input
										type="text"
										value={newRelationTerm}
										onChange={(e) => setNewRelationTerm(e.target.value)}
										onKeyPress={(e) => e.key === "Enter" && (e.preventDefault(), addRelationTerm())}
										placeholder="输入关系代称后按回车添加"
										className="config-input flex-1"
									/>
									<button
										type="button"
										className="px-3 py-2 bg-purple-600 hover:bg-purple-500 rounded text-sm text-white transition-all"
										onClick={addRelationTerm}
									>
										<Icons.plus size={14} />
									</button>
								</div>
								{(editForm.relationTerms || []).length > 0 && (
									<div className="flex flex-wrap gap-2">
										{(editForm.relationTerms || []).map((term, index) => (
											<span key={index} className="relation-tag">
												{term}
												<button
													type="button"
													className="remove-btn"
													onClick={() => removeRelationTerm(index)}
												>
													×
												</button>
											</span>
										))}
									</div>
								)}
							</div>

							<div className="form-field">
								<label>指定音色</label>
								<Select
									value={editForm.voice || ""}
									onChange={(v) => setEditForm({ ...editForm, voice: v })}
									options={[{ value: "", label: "自动选择" }, ...voiceOptions]}
								/>
							</div>
							<div className="form-field">
								<label>备注</label>
								<textarea
									value={editForm.notes || ""}
									onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
									placeholder="可选的备注信息"
									className="config-input"
									style={{ minHeight: "60px" }}
								/>
							</div>
							<div className="flex gap-2 pt-2">
							<button
								className="reader-search-btn flex-1 justify-center"
								onClick={handleAdd}
							>
								<Icons.plus size={14} />
								添加
							</button>
							<button
								className="reader-search-btn"
								onClick={() => {
									setShowAddForm(false);
									setEditForm({ name: "", gender: "other", role: undefined, notes: "", voice: "", aliases: [], relationTerms: [] });
									setNewAlias("");
									setNewRelationTerm("");
								}}
							>
								取消
							</button>
						</div>
						</div>
					)}

					{/* 角色列表 */}
					{activeTab === "list" && characters.length > 0 && (
						<div className="config-section">
							<div className="section-label">
								<Icons.user size={14} />
								角色列表 ({characters.length})
							</div>

							{isDragMode ? (
								<div className="space-y-2">
									{sortedCharacters.map((char, index) => (
										<div
											key={char.id}
											className={`drag-item ${draggedIndex === index ? 'dragging' : ''}`}
											draggable
											onDragStart={() => setDraggedIndex(index)}
											onDragOver={(e) => {
												e.preventDefault();
												if (draggedIndex !== null && draggedIndex !== index) {
													const newCharacters = [...sortedCharacters];
													const [removed] = newCharacters.splice(draggedIndex, 1);
													newCharacters.splice(index, 0, removed);
													const updatedOrders = newCharacters.map((c, i) => ({ ...c, order: i }));
													updatedOrders.forEach((c) => {
														updateCharacter(novelId, c.id, { order: c.order });
													});
													setDraggedIndex(index);
												}
											}}
											onDragEnd={() => setDraggedIndex(null)}
											onTouchStart={(e) => {
												touchStartIndexRef.current = index;
												touchCurrentIndexRef.current = index;
												touchStartYRef.current = e.touches[0].clientY;
												touchIsDraggingRef.current = true;
												setDraggedIndex(index);
											}}
											onTouchMove={(e) => {
												if (!touchIsDraggingRef.current) return;
												const currentIdx = touchCurrentIndexRef.current;
												if (currentIdx === null) return;
												const deltaY = e.touches[0].clientY - touchStartYRef.current;
												const itemHeight = 48;
												if (Math.abs(deltaY) > itemHeight / 2) {
													const direction = deltaY > 0 ? 1 : -1;
													const newIndex = currentIdx + direction;
													if (newIndex >= 0 && newIndex < sortedCharacters.length && newIndex !== currentIdx) {
														const newCharacters = [...sortedCharacters];
														const [removed] = newCharacters.splice(currentIdx, 1);
														newCharacters.splice(newIndex, 0, removed);
														const updatedOrders = newCharacters.map((c, i) => ({ ...c, order: i }));
														updatedOrders.forEach((c) => {
															updateCharacter(novelId, c.id, { order: c.order });
														});
														touchStartYRef.current = e.touches[0].clientY;
														touchCurrentIndexRef.current = newIndex;
														setDraggedIndex(newIndex);
													}
												}
											}}
											onTouchEnd={() => {
												touchIsDraggingRef.current = false;
												touchStartIndexRef.current = null;
												touchCurrentIndexRef.current = null;
												setDraggedIndex(null);
											}}
										>
											<span className="drag-order">{index + 1}</span>
											<span className="drag-name">{char.name}</span>
											{char.role && (
												<span className="drag-role">
													{char.role === "protagonist" ? "男主" :
													 char.role === "heroine" ? "女主" :
													 char.role === "antagonist" ? "反派" :
													 char.role === "supportingMale" ? "男配" :
													 char.role === "supportingFemale" ? "女配" :
													 char.role === "mentor" ? "导师" :
													 char.role === "rival" ? "对手" :
													 char.role === "loveInterest" ? "爱慕对象" :
													 char.role === "family" ? "家人" :
													 char.role === "friend" ? "朋友" : "NPC"}
												</span>
											)}
										</div>
									))}
								</div>
							) : (
								<div>
									{sortedCharacters.map((char) => (
										<div key={char.id} className="character-card">
										{editingId === char.id ? (
											<div className="space-y-3">
												<div className="form-field">
													<label>角色名</label>
													<input
														type="text"
														value={editForm.name || ""}
														onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
														className="config-input"
													/>
												</div>
												<div className="grid grid-cols-2 gap-3">
													<div className="form-field">
														<label>性别</label>
														<Select
															value={editForm.gender || "other"}
															onChange={(v) => setEditForm({ ...editForm, gender: v as "male" | "female" | "other" })}
															options={[
																{ value: "male", label: "男" },
																{ value: "female", label: "女" },
																{ value: "other", label: "其他" },
															]}
														/>
													</div>
													<div className="form-field">
														<label>角色类型</label>
														<Select
															value={editForm.role || ""}
															onChange={(v) => setEditForm({ ...editForm, role: v ? (v as CharacterRole) : undefined })}
															options={[
																{ value: "", label: "未设置" },
																{ value: "protagonist", label: "男主" },
																{ value: "heroine", label: "女主" },
																{ value: "antagonist", label: "反派" },
																{ value: "supportingMale", label: "男配" },
																{ value: "supportingFemale", label: "女配" },
																{ value: "mentor", label: "导师" },
																{ value: "rival", label: "对手" },
																{ value: "loveInterest", label: "爱慕对象" },
																{ value: "family", label: "家人" },
																{ value: "friend", label: "朋友" },
																{ value: "npc", label: "NPC" },
															]}
														/>
													</div>
												</div>
												<div className="form-field">
													<label>音色</label>
													<Select
														value={editForm.voice || ""}
														onChange={(v) => setEditForm({ ...editForm, voice: v })}
														options={[{ value: "", label: "自动选择" }, ...voiceOptions]}
													/>
												</div>

												{/* 别称 */}
												<div className="form-field">
													<div className="flex justify-between items-center mb-2">
														<label className="text-xs">别称</label>
														{(editForm.aliases || []).length > 0 && (
															<button
																type="button"
																className="text-xs text-red-500 hover:text-red-400"
																onClick={clearAllAliases}
															>
																清空全部
															</button>
														)}
													</div>
													<div className="flex gap-2 mb-2">
														<input
															type="text"
															value={newAlias}
															onChange={(e) => setNewAlias(e.target.value)}
															onKeyPress={(e) => e.key === "Enter" && (e.preventDefault(), addAlias())}
															placeholder="输入后按回车"
															className="config-input flex-1"
														/>
														<button
															type="button"
															className="px-2 py-1 bg-blue-600 hover:bg-blue-500 rounded text-xs text-white"
															onClick={addAlias}
														>
															<Icons.plus size={12} />
														</button>
													</div>
													{(editForm.aliases || []).length > 0 && (
														<div className="flex flex-wrap gap-1">
															{(editForm.aliases || []).map((alias, index) => (
																<span key={index} className="alias-tag text-xs">
																	{alias}
																	<button
																		type="button"
																		className="remove-btn"
																		onClick={() => removeAlias(index)}
																	>
																		×
																	</button>
																</span>
															))}
														</div>
													)}
												</div>

												{/* 关系代称 */}
												<div className="form-field">
													<div className="flex justify-between items-center mb-2">
														<label className="text-xs">关系代称</label>
														{(editForm.relationTerms || []).length > 0 && (
															<button
																type="button"
																className="text-xs text-red-500 hover:text-red-400"
																onClick={clearAllRelationTerms}
															>
																清空全部
															</button>
														)}
													</div>
													<div className="flex gap-2 mb-2">
														<input
															type="text"
															value={newRelationTerm}
															onChange={(e) => setNewRelationTerm(e.target.value)}
															onKeyPress={(e) => e.key === "Enter" && (e.preventDefault(), addRelationTerm())}
															placeholder="输入后按回车"
															className="config-input flex-1"
														/>
														<button
															type="button"
															className="px-2 py-1 bg-purple-600 hover:bg-purple-500 rounded text-xs text-white"
															onClick={addRelationTerm}
														>
															<Icons.plus size={12} />
														</button>
													</div>
													{(editForm.relationTerms || []).length > 0 && (
														<div className="flex flex-wrap gap-1">
															{(editForm.relationTerms || []).map((term, index) => (
																<span key={index} className="relation-tag text-xs">
																	{term}
																	<button
																		type="button"
																		className="remove-btn"
																		onClick={() => removeRelationTerm(index)}
																	>
																		×
																	</button>
																</span>
															))}
														</div>
													)}
												</div>

												<div className="form-field">
													<label>备注</label>
													<textarea
														value={editForm.notes || ""}
														onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
														className="config-input"
													/>
												</div>
												<div className="flex gap-2 pt-2">
													<button
														className="character-action-btn"
														onClick={saveEdit}
													>
														<Icons.saveIcon size={14} />
														<span>保存</span>
													</button>
													<button
														className="character-action-btn"
														onClick={cancelEdit}
													>
														<Icons.x size={14} />
														<span>取消</span>
													</button>
												</div>
											</div>
										) : (
											<div className="character-card-content">
												{/* 第一区块：头像 + 名称/性别/角色 + 音色 + 操作按钮 */}
												<div className="character-main-section">
													{/* 头像区域 */}
													<div className="character-avatar">
														<div className={`avatar-circle ${char.gender}`}>
															<span className="avatar-text">{char.name.charAt(0)}</span>
														</div>
													</div>

													{/* 信息区域 */}
													<div className="character-info">
														<div className="character-header">
															<h3 className="character-name">{char.name}</h3>
															<span className={`gender-badge ${char.gender}`}>
																{char.gender === "male" ? "男" : char.gender === "female" ? "女" : "其他"}
															</span>
															{char.role && (
																<span className="role-badge">
																	{char.role === "protagonist" ? "男主" :
																	 char.role === "heroine" ? "女主" :
																	 char.role === "antagonist" ? "反派" :
																	 char.role === "supportingMale" ? "男配" :
																	 char.role === "supportingFemale" ? "女配" :
																	 char.role === "mentor" ? "导师" :
																	 char.role === "rival" ? "对手" :
																	 char.role === "loveInterest" ? "爱慕对象" :
																	 char.role === "family" ? "家人" :
																	 char.role === "friend" ? "朋友" : "NPC"}
																</span>
															)}
														</div>

														<div className="detail-item voice-detail">
															<Icons.volume size={14} />
															<span className="detail-label">音色:</span>
															<span className="detail-value">
																{char.voice ? voiceOptions.find(o => o.value === char.voice)?.label || char.voice : "自动选择"}
															</span>
														</div>
													</div>

													{/* 操作按钮 */}
													<div className="character-actions">
														<button
															className="action-btn delete"
															onClick={() => handleDelete(char.id)}
															title="删除"
														>
															<Icons.trash2 size={16} />
														</button>
														<button
															className="action-btn edit"
															onClick={() => startEdit(char)}
															title="编辑"
														>
															<Icons.userRoundPen size={18} />
														</button>
													</div>
												</div>

												{/* 第二区块：别称 + 代称 */}
												{((char.aliases && char.aliases.length > 0) || (char.relationTerms && char.relationTerms.length > 0)) && (
													<div className="character-tags-section">
														{(char.aliases && char.aliases.length > 0) && (
															<div className="detail-item aliases">
																<span className="detail-label">别称:</span>
																<div className="tags-list">
																	{char.aliases.map((alias, index) => (
																		<span key={index} className="alias-badge">{alias}</span>
																	))}
																</div>
															</div>
														)}
														{(char.relationTerms && char.relationTerms.length > 0) && (
															<div className="detail-item relations">
																<span className="detail-label">代称:</span>
																<div className="tags-list">
																	{char.relationTerms.map((term, index) => (
																		<span key={index} className="relation-badge">{term}</span>
																	))}
																</div>
															</div>
														)}
													</div>
												)}

												{/* 第三区块：备注 */}
												{char.notes && (
													<div className="character-notes-section">
														<div className="notes-label">
															<Icons.punctuation size={14} />
															备注
															<button
																className={`notes-play-btn ${playingNoteCharacterId === char.id ? 'playing' : ''}`}
																onClick={(e) => {
																	e.stopPropagation();
																	handlePlayNote(char);
																}}
																title={playingNoteCharacterId === char.id ? '停止播放' : '播放备注'}
															>
																{playingNoteCharacterId === char.id ? (
																	<Icons.pause size={14} />
																) : (
																	<Icons.volume size={14} />
																)}
															</button>
														</div>
														<div className="notes-content">{char.notes}</div>
													</div>
												)}
											</div>
										)}
									</div>
								))}
							</div>
							)}
						</div>
					)}

					{/* 空状态 */}
					{characters.length === 0 && !showAddForm && (
						<div className="text-center py-12">
							<div className="w-16 h-16 mx-auto mb-4 bg-neutral-700 rounded-full flex items-center justify-center">
								<Icons.user size={32} className="text-neutral-500" />
							</div>
							<p className="text-neutral-400 text-lg mb-2">还没有添加角色</p>
							<p className="text-neutral-500 text-sm">点击上方按钮添加第一个角色</p>
						</div>
					)}
				</div>

				{/* 底部操作按钮 */}
				{activeTab === "list" && !showAddForm && (
					<div className="character-actions-fab-wrapper">
						<button
							className="action-btn add-character"
							onClick={() => setShowAddForm(true)}
							title="添加角色"
						>
							<Icons.userRoundPlus size={18} />
							<span>添加</span>
						</button>
						<button
							className="action-btn character-action"
							onClick={handleExportCharacters}
							title="导出小说设置"
						>
							<Icons.save size={18} />
							<span>导出</span>
						</button>
						<button
							className="action-btn character-action"
							onClick={handleImportCharacters}
							title="导入小说设置"
						>
							<Icons.import size={18} />
							<span>导入</span>
						</button>
						<button
							className="action-btn character-action"
							onClick={handleScanCharacters}
							title="扫描检测角色"
							disabled={isScanning}
						>
							<Icons.search size={18} />
							<span>{isScanning ? "扫描中" : "扫描"}</span>
						</button>
						<button
							className="action-btn character-action"
							onClick={handleScanHighFrequencyWords}
							title="高频词汇检测"
							disabled={isScanning}
						>
							<Icons.list size={18} />
							<span>高频词</span>
						</button>
						<button
							className="action-btn character-action"
							onClick={() => setShowAnalyzeModal(true)}
							title="AI分析角色"
							disabled={isAnalyzing || isScanning}
						>
							<Icons.sparkle size={18} />
							<span>{isAnalyzing ? "分析中" : "AI分析"}</span>
						</button>
						<button
							className={`action-btn character-action ${isDragMode ? 'active' : ''}`}
							onClick={() => setIsDragMode(!isDragMode)}
							title="拖拽排序"
						>
							<Icons.listOrdered size={18} />
							<span>排序</span>
						</button>
					</div>
				)}
			</div>
		</div>

		{/* 检测到的新角色弹窗 */}
		{showDetectModal && (
			<div className="modal-overlay" onClick={() => setShowDetectModal(false)}>
				<div className="modal-content detect-characters-modal" onClick={e => e.stopPropagation()}>
					<div className="modal-header">
						<h3>检测到的角色</h3>
						<div className="detect-search-wrapper">
							<input
								type="text"
								className="detect-search-input"
								placeholder="搜索角色名称..."
								value={detectSearchQuery}
								onChange={(e) => setDetectSearchQuery(e.target.value)}
							/>
							{detectSearchQuery && (
								<button
									className="detect-search-clear"
									onClick={() => setDetectSearchQuery("")}
								>
									×
								</button>
							)}
						</div>
						<button className="modal-close" onClick={() => setShowDetectModal(false)}>
							<Icons.close size={18} />
						</button>
					</div>
					<div className="modal-body">
						<div className="detection-header-row">
							<button
								className="select-all-btn"
								onClick={() => handleToggleAll(true)}
							>
								全选
							</button>
							<button
								className="select-none-btn"
								onClick={() => handleToggleAll(false)}
							>
								取消全选
							</button>
							<span className="text-sm text-neutral-400">
								{(() => {
									const filtered = detectedCharacters.filter(c => c.name.includes(detectSearchQuery));
									return detectSearchQuery
										? `找到 ${filtered.length} 个匹配 "${detectSearchQuery}" 的角色`
										: `从小说中检测到 ${detectedCharacters.length} 个可能的新角色，请选择操作`;
								})()}
							</span>
						</div>
						<div className="detected-characters-list">
							{detectedCharacters
								.filter(char => char.name.includes(detectSearchQuery))
								.map(char => {
								const selection = detectedSelections[char.name];
								if (!selection) return null;
								return (
									<div key={char.name} className="detected-character-item">
										<div className="detected-character-main">
											<label className="detected-character-label">
												<input
													type="checkbox"
													checked={selection.selected}
													onChange={(e) => {
														setDetectedSelections(prev => ({
															...prev,
															[char.name]: {
																...prev[char.name],
																selected: e.target.checked,
															},
														}));
													}}
												/>
												<span className="character-name">{char.name}</span>
												<span className="character-freq">出现 {char.frequency} 次</span>
												<span className="character-confidence" title={`置信度: ${(char.confidence * 100).toFixed(1)}%`}>
													{(char.confidence * 100).toFixed(0)}%
												</span>
											</label>
										</div>
										{selection.selected && (
											<div className="detected-character-actions">
												<div className="action-radios">
													<label className="action-radio">
														<input
															type="radio"
															name={`action-${char.name}`}
															checked={selection.action === 'new'}
															onChange={() => {
																setDetectedSelections(prev => ({
																	...prev,
																	[char.name]: {
																		...prev[char.name],
																		action: 'new',
																	},
																}));
															}}
														/>
														<span>新增角色</span>
													</label>
													<label className="action-radio">
														<input
															type="radio"
															name={`action-${char.name}`}
															checked={selection.action === 'alias'}
															onChange={() => {
																setDetectedSelections(prev => ({
																	...prev,
																	[char.name]: {
																		...prev[char.name],
																		action: 'alias',
																	},
																}));
															}}
														/>
														<span>添加为别名</span>
													</label>
													<label className="action-radio">
														<input
															type="radio"
															name={`action-${char.name}`}
															checked={selection.action === 'relation'}
															onChange={() => {
																setDetectedSelections(prev => ({
																	...prev,
																	[char.name]: {
																		...prev[char.name],
																		action: 'relation',
																	},
																}));
															}}
														/>
														<span>添加为代称</span>
													</label>
												</div>
												{(selection.action === 'alias' || selection.action === 'relation') && (
													<div className="merge-target-select">
														<Select
															value={selection.mergeTargetId || ''}
															onChange={(value) => {
																setDetectedSelections(prev => ({
																	...prev,
																	[char.name]: {
																		...prev[char.name],
																		mergeTargetId: value || undefined,
																	},
																}));
															}}
															options={[
																{ value: "", label: "选择目标角色" },
																...characters.map(c => ({ value: c.id, label: c.name }))
															]}
														/>
													</div>
												)}
											</div>
										)}
										{char.evidence.length > 0 && (
											<div className="character-contexts">
												{char.evidence.map((ctx, i) => (
													<div key={i} className="context-item">{ctx}</div>
												))}
											</div>
										)}
										<div className="detected-character-quick-actions">
											<button
												className="quick-btn quick-skip"
												onClick={() => {
													setDetectedCharacters(prev => prev.filter(c => c.name !== char.name));
													setDetectedSelections(prev => {
														const newSelections = { ...prev };
														delete newSelections[char.name];
														return newSelections;
													});
												}}
											>
												跳过
											</button>
											<button
												className="quick-btn quick-ignore"
												onClick={() => {
													addIgnoredCharacterName(novelId, char.name);
													setDetectedCharacters(prev => prev.filter(c => c.name !== char.name));
													setDetectedSelections(prev => {
														const newSelections = { ...prev };
														delete newSelections[char.name];
														return newSelections;
													});
												}}
											>
												忽略
											</button>
											<button
												className="quick-btn quick-add"
												onClick={() => {
													addCharacter(novelId, {
														name: char.name,
														gender: "other",
														notes: `自动检测到 ${char.frequency} 次，置信度 ${(char.confidence * 100).toFixed(1)}%\n` +
														       `依据：${char.evidence?.join('; ') || '无'}`,
														voice: "",
														aliases: [],
														relationTerms: [],
													});
													setDetectedCharacters(prev => prev.filter(c => c.name !== char.name));
													setDetectedSelections(prev => {
														const newSelections = { ...prev };
														delete newSelections[char.name];
														return newSelections;
													});
												}}
											>
												确认添加
											</button>
										</div>
									</div>
								);
							})}
						</div>
					</div>
					<div className="modal-footer">
						<button
							className="btn btn-secondary"
							onClick={() => setShowDetectModal(false)}
						>
							取消
						</button>
						<button
							className="btn btn-primary"
							onClick={handleAddSelectedCharacters}
							disabled={Object.values(detectedSelections).filter(s => s.selected && (s.action === 'new' || !!s.mergeTargetId)).length === 0}
						>
							确认添加
						</button>
					</div>
				</div>
			</div>
		)}

		{/* 高频词汇弹窗 */}
		{showWordsModal && (
			<div className="modal-overlay" onClick={() => setShowWordsModal(false)}>
				<div className="modal-content detect-characters-modal" onClick={e => e.stopPropagation()}>
					<div className="modal-header">
						<h3>高频词汇列表</h3>
						<button className="modal-close" onClick={() => setShowWordsModal(false)}>
							<Icons.close size={18} />
						</button>
					</div>
					<div className="modal-body">
						<p className="text-sm text-neutral-400 mb-4">
							从小说中检测到 {detectedWords.length} 个高频词，其中 {detectedWords.filter(w => w.isPossibleName).length} 个可能是角色名：
						</p>
						<div className="detected-characters-list">
							{detectedWords.map((word, index) => (
								<div key={index} className="detected-character-item">
									<div className="detected-character-main">
										<span className={`character-name ${word.isPossibleName ? 'text-blue-400' : ''}`}>
											{word.word}
										</span>
										<span className="character-freq">出现 {word.frequency} 次</span>
										{word.isPossibleName && (
											<span className="character-confidence text-blue-400">
												可能为人名
											</span>
										)}
									</div>
									{word.evidence.length > 0 && (
										<div className="character-contexts">
											{word.evidence.map((ctx, i) => (
												<div key={i} className="context-item">{ctx}</div>
											))}
										</div>
									)}
									<div className="detected-character-quick-actions">
										<button
											className="quick-btn quick-ignore"
											onClick={() => {
												addIgnoredCharacterName(novelId, word.word);
												setDetectedWords(prev => prev.filter((_, i) => i !== index));
											}}
										>
											忽略
										</button>
									</div>
								</div>
							))}
						</div>
					</div>
					<div className="modal-footer">
						<button
							className="btn btn-secondary"
							onClick={() => setShowWordsModal(false)}
						>
							关闭
						</button>
					</div>
				</div>
			</div>
		)}

		{/* AI分析角色弹窗 */}
		{showAnalyzeModal && (
			<div className="modal-overlay" onClick={() => !isAnalyzing && setShowAnalyzeModal(false)}>
				<div className="modal-content detect-characters-modal" onClick={e => e.stopPropagation()}>
					<div className="modal-header">
						<h3>AI 角色分析</h3>
						{!isAnalyzing && (
							<button className="modal-close" onClick={() => setShowAnalyzeModal(false)}>
								<Icons.close size={18} />
							</button>
						)}
					</div>
					<div className="modal-body">
						{analyzeError && (
							<div className="text-red-400 mb-4 p-3 bg-red-900/20 rounded">
								<p className="font-bold">分析失败</p>
								<p className="text-sm">{analyzeError}</p>
							</div>
						)}
						{isAnalyzing ? (
							<div className="analyze-progress-container">
								<div className="analyze-icon-wrapper">
									<Icons.sparkle size={40} className="analyze-icon animate-pulse" />
									<div className="analyze-icon-ring"></div>
								</div>
								<p className="analyze-title">正在分析小说内容</p>
								<p className="analyze-subtitle">提取角色人物小传与关系图谱...</p>
								<div className="analyze-progress-bar">
									<div
										className="analyze-progress-fill"
										style={{
											width: analyzeProgress.total > 0
												? `${(analyzeProgress.current / analyzeProgress.total) * 100}%`
												: '0%'
										}}
									/>
								</div>
								<div className="analyze-progress-info">
									<span className="analyze-batch">
										<Icons.list size={14} />
										批次 {analyzeProgress.current} / {analyzeProgress.total}
									</span>
									<span className="analyze-percent">
										{analyzeProgress.total > 0
											? Math.round((analyzeProgress.current / analyzeProgress.total) * 100)
											: 0}%
									</span>
								</div>
								<p className="analyze-hint">
									<Icons.clock size={12} />
									预计需要几分钟，请勿关闭应用
								</p>
							</div>
						) : (
							<div className="space-y-4">
								<p className="text-sm text-neutral-400">
									AI 将分析整本小说内容，提取角色人物小传和关系图谱信息。
								</p>
								<div className="bg-neutral-800/50 p-4 rounded text-sm space-y-2">
									<p className="text-accent">功能特点：</p>
									<ul className="list-disc list-inside text-neutral-300 space-y-1">
										<li>自动识别小说中的主要角色</li>
										<li>提取角色外貌、性格、背景描述</li>
										<li>分析角色之间的关系</li>
										<li>支持超大文本（1M+ tokens）</li>
									</ul>
								</div>
								<p className="text-xs text-neutral-500">
									注意：分析结果会消耗 AI API 调用配额，请确保已配置有效的 API Key
								</p>
							</div>
						)}
					</div>
					<div className="modal-footer">
						{isAnalyzing ? (
							<button
								className="btn btn-secondary"
								onClick={() => {
									// 取消分析 - 需要通过 abort controller
									setIsAnalyzing(false);
									setShowAnalyzeModal(false);
								}}
							>
								取消分析
							</button>
						) : (
							<>
								<button
									className="btn btn-secondary"
									onClick={() => setShowAnalyzeModal(false)}
								>
									关闭
								</button>
								<button
									className="btn btn-primary"
									onClick={handleAnalyzeCharacters}
								>
									<Icons.sparkle size={16} />
									开始分析
								</button>
							</>
						)}
					</div>
				</div>
			</div>
		)}

		{/* 导出结果弹窗 */}
		{exportModal.show && (
			<div className="modal-overlay" onClick={() => setExportModal({ ...exportModal, show: false })}>
				<div className="export-result-modal" onClick={(e) => e.stopPropagation()}>
					<div className="export-result-header">
						<div className={`result-icon ${exportModal.success ? 'success' : 'error'}`}>
							{exportModal.success ? <Icons.checkCircle size={24} /> : <Icons.alertCircle size={24} />}
						</div>
						<h3>{exportModal.success ? '保存成功' : '保存失败'}</h3>
					</div>
					<div className="export-result-content">
						{exportModal.success ? (
							<div className="space-y-2">
								<p><strong>文件名:</strong> {exportModal.fileName}</p>
								<p><strong>保存位置:</strong> Android/data/cn.helilab.proofreader/documents/characters/</p>
								<p><strong>角色数量:</strong> {exportModal.characterCount}个</p>
								<p><strong>关系数量:</strong> {exportModal.relationshipCount || 0}条</p>
							</div>
						) : (
							<div className="space-y-2">
								<p>无法自动保存到文件系统</p>
								<p><strong>文件名:</strong> {exportModal.fileName}</p>
								<p><strong>角色数量:</strong> {exportModal.characterCount}个</p>
								<p><strong>关系数量:</strong> {exportModal.relationshipCount || 0}条</p>
								<p><strong>数据大小:</strong> {exportModal.dataStr.length}字节</p>
								<p className="text-sm text-neutral-400">请尝试复制数据后自行保存</p>
							</div>
						)}
					</div>
					<div className="export-result-actions">
						<button
							className="action-btn secondary"
							onClick={() => setExportModal({ ...exportModal, show: false })}
						>
							<Icons.x size={16} />
							关闭
						</button>
						<button
							className="action-btn primary"
							onClick={() => copyToClipboard(exportModal.dataStr)}
						>
							<Icons.copy size={16} />
							复制JSON数据
						</button>
					</div>
				</div>
			</div>
		)}
	</>);
}
