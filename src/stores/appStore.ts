// ============================================================
// 全局应用状态（AI 配置 + 小说列表持久化到 localStorage）
// ============================================================
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Novel, Chapter, AIConfig, AIProvider, AppTab } from '../types';
import { setLoggerEnabled } from '../utils/logger';

// 剧本改编结果类型
interface ScriptResult {
  chapterId: number;
  segments: {
    chapterTitle: string;
    content: string;
    originalText: string;
  }[];
}

interface AppState {
  // 小说列表（持久化）
  novels: Novel[];
  // 当前选中的小说 ID
  currentNovelId: string | null;
  // 当前小说的章节（从 fullText 解析）
  chapters: Chapter[];
  currentChapterIndex: number;

  // AI 配置
  aiConfig: AIConfig;
  // 按提供商分别存储的 API Key
  apiKeyMap: Partial<Record<AIProvider, string>>;

  // UI
  activeTab: AppTab;
  configModalOpen: boolean;
  fontSize: number;
  theme: 'light' | 'dark';
  readingMode: boolean;
  lineSpacing: number; // 行间距（1.0-2.5）
  paragraphIndent: number; // 首行缩进（0-4字符，整数）
  paragraphSpacing: number; // 段间距（0-30px）
  readingBackground: 'white' | 'cream' | 'sepia' | 'mint' | 'sky' | 'lavender' | 'peach' | 'sage' | 'slate' | 'dark' | 'custom' | 'image'; // 阅读背景
  customTextColor: string; // 自定义文字颜色
  customBgColor: string; // 自定义背景颜色
  bgImageUrl: string; // 背景图片URL
  setReadingBackground: (background: 'white' | 'cream' | 'sepia' | 'mint' | 'sky' | 'lavender' | 'peach' | 'sage' | 'slate' | 'dark' | 'custom' | 'image') => void;
  setCustomColors: (textColor: string, bgColor: string) => void;
  setBgImageUrl: (url: string) => void;

  // 剧本改编结果缓存（按章节存储）
  scriptResults: Record<number, ScriptResult>;

  // Actions — 小说管理
  addNovel: (novel: Novel) => void;
  removeNovel: (id: string) => void;
  selectNovel: (id: string) => void;

  // Actions — 章节
  setChapters: (chapters: Chapter[]) => void;
  setCurrentChapter: (index: number) => void;
  setCurrentChapterIndex: (index: number) => void;

        // Actions — 文本替换（采纳修改），返回是否成功替换
  replaceParagraphText: (
    chapterId: number,
    paragraphIndex: number,
    oldText: string,
    newText: string,
  ) => boolean;

  // Actions — 直接替换整行（双击编辑）
  replaceLine: (
    chapterId: number,
    lineIndex: number,
    newLine: string,
  ) => void;

  // Actions — 剧本改编
  setScriptResult: (chapterId: number, segments: ScriptResult['segments']) => void;
  getScriptResult: (chapterId: number) => ScriptResult | undefined;
  clearScriptResults: () => void;

    // Actions — 其他
  clearFile: () => void;
  setAIConfig: (config: Partial<AIConfig>) => void;
  setApiKeyForProvider: (provider: AIProvider, key: string) => void;
  getApiKeyForProvider: (provider: AIProvider) => string;
  setActiveTab: (tab: AppTab) => void;
  setConfigModalOpen: (open: boolean) => void;
  setFontSize: (size: number) => void;
  setTheme: (theme: 'light' | 'dark') => void;
  setReadingMode: (enabled: boolean) => void;
  setLineSpacing: (spacing: number) => void;
  setParagraphIndent: (indent: number) => void;
  setParagraphSpacing: (spacing: number) => void;
}

