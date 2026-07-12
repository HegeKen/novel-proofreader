import { create } from "zustand";
import { persist } from "zustand/middleware";
import { secureStorageSet, secureStorageGet } from "../utils/secureStorage";


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

export interface PromptConfig {
	proofread: string;
	proofreadChapter: string;
	script: string;
	scriptTts: string;
	novelTts: string;
	readingModeTts: string;
	chapterTitle: string;
	characterReanalysis: string;
	characterAnalysis: string;
	worldbuilding: string;
	voiceDesign: string;
	majorEvents: string;
	majorEventsMerge: string;
	novelEvents: string;
}

export interface ProofreadConfig {
	enableParallelProcessing: boolean;
	maxConcurrentBatches: number;
}

export interface ConfigState {
	ttsConfig: TTSConfig;
	promptConfig: PromptConfig;
	proofreadConfig: ProofreadConfig;
	setTTSConfig: (config: TTSConfig) => void;
	updateTTSConfig: (patch: Partial<TTSConfig>) => void;
	setTTSApiKey: (apiKey: string) => void;
	setPromptConfig: (config: PromptConfig) => void;
	updatePromptConfig: (patch: Partial<PromptConfig>) => void;
	setProofreadConfig: (config: ProofreadConfig) => void;
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
			setTTSConfig: (config) => {
				if (config.apiKey) {
					secureStorageSet("tts-api-key", config.apiKey);
				}
				set({ ttsConfig: { ...DEFAULT_TTS_CONFIG, ...config } });
			},
			updateTTSConfig: (patch) => {
				if (patch.apiKey) {
					secureStorageSet("tts-api-key", patch.apiKey);
				}
				set((state) => ({ ttsConfig: { ...DEFAULT_TTS_CONFIG, ...state.ttsConfig, ...patch } }));
			},
			setTTSApiKey: (apiKey) => {
				secureStorageSet("tts-api-key", apiKey);
				set((state) => ({ ttsConfig: { ...state.ttsConfig, apiKey } }));
			},
			setPromptConfig: (config) => set({ promptConfig: config }),
			updatePromptConfig: (patch) =>
				set((state) => ({ promptConfig: { ...state.promptConfig, ...patch } })),
			setProofreadConfig: (config) => set({ proofreadConfig: { ...DEFAULT_PROOFREAD_CONFIG, ...config } }),
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
		},
	),
);
