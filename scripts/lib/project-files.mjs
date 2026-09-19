/**
 * 项目文件改造：让 Android Gradle 使用配置中的 keystore 签名，并开启可复现归档。
 *
 * 设计约束：
 *   - CI 里 `tauri android init` 可能重生成 gen/android，因此补丁必须**可重复施加**；
 *   - 补丁用显式标记块包裹，重复施加只会替换块内容，不会累积；
 *   - 补丁追加在 app/build.gradle.kts 末尾，避免依赖文件内部结构（顺序安全）。
 */

import fs from "node:fs";
import path from "node:path";
import { PROJECT_ROOT, log, readJson, relativeToRoot, resolveFromRoot, writeJson } from "./core.mjs";

export const GRADLE_BEGIN = "// >>> dsh-signing:begin (由 pnpm run setup:signing 生成，请勿手工修改)";
export const GRADLE_END = "// <<< dsh-signing:end";

export function androidAppGradlePath() {
	return path.join(PROJECT_ROOT, "src-tauri", "gen", "android", "app", "build.gradle.kts");
}

export function androidGitignorePath() {
	return path.join(PROJECT_ROOT, "src-tauri", "gen", "android", ".gitignore");
}

export function tauriConfPath() {
	return path.join(PROJECT_ROOT, "src-tauri", "tauri.conf.json");
}

/**
 * signing.config.json 里的路径一律相对**项目根**（与 android.keystorePath 等保持一致），
 * 但 tauri.conf.json 的 bundle 路径是相对 **src-tauri/** 解析的：
 *   - tauri-cli 在打包前会 `set_current_dir(dirs.tauri)`（bundle.rs / build.rs）；
 *   - CLI 把 config 里的字符串原样转成 PathBuf，不做重基（interface/rust.rs）；
 *   - tauri-bundler 直接把该路径交给 codesign（bundle/macos/sign.rs）。
 * 因此这里统一做一次基准转换，避免写错基准 —— 写错时在无证书环境会被完全忽略，
 * 在有证书的 CI 里才会在打包末期以 codesign 报错的形式暴露，排查成本很高。
 */
export function toTauriBundlePath(projectRelativePath) {
	const tauriDir = path.join(PROJECT_ROOT, "src-tauri");
	const absolute = path.resolve(PROJECT_ROOT, projectRelativePath);
	return path.relative(tauriDir, absolute).split(path.sep).join("/");
}

/** 生成 Gradle 补丁片段（Kotlin DSL）。 */
export function buildGradlePatch(config) {
	const propertiesFileName = path.basename(config.android.keystorePropertiesPath);
	const v1 = config.android.signatureScheme?.includes("v1") === false ? "false" : "true";
	const v2 = config.android.signatureScheme?.includes("v2") === false ? "false" : "true";
	const v3 = config.android.signatureScheme?.includes("v3") === false ? "false" : "true";

	// 说明：刻意不使用 java.util.Properties —— 在 Gradle Kotlin DSL 里 `java` 会被
	// Gradle 的 java 扩展（JavaPluginExtension）遮蔽，`java.util.Properties()` 无法编译。
	// 这里手写一个最小 properties 解析，零依赖且不受遮蔽影响。
	return `${GRADLE_BEGIN}
val dshKeystorePropertiesFile = rootProject.file(${JSON.stringify(propertiesFileName)})
val dshKeystoreProps = mutableMapOf<String, String>()
if (dshKeystorePropertiesFile.exists()) {
    dshKeystorePropertiesFile.readLines().forEach { line ->
        val trimmed = line.trim()
        if (trimmed.isNotEmpty() && !trimmed.startsWith("#")) {
            val separator = trimmed.indexOf('=')
            if (separator > 0) {
                dshKeystoreProps[trimmed.substring(0, separator).trim()] =
                    trimmed.substring(separator + 1).trim()
            }
        }
    }
}

if (!dshKeystorePropertiesFile.exists()) {
    logger.warn("[dsh-signing] keystore.properties 不存在，release 产物不会被签名。请运行: pnpm run setup:signing")
}

android {
    signingConfigs {
        if (dshKeystorePropertiesFile.exists()) {
            create("release") {
                val dshStoreFile = dshKeystoreProps["storeFile"]
                storeFile = if (dshStoreFile != null) rootProject.file(dshStoreFile) else null
                // storeType 必须与文件真实格式一致（Android Studio 旧版产出 JKS，新版 PKCS12）
                val dshStoreType = dshKeystoreProps["storeType"]
                if (dshStoreType != null) storeType = dshStoreType
                storePassword = dshKeystoreProps["storePassword"]
                keyAlias = dshKeystoreProps["keyAlias"]
                keyPassword = dshKeystoreProps["keyPassword"]
                // 固定签名方案，保证同一 key 下签名结果稳定
                enableV1Signing = ${v1}
                enableV2Signing = ${v2}
                enableV3Signing = ${v3}
                enableV4Signing = false
            }
        }
    }
    buildTypes {
        getByName("release") {
            if (dshKeystorePropertiesFile.exists()) {
                signingConfig = signingConfigs.findByName("release")
            }
        }
    }
    // 依赖元数据块含构建期生成的哈希，是 APK/AAB 不可复现的主要来源之一
    dependenciesInfo {
        includeInApk = false
        includeInBundle = false
    }
}

// 归档任务可复现：不写入构建时间戳、条目顺序稳定
tasks.withType<org.gradle.api.tasks.bundling.AbstractArchiveTask>().configureEach {
    isPreserveFileTimestamps = false
    isReproducibleFileOrder = true
}
${GRADLE_END}
`;
}

