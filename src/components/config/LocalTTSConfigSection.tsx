// ============================================================
// 本地 TTS 配置：Qwen3-TTS GGUF + llama-server
// ============================================================
import { useCallback, useEffect, useRef, useState } from "react";
import { useConfigStore } from "../../stores/configStore";
import { useUIStore } from "../../stores/uiStore";
import type { TTSConfig } from "../../types";
import {
	downloadLocalMmproj,
	ensureLocalTtsServer,
	formatBytes,
	getLocalTtsStatus,
	installLocalRuntime,
	isTauriRuntime,
	listenLocalTtsDownloadProgress,
	localPlaybackRate,
	stopLocalTtsServer,
	synthesizeLocalSpeech,
	type LocalTtsDownloadProgress,
	type LocalTtsStatus,
} from "../../utils/localTts";
import { playAudio } from "../../utils/ttsService";
import { Icons } from "../Icons";
import { Select } from "../Select";
import { TTS_LANGUAGE_OPTIONS } from "./ttsLanguageOptions";
import { VoiceDesignTTSConfigSection } from "./VoiceDesignTTSConfigSection";

type BusyAction = "status" | "start" | "stop" | "mmproj" | "runtime" | "test" | null;

function errText(err: unknown): string {
	if (err instanceof Error) return err.message;
	if (typeof err === "string") return err;
	return JSON.stringify(err);
}

/** 路径行：输入框 + 选择按钮 */
function PathRow({
	value,
	placeholder,
	onChange,
	onPick,
	onBlur,
	pickLabel = "选择",
}: {
	value: string;
	placeholder: string;
	onChange: (value: string) => void;
	onPick?: () => void;
	onBlur?: () => void;
	pickLabel?: string;
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
					{pickLabel}
				</button>
			)}
		</div>
	);
}

