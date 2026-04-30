// ============================================================
// 右侧校对区（带按行检测 + 采纳动画）
// ============================================================
import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useAppStore } from '../stores/appStore';
import { useProofreadStore } from '../stores/proofreadStore';
import { useAICheck } from '../hooks/useAICheck';
import { splitParagraphs } from '../utils/chapterSplit';
import { buildParagraphIndexMap } from '../utils/formatters';
import { EmptyState } from './EmptyState';
import type { CheckGranularity, ProofreadError } from '../types';

const ERROR_TYPE_LABELS: Record<string, string> = {
  typo: '🔤 错别字',
  format: '📐 排版',
  grammar: '📝 病句',
  punctuation: '📖 标点',
};

const ERROR_TYPE_COLORS: Record<string, string> = {
  typo: '#ff4d4f',
  format: '#faad14',
  grammar: '#1677ff',
  punctuation: '#52c41a',
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
  // 滚动容器 ref
  const proofreadContentRef = useRef<HTMLDivElement>(null);
  const paragraphRefs = useRef<(HTMLDivElement | null)[]>([]);

    const chapter = chapters[currentChapterIndex];
  const chapterResults = useMemo(() => {
    return chapter ? results[chapter.id] ?? [] : [];
  }, [chapter, results]);
  const totalLines = chapter ? splitParagraphs(chapter.content).filter(p => p.trim() !== '').length : 0;

  // 建立过滤后索引到原始索引的映射
  const paragraphIndexMap = useMemo(() => {
    return chapter ? buildParagraphIndexMap(chapter.content) : [];
  }, [chapter]);

  // 确保始终有段落列表用于高亮匹配（与阅读区保持同步）
  const displayResults = useMemo(() => {
    if (!chapter) return [];
    
    // 获取过滤后的段落列表（与阅读区一致）
    const paragraphs = splitParagraphs(chapter.content).filter(p => p.trim() !== '');
    
    // 如果有结果，合并结果数据
    if (chapterResults.length > 0) {
      return paragraphs.map((p, i) => {
        const existing = chapterResults.find(r => r.paragraphIndex === paragraphIndexMap[i]);
        if (existing) {
          return existing;
        }
        return {
          paragraphIndex: paragraphIndexMap[i],
          originalText: p,
          errors: [],
          status: 'pending' as const,
        };
      });
    }

    // 如果没有结果，生成空的段落列表
    return paragraphs.map((p, i) => ({
      paragraphIndex: paragraphIndexMap[i],
      originalText: p,
      errors: [],
      status: 'pending' as const,
    }));
  }, [chapter, chapterResults, paragraphIndexMap]);

    // 切换章节时，自动把段落列表以"待校对"状态渲染出来（如果没有已有结果）
  const lastChapterIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (!chapter) { lastChapterIdRef.current = null; return; }
    if (lastChapterIdRef.current === chapter.id) return;
    lastChapterIdRef.current = chapter.id;
    // 切换章节时重置起始行
    setStartLine(null);
    // 如果该章节还没有校对结果，初始化为待校对列表（过滤掉空段落）
    const existing = useProofreadStore.getState().results[chapter.id];
    if (!existing || existing.length === 0) {
      const paragraphs = splitParagraphs(chapter.content).filter(p => p.trim() !== '');
      const initial = paragraphs.map((p, i) => ({
        paragraphIndex: paragraphIndexMap[i],
        originalText: p,
        errors: [],
        status: 'pending' as const,
      }));
      setResults(chapter.id, initial);
    }
  }, [chapter?.id, paragraphIndexMap, chapter, setResults, setStartLine]);

  const handleStartCheck = async () => {
    setChecking(true);
    await checkChapter(granularity, startLine ?? 0);
    setChecking(false);
  };

  const handleSingleLineCheck = async (lineIndex: number) => {
    if (checking || singleCheckingLine !== null) return;
    await checkSingleLine(lineIndex, setSingleCheckingLine);
  };

  // 滚动到指定段落
  const scrollToParagraph = useCallback((index: number) => {
    const el = paragraphRefs.current[index];
    const container = proofreadContentRef.current;
    
    if (!el || !container) {
      console.log(`[ProofreadPanel] scrollToParagraph failed: el=${!!el}, container=${!!container}, index=${index}`);
      return;
    }

    console.log(`[ProofreadPanel] scrollToParagraph: index=${index}`);
    
    // 强制滚动，不检查是否在可视区域内
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  // 监听 highlightedParagraph 变化，自动滚动到对应段落
  useEffect(() => {
    if (highlightedParagraph !== null) {
      console.log(`[ProofreadPanel] highlightedParagraph changed: ${highlightedParagraph}`);
      // 使用 setTimeout 确保 DOM 已经渲染完成
      setTimeout(() => {
        scrollToParagraph(highlightedParagraph);
      }, 50);
    }
  }, [highlightedParagraph, scrollToParagraph]);

      /** 采纳单个错误：高亮旧文本 → 替换 → 高亮新文本 */
  const handleApply = useCallback(
    (paraResult: (typeof chapterResults)[number], err: ProofreadError, filteredIndex: number) => {
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
        toggleErrorApplied(chapterId, filteredIndex, err.id);  // 使用过滤后的索引
        return;
      }

      animatingRef.current = true;

      // 阶段 1：高亮旧文本（精确到错误位置）
      setApplyAnimation({
        chapterId,
        paragraphIndex: filteredIndex,  // 使用过滤后的索引，与阅读区保持一致
        phase: 'highlight-old',
        errorId: err.id,
        originalText: err.originalText,
        correctedText: err.correctedText,
        startIndex: err.startIndex,
        endIndex: err.endIndex,
      });
      setHighlightedParagraph(filteredIndex);

      setTimeout(() => {
        // 阶段 2：替换文本
        setApplyAnimation({
          chapterId,
          paragraphIndex: filteredIndex,  // 使用过滤后的索引，与阅读区保持一致
          phase: 'replacing',
          errorId: err.id,
          originalText: err.originalText,
          correctedText: err.correctedText,
          startIndex: err.startIndex,
          endIndex: err.endIndex,
        });

                const replaced = replaceParagraphText(chapterId, paraIndex, err.originalText, err.correctedText);
        toggleErrorApplied(chapterId, filteredIndex, err.id);  // 使用过滤后的索引

        if (!replaced) {
          // AI 返回的文本在段落中找不到，替换静默失败
          console.warn(`[ProofreadPanel] 文本匹配失败: "${err.originalText}" 不在段落 ${paraIndex} 中`);
        }

        setTimeout(() => {
          // 阶段 3：高亮新文本（精确到替换后的位置）
          // 替换后新文本的位置应该重新计算，因为新文本长度可能与原文本不同
          const newStartIndex = err.startIndex;
          const newEndIndex = err.startIndex + err.correctedText.length;
          
          setApplyAnimation({
            chapterId,
            paragraphIndex: filteredIndex,  // 使用过滤后的索引，与阅读区保持一致
            phase: 'highlight-new',
            errorId: err.id,
            originalText: err.originalText,
            correctedText: err.correctedText,
            startIndex: newStartIndex,
            endIndex: newEndIndex,
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
        <EmptyState icon="🔍" message="导入文件后可进行校对检测" />
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

            <div className="proofread-content" ref={proofreadContentRef}>
        {displayResults.length === 0 ? (
          <EmptyState icon="🔍" message="点击「开始检测」对当前章节进行 AI 校对" />
        ) : (
          displayResults.map((paraResult, i) => (
                        <div
              key={paraResult.paragraphIndex}
              ref={(el) => { paragraphRefs.current[i] = el; }}
              className={`proofread-paragraph ${
                highlightedParagraph === i ? 'highlighted' : ''
              }`}
              onClick={() => {
                setHighlightedParagraph(i);
                // 点击段落时自动切换起始行到该段落
                if (!checking) {
                  setStartLine(i === 0 ? null : i);
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
                    handleSingleLineCheck(i);
                  }}
                  disabled={checking || singleCheckingLine !== null || paraResult.status === 'checking'}
                  title="检测此行"
                >
                  {singleCheckingLine === i ? '检测中…' : '🔍 检测'}
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
                          handleApply(paraResult, err, i);
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
