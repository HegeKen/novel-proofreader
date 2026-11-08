// ============================================================
// 服务端文件选择器状态：命令式 request(opts) → 弹窗选择 → Promise 返回
// 桌面端使用 Tauri 原生对话框，Web 端使用本模块
// ============================================================

import { create } from "zustand";

/** 文件过滤器 */
export interface FileFilter {
	name: string;
	extensions: string[];
}

/** 选择器选项 */
export interface FilePickerOptions {
	title?: string;
	/** 只允许选择目录 */
	directory?: boolean;
	/** 允许选择多个文件 */
	multiple?: boolean;
	filters?: FileFilter[];
	defaultPath?: string;
}

interface FilePickerState {
	options: FilePickerOptions | null;
}

/** 当前挂起的选择请求（Promise resolver 不放进 store，避免被序列化） */
let pendingResolver: ((value: string | string[] | null) => void) | null = null;

export const useFilePickerStore = create<FilePickerState>(() => ({
	options: null,
}));

/** 发起一次服务端文件选择；用户取消时返回 null */
export function requestServerSelection(
	options: FilePickerOptions,
): Promise<string | string[] | null> {
	// 若已有未完成请求，先取消旧请求
	pendingResolver?.(null);
	pendingResolver = null;

	return new Promise((resolve) => {
		pendingResolver = resolve;
		useFilePickerStore.setState({ options });
	});
}

/** 由弹窗调用：完成选择并关闭 */
export function completeServerSelection(value: string | string[] | null): void {
	const resolve = pendingResolver;
	pendingResolver = null;
	useFilePickerStore.setState({ options: null });
	resolve?.(value);
}
