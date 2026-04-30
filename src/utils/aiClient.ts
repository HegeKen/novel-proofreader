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
		throw new Error(`AI 请求失败 (${resp.status}): ${text.slice(0, 200)}`);
	}

	const data: ChatCompletionResponse = await resp.json();
	logger.response(url, resp.status, data, elapsed);
	return data.choices?.[0]?.message?.content ?? "";
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

/** 校对系统 prompt */
export const PROOFREAD_SYSTEM_PROMPT = `你是一位专业的小说编辑。请仔细检查用户提供的文本中的错别字、排版错误、标点符号使用上存在的问题（如多余空格、标点误用、全角半角混用）和病句。

你必须返回一个 JSON 数组，每个元素代表一个错误，包含以下字段：
- "original_text": 原文中错误的原文片段（必须与原文完全一致，逐字复制）
- "corrected_text": 修正后的文本（直接替换 original_text 即可）
- "error_type": "typo"（错别字）/ "format"（排版错误）/ "punctuation"（标点符号使用上存在的问题）/ "grammar"（病句）
- "suggestion": 修改建议说明

注意：
1. original_text 必须从原文中精确复制，不要修改任何字符
2. corrected_text 是你建议的替换文本
3. 如果没有错误，返回空数组 []
4. 只返回 JSON，不要包含其他文字
5. 不要遗漏任何错误`;

/** 校对 user prompt */
export function buildProofreadUserPrompt(text: string): string {
	return `请检查以下文本：\n\n${text}`;
}

/** 剧本转换系统 prompt */
export const SCRIPT_SYSTEM_PROMPT = `你是一位专业的剧本编剧助手。请将用户提供的小说章节转换为标准剧本格式。

输出要求：
1. 每个场景以【场景】开头，描述场景环境
2. 角色对话以【角色名】开头
3. 动作描述以【动作】开头
4. 保持原文的故事情节和情感
5. 适当添加舞台指示
6. 输出纯文本格式`;

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
