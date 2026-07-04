// ============================================================
// 剧本 Markdown 解析 — 将 AI 返回的 MD 样式剧本解析为结构化块
// 同时提供 plain text 转换，供 TTS 请求使用
// ============================================================
import type { ScriptJSON as ScriptJSONType, ScriptScene } from "../types";
import { repairTruncatedJson } from "./aiClient";

export type ScriptBlock =
	| { type: "title"; text: string }
	| { type: "markdown-header"; text: string; level: number }
	| { type: "scene-header"; text: string }
	| { type: "character-list"; characters: string[] }
	| { type: "scene-description"; text: string }
	| { type: "separator" }
	| { type: "action"; text: string }
	| { type: "dialogue"; character: string; emotion?: string; tone?: string; text: string }
	| { type: "transition"; text: string }
	| { type: "narration"; text: string };

export type DialogueBlock = Extract<ScriptBlock, { type: "dialogue" }>;

// 非角色标记，解析对话时跳过
const NON_CHARACTER_MARKERS = ["动作", "场景", "转场", "内心独白", "人物", "场景描述", "旁白"];

/** 场景 JSON 结构 — 复用 types/index.ts 中的 ScriptScene，仅重写 blocks 类型以匹配本地 ScriptBlock 联合类型 */
interface ScriptSceneJSON extends Omit<ScriptScene, "blocks"> {
	blocks: ScriptBlock[];
}

/** 剧本 JSON 结构 — 复用 types/index.ts 中的 ScriptJSONType，仅重写 scenes 类型以匹配本地 ScriptSceneJSON */
interface ScriptJSON extends Omit<ScriptJSONType, "scenes"> {
	scenes: ScriptSceneJSON[];
}

/**
 * 判断是否为 AI 开场白（"好的，这是..."等），需跳过
 */
function isAiIntro(line: string): boolean {
	return /^(好的|这是|根据|以下|当然|没问题)/.test(line);
}

/**
 * 找到文本中第一个匹配的情绪词
 */
function findEmotionWord(text: string): string | null {
	const emotions = [
		"怅然", "慵懒", "开心", "悲伤", "愤怒", "恐惧", "惊讶", "兴奋",
		"委屈", "平静", "冷漠", "欣慰", "无奈", "愧疚", "释然", "嫉妒",
		"厌倦", "忐忑", "动情", "尖锐", "鄙夷", "温柔", "高冷", "活泼",
		"严肃", "俏皮", "深沉", "干练", "凌厉",
		// 用于自然语言描述中的情绪/语调关键词
		"压抑", "喘息", "颤抖", "哽咽", "低沉", "激动", "紧张", "轻松",
		"疲惫", "虚弱", "坚定", "犹豫", "轻蔑", "嘲讽", "苦笑", "冷笑",
		"叹息", "绝望", "焦虑", "烦躁", "暴躁", "温和", "亲切", "冷淡",
		"沙哑", "嘶哑", "轻柔", "尖锐", "低沉", "高亢", "缓慢", "急促",
		"扭曲", "嘶吼",
	];
	return emotions.find((e) => text.includes(e)) || null;
}

/**
 * 将剧本内容解析为结构化块数组
 * 兼容两种格式：
 * 1. Markdown 格式：**角色名** （情绪）\n    ：对话
 * 2. 纯文本格式：角色名：对话（同行）
 * @param knownCharacters 已知角色名列表，用于辅助识别纯角色名行
 */
