# 发布签名与可复现打包

本文档说明如何为 Proof Reader 配置**打包发布签名**，以及如何保证
「**配置一致的 key ⇒ 打包产物一致**」。

---

## 1. 快速开始

```bash
# ① 交互式配置引导（类似 Android Studio 的签名向导）
pnpm run setup:signing

# ② 自检 + 查看还缺哪些 Secret
pnpm run signing:check
pnpm run secrets:status

# ③ 写入 GitHub Secrets（向导已把能确定的值汇总成 dotenv）
gh secret set -f .signing/github-secrets.env
# 等价的兜底脚本：
bash scripts/ci/push-secrets.sh

# ④ 可复现构建
pnpm run build:release -- --target=aarch64-apple-darwin
```

引导会依次处理四件事：

| 步骤 | 产出 | 存放位置 |
| --- | --- | --- |
| ① Android keystore | `keystore.jks` + `keystore.properties` | `src-tauri/gen/android/`（gitignore） |
| ② macOS 签名 + 公证 | 环境变量凭据 | `.signing/signing.env`（gitignore） |
| ③ Windows 签名 | pfx / Azure Trusted Signing 配置 | `signing.config.json` |
| ④ Tauri updater 密钥对 | `updater.key` + 公钥回填配置 | `.signing/`（gitignore） |

非交互模式（CI / 脚本）与增量模式都已支持：

```bash
pnpm run setup:signing -- --yes                       # 全部采用推荐值
pnpm run setup:signing -- --platforms=android,updater # 只处理指定平台
pnpm run setup:signing -- --keystore=/path/app.jks    # 导入已有 keystore
pnpm run setup:signing -- --dry-run                   # 只预览，不写文件
```

> ⚠️ **keystore 与它的口令一旦丢失，你将无法再发布可覆盖安装的 Android 升级包。**
> 请把 `src-tauri/gen/android/keystore.jks` 与 `.signing/signing.env` 备份到密码管理器。

---

## 2. 配置契约：`signing.config.json`

`signing.config.json` 是打包发布配置的**唯一事实来源**，会被提交到版本库，
因为它**不含任何私钥**——只记录"用哪把 key、怎么打包"。

```jsonc
{
  "schemaVersion": 1,
  "app": { "productName": "...", "identifier": "...", "version": "0.15.0" },
  "reproducibility": {
    "sourceDateEpoch": "commit",        // 构建时间戳来源：commit | zero | 秒级数字
    "preserveFileTimestamps": false,    // 归档不写构建时间
    "reproducibleFileOrder": true,      // 归档条目顺序稳定
    "lockedDependencies": true,         // 依赖必须由 lockfile 决定
    "normalizeAndroidArchive": true     // APK 时间戳归一化 + 重签名
  },
  "android": { "keystorePath": "...", "keyAlias": "proofreader", "distinguishedName": { ... } },
  "macos":   { "hardenedRuntime": true, "notarize": true, "entitlements": "src-tauri/entitlements.plist" },
  "windows": { "mode": "pfx", "digestAlgorithm": "sha256" },
  "updater": { "publicKey": "...", "keyId": "main" },
  "configKey": "sha256:..."             // 由脚本自动回填，请勿手改
}
```

### `configKey` 是内容指纹

`configKey = sha256(规范化 JSON(除 configKey / $schema 外的全部字段))`。

- 字段顺序无关（递归按 key 排序后再序列化），所以格式化不会改变指纹。
- **改任何一个字段都会改变 `configKey`**，指纹与内容永远同步。
- `pnpm run signing:check` 会校验文件里的 `configKey` 是否与内容匹配，
  手改配置后忘记刷新会被立刻发现。

### 跨文件一致性

