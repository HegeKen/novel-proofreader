/**
 * 发布配置（signing.config.json）核心库。
 *
 * 设计目标：
 *   1. 同一份 signing.config.json（即同一 configKey）=> 打包产物逐字节一致（可复现）。
 *   2. 产物签名所用的 key 全部由该配置推导，配置不落盘任何私钥。
 *   3. configKey 同时覆盖 tauri.conf.json / package.json / Cargo.toml 的一致性，
 *      避免"配置改了但版本号没同步"导致的产物漂移。
 */

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..", "..");

export const SIGNING_CONFIG_PATH = path.join(PROJECT_ROOT, "signing.config.json");
/** 私钥、keystore、导出的 base64 都放这里，已被 .gitignore 忽略。 */
export const SIGNING_STATE_DIR = path.join(PROJECT_ROOT, ".signing");
export const SIGNING_ENV_PATH = path.join(SIGNING_STATE_DIR, "signing.env");
export const SECRETS_CHECKLIST_PATH = path.join(SIGNING_STATE_DIR, "github-secrets.md");

export const SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------

const COLOR_ENABLED = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

const ANSI = {
	reset: "\u001b[0m",
	bold: "\u001b[1m",
	dim: "\u001b[2m",
	red: "\u001b[31m",
	green: "\u001b[32m",
	yellow: "\u001b[33m",
	blue: "\u001b[34m",
	cyan: "\u001b[36m",
};

function paint(color, text) {
	if (!COLOR_ENABLED) return text;
	return `${ANSI[color]}${text}${ANSI.reset}`;
}

export const log = {
	title: (text) => console.log(`\n${paint("bold", text)}`),
	step: (text) => console.log(`${paint("cyan", "▸")} ${text}`),
	info: (text) => console.log(`  ${text}`),
	dim: (text) => console.log(`  ${paint("dim", text)}`),
	ok: (text) => console.log(`${paint("green", "✓")} ${text}`),
	warn: (text) => console.warn(`${paint("yellow", "!")} ${text}`),
	fail: (text) => console.error(`${paint("red", "✗")} ${text}`),
	raw: (text) => console.log(text),
};

/**
 * CLI 入口包装：把异常收敛成「一行错误 + 退出码 1」，而不是甩一坨调用栈。
 * 需要完整堆栈时设 DSH_DEBUG=1。
 */
export function runCli(main) {
	Promise.resolve()
		.then(() => main())
		.catch((error) => {
			if (error?.name === "CancelledError") {
				log.warn("已取消");
				process.exitCode = 130;
				return;
			}
			log.fail(error?.message ?? String(error));
			if (process.env.DSH_DEBUG) console.error(error);
			process.exitCode = 1;
		});
}

// ---------------------------------------------------------------------------
// 规范化 JSON / 指纹
// ---------------------------------------------------------------------------

/** 递归按 key 排序，保证同一逻辑配置永远序列化成同一串字节。 */
export function canonicalize(value) {
	if (value === null || typeof value !== "object") return value;
	if (Array.isArray(value)) return value.map(canonicalize);
	const out = {};
	for (const key of Object.keys(value).sort()) {
		if (value[key] === undefined) continue;
		out[key] = canonicalize(value[key]);
	}
	return out;
}

export function canonicalJson(value) {
	return JSON.stringify(canonicalize(value));
}

export function sha256(input, encoding = "hex") {
	return createHash("sha256").update(input).digest(encoding);
}

export function sha256File(filePath) {
	return sha256(fs.readFileSync(filePath));
}

/**
 * 参与指纹计算的字段。
 * configKey 自身不能参与（自引用），$schema 只是编辑器提示，不影响产物。
 */
export function fingerprintPayload(config) {
	const { configKey: _configKey, $schema: _schema, ...rest } = config ?? {};
	return rest;
}

/** 配置指纹：同 key => 期望产物一致。 */
export function computeConfigKey(config) {
	return `sha256:${sha256(canonicalJson(fingerprintPayload(config)))}`;
}

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

// ---------------------------------------------------------------------------
// 进程执行
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 配置读写
// ---------------------------------------------------------------------------

