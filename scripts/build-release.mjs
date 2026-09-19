#!/usr/bin/env node
/**
 * 可复现发布构建入口。
 *
 * 它把"配置一致 => 产物一致"所需的所有前提显式固定下来：
 *   - SOURCE_DATE_EPOCH 取自 commit（而非构建时刻）
 *   - RUSTFLAGS 路径重映射，消除构建机路径差异
 *   - 锁定依赖（--frozen-lockfile / cargo --locked）
 *   - TZ / LC_ALL 固定，禁用增量编译
 *   - Android 构建后对 APK 做时间戳归一化 + 用同一 keystore 重签名
 *   - 结束时生成产物清单，可直接用于跨机器比对
 *
 * 用法:
 *   pnpm run build:release                       # 当前平台桌面构建
 *   pnpm run build:release -- --target=aarch64-apple-darwin
 *   pnpm run build:release -- --android --android-arch=arm64
 *   pnpm run build:release -- --skip-build       # 只对已有产物生成清单
 *   pnpm run build:release -- --compare-with=baseline.json
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
	PROJECT_ROOT,
	collectConfigIssues,
	detectToolchain,
	gitInfo,
	isUnsignedAndroidArtifact,
	loadSigningConfig,
	runCli,
	log,
	relativeToRoot,
	resolveSourceDateEpoch,
	run,
	writeSigningEnv,
} from "./lib/core.mjs";
import {
	SECRETS,
	androidKeystorePath,
	readAndroidCertSha256,
	readKeystoreProperties,
	updaterPrivateKeyPath,
} from "./lib/platforms.mjs";
import {
	buildManifest,
	collectArtifacts,
	collectSigningIdentity,
	compareManifests,
	formatComparison,
} from "./lib/manifest.mjs";
import { normalizeAndResignApk } from "./lib/apk.mjs";
import { buildTauriBuildOverrides } from "./lib/project-files.mjs";

function parseArgs(argv) {
	const options = {
		target: null,
		android: false,
		androidArch: "arm64",
		skipBuild: false,
		allowUnsigned: false,
		out: null,
		compareWith: null,
		normalize: true,
	};
	for (const token of argv) {
		if (token.startsWith("--target=")) options.target = token.slice(9);
		else if (token === "--android") options.android = true;
		else if (token.startsWith("--android-arch=")) options.androidArch = token.slice(15);
		else if (token === "--skip-build" || token === "--manifest-only") options.skipBuild = true;
		else if (token === "--allow-unsigned") options.allowUnsigned = true;
		else if (token.startsWith("--out=")) options.out = token.slice(6);
		else if (token.startsWith("--compare-with=")) options.compareWith = token.slice(15);
		else if (token === "--no-normalize") options.normalize = false;
		else if (token === "--help" || token === "-h") options.help = true;
	}
	return options;
}

/** 构造确定性构建环境。返回 { env, notes }。 */
function buildDeterministicEnv({ config, epoch }) {
	const env = { ...process.env };
	const notes = [];

	env.SOURCE_DATE_EPOCH = String(epoch);
	notes.push(`SOURCE_DATE_EPOCH=${epoch} (${new Date(epoch * 1000).toISOString()})`);

	env.TZ = "UTC";
	env.LC_ALL = "C";
	env.CARGO_INCREMENTAL = "0";
	notes.push("TZ=UTC LC_ALL=C CARGO_INCREMENTAL=0");

	// 路径重映射：让产物不包含构建机专属路径
	const cargoHome = process.env.CARGO_HOME ?? path.join(os.homedir(), ".cargo");
	const remap = [
		`--remap-path-prefix=${cargoHome}=/cargo`,
		`--remap-path-prefix=${PROJECT_ROOT}=/build`,
	];
	const existing = process.env.RUSTFLAGS ? `${process.env.RUSTFLAGS} ` : "";
	env.RUSTFLAGS = `${existing}${remap.join(" ")}`;
	notes.push("RUSTFLAGS 路径重映射已启用");

	if (config.updater?.enabled !== false) {
		const keyPath = updaterPrivateKeyPath();
		if (fs.existsSync(keyPath) && !env.TAURI_SIGNING_PRIVATE_KEY_PATH) {
			env.TAURI_SIGNING_PRIVATE_KEY_PATH = keyPath;
			notes.push(`TAURI_SIGNING_PRIVATE_KEY_PATH=${relativeToRoot(keyPath)}`);
		}
	}
	if (env.TAURI_SIGNING_PRIVATE_KEY_PATH && !env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD && process.env[SECRETS.updaterPrivateKeyPassword]) {
		env[SECRETS.updaterPrivateKeyPassword] = process.env[SECRETS.updaterPrivateKeyPassword];
	}
	return { env, notes };
}

