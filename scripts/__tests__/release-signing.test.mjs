/**
 * 发布签名 / 可复现打包核心逻辑单测。
 *
 * 这些测试守住的是本项目最核心的契约：
 *   同一份配置 + 同一套 key + 同一工具链  ⇒  产物必须逐字节一致。
 */

import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { deflateRawSync } from 'node:zlib'

import {
	canonicalize,
	canonicalJson,
	computeConfigKey,
	collectConfigIssues,
	defaultSigningConfig,
	isUnsignedAndroidArtifact,
	looksLikeMinisignPublicKey,
	resolveSourceDateEpoch,
	sha256,
} from '../lib/core.mjs'
import {
	GRADLE_BEGIN,
	buildGradlePatch,
	buildTauriBuildOverrides,
	mergeGradlePatch,
	toTauriBundlePath,
} from '../lib/project-files.mjs'
import {
	buildManifest,
	collectSigningIdentity,
	compareManifests,
	computeIdentityKey,
	hashDirectory,
	comparableProjection,
} from '../lib/manifest.mjs'
import { normalizeZipTimestamps, findEocdOffset, listZipEntries, verifyJarSignature } from '../lib/apk.mjs'
import { buildDname, detectKeystoreType, escapeRdnValue, randomPassword } from '../lib/platforms.mjs'
import { resolveAbiSlug } from '../rename-android-artifacts.mjs'
import { buildSecretEntries } from '../lib/secrets.mjs'

// ---------------------------------------------------------------------------
// 测试用 ZIP 构造器（STORED + DEFLATE 各一条），用于验证时间戳归一化
// ---------------------------------------------------------------------------

function dosDateTime(date) {
	const dosTime =
		(date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1)
	const dosDate = ((date.getUTCFullYear() - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate()
	return { dosTime, dosDate }
}

/** 生成一个最小可用的 ZIP：entries = [{ name, data, stored?: boolean, date }] */
function makeZip(entries) {
	const locals = []
	const centrals = []
	let offset = 0

	for (const entry of entries) {
		const nameBuffer = Buffer.from(entry.name, 'utf8')
		const raw = Buffer.from(entry.data)
		const stored = entry.stored !== false
		const payload = stored ? raw : deflateRawSync(raw)
		const method = stored ? 0 : 8
		const crc = crc32(raw)
		const { dosTime, dosDate } = dosDateTime(entry.date ?? new Date(Date.UTC(2020, 0, 1)))

		const local = Buffer.alloc(30)
		local.writeUInt32LE(0x04034b50, 0)
		local.writeUInt16LE(20, 4)
		local.writeUInt16LE(0, 6)
		local.writeUInt16LE(method, 8)
		local.writeUInt16LE(dosTime, 10)
		local.writeUInt16LE(dosDate, 12)
		local.writeUInt32LE(crc, 14)
		local.writeUInt32LE(payload.length, 18)
		local.writeUInt32LE(raw.length, 22)
		local.writeUInt16LE(nameBuffer.length, 26)
		local.writeUInt16LE(0, 28)

		locals.push(local, nameBuffer, payload)

		const central = Buffer.alloc(46)
		central.writeUInt32LE(0x02014b50, 0)
		central.writeUInt16LE(20, 4)
		central.writeUInt16LE(20, 6)
		central.writeUInt16LE(0, 8)
		central.writeUInt16LE(method, 10)
		central.writeUInt16LE(dosTime, 12)
		central.writeUInt16LE(dosDate, 14)
		central.writeUInt32LE(crc, 16)
		central.writeUInt32LE(payload.length, 20)
		central.writeUInt32LE(raw.length, 24)
		central.writeUInt16LE(nameBuffer.length, 28)
		central.writeUInt16LE(0, 30)
		central.writeUInt16LE(0, 32)
		central.writeUInt16LE(0, 34)
		central.writeUInt16LE(0, 36)
		central.writeUInt32LE(0, 38)
		central.writeUInt32LE(offset, 42)
		centrals.push(central, nameBuffer)

		offset += local.length + nameBuffer.length + payload.length
	}

	const centralBuffer = Buffer.concat(centrals)
	const localBuffer = Buffer.concat(locals)

	const eocd = Buffer.alloc(22)
	eocd.writeUInt32LE(0x06054b50, 0)
	eocd.writeUInt16LE(0, 4)
	eocd.writeUInt16LE(0, 6)
	eocd.writeUInt16LE(entries.length, 8)
	eocd.writeUInt16LE(entries.length, 10)
	eocd.writeUInt32LE(centralBuffer.length, 12)
	eocd.writeUInt32LE(localBuffer.length, 16)
	eocd.writeUInt16LE(0, 20)

	return Buffer.concat([localBuffer, centralBuffer, eocd])
}

const CRC_TABLE = (() => {
	const table = new Int32Array(256)
	for (let i = 0; i < 256; i += 1) {
		let c = i
		for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
		table[i] = c
	}
	return table
})()

function crc32(buffer) {
	let c = 0xffffffff
	for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
	return (c ^ 0xffffffff) >>> 0
}

function readTimestamps(filePath) {
	const buffer = fs.readFileSync(filePath)
	const eocd = findEocdOffset(buffer)
	const count = buffer.readUInt16LE(eocd + 10)
	let cursor = buffer.readUInt32LE(eocd + 16)
	const stamps = []
	for (let index = 0; index < count; index += 1) {
		const nameLength = buffer.readUInt16LE(cursor + 28)
		const extraLength = buffer.readUInt16LE(cursor + 30)
		const commentLength = buffer.readUInt16LE(cursor + 32)
		const localOffset = buffer.readUInt32LE(cursor + 42)
		stamps.push({
			central: [buffer.readUInt16LE(cursor + 12), buffer.readUInt16LE(cursor + 14)],
			local: [buffer.readUInt16LE(localOffset + 10), buffer.readUInt16LE(localOffset + 12)],
		})
		cursor += 46 + nameLength + extraLength + commentLength
	}
	return stamps
}

function tempDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'proofreader-test-'))
}

