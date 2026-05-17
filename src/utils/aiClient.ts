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

/** 剧本TTS情感增强系统提示词 */
export const SCRIPT_TTS_ENHANCE_SYSTEM_PROMPT = `你是一位专业的小说有声书演播导演。请为剧本对话添加情感和音色标注，使TTS语音合成更具表现力。

## 标注规范

### 1. 基础情绪标签（放在对话最开头）
格式：(情绪)对话内容
情绪类型：
- 开心：快乐、高兴、兴奋
- 悲伤：难过、伤心、沮丧
- 愤怒：生气、恼怒、暴躁
- 恐惧：害怕、惊恐、畏惧
- 惊讶：吃惊、意外、震惊
- 兴奋：激动、亢奋、热情
- 委屈：冤枉、不平、诉苦
- 平静：冷静、淡定、安宁
- 冷漠：冷淡、无情、漠然

### 2. 复合情绪标签（放在对话最开头）
- 怅然：失落、怀念、感慨
- 欣慰：满足、安心、满意
- 无奈：无可奈何、无奈、没辙
- 愧疚：自责、内疚、抱歉
- 释然：释怀、放下、轻松
- 嫉妒：眼红、羡慕、不服
- 厌倦：厌烦、无聊、倦怠
- 忐忑：不安、焦虑、紧张
- 动情：感动、深情、温柔

### 3. 整体语调标签（放在对话最开头）
- 温柔：柔和、温情、体贴
- 高冷：冷淡、高傲、冷艳
- 活泼：开朗、俏皮、灵动
- 严肃：正经、庄重、威严
- 慵懒：懒散、松弛、随意
- 俏皮：调皮、可爱、戏谑
- 深沉：厚重、沉稳、内敛
- 干练：利落、爽快、直接
- 凌厉：锐利、锋芒、强势

### 4. 音色定位标签（放在对话最开头）
- 磁性：低沉、浑厚、有穿透力
- 醇厚：饱满、温润、有底蕴
- 清亮：清澈、明亮、纯净
- 空灵：飘渺、虚幻、超脱
- 稚嫩：年轻、单纯、天真
- 苍老：衰老、沧桑、沉重
- 甜美：可爱、温柔、愉悦
- 沙哑：粗粝、嘶哑、低沉
- 醇雅：优雅、知性、高贵

### 5. 人设腔调标签（放在对话最开头）
- 夹子音：娇柔、撒娇、可爱
- 御姐音：成熟、霸气、知性
- 正太音：男孩、稚气、可爱
- 大叔音：成熟、沧桑、稳重
- 台湾腔：软糯、温柔、可爱

### 6. 方言标签（放在对话最开头）
- 东北话：东北口音风格
- 四川话：四川口音风格
- 河南话：河南口音风格
- 粤语：广东话风格

### 7. 角色扮演标签（放在对话最开头）
- 孙悟空：猴哥的语气和腔调
- 林黛玉：林妹妹的语气和腔调

### 8. 唱歌标签
格式：(唱歌)歌词内容
标签内标识支持以下取值（效果等效）：唱歌、sing、singing
示例：(唱歌)原谅我这一生不羁放纵爱自由，也会怕有一天会跌倒。

### 9. 音频标签（可在对话任意位置插入）
格式：[音频描述]
类型：
- 呼吸/停顿：吸气、深呼吸、叹气、长叹一口气、喘息、屏息
- 情绪状态：紧张、害怕、激动、疲惫、委屈、撒娇、心虚、震惊、不耐烦
- 语音特征：颤抖、声音颤抖、变调、破音、鼻音、气声、沙哑
- 哭笑表达：笑、轻笑、大笑、冷笑、抽泣、呜咽、哽咽、嚎啕大哭
- 语速控制：快速、慢速、停顿后继续

## 输出格式（特别重要）

### 逐行标注格式（必须严格遵守）

对于每一行文本，请按照以下格式输出：
\`\`\`
{角色名}[音色]：(情绪标签)对话内容
\`\`\`

其中：
1. **{角色名}**：原剧本中的角色名（如：张强、王芳、旁白、我）
2. **[音色]**：可选的音色标识（如：[冰糖]、[茉莉]、[苏打]等），但标注时可以先留空，系统会后续处理
3. **(情绪标签)**：情绪、语调、音色标签，放在冒号后面
4. **对话内容**：原对话内容，可添加音频标签

**特别注意：**
- 对于所有文本行（包括旁白），都必须按照这个格式输出，标注角色和音色
- **旁白必须使用角色名“我”**（别称为“我”的角色）
- 场景描述、动作描述、转场等可以跳过，保持原样，但如果是叙述性文字，也建议用“我：”格式
- 如果没有指定音色，可以省略[音色]部分，但角色名必须保留

## 输出示例（新格式）

输入：
张强：她今晚一定会来。

输出：
张强：(低沉，怅然，磁性)她今晚一定会来。[叹气]

输入：
王芳：这地方……真有人住吗？

输出：
王芳：(疑惑，高冷，清亮)这地方……真有人住吗？[深呼吸]

输入：
（旁白：夜幕降临，月亮从云层中探出头来。）

输出：
我：(平静，温柔)夜幕降临，月亮从云层中探出头来。

输入：
李明：原谅我这一生不羁放纵爱自由。

输出：
李明：(唱歌)原谅我这一生不羁放纵爱自由，也会怕有一天会跌倒，Oh no。

## 重要约束

- **必须逐行标注角色和音色，每行格式统一为：角色名：(标签)内容**
- **旁白必须使用角色名“我”**（别称为“我”的角色）
- 标签必须放在对话最开头，用圆括号包裹。支持半角()、全角（）或[]格式
- 多个标签可以叠加，如：(温柔，高冷)但请确保它们不矛盾
- 音频标签用方括号包裹，可以放在对话中间
- 保持原对话内容不变，只添加标注
- 输出只包含标注后的剧本内容，不要包含任何解释或说明
- **不要输出 markdown 格式（如代码块、引号、加粗等），只返回纯文本**
- 严格保留原剧本的场景、动作、转场等格式，但叙述性文字要用“我：”格式
- 如果是唱歌部分，必须在开头添加(唱歌)标签

`;

