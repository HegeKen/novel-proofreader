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

interface ConfigState {
	config: AIModelConfig;
	setConfig: (config: AIModelConfig) => void;
	updateConfig: (patch: Partial<AIModelConfig>) => void;
}

const DEFAULT_CONFIG: AIModelConfig = {
	provider: "openai",
	baseUrl: "https://api.openai.com/v1",
	apiKey: "",
	model: "gpt-4o",
};

export const useConfigStore = create<ConfigState>()(
	persist(
		(set) => ({
			config: DEFAULT_CONFIG,
			setConfig: (config) => set({ config }),
			updateConfig: (patch) =>
				set((state) => ({ config: { ...state.config, ...patch } })),
		}),
		{
			name: "novel-proofreader-ai-config",
		},
	),
);
