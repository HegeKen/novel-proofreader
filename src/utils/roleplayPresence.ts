// ============================================================
// 群聊在场角色管理 — 角色名匹配与用户输入的邀请/离场意图检测
// ============================================================
import type { CharacterInfo } from "../types";

/** 清理 AI 输出的角色名（去除可能带上的引号/书名号/括号等装饰） */
export function cleanRoleName(name: string): string {
	return name.replace(/[「」""''《》【】()（）]/g, "").trim();
}

/**
 * 按姓名或别名匹配角色。
 * 匹配优先级：姓名精确 → 别名精确 → 后缀匹配（长度差 ≤2，如"晚"匹配"林晚"、"上林晚"匹配"林晚"）。
 * 不做无限制的 includes 兜底，避免"林"误匹配"林小晚"这类包含关系误伤。
 */
export function matchCharacterByName(name: string, characters: CharacterInfo[]): CharacterInfo | null {
	const target = cleanRoleName(name);
	if (!target) return null;
	// 精确匹配姓名
	let hit = characters.find((c) => c.name === target);
	if (hit) return hit;
	// 精确匹配别名（含清理后的别名）
	hit = characters.find((c) => c.aliases?.some((a) => cleanRoleName(a) === target));
	if (hit) return hit;
	// 后缀匹配：目标是角色名的后缀或角色名是目标的后缀，且长度差 ≤2
	hit = characters.find((c) => {
		if (Math.abs(c.name.length - target.length) > 2) return false;
		return c.name.endsWith(target) || target.endsWith(c.name);
	});
	return hit ?? null;
}

/** 邀请/离场意图检测结果 */
export interface PresenceIntent {
	/** 用户明确邀请加入的角色（当前不在场） */
	invited: CharacterInfo[];
	/** 用户明确要求离开的角色（当前在场） */
	dismissed: CharacterInfo[];
}

/** 名字段中的否定字（如"让林晚别过来"不是邀请） */
const NEGATION_CHARS = /[别不没未勿莫]/;

// 句中分隔符（中英文标点与空白），用于限定名字段边界
const SEP = "\\s,，。！!？?；;：:、…—";

/**
 * 提取"动词 + 名字 + 趋向动词"结构中的名字段。
 * 趋向动词后必须紧跟句尾/标点/语气词，避免"让林晚来不及反应"这类误判。
 */
function extractDirectedNames(text: string, verbs: string, moves: string): string[] {
	const re = new RegExp(
		`(?:${verbs})\\s*([^${SEP}]{1,6}?)\\s*(?:${moves})(?=[${SEP}]|$|[吧啊呀呢嘛哦])`,
		"g",
	);
	const results: string[] = [];
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null) results.push(m[1]);
	return results;
}

/**
 * 提取"名字 + 后缀"结构中的名字段（如"林晚走了""林晚也来了"）。
 * 后缀后紧跟疑问语气词（吗/么/？）时不判定——疑问句不是指令（"林晚走了吗？"）。
 */
function extractNamesBeforeSuffix(text: string, suffixes: string[]): string[] {
	const results: string[] = [];
	for (const suffix of suffixes) {
		const re = new RegExp(`([^${SEP}]{1,6}?)${suffix}(?![吗么？?])`, "g");
		let m: RegExpExecArray | null;
		while ((m = re.exec(text)) !== null) results.push(m[1]);
	}
	return results;
}

/**
 * 从用户输入检测角色邀请/离场意图。
 * 仅在"高置信度"（显式指令句式 + 无否定字 + 名字可匹配角色）时判定；
 * 单纯提及角色名（"我不喜欢林晚"）不产生任何意图。
 */
export function detectPresenceIntent(
	userText: string,
	presentIds: Set<string>,
	allCharacters: CharacterInfo[],
): PresenceIntent {
	// 邀请模式："让/叫/喊/请/把/拉 + 名字 + (拉/叫/喊)过来/来吧/加入/出场/登场"；"名字 + 也来了"
	const inviteNames = [
		...extractDirectedNames(userText, "让|叫|喊|请|把|拉", "拉过来|叫过来|喊过来|过来|来吧|加入|出场|登场"),
		...extractNamesBeforeSuffix(userText, ["也来了", "也来呀", "也来啊", "也来了"]),
	];
	// 离场模式："名字 + 走了/离开了/退下了/出去了"；"让/叫 + 名字 + 先走/走/离开/退下/出去"
	const dismissNames = [
		...extractNamesBeforeSuffix(userText, ["走了", "离开了", "退下了", "出去了", "先走了"]),
		...extractDirectedNames(userText, "让|叫", "先走|走|离开|退下|出去"),
	];

	const invited: CharacterInfo[] = [];
	const dismissed: CharacterInfo[] = [];
	for (const raw of inviteNames) {
		if (NEGATION_CHARS.test(raw)) continue;
		const c = matchCharacterByName(raw, allCharacters);
		if (c && !presentIds.has(c.id) && !invited.some((i) => i.id === c.id)) invited.push(c);
	}
	for (const raw of dismissNames) {
		if (NEGATION_CHARS.test(raw)) continue;
		const c = matchCharacterByName(raw, allCharacters);
		if (c && presentIds.has(c.id) && !dismissed.some((i) => i.id === c.id)) dismissed.push(c);
	}
	return { invited, dismissed };
}
