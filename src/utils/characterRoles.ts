// ============================================================
// 角色类型（role）枚举 → 中文显示名称的映射工具
// ============================================================
import type { CharacterRole, RelationType } from "../types";

/** 角色类型 → 中文显示名称 */
const ROLE_NAME_MAP: Record<CharacterRole, string> = {
	protagonist: "男主",
	heroine: "女主",
	antagonist: "反派",
	supportingMale: "男配",
	supportingFemale: "女配",
	mentor: "导师",
	rival: "对手",
	loveInterest: "爱慕对象",
	family: "家人",
	friend: "朋友",
	narrator: "旁白",
	npc: "NPC",
};

/** 将角色类型枚举转换为中文显示名称，缺失或未识别时返回 "NPC" */
export function getRoleName(role?: string): string {
	if (!role) return "NPC";
	return ROLE_NAME_MAP[role as CharacterRole] || "NPC";
}

/** 双人关系类型选项（下拉/复选框共用，避免各组件重复定义） */
export const RELATION_TYPE_OPTIONS: Array<{ value: RelationType; label: string }> = [
	{ value: "couple", label: "夫妻" },
	{ value: "lover", label: "恋人" },
	{ value: "ex-lover", label: "前任" },
	{ value: "father-son", label: "父子" },
	{ value: "father-daughter", label: "父女" },
	{ value: "mother-son", label: "母子" },
	{ value: "mother-daughter", label: "母女" },
	{ value: "brother", label: "兄弟" },
	{ value: "sister", label: "姐妹" },
	{ value: "brother-sister", label: "兄妹" },
	{ value: "sister-brother", label: "姐弟" },
	{ value: "mother-daughter-in-law", label: "婆媳" },
	{ value: "father-daughter-in-law", label: "公媳" },
	{ value: "mother-son-in-law", label: "岳母女婿" },
	{ value: "father-son-in-law", label: "翁婿" },
	{ value: "co-parents-male", label: "亲家公" },
	{ value: "co-parents-female", label: "亲家母" },
	{ value: "relative", label: "亲戚" },
	{ value: "classmate", label: "同学" },
	{ value: "friend", label: "朋友" },
	{ value: "bestie", label: "闺蜜" },
	{ value: "rival", label: "竞争对手" },
	{ value: "arch-enemy", label: "宿敌" },
	{ value: "enemy", label: "仇人" },
	{ value: "master-disciple", label: "师徒" },
	{ value: "teacher-student", label: "师生" },
	{ value: "employer-employee", label: "上下级" },
	{ value: "colleague", label: "同事" },
	{ value: "neighbor", label: "邻居" },
	{ value: "stranger", label: "陌生人" },
	{ value: "other", label: "其他" },
];

/** 角色性别选项（下拉共用） */
export const GENDER_OPTIONS: Array<{ value: "male" | "female" | "other"; label: string }> = [
	{ value: "male", label: "男" },
	{ value: "female", label: "女" },
	{ value: "other", label: "其他" },
];

/** 角色类型选项（含"未设置"，下拉共用；与既有 UI 列表保持一致，不含旁白） */
export const ROLE_OPTIONS: Array<{ value: "" | CharacterRole; label: string }> = [
	{ value: "", label: "未设置" },
	{ value: "protagonist", label: "男主" },
	{ value: "heroine", label: "女主" },
	{ value: "antagonist", label: "反派" },
	{ value: "supportingMale", label: "男配" },
	{ value: "supportingFemale", label: "女配" },
	{ value: "mentor", label: "导师" },
	{ value: "rival", label: "对手" },
	{ value: "loveInterest", label: "爱慕对象" },
	{ value: "family", label: "家人" },
	{ value: "friend", label: "朋友" },
	{ value: "npc", label: "NPC" },
];

/** 生成关系对的无序唯一 key（用于合并/去重同一条双向关系） */
export function makeRelationPairKey(nameA: string, nameB: string): string {
	const names = [nameA, nameB].sort();
	return `${names[0]}|${names[1]}`;
}

/** 角色性别 → 中文显示名称 */
export function getGenderName(gender?: string): string {
	if (gender === "male") return "男";
	if (gender === "female") return "女";
	return "其他";
}
