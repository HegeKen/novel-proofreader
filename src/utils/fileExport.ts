import type { Novel } from '../types';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile, writeTextFile, exists, readTextFile, mkdir, readDir, remove } from '@tauri-apps/plugin-fs';
import { BaseDirectory } from '@tauri-apps/plugin-fs';

function getBaseDir(): BaseDirectory {
  return BaseDirectory.Document;
}

function getNovelsSubDir(): string {
  return 'novels';
}

function getStoragePath(fileName: string): string {
  return `${getNovelsSubDir()}/${fileName}`;
}

export function ensureTxtFilename(fileName: string): string {
  return fileName.toLowerCase().endsWith('.txt') ? fileName : `${fileName}.txt`;
}

export async function ensureNovelsDirectory(): Promise<boolean> {
  try {
    const baseDir = getBaseDir();
    const novelsPath = getNovelsSubDir();
    const dirExists = await exists(novelsPath, { baseDir });
    if (!dirExists) {
      await mkdir(novelsPath, { baseDir, recursive: true });
    }
    return true;
  } catch (e) {
    console.error('Failed to create novels directory:', e);
    return false;
  }
}

export async function importNovelFromStorage(fileName: string): Promise<string | null> {
  try {
    await ensureNovelsDirectory();
    const fullPath = getStoragePath(fileName);
    const baseDir = getBaseDir();
    const fileExists = await exists(fullPath, { baseDir });
    if (fileExists) {
      const content = await readTextFile(fullPath, { baseDir });
      return content;
    }
    return null;
  } catch (e) {
    console.error('Failed to read novel from storage:', e);
    return null;
  }
}

export async function saveNovelToStorage(fileName: string, content: string): Promise<boolean> {
  try {
    await ensureNovelsDirectory();
    const fullPath = getStoragePath(fileName);
    const baseDir = getBaseDir();
    console.log('[fileExport] Saving to:', fullPath, 'baseDir:', baseDir);
    console.log('[fileExport] Content length:', content.length);
    await writeTextFile(fullPath, content, { baseDir });
    console.log('[fileExport] Save successful');
    return true;
  } catch (e) {
    console.error('[fileExport] Failed to save novel to storage:', e);
    return false;
  }
}

export async function deleteNovelFromStorage(fileName: string): Promise<boolean> {
  try {
    const fullPath = getStoragePath(fileName);
    const baseDir = getBaseDir();
    const fileExists = await exists(fullPath, { baseDir });
    if (fileExists) {
      await remove(fullPath, { baseDir });
    }
    return true;
  } catch (e) {
    console.error('Failed to delete novel from storage:', e);
    return false;
  }
}

export async function listNovelsInStorage(): Promise<string[]> {
  try {
    await ensureNovelsDirectory();
    const novelsPath = getNovelsSubDir();
    const baseDir = getBaseDir();
    const entries = await readDir(novelsPath, { baseDir });
    return entries
      .filter((entry) => entry.name?.endsWith('.txt'))
      .map((entry) => entry.name as string);
  } catch (e) {
    console.error('Failed to list novels in storage:', e);
    return [];
  }
}

export async function loadNovelsFromStorage(): Promise<Novel[]> {
  try {
    await ensureNovelsDirectory();
    const novelsPath = getNovelsSubDir();
    const baseDir = getBaseDir();
    const entries = await readDir(novelsPath, { baseDir });

    const novels: Novel[] = [];
    for (const entry of entries) {
      if (!entry.name || !entry.name.toLowerCase().endsWith('.txt')) continue;
      const filePath = `${novelsPath}/${entry.name}`;
      const content = await readTextFile(filePath, { baseDir });
      novels.push({
        id: `novel-${Date.now()}-${entry.name}`,
        name: entry.name.replace(/\.txt$/i, ''),
        fullText: content,
        importedAt: Date.now(),
        lastCacheSaveTime: undefined,
        chapters: [],
      });
    }
    return novels;
  } catch (e) {
    console.error('Failed to load novels from storage:', e);
    return [];
  }
}

// 检测是否在 Tauri 环境中
function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}

function generateUniqueName(baseName: string, extension: string): string {
  const timestamp = new Date();
  const timeStr = `${timestamp.getFullYear()}${String(timestamp.getMonth() + 1).padStart(2, '0')}${String(timestamp.getDate()).padStart(2, '0')}_${String(timestamp.getHours()).padStart(2, '0')}${String(timestamp.getMinutes()).padStart(2, '0')}${String(timestamp.getSeconds()).padStart(2, '0')}`;
  return `${baseName}_${timeStr}${extension}`;
}

