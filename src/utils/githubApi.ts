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