export function parseScriptBlocks(content: string): ScriptBlock[] {
	const blocks: ScriptBlock[] = [];
	const lines = content.split("\n");

	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i].trim();
		if (!trimmed) continue;

		const stripped = trimmed.replace(/\*\*/g, "");

		// 跳过 AI 开场白
		if (blocks.length === 0 && isAiIntro(stripped)) continue;

		// 分隔线 ---
		if (/^-{3,}$/.test(stripped)) {
			blocks.push({ type: "separator" });
			continue;
		}

		// Markdown 标题：# ## ### 等
		const mdHeaderMatch = stripped.match(/^(#{1,6})\s*(.+)$/);
		if (mdHeaderMatch) {
			const headerText = mdHeaderMatch[2].trim();
			const level = mdHeaderMatch[1].length;
			// 章节标题（第N章）仍作为 title 类型，便于和纯文本章节标题统一渲染
			if (/^第.{1,8}章(?:\s|$|：)/.test(headerText)) {
				blocks.push({ type: "title", text: headerText });
			} else {
				blocks.push({ type: "markdown-header", text: headerText, level });
			}
			continue;
		}

		// 章节标题：第N章 xxx
		if (/^第.{1,8}章(?:\s|$|：)/.test(stripped)) {
			blocks.push({ type: "title", text: stripped });
			continue;
		}

		// 角色列表：人物：\n- 角色1\n- 角色2
		if (/^人物[：:]/.test(stripped)) {
			const characters: string[] = [];
			let j = i + 1;
			while (j < lines.length) {
				const t = lines[j].trim().replace(/\*\*/g, "");
				if (/^[-•]\s+/.test(t)) {
					characters.push(t.replace(/^[-•]\s+/, ""));
					j++;
				} else {
					break;
				}
			}
			if (characters.length > 0) {
				blocks.push({ type: "character-list", characters });
				i = j - 1;
			}
			continue;
		}

		// 场景描述
		if (/^场景描述[：:]/.test(stripped)) {
			const text = stripped.replace(/^场景描述[：:]\s*/, "");
			blocks.push({ type: "scene-description", text });
			continue;
		}

		// 场景头：场景 N：... 或 场景：... 或 N. 内景...
		if (/^场景\s*\d*\s*[：:]/.test(stripped) || /^场景\s*\d/.test(stripped)) {
			blocks.push({ type: "scene-header", text: stripped });
			continue;
		}
		if (/^\d+[.、]\s/.test(stripped)) {
			blocks.push({ type: "scene-header", text: stripped });
			continue;
		}

		// 转场
		if (/^转场[：:]/.test(stripped)) {
			blocks.push({ type: "transition", text: stripped });
			continue;
		}

		// 动作描述：（...）整行包裹
		if (/^[（(].*[）)]$/.test(stripped) && stripped.length > 2) {
			const text = stripped.slice(1, -1);
			blocks.push({ type: "action", text });
			continue;
		}

		// 动作：... （纯文本格式）
		if (/^动作[：:]/.test(stripped)) {
			blocks.push({ type: "action", text: stripped.replace(/^动作[：:]\s*/, "") });
			continue;
		}

		// 内心独白
		if (/^内心独白[：:]/.test(stripped)) {
			blocks.push({ type: "narration", text: stripped });
			continue;
		}

		// Markdown 对话格式：角色名 （情绪）\n    ：对话
		const mdDialogueMatch = stripped.match(/^(.+?)(?:\s*[（(]([^）)]*)[）)])?$/);
		if (mdDialogueMatch && i + 1 < lines.length) {
			const character = mdDialogueMatch[1].trim();
			const emotion = mdDialogueMatch[2]?.trim();
			const nextTrimmed = lines[i + 1].trim();
			if (nextTrimmed.startsWith("：") && !NON_CHARACTER_MARKERS.includes(character)) {
				const text = nextTrimmed.replace(/^[\s：]+/, "").trim();
				blocks.push({ type: "dialogue", character, emotion: emotion || undefined, text });
				i++;
				continue;
			}
		}

		// 角色介绍列表项：- 角色名（别名）——描述 / - 角色名：描述
		// （必须在 plainMatch 之前检查，避免把角色介绍中的冒号误识别为对话）
		const listCharMatch = stripped.match(/^[-*+]\s+(.+?)\s*(?:[（(]([^）)]+)[）)])?\s*(?:——|--|：|:)\s*(.+)$/);
		if (listCharMatch) {
			const charName = listCharMatch[1].trim();
			const description = listCharMatch[3]?.trim() || "";
			if (charName && charName.length <= 20 && description.length > 0 &&
				!NON_CHARACTER_MARKERS.includes(charName) &&
				!/^(场景|动作|转场|旁白|内心独白|人物)/.test(charName)) {
				// 单行角色介绍，作为角色列表项（单元素）
				blocks.push({ type: "character-list", characters: [charName] });
				continue;
			}
		}

		// 纯文本对话格式：角色名：对话（同行，兼容含 ** 的情况）
		// 支持全角：和半角: 冒号
		const plainMatch = stripped.match(/^(.+?)[：:](.+)$/);
		if (plainMatch) {
			const character = plainMatch[1].trim();
			const text = plainMatch[2].trim();
			// 排除条件：
			// 1. Markdown 列表项开头（- * +）
			// 2. 角色名含括号但括号不在末尾（说明是角色介绍/注释，不是情绪标注）
			// 3. 角色名含破折号（可能是角色介绍）
			// 4. 角色名过长（>15字）
			// 5. 含非角色标记关键词
			const isList = /^[-*+]\s/.test(character);
			const hasMidBracket = /[（(].+[）)].+/.test(character); // 括号后还有内容
			const hasDash = /[—-]/.test(character);
			const tooLong = character.length > 15;
			// 提取纯角色名（去掉括号内容）检查非角色标记
			const cleanForCheck = character.replace(/\s*[（(][^）)]*[）)]\s*$/, "").trim();
			const hasNonMarker = NON_CHARACTER_MARKERS.some(
				(m) => cleanForCheck.includes(m),
			);
			if (
				character && text &&
				!isList && !hasMidBracket && !hasDash && !tooLong && !hasNonMarker
			) {
				// 从角色名中提取情绪/语调
				let emotion: string | undefined;
				let tone: string | undefined;
				const emotionMatch = character.match(/[（(]([^）)]+)[）)]$/);
				if (emotionMatch) {
					const emotionStr = emotionMatch[1].trim();
					const foundEmotion = findEmotionWord(emotionStr);
					if (foundEmotion) {
						emotion = foundEmotion;
						const remaining = emotionStr.replace(foundEmotion, "");
						const foundTone = findEmotionWord(remaining);
						if (foundTone && foundTone !== foundEmotion) tone = foundTone;
					}
				}
				blocks.push({ type: "dialogue", character, emotion, tone, text });
				continue;
			}
		}

		// 兜底：旁白/其他
		blocks.push({ type: "narration", text: stripped });
	}

	return blocks;
}

