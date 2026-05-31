// ============================================================
// 主布局 - Apple Liquid Glass Design
// ============================================================
import { useState, useEffect, useCallback } from "react";
import { NovelList } from "./components/NovelList";
import { ChapterNav } from "./components/ChapterNav";
import { ReaderPanel } from "./components/ReaderPanel";
import { ProofreadPanel } from "./components/ProofreadPanel";
import { TaskPanel } from "./components/TaskPanel";
import { ConfigModal } from "./components/ConfigModal";
import { CharacterSettings } from "./components/CharacterSettings";
import { GlobalSearch } from "./components/GlobalSearch";
import { HomePage } from "./components/HomePage";
import { useAppStore } from "./stores/appStore";
import { splitChapters } from "./utils/chapterSplit";
import { decodeTextBuffer } from "./utils/decodeText";
import { exportToFile, loadNovelsFromStorage, loadNovelContent, saveNovelToStorage, ensureTxtFilename, exportAllData } from "./utils/fileExport";
import { formatDateTime } from "./utils/formatters";
import { parseURLParams, updateURLParams } from "./utils/urlParams";
import { Icons } from "./components/Icons";
import { logger } from "./utils/logger";
import { audioCache } from "./utils/ttsService";
import { useConfigStore } from "./stores/configStore";

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
		console.warn("Failed to save visited state to localStorage");
	}
}

