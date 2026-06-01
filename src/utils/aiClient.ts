// ============================================================
// AI 调用封装 — 支持 OpenAI 兼容接口（含 LM Studio）
// ============================================================
import type { AIConfig } from "../types";
import { logger } from "./logger";
import { useAppStore } from "../stores/appStore";

export interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export interface ChatCompletionChoice {
	message: { role: string; content: string };
}

export interface ChatCompletionResponse {
	choices: ChatCompletionChoice[];
	usage?: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
}

// ============================================================
// Provider 识别 & 错误码映射
// ============================================================

type Provider = "deepseek" | "mimo" | "siliconflow" | "openai" | "unknown";

/** 根据 baseURL 识别提供商 */
function detectProvider(baseURL: string): Provider {
	const url = baseURL.toLowerCase();
	if (url.includes("deepseek")) return "deepseek";
	if (url.includes("xiaomimimo") || url.includes("mimo")) return "mimo";
	if (url.includes("siliconflow")) return "siliconflow";
	if (url.includes("openai")) return "openai";
	return "unknown";
}

/** 各提供商 HTTP 状态码 → 用户友好提示 */
const ERROR_MESSAGES: Record<Provider, Record<number, string>> = {
	deepseek: {
		400: "请求格式错误，请检查配置",
		401: "API Key 无效，请检查 DeepSeek API Key",
		402: "DeepSeek 账户余额不足，请前往充值",
		422: "请求参数错误",
		429: "请求频率超限，请稍后重试",
		500: "DeepSeek 服务器内部故障，请稍后重试",
		503: "DeepSeek 服务器负载过高，请稍后重试",
	},
	mimo: {
		400: "请求格式错误，请检查配置",
		401: "API Key 无效，请检查 MiMo API Key",
		402: "MiMo 账户余额不足，请前往充值",
		403: "MiMo 权限不足，请检查 API Key 权限",
		421: "MiMo 内容审核拦截，避免输入不安全或敏感内容",
		429: "请求频率超限，请稍后重试",
		500: "MiMo 服务器错误，请稍后重试",
	},
	siliconflow: {
		400: "请求参数错误，请检查模型名称和配置",
		401: "API Key 无效，请检查 SiliconFlow API Key",
		403: "SiliconFlow 账户余额不足或权限不够（可能需要实名认证）",
		429: "请求频率超限，请稍后重试",
		500: "SiliconFlow 服务异常，请稍后重试",
		503: "SiliconFlow 服务繁忙，请稍后重试",
		504: "SiliconFlow 服务超时，建议开启流式输出或稍后重试",
	},
	openai: {
		400: "请求格式错误，请检查配置",
		401: "API Key 无效，请检查 OpenAI API Key",
		402: "OpenAI 账户余额不足，请前往充值",
		403: "OpenAI 权限不足，请检查 API Key 权限",
		429: "请求频率超限，请稍后重试",
		500: "OpenAI 服务器错误，请稍后重试",
		503: "OpenAI 服务暂不可用，请稍后重试",
	},
	unknown: {},
};

/** 尝试从响应体提取更具体的错误信息 */
function extractDetailError(body: string): string | null {
	try {
		const obj = JSON.parse(body);
		// OpenAI / DeepSeek / MiMo / SiliconFlow 兼容格式
		if (obj.error?.message) return String(obj.error.message);
		if (obj.message) return String(obj.message);
		if (obj.error) return typeof obj.error === "string" ? obj.error : null;
	} catch {
		// 非 JSON，取前 120 字符作为原始信息
		if (body.length > 0) return body.slice(0, 120);
	}
	return null;
}

/**
 * 发送 Chat Completion 请求
 */
