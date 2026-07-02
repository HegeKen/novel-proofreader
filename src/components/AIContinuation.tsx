import { useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useNovelStore } from "../stores/novelStore";
import { useCharacterStore } from "../stores/characterStore";
import { useAIConfigStore } from "../stores/aiConfigStore";
import { useAppMetaStore } from "../stores/appMetaStore";
import { generateContinuation } from "../utils/aiClient";
import type { ContinuationParams } from "../utils/aiClient";
import { Icons } from "./Icons";

export function AIContinuation() {
	const [isGenerating, setIsGenerating] = useState(false);
	const continuationContentRef = useRef<string>("");
	const [continuationContent, setContinuationContent] = useState("");
	const [showPreview, setShowPreview] = useState(false);

	const chapters = useNovelStore((s) => s.chapters);
	const currentNovelId = useNovelStore((s) => s.currentNovelId);

	// AI续写当前章节
	const handleGenerate = useCallback(async () => {
		if (!currentNovelId || chapters.length === 0) return;
		const aiConfig = useAIConfigStore.getState().aiConfig;
		if (!aiConfig.apiKey || !aiConfig.baseURL) {
			useAppMetaStore.getState().showToast("请先在设置中配置AI模型", "warning");
			return;
		}

		const lastChapterIndex = chapters.length - 1;
		const lastChapter = chapters[lastChapterIndex];
		if (!lastChapter) return;

		setIsGenerating(true);
		try {
			// 获取最近3章作为风格参考
			const recentChapters = [];
			for (let i = Math.max(0, lastChapterIndex - 2); i <= lastChapterIndex; i++) {
				const ch = chapters[i];
				if (ch) {
					recentChapters.push({ title: ch.title || `第${i + 1}章`, content: ch.content });
				}
			}

			// 获取当前章节最后20段作为衔接上下文
			const allParagraphs = lastChapter.content.split("\n").filter(p => p.trim());
			const lastParagraphs = allParagraphs.slice(-20).join("\n");

			// 获取角色信息
			const allChars = useCharacterStore.getState().novelCharacters[currentNovelId] ?? [];

			// 获取角色关系
			const allRelationships = useCharacterStore.getState().characterRelationships[currentNovelId] ?? [];
			const relationships = allRelationships.map(r => {
				const srcChar = allChars.find(c => c.id === r.sourceId);
				const tgtChar = allChars.find(c => c.id === r.targetId);
				return {
					sourceName: srcChar?.name || "未知",
					targetName: tgtChar?.name || "未知",
					relationType: r.relationType as string[] | undefined,
					customRelationType: r.customRelationType,
					sourceNickname: r.sourceNickname,
					targetNickname: r.targetNickname,
				};
			});

			// 获取世界观
			const wb = useCharacterStore.getState().worldbuilding[currentNovelId];
			const worldbuildingText = wb ? [
				wb.worldType ? `世界类型: ${wb.worldType}` : "",
				wb.eraDescription ? `时代: ${wb.eraDescription}` : "",
				wb.geography ? `地理: ${wb.geography}` : "",
				wb.socialStructure ? `社会结构: ${wb.socialStructure}` : "",
				wb.powerSystem ? `力量体系: ${wb.powerSystem}` : "",
				wb.civilization ? `文明: ${wb.civilization}` : "",
				wb.history ? `历史: ${wb.history}` : "",
				wb.coreSettings ? `核心设定: ${wb.coreSettings}` : "",
				wb.description ? `描述: ${wb.description}` : "",
			].filter(Boolean).join("\n") : "";

			const params: ContinuationParams = {
				recentChapters,
				lastParagraphs,
				targetWordCount: Math.max(...chapters.map(ch => ch.content.length), 3000),
				characters: allChars.map(c => ({
					name: c.name,
					gender: c.gender,
					role: c.role,
					age: c.age,
					identity: c.identity,
					socialStatus: c.socialStatus,
					personality: c.personality,
					appearance: c.appearance,
					background: c.background,
					characterArc: c.characterArc,
					notes: c.notes,
					aliases: c.aliases,
					relationTerms: c.relationTerms,
					majorEvents: c.majorEvents,
				})),
				relationships,
				worldbuilding: worldbuildingText,
			};

			const config = {
				baseURL: aiConfig.baseURL,
				apiKey: aiConfig.apiKey,
				model: aiConfig.model,
				customHeaders: {} as Record<string, string>,
				maxCharsPerRequest: 0,
				enableLogging: false,
			};

			const result = await generateContinuation(params, config);

			continuationContentRef.current = result;
			setContinuationContent(result);
			setShowPreview(true);

			useAppMetaStore.getState().showToast(`续写完成，生成 ${result.length} 字符`, "success");
		} catch (err) {
			useAppMetaStore.getState().showToast("续写失败: " + (err instanceof Error ? err.message : String(err)), "error");
		} finally {
			setIsGenerating(false);
		}
	}, [currentNovelId, chapters]);

	// 确认追加
	const handleApply = useCallback(() => {
		const content = continuationContentRef.current;
		if (!content || chapters.length === 0) return;
		const lastChapterIndex = chapters.length - 1;
		useNovelStore.getState().appendToChapter(lastChapterIndex, content);
		continuationContentRef.current = "";
		setContinuationContent("");
		setShowPreview(false);
		useAppMetaStore.getState().showToast("续写内容已追加到章节末尾", "success");
	}, [chapters]);

	// 取消
	const handleCancel = useCallback(() => {
		continuationContentRef.current = "";
		setContinuationContent("");
		setShowPreview(false);
	}, []);

	return (
		<>
			{/* 续写按钮 — 放在章节列表末尾 */}
			<div className="chapter-list-continuation">
				<button
					className="chapter-list-continuation-btn"
					onClick={handleGenerate}
					disabled={isGenerating || chapters.length === 0}
					title="AI续写"
				>
					{isGenerating ? (
						<>
							<span className="spinner"></span>
							<span>AI续写中...</span>
						</>
					) : (
						<>
							<Icons.penLine size={16} />
							<span>AI续写</span>
						</>
					)}
				</button>
			</div>

			{/* 续写预览弹窗 — 全局渲染 */}
			{showPreview && createPortal(
				<div className="modal-overlay" onClick={handleCancel}>
					<div className="config-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "700px" }}>
						<div className="config-header">
							<div className="config-title">
								<Icons.penLine size={18} />
								<span>AI续写预览</span>
							</div>
							<button className="close-btn" onClick={handleCancel}>
								<Icons.x size={16} />
							</button>
						</div>
						<div className="config-body">
							<div className="mb-3 text-xs text-neutral-400">
								以下内容由AI根据角色设定、世界观和当前章节上下文生成，将追加到最后一章末尾。
							</div>
							<textarea
								className="config-input"
								value={continuationContent}
								readOnly
								rows={20}
								style={{ fontSize: "14px", lineHeight: "1.8", fontFamily: "inherit" }}
							/>
						</div>
						<div className="flex justify-end gap-2 pt-2">
							<button className="btn" onClick={handleCancel}>
								<Icons.x size={14} />
								<span>取消</span>
							</button>
							<button className="btn btn-primary" onClick={handleApply}>
								<Icons.saveIcon size={14} />
								<span>确认追加</span>
							</button>
						</div>
					</div>
				</div>,
				document.body
			)}
		</>
	);
}
