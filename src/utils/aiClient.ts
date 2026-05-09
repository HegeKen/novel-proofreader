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
		content.includes("The request was rejected because it was considered high risk")
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
export const PROOFREAD_SYSTEM_PROMPT = `你是一位专业的小说编辑。请仔细检查用户提供的文本中的错别字、排版错误、标点符号使用上存在的重大问题和病句。

你必须严格按照以下JSON格式返回结果：
{
  "type": "array",
  "items": {
    "type": "object",
    "properties": {
      "start": {"type": "integer", "description": "错误起始字符位置（从0开始）"},
      "end": {"type": "integer", "description": "错误结束字符位置"},
      "original": {"type": "string", "description": "原文错误片段（必须与原文完全一致）"},
      "corrected": {"type": "string", "description": "修正后的文本"},
      "type": {"enum": ["typo", "format", "punctuation", "grammar"]},
      "reason": {"type": "string", "maxLength": 20, "description": "修改原因（不超过20字）"}
    },
    "required": ["start", "end", "original", "corrected", "type"]
  }
}

字段说明：
- "start": 错误在原文中的起始位置（从0开始计数）
- "end": 错误在原文中的结束位置（不包含）
- "original": 原文中错误的片段（必须与原文完全一致，逐字复制）
- "corrected": 修正后的文本
- "type": "typo"（错别字）/ "format"（排版错误）/ "punctuation"（标点符号使用上存在的重大问题）/ "grammar"（病句）
- "reason": 修改原因（限制在20字以内）

注意：
1. original 必须从原文中精确复制，不要修改任何字符
2. corrected 必须与 original 不同（至少有一个字符的差异）
3. original 必须是用户提供的原文的子字符串，不能是 AI 自行编造的描述
4. 如果没有错误，返回空数组 []
5. 只返回 JSON，不要包含其他文字
6. 重点优先检查：错别字、语法错误、逻辑不通的句子、严重排版问题
7. 标点符号只检查重大错误（如明显错用导致语义混淆、重复标点、严重空格问题）
8. 严禁返回 original 和 corrected 相同的错误项`;

/** 校对系统 prompt（章节级别 - 按行号返回） */
export const PROOFREAD_SYSTEM_PROMPT_CHAPTER = `你是一位专业的小说编辑。请仔细检查用户提供的整章小说文本中的错别字、排版错误、标点符号使用上存在的重大问题和病句。

用户会以 JSON 格式提供文本，其中 key 是行号（从0开始的整数），value 是对应行的段落文本。请逐行检查。

你必须严格按照以下JSON格式返回结果：
{
  "type": "array",
  "items": {
    "type": "object",
    "properties": {
      "lineNumber": {"type": "integer", "description": "错误所在的行号（与输入的 key 对应）"},
      "start": {"type": "integer", "description": "错误在该行文本中的起始字符位置（从0开始）"},
      "end": {"type": "integer", "description": "错误在该行文本中的结束字符位置"},
      "original": {"type": "string", "description": "原文错误片段（必须与原文完全一致）"},
      "corrected": {"type": "string", "description": "修正后的文本"},
      "type": {"enum": ["typo", "format", "punctuation", "grammar"]},
      "reason": {"type": "string", "maxLength": 20, "description": "修改原因（不超过20字）"}
    },
    "required": ["lineNumber", "start", "end", "original", "corrected", "type"]
  }
}

字段说明：
- "lineNumber": 错误所在的行号（必须与输入中的 key 对应）
- "start": 错误在该行文本中的起始位置（行内从0开始计数）
- "end": 错误在该行文本中的结束位置（不包含）
- "original": 原文中错误的片段（必须与原文完全一致，逐字复制）
- "corrected": 修正后的文本
- "type": "typo"（错别字）/ "format"（排版错误）/ "punctuation"（标点符号使用上存在的重大问题）/ "grammar"（病句）
- "reason": 修改原因（限制在20字以内）

注意：
1. original 必须从原文中精确复制，不要修改任何字符
2. corrected 必须与 original 不同（至少有一个字符的差异）
3. original 必须是用户提供的原文的子字符串，不能是 AI 自行编造的描述
4. 如果没有错误，返回空数组 []
5. 只返回 JSON，不要包含其他文字
6. 重点优先检查：错别字、语法错误、逻辑不通的句子、严重排版问题
7. 标点符号只检查重大错误（如明显错用导致语义混淆、重复标点、严重空格问题）
8. 严禁返回 original 和 corrected 相同的错误项`;

/** 校对 user prompt */
export function buildProofreadUserPrompt(text: string, ignoredWords?: string[]): string {
	let prompt = `请检查以下文本：\n\n${text}`;
	
	if (ignoredWords && ignoredWords.length > 0) {
		prompt += `\n\n以下词语在本文中出现时，请不要将其标记为错误（可能是人名、地名或特殊术语）：\n${ignoredWords.join('、')}`;
	}
	
	return prompt;
}

/** 剧本转换系统 prompt */
export const SCRIPT_SYSTEM_PROMPT = `你是一位专业的剧本编剧助手。请将用户提供的小说章节转换为标准剧本格式。

输出要求：
1. 每个场景以【场景 编号】开头（例如【场景 1】），紧随其后描述场景环境（时间、地点、氛围等）
2. 角色对话以【角色名】开头，角色名单独一行，下一行是对话内容
3. 动作描述以【动作】开头，描述角色的动作、表情或环境变化
4. 心理描写可转换为内心独白或动作暗示，以【内心独白】开头
5. 保持原文的故事情节和情感，不要添加或删减重要内容
6. 适当添加舞台指示，使剧本更具可读性和可拍摄性
7. 输出纯文本格式，不要添加任何 Markdown 格式或代码块
8. 场景之间空一行，使结构更清晰`;

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
