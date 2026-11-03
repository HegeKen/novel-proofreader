// ============================================================
// 本地 TTS：Qwen3-TTS VoiceDesign（CrispASR）
// 用自然语言描述音色，不需要参考音频。
// ============================================================
import { useCallback, useEffect, useRef, useState } from "react";
import { useConfigStore } from "../../stores/configStore";
import { useUIStore } from "../../stores/uiStore";
import type { TTSConfig } from "../../types";
import {
	downloadVoiceDesignModel,
	ensureVoiceDesignServer,
	formatBytes,
	getVoiceDesignStatus,
	installCrispAsrRuntime,
	isTauriRuntime,
	listenVoiceDesignDownloadProgress,
	localPlaybackRate,
	stopVoiceDesignServer,
	synthesizeLocalSpeech,
	type VoiceDesignDownloadProgress,
	type VoiceDesignStatus,
} from "../../utils/localTts";
import { playAudio } from "../../utils/ttsService";
import { Icons } from "../Icons";
import { Select } from "../Select";
import { TTS_LANGUAGE_OPTIONS } from "./ttsLanguageOptions";

type BusyAction = "start" | "stop" | "talker" | "codec" | "runtime" | "test" | null;

const INSTRUCT_PRESETS = [
	{ label: "温柔女声", value: "温柔、清澈的年轻女性声音，语速舒缓，适合小说叙述。" },
	{ label: "沉稳男声", value: "低沉、沉稳的中年男性声音，语速适中，适合历史与悬疑叙述。" },
	{ label: "少年音", value: "清亮、活泼的少年声音，语气自然，略带朝气。" },
	{ label: "纪录片旁白", value: "专业纪录片旁白，声音厚实、吐字清晰、节奏平稳。" },
	{ label: "评书", value: "传统评书先生，声音洪亮、抑扬顿挫、富有戏剧张力。" },
];

function errText(err: unknown): string {
	if (err instanceof Error) return err.message;
	if (typeof err === "string") return err;
	return JSON.stringify(err);
}

function PathRow({
	value,
	placeholder,
	onChange,
	onPick,
	onBlur,
}: {
	value: string;
	placeholder: string;
	onChange: (value: string) => void;
	onPick?: () => void;
	onBlur?: () => void;
}) {
	return (
		<div className="local-tts-path-row">
			<input
				type="text"
				className="config-input"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				onBlur={onBlur}
				placeholder={placeholder}
				title={value}
			/>
			{onPick && (
				<button type="button" className="btn local-tts-pick-btn" onClick={onPick}>
					<Icons.import size={14} />
					选择
				</button>
			)}
		</div>
	);
}

