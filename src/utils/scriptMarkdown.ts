// ============================================================
// 剧本 Markdown 解析 — 将 AI 返回的 MD 样式剧本解析为结构化块
// 同时提供 plain text 转换，供 TTS 请求使用
// ============================================================

export type ScriptBlock =
	| { type: "title"; text: string }
	| { type: "markdown-header"; text: string; level: number }
	| { type: "scene-header"; text: string }
	| { type: "character-list"; characters: string[] }
	| { type: "scene-description"; text: string }
	| { type: "separator" }
	| { type: "action"; text: string }
	| { type: "dialogue"; character: string; emotion?: string; text: string }
	| { type: "transition"; text: string }
	| { type: "narration"; text: string };

// 非角色标记，解析对话时跳过
const NON_CHARACTER_MARKERS = ["动作", "场景", "转场", "内心独白", "人物", "场景描述", "旁白"];

/**
 * 判断是否为 AI 开场白（"好的，这是..."等），需跳过
 */
function isAiIntro(line: string): boolean {
	return /^(好的|这是|根据|以下|当然|没问题)/.test(line);
}

/**
 * 将剧本内容解析为结构化块数组
 * 兼容两种格式：
 * 1. Markdown 格式：**角色名** （情绪）\n    ：对话
 * 2. 纯文本格式：角色名：对话（同行）
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
		const plainMatch = stripped.match(/^(.+?)：(.+)$/);
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
			const hasNonMarker = NON_CHARACTER_MARKERS.some(
				(m) => character.includes(m),
			);
			if (
				character && text &&
				!isList && !hasMidBracket && !hasDash && !tooLong && !hasNonMarker
			) {
				blocks.push({ type: "dialogue", character, text });
				continue;
			}
		}

		// 兜底：旁白/其他
		blocks.push({ type: "narration", text: stripped });
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
export function scriptToPlainText(content: string): string {
	const blocks = parseScriptBlocks(content);
	return blocks
		.map((block) => {
			switch (block.type) {
				case "dialogue":
					return `${block.character}：${block.text}`;
				case "action":
					return `动作：${block.text}`;
				case "scene-header": {
					// 归一化为 "场景：text"，确保 parseScriptContent 跳过
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
