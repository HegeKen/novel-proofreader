// ============================================================
// 安全存储工具 — AES-GCM 加密 + localStorage 持久化
// ============================================================
import { logger } from './logger';

const STORAGE_PREFIX = 'secure-';
const DB_NAME = 'novel-proofreader-keys';
const STORE_NAME = 'crypto-keys';
const KEY_ID = 'master-key';

// 内存缓存，保持同步 API 兼容性
const memoryCache = new Map<string, string>();
let cryptoKey: CryptoKey | null = null;
let initPromise: Promise<void> | null = null;

// IndexedDB 用于存储加密密钥（比 localStorage 更安全）
function openDB(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, 1);
		req.onupgradeneeded = () => {
			req.result.createObjectStore(STORE_NAME);
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

async function loadOrCreateKey(): Promise<CryptoKey> {
	const db = await openDB();
	const tx = db.transaction(STORE_NAME, 'readonly');
	const store = tx.objectStore(STORE_NAME);

	return new Promise((resolve, reject) => {
		const req = store.get(KEY_ID);
		req.onsuccess = async () => {
			if (req.result) {
				const keyData = req.result as JsonWebKey;
				const key = await crypto.subtle.importKey(
					'jwk', keyData, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt'],
				);
				resolve(key);
			} else {
				const key = await crypto.subtle.generateKey(
					{ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'],
				);
				const exported = await crypto.subtle.exportKey('jwk', key);
				const writeTx = db.transaction(STORE_NAME, 'readwrite');
				writeTx.objectStore(STORE_NAME).put(exported, KEY_ID);
				resolve(key);
			}
		};
		req.onerror = () => reject(req.error);
	});
}

async function ensureKey(): Promise<CryptoKey> {
	if (cryptoKey) return cryptoKey;
	cryptoKey = await loadOrCreateKey();
	return cryptoKey;
}

async function encrypt(plaintext: string): Promise<string> {
	const key = await ensureKey();
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const encoded = new TextEncoder().encode(plaintext);
	const ciphertext = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv }, key, encoded,
	);
	const combined = new Uint8Array(iv.length + ciphertext.byteLength);
	combined.set(iv, 0);
	combined.set(new Uint8Array(ciphertext), iv.length);
	return btoa(String.fromCharCode(...combined));
}

async function decrypt(cipherBase64: string): Promise<string> {
	const key = await ensureKey();
	const combined = Uint8Array.from(atob(cipherBase64), c => c.charCodeAt(0));
	const iv = combined.slice(0, 12);
	const ciphertext = combined.slice(12);
	const plaintext = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv }, key, ciphertext,
	);
	return new TextDecoder().decode(plaintext);
}

// ============================================================
// 同步 API（基于内存缓存，写入时异步持久化）
// ============================================================

/** 从 localStorage 迁移旧 XOR 数据到加密存储 */
async function migrateOldData(): Promise<void> {
	try {
		for (let i = 0; i < localStorage.length; i++) {
			const rawKey = localStorage.key(i);
			if (rawKey?.startsWith(STORAGE_PREFIX)) {
				const realKey = rawKey.slice(STORAGE_PREFIX.length);
				const oldData = localStorage.getItem(rawKey);
				if (oldData && !memoryCache.has(realKey)) {
					try {
						const decrypted = await decrypt(oldData);
						memoryCache.set(realKey, decrypted);
					} catch {
						// 旧 XOR 数据无法用 AES-GCM 解密，删除
						localStorage.removeItem(rawKey);
					}
				}
			}
		}
	} catch (e) {
		logger.errorGeneric('secureStorage - Migration failed:', e);
	}
}

function ensureInit(): void {
	if (!initPromise) {
		initPromise = ensureKey().then(() => migrateOldData());
	}
}

/**
 * 安全存储敏感数据（加密后存储）
 * 写入内存缓存（同步）+ 异步持久化到 localStorage
 */
export function secureStorageSet(key: string, value: string): boolean {
	try {
		memoryCache.set(key, value);
		ensureInit();
		initPromise!.then(async () => {
			try {
				const encrypted = await encrypt(value);
				localStorage.setItem(`${STORAGE_PREFIX}${key}`, encrypted);
			} catch (e) {
				logger.errorGeneric('secureStorage - Async persist failed:', e);
			}
		});
		return true;
	} catch (e) {
		logger.errorGeneric('secureStorage - Failed to set:', e);
		return false;
	}
}

/**
 * 读取安全存储的数据
 * 优先从内存缓存读取，缓存未命中则从 localStorage 解密
 */
export function secureStorageGet(key: string): string | null {
	try {
		if (memoryCache.has(key)) {
			return memoryCache.get(key)!;
		}
		const encrypted = localStorage.getItem(`${STORAGE_PREFIX}${key}`);
		if (encrypted === null) return null;
		// 异步解密并缓存（首次读取可能稍慢）
		ensureInit();
		initPromise!.then(async () => {
			try {
				const decrypted = await decrypt(encrypted);
				memoryCache.set(key, decrypted);
			} catch {
				localStorage.removeItem(`${STORAGE_PREFIX}${key}`);
			}
		});
		return null;
	} catch (e) {
		logger.errorGeneric('secureStorage - Failed to get:', e);
		return null;
	}
}

/**
 * 删除安全存储的数据
 */
export function secureStorageRemove(key: string): void {
	try {
		memoryCache.delete(key);
		localStorage.removeItem(`${STORAGE_PREFIX}${key}`);
	} catch (e) {
		logger.errorGeneric('secureStorage - Failed to remove:', e);
	}
}

/**
 * 检查是否有安全存储的数据
 */
export function secureStorageHas(key: string): boolean {
	return memoryCache.has(key) || localStorage.getItem(`${STORAGE_PREFIX}${key}`) !== null;
}
