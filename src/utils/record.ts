// ============================================================
// Record 工具函数
// ============================================================

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