function StatusItem({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
	return (
		<div className="local-tts-status-row">
			<span className={`local-tts-status-dot ${ok ? "ok" : "missing"}`} />
			<span className="local-tts-status-label">{label}</span>
			<span className="local-tts-status-detail" title={detail}>
				{detail || (ok ? "已就绪" : "未检测到")}
			</span>
		</div>
	);
}

export function VoiceDesignTTSConfigSection() {
	const ttsConfig = useConfigStore((s) => s.ttsConfig);
	const updateTTSConfig = useConfigStore((s) => s.updateTTSConfig);
	const showToast = useUIStore((s) => s.showToast);

	const [status, setStatus] = useState<VoiceDesignStatus | null>(null);
	const [busy, setBusy] = useState<BusyAction>(null);
	const [progress, setProgress] = useState<VoiceDesignDownloadProgress | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const didAutoDetect = useRef(false);

	const refresh = useCallback(async () => {
		if (!isTauriRuntime()) return;
		setStatus(await getVoiceDesignStatus(useConfigStore.getState().ttsConfig));
	}, []);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			const latest = await getVoiceDesignStatus(useConfigStore.getState().ttsConfig);
			if (cancelled) return;
			setStatus(latest);
			if (didAutoDetect.current || !latest) return;
			didAutoDetect.current = true;
			const cfg = useConfigStore.getState().ttsConfig;
			const patch: Partial<TTSConfig> = {};
			if (!cfg.voiceDesignModelPath && latest.model_path) patch.voiceDesignModelPath = latest.model_path;
			if (!cfg.voiceDesignCodecPath && latest.codec_path) patch.voiceDesignCodecPath = latest.codec_path;
			if (!cfg.voiceDesignBinaryPath && latest.binary_path) patch.voiceDesignBinaryPath = latest.binary_path;
			if (Object.keys(patch).length > 0) {
				updateTTSConfig(patch);
				setStatus(await getVoiceDesignStatus(useConfigStore.getState().ttsConfig));
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [updateTTSConfig]);

	useEffect(() => {
		let unlisten: (() => void) | undefined;
		listenVoiceDesignDownloadProgress((p) => setProgress(p)).then((fn) => {
			unlisten = fn;
		});
		return () => unlisten?.();
	}, []);

	const runAction = useCallback(
		async (action: Exclude<BusyAction, null>, fn: () => Promise<void>) => {
			if (busy) return;
			setBusy(action);
			setActionError(null);
			try {
				await fn();
			} catch (err) {
				const msg = errText(err);
				setActionError(msg);
				showToast(msg, "error", 8000);
			} finally {
				setBusy(null);
				setProgress(null);
			}
		},
		[busy, showToast],
	);

	const pickFile = useCallback(
		async (
			extensions: string[],
			name: string,
			onSelected: (path: string) => Promise<void> | void,
		) => {
			try {
				const { open } = await import("@tauri-apps/plugin-dialog");
				const selected = await open({
					multiple: false,
					...(extensions.length > 0 ? { filters: [{ name, extensions }] } : {}),
				});
				if (typeof selected === "string") await onSelected(selected);
			} catch {
				showToast("无法打开文件选择器", "error");
			}
		},
		[showToast],
	);

	const handlePickModel = useCallback(
		() =>
			pickFile(["gguf"], "VoiceDesign talker GGUF", async (path) => {
				updateTTSConfig({ voiceDesignModelPath: path });
				setStatus(await getVoiceDesignStatus({ ...useConfigStore.getState().ttsConfig, voiceDesignModelPath: path }));
			}),
		[pickFile, updateTTSConfig],
	);

	const handlePickCodec = useCallback(
		() =>
			pickFile(["gguf"], "tokenizer / codec GGUF", (path) => {
				updateTTSConfig({ voiceDesignCodecPath: path });
				void refresh();
			}),
		[pickFile, updateTTSConfig, refresh],
	);

	const handlePickBinary = useCallback(
		() =>
			pickFile([], "crispasr 可执行文件", (path) => {
				updateTTSConfig({ voiceDesignBinaryPath: path });
				void refresh();
			}),
		[pickFile, updateTTSConfig, refresh],
	);

	const handleDownload = useCallback(
		(kind: "talker" | "codec") =>
			runAction(kind, async () => {
				const path = await downloadVoiceDesignModel(kind);
				updateTTSConfig(kind === "talker" ? { voiceDesignModelPath: path } : { voiceDesignCodecPath: path });
				showToast(kind === "talker" ? "VoiceDesign talker 下载完成" : "tokenizer/codec 下载完成", "success");
				await refresh();
			}),
		[runAction, updateTTSConfig, showToast, refresh],
	);

	const handleInstallRuntime = useCallback(
		() =>
			runAction("runtime", async () => {
				const path = await installCrispAsrRuntime();
				updateTTSConfig({ voiceDesignBinaryPath: path });
				showToast("CrispASR 运行时安装完成", "success");
				await refresh();
			}),
		[runAction, updateTTSConfig, showToast, refresh],
	);

	const handleStart = useCallback(
		() =>
			runAction("start", async () => {
				const info = await ensureVoiceDesignServer(useConfigStore.getState().ttsConfig);
				showToast(`VoiceDesign 服务已启动（端口 ${info.port}）`, "success");
				await refresh();
			}),
		[runAction, showToast, refresh],
	);

	const handleStop = useCallback(
		() =>
			runAction("stop", async () => {
				await stopVoiceDesignServer();
				showToast("VoiceDesign 服务已停止", "info");
				await refresh();
			}),
		[runAction, showToast, refresh],
	);

	const handleTest = useCallback(
		() =>
			runAction("test", async () => {
				const cfg = useConfigStore.getState().ttsConfig;
				const buffer = await synthesizeLocalSpeech(
					"这是一段 VoiceDesign 本地语音朗读测试，音色由文字描述控制。",
					cfg,
				);
				await playAudio(buffer, undefined, {
					playbackRate: localPlaybackRate(cfg.speed),
					volume: Math.min(1, Math.max(0.05, cfg.volume / 10)),
				});
				await refresh();
			}),
		[runAction, refresh],
	);

	const modelReady = !!status?.model_path;
	const codecReady = !!status?.codec_path;
	const binaryReady = !!status?.binary_path;
	const serverRunning = !!status?.server_running;
	const percent = progress && progress.total > 0
		? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
		: 0;

	return (
		<div className="local-tts-section">
			<p className="section-hint">
				VoiceDesign 用自然语言描述音色，不需要参考音频。需要 CrispASR 运行时 +
				talker GGUF + 独立 tokenizer/codec GGUF；首次加载约 4GB 模型。
			</p>

			<div className="local-tts-status">
				<StatusItem label="Talker" ok={modelReady} detail={status?.model_path || ""} />
				<StatusItem label="Codec" ok={codecReady} detail={status?.codec_path || "缺少 tokenizer"} />
				<StatusItem label="运行时" ok={binaryReady} detail={status?.binary_path || "未找到 crispasr"} />
				<StatusItem
					label="服务"
					ok={serverRunning}
					detail={serverRunning ? `运行中 · 端口 ${status?.server_port}` : "未启动（朗读时自动启动）"}
				/>
			</div>

			{(actionError || status?.error) && (
				<div className="local-tts-error">
					<Icons.alertCircle size={14} />
					<span>{actionError || status?.error}</span>
				</div>
			)}

			{progress && (
				<div className="local-tts-progress-block">
					<div className="local-tts-progress-label">
						<span>
							{progress.kind === "vd-talker"
								? "正在下载 talker"
								: progress.kind === "vd-codec"
									? "正在下载 tokenizer/codec"
									: "正在下载 CrispASR"}
						</span>
						<span>{percent}% · {formatBytes(progress.downloaded)} / {formatBytes(progress.total)}</span>
					</div>
					<div className="local-tts-progress">
						<div className="local-tts-progress-bar" style={{ width: `${percent}%` }} />
					</div>
				</div>
			)}

			<div className="form-field">
				<label>Talker 模型（VoiceDesign GGUF）</label>
				<PathRow
					value={ttsConfig.voiceDesignModelPath}
					placeholder="qwen3-tts-12hz-1.7b-voicedesign-f16.gguf 或 q8_0"
					onChange={(v) => updateTTSConfig({ voiceDesignModelPath: v })}
					onPick={handlePickModel}
					onBlur={() => void refresh()}
				/>
				{!modelReady && (
					<button
						type="button"
						className="btn local-tts-download-btn"
						disabled={!!busy}
						onClick={() => handleDownload("talker")}
					>
						<Icons.download size={14} />
						{busy === "talker" ? "下载中…" : "下载 Q8_0 talker（约 1.9 GB）"}
					</button>
				)}
			</div>

			<div className="form-field">
				<label>tokenizer / codec（必需）</label>
				<PathRow
					value={ttsConfig.voiceDesignCodecPath}
					placeholder="qwen3-tts-tokenizer-12hz.gguf"
					onChange={(v) => updateTTSConfig({ voiceDesignCodecPath: v })}
					onPick={handlePickCodec}
					onBlur={() => void refresh()}
				/>
				{!codecReady && (
					<button
						type="button"
						className="btn local-tts-download-btn"
						disabled={!!busy}
						onClick={() => handleDownload("codec")}
					>
						<Icons.download size={14} />
						{busy === "codec" ? "下载中…" : "下载 tokenizer/codec（约 340 MB）"}
					</button>
				)}
			</div>

			<div className="form-field">
				<label>音色描述（VoiceDesign 必填）</label>
				<textarea
					className="config-input local-tts-instruct"
					value={ttsConfig.voiceDesignInstruct}
					onChange={(e) => updateTTSConfig({ voiceDesignInstruct: e.target.value })}
					placeholder="例如：温柔、清澈的年轻女性声音，语速舒缓，适合小说叙述。"
					rows={3}
				/>
				<div className="local-tts-presets">
					{INSTRUCT_PRESETS.map((preset) => (
						<button
							key={preset.label}
							type="button"
							className="btn local-tts-preset-btn"
							onClick={() => updateTTSConfig({ voiceDesignInstruct: preset.value })}
						>
							{preset.label}
						</button>
					))}
				</div>
				<span className="local-tts-hint">
					角色设置里填写了「音色设计描述」时，情感朗读会优先使用角色描述；普通朗读使用这里的全局描述。
				</span>
			</div>

			<div className="form-field">
				<label>合成语言</label>
				<Select
					value={ttsConfig.localLanguage}
					onChange={(value) => updateTTSConfig({ localLanguage: value })}
					options={TTS_LANGUAGE_OPTIONS}
				/>
			</div>

			<div className="form-field">
				<label>CrispASR 运行时</label>
				<PathRow
					value={ttsConfig.voiceDesignBinaryPath}
					placeholder="留空自动检测（PATH / 应用工具目录 / 自动安装）"
					onChange={(v) => updateTTSConfig({ voiceDesignBinaryPath: v })}
					onPick={handlePickBinary}
					onBlur={() => void refresh()}
				/>
				{!binaryReady && (
					<button
						type="button"
						className="btn local-tts-download-btn"
						disabled={!!busy}
						onClick={handleInstallRuntime}
					>
						<Icons.downloadCloud size={14} />
						{busy === "runtime" ? "下载中…" : "自动安装 CrispASR（约 18 MB）"}
					</button>
				)}
			</div>

			<div className="local-tts-actions">
				<button type="button" className="btn" onClick={() => void refresh()} disabled={!!busy}>
					<Icons.refresh size={14} />
					检测
				</button>
				{serverRunning ? (
					<button type="button" className="btn" onClick={handleStop} disabled={!!busy}>
						<Icons.xCircle size={14} />
						{busy === "stop" ? "停止中…" : "停止服务"}
					</button>
				) : (
					<button type="button" className="btn" onClick={handleStart} disabled={!!busy}>
						<Icons.play size={14} />
						{busy === "start" ? "加载模型中…" : "启动服务"}
					</button>
				)}
				<button
					type="button"
					className="btn btn-primary"
					onClick={handleTest}
					disabled={!!busy || !modelReady || !codecReady}
				>
					<Icons.volume size={14} />
					{busy === "test" ? "合成中…" : "试听"}
				</button>
			</div>

			<div className="local-tts-hint local-tts-advanced">
				模型目录：{status?.models_dir || "—"}
				<br />
				服务日志：{status?.log_path || "—"}
			</div>
		</div>
	);
}
