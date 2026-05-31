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
	isVolume?: boolean;
	parentId?: number;
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
export type ErrorType = "typo" | "format" | "grammar" | "punctuation" | "network" | "timeout";

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

/** 角色类型枚举 */
export type CharacterRole =
	| "protagonist" // 男主
	| "heroine" // 女主
	| "antagonist" // 反派
	| "supportingMale" // 男配
	| "supportingFemale" // 女配
	| "mentor" // 导师
	| "rival" // 对手
	| "loveInterest" // 爱慕对象
	| "family" // 家人
	| "friend" // 朋友
	| "npc"; // NPC

/** 角色信息 */
export interface CharacterInfo {
	id: string;
	name: string;
	gender: "male" | "female" | "other";
	role?: CharacterRole; // 角色类型
	notes?: string;
	voice?: string; // 为该角色指定的音色
	aliases?: string[]; // 别称列表，如"我"、"主角"等
	relationTerms?: string[]; // 关系代称列表，如"老婆"、"老公"等
	order?: number; // 自定义排序顺序
}

/** 人物关系类型枚举 */
export type RelationType =
	| "couple" // 夫妻
	| "father-son" // 父子
	| "father-daughter" // 父女
	| "mother-son" // 母子
	| "mother-daughter" // 母女
	| "brother" // 兄弟
	| "sister" // 姐妹
	| "brother-sister" // 兄妹
	| "sister-brother" // 姐弟
	| "mother-daughter-in-law" // 婆媳（婆婆与儿媳）
	| "father-daughter-in-law" // 公媳（公公与儿媳）
	| "mother-son-in-law" // 岳母女婿
	| "father-son-in-law" // 翁婿（岳父与女婿）
	| "co-parents-male" // 亲家公
	| "co-parents-female" // 亲家母
	| "lover" // 恋人
	| "friend" // 朋友
	| "bestie" // 闺蜜
	| "rival" // 竞争对手
	| "master-disciple" // 师徒
	| "employer-employee" // 雇佣
	| "colleague" // 同事
	| "stranger" // 陌生人
	| "other"; // 其他

/** 人物关系 */
export interface CharacterRelationship {
	id: string;
	novelId: string;
	sourceId: string; // 关系源角色ID
	targetId: string; // 关系目标角色ID
	relationType?: RelationType[]; // 双人关系类型（可多个）
	customRelationType?: string; // 自定义关系类型（包含 "other" 时使用）
	sourceNickname: string[]; // 源角色对目标角色的称呼（可多个）
	targetNickname: string[]; // 目标角色对源角色的称呼（可多个）
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
