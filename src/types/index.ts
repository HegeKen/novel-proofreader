// ============================================================
// 类型定义
// ============================================================

/** 已导入的小说 */
export interface Novel {
	id: string;
	name: string;
	author?: string; // 添加可选的作者字段
	fullText: string;
	importedAt: number; // timestamp
	chapters: Array<{
		title: string;
		content: string;
	}>;
}

/** 章节 */
export interface Chapter {
	id: number;
	title: string;
	startIndex: number;
	endIndex: number;
	content: string;
}

/** AI 模型配置 */
export interface AIConfig {
	baseURL: string;
	apiKey: string;
	model: string;
	customHeaders: Record<string, string>;
	maxCharsPerRequest: number;
	enableLogging: boolean;
}

/** 错误类型 */
export type ErrorType = "typo" | "format" | "grammar" | "punctuation";

/** 单个检测错误 */
export interface ProofreadError {
	id: string;
	startIndex: number;
	endIndex: number;
	errorType: ErrorType;
	suggestion: string;
	originalText: string;
	/** AI 建议的修正文本（用于替换） */
	correctedText: string;
	applied: boolean;
}

/** 段落检测结果 */
export interface ParagraphResult {
	paragraphIndex: number;
	originalText: string;
	errors: ProofreadError[];
	status: "pending" | "checking" | "done" | "error";
	errorMessage?: string;
}

/** 检测粒度 */
export type CheckGranularity = "paragraph" | "chapter" | "line";

/** 剧本转换任务状态 */
export interface ScriptTask {
	id: number;
	chapterId: number;
	chapterTitle: string;
	status: "pending" | "running" | "done" | "error";
	result?: string;
	errorMessage?: string;
}

/** 应用标签页 */
export type AppTab = "proofread" | "script";

/** AI 模型提供商 */
export type AIProvider =
	| "openai"
	| "deepseek"
	| "siliconflow"
	| "mimo"
	| "lmstudio"
	| "custom";