export async function sendChatCompletion(
	messages: ChatMessage[],
	config: AIConfig,
	signal?: AbortSignal,
): Promise<string> {
	const url = `${config.baseURL.replace(/\/+$/, "")}/chat/completions`;

	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		...config.customHeaders,
	};
	if (config.apiKey) {
		headers["Authorization"] = `Bearer ${config.apiKey}`;
	}

	const body = {
		model: config.model,
		messages,
		temperature: 0.1,
		max_tokens: 4096,
	};

	logger.request(url, headers, body);

	const t0 = Date.now();
	const resp = await fetch(url, {
		method: "POST",
		headers,
		body: JSON.stringify(body),
		signal,
	});
	const elapsed = Date.now() - t0;

	if (!resp.ok) {
		const text = await resp.text().catch(() => "");
		logger.error(url, resp.status, text, elapsed);

		const provider = detectProvider(config.baseURL);
		useAppStore.getState().incrementAPIUsage(provider, false);
		const friendly = ERROR_MESSAGES[provider]?.[resp.status];
		const detail = extractDetailError(text);

		const parts: string[] = [];
		if (friendly) parts.push(friendly);
		if (detail && detail !== friendly) parts.push(detail);
		if (parts.length === 0) parts.push(`AI 请求失败 (${resp.status})`);

		throw new Error(parts.join(" — "));
	}

	const data: ChatCompletionResponse = await resp.json();
	logger.response(url, resp.status, data, elapsed);

	const provider = detectProvider(config.baseURL);
	const tokens = data.usage?.total_tokens ?? 0;
	useAppStore.getState().incrementAPIUsage(provider, true, tokens);

	// MiMo 内容拦截：返回 200 但 body 包含 high risk 拒绝文本
	const content = data.choices?.[0]?.message?.content ?? "";
	if (
		detectProvider(config.baseURL) === "mimo" &&
		content.includes(
			"The request was rejected because it was considered high risk",
		)
	) {
		throw new Error("MiMo 内容审核拦截，避免输入不安全或敏感内容 — 421");
	}

	return content;
}

/**
 * 测试 AI 连接
 */
export async function testConnection(
	config: AIConfig,
): Promise<{ ok: boolean; message: string }> {
	try {
		const reply = await sendChatCompletion(
			[{ role: "user", content: '请回复"连接成功"四个字。' }],
			config,
		);
		return { ok: true, message: reply.trim() };
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return { ok: false, message: msg };
	}
}

// ============================================================
// Prompt 模板
// ============================================================

/** 校对系统 prompt（段落级别） */
export const PROOFREAD_SYSTEM_PROMPT = `你是小说文字编辑。输出JSON数组，每个错误含：line(行号从1)、find(原文连续片段，含错误及前后至少3字符，**10-20字，严禁超20字**)、replace(修正后片段，长度与find相近)、type(typo/format/punctuation/grammar)、reason(≤10汉字)。
示例：[{"line":3,"find":"他很高兴地笑了","replace":"他很高興地笑了","type":"typo","reason":"繁简混用"}]
约束：find精确复制且唯一；同行的find不重叠；无法定位则跳过；无错返回[]。find字段**不能**超过20个字符，若错误本身较短则总长度控制在10-15字。`;

/** 校对系统 prompt（章节级别 - 每行返回一条错误） */
export const PROOFREAD_SYSTEM_PROMPT_CHAPTER = `你是小说文字编辑。校对输入的JSON对象（key=行号数字，value=段落文本）。

## 输出要求
输出JSON数组，每个元素表示一个错误，字段：
- line: 行号（数字，与输入key一致）
- column: 错误起始列（数字，从1计数，基于该行逐字符计算，含空格和标点）
- find: 原文错误片段（**10-20字，严禁超20字**，含错误及前后各至少3字符作为上下文，严禁返回整段全文）
- replace: 修正后的对应文本片段（长度与find相近）
- type: 错误类型（typo错别字/format排版空格/punctuation标点/grammar病句）
- reason: 原因（≤10汉字）

## 严格约束
1. find字段**必须**是10-20个字符的错误片段，**绝对不能**超过20字，也**绝对不能**返回整段原文
2. 每个JSON对象只包含 **一个错误**，多个错误拆成多个对象
3. find必须与原文精确匹配，column基于该行逐字符定位
4. 不跨行
5. 无错误返回空数组 []
6. 只输出JSON数组，无markdown标记、无解释、无代码块

## 示例
输入示例：{"0":"第一章 风雨欲来","1":"倾盘大雨，窗外街上穿流不息的人群"}
正确输出：[{"line":1,"column":1,"find":"倾盘大雨，窗外","replace":"倾盆大雨，窗外","type":"typo","reason":"错别字"},{"line":1,"column":10,"find":"街上穿流不息的人群","replace":"街上川流不息的人群","type":"typo","reason":"错别字"}]
错误输出（find超长）：[{"line":1,"column":1,"find":"倾盘大雨，窗外街上穿流不息的人群","replace":"..."}]

## 优先级
错别字 > 语法 > 排版 > 标点。不修改风格化、口语化表达。的/地/得错误：find含前后各≥2字符。`;

