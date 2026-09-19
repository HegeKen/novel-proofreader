#!/usr/bin/env node
/**
 * 发布配置引导（release signing wizard）
 *
 * 作用：像 Android Studio 的签名向导一样，一步步把"打包发布"所需的全部配置与密钥准备好：
 *   1. Android keystore 生成 / 导入（产物签名的 key）
 *   2. macOS 代码签名 + 公证凭据
 *   3. Windows 代码签名（pfx / Azure Trusted Signing）
 *   4. Tauri updater 签名密钥对
 *   5. 把签名配置写进 Android Gradle 与 tauri.conf.json
 *   6. 生成 .signing/ 下的本地材料、环境变量与 GitHub Secrets 清单
 *
 * 用法：
 *   pnpm run setup:signing                 # 交互式引导
 *   pnpm run setup:signing -- --yes        # 全部采用推荐值
 *   pnpm run setup:signing -- --platforms=android,updater
 *   pnpm run setup:signing -- --non-interactive
 *   pnpm run setup:signing -- --force      # 重建 keystore / 覆盖密钥
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
	PROJECT_ROOT,
	SECRETS_CHECKLIST_PATH,
	SIGNING_STATE_DIR,
	SECRETS_DOTENV_PATH,
	collectConfigIssues,
	computeConfigKey,
	defaultSigningConfig,
	ensureDir,
	loadSigningConfig,
	log,
	readJson,
	readSigningEnv,
	relativeToRoot,
	resolveSourceDateEpoch,
	runCli,
	saveSigningConfig,
	sha256,
	signingConfigExists,
	writeSecretsDotenv,
	writeSigningEnv,
} from "./lib/core.mjs";
import { CancelledError, createPrompter } from "./lib/prompt.mjs";
import {
	SECRETS,
	androidKeystoreExists,
	androidKeystorePath,
	buildSecretsChecklist,
	exportAndroidKeystoreBase64,
	findMacSigningIdentities,
	detectKeystoreType,
	generateAndroidKeystore,
	listKeystoreAliases,
	generateUpdaterKeypair,
	randomPassword,
	readAndroidCertSha256,
	readKeystoreProperties,
	updaterPrivateKeyPath,
	writeKeystoreProperties,
} from "./lib/platforms.mjs";
import { buildSecretEntries } from "./lib/secrets.mjs";
import {
	applyGradlePatch,
	applyTauriConfigPatch,
	ensureAndroidGitignore,
	logPatchResults,
} from "./lib/project-files.mjs";

const ALL_PLATFORMS = ["android", "macos", "windows", "updater"];

// ---------------------------------------------------------------------------
// 参数解析
// ---------------------------------------------------------------------------

function parseArgs(argv) {
	const args = {
		yes: false,
		nonInteractive: false,
		force: false,
		dryRun: false,
		platforms: null,
		keystore: null,
		keystorePassword: null,
		keyPassword: null,
		keyAlias: null,
		skipGradlePatch: false,
	};
	for (const token of argv) {
		if (token === "--yes" || token === "-y") args.yes = true;
		else if (token === "--non-interactive") args.nonInteractive = true;
		else if (token === "--force" || token === "-f") args.force = true;
		else if (token === "--dry-run") args.dryRun = true;
		else if (token === "--skip-gradle-patch") args.skipGradlePatch = true;
		else if (token.startsWith("--platforms=")) {
			args.platforms = token
				.slice("--platforms=".length)
				.split(",")
				.map((entry) => entry.trim())
				.filter(Boolean);
		} else if (token.startsWith("--keystore=")) args.keystore = token.slice("--keystore=".length);
		else if (token.startsWith("--keystore-password=")) args.keystorePassword = token.slice("--keystore-password=".length);
		else if (token.startsWith("--key-password=")) args.keyPassword = token.slice("--key-password=".length);
		else if (token.startsWith("--key-alias=")) args.keyAlias = token.slice("--key-alias=".length);
		else if (token === "--help" || token === "-h") {
			printHelp();
			process.exit(0);
		} else {
			log.warn(`忽略未知参数: ${token}`);
		}
	}
	return args;
}

function printHelp() {
	log.raw(`
发布配置引导 —— 准备打包签名所需的全部配置与密钥

用法:
  pnpm run setup:signing [选项]

选项:
  -y, --yes                 全部采用推荐值，不询问
      --non-interactive     非交互模式（CI 友好），缺省值优先取环境变量
  -f, --force               覆盖已存在的 keystore / updater 密钥（会破坏升级签名，慎用）
      --dry-run             只展示将要执行的操作
      --platforms=a,b       只处理指定平台: ${ALL_PLATFORMS.join(", ")}
      --keystore=PATH       使用已有的 keystore（导入模式，不新建）
      --keystore-password=P keystore 口令（默认从 ${SECRETS.androidKeystorePassword} 读取）
      --key-password=P      key 口令（留空则默认与 keystore 口令相同）
      --key-alias=NAME      key 别名（导入已有 keystore 且存在多个条目时必填）
      --skip-gradle-patch   不改动 Android Gradle 文件
  -h, --help                显示本帮助

环境变量:
  DSH_APPLE_NOTARIZE_ROUTE=apple-id|api-key   非交互时选择公证路线
  APPLE_API_KEY_P8_PATH=<.p8 路径>            自动读取并转成 base64
`);
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function deriveAppSection(base) {
	const app = { ...base.app };
	try {
		const tauriConfig = readJson(path.join(PROJECT_ROOT, "src-tauri", "tauri.conf.json"));
		app.productName = tauriConfig.productName ?? app.productName;
		app.identifier = tauriConfig.identifier ?? app.identifier;
		app.version = tauriConfig.version ?? app.version;
	} catch {
		/* tauri.conf.json 缺失时沿用默认值 */
	}
	try {
		const pkg = readJson(path.join(PROJECT_ROOT, "package.json"));
		if (pkg.version) app.version = pkg.version;
	} catch {
		/* ignore */
	}
	return app;
}

