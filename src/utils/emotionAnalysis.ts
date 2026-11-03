// ============================================================
// 本地情感分析结果 → TTS 朗读标注
//
// 本地模型（liudev/roberta-multilabel-28-3-classes）只输出段落级
// 31 维情感概率，不含角色识别与句子切分。这里补齐离线朗读所需的
// 轻量后处理：
//   1. 按引号切分「旁白 / 对话」
//   2. 用轻量规则猜测对话说话人（配置角色名 + 说话动词）
//   3. 把英文情感标签映射为应用使用的中文情绪/语调/语速
//   4. 生成与 AI 路径一致的 ParagraphEmotionResult
// ============================================================
import type { ParagraphEmotionResult } from "./aiClient";
import type { EmotionPrediction } from "./localEmotion";

export interface EmotionCharacter {
	name: string;
	aliases?: string[];
	role?: string;
}

export interface DialogueSegment {
	type: "narration" | "dialogue";
	text: string;
	start: number;
	speaker: string;
}

/** GoEmotions 28 类英文标签 → 应用中文情绪标签 */
export const EMOTION_ZH: Record<string, string> = {
	anger: "愤怒",
	annoyance: "烦躁",
	disapproval: "不满",
	disgust: "厌恶",
	fear: "恐惧",
	nervousness: "忐忑",
	embarrassment: "窘迫",
	disappointment: "失落",
	gratitude: "欣慰",
	joy: "开心",
	amusement: "愉悦",
	excitement: "兴奋",
	optimism: "乐观",
	pride: "自豪",
	relief: "释然",
	admiration: "钦佩",
	approval: "赞许",
	love: "温柔",
	caring: "温柔",
	desire: "渴望",
	neutral: "平静",
	sadness: "悲伤",
	grief: "悲痛",
	remorse: "愧疚",
	surprise: "惊讶",
	realization: "恍然",
	curiosity: "好奇",
	confusion: "困惑",
};

/** 模型 README 推荐的高查准率阈值（生产环境使用） */
export const EMOTION_THRESHOLDS: Record<string, number> = {
	anger: 0.71,
	annoyance: 0.66,
	disapproval: 0.65,
	disgust: 0.75,
	fear: 0.73,
	nervousness: 0.74,
	embarrassment: 0.82,
	disappointment: 0.69,
	gratitude: 0.75,
	joy: 0.59,
	amusement: 0.65,
	excitement: 0.61,
	optimism: 0.73,
	pride: 0.73,
	relief: 0.75,
	admiration: 0.71,
	approval: 0.69,
	love: 0.77,
	caring: 0.73,
	desire: 0.78,
	neutral: 0.63,
	sadness: 0.68,
	grief: 0.8,
	remorse: 0.81,
	surprise: 0.59,
	realization: 0.61,
	curiosity: 0.78,
	confusion: 0.77,
	tone_positive: 0.49,
	tone_negative: 0.47,
	tone_neutral: 0.62,
};

/** 中文情绪 → 语调 */
const ZH_TONE: Record<string, string> = {
	愤怒: "凌厉",
	烦躁: "不耐",
	不满: "冷淡",
	厌恶: "冷淡",
	恐惧: "紧张",
	忐忑: "紧张",
	窘迫: "局促",
	失落: "低沉",
	欣慰: "柔和",
	开心: "轻快",
	愉悦: "轻快",
	兴奋: "高亢",
	乐观: "轻快",
	自豪: "自信",
	释然: "舒缓",
	钦佩: "赞叹",
	赞许: "温和",
	温柔: "柔和",
	渴望: "动情",
	平静: "自然",
	悲伤: "低沉",
	悲痛: "哽咽",
	愧疚: "低沉",
	惊讶: "上扬",
	恍然: "舒缓",
	好奇: "俏皮",
	困惑: "迟疑",
	冷漠: "冷淡",
	怅然: "深沉",
	无奈: "低沉",
	嫉妒: "冷淡",
	厌倦: "慵懒",
	动情: "深情",
	高冷: "冷淡",
	活泼: "轻快",
	严肃: "庄重",
	慵懒: "慵懒",
	俏皮: "俏皮",
	深沉: "深沉",
	干练: "干练",
	凌厉: "凌厉",
};

