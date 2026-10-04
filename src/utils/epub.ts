// ============================================================
// EPUB 电子书解析与生成
// ============================================================
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";

/** 解析 EPUB 的结果 */
interface ParsedEpub {
	title?: string;
	text: string;
}

/** 用于生成 EPUB 的章节 */
interface EpubChapter {
	title: string;
	content: string;
}

/** 统一 ZIP 内路径写法（去掉开头的 ./） */
function normalizeZipPath(path: string): string {
	return path.replace(/^\.\//, "");
}

/** 解析相对路径（支持 ../ 与 ./） */
function resolvePath(path: string): string {
	const parts: string[] = [];
	for (const seg of path.split("/")) {
		if (seg === "" || seg === ".") continue;
		if (seg === "..") {
			parts.pop();
		} else {
			parts.push(seg);
		}
	}
	return parts.join("/");
}

/** XML 转义 */
function escapeXml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/** 将 XHTML/HTML 内容转换为纯文本（段落间以空行分隔） */
function extractXhtmlText(html: string): string {
	const doc = new DOMParser().parseFromString(html, "text/html");
	// 移除非正文节点
	doc.querySelectorAll("script, style, head, nav").forEach((el) => el.remove());
	const blocks = doc.querySelectorAll("p, div, h1, h2, h3, h4, h5, h6, li, blockquote, tr");
	if (blocks.length > 0) {
		const lines: string[] = [];
		blocks.forEach((block) => {
			// div 嵌套 p 等块级子元素时会重复收集，跳过外层 div
			if (
				block.tagName === "DIV" &&
				block.querySelector("p, div, h1, h2, h3, h4, h5, h6, li, blockquote")
			) {
				return;
			}
			const text = (block.textContent ?? "").replace(/\s+/g, " ").trim();
			if (text) lines.push(text);
		});
		if (lines.length > 0) return lines.join("\n\n");
	}
	return (doc.body?.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * 解析 EPUB 文件，提取书名与纯文本正文
 * @throws 无法解析出正文内容时抛出异常
 */
export function parseEpub(buffer: ArrayBuffer): ParsedEpub {
	const files = unzipSync(new Uint8Array(buffer));

	const readText = (path: string): string | null => {
		const data = files[normalizeZipPath(path)];
		return data ? strFromU8(data) : null;
	};

	// 1. 通过 container.xml 定位 OPF
	const containerXml = readText("META-INF/container.xml");
	let opfPath = "";
	if (containerXml) {
		const doc = new DOMParser().parseFromString(containerXml, "application/xml");
		opfPath = doc.querySelector("rootfile")?.getAttribute("full-path") ?? "";
	}
	// 兜底：直接在文件列表中查找 .opf
	if (!opfPath) {
		opfPath = Object.keys(files).find((p) => p.toLowerCase().endsWith(".opf")) ?? "";
	}

	let title: string | undefined;
	let spineHrefs: string[] = [];

	// 2. 解析 OPF：书名 + spine 阅读顺序
	const opfXml = opfPath ? readText(opfPath) : null;
	if (opfXml) {
		const doc = new DOMParser().parseFromString(opfXml, "application/xml");
		title = doc.querySelector("metadata > title")?.textContent?.trim() || undefined;
		const manifest = new Map<string, string>();
		doc.querySelectorAll("manifest > item").forEach((item) => {
			const id = item.getAttribute("id");
			const href = item.getAttribute("href");
			if (id && href) manifest.set(id, href);
		});
		const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
		doc.querySelectorAll("spine > itemref").forEach((ref) => {
			const idref = ref.getAttribute("idref");
			const href = idref ? manifest.get(idref) : null;
			if (href) spineHrefs.push(resolvePath(opfDir + href));
		});
	}

	// 3. 兜底：无 spine 时按路径排序收集所有 XHTML/HTML
	if (spineHrefs.length === 0) {
		spineHrefs = Object.keys(files)
			.filter((p) => /\.(xhtml|html)$/i.test(p))
			.sort();
	}

	// 4. 逐文件提取正文
	const chapterTexts: string[] = [];
	for (const href of spineHrefs) {
		const raw = readText(href);
		if (!raw) continue;
		const text = extractXhtmlText(raw);
		if (text.trim()) chapterTexts.push(text.trim());
	}

	const text = chapterTexts.join("\n\n");
	if (!text) {
		throw new Error("EPUB 中未解析到正文内容");
	}
	return { title, text };
}

/**
 * 由章节文本生成 EPUB 电子书二进制
 * @param title 书名
 * @param chapters 章节列表（title 为章节标题，content 为正文，段落以换行分隔）
 */
export function buildEpub(title: string, chapters: EpubChapter[]): Uint8Array {
	const uid = `novel-proofreader-${Date.now()}`;
	const chapterFiles: Record<string, Uint8Array> = {};
	const navItems: string[] = [];
	const manifestItems: string[] = [];
	const spineItems: string[] = [];

	chapters.forEach((ch, i) => {
		const fileName = `ch${String(i + 1).padStart(3, "0")}.xhtml`;
		const paras = ch.content
			.split("\n")
			.filter((p) => p.trim() !== "")
			.map((p) => `    <p>${escapeXml(p.trim())}</p>`)
			.join("\n");
		chapterFiles[`OEBPS/${fileName}`] = strToU8(`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh">
<head>
  <title>${escapeXml(ch.title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <h1>${escapeXml(ch.title)}</h1>
${paras}
</body>
</html>`);
		navItems.push(`      <li><a href="${fileName}">${escapeXml(ch.title)}</a></li>`);
		manifestItems.push(`    <item id="ch${i + 1}" href="${fileName}" media-type="application/xhtml+xml"/>`);
		spineItems.push(`    <itemref idref="ch${i + 1}"/>`);
	});

	const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
		// mimetype 必须是第一个条目且不压缩（EPUB 规范要求）
		mimetype: [strToU8("application/epub+zip"), { level: 0 }],
		"META-INF/container.xml": strToU8(`<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`),
		"OEBPS/style.css": strToU8("body { line-height: 1.8; margin: 1em; }\nh1 { text-align: center; font-size: 1.3em; }"),
		"OEBPS/nav.xhtml": strToU8(`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh">
<head>
  <title>目录</title>
</head>
<body>
  <nav epub:type="toc">
    <h1>目录</h1>
    <ol>
${navItems.join("\n")}
    </ol>
  </nav>
</body>
</html>`),
		"OEBPS/content.opf": strToU8(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">${escapeXml(uid)}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:language>zh</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, "Z")}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="style.css" media-type="text/css"/>
${manifestItems.join("\n")}
  </manifest>
  <spine>
${spineItems.join("\n")}
  </spine>
</package>`),
		...chapterFiles,
	};

	return zipSync(files, {
		level: 6,
		mtime: new Date(),
	});
}
