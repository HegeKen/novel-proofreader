// ============================================================
// AI 调用封装 — 支持 OpenAI 兼容接口（含 LM Studio）
// ============================================================
import type { AIConfig, AIProvider, NovelWorldbuilding, CharacterInfo, CharacterRelationship } from "../types";
import { logger } from "./logger";
import { normalizeCJKVariants } from "./normalizeCJK";
import { generateId } from "./id";
import { useAppMetaStore } from "../stores/appMetaStore";
import { ANOMALY_PROMPT_TEXT } from "./punctuationCheck";

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

/** 根据 baseURL 识别提供商 */
export function detectProvider(baseURL: string): AIProvider {
	const url = baseURL.toLowerCase();
	if (url.includes("deepseek")) return "deepseek";
	if (url.includes("xiaomimimo") || url.includes("mimo")) return "mimo";
	if (url.includes("siliconflow")) return "siliconflow";
	if (url.includes("openai")) return "openai";
	if (url.includes("localhost:1234") || url.includes("127.0.0.1:1234")) return "lmstudio";
	if (url.includes("localhost:11434") || url.includes("127.0.0.1:11434")) return "ollama";
	if (url.includes("localhost:8000") || url.includes("127.0.0.1:8000")) return "vllm";
	return "custom";
}

/** 各提供商 HTTP 状态码 → 用户友好提示 */
const ERROR_MESSAGES: Partial<Record<AIProvider, Record<number, string>>> = {
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

const RETRYABLE_STATUS_CODES = [429, 500, 502, 503, 504];
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000;

async function waitForRetry(attempt: number, signal?: AbortSignal): Promise<void> {
	const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt) + Math.random() * 500;
	if (!signal) {
		return new Promise(resolve => setTimeout(resolve, delay));
	}
	return new Promise((resolve, reject) => {
		const timer = setTimeout(resolve, delay);
		signal.addEventListener("abort", () => {
			clearTimeout(timer);
			reject(createAbortError());
		}, { once: true });
	});
}

/** 创建统一的取消异常（AbortError），供所有调用方一致识别 */
export function createAbortError(): DOMException {
	return new DOMException("请求已被取消", "AbortError");
}

/** 若已取消则抛出 AbortError */
function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) {
		throw createAbortError();
	}
}

async function executeChatRequest(
	url: string,
	headers: Record<string, string>,
	body: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<Response> {
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
	}

	return resp;
}

/**
 * 构建一次请求用的 AIConfig（基于 store 中的配置，去掉自定义头/分块限制，
 * 可选关闭日志），供各功能模块复用，避免重复内联配置对象
 */
export function buildRequestConfig(
	aiConfig: AIConfig,
	overrides: Partial<Pick<AIConfig, "maxCharsPerRequest" | "enableLogging">> = {},
): AIConfig {
	return {
		baseURL: aiConfig.baseURL,
		apiKey: aiConfig.apiKey,
		model: aiConfig.model,
		customHeaders: {},
		maxCharsPerRequest: 0,
		enableLogging: false,
		...overrides,
	};
}

/**
 * 发送 Chat Completion 请求（带重试机制）
 */
export async function sendChatCompletion(
	messages: ChatMessage[],
	config: AIConfig,
	signal?: AbortSignal,
): Promise<string> {
	const startTime = Date.now();
	const url = `${config.baseURL.replace(/\/+$/, "")}/chat/completions`;

	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		...config.customHeaders,
	};
	if (config.apiKey) {
		headers["Authorization"] = `Bearer ${config.apiKey}`;
	}

	const promptTokens = Math.floor(messages.reduce((acc, m) => acc + (m.content?.length || 0), 0) * 0.5);
	const minMaxTokens = Math.max(131072, Math.floor(promptTokens * 1.5));

	const body = {
		model: config.model,
		messages,
		temperature: 0.1,
		max_tokens: minMaxTokens,
	};

	const provider = detectProvider(config.baseURL);

	for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
		throwIfAborted(signal);

		try {
			const resp = await executeChatRequest(url, headers, body, signal);

			if (!resp.ok) {
				const text = await resp.text().catch(() => "");
				
				if (RETRYABLE_STATUS_CODES.includes(resp.status) && attempt < MAX_RETRIES - 1) {
					logger.warn(`AI 请求失败，准备重试 (attempt ${attempt + 1}/${MAX_RETRIES})`, { status: resp.status });
					await waitForRetry(attempt, signal);
					continue;
				}

				const duration = Date.now() - startTime;
				useAppMetaStore.getState().incrementAPIUsage(provider, false, 0, 0, duration);
				const friendly = ERROR_MESSAGES[provider]?.[resp.status];
				const detail = extractDetailError(text);

				const parts: string[] = [];
				if (friendly) parts.push(friendly);
				if (detail && detail !== friendly) parts.push(detail);
				if (parts.length === 0) parts.push(`AI 请求失败 (${resp.status})`);

				throw new Error(parts.join(" — "));
			}

			const data: ChatCompletionResponse = await resp.json();
			logger.response(url, resp.status, data, Date.now());

			const responsePromptTokens = data.usage?.prompt_tokens ?? 0;
			const completionTokens = data.usage?.completion_tokens ?? 0;
			const duration = Date.now() - startTime;
			useAppMetaStore.getState().incrementAPIUsage(provider, true, responsePromptTokens, completionTokens, duration);

			const content = data.choices?.[0]?.message?.content ?? "";
			if (
				provider === "mimo" &&
				content.includes(
					"The request was rejected because it was considered high risk",
				)
			) {
				throw new Error("MiMo 内容审核拦截，避免输入不安全或敏感内容 — 421");
			}

			return content;
		} catch (err) {
			// 取消请求：直接抛出，不重试
			if (err instanceof DOMException && err.name === "AbortError") {
				throw err;
			}
			if (attempt === MAX_RETRIES - 1) {
				const duration = Date.now() - startTime;
				useAppMetaStore.getState().incrementAPIUsage(provider, false, 0, 0, duration);
				throw err;
			}
			logger.warn(`AI 请求异常，准备重试 (attempt ${attempt + 1}/${MAX_RETRIES})`, { error: err });
			await waitForRetry(attempt, signal);
		}
	}

	const duration = Date.now() - startTime;
	useAppMetaStore.getState().incrementAPIUsage(provider, false, 0, 0, duration);
	throw new Error("AI 请求失败");
}

/**
 * 尝试修复被截断的 JSON 字符串
 * 当 AI 响应因 max_tokens 不足而被截断时，尝试补全未闭合的括号/引号
 */
export function repairTruncatedJson(jsonStr: string): string | null {
	try {
		JSON.parse(jsonStr);
		return jsonStr; // 本身是合法 JSON，无需修复
	} catch {
		// 继续尝试修复
	}

	let repaired = jsonStr.trimEnd();

	// 如果末尾有未闭合的字符串，截断到最后一个完整的值
	const lastQuote = repaired.lastIndexOf('"');
	if (lastQuote >= 0) {
		let backslashCount = 0;
		let idx = lastQuote - 1;
		while (idx >= 0 && repaired[idx] === '\\') {
			backslashCount++;
			idx--;
		}
		if (backslashCount % 2 === 0) {
			const afterLastQuote = repaired.slice(lastQuote + 1);
			if (!afterLastQuote.includes('"')) {
				const lastCompleteValue = Math.max(
					repaired.lastIndexOf('",'),
					repaired.lastIndexOf('"}'),
					repaired.lastIndexOf('"]'),
				);
				if (lastCompleteValue > lastQuote) {
					repaired = repaired.slice(0, lastCompleteValue + 1);
				}
			}
		}
	}

	// 统计需要补全的括号/花括号
	const stack: string[] = [];
	let inString = false;
	let escapeNext = false;

	for (let i = 0; i < repaired.length; i++) {
		const ch = repaired[i];
		if (escapeNext) { escapeNext = false; continue; }
		if (ch === '\\' && inString) { escapeNext = true; continue; }
		if (ch === '"') { inString = !inString; continue; }
		if (inString) continue;
		if (ch === '{' || ch === '[') {
			stack.push(ch === '{' ? '}' : ']');
		} else if (ch === '}' || ch === ']') {
			if (stack.length > 0 && stack[stack.length - 1] === ch) {
				stack.pop();
			}
		}
	}

	if (inString) repaired += '"';
	repaired = repaired.replace(/,(\s*)$/, '$1');
	while (stack.length > 0) repaired += stack.pop();

	try {
		JSON.parse(repaired);
		return repaired;
	} catch {
		return null;
	}
}

/**
 * 从截断的 JSON 响应中提取已完整输出的角色/关系对象
 * 当整体 JSON 解析失败时，逐个提取 "characters" 数组中完整的 {...} 对象
 */
function extractPartialAnalysisResult(response: string): Partial<CharacterAnalysisResult> | null {
	const characters: CharacterAnalysisResult["characters"] = [];
	const relationships: CharacterAnalysisResult["relationships"] = [];

	// 尝试从 "characters": [...] 区域提取单个完整对象
	const charSection = extractArrayObjects(response, "characters");
	characters.push(...charSection as CharacterAnalysisResult["characters"]);

	// 尝试从 "relationships": [...] 区域提取单个完整对象
	const relSection = extractArrayObjects(response, "relationships");
	for (const obj of relSection) {
		if (obj.sourceName || obj.targetName) {
			relationships.push(obj as CharacterAnalysisResult["relationships"][0]);
		}
	}

	// 尝试提取 worldbuilding
	let worldbuilding: CharacterAnalysisResult["worldbuilding"] | undefined;
	const wbMatch = response.match(/"worldbuilding"\s*:\s*(\{[\s\S]*?\})\s*[,}]/);
	if (wbMatch) {
		try {
			worldbuilding = JSON.parse(wbMatch[1]);
		} catch {
			// worldbuilding 可能也被截断，忽略
		}
	}

	if (characters.length === 0 && relationships.length === 0) return null;
	return { characters, relationships, worldbuilding };
}

/**
 * 从 JSON 字符串中提取指定数组字段里所有完整的对象
 * 使用花括号深度追踪，即使外层结构被截断也能提取
 */
function extractArrayObjects(jsonStr: string, arrayFieldName: string): Record<string, unknown>[] {
	const results: Record<string, unknown>[] = [];

	// 定位数组开始位置
	const arrayStartPattern = new RegExp(`"${arrayFieldName}"\\s*:\\s*\\[`);
	const arrayStartMatch = jsonStr.match(arrayStartPattern);
	if (!arrayStartMatch || arrayStartMatch.index === undefined) return results;

	const startIdx = arrayStartMatch.index + arrayStartMatch[0].length;
	let depth = 1; // 已经进入 [
	let objStart = -1;
	let objDepth = 0;
	let inString = false;
	let escapeNext = false;

	for (let i = startIdx; i < jsonStr.length; i++) {
		const ch = jsonStr[i];

		if (escapeNext) { escapeNext = false; continue; }
		if (ch === '\\' && inString) { escapeNext = true; continue; }
		if (ch === '"') { inString = !inString; continue; }
		if (inString) continue;

		if (ch === '{') {
			if (depth === 1) {
				objStart = i;
				objDepth = 0;
			}
			objDepth++;
		} else if (ch === '}') {
			objDepth--;
			if (depth === 1 && objStart >= 0 && objDepth === 0) {
				// 提取到一个完整的顶层对象
				const objStr = jsonStr.slice(objStart, i + 1);
				try {
					const obj = JSON.parse(objStr);
					if (obj && typeof obj === 'object') {
						results.push(obj);
					}
				} catch {
					// 单个对象解析失败，跳过
				}
				objStart = -1;
			}
		} else if (ch === '[') {
			depth++;
		} else if (ch === ']') {
			depth--;
			if (depth <= 0) break; // 数组结束
		}
	}

	return results;
}

/**
 * 解析角色分析的 AI 响应，支持完整 JSON、修复截断 JSON、提取部分结果三种策略
 */