`signing.config.json` 中的 `productName` / `identifier` / `version` 必须与
`package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 完全一致。
自检不通过时构建会**直接终止**——否则产物的版本信息与实际配置不符，
比对结果就失去意义。

---

## 3. 「产物一致」到底保证到什么程度

一致性由三把指纹共同界定，`release-manifest-*.json` 会把它们全部记录下来：

| 指纹 | 含义 | 不一致时 |
| --- | --- | --- |
| `configKey` | 打包配置内容 | 配置变了，比对无意义 |
| `identityKey` | `configKey` + **签名 key 证书指纹** | key 变了，产物必然不同 |
| `toolchain.key` | rustc / cargo / node / pnpm / JDK 版本 | 编译器变了，产物允许不同 |

判定逻辑（`scripts/lib/manifest.mjs`）：

| verdict | 含义 |
| --- | --- |
| `reproducible` | 三项指纹一致，且所有产物 sha256 一致 ✅ |
| `config-changed` | 配置指纹不同 |
| `key-changed` | 签名 key 不同 |
| `toolchain-changed` | 工具链版本不同 |
| `artifact-drift` | **输入完全一致但产物字节不同 —— 这是真正的不可复现，必须修** |

### 各平台的实际能力

| 平台 | 产物 | 逐字节一致 | 说明 |
| --- | --- | --- | --- |
| Android | `.apk` | ✅ 是 | 时间戳归一化 + 同一 keystore 重签名；RSA PKCS#1 v1.5 是确定性签名 |
| Android | `.aab` | ⚠️ 通常 | 由 Gradle 直接签名，已关闭 `dependenciesInfo`；未做归档重写 |
| Linux | `.deb` | ✅ 通常 | ar/tar 在固定 `SOURCE_DATE_EPOCH` 下稳定 |
| Linux | `.AppImage` | ⚠️ 部分 | mksquashfs 可能写入构建时间 |
| macOS | `.app` / `.dmg` | ❌ 否 | codesign 时间戳 + dmg 的 HFS+/APFS 元数据 |
| Windows | `.msi` / `.exe` | ❌ 否 | WiX/NSIS 写入时间戳与生成 UUID |

> 对无法逐字节一致的平台，本项目**不假装一致**：清单会如实记录哈希，
> `verify:reproducible` 会报告 `artifact-drift` 并列出具体产物，
> 你至少可以确认"同一配置 + 同一工具链下产物稳定"，而不会被误报误导。

### 两个容易误判成"已签名"的坑

工具会主动识别这两种情况并判为**未签名**，避免把不合格产物发出去：

1. **Android `-unsigned` 产物**：AGP 只有在没有签名配置时才会产出
   `*-unsigned.apk` / `*-unsigned.aab`。见到即说明签名补丁没生效。
2. **macOS ad-hoc 签名**：Tauri 在未配置证书时会做 ad-hoc 签名
   （`codesign -dv` 显示 `Signature=adhoc`、无 `Authority`）。
   这种产物本机能跑，但过不了 Gatekeeper。判定要求必须存在
   `Authority=Developer ID Application: ...`。

### Android 为什么能做到逐字节一致

`scripts/lib/apk.mjs` 的管线（顺序不可调换，因为 v2/v3 签名覆盖整个文件）：

```
Gradle/AGP 产出签名 APK
  → normalizeZipTimestamps()   纯 Node 原地重写所有 ZIP 条目 DOS 时间戳
  → zipalign -p 4              重新对齐（重建归档，因此必须重签名）
  → apksigner sign             用同一 keystore 重新签名（v1+v2+v3，不写签名时间）
```

已实测：**两份时间戳完全不同的 APK，在同一 keystore + 同一 `SOURCE_DATE_EPOCH`
下归一化后 sha256 完全一致**，且过程幂等（见 `scripts/lib/apk.mjs` 顶部注释）。

Gradle 侧的确定性设置由 `scripts/lib/project-files.mjs` 以标记块注入
`src-tauri/gen/android/app/build.gradle.kts`：

- `signingConfigs.release` 绑定配置中的 keystore，并固定签名方案（v4 关闭）
- `dependenciesInfo { includeInApk = false; includeInBundle = false }` —— 关掉含构建期哈希的依赖元数据块
- 所有 `AbstractArchiveTask` 设 `isPreserveFileTimestamps = false` / `isReproducibleFileOrder = true`

由于该补丁是可重复施加的（`// >>> dsh-signing:begin` 标记块），
CI 里的 `tauri android init` 即使重生成工程也不会丢掉签名配置——
composite action 会在 `init` 之后重新贴上补丁。

### 「未签名」不会被静默放行

`*-unsigned.apk` / `*-unsigned.aab` 是 AGP 在**没有签名配置**时才会产出的形态，
因此它是"签名补丁没生效"的硬信号。以下两处都会直接失败并给出排查顺序：

- `scripts/rename-android-artifacts.mjs`（CI 中整理产物名的步骤）
- `scripts/build-release.mjs`（归一化 APK 之前）

另外，AGP 的输出路径会随版本变化（`apk/<abi>/release/` 与 `apk/release/` 都存在过），
所以产物名整理不再写死层级，而是递归查找 `release` 目录；并用 AGP 的 ABI 目录名做后缀，
避免「按 ABI 拆分」与 `universal` 两种 APK 被重命名成同一个名字而互相覆盖。

---

## 4. 每个 Secret 的值怎么拿到、怎么写入

这一节以 **Secret 名**为线索组织：`WINDOWS_CERTIFICATE`、`APPLE_CERTIFICATE` 这些值分别
**是什么、从哪拿到、用哪条命令写进去**。

`pnpm run setup:signing` 会把同样这份引导按你当前配置生成到
`.signing/github-secrets.md`，并把你已经提供的值汇总到 `.signing/github-secrets.env`。

