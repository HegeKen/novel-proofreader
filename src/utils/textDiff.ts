// ============================================================
// 文本对比工具 - 基于逐字符 LCS 算法的 diff
// ============================================================

/** diff 片段类型 */
export type DiffType = "equal" | "added" | "removed" | "modified" | "placeholder";

/** 单个 diff 片段 */
export interface DiffPart {
	type: DiffType;
	text: string;
}

/** 一行 diff 的结果 */
export interface DiffLine {
	lineNumberOld: number | null; // 旧文本行号（null 表示新增行）
	lineNumberNew: number | null; // 新文本行号（null 表示删除行）
	parts: DiffPart[]; // 逐字符 diff 片段
	type: DiffType; // 行类型（整行相等/新增/删除/修改）
}

/** diffChars 的最大文本长度，超过此值不做逐字符 diff，直接返回整段 added/removed */
const MAX_DIFF_CHARS = 2000;

/**
 * 逐字符 LCS diff 算法
 * 将两段文本按字符级别对比，返回 diff 片段数组
 * 注意：对超长文本（>MAX_DIFF_CHARS）直接返回整段 removed+added，避免 O(n*m) 性能问题
 */
export function diffChars(text1: string, text2: string): DiffPart[] {
	const len1 = text1.length;
	const len2 = text2.length;

	// 超长文本不做逐字符 diff，避免性能问题
	if (len1 > MAX_DIFF_CHARS || len2 > MAX_DIFF_CHARS) {
		return [
			{ type: "removed", text: text1 },
			{ type: "added", text: text2 },
		];
	}

	// LCS DP 表
	const dp: number[][] = Array(len1 + 1)
		.fill(null)
		.map(() => Array(len2 + 1).fill(0));

	for (let i = len1 - 1; i >= 0; i--) {
		for (let j = len2 - 1; j >= 0; j--) {
			if (text1[i] === text2[j]) {
				dp[i][j] = dp[i + 1][j + 1] + 1;
			} else {
				dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
			}
		}
	}

	// 回溯生成 diff
	const parts: DiffPart[] = [];
	let i = 0;
	let j = 0;

	while (i < len1 && j < len2) {
		if (text1[i] === text2[j]) {
			pushPart(parts, "equal", text1[i]);
			i++;
			j++;
		} else if (dp[i + 1][j] >= dp[i][j + 1]) {
			pushPart(parts, "removed", text1[i]);
			i++;
		} else {
			pushPart(parts, "added", text2[j]);
			j++;
		}
	}

	while (i < len1) {
		pushPart(parts, "removed", text1[i]);
		i++;
	}

	while (j < len2) {
		pushPart(parts, "added", text2[j]);
		j++;
	}

	return parts;
}

/** 合并相邻同类型片段 */
function pushPart(parts: DiffPart[], type: DiffType, char: string): void {
	if (parts.length > 0 && parts[parts.length - 1].type === type) {
		parts[parts.length - 1].text += char;
	} else {
		parts.push({ type, text: char });
	}
}

/**
 * 按行对比两段文本，每行内部使用逐字符 diff
 * 使用基于 LCS 的行级对比
 */