// 浏览器环境的文件下载（fallback）
function browserDownload(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportToFile(content: string, suggestedName: string): Promise<'success' | 'fallback' | 'cancelled'> {
  // 如果不在 Tauri 环境中，直接使用浏览器下载
  if (!isTauri()) {
    console.log('Not in Tauri environment, using browser download');
    browserDownload(content, suggestedName);
    return 'fallback';
  }

  try {
    let finalPath: string | null = null;
    let currentName = suggestedName;

    while (true) {
      const filePath = await save({
        defaultPath: currentName,
        filters: [{ name: '文本文件', extensions: ['txt'] }],
      });

      if (!filePath) {
        return 'cancelled';
      }

      const fileExists = await exists(filePath);

      if (!fileExists) {
        finalPath = filePath;
        break;
      }

      const userChoice = confirm(`文件 "${currentName}" 已存在。\n\n点击"确定"覆盖文件。\n点击"取消"自动生成新文件名保存。`);

      if (userChoice) {
        finalPath = filePath;
        break;
      }

      const lastDotIndex = currentName.lastIndexOf('.');
      const baseName = lastDotIndex > 0 ? currentName.substring(0, lastDotIndex) : currentName;
      const ext = lastDotIndex > 0 ? currentName.substring(lastDotIndex) : '.txt';
      currentName = generateUniqueName(baseName, ext);
    }

    if (finalPath) {
      try {
        console.log(`Writing file: ${finalPath}, content length: ${content.length}`);
        await writeTextFile(finalPath, content);
        console.log('File written successfully');
        return 'success';
      } catch (fsError) {
        console.warn('Direct writeTextFile failed, trying writeFile with encoder:', fsError);
        const encoder = new TextEncoder();
        const data = encoder.encode(content);
        await writeFile(finalPath, data);
        return 'success';
      }
    }

    return 'cancelled';
  } catch (e) {
    console.error('Tauri export error:', e);
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedName;
    a.click();
    URL.revokeObjectURL(url);
    return 'fallback';
  }
}

export async function saveToAppData(content: string, fileName: string): Promise<boolean> {
  try {
    await writeTextFile(fileName, content, { baseDir: BaseDirectory.AppData });
    return true;
  } catch (e) {
    console.error('Save to AppData failed:', e);
    return false;
  }
}

export async function readFromAppData(fileName: string): Promise<string | null> {
  try {
    const content = await readTextFile(fileName, { baseDir: BaseDirectory.AppData });
    return content;
  } catch (e) {
    console.error('Read from AppData failed:', e);
    return null;
  }
}

// 导出所有数据为 JSON 文件
export interface ExportData {
  novels: Novel[];
  aiConfig: unknown;
  apiUsage: unknown;
  novelCategories: Record<string, string>;
  readingProgress: Record<string, unknown>;
  proofreadProgress: Record<string, Record<number, unknown>>;
  ignoredWords: Record<string, string[]>;
  exportTime: number;
  version: string;
}

// 设置项导出数据
export interface ExportSettingsData {
  aiConfig: unknown;
  apiUsage: unknown;
  novelCategories: Record<string, string>;
  ignoredWords: Record<string, string[]>;
  exportTime: number;
  version: string;
}

// 单个小说导出数据
export interface ExportNovelData {
  novel: Novel;
  readingProgress: Record<string, unknown>;
  proofreadProgress: Record<number, unknown>;
  exportTime: number;
  version: string;
}

function getTimestamp(): string {
  const timestamp = new Date();
  return `${timestamp.getFullYear()}${String(timestamp.getMonth() + 1).padStart(2, '0')}${String(timestamp.getDate()).padStart(2, '0')}_${String(timestamp.getHours()).padStart(2, '0')}${String(timestamp.getMinutes()).padStart(2, '0')}${String(timestamp.getSeconds()).padStart(2, '0')}`;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '_').substring(0, 50);
}

// 导出设置项
async function exportSettings(settingsData: ExportSettingsData): Promise<void> {
  const content = JSON.stringify(settingsData, null, 2);
  const timeStr = getTimestamp();
  const fileName = `settings_${timeStr}.json`;

  if (!isTauri()) {
    browserDownload(content, fileName);
    return;
  }

  try {
    const filePath = await save({
      defaultPath: fileName,
      filters: [{ name: 'JSON 文件', extensions: ['json'] }],
    });

    if (filePath) {
      await writeTextFile(filePath, content);
    }
  } catch (e) {
    console.error('Export settings failed:', e);
    browserDownload(content, fileName);
  }
}

// 导出单个小说
async function exportSingleNovel(novelData: ExportNovelData): Promise<void> {
  const content = JSON.stringify(novelData, null, 2);
  const timeStr = getTimestamp();
  const safeName = sanitizeFileName(novelData.novel.name);
  const fileName = `novel_${safeName}_${timeStr}.json`;

  if (!isTauri()) {
    browserDownload(content, fileName);
    return;
  }

  try {
    const filePath = await save({
      defaultPath: fileName,
      filters: [{ name: 'JSON 文件', extensions: ['json'] }],
    });

    if (filePath) {
      await writeTextFile(filePath, content);
    }
  } catch (e) {
    console.error('Export novel failed:', e);
    browserDownload(content, fileName);
  }
}

// 导出所有数据为多个 JSON 文件（设置项 + 每个小说单独文件）
export async function exportAllData(data: ExportData): Promise<void> {
  // 1. 导出设置项
  const settingsData: ExportSettingsData = {
    aiConfig: data.aiConfig,
    apiUsage: data.apiUsage,
    novelCategories: data.novelCategories,
    ignoredWords: data.ignoredWords,
    exportTime: data.exportTime,
    version: data.version,
  };
  await exportSettings(settingsData);

  // 2. 导出每个小说
  for (const novel of data.novels) {
    const novelData: ExportNovelData = {
      novel: novel,
      readingProgress: data.readingProgress[novel.id] as Record<string, unknown> || {},
      proofreadProgress: data.proofreadProgress[novel.id] || {},
      exportTime: data.exportTime,
      version: data.version,
    };
    await exportSingleNovel(novelData);
  }
}