---

### 4.0 四种写入方式

```bash
# ① 一条命令写入全部（推荐）
#    向导已把能确定的值写进 dotenv（含 keystore base64 与 updater 私钥）
gh secret set -f .signing/github-secrets.env

# ② 逐个写入，值不进 shell 历史
#    不带值的 gh secret set 会进入「隐藏输入」的交互提示
gh secret set APPLE_CERTIFICATE_PASSWORD

# ③ 管道直传（适合 base64 这类由文件生成的值）
base64 -i cert.p12 | tr -d '\n' | gh secret set APPLE_CERTIFICATE

# ④ 仓库自带的脚本（读 .signing/signing.env，逐项调用 gh；方式 ① 的兜底）
bash scripts/ci/push-secrets.sh
REPO=owner/name bash scripts/ci/push-secrets.sh   # 指定仓库
```

以上都依赖 `gh` CLI 的官方行为：

- `gh secret set NAME`（不给值）→ 交互式隐藏输入，**不会留在 shell 历史里**
- `-b/--body` 未指定时**读 stdin**，所以管道与 `<` 重定向都能用
- `-f/--env-file` 读取 dotenv 格式文件，可一次写入多个

**不用 gh 的话**：GitHub 网页 → 仓库 → `Settings` → `Secrets and variables` → `Actions`
→ `New repository secret`，逐项粘贴。

---

### 4.1 速查表：值从哪来 → 怎么写

| Secret | 值是什么 | 拿到这个值 | 写入 |
| --- | --- | --- | --- |
| `ANDROID_KEYSTORE_BASE64` | keystore 文件的 base64 | `base64 -i <keystore>` | 管道给 `gh secret set` |
| `ANDROID_KEYSTORE_PASSWORD` | keystore 口令 | 创建 keystore 时自己设定 | `gh secret set`（隐藏输入） |
| `ANDROID_KEY_ALIAS` | 私钥条目别名 | `keytool -list -keystore <keystore>` | `gh secret set ... --body "<别名>"` |
| `ANDROID_KEY_PASSWORD` | 私钥口令 | 同 keystore 口令（PKCS12） | `gh secret set` |
| `APPLE_CERTIFICATE` | Developer ID 证书 `.p12` 的 base64 | 钥匙串导出 `.p12` → `base64 -i cert.p12` | 管道给 `gh secret set` |
| `APPLE_CERTIFICATE_PASSWORD` | 导出 `.p12` 时设的密码 | 导出时自己设定 | `gh secret set` |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: X (TEAMID)` | `security find-identity -v -p codesigning` | 管道给 `gh secret set` |
| `APPLE_ID` | Apple 账号邮箱 | 你的账号 | `gh secret set ... --body` |
| `APPLE_PASSWORD` | App 专用密码 | appleid.apple.com 生成 | `gh secret set` |
| `APPLE_TEAM_ID` | 10 位 Team ID | developer.apple.com → Membership details | `gh secret set ... --body` |
| `APPLE_API_KEY` | App Store Connect **Key ID** | App Store Connect 生成（见 4.5.2） | `gh secret set ... --body` |
| `APPLE_API_ISSUER` | Issuer ID | 同上页面顶部 | `gh secret set ... --body` |
| `APPLE_API_KEY_P8` | `.p8` 文件内容的 base64 | `base64 -i AuthKey_XXXX.p8` | 管道给 `gh secret set` |
| `WINDOWS_CERTIFICATE` | 代码签名 `.pfx` 的 base64 | 向 CA 购买后导出 `.pfx` → `base64 -i cert.pfx` | 管道给 `gh secret set` |
| `WINDOWS_CERTIFICATE_PASSWORD` | `.pfx` 密码 | 导出时自己设定 | `gh secret set` |
| `AZURE_TENANT_ID` | Azure 租户 ID | Azure 门户 → Entra ID → 概览 | `gh secret set ... --body` |
| `AZURE_CLIENT_ID` | 服务主体 Client ID | 应用注册 → 应用程序(客户端) ID | `gh secret set ... --body` |
| `AZURE_CLIENT_SECRET` | 服务主体密钥 | 应用注册 → 证书和密码 | `gh secret set` |
| `AZURE_CODE_SIGNING_ENDPOINT` | Trusted Signing 终结点 | Trusted Signing 资源 → 概览 | `gh secret set ... --body` |
| `AZURE_CODE_SIGNING_ACCOUNT` | Trusted Signing 账号名 | Trusted Signing 资源名 | `gh secret set ... --body` |
| `AZURE_CODE_SIGNING_CERTIFICATE_PROFILE` | 证书配置文件名 | Trusted Signing → 证书配置文件 | `gh secret set ... --body` |
| `TAURI_SIGNING_PRIVATE_KEY` | updater 私钥内容 | `cat .signing/updater.key`（向导已生成） | `gh secret set ... < .signing/updater.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | updater 私钥口令 | 生成密钥对时设定 | `gh secret set` |

