// ============================================================
// 剧本改编面板
// ============================================================
import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { useNovelStore } from "../stores/novelStore";
import { useAIConfigStore } from "../stores/aiConfigStore";
import { useCharacterStore } from "../stores/characterStore";
import { useConfigStore } from "../stores/configStore";
import { sendChatCompletion, buildScriptUserPrompt, SCRIPT_TTS_ENHANCE_SYSTEM_PROMPT, buildScriptTTSEnhanceUserPrompt, cleanEnhancedScript } from "../utils/aiClient";
import { exportToFile } from "../utils/fileExport";
import { EmptyState } from "./EmptyState";
import { Icons } from "./Icons";
import { Select } from "./Select";
import { ScriptTTSPlayer, parseScriptContent } from "../utils/ttsService";
import { scriptToPlainText, parseScriptBlocks } from "../utils/scriptMarkdown";
import type { ScriptBlock } from "../utils/scriptMarkdown";
import { ScriptRenderer } from "./ScriptRenderer";
import { logger } from "../utils/logger";
import type { ChatMessage } from "../utils/aiClient";
import type { Chapter, AIConfig, CharacterInfo } from "../types";

interface ScriptSegment {
	chapterTitle: string;
	content: string;
	originalText: string;
}

// 内部组件，使用 key 重置状态
function TaskPanelContent({
	chapter,
	aiConfig,
	currentNovelId,
	getCharacters,
	setScriptResult,
	getScriptResult,
}: {
	chapter: Chapter | undefined;
	aiConfig: AIConfig;
	currentNovelId: string | null;
	getCharacters: (novelId: string) => CharacterInfo[];
	setScriptResult: (chapterId: number, segments: ScriptSegment[]) => void;
	getScriptResult: (
		chapterId: number,
	) => { segments: ScriptSegment[] } | undefined;
}) {
	const [prompt, setPrompt] = useState("");
	const [processing, setProcessing] = useState(false);
	const [result, setResult] = useState<ScriptSegment[]>(() => {
		if (!chapter) return [];
		const cached = getScriptResult(chapter.id);
		return cached?.segments ?? [];
	});
	const [error, setError] = useState("");
	const [ttsPlaying, setTtsPlaying] = useState(false);
	const [ttsProcessing, setTtsProcessing] = useState(false);
	const [showVoiceSettings, setShowVoiceSettings] = useState(false);
	const [currentDialogueIndex, setCurrentDialogueIndex] = useState(-1);
	const [currentPlayingCharacter, setCurrentPlayingCharacter] = useState<string | undefined>(undefined);
	const scriptTTSRef = useRef<ScriptTTSPlayer | null>(null);
	const isEmotionTTSActiveRef = useRef(false);
	const ttsConfig = useConfigStore((s) => s.ttsConfig);
	const updateTTSConfig = useConfigStore((s) => s.updateTTSConfig);
	const promptConfig = useConfigStore((s) => s.promptConfig);
	const ttsConfigRef = useRef(ttsConfig);

	const detectedCharacters = useMemo(() => {
		if (result.length > 0 && result[0].content) {
			const { characters } = parseScriptContent(scriptToPlainText(result[0].content));
			return characters;
		}
		return [];
	}, [result]);

	// 根据角色信息获取音色
	const getVoiceForCharacter = useCallback((characterName: string): string => {
		if (!currentNovelId) return ttsConfig.voice || "冰糖";

		const characters = getCharacters(currentNovelId);
		let matchedCharacter: CharacterInfo | undefined;

		// 首先尝试精确匹配角色名
		matchedCharacter = characters.find(
			(c) => c.name.toLowerCase() === characterName.toLowerCase()
		);

		// 如果没有匹配到，尝试通过别称匹配（特别是"我"）
		if (!matchedCharacter) {
			matchedCharacter = characters.find(
				(c) => 
					c.aliases?.some(
						alias => alias.toLowerCase() === characterName.toLowerCase()
					)
			);
		}

		if (matchedCharacter) {
			// 如果角色指定了音色，使用指定的
			if (matchedCharacter.voice) {
				return matchedCharacter.voice;
			}

			// 根据性别推荐音色
			switch (matchedCharacter.gender) {
				case "male":
					return "苏打";
				case "female":
					return "冰糖";
				default:
					return ttsConfig.voice || "冰糖";
			}
		}

		return ttsConfig.voice || "冰糖";
	}, [currentNovelId, getCharacters, ttsConfig]);

	useEffect(() => {
		ttsConfigRef.current = ttsConfig;
	}, [ttsConfig]);

	// 获取角色的音色设计 prompt
	const getVoiceDesignPromptForCharacter = useCallback((characterName: string): string | undefined => {
		if (!currentNovelId) return undefined;
		const characters = getCharacters(currentNovelId);
		let matched = characters.find((c) => c.name.toLowerCase() === characterName.toLowerCase());
		if (!matched) {
			matched = characters.find(
				(c) => c.aliases?.some((alias) => alias.toLowerCase() === characterName.toLowerCase())
			);
		}
		if (!matched) return undefined;
		const designPrompt = matched.voiceDesignPrompt?.trim();
		const dialect = matched.dialect;
		if (designPrompt) {
			return dialect ? `${designPrompt}，说${dialect}` : designPrompt;
		}
		return undefined;
	}, [currentNovelId, getCharacters]);

	// 获取角色方言
	const getDialectForCharacter = useCallback((characterName: string): string | undefined => {
		if (!currentNovelId) return undefined;
		const characters = getCharacters(currentNovelId);
		let matched = characters.find((c) => c.name.toLowerCase() === characterName.toLowerCase());
		if (!matched) {
			matched = characters.find(
				(c) => c.aliases?.some((alias) => alias.toLowerCase() === characterName.toLowerCase())
			);
		}
		return matched?.dialect;
	}, [currentNovelId, getCharacters]);

	// 合并方言标签到文本
	const applyDialectLabel = useCallback((character: string, text: string): string => {
		const dialect = getDialectForCharacter(character);
		if (!dialect) return text;
		if (text.startsWith(`(${dialect},`) || text.startsWith(`(${dialect})`)) return text;
		const match = text.match(/^\(([^)]+)\)/);
		if (match) {
			return `(${dialect},${match[1]})${text.slice(match[0].length)}`;
		}
		return `(${dialect})${text}`;
	}, [getDialectForCharacter]);

	// 剧本情感朗读（直接利用剧本结构，无需AI分析）
	const handleEmotionTTS = useCallback(async (startDialogueIndex: number = 0) => {
		if (!ttsConfig.apiKey) {
			setError("请先在设置中配置 TTS API Key");
			return;
		}
		if (result.length === 0) return;

		// 停止当前播放
		if (scriptTTSRef.current) {
			isEmotionTTSActiveRef.current = false;
			scriptTTSRef.current.stop();
			scriptTTSRef.current = null;
		}

		setTtsProcessing(true);
		setError("");

		try {
			const blocks = parseScriptBlocks(result[0].content);
			const dialogues = blocks.filter((b): b is Extract<ScriptBlock, { type: "dialogue" }> => b.type === "dialogue");

			if (dialogues.length === 0) {
				setError("剧本中没有可朗读的对话");
				setTtsProcessing(false);
				return;
			}

			// 构建 characterVoices
			const characterVoices: Record<string, string> = { ...ttsConfig.characterVoices };
			for (const d of dialogues) {
				if (!characterVoices[d.character]) {
					characterVoices[d.character] = getVoiceForCharacter(d.character);
				}
			}

			const customTTSConfig = { ...ttsConfig, characterVoices };
			const scriptTTS = new ScriptTTSPlayer(customTTSConfig);
			scriptTTSRef.current = scriptTTS;
			isEmotionTTSActiveRef.current = true;

			scriptTTS.setOnUpdate(() => {
				if (!scriptTTSRef.current) return;
				const idx = scriptTTSRef.current.getCurrentIndex();
				const dlg = scriptTTSRef.current.getDialogues()[idx];
				setCurrentDialogueIndex(idx);
				setCurrentPlayingCharacter(dlg?.character);
			});
			scriptTTS.setOnComplete(() => {
				isEmotionTTSActiveRef.current = false;
				setTtsPlaying(false);
				setCurrentDialogueIndex(-1);
				setCurrentPlayingCharacter(undefined);
			});

			setTtsPlaying(true);
			setTtsProcessing(false);

			// 流式添加对话并立即开始播放
			for (let i = startDialogueIndex; i < dialogues.length; i++) {
				if (!isEmotionTTSActiveRef.current) break;

				const d = dialogues[i];
				let text = d.emotion ? `(${d.emotion})${d.text}` : d.text;
				text = applyDialectLabel(d.character, text);
				const voicePrompt = getVoiceDesignPromptForCharacter(d.character);

				await scriptTTS.addDialogueStream(d.character, text, undefined, voicePrompt);

				// 如果还没开始播放，第一个音频生成后启动播放
				if (i === startDialogueIndex && !scriptTTS.getIsPlaying()) {
					scriptTTS.play();
				}
			}

			if (isEmotionTTSActiveRef.current) {
				scriptTTS.markStreamComplete();
			}
		} catch (e) {
			isEmotionTTSActiveRef.current = false;
			setError(e instanceof Error ? e.message : "TTS播放失败");
			setTtsPlaying(false);
			setCurrentDialogueIndex(-1);
			setCurrentPlayingCharacter(undefined);
		} finally {
			setTtsProcessing(false);
		}
	}, [result, ttsConfig, getVoiceForCharacter, applyDialectLabel, getVoiceDesignPromptForCharacter]);

	// 点击对话行开始播放
	const handleDialogueClick = useCallback((index: number) => {
		if (!scriptTTSRef.current || !ttsPlaying) {
			handleEmotionTTS(index);
		} else {
			scriptTTSRef.current.skipTo(index);
		}
	}, [handleEmotionTTS, ttsPlaying]);

	const handleScriptTTS = useCallback(async () => {
		if (!ttsConfig.apiKey) {
			setError("请先在设置中配置 TTS API Key");
			return;
		}

		if (result.length === 0) return;

		if (scriptTTSRef.current) {
			scriptTTSRef.current.stop();
		}

		setTtsProcessing(true);
		setError("");

		try {
			// 获取当前小说的角色列表
			const characters = currentNovelId ? getCharacters(currentNovelId) : [];
			
			const ttsEnhanceAiConfig = {
				baseURL: aiConfig.baseURL,
				apiKey: aiConfig.apiKey,
				model: aiConfig.model,
				customHeaders: {},
				maxCharsPerRequest: 4000,
				enableLogging: aiConfig.enableLogging,
			};

			const enhanceMessages: ChatMessage[] = [
				{ role: "system", content: promptConfig.scriptTts || SCRIPT_TTS_ENHANCE_SYSTEM_PROMPT },
				{ role: "user", content: buildScriptTTSEnhanceUserPrompt(scriptToPlainText(result[0].content), characters) },
			];

			const enhancedScript = await sendChatCompletion(
				enhanceMessages,
				ttsEnhanceAiConfig,
			);

			logger.tts("=== 增强后的剧本内容（原始） ===");
			logger.tts(enhancedScript);

			const cleanedScript = cleanEnhancedScript(enhancedScript);
			const plainScript = scriptToPlainText(cleanedScript);
			logger.tts("=== 清理后的剧本内容 ===");
			logger.tts(plainScript);

			// 根据角色信息构建 characterVoices
			const { characters: detected } = parseScriptContent(plainScript);
			const characterVoices: Record<string, string> = { ...ttsConfig.characterVoices };
			for (const char of detected) {
				characterVoices[char] = characterVoices[char] || getVoiceForCharacter(char);
			}

			const customTTSConfig = {
				...ttsConfig,
				characterVoices,
			};

			scriptTTSRef.current = new ScriptTTSPlayer(customTTSConfig);
			scriptTTSRef.current.setOnUpdate(() => {});
			scriptTTSRef.current.setOnComplete(() => {
				setTtsPlaying(false);
			});

			scriptTTSRef.current.loadScript(plainScript, getVoiceDesignPromptForCharacter);

			logger.tts("=== 解析出的对话 ===", scriptTTSRef.current.getDialogues());

			setTtsPlaying(true);
			scriptTTSRef.current.play();
		} catch (e) {
			setError(e instanceof Error ? e.message : "TTS播放失败");
			setTtsPlaying(false);
		} finally {
			setTtsProcessing(false);
		}
	}, [result, ttsConfig, aiConfig, getVoiceForCharacter, getVoiceDesignPromptForCharacter, promptConfig, currentNovelId, getCharacters]);

	const handleScriptTTSStop = useCallback(() => {
		isEmotionTTSActiveRef.current = false;
		if (scriptTTSRef.current) {
			scriptTTSRef.current.stop();
			scriptTTSRef.current = null;
		}
		setTtsPlaying(false);
		setCurrentDialogueIndex(-1);
		setCurrentPlayingCharacter(undefined);
	}, []);

	const handleCharacterVoiceChange = useCallback((character: string, voice: string) => {
		const newCharacterVoices = { ...ttsConfig.characterVoices, [character]: voice };
		updateTTSConfig({ characterVoices: newCharacterVoices });
	}, [ttsConfig.characterVoices, updateTTSConfig]);

	const handleGenerate = useCallback(async () => {
		if (!chapter) return;

		const effectivePrompt = prompt.trim() || promptConfig.script;
		if (!aiConfig.apiKey) {
			setError("请先在设置中配置 API Key");
			return;
		}

		setProcessing(true);
		setError("");
		setResult([]);

		const chapterText = chapter.content.trim();

		if (!chapterText) {
			setError("当前章节没有可转换的内容");
			setProcessing(false);
			return;
		}

		try {
			const scriptAiConfig = {
				baseURL: aiConfig.baseURL,
				apiKey: aiConfig.apiKey,
				model: aiConfig.model,
				customHeaders: {},
				maxCharsPerRequest: 4000,
				enableLogging: aiConfig.enableLogging,
			};

			const characters = currentNovelId ? getCharacters(currentNovelId) : [];
			const messages: ChatMessage[] = [
				{ role: "system", content: effectivePrompt },
				{ role: "user", content: buildScriptUserPrompt(chapterText, characters) },
			];

			const segmentContent = await sendChatCompletion(
				messages,
				scriptAiConfig,
			);

			const segments: ScriptSegment[] = [{
				chapterTitle: chapter.title,
				content: segmentContent,
				originalText: chapterText,
			}];

			setResult(segments);
			setScriptResult(chapter.id, segments);
		} catch (e) {
			setError(e instanceof Error ? e.message : "生成失败");
		} finally {
			setProcessing(false);
		}
	}, [chapter, prompt, aiConfig, setScriptResult, promptConfig, currentNovelId, getCharacters]);

	const handleExport = useCallback(async () => {
		if (result.length === 0) return;

		const fullScript = result
			.map((s) => `// ${s.chapterTitle}\n\n${s.content}`)
			.join("\n\n" + "=".repeat(60) + "\n\n");

		await exportToFile(fullScript, `${chapter?.title ?? "剧本"}_改编.txt`);
	}, [result, chapter]);

	return (
		<>
			<div className="task-header">
				<h3>
					<Icons.script size={16} />
					剧本改编
				</h3>
				<span className="task-chapter">{chapter?.title}</span>
			</div>

			<div className="task-body">
				<div className="task-section">
					<div className="section-label">自定义提示词（可选）</div>
					<textarea
						value={prompt}
						onChange={(e) => setPrompt(e.target.value)}
						placeholder={promptConfig.script}
						className="prompt-textarea"
						rows={4}
					/>
				</div>

				<div className="task-actions">
					<button
						className="btn-generate"
						onClick={handleGenerate}
						disabled={processing}
					>
						{processing ? (
							<>
								<span className="spinner"></span>
								<span>转换中...</span>
							</>
						) : (
							<><Icons.play size={16} /> 按章节转换</>
						)}
					</button>
				</div>

				{error && <div className="task-error"><Icons.error size={14} /> {error}</div>}

				{/* 结果区域 */}
				<div className="task-result-wrapper">
					{result.length > 0 ? (
						<>
							<div className="result-content">
								<div className="result-summary">
									<span className="summary-count">
										章节转换完成
										{currentPlayingCharacter && ttsPlaying && (
											<span className="current-character-badge">
												正在朗读：{currentPlayingCharacter}
											</span>
										)}
									</span>
									<div className="script-tts-controls">
										{ttsPlaying ? (
											<button className="btn-script-tts stop" onClick={handleScriptTTSStop}>
												<Icons.pause size={14} /> 停止播放
											</button>
										) : (
											<>
												<button className="btn-script-tts" onClick={() => handleEmotionTTS()} disabled={ttsProcessing}>
													{ttsProcessing ? (
														<>
															<span className="spinner"></span>
															<span>准备中...</span>
														</>
													) : (
														<><Icons.bookHeadphones size={14} /> 情感朗读</>
													)}
												</button>
												<button className="btn-script-tts" onClick={handleScriptTTS} disabled={ttsProcessing} title="AI 增强情感配音">
													<Icons.sparkles size={14} /> AI增强
												</button>
											</>
										)}
										<button
											className={`btn-voice-settings ${showVoiceSettings ? "active" : ""}`}
											onClick={() => setShowVoiceSettings(!showVoiceSettings)}
										>
											<Icons.volume size={14} /> 角色音色
										</button>
									</div>
								</div>
								{showVoiceSettings && detectedCharacters.length > 0 && (
									<div className="voice-settings-panel">
										<div className="voice-settings-header">
											<span>角色音色设置</span>
											<span className="voice-settings-hint">为每个角色选择配音音色</span>
										</div>
										<div className="voice-settings-list">
											{detectedCharacters.map((character) => {
											const recommendedVoice = getVoiceForCharacter(character);
											const selectedVoice = ttsConfig.characterVoices[character] || recommendedVoice;
											return (
												<div key={character} className="voice-setting-item">
													<span className="character-name">{character}</span>
													<Select
														value={selectedVoice}
														onChange={(value) => handleCharacterVoiceChange(character, value)}
														options={[
															{ value: "冰糖", label: "冰糖（女）" },
															{ value: "茉莉", label: "茉莉（女）" },
															{ value: "苏打", label: "苏打（男）" },
															{ value: "白桦", label: "白桦（男）" },
															{ value: "Mia", label: "Mia（女英）" },
															{ value: "Chloe", label: "Chloe（女英）" },
															{ value: "Milo", label: "Milo（男英）" },
															{ value: "Dean", label: "Dean（男英）" }
														]}
													/>
												</div>
											);
										})}
										</div>
									</div>
								)}
								{result.map((seg, i) => (
									<div key={i} className="result-segment">
										<div className="segment-content">
										<ScriptRenderer
											content={seg.content}
											currentDialogueIndex={ttsPlaying ? currentDialogueIndex : -1}
											onDialogueClick={handleDialogueClick}
											characters={currentNovelId ? getCharacters(currentNovelId) : []}
										/>
									</div>
									</div>
								))}
							</div>
							{/* 右下角固定保存按钮 */}
							<div className="task-export-bar">
								<button className="btn" onClick={handleExport}>
									💾 导出剧本
								</button>
							</div>
						</>
					) : (
						<EmptyState
							icon="📄"
							message="点击「按章节转换」按钮，将当前章节内容转换为剧本格式"
						/>
					)}
				</div>
			</div>
		</>
	);
}

// 主组件
export function TaskPanel() {
	const chapters = useNovelStore((s) => s.chapters);
	const currentChapterIndex = useNovelStore((s) => s.currentChapterIndex);
	const currentNovelId = useNovelStore((s) => s.currentNovelId);
	const aiConfig = useAIConfigStore((s) => s.aiConfig);
	const setScriptResult = useNovelStore((s) => s.setScriptResult);
	const getScriptResult = useNovelStore((s) => s.getScriptResult);
	const getCharacters = useCharacterStore((s) => s.getCharacters);

	const chapter = chapters[currentChapterIndex];

	if (!chapter) {
		return (
			<div className="task-panel empty">
				<EmptyState icon={<Icons.script size={48} />} message="导入文件后可使用剧本改编功能" />
			</div>
		);
	}

	// 使用章节 ID 作为 key，确保章节切换时重新挂载组件
	return (
		<div className="task-panel">
			<TaskPanelContent
				key={chapter.id}
				chapter={chapter}
				aiConfig={aiConfig}
				currentNovelId={currentNovelId}
				getCharacters={getCharacters}
				setScriptResult={setScriptResult}
				getScriptResult={getScriptResult}
			/>
		</div>
	);
}
