/**
 * 构建环境与可复现构建辅助。
 *
 * 工具链指纹 / git 状态 / SOURCE_DATE_EPOCH 都用于区分
 * 「真漂移」（配置变了）和「环境差异」（工具链变了）。
 */

import { PROJECT_ROOT } from "./paths.mjs";
import { canonicalJson, sha256 } from "./crypto.mjs";
import { tryRun } from "./exec.mjs";

/** 工具链指纹：工具链不同时产物本来就允许不同，用它来区分"真漂移"和"环境差异"。 */
export function detectToolchain(root = PROJECT_ROOT) {
	const rustc = tryRun("rustc", ["--version"], { cwd: root })?.trim() ?? "unknown";
	const cargo = tryRun("cargo", ["--version"], { cwd: root })?.trim() ?? "unknown";
	const pnpm = tryRun("pnpm", ["--version"], { cwd: root })?.trim() ?? "unknown";
	const java = tryRun("java", ["-version"], { cwd: root, allowStderr: true })?.trim().split("\n")[0] ?? "unknown";
	const toolchain = {
		rustc,
		cargo,
		pnpm,
		java,
		node: process.version,
		platform: process.platform,
		arch: process.arch,
	};
	toolchain.key = `sha256:${sha256(canonicalJson(toolchain))}`;
	return toolchain;
}

export function gitInfo(root = PROJECT_ROOT) {
	const commit = tryRun("git", ["rev-parse", "HEAD"], { cwd: root })?.trim() ?? null;
	const commitEpoch = tryRun("git", ["log", "-1", "--format=%ct"], { cwd: root })?.trim() ?? null;
	const status = tryRun("git", ["status", "--porcelain"], { cwd: root }) ?? "";
	const tags = tryRun("git", ["tag", "--points-at", "HEAD"], { cwd: root })?.trim() ?? "";
	return {
		commit,
		commitEpoch: commitEpoch ? Number(commitEpoch) : null,
		dirty: status.trim().length > 0,
		tags: tags ? tags.split("\n") : [],
	};
}

/**
 * SOURCE_DATE_EPOCH：可复现构建的事实标准，构建工具链会用它替代"当前时间"。
 * 默认取 HEAD 的提交时间，保证同一 commit 永远得到同一时间戳。
 */
export function resolveSourceDateEpoch(config, root = PROJECT_ROOT) {
	const mode = config?.reproducibility?.sourceDateEpoch ?? "commit";
	if (typeof mode === "number") return Math.floor(mode);
	if (mode === "zero") return 0;
	const epoch = gitInfo(root).commitEpoch;
	return epoch ?? 0;
}