> 所有 base64 命令都建议追加 `| tr -d '\n'`（macOS/BSD）或改用 `base64 -w0`（Linux）。
> 详见 4.9 的说明——其实带换行也能用，但单行最不容易出错。

---

### 4.2 我手上没有这些材料，怎么办

先分清哪些能自己造、哪些必须花钱：

| 材料 | 能否自己生成 | 前置条件 |
| --- | --- | --- |
| Android keystore | ✅ | 只要装了 JDK 的 `keytool` |
| updater 密钥对 | ✅ | `pnpm tauri signer generate` |
| `APPLE_CERTIFICATE` | ❌ | **付费** Apple Developer Program 会员（个人/公司均可） |
| `APPLE_PASSWORD` / `APPLE_API_*` | ❌ | 同上（公证是 Apple 提供的服务） |
| `WINDOWS_CERTIFICATE` | ⚠️ 技术上可以，但**不能用于分发** | 必须由受信任 CA 签发 |

**没有 Windows 代码签名证书时的三个选择**：

| 选择 | 成本 | 结果 |
| --- | --- | --- |
| 买 OV 代码签名证书（DigiCert / Sectigo / GlobalSign / SSL.com…） | 约每年千元级 | 可导出 `.pfx` → 走 `WINDOWS_CERTIFICATE`；SmartScreen 需积累声誉 |
| 买 EV 证书 | 更贵 | 私钥常在硬件令牌里、**无法导出 `.pfx`** → 只能用云签名或插令牌本机构建 |
| Azure Trusted Signing | 约每月十几美元 | 云签名，最适合 CI；走 4.7 的 6 个 `AZURE_*`，**不需要** `WINDOWS_CERTIFICATE` |

**没有 Apple 付费账号时**：拿不到 `APPLE_CERTIFICATE`，macOS 产物只能不签名（或仅 ad-hoc）。
本工具会把这类产物判为**未签名**，tag 发布时会失败——这是有意的，避免发出过不了 Gatekeeper 的包。

---

### 4.3 Android 的 4 个 Secret

keystore 可以自己生成，所以这 4 个值完全在你掌控内。

```bash
# 生成 keystore（等价于向导的 Android 步骤）
keytool -genkeypair -keystore release.jks -storetype PKCS12 \
  -alias proofreader -keyalg RSA -keysize 4096 -validity 10950 \
  -dname "CN=你的组织名, OU=Mobile, O=你的组织名, L=Hangzhou, ST=Zhejiang, C=CN"
# 交互式询问口令，不进 shell 历史
```

#### `ANDROID_KEYSTORE_BASE64`

- **值**：`release.jks`（keystore 文件）的 base64
- **写入**：

```bash
base64 -i release.jks | tr -d '\n' | gh secret set ANDROID_KEYSTORE_BASE64   # macOS
base64 -w0 release.jks | gh secret set ANDROID_KEYSTORE_BASE64               # Linux
```

#### `ANDROID_KEYSTORE_PASSWORD`

- **值**：上面 `keytool` 提示你输入的 keystore 口令（向导会随机生成并写入 `.signing/signing.env`）
- **写入**：`gh secret set ANDROID_KEYSTORE_PASSWORD`（隐藏输入）

#### `ANDROID_KEY_ALIAS`

- **值**：`keytool -list -keystore release.jks` 打印出的条目名。**JKS 的别名会被 keytool 统一转小写**
  （填 `studioA` 实际是 `studioa`），以 keystore 里的实际写法为准
- **写入**：

```bash
gh secret set ANDROID_KEY_ALIAS --body "proofreader"
```

#### `ANDROID_KEY_PASSWORD`

- **值**：私钥口令。**PKCS12 下必须与 keystore 口令相同**；JKS 允许不同
- **写入**：`gh secret set ANDROID_KEY_PASSWORD`（隐藏输入）

> 换了机器或重新生成 keystore 时，用 `pnpm run setup:signing -- --keystore=<路径>` 导入，
> 向导会自动识别类型（JKS / PKCS12）、规范化别名，并用「能否读出证书指纹」做硬校验。

---

### 4.4 `APPLE_CERTIFICATE`、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_SIGNING_IDENTITY`

这三个值都来自同一张 **Developer ID Application** 证书。前置条件：付费 Apple Developer 会员，
且只有 **Account Holder / Admin** 能创建 Developer ID 证书。

#### 4.4.1 生成 CSR

