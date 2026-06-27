import { logger } from './logger';

export interface GitHubRelease {
	name: string;
	tag_name: string;
	body: string;
	html_url: string;
	assets: Array<{
		name: string;
		browser_download_url: string;
		size: number;
	}>;
	published_at: string;
}

export interface MirrorSource {
	name: string;
	url: string;
	description: string;
}

export const GITHUB_MIRRORS: MirrorSource[] = [
	{ name: "官方源", url: "", description: "GitHub 官方下载（国内可能较慢）" },
	{ name: "镜像 1", url: "https://gh-proxy.com", description: "gh-proxy.com 镜像加速" },
	{ name: "镜像 2", url: "https://ghproxy.net", description: "ghproxy.net 镜像加速" },
	{ name: "镜像 3", url: "https://ghproxy.com", description: "ghproxy.com 镜像加速" },
	{ name: "镜像 4", url: "https://gh.api.99988866.xyz", description: "99988866.xyz 镜像加速" },
	{ name: "镜像 5", url: "https://mirror.ghproxy.com", description: "mirror.ghproxy.com 镜像加速" },
];

/** CORS 代理源（用于 GitHub API 请求，这些代理会正确设置 CORS 头） */
export const CORS_PROXIES: MirrorSource[] = [
	{ name: "直连", url: "", description: "直接请求 GitHub API（推荐）" },
	{ name: "代理 1", url: "https://api.allorigins.win/raw?url=", description: "allorigins.win CORS 代理（⚠️ 第三方代理，可能看到你的请求内容）" },
	{ name: "代理 2", url: "https://corsproxy.io/?", description: "corsproxy.io CORS 代理（⚠️ 第三方代理，可能看到你的请求内容）" },
];

export function getMirrorUrls(originalUrl: string): string[] {
	const urls: string[] = [originalUrl];
	for (const mirror of GITHUB_MIRRORS) {
		if (!mirror.url) continue;
		try {
			const url = new URL(originalUrl);
			const mirrorUrl = `${mirror.url}${url.pathname}`;
			if (url.search) {
				urls.push(`${mirrorUrl}${url.search}`);
			} else {
				urls.push(mirrorUrl);
			}
		} catch {
			urls.push(`${mirror.url}/${originalUrl.replace("https://github.com/", "")}`);
		}
	}
	return urls;
}

/** 为 GitHub 下载链接生成镜像 URL（使用 pathname 方式） */
export function getMirrorUrl(originalUrl: string, mirror: MirrorSource): string {
	if (!mirror.url) return originalUrl;
	try {
		const url = new URL(originalUrl);
		const mirrorUrl = `${mirror.url}${url.pathname}`;
		return url.search ? `${mirrorUrl}${url.search}` : mirrorUrl;
	} catch {
		return `${mirror.url}/${originalUrl.replace("https://github.com/", "")}`;
	}
}

/** 为任意完整 URL 生成 CORS 代理 URL */
export function getCorsProxyUrl(originalUrl: string, proxy: MirrorSource): string {
	if (!proxy.url) return originalUrl;
	return `${proxy.url}${encodeURIComponent(originalUrl)}`;
}

/**
 * 带 CORS 代理回退的 API 请求
 * 1. 尝试选中的代理源
 * 2. 如果失败，依次尝试其他 CORS 代理
 * 3. 全部失败则抛出错误
 */
export async function fetchApiWithFallback(
	url: string,
	selectedProxy?: MirrorSource,
): Promise<Response> {
	const proxyList: MirrorSource[] = [];
	if (selectedProxy) {
		proxyList.push(selectedProxy);
	}
	// 添加其他代理作为回退（去重）
	for (const p of CORS_PROXIES) {
		if (!proxyList.some(existing => existing.name === p.name)) {
			proxyList.push(p);
		}
	}

	let lastError: Error | null = null;
	for (const proxy of proxyList) {
		try {
			const proxyUrl = getCorsProxyUrl(url, proxy);
			const response = await fetch(proxyUrl);
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}
			return response;
		} catch (error) {
			lastError = error as Error;
			logger.warn(`githubApi - API request failed via ${proxy.name}:`, error);
		}
	}

	throw lastError || new Error("All API request attempts failed");
}

const MAX_DOWNLOAD_SIZE = 500 * 1024 * 1024; // 500 MB

export async function downloadFromMirror(mirrorUrl: string, fileName: string): Promise<void> {
	const response = await fetch(mirrorUrl);
	if (!response.ok) {
		throw new Error(`HTTP ${response.status}`);
	}
	const contentLength = Number(response.headers.get("content-length"));
	if (contentLength > MAX_DOWNLOAD_SIZE) {
		throw new Error(`文件过大 (${(contentLength / 1024 / 1024).toFixed(0)}MB)，超过 500MB 限制`);
	}
	const blob = await response.blob();
	if (blob.size > MAX_DOWNLOAD_SIZE) {
		throw new Error(`文件过大 (${(blob.size / 1024 / 1024).toFixed(0)}MB)，超过 500MB 限制`);
	}
	const downloadUrl = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = downloadUrl;
	a.download = fileName;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(downloadUrl);
}

