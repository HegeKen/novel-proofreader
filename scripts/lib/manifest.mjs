/**
 * 产物清单（release manifest）与可复现性校验。
 *
 * 核心契约：
 *   同一份 signing.config.json（configKey）+ 同一套签名 key（identityKey）+ 同一工具链（toolchain.key）
 *   =>  每个产物的 sha256 必须完全一致。
 *
 * 校验器会把"配置变了"、"key 变了"、"工具链变了"与"真正的产物漂移"区分开，
 * 避免把合理的差异误报成不可复现。
 */

import fs from "node:fs";
import path from "node:path";
import { sha256, sha256File, canonicalJson, tryRun } from "./core.mjs";
import { findBuildTools, verifyApk, verifyJarSignature } from "./apk.mjs";

export const MANIFEST_VERSION = 1;

const ARTIFACT_EXTENSIONS = new Set([
	".apk",
	".aab",
	".dmg",
	".deb",
	".rpm",
	".appimage",
	".msi",
	".exe",
	".app",
	".tar.gz",
	".zip",
	".sig",
]);

export function isArtifactLike(name) {
	const lower = name.toLowerCase();
	if (lower.endsWith(".tar.gz")) return true;
	return ARTIFACT_EXTENSIONS.has(path.extname(lower));
}

/** 递归收集产物文件（跳过目录型 .app 的内部文件，整体作为一个产物）。 */
export function collectArtifacts(roots, { includeSignatures = true } = {}) {
	const found = [];
	const seen = new Set();

	const walk = (target) => {
		if (!fs.existsSync(target)) return;
		const stat = fs.statSync(target);
		if (stat.isDirectory()) {
			const base = path.basename(target);
			if (base.endsWith(".app")) {
				if (!seen.has(target)) {
					seen.add(target);
					found.push(target);
				}
				return;
			}
			for (const entry of fs.readdirSync(target).sort()) walk(path.join(target, entry));
			return;
		}
		if (!isArtifactLike(path.basename(target))) return;
		if (!includeSignatures && target.endsWith(".sig")) return;
		if (seen.has(target)) return;
		seen.add(target);
		found.push(target);
	};

	for (const root of roots) walk(root);
	return found.sort();
}

/** 目录型产物（.app）：按"排序后的相对路径 + 文件哈希"聚合，避免 FS 顺序影响结果。 */
export function hashDirectory(dirPath) {
	const entries = [];
	let totalSize = 0;
	const walk = (current) => {
		for (const name of fs.readdirSync(current).sort()) {
			const full = path.join(current, name);
			const stat = fs.lstatSync(full);
			const relative = path.relative(dirPath, full).split(path.sep).join("/");
			if (stat.isSymbolicLink()) {
				entries.push(`${relative}\0link\0${fs.readlinkSync(full)}`);
				continue;
			}
			if (stat.isDirectory()) {
				walk(full);
				continue;
			}
			totalSize += stat.size;
			entries.push(`${relative}\0file\0${sha256File(full)}`);
		}
	};
	walk(dirPath);
	return { sha256: sha256(entries.join("\n")), size: totalSize, fileCount: entries.length };
}

export function hashArtifact(artifactPath) {
	if (fs.statSync(artifactPath).isDirectory()) {
		const { sha256: digest, size, fileCount } = hashDirectory(artifactPath);
		return { sha256: digest, size, fileCount, kind: "directory" };
	}
	return { sha256: sha256File(artifactPath), size: fs.statSync(artifactPath).size, kind: "file" };
}

function detectPlatform(artifactPath, explicitTarget) {
	const normalized = artifactPath.split(path.sep).join("/").toLowerCase();
	const extension = path.extname(normalized);
	if (extension === ".apk" || extension === ".aab" || normalized.includes("gen/android")) {
		return { platform: "android", target: explicitTarget ?? "android" };
	}
	if (extension === ".dmg" || extension === ".app" || normalized.includes("apple-darwin")) {
		return { platform: "macos", target: explicitTarget ?? "darwin" };
	}
	if (extension === ".msi" || extension === ".exe" || normalized.includes("windows")) {
		return { platform: "windows", target: explicitTarget ?? "windows" };
	}
	if (extension === ".deb" || extension === ".rpm" || extension === ".appimage" || normalized.includes("linux")) {
		return { platform: "linux", target: explicitTarget ?? "linux" };
	}
	return { platform: "unknown", target: explicitTarget ?? "unknown" };
}

