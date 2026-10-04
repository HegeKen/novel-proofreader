/**
 * 终端输出：统一的颜色日志。
 *
 * TTY 下上色，NO_COLOR 或重定向时输出纯文本。
 */

const COLOR_ENABLED = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

const ANSI = {
	reset: "\u001b[0m",
	bold: "\u001b[1m",
	dim: "\u001b[2m",
	red: "\u001b[31m",
	green: "\u001b[32m",
	yellow: "\u001b[33m",
	blue: "\u001b[34m",
	cyan: "\u001b[36m",
};

function paint(color, text) {
	if (!COLOR_ENABLED) return text;
	return `${ANSI[color]}${text}${ANSI.reset}`;
}

export const log = {
	title: (text) => console.log(`\n${paint("bold", text)}`),
	step: (text) => console.log(`${paint("cyan", "▸")} ${text}`),
	info: (text) => console.log(`  ${text}`),
	dim: (text) => console.log(`  ${paint("dim", text)}`),
	ok: (text) => console.log(`${paint("green", "✓")} ${text}`),
	warn: (text) => console.warn(`${paint("yellow", "!")} ${text}`),
	fail: (text) => console.error(`${paint("red", "✗")} ${text}`),
	raw: (text) => console.log(text),
};