/** 构建带忽略词的系统 prompt */
export function buildProofreadSystemPrompt(
	basePrompt: string,
	ignoredWords?: string[],
): string {
	if (!ignoredWords || ignoredWords.length === 0) {
		return basePrompt;
	}
	return basePrompt + `\n\n【强制约束】以下词语无论是否错误，都绝对不能出现在find字段中（这些是人名/地名/专有名词/特殊术语）：${ignoredWords.join('、')}`;
}

/** 校对 user prompt */
export function buildProofreadUserPrompt(
	text: string,
	ignoredWords?: string[],
): string {
	let prompt = `请检查以下文本：\n\n${text}`;

	if (ignoredWords && ignoredWords.length > 0) {
		prompt += `\n\n【强制约束】以下词语在本文中出现时，绝对不能标记为错误（这些是人名、地名、专有名词或特殊术语），即使它们看起来像错别字：\n${ignoredWords.join("、")}\n\n请直接跳过这些词语，不要在返回结果中包含它们。`;
	}

	return prompt;
}

/** 剧本转换系统 prompt */
export const SCRIPT_SYSTEM_PROMPT = `你是剧本改编编剧。将小说章节转为中文影视拍摄剧本格式。输出纯剧本，无markdown。

## 标记（标记后冒号，内容换行）
场景 [序号]：[时间] - [地点] - [氛围]（氛围≤6字）
动作：描述角色动作/表情/环境（每段≤3行）
[角色名]：对话（口语化）
内心独白：[角色名]：内容（仅当无法用动作替代时）
转场：[切至/叠化/淡入/淡出/闪回]（仅时空大跳跃时用）

## 规则（优先级）
1. 保留核心情节、关键对话、转折点
2. 叙述转动作（紧张→攥紧拳头）
3. 对话口语化（加停顿、语气词）
4. 环境精简，只留推动情绪/情节的
5. 心理描写优先转微表情/小动作→对话暗示→内心独白
6. 删除作者评论（如“由此可见”）

## 约束
- 场景间空一行，场景内不空行
- 每场景至少一个动作+对话或事件
- 角色名一致，首次可加（年龄，身份）
- 不添加原文没有的角色/情节/对话
- 无戏剧价值的过渡叙述可合并或省略（用一句动作交代结果）

## 示例
场景 1：夜 - 废弃工厂 - 压抑
动作：雨水漏过屋顶，滴在铁皮上。张强（40岁，厂长）站在暗处，捏着照片。
张强：她今晚一定会来。
转场：切至
场景 2：夜 - 工厂门口 - 紧张
动作：林晓（28岁，记者）撑着黑伞，雨水顺伞流下。她推门而入。
林晓：有人吗？
`;

/** 剧本转换 user prompt */
export function buildScriptUserPrompt(text: string): string {
	return `请将以下小说章节转换为剧本格式：\n\n${text}`;
}

/** 剧本TTS情感增强系统提示词 */
export const SCRIPT_TTS_ENHANCE_SYSTEM_PROMPT = `你是有声书演播导演。为剧本对话添加情感/音色标注，提升TTS表现力。输出纯文本，无markdown。

## 标注格式（每行必须）
{角色名}[音色]：(标签)对话内容[音频标签]
- 旁白用角色名“我”
- 音色可留空，如“张强：(低沉)...” 
- 标签放冒号后，圆括号内，多标签逗号分隔
- 音频标签放方括号内，可插在对话中

## 标签类型（示例）
情绪：开心/悲伤/愤怒/恐惧/惊讶/兴奋/委屈/平静/冷漠
复合：怅然/欣慰/无奈/愧疚/释然/嫉妒/厌倦/忐忑/动情
语调：温柔/高冷/活泼/严肃/慵懒/俏皮/深沉/干练/凌厉
音色：磁性/醇厚/清亮/空灵/稚嫩/苍老/甜美/沙哑/醇雅
腔调：夹子音/御姐音/正太音/大叔音/台湾腔
方言：东北话/四川话/河南话/粤语
角色扮演：孙悟空/林黛玉
唱歌：(唱歌)歌词
音频：[吸气]/[叹气]/[颤抖]/[笑]/[哭]/[快速]/[停顿]

## 规则
- 场景/动作/转场保持原样，叙述性文字用“我：”格式
- 标签不矛盾；唱歌必须加(唱歌)
- 仅输出标注后文本，无解释

## 示例
张强：(低沉，怅然，磁性)她今晚一定会来。[叹气]
王芳：(疑惑，高冷，清亮)这地方……真有人住吗？[深呼吸]
我：(平静，温柔)夜幕降临，月亮探出头来。
李明：(唱歌)原谅我这一生不羁放纵自由。
`;