/** 探测产物签名状态（按平台用官方工具校验，而非猜测）。 */
export function detectSignature(artifactPath) {
	const name = path.basename(artifactPath);
	const lower = name.toLowerCase();
	const sigPath = `${artifactPath}.sig`;
	const signatureFile = fs.existsSync(sigPath) ? path.relative(process.cwd(), sigPath) : null;

	if (lower.endsWith(".apk")) {
		try {
			const buildTools = findBuildTools();
			if (!buildTools) return { signed: null, kind: "apk", detail: "未找到 build-tools，无法校验" };
			const result = verifyApk(artifactPath, buildTools);
			return {
				signed: result.verified,
				kind: "apk",
				schemes: result.schemes,
				certificateSha256: result.certificateSha256,
				updaterSignature: signatureFile,
			};
		} catch (error) {
			return { signed: null, kind: "apk", detail: error.message };
		}
	}

	if (lower.endsWith(".aab")) {
		// AAB 由 Gradle 用同一 keystore 做 v1(JAR) 签名
		const result = verifyJarSignature(artifactPath);
		return {
			signed: result.signed,
			kind: "aab",
			...(result.detail ? { detail: result.detail } : {}),
			...(result.signatureFiles ? { signatureFiles: result.signatureFiles } : {}),
			updaterSignature: signatureFile,
		};
	}

	if (process.platform === "darwin" && (lower.endsWith(".app") || lower.endsWith(".dmg"))) {
		const info = tryRun("codesign", ["-dv", "--verbose=4", artifactPath], { allowStderr: true });
		if (!info) return { signed: false, kind: "codesign", detail: "没有签名", updaterSignature: signatureFile };
		const authority = info.match(/Authority=([^\n]+)/)?.[1]?.trim() ?? null;
		const teamIdentifier = info.match(/TeamIdentifier=([^\n]+)/)?.[1]?.trim() ?? null;
		const signatureKind = info.match(/Signature=([^\n]+)/)?.[1]?.trim() ?? null;
		// Tauri 在未配置证书时会做 ad-hoc 签名（Signature=adhoc 且没有 Authority）。
		// 这种产物本机能跑，但过不了 Gatekeeper，绝不能被当作"已签名"发布。
		const adhoc = /adhoc/i.test(signatureKind ?? "") || !authority;
		const notarized = lower.endsWith(".app")
			? Boolean(tryRun("spctl", ["-a", "-vv", artifactPath], { allowStderr: true })?.includes("accepted"))
			: null;
		return {
			signed: !adhoc,
			kind: "codesign",
			...(adhoc ? { detail: "ad-hoc 签名（未使用 Developer ID 证书），无法通过 Gatekeeper" } : {}),
			authority,
			teamIdentifier,
			notarized,
			updaterSignature: signatureFile,
		};
	}

	if (process.platform === "win32" && (lower.endsWith(".exe") || lower.endsWith(".msi"))) {
		const output = tryRun("signtool", ["verify", "/pa", "/v", artifactPath], { allowStderr: true });
		return {
			signed: output ? /Successfully verified/i.test(output) : false,
			kind: "authenticode",
			updaterSignature: signatureFile,
		};
	}

	if (signatureFile) {
		return { signed: true, kind: "tauri-updater-minisign", updaterSignature: signatureFile };
	}
	return { signed: null, kind: "none", updaterSignature: null };
}

/** 汇总签名身份（不含任何私钥），它就是"配置一致的 key"里的 key。 */
export function collectSigningIdentity(config, { androidCertSha256 = null } = {}) {
	const android = config.android?.enabled === false
		? { enabled: false }
		: {
				enabled: true,
				keyAlias: config.android.keyAlias,
				keystoreType: config.android.keystoreType,
				certificateSha256: androidCertSha256,
				signatureScheme: config.android.signatureScheme ?? "v1+v2+v3",
			};
	const macos = config.macos?.enabled === false
		? { enabled: false }
		: {
				enabled: true,
				signingIdentityEnv: config.macos.signingIdentityEnv,
				hardenedRuntime: config.macos.hardenedRuntime !== false,
				notarize: Boolean(config.macos.notarize),
			};
	const windows = config.windows?.enabled === false
		? { enabled: false }
		: { enabled: true, mode: config.windows.mode, digestAlgorithm: config.windows.digestAlgorithm };
	const updater = config.updater?.enabled === false
		? { enabled: false }
		: {
				enabled: true,
				keyId: config.updater.keyId,
				publicKeySha256: config.updater.publicKey ? sha256(config.updater.publicKey) : null,
			};
	return { android, macos, windows, updater };
}

export function computeIdentityKey(config, signingIdentity) {
	return `sha256:${sha256(canonicalJson({ configKey: config.configKey, signingIdentity }))}`;
}

export function buildManifest({
	config,
	artifactPaths,
	toolchain,
	git,
	signingIdentity,
	sourceDateEpoch,
	extra = {},
}) {
	const artifacts = artifactPaths.map((artifactPath) => {
		const { sha256: digest, size, fileCount, kind } = hashArtifact(artifactPath);
		const { platform, target } = detectPlatform(artifactPath, extra.target);
		return {
			name: path.basename(artifactPath),
			path: artifactPath.split(path.sep).join("/"),
			platform,
			target,
			kind,
			size,
			...(fileCount === undefined ? {} : { fileCount }),
			sha256: digest,
			signature: detectSignature(artifactPath),
		};
	});

	return {
		manifestVersion: MANIFEST_VERSION,
		generatedAt: new Date().toISOString(),
		sourceDateEpoch,
		configKey: config.configKey,
		identityKey: computeIdentityKey(config, signingIdentity),
		source: {
			commit: git?.commit ?? null,
			dirty: git?.dirty ?? null,
			tags: git?.tags ?? [],
		},
		toolchain,
		signing: signingIdentity,
		artifacts,
	};
}

