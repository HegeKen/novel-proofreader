// ============================================================
// 角色排序组件 - 使用 Pointer Events 实现跨平台拖拽
// ============================================================
import { useState, useCallback, useMemo, useRef } from "react";
import type { CharacterInfo } from "../types";
import { Icons } from "./Icons";
import { getRoleName } from "../utils/characterRoles";

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
	}, []);

	// 注册 item ref
	const setItemRef = useCallback((charId: string, el: HTMLDivElement | null) => {
		if (el) {
			itemRefs.current.set(charId, el);
		} else {
			itemRefs.current.delete(charId);
		}
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
