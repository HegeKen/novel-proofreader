// ============================================================
// 文件导出与小说存储 — 导出对话框、小说 txt 读写、全量备份
// ============================================================
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile, exists, readTextFile, mkdir, readDir, remove, BaseDirectory } from '@tauri-apps/plugin-fs';
import { logger } from './logger';

function isTauri(): boolean {
	return typeof window !== 'undefined' && '__TAURI__' in window;
}

function getBaseDir(): BaseDirectory {
	return BaseDirectory.Document;
}

function getNovelsSubDir(): string {
	return 'novels';
}

function getNovelsStoragePath(fileName: string): string {
	return `${getNovelsSubDir()}/${sanitizeNovelFilename(fileName)}`;
}

/**
 * 消毒小说文件名，防止路径穿越（`../` 写出 baseDir 之外）与非法字符。
 * 同时额外处理路径分隔符。
 */
export function sanitizeNovelFilename(fileName: string): string {
	// 替换路径分隔符与 Windows 非法字符
	let safe = fileName.replace(/[\\/:*?"<>|]/g, "_");
	// 剔除不可见控制字符（\x00-\x1f 与 \x7f），按码点过滤避免正则匹配控制字符
	safe = Array.from(safe)
		.filter((ch) => {
			const code = ch.charCodeAt(0);
			return code >= 0x20 && code !== 0x7f;
		})
		.join("");
	// 兜底：若仍含 ".." 片段（如 "a..b" 无分隔符场景），将连续点替换为单点，
	// 避免 Tauri 端对路径的进一步解析产生歧义
	safe = safe.replace(/\.\./g, ".");
	safe = safe.trim();
	if (!safe || safe === "." || safe === "..") safe = "novel";
	return safe;
}

export function ensureTxtFilename(fileName: string): string {
	return fileName.toLowerCase().endsWith('.txt') ? fileName : `${fileName}.txt`;
}

async function migrateFromDocumentDir(subDir: string): Promise<void> {
	try {
		const oldBaseDir = BaseDirectory.Document;
		const newBaseDir = getBaseDir();
		if (oldBaseDir === newBaseDir) return;
		const oldDirExists = await exists(subDir, { baseDir: oldBaseDir });
		if (!oldDirExists) return;
		const files = await readDir(subDir, { baseDir: oldBaseDir });
		for (const file of files) {
			if (!file.name || file.isDirectory) continue;
			const filePath = `${subDir}/${file.name}`;
			try {
				const content = await readTextFile(filePath, { baseDir: oldBaseDir });
				await writeTextFile(filePath, content, { baseDir: newBaseDir });
				logger.file(`[migrate] Migrated ${filePath} from Document to LocalData`);
			} catch (e) {
				logger.errorGeneric(`[migrate] Failed to migrate ${filePath}:`, e);
			}
		}
	} catch (e) {
		logger.errorGeneric('[migrate] Migration from Document dir failed:', e);
	}
}

async function ensureNovelsDirectory(): Promise<boolean> {
	if (!isTauri()) {
		logger.warn('fileExport - Not in Tauri environment, skipping ensureNovelsDirectory');
		return false;
	}
	try {
		const baseDir = getBaseDir();
		const novelsPath = getNovelsSubDir();
		const dirExists = await exists(novelsPath, { baseDir });
		if (!dirExists) {
			await mkdir(novelsPath, { baseDir, recursive: true });
		}
		await migrateFromDocumentDir(novelsPath);
		return true;
	} catch (e) {
		logger.errorGeneric('fileExport - Failed to create novels directory:', e);
		return false;
	}
}

export async function exportToFile(content: string, fileName: string): Promise<"success" | "fallback" | false> {
	try {
		const filePath = await save({
			defaultPath: fileName,
			filters: [{ name: 'Text Files', extensions: ['txt'] }],
		});
		if (filePath) {
			logger.file('Export path:', filePath);
			logger.file('Content length:', content.length);
			logger.file('Content preview:', content.slice(0, 100));

			try {
				await writeTextFile(filePath, content);
				logger.file('writeTextFile success');
			} catch (writeErr) {
				logger.errorGeneric('[fileExport]', 'writeTextFile failed:', writeErr);
				const { writeFile } = await import('@tauri-apps/plugin-fs');
				await writeFile(filePath, new TextEncoder().encode(content));
				logger.file('writeFile fallback success');
			}

			logger.file('Exported file to:', filePath);
			return "success";
		}
		return false;
	} catch (e) {
		logger.errorGeneric('[fileExport]', 'Failed to export file:', e);
		const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = fileName;
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		URL.revokeObjectURL(url);
		return "fallback";
	}
}

/**
 * 导出二进制文件（如 EPUB）：Tauri 保存对话框优先，失败回退浏览器下载
 */
export async function exportBinaryToFile(
	data: Uint8Array,
	fileName: string,
	filterName: string,
	extension: string,
): Promise<"success" | "fallback" | false> {
	try {
		const filePath = await save({
			defaultPath: fileName,
			filters: [{ name: filterName, extensions: [extension] }],
		});
		if (filePath) {
			const { writeFile } = await import('@tauri-apps/plugin-fs');
			await writeFile(filePath, data);
			logger.file('Exported binary file to:', filePath);
			return "success";
		}
		return false;
	} catch (e) {
		logger.errorGeneric('[fileExport]', 'Failed to export binary file:', e);
		// 回退：浏览器直接下载
		const blob = new Blob([data as unknown as BlobPart], { type: 'application/octet-stream' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = fileName;
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		URL.revokeObjectURL(url);
		return "fallback";
	}
}

// ==================== 小说存储相关函数 ====================

/**
 * 串行写队列：保证对同一文件的多次写入按调用顺序落盘，
 * 避免异步写盘完成顺序与发起顺序不一致导致旧内容覆盖新内容。
 */
let fsWriteChain: Promise<unknown> = Promise.resolve();

function enqueueFsWrite<T>(task: () => Promise<T>): Promise<T> {
	const run = fsWriteChain.then(task);
	// 链上吞掉错误，避免单个失败中断后续写入
	fsWriteChain = run.catch(() => undefined);
	return run;
}

export async function loadNovelContent(fileName: string): Promise<string | null> {
	try {
		const fullPath = getNovelsStoragePath(fileName);
		const baseDir = getBaseDir();
		const content = await readTextFile(fullPath, { baseDir });
		logger.file('Loaded novel content from storage:', fileName);
		return content;
	} catch (e) {
		logger.errorGeneric('[fileExport]', 'Failed to load novel:', e);
		return null;
	}
}

export function saveNovelToStorage(fileName: string, content: string): Promise<boolean> {
	// 串行化写盘，防止并发保存乱序
	return enqueueFsWrite(() => doSaveNovelToStorage(fileName, content));
}

async function doSaveNovelToStorage(fileName: string, content: string): Promise<boolean> {
	try {
		await ensureNovelsDirectory();
		const fullPath = getNovelsStoragePath(fileName);
		const baseDir = getBaseDir();
		logger.proofread(`Saving to: ${fullPath} baseDir: ${baseDir}`);
		logger.proofread(`Content length: ${content.length}`);
		await writeTextFile(fullPath, content, { baseDir });
		logger.file('Save successful');
		return true;
	} catch (e) {
		logger.errorGeneric('[fileExport]', 'Failed to save novel to storage:', e);
		return false;
	}
}

export async function deleteNovelFromStorage(fileName: string): Promise<boolean> {
	try {
		const fullPath = getNovelsStoragePath(fileName);
		const baseDir = getBaseDir();
		const fileExists = await exists(fullPath, { baseDir });
		if (fileExists) {
			await remove(fullPath, { baseDir });
		}
		return true;
	} catch (e) {
		logger.errorGeneric('fileExport - Failed to delete novel from storage:', e);
		return false;
	}
}

export async function loadNovelsFromStorage(): Promise<string[]> {
	try {
		await ensureNovelsDirectory();
		const novelsPath = getNovelsSubDir();
		const baseDir = getBaseDir();
		const files = await readDir(novelsPath, { baseDir });
		const txtFiles = files.filter(f => f.name.toLowerCase().endsWith('.txt')).map(f => f.name);
		logger.file('Loaded novels from storage:', txtFiles);
		return txtFiles;
	} catch (e) {
		logger.errorGeneric('[fileExport]', 'Failed to load novels:', e);
		return [];
	}
}

export async function exportAllData(data: {
	novels: import('../types').Novel[];
	aiConfig: import('../types').AIConfig;
	apiUsage: import('../types').APIUsage;
	novelCategories: Record<string, import('../types').NovelCategory>;
	readingProgress: Record<string, {
		currentChapterIndex: number;
		currentParagraphIndex: number;
		readingStartTime: number;
		totalReadingTime: number;
	}>;
	dictionary: Record<string, import('../types').DictionaryWord[]>;
	exportTime: string;
	version: string;
}): Promise<boolean> {
	try {
		const content = JSON.stringify(data, null, 2);
		// 文件名带本地时间戳，避免覆盖历史备份
		const now = new Date();
		const pad = (n: number) => String(n).padStart(2, '0');
		const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
		const filePath = await save({
			defaultPath: `novel-proofreader-backup-${timestamp}.json`,
			filters: [{ name: 'JSON Files', extensions: ['json'] }],
		});
		if (filePath) {
			await writeTextFile(filePath, content);
			logger.file('Exported all data to:', filePath);
			return true;
		}
		return false;
	} catch (e) {
		logger.errorGeneric('[fileExport]', 'Failed to export all data:', e);
		return false;
	}
}
