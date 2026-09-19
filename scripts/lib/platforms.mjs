/**
 * 各平台签名材料（keystore / 证书 / 签名密钥）的生成、读取与 CI Secret 映射。
 *
 * 约定：本模块只负责"材料"，不改项目文件（那是 project-files.mjs 的职责）。
 * 所有私钥都写在 .signing/ 下（已在 .gitignore 中忽略），永不进入配置或产物清单。
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	PROJECT_ROOT,
	base64EncodeFile,
	capture,
	ensureDir,
	relativeToRoot,
	resolveFromRoot,
	tryRun,
	writeFileSecure,
} from "./core.mjs";

// ---------------------------------------------------------------------------
// CI Secret 名称（唯一事实来源，向导 / 校验 / 文档 / workflow 都引用它）
// ---------------------------------------------------------------------------

export const SECRETS = {
	androidKeystore: "ANDROID_KEYSTORE_BASE64",
	androidKeystorePassword: "ANDROID_KEYSTORE_PASSWORD",
	androidKeyAlias: "ANDROID_KEY_ALIAS",
	androidKeyPassword: "ANDROID_KEY_PASSWORD",
	macosCertificate: "APPLE_CERTIFICATE",
	macosCertificatePassword: "APPLE_CERTIFICATE_PASSWORD",
	macosSigningIdentity: "APPLE_SIGNING_IDENTITY",
	macosId: "APPLE_ID",
	macosPassword: "APPLE_PASSWORD",
	macosTeamId: "APPLE_TEAM_ID",
	macosApiKey: "APPLE_API_KEY",
	macosApiIssuer: "APPLE_API_ISSUER",
	macosApiKeyP8: "APPLE_API_KEY_P8",
	updaterPrivateKey: "TAURI_SIGNING_PRIVATE_KEY",
	updaterPrivateKeyPassword: "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
	windowsCertificate: "WINDOWS_CERTIFICATE",
	windowsCertificatePassword: "WINDOWS_CERTIFICATE_PASSWORD",
	azureClientId: "AZURE_CLIENT_ID",
	azureClientSecret: "AZURE_CLIENT_SECRET",
	azureTenantId: "AZURE_TENANT_ID",
	azureEndpoint: "AZURE_CODE_SIGNING_ENDPOINT",
	azureAccount: "AZURE_CODE_SIGNING_ACCOUNT",
	azureProfile: "AZURE_CODE_SIGNING_CERTIFICATE_PROFILE",
};

// ---------------------------------------------------------------------------
// 通用
// ---------------------------------------------------------------------------

/** 生成 URL-safe 随机密码：不含 \ : = # 等会破坏 properties / shell 的字符。 */
export function randomPassword(bytes = 32) {
	return crypto.randomBytes(bytes).toString("base64url");
}

