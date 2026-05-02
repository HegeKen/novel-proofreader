// ============================================================
// 文件导入 Hook（支持 UTF-8 / GBK / GB18030 编码自动检测）
// ============================================================
import { useCallback } from "react";
import { useAppStore } from "../stores/appStore";
import { splitChapters } from "../utils/chapterSplit";
import { decodeTextBuffer } from "../utils/decodeText";
import type { Novel } from "../types";

/**
 * 在浏览器/WebView 环境中使用 input[type=file] 导入 TXT 文件
 * 自动检测 UTF-8 / GBK / GB18030 编码
 */
export function useFileImport() {
	const addNovel = useAppStore((s) => s.addNovel);
	const clearFile = useAppStore((s) => s.clearFile);

	const importFile = useCallback(() => {
		return new Promise<void>((resolve) => {
			const input = document.createElement("input");
			input.type = "file";
			input.accept = ".txt,.text";
			input.onchange = async (e) => {
				const file = (e.target as HTMLInputElement).files?.[0];
				if (!file) {
					resolve();
					return;
				}
				const buffer = await file.arrayBuffer();
				const text = decodeTextBuffer(buffer);
				const chapters = splitChapters(text);

				// 创建 Novel 对象并添加到 store
				const novel: Novel = {
					id: Date.now().toString(), // 使用时间戳作为临时ID
					name: file.name,
					author: "", // 如果能从文件名或内容中提取作者更好
					fullText: text,
					importedAt: Date.now(),
					chapters: chapters,
				};

				addNovel(novel);
				resolve();
			};
			input.click();
		});
	}, [addNovel]);

	return { importFile, clearFile };
}
