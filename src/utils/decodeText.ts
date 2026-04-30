// ============================================================
// 文本编码检测与解码（UTF-8 / GBK / GB18030）
// ============================================================

/**
 * 检测 ArrayBuffer 的文本编码并解码为字符串
 * 优先 UTF-8（含 BOM 跳过），失败则回退 GB18030（GBK 超集）
 */
export function decodeTextBuffer(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);

	// 跳过 UTF-8 BOM（EF BB BF）
	let offset = 0;
	if (
		bytes.length >= 3 &&
		bytes[0] === 0xef &&
		bytes[1] === 0xbb &&
		bytes[2] === 0xbf
	) {
		offset = 3;
	}

	// 尝试 UTF-8（严格模式，非法序列会抛异常）
	try {
		const decoder = new TextDecoder("utf-8", { fatal: true });
		return decoder.decode(bytes.subarray(offset));
	} catch {
		// 非 UTF-8，回退 GB18030
	}

	// GB18030 是 GBK 的超集，兼容所有 GBK 编码
	return new TextDecoder("gb18030").decode(bytes.subarray(offset));
}