/** 中文情绪 → 基础语速（1–10） */
const ZH_SPEED: Record<string, number> = {
	愤怒: 7,
	烦躁: 6,
	不满: 6,
	厌恶: 5,
	恐惧: 8,
	忐忑: 6,
	窘迫: 5,
	失落: 4,
	欣慰: 5,
	开心: 6,
	愉悦: 5,
	兴奋: 7,
	乐观: 5,
	自豪: 6,
	释然: 4,
	钦佩: 5,
	赞许: 5,
	温柔: 4,
	渴望: 5,
	平静: 5,
	悲伤: 3,
	悲痛: 3,
	愧疚: 4,
	惊讶: 6,
	恍然: 4,
	好奇: 5,
	困惑: 4,
	冷漠: 4,
	怅然: 4,
	无奈: 4,
	嫉妒: 5,
	厌倦: 4,
};

/** 旁白中出现这些词时，优先使用对应情绪（比段落级概率更可靠） */
const NARRATION_KEYWORDS: Array<[RegExp, string]> = [
	[/怒|吼|厉声|拍案|怒斥|咆哮|咬牙|冷哼/, "愤怒"],
	[/哭|泪|悲|哽咽|抽泣|哀伤|痛楚/, "悲伤"],
	[/颤|害怕|恐惧|惊恐|冷汗|哆嗦|发抖|毛骨悚然/, "恐惧"],
	[/惊|愣|怔|愕然|错愕|瞪大/, "惊讶"],
	[/冷笑|冷漠|面无表情|淡淡地/, "冷漠"],
	[/叹|苦笑|无奈|摇头|怅然/, "怅然"],
	[/温柔|轻声|柔声|低声安慰/, "温柔"],
	[/笑|喜|欢|雀跃|忍俊不禁/, "开心"],
];

/** 判断旁白是否可直接沿用段落级强情绪（概率很高时才沿用，避免过度演绎） */
const STRONG_EMOTIONS = new Set(["anger", "fear", "excitement", "sadness", "grief", "joy"]);

const SPEECH_VERBS =
	"说道|问道|答道|喊道|叫道|吼道|笑道|叹道|怒道|低声道|轻声道|冷冷道|说|道|问|答|喊|叫|吼|嚷|嘟囔|嘀咕|低语|开口|回答|反问|喝道|补充|接着说|继续道";

const PRONOUN_STOPWORDS = new Set([
	"他",
	"她",
	"它",
	"我",
	"你",
	"您",
	"咱",
	"我们",
	"他们",
	"她们",
	"大家",
	"众人",
	"有人",
	"两人",
	"三人",
	"那人",
	"此人",
	"对方",
	"旁白",
	"作者",
]);

const SPEECH_ADVERBS = new Set([
	"低声",
	"轻声",
	"冷声",
	"沉声",
	"大声",
	"小声",
	"高声",
	"柔声",
	"怒声",
	"厉声",
]);

const SPEECH_VERB_SET = new Set(SPEECH_VERBS.split("|"));

function isUsableName(name: string): boolean {
	if (name.length < 2 || name.length > 4) return false;
	if (PRONOUN_STOPWORDS.has(name) || SPEECH_ADVERBS.has(name)) return false;
	if (/^[他她它我你您咱]/.test(name)) return false;
	// 排除「低声说」「说道」「怒吼」这类动作/动词误识别；已配置角色名不走此函数
	if (SPEECH_VERB_SET.has(name)) return false;
	if (/(?:说|道|问|答|喊|叫|吼|嚷|笑|哭|叹|骂|斥|喝)$/.test(name)) return false;
	return true;
}

