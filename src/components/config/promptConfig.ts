import {
	PROOFREAD_SYSTEM_PROMPT,
	PROOFREAD_SYSTEM_PROMPT_CHAPTER,
	SCRIPT_SYSTEM_PROMPT,
	SCRIPT_TTS_ENHANCE_SYSTEM_PROMPT,
	NOVEL_TTS_ENHANCE_SYSTEM_PROMPT,
	READING_MODE_TTS_ENHANCE_SYSTEM_PROMPT,
	CHAPTER_TITLE_SYSTEM_PROMPT,
	CHARACTER_REANALYSIS_SYSTEM_PROMPT,
	CHARACTER_ANALYSIS_SYSTEM_PROMPT,
	WORLDBUILDING_ANALYSIS_SYSTEM_PROMPT,
	VOICE_DESIGN_SYSTEM_PROMPT,
	MAJOR_EVENTS_SYSTEM_PROMPT,
	MAJOR_EVENTS_MERGE_PROMPT,
	NOVEL_EVENTS_SYSTEM_PROMPT,
} from "../../utils/aiClient";

export interface PromptConfig {
	proofread: string;
	proofreadChapter: string;
	script: string;
	scriptTts: string;
	novelTts: string;
	readingModeTts: string;
	chapterTitle: string;
	characterReanalysis: string;
	characterAnalysis: string;
	worldbuilding: string;
	voiceDesign: string;
	majorEvents: string;
	majorEventsMerge: string;
	novelEvents: string;
}

export const DEFAULTS: Record<keyof PromptConfig, string> = {
	proofread: PROOFREAD_SYSTEM_PROMPT,
	proofreadChapter: PROOFREAD_SYSTEM_PROMPT_CHAPTER,
	script: SCRIPT_SYSTEM_PROMPT,
	scriptTts: SCRIPT_TTS_ENHANCE_SYSTEM_PROMPT,
	novelTts: NOVEL_TTS_ENHANCE_SYSTEM_PROMPT,
	readingModeTts: READING_MODE_TTS_ENHANCE_SYSTEM_PROMPT,
	chapterTitle: CHAPTER_TITLE_SYSTEM_PROMPT,
	characterReanalysis: CHARACTER_REANALYSIS_SYSTEM_PROMPT,
	characterAnalysis: CHARACTER_ANALYSIS_SYSTEM_PROMPT,
	worldbuilding: WORLDBUILDING_ANALYSIS_SYSTEM_PROMPT,
	voiceDesign: VOICE_DESIGN_SYSTEM_PROMPT,
	majorEvents: MAJOR_EVENTS_SYSTEM_PROMPT,
	majorEventsMerge: MAJOR_EVENTS_MERGE_PROMPT,
	novelEvents: NOVEL_EVENTS_SYSTEM_PROMPT,
};

export const LABELS: Record<keyof PromptConfig, { label: string; hint: string; rows: number }> = {
	proofread: { label: "校对系统 Prompt（段落级别）", hint: "用于逐段落校对检测", rows: 6 },
	proofreadChapter: { label: "校对系统 Prompt（章节级别）", hint: "用于整章节批量校对检测", rows: 6 },
	script: { label: "剧本转换系统 Prompt", hint: "用于将小说转换为剧本格式", rows: 8 },
	scriptTts: { label: "剧本 TTS 情感增强 Prompt", hint: "用于为剧本对话添加情感/音色标注", rows: 8 },
	novelTts: { label: "小说 TTS 情感增强 Prompt", hint: "用于为小说章节添加情感/音色标注", rows: 8 },
	readingModeTts: { label: "阅读模式 TTS 增强 Prompt", hint: "用于阅读模式下分析段落、识别人物、判断情绪", rows: 6 },
	chapterTitle: { label: "章节标题生成 Prompt", hint: "用于根据章节内容生成合适的章节标题", rows: 6 },
	characterReanalysis: { label: "角色重新分析 Prompt", hint: "用于重新分析角色小传，结合角色名、别称和关系代称", rows: 6 },
	characterAnalysis: { label: "角色分析 Prompt（全本）", hint: "用于从整本小说中提取角色信息、小传和关系图谱", rows: 8 },
	worldbuilding: { label: "世界观分析 Prompt", hint: "用于分析小说的世界观设定，生成结构化数据", rows: 8 },
	voiceDesign: { label: "音色设计生成 Prompt", hint: "用于根据角色信息生成TTS音色描述", rows: 6 },
	majorEvents: { label: "角色大事件分析 Prompt（单批）", hint: "用于逐批分析角色在文本片段中的关键经历", rows: 6 },
	majorEventsMerge: { label: "角色大事件合并 Prompt", hint: "用于合并各批次大事件结果，去重排序", rows: 6 },
	novelEvents: { label: "小说大事记生成 Prompt", hint: "用于从小说内容中提取并生成完整的大事记", rows: 8 },
};