/** RFC 2253 转义，避免 CN 中的逗号/加号破坏 keytool -dname 解析。 */
export function escapeRdnValue(value) {
	const text = String(value);
	const escaped = text.replace(/([,+"\\<>;=])/g, "\\$1");
	const leading = escaped.replace(/^(\s+|#)/, (match) => match.replace(/(\s|#)/g, "\\$1"));
	return leading.replace(/(\s+)$/, (match) => match.replace(/\s/g, "\\ "));
}

export function buildDname(dn) {
	return [
		["CN", dn.commonName],
		["OU", dn.organizationalUnit],
		["O", dn.organization],
		["L", dn.locality],
		["ST", dn.state],
		["C", dn.country],
	]
		.filter(([, value]) => value)
		.map(([key, value]) => `${key}=${escapeRdnValue(value)}`)
		.join(", ");
}

// ---------------------------------------------------------------------------
// Android keystore
// ---------------------------------------------------------------------------

export function androidKeystorePath(config) {
	return resolveFromRoot(config.android.keystorePath);
}

export function androidKeystorePropertiesPath(config) {
	return resolveFromRoot(config.android.keystorePropertiesPath);
}

export function androidKeystoreExists(config) {
	return fs.existsSync(androidKeystorePath(config));
}

/**
 * 通过文件头识别 keystore 类型。
 *
 * 为什么必须识别：AGP 的 SigningConfig.storeType 一旦与实际文件不符，
 * 加载会直接失败。而 Android Studio 旧版本向导产出 JKS、新版本产出 PKCS12，
 * 用户导入时很容易与配置里写的不一致。只靠配置猜测是靠不住的。
 */
export function detectKeystoreType(filePath) {
	if (!fs.existsSync(filePath)) return null;
	const header = Buffer.alloc(4);
	const fd = fs.openSync(filePath, "r");
	try {
		fs.readSync(fd, header, 0, 4, 0);
	} finally {
		fs.closeSync(fd);
	}
	// JKS: magic 0xFEEDFEED；PKCS12: DER SEQUENCE (0x30 0x82 ...)
	if (header[0] === 0xfe && header[1] === 0xed && header[2] === 0xfe && header[3] === 0xed) return "JKS";
	if (header[0] === 0x30) return "PKCS12";
	return null;
}

/** 用 keytool 生成 keystore。同一个 keystore 是"配置一致的 key"里的 key。 */
export function generateAndroidKeystore({ config, storePassword, keyPassword, force = false }) {
	const keystorePath = androidKeystorePath(config);
	if (fs.existsSync(keystorePath) && !force) {
		throw new Error(`keystore 已存在: ${relativeToRoot(keystorePath)}（如需重建请加 --force，注意会破坏升级签名）`);
	}
	ensureDir(path.dirname(keystorePath));
	fs.rmSync(keystorePath, { force: true });

	const { keyAlias, keyAlgorithm, keySize, validityDays, keystoreType, distinguishedName } = config.android;
	const args = [
		"-genkeypair",
		"-alias",
		keyAlias,
		"-keyalg",
		keyAlgorithm,
		"-keysize",
		String(keySize),
		"-validity",
		String(validityDays),
		"-keystore",
		keystorePath,
		"-storetype",
		keystoreType,
		"-storepass",
		storePassword,
		"-dname",
		buildDname(distinguishedName),
	];
	// PKCS12 规范下 key password 必须与 store password 相同，keytool 会忽略 -keypass。
	if (keystoreType.toUpperCase() === "JKS" && keyPassword && keyPassword !== storePassword) {
		args.push("-keypass", keyPassword);
	}
	capture("keytool", args);
	if (!fs.existsSync(keystorePath)) throw new Error("keytool 未生成 keystore 文件");
	return keystorePath;
}

/**
 * 列出 keystore 中的条目（别名 + 类型）。
 *
 * keytool 的输出是本地化的（中文 JDK 打印「密钥库」等），因此显式强制 JVM 语言为英文；
 * 条目行格式固定为 `<alias>, <date>, <EntryType>, `。
 * 口令错误或文件损坏时 keytool 退出码非 0，返回 null —— 调用方据此报错。
 */
export function listKeystoreAliases({ keystorePath, storePassword }) {
	if (!fs.existsSync(keystorePath)) return null;
	const output = tryRun(
		"keytool",
		[
			"-list",
			"-keystore",
			keystorePath,
			"-storepass",
			storePassword,
			"-J-Duser.language=en",
			"-J-Duser.country=US",
		],
		{ allowStderr: true },
	);
	if (!output) return null;
	const aliases = [];
	for (const line of output.split(/\r?\n/)) {
		const match = line.match(
			/^(.*),\s*\d{4}\s+\S+\s+\d{1,2},\s*(PrivateKeyEntry|trustedCertEntry|SecretKeyEntry)\s*,\s*$/,
		);
		if (match) aliases.push({ alias: match[1].trim(), entryType: match[2] });
	}
	return aliases;
}

/** 读取 keystore 中签名证书的 SHA-256（即"key 指纹"，用于产物一致性核对）。 */
export function readAndroidCertSha256({ config, storePassword, alias }) {
	const keystorePath = androidKeystorePath(config);
	if (!fs.existsSync(keystorePath)) return null;
	const targetAlias = alias ?? config.android.keyAlias;
	const output = tryRun(
		"keytool",
		[
			"-list",
			"-v",
			"-keystore",
			keystorePath,
			"-storepass",
			storePassword,
			"-alias",
			targetAlias,
			"-J-Duser.language=en",
			"-J-Duser.country=US",
		],
		{ allowStderr: true },
	);
	if (!output) return null;
	const match = output.match(/SHA256:\s*([0-9A-Fa-f:]{95})/);
	return match ? match[1].replace(/:/g, "").toLowerCase() : null;
}

export function writeKeystoreProperties({ config, storePassword, keyPassword }) {
	const keystorePath = androidKeystorePath(config);
	const propertiesPath = androidKeystorePropertiesPath(config);
	const relative = path.relative(path.dirname(propertiesPath), keystorePath).split(path.sep).join("/");
	// storeType 一并写入：AGP 需要它才能正确加载 JKS/PKCS12
	const storeType = config.android.keystoreType || detectKeystoreType(keystorePath) || "PKCS12";
	const lines = [
		"# 由 pnpm run setup:signing 生成 —— 含签名口令，切勿提交（已在 .gitignore 忽略）",
		`storeFile=${relative}`,
		`storeType=${storeType}`,
		`storePassword=${storePassword}`,
		`keyAlias=${config.android.keyAlias}`,
		`keyPassword=${keyPassword}`,
	];
	writeFileSecure(propertiesPath, `${lines.join("\n")}\n`);
	return propertiesPath;
}

export function readKeystoreProperties(config) {
	const propertiesPath = androidKeystorePropertiesPath(config);
	if (!fs.existsSync(propertiesPath)) return null;
	const text = fs.readFileSync(propertiesPath, "utf8");
	const parsed = {};
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const separator = trimmed.indexOf("=");
		if (separator < 0) continue;
		parsed[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
	}
	return {
		storeFile: parsed.storeFile,
		storeType: parsed.storeType,
		storePassword: parsed.storePassword,
		keyAlias: parsed.keyAlias,
		keyPassword: parsed.keyPassword,
	};
}

/** 把 keystore 导出为 base64，供 CI Secret 使用。 */
export function exportAndroidKeystoreBase64(config) {
	const keystorePath = androidKeystorePath(config);
	if (!fs.existsSync(keystorePath)) throw new Error(`keystore 不存在: ${relativeToRoot(keystorePath)}`);
	const encoded = base64EncodeFile(keystorePath);
	const outPath = writeFileSecure(path.join(PROJECT_ROOT, ".signing", "android-keystore.base64"), `${encoded}\n`);
	return { encoded, outPath };
}

// ---------------------------------------------------------------------------
// macOS
// ---------------------------------------------------------------------------

export function findMacSigningIdentities() {
	if (process.platform !== "darwin") return [];
	const output = tryRun("security", ["find-identity", "-v", "-p", "codesigning"]) ?? "";
	return [...output.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

/** 从 .p12 / .pfx 读取叶子证书 SHA-256，用于确认 CI 与本地用的是同一张证书。 */
export function readP12CertSha256(p12Path, password) {
	if (!fs.existsSync(p12Path)) return null;
	const output = tryRun(
		"openssl",
		["pkcs12", "-in", p12Path, "-nokeys", "-passin", `pass:${password}`, "-nodes"],
		{ allowStderr: true },
	);
	if (!output) return null;
	const pem = output.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/);
	if (!pem) return null;
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "p12-cert-"));
	const pemPath = path.join(tempDir, "cert.pem");
	try {
		fs.writeFileSync(pemPath, pem[0], "utf8");
		const digest = tryRun("openssl", ["x509", "-noout", "-fingerprint", "-sha256", "-in", pemPath], {
			allowStderr: true,
		});
		return digest?.match(/=([0-9A-Fa-f:]+)/)?.[1]?.replace(/:/g, "").toLowerCase() ?? null;
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
}

export function macosNotarizationMode(config) {
	if (!config?.macos?.notarize) return "none";
	const hasApiKey = Boolean(process.env.APPLE_API_KEY && process.env.APPLE_API_ISSUER);
	const hasAppleId = Boolean(process.env.APPLE_ID && process.env.APPLE_PASSWORD && process.env.APPLE_TEAM_ID);
	if (hasApiKey) return "api-key";
	if (hasAppleId) return "apple-id";
	return "unset";
}

// ---------------------------------------------------------------------------
// Tauri updater 签名密钥
// ---------------------------------------------------------------------------

export function updaterPrivateKeyPath() {
	return path.join(PROJECT_ROOT, ".signing", "updater.key");
}

export function updaterPublicKeyPath() {
	return `${updaterPrivateKeyPath()}.pub`;
}

/**
 * 生成 minisign 密钥对。用 tauri CLI 自带的 signer（无需 cargo/网络）。
 * 返回 { privateKeyPath, publicKeyPath, publicKey }。
 */
export function generateUpdaterKeypair({ password, force = false, tauriBin }) {
	const privateKeyPath = updaterPrivateKeyPath();
	const publicKeyPath = updaterPublicKeyPath();
	if (fs.existsSync(privateKeyPath) && !force) {
		throw new Error(`updater 私钥已存在: ${relativeToRoot(privateKeyPath)}（加 --force 才会覆盖）`);
	}
	ensureDir(path.dirname(privateKeyPath));
	fs.rmSync(privateKeyPath, { force: true });
	fs.rmSync(publicKeyPath, { force: true });

	const bin = tauriBin ?? path.join(PROJECT_ROOT, "node_modules", ".bin", "tauri");
	const args = ["signer", "generate", "--write-keys", privateKeyPath, "--ci"];
	if (password) args.push("--password", password);
	capture(bin, args);
	fs.chmodSync(privateKeyPath, 0o600);
	const publicKey = fs.readFileSync(publicKeyPath, "utf8").trim();
	return { privateKeyPath, publicKeyPath, publicKey };
}

/** 用私钥对文件签名（生成 .sig），与 CI 行为一致。 */
export function signFileWithUpdaterKey(filePath, { password, privateKeyPath, tauriBin }) {
	const bin = tauriBin ?? path.join(PROJECT_ROOT, "node_modules", ".bin", "tauri");
	const keyPath = privateKeyPath ?? updaterPrivateKeyPath();
	const args = ["signer", "sign", "--private-key-path", keyPath];
	if (password) args.push("--password", password);
	args.push(filePath);
	const output = capture(bin, args);
	const signature = output.trim();
	const sigPath = `${filePath}.sig`;
	fs.writeFileSync(sigPath, signature, "utf8");
	return { signature, sigPath };
}

// ---------------------------------------------------------------------------
// GitHub Secrets 清单
// ---------------------------------------------------------------------------

/**
 * 生成 GitHub Secrets 清单。
 *
 * 每个条目都带「值从哪来」与「怎么写进去」两条可直接复制的命令，让清单本身
 * 就是一份可执行的引导，而不是一张名词表。
 *
 * 写入方式说明（依据 gh 官方行为）：
 *   - `gh secret set NAME`（不带值）会进入隐藏输入的交互提示 —— 适合口令类，不落 shell 历史；
 *   - `--body` 未指定时读 stdin，因此 `... | gh secret set NAME` 可直接管道传输；
 *   - `gh secret set -f <dotenv 文件>` 可一次写入多个。
 */
export function buildSecretsChecklist({ os = process.platform, entries = [], dotenvPath = null } = {}) {
	const lines = [
		"# GitHub Actions 发布签名 Secrets —— 获取与写入引导",
		"",
		"> 由 `pnpm run setup:signing` 生成。**请勿提交本文件**（位于 `.signing/`，已被 .gitignore 忽略）。",
		"",
	];

	if (dotenvPath) {
		lines.push(
			"## 一次性写入全部（推荐）",
			"",
			"已把本次能确定的值汇总到 dotenv 文件，执行一条命令即可全部写入：",
			"",
			"```bash",
			`gh secret set -f ${dotenvPath}`,
			"```",
			"",
			"该文件含明文口令，已被 gitignore 忽略；用完可删除。",
			"",
		);
	}

	lines.push(
		"## 逐个写入",
		"",
		"```bash",
		...entries.filter((entry) => entry.writeCommand).map((entry) => entry.writeCommand),
		"```",
		"",
		"## 清单",
		"",
		"| Secret | 必需 | 用途 |",
		"| --- | --- | --- |",
		...entries.map(
			(entry) => `| \`${entry.name}\` | ${entry.required ? "是" : "按需"} | ${entry.purpose} |`,
		),
		"",
		"## 每个 Secret 的值从哪来、怎么写",
		"",
	);

	for (const entry of entries) {
		lines.push(`### \`${entry.name}\``);
		lines.push(`- 用途：${entry.purpose}`);
		lines.push(`- 获取：${entry.howTo}`);
		if (entry.produceCommand) lines.push(`- 产出值：\`${entry.produceCommand}\``);
		lines.push(
			entry.writeCommand
				? `- 写入：\`${entry.writeCommand}\``
				: `- 写入：\`gh secret set ${entry.name}\`（在隐藏提示中粘贴值）`,
		);
		lines.push("");
	}

	lines.push(
		"## 验证",
		"",
		"```bash",
		"gh secret list          # 只能看到名字与更新时间，值无法读回",
		"```",
		"",
		`生成平台: \`${os}\``,
		"",
	);
	return lines.join("\n");
}
