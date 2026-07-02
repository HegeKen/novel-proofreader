import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useCharacterStore } from "../stores/characterStore";
import { useAIConfigStore } from "../stores/aiConfigStore";
import { useAppMetaStore } from "../stores/appMetaStore";
import type { CharacterInfo, CharacterRelationship, RelationType } from "../types";
import { Icons } from "./Icons";
import { Select } from "./Select";
import { ConfirmModal } from "./config/ConfirmModal";
import { sendChatCompletion } from "../utils/aiClient";
import type { ChatMessage } from "../utils/aiClient";

interface RelationshipGraphProps {
	novelId: string;
	characters: CharacterInfo[];
	// 外部聚焦状态（由父组件控制）
	externalFocusedId: string | null;
	// 回调：聚焦状态改变时通知父组件
	onFocusedChange: (id: string | null) => void;
	// 外部缩放控制（可选）
	externalScale?: number;
	onScaleChange?: (scale: number) => void;
}

interface GraphNode {
	character: CharacterInfo;
	x: number;
	y: number;
	angle: number;
	connectionCount: number;
	radius: number;
}

interface GraphEdge {
	relationship: CharacterRelationship;
	sourceNode: GraphNode;
	targetNode: GraphNode;
}

export function RelationshipGraph({
	novelId,
	characters,
	externalFocusedId,
	onFocusedChange,
	externalScale,
	onScaleChange,
}: RelationshipGraphProps) {
	const allRelationships = useCharacterStore((s) => s.characterRelationships);
	const relationships = useMemo(() => allRelationships[novelId] ?? [], [allRelationships, novelId]);
	const addRelationship = useCharacterStore((s) => s.addRelationship);
	const updateRelationship = useCharacterStore((s) => s.updateRelationship);
	const removeRelationship = useCharacterStore((s) => s.removeRelationship);
	const storeNodePositions = useCharacterStore((s) => s.nodePositions);
	const nodePositions = useMemo(() => storeNodePositions[novelId] ?? {}, [storeNodePositions, novelId]);

	const [showAddModal, setShowAddModal] = useState(false);
	const [editingRelation, setEditingRelation] = useState<CharacterRelationship | null>(null);
	const [showCharacterModal, setShowCharacterModal] = useState(false);
	const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);

	const [confirmModal, setConfirmModal] = useState<{
		show: boolean;
		message: string;
		onConfirm: () => void;
	}>({ show: false, message: "", onConfirm: () => {} });

	const aiConfig = useAIConfigStore((s) => s.aiConfig);
	const [isGeneratingRelationships, setIsGeneratingRelationships] = useState(false);

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

	const [viewportOffset, setViewportOffset] = useState({ x: 0, y: 0 });
	const [internalScale, setInternalScale] = useState(1);
	const scale = externalScale ?? internalScale;
	
	// 缩放处理函数
	const setScaleWithCallback = useCallback((newScale: number) => {
		const clampedScale = Math.min(Math.max(newScale, 0.3), 5);
		setInternalScale(clampedScale);
		onScaleChange?.(clampedScale);
	}, [onScaleChange]);
	
	const [isDragging, setIsDragging] = useState(false);
	const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
	const [isNodeDragging, setIsNodeDragging] = useState(false);
	const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
	const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
	const dragOffsetRef = useRef({ x: 0, y: 0 });
	const nodeDragOriginRef = useRef<{ mouseX: number; mouseY: number; nodeX: number; nodeY: number } | null>(null);
	// 双指缩放状态
	const pinchStateRef = useRef<{
		initialDistance: number;
		initialScale: number;
		initialCenter: { x: number; y: number };
		initialOffset: { x: number; y: number };
	} | null>(null);
	useEffect(() => {
		dragOffsetRef.current = dragOffset;
	}, [dragOffset]);
	const nodeDraggedRef = useRef(false);
	const pendingNodeDragRef = useRef<{ novelId: string; nodeId: string } | null>(null);
	const graphRef = useRef<HTMLDivElement>(null);

	const graphNodes = useMemo<GraphNode[]>(() => {
		if (characters.length === 0) return [];

		const connectionCount: Record<string, number> = {};
		characters.forEach((c) => (connectionCount[c.id] = 0));
		relationships.forEach((r) => {
			connectionCount[r.sourceId] = (connectionCount[r.sourceId] || 0) + 1;
			connectionCount[r.targetId] = (connectionCount[r.targetId] || 0) + 1;
		});

		const rolePriority: Record<string, number> = {
			protagonist: 1,
			heroine: 2,
			antagonist: 3,
			mentor: 4,
			rival: 5,
			loveInterest: 6,
			family: 7,
			friend: 8,
			supportingMale: 9,
			supportingFemale: 10,
			npc: 11,
		};

		const sortedChars = [...characters].sort((a, b) => {
			const priorityA = rolePriority[a.role || "npc"] || 11;
			const priorityB = rolePriority[b.role || "npc"] || 11;
			if (priorityA !== priorityB) return priorityA - priorityB;
			return (connectionCount[b.id] || 0) - (connectionCount[a.id] || 0);
		});

		const centerX = 0;
		const centerY = 0;
		
		const roleDistances: Record<string, number> = {
			protagonist: 0,
			heroine: 0,
			antagonist: 220,
			mentor: 180,
			rival: 220,
			loveInterest: 150,
			family: 170,
			friend: 190,
			supportingMale: 240,
			supportingFemale: 240,
			npc: 300,
		};

		const gridLayout: Record<string, { x: number; y: number }> = {};

		const placedNodes: Array<{ x: number; y: number; radius: number }> = [];

		const checkDistance = (x: number, y: number, radius: number): boolean => {
			for (const node of placedNodes) {
				const dist = Math.sqrt((x - node.x) ** 2 + (y - node.y) ** 2);
				const minDist = radius + node.radius + 8;
				if (dist < minDist) return false;
			}
			return true;
		};

		const getRadius = (char: CharacterInfo) => {
			const charConnCount = connectionCount[char.id] || 0;
			return Math.min(Math.max(28 + charConnCount * 2, 28), 50);
		};

		const placeWithCollisionCheck = (char: CharacterInfo, x: number, y: number): void => {
			const radius = getRadius(char);
			let finalX = x;
			let finalY = y;
			let attempts = 0;
			const maxAttempts = 30;

			while (!checkDistance(finalX, finalY, radius) && attempts < maxAttempts) {
				const angle = (attempts * 20) * (Math.PI / 180);
				const offset = (attempts + 1) * 20;
				finalX = x + Math.cos(angle) * offset;
				finalY = y + Math.sin(angle) * offset;
				attempts++;
			}

			gridLayout[char.id] = { x: finalX, y: finalY };
			placedNodes.push({ x: finalX, y: finalY, radius });
		};

		const protagonistChars = sortedChars.filter(c => c.role === "protagonist");
		const heroineChars = sortedChars.filter(c => c.role === "heroine");
		const antagonistChars = sortedChars.filter(c => c.role === "antagonist");
		const rivalChars = sortedChars.filter(c => c.role === "rival");
		const mentorChars = sortedChars.filter(c => c.role === "mentor");
		const loveInterestChars = sortedChars.filter(c => c.role === "loveInterest");
		const familyChars = sortedChars.filter(c => c.role === "family");
		const friendChars = sortedChars.filter(c => c.role === "friend");
		const supportingMaleChars = sortedChars.filter(c => c.role === "supportingMale");
		const supportingFemaleChars = sortedChars.filter(c => c.role === "supportingFemale");
		const npcChars = sortedChars.filter(c => !c.role || c.role === "npc");

		if (protagonistChars.length > 0) {
			placeWithCollisionCheck(protagonistChars[0], centerX, centerY);
		}

		if (heroineChars.length > 0) {
			const heroine = heroineChars[0];
			if (protagonistChars.length > 0) {
				placeWithCollisionCheck(heroine, centerX + 120, centerY);
			} else {
				placeWithCollisionCheck(heroine, centerX, centerY);
			}
		}

		const placeCharacters = (chars: CharacterInfo[], baseAngle: number, distance: number) => {
			if (chars.length === 0) return;
			if (chars.length === 1) {
				const angleRad = (baseAngle * Math.PI) / 180;
				const x = centerX + Math.cos(angleRad) * distance;
				const y = centerY + Math.sin(angleRad) * distance;
				placeWithCollisionCheck(chars[0], x, y);
			} else {
				const angleSpan = Math.min(140, chars.length * 35);
				const startAngle = baseAngle - angleSpan / 2;
				chars.forEach((char, i) => {
					const angle = startAngle + (i / (chars.length - 1)) * angleSpan;
					const angleRad = (angle * Math.PI) / 180;
					const x = centerX + Math.cos(angleRad) * distance;
					const y = centerY + Math.sin(angleRad) * distance;
					placeWithCollisionCheck(char, x, y);
				});
			}
		};

		placeCharacters(antagonistChars, 0, roleDistances.antagonist);
		placeCharacters(rivalChars, 30, roleDistances.rival);
		placeCharacters(mentorChars, 180, roleDistances.mentor);
		placeCharacters(loveInterestChars, -60, roleDistances.loveInterest);
		placeCharacters(familyChars, -120, roleDistances.family);
		placeCharacters(friendChars, 120, roleDistances.friend);
		placeCharacters(supportingMaleChars, 60, roleDistances.supportingMale);
		placeCharacters(supportingFemaleChars, -30, roleDistances.supportingFemale);

		if (npcChars.length > 0) {
			const totalNpcs = npcChars.length;
			npcChars.forEach((char, i) => {
				const angle = (i / totalNpcs) * 360 - 90;
				const angleRad = (angle * Math.PI) / 180;
				const x = centerX + Math.cos(angleRad) * roleDistances.npc;
				const y = centerY + Math.sin(angleRad) * roleDistances.npc * 0.7;
				placeWithCollisionCheck(char, x, y);
			});
		}

		return sortedChars.map((char) => {
			const customPos = nodePositions[char.id];
			const autoPos = gridLayout[char.id] || { x: centerX, y: centerY };
			const pos = customPos || autoPos;
			const radius = getRadius(char);
			return {
				character: char,
				x: pos.x,
				y: pos.y,
				angle: 0,
				connectionCount: connectionCount[char.id] || 0,
				radius,
			};
		});
	}, [characters, relationships, nodePositions]);

	const graphEdges = useMemo<GraphEdge[]>(() => {
		return relationships
			.map((rel) => {
				const sourceNode = graphNodes.find((n) => n.character.id === rel.sourceId);
				const targetNode = graphNodes.find((n) => n.character.id === rel.targetId);
				if (!sourceNode || !targetNode) return null;
				return { relationship: rel, sourceNode, targetNode };
			})
			.filter((e): e is GraphEdge => e !== null);
	}, [relationships, graphNodes]);

	const relatedCharacterIds = useMemo(() => {
		if (!externalFocusedId) return null;
		const relatedIds = new Set<string>();
		relatedIds.add(externalFocusedId);
		relationships.forEach((rel) => {
			if (rel.sourceId === externalFocusedId) {
				relatedIds.add(rel.targetId);
			} else if (rel.targetId === externalFocusedId) {
				relatedIds.add(rel.sourceId);
			}
		});
		return relatedIds;
	}, [externalFocusedId, relationships]);

	const filteredGraphNodes = useMemo(() => {
		if (!relatedCharacterIds) return graphNodes;
		return graphNodes.filter((n) => relatedCharacterIds.has(n.character.id));
	}, [graphNodes, relatedCharacterIds]);

	const filteredGraphEdges = useMemo(() => {
		if (!relatedCharacterIds) return graphEdges;
		return graphEdges.filter(
			(e) => e.relationship.sourceId === externalFocusedId || e.relationship.targetId === externalFocusedId
		);
	}, [graphEdges, externalFocusedId, relatedCharacterIds]);

	const getCharacterById = useCallback(
		(id: string) => characters.find((c) => c.id === id),
		[characters]
	);

	const getRelationBetween = useCallback(
		(sourceId: string, targetId: string) => {
			return relationships.find(
				(r) =>
					(r.sourceId === sourceId && r.targetId === targetId) ||
					(r.sourceId === targetId && r.targetId === sourceId)
			);
		},
		[relationships]
	);

	const getCharacterRelations = useCallback(
		(characterId: string) => {
			return relationships.filter(
				(r) => r.sourceId === characterId || r.targetId === characterId
			);
		},
		[relationships]
	);

	const handleNodeClick = useCallback(
		(character: CharacterInfo) => {
			setSelectedCharacterId(character.id);
			onFocusedChange(character.id);
			setShowCharacterModal(true);
		},
		[onFocusedChange]
	);

	const handleOpenAddModal = useCallback(
		(sourceId?: string, targetId?: string) => {
			setRelationForm({
				sourceId: sourceId || (characters.length > 0 ? characters[0].id : ""),
				targetId: targetId || (characters.length > 1 ? characters[1].id : ""),
				relationType: [],
				customRelationType: "",
				sourceNickname: [],
				targetNickname: [],
				newSourceNickname: "",
				newTargetNickname: "",
			});
			setEditingRelation(null);
			setShowAddModal(true);
		},
		[characters]
	);

	const handleOpenEditModal = useCallback(
		(relation: CharacterRelationship) => {
			setRelationForm({
				sourceId: relation.sourceId,
				targetId: relation.targetId,
				relationType: Array.isArray(relation.relationType) ? relation.relationType : (relation.relationType ? [relation.relationType] : []),
				customRelationType: relation.customRelationType || "",
				sourceNickname: [...relation.sourceNickname],
				targetNickname: [...relation.targetNickname],
				newSourceNickname: "",
				newTargetNickname: "",
			});
			setEditingRelation(relation);
			setShowAddModal(true);
		},
		[]
	);

	const handleAddSourceNickname = useCallback(() => {
		if (!relationForm.newSourceNickname.trim()) return;
		setRelationForm((prev) => ({
			...prev,
			sourceNickname: [...prev.sourceNickname, prev.newSourceNickname.trim()],
			newSourceNickname: "",
		}));
	}, [relationForm.newSourceNickname]);

	const handleAddTargetNickname = useCallback(() => {
		if (!relationForm.newTargetNickname.trim()) return;
		setRelationForm((prev) => ({
			...prev,
			targetNickname: [...prev.targetNickname, prev.newTargetNickname.trim()],
			newTargetNickname: "",
		}));
	}, [relationForm.newTargetNickname]);

	const handleRemoveSourceNickname = useCallback((index: number) => {
		setRelationForm((prev) => ({
			...prev,
			sourceNickname: prev.sourceNickname.filter((_, i) => i !== index),
		}));
	}, []);

	const handleRemoveTargetNickname = useCallback((index: number) => {
		setRelationForm((prev) => ({
			...prev,
			targetNickname: prev.targetNickname.filter((_, i) => i !== index),
		}));
	}, []);

	const handleSaveRelation = useCallback(() => {
		if (!relationForm.sourceId || !relationForm.targetId) return;
		if (relationForm.sourceId === relationForm.targetId) return;
		if (relationForm.sourceNickname.length === 0 || relationForm.targetNickname.length === 0) return;

		const existingRelation = getRelationBetween(relationForm.sourceId, relationForm.targetId);

		if (editingRelation) {
			updateRelationship(novelId, editingRelation.id, {
				relationType: relationForm.relationType.length > 0 ? (relationForm.relationType as RelationType[]) : undefined,
				customRelationType: relationForm.relationType.includes("other") ? relationForm.customRelationType : undefined,
				sourceNickname: relationForm.sourceNickname,
				targetNickname: relationForm.targetNickname,
			});
		} else if (existingRelation) {
			updateRelationship(novelId, existingRelation.id, {
				relationType: relationForm.relationType.length > 0 ? (relationForm.relationType as RelationType[]) : undefined,
				customRelationType: relationForm.relationType.includes("other") ? relationForm.customRelationType : undefined,
				sourceNickname: [...new Set([...existingRelation.sourceNickname, ...relationForm.sourceNickname])],
				targetNickname: [...new Set([...existingRelation.targetNickname, ...relationForm.targetNickname])],
			});
		} else {
			addRelationship(novelId, {
				sourceId: relationForm.sourceId,
				targetId: relationForm.targetId,
				relationType: relationForm.relationType.length > 0 ? (relationForm.relationType as RelationType[]) : undefined,
				customRelationType: relationForm.relationType.includes("other") ? relationForm.customRelationType : undefined,
				sourceNickname: relationForm.sourceNickname,
				targetNickname: relationForm.targetNickname,
			});
		}

		setShowAddModal(false);
	}, [
		novelId,
		relationForm,
		editingRelation,
		addRelationship,
		updateRelationship,
		getRelationBetween,
	]);

	const handleDeleteRelation = useCallback(
		(relationId: string) => {
			setConfirmModal({
				show: true,
				message: "确定要删除这个关系吗？",
				onConfirm: () => {
					removeRelationship(novelId, relationId);
					setConfirmModal(prev => ({ ...prev, show: false }));
				},
			});
		},
		[novelId, removeRelationship]
	);

	const handleMouseDown = useCallback((e: React.MouseEvent) => {
		if (e.button !== 0) return;
		setIsDragging(true);
		setDragStart({ x: e.clientX, y: e.clientY });
	}, []);

	const handleNodeMouseDown = useCallback(
		(e: React.MouseEvent, nodeId: string, nodeX: number, nodeY: number) => {
			e.stopPropagation();
			setIsNodeDragging(true);
			setDraggingNodeId(nodeId);
			nodeDragOriginRef.current = { mouseX: e.clientX, mouseY: e.clientY, nodeX, nodeY };
			setDragOffset({ x: 0, y: 0 });
			dragOffsetRef.current = { x: 0, y: 0 };
			nodeDraggedRef.current = false;
			pendingNodeDragRef.current = { novelId: novelId, nodeId };
		},
		[novelId]
	);

	const handleMouseMove = useCallback(
		(e: React.MouseEvent) => {
			if (isNodeDragging && draggingNodeId && nodeDragOriginRef.current) {
				const dx = e.clientX - nodeDragOriginRef.current.mouseX;
				const dy = e.clientY - nodeDragOriginRef.current.mouseY;
				if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
					nodeDraggedRef.current = true;
				}
				setDragOffset({ x: dx / scale, y: dy / scale });
				dragOffsetRef.current = { x: dx / scale, y: dy / scale };
			} else if (isDragging) {
				const dx = e.clientX - dragStart.x;
				const dy = e.clientY - dragStart.y;
				setViewportOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
				setDragStart({ x: e.clientX, y: e.clientY });
			}
		},
		[isDragging, dragStart, isNodeDragging, draggingNodeId, scale]
	);

	const handleMouseUp = useCallback(() => {
		if (isNodeDragging && draggingNodeId && nodeDragOriginRef.current) {
			const finalX = nodeDragOriginRef.current.nodeX + dragOffsetRef.current.x;
			const finalY = nodeDragOriginRef.current.nodeY + dragOffsetRef.current.y;
			const currentPositions = useCharacterStore.getState().nodePositions[novelId] ?? {};
			useCharacterStore.getState().setNodePositions(novelId, {
				...currentPositions,
				[draggingNodeId]: { x: finalX, y: finalY },
			});
			pendingNodeDragRef.current = null;
		}
		setIsDragging(false);
		setIsNodeDragging(false);
		setDraggingNodeId(null);
	}, [isNodeDragging, draggingNodeId, novelId]);

	const handleWheel = useCallback((e: React.WheelEvent) => {
		e.stopPropagation();
		const delta = e.deltaY > 0 ? 0.9 : 1.1;
		const newScale = Math.min(Math.max(scale * delta, 0.3), 5);
		setScaleWithCallback(newScale);
	}, [scale, setScaleWithCallback]);

	// 计算双指触摸距离
	const getTouchDistance = (touches: React.TouchList): number => {
		const dx = touches[0].clientX - touches[1].clientX;
		const dy = touches[0].clientY - touches[1].clientY;
		return Math.sqrt(dx * dx + dy * dy);
	};

	// 计算双指触摸中心点
	const getTouchCenter = (touches: React.TouchList): { x: number; y: number } => {
		return {
			x: (touches[0].clientX + touches[1].clientX) / 2,
			y: (touches[0].clientY + touches[1].clientY) / 2,
		};
	};

	const handleTouchStart = useCallback((e: React.TouchEvent) => {
		if (e.touches.length === 2) {
			// 双指触摸：开始缩放
			const distance = getTouchDistance(e.touches);
			const center = getTouchCenter(e.touches);
			pinchStateRef.current = {
				initialDistance: distance,
				initialScale: scale,
				initialCenter: center,
				initialOffset: viewportOffset,
			};
			setIsDragging(false);
		} else if (e.touches.length === 1) {
			// 单指触摸：开始拖拽
			if (pinchStateRef.current) {
				pinchStateRef.current = null;
			}
			setIsDragging(true);
			setDragStart({ x: e.touches[0].clientX, y: e.touches[0].clientY });
		}
	}, [scale, viewportOffset]);

	const handleNodeTouchStart = useCallback(
		(e: React.TouchEvent, nodeId: string, nodeX: number, nodeY: number) => {
			e.stopPropagation();
			setIsNodeDragging(true);
			setDraggingNodeId(nodeId);
			nodeDragOriginRef.current = { mouseX: e.touches[0].clientX, mouseY: e.touches[0].clientY, nodeX, nodeY };
			setDragOffset({ x: 0, y: 0 });
			dragOffsetRef.current = { x: 0, y: 0 };
			nodeDraggedRef.current = false;
			pendingNodeDragRef.current = { novelId: novelId, nodeId };
		},
		[novelId]
	);

	const handleTouchMove = useCallback(
		(e: React.TouchEvent) => {
			// 双指缩放
			if (e.touches.length === 2 && pinchStateRef.current) {
				const currentDistance = getTouchDistance(e.touches);
				const currentCenter = getTouchCenter(e.touches);
				const scaleFactor = currentDistance / pinchStateRef.current.initialDistance;
				const newScale = Math.min(Math.max(pinchStateRef.current.initialScale * scaleFactor, 0.3), 5);
				
				// 计算新的偏移，以保持中心点位置
				const centerDx = currentCenter.x - pinchStateRef.current.initialCenter.x;
				const centerDy = currentCenter.y - pinchStateRef.current.initialCenter.y;
				const scaleDiff = newScale - pinchStateRef.current.initialScale;
				
				// 调整偏移以保持缩放中心
				const newOffsetX = pinchStateRef.current.initialOffset.x + centerDx - (currentCenter.x - graphRef.current!.clientWidth / 2) * (scaleDiff / pinchStateRef.current.initialScale);
				const newOffsetY = pinchStateRef.current.initialOffset.y + centerDy - (currentCenter.y - graphRef.current!.clientHeight / 2) * (scaleDiff / pinchStateRef.current.initialScale);
				
				setScaleWithCallback(newScale);
				setViewportOffset({ x: newOffsetX, y: newOffsetY });
			} else if (e.touches.length === 1) {
				// 单指拖拽
				if (isNodeDragging && draggingNodeId && nodeDragOriginRef.current) {
					const dx = e.touches[0].clientX - nodeDragOriginRef.current.mouseX;
					const dy = e.touches[0].clientY - nodeDragOriginRef.current.mouseY;
					if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
						nodeDraggedRef.current = true;
					}
					setDragOffset({ x: dx / scale, y: dy / scale });
					dragOffsetRef.current = { x: dx / scale, y: dy / scale };
				} else if (isDragging && !pinchStateRef.current) {
					const dx = e.touches[0].clientX - dragStart.x;
					const dy = e.touches[0].clientY - dragStart.y;
					setViewportOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
					setDragStart({ x: e.touches[0].clientX, y: e.touches[0].clientY });
				}
			}
		},
		[isDragging, dragStart, isNodeDragging, draggingNodeId, scale, setScaleWithCallback]
	);

	const handleTouchEnd = useCallback(() => {
		// 清除双指缩放状态
		pinchStateRef.current = null;
		
		if (isNodeDragging && draggingNodeId && nodeDragOriginRef.current) {
			const finalX = nodeDragOriginRef.current.nodeX + dragOffsetRef.current.x;
			const finalY = nodeDragOriginRef.current.nodeY + dragOffsetRef.current.y;
			const currentPositions = useCharacterStore.getState().nodePositions[novelId] ?? {};
			useCharacterStore.getState().setNodePositions(novelId, {
				...currentPositions,
				[draggingNodeId]: { x: finalX, y: finalY },
			});
			pendingNodeDragRef.current = null;
		}
		setIsDragging(false);
		setIsNodeDragging(false);
		setDraggingNodeId(null);
	}, [isNodeDragging, draggingNodeId, novelId]);

	const handleResetLayout = useCallback(() => {
		// 直接计算并设置正确的缩放和偏移，不先重置
		requestAnimationFrame(() => {
			if (!graphRef.current) return;
			const svg = graphRef.current.querySelector("svg");
			if (!svg) return;

			const vbAttr = svg.getAttribute("viewBox");
			if (!vbAttr) return;

			const parts = vbAttr.split(" ").map(Number);
			if (parts.length !== 4) return;
			const [, , vbWidth, vbHeight] = parts;

			const containerWidth = graphRef.current.clientWidth;
			const containerHeight = graphRef.current.clientHeight;
			if (containerWidth === 0 || containerHeight === 0) return;

			const paddingFactor = 0.85;
			const scaleX = (containerWidth / vbWidth) * paddingFactor;
			const scaleY = (containerHeight / vbHeight) * paddingFactor;
			const newScale = Math.round(Math.max(Math.min(scaleX, scaleY), 0.1) * 100) / 100;

			const scaledWidth = vbWidth * newScale;
			const scaledHeight = vbHeight * newScale;
			const offsetX = Math.round((containerWidth - scaledWidth) / 2);
			const offsetY = Math.round((containerHeight - scaledHeight) / 2);

			setScaleWithCallback(newScale);
			setViewportOffset({ x: offsetX, y: offsetY });
		});
	}, [setScaleWithCallback]);

	// 焦点改变时自动适应窗口
	useEffect(() => {
		// 延迟一点执行，确保 DOM 已更新
		const timer = setTimeout(() => {
			handleResetLayout();
		}, 100);
		return () => clearTimeout(timer);
	}, [externalFocusedId, handleResetLayout]);

	useEffect(() => {
		const handleGlobalUp = () => {
			if (pendingNodeDragRef.current && nodeDragOriginRef.current) {
				const { novelId: nid, nodeId } = pendingNodeDragRef.current;
				const finalX = nodeDragOriginRef.current.nodeX + dragOffsetRef.current.x;
				const finalY = nodeDragOriginRef.current.nodeY + dragOffsetRef.current.y;
				const currentPositions = useCharacterStore.getState().nodePositions[nid] ?? {};
				useCharacterStore.getState().setNodePositions(nid, {
					...currentPositions,
					[nodeId]: { x: finalX, y: finalY },
				});
				pendingNodeDragRef.current = null;
			}
			setIsDragging(false);
			setIsNodeDragging(false);
			setDraggingNodeId(null);
		};
		window.addEventListener("mouseup", handleGlobalUp);
		window.addEventListener("touchend", handleGlobalUp);
		return () => {
			window.removeEventListener("mouseup", handleGlobalUp);
			window.removeEventListener("touchend", handleGlobalUp);
		};
	}, []);

	// AI生成角色关系
	const handleGenerateRelationships = useCallback(async () => {
		if (characters.length < 2) {
			useAppMetaStore.getState().showToast("至少需要2个角色才能生成关系", "warning");
			return;
		}
		if (!aiConfig.apiKey || !aiConfig.baseURL) {
			useAppMetaStore.getState().showToast("请先在设置中配置AI模型", "warning");
			return;
		}

		setIsGeneratingRelationships(true);
		try {
			const charsInfo = characters.map(c => ({
				id: c.id,
				name: c.name,
				gender: c.gender,
				role: c.role || "",
				age: c.age || "",
				identity: c.identity || "",
				personality: c.personality || "",
				notes: c.notes || "",
				aliases: c.aliases || [],
				relationTerms: c.relationTerms || [],
			}));

			const existingRelationships = relationships.map(r => {
				const srcChar = characters.find(c => c.id === r.sourceId);
				const tgtChar = characters.find(c => c.id === r.targetId);
				return {
					sourceName: srcChar?.name || "未知",
					targetName: tgtChar?.name || "未知",
					relationType: r.relationType || [],
					sourceNickname: r.sourceNickname,
					targetNickname: r.targetNickname,
				};
			});

			const systemPrompt = `你是一位小说角色关系分析专家。根据角色信息列表，分析他们之间可能存在的人际关系。

## 要求
- 只基于角色信息中提到的关联进行分析，不要凭空编造关系
- 每对角色之间只输出一条关系（从最相关的角度）
- 称呼要符合角色身份和关系（如夫妻互称"老公/老婆"，师徒称"师父/徒弟"）
- 注意关系方向：sourceNickname 是源角色对目标角色的称呼，targetNickname 是目标角色对源角色的称呼
- 关系类型从以下中选择：couple(夫妻)、father-son(父子)、father-daughter(父女)、mother-son(母子)、mother-daughter(母女)、brother(兄弟)、sister(姐妹)、brother-sister(兄妹)、sister-brother(姐弟)、mother-daughter-in-law(婆媳)、father-daughter-in-law(公媳)、mother-son-in-law(岳母女婿)、father-son-in-law(翁婿)、co-parents-male(亲家公)、co-parents-female(亲家母)、lover(恋人)、ex-lover(前任)、classmate(同学)、friend(朋友)、bestie(闺蜜)、rival(竞争对手)、arch-enemy(宿敌)、enemy(仇人)、master-disciple(师徒)、teacher-student(师生)、employer-employee(上下级)、colleague(同事)、neighbor(邻居)、relative(亲戚)、stranger(陌生人)、other(其他)
- 如果判断关系类型不属于以上具体类型，请使用 "other"，同时在 customRelationType 字段中用中文描述具体关系（如"青梅竹马"、"结拜兄弟"、"救命恩人"等）
- 如果已有关系存在但称呼不完整，可以补充称呼
- 严格按照JSON格式输出

## 输出格式
输出一个JSON数组，每个元素包含：
{
  "sourceName": "源角色名称（必须匹配输入中的name）",
  "targetName": "目标角色名称（必须匹配输入中的name）",
  "relationType": ["关系类型数组"],
  "customRelationType": "当relationType包含other时，填写中文关系描述；否则无需填写",
  "sourceNickname": ["源角色对目标角色的称呼"],
  "targetNickname": ["目标角色对源角色的称呼"]
}`;

			const userPrompt = `## 角色列表
${JSON.stringify(charsInfo, null, 2)}

## 已有关系
${existingRelationships.length > 0 ? JSON.stringify(existingRelationships, null, 2) : "暂无"}

请根据以上角色信息，分析他们之间应该存在的关系，输出JSON数组。如果角色之间没有明确的关联，不要强行建立关系。`;

			const messages: ChatMessage[] = [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: userPrompt },
			];

			const config = {
				baseURL: aiConfig.baseURL,
				apiKey: aiConfig.apiKey,
				model: aiConfig.model,
				customHeaders: {} as Record<string, string>,
				maxCharsPerRequest: 0,
				enableLogging: false,
			};

			const response = await sendChatCompletion(messages, config);

			// 解析JSON
			let parsed: Array<{
				sourceName: string;
				targetName: string;
				relationType: string[];
				customRelationType?: string;
				sourceNickname: string[];
				targetNickname: string[];
			}>;

			try {
				parsed = JSON.parse(response);
			} catch {
				const jsonMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
				if (jsonMatch) {
					parsed = JSON.parse(jsonMatch[1]);
				} else {
					const arrMatch = response.match(/\[[\s\S]*\]/);
					if (arrMatch) {
						parsed = JSON.parse(arrMatch[0]);
					} else {
						throw new Error("无法解析AI返回结果");
					}
				}
			}

			if (!Array.isArray(parsed)) throw new Error("AI返回结果格式错误");

			// 创建角色名称到ID的映射
			const nameToId: Record<string, string> = {};
			characters.forEach(c => { nameToId[c.name] = c.id; });

			let addedCount = 0;
			for (const rel of parsed) {
				const sourceId = nameToId[rel.sourceName];
				const targetId = nameToId[rel.targetName];
				if (!sourceId || !targetId || sourceId === targetId) continue;

				// 检查是否已存在相同关系
				const existing = getRelationBetween(sourceId, targetId);
				if (existing) {
					// 补充称呼和关系类型
					const newSourceNicknames = rel.sourceNickname.filter(n => !existing.sourceNickname.includes(n));
					const newTargetNicknames = rel.targetNickname.filter(n => !existing.targetNickname.includes(n));
					const hasNewRelationType = rel.relationType.length > 0 && (!existing.relationType || existing.relationType.length === 0);
					const hasNewCustomType = rel.customRelationType && (!existing.customRelationType || existing.customRelationType !== rel.customRelationType);
					if (newSourceNicknames.length > 0 || newTargetNicknames.length > 0 || hasNewRelationType || hasNewCustomType) {
						updateRelationship(novelId, existing.id, {
							relationType: rel.relationType.length > 0 ? rel.relationType as RelationType[] : existing.relationType,
							customRelationType: rel.customRelationType || existing.customRelationType,
							sourceNickname: [...existing.sourceNickname, ...newSourceNicknames],
							targetNickname: [...existing.targetNickname, ...newTargetNicknames],
						});
						addedCount++;
					}
				} else {
					addRelationship(novelId, {
						sourceId,
						targetId,
						relationType: rel.relationType.length > 0 ? rel.relationType as RelationType[] : undefined,
						customRelationType: rel.customRelationType,
						sourceNickname: rel.sourceNickname || [],
						targetNickname: rel.targetNickname || [],
					});
					addedCount++;
				}
			}

			useAppMetaStore.getState().showToast(`关系生成完成，新增/更新 ${addedCount} 条关系`, "success");
		} catch (err) {
			useAppMetaStore.getState().showToast("关系生成失败: " + (err instanceof Error ? err.message : String(err)), "error");
		} finally {
			setIsGeneratingRelationships(false);
		}
	}, [characters, relationships, aiConfig, novelId, addRelationship, updateRelationship, getRelationBetween]);

	const getSourceSuggestions = useCallback(
		(input: string) => {
			if (!input.trim()) return [];
			const targetChar = getCharacterById(relationForm.targetId);
			const suggestions: string[] = [];
			if (targetChar) {
				suggestions.push(targetChar.name, ...(targetChar.relationTerms || []));
			}
			return suggestions.filter((s) => s.toLowerCase().includes(input.toLowerCase()));
		},
		[relationForm.targetId, getCharacterById]
	);

	const getTargetSuggestions = useCallback(
		(input: string) => {
			if (!input.trim()) return [];
			const sourceChar = getCharacterById(relationForm.sourceId);
			const suggestions: string[] = [];
			if (sourceChar) {
				suggestions.push(sourceChar.name, ...(sourceChar.relationTerms || []));
			}
			return suggestions.filter((s) => s.toLowerCase().includes(input.toLowerCase()));
		},
		[relationForm.sourceId, getCharacterById]
	);

	const viewBox = useMemo(() => {
		if (filteredGraphNodes.length === 0) return "-300 -300 600 600";
		
		let minX = Infinity, maxX = -Infinity;
		let minY = Infinity, maxY = -Infinity;
		
		filteredGraphNodes.forEach(node => {
			minX = Math.min(minX, node.x);
			maxX = Math.max(maxX, node.x);
			minY = Math.min(minY, node.y);
			maxY = Math.max(maxY, node.y);
		});
		
		const maxRadius = filteredGraphNodes.reduce((max, n) => Math.max(max, n.radius), 0);
		const padding = maxRadius + 80;
		const width = maxX - minX + padding * 2;
		const height = maxY - minY + padding * 2;
		const centerX = (minX + maxX) / 2;
		const centerY = (minY + maxY) / 2;
		
		return `${centerX - width / 2} ${centerY - height / 2} ${width} ${height}`;
	}, [filteredGraphNodes]);

	if (characters.length === 0) {
		return (
			<div className="relationship-graph-empty">
				<div className="empty-icon">
					<Icons.user size={48} />
				</div>
				<p className="empty-title">暂无角色</p>
				<p className="empty-desc">请先添加角色，再建立人物关系</p>
			</div>
		);
	}

	return (
		<div className="relationship-graph-container">
			<div className="relationship-graph-toolbar">
				<div className="graph-toolbar-info">
					<span>{filteredGraphNodes.length} 个角色</span>
					<span>{filteredGraphEdges.length} 条关系</span>
				</div>
				<div className="graph-toolbar-actions">
					<button
						className="graph-toolbar-btn"
						onClick={handleGenerateRelationships}
						disabled={isGeneratingRelationships || characters.length < 2}
					>
						<Icons.sparkle size={12} />
						<span>{isGeneratingRelationships ? "生成中..." : "AI生成关系"}</span>
					</button>
				</div>
			</div>

			<div
				className={`relationship-graph-viewport ${isDragging ? "dragging" : ""}`}
				ref={graphRef}
				onMouseDown={handleMouseDown}
				onMouseMove={handleMouseMove}
				onMouseUp={handleMouseUp}
				onWheel={handleWheel}
				onTouchStart={handleTouchStart}
				onTouchMove={handleTouchMove}
				onTouchEnd={handleTouchEnd}
			>
				<div
					className="relationship-graph-content"
					style={{
						transform: `translate(${viewportOffset.x}px, ${viewportOffset.y}px) scale(${scale})`,
					}}
				>
					<svg className="relationship-graph-svg" viewBox={viewBox}>
						<defs>
							<marker
								id="arrowhead-end"
								markerWidth="10"
								markerHeight="7"
								refX="9"
								refY="3.5"
								orient="auto"
							>
								<polygon points="0 0, 10 3.5, 0 7" fill="#8b4513" />
							</marker>
							<marker
								id="arrowhead-start"
								markerWidth="10"
								markerHeight="7"
								refX="1"
								refY="3.5"
								orient="auto"
							>
								<polygon points="10 0, 0 3.5, 10 7" fill="#8b4513" />
							</marker>
						</defs>

						{filteredGraphEdges.map((edge) => {
							const isSourceDragged = isNodeDragging && draggingNodeId === edge.sourceNode.character.id;
							const isTargetDragged = isNodeDragging && draggingNodeId === edge.targetNode.character.id;
							const effectiveSourceX = edge.sourceNode.x + (isSourceDragged ? dragOffset.x : 0);
							const effectiveSourceY = edge.sourceNode.y + (isSourceDragged ? dragOffset.y : 0);
							const effectiveTargetX = edge.targetNode.x + (isTargetDragged ? dragOffset.x : 0);
							const effectiveTargetY = edge.targetNode.y + (isTargetDragged ? dragOffset.y : 0);
							const sourceRadius = edge.sourceNode.radius;
							const targetRadius = edge.targetNode.radius;
							const dx = effectiveTargetX - effectiveSourceX;
							const dy = effectiveTargetY - effectiveSourceY;
							const distance = Math.sqrt(dx * dx + dy * dy);
							const nx = dx / distance;
							const ny = dy / distance;
							
							const startX = effectiveSourceX + nx * sourceRadius;
							const startY = effectiveSourceY + ny * sourceRadius;
							const endX = effectiveTargetX - nx * targetRadius;
							const endY = effectiveTargetY - ny * targetRadius;
							
							const midX = (startX + endX) / 2;
							const midY = (startY + endY) / 2;
							
							const angle = Math.atan2(dy, dx) * (180 / Math.PI);
							const adjustedAngle = (angle > 90 || angle < -90) ? angle + 180 : angle;
							const isVerticalEdge = Math.abs(Math.abs(adjustedAngle) - 90) < 20;
							
							const rawRelationType = edge.relationship.relationType;
							const relationTypes = Array.isArray(rawRelationType) ? rawRelationType : (rawRelationType ? [rawRelationType] : []);
							const typeLabels: string[] = [];
							const typeMap: Record<string, string> = {
								couple: "夫妻",
								"father-son": "父子",
								"father-daughter": "父女",
								"mother-son": "母子",
								"mother-daughter": "母女",
								brother: "兄弟",
								sister: "姐妹",
								"brother-sister": "兄妹",
								"sister-brother": "姐弟",
								"mother-daughter-in-law": "婆媳",
								"father-daughter-in-law": "公媳",
								"mother-son-in-law": "岳母女婿",
								"father-son-in-law": "翁婿",
								"co-parents-male": "亲家公",
								"co-parents-female": "亲家母",
								lover: "恋人",
								"ex-lover": "前任",
								classmate: "同学",
								friend: "朋友",
								bestie: "闺蜜",
								rival: "竞争对手",
								"arch-enemy": "宿敌",
								enemy: "仇人",
								"master-disciple": "师徒",
								"teacher-student": "师生",
								"employer-employee": "上下级",
								colleague: "同事",
								neighbor: "邻居",
								relative: "亲戚",
								stranger: "陌生人",
							};
							relationTypes.forEach((t) => {
								if (t === "other") {
									typeLabels.push(edge.relationship.customRelationType || "其他");
								} else {
									typeLabels.push(typeMap[t as string] || t);
								}
							});
							const label = typeLabels.join("、");
							const labelWidth = Math.max(label.length * 11 + 16, 50);
							const verticalRectHeight = Math.max(label.length * 18 + 16, 50);
							const verticalRectWidth = 24;
							
							return (
								<g key={edge.relationship.id} className="graph-edge">
									<line
										x1={startX}
										y1={startY}
										x2={endX}
										y2={endY}
										className="edge-line"
										markerStart="url(#arrowhead-start)"
										markerEnd="url(#arrowhead-end)"
									/>
									{label && (
										<g
											transform={`translate(${midX}, ${midY})${isVerticalEdge ? "" : ` rotate(${adjustedAngle})`}`}
											className="edge-label-group"
											onClick={() => handleOpenEditModal(edge.relationship)}
										>
											<rect
												x={isVerticalEdge ? -verticalRectWidth / 2 : -labelWidth / 2}
												y={isVerticalEdge ? -verticalRectHeight / 2 : -10}
												width={isVerticalEdge ? verticalRectWidth : labelWidth}
												height={isVerticalEdge ? verticalRectHeight : 20}
												rx="3"
												className="edge-label-bg"
											/>
											{isVerticalEdge ? (
												<text className="edge-label-text" textAnchor="middle" dominantBaseline="middle">
													{label.split('').map((char, i) => (
														<tspan key={i} x="0" dy={i === 0 ? undefined : "1.2em"}>{char}</tspan>
													))}
												</text>
											) : (
												<text className="edge-label-text" textAnchor="middle" dominantBaseline="middle">
													{label}
												</text>
											)}
										</g>
									)}
								</g>
							);
						})}

						{filteredGraphNodes.map((node) => {
							const isDraggingThis = isNodeDragging && draggingNodeId === node.character.id;
							const displayX = node.x + (isDraggingThis ? dragOffset.x : 0);
							const displayY = node.y + (isDraggingThis ? dragOffset.y : 0);
							return (
							<g
								key={node.character.id}
								className={`graph-node ${isNodeDragging && draggingNodeId === node.character.id ? 'dragging' : ''} ${node.character.id === externalFocusedId ? 'focused' : ''}`}
								transform={`translate(${displayX}, ${displayY})`}
								onClick={() => {
									if (!nodeDraggedRef.current) {
										handleNodeClick(node.character);
									}
								}}
								onMouseDown={(e) => handleNodeMouseDown(e, node.character.id, node.x, node.y)}
								onTouchStart={(e) => handleNodeTouchStart(e, node.character.id, node.x, node.y)}
							>
								<circle r={`${node.radius}`} className={`node-circle ${node.character.gender} ${node.character.role || ''} ${node.character.id === externalFocusedId ? 'focused' : ''}`} />
								<text className="node-name" textAnchor="middle" dominantBaseline="middle">
									{node.character.name.length > Math.floor(node.radius / 7)
										? node.character.name.slice(0, Math.floor(node.radius / 7)) + "..."
										: node.character.name}
								</text>
								{node.character.role && (
									<g className="node-role-indicator" transform={`translate(0, ${node.radius * 0.63})`}>
										<rect x="-18" y="-8" width="36" height="16" rx="8" className="role-badge-circle" />
										<text className="role-label" textAnchor="middle" dominantBaseline="middle">
											{node.character.role === "protagonist" ? "男主" :
											 node.character.role === "heroine" ? "女主" :
											 node.character.role === "antagonist" ? "反派" :
											 node.character.role === "supportingMale" ? "男配" :
											 node.character.role === "supportingFemale" ? "女配" :
											 node.character.role === "mentor" ? "导师" :
											 node.character.role === "rival" ? "对手" :
											 node.character.role === "loveInterest" ? "爱慕对象" :
											 node.character.role === "family" ? "家人" :
											 node.character.role === "friend" ? "朋友" : "NPC"}
										</text>
									</g>
								)}
								{node.connectionCount > 0 && (
									<g className="node-connection-indicator" transform={`translate(${node.radius * 0.7}, ${-node.radius * 0.7})`}>
										<circle r="10" className="connection-badge" />
										<text className="connection-count" textAnchor="middle" dominantBaseline="middle">
											{node.connectionCount}
										</text>
									</g>
								)}
							</g>
							);
						})}
					</svg>
				</div>
			</div>

			{showAddModal && (
				<div className="modal-overlay" onClick={() => setShowAddModal(false)}>
					<div className="relation-edit-modal" onClick={(e) => e.stopPropagation()}>
						<div className="modal-header">
							<h3>{editingRelation ? "编辑关系" : "添加关系"}</h3>
							<button className="modal-close" onClick={() => setShowAddModal(false)}>
								<Icons.close size={18} />
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
										options={characters.map((c) => ({ value: c.id, label: c.name }))}
										disabled={!!editingRelation}
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
											onKeyPress={(e) => e.key === "Enter" && (e.preventDefault(), handleAddSourceNickname())}
											placeholder="输入称呼后按回车"
										/>
										<button className="nickname-add-btn" onClick={handleAddSourceNickname}>
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
														onClick={() => handleRemoveSourceNickname(i)}
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
										options={characters.map((c) => ({ value: c.id, label: c.name }))}
										disabled={!!editingRelation}
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
											onKeyPress={(e) => e.key === "Enter" && (e.preventDefault(), handleAddTargetNickname())}
											placeholder="输入称呼后按回车"
										/>
										<button className="nickname-add-btn" onClick={handleAddTargetNickname}>
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
														onClick={() => handleRemoveTargetNickname(i)}
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
										handleDeleteRelation(editingRelation.id);
										setShowAddModal(false);
									}}
								>
									<Icons.trash2 size={14} />
									删除
								</button>
							)}
							<div className="modal-footer-right">
								<button className="btn" onClick={() => setShowAddModal(false)}>
									取消
								</button>
								<button
									className="btn"
									onClick={handleSaveRelation}
									disabled={
										!relationForm.sourceId ||
										!relationForm.targetId ||
										relationForm.sourceId === relationForm.targetId ||
										relationForm.sourceNickname.length === 0 ||
										relationForm.targetNickname.length === 0
									}
								>
									{editingRelation ? "保存" : "添加"}
								</button>
							</div>
						</div>
					</div>
				</div>
			)}

			{showCharacterModal && selectedCharacterId && (
				<div className="modal-overlay" onClick={() => setShowCharacterModal(false)}>
					<div className="relation-edit-modal" onClick={(e) => e.stopPropagation()}>
						<div className="modal-header">
							<h3>{getCharacterById(selectedCharacterId)?.name} 的关系</h3>
							<button className="modal-close" onClick={() => setShowCharacterModal(false)}>
								<Icons.close size={18} />
							</button>
						</div>
						<div className="modal-body">
							<div className="character-relations-list">
								{getCharacterRelations(selectedCharacterId).length === 0 ? (
									<div className="empty-relations">
										<p>暂无关系</p>
									</div>
								) : (
									getCharacterRelations(selectedCharacterId).map((rel) => {
										const isSource = rel.sourceId === selectedCharacterId;
										const otherCharId = isSource ? rel.targetId : rel.sourceId;
										const otherChar = getCharacterById(otherCharId);
										const nicknames = isSource ? rel.sourceNickname : rel.targetNickname;
										return (
											<div key={rel.id} className="relation-item">
												<div className="relation-item-info">
													<div className="relation-item-avatar">
														<div className={`avatar-circle-sm ${otherChar?.gender || "other"}`}>
															{otherChar?.name.charAt(0) || "?"}
														</div>
													</div>
													<div className="relation-item-details">
														<div className="relation-item-name">{otherChar?.name || "未知"}</div>
														<div className="relation-item-nicknames">
															{nicknames.map((nick, i) => (
																<span key={i} className="nickname-badge">{nick}</span>
															))}
														</div>
													</div>
												</div>
												<div className="relation-item-actions">
													<button
														className="relation-action-btn"
														onClick={() => {
															setShowCharacterModal(false);
															handleOpenEditModal(rel);
														}}
														title="编辑"
													>
														<Icons.edit size={14} />
													</button>
													<button
														className="relation-action-btn danger"
														onClick={() => {
															handleDeleteRelation(rel.id);
														}}
														title="删除"
													>
														<Icons.trash2 size={14} />
													</button>
												</div>
											</div>
										);
									})
								)}
							</div>
						</div>
						<div className="modal-footer">
							<button
								className="btn"
								onClick={() => {
									setShowCharacterModal(false);
									handleOpenAddModal(selectedCharacterId);
								}}
							>
								<Icons.plus size={14} />
								添加新关系
							</button>
						</div>
					</div>
				</div>
			)}

			{/* 按钮区域由父组件渲染 */}

			<ConfirmModal
				show={confirmModal.show}
				title="删除关系"
				message={confirmModal.message}
				danger
				confirmText="确定"
				cancelText="取消"
				onConfirm={confirmModal.onConfirm}
				onCancel={() => setConfirmModal(prev => ({ ...prev, show: false }))}
			/>
		</div>
	);
}