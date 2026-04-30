interface FilePickerOptions {
  suggestedName: string;
  types: { description: string; accept: { 'text/plain': string[] } }[];
}

interface FilePickerHandle {
  createWritable: () => Promise<{
    write: (data: string) => Promise<void>;
    close: () => Promise<void>;
  }>;
}

type FilePickerAPI = {
  showSaveFilePicker: (options: FilePickerOptions) => Promise<FilePickerHandle>;
};

export async function exportToFile(content: string, suggestedName: string): Promise<'success' | 'fallback' | 'cancelled'> {
  if ('showSaveFilePicker' in window) {
    try {
      const handle = await (window as unknown as FilePickerAPI).showSaveFilePicker({
        suggestedName,
        types: [{ description: '文本文件', accept: { 'text/plain': ['.txt'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      return 'success';
    } catch {
      return 'cancelled';
    }
  }

  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  a.click();
  URL.revokeObjectURL(url);
  return 'fallback';
}