// ============================================================
// ID 生成工具 — 统一各模块的 ID 生成方式
// ============================================================

/**
 * 生成带前缀的唯一 ID，格式：`${prefix}-${timestamp}-${random}`
 * @param prefix ID 前缀（如 "char"、"rel"、"evt"）
 * @param randomLength 随机段长度（默认 9）
 */
export function generateId(prefix: string, randomLength: number = 9): string {
	return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 2 + randomLength)}`;
}

/**
 * 按合法 novelId 集合过滤 Record（清理已删除小说的残留数据）
 */
export function filterRecordByKeys<T>(record: Record<string, T>, validKeys: string[]): Record<string, T> {
	const validSet = new Set(validKeys);
	const result: Record<string, T> = {};
	for (const key of Object.keys(record)) {
		if (validSet.has(key)) result[key] = record[key];
	}
	return result;
}

