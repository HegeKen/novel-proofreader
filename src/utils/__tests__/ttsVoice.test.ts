import { describe, it, expect } from "vitest";
import type { TTSConfig } from "../../types";
import { externalVoiceForGender } from "../ttsVoice";

function config(overrides: Partial<TTSConfig> = {}): TTSConfig {
	return {
		enabled: true, provider: "external", localEngine: "qwen3-base", voice: "冰糖", speed: 5, volume: 5,
		apiKey: "", baseUrl: "", characterVoices: {}, audioCacheEnabled: false, audioCachePersistent: false,
		dialect: "", localModelPath: "", localMmprojPath: "", localBinaryPath: "", localSpeakerRefPath: "",
		localLanguage: "zh", localGpuLayers: -1, voiceDesignModelPath: "", voiceDesignCodecPath: "",
		voiceDesignBinaryPath: "", voiceDesignInstruct: "", externalTtsBaseUrl: "http://127.0.0.1:5005/v1",
		externalTtsApiKey: "", externalTtsModel: "", externalTtsVoice: "长乐", externalTtsMaleVoice: "长乐",
		externalTtsFemaleVoice: "白芷", externalTtsEmotionTags: true, externalTtsInstructions: "",
		externalTtsLanguage: "zh", ...overrides,
	};
}

describe("外部 TTS 音色分配", () => {
	it("男性角色使用长乐", () => {
		expect(externalVoiceForGender(config(), "male")).toBe("长乐");
	});
	it("女性角色使用白芷", () => {
		expect(externalVoiceForGender(config(), "female")).toBe("白芷");
	});
	it("未知性别使用默认/旁白音色", () => {
		expect(externalVoiceForGender(config(), "other")).toBe("长乐");
		expect(externalVoiceForGender(config({ externalTtsVoice: "旁白音" }), undefined)).toBe("旁白音");
	});
	it("支持自定义男女音色", () => {
		const c = config({ externalTtsMaleVoice: "男声A", externalTtsFemaleVoice: "女声B" });
		expect(externalVoiceForGender(c, "male")).toBe("男声A");
		expect(externalVoiceForGender(c, "female")).toBe("女声B");
	});
});
