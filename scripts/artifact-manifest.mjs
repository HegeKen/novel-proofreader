#!/usr/bin/env node
/**
 * 产物清单（release manifest）生成与合并。
 *
 * 用法:
 *   node scripts/artifact-manifest.mjs generate [--target=<triple>] [--out=<file>] [--paths=a,b]
 *   node scripts/artifact-manifest.mjs merge --inputs=a.json,b.json --out=release-manifest.json
 *
 * 清单里同时记录：
 *   - configKey   : signing.config.json 的内容指纹
 *   - identityKey : configKey + 签名 key 指纹（"配置一致的 key" 里的 key）
 *   - toolchain   : Rust/Node/pnpm/JDK 版本指纹
 *   - artifacts[] : 每个产物的 sha256、大小、以及签名状态/证书指纹
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
	PROJECT_ROOT,
	collectConfigIssues,
	detectToolchain,
	gitInfo,
	loadSigningConfig,
	runCli,
	log,
	relativeToRoot,
	resolveSourceDateEpoch,
	sha256,
} from "./lib/core.mjs";
import {
	androidKeystorePath,
	readKeystoreProperties,
	readAndroidCertSha256,
	updaterPublicKeyPath,
} from "./lib/platforms.mjs";
import {
	buildManifest,
	collectArtifacts,
	comparableProjection,
	collectSigningIdentity,
	formatComparison,
	compareManifests,
} from "./lib/manifest.mjs";

function parseArgs(argv) {
	const options = { target: null, out: null, paths: null, inputs: null, allowUnsigned: false, json: false };
	for (const token of argv) {
		if (token.startsWith("--target=")) options.target = token.slice(9);
		else if (token.startsWith("--out=")) options.out = token.slice(6);
		else if (token.startsWith("--paths=")) options.paths = token.slice(8).split(",").filter(Boolean);
		else if (token.startsWith("--inputs=")) options.inputs = token.slice(9).split(",").filter(Boolean);
		else if (token === "--allow-unsigned") options.allowUnsigned = true;
		else if (token === "--json") options.json = true;
		else if (token === "--help" || token === "-h") options.help = true;
	}
	return options;
}

function defaultArtifactRoots(target) {
	const roots = [
		path.join(PROJECT_ROOT, "src-tauri", "gen", "android", "app", "build", "outputs", "apk"),
		path.join(PROJECT_ROOT, "src-tauri", "gen", "android", "app", "build", "outputs", "bundle"),
	];
	if (target) roots.unshift(path.join(PROJECT_ROOT, "src-tauri", "target", target, "release", "bundle"));
	roots.push(path.join(PROJECT_ROOT, "src-tauri", "target", "release", "bundle"));
	return roots;
}

function resolveAndroidCertificate(config) {
	if (config.android?.enabled === false) return null;
	const keystorePath = androidKeystorePath(config);
	if (!fs.existsSync(keystorePath)) return null;
	const properties = readKeystoreProperties(config);
	if (!properties?.storePassword) return null;
	return readAndroidCertSha256({ config, storePassword: properties.storePassword });
}

function generate(options) {
	const config = loadSigningConfig();
	const { errors } = collectConfigIssues(config);
	if (errors.length > 0) {
		for (const error of errors) log.fail(error);
		throw new Error("signing.config.json 自检未通过，拒绝生成清单（否则清单无法代表可复现配置）");
	}

	const roots = options.paths ? options.paths.map((entry) => path.resolve(entry)) : defaultArtifactRoots(options.target);
	const artifactPaths = collectArtifacts(roots);
	if (artifactPaths.length === 0) {
		log.warn(`未在以下目录找到产物:\n  ${roots.map((root) => relativeToRoot(root)).join("\n  ")}`);
		log.dim("提示：先完成打包，或用 --paths=<目录或文件,...> 显式指定");
	}

	const androidCertSha256 = resolveAndroidCertificate(config);
	const signingIdentity = collectSigningIdentity(config, { androidCertSha256 });
	if (config.updater?.publicKey && fs.existsSync(updaterPublicKeyPath())) {
		signingIdentity.updater.localPublicKeySha256 = sha256(fs.readFileSync(updaterPublicKeyPath(), "utf8").trim());
	}

	const manifest = buildManifest({
		config,
		artifactPaths,
		toolchain: detectToolchain(),
		git: gitInfo(),
		signingIdentity,
		sourceDateEpoch: resolveSourceDateEpoch(config),
		extra: { target: options.target },
	});

	const outPath = options.out
		? path.resolve(options.out)
		: path.join(PROJECT_ROOT, options.target ? `release-manifest-${options.target}.json` : "release-manifest.json");
	fs.mkdirSync(path.dirname(outPath), { recursive: true });
	fs.writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

	if (options.json) {
		log.raw(JSON.stringify({ outPath, manifest }, null, 2));
		return outPath;
	}

	log.title("产物清单");
	log.info(`configKey   : ${manifest.configKey}`);
	log.info(`identityKey : ${manifest.identityKey}`);
	log.info(`toolchain   : ${manifest.toolchain.key}`);
	log.info(`产物数量    : ${manifest.artifacts.length}`);
	if (manifest.artifacts.length > 0) {
		log.raw("");
		log.raw("  sha256(前16)      签名    大小        产物");
		for (const artifact of manifest.artifacts) {
			const signed = artifact.signature?.signed;
			const signedLabel = signed === true ? "已签名" : signed === false ? "未签名" : "未知  ";
			const sizeMb = `${(artifact.size / 1024 / 1024).toFixed(2)}MB`;
			log.raw(
				`  ${artifact.sha256.slice(0, 16)}  ${signedLabel}  ${sizeMb.padStart(9)}  ${artifact.name}`,
			);
		}
	}
	log.raw("");
	log.ok(`清单已写入: ${relativeToRoot(outPath)}`);

	const allowUnsigned = options.allowUnsigned || process.env.DSH_ALLOW_UNSIGNED === "true";
	const unsigned = manifest.artifacts.filter(
		(artifact) => artifact.signature?.signed === false && !artifact.name.endsWith(".sig"),
	);
	if (unsigned.length > 0 && !allowUnsigned) {
		log.raw("");
		for (const artifact of unsigned) log.fail(`未签名产物: ${artifact.name}`);
		throw new Error(`${unsigned.length} 个产物未签名（如属预期可加 --allow-unsigned）`);
	}
	return outPath;
}

function merge(options) {
	const inputs = (options.inputs ?? []).map((entry) => path.resolve(entry));
	if (inputs.length === 0) throw new Error("merge 需要 --inputs=a.json,b.json");
	const manifests = inputs.map((input) => {
		if (!fs.existsSync(input)) throw new Error(`清单不存在: ${input}`);
		return JSON.parse(fs.readFileSync(input, "utf8"));
	});

	const [first, ...rest] = manifests;
	for (const manifest of rest) {
		if (manifest.configKey !== first.configKey) {
			throw new Error(
				`清单 configKey 不一致，拒绝合并:\n  ${inputs[0]}: ${first.configKey}\n  ${manifest.source?.commit}: ${manifest.configKey}`,
			);
		}
		if (manifest.identityKey !== first.identityKey) {
			throw new Error(`清单 identityKey 不一致（不同签名 key 的产物不可合并）: ${manifest.identityKey}`);
		}
	}

	const byName = new Map();
	for (const manifest of manifests) {
		for (const artifact of manifest.artifacts ?? []) {
			if (byName.has(artifact.name)) {
				log.warn(`产物重名，保留先出现的: ${artifact.name}`);
				continue;
			}
			byName.set(artifact.name, artifact);
		}
	}

	const merged = {
		...first,
		generatedAt: new Date().toISOString(),
		sourceDateEpoch: Math.min(...manifests.map((manifest) => manifest.sourceDateEpoch ?? 0)),
		artifacts: [...byName.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
		mergedFrom: inputs.map((input) => relativeToRoot(input)),
	};

	const outPath = options.out ? path.resolve(options.out) : path.join(PROJECT_ROOT, "release-manifest.json");
	fs.writeFileSync(outPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
	log.ok(`已合并 ${manifests.length} 份清单、${merged.artifacts.length} 个产物 -> ${relativeToRoot(outPath)}`);
	log.info(`configKey   : ${merged.configKey}`);
	log.info(`identityKey : ${merged.identityKey}`);
	return outPath;
}

function printHelp() {
	log.raw(`
产物清单工具

  node scripts/artifact-manifest.mjs generate [选项]
      --target=<triple>     目标三元组，用于定位 bundle 目录
      --paths=a,b           显式指定产物文件/目录
      --out=<file>          输出路径
      --allow-unsigned      允许存在未签名产物
      --json                以 JSON 输出摘要

  node scripts/artifact-manifest.mjs merge --inputs=a.json,b.json [--out=release-manifest.json]
`);
}

function main() {
	const [command = "generate", ...rest] = process.argv.slice(2);
	const options = parseArgs(rest);
	if (options.help) return printHelp();
	if (command === "generate") return void generate(options);
	if (command === "merge") return void merge(options);
	if (command === "projection") {
		const manifest = JSON.parse(fs.readFileSync(path.resolve(options.inputs?.[0] ?? "release-manifest.json"), "utf8"));
		log.raw(JSON.stringify(comparableProjection(manifest), null, 2));
		return;
	}
	if (command === "compare") {
		const [expectedPath, actualPath] = options.inputs ?? [];
		if (!expectedPath || !actualPath) throw new Error("compare 需要 --inputs=expected.json,actual.json");
		const expected = JSON.parse(fs.readFileSync(path.resolve(expectedPath), "utf8"));
		const actual = JSON.parse(fs.readFileSync(path.resolve(actualPath), "utf8"));
		const report = compareManifests(expected, actual);
		log.raw(formatComparison(report, { expectedLabel: relativeToRoot(path.resolve(expectedPath)), actualLabel: relativeToRoot(path.resolve(actualPath)) }));
		process.exitCode = report.reproducible ? 0 : 1;
		return;
	}
	printHelp();
	throw new Error(`未知子命令: ${command}`);
}

runCli(main);
