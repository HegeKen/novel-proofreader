// ============================================================
// 版本信息 — Web 端版本常量与当前版本获取
// ============================================================

/** Web 端版本号（来自 package.json，由 Vite 编译时注入） */
export const WEB_VERSION: string = __APP_VERSION__;

export async function getCurrentVersion(): Promise<string> {
	try {
		const { getVersion } = await import("@tauri-apps/api/app");
		return await getVersion();
	} catch {
		return WEB_VERSION;
	}
}
