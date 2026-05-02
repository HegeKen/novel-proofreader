// ============================================================
// AI 模型配置弹窗 - 紧凑设计
// ============================================================
import { useState, useCallback } from "react";
import { useAppStore } from "../stores/appStore";
import type { AIProvider } from "../types";

const PROVIDERS: {
	value: AIProvider;
	label: string;
	logo: string;
	color: string;
}[] = [
	{
		value: "openai",
		label: "OpenAI",
		logo: "https://avatars.githubusercontent.com/u/14957082?s=200&v=4",
		color: "#0ea561",
	},
	{
		value: "deepseek",
		label: "DeepSeek",
		logo: "https://sf-maas-uat-prod.oss-cn-shanghai.aliyuncs.com/Model_LOGO/DeepSeek.svg",
		color: "#0ea561",
	},
	{
		value: "siliconflow",
		label: "SiliconFlow",
		logo: "https://siliconflow.cn/logo-new.svg",
		color: "#0ea561",
	},
	{
		value: "mimo",
		label: "Xiaomi MiMo",
		logo: "https://aistudio.xiaomimimo.com/favicon.0619b0d2.png",
		color: "#0ea561",
	},
	{
		value: "lmstudio",
		label: "LM Studio",
		logo: "https://lm-studio.cn/_next/static/media/lmstudio-app-logo.11b4d746.webp",
		color: "#0ea561",
	},
	{
		value: "custom",
		label: "自定义",
		logo: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="%236b7280" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"%3E%3C/path%3E%3Ccircle cx="12" cy="12" r="3"%3E%3C/circle%3E%3C/svg%3E',
		color: "#0ea561",
	},
];

