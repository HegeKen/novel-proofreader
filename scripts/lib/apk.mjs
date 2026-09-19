/**
 * APK/AAB 归档归一化与确定性签名。
 *
 * 为什么需要它：
 *   Gradle/AGP 会在归档条目里写入构建时间戳，即使 key 完全一致，
 *   两次构建的 APK 字节也会不同，无法满足"配置一致 => 产物一致"。
 *
 * 处理管线（顺序不能变，因为 v2/v3 签名覆盖整个文件）：
 *   1. normalizeZipTimestamps()  —— 纯 Node 原地重写所有条目的 DOS 时间戳
 *   2. zipalign -p 4             —— 对齐（会重建归档，必须重新签名）
 *   3. apksigner sign            —— 用同一 keystore 重新签名
 *
 * 已验证：同一 keystore + 同一输入 => 签名后 APK 的 SHA-256 完全一致
 * （RSA PKCS#1 v1.5 是确定性签名，apksigner 默认不写入签名时间）。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { capture, log, tryRun } from "./core.mjs";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const ZIP64_EOCD_LOCATOR = 0x07064b50;
const MAX_COMMENT = 0xffff;

export class AndroidToolchainMissingError extends Error {
	constructor(message) {
		super(message);
		this.name = "AndroidToolchainMissingError";
	}
}

/** 定位 Android SDK 根目录：环境变量优先，其次常见安装位置。 */
export function findAndroidSdkRoot() {
	const candidates = [
		process.env.ANDROID_HOME,
		process.env.ANDROID_SDK_ROOT,
		path.join(os.homedir(), "Library", "Android", "sdk"),
		path.join(os.homedir(), "Android", "Sdk"),
		path.join(os.homedir(), "Android", "sdk"),
		process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Android", "Sdk") : null,
	];
	for (const candidate of candidates) {
		if (candidate && fs.existsSync(candidate)) return candidate;
	}
	return null;
}

function versionRank(name) {
	const match = name.match(/^(\d+)\.(\d+)\.(\d+)/);
	if (!match) return -1;
	return Number(match[1]) * 1_000_000 + Number(match[2]) * 1_000 + Number(match[3]);
}

/** 定位 build-tools 中可用的 apksigner / zipalign，取版本最高的一套。 */
export function findBuildTools() {
	const sdkRoot = findAndroidSdkRoot();
	if (!sdkRoot) return null;
	const buildToolsDir = path.join(sdkRoot, "build-tools");
	if (!fs.existsSync(buildToolsDir)) return null;
	const versions = fs
		.readdirSync(buildToolsDir)
		.filter((name) => versionRank(name) >= 0)
		.sort((a, b) => versionRank(b) - versionRank(a));
	for (const version of versions) {
		const dir = path.join(buildToolsDir, version);
		const apksigner = path.join(dir, process.platform === "win32" ? "apksigner.bat" : "apksigner");
		const zipalign = path.join(dir, process.platform === "win32" ? "zipalign.exe" : "zipalign");
		if (fs.existsSync(apksigner) && fs.existsSync(zipalign)) {
			return { sdkRoot, dir, version, apksigner, zipalign };
		}
	}
	return null;
}

function toDosDateTime(epochSeconds) {
	// DOS 时间无时区概念，统一按 UTC 计算以保证确定性。
	let date = new Date(Math.max(epochSeconds, 315_532_800) * 1000); // 1980-01-01 下限
	if (Number.isNaN(date.getTime())) date = new Date(315_532_800 * 1000);
	const year = date.getUTCFullYear();
	const dosTime = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1);
	const dosDate = ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
	return { dosTime, dosDate };
}

/** 定位 EOCD（中央目录结束记录）偏移，供归一化与测试使用。 */
export function findEocdOffset(buffer) {
	return findEocd(buffer);
}

function findEocd(buffer) {
	const minimum = Math.max(0, buffer.length - MAX_COMMENT - 22);
	for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
		if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
	}
	return -1;
}

/**
 * 原地把所有 ZIP 条目的修改时间改写为固定值。
 * 不改变任何条目长度或偏移，因此不会破坏 zipalign 之外的布局。
 * 返回被改写的条目数。
 */
