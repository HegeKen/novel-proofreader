// ============================================================
// 语言检测与英文文本规范化的单元测试
// ============================================================
import { describe, it, expect } from "vitest";
import {
	detectNovelLanguage,
	stripIndentMarkers,
	needsSoftWrapReflow,
	reflowSoftWrappedText,
	prepareNovelText,
} from "../language";

describe("detectNovelLanguage", () => {
	it("中文正文判为 zh", () => {
		expect(detectNovelLanguage("他站在村口，望着远处的山。".repeat(50))).toBe("zh");
	});

	it("英文正文判为 en", () => {
		expect(detectNovelLanguage("He stood at the village gate and looked at the hills. ".repeat(50))).toBe("en");
	});

	it("含少量英文术语的中文小说仍判为 zh", () => {
		expect(detectNovelLanguage("他打开 MacBook，运行 macOS 上的软件。".repeat(50))).toBe("zh");
	});

	it("空文本按英文处理（无 CJK 字符）", () => {
		expect(detectNovelLanguage("")).toBe("en");
	});
});

describe("stripIndentMarkers", () => {
	it("剥离行首 ¡¡¡¡ 及其后的空白", () => {
		expect(stripIndentMarkers("¡¡¡¡CHAPTER ONE\n¡¡¡¡  The boy lived")).toBe("CHAPTER ONE\nThe boy lived");
	});

	it("不影响正文中间的 ¡", () => {
		expect(stripIndentMarkers("He yelled ¡Hola! at the crowd.")).toBe("He yelled ¡Hola! at the crowd.");
	});
});

describe("软换行重排", () => {
	it("识别按宽度折行的英文文本", () => {
		const text = Array.from({ length: 100 }, (_, i) => `short line number ${i}`).join("\n\n");
		expect(needsSoftWrapReflow(text)).toBe(true);
	});

	it("一行一段的排版不触发重排", () => {
		const line = "他站在村口望着远处的山，风从田野上吹过。".repeat(3);
		expect(needsSoftWrapReflow(Array.from({ length: 100 }, () => line).join("\n"))).toBe(false);
	});

	it("合并同段落的多行，并保护章节标题", () => {
		const text = [
			"",
			" Chapter One ",
			"The Dark Lord Ascending ",
			"",
			"The man stood",
			"on the hill and",
			"watched the sky.",
			"",
		].join("\n");
		const result = reflowSoftWrappedText(text);
		expect(result).toContain("Chapter One\nThe Dark Lord Ascending");
		expect(result).toContain("The man stood on the hill and watched the sky.");
	});

	it("行尾连字符断词直接拼接", () => {
		const text = ["It was impos-", "sible to tell.", ""].join("\n");
		expect(reflowSoftWrappedText(text)).toBe("It was impossible to tell.");
	});
});

describe("prepareNovelText", () => {
	it("中文文本只统一换行符，不改段落", () => {
		const { text, language } = prepareNovelText("第一段\r\n第二段\r\n");
		expect(language).toBe("zh");
		expect(text).toBe("第一段\n第二段\n");
	});

	it("英文文本清理缩进符并按需重排", () => {
		const { language } = prepareNovelText("¡¡¡¡He ran.\n¡¡¡¡She followed.");
		expect(language).toBe("en");
	});

	it("reflow=false 时英文不重排（供 EPUB 等结构化来源使用）", () => {
		const raw = Array.from({ length: 60 }, (_, i) => `line ${i}a\nline ${i}b`).join("\n\n");
		const withReflow = prepareNovelText(raw);
		const withoutReflow = prepareNovelText(raw, { reflow: false });
		expect(withoutReflow.text).toBe(raw);
		expect(withReflow.text).not.toBe(raw);
	});
});
