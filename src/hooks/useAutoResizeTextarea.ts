import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

export interface AutoResizeTextareaOptions {
	/**
	 * 最小高度（px）。不传时以「一行」为下限（等同单行输入框的高度）。
	 * 需要留出更大的空白输入区时显式传入。
	 */
	minHeight?: number;
	/** 最大高度（px）。超过后不再增高，改为内部滚动。默认 480 */
	maxHeight?: number;
}

/** 每个元素第一次测到的原始内边距，用于「测量前还原」，避免 padding 反复震荡 */
const basePaddings = new WeakMap<HTMLElement, { top: number; bottom: number }>();

/**
 * 让 textarea 随内容自动增高，完整展示已输入的文字，并在内容比容器矮时让文字垂直居中。
 *
 * 踩过的坑（都体现在下面的实现里）：
 * 1. **测量时必须把 `height` 和 `min-height` 归零**：否则 `rows` 属性、CSS `min-height`
 *    和当前高度都会把 `scrollHeight` 顶大，单行文字被撑成两三行的高度且顶对齐；
 * 2. **测量/设置期间必须临时关掉 transition**：这些输入框带 `transition: all`，
 *    写入高度后立刻读 `offsetHeight` 拿到的是**过渡动画的当前值**（起始值），
 *    于是「容器比内容高多少」会被算错，垂直居中永远不生效；
 * 3. **测量前还原原始 padding**：否则上一轮为居中加上的 padding 会被算进内容高度；
 * 4. 空内容时 `placeholder` 也参与 `scrollHeight`，测量期间临时移除。
 *
 * 另外：`value` 变化（含程序化写入）会重测；只监听宽度变化，避免「改高度 → 触发 observer
 * → 再改高度」的死循环；上限取 `maxHeight` 与视口高度 60% 的较小值。
 */
export function useAutoResizeTextarea<T extends HTMLTextAreaElement = HTMLTextAreaElement>(
	value: string,
	{ minHeight, maxHeight = 480 }: AutoResizeTextareaOptions = {},
) {
	const elRef = useRef<T | null>(null);

	const resize = useCallback(() => {
		const el = elRef.current;
		if (!el) return;

		const computed = getComputedStyle(el);
		const lineHeight = parseFloat(computed.lineHeight) || parseFloat(computed.fontSize) * 1.5 || 20;

		let base = basePaddings.get(el);
		if (!base) {
			base = { top: parseFloat(computed.paddingTop) || 0, bottom: parseFloat(computed.paddingBottom) || 0 };
			basePaddings.set(el, base);
		}

		// 关掉过渡：这些输入框带 `transition: all`，否则写高度后读到的仍是过渡起始值
		const prevTransition = el.style.transition;
		const prevHeight = el.style.height;
		const placeholder = el.placeholder;
		const hidePlaceholder = placeholder.length > 0 && el.value.length === 0;

		el.style.transition = "none";

		try {
			// ── 测量真实内容高度（height / min-height 归零、padding 还原） ──
			el.style.paddingTop = `${base.top}px`;
			el.style.paddingBottom = `${base.bottom}px`;
			el.style.minHeight = "0";
			el.style.height = "0px";
			if (hidePlaceholder) el.placeholder = "";

			const scroll = el.scrollHeight; // = 文本行 + 上下内边距（不含边框）
			const border = Math.max(el.offsetHeight - el.clientHeight, 0);

			if (hidePlaceholder) el.placeholder = placeholder;

			const textHeight = scroll - base.top - base.bottom;
			if (textHeight <= 0) return;

			// ── 计算目标高度 ───────────────────────────────────────────
			const natural = textHeight + base.top + base.bottom + border;
			const oneLine = lineHeight + base.top + base.bottom + border;
			const viewportCap = typeof window === "undefined" ? maxHeight : window.innerHeight * 0.6;
			const cap = Math.max(minHeight ?? oneLine, Math.min(maxHeight, viewportCap));
			const next = Math.min(Math.max(natural, minHeight ?? oneLine), cap);

			el.style.height = `${next}px`;
			el.style.overflowY = natural > cap ? "auto" : "hidden";

			// ── 容器比内容高时，把多余空间上下均分 → 文字垂直居中 ──────
			// （例如 `.config-textarea { min-height: 100px }` 撑高了只有一行的输入框）
			const rendered = el.offsetHeight;
			const space = rendered - border - textHeight;
			if (space > base.top + base.bottom + 0.5) {
				const half = space / 2;
				el.style.paddingTop = `${half}px`;
				el.style.paddingBottom = `${half}px`;
			}
		} finally {
			// 先把上面写的高度/内边距落地，再恢复过渡，避免被动画拉回旧值
			void el.offsetHeight;
			el.style.transition = prevTransition;
			if (el.style.height === "0px") el.style.height = prevHeight;
		}
	}, [minHeight, maxHeight]);

	useLayoutEffect(() => {
		resize();
	}, [resize, value]);

	useEffect(() => {
		const el = elRef.current;
		if (!el) return;

		// 只在宽度变化时重新测量（高度变化不触发，避免死循环）
		let lastWidth = el.clientWidth;
		let observer: ResizeObserver | undefined;
		if (typeof ResizeObserver !== "undefined") {
			observer = new ResizeObserver(() => {
				const width = el.clientWidth;
				if (Math.abs(width - lastWidth) < 1) return;
				lastWidth = width;
				resize();
			});
			observer.observe(el);
		}

		window.addEventListener("resize", resize);

		// 字体加载完成后行高会变，需要再测一次
		if (typeof document !== "undefined" && document.fonts) {
			void document.fonts.ready.then(resize).catch(() => undefined);
		}

		return () => {
			observer?.disconnect();
			window.removeEventListener("resize", resize);
		};
	}, [resize]);

	const setRef = useCallback((el: T | null) => {
		elRef.current = el;
	}, []);

	return { setRef, resize };
}
