// ============================================================
// 剧本改编面板
// ============================================================
import { useState, useEffect } from 'react';
import { useAppStore } from '../stores/appStore';
import {
  sendChatCompletion,
  buildScriptUserPrompt,
} from '../utils/aiClient';
import { splitParagraphs } from '../utils/chapterSplit';
import type { ChatMessage } from '../utils/aiClient';

interface ScriptSegment {
  chapterTitle: string;
  content: string;
  originalText: string;
}

type ConvertGranularity = 'paragraph' | 'line' | 'chapter';

const DEFAULT_PROMPT = "你是一位专业的编剧。请将以下小说片段改编为剧本格式：\n\n1. 为每个场景标注【场景】（室内/室外、时间、地点）\n2. 角色对白使用「角色名：对白内容」格式\n3. 动作和神态用括号标注为舞台指示\n4. 保留原文核心情节和冲突，精简环境描写\n5. 如有旁白需要，用【旁白】标注\n\n请直接输出剧本内容，不要额外解释。";

export function TaskPanel() {
    const chapters = useAppStore((s) => s.chapters);
  const currentChapterIndex = useAppStore((s) => s.currentChapterIndex);
  const aiConfig = useAppStore((s) => s.aiConfig);
  const setScriptResult = useAppStore((s) => s.setScriptResult);
  const getScriptResult = useAppStore((s) => s.getScriptResult);

  const [prompt, setPrompt] = useState('');
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [result, setResult] = useState<ScriptSegment[]>([]);
  const [error, setError] = useState('');
  
  // 添加转换粒度选择
  const [granularity, setGranularity] = useState<ConvertGranularity>('paragraph');
  const [startLine, setStartLine] = useState<number | null>(null);

  const chapter = chapters[currentChapterIndex];
  const totalLines = chapter ? chapter.content.split('\n').length : 0;

  // 章节切换时，加载缓存的剧本改编结果
  useEffect(() => {
    if (!chapter) return;
    const cached = getScriptResult(chapter.id);
    if (cached) {
      setResult(cached.segments);
    } else {
      setResult([]);
    }
  }, [chapter?.id, getScriptResult]);

  const handleGenerate = async () => {
    if (!chapter) return;

    const effectivePrompt = prompt.trim() || DEFAULT_PROMPT;
        if (!aiConfig.apiKey) {
      setError('请先在设置中配置 API Key');
      return;
    }

    setProcessing(true);
    setError('');
    setResult([]);

    let paragraphs: string[];
    let totalCount: number;

    // 根据粒度选择处理文本
    switch (granularity) {
      case 'chapter':
        // 整章作为一个段落处理
        paragraphs = [chapter.content.trim()];
        totalCount = 1;
        break;
      case 'line':
        // 按行处理，支持起始行选择
        const allLines = splitParagraphs(chapter.content);
        const startIdx = startLine ?? 0;
        paragraphs = allLines.slice(startIdx).filter(p => p.trim().length > 0);
        totalCount = paragraphs.length;
        break;
      default: // paragraph
        // 按段落处理，支持起始行选择
        const allParagraphs = splitParagraphs(chapter.content).filter(p => p.trim().length > 0);
        if (startLine !== null && startLine < allParagraphs.length) {
          paragraphs = allParagraphs.slice(startLine);
        } else {
          paragraphs = allParagraphs;
        }
        totalCount = paragraphs.length;
        break;
    }
    
    if (paragraphs.length === 0) {
      setError('当前选择范围内没有可转换的内容');
      setProcessing(false);
      return;
    }
    
    setProgress({ current: 0, total: totalCount });

    const segments: ScriptSegment[] = [];

    try {
                    const scriptAiConfig = {
        baseURL: aiConfig.baseURL,
        apiKey: aiConfig.apiKey,
        model: aiConfig.model,
        customHeaders: {},
        maxCharsPerRequest: 4000,
        enableLogging: aiConfig.enableLogging,
      };

      for (let i = 0; i < paragraphs.length; i++) {
        setProgress({ current: i + 1, total: totalCount });

        const systemPrompt = effectivePrompt;
        const paragraphText = paragraphs[i];

        // 确保段落有足够的内容
        if (!paragraphText || paragraphText.trim().length === 0) {
          continue;
        }

        const messages: ChatMessage[] = [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: buildScriptUserPrompt(paragraphText) },
        ];

                const segmentContent = await sendChatCompletion(messages, scriptAiConfig);

        // 根据粒度设置不同的标题
        let segmentTitle: string;
        switch (granularity) {
          case 'chapter':
            segmentTitle = chapter.title;
            break;
          case 'line':
            const lineNum = (startLine ?? 0) + i + 1;
            segmentTitle = `${chapter.title} - 第 ${lineNum} 行`;
            break;
          default:
            const paraNum = (startLine ?? 0) + i + 1;
            segmentTitle = `${chapter.title} - 段落 ${paraNum}`;
            break;
        }

        segments.push({
          chapterTitle: segmentTitle,
          content: segmentContent,
          originalText: paragraphText,
        });
      }

      setResult(segments);
        // 保存到全局状态，以便切换栏目后不会丢失
        setScriptResult(chapter.id, segments);
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成失败');
    } finally {
      setProcessing(false);
    }
  };

  const handleExport = () => {
    if (result.length === 0) return;

    const fullScript = result
      .map((s) => `// ${s.chapterTitle}\n\n${s.content}`)
      .join('\n\n' + '='.repeat(60) + '\n\n');

    const blob = new Blob([fullScript], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${chapter?.title ?? '剧本'}_改编.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!chapter) {
    return (
      <div className="task-panel empty">
        <div className="empty-hint">
          <span className="empty-icon">🎬</span>
          <p>导入文件后可使用剧本改编功能</p>
        </div>
      </div>
    );
  }

  return (
    <div className="task-panel">
      <div className="task-header">
        <h3>🎬 剧本改编</h3>
        <span className="task-chapter">{chapter.title}</span>
      </div>

      {/* 工具栏 */}
      <div className="task-toolbar">
        <div className="toolbar-left">
          <label className="granularity-select">
            转换粒度：
            <select
              value={granularity}
              onChange={(e) => setGranularity(e.target.value as ConvertGranularity)}
              disabled={processing}
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
                disabled={processing}
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
          {processing ? (
            <button className="btn-cancel" onClick={() => setProcessing(false)}>
              取消转换
            </button>
          ) : (
            <button className="btn-check" onClick={handleGenerate}>
              🚀 开始转换
            </button>
          )}
        </div>
      </div>

      <div className="task-input-area">
        <textarea
          className="task-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={DEFAULT_PROMPT}
          rows={3}
          disabled={processing}
        />
        {processing && (
          <div className="task-progress-bar">
            <span className="task-progress">
              进度：{progress.current}/{progress.total}
            </span>
            <div className="progress-bar">
              <div 
                className="progress-fill" 
                style={{ width: `${(progress.current / progress.total) * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {error && <div className="task-error">❌ {error}</div>}

      {/* 结果区域 */}
      <div className="task-result-wrapper">
        {result.length > 0 ? (
          <>
            <div className="result-content">
              <div className="result-summary">
                <span className="summary-count">共 {result.length} 段内容</span>
              </div>
              {result.map((seg, i) => (
                <div key={i} className="result-segment">
                  <div className="segment-header">
                    <span className="segment-index">📝 段落 {i + 1}</span>
                    <span className="segment-title">{seg.chapterTitle}</span>
                  </div>
                  <div className="segment-content">
                    {seg.content}
                  </div>
                </div>
              ))}
            </div>
            {/* 右下角固定保存按钮 */}
            <div className="task-export-bar">
              <button className="btn-export-primary" onClick={handleExport}>
                💾 导出剧本
              </button>
            </div>
          </>
        ) : (
          <div className="result-empty">
            <span className="empty-icon">📄</span>
            <p>点击「开始转换」按钮，将当前章节内容转换为剧本格式</p>
          </div>
        )}
      </div>
    </div>
  );
}
