// ============================================================
// 剧本改编面板
// ============================================================
import { useState, useCallback } from "react";
import { useAppStore } from "../stores/appStore";
import { sendChatCompletion, buildScriptUserPrompt } from "../utils/aiClient";
import { exportToFile } from "../utils/fileExport";
import { EmptyState } from "./EmptyState";
import { Icons } from "./Icons";
import { SCRIPT_SYSTEM_PROMPT } from "../utils/aiClient";
import type { ChatMessage } from "../utils/aiClient";
import type { Chapter, AIConfig } from "../types";

interface ScriptSegment {
	chapterTitle: string;
	content: string;
	originalText: string;
}

const DEFAULT_PROMPT = SCRIPT_SYSTEM_PROMPT;

// 内部组件，使用 key 重置状态
function TaskPanelContent({
	chapter,
	aiConfig,
	setScriptResult,
	getScriptResult,
}: {
	chapter: Chapter | undefined;
	aiConfig: AIConfig;
	setScriptResult: (chapterId: number, segments: ScriptSegment[]) => void;
	getScriptResult: (
		chapterId: number,
	) => { segments: ScriptSegment[] } | undefined;
}) {
	const [prompt, setPrompt] = useState("");
	const [processing, setProcessing] = useState(false);
	const [result, setResult] = useState<ScriptSegment[]>(() => {
		if (!chapter) return [];
		const cached = getScriptResult(chapter.id);
		return cached?.segments ?? [];
	});
	const [error, setError] = useState("");

	const handleGenerate = useCallback(async () => {
		if (!chapter) return;

		const effectivePrompt = prompt.trim() || DEFAULT_PROMPT;
		if (!aiConfig.apiKey) {
			setError("请先在设置中配置 API Key");
			return;
		}

		setProcessing(true);
		setError("");
		setResult([]);

		const chapterText = chapter.content.trim();

		if (!chapterText) {
			setError("当前章节没有可转换的内容");
			setProcessing(false);
			return;
		}

		try {
			const scriptAiConfig = {
				baseURL: aiConfig.baseURL,
				apiKey: aiConfig.apiKey,
				model: aiConfig.model,
				customHeaders: {},
				maxCharsPerRequest: 4000,
				enableLogging: aiConfig.enableLogging,
			};

			const messages: ChatMessage[] = [
				{ role: "system", content: effectivePrompt },
				{ role: "user", content: buildScriptUserPrompt(chapterText) },
			];

			const segmentContent = await sendChatCompletion(
				messages,
				scriptAiConfig,
			);

			const segments: ScriptSegment[] = [{
				chapterTitle: chapter.title,
				content: segmentContent,
				originalText: chapterText,
			}];

			setResult(segments);
			setScriptResult(chapter.id, segments);
		} catch (e) {
			setError(e instanceof Error ? e.message : "生成失败");
		} finally {
			setProcessing(false);
		}
	}, [chapter, prompt, aiConfig, setScriptResult]);

	const handleExport = useCallback(async () => {
		if (result.length === 0) return;

		const fullScript = result
			.map((s) => `// ${s.chapterTitle}\n\n${s.content}`)
			.join("\n\n" + "=".repeat(60) + "\n\n");

		await exportToFile(fullScript, `${chapter?.title ?? "剧本"}_改编.txt`);
	}, [result, chapter]);

	return (
		<>
			<div className="task-header">
				<h3>
					<Icons.script size={16} />
					剧本改编
				</h3>
				<span className="task-chapter">{chapter?.title}</span>
			</div>

			<div className="task-body">
				<div className="task-section">
					<div className="section-label">自定义提示词（可选）</div>
					<textarea
						value={prompt}
						onChange={(e) => setPrompt(e.target.value)}
						placeholder={DEFAULT_PROMPT}
						className="prompt-textarea"
						rows={4}
					/>
				</div>

				<div className="task-actions">
					<button
						className="btn-generate"
						onClick={handleGenerate}
						disabled={processing}
					>
						{processing ? (
							<>
								<span className="spinner"></span>
								<span>转换中...</span>
							</>
						) : (
							<><Icons.play size={16} /> 按章节转换</>
						)}
					</button>
				</div>

				{error && <div className="task-error"><Icons.error size={14} /> {error}</div>}

				{/* 结果区域 */}
				<div className="task-result-wrapper">
					{result.length > 0 ? (
						<>
							<div className="result-content">
								<div className="result-summary">
									<span className="summary-count">
										章节转换完成
									</span>
								</div>
								{result.map((seg, i) => (
									<div key={i} className="result-segment">
										<div className="segment-header">
											<span className="segment-index"><Icons.grammar size={12} /> {seg.chapterTitle}</span>
										</div>
										<div className="segment-content">{seg.content}</div>
									</div>
								))}
							</div>
							{/* 右下角固定保存按钮 */}
							<div className="task-export-bar">
								<button className="btn-export" onClick={handleExport}>
									💾 导出剧本
								</button>
							</div>
						</>
					) : (
						<EmptyState
							icon="📄"
							message="点击「按章节转换」按钮，将当前章节内容转换为剧本格式"
						/>
					)}
				</div>
			</div>
		</>
	);
}

// 主组件
export function TaskPanel() {
	const chapters = useAppStore((s) => s.chapters);
	const currentChapterIndex = useAppStore((s) => s.currentChapterIndex);
	const aiConfig = useAppStore((s) => s.aiConfig);
	const setScriptResult = useAppStore((s) => s.setScriptResult);
	const getScriptResult = useAppStore((s) => s.getScriptResult);

	const chapter = chapters[currentChapterIndex];

	if (!chapter) {
		return (
			<div className="task-panel empty">
				<EmptyState icon={<Icons.script size={48} />} message="导入文件后可使用剧本改编功能" />
			</div>
		);
	}

	// 使用章节 ID 作为 key，确保章节切换时重新挂载组件
	return (
		<div className="task-panel">
			<TaskPanelContent
				key={chapter.id}
				chapter={chapter}
				aiConfig={aiConfig}
				setScriptResult={setScriptResult}
				getScriptResult={getScriptResult}
			/>
		</div>
	);
}