export function normalizeZipTimestamps(filePath, epochSeconds) {
	const buffer = fs.readFileSync(filePath);
	const eocd = findEocd(buffer);
	if (eocd < 0) throw new Error(`${path.basename(filePath)} 不是合法的 ZIP/APK（未找到 EOCD）`);

	const entryCount = buffer.readUInt16LE(eocd + 10);
	const centralOffset = buffer.readUInt32LE(eocd + 16);

	// ZIP64 情况下偏移字段为 0xFFFFFFFF，需要走 ZIP64 EOCD；APK 极少出现，明确报错而不是静默出错。
	if (entryCount === 0xffff || centralOffset === 0xffffffff) {
		const locatorOffset = eocd - 20;
		if (locatorOffset >= 0 && buffer.readUInt32LE(locatorOffset) === ZIP64_EOCD_LOCATOR) {
			throw new Error("暂不支持 ZIP64 归档的时间戳归一化");
		}
	}

	const { dosTime, dosDate } = toDosDateTime(epochSeconds);
	let cursor = centralOffset;
	let rewritten = 0;

	for (let index = 0; index < entryCount; index += 1) {
		if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
			throw new Error(`中央目录第 ${index} 项损坏，归档可能不是标准 ZIP`);
		}
		const nameLength = buffer.readUInt16LE(cursor + 28);
		const extraLength = buffer.readUInt16LE(cursor + 30);
		const commentLength = buffer.readUInt16LE(cursor + 32);
		const localOffset = buffer.readUInt32LE(cursor + 42);

		buffer.writeUInt16LE(dosTime, cursor + 12);
		buffer.writeUInt16LE(dosDate, cursor + 14);

		if (localOffset + 14 <= buffer.length && buffer.readUInt32LE(localOffset) === LOCAL_SIGNATURE) {
			buffer.writeUInt16LE(dosTime, localOffset + 10);
			buffer.writeUInt16LE(dosDate, localOffset + 12);
		}
		rewritten += 1;
		cursor += 46 + nameLength + extraLength + commentLength;
	}

	fs.writeFileSync(filePath, buffer);
	return rewritten;
}

/** 列出 ZIP 归档中的条目名（不依赖任何外部工具，也不受 JVM 语言环境影响）。 */
export function listZipEntries(filePath) {
	const buffer = fs.readFileSync(filePath);
	const eocd = findEocd(buffer);
	if (eocd < 0) throw new Error(`${path.basename(filePath)} 不是合法的 ZIP/APK（未找到 EOCD）`);
	const entryCount = buffer.readUInt16LE(eocd + 10);
	let cursor = buffer.readUInt32LE(eocd + 16);
	const entries = [];
	for (let index = 0; index < entryCount; index += 1) {
		if (buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) break;
		const nameLength = buffer.readUInt16LE(cursor + 28);
		const extraLength = buffer.readUInt16LE(cursor + 30);
		const commentLength = buffer.readUInt16LE(cursor + 32);
		entries.push({
			name: buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength),
			size: buffer.readUInt32LE(cursor + 24),
		});
		cursor += 46 + nameLength + extraLength + commentLength;
	}
	return entries;
}

/**
 * 校验 JAR/AAB 的 v1 签名。
 *
 * 两个坑：
 *   1. `jarsigner -verify` 对"完全没有签名条目"的 zip 也返回退出码 0，
 *      所以必须先读中央目录确认存在 META-INF/*.SF，不能只看退出码。
 *   2. jarsigner 的输出是本地化的（中文 JDK 打印「jar 已验证」），
 *      因此显式强制 JVM 语言为英文再做文本匹配。
 */
export function verifyJarSignature(filePath) {
	let signatureEntries;
	try {
		signatureEntries = listZipEntries(filePath).filter((entry) =>
			/^META-INF\/[^/]+\.(SF|RSA|DSA|EC)$/i.test(entry.name),
		);
	} catch (error) {
		return { signed: null, scheme: "v1", detail: error.message };
	}
	if (signatureEntries.length === 0) {
		return { signed: false, scheme: "v1", detail: "归档内没有 META-INF 签名条目" };
	}
	const output = tryRun(
		"jarsigner",
		["-verify", "-J-Duser.language=en", "-J-Duser.country=US", filePath],
		{ allowStderr: true },
	);
	if (!output) {
		return { signed: false, scheme: "v1", detail: "jarsigner 校验未通过", signatureFiles: signatureEntries.map((e) => e.name) };
	}
	return {
		signed: /jar verified/i.test(output),
		scheme: "v1",
		signatureFiles: signatureEntries.map((entry) => entry.name),
	};
}