function parseCharacterAnalysisResponse(response: string): Partial<CharacterAnalysisResult> | null {
	// 策略 1：直接解析完整 JSON
	const jsonMatch = response.match(/\{[\s\S]*\}/);
	if (jsonMatch) {
		try {
			return JSON.parse(jsonMatch[0]) as Partial<CharacterAnalysisResult>;
		} catch {
			// 策略 2：尝试修复截断后解析
			const repaired = repairTruncatedJson(jsonMatch[0]);
			if (repaired) {
				try {
					return JSON.parse(repaired) as Partial<CharacterAnalysisResult>;
				} catch {
					// 修复后仍然失败
				}
			}
		}
	}

	// 策略 3：从截断的响应中逐个提取已完成的角色/关系对象
	return extractPartialAnalysisResult(response);
}

/**
 * 按段落边界切片文本
 * 优先在双换行（段落分隔）处断开，避免截断句子
 * 如果单个段落超过 maxSize，则在单换行处断开
 */
function splitByParagraphs(text: string, maxSize: number): string[] {
	const chunks: string[] = [];
	let remaining = text;

	while (remaining.length > 0) {
		if (remaining.length <= maxSize) {
			chunks.push(remaining);
			break;
		}

		// 在 maxSize 范围内找最后一个段落分隔（双换行）
		let cutIdx = -1;
		const searchRegion = remaining.slice(0, maxSize);
		const doubleNewlineIdx = searchRegion.lastIndexOf('\n\n');
		if (doubleNewlineIdx > maxSize * 0.3) {
			cutIdx = doubleNewlineIdx + 2; // 包含分隔符
		}

		// 如果没找到合适的段落分隔，尝试在单换行处断开
		if (cutIdx <= 0) {
			const singleNewlineIdx = searchRegion.lastIndexOf('\n');
			if (singleNewlineIdx > maxSize * 0.3) {
				cutIdx = singleNewlineIdx + 1;
			}
		}

		// 如果还是找不到，硬切
		if (cutIdx <= 0) {
			cutIdx = maxSize;
		}

		chunks.push(remaining.slice(0, cutIdx));
		remaining = remaining.slice(cutIdx);
	}

	return chunks;
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

/** 账户余额信息（DeepSeek 官方接口返回结构） */
export interface BalanceInfo {
	currency: string;
	total_balance: string;
	granted_balance: string;
	topped_up_balance: string;
}

export interface AccountBalance {
	is_available: boolean;
	balance_infos: BalanceInfo[];
}

/**
 * 查询 DeepSeek 账户余额
 * 官方接口：GET {baseURL 根}/user/balance（不带 /v1 路径）
 * 参考：https://api-docs.deepseek.com/zh-cn/api/get-user-balance
 */
export async function fetchAccountBalance(
	config: Pick<AIConfig, "baseURL" | "apiKey">,
	signal?: AbortSignal,
): Promise<AccountBalance> {
	if (!config.apiKey) {
		throw new Error("请先配置 API Key");
	}
	// baseURL 可能是 https://api.deepseek.com 或 https://api.deepseek.com/v1，
	// 余额接口固定在根路径 /user/balance，需去掉尾部 /v1（及可能的尾部斜杠）
	const base = config.baseURL.replace(/\/+$/, "").replace(/\/v\d+$/i, "");
	const url = `${base}/user/balance`;

	const resp = await fetch(url, {
		method: "GET",
		headers: {
			"Accept": "application/json",
			"Authorization": `Bearer ${config.apiKey}`,
		},
		signal,
	});

	if (!resp.ok) {
		const text = await resp.text().catch(() => "");
		const detail = extractDetailError(text);
		throw new Error(detail || `余额查询失败 (${resp.status})`);
	}

	const data = (await resp.json()) as Partial<AccountBalance>;
	if (!data || typeof data.is_available !== "boolean") {
		throw new Error("余额接口返回格式不正确");
	}
	return {
		is_available: data.is_available,
		balance_infos: Array.isArray(data.balance_infos) ? data.balance_infos : [],
	};
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
约束：find精确复制且唯一；同行的find不重叠；无法定位则跳过；无错返回[]；变体字检测优先级高于普通错别字。

${ANOMALY_PROMPT_TEXT}`;
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

示例输入{"0":"第一章","1":"倾盘大雨。"} → [{"lineNumber":"1","column":5,"find":"倾盘大雨。","replace":"倾盆大雨。","type":"typo","reason":"错别字"}]。的/地/得错误：find含错误及前后各≥2字符。优先级：变体字>错别字>语法>排版>标点。不修改风格化/口语化表达。

${ANOMALY_PROMPT_TEXT}`;
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

/** 双段落校对系统 prompt（同时检查两段并给出合并建议） */
export const PROOFREAD_SYSTEM_PROMPT_DUAL = `你是小说文字编辑。系统会给你两个连续段落（第1段和第2段）。

## 首要任务：逐段校对错误
分别检查两个段落中的文字错误。错误检测是首要任务，必须确保每个段落的错误都被完整检测出来。

上下文完整性要求（避免误判的关键）：
1. 如错误靠近句末，find必须包含句末标点（句号、问号、感叹号、逗号等）
2. find应包含完整的语义单元（完整词语、完整句子片段），不要截断词语
3. 上下文完整性优先于字数限制，宁可超出字数也要保证完整
4. 如错误涉及句子结构，应包含足够上下文以判断是否真正错误
5. 禁止为满足字数限制而删除必要的标点或截断词语

变体字精校规则：
1. 识别康熙字典中的生僻异体字、旧字形、俗字、讹字
2. 识别Unicode扩展区中的生僻字（U+2F00-U+2FFF康熙部首区、U+3400-U+4DBF扩展A区等）
3. 将变体字修正为现代通用标准汉字
4. 常见变体字示例：丼→井、氼→溺、仌→冰、羣→群、刄→刃、巛→川、鉨→镍

## 附加任务：评估段落分割
在校对完成后，评估两个段落的分割是否合理：
- 段落过短（少于10字），不是对话且语义连贯 → 建议合并
- 段落被强行截断（如一句话被拆成两段） → 建议合并
- 两段属于同一语义单元（如连续对话、同一描写） → 建议合并
- 段落长度均衡且语义独立 → 保持分割

输出JSON格式（严格遵守，只输出JSON对象，不要markdown）：
{
  "errors": [
    {
      "line": 1,
      "find": "原文连续片段，含错误及前后至少3字符，10-40字",
      "replace": "修正后片段",
      "type": "typo|format|punctuation|grammar|variant",
      "reason": "≤10汉字"
    }
  ],
  "merge_suggestion": {
    "should_merge": true/false,
    "reason": "合并或不合并的原因，≤30字"
  }
}

注意：
- errors中的line字段：1表示该错误属于第1段，2表示该错误属于第2段
- 即使某段无错误，另一段的错误也必须完整返回
- 类型说明：typo=错别字, format=排版空格空行, punctuation=标点致命错误, grammar=病句, variant=康熙变体字
- 约束：find精确复制且唯一；同段的find不重叠；无法定位则跳过；两段均无错时errors返回[]；变体字检测优先级高于普通错别字
- 无错时merge_suggestion也要返回（should_merge=false，reason说明原因）

${ANOMALY_PROMPT_TEXT}`;

/** 构建双段落校对 user prompt */
export function buildDualParagraphUserPrompt(
	paragraph1: string,
	paragraph2: string,
	ignoredWords?: string[],
): string {
	const normalized1 = normalizeCJKVariants(paragraph1);
	const normalized2 = normalizeCJKVariants(paragraph2);

	let prompt = `请检查以下两个连续段落，并评估段落分割是否合理：\n\n【第1段】\n${normalized1}\n\n【第2段】\n${normalized2}`;

	if (ignoredWords && ignoredWords.length > 0) {
		prompt += `\n\n【强制约束】以下词语在本文中出现时，绝对不能标记为错误（这些是人名、地名、专有名词或特殊术语），即使它们看起来像错别字：\n${ignoredWords.join("、")}\n\n请直接跳过这些词语，不要在返回结果中包含它们。`;
	}

	return prompt;
}

/** 剧本转换系统 prompt */
export const SCRIPT_SYSTEM_PROMPT = `你是剧本改编编剧。将小说章节转为中文影视拍摄剧本格式。输出纯JSON，无markdown，不要任何开场白。

## 核心约束：绝对禁止篡改原文
- text 字段必须包含原文的完整内容，只允许在开头添加标签
- 禁止修改、增删、替换原文中的任何词语、标点或字符

## 输出JSON格式（必须严格遵守）
{
  "scenes": [
    {
      "title": "场景标题",
      "time": {
        "period": "标准化时段",
        "detail": "可选，环境描写（≤12字）"
      },
      "location": {
        "scope": "内景/外景/内外",
        "name": "具体地点"
      },
      "atmosphere": {
        "tag": "核心氛围词（≤4字）",
        "intensity": "弱/中/强"
      },
      "blocks": [
        {"type":"action","text":"动作描述"},
        {"type":"dialogue","character":"角色名","emotion":"情绪","tone":"语调","text":"对话内容"},
        {"type":"narration","text":"内心独白或旁白"},
        {"type":"transition","text":"转场类型"}
      ]
    }
  ],
  "characters": ["角色1","角色2"]
}

## 字段说明
- type: 只能是 "scene-header" | "action" | "dialogue" | "narration" | "transition"
- title: 场景标题，必须是能概括该场景核心内容的有意义标题（4-12字），如"雨夜重逢"、"密室审讯"，禁止使用"场景 1"、"场景 2"等无意义序号
- character: 角色名必须与提供的角色列表完全一致
- emotion: 情绪标签，从以下选择：怅然/慵懒/开心/悲伤/愤怒/恐惧/惊讶/兴奋/委屈/平静/冷漠/欣慰/无奈/愧疚/释然/嫉妒/厌倦/忐忑/动情
- tone: 语调标签，从以下选择：温柔/高冷/活泼/严肃/俏皮/深沉/干练/凌厉
- text: 动作描述或对话内容，对话必须是角色说的话，口语化，加停顿和语气词
- 引号规范：所有对话、对白、自白内容必须用单引号包裹，如 '你好吗？'，禁止使用双引号或中文引号
- 转义字符：禁止使用任何转义字符（如 \\、"、\\\\），所有内容直接书写，不需要转义

## time / location / atmosphere 标准化规范
### time.period（必填，仅限以下值）
清晨 | 上午 | 正午 | 下午 | 黄昏 | 傍晚 | 夜间 | 深夜 | 凌晨
### time.detail（可选）
自然光线或环境细节描写，如"阳光透过窗帘"、"月色暗淡"，不超过12字
### location.scope（必填）
内景 — 室内封闭空间
外景 — 室外开放空间
内外 — 室内外切换或过渡
### location.name（必填）
具体地点名称，如"废弃工厂车间"、"医院走廊"
### atmosphere.tag（必填，≤4字）
核心氛围词，如：压抑/紧张/温暖/阴冷/欢快/肃穆/浪漫/诡异/宁静/喧嚣
### atmosphere.intensity（必填）
弱 — 氛围淡雅、轻微
中 — 氛围明显
强 — 氛围浓烈、极致

## 核心规则（优先级从高到低）
1. **角色一致性**：剧本中出现的角色名必须与提供的角色列表完全一致，包括别名
2. **引号内容默认判定为台词**：原文中被引号包裹的内容（无论单双引号、中文引号）默认视为角色对话，应转为dialogue类型；是否为拟声词、旁白等由你根据上下文判断决定
3. **无法判断角色时使用NPC**：如果无法确定说话者是谁，使用"NPC"作为角色名；如果是路人、群众等，使用"路人甲"、"路人乙"、"群众"等通用名称
4. **对话必须有情感标注**：每个dialogue必须包含emotion和tone字段
5. **对话/动作严格分离**：角色说的话用dialogue类型，环境描写用action类型
6. **必须输出合法JSON**：确保JSON格式正确，所有字符串用双引号，字段名正确
7. **保留核心情节**：保留关键对话、转折点、情感冲突
8. **叙述转动作**：把叙述性文字转化为可视觉化的动作描述
9. **对话口语化**：加停顿、语气词，去掉书面化表达
10. **环境精简**：只保留推动情绪/情节的环境描写
11. **心理描写优先转微表情/小动作**，其次对话暗示，最后narration
12. **删除作者评论**：如"由此可见"、"值得一提的是"等

## 绝对禁止（违反任何一条视为输出失败）
- ❌ 禁止输出JSON以外的任何内容
- ❌ 禁止添加原文没有的角色、情节、对话
- ❌ 禁止dialogue没有emotion或tone字段
- ❌ 禁止使用除上述类型以外的其他type值
- ❌ 禁止使用markdown格式（如**加粗**、*斜体*等）
- ❌ 禁止输出解释性文字、开场白、结束语
- ❌ 禁止time.period使用枚举值以外的值
- ❌ 禁止atmosphere.tag超过4个字
- ❌ 禁止atmosphere.intensity使用非"弱/中/强"的值
- ❌ 禁止location.scope使用非"内景/外景/内外"的值
- ❌ 禁止对话内容使用双引号或中文引号，必须用单引号包裹
- ❌ 禁止使用任何转义字符（如 \\、"、\\\\），内容直接书写即可

## 正确示例
{"scenes":[{"title":"雨夜守候","time":{"period":"夜间","detail":"月色暗淡"},"location":{"scope":"外景","name":"废弃工厂"},"atmosphere":{"tag":"压抑","intensity":"强"},"blocks":[{"type":"action","text":"雨水漏过屋顶，滴在铁皮上。张强站在暗处，手指微微颤抖。"},{"type":"dialogue","character":"张强","emotion":"坚定","tone":"深沉","text":"'她今晚一定会来。'"},{"type":"action","text":"他将照片贴在胸口，眼神坚定。"},{"type":"dialogue","character":"张强","emotion":"决绝","tone":"凌厉","text":"'无论付出什么代价。'"}]},{"title":"推门而入","time":{"period":"夜","detail":"雨势渐小"},"location":{"scope":"外景","name":"工厂门口"},"atmosphere":{"tag":"紧张","intensity":"中"},"blocks":[{"type":"action","text":"林晓撑着黑伞，雨水顺伞流下。她深吸一口气，推门而入。"},{"type":"dialogue","character":"林晓","emotion":"紧张","tone":"温柔","text":"'有人吗？'"},{"type":"action","text":"回声在空旷的厂房里回荡。"}]}],"characters":["张强","林晓"]}`;

/** 剧本转换 user prompt */
export function buildScriptUserPrompt(
	text: string,
	characters?: Array<{ name: string; aliases?: string[]; role?: string; gender?: string; voice?: string; voiceDesignPrompt?: string; dialect?: string }>,
): string {
	let characterSection = '';
	if (characters && characters.length > 0) {
		const roleLabels: Record<string, string> = {
			protagonist: '男主', heroine: '女主', antagonist: '反派',
			supportingMale: '男配', supportingFemale: '女配', narrator: '旁白',
			mentor: '导师', rival: '对手', loveInterest: '爱慕对象',
			family: '家人', friend: '朋友', npc: 'NPC',
		};
		const lines = characters.map((c) => {
			const aliasStr = c.aliases?.length ? '(也可称：' + c.aliases.join('、') + ')' : '';
			const roleStr = c.role ? '[' + (roleLabels[c.role] || c.role) + ']' : '';
			const voiceStr = c.voice ? ' 音色:' + c.voice : '';
			const dialectStr = c.dialect ? ' 方言:' + c.dialect : '';
			const designStr = c.voiceDesignPrompt ? ' 音色设计:"' + c.voiceDesignPrompt.slice(0, 80) + (c.voiceDesignPrompt.length > 80 ? '...' : '') + '"' : '';
			return '- ' + c.name + aliasStr + roleStr + voiceStr + dialectStr + designStr;
		});
		characterSection = '\n\n## 角色信息（剧本中的角色名必须与以下设定完全一致）\n' + lines.join('\n') + '\n\n请根据角色的音色设计和方言信息，为对话添加合适的情感标签和语调。';
	}
	return '请将以下小说章节转换为剧本格式：' + characterSection + '\n\n' + text;
}

/** 剧本TTS情感增强系统提示词 */
export const SCRIPT_TTS_ENHANCE_SYSTEM_PROMPT = `你是有声书演播导演。为剧本对话添加情感/音色/方言标注(TTS)。输出纯文本，保留原剧本格式。

## 核心原则：贴近生活、自然真实
- 情感表达要像真人在日常生活里说话，克制内敛，不要舞台腔、播音腔
- 避免过度戏剧化：日常对话不用"动情""凌厉"等强标签，优先用"平静""无奈""温柔"
- 情绪强度与原文语境匹配：小事不放大，大事不缩水
- 优先选择克制、含蓄的情绪（如"平静""无奈""温柔""慵懒"），慎用激烈情绪

## 标注格式（含语速建议）
角色名：(标签|语速)对话内容
- 圆括号内：标签与语速之间用竖线 | 分隔，如 (平静|5) 或 (愤怒|7)
- 语速取值 1-10：5=日常对话自然语速，3=舒缓叙述，7=激动急切，1=极慢，10=极快
- 标签为情绪/语调/音色/方言/唱歌之一
- 标签后紧接 |语速，然后 )，再加对话内容
- 旁白/叙述用"我："格式
- 仅输出标注后文本，无解释

## 可用标签
情绪：怅然/慵懒/开心/悲伤/愤怒/恐惧/惊讶/兴奋/委屈/平静/冷漠
复合：欣慰/无奈/愧疚/释然/嫉妒/厌倦/忐忑/动情
语调：温柔/高冷/活泼/严肃/俏皮/深沉/干练/凌厉
音色：磁性/醇厚/清亮/空灵/稚嫩/苍老/甜美/沙哑
方言：东北话/四川话/河南话/粤语/台湾腔/陕西话/吴语/湘语/赣语/客家话/闽语
特殊：(唱歌)放在歌词前；[叹气][笑][颤抖]等音频标签可放在句中

## 标签与语速选择指南（贴近生活）
- 日常寒暄、闲聊：平静/温柔/活泼 + 语速5（不要用动情/凌厉）
- 轻微情绪波动：无奈/慵懒/欣慰 + 语速4-5（不要用愤怒/恐惧）
- 真正激动时才用：愤怒/恐惧/兴奋/动情 + 语速7-8
- 抒情/回忆/沉思：怅然/释然 + 语速3-4
- 旁白叙述：默认"平静" + 语速5，仅在大起大落处换标签
- 避免：连续多句都用强情绪标签或极端语速，生活里人不会一直激动

## 格式示例（严格遵循）
张强：(怅然|4)这么多年过去了，再走过那条街，心里一下子空了一块。
王芳：(慵懒|4)再让我睡五分钟……就五分钟，真的，最后一次。
我：(磁性|5)夜已经深了，城市还在呼吸。我是今晚陪你的人，欢迎收听《午夜电台》。
李大爷：(东北话|6)哎呀妈呀，这天儿也忒冷了吧！你说这风，嗖嗖的，跟刀子似的，割脸啊！
阿明：(粤语|6)呢个真係好正啊！食过一次就唔会忘记！
李明：(唱歌|6)原谅我这一生不羁放纵爱自由，也会怕有一天会跌倒，Oh no。

## 规则
- 场景/转场保持原样，不添加标签和语速
- 旁白朗读的动作描述需添加情感标签和语速（如平静|5等）
- 保留原文所有内容，绝不删改
- 每个角色说话只加一个标签，不要叠加多个标签
- 唱歌必须加(唱歌|语速)，方言必须加对应方言标签如(东北话|5)
- 语速必须与情绪匹配：平静=5，激动=7-8，抒情=3-4
`;

/** 构建TTS情感增强的user prompt */
export function buildScriptTTSEnhanceUserPrompt(scriptContent: string, configuredCharacters?: Array<{ name: string; role?: string; dialect?: string; aliases?: string[]; relationTerms?: string[] }>): string {
        // 检查是否有旁白角色
        const narratorChar = configuredCharacters?.find(c =>
                c.role === 'narrator' ||
                c.aliases?.some(a => a.includes('旁白')) ||
                c.relationTerms?.some(r => r.includes('旁白'))
        );
        const narratorInstruction = narratorChar 
                ? `\n重要-旁白角色：剧本中的动作描述/场景描写由旁白"${narratorChar.name}"朗读，统一使用"${narratorChar.name}："格式，并为其添加合适的情感标签（如平静、怅然、紧张等）。` 
                : '\n重要：旁白或叙述性文字用"我："格式朗读。';
        
        // 构建方言提示
        const dialectChars = configuredCharacters?.filter(c => c.dialect) || [];
        const dialectInstruction = dialectChars.length > 0
                ? `\n\n重要-角色方言指定：以下角色必须使用指定方言标签：\n${dialectChars.map(c => `- ${c.name}：方言标签为(${c.dialect})，该角色所有对话必须加上(${c.dialect})标签`).join('\n')}\n`
                : '';

        return `为以下剧本对话添加情感/音色标注(TTS)。规则：所有行(含旁白)标注角色名。格式：角色名：(标签|语速)内容，语速1-10（5=日常对话，3=舒缓，7=激动）。场景/转场保持原样。唱歌加(唱歌|语速)。纯文本输出，无markdown。情感要贴近生活、自然真实，克制内敛，避免舞台腔/过度戏剧化；日常对话优先用"平静/温柔/无奈"等克制标签+语速5，真正激动时才用"愤怒/恐惧/动情"+语速7-8。${narratorInstruction}${dialectInstruction}
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

## 核心原则：贴近生活、自然真实
- 情感表达要像真人在日常生活里说话，克制内敛，不要舞台腔、播音腔
- 避免过度戏剧化：日常对话不用"动情""凌厉"等强标签，优先用"平静""无奈""温柔"
- 情绪强度与原文语境匹配：小事不放大，大事不缩水
- 优先选择克制、含蓄的情绪（如"平静""无奈""温柔""慵懒"），慎用激烈情绪
- 旁白/叙述段：默认"平静"，仅在大起大落、明显情绪描写时才换标签

## 标注格式（含语速建议）
(标签|语速)文本内容

- 圆括号内：标签与语速之间用竖线 | 分隔，如 (平静|5) 或 (愤怒|7)
- 语速取值 1-10：5=日常对话自然语速，3=舒缓叙述，7=激动急切，1=极慢，10=极快
- 标签为情绪/语调/音色/方言/唱歌之一
- 标签后紧接 |语速，然后 )，再加文本内容
- 保持原文完整不变，仅在最前面加标签和语速
- 仅输出标注后文本，无任何解释

## 可用标签
情绪：怅然/慵懒/开心/悲伤/愤怒/恐惧/惊讶/兴奋/委屈/平静/冷漠
复合：欣慰/无奈/愧疚/释然/嫉妒/厌倦/忐忑/动情
语调：温柔/高冷/活泼/严肃/俏皮/深沉/干练/凌厉
音色：磁性/醇厚/清亮/空灵/稚嫩/苍老/甜美/沙哑
方言：东北话/四川话/河南话/粤语/台湾腔/陕西话/吴语/湘语/赣语/客家话/闽语
特殊：(唱歌)放在歌词前；[叹气][笑][颤抖]等音频标签可放在句中

## 标签与语速选择指南（贴近生活）
- 日常寒暄、闲聊：平静/温柔/活泼 + 语速5（不要用动情/凌厉）
- 轻微情绪波动：无奈/慵懒/欣慰 + 语速4-5（不要用愤怒/恐惧）
- 真正激动时才用：愤怒/恐惧/兴奋/动情 + 语速7-8
- 抒情/回忆/沉思：怅然/释然 + 语速3-4
- 旁白叙述：默认"平静" + 语速5，仅在大起大落处换标签
- 避免：连续多段都用强情绪标签或极端语速，生活里人不会一直激动

## 格式示例（严格遵循）
(怅然|4)这么多年过去了，再走过那条街，心里一下子空了一块。
(慵懒|4)再让我睡五分钟……就五分钟，真的，最后一次。
(磁性|5)夜已经深了，城市还在呼吸。我是今晚陪你的人，欢迎收听《午夜电台》。
(东北话|6)哎呀妈呀，这天儿也忒冷了吧！你说这风，嗖嗖的，跟刀子似的，割脸啊！
(粤语|6)呢个真係好正啊！食过一次就唔会忘记！
(唱歌|6)原谅我这一生不羁放纵爱自由，也会怕有一天会跌倒，Oh no。背弃了理想，谁人都可以，哪会怕有一天只你共我。

## 规则
- 【绝对禁止】不得修改、增删、替换、润色原文中的任何文字、标点或字符
- 每个段落/对话最开头加一个标签和语速，不要多个标签叠加
- 保留原文所有内容和标点，绝不删改原文
- 唱歌内容前面必须加(唱歌|语速)，不要加其他标签
- 方言内容必须加对应方言标签如(东北话|5)，不要加其他标签
- 语速必须与情绪匹配：平静=5，激动=7-8，抒情=3-4
`;

/** 构建小说章节TTS情感增强的user prompt */
export function buildNovelTTSEnhanceUserPrompt(chapterContent: string, configuredCharacters?: Array<{ name: string; dialect?: string }>): string {
        const dialectChars = configuredCharacters?.filter(c => c.dialect) || [];
        const dialectInstruction = dialectChars.length > 0
                ? `\n\n重要-角色方言指定：以下角色出现时，其对话必须加上对应方言标签：\n${dialectChars.map(c => `- ${c.name}：使用(${c.dialect})`).join('\n')}\n请根据角色名识别对话归属，为对应角色的对话添加正确的方言标签。`
                : '';
        
        return `为以下小说章节添加情感/音色标注(TTS)。规则：每段加合适标签和语速，格式(标签|语速)，语速1-10（5=日常对话，3=舒缓，7=激动）。对话丰富，叙述平稳，唱歌加(唱歌|语速)。纯文本输出，保留原文结构与内容。情感要贴近生活、自然真实，克制内敛，避免舞台腔/过度戏剧化；日常对话优先用"平静/温柔/无奈"等克制标签+语速5，真正激动时才用"愤怒/恐惧/动情"+语速7-8；旁白默认"平静"+语速5，仅在大起大落处换标签。${dialectInstruction}\n\n${chapterContent}`;
}

// ============================================================
// 阅读模式逐段TTS情感增强Prompt
// ============================================================

/** 阅读模式逐段TTS情感增强系统提示词 */
export const READING_MODE_TTS_ENHANCE_SYSTEM_PROMPT = `你是小说有声书演播导演。分析段落：识别人物、判断情绪、输出TTS标注JSON。

## 核心原则：贴近生活、自然真实
- 情感表达要像真人在日常生活里说话，克制内敛，不要舞台腔、播音腔
- 避免过度戏剧化：日常对话不用"动情""凌厉"等强标签，优先用"平静""无奈""温柔"
- 情绪强度与原文语境匹配：小事不放大，大事不缩水
- 优先选择克制、含蓄的情绪（如"平静""无奈""温柔""慵懒"），慎用激烈情绪
- 旁白/叙述段：默认"平静"，仅在大起大落、明显情绪描写时才换标签

## 核心约束：绝对禁止篡改原文
- text 字段必须包含「当前段落」的完整原文，只允许在开头添加 (标签) 或句中插入 [音频标签]
- 禁止修改、增删、替换、润色原文中的任何词语、标点或字符
- 禁止将原文中角色说的话改写为旁白，或旁白改写为对话
- 禁止把「当前段落」中不含的人名、名词写入 text

## 输出格式
情绪/语调(选其一)：开心/悲伤/愤怒/恐惧/惊讶/兴奋/委屈/平静/冷漠/怅然/欣慰/无奈/愧疚/释然/嫉妒/厌倦/忐忑/动情/温柔/高冷/活泼/严肃/慵懒/俏皮/深沉/干练/凌厉。
方言(如需)：东北话/四川话/河南话/粤语/台湾腔/陕西话/吴语/湘语/赣语/客家话/闽语
特殊标记：(唱歌)放在歌词前；[音频标签]如[叹气][笑][颤抖]插在句中。

## 语速建议（speed 字段，1-10 整数）
- 5=日常对话自然语速（默认值）
- 3-4=舒缓叙述、抒情、回忆、沉思
- 6-7=激动、急切、兴奋、惊讶
- 8-10=极度激动、紧急、恐惧（慎用）
- 1-2=极慢（仅用于特殊场景，如濒死、深情告白）
- 语速必须与情绪匹配：平静=5，激动=7-8，抒情=3-4
- 避免极端值（1/10），保持自然流畅

## 情绪与语速选择指南（贴近生活）
- 日常寒暄、闲聊：平静/温柔/活泼 + speed=5（不要用动情/凌厉）
- 轻微情绪波动：无奈/慵懒/欣慰 + speed=4-5（不要用愤怒/恐惧）
- 真正激动时才用：愤怒/恐惧/兴奋/动情 + speed=7-8
- 抒情/回忆/沉思：怅然/释然 + speed=3-4
- 旁白叙述：默认"平静" + speed=5，仅在大起大落处换标签
- 避免：连续多段都用强情绪标签或极端语速，生活里人不会一直激动

输出JSON：
{"characters":["人物名"],"segments":[{"type":"narration/dialogue","speaker":"旁白或角色名","emotion":"情绪","tone":"语调","speed":5,"text":"(方言,情绪,语调)标签化文本"}]}

## 方言规则（严格遵守）
- 当角色在"已配置角色"中标注了 <方言：XXX> 时，该角色的对话 text 必须以 (XXX,情绪,语调) 开头
- 例：角色有 <方言：粤语>，对话应写为 (粤语,开心,活泼)正文内容
- 普通话角色（无方言标注）直接用 (情绪,语调)，不加方言标签
- 旁白始终用普通话，不加方言标签

## 其他规则
- 旁白speaker="旁白"，对话用角色名
- 保持原文本顺序，只加标签；对话和叙述分开但必须按照原文顺序输出
- 默认情绪="平静"，语调="温柔"，speed=5
- 必须输出合法JSON

示例：
输入："李明叹了口气，说：'你好吗'"
输出：{"characters":["李明"],"segments":[{"type":"narration","speaker":"旁白","emotion":"怅然","tone":"深沉","speed":4,"text":"(怅然,深沉)李明[叹气]叹了口气，说："},{"type":"dialogue","speaker":"李明","emotion":"无奈","tone":"温柔","speed":5,"text":"(无奈,温柔)'你好吗'"}]}`;

/** 阅读模式逐段TTS情感增强User Prompt */
export function buildReadingModeTTSEnhanceUserPrompt(
        paragraphText: string,
        contextBefore: string,
        contextAfter: string,
        configuredCharacters: Array<{ name: string; aliases: string[]; voice?: string; role?: string; relationTerms?: string[]; dialect?: string }>,
        novelEvents?: Array<{ title: string; description: string; chapter: string; timeInfo: string }>
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
        
        // 构建小说大事记上下文
        const eventsContext = novelEvents && novelEvents.length > 0
                ? `\n\n【小说大事记-当前章节涉及的关键事件】\n以下事件发生在当前章节或与之紧密相关，是理解当前段落情感基调的重要背景：\n${novelEvents.map((evt, idx) => `${idx + 1}. [${evt.chapter}] ${evt.title}：${evt.description}`).join('\n')}\n\n请根据这些事件背景来判断当前段落的情感基调，例如：如果之前发生了悲剧事件，当前段落可能带有悲伤或压抑的情绪；如果之前发生了喜事，当前段落可能带有开心或轻松的情绪。`
                : '';
        
        return `分析段落，识别人物并判断情绪，为每个 segment 给出语速建议(speed 1-10)。情感要贴近生活、自然真实，克制内敛，避免舞台腔/过度戏剧化；日常对话优先用"平静/温柔/无奈"等克制标签+speed=5，真正激动时才用"愤怒/恐惧/动情"+speed=7-8；旁白默认"平静"+speed=5，仅在大起大落处换标签。

已配置角色：
${chars}${narratorInstruction}${dialectInstruction}${eventsContext}

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
6. 【关键】如果「当前段落」原文不含对话（没有引号/冒号引出的说话内容），全部归为 narration 类型，speaker 为旁白
7. 【贴近生活】情绪强度与原文语境匹配：小事不放大，大事不缩水；避免连续多段都用强情绪标签
8. 【语速建议】每个 segment 必须包含 speed 字段(1-10整数)：平静=5，激动=7-8，抒情=3-4，避免极端值1/10`;
}

/** 文本片段类型 */
export interface TextSegment {
	type: 'narration' | 'dialogue';
	speaker: string;
	emotion: string;
	tone: string;
	text: string;
	speed?: number;
}

/** 段落情感分析结果类型 */
export interface ParagraphEmotionResult {
	characters: string[];
	segments: TextSegment[];
}

/**
 * 从 AI 响应中提取 JSON 数组（容错处理）
 */
export function extractJSON(text: string): unknown {
	// 尝试直接解析
	try {
		const parsed = JSON.parse(text);
		if (Array.isArray(parsed)) return parsed;
		if (typeof parsed === 'object' && parsed !== null) return parsed;
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
			if (typeof parsed === 'object' && parsed !== null) return parsed;
		} catch {
			// 继续
		}
	}

	// 尝试提取 { ... } 对象（优先于数组，因为对象可能包含 errors 数组）
	const objectMatch = text.match(/\{[\s\S]*\}/);
	if (objectMatch) {
		try {
			const parsed = JSON.parse(objectMatch[0]);
			if (typeof parsed === 'object' && parsed !== null) return parsed;
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

/** 将 extractJSON 结果规范化为错误数组（兼容对象和数组两种格式） */
export function normalizeErrors(raw: unknown): unknown[] {
	if (Array.isArray(raw)) return raw;
	if (typeof raw === 'object' && raw !== null) {
		const obj = raw as Record<string, unknown>;
		if (Array.isArray(obj.errors)) return obj.errors;
	}
	return [];
}

// ============================================================
// AI续写小说
// ============================================================

/** 续写系统 prompt */
export const CONTINUATION_SYSTEM_PROMPT = `你是一位专业的小说续写作家。请根据已有信息，以相同的风格续写小说后续内容。

## 要求
- 严格遵循已有小说的世界观设定、人物性格和关系
- 保持与原文一致的文风、语气和叙事节奏
- 对话符合角色性格和身份
- 续写内容要有连贯性和逻辑性
- 输出{TARGET_WORD_COUNT}左右的连贯内容
- 只输出小说正文，不要添加解释、说明或章节标题
- 以段落形式输出，段落之间用换行分隔`;

/** 小说续写参数 */
export interface ContinuationParams {
	/** 最近1-3章的完整文本（用于风格和上下文参考） */
	recentChapters: Array<{ title: string; content: string }>;
	/** 上一章末尾的最后N段（直接衔接上下文） */
	lastParagraphs: string;
	/** 目标字数（基于小说现有章节最大字数动态计算） */
	targetWordCount: number;
	/** 角色信息列表 */
	characters: Array<{
		name: string;
		gender: string;
		role?: string;
		age?: string;
		identity?: string;
		socialStatus?: string;
		personality?: string;
		appearance?: string;
		background?: string;
		characterArc?: string;
		notes?: string;
		aliases?: string[];
		relationTerms?: string[];
		majorEvents?: string;
	}>;
	/** 角色关系 */
	relationships: Array<{
		sourceName: string;
		targetName: string;
		relationType?: string[];
		customRelationType?: string;
		sourceNickname: string[];
		targetNickname: string[];
	}>;
	/** 世界观设定 */
	worldbuilding: string;
}

/**
 * AI续写小说
 * @param params 续写参数
 * @param config AI配置
 * @param signal 取消信号
 * @returns 续写内容
 */
export async function generateContinuation(
	params: ContinuationParams,
	config: AIConfig,
	signal?: AbortSignal,
): Promise<string> {
	const chapterContext = params.recentChapters.map(ch =>
		`【${ch.title}】\n${ch.content.slice(-2000)}`
	).join("\n\n");

	const charsSummary = params.characters.map(c => {
		const parts = [`姓名: ${c.name}`, c.gender === "male" ? "男" : c.gender === "female" ? "女" : "其他"];
		if (c.role) parts.push(`角色类型: ${c.role}`);
		if (c.age) parts.push(`年龄: ${c.age}`);
		if (c.identity) parts.push(`身份: ${c.identity}`);
		if (c.socialStatus) parts.push(`地位: ${c.socialStatus}`);
		if (c.personality) parts.push(`性格: ${c.personality}`);
		if (c.appearance) parts.push(`外貌: ${c.appearance}`);
		if (c.background) parts.push(`出身: ${c.background}`);
		if (c.characterArc) parts.push(`角色弧光: ${c.characterArc}`);
		if (c.notes) parts.push(`备注: ${c.notes.slice(0, 200)}`);
		if (c.majorEvents) parts.push(`大事件: ${c.majorEvents.slice(0, 200)}`);
		if (c.aliases?.length) parts.push(`别称: ${c.aliases.join("、")}`);
		return parts.join("，");
	}).join("\n");

	const relsSummary = params.relationships.map(r => {
		const relTypes = (r.relationType || []).join("、");
		const customType = r.customRelationType ? `(${r.customRelationType})` : "";
		const sNick = r.sourceNickname.length > 0 ? `，${r.sourceName}称${r.targetName}为${r.sourceNickname.join("、")}` : "";
		const tNick = r.targetNickname.length > 0 ? `，${r.targetName}称${r.sourceName}为${r.targetNickname.join("、")}` : "";
		return `${r.sourceName} ↔ ${r.targetName}: ${relTypes}${customType}${sNick}${tNick}`;
	}).join("\n");

	const userPrompt = `## 章节上下文
${chapterContext}

## 当前需衔接的末尾段落
${params.lastParagraphs}

## 角色设定
${charsSummary || "暂无"}

## 角色关系
${relsSummary || "暂无"}

## 世界观设定
${params.worldbuilding || "暂无"}

请根据以上信息，续写接下来的剧情发展，保持风格一致。`;

	// 动态替换目标字数
	const systemPrompt = CONTINUATION_SYSTEM_PROMPT.replace("{TARGET_WORD_COUNT}", `每次续写输出${params.targetWordCount}字左右的连贯内容`);

	const messages: ChatMessage[] = [
		{ role: "system", content: systemPrompt },
		{ role: "user", content: userPrompt },
	];

	const response = await sendChatCompletion(messages, config, signal);

	return response.trim();
}

// ============================================================
// AI章节桥接（在章节之间生成衔接内容）
// ============================================================

/** 章节桥接系统 prompt */
export const BRIDGE_SYSTEM_PROMPT = `你是一位专业的小说衔接写作专家。你的任务是在小说的两章之间生成自然的过渡/衔接段落，使章节之间的转换更加流畅。

## 要求
- 严格基于上一章末尾内容和下一章开头内容，生成衔接过渡
- 保持与原文一致的文风、语气和叙事节奏
- 对话和描写符合角色性格和身份
- 衔接内容要自然流畅，不要让读者感觉到"拼接感"
- 输出50-200字左右的简洁衔接段落
- 只输出衔接正文，不要添加解释、说明或标题
- 如果上下两章内容连接紧密，可以在保持连贯性的同时补充一些过渡性描写`;

/** 章节桥接参数 */
export interface BridgeParams {
	/** 上一章标题 */
	prevTitle: string;
	/** 上一章末尾内容（最后5-10段） */
	prevEnding: string;
	/** 下一章标题 */
	nextTitle: string;
	/** 下一章开头内容（前3-5段） */
	nextBeginning: string;
	/** 角色信息摘要 */
	charactersSummary: string;
	/** 世界观设定 */
	worldbuilding: string;
}

/**
 * AI生成章节之间的衔接段落
 * @param params 桥接参数
 * @param config AI配置
 * @param signal 取消信号
 * @returns 衔接段落
 */
export async function generateChapterBridge(
	params: BridgeParams,
	config: AIConfig,
	signal?: AbortSignal,
): Promise<string> {
	const userPrompt = `## 上一章：${params.prevTitle}
末尾内容：
${params.prevEnding}

## 下一章：${params.nextTitle}
开头内容：
${params.nextBeginning}

## 角色信息
${params.charactersSummary || "暂无"}

## 世界观设定
${params.worldbuilding || "暂无"}

请根据以上信息，在上一章末尾和下一章开头之间生成自然的过渡衔接段落。`;

	const messages: ChatMessage[] = [
		{ role: "system", content: BRIDGE_SYSTEM_PROMPT },
		{ role: "user", content: userPrompt },
	];

	const response = await sendChatCompletion(messages, config, signal);

	return response.trim();
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
      "characterArc": "角色弧光描述（角色成长变化、内心转变、价值观演变等）",
      "description": "人物完整小传描述（整合以上信息，100-300字）",
      "appearances": ["首次出场章节或位置描述"],
      "voiceDesignPrompt": "音色设计描述（根据角色性别、年龄、性格、身份和地域背景设计，如：温柔甜美，年轻女性，温婉知性，使用东北话，江南口音，适合表达柔情、羞涩、关切等情感）",
      "majorEvents": "角色在全文中的关键经历和大事件总结（如：1. 在青云门拜师学艺，2. 参加天才大会夺冠，3. 发现身世之谜远走天涯。按时间顺序列出所有核心事件）"
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

/** 分段分析大文本并合并结果（两阶段分析）
 *
 * 第一阶段：逐批分析，收集所有角色的碎片化数据
 * 第二阶段：对每个角色（出现于多个批次中的）进行综合分析总结，
 *           生成更完整详实的角色档案。仅出现在单个批次中的角色直接使用原数据。
 */
export async function analyzeCharactersInBatches(
	fullText: string,
	config: AIConfig,
	batchSize: number = 30000,
	signal?: AbortSignal,
	onProgress?: (current: number, total: number, phase: "analyze" | "summarize") => void,
): Promise<CharacterAnalysisResult> {
	// 按段落切片：在段落边界（双换行）处断开，避免截断句子
	const chunks = splitByParagraphs(fullText, batchSize);

	const total = chunks.length;
	const allCharacters: CharacterAnalysisResult["characters"] = [];
	const allRelationships: CharacterAnalysisResult["relationships"] = [];
	let mergedWorldbuilding: CharacterAnalysisResult["worldbuilding"] | undefined;

	const userPromptTemplate = `请分析以下小说文本，提取角色和关系信息：

[TEXT_START]
{chunk}
[TEXT_END]

请以JSON格式输出角色和关系信息。`;

	// ==================== 第一阶段：逐批分析，收集所有角色碎片 ====================
	// key: 角色名称, value: 该角色在各批次中出现的所有数据片段
	const characterFragments = new Map<string, CharacterAnalysisResult["characters"]>();

	for (let i = 0; i < chunks.length; i++) {
		if (signal?.aborted) {
			throw new Error("分析已取消");
		}

		const messages: ChatMessage[] = [
			{ role: "system", content: CHARACTER_ANALYSIS_SYSTEM_PROMPT },
			{ role: "user", content: userPromptTemplate.replace("{chunk}", chunks[i]) },
		];

		try {
			const response = await sendChatCompletion(messages, config, signal);

			const result = parseCharacterAnalysisResponse(response);

			if (result) {
				const charCount = result.characters?.length || 0;
				const relCount = result.relationships?.length || 0;
				logger.info(`[CharacterAnalysis] 批次 ${i + 1} 解析成功: ${charCount}个角色, ${relCount}条关系`);

				// 收集所有角色数据片段
				for (const char of result.characters || []) {
					if (char.name) {
						if (!characterFragments.has(char.name)) {
							characterFragments.set(char.name, []);
						}
						characterFragments.get(char.name)!.push(char);
					}
				}

				// 合并关系
				for (const rel of result.relationships || []) {
					allRelationships.push(rel);
				}

				// 优先取非空的世界观
				if (result.worldbuilding && result.worldbuilding.worldType) {
					mergedWorldbuilding = result.worldbuilding;
				}
			} else {
				logger.warn(`[CharacterAnalysis] 批次 ${i + 1} 无法从响应中提取任何数据`);
			}
		} catch (err) {
			logger.warn("[CharacterAnalysis] 批次分析失败:", err);
		} finally {
			// 进度统一计算：第一阶段占前 total 步，第二阶段占后续步数
			// 在第一阶段结束前无法知道第二阶段的实际步数，先用 total 显示
			onProgress?.(i + 1, total, "analyze");
		}
	}

	// ==================== 第二阶段：逐角色综合分析总结 ====================
	// 对出现在多个批次中的角色，调用AI综合所有片段生成完整档案
	// 仅出现在一个批次中的角色，直接使用该批次的数据
	const summarizeBatchCount = Array.from(characterFragments.values())
		.filter((fragments) => fragments.length > 1)
		.length;
	let phase2Current = 0;

	const configForCall = {
		baseURL: config.baseURL,
		apiKey: config.apiKey,
		model: config.model,
		customHeaders: config.customHeaders || {},
		maxCharsPerRequest: config.maxCharsPerRequest || 0,
		enableLogging: config.enableLogging || false,
	};

	for (const [name, fragments] of characterFragments.entries()) {
		if (signal?.aborted) {
			throw new Error("分析已取消");
		}

		if (fragments.length <= 1) {
			// 仅有一个片段，直接使用
			allCharacters.push(fragments[0]);
			continue;
		}

		// 多个片段，需要综合分析
		phase2Current++;

		try {
			// 先对数组字段做程序化并集，确保不丢失任何信息
			const mergedAliases = [...new Set(fragments.flatMap(f => f.aliases || []))];
			const mergedAppearances = [...new Set(fragments.flatMap(f => f.appearances || []))];

			// 将片段格式化为可读的文本，标注来源阶段
			const fragmentsText = fragments.map((f, idx) => {
				return `【第 ${idx + 1} 阶段（小说前段→后段）中分析的数据】\n${JSON.stringify(f, null, 2)}`;
			}).join("\n\n");

			// 在 prompt 中附带已合并的数组字段，明确要求 AI 保留
			const premergedInfo = `\n\n## 已合并的完整数据（必须全部保留，不可丢弃）\n` +
				`- 所有别名（aliases）：${JSON.stringify(mergedAliases)}\n` +
				`- 所有出场位置（appearances）：${JSON.stringify(mergedAppearances)}`;

			const systemPrompt = CHARACTER_FRAGMENT_SUMMARIZE_PROMPT
				.replace("{characterName}", name)
				.replace("{characterFragments}", fragmentsText + premergedInfo);

			const userPrompt = `请综合分析角色「${name}」在上述所有阶段中的数据片段，生成一份完整的角色档案JSON。注意：必须涵盖角色从出场到结局的所有阶段信息，不可省略早期内容。`;

			const messages: ChatMessage[] = [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: userPrompt },
			];

			const response = await sendChatCompletion(messages, configForCall, signal);
			const result = parseCharacterAnalysisResponse(response);
			const summarized = result?.characters?.[0] as CharacterAnalysisResult["characters"][0] | undefined;

			if (summarized && summarized.name) {
				// 确保数组字段包含所有片段的并集
				summarized.aliases = [...new Set([...(summarized.aliases || []), ...mergedAliases])];
				summarized.appearances = [...new Set([...(summarized.appearances || []), ...mergedAppearances])];
				allCharacters.push(summarized);
			} else {
				logger.warn(`[CharacterAnalysis] 角色「${name}」综合分析JSON解析失败，使用原始数据`);
				allCharacters.push(fragments[0]);
			}
		} catch (err) {
			logger.warn(`[CharacterAnalysis] 角色「${name}」综合分析失败:`, err);
			// 失败时使用第一个片段作为兜底
			allCharacters.push(fragments[0]);
		} finally {
			onProgress?.(phase2Current, summarizeBatchCount, "summarize");
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

/** 角色多片段综合分析系统提示词 — 用于合并同一角色在不同批次中的碎片化数据 */
export const CHARACTER_FRAGMENT_SUMMARIZE_PROMPT = `你是小说角色分析专家。现在需要将同一角色在小说不同阶段（从前到后）中提取出的多份碎片化角色数据进行综合整合，生成一份完整、详实的角色档案。

## 输入信息
角色名称：{characterName}

以下是在小说不同阶段中分析出的该角色数据片段（JSON格式），按小说从前到后的顺序排列：

{characterFragments}

## 分析任务
请综合分析以上所有阶段的数据片段，遵循以下整合策略：
1. **全面累积**：每个阶段的信息都必须保留，不可丢弃任何阶段的独特内容
2. **互补整合**：不同阶段中出现的互补信息进行有机整合，使角色形象贯穿全文
3. **矛盾处理**：如果阶段间存在矛盾（如角色成长变化），按时间线描述变化过程
4. **扩展完善**：综合所有阶段信息，使各维度描述涵盖角色从出场到结局的完整历程

## 输出格式
请返回以下JSON结构（纯JSON，无markdown），与原格式完全一致：
{
  "name": "角色名称",
  "aliases": ["所有阶段出现过的所有别名，不可遗漏"],
  "gender": "male/female/other",
  "age": "年龄描述",
  "role": "protagonist/heroine/antagonist/supportingMale/supportingFemale/mentor/rival/loveInterest/family/friend/npc",
  "appearance": "整合所有阶段的外貌特征描述",
  "identity": "整合所有阶段的身份职业",
  "socialStatus": "整合所有阶段的社会地位",
  "personality": "整合所有阶段的核心性格特质",
  "background": "出身背景",
  "characterArc": "角色从出场到结局的完整成长弧光",
  "description": "整合所有阶段信息的完整人物小传（150-400字），涵盖角色从出场到结局的完整历程",
  "appearances": ["所有阶段提到的出场位置描述"],
  "voiceDesignPrompt": "整合所有阶段信息的音色设计描述",
  "majorEvents": "按时间顺序列出角色在全文中的所有关键经历和大事件，每个阶段的事件都必须包含，不可省略"
}

## 约束
- 输出必须是有效的JSON格式
- 不要臆造信息，只基于提供的片段数据
- 每个字段都要填写，不要留空（除非确实没有任何信息）
- **关键原则：宁可内容多一些、详细一些，也不要遗漏任何阶段的信息**
- aliases 必须包含"已合并的完整数据"中的所有项
- majorEvents 必须涵盖角色从首次出场到结局的所有阶段事件
- description 字段要整合所有阶段信息，写一段涵盖全文历程的人物小传`;

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

## 核心原则：贴近生活、自然真实
- 音色描述要让 TTS 模型生成像真人日常说话的声音，不要播音腔、舞台腔
- 语速节奏要贴近现实生活：普通对话约每分钟 200-260 字，不要过快或过慢
- 避免"极快""极慢""如连珠炮""慢吞吞"等极端描述，除非角色人设明确需要
- 情绪语气要克制自然，避免"极度愤怒""撕心裂肺"等过度戏剧化描述

## 要求
- 输出1-4句，简洁精准，不堆砌维度
- 不出现混响、回声、EQ、压缩等音质效果词
- 不出现"普通的""正常的""外国的"等模糊描述
- 不同时要求矛盾特征（如"稚嫩的童声"与"CEO气场"）
- 语速描述要贴近真实生活节奏，避免极端值

## 描述维度（选2-3个核心的即可，不必面面俱到）
- 性别与年龄：如"年轻女性""五十多岁的中年男性"
- 音色质感：如"deep and gravelly""丝滑醇厚、带着磁性"
- 情绪语气：如"warm and confident""温柔但带着一丝疲惫"
- 语速节奏：贴近真实生活，如"语速平稳，像日常聊天""说话节奏舒缓，不紧不慢"
- 人设说话风格（可选）：如"深夜电台DJ""一本正经地"

## 示例
输入：角色名：林婉儿，女，女主。江南大家闺秀，知书达理，性格温婉可人。
输出：温柔甜美，年轻女性，温婉知性，语速舒缓自然，江南口音。

输入：角色名：赵铁柱，男，男主。东北豪爽汉子，性格耿直，东北口音。
输出：粗犷豪迈，中年男性，直爽干练，语速平稳像日常聊天，东北口音。`;

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
3. 保留尽可能多的核心事件，越详尽越好
4. 去除冗余和次要信息
5. 每个事件用一句话概括，清晰明了`;

/** 小说大事记生成系统 prompt */
export const NOVEL_EVENTS_SYSTEM_PROMPT = `你是一位专业的小说编辑助手。请根据以下小说内容，提取并生成一份完整的小说大事记。

严格按照以下 JSON 模板格式返回数据，不要包含任何额外说明文字：
{
  "events": [
    {
      "title": "事件标题",
      "description": "事件详细描述（20-50字）",
      "timeOrder": 1,
      "chapterOrder": 1,
      "timeInfo": "具体时间描述（如：第一章、三年后、清晨、某日傍晚等）",
      "chapter": "发生章节（如：第一卷·第1章）",
      "involvedCharacterNames": ["角色A", "角色B"],
      "id": "evt-001"
    }
  ]
}

要求：
1. 提取小说中发生的所有重要事件，按照时间顺序排列，越详细越好
2. 仔细分析全文中的所有时间信息，包括章节标题、正文中提到的时间点、时间段、时间跨度等
3. 每个事件包含：title（标题）、description（描述）、timeOrder（时间顺序编号）、chapterOrder（行文顺序编号）、timeInfo（具体时间描述，从原文中提取或推断）、chapter（发生章节）、involvedCharacterNames（涉及角色名称数组）、id（事件ID，格式为 evt-xxx）
4. 事件数量不做限制，尽可能详细记录每个重要时间点发生的事件
5. timeOrder 从 1 开始递增，表示故事时间线顺序（数字越小越早发生）
6. chapterOrder 从 1 开始递增，表示阅读顺序/行文顺序（数字越小越早在小说中出现）
7. 注意：timeOrder 和 chapterOrder 是两个不同的概念！如果小说使用插叙/倒叙，同一事件的 timeOrder 和 chapterOrder 会不同。例如：倒叙中先读到的事件，chapterOrder 小但 timeOrder 大；插叙中回忆的事件，chapterOrder 大但 timeOrder 小
8. timeInfo 字段要尽可能详细，包含具体的时间描述、时间段、时间跨度等

【章节格式严格规范】
9. chapter 字段必须统一使用"第X卷·第Y章"格式，卷编号和章节编号必须使用**阿拉伯数字**！例如：
   - "第1卷·第1章"（正确）
   - "第2卷·第10章"（正确）
   - "第1卷·序章"（正确）
   - "第一卷·第1章"（错误！卷编号必须用阿拉伯数字）
   - "第1卷·第一章"（错误！章节编号必须用阿拉伯数字）
   - "第一卷·第一章"（错误！卷和章节编号都必须用阿拉伯数字）
   - "第1卷"（错误！必须包含章节名）
   - "第1章"（错误！必须包含卷名）
   - "第12章·第1卷"（错误！卷名必须在前面）
10. 卷名必须在章节名前面，用"·"分隔，格式为"第N卷·第M章"（N和M为阿拉伯数字）
11. 卷编号必须使用阿拉伯数字（第1卷、第2卷、第10卷...），禁止使用中文数字（第一卷、第二卷...）
12. 章节编号必须使用阿拉伯数字（第1章、第2章、第10章...），禁止使用中文数字（第一章、第二章...）
13. 如果事件发生在多个章节，使用最先出现的章节
14. 如果无法确定具体章节，使用最接近的章节

【排序规则】
15. 卷的顺序必须严格按照数字大小：第1卷 < 第2卷 < ... < 第8卷 < ...
16. 同一卷内的章节顺序必须严格按照数字大小：第1章 < 第2章 < ... < 第10章 < ...
17. chapterOrder 必须与章节的阅读顺序完全一致，不要打乱卷和章节的自然顺序
18. timeOrder 必须与故事时间线一致，如果小说是线性叙事，timeOrder 应该与 chapterOrder 一致
19. involvedCharacterNames 使用小说中的实际角色名称
20. 只输出 JSON 格式，不要包含 markdown 代码块标记或其他文字`;

/** 小说大事记合并系统 prompt — 合并去重排序 */
export const NOVEL_EVENTS_MERGE_PROMPT = `你是小说剧情分析专家。以下是从小说不同文本片段中提取出的事件列表，请将这些事件合并、去重并按时间顺序排列。

严格按照以下 JSON 模板格式返回数据，不要包含任何额外说明文字：
{
  "events": [
    {
      "title": "事件标题",
      "description": "事件详细描述（20-50字）",
      "timeOrder": 1,
      "chapterOrder": 1,
      "timeInfo": "具体时间描述",
      "chapter": "发生章节（如：第1卷·第1章）",
      "involvedCharacterNames": ["角色A", "角色B"],
      "id": "evt-001"
    }
  ]
}

要求：
1. 合并意思相近或重复的事件
2. 按故事发展的时间顺序排列
3. 保留尽可能多的核心事件，越详尽越好
4. 去除冗余和次要信息
5. timeOrder 从 1 开始递增，不要重复，表示故事时间线顺序
6. chapterOrder 从 1 开始递增，不要重复，表示阅读顺序/行文顺序
7. 注意：timeOrder 和 chapterOrder 是两个不同的概念！如果小说使用插叙/倒叙，同一事件的 timeOrder 和 chapterOrder 会不同

【章节格式严格规范】
8. chapter 字段必须统一使用"第X卷·第Y章"格式，卷编号和章节编号必须使用**阿拉伯数字**！例如：
   - "第1卷·第1章"（正确）
   - "第2卷·第10章"（正确）
   - "第1卷·序章"（正确）
   - "第一卷·第1章"（错误！卷编号必须用阿拉伯数字）
   - "第1卷·第一章"（错误！章节编号必须用阿拉伯数字）
   - "第一卷·第一章"（错误！卷和章节编号都必须用阿拉伯数字）
   - "第1卷"（错误！必须包含章节名）
   - "第1章"（错误！必须包含卷名）
   - "第12章·第1卷"（错误！卷名必须在前面）
9. 卷名必须在章节名前面，用"·"分隔，格式为"第N卷·第M章"（N和M为阿拉伯数字）
10. 卷编号必须使用阿拉伯数字（第1卷、第2卷、第10卷...），禁止使用中文数字（第一卷、第二卷...）
11. 章节编号必须使用阿拉伯数字（第1章、第2章、第10章...），禁止使用中文数字（第一章、第二章...）
12. 如果发现章节格式不一致（如"第12章·第一卷"、"第一卷·第一章"），必须修正为正确格式（"第1卷·第12章"）

【排序规则】
13. 卷的顺序必须严格按照数字大小：第1卷 < 第2卷 < ... < 第8卷 < ...
14. 同一卷内的章节顺序必须严格按照数字大小：第1章 < 第2章 < ... < 第10章 < ...
15. chapterOrder 必须与章节的阅读顺序完全一致，不要打乱卷和章节的自然顺序
16. 先按卷排序，再按章节排序，确保所有第1卷的事件排在第2卷之前

17. 只输出 JSON 格式，不要包含 markdown 代码块标记或其他文字`;

/**
 * 分批分析整本小说，提取小说大事记
 * @param fullText 小说全文
 * @param characterNames 角色名称列表
 * @param config AI配置
 * @param onProgress 进度回调
 * @returns 小说大事记结果
 */
export interface NovelEventsResult {
  events: Array<{
    title: string;
    description: string;
    timeOrder: number;
    chapterOrder: number;
    timeInfo: string;
    chapter: string;
    involvedCharacterNames: string[];
    id: string;
  }>;
}

export async function generateNovelEvents(
  fullText: string,
  characterNames: string,
  config: AIConfig,
  onProgress?: (current: number, total: number, phase: "analyze" | "merge") => void,
  skipMerge?: boolean,
  existingEvents?: Array<{ title: string; description: string; timeOrder: number; chapterOrder: number; chapter: string; timeInfo: string }>,
): Promise<NovelEventsResult> {
  if (!config.apiKey || !config.baseURL) {
    throw new Error("AI配置不完整");
  }

  const batchSize = 80000;
  const chunks = splitByParagraphs(fullText, batchSize);

  if (chunks.length === 0) {
    return { events: [] };
  }

  const configForCall = {
    baseURL: config.baseURL,
    apiKey: config.apiKey,
    model: config.model,
    customHeaders: config.customHeaders || {},
    maxCharsPerRequest: config.maxCharsPerRequest || 0,
    enableLogging: config.enableLogging || false,
  };

  const allEventsFromChunks: NovelEventsResult["events"] = [];
  const failedBatches: number[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const existingEventsContext = existingEvents && existingEvents.length > 0
      ? `

【现有大事记参考（请避免重复，新事件的 timeOrder 和 chapterOrder 需要与以下事件衔接）】
${existingEvents.map((evt, idx) => `${idx + 1}. [时间顺序:${evt.timeOrder}][行文顺序:${evt.chapterOrder}][${evt.chapter}] ${evt.title}：${evt.description}`).join('\n')}

注意：
1. 新生成的事件不要与上述现有事件重复
2. timeOrder 和 chapterOrder 需要与现有事件的编号衔接，不要从 1 重新开始
3. 如果现有事件的最大 timeOrder 是 N，新事件的 timeOrder 应从 N+1 开始（或根据事件实际时间位置插入）
4. 如果现有事件的最大 chapterOrder 是 M，新事件的 chapterOrder 应从 M+1 开始（或根据事件实际行文位置插入）`
      : '';

    const userPrompt = `请分析以下小说文本片段（第 ${i + 1}/${chunks.length} 部分），提取其中的重要事件并生成大事记：

小说角色列表：${characterNames || "暂无"}${existingEventsContext}

${chunks[i]}`;

    const messages: ChatMessage[] = [
      { role: "system", content: NOVEL_EVENTS_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ];

    try {
      const response = await sendChatCompletion(messages, configForCall);

      let result: NovelEventsResult | null = null;
      try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          result = JSON.parse(jsonMatch[0]);
        }
      } catch (parseErr) {
        logger.warn(`[NovelEvents] 批次 ${i + 1} JSON 解析失败:`, parseErr);
      }

      if (result && Array.isArray(result.events)) {
        for (const evt of result.events) {
          if (evt.title) {
            allEventsFromChunks.push({
              ...evt,
              id: generateId("evt"),
            });
          }
        }
        logger.info(`[NovelEvents] 批次 ${i + 1} 解析成功: ${result.events.length} 个事件`);
      } else {
        failedBatches.push(i + 1);
        logger.warn(`[NovelEvents] 批次 ${i + 1} 返回空结果`);
      }
    } catch (err) {
      failedBatches.push(i + 1);
      logger.warn(`[NovelEvents] 批次 ${i + 1} 分析失败:`, err);
    } finally {
      onProgress?.(i + 1, chunks.length, "analyze");
    }
  }

  if (allEventsFromChunks.length === 0) {
    if (failedBatches.length === chunks.length) {
      throw new Error(`所有 ${chunks.length} 个批次分析均失败，请检查网络连接或AI配置`);
    }
    return { events: [] };
  }

  if (chunks.length === 1 || skipMerge) {
    if (failedBatches.length > 0) {
      logger.warn("[NovelEvents] 单个批次分析失败");
    }
    return { events: allEventsFromChunks };
  }

  const eventsJson = JSON.stringify(allEventsFromChunks);
  const mergePrompt = `以下是从小说各文本片段中提取出的事件列表，请合并去重并按时间顺序排列：

${eventsJson}`;

  const mergeMessages: ChatMessage[] = [
    { role: "system", content: NOVEL_EVENTS_MERGE_PROMPT },
    { role: "user", content: mergePrompt },
  ];

  try {
    const finalResponse = await sendChatCompletion(mergeMessages, configForCall);

    let finalResult: NovelEventsResult | null = null;
    try {
      const jsonMatch = finalResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        finalResult = JSON.parse(jsonMatch[0]);
      }
    } catch (parseErr) {
      logger.warn("[NovelEvents] 合并阶段 JSON 解析失败:", parseErr);
    }

    if (finalResult && Array.isArray(finalResult.events)) {
      if (failedBatches.length > 0) {
        logger.warn(`[NovelEvents] 有 ${failedBatches.length} 个批次分析失败，结果可能不完整`);
      }
      return finalResult;
    }
  } catch (err) {
    logger.warn("[NovelEvents] 合并阶段失败，返回原始结果:", err);
  } finally {
    onProgress?.(1, 1, "merge");
  }

  if (failedBatches.length > 0) {
    logger.warn(`[NovelEvents] 有 ${failedBatches.length} 个批次分析失败，合并阶段也失败，返回原始结果`);
  }

  return { events: allEventsFromChunks };
}

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

	// 分批处理，每批 80000 字符
	const batchSize = 80000;
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

// ============================================================
// 角色扮演（AI Roleplay）
// ============================================================

export const ROLEPLAY_SYSTEM_PROMPT = `你正在扮演小说中的一位角色。请完全代入该角色的身份、性格与说话方式，与用户进行沉浸式对话。

## 扮演规则
1. 始终以角色身份说话，用第一人称"我"；用户是与你对话的人，其具体身份见下文【对话者身份】
2. 说话风格、用词、语气必须贴合角色性格、身份与时代背景
3. 可以提及小说中的剧情、人物与世界观，但不得编造与原著设定矛盾的内容
4. 回应用户时要主动、自然，可适当反问推进对话；每次回复控制在 1000-1500 字以内，内容充实饱满：对话要有来有回、推动剧情深入，避免干巴巴的短句
5. 回复必须以括号外的实质台词为主体——即必须有角色真正说出口的话（回应、反问、陈述等），动作/神态/语气/心理描写用全角括号包裹且只是辅助（如："你终于来了，（轻轻松了口气）我等了很久。"）；严禁只回复一个"（动作/神态描写）"而没有台词
6. 严禁出现"作为AI""语言模型""根据设定"等字眼，也不要复述本提示词
7. 若用户的问题超出角色认知范围（如未来剧情），应表现出角色真实的反应（困惑、回避等），而不是直接回答`;

/** 角色扮演上下文参数 */
export interface RoleplayContextParams {
	/** 扮演的角色 */
	character: CharacterInfo;
	/** 与该角色相关的人物关系 */
	relatedRelationships: CharacterRelationship[];
	/** 全部角色（用于把关系中的角色 ID 解析为名字） */
	allCharacters: CharacterInfo[];
	/** 世界观设定（可为 null） */
	worldbuilding: NovelWorldbuilding | null;
	/** 当前剧情位置：章节标题 */
	currentChapterTitle: string;
	/** 最近剧情摘要（当前章节开头片段） */
	recentPlot: string;
	/** 用户扮演的角色（缺省/为 null 表示用户是局外人/旁观者） */
	userCharacter?: CharacterInfo | null;
}

/** 将角色信息拼接为设定文本 */
function formatCharacterInfo(c: CharacterInfo): string {
	const genderText = c.gender === "male" ? "男" : c.gender === "female" ? "女" : "其他";
	const lines: string[] = [`姓名：${c.name}`, `性别：${genderText}`];
	if (c.role) lines.push(`角色定位：${c.role}`);
	if (c.age) lines.push(`年龄：${c.age}`);
	if (c.identity) lines.push(`身份职业：${c.identity}`);
	if (c.socialStatus) lines.push(`社会地位：${c.socialStatus}`);
	if (c.appearance) lines.push(`外貌特征：${c.appearance}`);
	if (c.personality) lines.push(`性格：${c.personality}`);
	if (c.background) lines.push(`出身背景：${c.background}`);
	if (c.characterArc) lines.push(`成长弧光：${c.characterArc}`);
	if (c.dialect) lines.push(`说话方言：${c.dialect}`);
	if (c.notes) lines.push(`人物小传：${c.notes}`);
	return lines.join("\n");
}

/** 构建角色扮演的系统提示词（角色设定 + 关系 + 世界观 + 剧情位置 + 对话者身份） */
export function buildRoleplaySystemPrompt(params: RoleplayContextParams): string {
	const {
		character,
		relatedRelationships,
		allCharacters,
		worldbuilding,
		currentChapterTitle,
		recentPlot,
		userCharacter,
	} = params;

	const charById = new Map(allCharacters.map((c) => [c.id, c]));

	// 对话者身份说明
	const userIdentity = userCharacter
		? `用户正在扮演「${userCharacter.name}」（${userCharacter.role ?? "小说角色"}）与你对话。请以你对「${userCharacter.name}」的了解来称呼与回应 TA，语气符合你与 TA 的关系与熟悉程度。`
		: "用户是故事之外的旁观者（局外人），以读者视角与你交谈。你可以把他当作一个了解你故事、对你和剧情感兴趣的人，自然地回应 TA 的问题。";

	// 人物关系摘要
	const relationLines = relatedRelationships
		.map((r) => {
			const isSource = r.sourceId === character.id;
			const otherId = isSource ? r.targetId : r.sourceId;
			const other = charById.get(otherId);
			if (!other) return null;
			const typeText = r.relationType?.length
				? r.relationType.join("、")
				: r.customRelationType || "相识";
			const nickname = (isSource ? r.sourceNickname : r.targetNickname)?.filter(Boolean);
			return `与「${other.name}」是${typeText}关系${nickname?.length ? `，你称呼他/她为：${nickname.join("、")}` : ""}`;
		})
		.filter((l): l is string => l !== null);

	// 世界观摘要（取主要维度）
	const wbLines: string[] = [];
	if (worldbuilding) {
		if (worldbuilding.worldType) wbLines.push(`世界背景：${worldbuilding.worldType}`);
		if (worldbuilding.eraDescription) wbLines.push(`时代背景：${worldbuilding.eraDescription}`);
		if (worldbuilding.geography) wbLines.push(`地理环境：${worldbuilding.geography}`);
		if (worldbuilding.socialStructure) wbLines.push(`社会结构：${worldbuilding.socialStructure}`);
		if (worldbuilding.powerSystem) wbLines.push(`力量体系：${worldbuilding.powerSystem}`);
		if (worldbuilding.coreSettings) wbLines.push(`核心设定：${worldbuilding.coreSettings}`);
		if (wbLines.length === 0 && worldbuilding.description) wbLines.push(`世界观概述：${worldbuilding.description}`);
	}

	return `${ROLEPLAY_SYSTEM_PROMPT}

【你的角色设定】
${formatCharacterInfo(character)}

【对话者身份】
${userIdentity}

${relationLines.length ? `【你的人际关系】\n${relationLines.join("\n")}\n` : ""}${wbLines.length ? `【世界背景】\n${wbLines.join("\n")}\n` : ""}【当前剧情位置】
当前故事进行到：${currentChapterTitle || "未知章节"}
最近剧情片段：
${recentPlot}`;
}

// ============================================================
// 多角色扮演 — AI 同时扮演多个角色，按角色输出多条气泡
// ============================================================

/** 多角色扮演输出的一段（一个角色的一条发言） */
export interface MultiRoleplaySegment {
	/** 角色名（必须与角色设定中的姓名一致） */
	character: string;
	/** 该角色的发言内容 */
	content: string;
}

export const ROLEPLAY_MULTI_SYSTEM_PROMPT = `你正在同时扮演小说中的多个角色，与用户进行沉浸式群像对话。你可以依据用户输入或剧情需要，将其他角色引入当前对话。

## 在场角色与引入规则
1. 【当前在场角色】是这场对话中已经出现的角色，他们一直都在场，理应参与发言
2. 当用户提到、请求或暗示某个不在场的角色加入时，该角色立即加入在场角色行列，并参与本次发言。角色加入只增不减：新角色入场后，原有在场角色全部保留、继续在场，严禁用新角色替换、挤掉或忽略任何已在场角色
3. 主角始终在场，除非剧情明确让其离开

## 输出格式（非常重要）
4. 输出为 JSON 数组，数组中的元素数量必须等于【当前在场角色】的数量——【当前在场角色】列出的每个名字都必须出现且只能出现一次，每个元素是一条发言：{"character":"角色名","content":"发言内容"}。参与人数没有上限：无论在场角色是 2 个、3 个、4 个还是更多，都必须全员发言、一人不少；人数较多时，各角色发言可适当简短，但人人必须有实质台词
5. 当用户请求或暗示某角色加入时（如"让某某过来""某某来了""叫上某某"），该角色加入在场角色，主角与引入角色都必须发言；严禁只让其中一个角色说话，也严禁因为人数增多而漏掉、省略或顶替任何已在场角色
6. 每条发言的 content 必须以括号外的实质内容为主体——即必须有角色真正说出口的台词（对话、回应、反问、陈述等），括号内的动作/神态/心理描写只是辅助；严禁只输出一个"（动作/神态描写）"而没有台词
7. 角色名必须是下方【可扮演角色】列表中存在的姓名，不得使用列表外的名字，也不得使用"旁白""叙述"等非角色名
8. 历史消息中形如"（角色名）内容"的记录，表示该角色说过的话，用于理解上下文

## 扮演规则
9. 每个角色都要完全代入其身份、性格与说话方式，说话风格必须贴合各自设定，用第一人称"我"
10. 每条发言必须先有实质台词（角色真正说出口的话），可再辅以括号包裹的动作/神态/语气/心理描写（如："你终于来了，（轻轻松了口气）我等了很久。"）；内容一般控制在 100-400 字以内（在场角色较多时，每人发言可适当压缩，保证全员都能发言），禁止只有括号内描写而没有台词
11. 角色之间可以相互对话、插话、回应，形成自然的群像互动
12. 严禁出现"作为AI""语言模型""根据设定"等字眼
13. 只输出 JSON 数组本身，不要输出任何解释、markdown 代码块标记或其他文字`;

/** 多角色扮演上下文参数 */
export interface RoleplayMultiContextParams extends RoleplayContextParams {
	/** 全部可扮演角色（含主角，供 AI 引入其他角色） */
	playableCharacters: CharacterInfo[];
	/** 当前在场角色（主角 + 历史对话中出现过的角色），这些角色都应参与发言 */
	presentCharacters?: CharacterInfo[];
}

/** 构建多角色扮演的系统提示词（主角色 + 全部可引入角色 + 关系 + 世界观 + 剧情 + 对话者身份） */
export function buildRoleplayMultiSystemPrompt(params: RoleplayMultiContextParams): string {
	const {
		character: mainCharacter,
		playableCharacters,
		presentCharacters,
		relatedRelationships,
		worldbuilding,
		currentChapterTitle,
		recentPlot,
		userCharacter,
	} = params;

	const charById = new Map(playableCharacters.map((c) => [c.id, c]));

	// 对话者身份说明
	const userIdentity = userCharacter
		? `用户正在扮演「${userCharacter.name}」（${userCharacter.role ?? "小说角色"}）。请以各自对「${userCharacter.name}」的了解来称呼与回应 TA。`
		: "用户是故事之外的旁观者（局外人），以读者视角与在场角色交谈。";

	// 全部可扮演角色设定（含主角，供 AI 引入其他角色）
	const charLines = playableCharacters.map((c) => formatCharacterInfo(c));

	// 当前在场角色（主角始终在场 + 历史出现过的角色）
	const presentNames = presentCharacters && presentCharacters.length > 0
		? presentCharacters.map((c) => c.name).join("、")
		: mainCharacter.name;

	// 主角色的人际关系摘要（帮助其他角色理解主角与谁相识）
	const relationLines = relatedRelationships
		.map((r) => {
			const isSource = r.sourceId === mainCharacter.id;
			const otherId = isSource ? r.targetId : r.sourceId;
			const other = charById.get(otherId);
			if (!other) return null;
			const typeText = r.relationType?.length
				? r.relationType.join("、")
				: r.customRelationType || "相识";
			return `「${mainCharacter.name}」与「${other.name}」是${typeText}关系`;
		})
		.filter((l): l is string => l !== null);

	// 世界观摘要（取主要维度）
	const wbLines: string[] = [];
	if (worldbuilding) {
		if (worldbuilding.worldType) wbLines.push(`世界背景：${worldbuilding.worldType}`);
		if (worldbuilding.eraDescription) wbLines.push(`时代背景：${worldbuilding.eraDescription}`);
		if (worldbuilding.geography) wbLines.push(`地理环境：${worldbuilding.geography}`);
		if (worldbuilding.socialStructure) wbLines.push(`社会结构：${worldbuilding.socialStructure}`);
		if (worldbuilding.powerSystem) wbLines.push(`力量体系：${worldbuilding.powerSystem}`);
		if (worldbuilding.coreSettings) wbLines.push(`核心设定：${worldbuilding.coreSettings}`);
		if (wbLines.length === 0 && worldbuilding.description) wbLines.push(`世界观概述：${worldbuilding.description}`);
	}

	return `${ROLEPLAY_MULTI_SYSTEM_PROMPT}

【当前在场角色】（这些角色都在场，本轮输出中每个角色都必须各发言一条，缺一不可）
${presentNames}

【可扮演角色】（全部可被引入对话的角色，不在场角色可依剧情引入）
${charLines.join("\n\n")}

【当前对话的主角色】
${formatCharacterInfo(mainCharacter)}

【对话者身份】
${userIdentity}

${relationLines.length ? `【主要人物关系】\n${relationLines.join("\n")}\n` : ""}${wbLines.length ? `【世界背景】\n${wbLines.join("\n")}\n` : ""}【当前剧情位置】
当前故事进行到：${currentChapterTitle || "未知章节"}
最近剧情片段：
${recentPlot}`;
}

/**
 * 解析 AI 的多角色回复为发言段数组。
 * 依次尝试：
 *  1. JSON 数组（纯数组 / ```json 代码块 / 夹带文字）
 *  2. 单个 JSON 对象
 *  3. 多个 JSON 对象拼接（AI 常见的 `{...}\n{...}` 或 `{...}{...}` 形式）
 *  4. "角色名：内容" / "（角色名）内容" 文本行格式
 * 全部失败返回 null（调用方回退为单角色消息）。
 */
export function parseMultiRoleplayResponse(reply: string): MultiRoleplaySegment[] | null {
	const trimmed = reply.trim();
	if (!trimmed) return null;

	// 1. 去掉可能的 markdown 代码块包裹
	let jsonText = trimmed;
	const codeBlock = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
	if (codeBlock) {
		jsonText = codeBlock[1].trim();
	}

	// 2. 尝试直接解析 JSON 数组
	let parsed: unknown;
	try {
		parsed = JSON.parse(jsonText);
	} catch {
		parsed = null;
	}

	// 3. 数组解析失败时，提取可能的数组片段（AI 有时会夹带解释文字）
	if (!Array.isArray(parsed)) {
		const arrMatch = jsonText.match(/\[[\s\S]*\]/);
		if (arrMatch) {
			try {
				parsed = JSON.parse(arrMatch[0]);
			} catch {
				parsed = null;
			}
		}
	}

	if (Array.isArray(parsed)) {
		const segments: MultiRoleplaySegment[] = [];
		for (const item of parsed) {
			const seg = extractSegment(item);
			if (seg) segments.push(seg);
		}
		return segments.length > 0 ? segments : null;
	}

	// 4. 单个 JSON 对象（AI 只让一个角色说话时）
	if (parsed && typeof parsed === "object") {
		const seg = extractSegment(parsed);
		if (seg) return [seg];
	}

	// 5. 多个 JSON 对象拼接（整体不是合法 JSON，逐个对象扫描）
	const objectSegments = parseConcatenatedObjects(jsonText);
	if (objectSegments.length > 0) return objectSegments;

	// 6. 回退：解析"角色名：内容"文本格式（每行一段，支持多角色）
	const textSegments = parseTextSegments(trimmed);
	return textSegments.length > 0 ? textSegments : null;
}

/** 判断发言内容是否只有括号内描写（无括号外实质台词） */
export function hasSubstantiveContent(content: string): boolean {
	// 去掉全角/半角括号包裹的内容后，剩余部分若几乎为空白，则视为纯描写
	const outside = content.replace(/[（(【][^（）()【】]*[）)】]/g, "").replace(/\s+/g, "");
	return outside.length > 0;
}

/** 判断发言内容是否"整段仅为一对括号包裹的描写"（开头、结尾均为括号且只含一对括号） */
export function isBracketOnlyContent(content: string): boolean {
	return /^[（(【][^（）()【】]{1,}[）)】]$/.test(content.trim());
}

/** 从单个 JSON 项提取发言段（兼容 character/name、content/text 字段） */
function extractSegment(item: unknown): MultiRoleplaySegment | null {
	if (typeof item !== "object" || item === null) return null;
	const o = item as Record<string, unknown>;
	const character = String(o.character ?? o.name ?? "").trim();
	const content = String(o.content ?? o.text ?? "").trim();
	if (!character || !content) return null;
	return { character, content };
}

/** 解析多个 JSON 对象拼接的文本（如 {"character":"A",...}\n{"character":"B",...}） */
function parseConcatenatedObjects(text: string): MultiRoleplaySegment[] {
	const segments: MultiRoleplaySegment[] = [];
	// 匹配所有完整的 JSON 对象字面量（含嵌套花括号/引号转义）
	const objectPattern = /\{(?:[^{}]|\{[^{}]*\})*\}/g;
	let m: RegExpExecArray | null;
	while ((m = objectPattern.exec(text)) !== null) {
		try {
			const seg = extractSegment(JSON.parse(m[0]));
			if (seg) segments.push(seg);
		} catch {
			// 跳过无法解析的对象
		}
	}
	return segments;
}

/** 解析"角色名：内容" / "（角色名）内容" 文本行格式 */
function parseTextSegments(text: string): MultiRoleplaySegment[] {
	const segments: MultiRoleplaySegment[] = [];
	for (const rawLine of text.split(/\n+/)) {
		const line = rawLine.trim();
		if (!line) continue;
		const colonMatch = line.match(/^(?<name>[^：:]{1,12})[：:]\s*(?<content>.+)$/);
		const bracketMatch = line.match(/^[（(【]\s*(?<name>[^）)】]{1,12})\s*[）)】]\s*(?<content>.+)$/);
		const m = colonMatch ?? bracketMatch;
		if (!m?.groups) continue;
		const character = m.groups.name.trim();
		const content = m.groups.content.trim();
		if (!character || !content) continue;
		segments.push({ character, content });
	}
	return segments;
}
