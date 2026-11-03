// ============================================================
// 本地情感分析配置：RoBERTa 多标签模型（离线，无需 API Key）
// ============================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import { useCharacterStore } from "../../stores/characterStore";
import { useConfigStore } from "../../stores/configStore";
import { useNovelStore } from "../../stores/novelStore";
import { useUIStore } from "../../stores/uiStore";
import { useWordReplacementStore } from "../../stores/wordReplacementStore";
import { applyWordReplacements } from "../../utils/textReplace";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { EMOTION_ZH, buildLocalParagraphEmotion } from "../../utils/emotionAnalysis";
import type { ParagraphEmotionResult } from "../../utils/aiClient";
import {
	analyzeEmotionLocal,
	downloadLocalEmotionModel,
	formatEmotionBytes,
	formatEmotionModelSize,
	getLocalEmotionStatus,
	importLocalEmotionModel,
	listenLocalEmotionDownloadProgress,
	listenLocalEmotionImportProgress,
	unloadLocalEmotionModel,
	type EmotionPrediction,
	type LocalEmotionDownloadProgress,
	type LocalEmotionImportProgress,
	type LocalEmotionStatus,
} from "../../utils/localEmotion";
import { isTauriRuntime } from "../../utils/localTts";
import { Icons } from "../Icons";

type BusyAction = "status" | "download" | "import" | "test" | "unload" | null;

const DEFAULT_TEST_TEXT = "他猛地拍案而起，怒吼道：“你给我滚出去！”";
const DEFAULT_TEST_CONTEXT = "李青死死握紧了手中的长剑，手心满是冷汗。";

const TONE_LABELS: Record<string, string> = {
	tone_positive: "正向",
	tone_negative: "负向",
	tone_neutral: "中性",
};

function labelZh(label: string): string {
	return EMOTION_ZH[label] || TONE_LABELS[label] || label;
}

function errText(err: unknown): string {
	if (err instanceof Error) return err.message;
	if (typeof err === "string") return err;
	return JSON.stringify(err);
}

