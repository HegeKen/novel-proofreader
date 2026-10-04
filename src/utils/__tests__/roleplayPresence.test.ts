// ============================================================
// roleplayPresence 单元测试 — 角色名匹配与邀请/离场意图检测
// ============================================================
import { describe, it, expect } from "vitest";
import { cleanRoleName, matchCharacterByName, detectPresenceIntent } from "../roleplayPresence";
import type { CharacterInfo } from "../../types";

/** 构造最小角色 */
function makeChar(id: string, name: string, aliases?: string[]): CharacterInfo {
	return { id, name, gender: "female", aliases };
}

const linWan = makeChar("c1", "林晚");
const linXiaoWan = makeChar("c2", "林小晚");
const suYao = makeChar("c3", "苏瑶", ["瑶瑶"]);
const zhangQiang = makeChar("c4", "张强");
const ALL = [linWan, linXiaoWan, suYao, zhangQiang];

describe("cleanRoleName", () => {
	it("去除包裹符号与空白", () => {
		expect(cleanRoleName("「林晚」")).toBe("林晚");
		expect(cleanRoleName("《苏瑶》 ")).toBe("苏瑶");
		expect(cleanRoleName("（张强）")).toBe("张强");
	});
});

describe("matchCharacterByName", () => {
	it("姓名精确匹配", () => {
		expect(matchCharacterByName("林晚", ALL)?.id).toBe("c1");
	});

	it("别名精确匹配", () => {
		expect(matchCharacterByName("瑶瑶", ALL)?.id).toBe("c3");
	});

	it("带装饰符号的名字也能匹配", () => {
		expect(matchCharacterByName("「苏瑶」", ALL)?.id).toBe("c3");
	});

	it("后缀匹配：单字名匹配全名（长度差 ≤2）", () => {
		expect(matchCharacterByName("晚", ALL)?.id).toBe("c1");
	});

	it("后缀匹配：扩展名匹配原名（长度差 ≤2）", () => {
		expect(matchCharacterByName("上林晚", ALL)?.id).toBe("c1");
	});

	it("长度差 >2 时拒绝匹配", () => {
		expect(matchCharacterByName("晚", [makeChar("c9", "林小晚儿")])).toBeNull();
	});

	it("不做无限制包含匹配：「林」不匹配「林小晚」", () => {
		const only = [linXiaoWan];
		expect(matchCharacterByName("林", only)).toBeNull();
	});

	it("完全无关的名字返回 null", () => {
		expect(matchCharacterByName("路人甲", ALL)).toBeNull();
	});
});

describe("detectPresenceIntent", () => {
	const present = new Set(["c1"]); // 林晚在场

	it("识别「让XX过来」邀请", () => {
		const { invited, dismissed } = detectPresenceIntent("让苏瑶过来吧", present, ALL);
		expect(invited.map((c) => c.id)).toEqual(["c3"]);
		expect(dismissed).toEqual([]);
	});

	it("识别「叫上/把XX叫来」类邀请", () => {
		const { invited } = detectPresenceIntent("把张强拉过来", present, ALL);
		expect(invited.map((c) => c.id)).toEqual(["c4"]);
	});

	it("识别「XX也来了」邀请", () => {
		const { invited } = detectPresenceIntent("苏瑶也来了", present, ALL);
		expect(invited.map((c) => c.id)).toEqual(["c3"]);
	});

	it("已在场的角色不会重复邀请", () => {
		const { invited } = detectPresenceIntent("让林晚过来", present, ALL);
		expect(invited).toEqual([]);
	});

	it("识别「XX走了」离场", () => {
		const { dismissed } = detectPresenceIntent("林晚走了", present, ALL);
		expect(dismissed.map((c) => c.id)).toEqual(["c1"]);
	});

	it("识别「让XX走」离场", () => {
		const { dismissed } = detectPresenceIntent("让林晚先走吧", present, ALL);
		expect(dismissed.map((c) => c.id)).toEqual(["c1"]);
	});

	it("不在场的角色不产生离场", () => {
		const { dismissed } = detectPresenceIntent("苏瑶走了", present, ALL);
		expect(dismissed).toEqual([]);
	});

	it("否定句式不触发（让XX别过来）", () => {
		const { invited, dismissed } = detectPresenceIntent("让苏瑶别过来", present, ALL);
		expect(invited).toEqual([]);
		expect(dismissed).toEqual([]);
	});

	it("否定句式不触发（XX没走）", () => {
		const { dismissed } = detectPresenceIntent("林晚没走", present, ALL);
		expect(dismissed).toEqual([]);
	});

	it("疑问句不触发（XX走了吗？）", () => {
		const { dismissed } = detectPresenceIntent("林晚走了吗？", present, ALL);
		expect(dismissed).toEqual([]);
	});

	it("趋向动词后接叙述内容时不触发（让林晚来不及反应）", () => {
		const { invited } = detectPresenceIntent("让林晚来不及反应", present, ALL);
		expect(invited).toEqual([]);
	});

	it("单纯提及不触发任何意图", () => {
		const r1 = detectPresenceIntent("我不喜欢林晚", present, ALL);
		expect(r1.invited).toEqual([]);
		expect(r1.dismissed).toEqual([]);
		const r2 = detectPresenceIntent("苏瑶上次说的话很有道理", present, ALL);
		expect(r2.invited).toEqual([]);
		expect(r2.dismissed).toEqual([]);
	});

	it("无法匹配角色的名字不产生意图", () => {
		const { invited } = detectPresenceIntent("让路人甲过来", present, ALL);
		expect(invited).toEqual([]);
	});
});
