/**
 * 各平台 Secrets 的「值从哪来 → 怎么写进去」配方。
 *
 * 这是 setup-signing（生成清单）与 secrets-status（检查缺失）共用的唯一事实来源，
 * 避免文档、清单与检查命令三处各写一份而逐渐不一致。
 */

import { SECRETS } from "./platforms.mjs";

export function buildSecretEntries({ config, env = process.env, platform = process.platform } = {}) {
	// 值已知的项：安全时用 --body 直传，敏感值走隐藏输入或 dotenv，避免落进 shell 历史
	const safeWrite = (name, value) =>
		typeof value === "string" && value !== "" && !value.startsWith("<")
			? `gh secret set ${name} --body ${JSON.stringify(value)}`
			: null;
	const pipeWrite = (name, produce) => (produce ? `${produce} | gh secret set ${name}` : null);

	// base64 编码命令按平台区分（BSD / GNU / PowerShell）
	const fileToBase64 = (file) => {
		if (platform === "win32") {
			return `[Convert]::ToBase64String([IO.File]::ReadAllBytes("${file}"))`;
		}
		if (platform === "darwin") {
			return `base64 -i ${file} | tr -d '\\n'`;
		}
		return `base64 -w0 ${file}`;
	};

	const keystorePath = config.android.keystorePath;
	const keystoreProduce = fileToBase64(keystorePath);

	const entries = [
		{
			name: SECRETS.androidKeystore,
			required: true,
			purpose: "Android release 签名 keystore（base64）",
			howTo: `由向导或 Android Studio / keytool 生成的 keystore 文件：${keystorePath}`,
			produceCommand: keystoreProduce,
			writeCommand: pipeWrite(SECRETS.androidKeystore, keystoreProduce),
		},
		{
			name: SECRETS.androidKeystorePassword,
			required: true,
			purpose: "keystore 口令",
			howTo: "创建/导入 keystore 时设定；向导随机生成后存于 .signing/signing.env",
			writeCommand: `gh secret set ${SECRETS.androidKeystorePassword}`,
		},
		{
			name: SECRETS.androidKeyAlias,
			required: true,
			purpose: "私钥条目别名（不是机密）",
			howTo: "signing.config.json 的 android.keyAlias；也可用 keytool -list -keystore <keystore> 查看（JKS 别名会被转小写）",
			produceCommand: `keytool -list -keystore ${keystorePath} -J-Duser.language=en`,
			writeCommand: safeWrite(SECRETS.androidKeyAlias, config.android.keyAlias),
		},
		{
			name: SECRETS.androidKeyPassword,
			required: true,
			purpose: "私钥口令（PKCS12 下与 keystore 口令相同）",
			howTo: "创建 keystore 时设定；JKS 允许与 keystore 口令不同",
			writeCommand: `gh secret set ${SECRETS.androidKeyPassword}`,
		},
		{
			name: SECRETS.macosCertificate,
			required: Boolean(config.macos?.enabled !== false && config.macos?.notarize),
			purpose: "Developer ID 证书 .p12 的 base64",
			howTo: "Apple Developer 导出 .p12（含私钥）后编码；详见 docs/RELEASE_SIGNING.md §4.4",
			produceCommand: fileToBase64("<导出的 cert.p12>"),
			writeCommand: pipeWrite(SECRETS.macosCertificate, fileToBase64("<导出的 cert.p12>")),
		},
		{
			name: SECRETS.macosCertificatePassword,
			// 必须与 APPLE_CERTIFICATE 成对：tauri-bundler 只在两者同时存在时才导入证书
			required: Boolean(config.macos?.enabled !== false && config.macos?.notarize),
			purpose: ".p12 导出密码（必须与 APPLE_CERTIFICATE 同时提供）",
			howTo: "在钥匙串「导出…」时设置的密码",
			writeCommand: `gh secret set ${SECRETS.macosCertificatePassword}`,
		},
		{
			name: SECRETS.macosSigningIdentity,
			required: Boolean(config.macos?.enabled !== false),
			purpose: "macOS 签名身份（形如 Developer ID Application: X (TEAMID)）",
			howTo: "运行 security find-identity -v -p codesigning，取引号内完整字符串",
			produceCommand: "security find-identity -v -p codesigning",
			writeCommand: safeWrite(SECRETS.macosSigningIdentity, env[SECRETS.macosSigningIdentity]),
		},
		{
			name: SECRETS.macosId,
			required: false,
			purpose: "Apple ID（公证路线 1，非机密）",
			howTo: "你的 Apple 账号邮箱",
			writeCommand: safeWrite(SECRETS.macosId, env[SECRETS.macosId]),
		},
		{
			name: SECRETS.macosPassword,
			required: false,
			purpose: "App 专用密码（公证路线 1）",
			howTo: "appleid.apple.com → 登录与安全 → App 专用密码 → 生成",
			writeCommand: `gh secret set ${SECRETS.macosPassword}`,
		},
		{
			name: SECRETS.macosTeamId,
			required: false,
			purpose: "Apple Team ID（公证路线 1，非机密）",
			howTo: "developer.apple.com → Membership details（也可从证书名括号里读出）",
			writeCommand: safeWrite(SECRETS.macosTeamId, env[SECRETS.macosTeamId]),
		},
		{
			name: SECRETS.macosApiKey,
			required: false,
			purpose: "App Store Connect API 的 Key ID（公证路线 2，非机密）",
			howTo: "App Store Connect → 用户和访问 → 集成 → App Store Connect API → 团队密钥",
			writeCommand: safeWrite(SECRETS.macosApiKey, env[SECRETS.macosApiKey]),
		},
		{
			name: SECRETS.macosApiIssuer,
			required: false,
			purpose: "App Store Connect Issuer ID（公证路线 2，非机密）",
			howTo: "同上页面顶部的 Issuer ID",
			writeCommand: safeWrite(SECRETS.macosApiIssuer, env[SECRETS.macosApiIssuer]),
		},
		{
			name: SECRETS.macosApiKeyP8,
			required: false,
			purpose: ".p8 私钥内容的 base64（公证路线 2）",
			howTo: "下载 AuthKey_<KEY_ID>.p8 后编码（只能下载一次；CI 会落地成文件）",
			produceCommand: fileToBase64(`AuthKey_${env[SECRETS.macosApiKey] ?? "<KEY_ID>"}.p8`),
			writeCommand: pipeWrite(
				SECRETS.macosApiKeyP8,
				fileToBase64(`AuthKey_${env[SECRETS.macosApiKey] ?? "<KEY_ID>"}.p8`),
			),
		},
		{
			name: SECRETS.updaterPrivateKey,
			required: Boolean(config.updater?.enabled !== false),
			purpose: "Tauri updater 私钥内容（对产物签名）",
			howTo: "pnpm tauri signer generate --write-keys .signing/updater.key（向导 updater 步骤亦可）",
			produceCommand: "cat .signing/updater.key",
			writeCommand: `gh secret set ${SECRETS.updaterPrivateKey} < .signing/updater.key`,
		},
		{
			name: SECRETS.updaterPrivateKeyPassword,
			required: true,
			purpose: "updater 私钥口令",
			howTo: "生成密钥对时设定；向导随机生成后存于 .signing/signing.env",
			writeCommand: `gh secret set ${SECRETS.updaterPrivateKeyPassword}`,
		},
	];

	if (config.windows?.mode === "pfx") {
		entries.push(
			{
				name: SECRETS.windowsCertificate,
				required: Boolean(config.windows?.enabled !== false),
				purpose: "Windows 代码签名证书 .pfx 的 base64",
				howTo: "向 CA 购买后导出 .pfx（含私钥与证书链）；EV 证书常因私钥在 HSM 中而无法导出",
				produceCommand: fileToBase64("<cert.pfx>"),
				writeCommand: pipeWrite(SECRETS.windowsCertificate, fileToBase64("<cert.pfx>")),
			},
			{
				name: SECRETS.windowsCertificatePassword,
				required: false,
				purpose: ".pfx 密码",
				howTo: "导出 .pfx 时设置的密码",
				writeCommand: `gh secret set ${SECRETS.windowsCertificatePassword}`,
			},
		);
	} else if (config.windows?.mode === "azure-trusted-signing") {
		const azure = config.windows?.azureTrustedSigning ?? {};
		entries.push(
			{
				name: SECRETS.azureTenantId,
				required: true,
				purpose: "Azure 租户 ID（非机密）",
				howTo: "Azure 门户 → Microsoft Entra ID → 概览 → 租户 ID",
				writeCommand: safeWrite(SECRETS.azureTenantId, env[SECRETS.azureTenantId]),
			},
			{
				name: SECRETS.azureClientId,
				required: true,
				purpose: "服务主体 Client ID（非机密）",
				howTo: "Azure 门户 → 应用注册 → 你的应用 → 应用程序(客户端) ID",
				writeCommand: safeWrite(SECRETS.azureClientId, env[SECRETS.azureClientId]),
			},
			{
				name: SECRETS.azureClientSecret,
				required: true,
				purpose: "服务主体 Client Secret",
				howTo: "应用注册 → 证书和密码 → 新建客户端密码（值只显示一次）",
				writeCommand: `gh secret set ${SECRETS.azureClientSecret}`,
			},
			{
				name: SECRETS.azureEndpoint,
				required: true,
				purpose: "Trusted Signing 终结点（非机密）",
				howTo: "Trusted Signing 资源 → 概览 → 终结点（如 https://eus.codesigning.azure.net/）",
				writeCommand: safeWrite(SECRETS.azureEndpoint, azure.endpoint || env[SECRETS.azureEndpoint]),
			},
			{
				name: SECRETS.azureAccount,
				required: true,
				purpose: "Trusted Signing 账号名（非机密）",
				howTo: "Trusted Signing 资源名",
				writeCommand: safeWrite(SECRETS.azureAccount, azure.account || env[SECRETS.azureAccount]),
			},
			{
				name: SECRETS.azureProfile,
				required: true,
				purpose: "证书配置文件名（非机密）",
				howTo: "Trusted Signing 资源 → 证书配置文件（类型选 Public Trust）",
				writeCommand: safeWrite(
					SECRETS.azureProfile,
					azure.certificateProfile || env[SECRETS.azureProfile],
				),
			},
		);
	}

	return entries;
}