export function diffLines(text1: string, text2: string): DiffLine[] {
	// 规范化换行符：统一 \r\n 和 \r 为 \n，避免行尾不可见字符导致匹配失败
	const normalizedText1 = text1.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	const normalizedText2 = text2.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

	const lines1 = normalizedText1.split("\n");
	const lines2 = normalizedText2.split("\n");

	// 行级 LCS
	const len1 = lines1.length;
	const len2 = lines2.length;
	const dp: number[][] = Array(len1 + 1)
		.fill(null)
		.map(() => Array(len2 + 1).fill(0));

	for (let i = len1 - 1; i >= 0; i--) {
		for (let j = len2 - 1; j >= 0; j--) {
			if (lines1[i] === lines2[j]) {
				dp[i][j] = dp[i + 1][j + 1] + 1;
			} else {
				dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
			}
		}
	}

	// 回溯
	const rawLines: DiffLine[] = [];
	let i = 0;
	let j = 0;
	let lineNum1 = 1;
	let lineNum2 = 1;

	while (i < len1 && j < len2) {
		if (lines1[i] === lines2[j]) {
			rawLines.push({
				lineNumberOld: lineNum1,
				lineNumberNew: lineNum2,
				parts: [{ type: "equal", text: lines1[i] }],
				type: "equal",
			});
			i++;
			j++;
			lineNum1++;
			lineNum2++;
		} else if (dp[i + 1][j] >= dp[i][j + 1]) {
			// 删除行
			rawLines.push({
				lineNumberOld: lineNum1,
				lineNumberNew: null,
				parts: [{ type: "removed", text: lines1[i] }],
				type: "removed",
			});
			i++;
			lineNum1++;
		} else {
			// 新增行
			rawLines.push({
				lineNumberOld: null,
				lineNumberNew: lineNum2,
				parts: [{ type: "added", text: lines2[j] }],
				type: "added",
			});
			j++;
			lineNum2++;
		}
	}

	// 剩余的删除行
	while (i < len1) {
		rawLines.push({
			lineNumberOld: lineNum1,
			lineNumberNew: null,
			parts: [{ type: "removed", text: lines1[i] }],
			type: "removed",
		});
		i++;
		lineNum1++;
	}

	// 剩余的新增行
	while (j < len2) {
		rawLines.push({
			lineNumberOld: null,
			lineNumberNew: lineNum2,
			parts: [{ type: "added", text: lines2[j] }],
			type: "added",
		});
		j++;
		lineNum2++;
	}

	// 合并相邻的删除+新增为"修改"行，对内部做逐字符 diff
	const result: DiffLine[] = [];
	let k = 0;
	while (k < rawLines.length) {
		const line = rawLines[k];

		// 查找连续的 removed 块
		if (line.type === "removed") {
			const removedBlock: DiffLine[] = [];
			while (k < rawLines.length && rawLines[k].type === "removed") {
				removedBlock.push(rawLines[k]);
				k++;
			}
			// 查找紧随的 added 块
			const addedBlock: DiffLine[] = [];
			while (k < rawLines.length && rawLines[k].type === "added") {
				addedBlock.push(rawLines[k]);
				k++;
			}

			// 如果 removed 和 added 各一行，做逐字符 diff 合并为一个"修改"行
			if (removedBlock.length === 1 && addedBlock.length === 1) {
				const charDiff = diffChars(removedBlock[0].parts[0].text, addedBlock[0].parts[0].text);
				// 检查是否有实际差异（非完全 added/removed）
				const hasEqual = charDiff.some((p) => p.type === "equal");
				if (hasEqual) {
					result.push({
						lineNumberOld: removedBlock[0].lineNumberOld,
						lineNumberNew: addedBlock[0].lineNumberNew,
						parts: charDiff,
						type: "modified",
					});
					continue;
				}
			}

			// 否则分别输出
			for (const r of removedBlock) result.push(r);
			for (const a of addedBlock) result.push(a);
		} else {
			result.push(line);
			k++;
		}
	}

	return result;
}

/** 精细对比相似度阈值，低于此值不配对 */
const FINE_SIMILARITY_THRESHOLD = 0.2;

/** 计算两段文本的相似度（基于 LCS 长度 / 较长文本长度），范围 [0, 1] */
function similarity(a: string, b: string): number {
	if (!a && !b) return 1;
	if (!a || !b) return 0;
	const maxLen = Math.max(a.length, b.length);
	if (maxLen === 0) return 1;
	return lcsLength(a, b) / maxLen;
}

/** 计算两段文本的 LCS 长度（滚动数组优化空间） */
function lcsLength(a: string, b: string): number {
	const m = a.length;
	const n = b.length;
	// 超长文本降级：返回较短长度的 50% 作为粗略估计
	if (m > MAX_DIFF_CHARS || n > MAX_DIFF_CHARS) {
		return Math.floor(Math.min(m, n) * 0.5);
	}
	const dp = Array(n + 1).fill(0);
	for (let i = 1; i <= m; i++) {
		let prev = 0;
		for (let j = 1; j <= n; j++) {
			const temp = dp[j];
			if (a[i - 1] === b[j - 1]) {
				dp[j] = prev + 1;
			} else {
				dp[j] = Math.max(dp[j], dp[j - 1]);
			}
			prev = temp;
		}
	}
	return dp[n];
}

