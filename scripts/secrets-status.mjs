#!/usr/bin/env node
/**
 * 检查仓库 Secrets 的配置情况，并对**每一个缺失项**给出「去哪拿 + 用什么命令写入」。
 *
 * 用法:
 *   pnpm run secrets:status              # 列出已配置 / 缺失，并给出获取与写入指引
 *   pnpm run secrets:status -- --strict  # 有必需项缺失时以非 0 退出（可放进 CI 或提交前检查）
 *   pnpm run secrets:status -- --json
 *
 * 说明：GitHub 只能列出 Secret 的**名字与更新时间**，值无法读回。
 * 因此本命令只判断「在不在」，并把值的获取方式与你该执行的写入命令一并打印出来。
 */

import process from "node:process";
import { loadSigningConfig, log, runCli, tryRun } from "./lib/core.mjs";
import { buildSecretEntries } from "./lib/secrets.mjs";

function parseArgs(argv) {
	const options = { strict: false, json: false };
	for (const token of argv) {
		if (token === "--strict") options.strict = true;
		else if (token === "--json") options.json = true;
	}
	return options;
}

/** 读取仓库现有 Secret 名（只拿名字，值读不回来）。 */
export function listRemoteSecretNames() {
	if (!tryRun("gh", ["--version"])) {
		return { available: false, reason: "未安装 gh CLI", names: [] };
	}
	const auth = tryRun("gh", ["auth", "status"]);
	if (!auth) {
		return { available: false, reason: "gh 未登录（gh auth login）", names: [] };
	}
	const output = tryRun("gh", ["secret", "list", "--json", "name"]);
	if (!output) {
		return { available: false, reason: "无法读取仓库 Secrets（可能不在 git 仓库内或无权限）", names: [] };
	}
	try {
		const parsed = JSON.parse(output);
		return { available: true, names: parsed.map((entry) => entry.name) };
	} catch {
		return { available: false, reason: "gh secret list 输出无法解析", names: [] };
	}
}

function main() {
	const options = parseArgs(process.argv.slice(2));
	const config = loadSigningConfig();
	const entries = buildSecretEntries({ config });
	const remote = listRemoteSecretNames();
	const present = new Set(remote.names);

	const rows = entries.map((entry) => ({
		...entry,
		configured: present.has(entry.name),
	}));
	const missingRequired = rows.filter((row) => row.required && !row.configured);
	const missingOptional = rows.filter((row) => !row.required && !row.configured);

	if (options.json) {
		log.raw(JSON.stringify({ remote, rows }, null, 2));
		process.exitCode = options.strict && missingRequired.length > 0 ? 1 : 0;
		return;
	}

	log.title("仓库 Secrets 状态");
	if (!remote.available) {
		log.warn(`无法确认远程状态：${remote.reason}`);
		log.dim("下面仍会列出本仓库需要的全部 Secret 及其获取方式");
	} else {
		log.info(`远程已配置 ${remote.names.length} 个 Secret`);
	}

	const render = (row, marker) => {
		log.raw(`  ${marker} ${row.name}${row.required ? "（必需）" : "（按需）"}`);
		log.dim(`      用途：${row.purpose}`);
		log.dim(`      获取：${row.howTo}`);
		if (row.produceCommand) log.dim(`      产出：${row.produceCommand}`);
		log.dim(`      写入：${row.writeCommand ?? `gh secret set ${row.name}`}`);
	};

	const configured = rows.filter((row) => row.configured);
	if (configured.length > 0) {
		log.title(`已配置（${configured.length}）`);
		for (const row of configured) log.raw(`  ✓ ${row.name}`);
	}

	if (missingRequired.length > 0) {
		log.title(`缺失且必需（${missingRequired.length}）—— 补齐后 tag 发布才能产出已签名的包`);
		for (const row of missingRequired) render(row, "✗");
	} else if (remote.available) {
		log.title("必需项");
		log.ok("全部已配置");
	}

	if (missingOptional.length > 0) {
		log.title(`未配置（按需，${missingOptional.length}）—— 只影响对应平台的签名`);
		for (const row of missingOptional) render(row, "·");
	}

	log.raw("");
	if (missingRequired.length > 0 && remote.available) {
		log.info("提示：能由本机材料直接产出的项，可用向导汇总的 dotenv 一次写入：");
		log.dim("  pnpm run setup:signing && gh secret set -f .signing/github-secrets.env");
	}
	log.raw("");

	process.exitCode = options.strict && missingRequired.length > 0 ? 1 : 0;
}

runCli(main);
