import { useState } from "react";
import { useConfigStore } from "../../stores/configStore";
import { Icons } from "../Icons";
import { Select } from "../Select";
import { LocalTTSConfigSection } from "./LocalTTSConfigSection";
import { ExternalTTSConfigSection } from "./ExternalTTSConfigSection";


export function TTSConfigSection() {
	const ttsConfig = useConfigStore((s) => s.ttsConfig);
	const updateTTSConfig = useConfigStore((s) => s.updateTTSConfig);
	const [showApiKey, setShowApiKey] = useState(false);
	const isLocal = ttsConfig.provider === "local";
	const isExternal = ttsConfig.provider === "external";

	return (
		<div className="config-section">
			<div className="section-label"><Icons.volume size={14} />语音朗读 (TTS)</div>

			<div className="form-field">
				<label>语音引擎</label>
				<Select
					value={ttsConfig.provider}
					onChange={(value) => updateTTSConfig({ provider: value as "cloud" | "local" })}
					options={[
						{ value: "local", label: "本地内置模型（离线，无需 API Key）" },
						{ value: "external", label: "外部本地 TTS 服务（OpenAI 兼容）" },
						{ value: "cloud", label: "小米 MiMo 云端 TTS" },
					]}
				/>
				<span className="local-tts-hint">
					{isLocal
						? "使用应用内置的本地模型引擎，响应速度取决于电脑性能，不产生 API 费用。"
						: isExternal
							? "连接你自行运行的 OpenAI 兼容 TTS 服务；应用只调用 /v1/audio/speech，不包含任何模型特定代码。"
							: "使用 Xiaomi MiMo TTS API 将文本转换为语音，需要联网与 API Key。"}
				</span>
			</div>

			{isLocal ? (
				<LocalTTSConfigSection />
			) : isExternal ? (
				<ExternalTTSConfigSection />
			) : (
				<>
					<form onSubmit={(e) => e.preventDefault()}>
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
							placeholder="https://api.xiaomimimo.com/v1"
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
								{ value: "Dean", label: "Dean" },
							]}
						/>
					</div>
					<div className="form-field">
						<label>朗读方言{ttsConfig.dialect ? `（当前：${ttsConfig.dialect}）` : ""}</label>
						<Select
							value={ttsConfig.dialect}
							onChange={(value) => updateTTSConfig({ dialect: value })}
							options={[
								{ value: "", label: "普通话（无方言）" },
								{ value: "粤语", label: "粤语" },
								{ value: "东北话", label: "东北话" },
								{ value: "四川话", label: "四川话" },
								{ value: "河南话", label: "河南话" },
								{ value: "陕西话", label: "陕西话" },
								{ value: "台湾腔", label: "台湾腔" },
								{ value: "吴语", label: "吴语" },
								{ value: "湘语", label: "湘语" },
								{ value: "赣语", label: "赣语" },
								{ value: "客家话", label: "客家话" },
								{ value: "闽语", label: "闽语" },
							]}
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
				</>
			)}

			<div className="local-tts-hint" style={{ marginTop: 4 }}>
				段落情绪与朗读标签的生成方式（AI 大模型 / 本地离线模型）在「情感分析」标签中配置。
			</div>

			<div className="form-field" style={{ marginTop: isLocal ? 12 : 0 }}>
				<label>
					语速 ({ttsConfig.speed}){" "}
					<span className="label-hint">
						{isLocal || isExternal
							? "（通过播放倍率实现，5=原速）"
							: "（5=日常对话自然语速，3=舒缓叙述，7=激动急切）"}
					</span>
				</label>
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

			<div className="divider"></div>
			<div className="section-label"><Icons.cache size={14} />音频缓存设置</div>
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