/** 构建TTS情感增强的user prompt */
export function buildScriptTTSEnhanceUserPrompt(scriptContent: string): string {
        return `为以下剧本对话添加情感/音色标注(TTS)。规则：所有行(含旁白)标注角色名，旁白用"我"。格式：角色名：(标签)内容。场景/动作/转场保持原样，叙述用"我："。唱歌加(唱歌)。纯文本输出，无markdown。
剧本：
${scriptContent}
逐行标注，旁白角色为"我"。`;
}

/** 清理AI返回的剧本内容，去除可能的markdown格式 */
export function cleanEnhancedScript(script: string): string {
	let cleaned = script.trim();
	
	// 去除markdown代码块
	cleaned = cleaned.replace(/^```[\s\S]*?```$/gm, (match) => {
		// 只提取代码块内的内容
		const content = match.slice(3, -3);
		// 去除可能的语言标记（如 javascript, python 等）
		const lines = content.split('\n');
		if (lines.length > 0 && lines[0].trim().length < 20 && !lines[0].includes('：') && !lines[0].includes('场景')) {
			return lines.slice(1).join('\n');
		}
		return content;
	});
	
	// 去除开头和结尾的反引号
	cleaned = cleaned.replace(/^`+/, '').replace(/`+$/, '');
	
	// 去除可能的解释性文字（只保留剧本内容）
	const lines = cleaned.split('\n');
	const scriptLines: string[] = [];
	
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) {
			scriptLines.push(line);
			continue;
		}
		
		// 保留符合剧本格式的行
		if (trimmed.includes('：') || 
			trimmed.startsWith('场景') || 
			trimmed.startsWith('动作') || 
			trimmed.startsWith('转场') ||
			trimmed.startsWith('内心独白') ||
			trimmed.startsWith('旁白')) {
			scriptLines.push(line);
		} else if (trimmed.startsWith('"') || trimmed.startsWith('“')) {
			// 可能是被引号包裹的，去除引号
			const unquoted = line.replace(/^["“]/, '').replace(/["”]$/, '');
			scriptLines.push(unquoted);
		}
		// 其他行可能是解释，忽略
	}
	
	return scriptLines.join('\n');
}

/** 小说章节TTS情感增强提示词 */
export const NOVEL_TTS_ENHANCE_SYSTEM_PROMPT = `你是有声书演播导演。为小说章节添加情感/音色标注(TTS)。输出纯文本，无markdown。保留原文段落和换行。

## 标签（可叠加，圆括号放开头，多标签逗号分隔）
情绪：开心/悲伤/愤怒/恐惧/惊讶/兴奋/委屈/平静/冷漠
复合：怅然/欣慰/无奈/愧疚/释然/嫉妒/厌倦/忐忑/动情
语调：温柔/高冷/活泼/严肃/慵懒/俏皮/深沉/干练/凌厉
音色：磁性/醇厚/清亮/空灵/稚嫩/苍老/甜美/沙哑/醇雅
腔调：夹子音/御姐音/正太音/大叔音/台湾腔
方言：东北话/四川话/河南话/粤语
角色扮演：孙悟空/林黛玉
唱歌：(唱歌)歌词

## 音频标签（方括号，插在句中）
呼吸：[吸气][深呼吸][叹气][长叹一口气][喘息][屏息]
情绪：[紧张][害怕][激动][疲惫][委屈][撒娇][心虚][震惊][不耐烦]
声音：[颤抖][声音颤抖][变调][破音][鼻音][气声][沙哑]
哭笑：[笑][轻笑][大笑][冷笑][抽泣][呜咽][哽咽][嚎啕大哭]
节奏：[快速][缓慢][停顿][停顿一下][沉默片刻][沉默一会儿]

## 规则
- 标签放对话/叙述最开头，如(开心，轻快)今天真好！
- 音频标签可放中间，如[叹气]唉...
- 保持原内容不变，只添加标注
- 旁白可用温和标签，唱歌必须加(唱歌)
- 仅输出标注后文本，无解释
`;

