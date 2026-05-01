import { useState, useCallback } from "react";
import { useAppStore } from "../stores/appStore";
import { sendChatCompletion, buildScriptUserPrompt } from "../utils/aiClient";
import { splitParagraphs } from "../utils/chapterSplit";
import { exportToFile } from "../utils/fileExport";
import { EmptyState } from "./EmptyState";
import type { ChatMessage } from "../utils/aiClient";

interface ScriptSegment {
	chapterTitle: string;
	content: string;
	originalText: string;
}

type ConvertGranularity = "paragraph" | "chapter";

const DEFAULT_PROMPT = "你是一位专业的编剧。请将以下小说片段改编为剧本格式：\n\n1. 为每个场景标注【场景】（室内/室外、时间、地点）\n2. 角色对白使用「角色名：对白内容」格式\n3. 动作和神态用括号标注为舞台指示\n4. 保留原文核心情节和冲突，精简环境描写\n5. 如有旁白需要，用【旁白】标注\n\n请直接输出剧本内容，不要额外解释。";

export function TaskPanel() {
	const chapters = useAppStore((s) => s.chapters);
	const currentChapterIndex = useAppStore((s) => s.currentChapterIndex);
	const aiConfig = useAppStore((s) => s.aiConfig);
	const setScriptResult = useAppStore((s) => s.setScriptResult);
	const getScriptResult = useAppStore((s) => s.getScriptResult);

	const chapter = chapters[currentChapterIndex];
	const [prompt, setPrompt] = useState("");
	const [processing, setProcessing] = useState(false);
	const [progress, setProgress] = useState({ current: 0, total: 0 });
	const [result, setResult] = useState<ScriptSegment[]>(() => {
		if (!chapter) return [];
		return getScriptResult(chapter.id)?.segments ?? [];
	});
	const [error, setError] = useState("");
	const [granularity, setGranularity] = useState<ConvertGranularity>("paragraph");
	const [startLine, setStartLine] = useState<number | null>(null);

	const totalLines = chapter ? chapter.content.split("\n").length : 0;

	const handleGenerate = useCallback(async () => {
		if (!chapter) return;
		const effectivePrompt = prompt.trim() || DEFAULT_PROMPT;
		if (!aiConfig.apiKey) { setError("请先在设置中配置 API Key"); return; }

		setProcessing(true);
		setError("");
		setResult([]);

		let paragraphs: string[];
		let totalCount: number;

		if (granularity === "chapter") {
			paragraphs = [chapter.content.trim()];
			totalCount = 1;
		} else {
			const allParagraphs = splitParagraphs(chapter.content).filter((p) => p.trim().length > 0);
			const startIdx = startLine ?? 0;
			paragraphs = allParagraphs.slice(startIdx);
			totalCount = paragraphs.length;
		}

		if (paragraphs.length === 0) { setError("当前选择范围内没有可转换的内容"); setProcessing(false); return; }

		setProgress({ current: 0, total: totalCount });
		const segments: ScriptSegment[] = [];

		try {
			for (let i = 0; i < paragraphs.length; i++) {
				setProgress({ current: i + 1, total: totalCount });
				const paragraphText = paragraphs[i];
				if (!paragraphText?.trim()) continue;

				const messages: ChatMessage[] = [
					{ role: "system", content: effectivePrompt },
					{ role: "user", content: buildScriptUserPrompt(paragraphText) },
				];

				const segmentContent = await sendChatCompletion(messages, aiConfig);
				const segIndex = (startLine ?? 0) + i + 1;
				const segmentTitle = granularity === "chapter" ? chapter.title : `${chapter.title} - 段落 ${segIndex}`;

				segments.push({ chapterTitle: segmentTitle, content: segmentContent, originalText: paragraphText });
			}

			setResult(segments);
			setScriptResult(chapter.id, segments);
		} catch (e) {
			setError(e instanceof Error ? e.message : "生成失败");
		} finally {
			setProcessing(false);
		}
	}, [chapter, prompt, aiConfig, granularity, startLine, setScriptResult]);

	const handleExport = useCallback(async () => {
		if (result.length === 0) return;
		const fullScript = result.map((s) => `// ${s.chapterTitle}\n\n${s.content}`).join("\n\n" + "=".repeat(60) + "\n\n");
		await exportToFile(fullScript, `${chapter?.title ?? "剧本"}_改编.txt`);
	}, [result, chapter]);

	if (!chapter) {
		return <div className="task-panel empty"><EmptyState icon="🎬" message="导入文件后可使用剧本改编功能" /></div>;
	}

	return (
		<div className="task-panel">
			<div className="task-header">
				<h3>🎬 剧本改编</h3>
				<span className="task-chapter">{chapter?.title}</span>
			</div>

			<div className="task-body">
				<div className="task-section">
					<div className="section-label">转换粒度</div>
					<div className="granularity-options">
						<button className={`granularity-btn ${granularity === "paragraph" ? "active" : ""}`} onClick={() => setGranularity("paragraph")}>按段落</button>
						<button className={`granularity-btn ${granularity === "chapter" ? "active" : ""}`} onClick={() => setGranularity("chapter")}>整章</button>
					</div>
				</div>

				{granularity === "paragraph" && (
					<div className="task-section">
						<div className="section-label">起始位置</div>
						<div className="start-line-input">
							<input type="number" min="0" max={totalLines} value={startLine ?? ""} onChange={(e) => setStartLine(e.target.value ? parseInt(e.target.value) : null)} placeholder="从第 0 行开始" className="config-input" />
							<span className="line-hint">共 {totalLines} 行</span>
						</div>
					</div>
				)}

				<div className="task-section">
					<div className="section-label">自定义提示词（可选）</div>
					<textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={DEFAULT_PROMPT} className="prompt-textarea" rows={4} />
				</div>

				<div className="task-actions">
					<button className="btn-generate" onClick={handleGenerate} disabled={processing}>
						{processing ? <><span className="spinner"></span><span>转换中... {progress.current}/{progress.total}</span></> : "🚀 开始转换"}
					</button>
				</div>

				{error && <div className="task-error">❌ {error}</div>}

				<div className="task-result-wrapper">
					{result.length > 0 ? (
						<>
							<div className="result-content">
								<div className="result-summary"><span className="summary-count">共 {result.length} 段内容</span></div>
								{result.map((seg, i) => (
									<div key={i} className="result-segment">
										<div className="segment-header"><span className="segment-index">📝 段落 {i + 1}</span><span className="segment-title">{seg.chapterTitle}</span></div>
										<div className="segment-content">{seg.content}</div>
									</div>
								))}
							</div>
							<div className="task-export-bar">
								<button className="btn-export" onClick={handleExport}>💾 导出剧本</button>
							</div>
						</>
					) : (
						<EmptyState icon="📄" message="点击「开始转换」按钮，将当前章节内容转换为剧本格式" />
					)}
				</div>
			</div>
		</div>
	);
}
