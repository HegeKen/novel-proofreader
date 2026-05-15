// ============================================================
// 剧本改编面板
// ============================================================
import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { useAppStore } from "../stores/appStore";
import { useConfigStore } from "../stores/configStore";
import { sendChatCompletion, buildScriptUserPrompt, SCRIPT_TTS_ENHANCE_SYSTEM_PROMPT, buildScriptTTSEnhanceUserPrompt, cleanEnhancedScript } from "../utils/aiClient";
import { exportToFile } from "../utils/fileExport";
import { EmptyState } from "./EmptyState";
import { Icons } from "./Icons";
import { SCRIPT_SYSTEM_PROMPT } from "../utils/aiClient";
import { ScriptTTSPlayer, parseScriptContent } from "../utils/ttsService";
import type { ChatMessage } from "../utils/aiClient";
import type { Chapter, AIConfig, CharacterInfo } from "../types";

interface ScriptSegment {
	chapterTitle: string;
	content: string;
	originalText: string;
}

const DEFAULT_PROMPT = SCRIPT_SYSTEM_PROMPT;

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
	const scriptTTSRef = useRef<ScriptTTSPlayer | null>(null);
	const ttsConfig = useConfigStore((s) => s.ttsConfig);
	const updateTTSConfig = useConfigStore((s) => s.updateTTSConfig);
	const ttsConfigRef = useRef(ttsConfig);

	const detectedCharacters = useMemo(() => {
		if (result.length > 0 && result[0].content) {
			const { characters } = parseScriptContent(result[0].content);
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
			const ttsEnhanceAiConfig = {
				baseURL: aiConfig.baseURL,
				apiKey: aiConfig.apiKey,
				model: aiConfig.model,
				customHeaders: {},
				maxCharsPerRequest: 4000,
				enableLogging: aiConfig.enableLogging,
			};

			const enhanceMessages: ChatMessage[] = [
				{ role: "system", content: SCRIPT_TTS_ENHANCE_SYSTEM_PROMPT },
				{ role: "user", content: buildScriptTTSEnhanceUserPrompt(result[0].content) },
			];

			const enhancedScript = await sendChatCompletion(
				enhanceMessages,
				ttsEnhanceAiConfig,
			);

			console.log("=== 增强后的剧本内容（原始） ===");
			console.log(enhancedScript);

			const cleanedScript = cleanEnhancedScript(enhancedScript);
			console.log("=== 清理后的剧本内容 ===");
			console.log(cleanedScript);

			// 根据角色信息构建 characterVoices
			const { characters: detected } = parseScriptContent(cleanedScript);
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

			scriptTTSRef.current.loadScript(cleanedScript);
			
			console.log("=== 解析出的对话 ===");
			console.log(scriptTTSRef.current.getDialogues());

			setTtsPlaying(true);
			scriptTTSRef.current.play();
		} catch (e) {
			setError(e instanceof Error ? e.message : "TTS播放失败");
			setTtsPlaying(false);
		} finally {
			setTtsProcessing(false);
		}
	}, [result, ttsConfig, aiConfig, getVoiceForCharacter]);

	const handleScriptTTSStop = useCallback(() => {
		if (scriptTTSRef.current) {
			scriptTTSRef.current.stop();
			setTtsPlaying(false);
		}
	}, []);

	const handleCharacterVoiceChange = useCallback((character: string, voice: string) => {
		const newCharacterVoices = { ...ttsConfig.characterVoices, [character]: voice };
		updateTTSConfig({ characterVoices: newCharacterVoices });
	}, [ttsConfig.characterVoices, updateTTSConfig]);

	const handleGenerate = useCallback(async () => {
		if (!chapter) return;

		const effectivePrompt = prompt.trim() || DEFAULT_PROMPT;
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

			const messages: ChatMessage[] = [
				{ role: "system", content: effectivePrompt },
				{ role: "user", content: buildScriptUserPrompt(chapterText) },
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
	}, [chapter, prompt, aiConfig, setScriptResult]);

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
						placeholder={DEFAULT_PROMPT}
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
									</span>
									<div className="script-tts-controls">
										{ttsPlaying ? (
											<button className="btn-script-tts stop" onClick={handleScriptTTSStop}>
												<Icons.pause size={14} /> 停止播放
											</button>
										) : (
											<button className="btn-script-tts" onClick={handleScriptTTS} disabled={ttsProcessing}>
												{ttsProcessing ? (
													<>
														<span className="spinner"></span>
														<span>准备中...</span>
													</>
												) : (
													<><Icons.bookHeadphones size={14} /> 角色配音</>
												)}
											</button>
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
													<select
														value={selectedVoice}
														onChange={(e) => handleCharacterVoiceChange(character, e.target.value)}
														className="voice-select"
													>
														<option value="冰糖">冰糖（女）</option>
														<option value="茉莉">茉莉（女）</option>
														<option value="苏打">苏打（男）</option>
														<option value="白桦">白桦（男）</option>
														<option value="Mia">Mia（女英）</option>
														<option value="Chloe">Chloe（女英）</option>
														<option value="Milo">Milo（男英）</option>
														<option value="Dean">Dean（男英）</option>
													</select>
												</div>
											);
										})}
										</div>
									</div>
								)}
								{result.map((seg, i) => (
									<div key={i} className="result-segment">
										<div className="segment-header">
											<span className="segment-index"><Icons.grammar size={12} /> {seg.chapterTitle}</span>
										</div>
										<div className="segment-content">{seg.content}</div>
									</div>
								))}
							</div>
							{/* 右下角固定保存按钮 */}
							<div className="task-export-bar">
								<button className="btn-export" onClick={handleExport}>
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
	const chapters = useAppStore((s) => s.chapters);
	const currentChapterIndex = useAppStore((s) => s.currentChapterIndex);
	const currentNovelId = useAppStore((s) => s.currentNovelId);
	const aiConfig = useAppStore((s) => s.aiConfig);
	const setScriptResult = useAppStore((s) => s.setScriptResult);
	const getScriptResult = useAppStore((s) => s.getScriptResult);
	const getCharacters = useAppStore((s) => s.getCharacters);

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
