// ============================================================
// macOS 系统权限引导
// ============================================================
import { invoke } from "@tauri-apps/api/core";

/** 是否 macOS 桌面端 */
export function isMacOSPlatform(): boolean {
	if (typeof navigator === "undefined") return false;
	return /Mac/i.test(navigator.userAgent) && !/iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/** 打开「隐私与安全性 → 完全磁盘访问权限」设置面板 */
export async function openFullDiskAccessSettings(): Promise<void> {
	await invoke("macos_open_full_disk_access_settings");
}
