// ============================================================
// 文件导入 Hook（支持 UTF-8 / GBK / GB18030 编码自动检测）
// ============================================================
import { useCallback } from "react";
import { useNovelStore } from "../stores/novelStore";
import { splitChapters } from "../utils/chapterSplit";
import { decodeTextBuffer } from "../utils/decodeText";
import { saveNovelToStorage, ensureTxtFilename } from "../utils/fileExport";
import { logger } from "../utils/logger";
import type { Novel } from "../types";

/**
 * 在浏览器/WebView 环境中使用 input[type=file] 导入 TXT 文件
 * 自动检测 UTF-8 / GBK / GB18030 编码
 */
export function useFileImport() {
	const addNovel = useNovelStore((s) => s.addNovel);
	const clearFile = useNovelStore((s) => s.clearFile);

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
				logger.file(`开始导入文件: ${file.name}, 大小: ${(file.size / 1024).toFixed(1)} KB`);
				const buffer = await file.arrayBuffer();
				const text = decodeTextBuffer(buffer);
				logger.file(`文件解码完成, 字符数: ${text.length}`);
				const chapters = splitChapters(text);
				logger.file(`章节分割完成, 共 ${chapters.length} 章`);

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
				await saveNovelToStorage(ensureTxtFilename(novel.name), novel.fullText);
				logger.file(`文件导入完成: ${novel.name}`);
				resolve();
			};
			input.click();
		});
	}, [addNovel]);

	return { importFile, clearFile };
}
