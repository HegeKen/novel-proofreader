import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useAppStore } from "../stores/appStore";
import type { CharacterInfo, CharacterRelationship, RelationType } from "../types";
import { Icons } from "./Icons";
import { Select } from "./Select";

interface RelationshipGraphProps {
	novelId: string;
	characters: CharacterInfo[];
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

export function RelationshipGraph({ novelId, characters }: RelationshipGraphProps) {
	const allRelationships = useAppStore((s) => s.characterRelationships);
	const relationships = useMemo(() => allRelationships[novelId] ?? [], [allRelationships, novelId]);
	const addRelationship = useAppStore((s) => s.addRelationship);
	const updateRelationship = useAppStore((s) => s.updateRelationship);
	const removeRelationship = useAppStore((s) => s.removeRelationship);
	const storeNodePositions = useAppStore((s) => s.nodePositions);
	const nodePositions = useMemo(() => storeNodePositions[novelId] ?? {}, [storeNodePositions, novelId]);

	const [showAddModal, setShowAddModal] = useState(false);
	const [editingRelation, setEditingRelation] = useState<CharacterRelationship | null>(null);
	const [showCharacterModal, setShowCharacterModal] = useState(false);
	const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
	const [focusedCharacterId, setFocusedCharacterId] = useState<string | null>(null);
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
	const [scale, setScale] = useState(1);
	const [isDragging, setIsDragging] = useState(false);
	const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
	const [isNodeDragging, setIsNodeDragging] = useState(false);
	const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
	const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
	const dragOffsetRef = useRef({ x: 0, y: 0 });
	const nodeDragOriginRef = useRef<{ mouseX: number; mouseY: number; nodeX: number; nodeY: number } | null>(null);
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
		if (!focusedCharacterId) return null;
		const relatedIds = new Set<string>();
		relatedIds.add(focusedCharacterId);
		relationships.forEach((rel) => {
			if (rel.sourceId === focusedCharacterId) {
				relatedIds.add(rel.targetId);
			} else if (rel.targetId === focusedCharacterId) {
				relatedIds.add(rel.sourceId);
			}
		});
		return relatedIds;
	}, [focusedCharacterId, relationships]);

	const filteredGraphNodes = useMemo(() => {
		if (!relatedCharacterIds) return graphNodes;
		return graphNodes.filter((n) => relatedCharacterIds.has(n.character.id));
	}, [graphNodes, relatedCharacterIds]);

	const filteredGraphEdges = useMemo(() => {
		if (!relatedCharacterIds) return graphEdges;
		return graphEdges.filter(
			(e) => e.relationship.sourceId === focusedCharacterId || e.relationship.targetId === focusedCharacterId
		);
	}, [graphEdges, focusedCharacterId, relatedCharacterIds]);

	const characterSelectWidth = useMemo(() => {
		const allLabels = ["全部角色", ...characters.map((c) => c.name)];
		const maxLen = Math.max(4, ...allLabels.map((l) => l.length));
		return maxLen * 14 + 52;
	}, [characters]);

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
			setFocusedCharacterId(character.id);
			setShowCharacterModal(true);
		},
		[]
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
			if (confirm("确定要删除这个关系吗？")) {
				removeRelationship(novelId, relationId);
			}
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
			const currentPositions = useAppStore.getState().nodePositions[novelId] ?? {};
			useAppStore.getState().setNodePositions(novelId, {
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
		setScale((prev) => Math.min(Math.max(prev * delta, 0.3), 3));
	}, []);

	const handleTouchStart = useCallback((e: React.TouchEvent) => {
		if (e.touches.length !== 1) return;
		setIsDragging(true);
		setDragStart({ x: e.touches[0].clientX, y: e.touches[0].clientY });
	}, []);

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
			if (e.touches.length !== 1) return;
			if (isNodeDragging && draggingNodeId && nodeDragOriginRef.current) {
				const dx = e.touches[0].clientX - nodeDragOriginRef.current.mouseX;
				const dy = e.touches[0].clientY - nodeDragOriginRef.current.mouseY;
				if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
					nodeDraggedRef.current = true;
				}
				setDragOffset({ x: dx / scale, y: dy / scale });
				dragOffsetRef.current = { x: dx / scale, y: dy / scale };
			} else if (isDragging) {
				const dx = e.touches[0].clientX - dragStart.x;
				const dy = e.touches[0].clientY - dragStart.y;
				setViewportOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
				setDragStart({ x: e.touches[0].clientX, y: e.touches[0].clientY });
			}
		},
		[isDragging, dragStart, isNodeDragging, draggingNodeId, scale]
	);

	const handleTouchEnd = useCallback(() => {
		if (isNodeDragging && draggingNodeId && nodeDragOriginRef.current) {
			const finalX = nodeDragOriginRef.current.nodeX + dragOffsetRef.current.x;
			const finalY = nodeDragOriginRef.current.nodeY + dragOffsetRef.current.y;
			const currentPositions = useAppStore.getState().nodePositions[novelId] ?? {};
			useAppStore.getState().setNodePositions(novelId, {
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
		setScale(1);
		setViewportOffset({ x: 0, y: 0 });

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

			setScale(newScale);
			setViewportOffset({ x: offsetX, y: offsetY });
		});
	}, []);

	useEffect(() => {
		const handleGlobalUp = () => {
			if (pendingNodeDragRef.current && nodeDragOriginRef.current) {
				const { novelId: nid, nodeId } = pendingNodeDragRef.current;
				const finalX = nodeDragOriginRef.current.nodeX + dragOffsetRef.current.x;
				const finalY = nodeDragOriginRef.current.nodeY + dragOffsetRef.current.y;
				const currentPositions = useAppStore.getState().nodePositions[nid] ?? {};
				useAppStore.getState().setNodePositions(nid, {
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
				<div className="graph-focus-controls">
					<Select
						value={focusedCharacterId || ""}
						onChange={(value) => setFocusedCharacterId(value || null)}
						options={[
							{ value: "", label: "全部角色" },
							...characters.map((c) => ({ value: c.id, label: c.name }))
						]}
						style={{ minWidth: characterSelectWidth }}
					/>
					{focusedCharacterId && (
						<button
							className="graph-toolbar-btn"
							onClick={() => setFocusedCharacterId(null)}
							title="取消聚焦"
						>
							<Icons.close size={14} />
						</button>
					)}
				</div>
				<div className="graph-zoom-controls">
					<button
						className="graph-zoom-btn"
						onClick={() => setScale((s) => Math.min(s * 1.2, 3))}
						title="放大"
					>
						<Icons.plus size={14} />
					</button>
					<span className="graph-zoom-level">{Math.round(scale * 100)}%</span>
					<button
						className="graph-zoom-btn"
						onClick={() => setScale((s) => Math.max(s * 0.8, 0.3))}
						title="缩小"
					>
						<Icons.minus size={14} />
					</button>
					<button
						className="graph-zoom-btn"
						onClick={handleResetLayout}
						title="适应窗口"
					>
						<Icons.refresh size={14} />
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
								friend: "朋友",
								bestie: "闺蜜",
								rival: "竞争对手",
								"master-disciple": "师徒",
								"employer-employee": "雇佣",
								colleague: "同事",
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
								className={`graph-node ${isNodeDragging && draggingNodeId === node.character.id ? 'dragging' : ''} ${node.character.id === focusedCharacterId ? 'focused' : ''}`}
								transform={`translate(${displayX}, ${displayY})`}
								onClick={() => {
									if (!nodeDraggedRef.current) {
										handleNodeClick(node.character);
									}
								}}
								onMouseDown={(e) => handleNodeMouseDown(e, node.character.id, node.x, node.y)}
								onTouchStart={(e) => handleNodeTouchStart(e, node.character.id, node.x, node.y)}
							>
								<circle r={`${node.radius}`} className={`node-circle ${node.character.gender} ${node.character.role || ''} ${node.character.id === focusedCharacterId ? 'focused' : ''}`} />
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
											["lover", "恋人"],
											["friend", "朋友"],
											["bestie", "闺蜜"],
											["rival", "竞争对手"],
											["master-disciple", "师徒"],
											["employer-employee", "雇佣"],
											["colleague", "同事"],
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
								<button className="btn btn-secondary" onClick={() => setShowAddModal(false)}>
									取消
								</button>
								<button
									className="btn btn-primary"
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
								className="btn btn-primary"
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
		</div>
	);
}