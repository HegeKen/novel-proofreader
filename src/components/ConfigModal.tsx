// ============================================================
// AI 模型配置弹窗 - 紧凑设计
// ============================================================
import { useState, useCallback } from "react";
import { useAppStore } from "../stores/appStore";
import { useConfigStore } from "../stores/configStore";
import type { AIProvider } from "../types";
import { Icons } from "./Icons";
import { Select } from "./Select";

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
		value: "ollama",
		label: "Ollama",
		logo: "https://ollama.com/public/ollama.png",
		color: "#0ea561",
	},
	{
		value: "vllm",
		label: "VLLM",
		logo: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%236b7280" stroke-width="2"%3E%3Cpath d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/%3E%3C/svg%3E',
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
	ollama: { baseUrl: "http://localhost:11434/v1", model: "llama3.1" },
	vllm: { baseUrl: "http://localhost:8000/v1", model: "" },
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
	if (url.includes("localhost:11434") || url.includes("127.0.0.1:11434"))
		return "ollama";
	if (url.includes("localhost:8000") || url.includes("127.0.0.1:8000"))
		return "vllm";
	return "custom";
};

// API 使用统计组件
function APIUsageSection() {
	const apiUsage = useAppStore((s) => s.apiUsage);
	const resetAPIUsage = useAppStore((s) => s.resetAPIUsage);

	const successRate = apiUsage.totalRequests > 0
		? Math.round((apiUsage.successfulRequests / apiUsage.totalRequests) * 100)
		: 0;

	const errorRate = apiUsage.totalRequests > 0
		? Math.round((apiUsage.failedRequests / apiUsage.totalRequests) * 100)
		: 0;

	return (
		<div className="config-section">
			<div className="section-label">
				<Icons.barChart3 size={14} />
				API 使用统计
			</div>

			<div className="usage-stats">
				<div className="usage-stat-card total">
					<div className="usage-stat-header">
						<div className="usage-stat-icon">
							<Icons.barChart3 size={16} />
						</div>
					</div>
					<div className="usage-stat-value">{apiUsage.totalRequests}</div>
					<div className="usage-stat-label">总请求数</div>
				</div>

				<div className="usage-stat-card success">
					<div className="usage-stat-header">
						<div className="usage-stat-icon">
							<Icons.checkCircle size={16} />
						</div>
					</div>
					<div className="usage-stat-value">{apiUsage.successfulRequests}</div>
					<div className="usage-stat-label">成功请求</div>
				</div>

				<div className="usage-stat-card failed">
					<div className="usage-stat-header">
						<div className="usage-stat-icon">
							<Icons.alertCircle size={16} />
						</div>
					</div>
					<div className="usage-stat-value">{apiUsage.failedRequests}</div>
					<div className="usage-stat-label">失败请求</div>
				</div>

				<div className="usage-stat-card rate">
					<div className="usage-stat-header">
						<div className="usage-stat-icon">
							<Icons.loader2 size={16} />
						</div>
					</div>
					<div className="usage-stat-value">{successRate}%</div>
					<div className="usage-stat-label">成功率</div>
				</div>
			</div>

			<div className="usage-progress">
				<div className="usage-progress-header">
					<span className="usage-progress-label">成功率</span>
					<span className="usage-progress-value">{successRate}%</span>
				</div>
				<div className="usage-progress-bar">
					<div
						className="usage-progress-fill success"
						style={{ width: `${successRate}%` }}
					/>
				</div>
			</div>

			<div className="usage-progress">
				<div className="usage-progress-header">
					<span className="usage-progress-label">失败率</span>
					<span className="usage-progress-value">{errorRate}%</span>
				</div>
				<div className="usage-progress-bar">
					<div
						className="usage-progress-fill error"
						style={{ width: `${errorRate}%` }}
					/>
				</div>
			</div>

			{Object.keys(apiUsage.providerStats).length > 0 && (
				<div className="provider-stats">
					<div className="provider-stats-header">
						<Icons.cache size={12} />
						按提供商统计
					</div>
					{Object.entries(apiUsage.providerStats).map(([provider, stats], index) => (
						<div key={provider} className="provider-stat-item">
							<div className="provider-stat-info">
								<div className="provider-stat-icon">
									{index + 1}
								</div>
								<span className="provider-stat-name">{provider}</span>
							</div>
							<div className="provider-stat-details">
								<span className="provider-stat-requests">{stats.requests} 请求</span>
								<span className="provider-stat-success">
									<Icons.check size={12} />
									{stats.success} 成功
								</span>
							</div>
						</div>
					))}
				</div>
			)}

			<button className="btn-reset-usage" onClick={resetAPIUsage}>
				<Icons.refresh size={14} />
				重置统计
			</button>
		</div>
	);
}

