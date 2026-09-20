// ============================================================
// 自动增高的多行输入框
// 直接替换 <textarea>：内容多高就多高（设上限），完整展示已输入文字。
// 不适合「铺满固定容器」或「聊天输入条」这类需要固定高度的场景。
// ============================================================
import { useCallback, useLayoutEffect, type TextareaHTMLAttributes } from "react";
import { useAutoResizeTextarea } from "../hooks/useAutoResizeTextarea";

interface AutoResizeTextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "ref"> {
	value: string;
	/** 最大高度（px），超过后内部滚动。默认 480，且不会超过视口高度的 60% */
	maxHeight?: number;
	/** 最小高度（px）。不传时以「一行」为下限，等同单行输入框 */
	minHeight?: number;
	/** 元素挂载/卸载时回调，供调用方保存 ref（自动聚焦、读取选区等） */
	onReady?: (el: HTMLTextAreaElement | null) => void;
}

export function AutoResizeTextarea({
	value,
	maxHeight = 480,
	minHeight,
	onReady,
	style,
	...rest
}: AutoResizeTextareaProps) {
	const { setRef, resize } = useAutoResizeTextarea(value, { maxHeight, minHeight });

	const handleRef = useCallback(
		(el: HTMLTextAreaElement | null) => {
			setRef(el);
			onReady?.(el);
		},
		[setRef, onReady],
	);

	// 挂载后立刻测一次，避免首屏出现一帧的固定高度
	useLayoutEffect(() => {
		resize();
	}, [resize]);

	return (
		<textarea
			{...rest}
			ref={handleRef}
			value={value}
			style={{ resize: "none", ...style }}
		/>
	);
}