function loadOrInitConfig() {
	if (!signingConfigExists()) {
		const fresh = defaultSigningConfig();
		fresh.app = deriveAppSection(fresh);
		return { config: fresh, created: true };
	}
	const config = loadSigningConfig();
	config.app = { ...config.app, ...deriveAppSection(config) };
	return { config, created: false };
}

/** configKey 之外还有什么能证明"key 一致"：证书指纹必须一起记录。 */
function writeSecretsChecklist(entries) {
	ensureDir(SIGNING_STATE_DIR);
	const contents = buildSecretsChecklist({
		entries,
		dotenvPath: relativeToRoot(SECRETS_DOTENV_PATH),
	});
	fs.writeFileSync(SECRETS_CHECKLIST_PATH, contents, "utf8");
	return SECRETS_CHECKLIST_PATH;
}

// ---------------------------------------------------------------------------
// 各平台步骤
// ---------------------------------------------------------------------------

async function stepAndroid({ config, prompter, args, state }) {
	log.title("① Android 签名（keystore）");
	log.dim("Android 要求所有升级包必须用同一个 keystore 签名，请妥善备份。");

	const keystorePath = androidKeystorePath(config);
	const exists = androidKeystoreExists(config);
	const secrets = {};

	if (args.keystore) {
		const source = path.resolve(args.keystore);
		if (!fs.existsSync(source)) throw new Error(`指定的 keystore 不存在: ${source}`);
		if (source !== keystorePath) {
			ensureDir(path.dirname(keystorePath));
			fs.copyFileSync(source, keystorePath);
			log.ok(`已导入 keystore: ${relativeToRoot(source)} -> ${relativeToRoot(keystorePath)}`);
		}
		// 导入的 keystore 类型可能与配置不一致（Android Studio 旧版产出 JKS），
		// 以文件头识别结果为准，否则 AGP 加载会失败
		const detected = detectKeystoreType(keystorePath);
		if (detected && detected !== config.android.keystoreType) {
			log.warn(`keystore 实际类型为 ${detected}，配置中为 ${config.android.keystoreType}，已自动修正`);
			config.android = { ...config.android, keystoreType: detected };
		} else if (detected) {
			log.ok(`keystore 类型确认: ${detected}`);
		}
	} else if (exists && !args.force) {
		log.ok(`复用已有 keystore: ${relativeToRoot(keystorePath)}`);
		log.dim("（如需重建请加 --force；重建会导致老用户无法覆盖安装）");
	} else {
		const shouldCreate = await prompter.confirm({
			message: exists ? "keystore 已存在，是否重建？" : "是否生成新的 Android keystore？",
			// --force 时默认值为 true，--yes/非交互下才会真的重建；否则默认保留已有 key
			defaultValue: !exists || Boolean(args.force),
		});
		if (!shouldCreate) {
			log.warn("跳过 Android keystore 生成，release 产物将不会被签名");
			return { secrets, skipped: true };
		}
		if (args.dryRun) {
			log.info(`[dry-run] keytool -genkeypair -alias ${config.android.keyAlias} -keystore ${config.android.keystorePath}`);
		} else {
			const storePassword = await resolveAndroidPassword({ prompter, args, kind: "keystore" });
			const keyPassword = config.android.keystoreType.toUpperCase() === "JKS"
				? await resolveAndroidPassword({ prompter, args, kind: "key" })
				: storePassword;
			const generated = generateAndroidKeystore({ config, storePassword, keyPassword, force: args.force });
			log.ok(`已生成 keystore: ${relativeToRoot(generated)}`);
			state.androidPasswords = { storePassword, keyPassword };
		}
	}

	// 口令：优先复用 keystore.properties，其次 --keystore-password / 环境变量，最后询问。
	// key 口令默认与 keystore 口令相同（PKCS12 强制如此；JKS 也绝大多数如此），
	// 需要不同时用 --key-password= 显式覆盖 —— 之后会用证书指纹做硬校验。
	let storePassword = state.androidPasswords?.storePassword ?? "";
	let keyPassword = state.androidPasswords?.keyPassword ?? "";
	if (!storePassword) {
		const existing = readKeystoreProperties(config);
		if (existing?.storePassword && exists) {
			storePassword = existing.storePassword;
			keyPassword = existing.keyPassword ?? existing.storePassword;
			log.ok("已从 keystore.properties 复用口令");
		} else {
			storePassword = await resolveAndroidPassword({ prompter, args, kind: "keystore" });
			keyPassword =
				args.keyPassword ||
				process.env[SECRETS.androidKeyPassword] ||
				state.previousEnv?.[SECRETS.androidKeyPassword] ||
				storePassword;
			if (keyPassword !== storePassword) log.dim("key 口令与 keystore 口令不同（来自显式指定）");
		}
	}

	// 关键校验：证书指纹能否读出，决定了这套配置到底能不能签出包。
	// 导入已有 keystore 时别名/口令都可能与默认值不同，这里必须硬失败而不是"警告后继续"。
	if (!args.dryRun) {
		if (args.keyAlias) {
			config.android = { ...config.android, keyAlias: args.keyAlias };
		}
		const entries = listKeystoreAliases({ keystorePath, storePassword });
		if (entries === null) {
			throw new Error(
				"无法读取 keystore：口令不正确或文件已损坏。\n" +
					"  请用 --keystore-password= 重新提供；PKCS12 的 key 口令必须与 keystore 口令相同。",
			);
		}
		if (entries.length === 0) {
			throw new Error("keystore 中没有任何条目，无法用于签名");
		}

		// JKS 的别名是大小写不敏感的（keytool 会统一转小写），
		// 因此按大小写不敏感匹配，并采用 keystore 里的规范写法，避免配置与实际不一致。
		const requestedAlias = config.android.keyAlias;
		const matched = entries.find(
			(entry) => entry.alias.toLowerCase() === String(requestedAlias).toLowerCase(),
		);
		if (matched) {
			if (matched.alias !== requestedAlias) {
				log.dim(`别名规范化为 keystore 中的写法: ${requestedAlias} -> ${matched.alias}`);
				config.android = { ...config.android, keyAlias: matched.alias };
			}
		} else {
			const privateKeys = entries.filter((entry) => entry.entryType === "PrivateKeyEntry");
			const names = entries.map((entry) => `${entry.alias}(${entry.entryType})`).join(", ");
			if (privateKeys.length === 1) {
				log.warn(
					`别名 "${requestedAlias}" 不存在，已自动改用唯一的私钥条目 "${privateKeys[0].alias}"`,
				);
				config.android = { ...config.android, keyAlias: privateKeys[0].alias };
			} else {
				throw new Error(
					`别名 "${requestedAlias}" 不在 keystore 中。现有条目: ${names}\n` +
						"  请用 --key-alias=<名称> 指定要用于签名的私钥条目。",
				);
			}
		}

		const certificateSha256 = readAndroidCertSha256({
			config,
			storePassword,
			alias: config.android.keyAlias,
		});
		if (!certificateSha256) {
			throw new Error(
				`无法用给定口令读取别名 "${config.android.keyAlias}" 的证书 —— key 口令可能不正确。\n` +
					"  JKS 允许 key 口令与 keystore 口令不同，请用 --key-password= 显式提供。",
			);
		}
		log.ok(`签名证书 SHA-256: ${certificateSha256}`);
		log.dim(`keyAlias=${config.android.keyAlias} storeType=${config.android.keystoreType}`);
		state.androidCertSha256 = certificateSha256;
	}

	// 别名/类型都确定后再写属性文件，避免落下一个与实际不符的中间状态
	if (!args.dryRun) {
		const propertiesPath = writeKeystoreProperties({ config, storePassword, keyPassword });
		log.ok(`已写入属性文件: ${relativeToRoot(propertiesPath)}`);
	}

	if (!args.dryRun) {
		const { encoded, outPath } = exportAndroidKeystoreBase64(config);
		secrets[SECRETS.androidKeystore] = "<base64 文件内容>";
		state.keystoreBase64Path = outPath;
		log.ok(`已导出 base64（供 CI Secret）: ${relativeToRoot(outPath)} (${encoded.length} 字节)`);
	}

	Object.assign(secrets, {
		[SECRETS.androidKeystorePassword]: storePassword,
		[SECRETS.androidKeyAlias]: config.android.keyAlias,
		[SECRETS.androidKeyPassword]: keyPassword,
	});
	state.androidSecrets = { storePassword, keyPassword };
	return { secrets };
}