/** 构建TTS情感增强的user prompt */
export function buildScriptTTSEnhanceUserPrompt(scriptContent: string): string {
	return `请为以下剧本中的对话部分添加情感和音色标注（用于TTS语音合成）。

**重要规则：**
- 所有文本行（包括旁白、叙述）都需要标注角色名，旁白必须使用角色名"我"
- 格式统一为：角色名：(情绪标签)对话内容
- 场景描述（如"场景 1：夜 - 老宅客厅 - 阴森"）、动作描述（如"动作："）、转场（如"转场："）可以保持原样，但叙述性文字要用"我："格式
- 如果对话中包含唱歌歌词，需要在开头添加(唱歌)标签
- **不要输出 markdown 格式（如代码块、引号、加粗等），只返回纯文本**

剧本内容：
${scriptContent}

请逐行标注角色和音色，旁白使用角色名"我"。`;
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
export const NOVEL_TTS_ENHANCE_SYSTEM_PROMPT = `你是一位专业的小说有声书演播导演。请为小说章节内容添加情感和音色标注，使TTS语音合成更具表现力。

## 可用的标签类型

### 基础情绪标签
开心、悲伤、愤怒、恐惧、惊讶、兴奋、委屈、平静、冷漠

### 复合情绪标签
怅然、欣慰、无奈、愧疚、释然、嫉妒、厌倦、忐忑、动情

### 整体语调标签
温柔、高冷、活泼、严肃、慵懒、俏皮、深沉、干练、凌厉

### 音色定位标签
磁性、醇厚、清亮、空灵、稚嫩、苍老、甜美、沙哑、醇雅

### 人设腔调标签
夹子音、御姐音、正太音、大叔音、台湾腔

### 方言标签
东北话、四川话、河南话、粤语

### 角色扮演标签
孙悟空、林黛玉

### 音频标签（方括号）
- 呼吸相关：[吸气]、[深呼吸]、[叹气]、[长叹一口气]、[喘息]、[屏息]
- 情绪相关：[紧张]、[害怕]、[激动]、[疲惫]、[委屈]、[撒娇]、[心虚]、[震惊]、[不耐烦]
- 声音特征：[颤抖]、[声音颤抖]、[变调]、[破音]、[鼻音]、[气声]、[沙哑]
- 哭笑表达：[笑]、[轻笑]、[大笑]、[冷笑]、[抽泣]、[呜咽]、[哽咽]、[嚎啕大哭]
- 语速与节奏：[快速]、[缓慢]、[停顿]、[停顿一下]、[沉默片刻]、[沉默一会儿]

## 使用示例

### 简单示例
- (开心，轻快)今天真是个好日子！
- (悲伤，声音颤抖)你……你真的要走吗？
- (紧张，深呼吸)好、好的，我准备好了。

### 复杂对话示例
(无奈，叹气)唉，你这又是何必呢？(平静)其实有些事情，不必太过执着。
(激动，声音颤抖)不！我一定要坚持下去！[抽泣]哪怕只有一丝希望……

## 重要约束

- 标签必须放在对话最开头，用圆括号包裹。支持半角()、全角（）或[]格式
- 多个标签可以叠加，如：(温柔，高冷)但请确保它们不矛盾
- 音频标签用方括号包裹，可以放在对话中间
- 保持原对话内容不变，只添加标注
- 如果是旁白或叙述，可以添加更温和的标签
- 输出只包含标注后的小说内容，不要包含任何解释或说明
- **不要输出 markdown 格式（如代码块、引号、加粗等），只返回纯文本**
- 严格保留原小说的段落结构和换行，只添加标签
- 如果是唱歌部分，必须在开头添加(唱歌)标签`;

/** 构建小说章节TTS情感增强的user prompt */
export function buildNovelTTSEnhanceUserPrompt(chapterContent: string): string {
	return `请为以下小说章节添加情感和音色标注（用于TTS语音合成）。

**重要规则：**
- 为每一段文字添加合适的情绪和音色标签
- 对话部分可以根据语气添加更丰富的标签
- 叙述部分可以用更温和、平稳的标签
- 如果段落中包含唱歌歌词，需要在开头添加(唱歌)标签
- **不要输出 markdown 格式（如代码块、引号、加粗等），只返回纯文本**
- **严格保留原小说的所有内容和段落结构，只添加标签**

小说内容：
${chapterContent}

请只对文字内容添加情绪、语调、音色标签，其他内容原样保留。`;
}

// ============================================================
// 阅读模式逐段TTS情感增强Prompt
// ============================================================

/** 阅读模式逐段TTS情感增强系统提示词 */
export const READING_MODE_TTS_ENHANCE_SYSTEM_PROMPT = `你是一位专业的小说有声书演播导演。请分析小说段落，识别涉及的人物并判断情绪，输出用于TTS语音合成的标注。

## 分析任务

### 1. 人物识别
- 识别段落中涉及的所有人物名称
- 包括直接出现的名字和代称（如"我"、"他"、"她"）
- 返回标准的人物名称（如配置中的主角名）

### 2. 情绪分析
根据上下文判断段落的整体情绪氛围：

**基础情绪：**
- 开心、悲伤、愤怒、恐惧、惊讶、兴奋、委屈、平静、冷漠

**复合情绪：**
- 怅然、欣慰、无奈、愧疚、释然、嫉妒、厌倦、忐忑、动情

**语调风格：**
- 温柔、高冷、活泼、严肃、慵懒、俏皮、深沉、干练、凌厉

### 3. 特殊标记
- 如果包含对话，标记说话角色
- 如果包含唱歌内容，标记(唱歌)
- 如果需要音效，使用[音频标签]

## 输出格式（JSON）

必须返回以下格式的JSON对象：

\`\`\`json
{
  "characters": ["人物A", "人物B"],
  "segments": [
    {
      "type": "narration",
      "speaker": "旁白",
      "emotion": "情绪标签",
      "tone": "语调标签",
      "text": "(情绪,语调)旁白文本内容"
    },
    {
      "type": "dialogue",
      "speaker": "角色名",
      "emotion": "情绪标签",
      "tone": "语调标签",
      "text": "(情绪,语调)对话内容"
    }
  ]
}
\`\`\`

字段说明：
- characters: 涉及的人物列表，无人则为[]
- segments: 文本片段数组，每个片段包含：
  - type: "narration"(旁白) 或 "dialogue"(对话)
  - speaker: 说话人（旁白固定为"旁白"，对话为角色名）
  - emotion: 情绪标签
  - tone: 语调标签
  - text: 添加标签后的文本内容

## 增强文本格式规则

1. 每个片段格式：(情绪,语调)文本内容
2. 旁白使用"旁白"作为speaker
3. 对话使用实际角色名作为speaker
4. 音频标签放在合适位置：[叹气]、[笑]、[颤抖]等
5. 保持原文内容不变，只添加标签

## 示例

输入段落：
"李明站在窗前，望着窗外的雨。三年了，他终于回来了。"

输出：
\`\`\`json
{
  "characters": ["李明"],
  "segments": [
    {
      "type": "narration",
      "speaker": "旁白",
      "emotion": "怅然",
      "tone": "深沉",
      "text": "(怅然,深沉)李明站在窗前，望着窗外的雨。[叹气]三年了，他终于回来了。"
    }
  ]
}
\`\`\`

输入段落：
"王芳激动地说：'你真的回来了！'"

输出：
\`\`\`json
{
  "characters": ["王芳"],
  "segments": [
    {
      "type": "narration",
      "speaker": "旁白",
      "emotion": "平静",
      "tone": "温柔",
      "text": "(平静,温柔)王芳激动地说："
    },
    {
      "type": "dialogue",
      "speaker": "王芳",
      "emotion": "兴奋",
      "tone": "活泼",
      "text": "(兴奋,活泼)[激动]'你真的回来了！'"
    }
  ]
}
\`\`\`

输入段落（混合内容）：
"李明叹了口气，说：'这些年，你过得好吗？'王芳低下头，轻声回答：'还好，只是有时候会想起以前的事。'"

输出：
\`\`\`json
{
  "characters": ["李明", "王芳"],
  "segments": [
    {
      "type": "narration",
      "speaker": "旁白",
      "emotion": "怅然",
      "tone": "深沉",
      "text": "(怅然,深沉)李明[叹气]叹了口气，说："
    },
    {
      "type": "dialogue",
      "speaker": "李明",
      "emotion": "无奈",
      "tone": "温柔",
      "text": "(无奈,温柔)'这些年，你过得好吗？'"
    },
    {
      "type": "narration",
      "speaker": "旁白",
      "emotion": "平静",
      "tone": "温柔",
      "text": "(平静,温柔)王芳低下头，轻声回答："
    },
    {
      "type": "dialogue",
      "speaker": "王芳",
      "emotion": "怅然",
      "tone": "温柔",
      "text": "(怅然,温柔)'还好，只是有时候会想起以前的事。'"
    }
  ]
}
\`\`\`

## 重要约束

- 必须返回有效的JSON格式
- emotion和tone必须从提供的标签列表中选择
- 将段落拆分为多个片段，每个片段明确标记是旁白还是对话
- 旁白speaker固定为"旁白"
- 对话speaker使用实际角色名
- 如果无法确定情绪，使用"平静"作为默认值
- 如果无法确定语调，使用"温柔"作为默认值
- 必须将叙述性内容和对话内容分开处理`;

/** 阅读模式逐段TTS情感增强User Prompt */
export function buildReadingModeTTSEnhanceUserPrompt(
	paragraphText: string,
	contextBefore: string,
	contextAfter: string,
	configuredCharacters: Array<{ name: string; aliases: string[]; voice?: string }>
): string {
	const charactersInfo = configuredCharacters.length > 0
		? configuredCharacters.map(c => {
			const aliasesStr = c.aliases?.length ? `（别称：${c.aliases.join('、')}）` : '';
			const voiceStr = c.voice ? ` [音色：${c.voice}]` : '';
			return `- ${c.name}${aliasesStr}${voiceStr}`;
		}).join('\n')
		: '无已配置角色';

	return `请分析以下小说段落，识别涉及的人物并判断情绪。

## 已配置的角色信息
${charactersInfo}

## 前文上下文
${contextBefore || '（无）'}

## 当前段落（需要分析）
${paragraphText}

## 后文上下文
${contextAfter || '（无）'}

## 分析要求
1. 从已配置的角色中匹配段落涉及的人物
2. 根据上下文判断段落的整体情绪氛围
3. 为文本添加合适的情绪和语调标签
4. 如果是对话，识别说话人

请严格按照系统提示中的JSON格式返回结果。`;
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
