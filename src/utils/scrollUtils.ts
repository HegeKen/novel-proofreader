// ============================================================
// 滚动工具函数 - 用于阅读区和校对区的同步滚动
// ============================================================

/**
 * 滚动到指定元素并使其在容器中居中
 * @param containerRef - 滚动容器的 ref
 * @param elementRefs - 元素 refs 数组
 * @param index - 要滚动到的元素索引
 */
export function scrollToElement(
	containerRef: React.RefObject<HTMLDivElement | null>,
	elementRefs: React.RefObject<(HTMLDivElement | null)[]>,
	index: number,
): void {
	const container = containerRef.current;
	const el = elementRefs.current[index];

	if (!container || !el) return;

	const containerRect = container.getBoundingClientRect();
	const elRect = el.getBoundingClientRect();

	// 计算元素相对于容器顶部的偏移量
	// 使用 getBoundingClientRect 来获取精确的相对位置
	const elementRelativeTop = elRect.top - containerRect.top;
	
	// 计算目标滚动位置，使元素在容器中垂直居中
	// scrollTop = 当前滚动位置 + 元素相对位置 - 容器高度的一半 + 元素高度的一半
	const targetScrollTop = container.scrollTop + elementRelativeTop - container.offsetHeight / 2 + el.offsetHeight / 2;
	
	// 限制滚动范围，避免滚动到无效位置
	const minScroll = 0;
	const maxScroll = container.scrollHeight - container.offsetHeight;
	const clampedScrollTop = Math.max(minScroll, Math.min(targetScrollTop, maxScroll));
	
	// 使用平滑滚动
	container.scrollTo({
		top: clampedScrollTop,
		behavior: "smooth"
	});
}

/**
 * 程序化滚动锁 - 防止滚动事件循环
 * 每个面板应该有自己的锁实例
 */
export class ScrollLock {
	private locked = false;
	private lockTimeout: ReturnType<typeof setTimeout> | null = null;

	acquire(duration: number = 800): boolean {
		if (this.locked) return false;
		this.locked = true;
		if (this.lockTimeout) clearTimeout(this.lockTimeout);
		this.lockTimeout = setTimeout(() => {
			this.locked = false;
		}, duration);
		return true;
	}

	isLocked(): boolean {
		return this.locked;
	}
}
