// ============================================================
// 最左侧小说列表
// ============================================================
import { useAppStore } from '../stores/appStore';
import { splitChapters } from '../utils/chapterSplit';
import { decodeTextBuffer } from '../utils/decodeText';
import { formatFileSize, formatDateTime } from '../utils/formatters';
import { EmptyState } from './EmptyState';
import type { Novel } from '../types';

export function NovelList({ onNovelSelect }: { onNovelSelect?: () => void } = {}) {
  const novels = useAppStore((s) => s.novels);
  const currentNovelId = useAppStore((s) => s.currentNovelId);
  const addNovel = useAppStore((s) => s.addNovel);
  const removeNovel = useAppStore((s) => s.removeNovel);
  const selectNovel = useAppStore((s) => s.selectNovel);
  const setChapters = useAppStore((s) => s.setChapters);

  const handleImport = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const buffer = await file.arrayBuffer();
      const text = decodeTextBuffer(buffer);
      const novel: Novel = {
        id: `novel-${Date.now()}`,
        name: file.name.replace(/\.txt$/i, ''),
        fullText: text,
        importedAt: Date.now(),
        chapters: [], // 添加空的章节数组以满足类型定义
      };
      addNovel(novel);

      // 解析章节
      const chapters = splitChapters(text);
      setChapters(chapters);
    };
    input.click();
  };

  const handleSelect = (novel: Novel) => {
    selectNovel(novel.id);
    const chapters = splitChapters(novel.fullText);
    setChapters(chapters);
    if (onNovelSelect) {
      onNovelSelect();
    }
  };

  const handleRemove = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    removeNovel(id);
  };

  return (
    <div className="novel-list">
      <div className="novel-list-header">
        <span className="novel-list-title">📚 小说库</span>
        <button className="btn-import-novel" onClick={handleImport} title="导入新小说">
          +
        </button>
      </div>
      <div className="novel-list-items">
        {novels.length === 0 ? (
          <EmptyState icon="📚" message="暂无小说" hint="点击 + 导入 TXT 文件" />
        ) : (
          novels.map((novel) => (
            <div
              key={novel.id}
              className={`novel-item ${currentNovelId === novel.id ? 'active' : ''}`}
              onClick={() => handleSelect(novel)}
            >
              <div className="novel-item-name">{novel.name}</div>
              <div className="novel-item-meta">
                <span>{formatFileSize(novel.fullText)}</span>
                <span>{formatDateTime(novel.importedAt)}</span>
              </div>
              <button
                className="novel-item-remove"
                onClick={(e) => handleRemove(e, novel.id)}
                title="删除"
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
