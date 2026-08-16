import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AIConfig, AIProvider } from "../types";
import { setLoggerEnabled } from "../utils/logger";
import { detectProvider } from "../utils/aiClient";
import { secureStorageSet, secureStorageGet, preloadSecureStorage } from "../utils/secureStorage";

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
	model: "deepseek-v4-flash",
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
				aiConfig: { ...state.aiConfig, apiKey: "" },
				apiKeyMap: {},
			}),
			onRehydrateStorage: () => async (state) => {
				if (state) {
					setLoggerEnabled(state.aiConfig.enableLogging);
					await preloadSecureStorage();
					const providers: AIProvider[] = ['openai', 'deepseek', 'siliconflow', 'mimo', 'lmstudio', 'ollama', 'vllm', 'custom'];
					const currentProvider = detectProvider(state.aiConfig.baseURL);
					const nextApiKeyMap = { ...state.apiKeyMap };
					let restoredKey = "";
					for (const provider of providers) {
						const savedKey = secureStorageGet(`apiKey-${provider}`);
						if (savedKey) {
							nextApiKeyMap[provider] = savedKey;
							if (provider === currentProvider) restoredKey = savedKey;
						}
					}
					// 通过 setState 恢复 apiKeyMap 与当前 provider 的 apiKey，
					// 触发组件重新渲染，避免启动后 AI 功能提示"请设置 AI Key"
					useAIConfigStore.setState({
						apiKeyMap: nextApiKeyMap,
						aiConfig: { ...state.aiConfig, apiKey: restoredKey || state.aiConfig.apiKey },
					});
				}
			},
		},
	),
);
