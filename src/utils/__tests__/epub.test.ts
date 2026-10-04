// ============================================================
// EPUB 生成与解析的往返测试
// ============================================================
import { describe, it, expect } from "vitest";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { buildEpub, parseEpub } from "../epub";

describe("epub", () => {
	const chapters = [
		{ title: "第一章 风起", content: "林晚站在村口的老槐树下。\n风吹过田野，带来远处的钟声。" },
		{ title: "第二章 云涌", content: "客栈里人声鼎沸。\n说书先生一拍醒木：\"且听下回分解。\"" },
	];

	it("生成的 EPUB 结构符合规范", () => {
		const data = buildEpub("测试小说", chapters);
		const files = unzipSync(data);
		// mimetype 必须是第一个条目
		expect(Object.keys(files)[0]).toBe("mimetype");
		expect(strFromU8(files.mimetype)).toBe("application/epub+zip");
		expect(files["META-INF/container.xml"]).toBeDefined();
		expect(files["OEBPS/content.opf"]).toBeDefined();
		expect(files["OEBPS/nav.xhtml"]).toBeDefined();
		expect(files["OEBPS/ch001.xhtml"]).toBeDefined();
		expect(files["OEBPS/ch002.xhtml"]).toBeDefined();
		// OPF 包含书名与两个 spine 条目
		const opf = strFromU8(files["OEBPS/content.opf"]);
		expect(opf).toContain("<dc:title>测试小说</dc:title>");
		expect(opf.match(/<itemref /g)?.length).toBe(2);
	});

	it("生成后可解析回原文（往返一致）", () => {
		const data = buildEpub("测试小说", chapters);
		const parsed = parseEpub(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
		expect(parsed.title).toBe("测试小说");
		expect(parsed.text).toContain("林晚站在村口的老槐树下。");
		expect(parsed.text).toContain("风吹过田野，带来远处的钟声。");
		expect(parsed.text).toContain("客栈里人声鼎沸。");
		expect(parsed.text).toContain("且听下回分解。");
		// 章节标题保留在正文中，便于导入后按标题重新分章
		expect(parsed.text).toContain("第一章 风起");
		expect(parsed.text).toContain("第二章 云涌");
	});

	it("特殊字符（XML 敏感字符）在导出导入后保持不变", () => {
		const special = [
			{ title: "特殊字符", content: "他笑着说：\"<你好> & 再见\"。\nA < B，B > C。" },
		];
		const data = buildEpub("特殊&书名", special);
		const parsed = parseEpub(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
		expect(parsed.title).toBe("特殊&书名");
		expect(parsed.text).toContain("\"<你好> & 再见\"");
		expect(parsed.text).toContain("A < B，B > C。");
	});

	it("无任何 XHTML 正文时抛出异常", () => {
		// 构造一个只有元数据、没有正文文件的 EPUB
		const data = zipSync({
			mimetype: [strToU8("application/epub+zip"), { level: 0 as const }],
			"META-INF/container.xml": strToU8(
				'<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
			),
			"OEBPS/content.opf": strToU8(
				'<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">x</dc:identifier><dc:title>空书</dc:title><dc:language>zh</dc:language></metadata><manifest></manifest><spine></spine></package>',
			),
		});
		expect(() =>
			parseEpub(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer),
		).toThrow();
	});
});
