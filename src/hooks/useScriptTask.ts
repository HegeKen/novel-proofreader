// ============================================================
// 循环任务转剧本 Hook
// ============================================================
import { useCallback, useRef } from 'react';
import { useAppStore } from '../stores/appStore';
import { useProofreadStore } from '../stores/proofreadStore';
import {
  sendChatCompletion,
  SCRIPT_SYSTEM_PROMPT,
  buildScriptUserPrompt,
} from '../utils/aiClient';
import type { ScriptTask } from '../types';

export function useScriptTask() {
  const aiConfig = useAppStore((s) => s.aiConfig);
  const chapters = useAppStore((s) => s.chapters);
  const addScriptTask = useProofreadStore((s) => s.addScriptTask);
  const updateScriptTask = useProofreadStore((s) => s.updateScriptTask);
  const setScriptRunning = useProofreadStore((s) => s.setScriptRunning);
  const abortRef = useRef<AbortController | null>(null);

  const convertChapter = useCallback(
    async (chapterIndex: number) => {
      const chapter = chapters[chapterIndex];
      if (!chapter) return;

      const task: ScriptTask = {
        id: Date.now(),
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        status: 'running',
      };
      addScriptTask(task);

      try {
        const messages = [
          { role: 'system' as const, content: SCRIPT_SYSTEM_PROMPT },
          { role: 'user' as const, content: buildScriptUserPrompt(chapter.content) },
        ];
        const reply = await sendChatCompletion(messages, aiConfig, abortRef.current?.signal);
        updateScriptTask(task.id, { status: 'done', result: reply });
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const msg = err instanceof Error ? err.message : String(err);
        updateScriptTask(task.id, { status: 'error', errorMessage: msg });
      }
    },
    [chapters, aiConfig, addScriptTask, updateScriptTask],
  );

  const convertRange = useCallback(
    async (startIdx: number, endIdx: number, delayMs = 2000) => {
      setScriptRunning(true);
      const controller = new AbortController();
      abortRef.current = controller;

      for (let i = startIdx; i <= endIdx && i < chapters.length; i++) {
        if (controller.signal.aborted) break;
        await convertChapter(i);
        if (i < endIdx && delayMs > 0) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }

      setScriptRunning(false);
    },
    [chapters, convertChapter, setScriptRunning],
  );

  const cancelConversion = useCallback(() => {
    abortRef.current?.abort();
    setScriptRunning(false);
  }, [setScriptRunning]);

  return { convertChapter, convertRange, cancelConversion };
}
