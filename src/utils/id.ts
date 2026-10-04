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