/**
 * 合并对话块 — 将 role:action/narration:dialogue 的连续块合并为 dialogue 块
 */
function mergeDialogueBlocks(blocks: ScriptBlock[], knownCharacters?: string[]): ScriptBlock[] {
	const merged: ScriptBlock[] = [];
	const isKnownCharacter = (name: string): boolean => {
		if (!knownCharacters || knownCharacters.length === 0) return true;
		const lower = name.toLowerCase().trim();
		return knownCharacters.some((c) => c.toLowerCase() === lower);
	};

	for (let i = 0; i < blocks.length; i++) {
		const current = blocks[i];

		if (current.type === "narration") {
			const text = current.text.trim();
			const charMatch = text.match(/^(.+?)[:：]$/);
			// 也支持无冒号的纯角色名（如 "黄老蔫" 后跟动作/对话）
			const nameOnly = !charMatch && text.length <= 15 && isKnownCharacter(text);
			const characterRaw = charMatch ? charMatch[1].trim() : (nameOnly ? text : null);

			if (characterRaw) {
				// 去掉括号内容后再检查长度和角色名匹配
				const cleanName = characterRaw.replace(/\s*[（(][^）)]*[）)]\s*$/, "").trim() || characterRaw;
				if (cleanName.length <= 15 && isKnownCharacter(cleanName)) {
					let emotion: string | undefined;
					let tone: string | undefined;
					let dialogueText = "";

					// 从角色名末尾括号中提取情绪/语调
					const emotionMatch = characterRaw.match(/[（(]([^）)]+)[）)]$/);
					if (emotionMatch) {
						const emotionStr = emotionMatch[1].trim();
						const foundEmotion = findEmotionWord(emotionStr);
						if (foundEmotion) {
							emotion = foundEmotion;
							const remaining = emotionStr.replace(foundEmotion, "");
							const foundTone = findEmotionWord(remaining);
							if (foundTone && foundTone !== foundEmotion) tone = foundTone;
						}
					}

					let j = i + 1;
					while (j < blocks.length) {
						const next = blocks[j];
						if (next.type === "action") {
							if (!dialogueText) {
								const foundEmotion = findEmotionWord(next.text);
								if (foundEmotion) {
									const remaining = next.text.replace(foundEmotion, "");
									const foundTone = findEmotionWord(remaining);
									emotion = foundEmotion;
									if (foundTone && foundTone !== foundEmotion) tone = foundTone;
								}
							}
							j++;
						} else if (next.type === "narration") {
							const narrationText = next.text.trim();
							// 支持 "、"、> 开头识别为对话文本
							if (narrationText.startsWith('"') || narrationText.startsWith('\u201C') || narrationText.startsWith('>')) {
								dialogueText = narrationText.replace(/^["\u201C>\s]+|["\u201D]+$/g, "");
								j++;
							} else if (!dialogueText) {
								j++;
							} else {
								break;
							}
						} else if (next.type === "dialogue") {
							dialogueText = next.text;
							if (!emotion && next.emotion) emotion = next.emotion;
							if (!tone && next.tone) tone = next.tone;
							j++;
						} else {
							break;
						}
					}

					if (dialogueText) {
						merged.push({ type: "dialogue", character: characterRaw, emotion, tone, text: dialogueText });
						i = j - 1;
						continue;
					}
				}
			}
		}

		merged.push(current);
	}

	return merged;
}