// ---------------------------------------------------------------------------

describe('规范化 JSON 与 configKey', () => {
	it('canonicalize 递归按 key 排序，字段顺序不影响结果', () => {
		const a = { b: 1, a: { d: [1, 2], c: 'x' } }
		const b = { a: { c: 'x', d: [1, 2] }, b: 1 }
		expect(canonicalJson(a)).toBe(canonicalJson(b))
		expect(canonicalJson(a)).toBe('{"a":{"c":"x","d":[1,2]},"b":1}')
	})

	it('canonicalize 丢弃 undefined 但保留 null', () => {
		expect(canonicalize({ a: undefined, b: null })).toEqual({ b: null })
	})

	it('configKey 忽略 configKey 自身与 $schema，且随内容变化', () => {
		const base = { schemaVersion: 1, app: { version: '1.0.0' } }
		const withKey = { ...base, configKey: 'sha256:deadbeef' }
		const withSchema = { ...base, $schema: './signing.config.schema.json' }
		expect(computeConfigKey(withKey)).toBe(computeConfigKey(base))
		expect(computeConfigKey(withSchema)).toBe(computeConfigKey(base))
		expect(computeConfigKey({ ...base, app: { version: '1.0.1' } })).not.toBe(computeConfigKey(base))
	})

	it('configKey 是带前缀的 sha256', () => {
		expect(computeConfigKey(defaultSigningConfig())).toMatch(/^sha256:[0-9a-f]{64}$/)
	})

	it('sha256 输出稳定', () => {
		expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
	})
})

describe('配置一致性校验', () => {
	it('默认配置与仓库实际版本/标识符一致', () => {
		const repoVersion = JSON.parse(
			fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
		).version
		const config = { ...defaultSigningConfig(), app: { ...defaultSigningConfig().app, version: repoVersion } }
		const { errors } = collectConfigIssues(config)
		expect(errors).toEqual([])
	})

	it('版本号与 package.json 不一致时报错', () => {
		const { errors } = collectConfigIssues({
			...defaultSigningConfig(),
			app: { productName: 'Proof Reader', identifier: 'cn.helilab.proofreader', version: '0.0.1' },
		})
		expect(errors.join('\n')).toMatch(/package\.json/)
	})

	it('identifier 与 tauri.conf.json 不一致时报错', () => {
		const repoVersion = JSON.parse(
			fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
		).version
		const { errors } = collectConfigIssues({
			...defaultSigningConfig(),
			app: { productName: 'Proof Reader', identifier: 'com.example.wrong', version: repoVersion },
		})
		expect(errors.join('\n')).toMatch(/identifier/)
	})

	it('sourceDateEpoch 非法时报错', () => {
		const config = defaultSigningConfig()
		config.reproducibility.sourceDateEpoch = 'now'
		const { errors } = collectConfigIssues(config)
		expect(errors.join('\n')).toMatch(/sourceDateEpoch/)
	})

	it('keystore 位数不足时报错', () => {
		const config = defaultSigningConfig()
		config.android.keySize = 1024
		const { errors } = collectConfigIssues(config)
		expect(errors.join('\n')).toMatch(/keySize/)
	})

	it('识别合法与非法的 minisign 公钥', () => {
		const valid = Buffer.from(
			'untrusted comment: minisign public key: 968254952BC7B0D2\nRWTSsMcrlVSC\n',
		).toString('base64')
		expect(looksLikeMinisignPublicKey(valid)).toBe(true)
		expect(looksLikeMinisignPublicKey(Buffer.from('not a key').toString('base64'))).toBe(false)
		expect(looksLikeMinisignPublicKey('')).toBe(false)
	})
})

