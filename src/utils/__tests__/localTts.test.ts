import { describe, it, expect, vi } from "vitest";
import type { TTSConfig } from "../../types";

vi.mock("../localTts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../localTts")>();
	return {
		...actual,
		synthesizeLocalSpeech: vi.fn(async () => new ArrayBuffer(16)),
	};
});

import { audioCache, synthesizeSpeech, synthesizeSpeechWithVoice } from "../ttsService";
import { localPlaybackRate, synthesizeExternalSpeech, synthesizeLocalSpeech } from "../localTts";
import { useWordReplacementStore } from "../../stores/wordReplacementStore";

function localConfig(overrides: Partial<TTSConfig> = {}): TTSConfig {
	return {
		enabled: true,
		provider: "local",
		localEngine: "qwen3-base",
		voice: "冰糖",
		speed: 5,
		volume: 5,
		apiKey: "",
		baseUrl: "https://api.xiaomimimo.com/v1",
		characterVoices: {},
		audioCacheEnabled: true,
		audioCachePersistent: false,
		dialect: "",
		localModelPath: "/models/Qwen3-TTS-Q8_0.gguf",
		localMmprojPath: "/models/mmproj-Qwen3-TTS-Q8_0.gguf",
		localBinaryPath: "",
		localSpeakerRefPath: "/models/ref.wav",
		localLanguage: "zh",
		localGpuLayers: -1,
		voiceDesignModelPath: "",
		voiceDesignCodecPath: "",
		voiceDesignBinaryPath: "",
		voiceDesignInstruct: "",
		externalTtsBaseUrl: "http://127.0.0.1:5005/v1",
		externalTtsApiKey: "",
		externalTtsModel: "",
		externalTtsVoice: "长乐",
		externalTtsMaleVoice: "长乐",
		externalTtsFemaleVoice: "白芷",
		externalTtsEmotionTags: true,
		externalTtsInstructions: "",
		externalTtsLanguage: "zh",
		...overrides,
	};
}

