// ============================================================
// 离线段落情感分析：本地模型推理 + 规则后处理
// ============================================================
import type { ParagraphEmotionResult } from "./aiClient";
import { buildLocalParagraphEmotion, type EmotionCharacter } from "./emotionAnalysis";
import { analyzeEmotionLocal } from "./localEmotion";
import { logger } from "./logger";

/**
 * 离线分析一个段落（调用本地 RoBERTa 模型 + 引号/说话人规则）。
 * 失败时返回 null，由调用方决定是否提示。
 */
export async function analyzeParagraphLocally(
	paragraphText: string,
	context: string,
	characters: EmotionCharacter[] = [],
): Promise<ParagraphEmotionResult | null> {
	try {
		const prediction = await analyzeEmotionLocal(paragraphText, context);
		const result = buildLocalParagraphEmotion(paragraphText, prediction, characters);
		return result.segments.length > 0 ? result : null;
	} catch (err) {
		logger.tts("本地情感分析失败", err instanceof Error ? err.message : String(err));
		return null;
	}
}
