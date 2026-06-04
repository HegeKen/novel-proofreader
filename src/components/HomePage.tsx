import { useState, useEffect } from "react";
import { Users, Cloud, MessageSquare, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Icons } from "./Icons";
import { useMobile } from "../hooks/useMobile";
import { logger } from "../utils/logger";
import { useAppStore } from "../stores/appStore";

import { fetchLatestReleaseWithAssets, fetchAllReleases, formatFileSize, getAllAssetsByPlatform, tryDownloadWithMirrors, downloadFromMirror, getMirrorUrl, GITHUB_MIRRORS, CORS_PROXIES, compareVersions, getCurrentVersion, type GitHubRelease, type MirrorSource } from "../utils/githubApi";

interface HomePageProps {
	onStart?: () => void;
}

export function HomePage({ onStart }: HomePageProps) {
	const { isMobile } = useMobile();
	
	const [release, setRelease] = useState<GitHubRelease | null>(null);
	const [loading, setLoading] = useState(true);
	const [allReleases, setAllReleases] = useState<GitHubRelease[]>([]);
	const [showDownloadModal, setShowDownloadModal] = useState(false);
	const [downloadingAsset, setDownloadingAsset] = useState<string | null>(null);

	// 镜像源选择弹窗状态
	const [mirrorPickerAsset, setMirrorPickerAsset] = useState<{ url: string; fileName: string; displayName: string; size: number } | null>(null);
	const [downloadingMirror, setDownloadingMirror] = useState<string>("");
	const [mirrorResults, setMirrorResults] = useState<Record<string, "success" | "error">>({});

	// API CORS 代理选择（用于获取 Releases 列表）
	const [selectedApiProxyIndex, setSelectedApiProxyIndex] = useState<number>(0);
	const selectedApiProxy = CORS_PROXIES[selectedApiProxyIndex];

	// 版本比对状态
	const [currentVersion, setCurrentVersion] = useState<string>("");
	const [hasUpdate, setHasUpdate] = useState(false);

	useEffect(() => {
		(async () => {
			const version = await getCurrentVersion();
			setCurrentVersion(version);
		})();
	}, []);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			setLoading(true);
			const [releaseData, releasesData] = await Promise.all([
				fetchLatestReleaseWithAssets("HegeKen/novel-proofreader", selectedApiProxy),
				fetchAllReleases("HegeKen/novel-proofreader", selectedApiProxy),
			]);
			if (cancelled) return;
			setRelease(releaseData);
			setAllReleases(releasesData);

			if (releaseData?.tag_name && currentVersion) {
				const needsUpdate = compareVersions(currentVersion, releaseData.tag_name) === -1;
				setHasUpdate(needsUpdate);
			}

			setLoading(false);
		})();
		return () => { cancelled = true; };
	}, [selectedApiProxy, currentVersion]);

	const handleStartApp = () => {
		onStart?.();
	};

	const handleDownload = async (url: string, fileName: string) => {
		if (downloadingAsset === fileName) return;
		setDownloadingAsset(fileName);
		try {
			await tryDownloadWithMirrors(url, fileName);
		} catch (error) {
			logger.errorGeneric('HomePage - Download failed:', error);
			useAppStore.getState().showToast("下载失败，请稍后重试或尝试其他镜像源", "error");
		} finally {
			setDownloadingAsset(null);
		}
	};

	const handleOpenMirrorPicker = (url: string, fileName: string, displayName: string, size: number) => {
		setMirrorPickerAsset({ url, fileName, displayName, size });
		setDownloadingMirror("");
		setMirrorResults({});
	};

	const handleCloseMirrorPicker = () => {
		setMirrorPickerAsset(null);
		setDownloadingMirror("");
		setMirrorResults({});
	};

	const handleMirrorDownload = async (mirror: MirrorSource) => {
		if (!mirrorPickerAsset) return;
		const mirrorKey = mirror.name;
		setDownloadingMirror(mirrorKey);

		try {
			const mirrorUrl = getMirrorUrl(mirrorPickerAsset.url, mirror);
			await downloadFromMirror(mirrorUrl, mirrorPickerAsset.fileName);
			setMirrorResults(prev => ({ ...prev, [mirrorKey]: "success" }));
		} catch (error) {
			logger.errorGeneric(`HomePage - Download from ${mirror.name} failed:`, error);
			setMirrorResults(prev => ({ ...prev, [mirrorKey]: "error" }));
		} finally {
			setDownloadingMirror("");
		}
	};

	const getArchitecture = (fileName: string): string => {
		const lowerName = fileName.toLowerCase();
		if (lowerName.includes("aarch64") || lowerName.includes("arm64")) return "ARM64";
		if (lowerName.includes("x86_64") || lowerName.includes("amd64") || lowerName.includes("x64")) return "x64";
		if (lowerName.includes("ia32") || lowerName.includes("x86") || lowerName.includes("i386")) return "x86";
		if (lowerName.includes("arm")) return "ARM";
		return "通用";
	};

	const getFileExtension = (fileName: string): string => {
		const match = fileName.match(/\.([^.]+)$/);
		return match ? match[1].toUpperCase() : "";
	};

	const parseChangelogSimple = (body: string) => {
		const lines = body.split("\n");
		const sections: { type: "module" | "item"; content: string }[] = [];

		lines.forEach(line => {
			const trimmedLine = line.trim();
			const moduleMatch = trimmedLine.match(/^\*\*([^*]+)\*\*/);
			if (moduleMatch) {
				sections.push({ type: "module", content: moduleMatch[1].trim() });
			} else if (trimmedLine.startsWith("- ") || trimmedLine.startsWith("* ") || trimmedLine.startsWith("• ")) {
				sections.push({ type: "item", content: trimmedLine.slice(2).trim() });
			} else if (trimmedLine && !trimmedLine.startsWith("#") && !trimmedLine.startsWith("##")) {
				sections.push({ type: "item", content: trimmedLine });
			}
		});

		const groupedSections: { moduleName?: string; items: string[] }[] = [];
		let currentGroup: { moduleName?: string; items: string[] } = { items: [] };

		sections.forEach(section => {
			if (section.type === "module") {
				if (currentGroup.items.length > 0 || currentGroup.moduleName) {
					groupedSections.push(currentGroup);
				}
				currentGroup = { moduleName: section.content, items: [] };
			} else {
				currentGroup.items.push(section.content);
			}
		});

		if (currentGroup.items.length > 0 || currentGroup.moduleName) {
			groupedSections.push(currentGroup);
		}

		return (
			<div className="timeline-list">
				{groupedSections.map((group, groupIdx) => (
					<div key={groupIdx} className="timeline-section">
						{group.moduleName && (
							<div className="timeline-module-title">
								<strong>{group.moduleName}</strong>
							</div>
						)}
						{group.items.map((item, itemIdx) => (
							<div key={itemIdx} className="timeline-item-line">
								<span className="timeline-item-number">{itemIdx + 1}.</span>
								<span className="timeline-item-text">{item}</span>
							</div>
						))}
					</div>
				))}
			</div>
		);
	};

	const features = [
		{
			icon: Icons.search,
			title: "AI 智能校对",
			description: "基于 AI 的智能文本校对，自动检测排版错误、标点问题、用词不当等",
		},
		{
			icon: Icons.book,
			title: "小说阅读",
			description: "优雅的阅读体验，支持章节拆分、阅读进度记忆",
		},
		{
			icon: Icons.script,
			title: "剧本改编",
			description: "一键将小说转换为剧本格式，方便影视创作",
		},
		{
			icon: Users,
			title: "人物关系图",
			description: "自动分析小说人物关系，可视化展示角色联系",
		},
		{
			icon: Cloud,
			title: "数据安全",
			description: "本地处理，隐私保护，所有数据仅存储在您的设备上",
		},
		{
			icon: Icons.download,
			title: "多格式导出",
			description: "支持 TXT 格式导出，方便分享和备份",
		},
	];

	const renderDownloadButton = (asset: NonNullable<GitHubRelease>["assets"][0], platformKey: string, index: number, isDownloading: boolean) => {
		const arch = getArchitecture(asset.name);
		const ext = getFileExtension(asset.name);
		const displayName = platformKey === "macos" ? arch : `${arch} (${ext})`;
		return (
			<div key={index} className="download-asset-wrapper" style={{ display: "flex", gap: "4px", flex: 1 }}>
				<button
					onClick={() => handleDownload(asset.browser_download_url, asset.name)}
					className="download-asset-btn"
					disabled={isDownloading}
					style={{ opacity: isDownloading ? 0.7 : 1, cursor: isDownloading ? "wait" : "pointer", flex: 1 }}
				>
					<div className="asset-icon">
						{isDownloading ? (
							<Loader2 className="animate-spin" size={16} />
						) : (
							<Icons.download size={16} />
						)}
					</div>
					<div className="asset-info">
						<span className="asset-name">{displayName}</span>
						<span className="asset-size">
							{isDownloading ? "下载中..." : formatFileSize(asset.size)}
						</span>
					</div>
				</button>
				<button
					className="mirror-picker-btn"
					title="选择下载源"
					onClick={(e) => {
						e.stopPropagation();
						handleOpenMirrorPicker(asset.browser_download_url, asset.name, displayName, asset.size);
					}}
				>
					<Icons.chevronDown size={14} />
				</button>
			</div>
		);
	};

	return (
		<div className="home-page">
			<header className="app-header">
				<div className="header-left">
					<h1 className="app-title">
						<a href="/" style={{ textDecoration: "none", color: "inherit", display: "flex", alignItems: "center", gap: "8px" }}>
							<img src="/icons/icon.png" alt="" className="app-icon" />
							AI排版校对助手
						</a>
					</h1>
				</div>
				<div className="header-center">
				</div>
				<div className="header-right">
					{onStart && (
						<button className={isMobile ? "btn-mobile" : "btn"} onClick={handleStartApp}>
							<Icons.book size={16} />
							<span>使用网页版</span>
						</button>
					)}
					<button className={isMobile ? "btn-mobile btn-primary" : "btn btn-primary"} onClick={() => setShowDownloadModal(true)}>
						<Icons.download size={16} />
						<span>下载应用</span>
					</button>
				</div>
			</header>

			<section className="hero-section">
				<div className="hero-content">
					<div className="hero-icon">
						<img src="/icons/icon.png" alt="Logo" />
					</div>
					<h1 className="hero-title">AI 排版校对助手</h1>
					<p className="hero-subtitle">
						智能校对 · 小说阅读 · 剧本改编
					</p>
					<p className="hero-description">
						专为小说创作者打造的 AI 辅助工具，帮助您提升写作效率，让文字更加完美。
					</p>

					{onStart && (
						<button className="start-btn" onClick={handleStartApp}>
							<Icons.book size={20} />
							<span>立即体验网页版</span>
						</button>
					)}
				</div>
				<div className="hero-decoration">
					<div className="decoration-circle circle-1"></div>
					<div className="decoration-circle circle-2"></div>
					<div className="decoration-circle circle-3"></div>
				</div>
			</section>

			<section className="features-section">
				<h2 className="section-title">核心功能</h2>
				<div className="features-grid">
					{features.map((feature, index) => (
						<div key={index} className="feature-card">
							<div className="feature-icon">
								<feature.icon size={28} />
							</div>
							<h3 className="feature-title">{feature.title}</h3>
							<p className="feature-description">{feature.description}</p>
						</div>
					))}
				</div>
			</section>

			<section className="about-section">
				<h2 className="section-title">关于项目</h2>
				<div className="about-content">
					<p>
						AI 排版校对助手是一款专为小说创作者设计的工具，集成了先进的 AI 技术，
						帮助作者快速发现并修正文本中的各类问题。
					</p>
					<p>
						项目完全开源，所有代码托管在 GitHub 上，欢迎贡献代码或提出建议。
					</p>
					<div className="about-links">
						<a
							href="https://github.com/HegeKen/novel-proofreader"
							target="_blank"
							rel="noopener noreferrer"
							className="about-link"
						>
							<Icons.codeXml size={18} />
							<span>GitHub</span>
						</a>
						<a
							href="https://github.com/HegeKen/novel-proofreader/issues"
							target="_blank"
							rel="noopener noreferrer"
							className="about-link"
						>
							<MessageSquare size={18} />
							<span>反馈建议</span>
						</a>
					</div>
				</div>

				<div className="changelog-section">
					<h3 className="changelog-title">更新日志</h3>
					<div className="timeline">
						{allReleases.length > 0 ? (
							allReleases.map((rel, index) => (
								<div key={index} className="timeline-item">
									<div className="timeline-line">
										<div className={`timeline-dot ${index === 0 ? 'timeline-dot-active' : ''}`}>
											{index === 0 ? '+' : '✓'}
										</div>
										{index < allReleases.length - 1 && <div className="timeline-connector"></div>}
									</div>
									<div className="timeline-content">
										<div className="timeline-header">
											<span className="timeline-version">版本: {rel.tag_name}</span>
											<span className="timeline-date">更新时间: {new Date(rel.published_at).toLocaleDateString("zh-CN")}</span>
										</div>
										<div className="timeline-body">
											{parseChangelogSimple(rel.body || "")}
										</div>
									</div>
								</div>
							))
						) : (
							<p className="changelog-empty">暂无更新日志</p>
						)}
					</div>
				</div>
			</section>

			{showDownloadModal && (
				<div className="modal-overlay" onClick={() => setShowDownloadModal(false)}>
					<div className="config-modal" onClick={e => e.stopPropagation()}>
						<div className="modal-header">
							<h3 className="modal-title">
								<Icons.download size={20} />
								<span>下载应用</span>
							</h3>
							<button className="btn-close" onClick={() => setShowDownloadModal(false)}>
								<Icons.x size={18} />
							</button>
						</div>
						<div className="modal-body">
							<div className="api-mirror-selector" style={{ marginBottom: "16px" }}>
								<Icons.server size={14} />
								<select
									value={selectedApiProxyIndex}
									onChange={(e) => {
										setSelectedApiProxyIndex(parseInt(e.target.value, 10));
									}}
									className="api-mirror-select"
								>
									{CORS_PROXIES.map((p, i) => (
										<option key={i} value={i}>{p.name}</option>
									))}
								</select>
							</div>
							{hasUpdate && release?.tag_name && (
								<div className="update-hint" style={{ marginBottom: "16px" }}>
									<p style={{ fontSize: "0.9em", color: "#d97706", padding: "12px", backgroundColor: "#fef3c7", borderRadius: "8px", border: "1px solid #f59e0b" }}>
										🚀 发现新版本 {release.tag_name}，当前版本 {currentVersion}，建议更新以获取最新功能
									</p>
								</div>
							)}
							{loading ? (
								<div className="loading-spinner">
									<Loader2 className="animate-spin" size={24} />
								</div>
							) : release?.assets && release.assets.length > 0 ? (
								<>
									<div className="download-hint">
										<p style={{ fontSize: "0.9em", color: "#666", marginBottom: "16px", padding: "12px", backgroundColor: "#f8f9fa", borderRadius: "8px" }}>
											💡 如果 GitHub 官方源下载较慢，系统会自动尝试多个镜像加速源
										</p>
									</div>
									<div className="download-platforms-list">
										{[
											{ key: "macos", name: "macOS", icon: Icons.laptop },
											{ key: "windows", name: "Windows", icon: Icons.monitor },
											{ key: "linux", name: "Linux", icon: Icons.server },
											{ key: "android", name: "Android", icon: Icons.smartphone },
										].map(platform => {
											const assets = getAllAssetsByPlatform(release.assets, platform.key as "macos" | "windows" | "linux" | "android");
											if (assets.length === 0) return null;
											const assetPairs: typeof assets[] = [];
											for (let i = 0; i < assets.length; i += 2) {
												assetPairs.push(assets.slice(i, i + 2));
											}
											return (
												<div key={platform.key} className="download-platform-section">
													<div className="platform-header">
														<platform.icon size={18} />
														<span className="platform-name">{platform.name}</span>
													</div>
													<div className="platform-assets">
														{assetPairs.map((pair, pairIndex) => (
															<div key={pairIndex} style={{ display: "flex", gap: "8px", width: "100%" }}>
																{pair.map((asset, assetIndex) =>
																	renderDownloadButton(asset, platform.key, pairIndex * 2 + assetIndex, downloadingAsset === asset.name)
																)}
																{pair.length === 1 && <div style={{ flex: 1 }} />}
															</div>
														))}
													</div>
												</div>
											);
										})}
									</div>
								</>
							) : (
								<p className="no-assets">暂无可用下载</p>
							)}
						</div>
					</div>
				</div>
			)}

			{/* 镜像源选择弹窗 */}
			{mirrorPickerAsset && (
				<div className="modal-overlay" onClick={handleCloseMirrorPicker}>
					<div className="mirror-picker-modal" onClick={e => e.stopPropagation()}>
						<div className="modal-header">
							<h3 className="modal-title">
								<Icons.download size={18} />
								<span>选择下载源</span>
							</h3>
							<button className="btn-close" onClick={handleCloseMirrorPicker}>
								<Icons.x size={18} />
							</button>
						</div>
						<div className="modal-body">
							<div className="mirror-picker-info">
								<span className="mirror-picker-file">{mirrorPickerAsset.displayName}</span>
								<span className="mirror-picker-size">{formatFileSize(mirrorPickerAsset.size)}</span>
							</div>
							<div className="mirror-picker-list">
								{GITHUB_MIRRORS.map((mirror) => {
									const mirrorKey = mirror.name;
									const isDownloadingThis = downloadingMirror === mirrorKey;
									const result = mirrorResults[mirrorKey];
									return (
										<button
											key={mirrorKey}
											className={`mirror-picker-item ${result === "success" ? "success" : ""} ${result === "error" ? "error" : ""}`}
											onClick={() => handleMirrorDownload(mirror)}
											disabled={isDownloadingThis || result === "success"}
										>
											<div className="mirror-picker-item-left">
												<div className="mirror-picker-item-icon">
													{isDownloadingThis ? (
														<Loader2 className="animate-spin" size={18} />
													) : result === "success" ? (
														<CheckCircle2 size={18} />
													) : result === "error" ? (
														<XCircle size={18} />
													) : (
														<Icons.download size={18} />
													)}
												</div>
												<div className="mirror-picker-item-info">
													<span className="mirror-picker-item-name">{mirror.name}</span>
													<span className="mirror-picker-item-desc">{mirror.description}</span>
												</div>
											</div>
											{result === "success" && (
												<span className="mirror-picker-item-status">下载成功</span>
											)}
											{result === "error" && (
												<span className="mirror-picker-item-status error">下载失败</span>
											)}
										</button>
									);
								})}
							</div>
						</div>
					</div>
				</div>
			)}

			<footer className="footer">
				<p>
					© 2026 AI 排版校对助手 · 基于 React + Tauri 构建
				</p>
			</footer>
		</div>
	);
}
