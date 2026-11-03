import { describe, expect, it } from "vitest";
import {
	EMOTION_THRESHOLDS,
	EMOTION_ZH,
	buildLocalParagraphEmotion,
	detectSpeaker,
	emotionSpeed,
	pickEmotion,
	splitDialogueSegments,
} from "../emotionAnalysis";
import type { EmotionPrediction } from "../localEmotion";

function prediction(scores: Record<string, number>): EmotionPrediction {
	const emotionScores = Object.keys(EMOTION_ZH).map((label) => ({
		label,
		probability: scores[label] ?? 0,
	}));
	const toneScores = ["tone_positive", "tone_negative", "tone_neutral"].map((label) => ({
		label,
		probability: scores[label] ?? 0,
	}));
	const labels = [...emotionScores, ...toneScores].sort((a, b) => b.probability - a.probability);
	return {
		labels,
		top_label: labels[0].label,
		top_probability: labels[0].probability,
		tone_label: "tone_neutral",
		tone_probability: 0,
		tokens: 16,
		elapsed_ms: 12,
	};
}

describe("本地情感标签映射", () => {
	it("覆盖模型的 28 种情感与生产阈值", () => {
		expect(Object.keys(EMOTION_ZH)).toHaveLength(28);
		for (const label of Object.keys(EMOTION_ZH)) {
			expect(EMOTION_THRESHOLDS[label]).toBeGreaterThan(0);
		}
	});

	it("达到 README 推荐阈值时采用该情绪", () => {
		const picked = pickEmotion(prediction({ anger: 0.9, neutral: 0.2, tone_negative: 0.8 }));
		expect(picked.key).toBe("anger");
		expect(picked.zh).toBe("愤怒");
	});

	it("所有情绪都低于阈值时回落为平静", () => {
		const picked = pickEmotion(prediction({ anger: 0.3, joy: 0.2, neutral: 0.25 }));
		expect(picked.zh).toBe("平静");
	});

	it("低置信度会把语速拉回日常语速", () => {
		expect(emotionSpeed("愤怒", 0.9)).toBeGreaterThan(5);
		expect(emotionSpeed("愤怒", 0.3)).toBe(6);
	});
});

describe("旁白/对话切分与说话人识别", () => {
	it("按引号切分旁白与对话", () => {
		const text = "李明叹了口气，说道：“你好吗？”他转身离开。";
		const segments = splitDialogueSegments(text, [{ name: "李明" }]);
		expect(segments.map((s) => s.type)).toEqual(["narration", "dialogue", "narration"]);
		expect(segments[1].text).toBe("“你好吗？”");
		expect(segments[1].speaker).toBe("李明");
	});

	it("支持「名字：」引出对白与引号后置说话人", () => {
		expect(detectSpeaker("王芳：“走吧。”", 3, 7, [])).toBe("王芳");
		expect(detectSpeaker("“你好。”李明说。", 0, 4, [])).toBe("李明");
	});

	it("不会把「低声说道」误识别为说话人", () => {
		const text = "他低声说道：“走吧。”";
		expect(detectSpeaker(text, text.indexOf("“"), text.indexOf("”"), [])).toBe("旁白");
	});

	it("无角色配置时从「名字 + 叹/说」结构中提取姓名", () => {
		const text = "李明叹了口气，说道：“走吧。”";
		expect(detectSpeaker(text, text.indexOf("“"), text.indexOf("”"), [])).toBe("李明");
	});

	it("「名字说道：」只保留名字部分", () => {
		const text = "王芳说道：“我不去。”";
		expect(detectSpeaker(text, text.indexOf("“"), text.indexOf("”"), [])).toBe("王芳");
	});

	it("识别已配置角色别名", () => {
		const characters = [{ name: "李明", aliases: ["小明"] }];
		expect(detectSpeaker("小明笑道：“当然。”", 5, 10, characters)).toBe("小明");
	});
});

describe("本地分析结果转换为朗读标注", () => {
	it("对话使用段落情绪，旁白默认平静", () => {
		const text = "李明怒吼道：“你给我滚出去！”";
		const result = buildLocalParagraphEmotion(text, prediction({ anger: 0.95, tone_negative: 0.9 }), [
			{ name: "李明" },
		]);
		const dialogue = result.segments.find((s) => s.type === "dialogue");
		const narration = result.segments.find((s) => s.type === "narration");
		expect(dialogue?.speaker).toBe("李明");
		expect(dialogue?.emotion).toBe("愤怒");
		expect(dialogue?.text).toBe("(愤怒,凌厉)“你给我滚出去！”");
		expect(dialogue?.speed).toBeGreaterThanOrEqual(7);
		expect(narration?.emotion).toBe("愤怒");
		expect(result.characters).toContain("李明");
	});

	it("旁白关键词优先于段落级中性判断", () => {
		const text = "他冷笑一声，转身离开。";
		const result = buildLocalParagraphEmotion(text, prediction({ neutral: 0.8 }));
		expect(result.segments[0].emotion).toBe("冷漠");
		expect(result.segments[0].text.startsWith("(冷漠,")).toBe(true);
	});

	it("「怒吼道」不会被当成说话人", () => {
		const text = "他猛地拍案而起，怒吼道：“你给我滚出去！”";
		const result = buildLocalParagraphEmotion(text, prediction({ anger: 0.95 }));
		const dialogue = result.segments.find((s) => s.type === "dialogue");
		expect(dialogue?.speaker).toBe("旁白");
		expect(dialogue?.text).toBe("(愤怒,凌厉)“你给我滚出去！”");
	});

	it("无引号时整段作为旁白输出", () => {
		const result = buildLocalParagraphEmotion("夜深了，雨还在下。", prediction({ sadness: 0.9 }));
		expect(result.segments).toHaveLength(1);
		expect(result.segments[0].type).toBe("narration");
		expect(result.segments[0].text.startsWith("(悲伤,")).toBe(true);
	});
});
