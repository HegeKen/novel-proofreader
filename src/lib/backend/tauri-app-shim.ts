// ============================================================
// Web 模式下的 Tauri 应用信息适配
// 仅在 Web 构建时通过 Vite alias 替换 @tauri-apps/api/app
// ============================================================

export async function getVersion(): Promise<string> {
	return __APP_VERSION__;
}

export async function getName(): Promise<string> {
	return "novel-proofreader";
}

export async function getTauriVersion(): Promise<string> {
	return "web";
}