export function isGradlePatched() {
	const filePath = androidAppGradlePath();
	if (!fs.existsSync(filePath)) return false;
	return fs.readFileSync(filePath, "utf8").includes(GRADLE_BEGIN);
}

/**
 * 把补丁块幂等地并入 build.gradle.kts 文本。
 * 已存在标记块则替换，否则追加到文件末尾（追加保证不依赖文件内部结构）。
 */
export function mergeGradlePatch(original, patch) {
	const beginIndex = original.indexOf(GRADLE_BEGIN);
	if (beginIndex >= 0) {
		const endIndex = original.indexOf(GRADLE_END);
		if (endIndex < 0) throw new Error("build.gradle.kts 中的签名标记块不完整，请手动清理后重试");
		return `${original.slice(0, beginIndex)}${patch}${original.slice(endIndex + GRADLE_END.length + 1)}`;
	}
	const separator = original.endsWith("\n") ? "\n" : "\n\n";
	return `${original}${separator}${patch}`;
}

/** 幂等施加补丁：已存在则替换标记块，否则追加。返回 { changed, created }。 */
export function applyGradlePatch(config, { dryRun = false } = {}) {
	const filePath = androidAppGradlePath();
	if (!fs.existsSync(filePath)) {
		throw new Error(
			`未找到 ${relativeToRoot(filePath)}。请先运行 \`pnpm tauri android init\` 生成 Android 工程。`,
		);
	}
	const original = fs.readFileSync(filePath, "utf8");
	const next = mergeGradlePatch(original, buildGradlePatch(config));

	if (next === original) return { changed: false };
	if (!dryRun) fs.writeFileSync(filePath, next, "utf8");
	return { changed: true };
}

/** 让 keystore 与属性文件永远不进版本库。 */
export function ensureAndroidGitignore() {
	const filePath = androidGitignorePath();
	const required = ["keystore.properties", "keystore.jks", "*.jks", "*.keystore", "!debug.keystore"];
	if (!fs.existsSync(filePath)) return { changed: false };
	const original = fs.readFileSync(filePath, "utf8");
	const lines = original.split(/\r?\n/);
	const missing = required.filter((entry) => !lines.includes(entry));
	if (missing.length === 0) return { changed: false };
	const next = `${original.replace(/\s*$/, "")}\n\n# 签名材料（由 pnpm run setup:signing 生成）\n${missing.join("\n")}\n`;
	fs.writeFileSync(filePath, next, "utf8");
	return { changed: true, added: missing };
}

/**
 * 把可复现/签名相关设置写入 tauri.conf.json。
 * 注意：刻意**不**写 bundle.createUpdaterArtifacts —— 它会让缺少私钥的构建直接失败，
 * 改由 scripts/build-release.mjs 在私钥存在时通过 --config 覆盖注入。
 */
export function applyTauriConfigPatch(config, { dryRun = false } = {}) {
	const filePath = tauriConfPath();
	const tauriConfig = readJson(filePath);
	const next = structuredClone(tauriConfig);

	next.productName = config.app.productName;
	next.version = config.app.version;
	next.identifier = config.app.identifier;
	next.bundle = next.bundle ?? {};

	const { macos, windows } = config;
	if (macos?.enabled !== false) {
		const entitlementsPath = macos.entitlements ? resolveFromRoot(macos.entitlements) : null;
		next.bundle.macOS = {
			...next.bundle.macOS,
			...(macos.minimumSystemVersion ? { minimumSystemVersion: macos.minimumSystemVersion } : {}),
			hardenedRuntime: macos.hardenedRuntime !== false,
			...(entitlementsPath && fs.existsSync(entitlementsPath)
				? { entitlements: toTauriBundlePath(macos.entitlements) }
				: {}),
		};
		if (!entitlementsPath || !fs.existsSync(entitlementsPath)) {
			delete next.bundle.macOS.entitlements;
		}
	}
	if (windows?.enabled !== false && windows.mode !== "none") {
		next.bundle.windows = {
			...next.bundle.windows,
			digestAlgorithm: windows.digestAlgorithm ?? "sha256",
			...(windows.timestampUrl ? { timestampUrl: windows.timestampUrl } : {}),
			...(windows.tsp === true ? { tsp: true } : {}),
		};
		// 本地构建可直接使用已导入证书的指纹；CI 的指纹由 composite action 导入 pfx 后
		// 通过 --config 覆盖注入（见 buildTauriBuildOverrides），不写进版本库。
		if (windows.certificateThumbprint) {
			next.bundle.windows.certificateThumbprint = windows.certificateThumbprint;
		} else {
			delete next.bundle.windows.certificateThumbprint;
		}
	}

	if (config.updater?.enabled !== false && config.updater?.publicKey) {
		next.plugins = next.plugins ?? {};
		next.plugins.updater = {
			...next.plugins.updater,
			pubkey: config.updater.publicKey,
			...(config.updater.endpoints?.length ? { endpoints: config.updater.endpoints } : {}),
		};
	} else if (next.plugins?.updater) {
		// 配置里没有公钥时不要留下过期的公钥，否则客户端会拿错误的 key 校验更新包
		delete next.plugins.updater;
		if (Object.keys(next.plugins).length === 0) delete next.plugins;
	}

	const changed = JSON.stringify(tauriConfig) !== JSON.stringify(next);
	if (changed && !dryRun) writeJson(filePath, next);
	return { changed };
}

