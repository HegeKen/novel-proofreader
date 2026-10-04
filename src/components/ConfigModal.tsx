import { useState, useCallback, useMemo } from "react";
import { useAIConfigStore } from "../stores/aiConfigStore";
import { useConfigStore } from "../stores/configStore";
import type { AIProvider, ApiFormat, ModelSource } from "../types";
import { Icons } from "./Icons";
import { Modal } from "./Modal";
import { AITestSection } from "./config/AITestSection";
import { BalanceSection } from "./config/BalanceSection";
import { APIUsageSection } from "./config/APIUsageSection";
import { ProofreadSettingsSection } from "./config/ProofreadSettingsSection";
import { TTSConfigSection } from "./config/TTSConfigSection";
import { DataManagementSection } from "./config/DataManagementSection";
import { PromptSettingsSection } from "./config/PromptSettingsSection";
import { LocalModelSettings } from "./LocalModelSettings";
import type { PromptConfig } from "./config/promptConfig";
import { DEFAULTS as PROMPT_DEFAULTS } from "./config/promptConfig";
import { WordReplacementModal } from "./WordReplacementModal";
import { getLogHistory, clearLogHistory, type LogEntry } from "../utils/logger";
import { detectProvider, DUAL_FORMAT_PROVIDERS, ANTHROPIC_BASE_URLS } from "../utils/aiClient";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";

