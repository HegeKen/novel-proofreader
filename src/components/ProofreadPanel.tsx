import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useAppStore } from "../stores/appStore";
import { useProofreadStore } from "../stores/proofreadStore";
import { useAICheck } from "../hooks/useAICheck";
import { splitParagraphs } from "../utils/chapterSplit";
import { EmptyState } from "./EmptyState";
import type { CheckGranularity, ProofreadError } from "../types";

const ERROR_TYPE_LABELS: Record<string, string> = {
	typo: "🔤 错别字",
	format: "📐 排版",
	grammar: "📝 病句",
	punctuation: "📖 标点",
};

const ERROR_TYPE_COLORS: Record<string, string> = {
	typo: "#ff4d4f",
	format: "#faad14",
	grammar: "#1677ff",
	punctuation: "#52c41a",
};

export function ProofreadPanel() {
	const chapters = useAppStore((s) => s.chapters);
	const currentChapterIndex = useAppStore((s) => s.currentChapterIndex);
	const replaceParagraphText = useAppStore((s) => s.replaceParagraphText);
	const results = useProofreadStore((s) => s.results);
	const highlightedParagraph = useProofreadStore((s) => s.highlightedParagraph);
	const setHighlightedParagraph = useProofreadStore((s) => s.setHighlightedParagraph);
	const startLine = useProofreadStore((s) => s.startLine);
	const setStartLine = useProofreadStore((s) => s.setStartLine);
	const toggleErrorApplied = useProofreadStore((s) => s.toggleErrorApplied);
	const setApplyAnimation = useProofreadStore((s) => s.setApplyAnimation);
	const setResults = useProofreadStore((s) => s.setResults);

	const { checkChapter, cancelCheck, checkSingleLine } = useAICheck();
	const [granularity, setGranularity] = useState<CheckGranularity>("paragraph");
	const [checking, setChecking] = useState(false);
	const [singleCheckingLine, setSingleCheckingLine] = useState<number | null>(null);
	const animatingRef = useRef(false);
	const proofreadContentRef = useRef<HTMLDivElement>(null);
	const paragraphRefs = useRef<(HTMLDivElement | null)[]>([]);

	const chapter = chapters[currentChapterIndex];
	const chapterResults = useMemo(() => chapter ? (results[chapter.id] ?? []) : [], [chapter, results]);

	const totalLines = useMemo(() => {
		if (!chapter) return 0;
		return splitParagraphs(chapter.content).filter((p) => p.trim() !== "").length;
	}, [chapter]);

	useEffect(() => {
		if (!chapter) return;
		setStartLine(null);
		const paragraphs = splitParagraphs(chapter.content).filter((p) => p.trim() !== "");
		setResults(chapter.id, paragraphs.map((p, i) => ({
			paragraphIndex: i,
			originalText: p,
			errors: [],
			status: "pending" as const,
		})));
		paragraphRefs.current = [];
	}, [chapter, setResults, setStartLine]);

	const handleStartCheck = async () => {
		setChecking(true);
		await checkChapter(granularity, startLine ?? 0);
		setChecking(false);
	};

	const handleSingleLineCheck = async (lineIndex: number) => {
		if (checking || singleCheckingLine !== null) return;
		await checkSingleLine(lineIndex, setSingleCheckingLine);
	};

	const scrollToParagraph = useCallback((index: number) => {
		requestAnimationFrame(() => {
			const el = paragraphRefs.current[index];
			if (el && proofreadContentRef.current) {
				el.scrollIntoView({ behavior: "smooth", block: "center" });
			}
		});
	}, []);

	useEffect(() => {
		if (highlightedParagraph !== null) {
			scrollToParagraph(highlightedParagraph);
		}
	}, [highlightedParagraph, scrollToParagraph]);

	const handleApply = useCallback((paraResult: typeof chapterResults[number], err: ProofreadError, filteredIndex: number) => {
		if (animatingRef.current) return;
		const state = useAppStore.getState();
		const currentChapter = state.chapters[state.currentChapterIndex];
		if (!currentChapter) return;
		const chapterId = currentChapter.id;
		const paraIndex = paraResult.paragraphIndex;

		if (err.applied) {
			replaceParagraphText(chapterId, paraIndex, err.correctedText, err.originalText);
			toggleErrorApplied(chapterId, filteredIndex, err.id);
			return;
		}

		animatingRef.current = true;
		setApplyAnimation({ chapterId, paragraphIndex: filteredIndex, phase: "highlight-old", errorId: err.id, originalText: err.originalText, correctedText: err.correctedText, startIndex: err.startIndex, endIndex: err.endIndex });
		setHighlightedParagraph(filteredIndex);

		setTimeout(() => {
			setApplyAnimation({ chapterId, paragraphIndex: filteredIndex, phase: "replacing", errorId: err.id, originalText: err.originalText, correctedText: err.correctedText, startIndex: err.startIndex, endIndex: err.endIndex });
			replaceParagraphText(chapterId, paraIndex, err.originalText, err.correctedText);
			toggleErrorApplied(chapterId, filteredIndex, err.id);
			setTimeout(() => {
				setApplyAnimation({ chapterId, paragraphIndex: filteredIndex, phase: "highlight-new", errorId: err.id, originalText: err.originalText, correctedText: err.correctedText, startIndex: err.startIndex, endIndex: err.startIndex + err.correctedText.length });
				setTimeout(() => { setApplyAnimation(null); animatingRef.current = false; }, 1200);
			}, 300);
		}, 600);
	}, [replaceParagraphText, toggleErrorApplied, setApplyAnimation, setHighlightedParagraph]);

	if (!chapter) {
		return <div className="proofread-panel empty"><EmptyState icon="🔍" message="导入文件后可进行校对检测" /></div>;
	}

	const totalErrors = chapterResults.reduce((sum, r) => sum + r.errors.length, 0);

	return (
		<div className="proofread-panel">
			<div className="proofread-toolbar">
				<div className="toolbar-left">
					<label className="granularity-select">
						检测项：
						<select value={granularity} onChange={(e) => setGranularity(e.target.value as CheckGranularity)} disabled={checking}>
							<option value="paragraph">按段落</option>
							<option value="chapter">按章节</option>
						</select>
					</label>
				</div>
				<div className="toolbar-right">
					{granularity !== "chapter" && totalLines > 0 && (
						<span className="start-line-select">
							从第 {startLine ?? 1} 行
						</span>
					)}
					{totalErrors > 0 && <span className="error-count">发现 <strong>{totalErrors}</strong> 个问题</span>}
					{checking ? (
						<button className="btn-cancel" onClick={cancelCheck}>取消检测</button>
					) : (
						<button className="btn-check" onClick={handleStartCheck}>开始检测</button>
					)}
				</div>
			</div>

			<div className="proofread-content" ref={proofreadContentRef}>
				{chapterResults.length === 0 ? (
					<EmptyState icon="🔍" message="点击「开始检测」对当前章节进行 AI 校对" />
				) : (
					chapterResults.map((paraResult, i) => (
						<div
							key={paraResult.paragraphIndex}
							ref={(el) => { paragraphRefs.current[i] = el; }}
							className={`proofread-paragraph ${highlightedParagraph === i ? "highlighted" : ""}`}
							onClick={() => { setHighlightedParagraph(i); if (!checking) setStartLine(i === 0 ? null : i); }}
						>
							<div className="para-original">
								<span className="para-index">#{paraResult.paragraphIndex + 1}</span>
								{paraResult.originalText.length > 200 ? paraResult.originalText.slice(0, 200) + "…" : paraResult.originalText}
								<button className="btn-single-check" onClick={(e) => { e.stopPropagation(); handleSingleLineCheck(i); }} disabled={checking || singleCheckingLine !== null || paraResult.status === "checking"} title="检测此行">
									{singleCheckingLine === i ? "检测中…" : "🔍 检测"}
								</button>
							</div>
							{paraResult.status === "checking" && <div className="para-status checking"><span className="spinner" /> 检测中…</div>}
							{paraResult.status === "error" && <div className="para-status error">❌ 检测失败：{paraResult.errorMessage}</div>}
							{paraResult.status === "done" && paraResult.errors.length === 0 && <div className="para-status success">✅ 未发现问题</div>}
							{paraResult.errors.length > 0 && (
								<div className="para-errors">
									{paraResult.errors.map((err: ProofreadError) => (
										<div key={err.id} className={`error-item ${err.applied ? "applied" : ""}`}>
											<div className="error-header">
												<span className="error-type-badge" style={{ backgroundColor: ERROR_TYPE_COLORS[err.errorType] }}>
													{ERROR_TYPE_LABELS[err.errorType] ?? err.errorType}
												</span>
												<span className="error-location">位置 {err.startIndex}–{err.endIndex}</span>
												{err.applied && <span className="applied-badge">已采纳</span>}
											</div>
											<div className="error-detail">
												<span className="error-original">「{err.originalText}」</span>
												<span className="error-arrow">→</span>
												<span className="error-suggestion">{err.correctedText}</span>
											</div>
											{err.suggestion && <div className="error-suggestion-note">💡 {err.suggestion}</div>}
											<button className="btn-apply" onClick={(e) => { e.stopPropagation(); handleApply(paraResult, err, i); }}>
												{err.applied ? "撤销" : "采纳修改"}
											</button>
										</div>
									))}
								</div>
							)}
						</div>
					))
				)}
			</div>
		</div>
	);
}
