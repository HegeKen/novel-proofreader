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

/**
 * 判断当前是否为 Android 平台（仅 Tauri Android 包内的 WebView 会命中）
 * @returns true 表示 Android
 */
export function isAndroidPlatform(): boolean {
	if (typeof navigator === "undefined") return false;
	return /Android/i.test(navigator.userAgent);
}