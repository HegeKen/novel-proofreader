import { useState, useEffect, useCallback } from "react";
import { NovelList } from "./components/NovelList";
import { ChapterNav } from "./components/ChapterNav";
import { ReaderPanel } from "./components/ReaderPanel";
import { ProofreadPanel } from "./components/ProofreadPanel";
import { TaskPanel } from "./components/TaskPanel";
import { ConfigModal } from "./components/ConfigModal";
import { useAppStore } from "./stores/appStore";
import { splitChapters } from "./utils/chapterSplit";
import { decodeTextBuffer } from "./utils/decodeText";
import { exportToFile } from "./utils/fileExport";

type RightTab = "proofread" | "task";
type MobileTab = "novels" | "chapters" | "reader" | "task" | "settings";

export default function App() {
	const novels = useAppStore((s) => s.novels);
	const currentNovelId = useAppStore((s) => s.currentNovelId);
	const setChapters = useAppStore((s) => s.setChapters);
	const theme = useAppStore((s) => s.theme);
	const setTheme = useAppStore((s) => s.setTheme);
	const chapters = useAppStore((s) => s.chapters);
	const currentChapterIndex = useAppStore((s) => s.currentChapterIndex);
	const setCurrentChapterIndex = useAppStore((s) => s.setCurrentChapterIndex);
	const readingMode = useAppStore((s) => s.readingMode);
	const saveToCache = useAppStore((s) => s.saveToCache);

	const [configOpen, setConfigOpen] = useState(false);
	const [rightTab, setRightTab] = useState<RightTab>("proofread");
	const [mobileTab, setMobileTab] = useState<MobileTab>("reader");
	const [isMobile, setIsMobile] = useState(false);
	const [mobileProofreadVisible, setMobileProofreadVisible] = useState(true);

	useEffect(() => {
		const checkMobile = () => setIsMobile(window.innerWidth <= 768);
		checkMobile();
		window.addEventListener("resize", checkMobile);
		return () => window.removeEventListener("resize", checkMobile);
	}, []);

	useEffect(() => {
		document.documentElement.setAttribute("data-theme", theme);
		document.documentElement.style.setProperty("--safe-area-top", `calc(1px * ${parseInt(getComputedStyle(document.documentElement).getPropertyValue("--safe-area-inset-top")) || 0})`);
	}, [theme]);

	const handleVolumeKey = useCallback(
		(e: KeyboardEvent) => {
			if (!isMobile) return;
			if (e.code === "VolumeUp") {
				e.preventDefault();
				if (currentChapterIndex > 0) setCurrentChapterIndex(currentChapterIndex - 1);
			} else if (e.code === "VolumeDown") {
				e.preventDefault();
				if (currentChapterIndex < chapters.length - 1) setCurrentChapterIndex(currentChapterIndex + 1);
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
			const text = decodeTextBuffer(await file.arrayBuffer());
			setChapters(splitChapters(text));
		};
		input.click();
	};

	const handleExportAsNew = async () => {
		const novel = novels.find((n) => n.id === currentNovelId);
		if (!novel) return;
		const content = chapters.map((ch) => ch.content).join("");
		await exportToFile(content, `${novel.name}.txt`);
	};

	const handleSaveToOriginal = async () => {
		const novel = novels.find((n) => n.id === currentNovelId);
		if (!novel) return;
		if (!confirm(`确定要覆盖原文件 "${novel.name}" 吗？此操作不可撤销。`)) return;
		const content = chapters.map((ch) => ch.content).join("");
		const result = await exportToFile(content, `${novel.name}.txt`);
		alert(result === "success" ? "文件已成功保存！" : "文件已下载！请手动覆盖原文件。");
	};

	const handleExportNovel = async () => {
		const novel = novels.find((n) => n.id === currentNovelId);
		if (!novel) return;
		const content = chapters.map((ch) => ch.content).join("");
		await exportToFile(content, `${novel.name}_edited.txt`);
	};

	const handleMobileTabChange = (tab: MobileTab) => {
		setMobileTab(tab);
		if (tab === "task") setRightTab(tab);
	};

	return (
		<div className="app">
			<header className="app-header">
				<div className="header-left">
					<h1 className="app-title">
						<img src="/icons/icon.png" alt="" className="app-icon" />
						校对助手
					</h1>
				</div>
				<div className="header-center">
					<button className="btn-import" onClick={handleImport}>📂 导入 TXT 文件</button>
					{currentNovelId && (
						<>
							<button className="btn-export" onClick={handleExportAsNew}>📤 导出修改版本</button>
							<button className="btn-save-original" onClick={handleSaveToOriginal}>📝 保存到原文件</button>
						</>
					)}
				</div>
				<div className="header-right">
					{isMobile && currentNovelId && (
						<button className="btn-export-mobile" onClick={handleExportNovel} title="导出整本小说">📤</button>
					)}
					{isMobile && currentNovelId && (
						<button className="btn-save-mobile" onClick={handleSaveToOriginal} title="保存到原文件">📝</button>
					)}
					{currentNovelId && <button className="btn-save-cache" onClick={saveToCache} title="保存到缓存">🗂️ 保存</button>}
					<button className="btn-theme-toggle" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} title={theme === "dark" ? "切换到亮色模式" : "切换到深色模式"}>
						{theme === "dark" ? "☀️" : "🌙"}
					</button>
					<button className="btn-settings" onClick={() => setConfigOpen(true)}>⚙️ 设置</button>
				</div>
			</header>

			<div className="app-body">
				<aside className={`app-novel-list ${isMobile && mobileTab === "novels" ? "mobile-active" : ""} ${!isMobile && readingMode ? "hidden-panel" : ""}`}>
					<NovelList onNovelSelect={() => isMobile && setMobileTab("chapters")} />
				</aside>

				<aside className={`app-sidebar ${isMobile && mobileTab === "chapters" ? "mobile-active" : ""} ${!isMobile && readingMode ? "hidden-panel" : ""}`}>
					<ChapterNav onChapterSelect={() => isMobile && setMobileTab("reader")} />
				</aside>

				<main className={`app-main ${rightTab === "task" ? "task-mode" : ""} ${isMobile && mobileTab === "reader" ? "" : isMobile ? "hidden" : ""}`}>
					{isMobile && mobileTab === "reader" && (
						<div className="mobile-reader-proofread">
							<div className="mobile-reader-section">
								<ReaderPanel showReadingModeToggle={true} />
							</div>
							{!readingMode && mobileProofreadVisible && (
								<div className="mobile-proofread-section">
									<button className="mobile-proofread-toggle" onClick={() => setMobileProofreadVisible(false)}>🔍 收起校对</button>
									<div className="right-content"><ProofreadPanel /></div>
								</div>
							)}
							{!readingMode && !mobileProofreadVisible && (
								<button className="mobile-proofread-toggle" onClick={() => setMobileProofreadVisible(true)}>📝 显示校对</button>
							)}
						</div>
					)}
					{!isMobile && <ReaderPanel showReadingModeToggle={true} />}
				</main>

				<aside className={`app-right ${rightTab === "task" ? "task-mode" : ""} ${isMobile && mobileTab === "task" ? "mobile-active" : ""} ${!isMobile && readingMode ? "hidden-panel" : ""}`}>
					{isMobile && mobileTab === "task" ? (
						<TaskPanel />
					) : (
						<>
							<div className="right-tabs">
								<button className={`tab-btn ${rightTab === "proofread" ? "active" : ""}`} onClick={() => setRightTab("proofread")}>🔍 校对检测</button>
								<button className={`tab-btn ${rightTab === "task" ? "active" : ""}`} onClick={() => setRightTab("task")}>🎬 剧本改编</button>
							</div>
							<div className="right-content">
								{rightTab === "proofread" ? <ProofreadPanel /> : <TaskPanel />}
							</div>
						</>
					)}
				</aside>
			</div>

			{isMobile && (
				<div className="mobile-tab-bar">
					<button className={`mobile-tab-btn ${mobileTab === "novels" ? "active" : ""}`} onClick={() => handleMobileTabChange("novels")}>📚<span>小说</span></button>
					<button className={`mobile-tab-btn ${mobileTab === "chapters" ? "active" : ""}`} onClick={() => handleMobileTabChange("chapters")}>📑<span>章节</span></button>
					<button className={`mobile-tab-btn ${mobileTab === "reader" ? "active" : ""}`} onClick={() => handleMobileTabChange("reader")}>📖<span>阅读</span></button>
					<button className={`mobile-tab-btn ${mobileTab === "task" ? "active" : ""}`} onClick={() => handleMobileTabChange("task")}>🎬<span>剧本</span></button>
				</div>
			)}

			<ConfigModal open={configOpen} onClose={() => setConfigOpen(false)} />
		</div>
	);
}
