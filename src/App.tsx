// ============================================================
// 主布局 - Apple Liquid Glass Design
// ============================================================
import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import { NovelList } from "./components/NovelList";
import { ChapterNav } from "./components/ChapterNav";
import { ReaderPanel } from "./components/ReaderPanel";
import { ProofreadPanel } from "./components/ProofreadPanel";
import { TaskPanel } from "./components/TaskPanel";
import { GlobalSearch } from "./components/GlobalSearch";
import { ToastContainer } from "./components/Toast";
import { useNovelStore } from "./stores/novelStore";
import { useUIStore } from "./stores/uiStore";
import { useAppMetaStore } from "./stores/appMetaStore";
import { useAIConfigStore } from "./stores/aiConfigStore";
import { useProofreadMetaStore } from "./stores/proofreadMetaStore";
import { splitChapters } from "./utils/chapterSplit";
import { decodeTextBuffer } from "./utils/decodeText";
import { exportToFile, loadNovelsFromStorage, loadNovelContent, saveNovelToStorage, ensureTxtFilename, exportAllData } from "./utils/fileExport";
import { formatDateTime } from "./utils/formatters";
import { parseURLParams, updateURLParams } from "./utils/urlParams";
import { Icons } from "./components/Icons";
import { logger } from "./utils/logger";
import { audioCache } from "./utils/ttsService";
import { useConfigStore } from "./stores/configStore";
import { useMobile } from "./hooks/useMobile";

const ConfigModal = lazy(() => import("./components/ConfigModal").then(m => ({ default: m.ConfigModal })));
const CharacterSettings = lazy(() => import("./components/CharacterSettings").then(m => ({ default: m.CharacterSettings })));
const HomePage = lazy(() => import("./components/HomePage").then(m => ({ default: m.HomePage })));

type RightTab = "proofread" | "task";
type MobileTab = "novels" | "chapters" | "reader" | "task" | "settings";

const VISITED_KEY = "proofreader_has_visited";

function hasVisited(): boolean {
	try {
		return localStorage.getItem(VISITED_KEY) === "true";
	} catch {
		return false;
	}
}

function markAsVisited(): void {
	try {
		localStorage.setItem(VISITED_KEY, "true");
	} catch {
		logger.warn('App - Failed to save visited state to localStorage');
	}
}

