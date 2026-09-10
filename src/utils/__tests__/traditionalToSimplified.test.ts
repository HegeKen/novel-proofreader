// ============================================================
// 繁体字 → 简体字转换工具测试
// ============================================================
import { describe, it, expect } from "vitest";
import { convertTraditionalToSimplified, scanTraditionalChars } from "../traditionalToSimplified";

describe("convertTraditionalToSimplified", () => {
	it("将繁体文本转换为简体文本", () => {
		expect(convertTraditionalToSimplified("繁體字測試")).toBe("繁体字测试");
		expect(convertTraditionalToSimplified("我們很高興見到你")).toBe("我们很高兴见到你");
	});

	it("简体文本保持不变", () => {
		expect(convertTraditionalToSimplified("简体文本测试")).toBe("简体文本测试");
	});

	it("空文本原样返回", () => {
		expect(convertTraditionalToSimplified("")).toBe("");
	});
});

describe("scanTraditionalChars", () => {
	it("统计文本中的繁体字、对应简体字及次数", () => {
		const result = scanTraditionalChars("繁體字測試繁體");
		expect(result).toHaveLength(3);
		const byVariant = Object.fromEntries(result.map((e) => [e.variant, e]));
		expect(byVariant["體"]).toMatchObject({ standard: "体", count: 2 });
		expect(byVariant["測"]).toMatchObject({ standard: "测", count: 1 });
		expect(byVariant["試"]).toMatchObject({ standard: "试", count: 1 });
	});

	it("无繁体字时返回空数组", () => {
		expect(scanTraditionalChars("简体文本")).toEqual([]);
		expect(scanTraditionalChars("")).toEqual([]);
	});

	it("结果按出现次数降序排列", () => {
		const result = scanTraditionalChars("體體體測測試");
		expect(result[0]).toMatchObject({ variant: "體", count: 3 });
		expect(result[1]).toMatchObject({ variant: "測", count: 2 });
		expect(result[2]).toMatchObject({ variant: "試", count: 1 });
	});
});
