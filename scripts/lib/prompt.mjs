/**
 * 极简交互提示器（零依赖）。
 *
 * 支持两种模式：
 *   - 交互模式：TTY 下逐项询问，用于"配置引导"。
 *   - 非交互模式：CI / 管道 / --yes 下，用默认值或环境变量推导，绝不阻塞。
 */

import readline from "node:readline/promises";
import process from "node:process";
import { log } from "./core.mjs";

class CancelledError extends Error {
	constructor() {
		super("用户取消");
		this.name = "CancelledError";
	}
}

export { CancelledError };

export function createPrompter({ interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY), yes = false } = {}) {
	let rl = null;

	const ensureReadline = () => {
		if (!rl) rl = readline.createInterface({ input: process.stdin, output: process.stdout });
		return rl;
	};

	const close = () => {
		if (rl) {
			rl.close();
			rl = null;
		}
	};

	const ask = async (message, defaultValue) => {
		if (!interactive) return defaultValue;
		const suffix = defaultValue !== undefined && defaultValue !== "" ? ` (${defaultValue})` : "";
		const answer = (await ensureReadline().question(`${message}${suffix}: `)).trim();
		return answer === "" ? defaultValue : answer;
	};

	/** 文本输入。nonInteractive 时回落到 envOverride -> defaultValue，仍为空则抛错。 */
	const text = async ({ message, defaultValue = "", envVar, required = false, hint }) => {
		if (hint) log.dim(hint);
		let value = await ask(message, defaultValue);
		if ((value === undefined || value === "") && envVar && process.env[envVar]) {
			value = process.env[envVar];
		}
		if (required && (value === undefined || value === "")) {
			if (!interactive) {
				throw new Error(`非交互模式下缺少必填项 ${message}，请通过 ${envVar ?? "命令行参数"} 提供`);
			}
			log.warn("该项必填，请重新输入");
			return text({ message, defaultValue, envVar, required, hint });
		}
		return value ?? "";
	};

	/** 密码输入（不回显）。非交互时优先读环境变量。 */
	const password = async ({ message, envVar }) => {
		if (envVar && process.env[envVar]) return process.env[envVar];
		if (!interactive) return "";
		const prompt = `${message}: `;
		const input = process.stdin;
		const output = process.stdout;
		if (!input.isTTY) {
			const answer = await ask(message);
			return answer ?? "";
		}
		output.write(prompt);
		const wasRaw = input.isRaw;
		input.setRawMode?.(true);
		input.resume();
		let buffer = "";
		return new Promise((resolve, reject) => {
			const onData = (chunk) => {
				const char = chunk.toString("utf8");
				for (const ch of char) {
					if (ch === "\r" || ch === "\n") {
						cleanup();
						output.write("\n");
						resolve(buffer);
						return;
					}
					if (ch === "\u0003") {
						cleanup();
						output.write("\n");
						reject(new CancelledError());
						return;
					}
					if (ch === "\u007f" || ch === "\b") {
						if (buffer.length > 0) {
							buffer = buffer.slice(0, -1);
							output.write("\b \b");
						}
						continue;
					}
					buffer += ch;
					output.write("*");
				}
			};
			const cleanup = () => {
				input.removeListener("data", onData);
				input.setRawMode?.(wasRaw ?? false);
				input.pause();
			};
			input.on("data", onData);
		});
	};

	/**
	 * 是否确认。
	 * 注意：yes（--yes）模式下返回 defaultValue 而不是恒为 true —— --yes 的语义是
	 * "采用推荐值"，不能把"是否覆盖已有 keystore"这类破坏性提问自动变成"是"。
	 */
	const confirm = async ({ message, defaultValue = true }) => {
		if (yes) return defaultValue;
		if (!interactive) return defaultValue;
		const hint = defaultValue ? "Y/n" : "y/N";
		const answer = (await ensureReadline().question(`${message} [${hint}]: `)).trim().toLowerCase();
		if (answer === "") return defaultValue;
		return answer === "y" || answer === "yes" || answer === "是";
	};

	/** 单选。返回选项的 value。 */
	const select = async ({ message, options, defaultValue }) => {
		const fallback = defaultValue ?? options[0]?.value;
		if (yes || !interactive) return fallback;
		log.raw("");
		log.raw(`  ${message}`);
		options.forEach((option, index) => {
			const marker = option.value === fallback ? " (默认)" : "";
			log.raw(`    ${index + 1}) ${option.label}${marker}${option.description ? `  — ${option.description}` : ""}`);
		});
		const answer = (await ensureReadline().question("  请选择编号: ")).trim();
		if (answer === "") return fallback;
		const picked = options[Number(answer) - 1] ?? options.find((option) => option.value === answer);
		return picked ? picked.value : fallback;
	};

	return { interactive, yes, text, password, confirm, select, close, note: log.info };
}
