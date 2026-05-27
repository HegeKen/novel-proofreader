// ============================================================
// AI 模型配置弹窗 - 紧凑设计
// ============================================================
import { useState, useCallback } from "react";
import { useAppStore } from "../stores/appStore";
import { useConfigStore } from "../stores/configStore";
import type { AIProvider } from "../types";
import { Icons } from "./Icons";
import { Select } from "./Select";
import { formatLargeNumber } from "../utils/formatters";
import {
	PROOFREAD_SYSTEM_PROMPT,
	PROOFREAD_SYSTEM_PROMPT_CHAPTER,
	SCRIPT_SYSTEM_PROMPT,
	SCRIPT_TTS_ENHANCE_SYSTEM_PROMPT,
	NOVEL_TTS_ENHANCE_SYSTEM_PROMPT,
	READING_MODE_TTS_ENHANCE_SYSTEM_PROMPT,
} from "../utils/aiClient";

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

				<div className="usage-stat-card tokens">
					<div className="usage-stat-header">
						<div className="usage-stat-icon">
							<Icons.barChart3 size={16} />
						</div>
					</div>
					<div className="usage-stat-value">{formatLargeNumber(apiUsage.totalTokens)}</div>
					<div className="usage-stat-label">Token 使用量</div>
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

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
	};

	return (
		<div className="config-section">
			<div className="section-label">
				<Icons.volume size={14} />
				语音朗读 (TTS)
			</div>
			<p style={{ fontSize: "12px", color: "#666", marginBottom: "12px" }}>
				使用 Xiaomi MiMo TTS API 将文本转换为语音。
			</p>

			<form onSubmit={handleSubmit}>
				<div className="form-field">
					<label>MiMo API Key</label>
					<div className="input-wrapper">
						<input
							type={showApiKey ? "text" : "password"}
							value={ttsConfig.apiKey}
							onChange={(e) => updateTTSConfig({ apiKey: e.target.value })}
							placeholder="输入 MiMo API Key"
							className="config-input"
							autoComplete="new-password"
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
			</form>

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
						{ value: "冰糖", label: "冰糖" },
						{ value: "茉莉", label: "茉莉" },
						{ value: "苏打", label: "苏打" },
						{ value: "白桦", label: "白桦" },
						{ value: "Mia", label: "Mia" },
						{ value: "Chloe", label: "Chloe" },
						{ value: "Milo", label: "Milo" },
						{ value: "Dean", label: "Dean" }
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

			<div className="divider"></div>

			<div className="section-label">
				<Icons.cache size={14} />
				音频缓存设置
			</div>

			<div className="toggle-item">
				<label className="toggle-label">
					<div className="toggle-switch">
						<input
							type="checkbox"
							checked={ttsConfig.audioCacheEnabled}
							onChange={(e) => updateTTSConfig({ audioCacheEnabled: e.target.checked })}
						/>
						<span className="toggle-slider"></span>
					</div>
					<span className="toggle-text">启用音频缓存</span>
				</label>
				<span className="toggle-hint">启用后，已生成的音频将被缓存，避免重复请求</span>
			</div>

			{ttsConfig.audioCacheEnabled && (
				<div className="toggle-item">
					<label className="toggle-label">
						<div className="toggle-switch">
							<input
								type="checkbox"
								checked={ttsConfig.audioCachePersistent}
								onChange={(e) => updateTTSConfig({ audioCachePersistent: e.target.checked })}
							/>
							<span className="toggle-slider"></span>
						</div>
						<span className="toggle-text">启用缓存持久化</span>
					</label>
					<span className="toggle-hint">缓存将保存到本地存储，重启后仍然有效</span>
				</div>
			)}
		</div>
	);
}