/** 只保留与"产物是否一致"相关的字段，便于跨机器比较。 */
export function comparableProjection(manifest) {
	return {
		configKey: manifest.configKey,
		identityKey: manifest.identityKey,
		toolchainKey: manifest.toolchain?.key ?? null,
		artifacts: [...(manifest.artifacts ?? [])]
			.map((artifact) => ({ name: artifact.name, sha256: artifact.sha256 }))
			.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
	};
}

/**
 * 比较两份清单。
 * 返回 { reproducible, verdict, reasons, differences }，verdict 取值：
 *   reproducible        —— 全部一致，契约成立
 *   config-changed      —— 配置不同，比较无意义
 *   key-changed         —— 签名 key 不同（这是"配置一致的 key"被破坏的真正原因）
 *   toolchain-changed   —— 工具链不同
 *   artifact-drift      —— 输入完全相同但产物字节不同（真正的不可复现）
 */
export function compareManifests(expected, actual) {
	const reasons = [];
	const differences = [];

	if (expected.configKey !== actual.configKey) {
		reasons.push(`配置指纹不同: 期望 ${expected.configKey}，实际 ${actual.configKey}`);
	}
	if (expected.identityKey !== actual.identityKey) {
		reasons.push(`签名 key 指纹不同: 期望 ${expected.identityKey}，实际 ${actual.identityKey}`);
	}
	const expectedToolchain = expected.toolchain?.key ?? null;
	const actualToolchain = actual.toolchain?.key ?? null;
	if (expectedToolchain !== actualToolchain) {
		reasons.push(`工具链不同: 期望 ${expectedToolchain}，实际 ${actualToolchain}`);
	}

	const expectedMap = new Map((expected.artifacts ?? []).map((artifact) => [artifact.name, artifact]));
	const actualMap = new Map((actual.artifacts ?? []).map((artifact) => [artifact.name, artifact]));

	for (const [name, artifact] of expectedMap) {
		const counterpart = actualMap.get(name);
		if (!counterpart) {
			differences.push({ name, type: "missing", expected: artifact.sha256, actual: null });
			continue;
		}
		if (counterpart.sha256 !== artifact.sha256) {
			differences.push({
				name,
				type: "content",
				expected: artifact.sha256,
				actual: counterpart.sha256,
				sizeExpected: artifact.size,
				sizeActual: counterpart.size,
			});
		}
	}
	for (const name of actualMap.keys()) {
		if (!expectedMap.has(name)) differences.push({ name, type: "unexpected", expected: null, actual: actualMap.get(name).sha256 });
	}

	const sameInputs = reasons.length === 0;
	let verdict;
	if (!sameInputs && expected.configKey !== actual.configKey) verdict = "config-changed";
	else if (expected.identityKey !== actual.identityKey) verdict = "key-changed";
	else if (expectedToolchain !== actualToolchain) verdict = "toolchain-changed";
	else if (differences.length > 0) verdict = "artifact-drift";
	else verdict = "reproducible";

	return { reproducible: verdict === "reproducible", verdict, reasons, differences };
}

export function formatComparison(report, { expectedLabel = "基准", actualLabel = "本次" } = {}) {
	const lines = [];
	const icon = report.reproducible ? "✓" : "✗";
	lines.push(`${icon} 结论: ${VERDICT_LABELS[report.verdict] ?? report.verdict}`);
	if (report.reasons.length > 0) {
		lines.push("");
		lines.push(`  ${expectedLabel} 与 ${actualLabel} 的输入不同（这本身就解释了产物差异）:`);
		for (const reason of report.reasons) lines.push(`    - ${reason}`);
	}
	if (report.differences.length > 0) {
		lines.push("");
		lines.push("  产物差异:");
		for (const difference of report.differences) {
			if (difference.type === "content") {
				lines.push(`    - ${difference.name}: ${difference.expected.slice(0, 16)}… != ${difference.actual.slice(0, 16)}…`);
			} else if (difference.type === "missing") {
				lines.push(`    - ${difference.name}: 本次缺失`);
			} else {
				lines.push(`    - ${difference.name}: 本次多出`);
			}
		}
	}
	if (report.reproducible) {
		lines.push("");
		lines.push("  同一份配置 + 同一套 key + 同一工具链，全部产物字节一致。");
	}
	return lines.join("\n");
}

export const VERDICT_LABELS = {
	reproducible: "可复现（产物字节一致）",
	"config-changed": "配置指纹不同，需先对齐 signing.config.json",
	"key-changed": "签名 key 不同，同一配置下产物必然不同",
	"toolchain-changed": "工具链版本不同（Rust/Node/pnpm/JDK）",
	"artifact-drift": "输入完全一致但产物字节不同，存在不可复现因素",
};
