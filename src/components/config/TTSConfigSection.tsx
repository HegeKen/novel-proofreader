import { useState } from "react";
import { useConfigStore } from "../../stores/configStore";
import { Icons } from "../Icons";
import { Select } from "../Select";
import { WordReplacementModal } from "../WordReplacementModal";

interface Props {
	onOpenWordReplacement?: () => void;
}

export function TTSConfigSection({ onOpenWordReplacement }: Props) {
	const ttsConfig = useConfigStore((s) => s.ttsConfig);
	const updateTTSConfig = useConfigStore((s) => s.updateTTSConfig);
	const [showApiKey, setShowApiKey] = useState(false);
	const [showWordReplacementModal, setShowWordReplacementModal] = useState(false);

	return (
		<>
			<div className="config-section">
				<div className="section-label"><Icons.volume size={14} />语音朗读 (TTS)</div>
				<p style={{ fontSize: "12px", color: "#666", marginBottom: "12px" }}>使用 Xiaomi MiMo TTS API 将文本转换为语音。</p>
				<form onSubmit={(e) => e.preventDefault()}>
					<div className="form-field">
						<label>MiMo API Key</label>
						<div className="input-wrapper">
							<input type={showApiKey ? "text" : "password"} value={ttsConfig.apiKey}
								onChange={(e) => updateTTSConfig({ apiKey: e.target.value })}
								placeholder="输入 MiMo API Key" className="config-input" autoComplete="new-password" />
							<button className="toggle-visibility-btn" onClick={() => setShowApiKey(!showApiKey)} type="button">
								{showApiKey ? <Icons.eyeOff size={16} /> : <Icons.eye size={16} />}
							</button>
						</div>
					</div>
				</form>
				<div className="form-field">
					<label>Base URL</label>
					<input type="text" value={ttsConfig.baseUrl}
						onChange={(e) => updateTTSConfig({ baseUrl: e.target.value })}
						placeholder="https://api.mimo-v2.com/v1" className="config-input" />
				</div>
				<div className="form-field">
					<label>音色</label>
					<Select value={ttsConfig.voice}
						onChange={(value) => updateTTSConfig({ voice: value })}
						options={[
							{ value: "冰糖", label: "冰糖" }, { value: "茉莉", label: "茉莉" },
							{ value: "苏打", label: "苏打" }, { value: "白桦", label: "白桦" },
							{ value: "Mia", label: "Mia" }, { value: "Chloe", label: "Chloe" },
							{ value: "Milo", label: "Milo" }, { value: "Dean", label: "Dean" }
						]} />
				</div>
				<div className="form-field">
					<label>语速 ({ttsConfig.speed})</label>
					<input type="range" min="1" max="10" value={ttsConfig.speed}
						onChange={(e) => updateTTSConfig({ speed: parseInt(e.target.value) })} className="config-range" />
				</div>
				<div className="form-field">
					<label>音量 ({ttsConfig.volume})</label>
					<input type="range" min="1" max="10" value={ttsConfig.volume}
						onChange={(e) => updateTTSConfig({ volume: parseInt(e.target.value) })} className="config-range" />
				</div>
				<a href="https://platform.xiaomimimo.com/docs/zh-CN/usage-guide/speech-synthesis-v2.5"
					target="_blank" rel="noopener noreferrer" style={{ fontSize: "12px", color: "var(--accent)" }}>
					获取 MiMo API Key →
				</a>
				<div className="divider"></div>
				<div className="section-label"><Icons.punctuation size={14} />敏感词替换</div>
				<p style={{ fontSize: "12px", color: "#666", marginBottom: "8px" }}>
					在请求 TTS 大模型前，会将文本中的敏感词替换为指定词组，用于规避敏感词拒绝生成的问题。
				</p>
				<div className="divider"></div>
				<div className="section-label"><Icons.cache size={14} />音频缓存设置</div>
				<div className="toggle-item">
					<label className="toggle-label">
						<div className="toggle-switch">
							<input type="checkbox" checked={ttsConfig.audioCacheEnabled}
								onChange={(e) => updateTTSConfig({ audioCacheEnabled: e.target.checked })} />
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
								<input type="checkbox" checked={ttsConfig.audioCachePersistent}
									onChange={(e) => updateTTSConfig({ audioCachePersistent: e.target.checked })} />
								<span className="toggle-slider"></span>
							</div>
							<span className="toggle-text">启用缓存持久化</span>
						</label>
						<span className="toggle-hint">缓存将保存到本地存储，重启后仍然有效</span>
					</div>
				)}
			</div>
			{!onOpenWordReplacement && (
				<WordReplacementModal open={showWordReplacementModal} onClose={() => setShowWordReplacementModal(false)} />
			)}
		</>
	);
}