function resolveTauriBin() {
	const bin = path.join(PROJECT_ROOT, "node_modules", ".bin", process.platform === "win32" ? "tauri.cmd" : "tauri");
	if (!fs.existsSync(bin)) throw new Error("未找到 tauri CLI，请先运行 pnpm install");
	return bin;
}

function runDesktopBuild({ config, options, env, epoch }) {
	const tauriBin = resolveTauriBin();
	const args = ["build"];
	if (options.target) args.push("--target", options.target);

	// updater 签名与 Windows 签名都通过 --config 注入（不写死进 tauri.conf.json）
	const hasUpdaterKey = Boolean(env.TAURI_SIGNING_PRIVATE_KEY_PATH || env.TAURI_SIGNING_PRIVATE_KEY);
	const overrides = buildTauriBuildOverrides(config, { env, updaterKeyAvailable: hasUpdaterKey });
	if (overrides.bundle?.createUpdaterArtifacts) {
		log.ok("已启用 updater 产物签名（将生成 .sig）");
	} else if (config.updater?.enabled !== false) {
		log.warn("未找到 updater 私钥，跳过 .sig 生成（pnpm run setup:signing 可生成）");
	}
	if (overrides.bundle?.windows?.certificateThumbprint) {
		log.ok("已注入 Windows 代码签名证书指纹");
	} else if (overrides.bundle?.windows?.signCommand) {
		log.ok("已注入 Windows 自定义签名命令（signCommand）");
	} else if (config.windows?.enabled !== false && config.windows?.mode !== "none") {
		log.warn("Windows 签名未配置（缺少 pfx 导入后的指纹或 signCommand），产物将未签名");
	}
	if (Object.keys(overrides).length > 0) {
		// spawnSync 以数组传参，JSON 里的空格不会造成参数拆分问题
		args.push("--config", JSON.stringify(overrides));
	}

	if (process.platform === "darwin") {
		env.APPLE_SIGNING_IDENTITY ??= process.env[SECRETS.macosSigningIdentity];
		env.APPLE_CERTIFICATE ??= process.env[SECRETS.macosCertificate];
		env.APPLE_CERTIFICATE_PASSWORD ??= process.env[SECRETS.macosCertificatePassword];
		if (!env.APPLE_SIGNING_IDENTITY && !env.APPLE_CERTIFICATE) {
			log.warn("未配置 macOS 签名身份，产物将未签名（公证也会被跳过）");
		}
	}

	void epoch;
	run(tauriBin, args, { env });
}

function runAndroidBuild({ config, options, env }) {
	const tauriBin = resolveTauriBin();
	const properties = readKeystoreProperties(config);
	if (!properties) {
		log.warn(`未找到 keystore 属性文件，Android release 产物将未签名`);
	}
	const args = ["android", "build", "--target", options.androidArch];
	run(tauriBin, args, { env });
	void config;
}