export function readJson(filePath) {
	return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function writeJson(filePath, value) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function signingConfigExists() {
	return fs.existsSync(SIGNING_CONFIG_PATH);
}

export function loadSigningConfig({ required = true } = {}) {
	if (!fs.existsSync(SIGNING_CONFIG_PATH)) {
		if (!required) return null;
		throw new Error(
			`未找到 ${path.relative(PROJECT_ROOT, SIGNING_CONFIG_PATH)}。\n` +
				`请运行:  pnpm run setup:signing   （会按当前工程自动推导并生成）`,
		);
	}
	return readJson(SIGNING_CONFIG_PATH);
}

/**
 * 写入配置并补齐 configKey。
 * configKey 由内容推导，因此永远与内容同步 —— 这是"配置一致"的唯一事实来源。
 */
export function saveSigningConfig(config) {
	const next = { ...config };
	delete next.configKey;
	next.configKey = computeConfigKey(next);
	writeJson(SIGNING_CONFIG_PATH, next);
	return next;
}

/** 默认配置：与当前仓库实际值对齐，保证开箱即可生成正确指纹。 */
export function defaultSigningConfig() {
	return {
		$schema: "./signing.config.schema.json",
		schemaVersion: SCHEMA_VERSION,
		app: {
			productName: "Proof Reader",
			identifier: "cn.helilab.proofreader",
			version: "0.0.0",
		},
		reproducibility: {
			sourceDateEpoch: "commit",
			preserveFileTimestamps: false,
			reproducibleFileOrder: true,
			dependencyInfoInRelease: false,
			lockedDependencies: true,
			normalizeAndroidArchive: true,
		},
		android: {
			enabled: true,
			keystorePath: "src-tauri/gen/android/keystore.jks",
			keystorePropertiesPath: "src-tauri/gen/android/keystore.properties",
			keystoreType: "PKCS12",
			keyAlias: "proofreader",
			keyAlgorithm: "RSA",
			keySize: 4096,
			validityDays: 10950,
			signatureScheme: "v1+v2+v3",
			distinguishedName: {
				commonName: "Heli Lab",
				organizationalUnit: "Mobile",
				organization: "Heli Lab",
				locality: "Hangzhou",
				state: "Zhejiang",
				country: "CN",
			},
		},
		macos: {
			enabled: true,
			signingIdentityEnv: "APPLE_SIGNING_IDENTITY",
			hardenedRuntime: true,
			notarize: true,
			minimumSystemVersion: "10.15",
			entitlements: "src-tauri/entitlements.plist",
		},
		windows: {
			enabled: true,
			mode: "pfx",
			digestAlgorithm: "sha256",
			timestampUrl: "http://timestamp.digicert.com",
			tsp: false,
			// 本地构建用：证书指纹（CI 会在导入 pfx 后自动注入，无需填这里）
			certificateThumbprint: "",
			// mode=azure-trusted-signing 时使用，会被转换成 bundle.windows.signCommand
			azureTrustedSigning: {
				endpoint: "",
				account: "",
				certificateProfile: "",
				description: "",
				// 固定签名工具版本——它也决定产物字节，因此纳入 configKey
				cliVersion: "",
			},
		},
		updater: {
			enabled: true,
			publicKey: "",
			keyId: "main",
			endpoints: [],
		},
	};
}

// ---------------------------------------------------------------------------
// 一致性校验
// ---------------------------------------------------------------------------

function readPackageVersion() {
	return readJson(path.join(PROJECT_ROOT, "package.json")).version;
}

function readTauriConfig() {
	return readJson(path.join(PROJECT_ROOT, "src-tauri", "tauri.conf.json"));
}

function readCargoVersion() {
	const cargoToml = fs.readFileSync(path.join(PROJECT_ROOT, "src-tauri", "Cargo.toml"), "utf8");
	const match = cargoToml.match(/^\s*version\s*=\s*"([^"]+)"/m);
	return match?.[1] ?? null;
}

