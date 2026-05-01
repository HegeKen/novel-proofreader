import { save } from '@tauri-apps/plugin-dialog';
import { writeFile, writeTextFile, exists, readTextFile, mkdir, readDir, remove } from '@tauri-apps/plugin-fs';
import { BaseDirectory } from '@tauri-apps/plugin-fs';

function getBaseDir(): BaseDirectory {
  return BaseDirectory.Document;
}

function getNovelsSubDir(): string {
  return 'novels';
}

function isTauriEnvironment(): boolean {
  return typeof window !== 'undefined' && !!(window as unknown as Record<string, unknown>).__TAURI__;
}

export async function ensureNovelsDirectory(): Promise<boolean> {
  if (!isTauriEnvironment()) {
    console.log('[fileExport] Not in Tauri environment, skipping directory creation');
    return true;
  }
  try {
    const baseDir = getBaseDir();
    const novelsPath = getNovelsSubDir();
    const fullPath = `${novelsPath}`;
    const dirExists = await exists(fullPath, { baseDir });
    if (!dirExists) {
      await mkdir(fullPath, { baseDir, recursive: true });
    }
    return true;
  } catch (e) {
    console.error('Failed to create novels directory:', e);
    return false;
  }
}

export async function importNovelFromStorage(fileName: string): Promise<string | null> {
  if (!isTauriEnvironment()) {
    console.log('[fileExport] Not in Tauri environment, skipping import');
    return null;
  }
  try {
    await ensureNovelsDirectory();
    const novelsPath = getNovelsSubDir();
    const fullPath = `${novelsPath}/${fileName}`;
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
  if (!isTauriEnvironment()) {
    console.log('[fileExport] Not in Tauri environment, skipping save');
    return true;
  }
  try {
    await ensureNovelsDirectory();
    const novelsPath = getNovelsSubDir();
    const fullPath = `${novelsPath}/${fileName}`;
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
  if (!isTauriEnvironment()) {
    console.log('[fileExport] Not in Tauri environment, skipping delete');
    return true;
  }
  try {
    const novelsPath = getNovelsSubDir();
    const fullPath = `${novelsPath}/${fileName}`;
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
  if (!isTauriEnvironment()) {
    console.log('[fileExport] Not in Tauri environment, returning empty list');
    return [];
  }
  try {
    await ensureNovelsDirectory();
    const novelsPath = getNovelsSubDir();
    const baseDir = getBaseDir();
    const entries = await readDir(novelsPath, { baseDir });
    return entries
      .filter(entry => entry.name?.endsWith('.txt'))
      .map(entry => entry.name as string);
  } catch (e) {
    console.error('Failed to list novels in storage:', e);
    return [];
  }
}

function generateUniqueName(baseName: string, extension: string): string {
  const timestamp = new Date();
  const timeStr = `${timestamp.getFullYear()}${String(timestamp.getMonth() + 1).padStart(2, '0')}${String(timestamp.getDate()).padStart(2, '0')}_${String(timestamp.getHours()).padStart(2, '0')}${String(timestamp.getMinutes()).padStart(2, '0')}${String(timestamp.getSeconds()).padStart(2, '0')}`;
  return `${baseName}_${timeStr}${extension}`;
}

export async function exportToFile(content: string, suggestedName: string): Promise<'success' | 'fallback' | 'cancelled'> {
  try {
    if (!content || content.trim() === '') {
      console.error('Export content is empty!');
      alert('导出失败：内容为空，请先导入或编辑小说内容');
      return 'cancelled';
    }

    if (!isTauriEnvironment()) {
      console.log('[fileExport] Not in Tauri environment, using browser download fallback');
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = suggestedName;
      a.click();
      URL.revokeObjectURL(url);
      return 'fallback';
    }

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