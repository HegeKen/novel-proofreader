import {
	PROOFREAD_SYSTEM_PROMPT,
	PROOFREAD_SYSTEM_PROMPT_CHAPTER,
	PROOFREAD_SYSTEM_PROMPT_DUAL,
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
	NOVEL_EVENTS_MERGE_PROMPT,
	CONTINUATION_SYSTEM_PROMPT,
	BRIDGE_SYSTEM_PROMPT,
	CHARACTER_FRAGMENT_SUMMARIZE_PROMPT,
	ROLEPLAY_SYSTEM_PROMPT,
	ROLEPLAY_MULTI_SYSTEM_PROMPT,
} from "../../utils/aiClient";

export interface PromptConfig {
	proofread: string;
	proofreadChapter: string;
	dualProofread: string;
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
	novelEventsMerge: string;
	continuation: string;
	bridge: string;
	characterFragmentSummarize: string;
	roleplay: string;
	roleplayMulti: string;
}

export const DEFAULTS: Record<keyof PromptConfig, string> = {
	proofread: PROOFREAD_SYSTEM_PROMPT,
	proofreadChapter: PROOFREAD_SYSTEM_PROMPT_CHAPTER,
	dualProofread: PROOFREAD_SYSTEM_PROMPT_DUAL,
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
	novelEventsMerge: NOVEL_EVENTS_MERGE_PROMPT,
	continuation: CONTINUATION_SYSTEM_PROMPT,
	bridge: BRIDGE_SYSTEM_PROMPT,
	characterFragmentSummarize: CHARACTER_FRAGMENT_SUMMARIZE_PROMPT,
	roleplay: ROLEPLAY_SYSTEM_PROMPT,
	roleplayMulti: ROLEPLAY_MULTI_SYSTEM_PROMPT,
};

export const LABELS: Record<keyof PromptConfig, { label: string; hint: string; rows: number }> = {
	proofread: { label: "校对系统 Prompt（段落级别）", hint: "用于逐段落校对检测", rows: 6 },
	proofreadChapter: { label: "校对系统 Prompt（章节级别）", hint: "用于整章节批量校对检测", rows: 6 },
	dualProofread: { label: "校对系统 Prompt（双段落合并）", hint: "用于对连续两个段落进行合并校对检测", rows: 6 },
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
	novelEventsMerge: { label: "小说大事记合并 Prompt", hint: "用于合并各批次大事记提取结果，去重排序", rows: 6 },
	continuation: { label: "AI 续写 Prompt", hint: "用于根据前文续写小说后续内容", rows: 6 },
	bridge: { label: "章节衔接 Prompt", hint: "用于在章节之间生成自然的过渡衔接段落", rows: 6 },
	characterFragmentSummarize: { label: "角色碎片整合 Prompt", hint: "用于整合同一角色多个阶段的分析数据，生成完整角色档案", rows: 8 },
	roleplay: { label: "角色扮演系统 Prompt（单角色）", hint: "用于 AI 扮演单个小说角色进行沉浸式对话", rows: 6 },
	roleplayMulti: { label: "角色扮演系统 Prompt（多角色）", hint: "用于 AI 同时扮演多个角色进行群像对话", rows: 6 },
};