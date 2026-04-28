// ============================================================
// 校对结果状态
// ============================================================
import { create } from 'zustand';
import type { ParagraphResult, ProofreadError, ScriptTask } from '../types';

/** 采纳动画阶段 */
export interface ApplyAnimation {
  chapterId: number;
  paragraphIndex: number;
  phase: 'highlight-old' | 'replacing' | 'highlight-new';
  errorId?: string;
  originalText?: string;
  correctedText?: string;
  startIndex?: number;
  endIndex?: number;
}

interface ProofreadState {
  // 每个章节的段落检测结果，key = chapterId
  results: Record<number, ParagraphResult[]>;
  // 当前高亮的段落索引
  highlightedParagraph: number | null;
  // 校对起始行（从 0 开始），null 表示从头开始
  startLine: number | null;
  // 采纳动画
  applyAnimation: ApplyAnimation | null;
  // 剧本转换任务
  scriptTasks: ScriptTask[];
  // 剧本转换进度
  scriptRunning: boolean;

  // Actions
  setResults: (chapterId: number, results: ParagraphResult[]) => void;
  updateParagraphResult: (chapterId: number, paragraphIndex: number, result: Partial<ParagraphResult>) => void;
  toggleErrorApplied: (chapterId: number, paragraphIndex: number, errorId: string) => void;
  clearResults: (chapterId: number) => void;
  clearAllResults: () => void;
  setHighlightedParagraph: (index: number | null) => void;
  setStartLine: (line: number | null) => void;
  setApplyAnimation: (anim: ApplyAnimation | null) => void;

  // Script actions
  addScriptTask: (task: ScriptTask) => void;
  updateScriptTask: (taskId: number, update: Partial<ScriptTask>) => void;
  clearScriptTasks: () => void;
  setScriptRunning: (running: boolean) => void;
}

export const useProofreadStore = create<ProofreadState>((set) => ({
    results: {},
  highlightedParagraph: null,
  startLine: null,
  applyAnimation: null,
  scriptTasks: [],
  scriptRunning: false,

  setResults: (chapterId, results) =>
    set((state) => ({
      results: { ...state.results, [chapterId]: results },
    })),

  updateParagraphResult: (chapterId, paragraphIndex, result) =>
    set((state) => {
      const chapterResults = state.results[chapterId] ?? [];
      const updated = [...chapterResults];
      if (updated[paragraphIndex]) {
        updated[paragraphIndex] = { ...updated[paragraphIndex], ...result };
      }
      return { results: { ...state.results, [chapterId]: updated } };
    }),

  toggleErrorApplied: (chapterId, paragraphIndex, errorId) =>
    set((state) => {
      const chapterResults = state.results[chapterId] ?? [];
      const updated = [...chapterResults];
      const para = updated[paragraphIndex];
      if (para) {
        updated[paragraphIndex] = {
          ...para,
          errors: para.errors.map((e: ProofreadError) =>
            e.id === errorId ? { ...e, applied: !e.applied } : e,
          ),
        };
      }
      return { results: { ...state.results, [chapterId]: updated } };
    }),

  clearResults: (chapterId) =>
    set((state) => {
      const newResults = { ...state.results };
      delete newResults[chapterId];
      return { results: newResults };
    }),

  clearAllResults: () => set({ results: {} }),

    setHighlightedParagraph: (index) => set({ highlightedParagraph: index }),

  setStartLine: (line) => set({ startLine: line }),

  setApplyAnimation: (anim) => set({ applyAnimation: anim }),

  addScriptTask: (task) =>
    set((state) => ({ scriptTasks: [...state.scriptTasks, task] })),

  updateScriptTask: (taskId, update) =>
    set((state) => ({
      scriptTasks: state.scriptTasks.map((t) =>
        t.id === taskId ? { ...t, ...update } : t,
      ),
    })),

  clearScriptTasks: () => set({ scriptTasks: [] }),

  setScriptRunning: (running) => set({ scriptRunning: running }),
}));
