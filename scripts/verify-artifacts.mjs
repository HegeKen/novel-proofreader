#!/usr/bin/env node
/**
 * 产物校验器 —— 回答两个问题：
 *   1. 同一份配置 + 同一套 key，两次打包的产物是否逐字节一致？（reproducible）
 *   2. release 产物是否确实已签名？（signed）
 *
 * 用法:
 *   node scripts/verify-artifacts.mjs reproducible --expected=a.json --actual=b.json
 *   node scripts/verify-artifacts.mjs signed --manifest=release-manifest.json [--require=android,macos,windows]
 *   node scripts/verify-artifacts.mjs apk --file=app.apk [--normalize] [--epoch=1700000000]
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { loadSigningConfig, log, relativeToRoot, resolveSourceDateEpoch, runCli, sha256File } from "./lib/core.mjs";
import { readKeystoreProperties, androidKeystorePath } from "./lib/platforms.mjs";
import { compareManifests, formatComparison } from "./lib/manifest.mjs";
import * as apk from "./lib/apk.mjs";

/** 由 CI 的 composite action 设置：为 true 时未签名产物只警告不失败。 */
const ALLOW_UNSIGNED = process.env.DSH_ALLOW_UNSIGNED === "true";

function parseArgs(argv) {
	const options = { manifest: null, expected: null, actual: null, require: null, files: [], normalize: false, epoch: null, json: false };
	for (const token of argv) {
		if (token.startsWith("--manifest=")) options.manifest = token.slice(11);
		else if (token.startsWith("--expected=")) options.expected = token.slice(11);
		else if (token.startsWith("--actual=")) options.actual = token.slice(9);
		else if (token.startsWith("--require=")) options.require = token.slice(10).split(",").filter(Boolean);
		else if (token.startsWith("--file=")) options.files.push(token.slice(7));
		else if (token.startsWith("--files=")) options.files.push(...token.slice(8).split(",").filter(Boolean));
		else if (token.startsWith("--epoch=")) options.epoch = Number(token.slice(8));
		else if (token === "--normalize") options.normalize = true;
		else if (token === "--json") options.json = true;
		else if (!token.startsWith("--")) options.files.push(token);
	}
	return options;
}

function readManifest(filePath) {
	if (!filePath) throw new Error("需要 --manifest=<file>");
	const resolved = path.resolve(filePath);
	if (!fs.existsSync(resolved)) throw new Error(`清单不存在: ${resolved}`);
	return { path: resolved, manifest: JSON.parse(fs.readFileSync(resolved, "utf8")) };
}

function commandReproducible(options) {
	if (!options.expected || !options.actual) throw new Error("需要 --expected=a.json --actual=b.json");
	const expected = readManifest(options.expected);
	const actual = readManifest(options.actual);
	const report = compareManifests(expected.manifest, actual.manifest);
	if (options.json) {
		log.raw(JSON.stringify(report, null, 2));
	} else {
		log.title("产物可复现性校验");
		log.info(`基准: ${relativeToRoot(expected.path)}`);
		log.info(`本次: ${relativeToRoot(actual.path)}`);
		log.raw("");
		log.raw(
			formatComparison(report, {
				expectedLabel: path.basename(expected.path),
				actualLabel: path.basename(actual.path),
			}),
		);
		if (report.verdict === "artifact-drift") {
			log.raw("");
			log.dim("排查建议: 固定 Rust/Node/pnpm 版本；确保 SOURCE_DATE_EPOCH 来自同一 commit；");
			log.dim("          Android 需关闭 dependenciesInfo 并对 APK 做时间戳归一化（pnpm run android:normalize）。");
		}
	}
	process.exitCode = report.reproducible ? 0 : 1;
}