describe('SOURCE_DATE_EPOCH 解析', () => {
	it('固定数字原样返回并取整', () => {
		expect(resolveSourceDateEpoch({ reproducibility: { sourceDateEpoch: 1700000000.9 } })).toBe(1700000000)
	})

	it('zero 返回 0', () => {
		expect(resolveSourceDateEpoch({ reproducibility: { sourceDateEpoch: 'zero' } })).toBe(0)
	})

	it('commit 模式回落到 git 提交时间（本仓库内应大于 0）', () => {
		expect(resolveSourceDateEpoch({ reproducibility: { sourceDateEpoch: 'commit' } })).toBeGreaterThan(0)
	})
})

describe('Android Gradle 补丁', () => {
	const config = defaultSigningConfig()

	it('包含签名、可复现与依赖元数据设置', () => {
		const patch = buildGradlePatch(config)
		expect(patch).toContain('signingConfigs')
		expect(patch).toContain('create("release")')
		expect(patch).toContain('signingConfig = signingConfigs.findByName("release")')
		expect(patch).toContain('includeInApk = false')
		expect(patch).toContain('includeInBundle = false')
		expect(patch).toContain('isPreserveFileTimestamps = false')
		expect(patch).toContain('isReproducibleFileOrder = true')
		expect(patch).toContain('keystore.properties')
	})

	it('不使用会被 Gradle java 扩展遮蔽的 java.util.Properties', () => {
		// Gradle Kotlin DSL 中 `java` 指向 JavaPluginExtension，
		// `java.util.Properties()` 无法编译（已由真实 Gradle 配置验证）。
		expect(buildGradlePatch(config)).not.toContain('java.util.Properties')
	})

	it('mergeGradlePatch 首次追加、二次替换且幂等', () => {
		const original = 'plugins { id("com.android.application") }\n'
		const patch = buildGradlePatch(config)

		const once = mergeGradlePatch(original, patch)
		expect(once.startsWith(original)).toBe(true)
		expect(once).toContain(GRADLE_BEGIN)
		expect(once.match(new RegExp(GRADLE_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))).toHaveLength(1)

		const twice = mergeGradlePatch(once, patch)
		expect(twice).toBe(once)
	})

	it('标记块损坏时抛错而不是静默产出坏文件', () => {
		const broken = `${GRADLE_BEGIN}\nandroid { }\n`
		expect(() => mergeGradlePatch(broken, buildGradlePatch(config))).toThrow(/标记块不完整/)
	})

	it('替换后的补丁块内容反映新的签名方案', () => {
		const v2Only = buildGradlePatch({ ...config, android: { ...config.android, signatureScheme: 'v2+v3' } })
		const merged = mergeGradlePatch(buildGradlePatch(config), v2Only)
		expect(merged).toContain('enableV1Signing = false')
		expect(merged).toContain('enableV2Signing = true')
	})
})

describe('tauri.conf.json 的路径基准转换', () => {
	it('把「相对项目根」的路径转换为 tauri.conf.json 使用的「相对 src-tauri」路径', () => {
		// Tauri 打包前会 chdir 到 src-tauri，且不对 entitlements 做重基，
		// 所以写进 tauri.conf.json 的必须是相对 src-tauri 的路径。
		expect(toTauriBundlePath('src-tauri/entitlements.plist')).toBe('entitlements.plist')
		expect(toTauriBundlePath('src-tauri/linux/ent.plist')).toBe('linux/ent.plist')
		// 位于 src-tauri 之外的资源用 ../ 表达，仍然可用
		expect(toTauriBundlePath('resources/ent.plist')).toBe('../resources/ent.plist')
	})
})