/** 构建小说章节TTS情感增强的user prompt */
export function buildNovelTTSEnhanceUserPrompt(chapterContent: string): string {
        return `为以下小说章节添加情感/音色标注(TTS)。规则：每段加合适标签，对话丰富，叙述平稳，唱歌加(唱歌)。纯文本输出，保留原文结构与内容。\n\n${chapterContent}`;
}

// ============================================================
// 阅读模式逐段TTS情感增强Prompt
// ============================================================

/** 阅读模式逐段TTS情感增强系统提示词 */
export const READING_MODE_TTS_ENHANCE_SYSTEM_PROMPT = `你是小说有声书演播导演。分析段落：识别人物、判断情绪、输出TTS标注JSON。

情绪/语调(选其一)：开心/悲伤/愤怒/恐惧/惊讶/兴奋/委屈/平静/冷漠/怅然/欣慰/无奈/愧疚/释然/嫉妒/厌倦/忐忑/动情/温柔/高冷/活泼/严肃/慵懒/俏皮/深沉/干练/凌厉。
特殊标记：(唱歌)放在歌词前；[音频标签]如[叹气][笑][颤抖]插在句中。

输出JSON：
{"characters":["人物名"],"segments":[{"type":"narration/dialogue","speaker":"旁白或角色名","emotion":"情绪","tone":"语调","text":"(情绪,语调)标签化文本"}]}

规则：
- 旁白speaker="旁白"，对话用角色名
- 保持原文本，只加标签；对话和叙述分开
- 默认情绪="平静"，语调="温柔"
- 必须输出合法JSON

示例：
输入："李明叹了口气，说：'你好吗'"
输出：{"characters":["李明"],"segments":[{"type":"narration","speaker":"旁白","emotion":"怅然","tone":"深沉","text":"(怅然,深沉)李明[叹气]叹了口气，说："},{"type":"dialogue","speaker":"李明","emotion":"无奈","tone":"温柔","text":"(无奈,温柔)'你好吗'"}]}`;

/** 阅读模式逐段TTS情感增强User Prompt */
export function buildReadingModeTTSEnhanceUserPrompt(
        paragraphText: string,
        contextBefore: string,
        contextAfter: string,
        configuredCharacters: Array<{ name: string; aliases: string[]; voice?: string }>
): string {
        const chars = configuredCharacters.length ? configuredCharacters.map(c => {
                const alias = c.aliases?.length ? `（别称：${c.aliases.join('、')}）` : '';
                const voice = c.voice ? ` [音色：${c.voice}]` : '';
                return `- ${c.name}${alias}${voice}`;
        }).join('\n') : '无已配置角色';
        return `分析段落，识别人物并判断情绪。已配置角色：\n${chars}\n前文：${contextBefore || '无'}\n当前段：${paragraphText}\n后文：${contextAfter || '无'}\n要求：匹配已配置角色，判断整体情绪，添加情绪/语调标签，识别对话说话人。返回JSON。`;
}

/** 文本片段类型 */
export interface TextSegment {
	type: 'narration' | 'dialogue';
	speaker: string;
	emotion: string;
	tone: string;
	text: string;
}

/** 段落情感分析结果类型 */
export interface ParagraphEmotionResult {
	characters: string[];
	segments: TextSegment[];
}

/**
 * 从 AI 响应中提取 JSON 数组（容错处理）
 */
export function extractJSON(text: string): unknown[] {
	// 尝试直接解析
	try {
		const parsed = JSON.parse(text);
		if (Array.isArray(parsed)) return parsed;
		return [];
	} catch {
		// 继续尝试提取
	}

	// 尝试提取 ```json ... ``` 代码块
	const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
	if (codeBlockMatch) {
		try {
			const parsed = JSON.parse(codeBlockMatch[1]);
			if (Array.isArray(parsed)) return parsed;
		} catch {
			// 继续
		}
	}

	// 尝试提取 [ ... ] 数组
	const arrayMatch = text.match(/\[[\s\S]*\]/);
	if (arrayMatch) {
		try {
			const parsed = JSON.parse(arrayMatch[0]);
			if (Array.isArray(parsed)) return parsed;
		} catch {
			// 放弃
		}
	}

	return [];
}