/**
 * 精细逐字对比：在 diffLines 基础上，对所有未配对的删除行与新增行
 * 按相似度贪心配对，再做逐字符 diff，精确到单个字、标点。
 * 即使删除行与新增行不相邻，也会尝试配对。
 */
export function diffLinesFine(text1: string, text2: string): DiffLine[] {
	const baseDiff = diffLines(text1, text2);

	// 收集所有未配对的删除行与新增行位置
	const removedIndices: number[] = [];
	const addedIndices: number[] = [];
	for (let i = 0; i < baseDiff.length; i++) {
		if (baseDiff[i].type === "removed") removedIndices.push(i);
		else if (baseDiff[i].type === "added") addedIndices.push(i);
	}

	// 无可配对行，直接返回
	if (removedIndices.length === 0 || addedIndices.length === 0) {
		return baseDiff;
	}

	// 计算所有配对的相似度，按相似度降序排列
	const pairs: { rPos: number; aPos: number; sim: number }[] = [];
	for (const rPos of removedIndices) {
		for (const aPos of addedIndices) {
			const sim = similarity(
				baseDiff[rPos].parts[0].text,
				baseDiff[aPos].parts[0].text,
			);
			if (sim >= FINE_SIMILARITY_THRESHOLD) {
				pairs.push({ rPos, aPos, sim });
			}
		}
	}
	pairs.sort((a, b) => b.sim - a.sim);

	// 贪心匹配：每个删除行/新增行最多匹配一次
	const usedRemoved = new Set<number>();
	const usedAdded = new Set<number>();
	const skipPositions = new Set<number>(); // 被合并的新增行位置（需跳过）
	const modifiedAt = new Map<number, DiffLine>(); // 删除行位置 -> 修改行

	for (const { rPos, aPos } of pairs) {
		if (usedRemoved.has(rPos) || usedAdded.has(aPos)) continue;
		usedRemoved.add(rPos);
		usedAdded.add(aPos);

		const rLine = baseDiff[rPos];
		const aLine = baseDiff[aPos];
		const charDiff = diffChars(rLine.parts[0].text, aLine.parts[0].text);

		modifiedAt.set(rPos, {
			lineNumberOld: rLine.lineNumberOld,
			lineNumberNew: aLine.lineNumberNew,
			parts: charDiff,
			type: "modified",
		});
		skipPositions.add(aPos);
	}

	// 重建结果：跳过被合并的新增行，替换被配对的删除行
	const result: DiffLine[] = [];
	for (let i = 0; i < baseDiff.length; i++) {
		if (skipPositions.has(i)) continue;
		if (modifiedAt.has(i)) {
			result.push(modifiedAt.get(i)!);
		} else {
			result.push(baseDiff[i]);
		}
	}

	return result;
}

/** diff 统计信息 */
export interface DiffStats {
	added: number; // 新增字符数
	removed: number; // 删除字符数
	modifiedLines: number; // 修改行数
	totalLines: number; // 总行数
}

/** 计算 diff 统计信息 */
export function getDiffStats(lines: DiffLine[]): DiffStats {
	let added = 0;
	let removed = 0;
	let modifiedLines = 0;

	for (const line of lines) {
		if (line.type === "modified") {
			modifiedLines++;
			for (const part of line.parts) {
				if (part.type === "added") added += part.text.length;
				if (part.type === "removed") removed += part.text.length;
			}
		} else if (line.type === "added") {
			added += line.parts[0].text.length;
			modifiedLines++;
		} else if (line.type === "removed") {
			removed += line.parts[0].text.length;
			modifiedLines++;
		}
	}

	return {
		added,
		removed,
		modifiedLines,
		totalLines: lines.length,
	};
}
