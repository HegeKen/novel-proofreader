#!/usr/bin/env node
/**
 * 发布配置自检 / 补丁施加。
 *
 * 用法:
 *   pnpm run signing:check              # 只校验，不写文件（CI 与提交前用）
 *   pnpm run signing:check -- --apply   # 校验并把签名补丁重新施加到项目文件
 *
 * 为什么需要 --apply：CI 中的 `tauri android init` 可能重新生成 gen/android，
 * 因此在构建前必须能幂等地把签名/可复现补丁重新贴上。
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
	PROJECT_ROOT,
	collectConfigIssues,
	computeConfigKey,
	loadSigningConfig,
	log,
	relativeToRoot,
	resolveSourceDateEpoch,
	runCli,
	signingConfigExists,
	writeSigningEnv,
} from "./lib/core.mjs";
import {
	SECRETS,
	androidKeystoreExists,
	androidKeystorePath,
	androidKeystorePropertiesPath,
	generateAndroidKeystore,
	randomPassword,
	readAndroidCertSha256,
	readKeystoreProperties,
	updaterPrivateKeyPath,
	updaterPublicKeyPath,
	writeKeystoreProperties,
} from "./lib/platforms.mjs";
import {
	applyGradlePatch,
	applyTauriConfigPatch,
	assertGradlePatchApplied,
	buildTauriBuildOverrides,
	ensureAndroidGitignore,
	logPatchResults,
} from "./lib/project-files.mjs";

const args = new Set(process.argv.slice(2));
const APPLY = args.has("--apply");
const RESTORE_ANDROID = args.has("--restore-android-from-ci");
const JSON_OUTPUT = args.has("--json");
const STRICT = args.has("--strict");
const PRINT_ENV = args.has("--print-env");

/**
 * 输出可复现构建所需的环境变量（KEY=VALUE 行），供 CI 追加到 $GITHUB_ENV。
 * 必须在任何其他输出之前执行，保证 stdout 只有环境变量。
 */
function printBuildEnv() {
	const config = loadSigningConfig({ required: false });
	if (!config) {
		log.raw("SOURCE_DATE_EPOCH=0");
		return;
	}
	const epoch = resolveSourceDateEpoch(config);
	const cargoHome = process.env.CARGO_HOME ?? path.join(process.env.HOME ?? "~", ".cargo");
	log.raw(`SOURCE_DATE_EPOCH=${epoch}`);
	log.raw("TZ=UTC");
	log.raw("LC_ALL=C");
	log.raw("CARGO_INCREMENTAL=0");
	log.raw(
		`RUSTFLAGS=--remap-path-prefix=${cargoHome}=/cargo --remap-path-prefix=${PROJECT_ROOT}=/build`,
	);
	const keyPath = updaterPrivateKeyPath();
	if (fs.existsSync(keyPath)) {
		log.raw(`TAURI_SIGNING_PRIVATE_KEY_PATH=${keyPath}`);
	}
}

if (PRINT_ENV) {
	printBuildEnv();
	process.exit(0);
}

/** 输出 GitHub Actions Job Summary（markdown），便于在 CI 页面直接看到本次构建的配置指纹。 */
function printSummary() {
	const config = loadSigningConfig({ required: false });
	const lines = ["### 发布签名配置", ""];
	if (!config) {
		lines.push("未找到 `signing.config.json`，本次构建产物不会被签名。", "");
		log.raw(lines.join("\n"));
		return;
	}
	const platforms = ["android", "macos", "windows", "updater"]
		.filter((key) => config[key] && config[key].enabled !== false)
		.join(", ");
	lines.push("| 项 | 值 |", "| --- | --- |");
	lines.push(`| configKey | \`${config.configKey}\` |`);
	lines.push(`| 版本 / 标识符 | v${config.app.version} · \`${config.app.identifier}\` |`);
	lines.push(`| 启用平台 | ${platforms || "无"} |`);
	lines.push(`| SOURCE_DATE_EPOCH | ${resolveSourceDateEpoch(config)} |`);
	const keystorePath = androidKeystorePath(config);
	if (fs.existsSync(keystorePath)) {
		const properties = readKeystoreProperties(config);
		if (properties?.storePassword) {
			const fingerprint = readAndroidCertSha256({ config, storePassword: properties.storePassword });
			if (fingerprint) lines.push(`| Android 签名证书 SHA-256 | \`${fingerprint}\` |`);
		}
	} else if (config.android?.enabled !== false) {
		lines.push("| Android 签名证书 | ⚠️ 未找到 keystore，产物不会签名 |");
	}
	lines.push("");
	log.raw(lines.join("\n"));
}

if (args.has("--summary")) {
	printSummary();
	process.exit(0);
}

/**
 * CI 用：生成 tauri 构建覆盖配置，并把 `--config <path>` 打到 stdout。
 *
 * 为什么落盘成文件而不是直接输出 JSON：tauri-action 的 `args` 输入会按空格拆参数，
 * 而 JSON 里可能含空格（例如 Azure 签名的描述、productName）。文件路径固定且无空格，最稳。
 */
