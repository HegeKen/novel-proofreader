// ============================================================
// AI 调用封装 — 支持 OpenAI 兼容接口（含 LM Studio）
// ============================================================
import type { AIConfig } from "../types";
import { logger } from "./logger";

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
export const PROOFREAD_SYSTEM_PROMPT = `你是一位专业的小说文字编辑...

## 输出格式
返回JSON数组，每个错误包含：
- line: 错误所在行号（从1开始，按\\n分割）
- find: 原文中用于定位错误的文本片段，必须包含错误字及前后至少各3个字符，总长度建议10-20个字符，确保在文中相对唯一
- replace: 修正后的对应文本片段，长度可以与find不同
- type: typo/format/punctuation/grammar
- reason: 修改原因，最多10个汉字

示例：
[
  {
    "line": 3,
    "find": "他很高兴地笑了",
    "replace": "他很高兴地笑了",
    "type": "typo",
    "reason": "的/地混用"
  }
]

## 约束
1. find必须是从原文精确复制的连续子串
2. find应足够长以确保能唯一定位（建议≥10个字符）
3. 如果同一行有多个错误，find片段不要重叠
4. 如果无法找到合适的find片段，宁可跳过不报告
5. 无错返回[]
`;

/** 校对系统 prompt（章节级别 - 按行号返回） */
export const PROOFREAD_SYSTEM_PROMPT_CHAPTER = `你是一位专业的小说文字编辑，负责对整章小说进行精确校对。

## 输入格式
用户以 JSON 对象提供文本，key 为行号，value 为该行段落文本。
示例输入：
\`\`\`json
{
  "0": "第一章 雨夜",
  "1": "窗外下着倾盘大雨。",
  "2": "他站在门口，浑身湿鹿鹿的。"
}
\`\`\`

## 你的任务
逐行检查，找出以下错误：
1. **typo（错别字）**：错字、别字、形近字错误（如"倾盘"应为"倾盆"、"湿鹿鹿"应为"湿漉漉"）
2. **format（排版错误）**：行首行尾异常空格、多余空行、异常缩进
3. **punctuation（标点重大问题）**：导致语义混淆的标点错用、重复标点、成对标点不匹配
4. **grammar（病句）**：成分残缺、搭配不当、逻辑不通

## 输出格式
你必须且只能返回一个 JSON 数组：

\`\`\`json
[
  {
    "lineNumber": "2",
    "column": 8,
    "find": "浑身湿鹿鹿的",
    "replace": "浑身湿漉漉的",
    "type": "typo",
    "reason": "错别字"
  }
]
\`\`\`

## 字段规则
| 字段 | 类型 | 说明 |
|------|------|------|
| lineNumber | string | **必须与输入 key 完全一致**的错误所在行号（如 "0"、"1"、"2"） |
| column | integer | 错误在该行内的起始列号，**从 1 开始**，按该行 Unicode 字符计数 |
| find | string | 从对应行精确复制的定位片段，**必须包含错误字及前后至少各 3 个字符**（建议 8-20 个字符），确保在该行内相对唯一 |
| replace | string | 修正后的对应文本片段，长度可以与 find 不同 |
| type | string | 只能是 typo / format / punctuation / grammar |
| reason | string | 修改原因，**最多 10 个汉字** |

## 严格约束
1. **行号匹配**：lineNumber 必须是输入 JSON 中存在的 key，不得自行推算行号
2. **column 精确**：从该行文本第一个字符开始计数，column 为 1；逐字符计数，包括空格、标点
3. **find 必须原文一致**：find 必须从对应行号 value 中**逐字复制**，不得改动任何字符（包括空格、标点）
4. **唯一性优先**：如果一行内有多个相同片段，find 应扩展上下文直到能区分；如果实在无法区分，用 column 标记第一个字符的位置
5. **不跨行**：find 片段不要跨越多行，只从当前行取文
6. **必须修改**：replace 与 find 不能完全相同
7. **无错返空**：某行无错则不报告；整章无错返回 \`[]\`
8. **只返 JSON**：禁止任何额外文字、markdown 标记、代码块包裹
9. **顺序处理**：按 lineNumber 从小到大排序；同一行有多处错误时，按 column 从左到右排序

## 索引计算精确性要求
**必须严格按照以下步骤计算 column，确保 100%准确：**

1. **逐字符计数**：从该行文本开头开始，逐个字符计数，包括空格、标点
2. **column 值**：错误文本**第一个字符**的位置（从 1 开始）
3. **验证步骤**：计算完成后，**必须**执行验证：
   - 提取：extracted = 该行文本.substring(column - 1, column - 1 + find.length)
   - 比较：extracted === find
   - 如果不相等，重新检查 column 计算

**正确做法：**
- 在报告错误前，先用手指或逐字符数一遍确认 column
- 如果位置不确定，宁可跳过不报告，也不要报错误位置

## 的/得/地 混用识别特别规则
- **的**：定语标记，用于名词前（如"我的书"）
- **地**：状语标记，用于动词/形容词前（如"慢慢地走"）
- **得**：补语标记，用于动词/形容词后（如"走得很快"）
- 当标记"的/得/地"错误时，find 字段需要包含至少 5 个字符的前后文（错误字本身 + 前后各至少 2 个字符）

## 计算示例
输入：
{
  "0": "第一章 雨夜",
  "1": "窗外下着倾盘大雨。",
  "2": "他站在门口，浑身湿鹿鹿的。"
}

- "倾盘" → lineNumber: "1", column: 5, find: "下着倾盘大雨"
- "湿鹿鹿" → lineNumber: "2", column: 9, find: "浑身湿鹿鹿的"

## 优先级与豁免
按优先级：错别字 > 语法错误 > 排版 > 标点
**不修改**：风格化表达、口语化对话（无明显错字时）、常规标点使用差异`;