/**
 * 计算构建时必须通过 `tauri build --config` 注入的覆盖项。
 *
 * 为什么不把这些直接写进 tauri.conf.json：
 *   - `createUpdaterArtifacts` 一旦写死，任何缺少 updater 私钥的构建都会直接失败；
 *   - Windows 的 `certificateThumbprint` 只有在 CI 导入 pfx 之后才知道；
 *   - `signCommand` 依赖具体的签名服务（如 Azure Trusted Signing）是否可用。
 *
 * 注意：tauri-bundler 判定「是否签名 Windows 产物」只看
 * `sign_command.is_some() || certificate_thumbprint.is_some()`（见 settings.rs 的 can_sign），
 * 它**不读取** WINDOWS_CERTIFICATE 之类的环境变量，所以必须显式注入其中之一。
 */
export function buildTauriBuildOverrides(config, { env = process.env, updaterKeyAvailable = false } = {}) {
	const bundle = {};
	if (updaterKeyAvailable) bundle.createUpdaterArtifacts = true;

	const windows = config.windows ?? {};
	if (windows.enabled !== false && windows.mode !== "none") {
		const thumbprint = env.DSH_WINDOWS_CERT_THUMBPRINT || windows.certificateThumbprint;
		if (windows.mode === "pfx" && thumbprint) {
			bundle.windows = { ...(bundle.windows ?? {}), certificateThumbprint: thumbprint };
		}
		if (windows.mode === "azure-trusted-signing") {
			const azure = windows.azureTrustedSigning ?? {};
			// 用对象形式传参：字符串形式会被 Tauri 按空格拆分，
			// 而 endpoint / 描述里都可能含空格。
			bundle.windows = {
				...(bundle.windows ?? {}),
				signCommand: {
					cmd: "trusted-signing-cli",
					args: [
						"-e",
						azure.endpoint ?? "",
						"-a",
						azure.account ?? "",
						"-c",
						azure.certificateProfile ?? "",
						"-d",
						azure.description || config.app?.productName || "",
						"%1",
					],
				},
			};
		}
	}

	return Object.keys(bundle).length > 0 ? { bundle } : {};
}

/** 校验 Gradle 补丁是否真的生效（CI 里 android init 之后用它兜底）。 */export function assertGradlePatchApplied(config) {
	const filePath = androidAppGradlePath();
	if (!fs.existsSync(filePath)) return { ok: false, reason: "android 工程不存在" };
	const text = fs.readFileSync(filePath, "utf8");
	if (!text.includes(GRADLE_BEGIN)) return { ok: false, reason: "签名补丁缺失" };
	if (!text.includes("includeInApk = false")) return { ok: false, reason: "依赖元数据未关闭" };
	if (!text.includes("isReproducibleFileOrder = true")) return { ok: false, reason: "归档可复现设置缺失" };
	if (!text.includes(path.basename(config.android.keystorePropertiesPath))) {
		return { ok: false, reason: "keystore 属性文件名与配置不一致" };
	}
	return { ok: true };
}

export function describeProjectPatchPlan(config) {
	return [
		`Android Gradle 签名补丁  -> ${relativeToRoot(androidAppGradlePath())}`,
		`Android 忽略签名材料      -> ${relativeToRoot(androidGitignorePath())}`,
		`Tauri 打包/签名配置       -> ${relativeToRoot(tauriConfPath())}`,
		`keystore 属性文件         -> ${relativeToRoot(path.join(PROJECT_ROOT, config.android.keystorePropertiesPath))}`,
	];
}

export function logPatchResults(results) {
	for (const [label, changed] of results) {
		if (changed) log.ok(`${label}: 已更新`);
		else log.dim(`${label}: 无需变更`);
	}
}
