import { create } from "zustand";
import { persist } from "zustand/middleware";
import { secureStorageSet, secureStorageGet, preloadSecureStorage } from "../utils/secureStorage";
import type { PromptConfig } from "../components/config/promptConfig";


export interface TTSConfig {
	enabled: boolean;
	voice: string;
	speed: number;
	volume: number;
	apiKey: string;
	baseUrl: string;
	characterVoices: Record<string, string>;
	audioCacheEnabled: boolean;
	audioCachePersistent: boolean;
	dialect: string;
}

export interface ProofreadConfig {
	enableParallelProcessing: boolean;
	maxConcurrentBatches: number;
}

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
	voice: "冰糖",
	speed: 5,
	volume: 5,
	apiKey: "",
	baseUrl: "https://api.xiaomimimo.com/v1",
	characterVoices: {},
	audioCacheEnabled: true,
	audioCachePersistent: false,
	dialect: "",
};

const DEFAULT_PROMPT_CONFIG: PromptConfig = {
	proofread: "",
	proofreadChapter: "",
	script: "",
	scriptTts: "",
	novelTts: "",
	readingModeTts: "",
	chapterTitle: "",
	characterReanalysis: "",
	characterAnalysis: "",
	worldbuilding: "",
	voiceDesign: "",
	majorEvents: "",
	majorEventsMerge: "",
	novelEvents: "",
};

const DEFAULT_PROOFREAD_CONFIG: ProofreadConfig = {
	enableParallelProcessing: true,
	maxConcurrentBatches: 4,
};

const loadedTtsApiKey = secureStorageGet("tts-api-key") || "";

export const useConfigStore = create<ConfigState>()(
	persist(
		(set) => ({
			ttsConfig: { ...DEFAULT_TTS_CONFIG, apiKey: loadedTtsApiKey },
			promptConfig: DEFAULT_PROMPT_CONFIG,
			proofreadConfig: DEFAULT_PROOFREAD_CONFIG,
			updateTTSConfig: (patch) => {
				if (patch.apiKey) {
					secureStorageSet("tts-api-key", patch.apiKey);
				}
				set((state) => ({ ttsConfig: { ...DEFAULT_TTS_CONFIG, ...state.ttsConfig, ...patch } }));
			},
			setPromptConfig: (config) => set({ promptConfig: config }),
			updateProofreadConfig: (patch) =>
				set((state) => ({ proofreadConfig: { ...DEFAULT_PROOFREAD_CONFIG, ...state.proofreadConfig, ...patch } })),
		}),
		{
			name: "novel-proofreader-app-config",
			partialize: (state) => ({
				ttsConfig: { ...state.ttsConfig, apiKey: "" },
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
				}
			},
		},
	),
);
