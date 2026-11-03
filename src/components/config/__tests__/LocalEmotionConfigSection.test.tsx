import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../utils/secureStorage", () => ({
	secureStorageSet: vi.fn(),
	secureStorageGet: vi.fn(() => ""),
	preloadSecureStorage: vi.fn(),
}));

import { LocalEmotionConfigSection } from "../LocalEmotionConfigSection";
import { useConfigStore } from "../../../stores/configStore";

beforeEach(() => {
	useConfigStore.setState((state) => ({
		ttsConfig: { ...state.ttsConfig, localEmotionEnabled: false },
	}));
});

describe("本地情感分析设置", () => {
	it("默认展示离线开关", () => {
		render(<LocalEmotionConfigSection />);
		expect(screen.getByText("使用本地情感模型（离线）")).toBeTruthy();
		expect(screen.getByText("情感分析（朗读标注）")).toBeTruthy();
	});

	it("开启后可以输入自定义测试文本与上文", () => {
		useConfigStore.setState((state) => ({
			ttsConfig: { ...state.ttsConfig, localEmotionEnabled: true },
		}));
		render(<LocalEmotionConfigSection />);

		const textarea = screen.getByPlaceholderText(/输入或粘贴要分析情绪的段落/);
		fireEvent.change(textarea, { target: { value: "她轻声说： “别怕，我在。”" } });
		expect((textarea as HTMLTextAreaElement).value).toContain("别怕");

		const context = screen.getByPlaceholderText(/填写前一段/);
		fireEvent.change(context, { target: { value: "夜色很深。" } });
		expect((context as HTMLTextAreaElement).value).toBe("夜色很深。");
	});
});
