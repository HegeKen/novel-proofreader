// ============================================================
// Web 模式下的 Tauri 文件系统适配：IndexedDB 虚拟文件系统
// 仅在 Web 构建时通过 Vite alias 替换 @tauri-apps/plugin-fs
//
// 小说 txt / 角色配置等仍可在浏览器内持久化（IndexedDB，容量远大于 localStorage）；
// 遇到 __browser_download__/ 前缀时改为触发浏览器下载。
// ============================================================

/** 与 @tauri-apps/plugin-fs 的 BaseDirectory 对应（Web 端忽略具体值） */
export const BaseDirectory = {
	Audio: 1,
	Cache: 2,
	Config: 3,
	Data: 4,
	LocalData: 5,
	Document: 6,
	Download: 7,
	Picture: 8,
	Public: 9,
	Video: 10,
	Resource: 11,
	Temp: 12,
	AppConfig: 13,
	AppData: 14,
	AppLocalData: 15,
	AppCache: 16,
	AppLog: 17,
	Desktop: 18,
	Executable: 19,
} as const;

export type BaseDirectory = (typeof BaseDirectory)[keyof typeof BaseDirectory];

/** 文件操作选项 */
export interface FsOptions {
	baseDir?: BaseDirectory;
	recursive?: boolean;
}

/** 目录项（与 Tauri DirEntry 结构对齐） */
export interface DirEntry {
	name: string;
	isDirectory: boolean;
	isFile: boolean;
}

interface Entry {
	kind: "file" | "dir";
	text?: string;
	data?: ArrayBuffer;
}

const DB_NAME = "novel-proofreader-fs";
const STORE_NAME = "entries";
const DOWNLOAD_PREFIX = "__browser_download__/";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
	if (dbPromise) return dbPromise;
	dbPromise = new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, 1);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME);
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error("打开 IndexedDB 失败"));
	});
	return dbPromise;
}

function normalizePath(path: string): string {
	let value = path.replace(/\\/g, "/");
	while (value.startsWith("./")) value = value.slice(2);
	while (value.startsWith("/")) value = value.slice(1);
	return value;
}

async function getEntry(path: string): Promise<Entry | undefined> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, "readonly");
		const request = tx.objectStore(STORE_NAME).get(path);
		request.onsuccess = () => resolve(request.result as Entry | undefined);
		request.onerror = () => reject(request.error ?? new Error("读取文件失败"));
	});
}

async function putEntry(path: string, entry: Entry): Promise<void> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, "readwrite");
		tx.objectStore(STORE_NAME).put(entry, path);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error ?? new Error("写入文件失败"));
	});
}

async function keysWithPrefix(prefix: string): Promise<string[]> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, "readonly");
		const store = tx.objectStore(STORE_NAME);
		const range = IDBKeyRange.bound(prefix, `${prefix}\uffff`);
		const request = store.getAllKeys(range);
		request.onsuccess = () => resolve((request.result as IDBValidKey[]).map(String));
		request.onerror = () => reject(request.error ?? new Error("列举目录失败"));
	});
}

async function deleteWithPrefix(prefix: string): Promise<void> {
	const keys = await keysWithPrefix(prefix);
	const db = await openDb();
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, "readwrite");
		const store = tx.objectStore(STORE_NAME);
		keys.forEach((key) => store.delete(key));
		store.delete(prefix);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error ?? new Error("删除文件失败"));
	});
}

async function ensureParentDirs(path: string): Promise<void> {
	const parts = path.split("/");
	parts.pop();
	let current = "";
	for (const part of parts) {
		current = current ? `${current}/${part}` : part;
		const existing = await getEntry(current);
		if (!existing) {
			await putEntry(current, { kind: "dir" });
		}
	}
}

/** 触发浏览器下载 */
function triggerDownload(name: string, blob: Blob): void {
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	URL.revokeObjectURL(url);
}

function downloadNameFromPath(path: string): string {
	const raw = path.slice(DOWNLOAD_PREFIX.length);
	const name = raw.split("/").pop();
	return name && name.length > 0 ? name : "download.txt";
}

// ------------------------------------------------------------
// 对外 API（与 plugin-fs 保持一致）
// ------------------------------------------------------------

export async function exists(path: string, _options?: FsOptions): Promise<boolean> {
	const key = normalizePath(path);
	if (await getEntry(key)) return true;
	const children = await keysWithPrefix(`${key}/`);
	return children.length > 0;
}

export async function mkdir(path: string, _options?: FsOptions): Promise<void> {
	const key = normalizePath(path);
	const parts = key.split("/");
	let current = "";
	for (const part of parts) {
		current = current ? `${current}/${part}` : part;
		if (!(await getEntry(current))) {
			await putEntry(current, { kind: "dir" });
		}
	}
}

export async function readTextFile(path: string, _options?: FsOptions): Promise<string> {
	const key = normalizePath(path);
	const entry = await getEntry(key);
	if (!entry || entry.kind !== "file") {
		throw new Error(`文件不存在: ${key}`);
	}
	if (typeof entry.text === "string") return entry.text;
	if (entry.data) return new TextDecoder().decode(entry.data);
	return "";
}

export async function writeTextFile(
	path: string,
	contents: string,
	_options?: FsOptions,
): Promise<void> {
	if (path.startsWith(DOWNLOAD_PREFIX)) {
		triggerDownload(downloadNameFromPath(path), new Blob([contents], { type: "text/plain;charset=utf-8" }));
		return;
	}
	const key = normalizePath(path);
	await ensureParentDirs(key);
	await putEntry(key, { kind: "file", text: contents });
}

export async function writeFile(
	path: string,
	data: Uint8Array,
	_options?: FsOptions,
): Promise<void> {
	if (path.startsWith(DOWNLOAD_PREFIX)) {
		const buffer = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
		triggerDownload(
			downloadNameFromPath(path),
			new Blob([buffer as unknown as BlobPart], { type: "application/octet-stream" }),
		);
		return;
	}
	const key = normalizePath(path);
	await ensureParentDirs(key);
	await putEntry(key, { kind: "file", data: (data as unknown as ArrayBuffer).slice(0) });
}

export async function readDir(path: string, _options?: FsOptions): Promise<DirEntry[]> {
	const key = normalizePath(path);
	const prefix = key ? `${key}/` : "";
	const keys = await keysWithPrefix(prefix);
	const entries = new Map<string, DirEntry>();
	for (const childKey of keys) {
		const rest = childKey.slice(prefix.length);
		if (!rest) continue;
		const slash = rest.indexOf("/");
		if (slash === -1) {
			entries.set(rest, { name: rest, isFile: true, isDirectory: false });
		} else {
			const name = rest.slice(0, slash);
			entries.set(name, { name, isFile: false, isDirectory: true });
		}
	}
	return Array.from(entries.values()).sort((a, b) =>
		a.name.localeCompare(b.name),
	);
}

export async function remove(path: string, _options?: FsOptions): Promise<void> {
	await deleteWithPrefix(normalizePath(path));
}

export async function rename(
	oldPath: string,
	newPath: string,
	_options?: FsOptions,
): Promise<void> {
	const oldKey = normalizePath(oldPath);
	const entry = await getEntry(oldKey);
	if (!entry) throw new Error(`文件不存在: ${oldKey}`);
	const newKey = normalizePath(newPath);
	await ensureParentDirs(newKey);
	await putEntry(newKey, entry);
	await deleteWithPrefix(oldKey);
}
