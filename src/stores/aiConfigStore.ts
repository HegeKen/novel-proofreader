import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AIConfig, AIProvider } from "../types";
import { setLoggerEnabled } from "../utils/logger";
import { secureStorageSet, secureStorageGet } from "../utils/secureStorage";

export interface AIConfigState {
	aiConfig: AIConfig;
	apiKeyMap: Partial<Record<AIProvider, string>>;

	setAIConfig: (config: Partial<AIConfig>) => void;
	setApiKeyForProvider: (provider: AIProvider, key: string) => void;
	getApiKeyForProvider: (provider: AIProvider) => string;
}

const DEFAULT_AI_CONFIG: AIConfig = {
	baseURL: "https://api.deepseek.com/v1",
	apiKey: "",
	model: "deepseek-chat",
	customHeaders: {},
	maxCharsPerRequest: 2000,
	enableLogging: true,
};

export const useAIConfigStore = create<AIConfigState>()(
	persist(
		(set, get) => ({
			aiConfig: DEFAULT_AI_CONFIG,
			apiKeyMap: {},

			setAIConfig: (config) =>
				set((state) => {
					const next = { ...state.aiConfig, ...config };
					setLoggerEnabled(next.enableLogging);
					return { aiConfig: next };
				}),

			setApiKeyForProvider: (provider, key) => {
				secureStorageSet(`apiKey-${provider}`, key);
				set((state) => ({
					apiKeyMap: { ...state.apiKeyMap, [provider]: key },
				}));
			},

			getApiKeyForProvider: (provider) => {
				const state = get();
				const secureKey = secureStorageGet(`apiKey-${provider}`);
				if (secureKey !== null) {
					if (state.apiKeyMap[provider] !== secureKey) {
						set((s) => ({
							apiKeyMap: { ...s.apiKeyMap, [provider]: secureKey },
						}));
					}
					return secureKey;
				}
				return state.apiKeyMap[provider] ?? "";
			},
		}),
		{
			name: "novel-proofreader-ai-config",
			partialize: (state) => ({
				aiConfig: state.aiConfig,
				apiKeyMap: state.apiKeyMap,
			}),
			onRehydrateStorage: () => (state) => {
				if (state) {
					setLoggerEnabled(state.aiConfig.enableLogging);
				}
			},
		},
	),
);