describe('ZIP 时间戳归一化', () => {
	it('把本地头与中央目录的时间戳统一为固定值', () => {
		const dir = tempDir()
		const file = path.join(dir, 'a.zip')
		fs.writeFileSync(
			file,
			makeZip([
				{ name: 'one.txt', data: 'hello', date: new Date(Date.UTC(2019, 4, 5, 6, 7, 8)) },
				{ name: 'two.txt', data: 'world!!'.repeat(10), stored: false, date: new Date(Date.UTC(2021, 10, 11, 12, 13, 14)) },
			]),
		)

		const before = readTimestamps(file)
		expect(new Set(before.map((stamp) => stamp.central.join())).size).toBe(2)

		const entries = normalizeZipTimestamps(file, 1_700_000_000)
		expect(entries).toBe(2)

		const after = readTimestamps(file)
		for (const stamp of after) {
			expect(stamp.central).toEqual(stamp.local)
		}
		// 全部条目时间戳一致，且与 SOURCE_DATE_EPOCH 对应
		expect(new Set(after.map((stamp) => stamp.central.join())).size).toBe(1)
	})

	it('不同输入时间戳在归一化后字节完全一致（核心契约）', () => {
		const dir = tempDir()
		const a = path.join(dir, 'a.zip')
		const b = path.join(dir, 'b.zip')
		const payload = () => [
			{ name: 'x.txt', data: 'payload-'.repeat(20) },
			{ name: 'y.txt', data: 'other'.repeat(5), stored: false },
		]
		fs.writeFileSync(a, makeZip(payload().map((entry) => ({ ...entry, date: new Date(Date.UTC(2001, 0, 1)) }))))
		fs.writeFileSync(b, makeZip(payload().map((entry) => ({ ...entry, date: new Date(Date.UTC(2024, 5, 6)) }))))
		expect(sha256(fs.readFileSync(a))).not.toBe(sha256(fs.readFileSync(b)))

		normalizeZipTimestamps(a, 1_700_000_000)
		normalizeZipTimestamps(b, 1_700_000_000)
		expect(sha256(fs.readFileSync(a))).toBe(sha256(fs.readFileSync(b)))
	})

	it('幂等：重复归一化不再改变字节', () => {
		const dir = tempDir()
		const file = path.join(dir, 'a.zip')
		fs.writeFileSync(file, makeZip([{ name: 'one.txt', data: 'hello' }]))
		normalizeZipTimestamps(file, 1_700_000_000)
		const first = sha256(fs.readFileSync(file))
		normalizeZipTimestamps(file, 1_700_000_000)
		expect(sha256(fs.readFileSync(file))).toBe(first)
	})

	it('非 ZIP 文件应报错而非静默通过', () => {
		const dir = tempDir()
		const file = path.join(dir, 'not-a-zip.bin')
		fs.writeFileSync(file, 'definitely not a zip')
		expect(() => normalizeZipTimestamps(file, 0)).toThrow(/EOCD/)
	})
})

