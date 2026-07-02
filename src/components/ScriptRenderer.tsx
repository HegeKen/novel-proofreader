// ============================================================
// 剧本渲染组件 — 将 MD 样式剧本解析为结构化 JSX 展示
// ============================================================
import { useMemo } from "react";
import { parseScriptBlocks } from "../utils/scriptMarkdown";
import { Icons } from "./Icons";
import type { CharacterInfo } from "../types";

interface ScriptRendererProps {
	content: string;
	currentDialogueIndex?: number;
	onDialogueClick?: (index: number) => void;
	characters?: CharacterInfo[];
}

function extractSceneNumber(header: string): string {
	const match = header.match(/^场景\s*(\d+)|^(\d+)[.、]/);
	return match ? (match[1] || match[2]) : "";
}

function extractSceneTitle(header: string): string {
	const cleaned = header
		.replace(/^场景\s*\d*\s*[：:]\s*/, "")
		.replace(/^\d+[.、]\s*/, "");
	return cleaned || header;
}

function extractSceneAtmosphere(header: string): string {
	const match = header.match(/[-—–]\s*([^-—–]+?)\s*$/);
	return match ? match[1].trim() : "";
}

function findCharacterInfo(name: string, characters?: CharacterInfo[]): CharacterInfo | undefined {
	if (!characters || characters.length === 0) return undefined;
	const lower = name.toLowerCase();
	return characters.find(
		(c) =>
			c.name.toLowerCase() === lower ||
			c.aliases?.some((a) => a.toLowerCase() === lower),
	);
}

function getCharacterInitial(name: string): string {
	return name.charAt(0);
}

function getGenderClass(gender?: string): string {
	switch (gender) {
		case "male":
			return "gender-male";
		case "female":
			return "gender-female";
		default:
			return "gender-other";
	}
}

export function ScriptRenderer({ content, currentDialogueIndex = -1, onDialogueClick, characters }: ScriptRendererProps) {
	const blocks = useMemo(() => parseScriptBlocks(content), [content]);

	const dialogueCount = useMemo(() => {
		return blocks.filter((b) => b.type === "dialogue").length;
	}, [blocks]);

	let dialogueIndex = 0;
	const scenes: { header: string; children: React.ReactNode[]; mdLevel?: number; atmosphere?: string }[] = [];
	let currentScene: { header: string; children: React.ReactNode[]; mdLevel?: number; atmosphere?: string } | null = null;

	blocks.forEach((block) => {
		if (block.type === "scene-header" || block.type === "title") {
			if (currentScene) scenes.push(currentScene);
			const atmosphere = block.type === "scene-header" ? extractSceneAtmosphere(block.text) : undefined;
			currentScene = { header: block.text, children: [], atmosphere };
		} else if (block.type === "markdown-header") {
			if (currentScene) scenes.push(currentScene);
			currentScene = { header: block.text, children: [], mdLevel: block.level };
		} else if (block.type === "separator") {
			return;
		} else {
			if (!currentScene) {
				currentScene = { header: "", children: [] };
			}
			const key = `${block.type}-${currentScene.children.length}`;
			if (block.type === "dialogue") {
				const dIdx = dialogueIndex++;
				const isActive = dIdx === currentDialogueIndex;
				const charInfo = findCharacterInfo(block.character, characters);
				const genderCls = getGenderClass(charInfo?.gender);
				const initial = getCharacterInitial(block.character);
				const hasVoiceDesign = !!charInfo?.voiceDesignPrompt;

				currentScene.children.push(
					<div
						key={key}
						className={`script-dialogue ${isActive ? "script-dialogue-active" : ""} ${genderCls}`}
						onClick={() => onDialogueClick?.(dIdx)}
						data-dialogue-index={dIdx}
					>
						<div className="script-dialogue-avatar">
							<span className={`dialogue-avatar-circle ${genderCls}`}>{initial}</span>
						</div>
						<div className="script-dialogue-content">
							<div className="script-dialogue-header">
								<span className={`script-character-name ${genderCls}`}>
									{block.character}
									{hasVoiceDesign && (
										<span className="voice-design-badge" title="已设置音色设计">
											<Icons.sparkles size={10} />
										</span>
									)}
								</span>
								{block.emotion && (
									<span className="script-emotion">
										<Icons.sparkle size={10} />
										{block.emotion}
									</span>
								)}
								<span className="dialogue-index-badge">{dIdx + 1}/{dialogueCount}</span>
							</div>
							<div className="script-dialogue-text">{block.text}</div>
						</div>
					</div>,
				);
			} else if (block.type === "action") {
				currentScene.children.push(
					<div key={key} className="script-action">
						<span className="script-action-icon">
							<Icons.script size={12} />
						</span>
						<span className="script-action-text">{block.text}</span>
					</div>,
				);
			} else if (block.type === "character-list") {
				currentScene.children.push(
					<div key={key} className="script-character-list">
						<span className="script-character-list-label">
							<Icons.userRound size={12} />
							人物
						</span>
						<div className="script-character-items">
							{block.characters.map((c, j) => {
								const charInfo = findCharacterInfo(c, characters);
								const genderCls = getGenderClass(charInfo?.gender);
								return (
									<span key={j} className={`script-character-tag ${genderCls}`}>
										{charInfo && (
											<span className={`tag-avatar-dot ${genderCls}`}></span>
										)}
										{c}
									</span>
								);
							})}
						</div>
					</div>,
				);
			} else if (block.type === "scene-description") {
				currentScene.children.push(
					<div key={key} className="script-scene-description">
						<Icons.info size={12} />
						<span>{block.text}</span>
					</div>,
				);
			} else if (block.type === "transition") {
				currentScene.children.push(
					<div key={key} className="script-transition">
						<Icons.chevronRight size={12} />
						{block.text}
						<Icons.chevronRight size={12} />
					</div>,
				);
			} else if (block.type === "narration") {
				currentScene.children.push(
					<div key={key} className="script-narration">
						<span className="narration-prefix">◆</span>
						{block.text}
					</div>,
				);
			}
		}
	});
	if (currentScene) scenes.push(currentScene);

	return (
		<div className="script-renderer">
			{scenes.map((scene, si) => {
				if (!scene.header) {
					return (
						<div key={si} className="script-scene-unnamed">
							{scene.children}
						</div>
					);
				}
				const isTitle = /^第.{1,8}章/.test(scene.header);
				if (isTitle) {
					return (
						<div key={si} className="script-title-wrap">
							<div className="script-title-divider"></div>
							<div className="script-title">{scene.header}</div>
							<div className="script-title-divider"></div>
						</div>
					);
				}
				if (scene.mdLevel) {
					return (
						<div key={si}>
							<div className={`script-md-header script-md-h${scene.mdLevel}`}>{scene.header}</div>
							{scene.children.length > 0 && (
								<div className="script-md-header-body">{scene.children}</div>
							)}
						</div>
					);
				}
				const sceneNum = extractSceneNumber(scene.header);
				const sceneTitle = extractSceneTitle(scene.header);
				return (
					<div key={si} className="script-scene-card">
						<div className="script-scene-card-header">
							<div className="scene-header-left">
								{sceneNum && <span className="script-scene-badge">场景 {sceneNum}</span>}
								<span className="script-scene-card-title">{sceneTitle}</span>
							</div>
							{scene.atmosphere && (
								<span className="script-atmosphere-tag">
									<Icons.sparkle size={11} />
									{scene.atmosphere}
								</span>
							)}
						</div>
						<div className="script-scene-card-body">
							{scene.children}
						</div>
					</div>
				);
			})}
		</div>
	);
}
