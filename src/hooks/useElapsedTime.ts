// ============================================================
// 任务已耗时计时 Hook — 用于 AI 长任务进行中动态显示耗时
// ============================================================
import { useEffect, useState } from "react";

/**
 * 计时器：active 为 true 时每秒递增已耗时（秒），active 为 false 时归零。
 * @param active 任务是否进行中
 * @returns 已耗时秒数
 */
export function useElapsedTime(active: boolean): number {
	const [elapsed, setElapsed] = useState(0);

	useEffect(() => {
		if (!active) {
			// 微任务延迟置零，避免 effect 中同步 setState 触发级联渲染
			queueMicrotask(() => setElapsed(0));
			return;
		}
		const start = Date.now();
		// 立即显示 0 秒，之后每秒更新
		const interval = window.setInterval(() => {
			setElapsed(Math.floor((Date.now() - start) / 1000));
		}, 500);
		return () => {
			window.clearInterval(interval);
			setElapsed(0);
		};
	}, [active]);

	return elapsed;
}

/** 将秒数格式化为 分:秒（如 3:45），不足 1 秒显示 0:00 */
export function formatElapsedTime(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	return `${m}:${String(s).padStart(2, "0")}`;
}