const PRESETS: Record<AIProvider, { baseUrl: string; model: string }> = {
	openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o" },
	deepseek: { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
	siliconflow: {
		baseUrl: "https://api.siliconflow.cn/v1",
		model: "deepseek-ai/DeepSeek-V3",
	},
	mimo: { baseUrl: "https://api.xiaomimimo.com/v1", model: "mimo-v2-flash" },
	lmstudio: { baseUrl: "http://localhost:1234/v1", model: "" },
	custom: { baseUrl: "", model: "" },
};

interface Props {
	open: boolean;
	onClose: () => void;
}

interface ConfigState {
	provider: AIProvider;
	baseUrl: string;
	apiKey: string;
	model: string;
	enableLogging: boolean;
}

// 根据 URL 检测提供商
const detectProvider = (url: string): AIProvider => {
	if (url.includes("deepseek")) return "deepseek";
	if (url.includes("openai")) return "openai";
	if (url.includes("siliconflow")) return "siliconflow";
	if (url.includes("xiaomimimo")) return "mimo";
	if (url.includes("localhost:1234") || url.includes("127.0.0.1:1234"))
		return "lmstudio";
	return "custom";
};

// 内部组件，使用 key 重置状态
function ConfigModalContent({
	initialConfig,
	apiKeyMap,
	onSave,
	onClose,
}: {
	initialConfig: ConfigState;
	apiKeyMap: Partial<Record<AIProvider, string>>;
	onSave: (config: ConfigState) => void;
	onClose: () => void;
}) {
	const [config, setConfig] = useState<ConfigState>(initialConfig);
	const [showApiKey, setShowApiKey] = useState(false);

	const handleProviderChange = useCallback(
		(p: AIProvider) => {
			setConfig((prev) => ({
				...prev,
				provider: p,
				baseUrl: PRESETS[p].baseUrl,
				model: PRESETS[p].model,
				apiKey: apiKeyMap[p] ?? "",
			}));
		},
		[apiKeyMap],
	);

	const handleSave = useCallback(() => {
		onSave(config);
	}, [config, onSave]);

	return (
		<div className="modal-overlay" onClick={onClose}>
			<div className="config-modal" onClick={(e) => e.stopPropagation()}>
				<div className="config-header">
					<div className="config-title">
						<span className="title-icon">⚙️</span>
						<span>AI 模型配置</span>
					</div>
					<button className="close-btn" onClick={onClose}>
						<svg
							width="16"
							height="16"
							viewBox="0 0 16 16"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
						>
							<path d="M3 3L13 13M13 3L3 13" />
						</svg>
					</button>
				</div>

				<div className="config-body">
					<div className="config-section">
						<div className="section-label">选择模型提供商</div>
						<div className="provider-grid">
							{PROVIDERS.map((p) => (
								<button
									key={p.value}
									className={`provider-card ${config.provider === p.value ? "active" : ""}`}
									onClick={() => handleProviderChange(p.value)}
									style={
										{
											"--provider-color": p.color,
										} as React.CSSProperties
									}
								>
									<img
										src={p.logo}
										alt={p.label}
										className="provider-logo"
										onError={(e) => {
											// 如果图片加载失败，显示文字标识
											const target = e.target as HTMLImageElement;
											target.style.display = "none";
											target.parentElement
												?.querySelector(".provider-fallback")
												?.classList.remove("hidden");
										}}
									/>
									<span className="provider-fallback hidden">
										{p.label.charAt(0)}
									</span>
									<span className="provider-name">{p.label}</span>
								</button>
							))}
						</div>
					</div>

					<div className="config-section">
						<div className="section-label">API 配置</div>
						<div className="form-field">
							<label>Base URL</label>
							<div className="input-wrapper">
								<input
									type="text"
									value={config.baseUrl}
									onChange={(e) =>
										setConfig((prev) => ({ ...prev, baseUrl: e.target.value }))
									}
									placeholder="https://api.deepseek.com/v1"
									className="config-input"
								/>
							</div>
						</div>

						<div className="form-field">
							<label>API Key</label>
							<div className="input-wrapper">
								<input
									type={showApiKey ? "text" : "password"}
									value={config.apiKey}
									onChange={(e) =>
										setConfig((prev) => ({ ...prev, apiKey: e.target.value }))
									}
									placeholder="sk-..."
									className="config-input"
								/>
								<button
									className="toggle-visibility-btn"
									onClick={() => setShowApiKey(!showApiKey)}
									type="button"
								>
									{showApiKey ? (
										<svg
											width="16"
											height="16"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											strokeWidth="2"
										>
											<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-5.96 5.06M15 11a3 3 0 1 1-6 0 3 3 0 0 1 6 0" />
										</svg>
									) : (
										<svg
											width="16"
											height="16"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											strokeWidth="2"
										>
											<path d="M13.87 10.13a2 2 0 0 0-2.83 0l-.34.34a2 2 0 0 1-2.83 0l-2.82-2.82a2 2 0 0 1 0-2.83l.34-.34a2 2 0 0 0 0-2.83L4.13 3.13a2 2 0 0 0-2.83 0L.69 5.34a2 2 0 0 0 0 2.83l.34.34a2 2 0 0 1 0 2.83l-2.82 2.82a2 2 0 0 0 0 2.83l.34.34a2 2 0 0 1 0 2.83l2.12 2.12a2 2 0 0 0 2.83 0l.34-.34a2 2 0 0 1 2.83 0l2.82 2.82a2 2 0 0 0 2.83 0l.34-.34a2 2 0 0 1 2.83 0l2.12 2.12a2 2 0 0 0 2.83 0l.34-.34a2 2 0 0 0 0-2.83l-2.82-2.82a2 2 0 0 1 0-2.83l.34-.34a2 2 0 0 0 0-2.83L20.87 13a2 2 0 0 0-2.83 0l-.34.34a2 2 0 0 1-2.83 0l-2.82-2.82a2 2 0 0 0-2.83 0l-.34.34z" />
										</svg>
									)}
								</button>
							</div>
						</div>

						<div className="form-field">
							<label>模型名称</label>
							<div className="input-wrapper">
								<input
									type="text"
									value={config.model}
									onChange={(e) =>
										setConfig((prev) => ({ ...prev, model: e.target.value }))
									}
									placeholder="deepseek-chat"
									className="config-input"
								/>
							</div>
						</div>
					</div>

					<div className="config-section">
						<div className="section-label">调试选项</div>
						<label className="toggle-label">
							<div className="toggle-switch">
								<input
									type="checkbox"
									checked={config.enableLogging}
									onChange={(e) =>
										setConfig((prev) => ({
											...prev,
											enableLogging: e.target.checked,
										}))
									}
								/>
								<span className="toggle-slider"></span>
							</div>
							<span className="toggle-text">开启调试日志</span>
						</label>
					</div>
				</div>

				<div className="config-footer">
					<button className="btn-cancel" onClick={onClose}>
						取消
					</button>
					<button className="btn-save" onClick={handleSave}>
						保存配置
					</button>
				</div>
			</div>
		</div>
	);
}

export function ConfigModal({ open, onClose }: Props) {
	const aiConfig = useAppStore((s) => s.aiConfig);
	const setAIConfig = useAppStore((s) => s.setAIConfig);
	const apiKeyMap = useAppStore((s) => s.apiKeyMap);
	const setApiKeyForProvider = useAppStore((s) => s.setApiKeyForProvider);

	// 计算初始配置
	const provider = detectProvider(aiConfig.baseURL);
	const initialConfig: ConfigState = {
		provider,
		baseUrl: aiConfig.baseURL,
		apiKey: apiKeyMap[provider] ?? aiConfig.apiKey,
		model: aiConfig.model,
		enableLogging: aiConfig.enableLogging,
	};

	// 保存配置的回调
	const handleSave = useCallback(
		(config: ConfigState) => {
			setApiKeyForProvider(config.provider, config.apiKey);
			setAIConfig({
				baseURL: config.baseUrl.replace(/\/+$/, ""),
				apiKey: config.apiKey,
				model: config.model,
				enableLogging: config.enableLogging,
			});
			onClose();
		},
		[setApiKeyForProvider, setAIConfig, onClose],
	);

	if (!open) return null;

	// 使用 key 属性确保每次打开弹窗时重新挂载组件，从而重置状态
	return (
		<ConfigModalContent
			key={open ? "open" : "closed"}
			initialConfig={initialConfig}
			apiKeyMap={apiKeyMap}
			onSave={handleSave}
			onClose={onClose}
		/>
	);
}