function emitTauriConfig() {
	const config = loadSigningConfig({ required: false });
	if (!config) return;
	const overrides = buildTauriBuildOverrides(config, {
		updaterKeyAvailable: fs.existsSync(updaterPrivateKeyPath()),
	});
	if (Object.keys(overrides).length === 0) return;
	const target = path.join(PROJECT_ROOT, ".signing", "tauri.release.conf.json");
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(target, `${JSON.stringify(overrides, null, 2)}\n`, "utf8");
	log.raw(`--config ${relativeToRoot(target)}`);
}

if (args.has("--emit-tauri-config")) {
	emitTauriConfig();
	process.exit(0);
}


const checks = [];
let failureCount = 0;

function check(label, status, detail) {
	checks.push({ label, status, detail });
	if (status === "fail") failureCount += 1;
}

function report() {
	if (JSON_OUTPUT) {
		log.raw(JSON.stringify({ checks, failures: failureCount }, null, 2));
		return;
	}
	log.title("发布配置自检");
	for (const item of checks) {
		// log.warn / log.fail 自己会加前缀，这里只在 ok 分支手动加"✓"
		if (item.status === "ok") log.raw(`  ✓ ${item.label}`);
		else if (item.status === "warn") log.warn(item.label);
		else log.fail(item.label);
		if (item.detail) log.dim(`    ${item.detail}`);
	}
	log.raw("");
	if (failureCount === 0) log.ok("全部关键项通过");
	else log.fail(`${failureCount} 项未通过`);
}

/**
 * CI 场景：把 CI Secret 还原成本地文件（keystore / keystore.properties / updater.key）。
 * 这样构建机上的"key"与本地完全一致，才能期望产物一致。
 */
function restoreAndroidFromCi(config) {
	const base64 = process.env[SECRETS.androidKeystore];
	if (!base64) return { restored: false, reason: "缺少 Secret " + SECRETS.androidKeystore };

	const keystorePath = androidKeystorePath(config);
	fs.mkdirSync(path.dirname(keystorePath), { recursive: true });
	fs.writeFileSync(keystorePath, Buffer.from(base64, "base64"));
	fs.chmodSync(keystorePath, 0o600);

	const storePassword = process.env[SECRETS.androidKeystorePassword] ?? "";
	const keyPassword = process.env[SECRETS.androidKeyPassword] ?? storePassword;
	writeKeystoreProperties({ config, storePassword, keyPassword });
	return { restored: true, keystorePath };
}

function restoreUpdaterFromCi() {
	const key = process.env[SECRETS.updaterPrivateKey];
	const password = process.env[SECRETS.updaterPrivateKeyPassword] ?? "";
	if (!key) return { restored: false, reason: "缺少 Secret " + SECRETS.updaterPrivateKey };
	const keyPath = updaterPrivateKeyPath();
	fs.mkdirSync(path.dirname(keyPath), { recursive: true });
	// CI 里 TAURI_SIGNING_PRIVATE_KEY 可能是文件内容，也可能是路径
	if (fs.existsSync(key)) {
		fs.copyFileSync(key, keyPath);
	} else {
		fs.writeFileSync(keyPath, key, "utf8");
	}
	fs.chmodSync(keyPath, 0o600);
	// 让 tauri CLI 直接读到
	process.env.TAURI_SIGNING_PRIVATE_KEY_PATH = keyPath;
	process.env.TAURI_SIGNING_PRIVATE_KEY = "";
	if (password) process.env[SECRETS.updaterPrivateKeyPassword] = password;
	return { restored: true, keyPath };
}

