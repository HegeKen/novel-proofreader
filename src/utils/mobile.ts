// ============================================================
// 移动端判断工具函数
// ============================================================

/**
 * 判断当前是否为移动端设备
 * @returns true 表示移动端，false 表示桌面端
 */
export function isMobileDevice(): boolean {
	if (typeof window === "undefined") return false;
	return window.innerWidth <= 768;
}

/**
 * 获取当前视口宽度是否小于等于指定阈值
 * @param threshold 阈值（默认 768）
 * @returns 是否小于等于阈值
 */
export function isViewportLessThan(threshold: number = 768): boolean {
	if (typeof window === "undefined") return false;
	return window.innerWidth <= threshold;
}

/**
 * 获取设备类型
 * @returns "mobile" | "tablet" | "desktop"
 */
export function getDeviceType(): "mobile" | "tablet" | "desktop" {
	if (typeof window === "undefined") return "desktop";
	const width = window.innerWidth;
	if (width <= 768) return "mobile";
	if (width <= 1024) return "tablet";
	return "desktop";
}