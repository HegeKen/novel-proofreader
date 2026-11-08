// ============================================================
// Web 模式下的文件对话框适配：服务端目录浏览 + 浏览器下载
// 仅在 Web 构建时通过 Vite alias 替换 @tauri-apps/plugin-dialog
// ==========================================================

import { requestServerSelection } from "../../stores/filePickerStore";

/** 下载前缀：由 fs shim 识别并触发浏览器下载 */
const DOWNLOAD_PREFIX = "__browser_download__/";

/** 与 plugin-dialog 的 open 选项对齐（Web 端只读取常用字段） */
export interface OpenDialogOptions {
	title?: string;
	defaultPath?: string;
	directory?: boolean;
	multiple?: boolean;
	filters?: { name: string; extensions: string[] }[];
}

/** 与 plugin-dialog 的 save 选项对齐 */
export interface SaveDialogOptions {
	title?: string;
	defaultPath?: string;
	filters?: { name: string; extensions: string[] }[];
}

/** 打开服务端文件/目录选择器 */
export async function open(options?: OpenDialogOptions): Promise<string | string[] | null> {
	const result = await requestServerSelection({
		title: options?.title,
		defaultPath: options?.defaultPath,
		directory: options?.directory,
		multiple: options?.multiple,
		filters: options?.filters,
	});
	return result;
}

/** Web 端保存：交给浏览器下载，返回虚拟路径 */
export async function save(options?: SaveDialogOptions): Promise<string> {
	const fileName = options?.defaultPath?.split(/[\\/]/).pop() ?? "download.txt";
	return `${DOWNLOAD_PREFIX}${fileName}`;
}

/** 目录选择（Web 端无原生语义，统一走目录选择） */
export async function openDirectory(): Promise<string | null> {
	const result = await requestServerSelection({ directory: true });
	return typeof result === "string" ? result : null;
}