// PROMPT 设置组件
function PromptSettingsSection({
	initialPromptConfig,
	onSave,
}: {
	initialPromptConfig: {
		proofread: string;
		proofreadChapter: string;
		script: string;
		scriptTts: string;
		novelTts: string;
		readingModeTts: string;
	};
	onSave: (config: typeof initialPromptConfig) => void;
}) {
	const [prompts, setPrompts] = useState({
		proofread: initialPromptConfig.proofread || PROOFREAD_SYSTEM_PROMPT,
		proofreadChapter: initialPromptConfig.proofreadChapter || PROOFREAD_SYSTEM_PROMPT_CHAPTER,
		script: initialPromptConfig.script || SCRIPT_SYSTEM_PROMPT,
		scriptTts: initialPromptConfig.scriptTts || SCRIPT_TTS_ENHANCE_SYSTEM_PROMPT,
		novelTts: initialPromptConfig.novelTts || NOVEL_TTS_ENHANCE_SYSTEM_PROMPT,
		readingModeTts: initialPromptConfig.readingModeTts || READING_MODE_TTS_ENHANCE_SYSTEM_PROMPT,
	});

	const handleCopy = async (text: string, label: string) => {
		try {
			await navigator.clipboard.writeText(text);
			console.log(`已复制: ${label}`);
		} catch (err) {
			console.error('复制失败:', err);
		}
	};

	const handleReset = (key: keyof typeof prompts, defaultValue: string) => {
		setPrompts((prev) => ({ ...prev, [key]: defaultValue }));
	};

	const handleSave = () => {
		onSave(prompts);
	};

	return (
		<div className="config-section prompt-section">
			<div className="section-label">
				<Icons.punctuation size={14} />
				PROMPT 设置
			</div>

			<div className="prompt-item">
				<div className="prompt-header">
					<label className="prompt-label">校对系统 Prompt（段落级别）</label>
					<div className="prompt-actions">
						<button
							className="prompt-btn"
							onClick={() => handleCopy(prompts.proofread, '校对系统 Prompt')}
							title="复制"
						>
							<Icons.copy size={14} />
						</button>
						<button
							className="prompt-btn"
							onClick={() => handleReset('proofread', PROOFREAD_SYSTEM_PROMPT)}
							title="重置"
						>
							<Icons.reset size={14} />
						</button>
					</div>
				</div>
				<textarea
					className="prompt-textarea"
					value={prompts.proofread}
					onChange={(e) => setPrompts((prev) => ({ ...prev, proofread: e.target.value }))}
					rows={6}
				/>
				<p className="prompt-hint">用于逐段落校对检测</p>
			</div>

			<div className="prompt-item">
				<div className="prompt-header">
					<label className="prompt-label">校对系统 Prompt（章节级别）</label>
					<div className="prompt-actions">
						<button
							className="prompt-btn"
							onClick={() => handleCopy(prompts.proofreadChapter, '校对系统 Prompt (章节)')}
							title="复制"
						>
							<Icons.copy size={14} />
						</button>
						<button
							className="prompt-btn"
							onClick={() => handleReset('proofreadChapter', PROOFREAD_SYSTEM_PROMPT_CHAPTER)}
							title="重置"
						>
							<Icons.reset size={14} />
						</button>
					</div>
				</div>
				<textarea
					className="prompt-textarea"
					value={prompts.proofreadChapter}
					onChange={(e) => setPrompts((prev) => ({ ...prev, proofreadChapter: e.target.value }))}
					rows={6}
				/>
				<p className="prompt-hint">用于整章节批量校对检测</p>
			</div>

			<div className="prompt-item">
				<div className="prompt-header">
					<label className="prompt-label">剧本转换系统 Prompt</label>
					<div className="prompt-actions">
						<button
							className="prompt-btn"
							onClick={() => handleCopy(prompts.script, '剧本转换 Prompt')}
							title="复制"
						>
							<Icons.copy size={14} />
						</button>
						<button
							className="prompt-btn"
							onClick={() => handleReset('script', SCRIPT_SYSTEM_PROMPT)}
							title="重置"
						>
							<Icons.reset size={14} />
						</button>
					</div>
				</div>
				<textarea
					className="prompt-textarea"
					value={prompts.script}
					onChange={(e) => setPrompts((prev) => ({ ...prev, script: e.target.value }))}
					rows={8}
				/>
				<p className="prompt-hint">用于将小说转换为剧本格式</p>
			</div>

			<div className="prompt-item">
				<div className="prompt-header">
					<label className="prompt-label">剧本 TTS 情感增强 Prompt</label>
					<div className="prompt-actions">
						<button
							className="prompt-btn"
							onClick={() => handleCopy(prompts.scriptTts, '剧本 TTS 增强 Prompt')}
							title="复制"
						>
							<Icons.copy size={14} />
						</button>
						<button
							className="prompt-btn"
							onClick={() => handleReset('scriptTts', SCRIPT_TTS_ENHANCE_SYSTEM_PROMPT)}
							title="重置"
						>
							<Icons.reset size={14} />
						</button>
					</div>
				</div>
				<textarea
					className="prompt-textarea"
					value={prompts.scriptTts}
					onChange={(e) => setPrompts((prev) => ({ ...prev, scriptTts: e.target.value }))}
					rows={8}
				/>
				<p className="prompt-hint">用于为剧本对话添加情感/音色标注</p>
			</div>

			<div className="prompt-item">
				<div className="prompt-header">
					<label className="prompt-label">小说 TTS 情感增强 Prompt</label>
					<div className="prompt-actions">
						<button
							className="prompt-btn"
							onClick={() => handleCopy(prompts.novelTts, '小说 TTS 增强 Prompt')}
							title="复制"
						>
							<Icons.copy size={14} />
						</button>
						<button
							className="prompt-btn"
							onClick={() => handleReset('novelTts', NOVEL_TTS_ENHANCE_SYSTEM_PROMPT)}
							title="重置"
						>
							<Icons.reset size={14} />
						</button>
					</div>
				</div>
				<textarea
					className="prompt-textarea"
					value={prompts.novelTts}
					onChange={(e) => setPrompts((prev) => ({ ...prev, novelTts: e.target.value }))}
					rows={8}
				/>
				<p className="prompt-hint">用于为小说章节添加情感/音色标注</p>
			</div>

			<div className="prompt-item">
				<div className="prompt-header">
					<label className="prompt-label">阅读模式 TTS 增强 Prompt</label>
					<div className="prompt-actions">
						<button
							className="prompt-btn"
							onClick={() => handleCopy(prompts.readingModeTts, '阅读模式 TTS 增强 Prompt')}
							title="复制"
						>
							<Icons.copy size={14} />
						</button>
						<button
							className="prompt-btn"
							onClick={() => handleReset('readingModeTts', READING_MODE_TTS_ENHANCE_SYSTEM_PROMPT)}
							title="重置"
						>
							<Icons.reset size={14} />
						</button>
					</div>
				</div>
				<textarea
					className="prompt-textarea"
					value={prompts.readingModeTts}
					onChange={(e) => setPrompts((prev) => ({ ...prev, readingModeTts: e.target.value }))}
					rows={6}
				/>
				<p className="prompt-hint">用于阅读模式下分析段落、识别人物、判断情绪</p>
			</div>

			<button className="prompt-save-btn" onClick={handleSave}>
				<Icons.save size={14} />
				保存 PROMPT 设置
			</button>
		</div>
	);
}