describe("本地 TTS 调用链", () => {
	it("本地模式不走云端 API，并去掉开头的表演标签", async () => {
		const config = localConfig();
		await synthesizeSpeech("(轻声)你好，世界。", config);
		expect(synthesizeLocalSpeech).toHaveBeenCalledTimes(1);
		expect(vi.mocked(synthesizeLocalSpeech).mock.calls[0][0]).toBe("你好，世界。");
	});

	it("连续多个标签也会被清理", async () => {
		const config = localConfig();
		await synthesizeSpeech("（粤语|语速3）(低声)他走了。", config);
		expect(vi.mocked(synthesizeLocalSpeech).mock.calls[0][0]).toBe("他走了。");
	});

	it("本地模式缺少 API Key 也不报错", async () => {
		const config = localConfig({ apiKey: "" });
		await expect(synthesizeSpeech("测试。", config)).resolves.toBeInstanceOf(ArrayBuffer);
	});

	it("缓存键包含本地模型与参考音频信息", () => {
		const a = audioCache.generateKey("文本", localConfig());
		const b = audioCache.generateKey("文本", localConfig({ localSpeakerRefPath: "/models/other.wav" }));
		const c = audioCache.generateKey("文本", localConfig({ localModelPath: "/models/other.gguf" }));
		expect(a).not.toBe(b);
		expect(a).not.toBe(c);
	});

	it("VoiceDesign 模式把角色音色描述传给本地合成", async () => {
		const config = localConfig({
			localEngine: "qwen3-voicedesign",
			voiceDesignModelPath: "/models/qwen3-tts-12hz-1.7b-voicedesign-f16.gguf",
			voiceDesignCodecPath: "/models/qwen3-tts-tokenizer-12hz.gguf",
			voiceDesignInstruct: "全局旁白音色",
		});
		await synthesizeSpeechWithVoice("(轻声)你来了。", config, "冰糖", "清亮活泼的少年音");
		const call = vi.mocked(synthesizeLocalSpeech).mock.calls.at(-1)!;
		expect(call[0]).toBe("你来了。");
		expect(call[3]).toBe("清亮活泼的少年音");
	});

	it("VoiceDesign 缓存键包含模型、codec 与音色描述", () => {
		const base = localConfig({
			localEngine: "qwen3-voicedesign",
			voiceDesignModelPath: "/m/talker.gguf",
			voiceDesignCodecPath: "/m/codec.gguf",
			voiceDesignInstruct: "温柔女声",
		});
		const a = audioCache.generateKey("文本", base);
		const b = audioCache.generateKey("文本", { ...base, voiceDesignInstruct: "沉稳男声" });
		const c = audioCache.generateKey("文本", { ...base, voiceDesignCodecPath: "/m/other.gguf" });
		expect(a).not.toBe(b);
		expect(a).not.toBe(c);
	});

	it("外部 OpenAI 兼容服务：URL、请求体与鉴权头正确", async () => {
		const fetchMock = vi.fn(async () =>
			new Response(new Uint8Array([0x52, 0x49, 0x46, 0x46]), {
				status: 200,
				headers: { "content-type": "audio/wav" },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
		try {
			const config = localConfig({
				provider: "external",
				externalTtsBaseUrl: "http://127.0.0.1:5005/v1/",
				externalTtsApiKey: "secret",
				externalTtsModel: "local-model",
				externalTtsVoice: "自定义音色",
				externalTtsInstructions: "温柔一些",
				externalTtsLanguage: "zh",
			});
			const buffer = await synthesizeExternalSpeech("你好。", config);
			expect(buffer.byteLength).toBe(4);
			const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
			expect(url).toBe("http://127.0.0.1:5005/v1/audio/speech");
			const body = JSON.parse(String(init.body));
			expect(body.input).toBe("你好。");
			expect(body.model).toBe("local-model");
			expect(body.voice).toBe("自定义音色");
			expect(body.instructions).toBe("温柔一些");
			expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret");
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("外部模式也走标签清理并复用外部合成", async () => {
		const fetchMock = vi.fn(async () =>
			new Response(new Uint8Array([0x52, 0x49, 0x46, 0x46]), {
				status: 200,
				headers: { "content-type": "audio/wav" },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
		try {
			const config = localConfig({ provider: "external", externalTtsBaseUrl: "http://127.0.0.1:5005/v1" });
			await synthesizeSpeech("(轻声)你好。", config);
			const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
			expect(body.input).toBe("你好。");
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("直接调用外部服务时也会执行敏感词替换", async () => {
		useWordReplacementStore.setState({
			replacements: [{ id: "r1", original: "敏感", replacement: "温和" }],
		});
		const fetchMock = vi.fn(async () =>
			new Response(new Uint8Array([0x52, 0x49, 0x46, 0x46]), {
				status: 200,
				headers: { "content-type": "audio/wav" },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
		try {
			const config = localConfig({ provider: "external", externalTtsBaseUrl: "http://127.0.0.1:5005/v1" });
			await synthesizeExternalSpeech("这是敏感内容", config, undefined, "敏感的音色描述");
			const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
			expect(body.input).toBe("这是温和内容");
			expect(body.instructions).toBe("温和的音色描述");
		} finally {
			vi.unstubAllGlobals();
			useWordReplacementStore.setState({ replacements: [] });
		}
	});

	it("替换规则变化会使音频缓存键失效", () => {
		const config = localConfig({ provider: "external" });
		useWordReplacementStore.setState({ replacements: [] });
		const before = audioCache.generateKey("文本", config);
		useWordReplacementStore.setState({
			replacements: [{ id: "r2", original: "文本", replacement: "内容" }],
		});
		const after = audioCache.generateKey("文本", config);
		expect(after).not.toBe(before);
		useWordReplacementStore.setState({ replacements: [] });
	});

	it("外部服务错误会带出 HTTP 详情", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => new Response("bad request", { status: 400 })));
		try {
			const config = localConfig({ provider: "external" });
			await expect(synthesizeExternalSpeech("你好", config)).rejects.toThrow(/HTTP 400/);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("情感标签在开启时透传，关闭时被移除", async () => {
		const fetchMock = vi.fn(async () =>
			new Response(new Uint8Array([0x52, 0x49, 0x46, 0x46]), {
				status: 200,
				headers: { "content-type": "audio/wav" },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
		try {
			const base = localConfig({ provider: "external", externalTtsEmotionTags: true });
			await synthesizeExternalSpeech("哈哈<laugh>真好笑。", base);
			let body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
			expect(body.input).toContain("<laugh>");

			const noTags = localConfig({ provider: "external", externalTtsEmotionTags: false });
			await synthesizeExternalSpeech("哈哈<laugh>真好笑。", noTags);
			body = JSON.parse(String((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body));
			expect(body.input).not.toContain("<laugh>");
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("括号情绪提示会转换为情感标签", async () => {
		const fetchMock = vi.fn(async () =>
			new Response(new Uint8Array([0x52, 0x49, 0x46, 0x46]), {
				status: 200,
				headers: { "content-type": "audio/wav" },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
		try {
			const config = localConfig({ provider: "external", externalTtsEmotionTags: true });
			await synthesizeExternalSpeech("他[叹气]说（轻笑）算了。", config);
			const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
			expect(body.input).toBe("他<sigh>说<chuckle>算了。");
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("外部服务使用角色传入的 voice", async () => {
		const fetchMock = vi.fn(async () =>
			new Response(new Uint8Array([0x52, 0x49, 0x46, 0x46]), {
				status: 200,
				headers: { "content-type": "audio/wav" },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
		try {
			const config = localConfig({ provider: "external" });
			await synthesizeExternalSpeech("你好", config, undefined, undefined, { voice: "白芷" });
			const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
			expect(body.voice).toBe("白芷");
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("语速映射为合理的播放倍率", () => {
		expect(localPlaybackRate(5)).toBe(1);
		expect(localPlaybackRate(1)).toBeLessThan(1);
		expect(localPlaybackRate(10)).toBeGreaterThan(1);
		expect(localPlaybackRate(10)).toBeLessThanOrEqual(1.6);
	});
});
