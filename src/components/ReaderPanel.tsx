// ============================================================
// 左侧阅读区（带行号 + 采纳动画 + 双击编辑）
// ============================================================
import { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { useAppStore } from '../stores/appStore';
import { useProofreadStore } from '../stores/proofreadStore';
import { splitParagraphs } from '../utils/chapterSplit';

export function ReaderPanel() {
  const chapters = useAppStore((s) => s.chapters);
  const currentChapterIndex = useAppStore((s) => s.currentChapterIndex);
  const fontSize = useAppStore((s) => s.fontSize);
  const replaceLine = useAppStore((s) => s.replaceLine);
    const highlightedParagraph = useProofreadStore((s) => s.highlightedParagraph);
  const setHighlightedParagraph = useProofreadStore((s) => s.setHighlightedParagraph);
  const applyAnimation = useProofreadStore((s) => s.applyAnimation);
  const startLine = useProofreadStore((s) => s.startLine);
  const setStartLine = useProofreadStore((s) => s.setStartLine);

  const containerRef = useRef<HTMLDivElement>(null);
  const paragraphRefs = useRef<(HTMLDivElement | null)[]>([]);
  const programmaticScrollRef = useRef(false);

  // 双击编辑状态：正在编辑的行索引
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const chapter = chapters[currentChapterIndex];
  const paragraphs = useMemo(() => {
    return chapter ? splitParagraphs(chapter.content) : [];
  }, [chapter]);

  /** 进入编辑模式 */
  const startEditing = useCallback((index: number, currentText: string) => {
    setEditingIndex(index);
    setEditValue(currentText);
  }, []);

  /** 保存编辑 */
  const saveEditing = useCallback(() => {
    if (editingIndex === null || !chapter) return;
    if (editValue !== paragraphs[editingIndex]) {
      replaceLine(chapter.id, editingIndex, editValue);
    }
    setEditingIndex(null);
  }, [editingIndex, editValue, chapter, paragraphs, replaceLine]);

  /** 取消编辑 */
  const cancelEditing = useCallback(() => {
    setEditingIndex(null);
  }, []);

  // 编辑模式下自动聚焦并调整 textarea 高度
  useEffect(() => {
    if (editingIndex !== null && textareaRef.current) {
      const ta = textareaRef.current;
      ta.focus();
      ta.selectionStart = ta.value.length;
      // 自动撑高
      ta.style.height = 'auto';
      ta.style.height = ta.scrollHeight + 'px';
    }
  }, [editingIndex]);

  /** textarea 内容变化时自动撑高 */
  const handleTextareaInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEditValue(e.target.value);
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  }, []);

  /** textarea 键盘事件：Ctrl+Enter 保存，Escape 取消 */
  const handleTextareaKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      saveEditing();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEditing();
    }
  }, [saveEditing, cancelEditing]);

  /** 程序化滚动到指定段落（带锁） */
  const scrollToParagraph = useCallback((index: number) => {
    const el = paragraphRefs.current[index];
    if (!el) return;
    programmaticScrollRef.current = true;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => { programmaticScrollRef.current = false; }, 800);
  }, []);

  useEffect(() => {
    if (highlightedParagraph !== null) {
      scrollToParagraph(highlightedParagraph);
    }
  }, [highlightedParagraph, scrollToParagraph]);

  useEffect(() => {
    if (applyAnimation) {
      scrollToParagraph(applyAnimation.paragraphIndex);
    }
  }, [applyAnimation, scrollToParagraph]);

  const handleScroll = useCallback(() => {
    if (programmaticScrollRef.current) return;
    const container = containerRef.current;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const midY = containerRect.top + containerRect.height / 2;

    for (let i = 0; i < paragraphRefs.current.length; i++) {
      const el = paragraphRefs.current[i];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (rect.top <= midY && rect.bottom >= midY) {
        setHighlightedParagraph(i);
        break;
      }
    }
  }, [setHighlightedParagraph]);

  if (!chapter) {
    return (
      <div className="reader-panel empty">
        <div className="empty-hint">
          <span className="empty-icon">📖</span>
          <p>请导入 TXT 小说文件开始阅读</p>
        </div>
      </div>
    );
  }

  return (
    <div className="reader-panel">
      <div className="reader-toolbar">
        <span className="chapter-title">{chapter.title || ''}</span>
      </div>
      <div
        className="reader-content"
        ref={containerRef}
        onScroll={handleScroll}
      >
        {paragraphs.map((para, i) => {
          const isAnimTarget =
            applyAnimation?.chapterId === chapter.id &&
            applyAnimation?.paragraphIndex === i;
          const animClass = isAnimTarget
            ? ` anim-${applyAnimation!.phase}`
            : '';
          const isEditing = editingIndex === i;

          // 如果是动画目标，提取需要高亮的文本片段
          const highlightInfo = isAnimTarget && applyAnimation!.startIndex !== undefined
            ? {
                before: para.slice(0, applyAnimation!.startIndex),
                highlight: para.slice(applyAnimation!.startIndex, applyAnimation!.endIndex),
                after: para.slice(applyAnimation!.endIndex),
                isOld: applyAnimation!.phase === 'highlight-old' || applyAnimation!.phase === 'replacing',
              }
            : null;

          return (
            <div
              key={i}
              ref={(el) => { paragraphRefs.current[i] = el; }}
              className={`reader-paragraph${highlightedParagraph === i ? ' highlighted' : ''}${animClass}${isEditing ? ' editing' : ''}`}
              style={{ fontSize: `${fontSize}px` }}
              onClick={() => { if (!isEditing) setHighlightedParagraph(i); }}
              onDoubleClick={() => { if (!isEditing) startEditing(i, para); }}
            >
                            <span
                className={`line-number${startLine === i ? ' start-line' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setStartLine(startLine === i ? null : i);
                }}
                title={startLine === i ? '取消起始行' : '设为校对起始行'}
              >
                {i + 1}
              </span>
              {isEditing ? (
                <textarea
                  ref={textareaRef}
                  className="line-edit-textarea"
                  value={editValue}
                  onChange={handleTextareaInput}
                  onKeyDown={handleTextareaKeyDown}
                  onBlur={saveEditing}
                  rows={1}
                  style={{ fontSize: `${fontSize}px` }}
                />
              ) : highlightInfo ? (
                <span className="line-text">
                  {highlightInfo.before}
                  <span className={`text-highlight ${highlightInfo.isOld ? 'highlight-old' : 'highlight-new'}`}>
                    {highlightInfo.highlight}
                  </span>
                  {highlightInfo.after}
                </span>
              ) : (
                <span className="line-text">{para}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
