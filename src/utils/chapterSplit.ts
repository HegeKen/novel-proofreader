// ============================================================
// 章节识别与分割
// ============================================================
import type { Chapter } from '../types';

/** 常见章节标题正则（捕获组包含序号 + 章节名） */
const CHAPTER_PATTERNS = [
  // 中文章节：第X章 + 可选章节名
  /(?:^|\n)\s*(第[一二三四五六七八九十百千万零\d]+[章回节卷部篇](?:\s*[^\n]*)?)/g,
  // 序章/序言/前言/引子/楔子 + 可选章节名
  /(?:^|\n)\s*(序章|序言|前言|引子|楔子|尾声|后记|番外|结局(?:\s*[^\n]*)?)/g,
  // 英文章节
  /(?:^|\n)\s*(Chapter\s+\d+[^\n]*)/gi,
  /(?:^|\n)\s*(PROLOGUE|EPILOGUE|AFTERWORD[^\n]*)/gi,
];

/** 按字符数强制分割的阈值 */
const DEFAULT_CHUNK_SIZE = 5000;

/**
 * 从全文中识别章节并分割
 */
export function splitChapters(fullText: string, chunkSize = DEFAULT_CHUNK_SIZE): Chapter[] {
  // 收集所有匹配到的章节标题及其位置
  const matches: { title: string; index: number }[] = [];

  for (const pattern of CHAPTER_PATTERNS) {
    // 每次使用前重置 lastIndex（因为 /g flag）
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(fullText)) !== null) {
      matches.push({
        title: m[1].trim(),
        index: m.index,
      });
    }
  }

  // 去重（同一位置可能被多个正则匹配）并按位置排序
  const unique = new Map<number, string>();
  for (const m of matches) {
    if (!unique.has(m.index)) {
      unique.set(m.index, m.title);
    }
  }
  const sorted = Array.from(unique.entries())
    .sort((a, b) => a[0] - b[0]);

  // 如果没有匹配到任何章节，按 chunkSize 强制分割
  if (sorted.length === 0) {
    const chapters: Chapter[] = [];
    let start = 0;
    let id = 1;
    while (start < fullText.length) {
      const end = Math.min(start + chunkSize, fullText.length);
      chapters.push({
        id,
        title: `第 ${id} 段`,
        startIndex: start,
        endIndex: end,
        content: fullText.slice(start, end),
      });
      start = end;
      id++;
    }
    return chapters;
  }

  // 构建章节列表
  const chapters: Chapter[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const [startIdx, title] = sorted[i];
    const endIdx = i + 1 < sorted.length ? sorted[i + 1][0] : fullText.length;
    chapters.push({
      id: i + 1,
      title,
      startIndex: startIdx,
      endIndex: endIdx,
      content: fullText.slice(startIdx, endIdx),
    });
  }

  // 如果第一个章节之前还有内容，作为"前言"
  if (sorted[0][0] > 0) {
    const preamble = fullText.slice(0, sorted[0][0]).trim();
    if (preamble.length > 0) {
      chapters.unshift({
        id: 0,
        title: '前言',
        startIndex: 0,
        endIndex: sorted[0][0],
        content: preamble,
      });
      // 重新编号
      chapters.forEach((ch, idx) => (ch.id = idx));
    }
  }

  return chapters;
}

/**
 * 将章节内容按原始换行严格分行（保留空行）
 */
export function splitParagraphs(text: string): string[] {
  return text.split('\n');
}

/**
 * 将文本按最大字符数分块（用于 AI 请求）
 */
export function splitTextChunks(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  const paragraphs = splitParagraphs(text);
  let current = '';

  for (const para of paragraphs) {
    if (current.length + para.length + 2 > maxChars) {
      if (current.length > 0) chunks.push(current);
      // 如果单个段落就超过 maxChars，强制按字符截断
      if (para.length > maxChars) {
        let offset = 0;
        while (offset < para.length) {
          chunks.push(para.slice(offset, offset + maxChars));
          offset += maxChars;
        }
        current = '';
      } else {
        current = para;
      }
    } else {
      current = current.length > 0 ? current + '\n\n' + para : para;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
