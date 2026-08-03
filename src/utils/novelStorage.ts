// ============================================================
// 小说文本存储工具 — 使用 IndexedDB 存储大文本，支持分块
// ============================================================
import { logger } from "./logger";

const DB_NAME = "novel-proofreader-db";
const DB_VERSION = 1;
const STORE_NAME = "novels";
/** 每块最大字符数（约 2MB，UTF-16 下约 4MB） */
const CHUNK_SIZE = 1_000_000;

function openDB(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve(request.result);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME, { keyPath: "key" });
			}
		};
	});
}

/** 将大文本分块存储到 IndexedDB */
export async function saveNovelText(key: string, text: string): Promise<boolean> {
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
				db.close();
				logger.file(`[novelStorage] 保存成功: key=${key}, 总长度=${text.length}, 分块数=${chunks.length}`);
				resolve(true);
			};
			tx.onerror = () => {
				db.close();
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
				db.close();
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
				db.close();
				logger.errorGeneric("[novelStorage]", "读取失败:", request.error);
				resolve(null);
			};
		});
	} catch (e) {
		logger.errorGeneric("[novelStorage]", "读取异常:", e);
		return null;
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
				db.close();
				logger.file(`[novelStorage] 删除成功: key=${key}`);
				resolve(true);
			};
			tx.onerror = () => {
				db.close();
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