const PROVIDERS: { value: AIProvider; label: string; logo: string; color: string }[] = [
	{ value: "openai", label: "OpenAI", logo: "https://avatars.githubusercontent.com/u/14957082?s=200&v=4", color: "#0ea561" },
	{ value: "deepseek", label: "DeepSeek", logo: "https://sf-maas-uat-prod.oss-cn-shanghai.aliyuncs.com/Model_LOGO/DeepSeek.svg", color: "#0ea561" },
	{ value: "siliconflow", label: "SiliconFlow", logo: "https://siliconflow.cn/logo-new.svg", color: "#0ea561" },
	{ value: "mimo", label: "Xiaomi MiMo", logo: "https://aistudio.xiaomimimo.com/favicon.0619b0d2.png", color: "#0ea561" },
	{ value: "qwen", label: "通义千问", logo: "https://img.alicdn.com/imgextra/i3/O1CN01JLF4IJ1yAv1ZE7bfQ_!!6000000006539-2-tps-180-48.png", color: "#615ced" },
	{ value: "glm", label: "智谱GLM", logo: "https://cdn.bigmodel.cn/static/logo/dark.svg", color: "#3b5998" },
	{ value: "openrouter", label: "OpenRouter", logo: "https://mintcdn.com/openrouter-d02e98a0/ksNSeB_K7gD-BUDh/assets/logo-v2-dark.svg?fit=max&auto=format&n=ksNSeB_K7gD-BUDh&q=85&s=8ba2f49b11cd9839c37dd03c62537ebd", color: "#615ced" },
	{ value: "custom", label: "自定义", logo: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="%236b7280" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"%3E%3C/path%3E%3Ccircle cx="12" cy="12" r="3"%3E%3C/circle%3E%3C/svg%3E', color: "#0ea561" },
];

const PRESETS: Record<AIProvider, { baseUrl: string; model: string }> = {
	openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o" },
	deepseek: { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-flash" },
	siliconflow: { baseUrl: "https://api.siliconflow.cn/v1", model: "deepseek-ai/DeepSeek-V4-Flash" },
	mimo: { baseUrl: "https://api.xiaomimimo.com/v1", model: "mimo-v2.6-flash" },
	qwen: { baseUrl: "https://trial.cn-beijing.maas.aliyuncs.com/compatible-mode/v1", model: "qwen3.8-flash" },
	glm: { baseUrl: "https://open.bigmodel.cn/api/paas/v4/", model: "glm-5.3" },
	openrouter: { baseUrl: "https://openrouter.ai/api/v1", model: "deepseek/deepseek-flash" },
	lmstudio: { baseUrl: "http://localhost:1234/v1", model: "" },
	ollama: { baseUrl: "http://localhost:11434/v1", model: "llama3.1" },
	vllm: { baseUrl: "http://localhost:8000/v1", model: "" },
	custom: { baseUrl: "", model: "" },
};

interface ConfigState {
	provider: AIProvider;
	baseUrl: string;
	apiKey: string;
	model: string;
	enableLogging: boolean;
	apiFormat: ApiFormat;
}

interface Props {
	open: boolean;
	onClose: () => void;
}

function ConfigModalContent({
	initialConfig,
	apiKeyMap,
	onSave,
	onClose,
	promptConfig,
	onSavePrompt,
}: {
	initialConfig: ConfigState;
	apiKeyMap: Partial<Record<AIProvider, string>>;
	onSave: (config: ConfigState) => void;
	onClose: () => void;
	promptConfig: PromptConfig;
	onSavePrompt: (config: PromptConfig) => void;
}) {
	const [config, setConfig] = useState<ConfigState>(initialConfig);
	const localModelConfig = useAIConfigStore((s) => s.localModelConfig);
	const setLocalModelConfig = useAIConfigStore((s) => s.setLocalModelConfig);
	const updateProofreadConfig = useConfigStore((s) => s.updateProofreadConfig);
	const modelSource = localModelConfig.modelSource;

	/** 切换推理模型来源 */
	const handleSourceChange = useCallback((source: ModelSource) => {
		setLocalModelConfig({ modelSource: source, enabled: source !== "cloud" });
		// 本地推理吞吐有限，切换到本地来源时校对并发默认降为 1（用户可在校对引擎设置中自行提高）
		if (source !== "cloud") {
			updateProofreadConfig({ maxConcurrentBatches: 1 });
		}
	}, [setLocalModelConfig, updateProofreadConfig]);
	const [showApiKey, setShowApiKey] = useState(false);
	const [activeTab, setActiveTab] = useState<"ai" | "proofread" | "tts" | "data" | "dev">("ai");
	const [logRefresh, setLogRefresh] = useState(0);
	const [showWordReplacementModal, setShowWordReplacementModal] = useState(false);
	const [promptState, setPromptState] = useState<PromptConfig>(promptConfig);
	const logs = useMemo(() => {
		void logRefresh;
		return config.enableLogging ? getLogHistory() : [];
	}, [config.enableLogging, logRefresh]);
	const { copiedId, copy: copyToClipboard } = useCopyToClipboard();

	const handleCopyLog = useCallback(async (log: LogEntry) => {
		const logText = `[${new Date(log.timestamp).toLocaleString("zh-CN")}] [${log.level.toUpperCase()}] [${log.category}] ${log.message}${log.data ? "\n" + JSON.stringify(log.data, null, 2) : ""}`;
		await copyToClipboard(log.id, logText);
	}, [copyToClipboard]);

	const handleCopyAllLogs = useCallback(async () => {
		const allLogs = logs.map(log => `[${new Date(log.timestamp).toLocaleString("zh-CN")}] [${log.level.toUpperCase()}] [${log.category}] ${log.message}${log.data ? "\n" + JSON.stringify(log.data, null, 2) : ""}`).join("\n\n");
		await copyToClipboard("all", allLogs);
	}, [logs, copyToClipboard]);

	const handleClearLogs = useCallback(() => {
		clearLogHistory();
		setLogRefresh((prev) => prev + 1);
	}, []);

	const handleProviderChange = useCallback((p: AIProvider) => {
		setConfig((prev) => {
			if (prev.provider === p) return prev;
			return {
				...prev,
				provider: p,
				baseUrl: PRESETS[p].baseUrl,
				model: PRESETS[p].model,
				apiKey: apiKeyMap[p] ?? "",
				// 切换后的提供商若不支持 Anthropic 格式，则回退到 OpenAI 格式
				apiFormat: DUAL_FORMAT_PROVIDERS.has(p) ? prev.apiFormat : "openai",
			};
		});
	}, [apiKeyMap]);

	/** 切换 API 格式（Anthropic 格式的实际端点由请求层按提供商解析） */
	const handleApiFormatChange = useCallback((format: ApiFormat) => {
		setConfig((prev) => (prev.apiFormat === format ? prev : { ...prev, apiFormat: format }));
	}, []);

	return (
		<Modal open onClose={onClose} title="APP 设置" icon={<Icons.settings size={16} />}>
			<div className="config-tabs">
					{([ ["ai", "AI 模型", Icons.brain], ["proofread", "校对引擎", Icons.bolt], ["tts", "语音朗读", Icons.volume], ["data", "数据管理", Icons.server], ["dev", "开发者工具", Icons.settings]] as const).map(([tab, label, Icon]) => (
						<button key={tab} className={`tab-btn ${activeTab === tab ? "active" : ""}`} onClick={() => setActiveTab(tab)}>
							<Icon size={14} />{label}
						</button>
					))}
				</div>
				<div className="config-body">
					{activeTab === "ai" && (
						<>
							<div className="config-section">
								<div className="section-label"><Icons.server size={14} />推理模型来源</div>
								<div className="provider-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
									{([
										["cloud", "云端 API", "DeepSeek / OpenAI 等"],
										["local-external", "本地服务", "Ollama / LM Studio"],
										["local-builtin", "内置模型", "Rust 原生推理"],
									] as const).map(([value, label, hint]) => (
										<button key={value}
											className={`provider-card ${modelSource === value ? "active" : ""}`}
											onClick={() => handleSourceChange(value)}
											style={{ "--provider-color": modelSource === value ? "var(--accent)" : "#0ea561" } as React.CSSProperties}>
											<span className="provider-name">{label}</span>
											<span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{hint}</span>
										</button>
									))}
								</div>
							</div>
							{modelSource === "cloud" && (
								<>
									<div className="config-section">
										<div className="section-label">选择模型提供商</div>
										<div className="provider-grid">
											{PROVIDERS.map((p) => (
												<button key={p.value} className={`provider-card ${config.provider === p.value ? "active" : ""}`}
													onClick={() => handleProviderChange(p.value)}
													style={{ "--provider-color": p.color } as React.CSSProperties}>
													<img src={p.logo} alt={p.label} className="provider-logo"
														onError={(e) => { const t = e.target as HTMLImageElement; t.style.display = "none"; t.parentElement?.querySelector(".provider-fallback")?.classList.remove("hidden"); }} />
													<span className="provider-fallback hidden">{p.label.charAt(0)}</span>
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
										<input type="text" value={config.baseUrl}
											onChange={(e) => setConfig((prev) => ({ ...prev, baseUrl: e.target.value }))}
											placeholder="https://api.deepseek.com/v1" className="config-input" />
									</div>
								</div>
								<form onSubmit={(e) => e.preventDefault()}>
									<div className="form-field">
										<label>API Key</label>
										<div className="input-wrapper">
											<input type={showApiKey ? "text" : "password"} value={config.apiKey}
												onChange={(e) => setConfig((prev) => ({ ...prev, apiKey: e.target.value }))}
												placeholder="sk-..." className="config-input" autoComplete="new-password" />
											<button className="toggle-visibility-btn" onClick={() => setShowApiKey(!showApiKey)} type="button">
												{showApiKey ? <Icons.eyeOff size={16} /> : <Icons.eye size={16} />}
											</button>
										</div>
									</div>
								</form>
								<div className="form-field">
									<label>模型名称</label>
									<div className="input-wrapper">
										<input type="text" value={config.model}
											onChange={(e) => setConfig((prev) => ({ ...prev, model: e.target.value }))}
											placeholder="deepseek-flash" className="config-input" />
									</div>
								</div>
								{DUAL_FORMAT_PROVIDERS.has(config.provider) && (
									<div className="form-field">
										<label>API 格式</label>
										<div className="format-switch">
											{([["openai", "OpenAI 格式"], ["anthropic", "Anthropic 格式"]] as const).map(([value, label]) => (
												<button key={value} type="button"
													className={`format-switch-btn ${config.apiFormat === value ? "active" : ""}`}
													onClick={() => handleApiFormatChange(value)}>
													{label}
												</button>
											))}
										</div>
										<div className="format-switch-hint">
											实际请求：{config.apiFormat === "anthropic"
												? `${ANTHROPIC_BASE_URLS[config.provider] ?? config.baseUrl.replace(/\/+$/, "")}/messages`
												: `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`}
										</div>
									</div>
								)}
							</div>
								<BalanceSection baseUrl={config.baseUrl} apiKey={config.apiKey} />
								<AITestSection config={config} />
								</>
							)}
							{modelSource !== "cloud" && <LocalModelSettings />}
						</>
					)}
					{activeTab === "proofread" && (
						<>
							<ProofreadSettingsSection />
							<div className="config-section">
								<div className="section-label"><Icons.punctuation size={14} />Prompt 模板</div>
								<PromptSettingsSection
									prompts={promptState}
									onChange={(key, value) => setPromptState((prev) => ({ ...prev, [key]: value }))}
								/>
							</div>
						</>
					)}
					{activeTab === "tts" && (
						<>
							<TTSConfigSection onOpenWordReplacement={() => setShowWordReplacementModal(true)} />
							<WordReplacementModal open={showWordReplacementModal} onClose={() => setShowWordReplacementModal(false)} />
						</>
					)}
					{activeTab === "dev" && (
						<>
							<div className="config-section">
								<div className="section-label"><Icons.laptop size={14} />调试选项</div>
								<label className="toggle-label">
									<div className="toggle-switch">
										<input type="checkbox" checked={config.enableLogging}
											onChange={(e) => setConfig((prev) => ({ ...prev, enableLogging: e.target.checked }))} />
										<span className="toggle-slider"></span>
									</div>
									<span className="toggle-text">开启调试日志</span>
								</label>
							</div>
							<div className="config-section">
								<div className="section-label"><Icons.punctuation size={14} />调试日志</div>
								{!config.enableLogging && (
									<p className="field-hint">开启「调试日志」后此处将显示运行日志</p>
								)}
								{config.enableLogging && (
									<div className="logs-container">
										{logs.length === 0 ? (
											<div className="empty-logs">
												<Icons.punctuation size={48} className="empty-icon" />
												<p>暂无日志记录</p>
											</div>
										) : (
											<div className="logs-list">
												{logs.map((log) => (
													<div key={log.id} className={`log-item log-${log.level}`}>
														<div className="log-header">
															<span className={`log-level log-level-${log.level}`}>
																{log.level === 'error' ? '✗' : log.level === 'warn' ? '⚠' : log.level === 'info' ? 'i' : '•'}
															</span>
															<span className="log-category">{log.category}</span>
															<span className="log-time">{new Date(log.timestamp).toLocaleString("zh-CN")}</span>
															<button
																className="log-copy-btn"
																onClick={() => handleCopyLog(log)}
																title="复制日志"
															>
																{copiedId === log.id ? <Icons.check size={12} /> : <Icons.copy size={12} />}
															</button>
														</div>
														<div className="log-message">{log.message}</div>
														{log.data && (
															<div className="log-data">
																<pre>{JSON.stringify(log.data, null, 2)}</pre>
															</div>
														)}
													</div>
												))}
											</div>
										)}
									</div>
								)}
							</div>
							<div className="config-section">
								<div className="section-label"><Icons.info size={14} />关于</div>
								<div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
									<div>版本：{__APP_VERSION__}</div>
								</div>
							</div>
						</>
					)}
					{activeTab === "data" && (
						<>
							<DataManagementSection />
							<APIUsageSection />
						</>
					)}
				</div>
				<div className="character-actions-fab-wrapper">
					<button className="btn" onClick={onClose}>
						<Icons.x size={18} />
						<span>关闭</span>
					</button>
					{(activeTab === "ai" || activeTab === "proofread" || activeTab === "tts" || activeTab === "dev") && (
						<button className="btn btn-primary" onClick={() => {
							onSave(config);
							onSavePrompt(promptState);
						}}>
							<Icons.save size={18} />
							<span>保存所有设置</span>
						</button>
					)}
					{activeTab === "proofread" && (
						<button className="btn" onClick={() => setPromptState(PROMPT_DEFAULTS)}>
							<Icons.reset size={18} />
							<span>恢复默认 Prompt</span>
						</button>
					)}
					{activeTab === "dev" && config.enableLogging && logs.length > 0 && (
						<>
							<button className="btn" onClick={handleCopyAllLogs}>
								{copiedId === "all" ? <Icons.check size={18} /> : <Icons.copy size={18} />}
								<span>{copiedId === "all" ? "已复制" : "复制全部"}</span>
							</button>
							<button className="btn" onClick={handleClearLogs}>
								<Icons.trash2 size={18} />
								<span>清空日志</span>
							</button>
						</>
					)}
				</div>
		</Modal>
	);
}

export function ConfigModal({ open, onClose }: Props) {
	const aiConfig = useAIConfigStore((s) => s.aiConfig);
	const setAIConfig = useAIConfigStore((s) => s.setAIConfig);
	const apiKeyMap = useAIConfigStore((s) => s.apiKeyMap);
	const setApiKeyForProvider = useAIConfigStore((s) => s.setApiKeyForProvider);
	const promptConfig = useConfigStore((s) => s.promptConfig);
	const setPromptConfig = useConfigStore((s) => s.setPromptConfig);

	const provider = detectProvider(aiConfig.baseURL);
	const initialConfig: ConfigState = {
		provider,
		baseUrl: aiConfig.baseURL,
		apiKey: apiKeyMap[provider] ?? aiConfig.apiKey,
		model: aiConfig.model,
		enableLogging: aiConfig.enableLogging,
		apiFormat: aiConfig.apiFormat ?? "openai",
	};

	const handleSave = useCallback((config: ConfigState) => {
		setApiKeyForProvider(config.provider, config.apiKey);
		setAIConfig({
			baseURL: config.baseUrl.replace(/\/+$/, ""),
			apiKey: config.apiKey,
			model: config.model,
			enableLogging: config.enableLogging,
			apiFormat: config.apiFormat,
		});
		onClose();
	}, [setApiKeyForProvider, setAIConfig, onClose]);

	const handleSavePrompt = useCallback((config: typeof promptConfig) => {
		setPromptConfig(config);
	}, [setPromptConfig]);

	if (!open) return null;

	return (
		<ConfigModalContent
			key={open ? "open" : "closed"}
			initialConfig={initialConfig}
			apiKeyMap={apiKeyMap}
			onSave={handleSave}
			onClose={onClose}
			promptConfig={promptConfig}
			onSavePrompt={handleSavePrompt}
		/>
	);
}
