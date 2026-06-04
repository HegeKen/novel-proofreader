// ============================================================
// 安全存储工具 - 用于加密存储敏感信息（如 API Key）
// ============================================================
import { logger } from './logger';

const ENCRYPTION_KEY = 'novel-proofreader-secure-key';

/**
 * 简单的 XOR 加密/解密
 */
function xorEncryptDecrypt(data: string, key: string): string {
	let result = '';
	for (let i = 0; i < data.length; i++) {
		result += String.fromCharCode(data.charCodeAt(i) ^ key.charCodeAt(i % key.length));
	}
	return result;
}

/**
 * 安全存储敏感数据（加密后存储）
 */
export function secureStorageSet(key: string, value: string): boolean {
	try {
		const encrypted = xorEncryptDecrypt(value, ENCRYPTION_KEY);
		localStorage.setItem(`secure-${key}`, encrypted);
		return true;
	} catch (e) {
		logger.errorGeneric('secureStorage - Failed to set:', e);
		return false;
	}
}

/**
 * 读取安全存储的数据（解密后返回）
 */
export function secureStorageGet(key: string): string | null {
	try {
		const encrypted = localStorage.getItem(`secure-${key}`);
		if (encrypted === null) return null;
		return xorEncryptDecrypt(encrypted, ENCRYPTION_KEY);
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
		localStorage.removeItem(`secure-${key}`);
	} catch (e) {
		logger.errorGeneric('secureStorage - Failed to remove:', e);
	}
}

/**
 * 检查是否有安全存储的数据
 */
export function secureStorageHas(key: string): boolean {
	return localStorage.getItem(`secure-${key}`) !== null;
}