1. 打开「钥匙串访问」→ 菜单栏「钥匙串访问」→「证书助理」→「从证书颁发机构请求证书…」
2. 「用户电子邮件地址」填 Apple ID 邮箱；「常用名称」随意；「CA 电子邮件地址」留空
3. 选「存储到磁盘」，保存 `CertificateSigningRequest.certSigningRequest`

> 这一步同时在登录钥匙串里生成了一对私钥，**不要删除** —— 导出 `.p12` 要用它。

#### 4.4.2 申请证书并导出 `.p12`

1. [developer.apple.com](https://developer.apple.com/account) → Certificates, Identifiers & Profiles → Certificates → `+`
2. 在 **Software** 分类下选 **Developer ID Application** → Continue → 上传刚才的 CSR → Download（`.cer`）
3. 双击 `.cer` 导入登录钥匙串，在「我的证书」里应看到
   `Developer ID Application: <名称> (TEAMID)`，展开能见到配套私钥
4. 右键该证书 → **导出…** → 文件格式选 **个人信息交换 (.p12)** → 设置密码（这就是
   `APPLE_CERTIFICATE_PASSWORD`）

#### 4.4.3 写入

```bash
# ① APPLE_CERTIFICATE：.p12 的 base64（注意：必须是含私钥的 .p12，不是 .cer）
base64 -i cert.p12 | tr -d '\n' | gh secret set APPLE_CERTIFICATE

# ② APPLE_CERTIFICATE_PASSWORD：导出 .p12 时设的密码（隐藏输入）
gh secret set APPLE_CERTIFICATE_PASSWORD

# ③ APPLE_SIGNING_IDENTITY：直接取本机可用身份
security find-identity -v -p codesigning
#   "Developer ID Application: Your Name (ABCDE12345)"
security find-identity -v -p codesigning | grep -o 'Developer ID Application: [^"]*' \
  | head -1 | tr -d '\n' | gh secret set APPLE_SIGNING_IDENTITY
```

`APPLE_SIGNING_IDENTITY` 必须与 `.p12` 里的证书一致，否则 Tauri 会报
`certificate from APPLE_CERTIFICATE ... does not match provided identity`。

---

### 4.5 macOS 公证的 3 个 Secret（两条路线，二选一）

公证（notarization）是 Apple 的服务，必须提供凭据。**两条路线只需选一条**：

#### 4.5.1 路线 1：Apple ID + App 专用密码

| Secret | 值 | 写入 |
| --- | --- | --- |
| `APPLE_ID` | 你的 Apple 账号邮箱 | `gh secret set APPLE_ID --body "you@example.com"` |
| `APPLE_PASSWORD` | **App 专用密码** | `gh secret set APPLE_PASSWORD` |
| `APPLE_TEAM_ID` | 10 位 Team ID | `gh secret set APPLE_TEAM_ID --body "ABCDE12345"` |

- App 专用密码： [appleid.apple.com](https://appleid.apple.com) → 登录与安全 → **App 专用密码** → 生成
  （形如 `abcd-efgh-ijkl-mnop`，只显示一次）。
  ⚠️ 它是**专用密码**，不是你 Apple ID 的登录密码。
- Team ID：developer.apple.com → Membership details，也可以从证书名括号里读出来。

#### 4.5.2 路线 2：App Store Connect API 密钥（CI 推荐）

1. [App Store Connect](https://appstoreconnect.apple.com) → 用户和访问 → **集成** → App Store Connect API → **团队密钥** → `+`
2. 生成后得到 **Key ID**；页面上方还有 **Issuer ID**；`.p8` 文件**只能下载一次**

| Secret | 值 | 写入 |
| --- | --- | --- |
| `APPLE_API_KEY` | **Key ID**（不是密钥内容！） | `gh secret set APPLE_API_KEY --body "ABCDE12345"` |
| `APPLE_API_ISSUER` | Issuer ID（UUID 形式） | `gh secret set APPLE_API_ISSUER --body "<uuid>"` |
| `APPLE_API_KEY_P8` | `.p8` 文件内容的 base64 | `base64 -i AuthKey_ABCDE12345.p8 \| tr -d '\n' \| gh secret set APPLE_API_KEY_P8` |

Tauri 实际读的是 `APPLE_API_KEY_PATH` 指向的**文件**（缺省时会在 `./private_keys` 里找
`AuthKey_<KEY_ID>.p8`）。CI 由 composite action 把 `APPLE_API_KEY_P8` 解码落地到
`src-tauri/private_keys/AuthKey_<KEY_ID>.p8` 并导出该路径，你不需要手动处理。

---

### 4.6 `WINDOWS_CERTIFICATE`、`WINDOWS_CERTIFICATE_PASSWORD`

这两个值来自一张**受信任 CA 签发的代码签名证书**。自签证书拿不到信任，不能用于分发。

#### 获取 `.pfx` 的两条路线

**路线 A：向 CA 购买 OV 证书**（DigiCert / Sectigo / GlobalSign / SSL.com 等）

1. 在 CA 下单，按指引完成组织验证
2. 私钥可在本机生成，完成后把证书**连同私钥**导出为 `.pfx`（务必包含完整证书链）
3. EV 证书通常要求私钥存在硬件令牌 / HSM 中，**无法导出 `.pfx`** →
   此时改用路线 B，或把令牌插在构建机上配合自定义 `signCommand`

**路线 B：Azure Trusted Signing**（云签名，最适合 CI，不需要 `WINDOWS_CERTIFICATE`）
→ 见 4.7。

#### 写入

```bash
# ① WINDOWS_CERTIFICATE：.pfx 的 base64
base64 -i cert.pfx | tr -d '\n' | gh secret set WINDOWS_CERTIFICATE

# ② WINDOWS_CERTIFICATE_PASSWORD：导出 .pfx 时设的密码
gh secret set WINDOWS_CERTIFICATE_PASSWORD
```

#### 重要：光有这两个 Secret 不会让产物被签名

`tauri-bundler` 判断「是否签名 Windows 产物」只看
`bundle.windows.certificateThumbprint` 或 `bundle.windows.signCommand`
（源码：`settings.rs` 的 `can_sign()`），它**不读取** `WINDOWS_CERTIFICATE` 环境变量。因此：

| 模式 | 必须注入的内容 | 由谁完成 |
| --- | --- | --- |
| pfx | `bundle.windows.certificateThumbprint` | CI 的 composite action **导入 pfx 取指纹**后经 `--config` 注入 |
| Azure | `bundle.windows.signCommand` | CI 依据 `signing.config.json` 生成并注入 |

两者都没配时 Windows 产物会**静默地不签名**，这正是 `verify-artifacts.mjs signed` 必须存在的原因。

**本地构建签名**：

```powershell
$pwd  = ConvertTo-SecureString -String '<pfx 密码>' -Force -AsPlainText
$cert = Import-PfxCertificate -FilePath .\cert.pfx -CertStoreLocation Cert:\CurrentUser\My -Password $pwd
$cert.Thumbprint
$env:DSH_WINDOWS_CERT_THUMBPRINT = $cert.Thumbprint     # 用环境变量提供，不污染配置文件
pnpm run build:release -- --target=x86_64-pc-windows-msvc
```

---

### 4.7 Azure Trusted Signing 的 6 个 Secret

选择这条路就不需要 `WINDOWS_CERTIFICATE`。

#### 申请步骤

1. 在 Azure 订阅下创建 **Trusted Signing** 资源
   （需要通过 Microsoft 的身份验证：组织通常需可验证的 3 年以上历史，个人身份验证也已开放）
2. 在该资源下创建 **Certificate Profile**，类型选 **Public Trust**
3. 创建 **App registration**（服务主体），记录 **Tenant ID** / **Client ID**，并生成 **Client Secret**
4. 给该服务主体授予 Trusted Signing 账号上的 **Trusted Signing Certificate Profile Signer** 角色
5. 记录资源的 **Endpoint**、**Account name**、**Certificate profile name**

#### 写入

```bash
gh secret set AZURE_TENANT_ID --body "<租户 ID>"
gh secret set AZURE_CLIENT_ID --body "<Client ID>"
gh secret set AZURE_CLIENT_SECRET                                   # 隐藏输入
gh secret set AZURE_CODE_SIGNING_ENDPOINT --body "https://eus.codesigning.azure.net/"
gh secret set AZURE_CODE_SIGNING_ACCOUNT --body "<Trusted Signing 账号名>"
gh secret set AZURE_CODE_SIGNING_CERTIFICATE_PROFILE --body "<证书配置文件名>"
```

#### 切换到该模式

```jsonc
// signing.config.json
"windows": {
  "mode": "azure-trusted-signing",
  "azureTrustedSigning": {
    "endpoint": "https://eus.codesigning.azure.net/",
    "account": "<账号名>",
    "certificateProfile": "<证书配置文件名>",
    "description": "Proof Reader",
    "cliVersion": "0.4.0"   // 固定签名工具版本；它也影响产物字节，因此会进入 configKey
  }
}
```

```bash
pnpm run signing:check -- --apply     # 施加配置并自检
```

CI 会据此安装 `trusted-signing-cli`（版本取自 `cliVersion`）并作为 `signCommand` 注入构建。

---

### 4.8 updater 的 2 个 Secret

```bash
# 生成密钥对（向导的 updater 步骤等价）
pnpm tauri signer generate --write-keys .signing/updater.key --ci
```

| Secret | 值 | 写入 |
| --- | --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | `.signing/updater.key` 文件内容（单行 base64） | `gh secret set TAURI_SIGNING_PRIVATE_KEY < .signing/updater.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 生成时设的私钥口令 | `gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD` |

公钥（`.signing/updater.key.pub`）**不是 Secret**：向导会自动写入 `signing.config.json` 的
`updater.publicKey` 与 `tauri.conf.json` 的 `plugins.updater.pubkey`，**必须提交**，
客户端靠它校验更新包。

---

### 4.9 base64 命令（三平台）与验证

```bash
# macOS（BSD base64）
base64 -i cert.p12 | tr -d '\n' > cert.b64

# Linux（GNU coreutils）
base64 -w0 cert.p12 > cert.b64
```

```powershell
# Windows PowerShell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("cert.pfx")) | Set-Content -NoNewline cert.b64
```

三个消费端都会**先剥离空白再解码**，带换行的 base64 也能用：

- Android：`Buffer.from(value, "base64")`（Node 忽略空白）
- macOS：`tauri-macos-sign` 的 `decode_base64()` 显式 `filter(|c| !c.is_ascii_whitespace())`
- Windows：composite action 用 `-replace '\s',''` 清理

**验证写入结果**（Secret 的值无法读回，只能看名字与更新时间）：

```bash
gh secret list
```

**更省事的做法**：直接让工具报出「缺哪个、去哪拿、执行哪条命令」——

```bash
pnpm run secrets:status              # 按当前 signing.config.json 列出已配置 / 缺失
pnpm run secrets:status -- --strict  # 有必需项缺失时以非 0 退出（可放进提交前检查）
```

它会读 `gh secret list`（只有名字，拿不到值），与配置里启用的平台比对，
对每个缺失项打印用途、获取途径、产出值的命令和写入命令。

**Secret 值读不回来，本地必须留原件。** 如果你的仓库里已经有一部分 Secret（例如接手项目），
光凭 Secret 无法还原材料，只能反过来核对本地备份是否就是 CI 在用的那一份：
用证书指纹比对，两边一致即表示是同一把 key。

```bash
# 本地 keystore 的证书 SHA-256
pnpm run signing:check | grep -A1 "签名证书"      # 也可用 keytool -list -v 手工查看

# CI 产物的证书 SHA-256（三种来源任选）
node -e "console.log(require('./release-manifest.json').signing.android.certificateSha256)"
apksigner verify --print-certs <下载的 release.apk> | grep "SHA-256 digest"
```

`release-manifest.json` 由构建自动产出并随 Release 上传，
所以「本地 key ⇄ CI 实际使用的 key 是否一致」是可以被证明的，不用靠猜。

**验证配置本身**：

```bash
pnpm run signing:check      # keystore / keystore.properties / Gradle 补丁 / updater 公钥 / 版本一致性
```

**验证产物确实被签名**（构建之后）：

```bash
pnpm run verify:signed -- --manifest=release-manifest-<target>.json
```

---

### 4.10 轮换与安全

- Secret 一旦写入**无法读回**，只能覆盖；原始材料必须自己留档。
- **fork 的 PR 拿不到 Secrets**：这正是 `require-signing` 只在 tag 推送时开启、
  `workflow_dispatch` 降级为警告的原因。
- 泄露处置的代价不同：
  - Android keystore：代价最高，换 key 会让现有用户无法覆盖安装
  - updater 私钥：需要先发一个带新公钥的过渡版本，否则老客户端拒绝新包
  - Apple / Windows 证书：可在门户吊销后重新签发，代价较低
- `.signing/`、`*.jks`、`*.p12`、`*.pfx`、`*.p8`、`keystore.properties` 均已在 `.gitignore` 中忽略。
- 建议把材料与口令存进密码管理器，保留至少两名管理员。

---

### 4.11 CI 中的执行顺序（重要）

```
checkout
  → pnpm install --frozen-lockfile
  → tauri android init                  (可能重生成 gen/android)
  → ./.github/actions/setup-release-signing        ← 必须在 init 之后
      ├─ 还原 keystore / keystore.properties / updater.key
      ├─ 导入 Windows pfx → DSH_WINDOWS_CERT_THUMBPRINT
      ├─ 落地 App Store Connect .p8 → APPLE_API_KEY_PATH
      ├─ 生成 --config 覆盖（updater 签名 + Windows 签名）→ DSH_TAURI_CONFIG_ARGS
      └─ 导出 SOURCE_DATE_EPOCH / RUSTFLAGS / TZ / CARGO_INCREMENTAL
  → pnpm tauri android build            (lockfile 固定的 CLI)
  → rename-android-artifacts.mjs        (校验已签名 + 统一产物名)
  → build-release.mjs --skip-build      (归一化 APK + 生成清单)
  → verify-artifacts.mjs signed         (未签名即失败)
```

tag 推送（`push` 事件）时 `require-signing: true`，**缺少任何签名材料都会让流水线失败**；
手动 `workflow_dispatch` 时降级为警告，方便没有密钥的 fork 自行构建。

---

## 5. 命令参考

| 命令 | 作用 |
| --- | --- |
| `pnpm run setup:signing` | 交互式发布配置引导 |
| `pnpm run signing:check` | 配置自检（`--strict` 让缺失材料成为错误，`--apply` 顺便贴补丁） |
| `pnpm run signing:check -- --apply --restore-android-from-ci` | CI：从 Secrets 还原并贴补丁 |
| `pnpm run secrets:status` | 列出已配置/缺失的 Secrets，并对每个缺失项给出获取与写入命令（`--strict` 让必需项缺失成为错误） |
| `pnpm run build:release` | 可复现构建（`--target` / `--android` / `--skip-build` / `--compare-with`） |
| `pnpm run artifact:manifest` | 只对已有产物生成清单 |
| `pnpm run artifact:merge -- --inputs=a.json,b.json` | 合并各平台清单 |
| `pnpm run verify:reproducible -- --expected=a.json --actual=b.json` | 比对两次构建 |
| `pnpm run verify:signed -- --manifest=m.json` | 校验 release 产物是否都已签名 |
| `pnpm run android:normalize -- --file=app.apk` | 单独归一化并校验某个 APK |
| `pnpm run rename:android -- --arch=aarch64` | 校验「已签名」并统一 Android 产物名（发现 `-unsigned` 即失败） |

### 退出码

- `signing:check`：有 fail 项 → `1`
- `verify:reproducible`：`reproducible` → `0`，其余 → `1`
- `verify:signed`：存在未签名产物 → `1`（除非 `DSH_ALLOW_UNSIGNED=true`）
- `build:release`：存在未签名产物 → `1`（除非 `--allow-unsigned`）

---

## 6. 路径基准（容易踩的坑）

`signing.config.json` 里的路径**一律相对项目根**（与 `android.keystorePath` 一致），
但写进 `tauri.conf.json` 时会被转换成 **相对 `src-tauri/`** 的路径。

原因是 Tauri 自身的约定：打包前 tauri-cli 会 `set_current_dir(src-tauri)`，
之后把配置里的字符串原样当作文件路径使用（不做重基）。所以：

| 文件 | 字段 | 路径基准 |
| --- | --- | --- |
| `signing.config.json` | `android.keystorePath`、`macos.entitlements` 等 | 项目根 |
| `src-tauri/tauri.conf.json` | `bundle.macOS.entitlements`、`bundle.icon` 等 | `src-tauri/` |

写错基准的后果不对称：**没有证书时该文件会被完全忽略**（Tauri 不签名就根本不读它），
**有证书的 CI 里则要到打包末期才由 `codesign` 报错**。因此 `pnpm run signing:check`
会提前按项目根校验文件是否存在。转换逻辑见 `scripts/lib/project-files.mjs` 的
`toTauriBundlePath()`（有单测覆盖）。

---

## 7. 常见问题

**Q：改了 `signing.config.json` 但忘记刷新 `configKey`？**
`pnpm run signing:check` 会报错并给出正确值。永远不要让脚本以外的工具改这个字段。

**Q：`artifact-drift` 该怎么办？**
按顺序排查：① `SOURCE_DATE_EPOCH` 是否来自同一 commit（工作区有未提交改动会破坏它）；
② `rust-toolchain.toml` 与 `pnpm-lock.yaml` 是否两端一致；③ 清单里的
`toolchain.key` 是否相同；④ Android 是否跳过了归一化（`--no-normalize` 或缺少 keystore）。

**Q：为什么 `createUpdaterArtifacts` 不在 `tauri.conf.json` 里？**
因为一旦写入，任何缺少 updater 私钥的构建都会直接失败。它由
`build-release.mjs` 与 CI 在私钥存在时通过 `--config` 注入。

**Q：想启用应用内自动更新检查？**
当前已完成的是**产物签名侧**（生成 `.sig`、公钥写入配置）。要在客户端做更新检查，
还需要引入 `tauri-plugin-updater`（Cargo + npm 依赖、`lib.rs` 初始化与 capability 权限），
并把 `updater.endpoints` 指向托管更新清单的地址。二者共用同一对密钥。

**Q：能否直接用 Android Studio 生成 keystore？**
可以，完全等价：

```bash
pnpm run setup:signing -- --keystore=/path/to/from-android-studio.jks
```

向导会导入、读取证书指纹、生成 `keystore.properties` 并贴上 Gradle 补丁。