/** 在引号前的文本中猜测说话人 */
function findSpeakerBefore(prefix: string, characters: EmotionCharacter[]): string | null {
	const names: Array<{ name: string; role?: string }> = [];
	for (const character of characters) {
		if (character.role === "narrator") continue;
		if (character.name) names.push({ name: character.name, role: character.role });
		for (const alias of character.aliases || []) {
			if (alias && alias !== character.name) names.push({ name: alias, role: character.role });
		}
	}

	// 1. 配置角色名 + 说话动词：优先匹配「名字 + 说道」这种明确结构
	const verbTail = new RegExp(`(?:[的地得着]|\\s|，|,){0,3}(?:${SPEECH_VERBS})[：:，,]?\\s*$`);
	for (const item of names) {
		const idx = prefix.lastIndexOf(item.name);
		if (idx < 0) continue;
		const tail = prefix.slice(idx + item.name.length);
		if (tail.length <= 12 && verbTail.test(tail)) {
			return item.name;
		}
	}

	// 2. 配置角色名：取距离引号最近的一个
	let best: { name: string; index: number } | null = null;
	for (const item of names) {
		const idx = prefix.lastIndexOf(item.name);
		if (idx < 0) continue;
		if (idx + item.name.length < prefix.length - 24) continue;
		if (!best || idx > best.index) best = { name: item.name, index: idx };
	}
	if (best) return best.name;

	// 3.「名字：」直接引出对白（先剥掉「说道：」中的动词/副词）
	const colon = prefix.match(/([\u4e00-\u9fa5]{2,6})[：:]\s*$/);
	if (colon) {
		let candidate = colon[1];
		// 长动词优先，避免「李明说道」先剥掉「道」后残留「李明说」
		const verbs = Array.from(SPEECH_VERB_SET).sort((a, b) => b.length - a.length);
		let stripped = true;
		while (stripped) {
			stripped = false;
			for (const verb of verbs) {
				if (candidate.length > verb.length && candidate.endsWith(verb)) {
					candidate = candidate.slice(0, -verb.length);
					stripped = true;
					break;
				}
			}
		}
		if (isUsableName(candidate)) return candidate;
	}

	// 4. 通用结构：句首 2–3 个汉字 + 说话/神态动词（非贪婪，避免把「叹了口气」并进名字）
	const clause = prefix.split(/[。！？；\n]/).pop() || prefix;
	const leading = clause.match(
		/^\s*([\u4e00-\u9fa5]{2,3}?)(?=[，,。！？；：:\s]|说道|说|道|问|答|喊|叫|笑|叹|怒|冷|低|轻|沉|大|小|高|柔|厉|咬|皱|点|摇|转|站|坐|看|望|盯|哼|了|着|的|地|得)/,
	);
	if (leading && isUsableName(leading[1])) {
		const rest = clause.slice(leading[0].length);
		const verb = new RegExp(`^(?:[^。！？；\n]{0,10}?)(?:${SPEECH_VERBS})`);
		if (verb.test(rest) || /[，,]\s*$/.test(prefix)) {
			return leading[1];
		}
	}

	return null;
}

/** 引号之后的结构（如“你好。”李明说） */
function findSpeakerAfter(suffix: string, characters: EmotionCharacter[]): string | null {
	const names = characters
		.filter((c) => c.role !== "narrator")
		.flatMap((c) => [c.name, ...(c.aliases || [])])
		.filter(Boolean);
	for (const name of names) {
		if (suffix.startsWith(name)) return name;
	}
	const match = suffix.match(
		new RegExp(`^[，,\\s]*([\\u4e00-\\u9fa5]{2,3})(?:[^。！？；\\n]{0,6})(?:${SPEECH_VERBS})`),
	);
	if (match && isUsableName(match[1])) return match[1];
	return null;
}

/** 猜测一段对话的说话人 */
export function detectSpeaker(
	text: string,
	quoteStart: number,
	quoteEnd: number,
	characters: EmotionCharacter[],
): string {
	const prefix = text.slice(Math.max(0, quoteStart - 48), quoteStart);
	const before = findSpeakerBefore(prefix, characters);
	if (before) return before;

	const suffix = text.slice(quoteEnd + 1, quoteEnd + 24);
	const after = findSpeakerAfter(suffix, characters);
	if (after) return after;

	// 整段只有一个已配置角色（且不是旁白）时，直接归给他/她
	const configured = characters.filter((c) => c.role !== "narrator" && c.name);
	const present = configured.filter((c) => text.includes(c.name) || (c.aliases || []).some((a) => text.includes(a)));
	if (present.length === 1) return present[0].name;

	return "旁白";
}

/** 找出文本中的引号区间（支持嵌套与直角引号） */
function findQuoteSpans(text: string): Array<{ start: number; end: number }> {
	const pairs: Record<string, string> = { "“": "”", "「": "」", "『": "』" };
	const closing = new Set(Object.values(pairs));
	const stack: number[] = [];
	const spans: Array<{ start: number; end: number }> = [];

	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (ch === '"') {
			const top = stack[stack.length - 1];
			if (top !== undefined && text[top] === '"') {
				stack.pop();
				spans.push({ start: top, end: i });
			} else {
				stack.push(i);
			}
			continue;
		}
		if (pairs[ch]) {
			stack.push(i);
			continue;
		}
		if (closing.has(ch) && stack.length > 0) {
			const top = stack[stack.length - 1];
			if (pairs[text[top]] === ch) {
				stack.pop();
				spans.push({ start: top, end: i });
			}
		}
	}

	spans.sort((a, b) => a.start - b.start);
	// 只保留最外层引号，嵌套引号并入外层对白
	const outer: Array<{ start: number; end: number }> = [];
	let lastEnd = -1;
	for (const span of spans) {
		if (span.start <= lastEnd) continue;
		outer.push(span);
		lastEnd = span.end;
	}
	return outer;
}