async function resolveAndroidPassword({ prompter, args, kind }) {
	const envVar = kind === "keystore" ? SECRETS.androidKeystorePassword : SECRETS.androidKeyPassword;
	const provided = kind === "keystore" ? args.keystorePassword : args.keyPassword;
	if (provided) return provided;
	if (process.env[envVar]) return process.env[envVar];

	if (args.yes || !prompter.interactive) {
		const generated = randomPassword();
		log.ok(`已自动生成强随机${kind === "keystore" ? " keystore" : " key"}口令（保存在 .signing/，请勿遗失）`);
		return generated;
	}
	const answer = await prompter.password({
		message: `${kind === "keystore" ? "keystore" : "key"} 口令（留空自动生成强随机口令）`,
	});
	return answer || randomPassword();
}

async function stepMacos({ config, prompter, args, state }) {
	log.title("② macOS 代码签名与公证");
	const secrets = {};
	if (config.macos?.enabled === false) {
		log.dim("配置中已禁用 macOS 签名，跳过");
		return { secrets };
	}

	if (process.platform === "darwin") {
		const identities = findMacSigningIdentities();
		if (identities.length === 0) {
			log.warn("本机钥匙串中没有可用的代码签名证书");
			log.dim("获取方式: Apple Developer -> Certificates -> Developer ID Application -> 导出 .p12");
		} else {
			log.info("本机可用签名身份:");
			for (const identity of identities) log.dim(`  · ${identity}`);
		}
		const picked = await prompter.select({
			message: "选择 macOS 签名身份",
			options: [
				...identities.map((identity) => ({ value: identity, label: identity })),
				{ value: "", label: "稍后在 CI 中通过 Secret 提供", description: "本地不签名" },
			],
			defaultValue: identities[0] ?? "",
		});
		if (picked) secrets[SECRETS.macosSigningIdentity] = picked;
	}

	log.dim("公证需要一个 App 专用密码或 App Store Connect API Key（二选一）");
	// 非交互场景无法回答交互式提问，用 DSH_APPLE_NOTARIZE_ROUTE 显式选择路线
	const routeFromEnv = (process.env.DSH_APPLE_NOTARIZE_ROUTE ?? "").trim().toLowerCase();
	if (routeFromEnv && !["apple-id", "api-key"].includes(routeFromEnv)) {
		throw new Error('DSH_APPLE_NOTARIZE_ROUTE 只能是 "apple-id" 或 "api-key"');
	}
	const useAppleId = routeFromEnv
		? routeFromEnv === "apple-id"
		: await prompter.confirm({
				message: "使用 Apple ID + App 专用密码进行公证？",
				defaultValue: true,
			});
	if (useAppleId) {
		secrets[SECRETS.macosId] = await prompter.text({ message: "Apple ID", envVar: SECRETS.macosId, defaultValue: "" });
		secrets[SECRETS.macosTeamId] = await prompter.text({ message: "Team ID", envVar: SECRETS.macosTeamId, defaultValue: "" });
		if (prompter.interactive && !args.yes) {
			secrets[SECRETS.macosPassword] = await prompter.password({
				message: "App 专用密码（appleid.apple.com 生成，形如 xxxx-xxxx-xxxx-xxxx）",
				envVar: SECRETS.macosPassword,
			});
		} else {
			secrets[SECRETS.macosPassword] = process.env[SECRETS.macosPassword] ?? "";
		}
	} else {
		log.dim("App Store Connect API 密钥路线（推荐用于 CI，密钥可随时吊销）");
		log.dim("  获取: App Store Connect -> 用户和访问 -> 集成 -> App Store Connect API -> 团队密钥");
		secrets[SECRETS.macosApiKey] = await prompter.text({
			message: "Key ID（形如 ABC123DEFG）",
			envVar: SECRETS.macosApiKey,
			defaultValue: "",
		});
		secrets[SECRETS.macosApiIssuer] = await prompter.text({
			message: "Issuer ID（UUID 形式）",
			envVar: SECRETS.macosApiIssuer,
			defaultValue: "",
		});
		// .p8 只能以文件形式交给 Tauri，因此这里就地转成 base64 供 CI 落地
		const p8Path = await prompter.text({
			message: "AuthKey_XXXX.p8 文件路径（留空表示稍后手动提供）",
			envVar: "APPLE_API_KEY_P8_PATH",
			defaultValue: "",
		});
		if (p8Path) {
			const resolved = path.resolve(p8Path);
			if (!fs.existsSync(resolved)) throw new Error(`.p8 文件不存在: ${resolved}`);
			secrets[SECRETS.macosApiKeyP8] = fs.readFileSync(resolved).toString("base64");
			log.ok(`已读取 .p8 并转为 base64（${relativeToRoot(resolved)}）`);
		} else if (process.env[SECRETS.macosApiKeyP8]) {
			secrets[SECRETS.macosApiKeyP8] = process.env[SECRETS.macosApiKeyP8];
			log.ok("已从环境变量读取 APPLE_API_KEY_P8");
		}
	}

	secrets[SECRETS.macosCertificate] = "<导出 .p12 后执行: base64 -i cert.p12 | pbcopy>";
	secrets[SECRETS.macosCertificatePassword] = "<导出 .p12 时设置的密码>";
	state.macosConfigured = true;
	return { secrets };
}

