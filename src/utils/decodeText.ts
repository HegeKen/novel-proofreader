// ============================================================
// 文本编码检测与解码（UTF-8 / UTF-16 / GB18030）
// ============================================================

/**
 * 检测 ArrayBuffer 的文本编码并解码为字符串
 *
 * 检测顺序：
 * 1. BOM 检测（UTF-8 / UTF-16 LE / UTF-16 BE）
 * 2. UTF-8 合法率统计（容忍少量坏字节，避免"一个坏字节整体回退"导致乱码）
 * 3. UTF-16 启发式（无 BOM 但结构像 UTF-16 的文档）
 * 4. 回退 GB18030（GBK 超集）
 */
export function decodeTextBuffer(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	if (bytes.length === 0) return "";

	// ---- 1. BOM 检测 ----
	if (bytes.length >= 2) {
		// UTF-16 LE BOM: FF FE
		if (bytes[0] === 0xff && bytes[1] === 0xfe) {
			// 注意：FF FE 也可能是 UTF-32 LE 的 BOM，此处按 UTF-16 处理
			try {
				return new TextDecoder("utf-16le").decode(bytes.subarray(2));
			} catch {
				// fall through
			}
		}
		// UTF-16 BE BOM: FE FF
		if (bytes[0] === 0xfe && bytes[1] === 0xff) {
			try {
				return new TextDecoder("utf-16be").decode(bytes.subarray(2));
			} catch {
				// fall through
			}
		}
	}

	let offset = 0;
	// UTF-8 BOM（EF BB BF）
	if (
		bytes.length >= 3 &&
		bytes[0] === 0xef &&
		bytes[1] === 0xbb &&
		bytes[2] === 0xbf
	) {
		offset = 3;
	}

	const body = bytes.subarray(offset);

	// ---- 2. UTF-8 合法率统计 ----
	// 统计非法序列数量：若坏字节占比极低（混合编码/少量乱码的 UTF-8 文件），仍按 UTF-8 解码
	const { invalidCount, sampleCount } = countInvalidUtf8(body);
	// 绝对容差（小文件内零星坏字节）+ 比例容差（大文件内少量乱码）双条件
	const absoluteTolerance = invalidCount <= 3;
	const ratioTolerance = sampleCount > 0 && invalidCount / sampleCount < 0.005;
	if (absoluteTolerance || ratioTolerance) {
		return decodeUtf8Lossy(body);
	}

	// ---- 3. UTF-16 启发式（无 BOM）----
	// 大量 \x00 交替出现在偶数/奇数位置 → 很可能是 UTF-16
	const utf16Score = scoreUtf16(body);
	if (utf16Score.ratio > 0.3 && utf16Score.zeroBytes > body.length * 0.1) {
		try {
			return new TextDecoder(utf16Score.le ? "utf-16le" : "utf-16be").decode(body);
		} catch {
			// fall through
		}
	}

	// ---- 4. 回退 GB18030（GBK 超集）----
	return new TextDecoder("gb18030").decode(body);
}

/** 严格解码 UTF-8；若失败则逐字节降级，最大限度保留可读内容 */
function decodeUtf8Lossy(bytes: Uint8Array): string {
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		// 将非法字节替换为 U+FFFD，保留合法部分
		return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
	}
}

/** 统计 UTF-8 非法序列数量（按序列首字节分类判断） */
function countInvalidUtf8(bytes: Uint8Array): { invalidCount: number; sampleCount: number } {
	let invalidCount = 0;
	let i = 0;
	// 采样上限：最多扫描前 64KB，避免大文件全量扫描
	const limit = Math.min(bytes.length, 64 * 1024);
	while (i < limit) {
		const b = bytes[i];
		if (b < 0x80) {
			i++;
			continue;
		}
		// 多字节序列：根据首字节判断后续长度
		let seqLen: number;
		if (b >= 0xc2 && b <= 0xdf) seqLen = 2; // 2 字节
		else if (b >= 0xe0 && b <= 0xef) seqLen = 3; // 3 字节
		else if (b >= 0xf0 && b <= 0xf4) seqLen = 4; // 4 字节
		else {
			// 非法首字节（0x80-0xC1 或 0xF5-0xFF）
			invalidCount++;
			i++;
			continue;
		}

		let valid = true;
		for (let j = 1; j < seqLen; j++) {
			const next = bytes[i + j];
			// 后续字节必须是 0x80-0xBF
			if (next === undefined || next < 0x80 || next > 0xbf) {
				valid = false;
				break;
			}
		}
		if (!valid) {
			invalidCount++;
			i++;
		} else {
			i += seqLen;
		}
	}
	return { invalidCount, sampleCount: limit };
}

/** 启发式评分：判断字节流是否为 UTF-16（LE/BE），返回零字节占比与方向 */
function scoreUtf16(bytes: Uint8Array): { ratio: number; zeroBytes: number; le: boolean } {
	if (bytes.length < 4) return { ratio: 0, zeroBytes: 0, le: true };

	let zeroBytes = 0;
	let evenZero = 0;
	let oddZero = 0;
	const limit = Math.min(bytes.length, 64 * 1024);

	for (let i = 0; i < limit; i++) {
		if (bytes[i] === 0x00) {
			zeroBytes++;
			if (i % 2 === 0) evenZero++;
			else oddZero++;
		}
	}

	// 中文 UTF-16LE 中，\x00 主要出现在偶数索引（高字节在奇数为 0 或非 0，视字符而定），
	// 但 ASCII 文本 UTF-16LE 的 \x00 在奇数索引。综合判断：
	// - LE：\x00 偏向奇数索引
	// - BE：\x00 偏向偶数索引
	const le = oddZero >= evenZero;
	return { ratio: zeroBytes / Math.max(1, limit), zeroBytes, le };
}
