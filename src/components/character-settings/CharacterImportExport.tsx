import { useState, useCallback } from "react";
import type { CharacterInfo, CharacterRelationship, NovelWorldbuilding, NovelEvent } from "../../types";
import { Icons } from "../Icons";
import { useAppMetaStore } from "../../stores/appMetaStore";
import { formatDateTime } from "../../utils/formatters";
import { logger } from "../../utils/logger";

interface CharacterImportExportProps {
	characters: CharacterInfo[];
	relationships: CharacterRelationship[];
	nodePositions: Record<string, { x: number; y: number }>;
	ignoredWords: string[];
	ignoredCharacterNames: string[];
	novelCategory: string | null;
	worldbuilding: NovelWorldbuilding | null;
	events: NovelEvent[];
	novelId: string;
	novelName: string;
	onImport: (data: string) => void;
}

export function CharacterImportExport({
	characters,
	relationships,
	nodePositions,
	ignoredWords,
	ignoredCharacterNames,
	novelCategory,
	worldbuilding,
	events,
	novelId,
	novelName,
	onImport,
}: CharacterImportExportProps) {
	const [isMobile] = useState(false);
	const [exportModal, setExportModal] = useState<{
		show: boolean;
		success: boolean;
		fileName: string;
		dataStr: string;
		characterCount: number;
		relationshipCount?: number;
	}>({
		show: false,
		success: false,
		fileName: "",
		dataStr: "",
		characterCount: 0,
	});

	const copyToClipboard = useCallback(async (data: string) => {
		const CHUNK_SIZE = 25 * 1024;

		try {
			if (isMobile && data.length > CHUNK_SIZE) {
				const totalChunks = Math.ceil(data.length / CHUNK_SIZE);
				useAppMetaStore.getState().showToast(`数据较大，将分 ${totalChunks} 次复制`, "info");

				for (let i = 0; i < totalChunks; i++) {
					const start = i * CHUNK_SIZE;
					const end = Math.min(start + CHUNK_SIZE, data.length);
					const chunk = data.substring(start, end);

					await navigator.clipboard.writeText(chunk);

					if (i < totalChunks - 1) {
						await new Promise<void>((resolve) => {
							useAppMetaStore.getState().showToast(`已复制第 ${i + 1}/${totalChunks} 部分`, "info");
							setTimeout(resolve, 500);
						});
					}
				}

				useAppMetaStore.getState().showToast(`成功复制全部 ${totalChunks} 部分数据！`, "success");
			} else {
				await navigator.clipboard.writeText(data);
				useAppMetaStore.getState().showToast("已复制到剪贴板！", "success");
			}
		} catch (err) {
			logger.errorGeneric('CharacterImportExport - 复制失败:', err);
			useAppMetaStore.getState().showToast("复制失败，请手动选择复制", "error");
		}
	}, [isMobile]);

	const handleExport = useCallback(async () => {
		const exportData = {
			version: "2.0",
			novelId,
			novelName,
			exportTime: formatDateTime(new Date()),
			characters: characters.map(char => ({
				id: char.id,
				name: char.name,
				gender: char.gender,
				role: char.role,
				order: char.order,
				relationTerms: char.relationTerms || [],
				aliases: char.aliases || [],
				age: char.age || "",
				appearance: char.appearance || "",
				identity: char.identity || "",
				socialStatus: char.socialStatus || "",
				personality: char.personality || "",
				background: char.background || "",
				characterArc: char.characterArc || "",
				notes: char.notes || "",
				voice: char.voice || "",
				voiceDesignPrompt: char.voiceDesignPrompt || "",
			})),
			relationships: relationships.map(rel => ({
				id: rel.id,
				sourceId: rel.sourceId,
				targetId: rel.targetId,
				relationType: rel.relationType,
				customRelationType: rel.customRelationType,
				sourceNickname: rel.sourceNickname || [],
				targetNickname: rel.targetNickname || [],
			})),
			nodePositions,
			ignoredWords,
			ignoredCharacterNames,
			novelCategory,
			worldbuilding: worldbuilding || null,
			events,
		};

		const dataStr = JSON.stringify(exportData, null, 2);
		const safeName = (novelName || "小说设置").replace(/[\\/:*?"<>|]/g, "_");
		const fileName = `${safeName}-小说设置-${new Date().toISOString().split("T")[0]}.json`;

		try {
			const { save } = await import("@tauri-apps/plugin-dialog");
			const { writeTextFile } = await import("@tauri-apps/plugin-fs");
			const filePath = await save({
				defaultPath: fileName,
				filters: [{ name: "JSON Files", extensions: ["json"] }],
			});
			if (filePath) {
				await writeTextFile(filePath, dataStr);
				logger.file("小说设置导出成功:", filePath);
				setExportModal({
					show: true,
					success: true,
					fileName,
					dataStr,
					characterCount: characters.length,
					relationshipCount: relationships.length,
				});
			}
		} catch (e) {
			logger.errorGeneric("CharacterImportExport - 导出失败:", e);
			useAppMetaStore.getState().showToast("导出失败，请重试", "error");
		}
	}, [characters, relationships, nodePositions, ignoredWords, ignoredCharacterNames, novelCategory, worldbuilding, events, novelId, novelName]);

	const handleImport = useCallback(() => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = ".json";
		input.onchange = async (e) => {
			const file = (e.target as HTMLInputElement).files?.[0];
			if (!file) return;

			const reader = new FileReader();
			reader.onload = async (event) => {
				try {
					const data = event.target?.result as string;
					onImport(data);
				} catch (err) {
					useAppMetaStore.getState().showToast("文件解析失败：" + (err instanceof Error ? err.message : String(err)), "error");
				}
			};
			reader.readAsText(file);
		};
		input.click();
	}, [onImport]);

	return (
		<div className="import-export-section">
			<div className="section-header">
				<h3>导入/导出</h3>
			</div>
			<div className="import-export-actions">
				<button className="btn" onClick={handleExport}>
					<Icons.download size={14} />
					导出角色设置
				</button>
				<button className="btn" onClick={handleImport}>
					<Icons.upload size={14} />
					导入角色设置
				</button>
			</div>
			{exportModal.show && (
				<div className="modal-overlay" onClick={() => setExportModal({ ...exportModal, show: false })}>
					<div className="config-modal" onClick={(e) => e.stopPropagation()}>
						<div className="config-header">
							<h3>导出成功</h3>
							<button className="close-btn" onClick={() => setExportModal({ ...exportModal, show: false })}>
								<Icons.x size={16} />
							</button>
						</div>
						<div className="config-body">
							<div className="export-info">
								<p className="export-file-name">{exportModal.fileName}</p>
								<div className="export-stats">
									<span>角色: {exportModal.characterCount}</span>
									{exportModal.relationshipCount && <span>关系: {exportModal.relationshipCount}</span>}
								</div>
							</div>
							<div className="export-actions">
								<button className="btn" onClick={() => copyToClipboard(exportModal.dataStr)}>
									<Icons.copy size={14} />
									复制到剪贴板
								</button>
							</div>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}