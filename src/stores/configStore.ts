// ============================================================
// AI 模型配置状态（独立 store，持久化到 localStorage）
// ============================================================
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AIProvider } from "../types";

export interface AIModelConfig {
	provider: AIProvider;
	baseUrl: string;
	apiKey: string;
	model: string;
}

export interface TTSConfig {
	enabled: boolean;
	voice: string;
	speed: number;
	volume: number;
	apiKey: string;
	baseUrl: string;
	characterVoices: Record<string, string>;
}

export interface PromptConfig {
	proofread: string;
	proofreadChapter: string;
	script: string;
	scriptTts: string;
	novelTts: string;
	readingModeTts: string;
}

interface ConfigState {
	config: AIModelConfig;
	ttsConfig: TTSConfig;
	promptConfig: PromptConfig;
	setConfig: (config: AIModelConfig) => void;
	updateConfig: (patch: Partial<AIModelConfig>) => void;
	setTTSConfig: (config: TTSConfig) => void;
	updateTTSConfig: (patch: Partial<TTSConfig>) => void;
	setPromptConfig: (config: PromptConfig) => void;
	updatePromptConfig: (patch: Partial<PromptConfig>) => void;
}

const DEFAULT_CONFIG: AIModelConfig = {
	provider: "openai",
	baseUrl: "https://api.openai.com/v1",
	apiKey: "",
	model: "gpt-4o",
};

const DEFAULT_TTS_CONFIG: TTSConfig = {
	enabled: false,
	voice: "冰糖",
	speed: 5,
	volume: 5,
	apiKey: "",
	baseUrl: "https://api.xiaomimimo.com/v1",
	characterVoices: {},
};

const DEFAULT_PROMPT_CONFIG: PromptConfig = {
	proofread: "",
	proofreadChapter: "",
	script: "",
	scriptTts: "",
	novelTts: "",
	readingModeTts: "",
};

export const useConfigStore = create<ConfigState>()(
	persist(
		(set) => ({
			config: DEFAULT_CONFIG,
			ttsConfig: DEFAULT_TTS_CONFIG,
			promptConfig: DEFAULT_PROMPT_CONFIG,
			setConfig: (config) => set({ config }),
			updateConfig: (patch) =>
				set((state) => ({ config: { ...state.config, ...patch } })),
			setTTSConfig: (config) => set({ ttsConfig: { ...DEFAULT_TTS_CONFIG, ...config } }),
			updateTTSConfig: (patch) =>
				set((state) => ({ ttsConfig: { ...DEFAULT_TTS_CONFIG, ...state.ttsConfig, ...patch } })),
			setPromptConfig: (config) => set({ promptConfig: config }),
			updatePromptConfig: (patch) =>
				set((state) => ({ promptConfig: { ...state.promptConfig, ...patch } })),
		}),
		{
			name: "novel-proofreader-ai-config",
		},
	),
);
