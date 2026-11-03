import { create } from "zustand";
import { persist } from "zustand/middleware";
import { secureStorageSet, secureStorageGet, preloadSecureStorage } from "../utils/secureStorage";
import type { TTSConfig, ProofreadConfig } from "../types";
import type { PromptConfig } from "../components/config/promptConfig";

export interface ConfigState {
	ttsConfig: TTSConfig;
	promptConfig: PromptConfig;
	proofreadConfig: ProofreadConfig;
	updateTTSConfig: (patch: Partial<TTSConfig>) => void;
	setPromptConfig: (config: PromptConfig) => void;
	updateProofreadConfig: (patch: Partial<ProofreadConfig>) => void;
}

const DEFAULT_TTS_CONFIG: TTSConfig = {
	enabled: false,
	provider: "cloud",
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
	localModelPath: "",
	localMmprojPath: "",
	localBinaryPath: "",
	localSpeakerRefPath: "",
	localLanguage: "zh",
	localGpuLayers: -1,
	localEmotionEnabled: false,
	voiceDesignModelPath: "",
	voiceDesignCodecPath: "",
	voiceDesignBinaryPath: "",
	voiceDesignInstruct: "温暖自然、清晰平稳的叙述声音，语速适中，情感克制。",
	externalTtsBaseUrl: "http://127.0.0.1:5005/v1",
	externalTtsApiKey: "",
	externalTtsModel: "",
	externalTtsVoice: "长乐",
	externalTtsMaleVoice: "长乐",
	externalTtsFemaleVoice: "白芷",
	externalTtsEmotionTags: true,
	externalTtsInstructions: "",
	externalTtsLanguage: "zh",
};

const DEFAULT_PROMPT_CONFIG: PromptConfig = {
	proofread: "",
	proofreadChapter: "",
	dualProofread: "",
	script: "",
	scriptTts: "",
	novelTts: "",
	readingModeTts: "",
	readingModeTtsBatch: "",
	chapterTitle: "",
	characterReanalysis: "",
	characterAnalysis: "",
	graphLayout: "",
	worldbuilding: "",
	voiceDesign: "",
	majorEvents: "",
	majorEventsMerge: "",
	novelEvents: "",
	novelEventsMerge: "",
	continuation: "",
	bridge: "",
	characterFragmentSummarize: "",
	roleplay: "",
	roleplayMulti: "",
};

const DEFAULT_PROOFREAD_CONFIG: ProofreadConfig = {
	enableParallelProcessing: true,
	maxConcurrentBatches: 4,
	keepAwakeOnScreenOff: false,
};

const loadedTtsApiKey = secureStorageGet("tts-api-key") || "";

export const useConfigStore = create<ConfigState>()(
	persist(
		(set) => ({
			ttsConfig: { ...DEFAULT_TTS_CONFIG, apiKey: loadedTtsApiKey },
			promptConfig: DEFAULT_PROMPT_CONFIG,
			proofreadConfig: DEFAULT_PROOFREAD_CONFIG,
			updateTTSConfig: (patch) => {
				if (patch.apiKey !== undefined) {
					secureStorageSet("tts-api-key", patch.apiKey);
				}
				if (patch.externalTtsApiKey !== undefined) {
					secureStorageSet("tts-external-api-key", patch.externalTtsApiKey);
				}
				set((state) => ({ ttsConfig: { ...DEFAULT_TTS_CONFIG, ...state.ttsConfig, ...patch } }));
			},
			setPromptConfig: (config) => set({ promptConfig: config }),
			updateProofreadConfig: (patch) =>
				set((state) => ({ proofreadConfig: { ...DEFAULT_PROOFREAD_CONFIG, ...state.proofreadConfig, ...patch } })),
		}),
		{
			name: "novel-proofreader-app-config",
			// 深合并：旧版本持久化数据缺少新字段（如 provider / 本地 TTS 配置）时补齐默认值
			merge: (persisted, current) => {
				const saved = (persisted ?? {}) as Partial<ConfigState>;
				return {
					...current,
					...saved,
					ttsConfig: { ...DEFAULT_TTS_CONFIG, ...(saved.ttsConfig ?? {}) },
					promptConfig: { ...DEFAULT_PROMPT_CONFIG, ...(saved.promptConfig ?? {}) },
					proofreadConfig: { ...DEFAULT_PROOFREAD_CONFIG, ...(saved.proofreadConfig ?? {}) },
				};
			},
			partialize: (state) => ({
				ttsConfig: { ...state.ttsConfig, apiKey: "", externalTtsApiKey: "" },
				promptConfig: state.promptConfig,
				proofreadConfig: state.proofreadConfig,
			}),
			onRehydrateStorage: () => async (state) => {
				if (state) {
					await preloadSecureStorage();
					const savedKey = secureStorageGet("tts-api-key");
					if (savedKey) {
						state.ttsConfig.apiKey = savedKey;
					}
					const savedExternalKey = secureStorageGet("tts-external-api-key");
					if (savedExternalKey) {
						state.ttsConfig.externalTtsApiKey = savedExternalKey;
					}
				}
			},
		},
	),
);
