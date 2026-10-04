// ============================================================
// 复制到剪贴板 Hook — 统一管理"已复制"状态
// ============================================================
import { useState, useCallback, useRef, useEffect } from "react";

/**
 * 复制文本到剪贴板，自动管理"已复制"状态
 * @returns copiedId — 当前已复制条目的 id；copy — 执行复制，返回是否成功
 */
export function useCopyToClipboard() {
	const [copiedId, setCopiedId] = useState<string | null>(null);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// 卸载时清理定时器
	useEffect(() => {
		return () => {
			if (timerRef.current) clearTimeout(timerRef.current);
		};
	}, []);

	const copy = useCallback(async (id: string, text: string): Promise<boolean> => {
		try {
			await navigator.clipboard.writeText(text);
			setCopiedId(id);
			if (timerRef.current) clearTimeout(timerRef.current);
			timerRef.current = setTimeout(() => setCopiedId(null), 2000);
			return true;
		} catch (err) {
			console.error("复制失败:", err);
			return false;
		}
	}, []);

	return { copiedId, copy };
}
