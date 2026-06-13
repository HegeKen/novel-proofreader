// ============================================================
// 角色设置组件
// ============================================================
import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useNovelStore } from "../stores/novelStore";
import { useAIConfigStore } from "../stores/aiConfigStore";
import { useCharacterStore } from "../stores/characterStore";
import { useProofreadMetaStore } from "../stores/proofreadMetaStore";
import { useAppMetaStore } from "../stores/appMetaStore";
import { useConfigStore } from "../stores/configStore";
import type { CharacterInfo, CharacterRelationship, CharacterRole, NovelCategory, RelationType } from "../types";
import { synthesizeSpeechWithVoice } from "../utils/ttsService";
import { Icons } from "./Icons";
import { Select } from "./Select";
import { logger } from "../utils/logger";
import { saveCharacterConfigToStorage, loadCharacterConfigFromStorage, getCharacterConfigFileName } from "../utils/fileExport";
import type { DetectedCharacter } from "../utils/fileExport";
import { analyzeCharactersInBatches, reanalyzeCharacterBiography, generateVoiceDesign } from "../utils/aiClient";
import { formatDateTime } from "../utils/formatters";
import { RelationshipGraph } from "./RelationshipGraph";

// ============================================================
// 角色排序组件 - 使用 Pointer Events 实现跨平台拖拽
// ============================================================
interface CharacterSortingSectionProps {
	novelId: string;
	characters: CharacterInfo[];
	updateCharacter: (novelId: string, charId: string, updates: Partial<CharacterInfo>) => void;
}

export function CharacterSortingSection({ novelId, characters, updateCharacter }: CharacterSortingSectionProps) {
	const [dragState, setDragState] = useState<{
		isDragging: boolean;
		draggedIndex: number | null;
		dragOverIndex: number | null;
		startY: number;
		currentY: number;
	}>({
		isDragging: false,
		draggedIndex: null,
		dragOverIndex: null,
		startY: 0,
		currentY: 0,
	});
	
	const containerRef = useRef<HTMLDivElement>(null);
	const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
	const dragThresholdRef = useRef(10); // 拖拽触发阈值
	const isDraggingRef = useRef(false);
	
	// 排序后的角色列表
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
	
	// 重新排序角色
	const reorderCharacters = useCallback((fromIndex: number, toIndex: number) => {
		if (fromIndex === toIndex) return;
		
		const newCharacters = [...sortedCharacters];
		const [removed] = newCharacters.splice(fromIndex, 1);
		newCharacters.splice(toIndex, 0, removed);
		
		// 更新所有角色的 order 字段
		newCharacters.forEach((char, index) => {
			updateCharacter(novelId, char.id, { order: index });
		});
	}, [sortedCharacters, novelId, updateCharacter]);
	
	// 计算拖拽目标位置
	const calculateDropIndex = useCallback((currentIndex: number, deltaY: number) => {
		if (!containerRef.current) return currentIndex;
		
		const items = Array.from(itemRefs.current.values());
		if (items.length === 0) return currentIndex;
		
		// 计算当前拖拽位置
		const draggedItem = items[currentIndex];
		if (!draggedItem) return currentIndex;
		
		const draggedRect = draggedItem.getBoundingClientRect();
		const draggedCenterY = draggedRect.top + draggedRect.height / 2 + deltaY;
		
		// 找到最接近的位置
		let newIndex = currentIndex;
		for (let i = 0; i < items.length; i++) {
			if (i === currentIndex) continue;
			
			const item = items[i];
			const rect = item.getBoundingClientRect();
			const centerY = rect.top + rect.height / 2;
			
			// 判断是否应该交换位置
			if (i < currentIndex && draggedCenterY < centerY) {
				newIndex = i;
				break;
			} else if (i > currentIndex && draggedCenterY > centerY) {
				newIndex = i;
			}
		}
		
		return newIndex;
	}, []);
	
	// Pointer 事件处理
	const handlePointerDown = useCallback((e: React.PointerEvent, index: number) => {
		// 记录初始位置
		setDragState({
			isDragging: false,
			draggedIndex: index,
			dragOverIndex: null,
			startY: e.clientY,
			currentY: e.clientY,
		});
		
		// 设置 pointer capture，确保后续事件都能被捕获
		const target = e.currentTarget as HTMLDivElement;
		target.setPointerCapture(e.pointerId);
		
		// 阻止默认行为（如文本选择）
		e.preventDefault();
	}, []);
	
	const handlePointerMove = useCallback((e: React.PointerEvent) => {
		if (dragState.draggedIndex === null) return;
		
		const deltaY = e.clientY - dragState.startY;
		
		// 检测是否开始拖拽（需要超过阈值）
		if (!dragState.isDragging && Math.abs(deltaY) > dragThresholdRef.current) {
			setDragState(prev => ({
				...prev,
				isDragging: true,
				currentY: e.clientY,
			}));
			isDraggingRef.current = true;
		} else if (dragState.isDragging) {
			// 计算新的目标位置
			const newIndex = calculateDropIndex(dragState.draggedIndex, deltaY);
			
			setDragState(prev => ({
				...prev,
				currentY: e.clientY,
				dragOverIndex: newIndex !== prev.draggedIndex ? newIndex : null,
			}));
		}
	}, [dragState, calculateDropIndex]);
	
	const handlePointerUp = useCallback((e: React.PointerEvent) => {
		if (dragState.isDragging && dragState.draggedIndex !== null && dragState.dragOverIndex !== null) {
			reorderCharacters(dragState.draggedIndex, dragState.dragOverIndex);
		}
		
		// 释放 pointer capture
		const target = e.currentTarget as HTMLDivElement;
		target.releasePointerCapture(e.pointerId);
		
		setDragState({
			isDragging: false,
			draggedIndex: null,
			dragOverIndex: null,
			startY: 0,
			currentY: 0,
		});
		isDraggingRef.current = false;
	}, [dragState, reorderCharacters]);
	
	const handlePointerCancel = useCallback((e: React.PointerEvent) => {
		// 释放 pointer capture
		const target = e.currentTarget as HTMLDivElement;
		try {
			target.releasePointerCapture(e.pointerId);
		} catch {
			// ignore
		}
		
		setDragState({
			isDragging: false,
			draggedIndex: null,
			dragOverIndex: null,
			startY: 0,
			currentY: 0,
		});
		isDraggingRef.current = false;
	}, []);
	
	// 注册 item ref
	const setItemRef = useCallback((charId: string, el: HTMLDivElement | null) => {
		if (el) {
			itemRefs.current.set(charId, el);
		} else {
			itemRefs.current.delete(charId);
		}
	}, []);
	
	// 获取角色类型显示名称
	const getRoleName = useCallback((role?: CharacterRole) => {
		if (!role) return "NPC";
		const roleMap: Record<CharacterRole, string> = {
			protagonist: "男主",
			heroine: "女主",
			antagonist: "反派",
			supportingMale: "男配",
			supportingFemale: "女配",
			mentor: "导师",
			rival: "对手",
			loveInterest: "爱慕对象",
			family: "家人",
			friend: "朋友",
			narrator: "旁白",
			npc: "NPC",
		};
		return roleMap[role] || "NPC";
	}, []);
	
	// 计算拖拽偏移样式
	const getDragStyle = useCallback((index: number) => {
		if (!dragState.isDragging || dragState.draggedIndex !== index) {
			return {};
		}
		
		const deltaY = dragState.currentY - dragState.startY;
		return {
			transform: `translateY(${deltaY}px) scale(1.02)`,
			zIndex: 100,
		};
	}, [dragState]);
	
	return (
		<div className="character-sorting-section" ref={containerRef}>
			<div className="sorting-header">
				<div className="section-label">
					<Icons.list size={16} />
					角色排序
				</div>
				<span className="sorting-hint">拖拽调整顺序</span>
			</div>
			
			<div className="sorting-list">
				{sortedCharacters.map((char, index) => (
					<div
						key={char.id}
						ref={(el) => setItemRef(char.id, el)}
						className={`sorting-item ${dragState.draggedIndex === index && dragState.isDragging ? 'dragging' : ''} ${dragState.dragOverIndex === index ? 'drag-over' : ''}`}
						style={getDragStyle(index)}
						onPointerDown={(e) => handlePointerDown(e, index)}
						onPointerMove={handlePointerMove}
						onPointerUp={handlePointerUp}
						onPointerCancel={handlePointerCancel}
					>
						<div className="sorting-grip">
							<Icons.listOrdered size={16} />
						</div>
						
						<div className="sorting-order">
							{index + 1}
						</div>
						
						<div className="sorting-info">
							<div className="sorting-name">{char.name}</div>
							{char.role && (
								<div className="sorting-role">{getRoleName(char.role)}</div>
							)}
						</div>
						
						<div className="sorting-actions">
							{char.gender && (
								<span className={`gender-badge ${char.gender}`}>
									{char.gender === "male" ? "♂" : char.gender === "female" ? "♀" : "⚧"}
								</span>
							)}
						</div>
					</div>
				))}
			</div>
			
			{dragState.isDragging && (
				<div className="sorting-tip">
					<Icons.alertCircle size={14} />
					<span>正在拖拽，松开完成排序</span>
				</div>
			)}
		</div>
	);
}

interface CharacterSettingsProps {
	novelId: string;
	novelName: string;
	onClose: () => void;
}