function normalizeAndroidArtifacts({ config, epoch, options }) {
	if (!options.normalize) return [];
	const properties = readKeystoreProperties(config);
	const keystore = androidKeystorePath(config);
	const signing =
		properties && fs.existsSync(keystore)
			? {
					keystorePath: keystore,
					storePassword: properties.storePassword,
					keyPassword: properties.keyPassword,
					keyAlias: properties.keyAlias,
				}
			: null;
	if (!signing) {
		log.warn("缺少 keystore 口令，跳过 APK 归一化（产物可能仍不可复现）");
		return [];
	}

	const roots = [
		path.join(PROJECT_ROOT, "src-tauri", "gen", "android", "app", "build", "outputs", "apk"),
	];
	const allApks = collectArtifacts(roots).filter((file) => file.toLowerCase().endsWith(".apk"));

	// AGP 只在「没有签名配置」时才产出 -unsigned，因此它是"签名补丁没生效"的硬信号。
	// 绝不能把它归一化后当成正常产物发出去。
	const unsignedApks = allApks.filter(isUnsignedAndroidArtifact);
	if (unsignedApks.length > 0) {
		const allow = options.allowUnsigned || process.env.DSH_ALLOW_UNSIGNED === "true";
		for (const file of unsignedApks) log.fail(`检测到未签名产物: ${relativeToRoot(file)}`);
		const message = [
			"Android 签名配置未生效（AGP 产出了 -unsigned APK）。排查顺序:",
			"  ① pnpm run signing:check",
			"  ② CI 中 setup-release-signing action 必须晚于 tauri android init",
			"  ③ 清理陈旧产物: rm -rf src-tauri/gen/android/app/build/outputs",
		].join("\n");
		if (!allow) throw new Error(message);
		log.warn(message);
	}
	const apks = allApks.filter((file) => !isUnsignedAndroidArtifact(file));

	const results = [];
	for (const apkPath of apks) {
		try {
			const result = normalizeAndResignApk(apkPath, { epochSeconds: epoch, signing });
			results.push({ apk: relativeToRoot(apkPath), ...result });
			if (result.normalized) {
				log.ok(`${path.basename(apkPath)}: 已归一化 ${result.entries} 个条目并重签名 (${result.schemes.join("+")})`);
			}
		} catch (error) {
			log.warn(`${path.basename(apkPath)} 归一化失败: ${error.message}`);
		}
	}
	return results;
}

function generateManifest({ config, options, epoch, target }) {
	const roots = options.android
		? [
				path.join(PROJECT_ROOT, "src-tauri", "gen", "android", "app", "build", "outputs", "apk"),
				path.join(PROJECT_ROOT, "src-tauri", "gen", "android", "app", "build", "outputs", "bundle"),
			]
		: [
				...(target ? [path.join(PROJECT_ROOT, "src-tauri", "target", target, "release", "bundle")] : []),
				path.join(PROJECT_ROOT, "src-tauri", "target", "release", "bundle"),
			];

	const artifactPaths = collectArtifacts(roots);
	if (artifactPaths.length === 0) {
		log.warn(`未找到产物。检查目录:\n  ${roots.map((root) => relativeToRoot(root)).join("\n  ")}`);
	}

	const keystore = androidKeystorePath(config);
	const properties = readKeystoreProperties(config);
	const androidCertSha256 =
		properties?.storePassword && fs.existsSync(keystore)
			? readAndroidCertSha256({ config, storePassword: properties.storePassword })
			: null;

	const manifest = buildManifest({
		config,
		artifactPaths,
		toolchain: detectToolchain(),
		git: gitInfo(),
		signingIdentity: collectSigningIdentity(config, { androidCertSha256 }),
		sourceDateEpoch: epoch,
		extra: { target: target ?? (options.android ? `android-${options.androidArch}` : undefined) },
	});

	const outPath = options.out
		? path.resolve(options.out)
		: path.join(PROJECT_ROOT, `release-manifest${manifest.artifacts[0]?.target ? `-${manifest.artifacts[0].target}` : ""}.json`);
	fs.writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
	return { manifest, outPath, artifactPaths };
}