export async function tryDownloadWithMirrors(url: string, fileName: string): Promise<void> {
	const urls = getMirrorUrls(url);
	let lastError: Error | null = null;

	for (let i = 0; i < urls.length; i++) {
		try {
			const response = await fetch(urls[i]);
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}
			const contentLength = Number(response.headers.get("content-length"));
			if (contentLength > MAX_DOWNLOAD_SIZE) {
				throw new Error(`文件过大 (${(contentLength / 1024 / 1024).toFixed(0)}MB)，超过 500MB 限制`);
			}
			const blob = await response.blob();
			if (blob.size > MAX_DOWNLOAD_SIZE) {
				throw new Error(`文件过大 (${(blob.size / 1024 / 1024).toFixed(0)}MB)，超过 500MB 限制`);
			}
			const downloadUrl = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = downloadUrl;
			a.download = fileName;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(downloadUrl);
			return;
		} catch (error) {
			lastError = error as Error;
			logger.warn(`githubApi - Download failed from ${urls[i]} (${i + 1}/${urls.length}):`, error);
		}
	}

	throw lastError || new Error("All download attempts failed");
}

export async function fetchLatestRelease(
	repo: string = "HegeKen/novel-proofreader",
	proxy?: MirrorSource,
): Promise<GitHubRelease | null> {
	try {
		const url = `https://api.github.com/repos/${repo}/releases/latest`;
		const response = await fetchApiWithFallback(url, proxy);
		return await response.json();
	} catch (error) {
		logger.errorGeneric('githubApi - Error fetching GitHub release:', error);
		return null;
	}
}

export async function fetchLatestReleaseWithAssets(
	repo: string = "HegeKen/novel-proofreader",
	proxy?: MirrorSource,
): Promise<GitHubRelease | null> {
	try {
		const url = `https://api.github.com/repos/${repo}/releases`;
		const response = await fetchApiWithFallback(url, proxy);
		const releases: GitHubRelease[] = await response.json();
		const releaseWithAssets = releases.find(r => r.assets && r.assets.length > 0);
		return releaseWithAssets || null;
	} catch (error) {
		logger.errorGeneric('githubApi - Error fetching releases:', error);
		return null;
	}
}

/** 通过 CORS 代理获取 Releases 列表 */
export async function fetchAllReleases(
	repo: string = "HegeKen/novel-proofreader",
	proxy?: MirrorSource,
): Promise<GitHubRelease[]> {
	try {
		const url = `https://api.github.com/repos/${repo}/releases`;
		const response = await fetchApiWithFallback(url, proxy);
		return await response.json();
	} catch (error) {
		logger.errorGeneric('githubApi - Error fetching releases:', error);
		return [];
	}
}

export function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function getAssetByPlatform(assets: GitHubRelease["assets"], platform: "macos" | "windows" | "linux" | "android"): typeof assets[0] | undefined {
	const allAssets = getAllAssetsByPlatform(assets, platform);
	if (allAssets.length === 0) return undefined;
	return allAssets[0];
}

export function getAllAssetsByPlatform(assets: GitHubRelease["assets"], platform: "macos" | "windows" | "linux" | "android"): typeof assets {
	const platformPatterns: Record<string, string[]> = {
		macos: ["macos", "darwin", "mac", ".dmg", ".pkg"],
		windows: ["windows", "win", "msi", "exe", ".zip"],
		linux: ["linux", "deb", "rpm", "appimage", "snap", ".tar.gz"],
		android: ["android", "android", ".apk", ".aab"],
	};

	const matchingAssets = assets.filter(asset => {
		const lowerName = asset.name.toLowerCase();
		if (platform === "android") {
			return lowerName.includes("android") || lowerName.includes(".apk") || lowerName.includes(".aab");
		}
		return platformPatterns[platform].some(pattern => lowerName.includes(pattern));
	});

	const prioritizedPatterns: Record<string, string[]> = {
		macos: [".dmg", ".pkg", "-arm64", "-x64"],
		windows: [".exe", ".msi", "-x64", "-ia32"],
		linux: [".deb", ".rpm", "appimage", ".tar.gz"],
		android: [".apk", ".aab"],
	};

	matchingAssets.sort((a, b) => {
		const aName = a.name.toLowerCase();
		const bName = b.name.toLowerCase();
		for (const pattern of prioritizedPatterns[platform]) {
			const aMatch = aName.includes(pattern);
			const bMatch = bName.includes(pattern);
			if (aMatch && !bMatch) return -1;
			if (!aMatch && bMatch) return 1;
		}
		return 0;
	});

	return matchingAssets;
}

export function compareVersions(current: string, latest: string): -1 | 0 | 1 {
	const normalize = (v: string) => {
		return v.replace(/^v/, "").split(".").map(n => parseInt(n, 10) || 0);
	};

	const currentParts = normalize(current);
	const latestParts = normalize(latest);

	for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
		const a = currentParts[i] || 0;
		const b = latestParts[i] || 0;
		if (a < b) return -1;
		if (a > b) return 1;
	}

	return 0;
}

export async function getCurrentVersion(): Promise<string> {
	try {
		const { getVersion } = await import("@tauri-apps/api/app");
		return await getVersion();
	} catch {
		return (globalThis as Record<string, unknown>).__APP_VERSION__ as string || "0.0.0";
	}
}
