// ============================================================
// 统一错误处理工具
// ============================================================
import { logger } from './logger';
import { useAppMetaStore } from '../stores/appMetaStore';
import { useAIConfigStore } from '../stores/aiConfigStore';

export type ErrorType = 'network' | 'auth' | 'validation' | 'api' | 'timeout' | 'abort' | 'unknown';

export interface ErrorInfo {
	type: ErrorType;
	message: string;
	originalError?: Error;
	code?: string;
}

export function getErrorType(error: unknown): ErrorType {
	if (error instanceof DOMException && error.name === 'AbortError') return 'abort';
	if (error instanceof Error) {
		const msg = error.message.toLowerCase();
		if (msg.includes('timeout') || msg.includes('timed out')) return 'timeout';
		if (msg.includes('network') || msg.includes('fetch') || msg.includes('failed to fetch')) return 'network';
		if (msg.includes('auth') || msg.includes('api key') || msg.includes('unauthorized') || msg.includes('401')) return 'auth';
		if (msg.includes('rate') || msg.includes('429')) return 'api';
		if (msg.includes('validation') || msg.includes('invalid')) return 'validation';
		if (msg.includes('api') || msg.includes('response') || msg.includes('500') || msg.includes('502') || msg.includes('503')) return 'api';
	}
	return 'unknown';
}

export function getFriendlyMessage(error: unknown, type: ErrorType): string {
	if (error instanceof Error) {
		const msg = error.message;
		if (msg.includes('Failed to fetch')) return '网络请求失败，请检查网络连接或API配置';
		if (msg.includes('401')) return 'API Key 无效或已过期，请检查配置';
		if (msg.includes('429')) return '请求过于频繁，请稍后再试';
		if (msg.includes('500')) return '服务器内部错误，请稍后再试';
		if (msg.includes('502') || msg.includes('503')) return '服务暂时不可用，请稍后再试';
	}

	switch (type) {
		case 'network': return '网络连接失败，请检查网络设置';
		case 'auth': return '认证失败，请检查API密钥配置';
		case 'timeout': return '请求超时，请检查网络或稍后重试';
		case 'abort': return '操作已取消';
		case 'validation': return '数据验证失败，请检查输入内容';
		case 'api': return 'API请求失败，请稍后重试';
		default:
			if (error instanceof Error) return error.message;
			return '发生未知错误，请重试';
	}
}

export function handleError(error: unknown, context?: string): ErrorInfo {
	const type = getErrorType(error);
	const message = getFriendlyMessage(error, type);

	logger.errorGeneric(context || 'Error', error);

	return {
		type,
		message,
		originalError: error instanceof Error ? error : undefined,
	};
}

export function handleErrorWithToast(error: unknown, context?: string): void {
	const errorInfo = handleError(error, context);
	useAppMetaStore.getState().showToast(errorInfo.message, 'error');
}

export async function safeExecute<T>(
	fn: () => Promise<T>,
	context?: string,
	showToast: boolean = true
): Promise<T | null> {
	try {
		return await fn();
	} catch (error) {
		if (showToast) {
			handleErrorWithToast(error, context);
		} else {
			handleError(error, context);
		}
		return null;
	}
}

export function handleApiError(error: unknown, context?: string): ErrorInfo {
	const errorInfo = handleError(error, context);

	if (errorInfo.type === 'auth') {
		useAIConfigStore.getState().setAIConfig({ apiKey: '' });
	}

	return errorInfo;
}
