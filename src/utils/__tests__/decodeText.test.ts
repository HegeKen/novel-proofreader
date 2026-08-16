import { describe, it, expect } from "vitest";
import { decodeTextBuffer } from "../decodeText";

function utf8Bytes(s: string): Uint8Array {
	return new TextEncoder().encode(s);
}

function utf16Bytes(s: string, le: boolean): Uint8Array {
	const arr: number[] = le ? [0xff, 0xfe] : [0xfe, 0xff];
	for (const ch of s) {
		const code = ch.codePointAt(0)!;
		if (le) {
			arr.push(code & 0xff, (code >> 8) & 0xff);
		} else {
			arr.push((code >> 8) & 0xff, code & 0xff);
		}
	}
	return new Uint8Array(arr);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	// 显式拷贝，确保返回 ArrayBuffer 而非 SharedArrayBuffer-like
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe("decodeTextBuffer", () => {
	it("decodes UTF-8 with BOM", () => {
		const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8Bytes("测试文本")]);
		expect(decodeTextBuffer(toArrayBuffer(bytes))).toBe("测试文本");
	});

	it("decodes plain UTF-8", () => {
		const bytes = utf8Bytes("你好世界 Hello");
		expect(decodeTextBuffer(toArrayBuffer(bytes))).toBe("你好世界 Hello");
	});

	it("decodes UTF-16 LE with BOM", () => {
		expect(decodeTextBuffer(toArrayBuffer(utf16Bytes("中文UTF16", true)))).toBe("中文UTF16");
	});

	it("decodes UTF-16 BE with BOM", () => {
		expect(decodeTextBuffer(toArrayBuffer(utf16Bytes("中文BE", false)))).toBe("中文BE");
	});

	it("tolerates few bad bytes in UTF-8", () => {
		const base = utf8Bytes("正常文本和一些内容");
		const mixed = new Uint8Array([...base.slice(0, 12), 0xff, 0xfe, ...base.slice(12)]);
		const result = decodeTextBuffer(toArrayBuffer(mixed));
		// 中文内容应保留（坏字节替换为替换符）
		expect(result).toContain("正常文本");
	});

	it("handles empty buffer", () => {
		expect(decodeTextBuffer(new ArrayBuffer(0))).toBe("");
	});
});
