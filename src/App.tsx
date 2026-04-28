// ============================================================
// 主布局
// ============================================================
import { useState, useEffect } from 'react';
import { NovelList } from './components/NovelList';
import { ChapterNav } from './components/ChapterNav';
import { ReaderPanel } from './components/ReaderPanel';
import { ProofreadPanel } from './components/ProofreadPanel';
import { TaskPanel } from './components/TaskPanel';
import { ConfigModal } from './components/ConfigModal';
import { useAppStore } from './stores/appStore';
import { splitChapters } from './utils/chapterSplit';
import { decodeTextBuffer } from './utils/decodeText';

type RightTab = 'proofread' | 'task';

export default function App() {
    const novels = useAppStore((s) => s.novels);
  const currentNovelId = useAppStore((s) => s.currentNovelId);
  const setChapters = useAppStore((s) => s.setChapters);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const [configOpen, setConfigOpen] = useState(false);
  const [rightTab, setRightTab] = useState<RightTab>('proofread');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const handleImport = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

            const buffer = await file.arrayBuffer();
      const text = decodeTextBuffer(buffer);
      const chapters = splitChapters(text);
      setChapters(chapters);
    };
    input.click();
  };

    /** 导出修改后的版本（另存为） */
  const handleExportAsNew = async () => {
    const novel = novels.find((n) => n.id === currentNovelId);
    if (!novel) return;

    // 优先使用 File System Access API，让用户选择保存位置
    if ('showSaveFilePicker' in window) {
      try {
        const handle = await (window as unknown as { showSaveFilePicker: (options: { suggestedName: string; types: { description: string; accept: { 'text/plain': string[] } }[] }) => Promise<{ createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }> }> }).showSaveFilePicker({
          suggestedName: `${novel.name}_edited.txt`,
          types: [{ description: '文本文件', accept: { 'text/plain': ['.txt'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(novel.fullText);
        await writable.close();
        return;
      } catch {
        // 用户取消选择，静默返回
        return;
      }
    }

    // fallback：直接下载
    const blob = new Blob([novel.fullText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${novel.name}_edited.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /** 保存到原文件 */
  const handleSaveToOriginal = async () => {
    const novel = novels.find((n) => n.id === currentNovelId);
    if (!novel) return;

    // 提示用户确认覆盖原文件
    if (!confirm(`确定要覆盖原文件 "${novel.name}" 吗？此操作不可撤销。`)) {
      return;
    }

    // 优先使用 File System Access API 写入原文件
    if ('showSaveFilePicker' in window) {
      try {
        const handle = await (window as unknown as { showSaveFilePicker: (options: { suggestedName: string; types: { description: string; accept: { 'text/plain': string[] } }[] }) => Promise<{ createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }> }> }).showSaveFilePicker({
          suggestedName: novel.name,
          types: [{ description: '文本文件', accept: { 'text/plain': ['.txt'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(novel.fullText);
        await writable.close();
        alert('文件已成功保存！');
        return;
      } catch {
        // 用户取消选择，静默返回
        return;
      }
    }

    // fallback：直接下载覆盖
    const blob = new Blob([novel.fullText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = novel.name;
    a.click();
    URL.revokeObjectURL(url);
    alert('文件已下载！请手动覆盖原文件。');
  };

  return (
    <div className="app">
      {/* 顶部栏 */}
      <header className="app-header">
        <div className="header-left">
          <h1 className="app-title">📖 小说校对助手</h1>
        </div>
        <div className="header-center">
                    <button className="btn-import" onClick={handleImport}>
            📂 导入 TXT 文件
          </button>
          {currentNovelId && (
            <>
              <button className="btn-import" onClick={handleExportAsNew}>
                💾 导出修改版本
              </button>
              <button className="btn-save-original" onClick={handleSaveToOriginal}>
                📝 保存到原文件
              </button>
            </>
          )}
        </div>
        <div className="header-right">
          <button
            className="btn-theme-toggle"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title={theme === 'dark' ? '切换到亮色模式' : '切换到深色模式'}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <button className="btn-settings" onClick={() => setConfigOpen(true)}>
            ⚙️ 设置
          </button>
        </div>
      </header>

      {/* 主体四栏布局 */}
      <div className="app-body">
        {/* 最左：小说列表 */}
        <aside className="app-novel-list">
          <NovelList />
        </aside>

        {/* 左二：章节导航 */}
        <aside className="app-sidebar">
          <ChapterNav />
        </aside>

        {/* 中间：阅读区 */}
        <main className={`app-main ${rightTab === 'task' ? 'task-mode' : ''}`}>
          <ReaderPanel />
        </main>

        {/* 右侧：校对 / 任务 */}
        <aside className={`app-right ${rightTab === 'task' ? 'task-mode' : ''}`}>
          <div className="right-tabs">
            <button
              className={`tab-btn ${rightTab === 'proofread' ? 'active' : ''}`}
              onClick={() => setRightTab('proofread')}
            >
              🔍 校对检测
            </button>
            <button
              className={`tab-btn ${rightTab === 'task' ? 'active' : ''}`}
              onClick={() => setRightTab('task')}
            >
              🎬 剧本改编
            </button>
          </div>
          <div className="right-content">
            {rightTab === 'proofread' ? <ProofreadPanel /> : <TaskPanel />}
          </div>
        </aside>
      </div>

      {/* 设置弹窗 */}
      <ConfigModal open={configOpen} onClose={() => setConfigOpen(false)} />
    </div>
  );
}