// 内部组件，使用 key 重置状态
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
	promptConfig: {
		proofread: string;
		proofreadChapter: string;
		script: string;
		scriptTts: string;
		novelTts: string;
		readingModeTts: string;
	};
	onSavePrompt: (config: typeof promptConfig) => void;
}) {
	const [config, setConfig] = useState<ConfigState>(initialConfig);
	const [showApiKey, setShowApiKey] = useState(false);
	const [activeTab, setActiveTab] = useState<"model" | "prompt">("model");

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
						<span>AI 配置</span>
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

				{/* Tab 切换 */}
				<div className="config-tabs">
					<button
						className={`tab-btn ${activeTab === "model" ? "active" : ""}`}
						onClick={() => setActiveTab("model")}
					>
						<Icons.saveOriginal size={14} />
						大模型配置
					</button>
					<button
						className={`tab-btn ${activeTab === "prompt" ? "active" : ""}`}
						onClick={() => setActiveTab("prompt")}
					>
						<Icons.punctuation size={14} />
						PROMPT 设置
					</button>
				</div>

				<div className="config-body">
					{activeTab === "model" && (
						<>
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

								<form onSubmit={(e) => e.preventDefault()}>
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
												autoComplete="new-password"
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
								</form>

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
						</>
					)}

					{activeTab === "prompt" && (
						<PromptSettingsSection
							initialPromptConfig={promptConfig}
							onSave={onSavePrompt}
						/>
					)}
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
	const promptConfig = useConfigStore((s) => s.promptConfig);
	const setPromptConfig = useConfigStore((s) => s.setPromptConfig);

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

	// 保存 PROMPT 配置的回调
	const handleSavePrompt = useCallback(
		(config: typeof promptConfig) => {
			setPromptConfig(config);
		},
		[setPromptConfig],
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
			promptConfig={promptConfig}
			onSavePrompt={handleSavePrompt}
		/>
	);
}
