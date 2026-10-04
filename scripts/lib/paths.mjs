/**
 * 路径常量与路径解析辅助。
 *
 * 所有脚本共享的「项目根 / 签名配置 / 签名状态目录」唯一定义处，
 * 其余模块一律从这里取路径，不再各自拼。
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

export const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..", "..");

export const SIGNING_CONFIG_PATH = path.join(PROJECT_ROOT, "signing.config.json");
/** 私钥、keystore、导出的 base64 都放这里，已被 .gitignore 忽略。 */
export const SIGNING_STATE_DIR = path.join(PROJECT_ROOT, ".signing");
export const SIGNING_ENV_PATH = path.join(SIGNING_STATE_DIR, "signing.env");
export const SECRETS_CHECKLIST_PATH = path.join(SIGNING_STATE_DIR, "github-secrets.md");
export const SECRETS_DOTENV_PATH = path.join(SIGNING_STATE_DIR, "github-secrets.env");

export function resolveFromRoot(relativeOrAbsolute, root = PROJECT_ROOT) {
	return path.isAbsolute(relativeOrAbsolute) ? relativeOrAbsolute : path.join(root, relativeOrAbsolute);
}

export function relativeToRoot(target, root = PROJECT_ROOT) {
	return path.relative(root, target).split(path.sep).join("/");
}