// 手动整理关系项组件
interface OrganizeRelationItemProps {
	relIndex: number;
	rel: {
		sourceName?: string;
		targetName?: string;
		relationType: string;
		customRelationType?: string;
		sourceNickname?: string[];
		targetNickname?: string[];
		description: string;
	};
	characters: CharacterInfo[];
	novelId: string;
	onAdded: () => void;
}

const RELATION_TYPE_OPTIONS: Array<{ value: RelationType; label: string }> = [
	{ value: "couple", label: "夫妻" },
	{ value: "lover", label: "恋人" },
	{ value: "ex-lover", label: "前任" },
	{ value: "father-son", label: "父子" },
	{ value: "father-daughter", label: "父女" },
	{ value: "mother-son", label: "母子" },
	{ value: "mother-daughter", label: "母女" },
	{ value: "brother", label: "兄弟" },
	{ value: "sister", label: "姐妹" },
	{ value: "brother-sister", label: "兄妹" },
	{ value: "sister-brother", label: "姐弟" },
	{ value: "mother-daughter-in-law", label: "婆媳" },
	{ value: "father-daughter-in-law", label: "公媳" },
	{ value: "mother-son-in-law", label: "岳母女婿" },
	{ value: "father-son-in-law", label: "翁婿" },
	{ value: "co-parents-male", label: "亲家公" },
	{ value: "co-parents-female", label: "亲家母" },
	{ value: "relative", label: "亲戚" },
	{ value: "classmate", label: "同学" },
	{ value: "friend", label: "朋友" },
	{ value: "bestie", label: "闺蜜" },
	{ value: "rival", label: "竞争对手" },
	{ value: "arch-enemy", label: "宿敌" },
	{ value: "enemy", label: "仇人" },
	{ value: "master-disciple", label: "师徒" },
	{ value: "teacher-student", label: "师生" },
	{ value: "employer-employee", label: "上下级" },
	{ value: "colleague", label: "同事" },
	{ value: "neighbor", label: "邻居" },
	{ value: "stranger", label: "陌生人" },
	{ value: "other", label: "其他" },
];

function OrganizeRelationItem({ rel, characters, novelId, onAdded }: OrganizeRelationItemProps) {
	const addRelationship = useCharacterStore((s) => s.addRelationship);
	const [sourceId, setSourceId] = useState("");
	const [targetId, setTargetId] = useState("");
	const [relationType, setRelationType] = useState<RelationType>("friend");
	const [sourceNickname, setSourceNickname] = useState("");
	const [targetNickname, setTargetNickname] = useState("");
	const [isAdded, setIsAdded] = useState(false);

	const handleAdd = () => {
		if (!sourceId || !targetId) {
			useAppMetaStore.getState().showToast("请选择源角色和目标角色", "warning");
			return;
		}
		if (sourceId === targetId) {
			useAppMetaStore.getState().showToast("源角色和目标角色不能相同", "warning");
			return;
		}

		addRelationship(novelId, {
			sourceId,
			targetId,
			relationType: [relationType],
			sourceNickname: sourceNickname ? [sourceNickname] : [],
			targetNickname: targetNickname ? [targetNickname] : [],
		});

		setIsAdded(true);
		onAdded();
	};

	return (
		<div className="organize-relation-item">
			<div className="organize-relation-desc">
				<Icons.userRound size={14} />
				<span>{rel.description || `${rel.sourceName || '未知'} -- ${rel.targetName || '未知'}`}</span>
			</div>
			<div className="organize-relation-form">
				<div className="organize-relation-row">
					<div className="organize-relation-field">
						<label>源角色</label>
						<select
							value={sourceId}
							onChange={(e) => setSourceId(e.target.value)}
							className="form-select"
						>
							<option value="">选择角色...</option>
							{characters.map((char) => (
								<option key={char.id} value={char.id}>
									{char.name}
								</option>
							))}
						</select>
					</div>
					<div className="organize-relation-arrow">
						<Icons.chevronRight size={16} />
					</div>
					<div className="organize-relation-field">
						<label>目标角色</label>
						<select
							value={targetId}
							onChange={(e) => setTargetId(e.target.value)}
							className="form-select"
						>
							<option value="">选择角色...</option>
							{characters.map((char) => (
								<option key={char.id} value={char.id}>
									{char.name}
								</option>
							))}
						</select>
					</div>
				</div>
				<div className="organize-relation-row">
					<div className="organize-relation-field">
						<label>关系类型</label>
						<select
							value={relationType}
							onChange={(e) => setRelationType(e.target.value as RelationType)}
							className="form-select"
						>
							{RELATION_TYPE_OPTIONS.map((opt) => (
								<option key={opt.value} value={opt.value}>
									{opt.label}
								</option>
							))}
						</select>
					</div>
					<div className="organize-relation-field">
						<label>源对目标的称呼</label>
						<input
							type="text"
							value={sourceNickname}
							onChange={(e) => setSourceNickname(e.target.value)}
							placeholder="如：老公、妻子"
							className="form-input"
						/>
					</div>
					<div className="organize-relation-field">
						<label>目标对源的称呼</label>
						<input
							type="text"
							value={targetNickname}
							onChange={(e) => setTargetNickname(e.target.value)}
							placeholder="如：老婆、丈夫"
							className="form-input"
						/>
					</div>
				</div>
				<button
					className="btn btn-primary btn-sm"
					onClick={handleAdd}
					disabled={isAdded}
				>
					{isAdded ? <Icons.check size={14} /> : <Icons.plus size={14} />}
					{isAdded ? "已添加" : "添加关系"}
				</button>
			</div>
		</div>
	);
}

// 角色合并配置面板组件
interface MergeConfigPanelProps {
	sourceChars: CharacterInfo[];
	onExecute: (mergedChar: CharacterInfo, deleteIds: string[]) => void;
	onBack: () => void;
}

