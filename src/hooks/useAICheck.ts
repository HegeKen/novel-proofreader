// ============================================================
// AI 校对检测 Hook
// ============================================================
import { useCallback, useRef } from "react";
import { useAppStore } from "../stores/appStore";
import { useProofreadStore } from "../stores/proofreadStore";
import { splitParagraphs, splitTextChunks } from "../utils/chapterSplit";
import {
	sendChatCompletion,
	PROOFREAD_SYSTEM_PROMPT,
	buildProofreadUserPrompt,
	extractJSON,
} from "../utils/aiClient";
import type { ProofreadError, CheckGranularity } from "../types";

function parseErrors(raw: unknown[], chapterId: number, index: number, text: string): ProofreadError[] {
	const errors: ProofreadError[] = [];
	for (const obj of raw) {
		if (typeof obj !== "object" || obj === null) continue;
		const o = obj as Record<string, unknown>;
		const orig = String(o.original_text ?? "");
		const corr = String(o.corrected_text ?? "");
		if (!orig) continue;
		const idx = text.indexOf(orig);
		const startIdx = idx >= 0 ? idx : 0;
		errors.push({
			id: `err-${chapterId}-${index}-${errors.length}`,
			startIndex: startIdx,
			endIndex: startIdx + orig.length,
			errorType: (o.error_type as ProofreadError["errorType"]) || "typo",
			suggestion: String(o.suggestion ?? ""),
			originalText: orig,
			correctedText: corr,
			applied: false,
		});
	}
	return errors;
}

export function useAICheck() {
	const aiConfig = useAppStore((s) => s.aiConfig);
	const chapters = useAppStore((s) => s.chapters);
	const currentChapterIndex = useAppStore((s) => s.currentChapterIndex);
	const setResults = useProofreadStore((s) => s.setResults);
	const updateParagraphResult = useProofreadStore((s) => s.updateParagraphResult);
	const abortRef = useRef<AbortController | null>(null);

	const checkChapter = useCallback(async (granularity: CheckGranularity, startFrom: number = 0) => {
		const chapter = chapters[currentChapterIndex];
		if (!chapter) return;

		abortRef.current?.abort();
		const controller = new AbortController();
		abortRef.current = controller;

		const text = chapter.content;

		if (granularity === "chapter") {
			setResults(chapter.id, [{ paragraphIndex: 0, originalText: text, errors: [], status: "checking" }]);
			try {
				const chunks = splitTextChunks(text, aiConfig.maxCharsPerRequest);
				const allErrors: ProofreadError[] = [];
				let globalOffset = 0;

				for (const chunk of chunks) {
					const messages = [
						{ role: "system" as const, content: PROOFREAD_SYSTEM_PROMPT },
						{ role: "user" as const, content: buildProofreadUserPrompt(chunk) },
					];
					const reply = await sendChatCompletion(messages, aiConfig, controller.signal);
					const raw = extractJSON(reply);

					for (const item of raw) {
						if (typeof item !== "object" || item === null) continue;
						const obj = item as Record<string, unknown>;
						const orig = String(obj.original_text ?? "");
						const corr = String(obj.corrected_text ?? "");
						if (!orig) continue;
						const idx = chunk.indexOf(orig);
						const startIdx = idx >= 0 ? idx + globalOffset : globalOffset;
						allErrors.push({
							id: `err-${chapter.id}-0-${allErrors.length}`,
							startIndex: startIdx,
							endIndex: startIdx + orig.length,
							errorType: (obj.error_type as ProofreadError["errorType"]) || "typo",
							suggestion: String(obj.suggestion ?? ""),
							originalText: orig,
							correctedText: corr,
							applied: false,
						});
					}
					globalOffset += chunk.length;
				}
				updateParagraphResult(chapter.id, 0, { errors: allErrors, status: "done" });
			} catch (err: unknown) {
				if (err instanceof DOMException && err.name === "AbortError") return;
				updateParagraphResult(chapter.id, 0, { status: "error", errorMessage: err instanceof Error ? err.message : String(err) });
			}
		} else {
			const allLines = splitParagraphs(text);
			const filteredItems = allLines.filter((p) => p.trim() !== "");
			const indexMap: number[] = [];
			allLines.forEach((line, i) => { if (line.trim() !== "") indexMap.push(i); });

			setResults(chapter.id, filteredItems.map((p, i) => ({
				paragraphIndex: indexMap[i],
				originalText: p,
				errors: [],
				status: (i < startFrom ? "done" : "pending") as "done" | "pending",
			})));

			for (let i = startFrom; i < filteredItems.length; i++) {
				if (controller.signal.aborted) break;
				updateParagraphResult(chapter.id, i, { status: "checking" });
				const item = filteredItems[i];

				if (item.trim().length < 5) {
					updateParagraphResult(chapter.id, i, { status: "done" });
					continue;
				}

				try {
					const messages = [
						{ role: "system" as const, content: PROOFREAD_SYSTEM_PROMPT },
						{ role: "user" as const, content: buildProofreadUserPrompt(item) },
					];
					const reply = await sendChatCompletion(messages, aiConfig, controller.signal);
					updateParagraphResult(chapter.id, i, { errors: parseErrors(extractJSON(reply), chapter.id, i, item), status: "done" });
				} catch (err: unknown) {
					if (err instanceof DOMException && err.name === "AbortError") return;
					updateParagraphResult(chapter.id, i, { status: "error", errorMessage: err instanceof Error ? err.message : String(err) });
				}
			}
		}
	}, [chapters, currentChapterIndex, aiConfig, setResults, updateParagraphResult]);

	const cancelCheck = useCallback(() => { abortRef.current?.abort(); }, []);

	const checkSingleLine = useCallback(async (lineIndex: number, setSingleCheckingLine: (v: number | null) => void) => {
		const chapter = chapters[currentChapterIndex];
		if (!chapter) return;

		setSingleCheckingLine(lineIndex);
		const lines = splitParagraphs(chapter.content).filter((p) => p.trim() !== "");
		if (lineIndex >= lines.length) { setSingleCheckingLine(null); return; }

		const lineText = lines[lineIndex];
		const existing = useProofreadStore.getState().results[chapter.id];
		if (!existing || existing.length === 0) {
			setResults(chapter.id, lines.map((p, i) => ({ paragraphIndex: i, originalText: p, errors: [], status: "done" as const })));
		} else {
			updateParagraphResult(chapter.id, lineIndex, { status: "checking", errors: [] });
		}

		try {
			const messages = [
				{ role: "system" as const, content: PROOFREAD_SYSTEM_PROMPT },
				{ role: "user" as const, content: buildProofreadUserPrompt(lineText) },
			];
			const reply = await sendChatCompletion(messages, aiConfig);
			updateParagraphResult(chapter.id, lineIndex, { errors: parseErrors(extractJSON(reply), chapter.id, lineIndex, lineText), status: "done" });
		} catch (err: unknown) {
			updateParagraphResult(chapter.id, lineIndex, { status: "error", errorMessage: err instanceof Error ? err.message : String(err) });
		} finally {
			setSingleCheckingLine(null);
		}
	}, [chapters, currentChapterIndex, aiConfig, setResults, updateParagraphResult]);

	return { checkChapter, cancelCheck, checkSingleLine };
}