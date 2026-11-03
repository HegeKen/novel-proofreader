// ============================================================
// 外部 OpenAI 兼容 TTS 服务配置
// 适用于任何提供 POST /v1/audio/speech 的本地/局域网服务。
// ============================================================
import { useCallback, useState } from "react";
import { useConfigStore } from "../../stores/configStore";
import { useUIStore } from "../../stores/uiStore";
import { localPlaybackRate, synthesizeExternalSpeech } from "../../utils/localTts";
import { applyWordReplacements } from "../../utils/textReplace";
import { playAudio } from "../../utils/ttsService";
import { Icons } from "../Icons";
import { Select } from "../Select";
import { TTS_LANGUAGE_OPTIONS } from "./ttsLanguageOptions";

function errText(err: unknown): string {
	if (err instanceof Error) return err.message;
	if (typeof err === "string") return err;
	return JSON.stringify(err);
}

export function ExternalTTSConfigSection() {
	const ttsConfig = useConfigStore((s) => s.ttsConfig);
	const updateTTSConfig = useConfigStore((s) => s.updateTTSConfig);
	const showToast = useUIStore((s) => s.showToast);
	const [showKey, setShowKey] = useState(false);
	const [testing, setTesting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [testText, setTestText] = useState("这是一段外部语音服务朗读测试。");
	const replacedPreview = applyWordReplacements(testText);

	const handleTest = useCallback(async () => {
		if (testing) return;
		setTesting(true);
		setError(null);
		try {
			const buffer = await synthesizeExternalSpeech(
				testText,
				useConfigStore.getState().ttsConfig,
			);
			await playAudio(buffer, undefined, {
				playbackRate: localPlaybackRate(ttsConfig.speed),
				volume: Math.min(1, Math.max(0.05, ttsConfig.volume / 10)),
			});
			showToast("外部 TTS 服务连接正常", "success");
		} catch (err) {
			const msg = errText(err);
			setError(msg);
			showToast(msg, "error", 8000);
		} finally {
			setTesting(false);
		}
	}, [testing, showToast, ttsConfig.speed, ttsConfig.volume, testText]);

	const endpoint = ttsConfig.externalTtsBaseUrl.trim()
		? `${ttsConfig.externalTtsBaseUrl.trim().replace(/\/+$/, "")}/audio/speech`
		: "（请填写服务地址）";

	return (
		<div className="local-tts-section">
			<p className="section-hint">
				连接任意 OpenAI 兼容的本地 TTS 服务（需提供 <code>POST /v1/audio/speech</code>）。
				应用不内置该服务的模型或解码逻辑，只负责逐句请求与播放。
				<br />
				注意：LM Studio 等只提供 <code>/v1/completions</code> 文本接口的运行时不能直接作为 TTS 服务；
				还需要一个独立的音频解码服务来暴露 <code>/v1/audio/speech</code>。
			</p>

			{error && (
				<div className="local-tts-error">
					<Icons.alertCircle size={14} />
					<span>{error}</span>
				</div>
			)}

			<div className="form-field">
				<label>服务地址</label>
				<input
					type="text"
					className="config-input"
					value={ttsConfig.externalTtsBaseUrl}
					onChange={(e) => updateTTSConfig({ externalTtsBaseUrl: e.target.value })}
					placeholder="http://127.0.0.1:5005/v1"
				/>
				<span className="local-tts-hint">实际请求：{endpoint}</span>
			</div>

			<div className="form-field">
				<label>API Key（可选）</label>
				<div className="input-wrapper">
					<input
						type={showKey ? "text" : "password"}
						className="config-input"
						value={ttsConfig.externalTtsApiKey}
						onChange={(e) => updateTTSConfig({ externalTtsApiKey: e.target.value })}
						placeholder="留空则不携带 Authorization"
						autoComplete="new-password"
					/>
					<button className="toggle-visibility-btn" onClick={() => setShowKey(!showKey)} type="button">
						{showKey ? <Icons.eyeOff size={16} /> : <Icons.eye size={16} />}
					</button>
				</div>
			</div>

			<div className="form-field">
				<label>模型名（可选）</label>
				<input
					type="text"
					className="config-input"
					value={ttsConfig.externalTtsModel}
					onChange={(e) => updateTTSConfig({ externalTtsModel: e.target.value })}
					placeholder="透传给服务的 model 字段，留空则由服务决定"
				/>
			</div>

			<div className="form-field">
				<label>默认/旁白音色</label>
				<input
					type="text"
					className="config-input"
					value={ttsConfig.externalTtsVoice}
					onChange={(e) => updateTTSConfig({ externalTtsVoice: e.target.value })}
					placeholder="透传给服务的 voice 字段，例如 长乐"
				/>
				<span className="local-tts-hint">普通朗读与旁白使用；未匹配到角色性别时也使用此音色。</span>
			</div>

			<div className="form-field">
				<label>男性角色音色</label>
				<input
					type="text"
					className="config-input"
					value={ttsConfig.externalTtsMaleVoice}
					onChange={(e) => updateTTSConfig({ externalTtsMaleVoice: e.target.value })}
					placeholder="长乐"
				/>
			</div>

			<div className="form-field">
				<label>女性角色音色</label>
				<input
					type="text"
					className="config-input"
					value={ttsConfig.externalTtsFemaleVoice}
					onChange={(e) => updateTTSConfig({ externalTtsFemaleVoice: e.target.value })}
					placeholder="白芷"
				/>
				<span className="local-tts-hint">
					情感朗读时会根据角色设置中的性别自动选择男/女音色；未设置性别的角色使用默认音色。
				</span>
			</div>

			<div className="toggle-item">
				<label className="toggle-label">
					<div className="toggle-switch">
						<input
							type="checkbox"
							checked={ttsConfig.externalTtsEmotionTags}
							onChange={(e) => updateTTSConfig({ externalTtsEmotionTags: e.target.checked })}
						/>
						<span className="toggle-slider"></span>
					</div>
					<span className="toggle-text">透传情感标签</span>
				</label>
				<span className="toggle-hint">
					保留正文中的 &lt;laugh&gt;、&lt;sigh&gt;、&lt;chuckle&gt;、&lt;cough&gt;、&lt;sniffle&gt;、&lt;groan&gt;、&lt;yawn&gt;、&lt;gasp&gt; 等标签，交给支持该语法的服务处理。关闭后会移除这些标签。
				</span>
			</div>

			<div className="form-field">
				<label>音色/风格描述（可选）</label>
				<textarea
					className="config-input local-tts-instruct"
					rows={2}
					value={ttsConfig.externalTtsInstructions}
					onChange={(e) => updateTTSConfig({ externalTtsInstructions: e.target.value })}
					placeholder="如果服务支持 instructions 字段，可在此填写；不支持时会被忽略"
				/>
			</div>

			<div className="form-field">
				<label>合成语言</label>
				<Select
					value={ttsConfig.externalTtsLanguage}
					onChange={(value) => updateTTSConfig({ externalTtsLanguage: value })}
					options={TTS_LANGUAGE_OPTIONS}
				/>
			</div>

			<div className="form-field">
				<label>试听文本</label>
				<input
					type="text"
					className="config-input"
					value={testText}
					onChange={(e) => setTestText(e.target.value)}
					placeholder="输入包含敏感词或情感标签的测试文本"
				/>
				<span className="local-tts-hint">
					替换后实际发送：{replacedPreview || "（空）"}
				</span>
			</div>

			<div className="local-tts-actions">
				<button type="button" className="btn btn-primary" onClick={handleTest} disabled={testing}>
					<Icons.volume size={14} />
					{testing ? "合成中…" : "测试并试听"}
				</button>
			</div>

			<div className="local-tts-hint local-tts-advanced">
				支持返回 WAV / MP3 / OGG 等浏览器可播放的音频格式；请求超时 120 秒。
			</div>
		</div>
	);
}
