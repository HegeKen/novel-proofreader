// ============================================================
// 小说文本存储工具 — 使用 IndexedDB 存储大文本，支持分块
// ============================================================
import { logger } from "./logger";

const DB_NAME = "novel-proofreader-db";
const DB_VERSION = 1;
const STORE_NAME = "novels";
/** 每块最大字符数（约 2MB，UTF-16 下约 4MB） */
const CHUNK_SIZE = 1_000_000;

/** 单例数据库连接（避免每次操作新建连接导致的并发乱序与连接泄漏） */
let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
	if (!dbPromise) {
		dbPromise = new Promise((resolve, reject) => {
			const request = indexedDB.open(DB_NAME, DB_VERSION);
			request.onerror = () => {
				dbPromise = null;
				reject(request.error);
			};
			request.onsuccess = () => resolve(request.result);
			request.onupgradeneeded = () => {
				const db = request.result;
				if (!db.objectStoreNames.contains(STORE_NAME)) {
					db.createObjectStore(STORE_NAME, { keyPath: "key" });
				}
			};
		});
	}
	return dbPromise;
}

/**
 * 串行写队列：保证多个写操作按调用顺序执行，避免
 * 并发事务完成顺序与发起顺序不一致导致旧数据覆盖新数据。
 */
let writeChain: Promise<unknown> = Promise.resolve();

function enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
	const run = writeChain.then(task);
	// 链上吞掉错误，避免单个失败中断后续写入
	writeChain = run.catch(() => undefined);
	return run;
}

/** 将大文本分块存储到 IndexedDB */
export function saveNovelText(key: string, text: string): Promise<boolean> {
	return enqueueWrite(() => doSaveNovelText(key, text));
}

async function doSaveNovelText(key: string, text: string): Promise<boolean> {
	try {
		const db = await openDB();
		const tx = db.transaction(STORE_NAME, "readwrite");
		const store = tx.objectStore(STORE_NAME);

		// 先清除旧数据
		store.delete(key);

		// 分块存储
		const chunks: string[] = [];
		for (let i = 0; i < text.length; i += CHUNK_SIZE) {
			chunks.push(text.slice(i, i + CHUNK_SIZE));
		}

		store.put({
			key,
			chunks,
			totalLength: text.length,
			chunkCount: chunks.length,
			savedAt: Date.now(),
		});

		return new Promise((resolve) => {
			tx.oncomplete = () => {
				logger.file(`[novelStorage] 保存成功: key=${key}, 总长度=${text.length}, 分块数=${chunks.length}`);
				resolve(true);
			};
			tx.onerror = () => {
				logger.errorGeneric("[novelStorage]", "保存失败:", tx.error);
				resolve(false);
			};
		});
	} catch (e) {
		logger.errorGeneric("[novelStorage]", "保存异常:", e);
		return false;
	}
}

/** 从 IndexedDB 读取并合并分块文本 */
export async function loadNovelText(key: string): Promise<string | null> {
	try {
		const db = await openDB();
		const tx = db.transaction(STORE_NAME, "readonly");
		const store = tx.objectStore(STORE_NAME);
		const request = store.get(key);

		return new Promise((resolve) => {
			request.onsuccess = () => {
				const result = request.result;
				if (!result) {
					logger.file(`[novelStorage] 未找到数据: key=${key}`);
					resolve(null);
					return;
				}
				const text = result.chunks.join("");
				logger.file(`[novelStorage] 读取成功: key=${key}, 总长度=${text.length}, 分块数=${result.chunkCount}`);
				resolve(text);
			};
			request.onerror = () => {
				logger.errorGeneric("[novelStorage]", "读取失败:", request.error);
				resolve(null);
			};
		});
	} catch (e) {
		logger.errorGeneric("[novelStorage]", "读取异常:", e);
		return null;
	}
}

/** 列出 IndexedDB 中所有已存储的小说键（用于 Web 端刷新后恢复小说列表） */
export async function listNovelKeys(): Promise<string[]> {
	try {
		const db = await openDB();
		const tx = db.transaction(STORE_NAME, "readonly");
		const store = tx.objectStore(STORE_NAME);
		const request = store.getAllKeys();

		return new Promise((resolve) => {
			request.onsuccess = () => {
				const keys = (request.result as IDBValidKey[]).map(String);
				logger.file(`[novelStorage] 列出存储键: ${keys.length} 个`);
				resolve(keys);
			};
			request.onerror = () => {
				logger.errorGeneric("[novelStorage]", "列出键失败:", request.error);
				resolve([]);
			};
		});
	} catch (e) {
		logger.errorGeneric("[novelStorage]", "列出键异常:", e);
		return [];
	}
}

/** 删除 IndexedDB 中的小说文本 */
export async function deleteNovelText(key: string): Promise<boolean> {
	try {
		const db = await openDB();
		const tx = db.transaction(STORE_NAME, "readwrite");
		const store = tx.objectStore(STORE_NAME);
		store.delete(key);

		return new Promise((resolve) => {
			tx.oncomplete = () => {
				logger.file(`[novelStorage] 删除成功: key=${key}`);
				resolve(true);
			};
			tx.onerror = () => {
				resolve(false);
			};
		});
	} catch (e) {
		logger.errorGeneric("[novelStorage]", "删除异常:", e);
		return false;
	}
}

/** 获取存储键名 */
export function getNovelStorageKey(novelName: string): string {
	return `novel:${novelName}`;
}