describe('产物清单与可复现性判定', () => {
	const config = { ...defaultSigningConfig(), configKey: 'sha256:aaa' }
	const toolchain = { key: 'sha256:ttt', rustc: 'rustc 1.90.0', node: 'v24.0.0' }
	const git = { commit: 'abc', dirty: false, tags: [] }

	function makeManifest(artifactHashes, overrides = {}) {
		return {
			manifestVersion: 1,
			generatedAt: '2024-01-01T00:00:00.000Z',
			sourceDateEpoch: 1,
			configKey: config.configKey,
			identityKey: computeIdentityKey(config, collectSigningIdentity(config, { androidCertSha256: 'ff' })),
			source: git,
			toolchain,
			signing: collectSigningIdentity(config, { androidCertSha256: 'ff' }),
			artifacts: Object.entries(artifactHashes).map(([name, sha]) => ({
				name,
				path: name,
				platform: 'android',
				target: 'android',
				kind: 'file',
				size: 1,
				sha256: sha,
				signature: { signed: true, kind: 'apk', certificateSha256: 'ff' },
			})),
			...overrides,
		}
	}

	it('完全一致时判定为 reproducible', () => {
		const a = makeManifest({ 'a.apk': 'h1', 'b.aab': 'h2' })
		const b = makeManifest({ 'a.apk': 'h1', 'b.aab': 'h2' })
		const report = compareManifests(a, b)
		expect(report.verdict).toBe('reproducible')
		expect(report.reproducible).toBe(true)
		expect(report.differences).toEqual([])
	})

	it('配置指纹不同时判定为 config-changed', () => {
		const a = makeManifest({ 'a.apk': 'h1' })
		const b = makeManifest({ 'a.apk': 'h1' }, { configKey: 'sha256:bbb' })
		expect(compareManifests(a, b).verdict).toBe('config-changed')
	})

	it('签名 key 不同时判定为 key-changed', () => {
		const a = makeManifest({ 'a.apk': 'h1' })
		const b = makeManifest(
			{ 'a.apk': 'h1' },
			{ identityKey: computeIdentityKey(config, collectSigningIdentity(config, { androidCertSha256: 'ee' })) },
		)
		expect(compareManifests(a, b).verdict).toBe('key-changed')
	})

	it('工具链不同时判定为 toolchain-changed', () => {
		const a = makeManifest({ 'a.apk': 'h1' })
		const b = makeManifest({ 'a.apk': 'h1' }, { toolchain: { ...toolchain, key: 'sha256:tt2' } })
		expect(compareManifests(a, b).verdict).toBe('toolchain-changed')
	})

	it('输入完全一致但产物字节不同时判定为 artifact-drift', () => {
		const a = makeManifest({ 'a.apk': 'h1', 'b.apk': 'h2' })
		const b = makeManifest({ 'a.apk': 'h1', 'b.apk': 'DIFFERENT' })
		const report = compareManifests(a, b)
		expect(report.verdict).toBe('artifact-drift')
		expect(report.reproducible).toBe(false)
		expect(report.differences).toEqual([
			{ name: 'b.apk', type: 'content', expected: 'h2', actual: 'DIFFERENT', sizeExpected: 1, sizeActual: 1 },
		])
	})

	it('识别缺失与多出的产物', () => {
		const a = makeManifest({ 'a.apk': 'h1', 'gone.apk': 'h3' })
		const b = makeManifest({ 'a.apk': 'h1', 'extra.apk': 'h4' })
		const report = compareManifests(a, b)
		expect(report.verdict).toBe('artifact-drift')
		expect(report.differences.map((difference) => [difference.name, difference.type])).toEqual(
			expect.arrayContaining([
				['gone.apk', 'missing'],
				['extra.apk', 'unexpected'],
			]),
		)
	})

	it('comparableProjection 剔除时间戳且按名字排序', () => {
		const projection = comparableProjection(makeManifest({ 'z.apk': 'h1', 'a.apk': 'h2' }))
		expect(Object.keys(projection)).toEqual(['configKey', 'identityKey', 'toolchainKey', 'artifacts'])
		expect(projection.artifacts.map((artifact) => artifact.name)).toEqual(['a.apk', 'z.apk'])
	})

	it('buildManifest 记录 configKey / identityKey / 工具链与产物哈希', () => {
		const dir = tempDir()
		const artifact = path.join(dir, 'demo.apk')
		fs.writeFileSync(artifact, 'fake apk content')
		const manifest = buildManifest({
			config,
			artifactPaths: [artifact],
			toolchain,
			git,
			signingIdentity: collectSigningIdentity(config, { androidCertSha256: 'ff' }),
			sourceDateEpoch: 42,
		})
		expect(manifest.sourceDateEpoch).toBe(42)
		expect(manifest.configKey).toBe(config.configKey)
		expect(manifest.artifacts).toHaveLength(1)
		expect(manifest.artifacts[0].sha256).toBe(sha256('fake apk content'))
		expect(manifest.identityKey).toMatch(/^sha256:/)
	})
})

describe('目录型产物哈希', () => {
	it('与文件系统遍历顺序无关', () => {
		const a = tempDir()
		const b = tempDir()
		for (const dir of [a, b]) {
			fs.mkdirSync(path.join(dir, 'Contents', 'MacOS'), { recursive: true })
			fs.writeFileSync(path.join(dir, 'Contents', 'MacOS', 'app'), 'binary')
			fs.writeFileSync(path.join(dir, 'Contents', 'Info.plist'), '<plist/>')
		}
		// 用不同顺序创建同名文件，哈希仍应一致
		const c = tempDir()
		fs.mkdirSync(path.join(c, 'Contents', 'MacOS'), { recursive: true })
		fs.writeFileSync(path.join(c, 'Contents', 'Info.plist'), '<plist/>')
		fs.writeFileSync(path.join(c, 'Contents', 'MacOS', 'app'), 'binary')

		expect(hashDirectory(a).sha256).toBe(hashDirectory(c).sha256)
		expect(hashDirectory(a).fileCount).toBe(2)

		fs.writeFileSync(path.join(b, 'Contents', 'Info.plist'), '<plist changed/>')
		expect(hashDirectory(b).sha256).not.toBe(hashDirectory(a).sha256)
	})
})