/** 读取 APK 的签名证书 SHA-256（十六进制，小写），未签名返回 null。 */
export function readApkCertificateSha256(apkPath, buildTools = findBuildTools()) {
	if (!buildTools) throw new AndroidToolchainMissingError("未找到 Android build-tools（需要 apksigner）");
	const output = tryRun(buildTools.apksigner, ["verify", "--print-certs", apkPath], { allowStderr: true });
	if (!output) return null;
	const match = output.match(/certificate SHA-256 digest:\s*([0-9a-fA-F]+)/);
	return match ? match[1].toLowerCase() : null;
}

export function verifyApk(apkPath, buildTools = findBuildTools()) {
	if (!buildTools) throw new AndroidToolchainMissingError("未找到 Android build-tools（需要 apksigner）");
	const output = tryRun(
		buildTools.apksigner,
		["verify", "--verbose", "--print-certs", apkPath],
		{ allowStderr: true },
	);
	if (!output) return { verified: false, schemes: [], certificateSha256: null, raw: "" };
	return {
		verified: /Verified using v\d scheme[^:]*: true/.test(output) || /^\s*Verified:?\s*true/m.test(output),
		schemes: [...output.matchAll(/Verified using (v\d) scheme[^:]*: (true|false)/g)]
			.filter((match) => match[2] === "true")
			.map((match) => match[1]),
		certificateSha256: output.match(/certificate SHA-256 digest:\s*([0-9a-fA-F]+)/)?.[1]?.toLowerCase() ?? null,
		raw: output,
	};
}

/**
 * 把已签名的 APK 归一化为"确定性产物"：重写时间戳 -> 重新对齐 -> 用同一 keystore 重签名。
 * 若未提供 keystore 密码则跳过（此时只能保证 gradle 侧设置生效）。
 */
export function normalizeAndResignApk(apkPath, { epochSeconds, signing, align = 4 }) {
	const buildTools = findBuildTools();
	if (!buildTools) {
		throw new AndroidToolchainMissingError(
			"未找到 Android SDK build-tools。请设置 ANDROID_HOME，或安装 build-tools 后重试。",
		);
	}
	if (!signing?.keystorePath || !fs.existsSync(signing.keystorePath)) {
		log.warn(`未找到 keystore，跳过 ${path.basename(apkPath)} 的归一化重签名`);
		return { normalized: false, reason: "missing-keystore" };
	}

	const before = fs.statSync(apkPath).size;
	const entries = normalizeZipTimestamps(apkPath, epochSeconds);

	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "apk-repro-"));
	const alignedPath = path.join(tempDir, path.basename(apkPath));
	try {
		capture(buildTools.zipalign, ["-f", "-p", String(align), apkPath, alignedPath]);

		const args = [
			"sign",
			"--ks",
			signing.keystorePath,
			"--ks-pass",
			`pass:${signing.storePassword}`,
			"--ks-key-alias",
			signing.keyAlias,
			"--key-pass",
			`pass:${signing.keyPassword}`,
			"--v1-signing-enabled",
			"true",
			"--v2-signing-enabled",
			"true",
			"--v3-signing-enabled",
			"true",
			// v4 会额外产出 .idsig 旁路文件，对产物一致性没有帮助，反而多一份需要管理的产物
			"--v4-signing-enabled",
			"false",
			"--out",
			apkPath,
			alignedPath,
		];
		capture(buildTools.apksigner, args);

		const verification = verifyApk(apkPath, buildTools);
		if (!verification.verified) {
			throw new Error(`${path.basename(apkPath)} 重签名后校验失败`);
		}
		return {
			normalized: true,
			entries,
			sizeBefore: before,
			sizeAfter: fs.statSync(apkPath).size,
			certificateSha256: verification.certificateSha256,
			schemes: verification.schemes,
			buildToolsVersion: buildTools.version,
		};
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
}
