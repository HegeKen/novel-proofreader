// 直接调用本地合成入口时，也必须执行敏感词替换
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TTSConfig } from "../../types";

vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(async (command: string) => {
		if (command.endsWith("start_server")) {
			return { port: 12345, model_path: "m", mmproj_path: "p", codec_path: "c", binary_path: "b", started_secs: 0 };
		}
		if (command === "tts_local_synthesize" || command === "tts_external_synthesize") {
			return btoa("RIFFtest");
		}
		return null;
	}),
}));

import { invoke } from "@tauri-apps/api/core";
import { synthesizeExternalSpeech, synthesizeLocalSpeech } from "../localTts";
import { useWordReplacementStore } from "../../stores/wordReplacementStore";

const config: TTSConfig = {
	enabled: true,
	provider: "local",
	localEngine: "qwen3-base",
	voice: "冰糖",
	speed: 5,
	volume: 5,
	apiKey: "",
	baseUrl: "",
	characterVoices: {},
	audioCacheEnabled: false,
	audioCachePersistent: false,
	dialect: "",
	localModelPath: "/m/model.gguf",
	localMmprojPath: "/m/mmproj.gguf",
	localBinaryPath: "/usr/bin/llama-server",
	localSpeakerRefPath: "",
	localLanguage: "zh",
	localGpuLayers: -1,
	voiceDesignModelPath: "",
	voiceDesignCodecPath: "",
	voiceDesignBinaryPath: "",
	voiceDesignInstruct: "",
	externalTtsBaseUrl: "",
	externalTtsApiKey: "",
	externalTtsModel: "",
	externalTtsVoice: "长乐",
	externalTtsMaleVoice: "长乐",
	externalTtsFemaleVoice: "白芷",
	externalTtsEmotionTags: true,
	externalTtsInstructions: "",
	externalTtsLanguage: "zh",
};

beforeEach(() => {
	(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
	useWordReplacementStore.setState({
		replacements: [{ id: "r1", original: "敏感", replacement: "温和" }],
	});
});

afterEach(() => {
	delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
	useWordReplacementStore.setState({ replacements: [] });
	vi.mocked(invoke).mockClear();
});

describe("本地 TTS 直接调用", () => {
	it("synthesizeLocalSpeech 会先执行敏感词替换", async () => {
		await synthesizeLocalSpeech("这是敏感内容。", config);
		const synthCall = vi.mocked(invoke).mock.calls.find(([cmd]) => cmd === "tts_local_synthesize");
		expect(synthCall).toBeTruthy();
		expect((synthCall![1] as { input: string }).input).toBe("这是温和内容。");
	});

	it("外部服务在 Tauri 环境走 Rust 代理", async () => {
		await synthesizeExternalSpeech(
			"这是敏感内容。",
			{
				...config,
				provider: "external",
				externalTtsBaseUrl: "http://127.0.0.1:5005/v1",
				externalTtsApiKey: "k",
			},
		);
		const call = vi.mocked(invoke).mock.calls.find(([cmd]) => cmd === "tts_external_synthesize");
		expect(call).toBeTruthy();
		expect((call![1] as { url: string }).url).toBe("http://127.0.0.1:5005/v1/audio/speech");
		expect((call![1] as { apiKey: string }).apiKey).toBe("k");
		expect((call![1] as { body: { input: string } }).body.input).toBe("这是温和内容。");
	});

	it("VoiceDesign 音色描述也会执行敏感词替换", async () => {
		await synthesizeLocalSpeech("正文", { ...config, localEngine: "qwen3-voicedesign" }, undefined, "敏感的声音");
		const synthCall = vi.mocked(invoke).mock.calls.find(([cmd]) => cmd === "tts_voice_design_synthesize");
		expect(synthCall).toBeTruthy();
		expect((synthCall![1] as { instructions: string }).instructions).toBe("温和的声音");
	});

	it("VoiceDesign 优先使用角色卡传入的描述", async () => {
		await synthesizeLocalSpeech(
			"正文",
			{ ...config, localEngine: "qwen3-voicedesign", voiceDesignInstruct: "全局旁白音色" },
			undefined,
			"清亮活泼的少年音",
		);
		const synthCall = vi.mocked(invoke).mock.calls.find(([cmd]) => cmd === "tts_voice_design_synthesize");
		expect(synthCall).toBeTruthy();
		expect((synthCall![1] as { instructions: string }).instructions).toBe("清亮活泼的少年音");
	});
});