function MergeConfigPanel({ sourceChars, onExecute, onBack }: MergeConfigPanelProps) {
	const [mergedName, setMergedName] = useState(sourceChars[0]?.name || "");
	const [mergedGender, setMergedGender] = useState<"male" | "female" | "other">(sourceChars[0]?.gender || "other");
	const [mergedRole, setMergedRole] = useState<CharacterRole | undefined>(sourceChars[0]?.role);
	const [mergedVoice, setMergedVoice] = useState(sourceChars[0]?.voice || "");

	// 收集所有别名和关系代称
	const allAliases = useMemo(() => {
		const aliases = new Set<string>();
		sourceChars.forEach(char => {
			char.aliases?.forEach(alias => aliases.add(alias));
		});
		return Array.from(aliases);
	}, [sourceChars]);

	const allRelationTerms = useMemo(() => {
		const terms = new Set<string>();
		sourceChars.forEach(char => {
			char.relationTerms?.forEach(term => terms.add(term));
		});
		return Array.from(terms);
	}, [sourceChars]);

	// 收集所有来源角色的备注
	const allNotes = useMemo(() => {
		return sourceChars
			.map(char => ({ id: char.id, name: char.name, notes: char.notes || "" }))
			.filter(item => item.notes.trim());
	}, [sourceChars]);

	const [selectedAliases, setSelectedAliases] = useState<Set<string>>(new Set(allAliases));
	const [selectedRelationTerms, setSelectedRelationTerms] = useState<Set<string>>(new Set(allRelationTerms));
	const [selectedNotes, setSelectedNotes] = useState<Set<string>>(new Set(allNotes.map(n => n.id)));

	const [customNotes, setCustomNotes] = useState("");

	const toggleAlias = (alias: string) => {
		setSelectedAliases(prev => {
			const newSet = new Set(prev);
			if (newSet.has(alias)) {
				newSet.delete(alias);
			} else {
				newSet.add(alias);
			}
			return newSet;
		});
	};

	const toggleRelationTerm = (term: string) => {
		setSelectedRelationTerms(prev => {
			const newSet = new Set(prev);
			if (newSet.has(term)) {
				newSet.delete(term);
			} else {
				newSet.add(term);
			}
			return newSet;
		});
	};

	const toggleNote = (charId: string) => {
		setSelectedNotes(prev => {
			const newSet = new Set(prev);
			if (newSet.has(charId)) {
				newSet.delete(charId);
			} else {
				newSet.add(charId);
			}
			return newSet;
		});
	};

	const handleExecute = () => {
		if (!mergedName.trim()) {
			useAppMetaStore.getState().showToast("请输入合并后的角色名称", "warning");
			return;
		}

		const selectedNotesContent = allNotes
			.filter(n => selectedNotes.has(n.id))
			.map(n => n.notes.trim())
			.filter(n => n)
			.join("\n\n");

		const finalNotes = [selectedNotesContent, customNotes]
			.filter(n => n.trim())
			.join("\n\n");

		const mergedChar: CharacterInfo = {
			id: `char-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			name: mergedName.trim(),
			gender: mergedGender,
			role: mergedRole,
			voice: mergedVoice,
			notes: finalNotes,
			aliases: Array.from(selectedAliases),
			relationTerms: Array.from(selectedRelationTerms),
		};

		const deleteIds = sourceChars.map(c => c.id);
		onExecute(mergedChar, deleteIds);
	};

	return (
		<div className="merge-config-panel">
			<div className="merge-source-info">
				<span className="merge-source-label">合并来源：</span>
				{sourceChars.map(c => c.name).join(", ")}
			</div>

			<div className="merge-config-form">
				<div className="form-field">
					<label>角色名称</label>
					<input
						type="text"
						className="config-input"
						value={mergedName}
						onChange={(e) => setMergedName(e.target.value)}
						placeholder="输入合并后的角色名称"
					/>
				</div>

				<div className="grid grid-cols-2 gap-3">
					<div className="form-field">
						<label>性别</label>
						<Select
							value={mergedGender}
							onChange={(v) => setMergedGender(v as "male" | "female" | "other")}
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
							value={mergedRole || ""}
							onChange={(v) => setMergedRole(v ? (v as CharacterRole) : undefined)}
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
						value={mergedVoice || ""}
						onChange={(v) => setMergedVoice(v as string)}
						options={[
							{ value: "", label: "默认" },
							{ value: "冰糖", label: "冰糖 (女)" },
							{ value: "茉莉", label: "茉莉 (女)" },
							{ value: "苏打", label: "苏打 (男)" },
							{ value: "白桦", label: "白桦 (男)" },
							{ value: "Mia", label: "Mia (女)" },
							{ value: "Chloe", label: "Chloe (女)" },
							{ value: "Milo", label: "Milo (男)" },
							{ value: "Dean", label: "Dean (男)" },
						]}
					/>
				</div>

				{allNotes.length > 0 && (
					<div className="form-field">
						<label>保留的备注 ({selectedNotes.size}/{allNotes.length})</label>
						<div className="merge-notes-list">
							{allNotes.map(note => (
								<label
									key={note.id}
									className={`merge-note-item ${selectedNotes.has(note.id) ? 'selected' : ''}`}
								>
									<input
										type="checkbox"
										checked={selectedNotes.has(note.id)}
										onChange={() => toggleNote(note.id)}
									/>
									<div className="note-content">
										<span className="note-author">{note.name}</span>
										<p>{note.notes}</p>
									</div>
								</label>
							))}
						</div>
					</div>
				)}

				<div className="form-field">
					<label>自定义备注（追加到选中的备注后）</label>
					<textarea
						className="config-input"
						value={customNotes}
						onChange={(e) => setCustomNotes(e.target.value)}
						placeholder="输入额外的备注信息"
						rows={3}
					/>
				</div>

				{allAliases.length > 0 && (
					<div className="form-field">
						<label>保留的别名 ({selectedAliases.size}/{allAliases.length})</label>
						<div className="merge-tags-grid">
							{allAliases.map(alias => (
								<label key={alias} className={`merge-tag-item ${selectedAliases.has(alias) ? 'selected' : ''}`}>
									<input
										type="checkbox"
										checked={selectedAliases.has(alias)}
										onChange={() => toggleAlias(alias)}
									/>
									<span>{alias}</span>
								</label>
							))}
						</div>
					</div>
				)}

				{allRelationTerms.length > 0 && (
					<div className="form-field">
						<label>保留的关系代称 ({selectedRelationTerms.size}/{allRelationTerms.length})</label>
						<div className="merge-tags-grid">
							{allRelationTerms.map(term => (
								<label key={term} className={`merge-tag-item ${selectedRelationTerms.has(term) ? 'selected' : ''}`}>
									<input
										type="checkbox"
										checked={selectedRelationTerms.has(term)}
										onChange={() => toggleRelationTerm(term)}
									/>
									<span>{term}</span>
								</label>
							))}
						</div>
					</div>
				)}
			</div>

			<div className="modal-footer">
				<button className="btn btn-secondary" onClick={onBack}>
					上一步
				</button>
				<button className="btn btn-primary" onClick={handleExecute}>
					确认合并 ({sourceChars.length}个角色)
				</button>
			</div>
		</div>
	);
}

export function CharacterSettings({ novelId, novelName, onClose }: CharacterSettingsProps) {
	const novelCharacters = useCharacterStore((s) => s.novelCharacters);
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
	const allRelationships = useCharacterStore((s) => s.characterRelationships);
	const relationships = useMemo(() => allRelationships[novelId] ?? [], [allRelationships, novelId]);
	const storeNodePositions = useCharacterStore((s) => s.nodePositions);
	const nodePositions = useMemo(() => storeNodePositions[novelId] ?? {}, [storeNodePositions, novelId]);
	const addCharacter = useCharacterStore((s) => s.addCharacter);
	const updateCharacter = useCharacterStore((s) => s.updateCharacter);
	const removeCharacter = useCharacterStore((s) => s.removeCharacter);
	const setCharactersForNovel = useCharacterStore((s) => s.setCharactersForNovel);
	const setRelationshipsForNovel = useCharacterStore((s) => s.setRelationshipsForNovel);
	const getRelationshipsForNovel = useCharacterStore((s) => s.getRelationshipsForNovel);
	const removeRelationship = useCharacterStore((s) => s.removeRelationship);
	const updateRelationship = useCharacterStore((s) => s.updateRelationship);
	const setNodePositions = useCharacterStore((s) => s.setNodePositions);
	const setIgnoredWords = useProofreadMetaStore((s) => s.setIgnoredWords);
	const setNovelCategory = useAppMetaStore((s) => s.setNovelCategory);
	const getIgnoredWords = useProofreadMetaStore((s) => s.getIgnoredWords);
	const addIgnoredCharacterName = useCharacterStore((s) => s.addIgnoredCharacterName);
	const getIgnoredCharacterNames = useCharacterStore((s) => s.getIgnoredCharacterNames);
	const setIgnoredCharacterNames = useCharacterStore((s) => s.setIgnoredCharacterNames);
	const ignoredCharacterNames = useMemo(() => getIgnoredCharacterNames(novelId), [getIgnoredCharacterNames, novelId]);
	const ignoredWords = useMemo(() => getIgnoredWords(novelId), [getIgnoredWords, novelId]);
	const novelCategories = useAppMetaStore((s) => s.novelCategories);
	const novelCategory = useMemo(() => novelCategories[novelId], [novelCategories, novelId]);
	const novels = useNovelStore((s) => s.novels);
	const currentNovel = useMemo(() => novels.find(n => n.id === novelId), [novels, novelId]);

	// 检测新角色弹窗状态
	const [showDetectModal, setShowDetectModal] = useState(false);
	const [detectedCharacters, setDetectedCharacters] = useState<DetectedCharacter[]>([]);
	const [detectSearchQuery, setDetectSearchQuery] = useState("");

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

	// 角色合并弹窗状态
	const [showMergeModal, setShowMergeModal] = useState(false);
	const [selectedForMerge, setSelectedForMerge] = useState<string[]>([]);
	const [mergeMode, setMergeMode] = useState<"select" | "config">("select");
	const [mergeSourceChars, setMergeSourceChars] = useState<CharacterInfo[]>([]);

	// 手动整理关系弹窗状态
	const [showOrganizeRelationsModal, setShowOrganizeRelationsModal] = useState(false);
	const [skippedRelationships, setSkippedRelationships] = useState<Array<{
		sourceName?: string;
		targetName?: string;
		relationType: string;
		customRelationType?: string;
		sourceNickname?: string[];
		targetNickname?: string[];
		description: string;
	}>>([]);

	// 关系管理弹窗状态
	const [showManageRelationsModal, setShowManageRelationsModal] = useState(false);
	const [editingRelation, setEditingRelation] = useState<CharacterRelationship | null>(null);
	const [showOnlyUnknown, setShowOnlyUnknown] = useState(true);
	const [selectedCharacterForRelations, setSelectedCharacterForRelations] = useState<string | null>(null);
	const [relationForm, setRelationForm] = useState<{
		sourceId: string;
		targetId: string;
		relationType: RelationType[];
		customRelationType: string;
		sourceNickname: string[];
		targetNickname: string[];
		newSourceNickname: string;
		newTargetNickname: string;
	}>({
		sourceId: "",
		targetId: "",
		relationType: [],
		customRelationType: "",
		sourceNickname: [],
		targetNickname: [],
		newSourceNickname: "",
		newTargetNickname: "",
	});

	const getCharacterById = useCallback(
		(id: string) => characters.find((c) => c.id === id),
		[characters]
	);

	const getSourceSuggestions = useCallback(
		(input: string) => {
			if (!input) return [];
			const targetChar = getCharacterById(relationForm.targetId);
			if (!targetChar) return [];
			const suggestions = new Set<string>();
			["老婆", "老公", "妻子", "丈夫", "爱人", "亲爱的", targetChar.name, targetChar.name.charAt(0)].forEach((s) => {
				if (s.toLowerCase().includes(input.toLowerCase())) {
					suggestions.add(s);
				}
			});
			return Array.from(suggestions).slice(0, 5);
		},
		[getCharacterById, relationForm.targetId]
	);

	const getTargetSuggestions = useCallback(
		(input: string) => {
			if (!input) return [];
			const sourceChar = getCharacterById(relationForm.sourceId);
			if (!sourceChar) return [];
			const suggestions = new Set<string>();
			["老婆", "老公", "妻子", "丈夫", "爱人", "亲爱的", sourceChar.name, sourceChar.name.charAt(0)].forEach((s) => {
				if (s.toLowerCase().includes(input.toLowerCase())) {
					suggestions.add(s);
				}
			});
			return Array.from(suggestions).slice(0, 5);
		},
		[getCharacterById, relationForm.sourceId]
	);

	const handleAddSourceNickname = useCallback((setForm: typeof setRelationForm) => {
		setForm((prev) => {
			if (prev.newSourceNickname.trim()) {
				return {
					...prev,
					sourceNickname: [...prev.sourceNickname, prev.newSourceNickname.trim()],
					newSourceNickname: "",
				};
			}
			return prev;
		});
	}, []);

	const handleRemoveSourceNickname = useCallback((index: number, setForm: typeof setRelationForm) => {
		setForm((prev) => ({
			...prev,
			sourceNickname: prev.sourceNickname.filter((_, i) => i !== index),
		}));
	}, []);

	const handleAddTargetNickname = useCallback((setForm: typeof setRelationForm) => {
		setForm((prev) => {
			if (prev.newTargetNickname.trim()) {
				return {
					...prev,
					targetNickname: [...prev.targetNickname, prev.newTargetNickname.trim()],
					newTargetNickname: "",
				};
			}
			return prev;
		});
	}, []);

	const handleRemoveTargetNickname = useCallback((index: number, setForm: typeof setRelationForm) => {
		setForm((prev) => ({
			...prev,
			targetNickname: prev.targetNickname.filter((_, i) => i !== index),
		}));
	}, []);

	// 角色设置标签页状态：'list' | 'graph'
	const [activeTab, setActiveTab] = useState<"list" | "graph">("list");

	// 角色小传重新分析状态
	const [showReanalyzeModal, setShowReanalyzeModal] = useState(false);
	const [reanalyzingCharacterId, setReanalyzingCharacterId] = useState<string | null>(null);
	const [oldBiography, setOldBiography] = useState<string>("");
	const [newBiography, setNewBiography] = useState<string>("");
	const [isReanalyzing, setIsReanalyzing] = useState(false);
	const [reanalyzeError, setReanalyzeError] = useState<string | null>(null);

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
		voiceDesignPrompt: "",
		aliases: [],
		relationTerms: [],
	});
	const [showAddForm, setShowAddForm] = useState(false);
	const [newAlias, setNewAlias] = useState("");
	const [newRelationTerm, setNewRelationTerm] = useState("");
	const [isGeneratingVoiceDesign, setIsGeneratingVoiceDesign] = useState(false);
	
	// TTS 功能状态
	const [playingNoteCharacterId, setPlayingNoteCharacterId] = useState<string | null>(null);
	const audioRef = useRef<HTMLAudioElement | null>(null);
	const cancelPlayRef = useRef<(() => void) | null>(null);
	const ttsConfig = useConfigStore((s) => s.ttsConfig);
	const aiConfig = useAIConfigStore((s) => s.aiConfig);

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
			voiceDesignPrompt: editForm.voiceDesignPrompt,
			aliases: editForm.aliases || [],
			relationTerms: editForm.relationTerms || [],
		});
		setShowAddForm(false);
		setEditForm({ name: "", gender: "other", notes: "", voice: "", voiceDesignPrompt: "", aliases: [], relationTerms: [] });
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

	// 复制JSON数据到剪贴板（移动端超过25KB时分段复制）
	const copyToClipboard = useCallback(async (data: string) => {
		const CHUNK_SIZE = 25 * 1024; // 25KB 分段大小
		
		try {
			if (isMobile && data.length > CHUNK_SIZE) {
				// 移动端：分段复制
				const totalChunks = Math.ceil(data.length / CHUNK_SIZE);
				useAppMetaStore.getState().showToast(`数据较大，将分 ${totalChunks} 次复制到剪贴板，请依次粘贴`, "info");
				
				for (let i = 0; i < totalChunks; i++) {
					const start = i * CHUNK_SIZE;
					const end = Math.min(start + CHUNK_SIZE, data.length);
					const chunk = data.substring(start, end);
					
					await navigator.clipboard.writeText(chunk);
					
					if (i < totalChunks - 1) {
						// 等待用户确认后继续下一段
						await new Promise<void>((resolve) => {
							const proceed = confirm(`已复制第 ${i + 1}/${totalChunks} 部分，点击确定继续复制下一部分`);
							if (!proceed) {
								useAppMetaStore.getState().showToast(`已取消复制，共复制了 ${i + 1}/${totalChunks} 部分`, "warning");
							}
							resolve();
						});
					}
				}
				
				useAppMetaStore.getState().showToast(`成功复制全部 ${totalChunks} 部分数据到剪贴板！`, "success");
			} else {
				// 桌面端或数据较小：直接复制
				await navigator.clipboard.writeText(data);
				useAppMetaStore.getState().showToast("已复制到剪贴板！", "success");
			}
		} catch (err) {
			logger.errorGeneric('CharacterSettings - 复制失败:', err);
			useAppMetaStore.getState().showToast("复制失败，请手动选择复制", "error");
		}
	}, [isMobile]);

	// 导出小说设置（包含角色、关系、忽略词等）
	const handleExportCharacters = useCallback(async () => {
		const exportData = {
			version: "2.0",
			novelId,
			novelName,
			exportTime: formatDateTime(new Date()),
			characters: sortedCharacters.map(char => ({
				id: char.id,
				name: char.name,
				gender: char.gender,
				role: char.role,
				order: char.order,
				relationTerms: char.relationTerms || [],
				aliases: char.aliases || [],
				notes: char.notes || "",
				voice: char.voice || "",
				voiceDesignPrompt: char.voiceDesignPrompt || "",
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
			novelCategory,
		};
		
		const dataStr = JSON.stringify(exportData, null, 2);
		// 使用小说名称作为文件名前缀
		const safeName = (novelName || "小说设置").replace(/[\\/:*?"<>|]/g, "_");
		const fileName = `${safeName}-小说设置-${new Date().toISOString().split("T")[0]}.json`;

		if (isMobile) {
			// 移动端：使用 Tauri API 保存到 Android/data/cn.helilab.proofreader/documents/characters/ 目录
			const success = await saveCharacterConfigToStorage(fileName, dataStr);
			logger.file('小说设置导出结果:', { success, fileName, characterCount: sortedCharacters.length, dataSize: dataStr.length, isMobile });
			setExportModal({
				show: true,
				success,
				fileName,
				dataStr,
				characterCount: sortedCharacters.length,
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
				characterCount: sortedCharacters.length,
				relationshipCount: relationships.length,
			});
		}
	}, [sortedCharacters, relationships, novelName, novelId, isMobile, nodePositions, ignoredWords, ignoredCharacterNames, novelCategory, setExportModal]);

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
					let importedNovelCategory: NovelCategory | null = null;
					let importedIgnoredCharacterNames: string[] = [];

					// 兼容新旧格式
					if (imported.version && Array.isArray(imported.characters)) {
						// 新格式：{ version, characters, relationships, nodePositions, ignoredWords,  novelCategory, ignoredCharacterNames }
						importedChars = imported.characters;
						importedRelationships = imported.relationships || [];
						importedNodePositions = imported.nodePositions || {};
						importedIgnoredWords = imported.ignoredWords || [];
						importedNovelCategory = imported.novelCategory || null;
						importedIgnoredCharacterNames = imported.ignoredCharacterNames || [];
					} else if (Array.isArray(imported)) {
						// 旧格式：CharacterInfo[]
						importedChars = imported;
					} else {
						useAppMetaStore.getState().showToast("文件格式错误：无法识别的数据格式", "error");
						return;
					}

					// 验证每个角色的格式
					const valid = importedChars.every(char => 
						typeof char.name === "string" &&
						["male", "female", "other"].includes(char.gender)
					);

					if (!valid) {
						useAppMetaStore.getState().showToast("文件格式错误：角色数据格式不正确", "error");
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
							// 直接在 mergedChars 中更新，而不是调用 updateCharacter
							const existingIndex = mergedChars.findIndex(c => c.id === existing.id);
							if (existingIndex >= 0) {
								mergedChars[existingIndex] = {
									...mergedChars[existingIndex],
									name: importedChar.name,
									gender: importedChar.gender,
									role: importedChar.role,
									order: importedChar.order,
									notes: importedChar.notes || "",
									voice: importedChar.voice || "",
									voiceDesignPrompt: importedChar.voiceDesignPrompt || "",
									aliases: importedChar.aliases || [],
									relationTerms: importedChar.relationTerms || [],
								};
							}
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
								voiceDesignPrompt: importedChar.voiceDesignPrompt || "",
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
						(importedNovelCategory ? "，导入小说分类" : "") +
						(importedIgnoredCharacterNames.length > 0 ? `，导入 ${importedIgnoredCharacterNames.length} 个忽略角色` : "");
					useAppMetaStore.getState().showToast(msg, "success");
				} catch (err) {
					useAppMetaStore.getState().showToast("文件解析失败：" + (err instanceof Error ? err.message : String(err)), "error");
				}
			};
			reader.readAsText(file);
		};
		input.click();
	}, [novelId, novelCharacters, setCharactersForNovel, setRelationshipsForNovel, setNodePositions, setIgnoredWords, setNovelCategory, setIgnoredCharacterNames]);

	// 使用AI分析整本小说提取角色和关系
	const handleAnalyzeCharacters = async () => {
		if (!currentNovel?.fullText) {
			useAppMetaStore.getState().showToast("无法获取小说内容", "error");
			return;
		}

		if (!aiConfig.apiKey || !aiConfig.baseURL) {
			useAppMetaStore.getState().showToast("请先在设置中配置AI模型", "warning");
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
						voiceDesignPrompt: char.voiceDesignPrompt,
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
			const currentSkippedRelationships: typeof result.relationships = [];

			// 建立角色名称到新ID的映射（仅包含新添加的角色）
			// 重要：这里使用新生成的ID，而不是AI返回的ID
			const nameToIdMapFull = new Map<string, string>();
			for (const char of newCharactersWithIds) {
				nameToIdMapFull.set(char.name.toLowerCase(), char.id);
			}

			// 建立AI返回的原始ID到新ID的映射（用于处理AI在relationships中使用了与characters不一致的ID的情况）
			const aiIdToNewIdMap = new Map<string, string>();
			for (let i = 0; i < result.characters.length; i++) {
				const originalId = result.characters[i].id;
				if (originalId && newCharactersWithIds[i]) {
					aiIdToNewIdMap.set(originalId, newCharactersWithIds[i].id);
				}
			}

			for (const rel of result.relationships) {
				// 优先使用 sourceName/targetName（按提示词要求）
				// 如果AI不按要求返回了 sourceId/targetId，则需要做额外处理
				let sourceName = rel.sourceName;
				let targetName = rel.targetName;

				// 如果 sourceName/targetName 不存在，尝试使用 sourceId/targetId
				// 这种情况下AI可能自作主张使用了ID，我们需要通过ID映射找到正确的角色
				if (!sourceName && rel.sourceId) {
					// 首先尝试用原始ID映射表查找
					const mappedId = aiIdToNewIdMap.get(rel.sourceId);
					if (mappedId) {
						// 通过新ID反查角色名
						const char = newCharactersWithIds.find(c => c.id === mappedId);
						if (char) {
							sourceName = char.name;
						}
					}
				}
				if (!targetName && rel.targetId) {
					const mappedId = aiIdToNewIdMap.get(rel.targetId);
					if (mappedId) {
						const char = newCharactersWithIds.find(c => c.id === mappedId);
						if (char) {
							targetName = char.name;
						}
					}
				}

				// 如果仍然无法确定角色名，保存到跳过的关系列表
				if (!sourceName || !targetName) {
					logger.warn("[CharacterSettings] 无法确定关系中的角色名，跳过:", rel);
					currentSkippedRelationships.push(rel);
					continue;
				}

				const sourceNameLower = sourceName.toLowerCase();
				const targetNameLower = targetName.toLowerCase();

				// 查找角色的ID（在新添加的角色中查找）
				const sourceId = nameToIdMapFull.get(sourceNameLower);
				const targetId = nameToIdMapFull.get(targetNameLower);

				// 如果在新添加的角色中找不到，尝试在已存在的角色中查找
				const finalSourceId = sourceId || characters.find(c => c.name.toLowerCase() === sourceNameLower)?.id;
				const finalTargetId = targetId || characters.find(c => c.name.toLowerCase() === targetNameLower)?.id;

				// 跳过无法匹配的关系，保存到跳过的关系列表
				if (!finalSourceId || !finalTargetId) {
					logger.warn(`[CharacterSettings] 无法找到角色ID: ${sourceName}(${sourceId}) -> ${targetName}(${targetId})`);
					currentSkippedRelationships.push(rel);
					continue;
				}

				// 跳过自环关系
				if (finalSourceId === finalTargetId) continue;

				newRelationships.push({
					id: `rel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
					novelId,
					sourceId: finalSourceId,
					targetId: finalTargetId,
					relationType: [rel.relationType as import("../types").RelationType],
					customRelationType: rel.customRelationType,
					sourceNickname: rel.sourceNickname || [],
					targetNickname: rel.targetNickname || [],
				});
			}

			// 添加新关系
			setRelationshipsForNovel(novelId, [...currentRelationships, ...newRelationships]);

			// 保存跳过的关系供手动整理
			setSkippedRelationships(currentSkippedRelationships);

			// 根据结果显示不同消息
			if (currentSkippedRelationships.length > 0) {
				const shouldOrganize = confirm(
					`分析完成！\n\n新增 ${newCharactersWithIds.length} 个角色\n导入 ${newRelationships.length} 条关系\n\n有 ${currentSkippedRelationships.length} 条关系因无法匹配角色而被跳过。\n\n是否现在手动整理这些关系？`
				);
				if (shouldOrganize) {
					setShowAnalyzeModal(false);
					setShowOrganizeRelationsModal(true);
				} else {
					setShowAnalyzeModal(false);
				}
			} else {
				useAppMetaStore.getState().showToast(`分析完成！新增 ${newCharactersWithIds.length} 个角色和 ${newRelationships.length} 条关系`, "success");
				setShowAnalyzeModal(false);
			}
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

	// 打开角色合并弹窗
	const handleOpenMergeModal = () => {
		setSelectedForMerge([]);
		setMergeMode("select");
		setMergeSourceChars([]);
		setShowMergeModal(true);
	};

	// 选择/取消选择角色进行合并
	const handleToggleMergeSelection = (charId: string) => {
		setSelectedForMerge(prev => {
			if (prev.includes(charId)) {
				return prev.filter(id => id !== charId);
			}
			return [...prev, charId];
		});
	};

	// 进入配置模式，准备合并
	const handleProceedToMergeConfig = () => {
		if (selectedForMerge.length < 2) {
			useAppMetaStore.getState().showToast("请至少选择2个角色进行合并", "warning");
			return;
		}
		const chars = characters.filter(c => selectedForMerge.includes(c.id));
		setMergeSourceChars(chars);
		setMergeMode("config");
	};

	// 执行角色合并
	const handleExecuteMerge = (mergedChar: CharacterInfo, deleteIds: string[]) => {
		// 删除被合并的角色
		for (const id of deleteIds) {
			removeCharacter(novelId, id);
		}
		// 添加合并后的角色
		addCharacter(novelId, mergedChar);
		// 关闭弹窗
		setShowMergeModal(false);
		useAppMetaStore.getState().showToast(`成功合并 ${deleteIds.length + 1} 个角色为 "${mergedChar.name}"`, "success");
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
		useAppMetaStore.getState().showToast(messages.join('，'), "success");
	}, [detectedCharacters, detectedSelections, novelId, characters, addCharacter, updateCharacter, setShowDetectModal]);

	
	// 重新分析角色小传
	const handleReanalyzeBiography = useCallback(async (character: CharacterInfo) => {
		if (!currentNovel?.fullText) {
			useAppMetaStore.getState().showToast("无法获取小说内容", "error");
			return;
		}

		if (!aiConfig.apiKey || !aiConfig.baseURL) {
			useAppMetaStore.getState().showToast("请先在设置中配置AI模型", "warning");
			return;
		}

		setReanalyzingCharacterId(character.id);
		setOldBiography(character.notes || "");
		setNewBiography("");
		setIsReanalyzing(true);
		setReanalyzeError(null);
		setShowReanalyzeModal(true);

		try {
			const config = {
				baseURL: aiConfig.baseURL,
				apiKey: aiConfig.apiKey,
				model: aiConfig.model,
				customHeaders: {},
				maxCharsPerRequest: 0,
				enableLogging: false,
			};

			const result = await reanalyzeCharacterBiography(
				currentNovel.fullText,
				character.name,
				character.aliases || [],
				character.relationTerms || [],
				config,
				character.notes || ""
			);

			setNewBiography(result);
		} catch (error) {
			setReanalyzeError(error instanceof Error ? error.message : "分析失败");
			logger.errorGeneric("重新分析角色小传失败", { error });
		} finally {
			setIsReanalyzing(false);
		}
	}, [currentNovel, aiConfig]);

	// 替换角色小传
	const handleReplaceBiography = useCallback(() => {
		if (!reanalyzingCharacterId || !newBiography) return;

		updateCharacter(novelId, reanalyzingCharacterId, { notes: newBiography });
		setShowReanalyzeModal(false);
		setReanalyzingCharacterId(null);
		setOldBiography("");
		setNewBiography("");
	}, [reanalyzingCharacterId, newBiography, novelId, updateCharacter]);

	// 关闭重新分析弹窗
	const handleCloseReanalyzeModal = useCallback(() => {
		setShowReanalyzeModal(false);
		setReanalyzingCharacterId(null);
		setOldBiography("");
		setNewBiography("");
		setReanalyzeError(null);
	}, []);

	// AI生成音色设计
	const handleGenerateVoiceDesign = useCallback(async () => {
		if (!editForm.name) return;
		
		setIsGeneratingVoiceDesign(true);
		try {
			const result = await generateVoiceDesign({
				name: editForm.name,
				gender: editForm.gender || "other",
				role: editForm.role,
				notes: editForm.notes,
			}, aiConfig);
			
			setEditForm(prev => ({
				...prev,
				voiceDesignPrompt: result,
			}));
			
			useAppMetaStore.getState().showToast("音色设计生成成功", "success");
		} catch (error) {
			logger.errorGeneric("生成音色设计失败", { error });
			useAppMetaStore.getState().showToast("生成音色设计失败", "error");
		} finally {
			setIsGeneratingVoiceDesign(false);
		}
	}, [editForm.name, editForm.gender, editForm.role, editForm.notes, aiConfig]);

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
			
			logger.tts("播放角色备注", { character: character.name, voice, text: playText.slice(0, 50) + "...", voiceDesign: !!character.voiceDesignPrompt });
			
			// 合成音频（支持音色设计）
			const audioBuffer = await synthesizeSpeechWithVoice(playText, ttsConfig, voice, character.voiceDesignPrompt);
			
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
			<div className={`character-settings-modal ${isDragMode ? "drag-mode-full-height" : ""}`} onClick={(e) => e.stopPropagation()}>
				<div className="config-header">
					<div className="config-title">
						<span className="title-icon"><Icons.user size={16} /></span>
						<span>角色设置</span>
						{novelName && <span className="title-novel-name">《{novelName}》</span>}
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

				<div className="config-body">
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
								<CharacterSortingSection
									novelId={novelId}
									characters={characters}
									updateCharacter={updateCharacter}
								/>
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

												<div className="form-field">
													<div className="flex justify-between items-center mb-2">
														<label className="text-xs">音色设计</label>
														<button
															type="button"
															className="text-xs text-blue-500 hover:text-blue-400 flex items-center gap-1"
															onClick={handleGenerateVoiceDesign}
															disabled={isGeneratingVoiceDesign || !editForm.name}
														>
															<Icons.sparkle size={12} />
															{isGeneratingVoiceDesign ? "生成中..." : "AI生成"}
														</button>
													</div>
													<textarea
														value={editForm.voiceDesignPrompt || ""}
														onChange={(e) => setEditForm({ ...editForm, voiceDesignPrompt: e.target.value })}
														className="config-input"
														placeholder="输入音色设计描述，如：温柔甜美，年轻女性，温婉知性，适合表达柔情、羞涩、关切等情感"
														rows={3}
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
														{char.voiceDesignPrompt && (
															<div className="detail-item voice-design-detail">
																<Icons.sparkle size={14} />
																<span className="detail-label">音色设计:</span>
																<span className="detail-value truncate" title={char.voiceDesignPrompt}>
																	{char.voiceDesignPrompt}
																</span>
															</div>
														)}
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
															<div className="notes-label-left">
																<Icons.punctuation size={14} />
																备注
															</div>
															<div className="notes-label-right">
																<button
																	className="notes-refresh-btn"
																	onClick={(e) => {
																		e.stopPropagation();
																		handleReanalyzeBiography(char);
																	}}
																	title="重新分析角色小传"
																>
																	<Icons.refreshCw size={14} />
																</button>
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
							onClick={() => setShowAnalyzeModal(true)}
							title="AI分析角色"
							disabled={isAnalyzing}
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
						<button
							className="action-btn character-action"
							onClick={handleOpenMergeModal}
							title="合并角色"
						>
							<Icons.combine size={18} />
							<span>合并</span>
						</button>
						<button
							className="action-btn character-action"
							onClick={() => setShowManageRelationsModal(true)}
							title="管理关系"
						>
							<Icons.userRoundPen size={18} />
							<span>关系</span>
						</button>
					</div>
				)}
			</div>
		</div>

		{/* 检测到的新角色弹窗 */}
		{showDetectModal && (
			<div className="modal-overlay" onClick={() => setShowDetectModal(false)}>
				<div className="modal-content detect-characters-modal" onClick={e => e.stopPropagation()}>
					<div className="config-header">
						<div className="config-title">
							<span className="title-icon"><Icons.user size={16} /></span>
							检测到的角色
						</div>
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
						<button className="close-btn" onClick={() => setShowDetectModal(false)}>
							<Icons.close size={16} />
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

		{/* AI分析角色弹窗 */}
		{showAnalyzeModal && (
			<div className="modal-overlay" onClick={() => !isAnalyzing && setShowAnalyzeModal(false)}>
				<div className="modal-content detect-characters-modal" onClick={e => e.stopPropagation()}>
					<div className="config-header">
						<div className="config-title">
							<span className="title-icon"><Icons.sparkles size={16} /></span>
							AI 角色分析
						</div>
						{!isAnalyzing && (
							<button className="close-btn" onClick={() => setShowAnalyzeModal(false)}>
								<Icons.close size={16} />
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
								<div className="analyze-features">
									<p className="analyze-features-title">功能特点</p>
									<div className="analyze-features-list">
										<span className="analyze-feature-item">自动识别小说中的主要角色</span>
										<span className="analyze-feature-item">提取角色外貌、性格、背景描述</span>
										<span className="analyze-feature-item">分析角色之间的关系</span>
										<span className="analyze-feature-item">支持超大文本（1M+ tokens）</span>
									</div>
								</div>
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

		{/* 角色合并弹窗 */}
		{showMergeModal && (
			<div className="modal-overlay" onClick={() => setShowMergeModal(false)}>
				<div className="config-modal merge-characters-modal" onClick={e => e.stopPropagation()}>
					<div className="config-header">
						<div className="config-title">
							<span className="title-icon"><Icons.combine size={16} /></span>
							<span>{mergeMode === "select" ? "选择要合并的角色" : "配置合并结果"}</span>
						</div>
						<button className="close-btn" onClick={() => setShowMergeModal(false)}>
							<Icons.x size={16} />
						</button>
					</div>
					<div className="config-body">
						{mergeMode === "select" ? (
							<div className="merge-select-mode">
								<p className="merge-hint">请选择至少2个角色进行合并：</p>
								<div className="merge-character-list">
									{sortedCharacters.map((char) => (
										<label
											key={char.id}
											className={`merge-character-item ${selectedForMerge.includes(char.id) ? 'selected' : ''}`}
										>
											<input
												type="checkbox"
												checked={selectedForMerge.includes(char.id)}
												onChange={() => handleToggleMergeSelection(char.id)}
											/>
											<span className="merge-char-name">{char.name}</span>
											<span className="merge-char-role">
												{char.role ? (
													char.role === "protagonist" ? "男主" :
													char.role === "heroine" ? "女主" :
													char.role === "antagonist" ? "反派" :
													char.role === "supportingMale" ? "男配" :
													char.role === "supportingFemale" ? "女配" :
													char.role === "mentor" ? "导师" :
													char.role === "rival" ? "对手" :
													char.role === "loveInterest" ? "爱慕对象" :
													char.role === "family" ? "家人" :
													char.role === "friend" ? "朋友" : "NPC"
												) : "未设置"}
											</span>
										</label>
									))}
								</div>
							</div>
						) : (
							<MergeConfigPanel
								sourceChars={mergeSourceChars}
								onExecute={handleExecuteMerge}
								onBack={() => setMergeMode("select")}
							/>
						)}
					</div>
					{mergeMode === "select" && (
						<div className="config-footer">
							<button
								className="btn btn-secondary"
								onClick={() => setShowMergeModal(false)}
							>
								取消
							</button>
							<button
								className="btn btn-primary"
								onClick={handleProceedToMergeConfig}
								disabled={selectedForMerge.length < 2}
							>
								下一步 ({selectedForMerge.length}个)
							</button>
						</div>
					)}
				</div>
			</div>
		)}

		{/* 手动整理关系弹窗 */}
		{showOrganizeRelationsModal && (
			<div className="modal-overlay" onClick={() => setShowOrganizeRelationsModal(false)}>
				<div className="modal-content organize-relations-modal" onClick={e => e.stopPropagation()}>
					<div className="modal-header">
						<h3>手动整理关系</h3>
						<button className="modal-close" onClick={() => setShowOrganizeRelationsModal(false)}>
							<Icons.x size={18} />
						</button>
					</div>
					<div className="modal-body">
						{skippedRelationships.length === 0 ? (
							<p className="text-neutral-400 text-center py-8">没有需要整理的关系</p>
						) : (
							<div className="organize-relations-list">
								{skippedRelationships.map((rel, index) => (
									<OrganizeRelationItem
										key={index}
										relIndex={index}
										rel={rel}
										characters={characters}
										novelId={novelId}
										onAdded={() => {
											setSkippedRelationships(prev => prev.filter((_, i) => i !== index));
										}}
									/>
								))}
							</div>
						)}
					</div>
					<div className="modal-footer">
						<button
							className="btn btn-secondary"
							onClick={() => setShowOrganizeRelationsModal(false)}
						>
							关闭
						</button>
						<button
							className="btn btn-primary"
							onClick={() => {
								useAppMetaStore.getState().showToast(`成功添加 ${skippedRelationships.length} 条关系`, "success");
								setShowOrganizeRelationsModal(false);
							}}
							disabled={skippedRelationships.length === 0}
						>
							完成 ({skippedRelationships.length})
						</button>
					</div>
				</div>
			</div>
		)}

		{/* 关系管理弹窗 */}
		{showManageRelationsModal && (
			<div className="modal-overlay" onClick={() => setShowManageRelationsModal(false)}>
				<div className="config-modal" onClick={e => e.stopPropagation()}>
					<div className="config-header">
						<div className="config-title">
							<span className="title-icon"><Icons.combine size={16} /></span>
							<span>管理关系</span>
						</div>
						<button className="close-btn" onClick={() => setShowManageRelationsModal(false)}>
							<Icons.x size={16} />
						</button>
					</div>
					<div className="config-body">
						<div className="flex items-center gap-2 mb-4">
							<label className="text-sm text-neutral-400">查看角色的关系：</label>
							<select
								value={selectedCharacterForRelations || ""}
								onChange={(e) => setSelectedCharacterForRelations(e.target.value || null)}
								className="form-select"
								style={{ maxWidth: "200px" }}
							>
								<option value="">查看所有角色关系</option>
								{characters.map((char) => (
									<option key={char.id} value={char.id}>{char.name}</option>
								))}
							</select>
						</div>
						<div className="flex items-center gap-2 justify-between mb-4">
							<div className="flex items-center gap-2">
								<label className="text-sm text-neutral-400">只显示未知角色关系</label>
								<button
									className={`w-11 h-6 rounded-full transition-colors ${showOnlyUnknown ? 'bg-[var(--accent)]' : 'bg-neutral-600'}`}
									onClick={() => setShowOnlyUnknown(!showOnlyUnknown)}
								>
									<div className={`w-4 h-4 rounded-full bg-white m-1 transition-transform ${showOnlyUnknown ? 'translate-x-5' : ''}`} />
								</button>
							</div>
						</div>
						{(() => {
							let filteredRels = showOnlyUnknown
								? relationships.filter(rel => {
									const sourceChar = characters.find(c => c.id === rel.sourceId);
									const targetChar = characters.find(c => c.id === rel.targetId);
									return !sourceChar || !targetChar;
								})
								: relationships;

							if (selectedCharacterForRelations) {
								filteredRels = filteredRels.filter(rel => 
									rel.sourceId === selectedCharacterForRelations || rel.targetId === selectedCharacterForRelations
								);
							}
							
							return filteredRels.length === 0
								? <p className="text-neutral-400 text-center py-8">暂无关系，请通过AI分析或关系图谱添加</p>
								: (
									<div className="manage-relations-list">
										{filteredRels.map((rel) => {
											const sourceChar = characters.find(c => c.id === rel.sourceId);
											const targetChar = characters.find(c => c.id === rel.targetId);
											
											let displayNicknames: string[] = [];
											
											if (selectedCharacterForRelations) {
												const isSource = rel.sourceId === selectedCharacterForRelations;
												if (isSource) {
													displayNicknames = rel.sourceNickname;
												} else {
													displayNicknames = rel.targetNickname;
												}
											}
											
											logger.debug("[关系列表] relId:", rel.id, "sourceId:", rel.sourceId, "targetId:", rel.targetId, "源角色:", sourceChar?.name || "未知", "目标角色:", targetChar?.name || "未知");
											return (
										<div key={rel.id} className="manage-relation-item">
											<div className="manage-relation-info">
												<div className="manage-relation-avatar">
													<div className={`avatar-circle-sm ${(selectedCharacterForRelations ? characters.find(c => c.id === selectedCharacterForRelations) : sourceChar)?.gender || "other"}`}>
														{(selectedCharacterForRelations ? characters.find(c => c.id === selectedCharacterForRelations) : sourceChar)?.name.charAt(0) || "?"}
													</div>
												</div>
												<div className="manage-relation-details">
													<div className="manage-relation-names">
														{selectedCharacterForRelations ? (
															<>
																<span className="relation-name">{characters.find(c => c.id === selectedCharacterForRelations)?.name || "未知"}</span>
																<span className="relation-arrow">
																	<Icons.chevronRight size={14} />
																	<span className="relation-type-badge">
																		{rel.relationType?.[0] || "其他"}
																	</span>
																	<Icons.chevronRight size={14} />
																</span>
																<span className="relation-name">{
																	(rel.sourceId === selectedCharacterForRelations ? targetChar : sourceChar)?.name || "未知"
																}</span>
															</>
														) : (
															<>
																<span className="relation-name">{sourceChar?.name || "未知"}</span>
																<span className="relation-arrow">
																	<Icons.chevronRight size={14} />
																	<span className="relation-type-badge">
																		{rel.relationType?.[0] || "其他"}
																	</span>
																	<Icons.chevronRight size={14} />
																</span>
																<span className="relation-name">{targetChar?.name || "未知"}</span>
															</>
														)}
													</div>
													<div className="manage-relation-nicknames">
														{selectedCharacterForRelations ? (
															displayNicknames?.map((nick, i) => (
																<span key={i} className="nickname-badge">{nick}</span>
															))
														) : (
															<>
																{rel.sourceNickname?.map((nick, i) => (
																	<span key={i} className="nickname-badge">{nick}</span>
																))}
																{rel.targetNickname?.map((nick, i) => (
																	<span key={i} className="nickname-badge">{nick}</span>
																))}
															</>
														)}
													</div>
												</div>
											</div>
											<div className="manage-relation-actions">
												<button
													className="relation-action-btn"
													onClick={() => {
														let validSourceId = rel.sourceId;
														let validTargetId = rel.targetId;
														
														if (!characters.find(c => c.id === rel.sourceId)) {
															validSourceId = characters[0]?.id || "";
														}
														if (!characters.find(c => c.id === rel.targetId)) {
															validTargetId = characters[0]?.id || "";
														}
														if (validSourceId === validTargetId && characters.length > 1) {
															validTargetId = characters[1]?.id || "";
														}
														
														setRelationForm({
															sourceId: validSourceId,
															targetId: validTargetId,
															relationType: [...(rel.relationType || [])],
															customRelationType: "",
															sourceNickname: [...(rel.sourceNickname || [])],
															targetNickname: [...(rel.targetNickname || [])],
															newSourceNickname: "",
															newTargetNickname: "",
														});
														setEditingRelation({ ...rel, sourceId: validSourceId, targetId: validTargetId });
													}}
													title="编辑"
												>
													<Icons.edit size={14} />
												</button>
												<button
													className="relation-action-btn danger"
													onClick={() => {
														if (confirm("确定要删除这条关系吗？")) {
															removeRelationship(novelId, rel.id);
														}
													}}
													title="删除"
												>
													<Icons.trash2 size={14} />
												</button>
											</div>
										</div>
									);
										})}
									</div>
								);
						})()}
					</div>
					<div className="config-footer">
						<button
							className="btn btn-secondary"
							onClick={() => setShowManageRelationsModal(false)}
						>
							关闭
						</button>
					</div>
				</div>
			</div>
		)}

		{/* 编辑关系弹窗 */}
		{editingRelation && (
			<div className="modal-overlay" onClick={() => setEditingRelation(null)}>
				<div className="relation-edit-modal" onClick={e => e.stopPropagation()}>
					<div className="modal-header">
						<h3>编辑关系</h3>
						<button className="modal-close" onClick={() => setEditingRelation(null)}>
							<Icons.x size={18} />
						</button>
					</div>
					<div className="modal-body">
						<div className="relation-form-section">
							<div className="form-field">
								<label>源角色</label>
								<Select
									value={relationForm.sourceId}
									onChange={(value) =>
										setRelationForm((prev) => ({ ...prev, sourceId: value }))
									}
									options={sortedCharacters.map((c) => ({ value: c.id, label: c.name }))}
								/>
							</div>

							<div className="form-field">
								<label>
									{getCharacterById(relationForm.sourceId)?.name || "源角色"}对{" "}
									{getCharacterById(relationForm.targetId)?.name || "目标角色"}的称呼
								</label>
								<div className="nickname-input-row">
									<input
										type="text"
										className="config-input flex-1"
										value={relationForm.newSourceNickname}
										onChange={(e) =>
											setRelationForm((prev) => ({
												...prev,
												newSourceNickname: e.target.value,
											}))
										}
										onKeyPress={(e) => e.key === "Enter" && (e.preventDefault(), handleAddSourceNickname(setRelationForm))}
										placeholder="输入称呼后按回车"
									/>
									<button className="nickname-add-btn" onClick={() => handleAddSourceNickname(setRelationForm)}>
										<Icons.plus size={14} />
									</button>
								</div>
								<div className="nickname-suggestions">
									{getSourceSuggestions(relationForm.newSourceNickname).map((s, i) => (
										<button
											key={i}
											className="nickname-suggestion"
											onClick={() => {
												setRelationForm((prev) => ({
													...prev,
													sourceNickname: [...prev.sourceNickname, s],
													newSourceNickname: "",
												}));
											}}
										>
											{s}
										</button>
									))}
								</div>
								{relationForm.sourceNickname.length > 0 && (
									<div className="nickname-tags">
										{relationForm.sourceNickname.map((nick, i) => (
											<span key={i} className="nickname-tag">
												{nick}
												<button
													type="button"
													className="remove-btn"
													onClick={() => handleRemoveSourceNickname(i, setRelationForm)}
												>
													×
												</button>
											</span>
										))}
									</div>
								)}
							</div>
						</div>

						<div className="relation-form-section">
							<div className="form-field">
								<label>目标角色</label>
								<Select
									value={relationForm.targetId}
									onChange={(value) =>
										setRelationForm((prev) => ({ ...prev, targetId: value }))
									}
									options={sortedCharacters.map((c) => ({ value: c.id, label: c.name }))}
								/>
							</div>

								<div className="form-field">
									<label>双人关系类型（可多选）</label>
								<div className="relation-type-checkboxes">
									{[
										["couple", "夫妻"],
										["lover", "恋人"],
										["ex-lover", "前任"],
										["father-son", "父子"],
										["father-daughter", "父女"],
										["mother-son", "母子"],
										["mother-daughter", "母女"],
										["brother", "兄弟"],
										["sister", "姐妹"],
										["brother-sister", "兄妹"],
										["sister-brother", "姐弟"],
										["mother-daughter-in-law", "婆媳"],
										["father-daughter-in-law", "公媳"],
										["mother-son-in-law", "岳母女婿"],
										["father-son-in-law", "翁婿"],
										["co-parents-male", "亲家公"],
										["co-parents-female", "亲家母"],
										["relative", "亲戚"],
										["classmate", "同学"],
										["friend", "朋友"],
										["bestie", "闺蜜"],
										["rival", "竞争对手"],
										["arch-enemy", "宿敌"],
										["enemy", "仇人"],
										["master-disciple", "师徒"],
										["teacher-student", "师生"],
										["employer-employee", "上下级"],
										["colleague", "同事"],
										["neighbor", "邻居"],
										["stranger", "陌生人"],
										["other", "其他"],
									].map(([value, label]) => (
										<label key={value} className="relation-type-checkbox">
											<input
												type="checkbox"
												checked={relationForm.relationType.includes(value as RelationType)}
												onChange={() => {
													setRelationForm((prev) => {
														const current = prev.relationType;
														if (current.includes(value as RelationType)) {
															return { ...prev, relationType: current.filter((t) => t !== value) };
														} else {
															return { ...prev, relationType: [...current, value as RelationType] };
														}
													});
												}}
											/>
											<span>{label}</span>
										</label>
									))}
								</div>
								{relationForm.relationType.includes("other") && (
									<textarea
										className="config-textarea"
										placeholder="请输入自定义关系类型..."
										value={relationForm.customRelationType}
										onChange={(e) =>
											setRelationForm((prev) => ({ ...prev, customRelationType: e.target.value }))
										}
										rows={2}
									/>
								)}
							</div>

							<div className="form-field">
								<label>
									{getCharacterById(relationForm.targetId)?.name || "目标角色"}对{" "}
									{getCharacterById(relationForm.sourceId)?.name || "源角色"}的称呼
								</label>
								<div className="nickname-input-row">
									<input
										type="text"
										className="config-input flex-1"
										value={relationForm.newTargetNickname}
										onChange={(e) =>
											setRelationForm((prev) => ({
												...prev,
												newTargetNickname: e.target.value,
											}))
										}
										onKeyPress={(e) => e.key === "Enter" && (e.preventDefault(), handleAddTargetNickname(setRelationForm))}
										placeholder="输入称呼后按回车"
									/>
									<button className="nickname-add-btn" onClick={() => handleAddTargetNickname(setRelationForm)}>
										<Icons.plus size={14} />
									</button>
								</div>
								<div className="nickname-suggestions">
									{getTargetSuggestions(relationForm.newTargetNickname).map((s, i) => (
										<button
											key={i}
											className="nickname-suggestion"
											onClick={() => {
												setRelationForm((prev) => ({
													...prev,
													targetNickname: [...prev.targetNickname, s],
													newTargetNickname: "",
												}));
											}}
										>
											{s}
										</button>
									))}
								</div>
								{relationForm.targetNickname.length > 0 && (
									<div className="nickname-tags">
										{relationForm.targetNickname.map((nick, i) => (
											<span key={i} className="nickname-tag">
												{nick}
												<button
													type="button"
													className="remove-btn"
													onClick={() => handleRemoveTargetNickname(i, setRelationForm)}
												>
													×
												</button>
											</span>
										))}
									</div>
								)}
							</div>
						</div>
					</div>
					<div className="modal-footer">
						{editingRelation && (
							<button
								className="btn btn-danger"
								onClick={() => {
									if (confirm("确定要删除这条关系吗？")) {
										removeRelationship(novelId, editingRelation.id);
										setEditingRelation(null);
									}
								}}
							>
								删除
							</button>
						)}
						<button
							className="btn btn-secondary"
							onClick={() => setEditingRelation(null)}
						>
							取消
						</button>
						<button
							className="btn btn-primary"
							onClick={() => {
								if (!relationForm.sourceId || !relationForm.targetId) {
									useAppMetaStore.getState().showToast("请选择源角色和目标角色", "warning");
									return;
								}
								if (relationForm.sourceId === relationForm.targetId) {
									useAppMetaStore.getState().showToast("源角色和目标角色不能相同", "warning");
									return;
								}
								if (relationForm.relationType.length === 0) {
									useAppMetaStore.getState().showToast("请至少选择一种关系类型", "warning");
									return;
								}

								const finalRelationType = relationForm.relationType.includes("other") && relationForm.customRelationType
									? [...relationForm.relationType.filter(t => t !== "other"), relationForm.customRelationType as RelationType]
									: relationForm.relationType;

								const existingRels = getRelationshipsForNovel(novelId)?.filter(
									r => r.sourceId === relationForm.sourceId && 
									     r.targetId === relationForm.targetId &&
									     r.id !== editingRelation?.id
								) || [];

								if (existingRels.length > 0) {
									const mergedRelation = {
										sourceId: relationForm.sourceId,
										targetId: relationForm.targetId,
										relationType: [...new Set(finalRelationType.concat(...existingRels.map(r => r.relationType || [])))],
										sourceNickname: [...new Set(relationForm.sourceNickname.concat(...existingRels.flatMap(r => r.sourceNickname || [])))],
										targetNickname: [...new Set(relationForm.targetNickname.concat(...existingRels.flatMap(r => r.targetNickname || [])))],
									};

									existingRels.forEach(r => removeRelationship(novelId, r.id));
									updateRelationship(novelId, editingRelation!.id, mergedRelation);
									useAppMetaStore.getState().showToast(`已合并 ${existingRels.length + 1} 条关系`, "success");
								} else {
									updateRelationship(novelId, editingRelation!.id, {
										sourceId: relationForm.sourceId,
										targetId: relationForm.targetId,
										relationType: finalRelationType,
										sourceNickname: relationForm.sourceNickname,
										targetNickname: relationForm.targetNickname,
									});
									useAppMetaStore.getState().showToast("关系已更新", "success");
								}
								setEditingRelation(null);
							}}
						>
							保存
						</button>
					</div>
				</div>
			</div>
		)}

		{/* 导出结果弹窗 */}
		{exportModal.show && (
			<div className="modal-overlay" onClick={() => setExportModal({ ...exportModal, show: false })}>
				<div className="config-modal export-result-modal" onClick={(e) => e.stopPropagation()}>
					<div className="config-header">
						<div className="config-title">
							<span className={`result-icon ${exportModal.success ? 'success' : 'error'}`}>
								{exportModal.success ? <Icons.checkCircle size={18} /> : <Icons.alertCircle size={18} />}
							</span>
							<span>{exportModal.success ? '保存成功' : '保存失败'}</span>
						</div>
						<button className="close-btn" onClick={() => setExportModal({ ...exportModal, show: false })}>
							<Icons.x size={16} />
						</button>
					</div>
					<div className="config-body">
						{exportModal.success ? (
							<div className="space-y-2">
								<p><strong>文件名:</strong> <span className="copyable" onClick={() => copyToClipboard(exportModal.fileName)} title="点击复制文件名">{exportModal.fileName}</span></p>
								<p><strong>保存位置:</strong> <span style={{ wordWrap: "break-word" }}>Android/data/cn.helilab.proofreader/documents/characters/</span></p>
								<p><strong>角色数量:</strong> {exportModal.characterCount}个</p>
								<p><strong>关系数量:</strong> {exportModal.relationshipCount || 0}条</p>
							</div>
						) : (
							<div className="space-y-2">
								<p>无法自动保存到文件系统</p>
								<p><strong>文件名:</strong> <span className="copyable" onClick={() => copyToClipboard(exportModal.fileName)} title="点击复制文件名">{exportModal.fileName}</span></p>
								<p><strong>角色数量:</strong> {exportModal.characterCount}个</p>
								<p><strong>关系数量:</strong> {exportModal.relationshipCount || 0}条</p>
								<p><strong>数据大小:</strong> {exportModal.dataStr.length}字节</p>
								<p className="text-sm text-neutral-400">请尝试复制数据后自行保存</p>
							</div>
						)}
					</div>
					<div className="config-footer">
						<button
							className="btn btn-secondary"
							onClick={() => setExportModal({ ...exportModal, show: false })}
						>
							关闭
						</button>
						<button
							className="btn btn-primary"
							onClick={() => copyToClipboard(exportModal.dataStr)}
						>
							<Icons.copy size={16} />
							复制JSON数据
						</button>
					</div>
				</div>
			</div>
		)}

		{/* 重新分析角色小传弹窗 */}
		{showReanalyzeModal && (
			<div className="modal-overlay" onClick={handleCloseReanalyzeModal}>
				<div className="config-modal reanalyze-modal" onClick={(e) => e.stopPropagation()}>
					<div className="config-header">
						<div className="config-title">
							<span className="title-icon"><Icons.refreshCw size={16} /></span>
							<span>重新分析角色小传</span>
						</div>
						<button className="close-btn" onClick={handleCloseReanalyzeModal}>
							<Icons.x size={16} />
						</button>
					</div>
					<div className="config-body">
						{isReanalyzing ? (
							<div className="flex flex-col items-center justify-center py-8">
								<span className="spinner large"></span>
								<p className="mt-4 text-neutral-300">正在重新分析角色小传...</p>
							</div>
						) : reanalyzeError ? (
							<div className="text-center py-8">
								<Icons.alertCircle size={32} className="text-red-400 mx-auto mb-4" />
								<p className="text-red-400">{reanalyzeError}</p>
							</div>
						) : (
							<div className="space-y-6">
								{/* 原小传 */}
								<div className="biography-section">
									<div className="biography-label">
										<Icons.history size={14} />
										<span>原角色小传</span>
									</div>
									<div className="biography-content">
										{oldBiography || <span className="text-neutral-500 italic">暂无小传</span>}
									</div>
								</div>

								{/* 分隔线 */}
								<div className="flex items-center gap-4">
									<div className="flex-1 h-px bg-neutral-700"></div>
									<Icons.chevronRight size={16} className="text-neutral-500" />
									<div className="flex-1 h-px bg-neutral-700"></div>
								</div>

								{/* 新小传 */}
								<div className="biography-section">
									<div className="biography-label">
										<Icons.sparkles size={14} />
										<span>新角色小传</span>
									</div>
									<div className="biography-content new">
										{newBiography}
									</div>
								</div>
							</div>
						)}
					</div>
					{!isReanalyzing && !reanalyzeError && (
						<div className="modal-footer">
							<button
								className="btn btn-secondary"
								onClick={handleCloseReanalyzeModal}
							>
								取消
							</button>
							<button
								className="btn btn-primary"
								onClick={handleReplaceBiography}
								disabled={!newBiography}
							>
								替换小传
							</button>
						</div>
					)}
				</div>
			</div>
		)}
	</>);
}
