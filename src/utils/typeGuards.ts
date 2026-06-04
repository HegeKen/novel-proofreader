// ============================================================
// 类型守卫工具 - 运行时类型检查
// ============================================================

/**
 * 检查是否为字符串
 */
export function isString(value: unknown): value is string {
	return typeof value === 'string';
}

/**
 * 检查是否为数字
 */
export function isNumber(value: unknown): value is number {
	return typeof value === 'number' && !isNaN(value);
}

/**
 * 检查是否为布尔值
 */
export function isBoolean(value: unknown): value is boolean {
	return typeof value === 'boolean';
}

/**
 * 检查是否为对象（非空）
 */
export function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

/**
 * 检查是否为数组
 */
export function isArray<T>(value: unknown, validator?: (item: unknown) => item is T): value is T[] {
	if (!Array.isArray(value)) return false;
	if (validator) {
		return value.every(validator);
	}
	return true;
}

/**
 * 检查是否为函数
 */
export function isFunction(value: unknown): value is (...args: unknown[]) => unknown {
	return typeof value === 'function';
}

/**
 * 检查是否为日期
 */
export function isDate(value: unknown): value is Date {
	return value instanceof Date && !isNaN(value.getTime());
}

/**
 * 检查字符串数组
 */
export function isStringArray(value: unknown): value is string[] {
	return isArray(value, isString);
}

/**
 * 检查数字数组
 */
export function isNumberArray(value: unknown): value is number[] {
	return isArray(value, isNumber);
}

/**
 * 检查 CharacterInfo 类型
 */
export function isCharacterInfo(value: unknown): value is {
	id: string;
	name: string;
	gender: 'male' | 'female' | 'other';
	relationTerms?: string[];
	notes?: string;
	[extra: string]: unknown;
} {
	if (!isObject(value)) return false;
	if (!isString((value as Record<string, unknown>).id)) return false;
	if (!isString((value as Record<string, unknown>).name)) return false;
	const gender = (value as Record<string, unknown>).gender;
	if (!['male', 'female', 'other'].includes(String(gender))) return false;
	const relationTerms = (value as Record<string, unknown>).relationTerms;
	if (relationTerms !== undefined && !isStringArray(relationTerms)) return false;
	const notes = (value as Record<string, unknown>).notes;
	if (notes !== undefined && !isString(notes)) return false;
	return true;
}

/**
 * 检查 CharacterRelationship 类型
 */
export function isCharacterRelationship(value: unknown): value is {
	id: string;
	novelId: string;
	sourceId: string;
	targetId: string;
	relationType: string[];
	sourceNickname?: string[];
	targetNickname?: string[];
} {
	if (!isObject(value)) return false;
	if (!isString((value as Record<string, unknown>).id)) return false;
	if (!isString((value as Record<string, unknown>).novelId)) return false;
	if (!isString((value as Record<string, unknown>).sourceId)) return false;
	if (!isString((value as Record<string, unknown>).targetId)) return false;
	const relationType = (value as Record<string, unknown>).relationType;
	if (!isStringArray(relationType)) return false;
	const sourceNickname = (value as Record<string, unknown>).sourceNickname;
	if (sourceNickname !== undefined && !isStringArray(sourceNickname)) return false;
	const targetNickname = (value as Record<string, unknown>).targetNickname;
	if (targetNickname !== undefined && !isStringArray(targetNickname)) return false;
	return true;
}

/**
 * 检查 AIConfig 类型
 */
export function isAIConfig(value: unknown): value is {
	baseURL: string;
	apiKey: string;
	model: string;
	customHeaders?: Record<string, string>;
	maxCharsPerRequest?: number;
	enableLogging?: boolean;
} {
	if (!isObject(value)) return false;
	if (!isString((value as Record<string, unknown>).baseURL)) return false;
	if (!isString((value as Record<string, unknown>).apiKey)) return false;
	if (!isString((value as Record<string, unknown>).model)) return false;
	const customHeaders = (value as Record<string, unknown>).customHeaders;
	if (customHeaders !== undefined && !isObject(customHeaders)) return false;
	const maxCharsPerRequest = (value as Record<string, unknown>).maxCharsPerRequest;
	if (maxCharsPerRequest !== undefined && !isNumber(maxCharsPerRequest)) return false;
	const enableLogging = (value as Record<string, unknown>).enableLogging;
	if (enableLogging !== undefined && !isBoolean(enableLogging)) return false;
	return true;
}

/**
 * 验证并解析 JSON，返回类型安全的结果
 */
export function safeJsonParse<T>(
	jsonString: string,
	validator?: (value: unknown) => value is T
): T | null {
	try {
		const parsed = JSON.parse(jsonString);
		if (validator && !validator(parsed)) {
			return null;
		}
		return parsed as T;
	} catch {
		return null;
	}
}

/**
 * 安全访问对象属性
 */
export function getProperty<T>(
	obj: unknown,
	path: string,
	defaultValue?: T
): T | undefined {
	if (!isObject(obj)) return defaultValue;
	
	const keys = path.split('.');
	let current: unknown = obj;
	
	for (const key of keys) {
		if (!isObject(current)) return defaultValue;
		current = current[key];
	}
	
	return current as T ?? defaultValue;
}

/**
 * 断言函数 - 用于开发时类型检查
 */
export function assert(condition: boolean, message: string): asserts condition {
	if (!condition) {
		throw new Error(`Assertion failed: ${message}`);
	}
}

/**
 * 断言值不为空
 */
export function assertNonNull<T>(value: T | null | undefined): asserts value is T {
	if (value === null || value === undefined) {
		throw new Error('Value is null or undefined');
	}
}