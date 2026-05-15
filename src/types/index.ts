// ============================================================
// 类型定义
// ============================================================

/** 已导入的小说 */
export interface Novel {
	id: string;
	bookId?: number; // 按导入顺序分配的序号（1开始），由 store 自动分配
	name: string;
	author?: string; // 添加可选的作者字段
	fullText: string;
	importedAt: number; // timestamp
	lastCacheSaveTime?: number; // 最后缓存保存时间
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
	skipped: boolean;
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
	| "ollama"
	| "vllm"
	| "custom";

/** 校对任务队列项 */
export interface ProofreadQueueItem {
	id: string;
	chapterId: number;
	chapterTitle: string;
	novelId: string;
	status: "pending" | "running" | "done" | "error";
	errorMessage?: string;
	startTime?: number;
	endTime?: number;
}

/** 校对进度记录 */
export interface ProofreadProgress {
	novelId: string;
	chapterId: number;
	lastParagraphIndex: number; // 上次校对到的段落索引
	completed: boolean; // 是否已完成
	updatedAt: number;
}

/** API 使用统计 */
export interface APIUsage {
	totalRequests: number;
	successfulRequests: number;
	failedRequests: number;
	totalTokens: number;
	lastReset: number;
	providerStats: Record<string, {
		requests: number;
		success: number;
		failure: number;
		tokens: number;
	}>;
}

/** 小说分类类型 */
export type NovelCategory =
	| "xuanhuan" // 玄幻
	| "dushi" // 都市
	| "kehuan" // 科幻
	| "wuxia" // 武侠
	| "xianxia" // 仙侠
	| "lishi" // 历史
	| "love" // 言情
	| "shentan" // 悬疑
	| "dongman" // 动漫
	| "qita"; // 其他

/** 小说分类信息 */
export interface NovelCategoryInfo {
	id: NovelCategory;
	name: string;
	icon: string;
}

/** 阅读进度记录 */
export interface ReadingProgress {
	novelId: string;
	currentChapterIndex: number;
	currentParagraphIndex: number;
	readingStartTime: number;
	totalReadingTime: number; // 累计阅读时长（毫秒）
}

/** 角色信息 */
export interface CharacterInfo {
	id: string;
	name: string;
	gender: "male" | "female" | "other";
	notes?: string;
	voice?: string; // 为该角色指定的音色
	aliases?: string[]; // 别称列表，如"我"、"主角"等
	relationTerms?: string[]; // 关系代称列表，如"老婆"、"老公"等
}

/** 阅读背景类型 */
export type ReadingBackground =
	| "white"
	| "cream"
	| "sepia"
	| "mint"
	| "sky"
	| "lavender"
	| "peach"
	| "sage"
	| "slate"
	| "dark"
	| "custom";
