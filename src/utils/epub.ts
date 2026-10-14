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

/** EPUB 附录数据（角色信息、大事记等） */
export interface EpubAppendix {
	/** 角色信息列表 */
	characters?: Array<{
		name: string;
		gender?: string;
		role?: string;
		age?: string;
		identity?: string;
		personality?: string;
		appearance?: string;
		background?: string;
		notes?: string;
	}>;
	/** 大事记列表 */
	events?: Array<{
		title: string;
		description: string;
		timeInfo?: string;
		chapter?: string;
		volume?: string;
	}>;
	/** 角色关系列表 */
	relationships?: Array<{
		sourceName: string;
		targetName: string;
		relationTypes: string[];
		sourceNicknames: string[];
		targetNicknames: string[];
	}>;
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
 * @param appendix 附录数据（角色信息、大事记等），会附加到文档最后
 */
export function buildEpub(title: string, chapters: EpubChapter[], appendix?: EpubAppendix): Uint8Array {
	const uid = `novel-proofreader-${Date.now()}`;
	const chapterFiles: Record<string, Uint8Array> = {};
	const navItems: string[] = [];
	const manifestItems: string[] = [];
	const spineItems: string[] = [];

	// 正文目录页面（toc.xhtml），点击章节标题跳转对应位置
	const tocLinks: string[] = [];

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
		tocLinks.push(`    <p><a href="${fileName}">${escapeXml(ch.title)}</a></p>`);
	});

	// 附录：角色信息
	if (appendix?.characters && appendix.characters.length > 0) {
		const fileName = "appendix-characters.xhtml";
		const items = appendix.characters
			.map((c) => {
				const fields = [
					c.gender && `<p><strong>性别：</strong>${escapeXml(c.gender)}</p>`,
					c.role && `<p><strong>类型：</strong>${escapeXml(c.role)}</p>`,
					c.age && `<p><strong>年龄：</strong>${escapeXml(c.age)}</p>`,
					c.identity && `<p><strong>身份：</strong>${escapeXml(c.identity)}</p>`,
					c.personality && `<p><strong>性格：</strong>${escapeXml(c.personality)}</p>`,
					c.appearance && `<p><strong>外貌：</strong>${escapeXml(c.appearance)}</p>`,
					c.background && `<p><strong>背景：</strong>${escapeXml(c.background)}</p>`,
					c.notes && `<p><strong>小传：</strong>${escapeXml(c.notes)}</p>`,
				].filter(Boolean);
				return `  <h2>${escapeXml(c.name)}</h2>\n${fields.join("\n")}`;
			})
			.join("\n");
		chapterFiles[`OEBPS/${fileName}`] = strToU8(`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh">
<head>
  <title>角色信息</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <h1>附录：角色信息</h1>
${items}
</body>
</html>`);
		navItems.push(`      <li><a href="${fileName}">附录：角色信息</a></li>`);
		manifestItems.push(`    <item id="appendix-characters" href="${fileName}" media-type="application/xhtml+xml"/>`);
		spineItems.push(`    <itemref idref="appendix-characters"/>`);
		tocLinks.push(`    <p><a href="${fileName}">附录：角色信息</a></p>`);
	}

	// 附录：大事记
	if (appendix?.events && appendix.events.length > 0) {
		const fileName = "appendix-events.xhtml";
		const items = appendix.events
			.map((e) => {
				const meta = [
					e.volume && `[${escapeXml(e.volume)}]`,
					e.chapter && `[${escapeXml(e.chapter)}]`,
					e.timeInfo && `[${escapeXml(e.timeInfo)}]`,
				].filter(Boolean).join(" ");
				return `  <h2>${escapeXml(e.title)}</h2>\n  ${meta ? `<p class="meta">${meta}</p>` : ""}\n  <p>${escapeXml(e.description)}</p>`;
			})
			.join("\n");
		chapterFiles[`OEBPS/${fileName}`] = strToU8(`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh">
<head>
  <title>小说大事记</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <h1>附录：小说大事记</h1>
${items}
</body>
</html>`);
		navItems.push(`      <li><a href="${fileName}">附录：小说大事记</a></li>`);
		manifestItems.push(`    <item id="appendix-events" href="${fileName}" media-type="application/xhtml+xml"/>`);
		spineItems.push(`    <itemref idref="appendix-events"/>`);
		tocLinks.push(`    <p><a href="${fileName}">附录：小说大事记</a></p>`);
	}

	// 附录：角色关系
	if (appendix?.relationships && appendix.relationships.length > 0) {
		const fileName = "appendix-relationships.xhtml";
		const items = appendix.relationships
			.map((r) => {
				const parts: string[] = [];
				parts.push(`  <h2>${escapeXml(r.sourceName)} ↔ ${escapeXml(r.targetName)}</h2>`);
				if (r.relationTypes.length > 0) {
					parts.push(`  <p><strong>关系：</strong>${escapeXml(r.relationTypes.join("、"))}</p>`);
				}
				if (r.sourceNicknames.length > 0) {
					parts.push(`  <p><strong>${escapeXml(r.sourceName)} 称呼 ${escapeXml(r.targetName)}：</strong>${escapeXml(r.sourceNicknames.join("、"))}</p>`);
				}
				if (r.targetNicknames.length > 0) {
					parts.push(`  <p><strong>${escapeXml(r.targetName)} 称呼 ${escapeXml(r.sourceName)}：</strong>${escapeXml(r.targetNicknames.join("、"))}</p>`);
				}
				return parts.join("\n");
			})
			.join("\n");
		chapterFiles[`OEBPS/${fileName}`] = strToU8(`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh">
<head>
  <title>角色关系</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <h1>附录：角色关系</h1>
${items}
</body>
</html>`);
		navItems.push(`      <li><a href="${fileName}">附录：角色关系</a></li>`);
		manifestItems.push(`    <item id="appendix-relationships" href="${fileName}" media-type="application/xhtml+xml"/>`);
		spineItems.push(`    <itemref idref="appendix-relationships"/>`);
		tocLinks.push(`    <p><a href="${fileName}">附录：角色关系</a></p>`);
	}

	// 生成正文目录页面（toc.xhtml），放在正文之前
	const tocContent = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh">
<head>
  <title>目录</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <h1>目录</h1>
${tocLinks.join("\n")}
</body>
</html>`;
	chapterFiles["OEBPS/toc.xhtml"] = strToU8(tocContent);
	// 将目录页面插入到 manifest 和 spine 的最前面（正文之前）
	manifestItems.unshift(`    <item id="toc" href="toc.xhtml" media-type="application/xhtml+xml"/>`);
	spineItems.unshift(`    <itemref idref="toc"/>`);

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
