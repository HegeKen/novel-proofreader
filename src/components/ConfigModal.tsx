import { useState, useCallback, useMemo } from "react";
import { useAIConfigStore } from "../stores/aiConfigStore";
import { useConfigStore } from "../stores/configStore";
import type { AIProvider } from "../types";
import { Icons } from "./Icons";
import { AITestSection } from "./config/AITestSection";
import { APIUsageSection } from "./config/APIUsageSection";
import { ProofreadSettingsSection } from "./config/ProofreadSettingsSection";
import { TTSConfigSection } from "./config/TTSConfigSection";
import { DataManagementSection } from "./config/DataManagementSection";
import { PromptSettingsSection } from "./config/PromptSettingsSection";
import { getLogHistory, clearLogHistory, type LogEntry } from "../utils/logger";

const PROVIDERS: { value: AIProvider; label: string; logo: string; color: string }[] = [
	{ value: "openai", label: "OpenAI", logo: "https://avatars.githubusercontent.com/u/14957082?s=200&v=4", color: "#0ea561" },
	{ value: "deepseek", label: "DeepSeek", logo: "https://sf-maas-uat-prod.oss-cn-shanghai.aliyuncs.com/Model_LOGO/DeepSeek.svg", color: "#0ea561" },
	{ value: "siliconflow", label: "SiliconFlow", logo: "https://siliconflow.cn/logo-new.svg", color: "#0ea561" },
	{ value: "mimo", label: "Xiaomi MiMo", logo: "https://aistudio.xiaomimimo.com/favicon.0619b0d2.png", color: "#0ea561" },
	{ value: "lmstudio", label: "LM Studio", logo: "https://lm-studio.cn/_next/static/media/lmstudio-app-logo.11b4d746.webp", color: "#0ea561" },
	{ value: "ollama", label: "Ollama", logo: "https://ollama.com/public/ollama.png", color: "#0ea561" },
	{ value: "vllm", label: "VLLM", logo: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%236b7280" stroke-width="2"%3E%3Cpath d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/%3E%3C/svg%3E', color: "#0ea561" },
	{ value: "custom", label: "自定义", logo: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="%236b7280" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"%3E%3C/path%3E%3Ccircle cx="12" cy="12" r="3"%3E%3C/circle%3E%3C/svg%3E', color: "#0ea561" },
];

const PRESETS: Record<AIProvider, { baseUrl: string; model: string }> = {
	openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o" },
	deepseek: { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
	siliconflow: { baseUrl: "https://api.siliconflow.cn/v1", model: "deepseek-ai/DeepSeek-V3" },
	mimo: { baseUrl: "https://api.xiaomimimo.com/v1", model: "mimo-v2-flash" },
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
}

const detectProvider = (url: string): AIProvider => {
	if (url.includes("deepseek")) return "deepseek";
	if (url.includes("openai")) return "openai";
	if (url.includes("siliconflow")) return "siliconflow";
	if (url.includes("xiaomimimo")) return "mimo";
	if (url.includes("localhost:1234") || url.includes("127.0.0.1:1234")) return "lmstudio";
	if (url.includes("localhost:11434") || url.includes("127.0.0.1:11434")) return "ollama";
	if (url.includes("localhost:8000") || url.includes("127.0.0.1:8000")) return "vllm";
	return "custom";
};

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
	promptConfig: { proofread: string; proofreadChapter: string; script: string; scriptTts: string; novelTts: string; readingModeTts: string; chapterTitle: string; characterReanalysis: string };
	onSavePrompt: (config: typeof promptConfig) => void;
}) {
	const [config, setConfig] = useState<ConfigState>(initialConfig);
	const [showApiKey, setShowApiKey] = useState(false);
	const [activeTab, setActiveTab] = useState<"ai" | "tts" | "settings" | "prompt" | "logs">("ai");
	const [logRefresh, setLogRefresh] = useState(0);
	const logs = useMemo(() => {
		void logRefresh;
		return config.enableLogging ? getLogHistory() : [];
	}, [config.enableLogging, logRefresh]);
	const [copiedId, setCopiedId] = useState<string | null>(null);

	const handleCopyLog = useCallback(async (log: LogEntry) => {
		const logText = `[${new Date(log.timestamp).toLocaleString("zh-CN")}] [${log.level.toUpperCase()}] [${log.category}] ${log.message}${log.data ? "\n" + JSON.stringify(log.data, null, 2) : ""}`;
		try {
			await navigator.clipboard.writeText(logText);
			setCopiedId(log.id);
			setTimeout(() => setCopiedId(null), 2000);
		} catch (err) {
			console.error("复制日志失败:", err);
		}
	}, []);

	const handleCopyAllLogs = useCallback(async () => {
		const allLogs = logs.map(log => `[${new Date(log.timestamp).toLocaleString("zh-CN")}] [${log.level.toUpperCase()}] [${log.category}] ${log.message}${log.data ? "\n" + JSON.stringify(log.data, null, 2) : ""}`).join("\n\n");
		try {
			await navigator.clipboard.writeText(allLogs);
			setCopiedId("all");
			setTimeout(() => setCopiedId(null), 2000);
		} catch (err) {
			console.error("复制所有日志失败:", err);
		}
	}, [logs]);

	const handleClearLogs = useCallback(() => {
		clearLogHistory();
		setLogRefresh((prev) => prev + 1);
	}, []);

	const handleProviderChange = useCallback((p: AIProvider) => {
		setConfig((prev) => {
			if (prev.provider === p) return prev;
			return { ...prev, provider: p, baseUrl: PRESETS[p].baseUrl, model: PRESETS[p].model, apiKey: apiKeyMap[p] ?? "" };
		});
	}, [apiKeyMap]);

	return (
		<div className="modal-overlay" onClick={onClose}>
			<div className="config-modal" onClick={(e) => e.stopPropagation()}>
				<div className="config-header">
					<div className="config-title">
						<span className="title-icon"><Icons.settings size={16} /></span>
						<span>AI 配置</span>
					</div>
					<button className="close-btn" onClick={onClose}>
						<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
							<path d="M3 3L13 13M13 3L3 13" />
						</svg>
					</button>
				</div>
				<div className="config-tabs">
					{([["ai", "AI 配置", Icons.saveOriginal], ["tts", "TTS 配置", Icons.volume], ["settings", "设置", Icons.settings], ["prompt", "PROMPT", Icons.punctuation]] as const).map(([tab, label, Icon]) => (
						<button key={tab} className={`tab-btn ${activeTab === tab ? "active" : ""}`} onClick={() => setActiveTab(tab)}>
							<Icon size={14} />{label}
						</button>
					))}
					{config.enableLogging && (
						<button key="logs" className={`tab-btn ${activeTab === "logs" ? "active" : ""}`} onClick={() => setActiveTab("logs")}>
							<Icons.punctuation size={14} />日志
						</button>
					)}
				</div>
				<div className="config-body">
					{activeTab === "ai" && (
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
											placeholder="deepseek-chat" className="config-input" />
									</div>
								</div>
							</div>
							<AITestSection config={config} />
						</>
					)}
					{activeTab === "tts" && <TTSConfigSection />}
					{activeTab === "settings" && (
						<>
							<ProofreadSettingsSection />
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
							<APIUsageSection />
							<DataManagementSection />
						</>
					)}
					{activeTab === "prompt" && (
						<PromptSettingsSection initialPromptConfig={promptConfig} onSave={onSavePrompt} />
					)}
					{activeTab === "logs" && (
						<div className="config-section">
							<div className="section-header">
								<div className="section-label"><Icons.punctuation size={14} />调试日志</div>
								<div className="section-actions">
									<button className="btn btn-sm" onClick={handleCopyAllLogs}>
										{copiedId === "all" ? <Icons.check size={14} /> : <Icons.copy size={14} />}
										{copiedId === "all" ? "已复制" : "复制全部"}
									</button>
									<button className="btn btn-sm btn-secondary" onClick={handleClearLogs}>
										<Icons.trash2 size={14} />清空
									</button>
								</div>
							</div>
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
						</div>
					)}
				</div>
				<div className="config-footer">
					<button className="btn-cancel" onClick={onClose}>取消</button>
					<button className="btn-save" onClick={() => onSave(config)}>保存配置</button>
				</div>
			</div>
		</div>
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
	};

	const handleSave = useCallback((config: ConfigState) => {
		setApiKeyForProvider(config.provider, config.apiKey);
		setAIConfig({ baseURL: config.baseUrl.replace(/\/+$/, ""), apiKey: config.apiKey, model: config.model, enableLogging: config.enableLogging });
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
