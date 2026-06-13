import { create } from "zustand";
import { persist } from "zustand/middleware";


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
};

const DEFAULT_PROOFREAD_CONFIG: ProofreadConfig = {
	enableParallelProcessing: true,
	maxConcurrentBatches: 4,
};

export const useConfigStore = create<ConfigState>()(
	persist(
		(set) => ({
			ttsConfig: DEFAULT_TTS_CONFIG,
			promptConfig: DEFAULT_PROMPT_CONFIG,
			proofreadConfig: DEFAULT_PROOFREAD_CONFIG,
			setTTSConfig: (config) => set({ ttsConfig: { ...DEFAULT_TTS_CONFIG, ...config } }),
			updateTTSConfig: (patch) =>
				set((state) => ({ ttsConfig: { ...DEFAULT_TTS_CONFIG, ...state.ttsConfig, ...patch } })),
			setPromptConfig: (config) => set({ promptConfig: config }),
			updatePromptConfig: (patch) =>
				set((state) => ({ promptConfig: { ...state.promptConfig, ...patch } })),
			setProofreadConfig: (config) => set({ proofreadConfig: { ...DEFAULT_PROOFREAD_CONFIG, ...config } }),
			updateProofreadConfig: (patch) =>
				set((state) => ({ proofreadConfig: { ...DEFAULT_PROOFREAD_CONFIG, ...state.proofreadConfig, ...patch } })),
		}),
		{
			name: "novel-proofreader-app-config",
		},
	),
);