/**
 * 将非对话块（action/narration/scene-description/transition）转为对话块，由旁白角色朗读
 */
export function convertNonDialogueToNarrator(blocks: ScriptBlock[], narratorName: string): ScriptBlock[] {
	return blocks.map((block) => {
		if (block.type === "action" || block.type === "scene-description" || block.type === "transition") {
			return { type: "dialogue" as const, character: narratorName, text: block.text };
		}
		if (block.type === "narration") {
			const text = block.text.trim();
			if (/^(.+?)[:：]$/.test(text)) return block;
			if (text.length <= 15) return block;
			return { type: "dialogue" as const, character: narratorName, text: block.text };
		}
		return block;
	});
}

/**
 * 将剧本块数组格式化为纯文本（供 TTS 使用）
 */
function formatBlocksToPlainText(blocks: ScriptBlock[]): string {
	return blocks
		.map((block) => {
			switch (block.type) {
				case "dialogue":
					return `${block.character}：${block.text}`;
				case "action":
					return `动作：${block.text}`;
				case "scene-header": {
					const text = block.text
						.replace(/^场景\s*\d*\s*[：:]\s*/, "")
						.replace(/^\d+[.、]\s*/, "");
					return `场景：${text}`;
				}
				case "scene-description":
					return `动作：${block.text}`;
				case "transition":
					return block.text;
				default:
					return "";
			}
		})
		.filter(Boolean)
		.join("\n");
}

/** 标准化引号：将弯引号/中文引号转换为 JSON 合法直引号 */
export function normalizeQuotes(str: string): string {
	return str
		.replace(/[\u201C\u201D]/g, '"')   // " " → "
		.replace(/[\u2018\u2019]/g, "'");  // ' ' → '
}

/** 修复剧本内容中的常见 JSON 问题（引号混用、未转义换行、特殊字符等） */
export function repairScriptContent(content: string): string {
	return content
		.replace(/[\u201C\u201D]/g, '"')
		.replace(/[\u2018\u2019]/g, "'")
		.replace(/\r\n/g, "\n")
		.replace(/\u2028/g, "")
		.replace(/\u2029/g, "")
		.replace(/\\u000a/g, "\\n")
		.replace(/\\u000d/g, "\\r")
		.trim();
}

/**
 * 尝试将 JSON 字符串解析为 ScriptJSON
 * 支持纯 JSON 和 markdown 代码块包裹的 JSON
 */
