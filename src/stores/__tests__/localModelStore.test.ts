import { describe, it, expect, vi, afterEach } from "vitest";
import { useLocalModelStore } from "../localModelStore";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("LM Studio 模型列表", () => {
	it("解析 /api/v1/models 的 models[].key", async () => {
		const fetchMock = vi.fn(async (url: string | URL | Request) => {
			if (String(url).endsWith("/api/v1/models")) {
				return new Response(
					JSON.stringify({
						models: [
							{ key: "model-a", display_name: "Model A" },
							{ key: "model-b", display_name: "Model B" },
						],
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			return new Response("not found", { status: 404 });
		});
		vi.stubGlobal("fetch", fetchMock);
		const models = await useLocalModelStore.getState().fetchModels("http://127.0.0.1:1234");
		expect(models).toEqual(["model-a", "model-b"]);
		expect(useLocalModelStore.getState().state.availableModels).toEqual(["model-a", "model-b"]);
	});

	it("回退到 /v1/models 的 data[].id", async () => {
		const fetchMock = vi.fn(async (url: string | URL | Request) => {
			if (String(url).endsWith("/v1/models")) {
				return new Response(JSON.stringify({ data: [{ id: "openai-model" }] }), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}
			return new Response("not found", { status: 404 });
		});
		vi.stubGlobal("fetch", fetchMock);
		const models = await useLocalModelStore.getState().fetchModels("http://127.0.0.1:1234");
		expect(models).toEqual(["openai-model"]);
	});
});
