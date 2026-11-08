// ============================================================
// 服务端文件浏览 API 封装：/api/fs/roots、/api/fs/list、/api/fs/read
// ============================================================

/** 允许浏览的根目录 */
export interface ServerRoot {
	name: string;
	path: string;
}

/** 目录项 */
export interface ServerEntry {
	name: string;
	path: string;
	isDir: boolean;
	size: number;
}

/** 获取可浏览的根目录 */
export async function listServerRoots(): Promise<ServerRoot[]> {
	const response = await fetch("/api/fs/roots");
	if (!response.ok) throw new Error(`获取目录失败: HTTP ${response.status}`);
	const data = (await response.json()) as { roots?: ServerRoot[] };
	return data.roots ?? [];
}

/** 列出目录内容 */
export async function listServerDir(path: string): Promise<ServerEntry[]> {
	const response = await fetch(`/api/fs/list?path=${encodeURIComponent(path)}`);
	const data = (await response.json()) as { entries?: ServerEntry[]; error?: string };
	if (!response.ok || data.error) {
		throw new Error(data.error ?? `读取目录失败: HTTP ${response.status}`);
	}
	return data.entries ?? [];
}

/** 读取服务端文件原始字节 */
export async function readServerFile(path: string): Promise<ArrayBuffer> {
	const response = await fetch(`/api/fs/read?path=${encodeURIComponent(path)}`);
	if (!response.ok) {
		let message = `读取文件失败: HTTP ${response.status}`;
		try {
			const data = (await response.json()) as { error?: string };
			if (data.error) message = data.error;
		} catch {
			// 忽略非 JSON 响应
		}
		throw new Error(message);
	}
	return response.arrayBuffer();
}