export default function App() {
	const urlParams = new URLSearchParams(window.location.search);
	const hasBookIdParam = urlParams.has("bookId");
	const [showHome, setShowHome] = useState(!hasVisited() && !hasBookIdParam);
	const novels = useAppStore((s) => s.novels);
	const currentNovelId = useAppStore((s) => s.currentNovelId);
	const setChapters = useAppStore((s) => s.setChapters);
	const theme = useAppStore((s) => s.theme);
	const setTheme = useAppStore((s) => s.setTheme);
	const saveCache = useAppStore((s) => s.saveCache);
	const lastCacheSaveTime = useAppStore((s) => s.lastCacheSaveTime);
	const chapters = useAppStore((s) => s.chapters);
	const currentChapterIndex = useAppStore((s) => s.currentChapterIndex);
	const setCurrentChapterIndex = useAppStore((s) => s.setCurrentChapterIndex);
	const readingMode = useAppStore((s) => s.readingMode);
	const setReadingMode = useAppStore((s) => s.setReadingMode);
	const selectNovel = useAppStore((s) => s.selectNovel);
	const showCharacterSettings = useAppStore((s) => s.showCharacterSettings);
	const setShowCharacterSettings = useAppStore((s) => s.setShowCharacterSettings);
	const [configOpen, setConfigOpen] = useState(false);
	const [rightTab, setRightTab] = useState<RightTab>("proofread");
	const [mobileTab, setMobileTab] = useState<MobileTab>("novels");
	const [isMobile, setIsMobile] = useState(false);

	const handleStartApp = useCallback(() => {
		markAsVisited();
		setShowHome(false);
	}, []);

	useEffect(() => {
		const checkMobile = () => {
			setIsMobile(window.innerWidth <= 768);
		};
		checkMobile();
		window.addEventListener("resize", checkMobile);
		return () => window.removeEventListener("resize", checkMobile);
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
						const firstNovel = loadedNovels[0];
						useAppStore.setState({
							novels: loadedNovels,
							currentNovelId: firstNovel.id,
						});
						const chapters = splitChapters(firstNovel.fullText);
						const progress = useAppStore.getState().getReadingProgress(firstNovel.id);
						useAppStore.setState({ chapters });
						if (progress) {
							useAppStore.setState({ currentChapterIndex: progress.currentChapterIndex });
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

		const setChapters = useAppStore.getState().setChapters;
		const trySelect = () => {
			const novelIndex = bookId - 1;
			if (novelIndex === undefined || novelIndex < 0) return false;
			const novel = novels[novelIndex];
			if (novel) {
				selectNovel(novel.id);
				if (novel.fullText) {
					const chapters = splitChapters(novel.fullText);
					setChapters(chapters);
				}
				if (params.chapter !== undefined && params.chapter >= 0) {
					setCurrentChapterIndex(params.chapter);
				}
				if (params.readingMode === "true") {
					setReadingMode(true);
				} else {
					setReadingMode(false);
				}
				setShowHome(false);
				return true;
			}
			return false;
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
			alert("文件已成功保存！");
		} else if (result === "fallback") {
			alert("文件已下载！请手动覆盖原文件。");
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
		const state = useAppStore.getState();
		const includeSensitiveData = confirm("是否在导出文件中包含 API 密钥等敏感信息？\n\n选择「确定」将包含敏感信息，选择「取消」则不包含。");
		await exportAllData({
			novels: state.novels,
			aiConfig: {
				...state.aiConfig,
				apiKey: includeSensitiveData ? state.aiConfig.apiKey : "[REDACTED]",
			},
			apiUsage: state.apiUsage,
			novelCategories: state.novelCategories,
			readingProgress: state.readingProgress,
			ignoredWords: state.ignoredWords,
			exportTime: formatDateTime(Date.now()),
			version: "0.9.0",
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
				<HomePage onStart={handleStartApp} />
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
					<button className="btn-import" onClick={handleImport}>
						<Icons.import size={16} />
						导入 TXT 文件
					</button>
					{currentNovelId && (
						<>
							<button className="btn-export" onClick={handleExportAsNew}>
								<Icons.save size={16} />
								导出修改版本
							</button>
							<button
								className="btn-save-original"
								onClick={handleSaveToOriginal}
							>
								<Icons.fileOutput size={16} />
								保存到原文件
							</button>
							<button
								className="btn-save-cache"
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
								className="btn-export-all"
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
							className="btn-export-mobile"
							onClick={handleExportNovel}
							title="导出整本小说"
						>
							<Icons.download size={18} />
						</button>
					)}
					{isMobile && currentNovelId && (
						<button
							className="btn-save-cache-mobile"
							onClick={handleSaveCache}
							title="保存缓存"
						>
							<Icons.cache size={18} />
						</button>
					)}
					{isMobile && currentNovelId && (
						<button
							className="btn-save-mobile"
							onClick={handleSaveToOriginal}
							title="保存到原文件"
						>
							<Icons.fileOutput size={18} />
						</button>
					)}
					<button
						className="btn-theme-toggle"
						onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
						title={theme === "dark" ? "切换到亮色模式" : "切换到深色模式"}
					>
						{theme === "dark" ? <Icons.sun size={18} /> : <Icons.moon size={18} />}
						{!isMobile && (theme === "dark" ? "切换到亮色" : "切换到深色")}
					</button>
					<GlobalSearch />
					<button className="btn-settings" onClick={() => setConfigOpen(true)}>
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
					className={`app-main ${rightTab === "task" ? "task-mode" : ""} ${isMobile && mobileTab === "reader" ? "" : isMobile ? "hidden" : ""} ${!isMobile && readingMode ? "" : ""}`}
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

			{isMobile && (
				<>
					<div className="mobile-tab-bar">
						<button
							className={`mobile-tab-btn ${mobileTab === "novels" ? "active" : ""}`}
							onClick={() => handleMobileTabChange("novels")}
						>
							<Icons.library size={18} />
							<span>小说</span>
						</button>
						<button
							className={`mobile-tab-btn ${mobileTab === "chapters" ? "active" : ""}`}
							onClick={() => handleMobileTabChange("chapters")}
						>
							<Icons.list size={18} />
							<span>章节</span>
						</button>
						<button
							className={`mobile-tab-btn ${mobileTab === "reader" ? "active" : ""}`}
							onClick={() => handleMobileTabChange("reader")}
						>
							<Icons.book size={18} />
							<span>阅读</span>
						</button>
						<button
							className={`mobile-tab-btn ${mobileTab === "task" ? "active" : ""}`}
							onClick={() => handleMobileTabChange("task")}
						>
							<Icons.script size={18} />
							<span>剧本</span>
						</button>
					</div>
					
				</>
			)}

			<ConfigModal open={configOpen} onClose={() => setConfigOpen(false)} />
			{showCharacterSettings && (
						<CharacterSettings
							novelId={showCharacterSettings}
							novelName={novels.find(n => n.id === showCharacterSettings)?.name || ""}
							onClose={() => setShowCharacterSettings(null)}
						/>
					)}
				</>
			)}
		</div>
	);
}