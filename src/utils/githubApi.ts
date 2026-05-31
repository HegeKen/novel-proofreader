export interface GitHubRelease {
	name: string;
	tag_name: string;
	body: string;
	assets: Array<{
		name: string;
		browser_download_url: string;
		size: number;
	}>;
	published_at: string;
}

const GITHUB_MIRRORS = [
	"https://gh-proxy.com",
	"https://ghproxy.net",
	"https://ghproxy.com",
	"https://gh.api.99988866.xyz",
	"https://mirror.ghproxy.com"
];

export function getMirrorUrls(originalUrl: string): string[] {
	const urls: string[] = [originalUrl];
	for (const mirror of GITHUB_MIRRORS) {
		try {
			const url = new URL(originalUrl);
			const mirrorUrl = `${mirror}${url.pathname}`;
			if (url.search) {
				urls.push(`${mirrorUrl}${url.search}`);
			} else {
				urls.push(mirrorUrl);
			}
		} catch {
			urls.push(`${mirror}/${originalUrl.replace("https://github.com/", "")}`);
		}
	}
	return urls;
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
			const blob = await response.blob();
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
			console.warn(`Download failed from ${urls[i]} (${i + 1}/${urls.length}):`, error);
		}
	}

	throw lastError || new Error("All download attempts failed");
}

export async function fetchLatestRelease(repo: string = "HegeKen/novel-proofreader"): Promise<GitHubRelease | null> {
	try {
		const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`);
		if (!response.ok) {
			console.error(`Failed to fetch release: ${response.status}`);
			return null;
		}
		return await response.json();
	} catch (error) {
		console.error("Error fetching GitHub release:", error);
		return null;
	}
}

export async function fetchLatestReleaseWithAssets(repo: string = "HegeKen/novel-proofreader"): Promise<GitHubRelease | null> {
	try {
		const response = await fetch(`https://api.github.com/repos/${repo}/releases`);
		if (!response.ok) {
			console.error(`Failed to fetch releases: ${response.status}`);
			return null;
		}
		const releases: GitHubRelease[] = await response.json();
		const releaseWithAssets = releases.find(r => r.assets && r.assets.length > 0);
		return releaseWithAssets || null;
	} catch (error) {
		console.error("Error fetching releases:", error);
		return null;
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
