// ============================================================
// 统一错误处理工具
// ============================================================
import { logger } from './logger';
import { useAppStore } from '../stores/appStore';

export type ErrorType = 'network' | 'auth' | 'validation' | 'api' | 'unknown';

export interface ErrorInfo {
	type: ErrorType;
	message: string;
	originalError?: Error;
	code?: string;
}

/**
 * 获取错误类型
 */
function getErrorType(error: unknown): ErrorType {
	if (error instanceof Error) {
		const message = error.message.toLowerCase();
		if (message.includes('network') || message.includes('fetch') || message.includes('http')) {
			return 'network';
		}
		if (message.includes('auth') || message.includes('api key') || message.includes('unauthorized')) {
			return 'auth';
		}
		if (message.includes('validation') || message.includes('invalid')) {
			return 'validation';
		}
		if (message.includes('api') || message.includes('response')) {
			return 'api';
		}
	}
	return 'unknown';
}

/**
 * 获取用户友好的错误消息
 */
function getFriendlyMessage(error: unknown, type: ErrorType): string {
	switch (type) {
		case 'network':
			return '网络连接失败，请检查网络设置';
		case 'auth':
			return '认证失败，请检查API密钥配置';
		case 'validation':
			return '数据验证失败，请检查输入内容';
		case 'api':
			return 'API请求失败，请稍后重试';
		default:
			if (error instanceof Error) {
				return error.message;
			}
			return '发生未知错误，请重试';
	}
}

/**
 * 统一错误处理函数
 */
export function handleError(error: unknown, context?: string): ErrorInfo {
	const type = getErrorType(error);
	const message = getFriendlyMessage(error, type);
	
	// 记录日志
	logger.errorGeneric(context || 'Error', error);
	
	return {
		type,
		message,
		originalError: error instanceof Error ? error : undefined,
	};
}

/**
 * 处理错误并显示Toast
 */
export function handleErrorWithToast(error: unknown, context?: string): void {
	const errorInfo = handleError(error, context);
	useAppStore.getState().showToast(errorInfo.message, 'error');
}

/**
 * 安全执行异步操作，自动处理错误
 */
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

/**
 * API错误处理
 */
export function handleApiError(error: unknown, context?: string): ErrorInfo {
	const errorInfo = handleError(error, context);
	
	// 如果是认证错误，清除API密钥
	if (errorInfo.type === 'auth') {
		const appStore = useAppStore.getState();
		// 清除所有API密钥
		appStore.setAIConfig({ apiKey: '' });
	}
	
	return errorInfo;
}