const DEFAULT_AI_CONFIG: AIConfig = {
  baseURL: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  customHeaders: {},
  maxCharsPerRequest: 2000,
  enableLogging: true,
};

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      novels: [],
      currentNovelId: null,
      chapters: [],
      currentChapterIndex: 0,
            aiConfig: DEFAULT_AI_CONFIG,
      apiKeyMap: {},
      activeTab: 'proofread',
      configModalOpen: false,
      fontSize: 16,
      theme: 'dark',
      readingMode: false,
      lineSpacing: 1.8,
      paragraphIndent: 2,
      paragraphSpacing: 16,
      readingBackground: 'cream',
      customTextColor: '#333333',
      customBgColor: '#FDF6E3',
      bgImageUrl: '',
      scriptResults: {},

      addNovel: (novel) =>
        set((state) => ({
          novels: [...state.novels, novel],
          currentNovelId: novel.id,
        })),

      removeNovel: (id) =>
        set((state) => {
          const novels = state.novels.filter((n) => n.id !== id);
          return {
            novels,
            currentNovelId:
              state.currentNovelId === id ? (novels[0]?.id ?? null) : state.currentNovelId,
          };
        }),

      selectNovel: (id) => set({ currentNovelId: id }),

      setChapters: (chapters) =>
        set({ chapters, currentChapterIndex: 0 }),

      clearFile: () =>
        set({ chapters: [], currentChapterIndex: 0, scriptResults: {} }),

      // 剧本改编结果操作
      setScriptResult: (chapterId: number, segments: ScriptResult['segments']) =>
        set((state) => ({
          scriptResults: {
            ...state.scriptResults,
            [chapterId]: { chapterId, segments },
          },
        })),

      getScriptResult: (chapterId: number) => {
        const state = get();
        return state.scriptResults[chapterId];
      },

      clearScriptResults: () => set({ scriptResults: {} }),

      setCurrentChapter: (index) => set({ currentChapterIndex: index }),

      setCurrentChapterIndex: (index) => set({ currentChapterIndex: index }),

                                                replaceParagraphText: (chapterId, paragraphIndex, oldText, newText) => {
          let replaced = false;
          set((state) => {
            // 更新章节内容（分割逻辑与 splitParagraphs 保持一致）
            const chapters = state.chapters.map((ch) => {
              if (ch.id !== chapterId) return ch;

                        // 与 splitParagraphs 一致：严格按 \n 分行
              const paragraphs = ch.content.split('\n');

              if (paragraphIndex < paragraphs.length) {
                let para = paragraphs[paragraphIndex];
                const original = para;

                // 1. 精确匹配
                if (para.includes(oldText)) {
                  para = para.replace(oldText, newText);
                } else {
                  // 2. 容错匹配：去除所有空白字符后模糊查找
                  const normalize = (s: string) => s.replace(/\s+/g, '');
                  const normPara = normalize(para);
                  const normOld = normalize(oldText);

                  const fuzzyIdx = normPara.indexOf(normOld);
                  if (fuzzyIdx >= 0) {
                    // 反向定位：在原文中找到第 fuzzyIdx 个非空白字符的位置
                    let charCount = 0;
                    let realStart = -1;
                    let realEnd = -1;
                    for (let j = 0; j < para.length; j++) {
                      if (!/\s/.test(para[j])) {
                        if (charCount === fuzzyIdx) realStart = j;
                        if (charCount === fuzzyIdx + normOld.length - 1) {
                          realEnd = j + 1;
                          break;
                        }
                        charCount++;
                      }
                    }
                    if (realStart >= 0 && realEnd > realStart) {
                      para = para.slice(0, realStart) + newText + para.slice(realEnd);
                    }
                  }
                  // 3. 都找不到 → 不替换，保持原样
                }

                if (para !== original) {
                  replaced = true;
                  paragraphs[paragraphIndex] = para;
                }
                return { ...ch, content: paragraphs.join('\n') };
              }
              return ch;
            });

            // 同步更新 novels 中的 fullText
            const novelId = state.currentNovelId;
            let novels = state.novels;
            if (novelId) {
              novels = novels.map((n) => {
                if (n.id !== novelId) return n;
                // 用 chapters 重建 fullText
                const fullText = chapters.map((ch) => ch.content).join('');
                return { ...n, fullText };
              });
            }

            return { chapters, novels };
          });
          return replaced;
        },

            replaceLine: (chapterId, lineIndex, newLine) =>
        set((state) => {
          const chapters = state.chapters.map((ch) => {
            if (ch.id !== chapterId) return ch;
            const lines = ch.content.split('\n');
            if (lineIndex >= lines.length) return ch;
            lines[lineIndex] = newLine;
            return { ...ch, content: lines.join('\n') };
          });

          const novelId = state.currentNovelId;
          let novels = state.novels;
          if (novelId) {
            novels = novels.map((n) => {
              if (n.id !== novelId) return n;
              const fullText = chapters.map((ch) => ch.content).join('');
              return { ...n, fullText };
            });
          }

          return { chapters, novels };
        }),

            setAIConfig: (config) =>
        set((state) => {
          const next = { ...state.aiConfig, ...config };
          setLoggerEnabled(next.enableLogging);
          return { aiConfig: next };
        }),

      setApiKeyForProvider: (provider, key) =>
        set((state) => ({
          apiKeyMap: { ...state.apiKeyMap, [provider]: key },
        })),

      getApiKeyForProvider: (provider) => {
        return get().apiKeyMap[provider] ?? '';
      },

      setActiveTab: (tab) => set({ activeTab: tab }),

      setConfigModalOpen: (open) => set({ configModalOpen: open }),

      setFontSize: (size) => set({ fontSize: size }),

      setTheme: (theme) => set({ theme }),

      setReadingMode: (enabled) => set({ readingMode: enabled }),

      setLineSpacing: (spacing) => set({ lineSpacing: spacing }),

      setParagraphIndent: (indent) => set({ paragraphIndent: indent }),

      setParagraphSpacing: (spacing) => set({ paragraphSpacing: spacing }),

      setReadingBackground: (background) => set({ readingBackground: background }),

      setCustomColors: (textColor, bgColor) => set({ customTextColor: textColor, customBgColor: bgColor }),

      setBgImageUrl: (url) => set({ bgImageUrl: url }),
    }),
    {
      name: 'novel-proofreader-store',
      // 持久化 aiConfig、fontSize、novels、currentNovelId、theme
            partialize: (state) => ({
        aiConfig: state.aiConfig,
        apiKeyMap: state.apiKeyMap,
        fontSize: state.fontSize,
        novels: state.novels,
        currentNovelId: state.currentNovelId,
        theme: state.theme,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) setLoggerEnabled(state.aiConfig.enableLogging);
      },
    },
  ),
);