describe('Android 产物路径与未签名守卫', () => {
	it('从 AGP 输出路径解析 ABI 目录名（用于避免重名覆盖）', () => {
		expect(resolveAbiSlug('/x/gen/android/app/build/outputs/apk/arm64/release/app-arm64-release.apk')).toBe('arm64')
		expect(
			resolveAbiSlug('/x/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk'),
		).toBe('universal')
		expect(
			resolveAbiSlug('/x/gen/android/app/build/outputs/bundle/universalRelease/app-universal-release.aab'),
		).toBe('universal')
		// 老版 AGP 没有 ABI 分层，此时没有 slug 可用，调用方会回落到 --arch
		expect(resolveAbiSlug('/x/gen/android/app/build/outputs/apk/release/app-release.apk')).toBeNull()
	})

	it('识别 -unsigned 产物（签名补丁未生效的硬信号）', () => {
		expect(isUnsignedAndroidArtifact('a/app-arm64-release-unsigned.apk')).toBe(true)
		expect(isUnsignedAndroidArtifact('a/app-universal-release-unsigned.aab')).toBe(true)
		expect(isUnsignedAndroidArtifact('a/app-arm64-release.apk')).toBe(false)
		expect(isUnsignedAndroidArtifact('a/ProofReader-v1.0.0-universal.aab')).toBe(false)
	})
})

describe('JAR/AAB 签名判定', () => {
	it('listZipEntries 能列出归档条目', () => {
		const dir = tempDir()
		const file = path.join(dir, 'a.zip')
		fs.writeFileSync(file, makeZip([{ name: 'one.txt', data: 'a' }, { name: 'dir/two.txt', data: 'b' }]))
		expect(listZipEntries(file).map((entry) => entry.name)).toEqual(['one.txt', 'dir/two.txt'])
	})

	it('没有 META-INF/*.SF 的归档判定为未签名（不依赖 jarsigner 的本地化输出）', () => {
		const dir = tempDir()
		const file = path.join(dir, 'unsigned.aab')
		fs.writeFileSync(file, makeZip([{ name: 'base/manifest.xml', data: '<x/>' }]))
		const result = verifyJarSignature(file)
		expect(result.signed).toBe(false)
		expect(result.detail).toMatch(/META-INF/)
	})

	it('存在签名条目时至少不会被判为"无签名条目"', () => {
		const dir = tempDir()
		const file = path.join(dir, 'signed-ish.aab')
		fs.writeFileSync(
			file,
			makeZip([
				{ name: 'base/manifest.xml', data: '<x/>' },
				{ name: 'META-INF/CERT.SF', data: 'Signature-Version: 1.0' },
				{ name: 'META-INF/CERT.RSA', data: 'fake-bytes' },
			]),
		)
		const result = verifyJarSignature(file)
		expect(result.signatureFiles).toEqual(['META-INF/CERT.SF', 'META-INF/CERT.RSA'])
		// 伪造的签名条目不可能通过 jarsigner 校验
		expect(result.signed).toBe(false)
	})
})

describe('Android keystore 类型识别', () => {
	it('通过文件头区分 JKS 与 PKCS12', () => {
		const dir = tempDir()
		const jks = path.join(dir, 'a.jks')
		const p12 = path.join(dir, 'a.p12')
		// JKS magic = 0xFEEDFEED；PKCS12 = DER SEQUENCE(0x30 0x82 ...)
		fs.writeFileSync(jks, Buffer.from([0xfe, 0xed, 0xfe, 0xed, 0x00, 0x00]))
		fs.writeFileSync(p12, Buffer.from([0x30, 0x82, 0x01, 0x00, 0x02, 0x01]))
		expect(detectKeystoreType(jks)).toBe('JKS')
		expect(detectKeystoreType(p12)).toBe('PKCS12')
	})

	it('非 keystore 文件与不存在的文件返回 null（不猜）', () => {
		const dir = tempDir()
		const bogus = path.join(dir, 'plain.txt')
		fs.writeFileSync(bogus, 'hello world')
		expect(detectKeystoreType(bogus)).toBeNull()
		expect(detectKeystoreType(path.join(dir, 'missing.jks'))).toBeNull()
	})
})