function StatusItem({
	label,
	ok,
	detail,
}: {
	label: string;
	ok: boolean;
	detail: string;
}) {
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

/** 本地引擎选择：Base（llama.cpp 参考音频克隆）/ VoiceDesign（CrispASR 文字音色描述） */
export function LocalTTSConfigSection() {
	const ttsConfig = useConfigStore((s) => s.ttsConfig);
	const updateTTSConfig = useConfigStore((s) => s.updateTTSConfig);
	const isVoiceDesign = ttsConfig.localEngine === "qwen3-voicedesign";

	return (
		<div>
			<div className="form-field">
				<label>本地引擎</label>
				<Select
					value={ttsConfig.localEngine}
					onChange={(value) => updateTTSConfig({ localEngine: value as "qwen3-base" | "qwen3-voicedesign" })}
					options={[
						{ value: "qwen3-base", label: "Qwen3-TTS Base（llama.cpp，参考音频克隆）" },
						{ value: "qwen3-voicedesign", label: "Qwen3-TTS VoiceDesign（CrispASR，文字描述音色）" },
					]}
				/>
				<span className="local-tts-hint">
					{isVoiceDesign
						? "无需参考音频，直接输入音色描述；需要 talker + tokenizer/codec 两个 GGUF。"
						: "用参考音频克隆音色；只需主模型 + mmproj，运行时为 llama-server。"}
				</span>
			</div>
			{isVoiceDesign ? <VoiceDesignTTSConfigSection /> : <BaseLocalTTSConfigSection />}
		</div>
	);
}

export function BaseLocalTTSConfigSection() {
	const ttsConfig = useConfigStore((s) => s.ttsConfig);
	const updateTTSConfig = useConfigStore((s) => s.updateTTSConfig);
	const showToast = useUIStore((s) => s.showToast);

	const [status, setStatus] = useState<LocalTtsStatus | null>(null);
	const [busy, setBusy] = useState<BusyAction>(null);
	const [progress, setProgress] = useState<LocalTtsDownloadProgress | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const didAutoDetect = useRef(false);

	const refresh = useCallback(async () => {
		if (!isTauriRuntime()) return;
		const latest = await getLocalTtsStatus(useConfigStore.getState().ttsConfig);
		setStatus(latest);
	}, []);

	// 挂载时自动检测；若用户尚未填写路径，自动带入已下载的模型 / mmproj / 运行时
	useEffect(() => {
		let cancelled = false;
		(async () => {
			const latest = await getLocalTtsStatus(useConfigStore.getState().ttsConfig);
			if (cancelled) return;
			setStatus(latest);
			if (didAutoDetect.current || !latest) return;
			didAutoDetect.current = true;
			const cfg = useConfigStore.getState().ttsConfig;
			const patch: Partial<TTSConfig> = {};
			if (!cfg.localModelPath && latest.model_path) patch.localModelPath = latest.model_path;
			if (!cfg.localMmprojPath && latest.mmproj_path) patch.localMmprojPath = latest.mmproj_path;
			if (!cfg.localBinaryPath && latest.binary_path) patch.localBinaryPath = latest.binary_path;
			if (Object.keys(patch).length > 0) {
				updateTTSConfig(patch);
				setStatus(await getLocalTtsStatus(useConfigStore.getState().ttsConfig));
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [updateTTSConfig]);

	// 下载进度事件
	useEffect(() => {
		let unlisten: (() => void) | undefined;
		listenLocalTtsDownloadProgress((p) => setProgress(p)).then((fn) => {
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
				if (typeof selected === "string") {
					await onSelected(selected);
				}
			} catch {
				showToast("无法打开文件选择器", "error");
			}
		},
		[showToast],
	);

	const handlePickModel = useCallback(
		() =>
			pickFile(["gguf"], "Qwen3-TTS 主模型", async (path) => {
				updateTTSConfig({ localModelPath: path });
				const latest = await getLocalTtsStatus({ ...useConfigStore.getState().ttsConfig, localModelPath: path });
				setStatus(latest);
				if (latest?.mmproj_path) {
					updateTTSConfig({ localMmprojPath: latest.mmproj_path });
				}
				if (latest?.binary_path && !useConfigStore.getState().ttsConfig.localBinaryPath) {
					updateTTSConfig({ localBinaryPath: latest.binary_path });
				}
			}),
		[pickFile, updateTTSConfig],
	);

	const handlePickMmproj = useCallback(
		() =>
			pickFile(["gguf"], "mmproj 文件", (path) => {
				updateTTSConfig({ localMmprojPath: path });
				void refresh();
			}),
		[pickFile, updateTTSConfig, refresh],
	);

	const handlePickSpeaker = useCallback(
		() =>
			pickFile(["wav", "mp3", "m4a", "flac", "ogg"], "参考音频", (path) => {
				updateTTSConfig({ localSpeakerRefPath: path });
				void refresh();
			}),
		[pickFile, updateTTSConfig, refresh],
	);

	const handlePickBinary = useCallback(
		() =>
			pickFile([], "llama-server 可执行文件", (path) => {
				updateTTSConfig({ localBinaryPath: path });
				void refresh();
			}),
		[pickFile, updateTTSConfig, refresh],
	);

	const handleDownloadMmproj = useCallback(
		() =>
			runAction("mmproj", async () => {
				const path = await downloadLocalMmproj();
				updateTTSConfig({ localMmprojPath: path });
				showToast("配套 mmproj 下载完成", "success");
				await refresh();
			}),
		[runAction, updateTTSConfig, showToast, refresh],
	);

	const handleInstallRuntime = useCallback(
		() =>
			runAction("runtime", async () => {
				const path = await installLocalRuntime();
				updateTTSConfig({ localBinaryPath: path });
				showToast("llama-server 运行时安装完成", "success");
				await refresh();
			}),
		[runAction, updateTTSConfig, showToast, refresh],
	);

	const handleStart = useCallback(
		() =>
			runAction("start", async () => {
				const info = await ensureLocalTtsServer(useConfigStore.getState().ttsConfig);
				showToast(`本地朗读服务已启动（端口 ${info.port}）`, "success");
				await refresh();
			}),
		[runAction, showToast, refresh],
	);

	const handleStop = useCallback(
		() =>
			runAction("stop", async () => {
				await stopLocalTtsServer();
				showToast("本地朗读服务已停止", "info");
				await refresh();
			}),
		[runAction, showToast, refresh],
	);

	const handleTest = useCallback(
		() =>
			runAction("test", async () => {
				const cfg = useConfigStore.getState().ttsConfig;
				const buffer = await synthesizeLocalSpeech(
					"这是一段本地语音朗读测试，用于确认模型可以正常工作。",
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
	const mmprojReady = !!status?.mmproj_path;
	const binaryReady = !!status?.binary_path;
	const serverRunning = !!status?.server_running;
	const percent = progress && progress.total > 0
		? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
		: 0;

	return (
		<div className="local-tts-section">
			<p className="section-hint">
				使用本地 Qwen3-TTS GGUF 模型朗读，无需联网与 API Key。首次启动需加载约 2.3GB 模型，之后逐句合成。
				本地 Base 模型不支持「音色设计」文本描述，角色音色请通过参考音频控制。
			</p>

			<div className="local-tts-status">
				<StatusItem label="主模型" ok={modelReady} detail={status?.model_path || ""} />
				<StatusItem label="mmproj" ok={mmprojReady} detail={status?.mmproj_path || "缺少（必需）"} />
				<StatusItem label="运行时" ok={binaryReady} detail={status?.binary_path || "未找到 llama-server"} />
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
						<span>{progress.kind === "mmproj" ? "正在下载 mmproj" : "正在下载 llama-server"}</span>
						<span>{percent}% · {formatBytes(progress.downloaded)} / {formatBytes(progress.total)}</span>
					</div>
					<div className="local-tts-progress">
						<div className="local-tts-progress-bar" style={{ width: `${percent}%` }} />
					</div>
				</div>
			)}

			<div className="form-field">
				<label>主模型（Qwen3-TTS GGUF）</label>
				<PathRow
					value={ttsConfig.localModelPath}
					placeholder="选择 Qwen3-TTS-12Hz-1.7B-Base-Q8_0.gguf"
					onChange={(v) => updateTTSConfig({ localModelPath: v })}
					onPick={handlePickModel}
					onBlur={() => void refresh()}
				/>
			</div>

			<div className="form-field">
				<label>配套 mmproj（必需）</label>
				<PathRow
					value={ttsConfig.localMmprojPath}
					placeholder="mmproj-Qwen3-TTS-12Hz-1.7B-Base-Q8_0.gguf"
					onChange={(v) => updateTTSConfig({ localMmprojPath: v })}
					onPick={handlePickMmproj}
					onBlur={() => void refresh()}
				/>
				{!mmprojReady && (
					<button
						type="button"
						className="btn local-tts-download-btn"
						disabled={!!busy}
						onClick={handleDownloadMmproj}
					>
						<Icons.download size={14} />
						{busy === "mmproj" ? "下载中…" : "下载配套 mmproj（约 440 MB）"}
					</button>
				)}
			</div>

			<div className="form-field">
				<label>参考音频（可选，用于克隆音色）</label>
				<PathRow
					value={ttsConfig.localSpeakerRefPath}
					placeholder="留空则使用模型默认音色"
					onChange={(v) => updateTTSConfig({ localSpeakerRefPath: v })}
					onPick={handlePickSpeaker}
					onBlur={() => void refresh()}
				/>
				<span className="local-tts-hint">
					建议 3–10 秒清晰、无背景音乐的单一说话人音频。参考音频会显著提升音色稳定性。
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
				<label>llama-server 运行时</label>
				<PathRow
					value={ttsConfig.localBinaryPath}
					placeholder="留空自动检测（Homebrew / PATH / 自动安装）"
					onChange={(v) => updateTTSConfig({ localBinaryPath: v })}
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
						{busy === "runtime" ? "下载中…" : "自动安装 llama-server（约 17 MB）"}
					</button>
				)}
			</div>

			<div className="local-tts-actions">
				<button type="button" className="btn" onClick={() => void refresh()} disabled={!!busy}>
					<Icons.refresh size={14} />
					{busy === "status" ? "检测中…" : "检测"}
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
					disabled={!!busy || !modelReady}
				>
					<Icons.volume size={14} />
					{busy === "test" ? "合成中…" : "试听"}
				</button>
			</div>

			<div className="local-tts-hint local-tts-advanced">
				模型目录：{status?.models_dir || "—"}
				<br />
				服务日志：{status?.log_path || "—"}
				{ttsConfig.localGpuLayers >= 0 && <> · GPU 层数：{ttsConfig.localGpuLayers}</>}
			</div>
		</div>
	);
}