/** 按引号把段落切分为旁白 / 对话片段 */
export function splitDialogueSegments(text: string, characters: EmotionCharacter[] = []): DialogueSegment[] {
	const spans = findQuoteSpans(text);
	const segments: DialogueSegment[] = [];
	let cursor = 0;

	const push = (type: DialogueSegment["type"], value: string, start: number, speaker = "旁白") => {
		const trimmed = value.trim();
		if (!trimmed) return;
		segments.push({ type, text: trimmed, start, speaker });
	};

	for (const span of spans) {
		if (span.start > cursor) {
			push("narration", text.slice(cursor, span.start), cursor);
		}
		const quote = text.slice(span.start, span.end + 1);
		const speaker = detectSpeaker(text, span.start, span.end, characters);
		push("dialogue", quote, span.start, speaker);
		cursor = span.end + 1;
	}

	if (cursor < text.length) {
		push("narration", text.slice(cursor), cursor);
	}
	if (segments.length === 0 && text.trim()) {
		push("narration", text, 0);
	}
	return segments;
}

/** 选出一个段落级情绪：优先使用 README 推荐阈值，其次回落较宽松阈值 */
export function pickEmotion(prediction: EmotionPrediction): { key: string; zh: string; probability: number } {
	const emotionScores = [...prediction.labels]
		.filter((item) => !item.label.startsWith("tone_"))
		.sort((a, b) => b.probability - a.probability);

	const hit = emotionScores.find(
		(item) => item.probability >= (EMOTION_THRESHOLDS[item.label] ?? 0.6),
	);
	const chosen = hit || emotionScores.find((item) => item.probability >= 0.4);

	const key = chosen?.label || "neutral";
	return {
		key,
		zh: EMOTION_ZH[key] || "平静",
		probability: chosen?.probability ?? 0,
	};
}

/** 中文情绪 → 语调 */
export function emotionTone(zh: string): string {
	return ZH_TONE[zh] || "自然";
}

/** 中文情绪 + 置信度 → 语速（1–10） */
export function emotionSpeed(zh: string, probability: number): number {
	let speed = ZH_SPEED[zh] ?? 5;
	if (probability >= 0.85) speed += 1;
	if (probability < 0.5) speed = Math.round((speed + 5) / 2);
	return Math.max(2, Math.min(9, speed));
}

/** 旁白里的情绪关键词（返回中文情绪或 null） */
export function narrationKeywordEmotion(text: string): string | null {
	for (const [pattern, emotion] of NARRATION_KEYWORDS) {
		if (pattern.test(text)) return emotion;
	}
	return null;
}

/** 旁白是否沿用段落级强情绪 */
function strongNarrationEmotion(prediction: EmotionPrediction): string | null {
	const top = prediction.labels[0];
	if (!top || top.probability < 0.8 || !STRONG_EMOTIONS.has(top.label)) return null;
	return EMOTION_ZH[top.label] || null;
}

/**
 * 把本地模型输出转换为 TTS 朗读结果（与 AI 路径的 ParagraphEmotionResult 结构一致）。
 */
export function buildLocalParagraphEmotion(
	text: string,
	prediction: EmotionPrediction,
	characters: EmotionCharacter[] = [],
): ParagraphEmotionResult {
	const base = pickEmotion(prediction);
	const segments = splitDialogueSegments(text, characters);
	const found = new Set<string>();

	const resultSegments = segments.map((segment) => {
		let emotion: string;
		let probability: number;

		if (segment.type === "dialogue") {
			emotion = base.zh;
			probability = base.probability;
			if (segment.speaker && segment.speaker !== "旁白") {
				found.add(segment.speaker);
			}
		} else {
			const keyword = narrationKeywordEmotion(segment.text);
			const strong = strongNarrationEmotion(prediction);
			emotion = keyword || strong || "平静";
			probability = keyword ? 1 : strong ? base.probability : 0;
		}

		const tone = emotionTone(emotion);
		const speed = emotionSpeed(emotion, probability);
		return {
			type: segment.type,
			speaker: segment.speaker,
			emotion,
			tone,
			speed,
			text: `(${emotion},${tone})${segment.text}`,
		};
	});

	return {
		characters: Array.from(found),
		segments: resultSegments,
	};
}
