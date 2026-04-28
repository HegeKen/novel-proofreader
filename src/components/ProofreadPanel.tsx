// ============================================================
// 右侧校对区（带按行检测 + 采纳动画）
// ============================================================
import { useState, useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '../stores/appStore';
import { useProofreadStore } from '../stores/proofreadStore';
import { useAICheck } from '../hooks/useAICheck';
import { splitParagraphs } from '../utils/chapterSplit';
import type { CheckGranularity, ProofreadError } from '../types';

const ERROR_TYPE_LABELS: Record<string, string> = {
  typo: '🔤 错别字',
  format: '📐 排版',
  grammar: '📝 病句',
};

const ERROR_TYPE_COLORS: Record<string, string> = {
  typo: '#ff4d4f',
  format: '#faad14',
  grammar: '#1677ff',
};

/** 采纳动画时长（ms） */
const ANIM_OLD_MS = 600;
const ANIM_REPLACE_MS = 300;
const ANIM_NEW_MS = 1200;

export function ProofreadPanel() {
  const chapters = useAppStore((s) => s.chapters);
  const currentChapterIndex = useAppStore((s) => s.currentChapterIndex);
  const replaceParagraphText = useAppStore((s) => s.replaceParagraphText);
    const results = useProofreadStore((s) => s.results);
  const setResults = useProofreadStore((s) => s.setResults);
  const highlightedParagraph = useProofreadStore((s) => s.highlightedParagraph);
  const setHighlightedParagraph = useProofreadStore((s) => s.setHighlightedParagraph);
  const toggleErrorApplied = useProofreadStore((s) => s.toggleErrorApplied);
  const setApplyAnimation = useProofreadStore((s) => s.setApplyAnimation);

    const startLine = useProofreadStore((s) => s.startLine);
  const setStartLine = useProofreadStore((s) => s.setStartLine);

      const { checkChapter, cancelCheck, checkSingleLine } = useAICheck();
  const [granularity, setGranularity] = useState<CheckGranularity>('paragraph');
  const [checking, setChecking] = useState(false);
  const [singleCheckingLine, setSingleCheckingLine] = useState<number | null>(null);
  // 动画互斥：防止快速连续点击"采纳"
  const animatingRef = useRef(false);

    const chapter = chapters[currentChapterIndex];
  const chapterResults = chapter ? results[chapter.id] ?? [] : [];
  const totalLines = chapter ? chapter.content.split('\n').length : 0;

    // 切换章节时，自动把段落列表以"待校对"状态渲染出来（如果没有已有结果）
  const lastChapterIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (!chapter) { lastChapterIdRef.current = null; return; }
    if (lastChapterIdRef.current === chapter.id) return;
    lastChapterIdRef.current = chapter.id;
    // 切换章节时重置起始行
    setStartLine(null);
    // 如果该章节还没有校对结果，初始化为待校对列表
    const existing = useProofreadStore.getState().results[chapter.id];
    if (!existing || existing.length === 0) {
      const paragraphs = splitParagraphs(chapter.content);
      const initial = paragraphs.map((p, i) => ({
        paragraphIndex: i,
        originalText: p,
        errors: [],
        status: 'pending' as const,
      }));
      setResults(chapter.id, initial);
    }
  }, [chapter?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStartCheck = async () => {
    setChecking(true);
    await checkChapter(granularity, startLine ?? 0);
    setChecking(false);
  };

  const handleSingleLineCheck = async (lineIndex: number) => {
    if (checking || singleCheckingLine !== null) return;
    await checkSingleLine(lineIndex, setSingleCheckingLine);
  };

      /** 采纳单个错误：高亮旧文本 → 替换 → 高亮新文本 */
  const handleApply = useCallback(
    (paraResult: (typeof chapterResults)[number], err: ProofreadError) => {
      // 动画互斥：上一个动画还没结束时禁止操作
      if (animatingRef.current) return;

      // 通过 getState() 获取最新 chapter，避免闭包过期
      const state = useAppStore.getState();
      const currentChapter = state.chapters[state.currentChapterIndex];
      if (!currentChapter) return;
      const chapterId = currentChapter.id;
      const paraIndex = paraResult.paragraphIndex;

                  // 如果已采纳则撤销（把文本换回去）
      if (err.applied) {
        const ok = replaceParagraphText(chapterId, paraIndex, err.correctedText, err.originalText);
        if (!ok) {
          // 撤销失败（原文已被修改），只翻转状态
          console.warn('[ProofreadPanel] 撤销替换失败，原文已不匹配');
        }
        toggleErrorApplied(chapterId, paraIndex, err.id);
        return;
      }

      animatingRef.current = true;

      // 阶段 1：高亮旧文本（精确到错误位置）
      setApplyAnimation({
        chapterId,
        paragraphIndex: paraIndex,
        phase: 'highlight-old',
        errorId: err.id,
        originalText: err.originalText,
        correctedText: err.correctedText,
        startIndex: err.startIndex,
        endIndex: err.endIndex,
      });
      setHighlightedParagraph(paraIndex);

      setTimeout(() => {
        // 阶段 2：替换文本
        setApplyAnimation({
          chapterId,
          paragraphIndex: paraIndex,
          phase: 'replacing',
          errorId: err.id,
          originalText: err.originalText,
          correctedText: err.correctedText,
          startIndex: err.startIndex,
          endIndex: err.endIndex,
        });

                const replaced = replaceParagraphText(chapterId, paraIndex, err.originalText, err.correctedText);
        toggleErrorApplied(chapterId, paraIndex, err.id);

        if (!replaced) {
          // AI 返回的文本在段落中找不到，替换静默失败
          console.warn(`[ProofreadPanel] 文本匹配失败: "${err.originalText}" 不在段落 ${paraIndex} 中`);
        }

        setTimeout(() => {
          // 阶段 3：高亮新文本（精确到替换后的位置）
          setApplyAnimation({
            chapterId,
            paragraphIndex: paraIndex,
            phase: 'highlight-new',
            errorId: err.id,
            originalText: err.originalText,
            correctedText: err.correctedText,
            startIndex: err.startIndex,
            endIndex: err.endIndex,
          });

          setTimeout(() => {
            // 动画结束，解锁
            setApplyAnimation(null);
            animatingRef.current = false;
          }, ANIM_NEW_MS);
        }, ANIM_REPLACE_MS);
      }, ANIM_OLD_MS);
    },
    [
      replaceParagraphText,
      toggleErrorApplied,
      setApplyAnimation,
      setHighlightedParagraph,
    ],
  );

  if (!chapter) {
    return (
      <div className="proofread-panel empty">
        <div className="empty-hint">
          <span className="empty-icon">🔍</span>
          <p>导入文件后可进行校对检测</p>
        </div>
      </div>
    );
  }

  const totalErrors = chapterResults.reduce((sum, r) => sum + r.errors.length, 0);

  return (
    <div className="proofread-panel">
            <div className="proofread-toolbar">
        <div className="toolbar-left">
          <label className="granularity-select">
            检测粒度：
            <select
              value={granularity}
              onChange={(e) => setGranularity(e.target.value as CheckGranularity)}
              disabled={checking}
            >
              <option value="paragraph">按段落</option>
              <option value="line">按行</option>
              <option value="chapter">按章节</option>
            </select>
          </label>
          {granularity !== 'chapter' && totalLines > 0 && (
            <label className="start-line-select">
              起始行：
              <select
                value={startLine ?? 0}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setStartLine(v === 0 ? null : v);
                }}
                disabled={checking}
              >
                <option value={0}>从头开始</option>
                {Array.from({ length: Math.min(totalLines, 500) }, (_, i) => i + 1)
                  .filter((n) => n < totalLines)
                  .map((n) => (
                    <option key={n} value={n}>
                      第 {n + 1} 行
                    </option>
                  ))}
              </select>
            </label>
          )}
        </div>
        <div className="toolbar-right">
          {totalErrors > 0 && (
            <span className="error-count">
              发现 <strong>{totalErrors}</strong> 个问题
            </span>
          )}
          {checking ? (
            <button className="btn-cancel" onClick={cancelCheck}>
              取消检测
            </button>
          ) : (
            <button className="btn-check" onClick={handleStartCheck}>
              开始检测
            </button>
          )}
        </div>
      </div>

            <div className="proofread-content">
        {chapterResults.length === 0 ? (
          <div className="empty-hint">
            <p>点击"开始检测"对当前章节进行 AI 校对</p>
          </div>
        ) : (
          chapterResults.map((paraResult) => (
                        <div
              key={paraResult.paragraphIndex}
              className={`proofread-paragraph ${
                highlightedParagraph === paraResult.paragraphIndex ? 'highlighted' : ''
              }`}
              onClick={() => {
                setHighlightedParagraph(paraResult.paragraphIndex);
                // 点击段落时自动切换起始行到该段落
                if (!checking) {
                  setStartLine(paraResult.paragraphIndex === 0 ? null : paraResult.paragraphIndex);
                }
              }}
            >
              <div className="para-original">
                <span className="para-index">#{paraResult.paragraphIndex + 1}</span>
                {paraResult.originalText.length > 200
                  ? paraResult.originalText.slice(0, 200) + '…'
                  : paraResult.originalText}
                <button
                  className="btn-single-check"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSingleLineCheck(paraResult.paragraphIndex);
                  }}
                  disabled={checking || singleCheckingLine !== null || paraResult.status === 'checking'}
                  title="检测此行"
                >
                  {singleCheckingLine === paraResult.paragraphIndex ? '检测中…' : '🔍 检测'}
                </button>
              </div>

              {paraResult.status === 'checking' && (
                <div className="para-status checking">
                  <span className="spinner" /> 检测中…
                </div>
              )}
              {paraResult.status === 'error' && (
                <div className="para-status error">
                  ❌ 检测失败：{paraResult.errorMessage}
                </div>
              )}
              {paraResult.status === 'done' && paraResult.errors.length === 0 && (
                <div className="para-status success">✅ 未发现问题</div>
              )}
              {paraResult.errors.length > 0 && (
                <div className="para-errors">
                  {paraResult.errors.map((err: ProofreadError) => (
                    <div
                      key={err.id}
                      className={`error-item ${err.applied ? 'applied' : ''}`}
                    >
                      <div className="error-header">
                        <span
                          className="error-type-badge"
                          style={{ backgroundColor: ERROR_TYPE_COLORS[err.errorType] }}
                        >
                          {ERROR_TYPE_LABELS[err.errorType] ?? err.errorType}
                        </span>
                        <span className="error-location">
                          位置 {err.startIndex}–{err.endIndex}
                        </span>
                        {err.applied && <span className="applied-badge">已采纳</span>}
                      </div>
                                            <div className="error-detail">
                        <span className="error-original">「{err.originalText}」</span>
                        <span className="error-arrow">→</span>
                        <span className="error-suggestion">{err.correctedText}</span>
                      </div>
                      {err.suggestion && (
                        <div className="error-suggestion-note">💡 {err.suggestion}</div>
                      )}
                      <button
                        className="btn-apply"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleApply(paraResult, err);
                        }}
                      >
                        {err.applied ? '撤销' : '采纳修改'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