describe('构建期 tauri 配置覆盖（--config 注入）', () => {
	const base = () => {
		const config = defaultSigningConfig()
		config.app = { productName: 'Proof Reader', identifier: 'cn.helilab.proofreader', version: '1.0.0' }
		return config
	}

	it('未配置任何签名时返回空对象（不注入无意义的 --config）', () => {
		const config = base()
		config.windows = { ...config.windows, mode: 'none' }
		config.updater = { ...config.updater, enabled: false }
		expect(buildTauriBuildOverrides(config, { env: {} })).toEqual({})
	})

	it('pfx 模式读取 config 中的指纹', () => {
		const config = base()
		config.windows = { ...config.windows, mode: 'pfx', certificateThumbprint: 'AABB' }
		expect(buildTauriBuildOverrides(config, { env: {} })).toEqual({
			bundle: { windows: { certificateThumbprint: 'AABB' } },
		})
	})

	it('环境变量里的指纹优先于 config（CI 导入 pfx 后才知道真实指纹）', () => {
		const config = base()
		config.windows = { ...config.windows, mode: 'pfx', certificateThumbprint: 'FROM_CONFIG' }
		const overrides = buildTauriBuildOverrides(config, {
			env: { DSH_WINDOWS_CERT_THUMBPRINT: 'FROM_CI' },
		})
		expect(overrides.bundle.windows.certificateThumbprint).toBe('FROM_CI')
	})

	it('pfx 模式缺少指纹时不注入（否则 Tauri 会因为找不到证书而失败）', () => {
		const config = base()
		config.windows = { ...config.windows, mode: 'pfx', certificateThumbprint: '' }
		expect(buildTauriBuildOverrides(config, { env: {} })).toEqual({})
	})

	it('azure 模式生成 signCommand 对象形式，并保留 %1 占位符', () => {
		const config = base()
		config.windows = {
			...config.windows,
			mode: 'azure-trusted-signing',
			azureTrustedSigning: {
				endpoint: 'https://eus.codesigning.azure.net/',
				account: 'acct',
				certificateProfile: 'prof',
				description: 'Proof Reader',
				cliVersion: '0.4.0',
			},
		}
		const signCommand = buildTauriBuildOverrides(config, { env: {} }).bundle.windows.signCommand
		// 必须是对象形式：字符串形式会被 Tauri 按空格拆分，而描述里含空格
		expect(signCommand.cmd).toBe('trusted-signing-cli')
		expect(signCommand.args).toContain('%1')
		expect(signCommand.args).toContain('https://eus.codesigning.azure.net/')
		expect(signCommand.args).toContain('Proof Reader')
		// certificateThumbprint 不应与 signCommand 同时出现
		expect(buildTauriBuildOverrides(config, { env: {} }).bundle.windows.certificateThumbprint).toBeUndefined()
	})

	it('updater 私钥可用时才注入 createUpdaterArtifacts（否则会让无密钥构建直接失败）', () => {
		const config = base()
		config.windows = { ...config.windows, mode: 'none' }
		expect(buildTauriBuildOverrides(config, { updaterKeyAvailable: false })).toEqual({})
		expect(buildTauriBuildOverrides(config, { updaterKeyAvailable: true })).toEqual({
			bundle: { createUpdaterArtifacts: true },
		})
	})

	it('updater 与 Windows 签名可以同时注入', () => {
		const config = base()
		config.windows = { ...config.windows, mode: 'pfx', certificateThumbprint: 'AABB' }
		const overrides = buildTauriBuildOverrides(config, { env: {}, updaterKeyAvailable: true })
		expect(overrides.bundle.createUpdaterArtifacts).toBe(true)
		expect(overrides.bundle.windows.certificateThumbprint).toBe('AABB')
	})
})