export function parseScriptJSON(content: string): ScriptJSON | null {
	const tryParse = (str: string): ScriptJSON | null => {
		try {
			const repaired = repairScriptContent(str);
			const parsed = JSON.parse(repaired);
			if (parsed && typeof parsed === "object" && Array.isArray(parsed.scenes)) {
				return parsed as ScriptJSON;
			}
			if (typeof parsed === "string" && parsed.length > 0) {
				return tryParse(parsed);
			}
		} catch {
			// 继续尝试其他提取方式
		}
		return null;
	};

	const tryRepairAndParse = (str: string): ScriptJSON | null => {
		const repaired = repairTruncatedJson(str);
		if (repaired) return tryParse(repaired);
		return null;
	};

	// 1. 直接解析
	const direct = tryParse(content.trim());
	if (direct) return direct;

	// 2. 尝试提取 markdown 代码块（```json ... ``` 或 ``` ... ```）
	const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (codeBlockMatch) {
		const extracted = tryParse(codeBlockMatch[1].trim());
		if (extracted) return extracted;
	}

	// 3. 尝试修复截断的 JSON
	const repaired = tryRepairAndParse(content.trim());
	if (repaired) return repaired;

	// 4. 尝试从文本中查找 JSON 对象（以 { 开头，以 } 结尾的最外层结构）
	const jsonStart = content.indexOf("{");
	if (jsonStart !== -1) {
		let depth = 0;
		for (let i = jsonStart; i < content.length; i++) {
			if (content[i] === "{") depth++;
			else if (content[i] === "}") depth--;
			if (depth === 0) {
				const candidate = content.slice(jsonStart, i + 1);
				const extracted = tryParse(candidate);
				if (extracted) return extracted;
				break;
			}
		}
	}

	return null;
}

/**
 * 将 ScriptJSON 转换为 ScriptBlock[]（用于渲染和 TTS）
 */
/** 兼容旧版字符串格式：将旧版 scene 字段升级为新结构 */
function normalizeLegacyScene(scene: ScriptSceneJSON): ScriptSceneJSON {
	if (typeof scene.time === 'string') {
		scene.time = { period: scene.time || '' };
	}
	if (typeof scene.location === 'string') {
		scene.location = { scope: '', name: scene.location || '' };
	}
	if (typeof scene.atmosphere === 'string') {
		scene.atmosphere = { tag: scene.atmosphere || '', intensity: '中' };
	}
	return scene;
}

export function scriptJSONToBlocks(json: ScriptJSON): ScriptBlock[] {
	const blocks: ScriptBlock[] = [];

	for (let si = 0; si < json.scenes.length; si++) {
		const scene = normalizeLegacyScene(json.scenes[si]);
		const hasDialogue = scene.blocks.some((b) => b.type === "dialogue");
		const isDescriptionLike = !scene.time?.period && !hasDialogue;

		if (isDescriptionLike && si > 0) {
			// 描述性场景（无时间、无对话），不加 scene-header，直接嵌入前一个场景中
			for (const block of scene.blocks) {
				blocks.push(block);
			}
		} else {
			const timeStr = scene.time?.detail
				? `${scene.time.period}·${scene.time.detail}`
				: scene.time?.period || '';
			const locStr = `${scene.location?.scope || ''}·${scene.location?.name || ''}`;
			const atmosStr = scene.atmosphere?.intensity
				? `${scene.atmosphere.tag}·${scene.atmosphere.intensity}`
				: scene.atmosphere?.tag || '';

			blocks.push({
				type: "scene-header",
				text: `${scene.title}：${timeStr} ｜ ${locStr} ｜ ${atmosStr}`,
			});
			for (const block of scene.blocks) {
				blocks.push(block);
			}
		}
	}
	return blocks;
}

/**
 * 将剧本转换为纯文本格式（供 TTS 使用）
 * 输出格式：
 * - 角色名：对话内容
 * - 动作：描述
 * - 场景：描述
 * - 转场：描述
 *
 * parseScriptContent 可直接解析此格式
 */
export function scriptToPlainText(content: string, knownCharacters?: string[], narratorName?: string): string {
	// 优先尝试 JSON 解析
	const jsonResult = parseScriptJSON(content);
	if (jsonResult) {
		let blocks = scriptJSONToBlocks(jsonResult);
		blocks = mergeDialogueBlocks(blocks, knownCharacters);
		if (narratorName) {
			blocks = convertNonDialogueToNarrator(blocks, narratorName);
		}
		return formatBlocksToPlainText(blocks);
	}

	// 回退 markdown 解析
	let blocks = parseScriptBlocks(content);
	blocks = mergeDialogueBlocks(blocks, knownCharacters);
	if (narratorName) {
		blocks = convertNonDialogueToNarrator(blocks, narratorName);
	}
	return formatBlocksToPlainText(blocks);
}