/** 角色分析系统提示词 - 用于从整本小说中提取角色人物小传和关系图谱 */
export const CHARACTER_ANALYSIS_SYSTEM_PROMPT = `你是小说角色分析专家。请从给定的小说文本中分析并提取所有重要角色信息，生成结构化的JSON数据。

## 输出格式
请返回以下JSON结构（纯JSON，无markdown）：

{
  "characters": [
    {
      "name": "角色名称（主要人名）",
      "aliases": ["别名1", "别名2"],
      "gender": "male/female/other",
      "role": "protagonist/heroine/antagonist/supportingMale/supportingFemale/mentor/rival/loveInterest/family/friend/npc",
      "description": "人物外貌、性格、背景的小传描述（100-300字）",
      "appearances": ["首次出场章节或位置描述"]
    }
  ],
  "relationships": [
    {
      "sourceName": "角色A名称",
      "targetName": "角色B名称",
      "relationType": "couple/father-son/father-daughter/mother-son/mother-daughter/brother/sister/brother-sister/lover/friend/rival/master-disciple/employer-employee/colleague/stranger/other",
      "customRelationType": "自定义关系描述（如果relationType是other）",
      "sourceNickname": ["角色A对B的称呼1", "角色A对B的称呼2"],
      "targetNickname": ["角色B对A的称呼1", "角色B对A的称呼2"],
      "description": "这段关系的简要描述（50字以内）"
    }
  ]
}

## 角色分类标准
- protagonist: 男主/男主角
- heroine: 女主/女主角
- antagonist: 反派/敌对角色
- supportingMale: 男配角
- supportingFemale: 女配角
- mentor: 导师/师父
- rival: 竞争对手/对手
- loveInterest: 爱慕对象/暧昧对象
- family: 家人/亲属
- friend: 朋友/好友
- npc: 其他次要角色

## 关系类型说明
- couple: 夫妻/恋人关系
- father-son/father-daughter: 父子/父女
- mother-son/mother-daughter: 母子/母女
- brother/sister/brother-sister: 兄弟/姐妹/兄妹/姐弟
- lover: 恋人/情人（暧昧或恋爱中）
- friend: 朋友/好友
- rival: 竞争对手
- master-disciple: 师徒
- employer-employee: 雇佣关系
- colleague: 同事/同僚
- stranger: 陌生人
- other: 其他（需填写customRelationType）

## 分析原则
1. 只提取有明确名字或明确身份指代的重要角色
2. 注意识别角色的别名和称呼变化
3. 从文本中的对话、互动、明确描述来推断关系
4. 关系代称要完整（如"老婆"、"老公"、"师父"、"徒弟"等）
5. description应该描述角色外貌特征、性格特点、身份背景
6. 如果文本过长，请分批次分析，最后合并结果

## 约束
- 输出必须是有效的JSON格式
- 数组可能为空，但结构必须完整
- 不要臆造信息，只基于文本内容
- 遇到不确定的关系，可以标记为other但提供描述`;

/** 角色分析结果类型 */
export interface CharacterAnalysisResult {
	characters: Array<{
		id?: string;
		name: string;
		aliases: string[];
		gender: "male" | "female" | "other";
		role: string;
		description: string;
		appearances: string[];
	}>;
	relationships: Array<{
		id?: string;
		sourceName?: string;
		targetName?: string;
		sourceId?: string;
		targetId?: string;
		relationType: string;
		customRelationType?: string;
		sourceNickname?: string[];
		targetNickname?: string[];
		description: string;
	}>;
}