async function stepWindows({ config, prompter, state }) {
	log.title("③ Windows 代码签名");
	const secrets = {};
	if (config.windows?.enabled === false) {
		log.dim("配置中已禁用 Windows 签名，跳过");
		return { secrets };
	}

	const mode = await prompter.select({
		message: "选择 Windows 签名方式",
		options: [
			{ value: "pfx", label: "PFX 证书", description: "传统 OV/EV 证书，导出为 .pfx" },
			{ value: "azure-trusted-signing", label: "Azure Trusted Signing", description: "云签名，推荐用于自动化" },
			{ value: "none", label: "暂不签名", description: "产物无签名，Windows 会显示未知发布者" },
		],
		defaultValue: config.windows?.mode ?? "pfx",
	});
	config.windows = { ...config.windows, mode };

	if (mode === "pfx") {
		secrets[SECRETS.windowsCertificate] = "<base64 -i cert.pfx | pbcopy>";
		secrets[SECRETS.windowsCertificatePassword] = "<.pfx 密码>";
	} else if (mode === "azure-trusted-signing") {
		for (const name of [
			SECRETS.azureTenantId,
			SECRETS.azureClientId,
			SECRETS.azureClientSecret,
			SECRETS.azureEndpoint,
			SECRETS.azureAccount,
			SECRETS.azureProfile,
		]) {
			secrets[name] = process.env[name] ?? `<${name}>`;
		}
	}
	state.windowsMode = mode;
	return { secrets };
}

