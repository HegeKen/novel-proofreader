// ============================================================
// TTS 音色选择工具
// ============================================================
import type { TTSConfig } from "../types";

/**
 * 外部 OpenAI 兼容服务按性别选择音色。
 * 未匹配到性别时使用默认/旁白音色。
 */
export function externalVoiceForGender(
	config: TTSConfig,
	gender?: "male" | "female" | "other" | null,
): string {
	if (gender === "male") {
		return config.externalTtsMaleVoice.trim() || "长乐";
	}
	if (gender === "female") {
		return config.externalTtsFemaleVoice.trim() || "白芷";
	}
	return config.externalTtsVoice.trim() || config.externalTtsMaleVoice.trim() || "长乐";
}