function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.help) {
		log.raw(`
可复现发布构建

  --target=<triple>        桌面目标三元组（如 aarch64-apple-darwin）
  --android                构建 Android
  --android-arch=<arch>    arm64 | armv7 | x86_64 | universal（默认 arm64）
  --skip-build             跳过打包，只用已有产物生成清单
  --no-normalize           跳过 APK 时间戳归一化
  --allow-unsigned         允许产物未签名
  --out=<file>             清单输出路径
  --compare-with=<file>    构建后与基准清单比对可复现性
`);
		return;
	}

	const config = loadSigningConfig();
	const { errors } = collectConfigIssues(config);
	if (errors.length > 0) {
		for (const error of errors) log.fail(error);
		throw new Error("signing.config.json 自检未通过，拒绝构建（否则无法保证产物可复现）");
	}

	const epoch = resolveSourceDateEpoch(config);
	const git = gitInfo();

	log.title("可复现发布构建");
	log.info(`版本        : v${config.app.version}`);
	log.info(`configKey   : ${config.configKey}`);
	log.info(`commit      : ${git.commit ?? "(非 git 仓库)"}${git.dirty ? " (工作区有未提交改动)" : ""}`);
	log.info(`目标        : ${options.android ? `android/${options.androidArch}` : options.target ?? "当前平台"}`);
	if (git.dirty) log.warn("工作区有未提交改动，产物内容将无法由 commit 唯一确定");

	const { env, notes } = buildDeterministicEnv({ config, epoch });
	log.title("确定性环境");
	for (const note of notes) log.dim(note);
	if (config.reproducibility?.lockedDependencies !== false) {
		log.dim("依赖锁定: pnpm install --frozen-lockfile");
	}
	void writeSigningEnv({ SOURCE_DATE_EPOCH: String(epoch) });

	if (!options.skipBuild) {
		if (config.reproducibility?.lockedDependencies !== false) {
			const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
			try {
				run(pnpm, ["install", "--frozen-lockfile"], { env });
			} catch (error) {
				log.warn(`pnpm install --frozen-lockfile 失败: ${error.message}`);
			}
		}
		log.title("打包");
		if (options.android) runAndroidBuild({ config, options, env });
		else runDesktopBuild({ config, options, env, epoch });
	} else {
		log.title("跳过打包");
	}

	if (options.android) {
		log.title("APK 归一化");
		const results = normalizeAndroidArtifacts({ config, epoch, options });
		if (results.length === 0) log.dim("没有需要处理的 APK");
	}

	log.title("产物清单");
	const { manifest, outPath } = generateManifest({ config, options, epoch, target: options.target });
	log.ok(`清单已写入: ${relativeToRoot(outPath)}`);
	log.info(`identityKey : ${manifest.identityKey}`);
	log.raw("");
	for (const artifact of manifest.artifacts) {
		const signed = artifact.signature?.signed;
		const label = signed === true ? "已签名" : signed === false ? "未签名" : "未知";
		log.raw(`  [${label}] ${artifact.sha256.slice(0, 16)}  ${artifact.name}`);
	}

	const allowUnsigned = options.allowUnsigned || process.env.DSH_ALLOW_UNSIGNED === "true";
	const unsigned = manifest.artifacts.filter(
		(artifact) => artifact.signature?.signed === false && !artifact.name.endsWith(".sig"),
	);
	if (unsigned.length > 0) {
		log.raw("");
		for (const artifact of unsigned) log.warn(`未签名产物: ${artifact.name}`);
		if (!allowUnsigned) {
			throw new Error("存在未签名产物，构建失败（如属预期请加 --allow-unsigned 或设 DSH_ALLOW_UNSIGNED=true）");
		}
	}

	if (options.compareWith) {
		const baselinePath = path.resolve(options.compareWith);
		if (!fs.existsSync(baselinePath)) throw new Error(`基准清单不存在: ${baselinePath}`);
		const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
		const report = compareManifests(baseline, manifest);
		log.title("可复现性比对");
		log.raw(formatComparison(report, { expectedLabel: path.basename(baselinePath), actualLabel: path.basename(outPath) }));
		if (!report.reproducible) process.exitCode = 1;
	}

	log.raw("");
	log.ok("完成");
}

runCli(main);
