import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { exists } from '@tauri-apps/plugin-fs';

function generateUniqueName(baseName: string, extension: string): string {
  const timestamp = new Date();
  const timeStr = `${timestamp.getFullYear()}${String(timestamp.getMonth() + 1).padStart(2, '0')}${String(timestamp.getDate()).padStart(2, '0')}_${String(timestamp.getHours()).padStart(2, '0')}${String(timestamp.getMinutes()).padStart(2, '0')}${String(timestamp.getSeconds()).padStart(2, '0')}`;
  return `${baseName}_${timeStr}${extension}`;
}

export async function exportToFile(content: string, suggestedName: string): Promise<'success' | 'fallback' | 'cancelled'> {
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
      const encoder = new TextEncoder();
      const data = encoder.encode(content);
      await writeFile(finalPath, data);
      return 'success';
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