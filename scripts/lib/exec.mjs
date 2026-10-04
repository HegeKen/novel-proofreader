/**
 * 通用进程执行与文件 IO。
 *
 * 约定：tryRun/commandExists 静默容忍失败（返回 null/false）；
 * run/capture 失败即抛错（用于构建主流程）。
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PROJECT_ROOT } from "./paths.mjs";
import { log } from "./log.mjs";

export function tryRun(command, args = [], options = {}) {
	try {
		const result = spawnSync(command, args, {
			cwd: options.cwd ?? PROJECT_ROOT,
			encoding: "utf8",
			stdio: ["ignore", "pipe", options.allowStderr ? "pipe" : "ignore"],
			shell: false,
			...(options.env ? { env: options.env } : {}),
		});
		if (result.error || result.status !== 0) return null;
		const stdout = result.stdout ?? "";
		const stderr = result.stderr ?? "";
		return options.allowStderr ? `${stdout}${stderr}` : stdout;
	} catch {
		return null;
	}
}

export function commandExists(command) {
	return Boolean(tryRun(command, ["--version"])) || Boolean(tryRun("which", [command]));
}

/** 前台执行，继承 stdio；失败即抛错。 */
export function run(command, args = [], options = {}) {
	log.dim(`$ ${[command, ...args].join(" ")}`);
	const result = spawnSync(command, args, {
		cwd: options.cwd ?? PROJECT_ROOT,
		stdio: "inherit",
		shell: false,
		...(options.env ? { env: options.env } : {}),
	});
	if (result.error) throw new Error(`执行失败: ${command} (${result.error.message})`);
	if (result.status !== 0) throw new Error(`命令退出码 ${result.status}: ${[command, ...args].join(" ")}`);
}

/** 静默执行并返回 stdout；失败即抛错。 */
export function capture(command, args = [], options = {}) {
	const result = spawnSync(command, args, {
		cwd: options.cwd ?? PROJECT_ROOT,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		shell: false,
		...(options.env ? { env: options.env } : {}),
	});
	if (result.error) throw new Error(`执行失败: ${command} (${result.error.message})`);
	if (result.status !== 0) {
		throw new Error(`命令退出码 ${result.status}: ${command} ${args.join(" ")}\n${result.stderr ?? ""}`);
	}
	return result.stdout ?? "";
}

export function readJson(filePath) {
	return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function writeJson(filePath, value) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function ensureDir(dirPath) {
	fs.mkdirSync(dirPath, { recursive: true });
	return dirPath;
}

export function shellQuote(value) {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function writeFileSecure(filePath, contents) {
	ensureDir(path.dirname(filePath));
	fs.writeFileSync(filePath, contents, "utf8");
	fs.chmodSync(filePath, 0o600);
	return filePath;
}
