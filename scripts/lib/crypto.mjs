/**
 * 哈希 / 编码 / 规范化 JSON。
 *
 * 配置指纹是「同一份 signing.config.json ⇒ 产物逐字节一致」判断的事实来源：
 * 递归按 key 排序后序列化，保证同一逻辑配置永远得到同一串字节。
 */

import { createHash } from "node:crypto";
import fs from "node:fs";

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

export function base64EncodeFile(filePath) {
	return fs.readFileSync(filePath).toString("base64");
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