/** 分段分析大文本并合并结果 */
export async function analyzeCharactersInBatches(
	fullText: string,
	config: AIConfig,
	batchSize: number = 50000,
	signal?: AbortSignal,
	onProgress?: (current: number, total: number) => void,
): Promise<CharacterAnalysisResult> {
	const chunks: string[] = [];
	for (let i = 0; i < fullText.length; i += batchSize) {
		chunks.push(fullText.slice(i, i + batchSize));
	}

	const total = chunks.length;
	const allCharacters: CharacterAnalysisResult["characters"] = [];
	const allRelationships: CharacterAnalysisResult["relationships"] = [];
	const processedNames = new Set<string>();

	const userPromptTemplate = `请分析以下小说文本，提取角色和关系信息：

[TEXT_START]
{chunk}
[TEXT_END]

请以JSON格式输出角色和关系信息。`;

	for (let i = 0; i < chunks.length; i++) {
		if (signal?.aborted) {
			throw new Error("分析已取消");
		}

		onProgress?.(i + 1, total);

		const messages: ChatMessage[] = [
			{ role: "system", content: CHARACTER_ANALYSIS_SYSTEM_PROMPT },
			{ role: "user", content: userPromptTemplate.replace("{chunk}", chunks[i]) },
		];

		try {
			const response = await sendChatCompletion(messages, config, signal);

			// 尝试解析JSON
			const jsonMatch = response.match(/\{[\s\S]*\}/);
			if (jsonMatch) {
				try {
					const result = JSON.parse(jsonMatch[0]) as Partial<CharacterAnalysisResult>;

					// 合并角色（去重）
					for (const char of result.characters || []) {
						if (!processedNames.has(char.name)) {
							processedNames.add(char.name);
							allCharacters.push(char);
						}
					}

					// 合并关系
					for (const rel of result.relationships || []) {
						allRelationships.push(rel);
					}
				} catch {
					logger.warn("[CharacterAnalysis] 解析JSON失败，跳过该批次");
				}
			}
		} catch (err) {
			logger.warn("[CharacterAnalysis] 批次分析失败:", err);
			// 继续处理其他批次
		}
	}

	// 对角色进行关系计数统计，影响力大的角色排在前面
	allCharacters.sort((a, b) => {
		const aRelCount = allRelationships.filter(
			r => r.sourceName === a.name || r.targetName === a.name
		).length;
		const bRelCount = allRelationships.filter(
			r => r.sourceName === b.name || r.targetName === b.name
		).length;
		return bRelCount - aRelCount;
	});

	return {
		characters: allCharacters,
		relationships: allRelationships,
	};
}

/** 章节名生成系统 prompt */
export const CHAPTER_TITLE_SYSTEM_PROMPT = `你是小说编辑专家。根据提供的章节内容和前几章的章节名，为当前章节生成合适的章节标题。

## 输出格式
请返回一个JSON数组，包含3-5个建议的章节名选项：
[{"title":"标题内容"},{"title":"另一个标题"},{"title":"备选标题"}]

## 要求
1. 章节名必须符合中文小说的命名习惯
2. 标题要能概括章节主要内容或核心事件
3. 避免剧透但要有吸引力
4. 保持与已有章节名风格一致
5. 生成的标题**不要**包含"第X章"或"第X回"前缀，只需纯标题内容

## 示例
输入章节内容："林辰走出家门，来到了繁华的京城大街上。他此行的目的是寻找传说中的铁匠铺..."
已有章节名：{"初入江湖":"第一章内容..."}
输出：[{"title":"京城寻踪"},{"title":"铁匠传说"},{"title":"繁华都市"}]`;

/**
 * 生成章节名建议
 * @param chapterContent 当前章节内容
 * @param previousChapters 前几章的章节名和内容（{title: content}格式）
 * @param chapterNumber 当前章节编号
 * @param config AI配置
 * @returns 章节名建议数组
 */
export async function generateChapterTitle(
	chapterContent: string,
	previousChapters: Record<string, string>,
	_chapterNumber: number,
	config: AIConfig,
	signal?: AbortSignal,
): Promise<string[]> {
	// 构建用户prompt
	const previousTitles = Object.keys(previousChapters).slice(-5); // 最多取前5章
	const titlesText = previousTitles.map((title, idx) => `${idx + 1}. ${title}`).join("\n");
	
	const userPrompt = `请为以下章节生成合适的章节名：

【章节内容】
${chapterContent.slice(0, 1000)}...

【前几章章节名参考】
${titlesText || "无"}

请生成3-5个合适的章节名建议。`;

	const messages: ChatMessage[] = [
		{ role: "system", content: CHAPTER_TITLE_SYSTEM_PROMPT },
		{ role: "user", content: userPrompt },
	];

	const response = await sendChatCompletion(messages, config, signal);
	
	try {
		const jsonMatch = response.match(/\[.*\]/);
		if (jsonMatch) {
			const result = JSON.parse(jsonMatch[0]) as Array<{ title: string }>;
			return result.map(item => item.title).filter(Boolean);
		}
	} catch {
		logger.warn("[ChapterTitle] 解析JSON失败");
	}
	
	// 如果解析失败，尝试提取引号或书名号中的标题
	const titleMatches = response.match(/["""](\S[^"""]{1,20})["""]|《([^》]+)》/g);
	if (titleMatches) {
		return titleMatches
			.map(t => t.replace(/["""《》]/g, "").trim())
			.filter(Boolean)
			.slice(0, 5);
	}
	
	return [];
}
