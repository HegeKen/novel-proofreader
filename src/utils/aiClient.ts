// ============================================================
// AI 调用封装 — 支持 OpenAI 兼容接口（含 LM Studio）
// ============================================================
import type { AIConfig, NovelWorldbuilding } from "../types";
import { logger } from "./logger";
import { normalizeCJKVariants } from "./normalizeCJK";
import { useAppMetaStore } from "../stores/appMetaStore";

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
		useAppMetaStore.getState().incrementAPIUsage(provider, false);
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
	const promptTokens = data.usage?.prompt_tokens ?? 0;
	const completionTokens = data.usage?.completion_tokens ?? 0;
	useAppMetaStore.getState().incrementAPIUsage(provider, true, promptTokens, completionTokens);

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
	testText?: string,
): Promise<{ ok: boolean; message: string }> {
	try {
		const userMessage = testText || '请回复"连接成功"四个字。';
		const reply = await sendChatCompletion(
			[{ role: "user", content: userMessage }],
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
export const PROOFREAD_SYSTEM_PROMPT = `你是小说文字编辑。输出JSON数组，每个错误含：line(行号从1)、find(原文连续片段，含错误及前后至少3字符，10-40字)、replace(修正后片段)、type(typo/format/punctuation/grammar/variant)、reason(≤10汉字)。

类型说明：
- typo：错别字（如"倾盘大雨"→"倾盆大雨"）
- format：排版空格空行
- punctuation：标点致命错误
- grammar：病句（如"的/地/得"混用）
- variant：康熙字典变体字/异体字/旧字形（如"⿰亻⿱⻊夂"、"⿲⿰⻊夂⻊夂"、"曱甴"等生僻字或旧字形，需修正为现代通用标准字）

上下文完整性要求（避免误判的关键）：
1. 如错误靠近句末，find必须包含句末标点（句号、问号、感叹号、逗号等）
2. find应包含完整的语义单元（完整词语、完整句子片段），不要截断词语
3. 上下文完整性优先于字数限制，宁可超出字数也要保证完整
4. 如错误涉及句子结构，应包含足够上下文以判断是否真正错误
5. 禁止为满足字数限制而删除必要的标点或截断词语

变体字精校规则：
1. 识别康熙字典中的生僻异体字、旧字形、俗字、讹字
2. 识别Unicode扩展区中的生僻字（如U+2F00-U+2FFF康熙部首区、U+3400-U+4DBF扩展A区等）
3. 将变体字修正为现代通用标准汉字
4. 常见变体字示例：
   - 旧字形「丼」→标准字「井」
   - 俗字「氼」→「溺」
   - 异体字「仌」→「冰」
   - 异体字「羣」→「群」
   - 旧字形「刄」→「刃」
   - 俗字「巛」→「川」
   - 旧字形「鉨」→「镍」

示例：[{"line":3,"find":"他很高兴地笑了。","replace":"他很高兴地笑了。","type":"typo","reason":"的/地混用"}]
约束：find精确复制且唯一；同行的find不重叠；无法定位则跳过；无错返回[]；变体字检测优先级高于普通错别字。`;
/** 校对系统 prompt（章节级别 - 每行返回一条错误） */
export const PROOFREAD_SYSTEM_PROMPT_CHAPTER = `你是小说文字编辑，校对整章JSON（key为行号，value为段落文本）。逐行检查typo(错别字)/format(排版空格空行)/punctuation(标点致命错误)/grammar(病句)/variant(康熙变体字)。输出JSON数组，字段：lineNumber(与输入key一致，string)、column(错误起始列，从1计数)、find(原文连续片段，含错误及前后各≥3字符，8-40字)、replace(修正后)、type、reason(≤10汉字)。严格约束：lineNumber须存在；column基于该行逐字符计算(含空格标点)；find精确复制；不跨行；无错返回[]；只输出JSON数组，无markdown。

类型说明：
- typo：错别字（如"倾盘大雨"→"倾盆大雨"）
- format：排版空格空行
- punctuation：标点致命错误
- grammar：病句（如"的/地/得"混用）
- variant：康熙字典变体字/异体字/旧字形（如"丼""氼""仌"等生僻字或旧字形，需修正为现代通用标准字）

上下文完整性要求（避免误判的关键）：
1. 如错误靠近句末，find必须包含句末标点（句号、问号、感叹号、逗号等）
2. find应包含完整的语义单元（完整词语、完整句子片段），不要截断词语
3. 上下文完整性优先于字数限制，宁可超出字数也要保证完整
4. 如错误涉及句子结构，应包含足够上下文以判断是否真正错误
5. 禁止为满足字数限制而删除必要的标点或截断词语

变体字精校规则：
1. 识别康熙字典中的生僻异体字、旧字形、俗字、讹字
2. 识别Unicode扩展区中的生僻字（如U+2F00-U+2FFF康熙部首区、U+3400-U+4DBF扩展A区等）
3. 将变体字修正为现代通用标准汉字
4. 常见变体字示例：
   - 旧字形「丼」→标准字「井」
   - 俗字「氼」→「溺」
   - 异体字「仌」→「冰」
   - 异体字「羣」→「群」
   - 旧字形「刄」→「刃」
   - 俗字「巛」→「川」
   - 旧字形「鉨」→「镍」

示例输入{"0":"第一章","1":"倾盘大雨。"} → [{"lineNumber":"1","column":5,"find":"倾盘大雨。","replace":"倾盆大雨。","type":"typo","reason":"错别字"}]。的/地/得错误：find含错误及前后各≥2字符。优先级：变体字>错别字>语法>排版>标点。不修改风格化/口语化表达。`;
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
	// 预处理：标准化 CJK 变体字，减少 AI 校对误报
	const normalized = normalizeCJKVariants(text);
	let prompt = `请检查以下文本：\n\n${normalized}`;

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
export const SCRIPT_TTS_ENHANCE_SYSTEM_PROMPT = `你是有声书演播导演。为剧本对话添加情感/音色/方言标注(TTS)。输出纯文本，保留原剧本格式。

## 标注格式
角色名：(标签)对话内容
- 圆括号内只能放一个标签（情绪/语调/音色/方言/唱歌之一）
- 标签后紧接对话内容，不加多余符号
- 旁白/叙述用"我："格式
- 仅输出标注后文本，无解释

## 可用标签
情绪：怅然/慵懒/开心/悲伤/愤怒/恐惧/惊讶/兴奋/委屈/平静/冷漠
复合：欣慰/无奈/愧疚/释然/嫉妒/厌倦/忐忑/动情
语调：温柔/高冷/活泼/严肃/俏皮/深沉/干练/凌厉
音色：磁性/醇厚/清亮/空灵/稚嫩/苍老/甜美/沙哑
方言：东北话/四川话/河南话/粤语/台湾腔/陕西话/吴语/湘语/赣语/客家话/闽语
特殊：(唱歌)放在歌词前；[叹气][笑][颤抖]等音频标签可放在句中

## 格式示例（严格遵循）
张强：(怅然)这么多年过去了，再走过那条街，心里一下子空了一块。
王芳：(慵懒)再让我睡五分钟……就五分钟，真的，最后一次。
我：(磁性)夜已经深了，城市还在呼吸。我是今晚陪你的人，欢迎收听《午夜电台》。
李大爷：(东北话)哎呀妈呀，这天儿也忒冷了吧！你说这风，嗖嗖的，跟刀子似的，割脸啊！
阿明：(粤语)呢个真係好正啊！食过一次就唔会忘记！
李明：(唱歌)原谅我这一生不羁放纵爱自由，也会怕有一天会跌倒，Oh no。

## 规则
- 场景/动作/转场保持原样，不添加标签
- 保留原文所有内容，绝不删改
- 每个角色说话只加一个标签，不要叠加多个标签
- 唱歌必须加(唱歌)，方言必须加对应方言标签
`;

/** 构建TTS情感增强的user prompt */
export function buildScriptTTSEnhanceUserPrompt(scriptContent: string, configuredCharacters?: Array<{ name: string; role?: string; dialect?: string }>): string {
        // 检查是否有旁白角色
        const narratorChar = configuredCharacters?.find(c => c.role === 'narrator');
        const narratorInstruction = narratorChar 
                ? `\n重要：如果剧本中存在旁白或叙述性文字，由旁白角色"${narratorChar.name}"朗读，使用"${narratorChar.name}："格式。` 
                : '\n重要：旁白或叙述性文字用"我："格式朗读。';
        
        // 构建方言提示
        const dialectChars = configuredCharacters?.filter(c => c.dialect) || [];
        const dialectInstruction = dialectChars.length > 0
                ? `\n\n重要-角色方言指定：以下角色必须使用指定方言标签：\n${dialectChars.map(c => `- ${c.name}：方言标签为(${c.dialect})，该角色所有对话必须加上(${c.dialect})标签`).join('\n')}\n`
                : '';

        return `为以下剧本对话添加情感/音色标注(TTS)。规则：所有行(含旁白)标注角色名。格式：角色名：(标签)内容。场景/动作/转场保持原样。唱歌加(唱歌)。纯文本输出，无markdown。${narratorInstruction}${dialectInstruction}
剧本：
${scriptContent}`;
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
export const NOVEL_TTS_ENHANCE_SYSTEM_PROMPT = `你是有声书演播导演。为小说文本添加情感/音色/方言标注(TTS)。输出纯文本，保留原文。

## 标注格式
(标签)文本内容

- 圆括号内只能放一个标签（情绪/语调/音色/方言/唱歌之一）
- 标签后紧接内容，不加冒号
- 保持原文完整不变，仅在最前面加标签
- 仅输出标注后文本，无任何解释

## 可用标签
情绪：怅然/慵懒/开心/悲伤/愤怒/恐惧/惊讶/兴奋/委屈/平静/冷漠
复合：欣慰/无奈/愧疚/释然/嫉妒/厌倦/忐忑/动情
语调：温柔/高冷/活泼/严肃/俏皮/深沉/干练/凌厉
音色：磁性/醇厚/清亮/空灵/稚嫩/苍老/甜美/沙哑
方言：东北话/四川话/河南话/粤语/台湾腔/陕西话/吴语/湘语/赣语/客家话/闽语
特殊：(唱歌)放在歌词前；[叹气][笑][颤抖]等音频标签可放在句中

## 格式示例（严格遵循）
(怅然)这么多年过去了，再走过那条街，心里一下子空了一块。
(慵懒)再让我睡五分钟……就五分钟，真的，最后一次。
(磁性)夜已经深了，城市还在呼吸。我是今晚陪你的人，欢迎收听《午夜电台》。
(东北话)哎呀妈呀，这天儿也忒冷了吧！你说这风，嗖嗖的，跟刀子似的，割脸啊！
(粤语)呢个真係好正啊！食过一次就唔会忘记！
(唱歌)原谅我这一生不羁放纵爱自由，也会怕有一天会跌倒，Oh no。背弃了理想，谁人都可以，哪会怕有一天只你共我。

## 规则
- 【绝对禁止】不得修改、增删、替换、润色原文中的任何文字、标点或字符
- 每个段落/对话最开头加一个标签，不要多个标签叠加
- 保留原文所有内容和标点，绝不删改原文
- 唱歌内容前面必须加(唱歌)，不要加其他标签
- 方言内容必须加对应方言标签，不要加其他标签
`;

/** 构建小说章节TTS情感增强的user prompt */
export function buildNovelTTSEnhanceUserPrompt(chapterContent: string, configuredCharacters?: Array<{ name: string; dialect?: string }>): string {
        const dialectChars = configuredCharacters?.filter(c => c.dialect) || [];
        const dialectInstruction = dialectChars.length > 0
                ? `\n\n重要-角色方言指定：以下角色出现时，其对话必须加上对应方言标签：\n${dialectChars.map(c => `- ${c.name}：使用(${c.dialect})`).join('\n')}\n请根据角色名识别对话归属，为对应角色的对话添加正确的方言标签。`
                : '';
        
        return `为以下小说章节添加情感/音色标注(TTS)。规则：每段加合适标签，对话丰富，叙述平稳，唱歌加(唱歌)。纯文本输出，保留原文结构与内容。${dialectInstruction}\n\n${chapterContent}`;
}

// ============================================================
// 阅读模式逐段TTS情感增强Prompt
// ============================================================

/** 阅读模式逐段TTS情感增强系统提示词 */
export const READING_MODE_TTS_ENHANCE_SYSTEM_PROMPT = `你是小说有声书演播导演。分析段落：识别人物、判断情绪、输出TTS标注JSON。

## 核心约束：绝对禁止篡改原文
- text 字段必须包含「当前段落」的完整原文，只允许在开头添加 (标签) 或句中插入 [音频标签]
- 禁止修改、增删、替换、润色原文中的任何词语、标点或字符
- 禁止将原文中角色说的话改写为旁白，或旁白改写为对话
- 禁止把「当前段落」中不含的人名、名词写入 text

## 输出格式
情绪/语调(选其一)：开心/悲伤/愤怒/恐惧/惊讶/兴奋/委屈/平静/冷漠/怅然/欣慰/无奈/愧疚/释然/嫉妒/厌倦/忐忑/动情/温柔/高冷/活泼/严肃/慵懒/俏皮/深沉/干练/凌厉。
方言(如需)：东北话/四川话/河南话/粤语/台湾腔/陕西话/吴语/湘语/赣语/客家话/闽语
特殊标记：(唱歌)放在歌词前；[音频标签]如[叹气][笑][颤抖]插在句中。

输出JSON：
{"characters":["人物名"],"segments":[{"type":"narration/dialogue","speaker":"旁白或角色名","emotion":"情绪","tone":"语调","text":"(方言,情绪,语调)标签化文本"}]}

## 方言规则（严格遵守）
- 当角色在"已配置角色"中标注了 <方言：XXX> 时，该角色的对话 text 必须以 (XXX,情绪,语调) 开头
- 例：角色有 <方言：粤语>，对话应写为 (粤语,开心,活泼)正文内容
- 普通话角色（无方言标注）直接用 (情绪,语调)，不加方言标签
- 旁白始终用普通话，不加方言标签

## 其他规则
- 旁白speaker="旁白"，对话用角色名
- 保持原文本顺序，只加标签；对话和叙述分开但必须按照原文顺序输出
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
        configuredCharacters: Array<{ name: string; aliases: string[]; voice?: string; role?: string; relationTerms?: string[]; dialect?: string }>
): string {
        const chars = configuredCharacters.length ? configuredCharacters.map(c => {
                const alias = c.aliases?.length ? `（别称：${c.aliases.join('、')}）` : '';
                const voice = c.voice ? ` [音色：${c.voice}]` : '';
                const roleLabel = c.role ? `【${c.role === 'narrator' ? '旁白' : c.role}】` : '';
                const dialect = c.dialect ? ` <方言：${c.dialect}>` : '';
                return `- ${c.name}${roleLabel}${alias}${voice}${dialect}`;
        }).join('\n') : '无已配置角色';
        
        // 构建方言强制指令
        const dialectChars = configuredCharacters.filter(c => c.dialect);
        const dialectInstruction = dialectChars.length > 0
                ? `\n\n## 方言强制指令（必须遵守）\n以下角色有方言设定，他们说的每句对话 text 必须以 (方言,情绪,语调) 开头：\n${dialectChars.map(c => `- ${c.name} → 必须使用 (${c.dialect},情绪,语调) 开头`).join('\n')}\n其他角色（无方言标注）一律不加方言标签，直接用 (情绪,语调)。旁白也不加方言标签。`
                : '';

        // 检查是否有旁白角色（检查 role、aliases、relationTerms）
        const narratorChar = configuredCharacters.find(c => 
                c.role === 'narrator' || 
                c.aliases?.some(a => a.includes('旁白')) ||
                c.relationTerms?.some(r => r.includes('旁白'))
        );
        const narratorInstruction = narratorChar 
                ? `\n重要：如果配置了旁白角色"${narratorChar.name}"，所有旁白(narration)必须使用该角色朗读，speaker设为"${narratorChar.name}"。` 
                : '\n重要：如果没有配置旁白角色，旁白speaker设为"旁白"。';
        
        return `分析段落，识别人物并判断情绪。

已配置角色：
${chars}${narratorInstruction}${dialectInstruction}

【上下文信息-仅用于分析，不要输出】
- 上文参考：${contextBefore || '无'}
- 当前段落：${paragraphText}
- 下文参考：${contextAfter || '无'}

要求：
1. 仅分析「当前段落」的内容，text 必须与原文逐字一致，不能增删改任何字符
2. 匹配已配置角色，判断整体情绪，添加情绪/语调标签，识别对话说话人
3. 返回JSON格式，不要包含任何解释性文字
4. 【绝对禁止】不要将「上文参考」「下文参考」的内容作为输出 text 的一部分，哪怕一个字符都不行
5. 【关键】有方言设定的角色，对话 text 必须以 (方言,情绪,语调) 开头，例如 (粤语,开心,活泼)今天天气真好！
6. 【关键】如果「当前段落」原文不含对话（没有引号/冒号引出的说话内容），全部归为 narration 类型，speaker 为旁白`;
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

// ============================================================
// 世界观分析提示词与函数
// ============================================================
export const WORLDBUILDING_ANALYSIS_SYSTEM_PROMPT = `你是小说世界观分析专家。请从给定的小说文本中提取并分析该故事的世界观设定，生成结构化的JSON数据。

## 输出格式必须是严格的JSON（不要有任何markdown标记）：
{
  "worldType": "世界背景类型（如：玄幻世界、科幻未来、古代王朝、现代都市、悬疑世界、末日废土、仙侠世界等）",
  "eraDescription": "时代背景描述（如：架空古代、近未来、星际时代、中世纪、民国时期、三国时期等）",
  "geography": "地理环境描述（如：大陆格局、气候特征、重要地点、地域分布等）",
  "socialStructure": "社会结构（如：政治体制、阶级划分、权力体系、管理制度等）",
  "powerSystem": "力量体系（如：修炼体系、魔法体系、科技水平、特殊能力等，无则为空字符串）",
  "civilization": "文明文化（如：种族构成、文化习俗、宗教信仰、语言文字、艺术风格等）",
  "history": "历史背景（如：重大历史事件、传说、纪元更替、重要年代等）",
  "coreSettings": "核心设定（如：世界运行规则、特殊法则、独特设定等）",
  "description": "完整世界观概述（综合以上所有维度，100-300字）"
}

## 分析原则
1. 只基于文本内容提取，不要臆造信息
2. 对于不确定的信息，对应字段留空字符串
3. 从环境描写、人物对话、背景叙述中分析世界观信息
4. 注意识别力量体系、社会制度等隐性设定

## 约束
- 输出必须是有效的JSON格式
- 不要臆造信息，只基于文本内容
- 遇到不确定的信息，对应字段留空字符串`;

/**
 * AI 分析小说世界观
 * @param fullText 小说全文
 * @param config AI配置
 * @param signal 取消信号
 * @returns 世界观分析结果
 */
export async function analyzeWorldbuilding(
	fullText: string,
	config: AIConfig,
	signal?: AbortSignal,
): Promise<NovelWorldbuilding | null> {
	const batchSize = 80000;
	const chunks: string[] = [];
	for (let i = 0; i < fullText.length; i += batchSize) {
		chunks.push(fullText.slice(i, i + batchSize));
	}

	let result: NovelWorldbuilding | null = null;

	const userPromptTemplate = `请分析以下小说文本，提取世界观设定信息：

[TEXT_START]
{chunk}
[TEXT_END]

请以JSON格式输出世界观信息。`;

	for (let i = 0; i < chunks.length; i++) {
		if (signal?.aborted) throw new Error("分析已取消");

		const messages: ChatMessage[] = [
			{ role: "system", content: WORLDBUILDING_ANALYSIS_SYSTEM_PROMPT },
			{ role: "user", content: userPromptTemplate.replace("{chunk}", chunks[i]) },
		];

		try {
			const response = await sendChatCompletion(messages, config, signal);
			const jsonMatch = response.match(/\{[\s\S]*\}/);
			if (jsonMatch) {
				const parsed = JSON.parse(jsonMatch[0]) as NovelWorldbuilding;
				// 优先取有内容的结果（后面批次覆盖前面）
				if (parsed.worldType) {
					result = parsed;
				}
			}
		} catch (err) {
			logger.warn("[Worldbuilding] 批次分析失败:", err);
		}
	}

	return result;
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
      "age": "年龄描述（如：20多岁、中年、年过半百等，不确定则为空字符串）",
      "role": "protagonist/heroine/antagonist/supportingMale/supportingFemale/mentor/rival/loveInterest/family/friend/npc",
      "appearance": "外貌特征描述（身高、体型、面容、穿着风格等）",
      "identity": "身份职业（如：剑客、商人、书生、将军、丫鬟等）",
      "socialStatus": "社会地位（如：贵族、平民、江湖高手、皇室成员等）",
      "personality": "核心性格特质（如：沉稳内敛、开朗活泼、心机深沉、善良正直等）",
      "background": "出身背景（如：名门望族、寒门子弟、孤儿、世家传承等）",
      "keyExperiences": ["关键人生经历1", "关键人生经历2", "重要转折点"],
      "characterArc": "角色弧光描述（角色成长变化、内心转变、价值观演变等）",
      "description": "人物完整小传描述（整合以上信息，100-300字）",
      "appearances": ["首次出场章节或位置描述"],
      "voiceDesignPrompt": "音色设计描述（根据角色性别、年龄、性格、身份和地域背景设计，如：温柔甜美，年轻女性，温婉知性，使用东北话，江南口音，适合表达柔情、羞涩、关切等情感）",
      "majorEvents": "角色在全文中的关键经历和大事件总结（如：1. 在青云门拜师学艺，2. 参加天才大会夺冠，3. 发现身世之谜远走天涯。按时间顺序列出3-8个核心事件）"
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
  ],
  "worldbuilding": {
    "worldType": "世界背景类型（如：玄幻世界、科幻未来、古代王朝、现代都市、悬疑世界等）",
    "eraDescription": "时代背景描述（如：架空古代、近未来、星际时代、中世纪、民国时期等）",
    "geography": "地理环境描述（如：大陆格局、气候特征、重要地点、地域分布等）",
    "socialStructure": "社会结构（如：政治体制、阶级划分、权力体系、管理制度等）",
    "powerSystem": "力量体系（如：修炼体系、魔法体系、科技水平、特殊能力等，无则为空字符串）",
    "civilization": "文明文化（如：种族构成、文化习俗、宗教信仰、语言文字、艺术风格等）",
    "history": "历史背景（如：重大历史事件、传说、纪元更替、重要年代等）",
    "coreSettings": "核心设定（如：世界运行规则、特殊法则、独特设定等）",
    "description": "完整世界观概述（综合以上所有维度，100-300字）"
  }
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
- employer-employee: 上下级关系
- colleague: 同事/同僚
- stranger: 陌生人
- other: 其他（需填写customRelationType）

## 分析原则
1. 只提取有明确名字或明确身份指代的重要角色
2. 注意识别角色的别名和称呼变化
3. 从文本中的对话、互动、明确描述来推断关系
4. 关系代称要完整（如"老婆"、"老公"、"师父"、"徒弟"等）
5. 尽可能详细提取以下信息：
   - 姓名：角色正式名称和别名
   - 年龄：从文本推断的年龄阶段
   - 性别：男/女/其他
   - 外貌特征：身高、体型、面容、穿着、气质等
   - 身份：职业、头衔、所属组织等
   - 社会地位：在社会中的阶层和影响力
   - 核心性格特质：内在性格特点和行为模式
   - 出身：家庭背景、成长环境
   - 关键人生经历：重要事件、转折点、成就或挫折
   - 角色弧光：角色在故事中的成长、转变和发展
6. 如果文本过长，请分批次分析，最后合并结果

## 约束
- 输出必须是有效的JSON格式
- 数组可能为空，但结构必须完整
- 不要臆造信息，只基于文本内容
- 遇到不确定的信息，对应字段留空字符串或空数组
- 遇到不确定的关系，可以标记为other但提供描述`;

/** 角色分析结果类型 */
export interface CharacterAnalysisResult {
	characters: Array<{
		id?: string;
		name: string;
		aliases: string[];
		gender: "male" | "female" | "other";
		age?: string;
		role: string;
		appearance?: string;
		identity?: string;
		socialStatus?: string;
		personality?: string;
		background?: string;
		keyExperiences?: string[];
		characterArc?: string;
		description: string;
		voiceDesignPrompt?: string;
		appearances: string[];
		majorEvents?: string;
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
	worldbuilding?: {
		worldType: string;
		eraDescription: string;
		geography: string;
		socialStructure: string;
		powerSystem: string;
		civilization: string;
		history: string;
		coreSettings: string;
		description: string;
	};
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
	let mergedWorldbuilding: CharacterAnalysisResult["worldbuilding"] | undefined;
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

					// 优先取非空的世界观（后面的批次覆盖前面的）
					if (result.worldbuilding && result.worldbuilding.worldType) {
						mergedWorldbuilding = result.worldbuilding;
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
		worldbuilding: mergedWorldbuilding,
	};
}

/** 单个角色小传重新分析系统提示词 */
export const CHARACTER_REANALYSIS_SYSTEM_PROMPT = `你是小说角色分析专家。请根据提供的小说文本和角色信息，重新提炼总结该角色的人物小传。

## 输入信息
- 小说文本：包含该角色出现的上下文
- 角色名称：${"{characterName}"}
- 角色别称：${"{aliases}"}
- 关系代称：${"{relationTerms}"}
- 现有小传：${"{existingBiography}"}（如果有）

## 分析维度
请从以下维度对角色进行分析并生成小传：
1. 外貌特征：身高、体型、面容、穿着风格等
2. 身份职业：角色的职业、头衔、所属组织等
3. 社会地位：在社会中的阶层和影响力
4. 核心性格：内在性格特点和行为模式
5. 出身背景：家庭背景、成长环境
6. 关键经历：重要事件、转折点、成就或挫折
7. 角色弧光：角色在故事中的成长、转变和发展

## 输出格式
请返回纯文本格式的角色小传（100-300字），不要使用JSON或其他格式。

## 分析原则
1. 优先基于提供的小说文本进行分析
2. 结合角色的名称、别称和关系代称来识别角色
3. 参考现有小传（如果有），保持信息的连贯性和一致性
4. 从小传应简洁明了，涵盖上述主要维度
5. 不要臆造信息，不确定的内容可以省略
6. 如果现有小传中的信息与小说文本冲突，以小说文本为准`;

/** 重新分析单个角色的小传 */
export async function reanalyzeCharacterBiography(
	fullText: string,
	characterName: string,
	aliases: string[] = [],
	relationTerms: string[] = [],
	config: AIConfig,
	existingBiography: string = "",
): Promise<string> {
	if (!fullText || !characterName) {
		throw new Error("缺少必要的输入参数");
	}

	if (!config.apiKey || !config.baseURL) {
		throw new Error("AI配置不完整");
	}

	// 截取包含角色名称的相关文本片段（最多10000字符）
	let relevantText = fullText;
	
	// 如果文本太长，尝试提取包含角色名称的上下文
	if (fullText.length > 10000) {
		const searchPattern = new RegExp(`([^。！？\n]*[${characterName}${aliases.join('|')}][^。！？\n]*[。！？\n]?)`, 'gi');
		const matches = fullText.match(searchPattern);
		if (matches && matches.length > 0) {
			relevantText = matches.slice(0, 30).join(''); // 最多取30个匹配片段
			if (relevantText.length > 10000) {
				relevantText = relevantText.slice(0, 10000);
			}
		} else {
			// 如果没有找到匹配，取前10000字符
			relevantText = fullText.slice(0, 10000);
		}
	}

	const systemPrompt = CHARACTER_REANALYSIS_SYSTEM_PROMPT
		.replace("${{characterName}}", characterName)
		.replace("${{aliases}}", aliases.length > 0 ? aliases.join("、") : "无")
		.replace("${{relationTerms}}", relationTerms.length > 0 ? relationTerms.join("、") : "无")
		.replace("${{existingBiography}}", existingBiography.trim() || "无");

	const userPrompt = `请分析以下小说文本，为角色「${characterName}」生成详细的人物小传：

[小说文本]
${relevantText}

[角色信息]
名称：${characterName}
别称：${aliases.length > 0 ? aliases.join("、") : "无"}
关系代称：${relationTerms.length > 0 ? relationTerms.join("、") : "无"}
${existingBiography.trim() ? `[现有小传（作为参考）]
${existingBiography}` : ""}

请根据上述信息，生成该角色的人物小传。${existingBiography.trim() ? '可以参考现有小传的内容，但需基于小说文本进行优化和补充。' : ''}`;

	const messages: ChatMessage[] = [
		{ role: "system", content: systemPrompt },
		{ role: "user", content: userPrompt },
	];

	const response = await sendChatCompletion(messages, config);

	// 返回清理后的小传文本
	return response.trim();
}

/** 音色设计生成系统 prompt */
export const VOICE_DESIGN_SYSTEM_PROMPT = `你是一位专业的声音设计师。根据角色信息生成TTS音色描述。

## 要求
- 输出1-4句，简洁精准，不堆砌维度
- 不出现混响、回声、EQ、压缩等音质效果词
- 不出现"普通的""正常的""外国的"等模糊描述
- 不同时要求矛盾特征（如"稚嫩的童声"与"CEO气场"）

## 描述维度（选2-3个核心的即可，不必面面俱到）
- 性别与年龄：如"年轻女性""五十多岁的中年男性"
- 音色质感：如"deep and gravelly""丝滑醇厚、带着磁性"
- 情绪语气：如"warm and confident""温柔但带着一丝疲惫"
- 语速节奏：如"slow and deliberate""语速极快，像连珠炮"
- 人设说话风格（可选）：如"深夜电台DJ""一本正经地"

## 示例
输入：角色名：林婉儿，女，女主。江南大家闺秀，知书达理，性格温婉可人。
输出：温柔甜美，年轻女性，温婉知性，江南口音。

输入：角色名：赵铁柱，男，男主。东北豪爽汉子，性格耿直，东北口音。
输出：粗犷豪迈，中年男性，直爽干练，东北口音。`;

/**
 * 基于角色信息生成音色设计描述
 * @param characterInfo 角色信息
 * @param config AI配置
 * @returns 音色设计描述文本
 */
export async function generateVoiceDesign(
	characterInfo: {
		name: string;
		gender: "male" | "female" | "other";
		role?: string;
		notes?: string;
	},
	config: AIConfig,
): Promise<string> {
	if (!config.apiKey || !config.baseURL) {
		throw new Error("AI配置不完整");
	}

	const roleNameMap: Record<string, string> = {
		protagonist: "男主",
		heroine: "女主",
		antagonist: "反派",
		supportingMale: "男配",
		supportingFemale: "女配",
		mentor: "导师",
		rival: "对手",
		loveInterest: "爱慕对象",
		family: "家人",
		friend: "朋友",
		narrator: "旁白",
		npc: "NPC",
	};

	const roleName = characterInfo.role ? roleNameMap[characterInfo.role] || characterInfo.role : "NPC";
	const genderName = characterInfo.gender === "male" ? "男" : characterInfo.gender === "female" ? "女" : "其他";

	const userPrompt = `角色名：${characterInfo.name}，${genderName}，${roleName}。${characterInfo.notes ? characterInfo.notes.slice(0, 500) : ""}

请生成音色描述。`;

	const messages: ChatMessage[] = [
		{ role: "system", content: VOICE_DESIGN_SYSTEM_PROMPT },
		{ role: "user", content: userPrompt },
	];

	const response = await sendChatCompletion(messages, config);

	return response.trim();
}

/** 角色大事件分析系统 prompt — 单批分析 */
export const MAJOR_EVENTS_SYSTEM_PROMPT = `你是一位小说剧情分析专家。根据提供的小说文本片段和角色信息，找出该角色在这段文本中出现的关键经历和大事件。

## 输出格式
如果该角色在这段文本中有重要事件，按出现的先后顺序，以 Markdown 列表格式输出：
1. 事件描述（10-30字，简洁明了）
2. 事件描述
...

如果该角色在这段文本中没有重要事件或没有出现，请输出：无

## 要求
1. 每个事件用一句话概括
2. 只基于提供的文本内容，不要臆造
3. 聚焦于角色亲身参与或对其有重大影响的事件`;

/** 角色大事件合并系统 prompt — 合并去重排序 */
export const MAJOR_EVENTS_MERGE_PROMPT = `你是小说剧情分析专家。以下是分析某个角色在全文中关键经历时，从不同文本片段中提取出的事件列表，请将这些事件合并、去重并按时间顺序排列。

## 输出格式
按时间顺序，以 Markdown 列表格式输出该角色的核心大事件，每行一条：
1. 事件描述（10-30字）
2. 事件描述
...

## 要求
1. 合并意思相近或重复的事件
2. 按故事发展的时间顺序排列
3. 保留 3-8 个最核心的事件
4. 去除冗余和次要信息
5. 每个事件用一句话概括，清晰明了`;

/**
 * 分批分析整本小说，提取角色的大事件
 * @param fullText 小说全文
 * @param characterInfo 角色信息
 * @param config AI配置
 * @returns 角色大事件文本
 */
export async function generateMajorEvents(
	fullText: string,
	characterInfo: {
		name: string;
		gender: "male" | "female" | "other";
		role?: string;
		notes?: string;
		aliases?: string[];
	},
	config: AIConfig,
): Promise<string> {
	if (!config.apiKey || !config.baseURL) {
		throw new Error("AI配置不完整");
	}

	// 分批处理，每批 30000 字符
	const batchSize = 30000;
	const chunks: string[] = [];
	for (let i = 0; i < fullText.length; i += batchSize) {
		chunks.push(fullText.slice(i, i + batchSize));
	}

	const roleLabel = characterInfo.role === "protagonist" ? "男主" :
		characterInfo.role === "heroine" ? "女主" :
		characterInfo.role === "antagonist" ? "反派" : (characterInfo.role || "角色");

	const configForCall = {
		baseURL: config.baseURL,
		apiKey: config.apiKey,
		model: config.model,
		customHeaders: config.customHeaders || {},
		maxCharsPerRequest: config.maxCharsPerRequest || 0,
		enableLogging: config.enableLogging || false,
	};

	// 第一阶段：逐批分析，提取每段中的事件
	const allEvents: string[] = [];
	for (let i = 0; i < chunks.length; i++) {
		const chunk = chunks[i];
		const userPrompt = `角色名：${characterInfo.name}
别称：${characterInfo.aliases?.length ? characterInfo.aliases.join('、') : '无'}
角色类型：${roleLabel}

请分析以下小说文本片段（第 ${i + 1}/${chunks.length} 部分），找出该角色在这部分中的关键经历和大事件：

${chunk}`;

		const messages: ChatMessage[] = [
			{ role: "system", content: MAJOR_EVENTS_SYSTEM_PROMPT },
			{ role: "user", content: userPrompt },
		];

		try {
			const response = await sendChatCompletion(messages, configForCall);
			const trimmed = response.trim();
			if (trimmed !== "无" && trimmed !== "") {
				allEvents.push(trimmed);
			}
		} catch (err) {
			logger.warn(`[MajorEvents] 批次 ${i + 1} 分析失败:`, err);
			// 继续处理其他批次
		}
	}

	if (allEvents.length === 0) {
		return "暂无分析结果";
	}

	if (allEvents.length === 1) {
		return allEvents[0];
	}

	// 第二阶段：合并所有批次的结果
	const combinedEvents = allEvents.join("\n");
	const mergePrompt = `角色名：${characterInfo.name}
角色类型：${roleLabel}

以下是各文本片段分析出的事件列表，请合并去重并按时间顺序排列：

${combinedEvents}`;

	const mergeMessages: ChatMessage[] = [
		{ role: "system", content: MAJOR_EVENTS_MERGE_PROMPT },
		{ role: "user", content: mergePrompt },
	];

	try {
		const finalResponse = await sendChatCompletion(mergeMessages, configForCall);
		return finalResponse.trim();
	} catch (err) {
		logger.warn("[MajorEvents] 合并阶段失败，返回原始结果:", err);
		return combinedEvents;
	}
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