// 阅读设置组件
function ReadingSettingsSection() {
	const readingReminderEnabled = useAppStore((s) => s.readingReminderEnabled);
	const readingReminderMinutes = useAppStore((s) => s.readingReminderMinutes);
	const setReadingReminderEnabled = useAppStore((s) => s.setReadingReminderEnabled);
	const setReadingReminderMinutes = useAppStore((s) => s.setReadingReminderMinutes);

	return (
		<div className="config-section">
			<div className="section-label">
				<Icons.book size={14} />
				阅读设置
			</div>

			<label className="toggle-label">
				<div className="toggle-switch">
					<input
						type="checkbox"
						checked={readingReminderEnabled}
						onChange={(e) => setReadingReminderEnabled(e.target.checked)}
					/>
					<span className="toggle-slider"></span>
				</div>
				<span className="toggle-text">启用阅读时长提醒</span>
			</label>

			{readingReminderEnabled && (
				<div className="form-field">
					<label>提醒间隔（分钟）</label>
					<div className="input-wrapper">
						<input
							type="number"
							min="5"
							max="120"
							step="5"
							value={readingReminderMinutes}
							onChange={(e) => setReadingReminderMinutes(parseInt(e.target.value) || 30)}
							className="config-input"
						/>
					</div>
				</div>
			)}
		</div>
	);
}

function TTSConfigSection() {
	const ttsConfig = useConfigStore((s) => s.ttsConfig);
	const updateTTSConfig = useConfigStore((s) => s.updateTTSConfig);
	const [showApiKey, setShowApiKey] = useState(false);

	return (
		<div className="config-section">
			<div className="section-label">
				<Icons.volume size={14} />
				语音朗读 (TTS)
			</div>
			<p style={{ fontSize: "12px", color: "#666", marginBottom: "12px" }}>
				使用 Xiaomi MiMo TTS API 将文本转换为语音。
			</p>

			<div className="form-field">
				<label>MiMo API Key</label>
				<div className="input-wrapper">
					<input
						type={showApiKey ? "text" : "password"}
						value={ttsConfig.apiKey}
						onChange={(e) => updateTTSConfig({ apiKey: e.target.value })}
						placeholder="输入 MiMo API Key"
						className="config-input"
					/>
					<button
						className="toggle-visibility-btn"
						onClick={() => setShowApiKey(!showApiKey)}
						type="button"
					>
						{showApiKey ? <Icons.eyeOff size={16} /> : <Icons.eye size={16} />}
					</button>
				</div>
			</div>

			<div className="form-field">
				<label>Base URL</label>
				<input
					type="text"
					value={ttsConfig.baseUrl}
					onChange={(e) => updateTTSConfig({ baseUrl: e.target.value })}
					placeholder="https://api.mimo-v2.com/v1"
					className="config-input"
				/>
			</div>

			<div className="form-field">
				<label>音色</label>
				<Select
					value={ttsConfig.voice}
					onChange={(value) => updateTTSConfig({ voice: value })}
					options={[
						{ value: '冰糖', label: '冰糖' },
						{ value: '茉莉', label: '茉莉' },
						{ value: '苏打', label: '苏打' },
						{ value: '白桦', label: '白桦' },
						{ value: 'Mia', label: 'Mia' },
						{ value: 'Chloe', label: 'Chloe' },
						{ value: 'Milo', label: 'Milo' },
						{ value: 'Dean', label: 'Dean' },
					]}
				/>
			</div>

			<div className="form-field">
				<label>语速 ({ttsConfig.speed})</label>
				<input
					type="range"
					min="1"
					max="10"
					value={ttsConfig.speed}
					onChange={(e) => updateTTSConfig({ speed: parseInt(e.target.value) })}
					className="config-range"
				/>
			</div>

			<div className="form-field">
				<label>音量 ({ttsConfig.volume})</label>
				<input
					type="range"
					min="1"
					max="10"
					value={ttsConfig.volume}
					onChange={(e) => updateTTSConfig({ volume: parseInt(e.target.value) })}
					className="config-range"
				/>
			</div>

			<a
				href="https://platform.xiaomimimo.com/docs/zh-CN/usage-guide/speech-synthesis-v2.5"
				target="_blank"
				rel="noopener noreferrer"
				style={{ fontSize: "12px", color: "var(--accent)" }}
			>
				获取 MiMo API Key →
			</a>
		</div>
	);
}

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
			setConfig((prev) => {
				// 如果切换到相同的提供商，保留当前的 baseUrl 和 model
				if (prev.provider === p) {
					return prev;
				}
				// 切换到不同的提供商时，使用新提供商的预设值
				return {
					...prev,
					provider: p,
					baseUrl: PRESETS[p].baseUrl,
					model: PRESETS[p].model,
					apiKey: apiKeyMap[p] ?? "",
				};
			});
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
						<span className="title-icon"><Icons.settings size={16} /></span>
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
									{showApiKey ? <Icons.eyeOff size={16} /> : <Icons.eye size={16} />}
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

					<APIUsageSection />

					<ReadingSettingsSection />

					<TTSConfigSection />
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