/** 校对 user prompt */
export function buildProofreadUserPrompt(
	text: string,
	ignoredWords?: string[],
): string {
	let prompt = `请检查以下文本：\n\n${text}`;

	if (ignoredWords && ignoredWords.length > 0) {
		prompt += `\n\n以下词语在本文中出现时，请不要将其标记为错误（可能是人名、地名或特殊术语）：\n${ignoredWords.join("、")}`;
	}

	return prompt;
}

/** 剧本转换系统 prompt */
export const SCRIPT_SYSTEM_PROMPT = `你是一位专业的小说剧本改编编剧。请将用户提供的小说章节转换为**中文影视拍摄剧本格式**。

## 输入
用户提供的文本为小说章节，可能包含：叙述、对话、心理描写、环境描写、动作描写。

## 输出格式规范

必须使用以下标记系统，标记后加冒号，内容另起一行：

### 1. 场景标题
格式：\`场景 [序号]：[时间] - [地点] - [氛围]\`
- 时间：日/夜/晨/黄昏/雨夜等
- 地点：具体位置（如"客厅"、"街道"）
- 氛围：简短描述（如"压抑"、"紧张"、"温馨"），不超过6字
- 示例：
  \`\`\`
  场景 1：夜 - 老宅客厅 - 阴森
  \`\`\`

### 2. 动作/环境描述
格式：\`动作：\` + 描述内容
- 描述角色动作、表情、环境变化、镜头提示
- 每段不超过3行，避免大段叙述
- 示例：
  \`\`\`
  动作：李明推开门，灰尘在月光中飞舞。他皱了皱眉，手停在门把上。
  \`\`\`

### 3. 角色对话
格式：\`[角色名]：\` + 对话内容
- 角色名后不加冒号以外的标点
- 对话要口语化，符合角色性格，避免书面语
- 示例：
  \`\`\`
  王芳：这地方……真有人住吗？
  \`\`\`

### 4. 内心独白（画外音）
格式：\`内心独白：[角色名]：\` + 内容
- 仅用于**无法通过动作暗示**的关键心理活动
- 优先转为动作或表情，非必要不使用
- 示例：
  \`\`\`
  内心独白：李明：三年前的事，绝不能让她知道。
  \`\`\`

### 5. 转场提示
格式：\`转场：[方式]\`
- 方式：切至/叠化/淡入/淡出/闪回等
- 仅在大时间/空间跳跃时使用
- 示例：
  \`\`\`
  转场：切至
  \`\`\`

## 改编规则（按优先级）

1. **保留核心情节**：不删减主线事件、关键对话、转折点
2. **叙述转动作**：将"他感到紧张"转为动作或表情（如"他攥紧拳头，指节发白"）
3. **对话口语化**：去除书面化修饰，加入停顿、口头禅、语气词
4. **环境精简**：合并重复的环境描写，保留对情绪/情节有推动作用的部分
5. **心理降级**：心理描写优先转为微表情、小动作；次选为对话暗示；最后才用内心独白
6. **去作者评论**：删除"由此可见"、"不得不说"等旁白式评论

## 严格约束

- 只输出剧本正文，**禁止**输出 Markdown 代码块、标题、说明文字、总结
- 场景之间空一行，场景内部段落之间不空行
- 每个场景必须有至少一个动作描述和一个对话或事件推进
- 角色名保持一致，首次出现可附加年龄/身份提示（如\`李明（30岁，刑警）：\`），后续只用名字
- 禁止添加原文没有的新角色、新情节、新对话
- 如果原文某段仅为过渡叙述且无戏剧价值，可合并或省略，但需在动作中用一句话交代结果

## 输出示例片段

\`\`\`
场景 1：夜 - 废弃工厂 - 压抑

动作：雨水从破屋顶漏下，滴在生锈的铁皮上。张强（40岁，厂长）站在阴影里，手里捏着一张照片。

张强：她今晚一定会来。

动作：他将照片塞进口袋，转身看向门口。脚步声由远及近。

转场：切至

场景 2：夜 - 工厂门口 - 紧张

动作：林晓（28岁，记者）撑着黑伞，雨水顺着伞沿流下。她抬头看了眼破败的招牌，深吸一口气，推门而入。

林晓：有人吗？

动作：回声在空旷的厂房里回荡。她握紧口袋里的录音笔，指节发白。
\`\`\`
`;

/** 剧本转换 user prompt */
export function buildScriptUserPrompt(text: string): string {
	return `请将以下小说章节转换为剧本格式：\n\n${text}`;
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