export default function App() {
	const urlParams = new URLSearchParams(window.location.search);
	const hasBookIdParam = urlParams.has("bookId");
	const [showHome, setShowHome] = useState(!hasVisited() && !hasBookIdParam);
	const novels = useNovelStore((s) => s.novels);
	const currentNovelId = useNovelStore((s) => s.currentNovelId);
	const setChapters = useNovelStore((s) => s.setChapters);
	const theme = useUIStore((s) => s.theme);
	const setTheme = useUIStore((s) => s.setTheme);
	const saveCache = useNovelStore((s) => s.saveCache);
	const lastCacheSaveTime = useNovelStore((s) => s.lastCacheSaveTime);
	const chapters = useNovelStore((s) => s.chapters);
	const currentChapterIndex = useNovelStore((s) => s.currentChapterIndex);
	const setCurrentChapterIndex = useNovelStore((s) => s.setCurrentChapterIndex);
	const readingMode = useUIStore((s) => s.readingMode);
	const setReadingMode = useUIStore((s) => s.setReadingMode);
	const selectNovel = useNovelStore((s) => s.selectNovel);
	const showCharacterSettings = useUIStore((s) => s.showCharacterSettings);
	const setShowCharacterSettings = useUIStore((s) => s.setShowCharacterSettings);
	const toastMessages = useAppMetaStore((s) => s.toastMessages);
	const hideToast = useAppMetaStore((s) => s.hideToast);
	const [configOpen, setConfigOpen] = useState(false);
	const [rightTab, setRightTab] = useState<RightTab>("proofread");
	const [mobileTab, setMobileTab] = useState<MobileTab>("novels");
	const { isMobile } = useMobile();

	const handleStartApp = useCallback(() => {
		markAsVisited();
		setShowHome(false);
	}, []);

	useEffect(() => {
		document.documentElement.setAttribute("data-theme", theme);
	}, [theme]);

	const audioCachePersistent = useConfigStore((s) => s.ttsConfig.audioCachePersistent);
	useEffect(() => {
		audioCache.setPersistent(audioCachePersistent);
	}, [audioCachePersistent]);

	useEffect(() => {
		if (novels.length === 0) {
			loadNovelsFromStorage().then(async (storedFileNames) => {
				if (storedFileNames.length > 0) {
					const loadedNovels: typeof novels = [];
					for (const fileName of storedFileNames) {
						const content = await loadNovelContent(fileName);
						if (content) {
							const novelId = `novel-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
							loadedNovels.push({
								id: novelId,
								name: fileName.replace(/\.txt$/i, ''),
								fullText: content,
								importedAt: Date.now(),
								chapters: [],
							});
						}
					}
					
					if (loadedNovels.length > 0) {
						const persistedState = useNovelStore.getState();
						const currentOldNovel = persistedState.novels.find(n => n.id === persistedState.currentNovelId);
						const matchedNovel = currentOldNovel
							? loadedNovels.find(n => n.name === currentOldNovel.name)
							: undefined;
						const selectedNovel = matchedNovel || loadedNovels[0];
						useNovelStore.setState({
							novels: loadedNovels,
							currentNovelId: selectedNovel.id,
						});
						const chapters = splitChapters(selectedNovel.fullText);
						const progress = useAppMetaStore.getState().getReadingProgress(selectedNovel.id);
						useNovelStore.setState({ chapters });
						if (progress) {
							useNovelStore.setState({ currentChapterIndex: progress.currentChapterIndex });
						}
					}
				}
			});
		}
	}, [novels.length]);

	useEffect(() => {
		const params = parseURLParams();
		const bookId = params.bookId;
		if (bookId === undefined) return;

		const trySelect = () => {
			const novel = novels.find(n => n.bookId === bookId);
			if (!novel) {
				logger.info('[App]', `trySelect: bookId=${bookId}, 未找到小说`);
				return false;
			}

			// 动态获取最新状态
			const currentState = useNovelStore.getState();
			
			logger.info('[App]', `trySelect: bookId=${bookId}, novel.id=${novel.id}, currentNovelId=${currentState.currentNovelId}, chapters.length=${currentState.chapters.length}, currentChapterIndex=${currentState.currentChapterIndex}`);
			
			// 如果已经是当前选中的小说且章节已加载，不需要重新设置
			if (currentState.currentNovelId === novel.id && currentState.chapters.length > 0) {
				logger.info('[App]', `trySelect: 已选中当前小说，检查章节是否变化`);
				// 只有在 URL 参数明确指定了不同章节时才更新章节索引
				if (params.chapter !== undefined && params.chapter >= 0 && params.chapter !== currentState.currentChapterIndex) {
					logger.info('[App]', `trySelect: 章节变化，从 ${currentState.currentChapterIndex} 切换到 ${params.chapter}`);
					setCurrentChapterIndex(params.chapter);
				} else {
					logger.info('[App]', `trySelect: 章节未变化，保持当前章节 ${currentState.currentChapterIndex}`);
				}
				return true;
			}

			logger.info('[App]', `trySelect: 选中新小说 ${novel.id}, bookId=${novel.bookId}`);
			selectNovel(novel.id);
			if (novel.fullText) {
				const chapters = splitChapters(novel.fullText);
				logger.info('[App]', `trySelect: 设置章节，共 ${chapters.length} 章`);
				currentState.setChapters(chapters);
			}
			if (params.chapter !== undefined && params.chapter >= 0) {
				logger.info('[App]', `trySelect: 设置初始章节 ${params.chapter}`);
				setCurrentChapterIndex(params.chapter);
			}
			if (params.readingMode === "true") {
				setReadingMode(true);
			} else {
				setReadingMode(false);
			}
			setShowHome(false);
			return true;
		};

		if (novels.length > 0) {
			trySelect();
		} else {
			const checkInterval = setInterval(() => {
				if (trySelect()) {
					clearInterval(checkInterval);
				}
			}, 100);
			setTimeout(() => clearInterval(checkInterval), 5000);
		}
	}, [novels, selectNovel, setCurrentChapterIndex, setReadingMode, setShowHome]);

	useEffect(() => {
		if (!currentNovelId) return;
		const novel = novels.find((n) => n.id === currentNovelId);
		if (!novel) return;

		updateURLParams({
			bookId: novel.bookId,
			chapter: currentChapterIndex,
			readingMode: readingMode ? "true" : "false",
		});
	}, [currentNovelId, currentChapterIndex, readingMode, novels]);

	const handleTitleClick = useCallback((e: React.MouseEvent) => {
		e.preventDefault();
		setShowHome(true);
		if (isMobile) {
			setMobileTab("novels");
		}
	}, [setShowHome, isMobile, setMobileTab]);

	const handleVolumeKey = useCallback(
		(e: KeyboardEvent) => {
			if (!isMobile) return;

			if (e.code === "VolumeUp") {
				e.preventDefault();
				e.stopPropagation();
				if (currentChapterIndex > 0) {
					setCurrentChapterIndex(currentChapterIndex - 1);
				}
			} else if (e.code === "VolumeDown") {
				e.preventDefault();
				e.stopPropagation();
				if (currentChapterIndex < chapters.length - 1) {
					setCurrentChapterIndex(currentChapterIndex + 1);
				}
			}
		},
		[isMobile, currentChapterIndex, chapters.length, setCurrentChapterIndex],
	);

	useEffect(() => {
		window.addEventListener("keydown", handleVolumeKey);
		return () => window.removeEventListener("keydown", handleVolumeKey);
	}, [handleVolumeKey]);

	const handleImport = async () => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = ".txt";
		input.onchange = async (e) => {
			const file = (e.target as HTMLInputElement).files?.[0];
			if (!file) return;

			const buffer = await file.arrayBuffer();
			const text = decodeTextBuffer(buffer);
			const chapters = splitChapters(text);
			setChapters(chapters);
		};
		input.click();
	};

	const handleExportAsNew = async () => {
		const novel = novels.find((n) => n.id === currentNovelId);
		if (!novel) return;
		await exportToFile(novel.fullText, `${novel.name}.txt`);
	};

	const handleSaveToOriginal = async () => {
		const novel = novels.find((n) => n.id === currentNovelId);
		if (!novel) return;
		if (!confirm(`确定要覆盖原文件 "${novel.name}" 吗？此操作不可撤销。`)) {
			return;
		}
		const result = await exportToFile(
			novel.fullText,
			`${novel.name}.txt`,
		);
		if (result === "success") {
			useAppMetaStore.getState().showToast("文件已成功保存！", "success");
		} else if (result === "fallback") {
			useAppMetaStore.getState().showToast("文件已下载！请手动覆盖原文件。", "success");
		}
	};

	const handleExportNovel = async () => {
		const novel = novels.find((n) => n.id === currentNovelId);
		if (!novel) return;
		await exportToFile(novel.fullText, `${novel.name}_edited.txt`);
	};

	const handleSaveCache = async () => {
		saveCache();
		const novel = novels.find((n) => n.id === currentNovelId);
		if (novel?.fullText) {
			await saveNovelToStorage(ensureTxtFilename(novel.name), novel.fullText);
		}
		const now = new Date();
		const timeStr = now.toLocaleTimeString("zh-CN", {
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		});
		logger.file("缓存已保存！", `保存时间：${timeStr}`);
	};

	const handleExportAllData = async () => {
		const novelState = useNovelStore.getState();
		const aiConfigState = useAIConfigStore.getState();
		const metaState = useAppMetaStore.getState();
		const proofreadMetaState = useProofreadMetaStore.getState();
		const includeSensitiveData = confirm("⚠️ 安全提示：导出包含 API 密钥后，任何获取该文件的人都能使用你的 API Key。\n\n选择「确定」包含敏感信息，选择「取消」则自动脱敏（推荐）。");
		await exportAllData({
			novels: novelState.novels,
			aiConfig: {
				...aiConfigState.aiConfig,
				apiKey: includeSensitiveData ? aiConfigState.aiConfig.apiKey : "[REDACTED]",
			},
			apiUsage: metaState.apiUsage,
			novelCategories: metaState.novelCategories,
			readingProgress: metaState.readingProgress,
			ignoredWords: proofreadMetaState.ignoredWords,
			exportTime: formatDateTime(Date.now()),
			version: "0.10.1",
		});
	};

	const handleMobileTabChange = (tab: MobileTab) => {
		setMobileTab(tab);
		if (tab === "task") {
			setRightTab(tab);
		}
	};

	return (
		<div className="app">
			{showHome ? (
				<Suspense fallback={null}>
					<HomePage onStart={handleStartApp} />
				</Suspense>
			) : (
				<>
					<header className="app-header">
				<div className="header-left">
					<h1 className="app-title">
						<a href="/" onClick={handleTitleClick} style={{ textDecoration: "none", color: "inherit", display: "flex", alignItems: "center", gap: "8px" }}>
							<img src="/icons/icon.png" alt="" className="app-icon" />
							AI排版校对助手
						</a>
					</h1>
				</div>
				<div className="header-center">
					<button className={isMobile ? "btn-mobile" : "btn"} onClick={handleImport} aria-label="导入 TXT 文件">
							<Icons.import size={16} />
							导入 TXT 文件
						</button>
						{currentNovelId && (
							<>
								<button className={isMobile ? "btn-mobile" : "btn"} onClick={handleExportAsNew}>
									<Icons.save size={16} />
									导出修改版本
								</button>
								<button
									className={isMobile ? "btn-mobile" : "btn"}
									onClick={handleSaveToOriginal}
								>
									<Icons.fileOutput size={16} />
									保存到原文件
								</button>
								<button
									className={isMobile ? "btn-mobile" : "btn"}
									onClick={handleSaveCache}
									title="手动保存当前进度到缓存"
								>
									<Icons.cache size={16} />
									保存缓存
									{lastCacheSaveTime && (
										<span className="cache-time">
											(
											{new Date(lastCacheSaveTime).toLocaleTimeString("zh-CN", {
												hour: "2-digit",
												minute: "2-digit",
											})}
											)
										</span>
									)}
								</button>
								<button
									className={isMobile ? "btn-mobile" : "btn"}
									onClick={handleExportAllData}
									title="导出所有设置和校对结果"
								>
									<Icons.downloadCloud size={16} />
									导出全部数据
								</button>
							</>
						)}
				</div>
				<div className="header-right">
					{isMobile && currentNovelId && (
						<button
							className={isMobile ? "btn-mobile" : "btn"}
							onClick={handleExportNovel}
							title="导出整本小说"
							aria-label="导出整本小说"
						>
							<Icons.download size={18} />
						</button>
					)}
					{isMobile && currentNovelId && (
						<button
							className={isMobile ? "btn-mobile" : "btn"}
							onClick={handleSaveCache}
							title="保存缓存"
							aria-label="保存缓存"
						>
							<Icons.cache size={18} />
						</button>
					)}
					{isMobile && currentNovelId && (
						<button
							className={isMobile ? "btn-mobile" : "btn"}
							onClick={handleSaveToOriginal}
							title="保存到原文件"
							aria-label="保存到原文件"
						>
							<Icons.fileOutput size={18} />
						</button>
					)}
					<button
						className={isMobile ? "btn-mobile" : "btn"}
						onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
						title={theme === "dark" ? "切换到亮色模式" : "切换到深色模式"}
						aria-label={theme === "dark" ? "切换到亮色模式" : "切换到深色模式"}
					>
						{theme === "dark" ? <Icons.sun size={18} /> : <Icons.moon size={18} />}
						{!isMobile && (theme === "dark" ? "切换到亮色" : "切换到深色")}
					</button>
					<GlobalSearch />
					<button className={isMobile ? "btn-mobile" : "btn"} onClick={() => setConfigOpen(true)} aria-label="设置">
						<Icons.bolt size={18} />
						{!isMobile && "设置"}
					</button>
				</div>
			</header>

			<div className={`app-body ${isMobile && readingMode ? "app-body-reading-mode" : ""}`}>
				<aside
					className={`app-novel-list ${isMobile && mobileTab === "novels" ? "mobile-active" : ""} ${!isMobile && readingMode ? "hidden-panel" : ""}`}
				>
					<NovelList
						onNovelSelect={() => isMobile && setMobileTab("chapters")}
					/>
				</aside>

				<aside
					className={`app-sidebar ${isMobile && mobileTab === "chapters" ? "mobile-active" : ""} ${!isMobile && readingMode ? "hidden-panel" : ""}`}
				>
					<ChapterNav
						onChapterSelect={() => isMobile && setMobileTab("reader")}
					/>
				</aside>

				<main
					className={`app-main ${rightTab === "task" ? "task-mode" : ""} ${isMobile && mobileTab === "reader" ? "mobile-fullscreen" : isMobile ? "hidden" : ""} ${!isMobile && readingMode ? "" : ""}`}
				>
					{isMobile && mobileTab === "reader" && (
						<div className="mobile-reader-proofread">
							<div className="mobile-reader-section">
								<ReaderPanel showReadingModeToggle={true} isMobile={isMobile} />
							</div>

							{!readingMode && (
								<div className="mobile-proofread-section">
									<div className="right-content">
										<ProofreadPanel />
									</div>
								</div>
							)}
						</div>
					)}
					{!isMobile && <ReaderPanel showReadingModeToggle={true} isMobile={isMobile} />}
				</main>

				<aside
					className={`app-right ${rightTab === "task" ? "task-mode" : ""} ${isMobile && mobileTab === "task" ? "mobile-active" : ""} ${!isMobile && readingMode ? "hidden-panel" : ""}`}
				>
					{isMobile && mobileTab === "task" ? (
						<TaskPanel />
					) : (
						<>
							<div className="right-tabs">
								<button
									className={`tab-btn ${rightTab === "proofread" ? "active" : ""}`}
									onClick={() => setRightTab("proofread")}
								>
									<Icons.search size={16} />
									校对检测
								</button>
								<button
									className={`tab-btn ${rightTab === "task" ? "active" : ""}`}
									onClick={() => setRightTab("task")}
								>
									<Icons.script size={16} />
									剧本改编
								</button>
							</div>
							<div className="right-content">
								{rightTab === "proofread" ? <ProofreadPanel /> : <TaskPanel />}
							</div>
						</>
					)}
				</aside>
			</div>

			{isMobile && !(readingMode && mobileTab === "reader") && (
				<>
					<div className="mobile-tab-bar" role="tablist">
						<button
							className={`mobile-tab-btn ${mobileTab === "novels" ? "active" : ""}`}
							onClick={() => handleMobileTabChange("novels")}
							role="tab"
							aria-selected={mobileTab === "novels"}
							aria-label="小说列表"
						>
							<Icons.library size={18} />
							<span>小说</span>
						</button>
						<button
							className={`mobile-tab-btn ${mobileTab === "chapters" ? "active" : ""}`}
							onClick={() => handleMobileTabChange("chapters")}
							role="tab"
							aria-selected={mobileTab === "chapters"}
							aria-label="章节导航"
						>
							<Icons.list size={18} />
							<span>章节</span>
						</button>
						<button
							className={`mobile-tab-btn ${mobileTab === "reader" ? "active" : ""}`}
							onClick={() => handleMobileTabChange("reader")}
							role="tab"
							aria-selected={mobileTab === "reader"}
							aria-label="阅读校对"
						>
							<Icons.book size={18} />
							<span>阅读</span>
						</button>
						<button
							className={`mobile-tab-btn ${mobileTab === "task" ? "active" : ""}`}
							onClick={() => handleMobileTabChange("task")}
							role="tab"
							aria-selected={mobileTab === "task"}
							aria-label="剧本改编"
						>
							<Icons.script size={18} />
							<span>剧本</span>
						</button>
					</div>
					
				</>
			)}

			<Suspense fallback={null}>
				<ConfigModal open={configOpen} onClose={() => setConfigOpen(false)} />
			</Suspense>
			{showCharacterSettings && (
				<Suspense fallback={null}>
					<CharacterSettings
						novelId={showCharacterSettings}
						novelName={novels.find(n => n.id === showCharacterSettings)?.name || ""}
						onClose={() => setShowCharacterSettings(null)}
					/>
				</Suspense>
			)}
			<ToastContainer
				messages={toastMessages}
				onClose={hideToast}
			/>
		</>
	)}

		</div>
	);
}