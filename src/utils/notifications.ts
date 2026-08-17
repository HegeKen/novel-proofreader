// ============================================================
// 系统通知工具 — 长任务阶段进度提示
// 桌面端/移动端优先使用 Tauri 通知插件，Web 端回退浏览器通知
// ============================================================

let permissionPromise: Promise<boolean> | null = null;

/** 判断是否 Tauri 环境 */
function isTauriEnv(): boolean {
	return typeof window !== "undefined" && ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
}

/** 确保通知权限（进程内只请求一次，缓存结果） */
async function ensurePermission(): Promise<boolean> {
	if (permissionPromise) return permissionPromise;
	permissionPromise = (async () => {
		try {
			if (isTauriEnv()) {
				const { isPermissionGranted, requestPermission } = await import("@tauri-apps/plugin-notification");
				let granted = await isPermissionGranted();
				if (!granted) {
					granted = (await requestPermission()) === "granted";
				}
				return granted;
			}
			if (typeof Notification !== "undefined") {
				if (Notification.permission === "granted") return true;
				if (Notification.permission === "default") {
					return (await Notification.requestPermission()) === "granted";
				}
			}
		} catch {
			// 权限检查失败视为不可用
		}
		return false;
	})();
	return permissionPromise;
}

/** 发送一条系统通知（失败静默，不影响业务逻辑） */
export async function sendTaskNotification(title: string, body?: string): Promise<void> {
	try {
		if (!(await ensurePermission())) return;
		if (isTauriEnv()) {
			const { sendNotification } = await import("@tauri-apps/plugin-notification");
			sendNotification({ title, body });
			return;
		}
		if (typeof Notification !== "undefined") {
			new Notification(title, { body });
		}
	} catch {
		// 通知失败不影响业务
	}
}
