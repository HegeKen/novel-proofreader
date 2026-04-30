// ============================================================
// 章节导航侧栏
// ============================================================
import { useAppStore } from '../stores/appStore';
import { EmptyState } from './EmptyState';

export function ChapterNav({ onChapterSelect }: { onChapterSelect?: () => void } = {}) {
  const chapters = useAppStore((s) => s.chapters);
  const currentChapterIndex = useAppStore((s) => s.currentChapterIndex);
  const setCurrentChapterIndex = useAppStore((s) => s.setCurrentChapterIndex);

  if (chapters.length === 0) {
    return (
      <div className="chapter-nav empty">
        <div className="nav-header">
          <h3>📑 章节</h3>
        </div>
        <EmptyState icon="📑" message="导入 TXT 文件后" hint="章节将在此列出" />
      </div>
    );
  }

  return (
    <div className="chapter-nav">
      <div className="nav-header">
        <h3>📑 章节</h3>
        <span className="chapter-count">{chapters.length} 章</span>
      </div>
      <div className="chapter-list">
        {chapters.map((ch, i) => (
          <button
            key={ch.id}
            className={`chapter-item ${i === currentChapterIndex ? 'active' : ''}`}
            onClick={() => {
              setCurrentChapterIndex(i);
              if (onChapterSelect) {
                onChapterSelect();
              }
            }}
            title={ch.title}
          >
            <span className="chapter-number">{i + 1}</span>
            <span className="chapter-title">{ch.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
