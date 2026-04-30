// ============================================================
// 滚动工具函数 - 用于阅读区和校对区的同步滚动
// ============================================================

/**
 * 滚动到指定元素并使其居中
 * @param containerRef - 滚动容器的 ref
 * @param elementRefs - 元素 refs 数组
 * @param index - 要滚动到的元素索引
 */
export function scrollToElement(
  containerRef: React.RefObject<HTMLDivElement | null>,
  elementRefs: React.RefObject<(HTMLDivElement | null)[]>,
  index: number
): void {
  const container = containerRef.current;
  const el = elementRefs.current[index];
  
  if (!container || !el) return;

  const containerRect = container.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();

  // 如果元素已在可视区域内，不需要滚动
  if (elRect.top >= containerRect.top && elRect.bottom <= containerRect.bottom) {
    return;
  }

  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
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