function isPlainObject(value) {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Tauri updater 公钥是 .pub 文件的完整内容：一整行 base64，
 * 解码后是 "untrusted comment: minisign public key: <ID>\n<key>"。
 */
export function looksLikeMinisignPublicKey(value) {
	try {
		const decoded = Buffer.from(String(value).trim(), "base64").toString("utf8");
		return decoded.includes("minisign public key") && decoded.includes("untrusted comment:");
	} catch {
		return false;
	}
}

/**
 * 校验配置的完整性 + 与 package.json / tauri.conf.json / Cargo.toml 的一致性。
 * 返回 { errors, warnings }，errors 非空时构建必须终止（否则产物无法复现）。
 */
export function collectConfigIssues(config) {
	const errors = [];
	const warnings = [];

	if (!isPlainObject(config)) {
		return { errors: ["signing.config.json 不是合法的 JSON 对象"], warnings };
	}
	if (config.schemaVersion !== SCHEMA_VERSION) {
		errors.push(`schemaVersion 应为 ${SCHEMA_VERSION}，实际为 ${JSON.stringify(config.schemaVersion)}`);
	}

	const { app, reproducibility, android, macos, windows, updater } = config;

	if (!isPlainObject(app)) {
		errors.push("缺少 app 配置段");
	} else {
		for (const field of ["productName", "identifier", "version"]) {
			if (!app[field]) errors.push(`app.${field} 不能为空`);
		}
		try {
			const tauriConfig = readTauriConfig();
			const pkgVersion = readPackageVersion();
			const cargoVersion = readCargoVersion();

			if (app.productName && tauriConfig.productName !== app.productName) {
				errors.push(
					`app.productName="${app.productName}" 与 tauri.conf.json productName="${tauriConfig.productName}" 不一致`,
				);
			}
			if (app.identifier && tauriConfig.identifier !== app.identifier) {
				errors.push(
					`app.identifier="${app.identifier}" 与 tauri.conf.json identifier="${tauriConfig.identifier}" 不一致`,
				);
			}
			if (app.version && pkgVersion !== app.version) {
				errors.push(`app.version="${app.version}" 与 package.json version="${pkgVersion}" 不一致`);
			}
			if (app.version && cargoVersion && cargoVersion !== app.version) {
				errors.push(`app.version="${app.version}" 与 src-tauri/Cargo.toml version="${cargoVersion}" 不一致`);
			}
			if (app.version && tauriConfig.version !== app.version) {
				errors.push(`app.version="${app.version}" 与 tauri.conf.json version="${tauriConfig.version}" 不一致`);
			}
		} catch (error) {
			errors.push(`读取版本信息失败: ${error.message}`);
		}
	}

	if (!isPlainObject(reproducibility)) {
		errors.push("缺少 reproducibility 配置段（产物一致性依赖它）");
	} else {
		const mode = reproducibility.sourceDateEpoch;
		if (mode !== "commit" && mode !== "zero" && typeof mode !== "number") {
			errors.push(`reproducibility.sourceDateEpoch 必须是 "commit" | "zero" | 秒级时间戳，实际为 ${JSON.stringify(mode)}`);
		}
		if (reproducibility.preserveFileTimestamps !== false) {
			warnings.push("reproducibility.preserveFileTimestamps 未设为 false，归档文件会写入构建时间导致产物漂移");
		}
		if (reproducibility.reproducibleFileOrder !== true) {
			warnings.push("reproducibility.reproducibleFileOrder 未设为 true，归档条目顺序可能不稳定");
		}
		if (reproducibility.lockedDependencies !== true) {
			warnings.push("reproducibility.lockedDependencies 未设为 true，依赖版本漂移会直接改变产物");
		}
	}

	if (isPlainObject(android)) {
		if (android.enabled !== false) {
			if (!android.keystorePath) errors.push("android.keystorePath 不能为空");
			if (!android.keystorePropertiesPath) errors.push("android.keystorePropertiesPath 不能为空");
			if (!android.keyAlias) errors.push("android.keyAlias 不能为空");
			const dn = android.distinguishedName;
			if (!isPlainObject(dn) || !dn.commonName) {
				errors.push("android.distinguishedName.commonName 不能为空（keystore 证书主体）");
			}
			if (typeof android.validityDays !== "number" || android.validityDays <= 0) {
				errors.push("android.validityDays 必须是正数");
			}
			if (typeof android.keySize !== "number" || android.keySize < 2048) {
				errors.push("android.keySize 至少为 2048");
			}
		}
	} else {
		warnings.push("未配置 android 段，Android 产物将不会被签名");
	}

	if (isPlainObject(windows) && windows.enabled !== false && windows.mode !== "none") {
		if (!["pfx", "azure-trusted-signing"].includes(windows.mode)) {
			errors.push(`windows.mode 必须是 "pfx" | "azure-trusted-signing" | "none"，实际为 ${JSON.stringify(windows.mode)}`);
		}
		if (windows.mode === "azure-trusted-signing") {
			// trusted-signing-cli 必须拿到这四个值，缺一个签名就会失败，提前拦住
			const azure = windows.azureTrustedSigning;
			if (!isPlainObject(azure)) {
				errors.push("windows.mode=azure-trusted-signing 时必须提供 windows.azureTrustedSigning");
			} else {
				for (const field of ["endpoint", "account", "certificateProfile"]) {
					if (!azure[field]) {
						errors.push(`windows.azureTrustedSigning.${field} 不能为空（Azure Trusted Signing 的账号信息）`);
					}
				}
			}
		}
	}

	if (isPlainObject(updater) && updater.enabled !== false) {
		if (!updater.publicKey) {
			warnings.push("updater.publicKey 为空，运行 pnpm run setup:signing 的 updater 步骤可自动回填");
		} else if (!looksLikeMinisignPublicKey(updater.publicKey)) {
			warnings.push(
				"updater.publicKey 不是合法的 Tauri minisign 公钥（应为 .signing/updater.key.pub 文件的完整内容）",
			);
		}
	}

	if (isPlainObject(macos) && macos.enabled !== false) {
		// entitlements 的路径基准是 src-tauri/（Tauri 打包前会 chdir 到那里），
		// 而 signing.config.json 里的路径统一相对项目根，所以这里按项目根校验存在性。
		// 提前校验的价值：写错基准时，无证书环境会完全忽略该文件，
		// 有证书的 CI 则要到打包末期才由 codesign 报错，很难定位。
		if (macos.entitlements) {
			const entitlements = resolveFromRoot(macos.entitlements);
			if (!fs.existsSync(entitlements)) {
				warnings.push(
					`macOS entitlements 文件不存在: ${macos.entitlements}（按项目根解析）。` +
						`tauri.conf.json 中会写为相对 src-tauri/ 的路径，文件缺失时签名将缺少 JIT 等权限`,
				);
			}
		} else if (macos.notarize) {
			warnings.push("macOS 开启了公证但没有配置 entitlements，hardened runtime 下 WebKit 可能无法启动");
		}
	}

	return { errors, warnings };
}

// ---------------------------------------------------------------------------
// 可复现构建辅助
// ---------------------------------------------------------------------------

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

export function resolveFromRoot(relativeOrAbsolute, root = PROJECT_ROOT) {
	return path.isAbsolute(relativeOrAbsolute) ? relativeOrAbsolute : path.join(root, relativeOrAbsolute);
}

export function relativeToRoot(target, root = PROJECT_ROOT) {
	return path.relative(root, target).split(path.sep).join("/");
}

/**
 * AGP 只有在「没有签名配置」时才会产出 `*-unsigned.apk` / `*-unsigned.aab`，
 * 因此这个后缀是"签名补丁没生效"的硬信号，绝不能把它当成正常产物。
 */
export function isUnsignedAndroidArtifact(filePath) {
	return /-unsigned\.(apk|aab)$/i.test(filePath);
}

export function ensureDir(dirPath) {
	fs.mkdirSync(dirPath, { recursive: true });
	return dirPath;
}

/** 写入 .signing/signing.env，供本地 shell `source` 使用。 */
export function writeSigningEnv(vars) {
	ensureDir(SIGNING_STATE_DIR);
	const lines = [
		"# 由 pnpm run setup:signing 生成 —— 含私钥，切勿提交",
		"# 用法: source .signing/signing.env",
		"",
	];
	for (const [key, value] of Object.entries(vars)) {
		if (value === undefined || value === null || value === "") continue;
		lines.push(`export ${key}=${shellQuote(String(value))}`);
	}
	const filePath = SIGNING_ENV_PATH;
	fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
	fs.chmodSync(filePath, 0o600);
	return filePath;
}

export const SECRETS_DOTENV_PATH = path.join(SIGNING_STATE_DIR, "github-secrets.env");

/**
 * 生成 gh 可直接消费的 dotenv 文件（`gh secret set -f <file>`）。
 * 只写入值已知的项；文件含明文口令，权限 600 且位于已忽略的 .signing/ 下。
 */
export function writeSecretsDotenv(values) {
	ensureDir(SIGNING_STATE_DIR);
	const lines = [
		"# 由 pnpm run setup:signing 生成 —— 含明文口令，切勿提交",
		"# 用法: gh secret set -f .signing/github-secrets.env",
		"",
	];
	for (const [key, value] of Object.entries(values)) {
		if (typeof value !== "string" || value === "" || value.startsWith("<")) continue;
		// dotenv 是单行 KEY=value，值里出现换行会破坏格式（base64 已在上游清成单行）
		if (value.includes("\n")) continue;
		lines.push(`${key}=${value}`);
	}
	fs.writeFileSync(SECRETS_DOTENV_PATH, `${lines.join("\n")}\n`, "utf8");
	fs.chmodSync(SECRETS_DOTENV_PATH, 0o600);
	return SECRETS_DOTENV_PATH;
}

/**
 * 读取已存在的 .signing/signing.env。
 * 用于增量运行：向导第二次执行时不应把上次生成的口令丢掉。
 */
export function readSigningEnv() {
	if (!fs.existsSync(SIGNING_ENV_PATH)) return {};
	const parsed = {};
	for (const line of fs.readFileSync(SIGNING_ENV_PATH, "utf8").split(/\r?\n/)) {
		const match = line.match(/^export\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
		if (!match) continue;
		let value = match[2];
		if (value.startsWith("'") && value.endsWith("'")) {
			value = value.slice(1, -1).replace(/'\\''/g, "'");
		}
		parsed[match[1]] = value;
	}
	return parsed;
}

export function shellQuote(value) {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function base64EncodeFile(filePath) {
	return fs.readFileSync(filePath).toString("base64");
}

export function writeFileSecure(filePath, contents) {
	ensureDir(path.dirname(filePath));
	fs.writeFileSync(filePath, contents, "utf8");
	fs.chmodSync(filePath, 0o600);
	return filePath;
}