async function stepUpdater({ config, prompter, args, state }) {
	log.title("④ Tauri Updater 签名密钥");
	log.dim("用同一把私钥对每个平台的更新包签名，客户端用公钥校验，保证更新包可验证。");

	const secrets = {};
	const privateKeyPath = updaterPrivateKeyPath();
	const exists = fs.existsSync(privateKeyPath);
	let publicKey = config.updater?.publicKey ?? "";

	const shouldGenerate = await prompter.confirm({
		message: exists && !args.force ? "已存在 updater 私钥，是否重新生成？" : "是否生成 updater 签名密钥对？",
		defaultValue: !exists || args.force,
	});

	if (shouldGenerate || !publicKey) {
		if (args.dryRun) {
			log.info(`[dry-run] tauri signer generate --write-keys ${relativeToRoot(privateKeyPath)} --ci`);
		} else {
			const password = args.yes || !prompter.interactive
				? process.env[SECRETS.updaterPrivateKeyPassword] ?? randomPassword()
				: (await prompter.password({ message: "私钥口令（留空自动生成）" })) || randomPassword();
			const result = generateUpdaterKeypair({ password, force: args.force || !exists });
			publicKey = result.publicKey;
			log.ok(`已生成 updater 密钥: ${relativeToRoot(result.privateKeyPath)}`);
			log.ok(`公钥指纹(sha256): ${sha256(publicKey).slice(0, 16)}…`);
			state.updaterPassword = password;
			secrets[SECRETS.updaterPrivateKey] = "<.signing/updater.key 的内容>";
			secrets[SECRETS.updaterPrivateKeyPassword] = password;
			state.updaterKeyGenerated = true;
		}
	} else {
		log.ok("复用已有 updater 公钥（配置中的 updater.publicKey）");
		if (exists) secrets[SECRETS.updaterPrivateKey] = "<.signing/updater.key 的内容>";
		// 复用已有密钥时必须沿用原口令，否则 CI 无法用该私钥签名
		const previousPassword = state.previousEnv?.[SECRETS.updaterPrivateKeyPassword];
		if (previousPassword) {
			state.updaterPassword = previousPassword;
			secrets[SECRETS.updaterPrivateKeyPassword] = previousPassword;
			log.dim("已从 .signing/signing.env 复用私钥口令");
		} else if (exists) {
			log.warn("未能找到原私钥口令，请手动提供 TAURI_SIGNING_PRIVATE_KEY_PASSWORD");
		}
	}

	config.updater = { ...config.updater, enabled: true, publicKey };
	const endpoints = await prompter.text({
		message: "更新清单地址（留空表示仅签名、不启用自动更新检查）",
		defaultValue: (config.updater.endpoints ?? []).join(","),
	});
	config.updater.endpoints = endpoints
		? endpoints.split(",").map((entry) => entry.trim()).filter(Boolean)
		: [];
	return { secrets };
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const prompter = createPrompter({
		yes: args.yes,
		interactive: !args.nonInteractive && Boolean(process.stdin.isTTY) && !args.yes,
	});
	const enabledPlatforms = args.platforms ?? ALL_PLATFORMS;

	log.title("发布配置引导 · Proof Reader");
	log.dim(`项目: ${PROJECT_ROOT}`);
	if (args.dryRun) log.warn("dry-run 模式：不会写入任何文件");

	const { config, created } = loadOrInitConfig();
	if (created) log.ok("已根据当前工程推导 signing.config.json 初始内容");

	const state = { previousEnv: readSigningEnv() };
	const secretsByScope = {};

	try {
		if (enabledPlatforms.includes("android")) {
			secretsByScope.android = (await stepAndroid({ config, prompter, args, state })).secrets;
		}
		if (enabledPlatforms.includes("macos")) {
			secretsByScope.macos = (await stepMacos({ config, prompter, args, state })).secrets;
		}
		if (enabledPlatforms.includes("windows")) {
			secretsByScope.windows = (await stepWindows({ config, prompter, args, state })).secrets;
		}
		if (enabledPlatforms.includes("updater")) {
			secretsByScope.updater = (await stepUpdater({ config, prompter, args, state })).secrets;
		}
	} catch (error) {
		if (error instanceof CancelledError) {
			log.warn("已取消，未做任何改动");
			return;
		}
		throw error;
	}

	if (args.dryRun) {
		log.title("dry-run 结果");
		log.info(`configKey 将是: ${computeConfigKey(config)}`);
		prompter.close();
		return;
	}

	// ---- 写入配置（会自动回填 configKey） ----
	const saved = saveSigningConfig(config);
	log.title("⑤ 写入配置与项目文件");
	log.ok(`signing.config.json 已更新`);
	log.info(`configKey = ${saved.configKey}`);
	log.dim("指纹由配置内容推导：同一 configKey + 同一套 key => 产物必须字节一致");

	const results = [];
	if (!args.skipGradlePatch) {
		try {
			const gradle = applyGradlePatch(saved);
			results.push(["Android Gradle 签名/可复现补丁", gradle.changed]);
		} catch (error) {
			log.warn(error.message);
		}
		results.push(["Android .gitignore 忽略签名材料", ensureAndroidGitignore().changed]);
	}
	const tauriPatch = applyTauriConfigPatch(saved);
	results.push(["tauri.conf.json 打包/签名配置", tauriPatch.changed]);
	logPatchResults(results);

	// ---- 一致性自检 ----
	const { errors, warnings } = collectConfigIssues(loadSigningConfig());
	if (errors.length > 0) {
		log.title("配置自检未通过");
		for (const error of errors) log.fail(error);
	} else {
		log.ok("配置自检通过");
	}
	for (const warning of warnings) log.warn(warning);

	// ---- 导出环境变量与 Secret 清单 ----
	const envVars = {
		SOURCE_DATE_EPOCH: String(resolveSourceDateEpoch(saved)),
	};
	for (const scope of Object.values(secretsByScope)) {
		for (const [key, value] of Object.entries(scope)) {
			if (typeof value === "string" && !value.startsWith("<")) envVars[key] = value;
		}
	}
	// 与已有内容合并：增量运行时不能丢掉上次生成的口令
	const envPath = writeSigningEnv({ ...state.previousEnv, ...envVars });
	log.ok(`环境变量已写入: ${relativeToRoot(envPath)}`);

	// 汇总「值已确定」的 Secret，供 gh 一次性写入。
	// 注意：keystore base64 与 updater 私钥体积大且已在 .signing/ 下有独立文件，
	// 因此不塞进 signing.env，而是在这里从磁盘读入，保证 dotenv 是完整的一份。
	const secretValues = { ...state.previousEnv };
	for (const [key, value] of Object.entries(envVars)) {
		if (key !== "SOURCE_DATE_EPOCH" && typeof value === "string" && value !== "" && !value.startsWith("<")) {
			secretValues[key] = value;
		}
	}
	const keystoreBase64Path = path.join(SIGNING_STATE_DIR, "android-keystore.base64");
	if (config.android?.enabled !== false && fs.existsSync(keystoreBase64Path)) {
		secretValues[SECRETS.androidKeystore] = fs.readFileSync(keystoreBase64Path, "utf8").trim();
	}
	if (fs.existsSync(updaterPrivateKeyPath())) {
		secretValues[SECRETS.updaterPrivateKey] = fs.readFileSync(updaterPrivateKeyPath(), "utf8").trim();
	}
	const dotenvPath = writeSecretsDotenv(secretValues);
	log.ok(`Secrets dotenv 已写入: ${relativeToRoot(dotenvPath)}`);

	const entries = buildSecretEntries({ config: saved });
	const checklistPath = writeSecretsChecklist(entries);
	log.ok(`GitHub Secrets 清单: ${relativeToRoot(checklistPath)}`);
	log.dim("一键写入全部: gh secret set -f .signing/github-secrets.env");

	// ---- 收尾提示 ----
	log.title("下一步");
	if (state.keystoreBase64Path) {
		log.info(`1. 备份 keystore 与口令（丢失后无法再发布升级包）:`);
		log.dim(`   ${relativeToRoot(androidKeystorePath(saved))}`);
		log.info("2. 把 Secrets 写入仓库（需要 gh 已登录）:");
		log.dim("   bash scripts/ci/push-secrets.sh");
		log.info("3. 校验配置:");
		log.dim("   pnpm run signing:check");
		log.info("4. 可复现构建并生成产物清单:");
		log.dim("   pnpm run build:release");
	} else {
		log.info("1. 查看 Secrets 清单并写入仓库:");
		log.dim(`   ${relativeToRoot(checklistPath)}`);
		log.info("2. 校验配置: pnpm run signing:check");
	}
	log.raw("");
	prompter.close();
}

/** 生成 Secrets 条目（含 gh 命令），供清单与 CI 文档共用。 */
runCli(main);