function StatusRow({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
	return (
		<div className="local-tts-status-row">
			<span className={`local-tts-status-dot ${ok ? "ok" : "missing"}`} />
			<span className="local-tts-status-label">{label}</span>
			<span className="local-tts-status-detail" title={detail}>{detail}</span>
		</div>
	);
}

export function LocalEmotionConfigSection() {
	const ttsConfig = useConfigStore((s) => s.ttsConfig);
	const updateTTSConfig = useConfigStore((s) => s.updateTTSConfig);
	const showToast = useUIStore((s) => s.showToast);
	const currentNovelId = useNovelStore((s) => s.currentNovelId);
	const getCharacters = useCharacterStore((s) => s.getCharacters);
	const replacements = useWordReplacementStore((s) => s.replacements);
	const { copiedId, copy } = useCopyToClipboard();
	const enabled = ttsConfig.localEmotionEnabled === true;
	const inTauri = isTauriRuntime();

	const [status, setStatus] = useState<LocalEmotionStatus | null>(null);
	const [busy, setBusy] = useState<BusyAction>(null);
	const [progress, setProgress] = useState<LocalEmotionDownloadProgress | null>(null);
	const [importProgress, setImportProgress] = useState<LocalEmotionImportProgress | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [testText, setTestText] = useState(DEFAULT_TEST_TEXT);
	const [testContext, setTestContext] = useState(DEFAULT_TEST_CONTEXT);
	const [testResult, setTestResult] = useState<EmotionPrediction | null>(null);
	const [testAnnotated, setTestAnnotated] = useState<ParagraphEmotionResult | null>(null);

	const refresh = useCallback(async () => {
		if (!isTauriRuntime()) return;
		setStatus(await getLocalEmotionStatus());
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	useEffect(() => {
		let unlistenDownload: (() => void) | undefined;
		let unlistenImport: (() => void) | undefined;
		listenLocalEmotionDownloadProgress((payload) => setProgress(payload)).then((fn) => {
			unlistenDownload = fn;
		});
		listenLocalEmotionImportProgress((payload) => setImportProgress(payload)).then((fn) => {
			unlistenImport = fn;
		});
		return () => {
			unlistenDownload?.();
			unlistenImport?.();
		};
	}, []);

	const run = useCallback(
		async (action: Exclude<BusyAction, null>, fn: () => Promise<void>) => {
			if (busy) return;
			setBusy(action);
			setActionError(null);
			try {
				await fn();
			} catch (err) {
				const message = errText(err);
				setActionError(message);
				showToast(message, "error", 8000);
			} finally {
				setBusy(null);
				setProgress(null);
				setImportProgress(null);
			}
		},
		[busy, showToast],
	);

	const handleDownload = useCallback(
		() =>
			run("download", async () => {
				const latest = await downloadLocalEmotionModel();
				setStatus(latest);
				showToast("本地情感模型下载完成，现在可以离线分析段落情绪", "success", 5000);
				await refresh();
			}),
		[run, showToast, refresh],
	);

	const handleImport = useCallback(
		() =>
			run("import", async () => {
				const { open } = await import("@tauri-apps/plugin-dialog");
				const selected = await open({
					directory: true,
					multiple: false,
					title: "选择情感模型目录（包含 config.json / tokenizer.json / model.safetensors）",
				});
				if (typeof selected !== "string") return;
				const latest = await importLocalEmotionModel(selected);
				setStatus(latest);
				setTestResult(null);
				setTestAnnotated(null);
				showToast("本地情感模型导入完成", "success", 5000);
				await refresh();
			}),
		[run, showToast, refresh],
	);

	const handleTest = useCallback(
		() =>
			run("test", async () => {
				const text = testText.trim();
				if (!text) {
					showToast("请先输入要分析的测试文本", "warning");
					return;
				}
				const prediction = await analyzeEmotionLocal(text, testContext.trim());
				const characters = currentNovelId
					? getCharacters(currentNovelId).map((c) => ({
						name: c.name,
						aliases: c.aliases || [],
						role: c.role,
					}))
					: [];
				setTestResult(prediction);
				setTestAnnotated(buildLocalParagraphEmotion(text, prediction, characters));
				const top = prediction.labels
					.slice(0, 3)
					.map((item) => `${labelZh(item.label)} ${(item.probability * 100).toFixed(0)}%`)
					.join(" · ");
				showToast(`本地情感分析：${top}`, "success", 6000);
				await refresh();
			}),
		[run, showToast, refresh, testText, testContext, currentNovelId, getCharacters],
	);

	const handleUnload = useCallback(
		() =>
			run("unload", async () => {
				const latest = await unloadLocalEmotionModel();
				setStatus(latest);
				showToast("已释放本地情感模型内存", "info", 3000);
			}),
		[run, showToast],
	);

	const downloaded = !!status?.downloaded;
	const percent = progress && progress.total > 0
		? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
		: 0;
	const importPercent = importProgress && importProgress.total > 0
		? Math.min(100, Math.round((importProgress.copied / importProgress.total) * 100))
		: 0;
	const topScores = testResult?.labels.slice(0, 6) ?? [];
	const annotatedText = testAnnotated?.segments.map((segment) => segment.text).join("") ?? "";
	const replacedText = useMemo(
		() => (annotatedText ? applyWordReplacements(annotatedText) : ""),
		[annotatedText, replacements],
	);

	return (
		<div className="local-emotion-section">
			<div className="section-label"><Icons.brain size={14} />情感分析（朗读标注）</div>

			<div className="toggle-item">
				<label className="toggle-label">
					<div className="toggle-switch">
						<input
							type="checkbox"
							checked={enabled}
							onChange={(e) => updateTTSConfig({ localEmotionEnabled: e.target.checked })}
						/>
						<span className="toggle-slider"></span>
					</div>
					<span className="toggle-text">使用本地情感模型（离线）</span>
				</label>
				<span className="toggle-hint">
					关闭时由 AI 大模型判断角色、情绪与语速；开启后完全在本地分析，无需 AI API Key，也不产生任何调用费用。
				</span>
			</div>

			{enabled && (
				<div className="local-tts-section" style={{ marginTop: 8 }}>
					<p className="section-hint">
						基于中文 RoBERTa 多标签情感模型（28 种细粒度情绪 + 3 种情感基调），结合上文语境判断段落情绪，
						再按引号切分旁白/对话并套用朗读标签。
					</p>

					<div className="local-tts-status">
						<StatusRow
							label="模型"
							ok={downloaded}
							detail={
								!inTauri
									? "仅桌面客户端可用"
									: downloaded
										? `${formatEmotionModelSize(status)} · 已就绪`
										: "未下载（约 390MB）"
							}
						/>
						<StatusRow
							label="内存"
							ok={!!status?.loaded}
							detail={status?.loaded ? "已加载（按需常驻）" : "未加载（首次分析时自动加载）"}
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
								<span>正在下载 {progress.file}</span>
								<span>{percent}% · {formatEmotionBytes(progress.downloaded)} / {formatEmotionBytes(progress.total)}</span>
							</div>
							<div className="local-tts-progress">
								<div className="local-tts-progress-bar" style={{ width: `${percent}%` }} />
							</div>
						</div>
					)}

					{importProgress && (
						<div className="local-tts-progress-block">
							<div className="local-tts-progress-label">
								<span>正在导入 {importProgress.file}</span>
								<span>{importPercent}% · {formatEmotionBytes(importProgress.copied)} / {formatEmotionBytes(importProgress.total)}</span>
							</div>
							<div className="local-tts-progress">
								<div className="local-tts-progress-bar" style={{ width: `${importPercent}%` }} />
							</div>
						</div>
					)}

					<div className="form-field">
						<label>测试文本</label>
						<textarea
							className="config-input local-emotion-test-input"
							value={testText}
							onChange={(e) => {
								setTestText(e.target.value);
								setTestResult(null);
								setTestAnnotated(null);
							}}
							rows={4}
							placeholder="输入或粘贴要分析情绪的段落，例如小说正文、对话或旁白"
						/>
					</div>
					<div className="form-field">
						<label>上文（可选）<span className="label-hint">用于模拟模型的双句输入</span></label>
						<textarea
							className="config-input local-emotion-test-input local-emotion-test-context"
							value={testContext}
							onChange={(e) => {
								setTestContext(e.target.value);
								setTestResult(null);
								setTestAnnotated(null);
							}}
							rows={2}
							placeholder="可留空；填写前一段/前几段可观察上下文对结果的影响"
						/>
					</div>

					<div className="local-tts-actions">
						<button
							className="btn btn-secondary"
							type="button"
							onClick={handleDownload}
							disabled={!!busy || downloaded || !inTauri}
							title={downloaded ? "模型已下载" : "从 HuggingFace 下载（失败时自动尝试镜像）"}
						>
							<Icons.download size={14} />
							{busy === "download" ? "下载中…" : downloaded ? "已下载" : "下载模型"}
						</button>
						<button
							className="btn btn-secondary"
							type="button"
							onClick={handleImport}
							disabled={!!busy || !inTauri}
							title="选择包含 config.json / tokenizer.json / model.safetensors 的本地目录"
						>
							<Icons.import size={14} />
							{busy === "import" ? "导入中…" : "导入本地模型"}
						</button>
						<button
							className="btn btn-secondary"
							type="button"
							onClick={handleTest}
							disabled={!!busy || !downloaded || !inTauri || !testText.trim()}
						>
							<Icons.play size={14} />
							{busy === "test" ? "分析中…" : "测试分析"}
						</button>
						<button
							className="btn btn-secondary"
							type="button"
							onClick={handleUnload}
							disabled={!!busy || !status?.loaded}
						>
							<Icons.refresh size={14} />
							释放内存
						</button>
					</div>

					{testResult && (
						<div className="local-emotion-result">
							<div className="local-emotion-result-head">
								<span>最近一次分析</span>
								<span>
									{(testResult.elapsed_ms / 1000).toFixed(2)}s · {testResult.tokens} tokens
								</span>
							</div>
							<div className="local-emotion-chips">
								{topScores.map((score) => (
									<span
										key={score.label}
										className={`local-emotion-chip${score.probability >= 0.5 ? " strong" : ""}`}
										title={score.label}
									>
										{labelZh(score.label)}
										<b>{(score.probability * 100).toFixed(0)}%</b>
									</span>
								))}
							</div>

							{testAnnotated && (
								<div className="local-emotion-annotated">
									<div className="local-emotion-annotated-head">
										<span>标注后文本（情感朗读输入）</span>
										<button
											type="button"
											className="local-emotion-copy-btn"
											onClick={() => void copy("test-annotated", annotatedText)}
										>
											{copiedId === "test-annotated" ? "已复制" : "复制"}
										</button>
									</div>
									<pre className="local-emotion-annotated-text">{annotatedText}</pre>
									<div className="local-emotion-segments">
										{testAnnotated.segments.map((segment, index) => (
											<div className="local-emotion-segment" key={`${segment.type}-${index}`}>
												<div className="local-emotion-segment-meta">
													<span className={`local-emotion-kind ${segment.type}`}>
														{segment.type === "dialogue" ? "对话" : "旁白"}
													</span>
													<span>{segment.speaker}</span>
													<span>{segment.emotion} / {segment.tone}</span>
													<span>语速 {segment.speed ?? 5}</span>
												</div>
												<div className="local-emotion-segment-text">{segment.text}</div>
											</div>
										))}
									</div>
								</div>
							)}

							{testAnnotated && (
								<div className="local-emotion-annotated">
									<div className="local-emotion-annotated-head">
										<span>敏感词替换后（按当前替换规则）</span>
										<button
											type="button"
											className="local-emotion-copy-btn"
											onClick={() => void copy("test-replaced", replacedText)}
										>
											{copiedId === "test-replaced" ? "已复制" : "复制"}
										</button>
									</div>
									<pre className="local-emotion-annotated-text">{replacedText}</pre>
									<span className="local-emotion-hint">
										{replacedText === annotatedText
											? "当前没有命中敏感词替换规则"
											: "已应用「设置 → 语音朗读 → 敏感词替换」中的规则"}
										；本地 / 外部 TTS 会在替换后去掉开头的表演标签，云端 TTS 会保留情感标签。
									</span>
								</div>
							)}
						</div>
					)}

					{!inTauri && (
						<p className="local-tts-hint">
							本地情感分析依赖 Rust 推理与本地模型文件，仅在桌面客户端可用；浏览器预览中会自动回退到 AI 分析。
						</p>
					)}

					<p className="local-tts-hint">
						模型：<code>liudev/roberta-multilabel-28-3-classes</code>
						。下载后保存在应用模型目录，可完全断网使用。若下载失败，可手动下载
						<code>config.json</code>、<code>tokenizer.json</code>、<code>model.safetensors</code>
						到同一目录后点击「导入本地模型」；导入会复制到应用模型目录（约需 390MB 空闲空间）。
					</p>
				</div>
			)}
		</div>
	);
}
