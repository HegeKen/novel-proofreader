// ============================================================
// 主布局 - Apple Liquid Glass Design
// ============================================================
import { useState, useEffect, useCallback } from 'react';
import { NovelList } from './components/NovelList';
import { ChapterNav } from './components/ChapterNav';
import { ReaderPanel } from './components/ReaderPanel';
import { ProofreadPanel } from './components/ProofreadPanel';
import { TaskPanel } from './components/TaskPanel';
import { ConfigModal } from './components/ConfigModal';
import { useAppStore } from './stores/appStore';
import { splitChapters } from './utils/chapterSplit';
import { decodeTextBuffer } from './utils/decodeText';
import { exportToFile } from './utils/fileExport';

type RightTab = 'proofread' | 'task';
type MobileTab = 'novels' | 'chapters' | 'reader' | 'task' | 'settings';

export default function App() {
  const novels = useAppStore((s) => s.novels);
  const currentNovelId = useAppStore((s) => s.currentNovelId);
  const setChapters = useAppStore((s) => s.setChapters);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const [configOpen, setConfigOpen] = useState(false);
  const [rightTab, setRightTab] = useState<RightTab>('proofread');
  const [mobileTab, setMobileTab] = useState<MobileTab>('reader');
  const [isMobile, setIsMobile] = useState(false);
  // 移动端校对面板显示/隐藏状态
  const [mobileProofreadVisible, setMobileProofreadVisible] = useState(true);

  // 检测是否为移动端
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // 移动端音量键翻页功能
  const chapters = useAppStore((s) => s.chapters);
  const currentChapterIndex = useAppStore((s) => s.currentChapterIndex);
  const setCurrentChapterIndex = useAppStore((s) => s.setCurrentChapterIndex);
  const readingMode = useAppStore((s) => s.readingMode);

  const handleVolumeKey = useCallback((e: KeyboardEvent) => {
    if (!isMobile) return;
    
    if (e.code === 'VolumeUp') {
      e.preventDefault();
      e.stopPropagation();
      if (currentChapterIndex > 0) {
        setCurrentChapterIndex(currentChapterIndex - 1);
      }
    } else if (e.code === 'VolumeDown') {
      e.preventDefault();
      e.stopPropagation();
      if (currentChapterIndex < chapters.length - 1) {
        setCurrentChapterIndex(currentChapterIndex + 1);
      }
    }
  }, [isMobile, currentChapterIndex, chapters.length, setCurrentChapterIndex]);

  useEffect(() => {
    window.addEventListener('keydown', handleVolumeKey);
    return () => window.removeEventListener('keydown', handleVolumeKey);
  }, [handleVolumeKey]);

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
    await exportToFile(novel.fullText, `${novel.name}_edited.txt`);
  };

  /** 保存到原文件 */
  const handleSaveToOriginal = async () => {
    const novel = novels.find((n) => n.id === currentNovelId);
    if (!novel) return;
    if (!confirm(`确定要覆盖原文件 "${novel.name}" 吗？此操作不可撤销。`)) {
      return;
    }
    const result = await exportToFile(novel.fullText, novel.name);
    if (result === 'success') {
      alert('文件已成功保存！');
    } else if (result === 'fallback') {
      alert('文件已下载！请手动覆盖原文件。');
    }
  };

  // 移动端标签切换
  const handleMobileTabChange = (tab: MobileTab) => {
    setMobileTab(tab);
    if (tab === 'task') {
      setRightTab(tab);
    }
  };

  return (
    <div className="app">
      {/* 顶部栏 */}
      <header className="app-header">
        <div className="header-left">
          <h1 className="app-title">
            <img src="/icons/icon.png" alt="" className="app-icon" />
            校对助手
          </h1>
        </div>
        <div className="header-center">
                    <button className="btn-import" onClick={handleImport}>
            📂 导入 TXT 文件
          </button>
          {currentNovelId && (
            <>
              <button className="btn-export" onClick={handleExportAsNew}>
                💾 导出修改版本
              </button>
              <button className="btn-save-original" onClick={handleSaveToOriginal}>
                📝 保存到原文件
              </button>
            </>
          )}
        </div>
        <div className="header-right">
          {isMobile && currentNovelId && (
            <button className="btn-save-mobile" onClick={handleSaveToOriginal} title="保存到原文件">
              💾
            </button>
          )}
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

      {/* 主体布局 - 响应式 */}
      <div className="app-body">
        {/* 最左：小说列表 - 桌面端阅读模式隐藏 */}
        <aside className={`app-novel-list ${isMobile && mobileTab === 'novels' ? 'mobile-active' : ''} ${!isMobile && readingMode ? 'hidden-panel' : ''}`}>
          <NovelList onNovelSelect={() => isMobile && setMobileTab('chapters')} />
        </aside>

        {/* 左二：章节导航 - 桌面端阅读模式隐藏 */}
        <aside className={`app-sidebar ${isMobile && mobileTab === 'chapters' ? 'mobile-active' : ''} ${!isMobile && readingMode ? 'hidden-panel' : ''}`}>
          <ChapterNav onChapterSelect={() => isMobile && setMobileTab('reader')} />
        </aside>

        {/* 中间：阅读区（桌面端） */}
        <main className={`app-main ${rightTab === 'task' ? 'task-mode' : ''} ${isMobile && mobileTab === 'reader' ? '' : isMobile ? 'hidden' : ''} ${!isMobile && readingMode ? '' : ''}`}>
          {/* 移动端：阅读区 + 校对区合并 */}
          {isMobile && mobileTab === 'reader' && (
            <div className="mobile-reader-proofread">
              <div className="mobile-reader-section">
                <ReaderPanel showReadingModeToggle={true} />
              </div>
              {/* 校对区切换按钮 - 阅读模式下隐藏 */}
              {!readingMode && (
                <button
                  className="mobile-proofread-toggle"
                  onClick={() => setMobileProofreadVisible(!mobileProofreadVisible)}
                >
                  {mobileProofreadVisible ? '🔍 收起校对' : '📝 显示校对'}
                </button>
              )}
              {/* 校对区 - 阅读模式下隐藏 */}
              {!readingMode && mobileProofreadVisible && (
                <div className="mobile-proofread-section">
                  <div className="right-content">
                    <ProofreadPanel />
                  </div>
                </div>
              )}
            </div>
          )}
          {/* 桌面端：仅显示阅读区 */}
          {!isMobile && <ReaderPanel showReadingModeToggle={true} />}
        </main>

        {/* 右侧：校对 / 任务（桌面端）- 桌面端阅读模式隐藏 */}
        <aside className={`app-right ${rightTab === 'task' ? 'task-mode' : ''} ${isMobile && mobileTab === 'task' ? 'mobile-active' : ''} ${!isMobile && readingMode ? 'hidden-panel' : ''}`}>
          {isMobile && mobileTab === 'task' ? (
            <TaskPanel />
          ) : (
            <>
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
            </>
          )}
        </aside>
      </div>

      {/* 移动端底部标签栏 */}
      {isMobile && (
        <div className="mobile-tab-bar">
          <button
            className={`mobile-tab-btn ${mobileTab === 'novels' ? 'active' : ''}`}
            onClick={() => handleMobileTabChange('novels')}
          >
            📚
            <span>小说</span>
          </button>
          <button
            className={`mobile-tab-btn ${mobileTab === 'chapters' ? 'active' : ''}`}
            onClick={() => handleMobileTabChange('chapters')}
          >
            📑
            <span>章节</span>
          </button>
          <button
            className={`mobile-tab-btn ${mobileTab === 'reader' ? 'active' : ''}`}
            onClick={() => handleMobileTabChange('reader')}
          >
            📖
            <span>阅读</span>
          </button>
          <button
            className={`mobile-tab-btn ${mobileTab === 'task' ? 'active' : ''}`}
            onClick={() => handleMobileTabChange('task')}
          >
            🎬
            <span>剧本</span>
          </button>
        </div>
      )}

      {/* 设置弹窗 */}
      <ConfigModal open={configOpen} onClose={() => setConfigOpen(false)} />
    </div>
  );
}
