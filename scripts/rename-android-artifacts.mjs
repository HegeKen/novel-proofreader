#!/usr/bin/env node
/**
 * 整理 Android release 产物：校验签名是否真的生效，并按统一规则重命名。
 *
 * 为什么需要它：
 *   1. AGP 的输出路径随 tauri/AGP 版本变化（如 `apk/<abi>/release/app-<abi>-release.apk`，
 *      也可能是 `apk/release/...`）。此前 CI 里写死了 `apk/release`，导致重命名从未生效。
 *      这里改为递归查找 release 目录，不再依赖层级。
 *   2. 一次构建可能同时产出「按 ABI 拆分」与 `universal` 两种 APK。旧写法把它们统统
 *      重命名成同一个名字，会互相覆盖丢产物。这里用 AGP 的 ABI 目录名做后缀，天然不冲突。
 *   3. AGP **只在没有签名配置时**才产出 `-unsigned` 文件。一旦发现，说明签名补丁没生效，
 *      必须失败而不是把未签名产物发出去。
 *
 * 用法:
 *   node scripts/rename-android-artifacts.mjs [--app-name=ProofReader] [--arch=aarch64] [--dry-run]
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
	PROJECT_ROOT,
	isUnsignedAndroidArtifact,
	loadSigningConfig,
	runCli,
	log,
	readJson,
	relativeToRoot,
	sha256File,
} from './lib/core.mjs';

function parseArgs(argv) {
	const options = { arch: 'universal', appName: null, dryRun: false, allowUnsigned: null };
	for (const token of argv) {
		if (token.startsWith('--arch=')) options.arch = token.slice(7);
		else if (token.startsWith('--app-name=')) options.appName = token.slice(11);
		else if (token === '--dry-run') options.dryRun = true;
		else if (token === '--allow-unsigned') options.allowUnsigned = true;
	}
	if (options.allowUnsigned === null) options.allowUnsigned = process.env.DSH_ALLOW_UNSIGNED === 'true';
	return options;
}

function walk(dir, predicate) {
	if (!fs.existsSync(dir)) return [];
	const results = [];
	for (const name of fs.readdirSync(dir)) {
		const full = path.join(dir, name);
		if (fs.statSync(full).isDirectory()) results.push(...walk(full, predicate));
		else if (predicate(full)) results.push(full);
	}
	return results;
}

const isReleasePath = (file) => /\/release\//i.test(file.split(path.sep).join('/')) || /Release\//.test(file);

/** 从 AGP 输出路径里取出 ABI 目录名，作为产物名后缀。 */
export function resolveAbiSlug(file) {
	const normalized = file.split(path.sep).join('/');
	const apk = normalized.match(/\/apk\/([^/]+)\/release\//i);
	if (apk) return apk[1];
	const bundle = normalized.match(/\/bundle\/([^/]+?)Release\//);
	if (bundle) return bundle[1];
	return null;
}

function findReleaseArtifacts() {
	const outputs = path.join(PROJECT_ROOT, 'src-tauri', 'gen', 'android', 'app', 'build', 'outputs');
	return {
		apks: walk(path.join(outputs, 'apk'), (file) => file.endsWith('.apk') && isReleasePath(file)),
		aabs: walk(path.join(outputs, 'bundle'), (file) => file.endsWith('.aab') && isReleasePath(file)),
	};
}

function main() {
	const options = parseArgs(process.argv.slice(2));
	const config = loadSigningConfig();
	const appName = options.appName ?? 'ProofReader';
	const version = config.app.version ?? readJson(path.join(PROJECT_ROOT, 'package.json')).version;

	const { apks, aabs } = findReleaseArtifacts();
	if (apks.length === 0 && aabs.length === 0) {
		throw new Error('未找到任何 release APK/AAB，构建可能没有产出产物');
	}

	// 硬失败信号：AGP 只有在没有签名配置时才会产出 -unsigned
	const unsigned = [...apks, ...aabs].filter(isUnsignedAndroidArtifact);
	if (unsigned.length > 0) {
		for (const file of unsigned) log.fail(`检测到未签名产物: ${relativeToRoot(file)}`);
		const message = [
			'存在 -unsigned 产物，说明 Android 签名配置没有生效。排查顺序:',
			'  ① pnpm run signing:check 是否全部通过（keystore / keystore.properties / Gradle 补丁）',
			'  ② CI 中 setup-release-signing action 是否在 tauri android init 之后执行',
			'  ③ 清理陈旧产物后重试: rm -rf src-tauri/gen/android/app/build/outputs',
		].join('\n');
		if (!options.allowUnsigned) throw new Error(message);
		log.warn(message);
	}

	const signable = [...apks, ...aabs].filter((file) => !isUnsignedAndroidArtifact(file));
	const staged = signable.map((file) => {
		const extension = path.extname(file);
		const slug = resolveAbiSlug(file) ?? options.arch;
		return { from: file, to: path.join(path.dirname(file), `${appName}-v${version}-${slug}${extension}`) };
	});

	// 重名保护：理论上不会发生（ABI 目录唯一），真出现也必须报错而不是静默覆盖
	const byTarget = new Map();
	for (const entry of staged) {
		const existing = byTarget.get(entry.to);
		if (existing) {
			throw new Error(
				`重命名目标冲突，会丢失产物:\n  ${relativeToRoot(existing.from)}\n  ${relativeToRoot(entry.from)}\n  都指向 ${path.basename(entry.to)}`,
			);
		}
		byTarget.set(entry.to, entry);
	}

	// 先把所有源文件挪到临时名，避免 a->b 的同时 b->c 这类链式覆盖
	const temporary = [];
	for (const entry of staged) {
		if (entry.from === entry.to) {
			temporary.push({ ...entry, temp: entry.from });
			continue;
		}
		const temp = `${entry.from}.dsh-rename-tmp`;
		if (!options.dryRun) fs.renameSync(entry.from, temp);
		temporary.push({ ...entry, temp });
	}
	for (const entry of temporary) {
		if (options.dryRun) {
			log.info(`[dry-run] ${relativeToRoot(entry.from)} -> ${path.basename(entry.to)}`);
			continue;
		}
		fs.renameSync(entry.temp, entry.to);
	}

	log.title('Android 产物整理');
	for (const entry of temporary) {
		const digest = !options.dryRun && fs.existsSync(entry.to) ? sha256File(entry.to).slice(0, 16) : '';
		log.raw(`  ${path.basename(entry.to).padEnd(44)} ${digest}`);
	}
	if (temporary.length === 0) log.warn('没有可整理的产物（可能全部是 -unsigned）');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runCli(main);