function main() {
	if (!signingConfigExists()) {
		check("signing.config.json 存在", "fail", "请运行: pnpm run setup:signing");
		report();
		process.exitCode = 1;
		return;
	}

	let config = loadSigningConfig();
	check("signing.config.json 可解析", "ok");

	// 1) 内容指纹是否与内容同步（手改配置后忘记刷新会被发现）
	const recomputed = computeConfigKey(config);
	if (recomputed === config.configKey) {
		check("configKey 与配置内容一致", "ok", config.configKey);
	} else {
		check(
			"configKey 与配置内容一致",
			"fail",
			`文件内为 ${config.configKey ?? "(缺失)"}，按内容应为 ${recomputed}。请运行 pnpm run setup:signing 重新生成`,
		);
	}

	// 2) 与 package.json / tauri.conf.json / Cargo.toml 的一致性
	const { errors, warnings } = collectConfigIssues(config);
	if (errors.length === 0) check("版本与标识符跨文件一致", "ok", `v${config.app.version} / ${config.app.identifier}`);
	else for (const error of errors) check("版本与标识符跨文件一致", "fail", error);
	for (const warning of warnings) check("配置告警", "warn", warning);

	// 3) Android 签名材料
	if (config.android?.enabled !== false) {
		const restored = RESTORE_ANDROID && restoreAndroidFromCi(config);
		if (RESTORE_ANDROID) {
			check("从 CI Secret 还原 keystore", restored.restored ? "ok" : "fail", restored.reason);
		}
		const keystorePath = androidKeystorePath(config);
		const propertiesPath = androidKeystorePropertiesPath(config);
		if (androidKeystoreExists(config)) {
			check("Android keystore 存在", "ok", relativeToRoot(keystorePath));
		} else {
			check(
				"Android keystore 存在",
				STRICT ? "fail" : "warn",
				`缺失 ${relativeToRoot(keystorePath)}，release 产物将无法签名。运行 pnpm run setup:signing 生成或导入`,
			);
		}
		const properties = readKeystoreProperties(config);
		if (properties) {
			const missing = ["storeFile", "storePassword", "keyAlias", "keyPassword"].filter((key) => !properties[key]);
			if (missing.length === 0) check("keystore.properties 完整", "ok");
			else check("keystore.properties 完整", "fail", `缺少字段: ${missing.join(", ")}`);
			if (properties.keyAlias && properties.keyAlias !== config.android.keyAlias) {
				check("keyAlias 与配置一致", "fail", `${properties.keyAlias} != ${config.android.keyAlias}`);
			} else if (properties.keyAlias) {
				check("keyAlias 与配置一致", "ok", properties.keyAlias);
			}
			if (fs.existsSync(keystorePath) && properties.storePassword) {
				const fingerprint = readAndroidCertSha256({ config, storePassword: properties.storePassword });
				if (fingerprint) check("Android 签名证书可读取", "ok", fingerprint);
				else check("Android 签名证书可读取", "fail", "口令可能不正确");
			}
		} else {
			check(
				"keystore.properties 存在",
				STRICT ? "fail" : "warn",
				`缺失 ${relativeToRoot(propertiesPath)}，运行 pnpm run setup:signing 生成`,
			);
		}
		const gitignore = path.join(PROJECT_ROOT, "src-tauri", "gen", "android", ".gitignore");
		const ignored = fs.existsSync(gitignore) && fs.readFileSync(gitignore, "utf8").includes("keystore.properties");
		check("签名材料已被 gitignore", ignored ? "ok" : "fail", ignored ? "" : "keystore.properties 可能被提交");
	}

	// 4) Gradle 补丁
	if (config.android?.enabled !== false) {
		const gradleState = assertGradlePatchApplied(config);
		if (gradleState.ok) check("Android Gradle 签名/可复现补丁已生效", "ok");
		else check("Android Gradle 签名/可复现补丁已生效", APPLY || !STRICT ? "warn" : "fail", gradleState.reason);
	}

	// 5) updater 密钥
	if (config.updater?.enabled !== false) {
		if (RESTORE_ANDROID) {
			const restoredKey = restoreUpdaterFromCi();
			if (restoredKey.restored) check("从 CI Secret 还原 updater 私钥", "ok", relativeToRoot(restoredKey.keyPath));
		}
		const pubPath = updaterPublicKeyPath();
		if (config.updater?.publicKey) {
			check("updater.publicKey 已写入配置", "ok", `${config.updater.publicKey.slice(0, 24)}…`);
			if (fs.existsSync(pubPath)) {
				const localPub = fs.readFileSync(pubPath, "utf8").trim();
				if (localPub === config.updater.publicKey) check("配置公钥与本地密钥对匹配", "ok");
				else check("配置公钥与本地密钥对匹配", "warn", "本地 .signing/updater.key.pub 与配置不一致");
			}
		} else {
			check("updater.publicKey 已写入配置", "warn", "运行 pnpm run setup:signing 可生成并回填");
		}
	}

	// 6) 可复现构建环境
	const epoch = resolveSourceDateEpoch(config);
	check("SOURCE_DATE_EPOCH 可解析", epoch > 0 ? "ok" : "warn", `${epoch} (${new Date(epoch * 1000).toISOString()})`);

	// 7) --apply：重新施加补丁
	if (APPLY) {
		log.title("施加签名/可复现补丁");
		const results = [];
		if (config.android?.enabled !== false) {
			try {
				results.push(["Android Gradle 补丁", applyGradlePatch(config).changed]);
			} catch (error) {
				log.warn(error.message);
			}
			results.push(["Android .gitignore", ensureAndroidGitignore().changed]);
		}
		results.push(["tauri.conf.json", applyTauriConfigPatch(config).changed]);
		logPatchResults(results);

		// --apply 会重写 configKey，需要重新加载
		config = loadSigningConfig();
		writeSigningEnv({ SOURCE_DATE_EPOCH: String(resolveSourceDateEpoch(config)) });
		if (config.android?.enabled !== false && !androidKeystoreExists(config) && process.env[SECRETS.androidKeystore]) {
			const password = process.env[SECRETS.androidKeystorePassword] ?? randomPassword();
			generateAndroidKeystore({ config, storePassword: password, keyPassword: password, force: true });
			check("CI 兜底生成 keystore", "ok");
		}
	}

	report();
	process.exitCode = failureCount > 0 ? 1 : 0;
}

runCli(main);