function commandSigned(options) {
	const { path: manifestPath, manifest } = readManifest(options.manifest);
	const requiredPlatforms = options.require ?? ["android", "macos", "windows"];
	const problems = [];
	const summary = [];

	for (const artifact of manifest.artifacts ?? []) {
		if (artifact.name.endsWith(".sig")) continue;
		const signature = artifact.signature ?? {};
		const needsSignature = requiredPlatforms.includes(artifact.platform);
		if (!needsSignature) {
			summary.push({ ...artifact, status: "skipped" });
			continue;
		}
		if (signature.signed === true) {
			summary.push({ ...artifact, status: "signed" });
		} else if (signature.signed === null || signature.signed === undefined) {
			problems.push(`${artifact.name}: 无法判定签名状态（${signature.detail ?? "no-detail"}）`);
			summary.push({ ...artifact, status: "unknown" });
		} else {
			problems.push(`${artifact.name}: 未签名`);
			summary.push({ ...artifact, status: "unsigned" });
		}
	}

	if (options.json) {
		log.raw(JSON.stringify({ manifest: relativeToRoot(manifestPath), summary, problems }, null, 2));
	} else {
		log.title("产物签名校验");
		log.info(`清单: ${relativeToRoot(manifestPath)}`);
		log.info(`要求签名的平台: ${requiredPlatforms.join(", ")}`);
		log.raw("");
		for (const item of summary) {
			const label = { signed: "已签名", unsigned: "未签名", unknown: "未知", skipped: "跳过" }[item.status];
			const detail =
				item.signature?.certificateSha256 ? ` cert=${item.signature.certificateSha256.slice(0, 16)}…`
				: item.signature?.authority ? ` ${item.signature.authority}`
				: "";
			log.raw(`  [${label}] ${item.name}${detail}`);
		}
		log.raw("");
		if (problems.length === 0) log.ok("全部 release 产物均已签名");
		else if (ALLOW_UNSIGNED) {
			for (const problem of problems) log.warn(problem);
			log.warn("DSH_ALLOW_UNSIGNED=true，未签名不视为失败");
		} else for (const problem of problems) log.fail(problem);
	}
	process.exitCode = problems.length > 0 && !ALLOW_UNSIGNED ? 1 : 0;
}

function commandApk(options) {
	const files = options.files.filter((file) => file.toLowerCase().endsWith(".apk"));
	if (files.length === 0) throw new Error("需要 --file=<apk>（可多个）");

	const config = loadSigningConfig({ required: false });
	const properties = config ? readKeystoreProperties(config) : null;
	const keystorePath = config ? androidKeystorePath(config) : null;
	const signing =
		config && properties && keystorePath && fs.existsSync(keystorePath)
			? {
					keystorePath,
					storePassword: properties.storePassword,
					keyPassword: properties.keyPassword,
					keyAlias: properties.keyAlias,
				}
			: null;

	const results = [];
	for (const file of files) {
		const resolved = path.resolve(file);
		if (!fs.existsSync(resolved)) throw new Error(`APK 不存在: ${resolved}`);
		const before = sha256File(resolved);
		let normalized = null;
		if (options.normalize) {
			const epoch = options.epoch ?? (config ? resolveSourceDateEpoch(config) : 0);
			normalized = apk.normalizeAndResignApk(resolved, { epochSeconds: epoch, signing });
		}
		const verification = apk.verifyApk(resolved);
		results.push({
			file: relativeToRoot(resolved),
			sha256: sha256File(resolved),
			sha256Before: before,
			normalized,
			verified: verification.verified,
			schemes: verification.schemes,
			certificateSha256: verification.certificateSha256,
		});
	}

	if (options.json) {
		log.raw(JSON.stringify({ buildTools: apk.findBuildTools()?.version ?? null, results }, null, 2));
	} else {
		log.title("APK 校验");
		log.info(`build-tools: ${apk.findBuildTools()?.version ?? "未找到"}`);
		for (const result of results) {
			log.raw("");
			log.info(`文件: ${result.file}`);
			log.info(`sha256: ${result.sha256}`);
			if (result.sha256Before !== result.sha256) log.info(`归一化前 sha256: ${result.sha256Before}`);
			if (result.normalized) {
				log.info(`归一化条目数: ${result.normalized.entries}，大小 ${result.normalized.sizeBefore} -> ${result.normalized.sizeAfter}`);
			}
			log.info(`签名有效: ${result.verified ? "是" : "否"}${result.schemes?.length ? ` (${result.schemes.join(", ")})` : ""}`);
			if (result.certificateSha256) log.info(`证书 SHA-256: ${result.certificateSha256}`);
		}
	}
	process.exitCode = results.every((result) => result.verified) ? 0 : 1;
}

function printHelp() {
	log.raw(`
产物校验器

  reproducible  --expected=a.json --actual=b.json
  signed        --manifest=m.json [--require=android,macos,windows]
  apk           --file=app.apk [--file=other.apk] [--normalize] [--epoch=<秒>]
`);
}

function main() {
	const [command, ...rest] = process.argv.slice(2);
	const options = parseArgs(rest);
	switch (command) {
		case "reproducible":
			return commandReproducible(options);
		case "signed":
			return commandSigned(options);
		case "apk":
			return commandApk(options);
		case "--help":
		case "-h":
		case undefined:
			return printHelp();
		default:
			printHelp();
			throw new Error(`未知子命令: ${command}`);
	}
}

runCli(main);