describe('Secrets 配方（获取 → 写入）', () => {
	const config = () => {
		const value = defaultSigningConfig()
		value.app = { productName: 'Proof Reader', identifier: 'cn.helilab.proofreader', version: '1.0.0' }
		return value
	}
	const byName = (entries) => new Map(entries.map((entry) => [entry.name, entry]))

	it('每个条目都带用途、获取途径与写入命令（清单本身就是引导）', () => {
		for (const entry of buildSecretEntries({ config: config(), env: {}, platform: 'darwin' })) {
			expect(entry.name).toMatch(/^[A-Z0-9_]+$/)
			expect(entry.purpose).toBeTruthy()
			expect(entry.howTo).toBeTruthy()
			expect(entry.writeCommand ?? '').toMatch(/gh secret set|/s)
		}
	})

	it('pfx 模式下给出 WINDOWS_CERTIFICATE 而不会出现 AZURE_*', () => {
		const windows = { ...config().windows, mode: 'pfx' }
		const names = [...byName(buildSecretEntries({ config: { ...config(), windows }, env: {}, platform: 'win32' })).keys()]
		expect(names).toContain('WINDOWS_CERTIFICATE')
		expect(names).toContain('WINDOWS_CERTIFICATE_PASSWORD')
		expect(names.some((name) => name.startsWith('AZURE_'))).toBe(false)
	})

	it('azure 模式下给出 6 个 AZURE_* 而不会出现 WINDOWS_CERTIFICATE', () => {
		const windows = {
			...config().windows,
			mode: 'azure-trusted-signing',
			azureTrustedSigning: { endpoint: 'https://e/', account: 'a', certificateProfile: 'p', description: 'd', cliVersion: '' },
		}
		const names = [...byName(buildSecretEntries({ config: { ...config(), windows }, env: {}, platform: 'win32' })).keys()]
		for (const name of [
			'AZURE_TENANT_ID',
			'AZURE_CLIENT_ID',
			'AZURE_CLIENT_SECRET',
			'AZURE_CODE_SIGNING_ENDPOINT',
			'AZURE_CODE_SIGNING_ACCOUNT',
			'AZURE_CODE_SIGNING_CERTIFICATE_PROFILE',
		]) {
			expect(names).toContain(name)
		}
		expect(names).not.toContain('WINDOWS_CERTIFICATE')
	})

	it('APPLE_CERTIFICATE 与 APPLE_CERTIFICATE_PASSWORD 的必需性成对（Tauri 要求两者同时存在）', () => {
		const entries = byName(buildSecretEntries({ config: config(), env: {}, platform: 'darwin' }))
		expect(entries.get('APPLE_CERTIFICATE').required).toBe(true)
		expect(entries.get('APPLE_CERTIFICATE_PASSWORD').required).toBe(true)
	})

	it('base64 产出命令与平台匹配（BSD / GNU / PowerShell）', () => {
		const mac = byName(buildSecretEntries({ config: config(), env: {}, platform: 'darwin' })).get('ANDROID_KEYSTORE_BASE64')
		expect(mac.produceCommand).toContain("tr -d '\\n'")
		const linux = byName(buildSecretEntries({ config: config(), env: {}, platform: 'linux' })).get('ANDROID_KEYSTORE_BASE64')
		expect(linux.produceCommand).toContain('base64 -w0')
		const win = byName(buildSecretEntries({ config: config(), env: {}, platform: 'win32' })).get('ANDROID_KEYSTORE_BASE64')
		expect(win.produceCommand).toContain('[Convert]::ToBase64String')
	})

	it('非机密的已知值用 --body 直传，机密值走隐藏输入（不留 shell 历史）', () => {
		const entries = byName(
			buildSecretEntries({
				config: config(),
				env: { APPLE_ID: 'me@example.com' },
				platform: 'darwin',
			}),
		)
		expect(entries.get('APPLE_ID').writeCommand).toContain('--body')
		expect(entries.get('APPLE_ID').writeCommand).toContain('me@example.com')
		// 口令类不打印明文
		expect(entries.get('ANDROID_KEYSTORE_PASSWORD').writeCommand).toBe('gh secret set ANDROID_KEYSTORE_PASSWORD')
	})

	it('updater 私钥用重定向写入（避免把私钥当参数传）', () => {
		const entries = byName(buildSecretEntries({ config: config(), env: {}, platform: 'linux' }))
		expect(entries.get('TAURI_SIGNING_PRIVATE_KEY').writeCommand).toContain('< .signing/updater.key')
	})
})

describe('平台辅助函数', () => {
	it('escapeRdnValue 转义会破坏 -dname 解析的字符', () => {
		expect(escapeRdnValue('Heli, Lab')).toBe('Heli\\, Lab')
		expect(escapeRdnValue('a+b')).toBe('a\\+b')
		expect(escapeRdnValue('plain')).toBe('plain')
	})

	it('buildDname 跳过空字段并保持顺序', () => {
		const dname = buildDname({
			commonName: 'Heli Lab',
			organizationalUnit: 'Mobile',
			organization: '',
			locality: 'Hangzhou',
			state: '',
			country: 'CN',
		})
		expect(dname).toBe('CN=Heli Lab, OU=Mobile, L=Hangzhou, C=CN')
	})

	it('randomPassword 不含会破坏 properties/shell 的字符且足够长', () => {
		for (let index = 0; index < 20; index += 1) {
			const password = randomPassword(32)
			expect(password).toMatch(/^[A-Za-z0-9_-]+$/)
			expect(password.length).toBeGreaterThanOrEqual(42)
		}
		expect(randomPassword(32)).not.toBe(randomPassword(32))
	})
})
