import { useState } from "react";
import {
	PROOFREAD_SYSTEM_PROMPT,
	PROOFREAD_SYSTEM_PROMPT_CHAPTER,
	SCRIPT_SYSTEM_PROMPT,
	SCRIPT_TTS_ENHANCE_SYSTEM_PROMPT,
	NOVEL_TTS_ENHANCE_SYSTEM_PROMPT,
	READING_MODE_TTS_ENHANCE_SYSTEM_PROMPT,
	CHAPTER_TITLE_SYSTEM_PROMPT,
	CHARACTER_REANALYSIS_SYSTEM_PROMPT,
} from "../../utils/aiClient";
import { logger } from "../../utils/logger";
import { Icons } from "../Icons";

interface PromptConfig {
	proofread: string;
	proofreadChapter: string;
	script: string;
	scriptTts: string;
	novelTts: string;
	readingModeTts: string;
	chapterTitle: string;
	characterReanalysis: string;
}

const DEFAULTS: Record<keyof PromptConfig, string> = {
	proofread: PROOFREAD_SYSTEM_PROMPT,
	proofreadChapter: PROOFREAD_SYSTEM_PROMPT_CHAPTER,
	script: SCRIPT_SYSTEM_PROMPT,
	scriptTts: SCRIPT_TTS_ENHANCE_SYSTEM_PROMPT,
	novelTts: NOVEL_TTS_ENHANCE_SYSTEM_PROMPT,
	readingModeTts: READING_MODE_TTS_ENHANCE_SYSTEM_PROMPT,
	chapterTitle: CHAPTER_TITLE_SYSTEM_PROMPT,
	characterReanalysis: CHARACTER_REANALYSIS_SYSTEM_PROMPT,
};

const LABELS: Record<keyof PromptConfig, { label: string; hint: string; rows: number }> = {
	proofread: { label: "校对系统 Prompt（段落级别）", hint: "用于逐段落校对检测", rows: 6 },
	proofreadChapter: { label: "校对系统 Prompt（章节级别）", hint: "用于整章节批量校对检测", rows: 6 },
	script: { label: "剧本转换系统 Prompt", hint: "用于将小说转换为剧本格式", rows: 8 },
	scriptTts: { label: "剧本 TTS 情感增强 Prompt", hint: "用于为剧本对话添加情感/音色标注", rows: 8 },
	novelTts: { label: "小说 TTS 情感增强 Prompt", hint: "用于为小说章节添加情感/音色标注", rows: 8 },
	readingModeTts: { label: "阅读模式 TTS 增强 Prompt", hint: "用于阅读模式下分析段落、识别人物、判断情绪", rows: 6 },
	chapterTitle: { label: "章节标题生成 Prompt", hint: "用于根据章节内容生成合适的章节标题", rows: 6 },
	characterReanalysis: { label: "角色重新分析 Prompt", hint: "用于重新分析角色小传，结合角色名、别称和关系代称", rows: 6 },
};

export function PromptSettingsSection({
	initialPromptConfig,
	onSave,
}: {
	initialPromptConfig: PromptConfig;
	onSave: (config: PromptConfig) => void;
}) {
	const [prompts, setPrompts] = useState<PromptConfig>(
		Object.fromEntries(Object.entries(initialPromptConfig).map(([k, v]) => [k, v || DEFAULTS[k as keyof PromptConfig]])) as PromptConfig
	);

	const handleCopy = async (text: string, label: string) => {
		try { await navigator.clipboard.writeText(text); logger.ui(`已复制: ${label}`); }
		catch (err) { logger.errorGeneric('复制失败:', err); }
	};

	return (
		<div className="config-section prompt-section">
			<div className="section-label"><Icons.punctuation size={14} />PROMPT</div>
			{(Object.keys(LABELS) as (keyof PromptConfig)[]).map((key) => (
				<div key={key} className="prompt-item">
					<div className="prompt-header">
						<label className="prompt-label">{LABELS[key].label}</label>
						<div className="prompt-actions">
							<button className="prompt-btn" onClick={() => handleCopy(prompts[key], LABELS[key].label)} title="复制">
								<Icons.copy size={14} />
							</button>
							<button className="prompt-btn" onClick={() => setPrompts(prev => ({ ...prev, [key]: DEFAULTS[key] }))} title="重置">
								<Icons.reset size={14} />
							</button>
						</div>
					</div>
					<textarea className="prompt-textarea" value={prompts[key]}
						onChange={(e) => setPrompts(prev => ({ ...prev, [key]: e.target.value }))}
						rows={LABELS[key].rows} />
					<p className="prompt-hint">{LABELS[key].hint}</p>
				</div>
			))}
			<button className="prompt-save-btn" onClick={() => onSave(prompts)}>
				<Icons.save size={14} />保存 PROMPT 设置
			</button>
		</div>
	);
}
