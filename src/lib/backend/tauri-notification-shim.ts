// ============================================================
// Web 模式下的通知适配：使用浏览器 Notification API
// 仅在 Web 构建时通过 Vite alias 替换 @tauri-apps/plugin-notification
// ==========================================================

export async function isPermissionGranted(): Promise<boolean> {
	if (typeof Notification === "undefined") return false;
	return Notification.permission === "granted";
}

export async function requestPermission(): Promise<"granted" | "denied" | "default"> {
	if (typeof Notification === "undefined") return "denied";
	return Notification.requestPermission();
}

export function sendNotification(options: { title: string; body?: string }): void {
	if (typeof Notification === "undefined") return;
	if (Notification.permission !== "granted") return;
	new Notification(options.title, { body: options.body });
}
