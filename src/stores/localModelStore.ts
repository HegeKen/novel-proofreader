// ============================================================
// 本地大模型状态管理：检测外部服务、获取模型列表、测试推理、内置模型管理
// ============================================================
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { LocalModelState } from "../types";
import { normalizeLocalEndpoint } from "../utils/aiClient";
import { logger } from "../utils/logger";

/** 内置模型信息（与 Rust 侧 ModelInfo 对应） */
interface BuiltinModelInfo {
	id: string;
	name: string;
	filename: string;
	url: string;
	size_mb: number;
	description: string;
	recommended: boolean;
}

/** 系统资源信息（与 Rust 侧 SystemInfo 对应） */
interface LlmSystemInfo {
	total_memory_mb: number;
	disk_available_mb: number;
	recommended_model_id: string;
}

/** 内置模型运行状态 */
interface BuiltinModelState {
	/** 引擎是否可用（编译时是否启用 local-llm feature） */
	engineReady: boolean;
	/** 已下载的预置模型 */
	downloadedModels: BuiltinModelInfo[];
	/** 预置可选模型 */
	presetModels: BuiltinModelInfo[];
	/** 用户手动导入的模型（目录扫描得到的非预置 .gguf） */
	importedModels: BuiltinModelInfo[];
	/** 当前已加载的模型 id */
	loadedModelId: string | null;
	/** 正在下载的模型及进度（0-100） */
	downloading: Record<string, number>;
	/** 系统资源信息 */
	systemInfo: LlmSystemInfo | null;
	/** 模型存储目录路径 */
	modelsDir: string;
	/** 加载中 */
	loading: boolean;
	/** 导入中 */
	importing: boolean;
	/** 是否静默 llama.cpp 详细日志（默认开启） */
	silentLlamaLogs: boolean;
}

interface LocalModelStore {
	state: LocalModelState;
	builtin: BuiltinModelState;

	/** 检测本地服务状态（apiKey 用于已启用鉴权的服务，如 LM Studio） */
	checkService: (endpoint: string, apiKey?: string) => Promise<boolean>;

	/** 获取可用模型列表 */
	fetchModels: (endpoint: string, apiKey?: string) => Promise<string[]>;

	/** 测试模型推理 */
	testInference: (endpoint: string, model: string, apiKey?: string) => Promise<boolean>;

	/** 更新状态 */
	setState: (state: Partial<LocalModelState>) => void;

	/** 刷新内置模型状态（从 Rust 侧拉取） */
	refreshBuiltinStatus: () => Promise<void>;

	/** 下载内置模型 */
	downloadBuiltinModel: (modelId: string) => Promise<boolean>;

	/** 加载内置模型 */
	loadBuiltinModel: (modelId: string, contextSize?: number, gpuLayers?: number) => Promise<boolean>;

	/** 卸载内置模型 */
	unloadBuiltinModel: () => Promise<void>;

	/** 删除内置模型文件 */
	deleteBuiltinModel: (modelId: string) => Promise<void>;

	/** 导入本地 GGUF 模型文件 */
	importBuiltinModel: (srcPath: string) => Promise<boolean>;

	/** 在系统文件管理器中打开模型存储目录 */
	openModelsDir: () => Promise<boolean>;

	/** 监听下载进度事件（返回取消监听函数） */
	listenDownloadProgress: () => Promise<() => void>;

	/** 更新内置模型状态 */
	setBuiltin: (state: Partial<BuiltinModelState>) => void;

	/** 首次启动本地模型引导是否已展示 */
	localGuideShown: boolean;

	/** 标记本地模型引导已展示 */
	markLocalGuideShown: () => void;
}

/** 是否运行在 Tauri 环境（内置模型命令仅在桌面端可用） */
function isTauri(): boolean {
	return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// 从旧版 appMetaStore（persist key: novel-proofreader-meta）一次性迁移引导标记。
// persist 默认浅合并：新 key 已有数据时以新数据为准，无数据时保留此处的迁移值。
function loadLegacyGuideShown(): boolean {
	try {
		const raw = localStorage.getItem("novel-proofreader-meta");
		if (!raw) return false;
		return JSON.parse(raw)?.state?.localGuideShown === true;
	} catch {
		return false;
	}
}

export const useLocalModelStore = create<LocalModelStore>()(
	persist(
		(set, get) => ({
	state: {
		status: "idle",
		availableModels: [],
		loadedModel: null,
		errorMessage: null,
	},
	builtin: {
		engineReady: false,
		downloadedModels: [],
		presetModels: [],
		importedModels: [],
		loadedModelId: null,
		downloading: {},
		systemInfo: null,
		modelsDir: "",
			loading: false,
			importing: false,
			silentLlamaLogs: true,
		},
		localGuideShown: loadLegacyGuideShown(),

		markLocalGuideShown: () => set({ localGuideShown: true }),

	checkService: async (endpoint: string, apiKey?: string) => {
		set({ state: { ...get().state, status: "connecting", errorMessage: null } });
		const base = normalizeLocalEndpoint(endpoint);
		const authHeaders: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};

		// 依次探测：Ollama 原生 → OpenAI 兼容（旧版 LM Studio / vLLM）→ LM Studio 新版 REST API
		const probePaths = ["/v1/models", "/api/v1/models"];
		for (const path of probePaths) {
			try {
				const resp = await fetch(`${base}${path}`, {
					method: "GET",
					headers: authHeaders,
					signal: AbortSignal.timeout(5000),
				});
				if (resp.ok) {
					set({ state: { ...get().state, status: "ready" } });
					return true;
				}
				// 401/403 表示服务在线但鉴权失败，给出明确提示
				if (resp.status === 401 || resp.status === 403) {
					set({
						state: {
							...get().state,
							status: "error",
							errorMessage: "服务要求 API Key，请填写正确的密钥",
						},
					});
					return false;
				}
			} catch {
				// 连接失败，尝试下一个端点
			}
		}

		set({
			state: {
				...get().state,
				status: "error",
				errorMessage: "无法连接到本地服务，请确认服务已启动",
			},
		});
		return false;
	},

	fetchModels: async (endpoint: string, apiKey?: string) => {
		const base = normalizeLocalEndpoint(endpoint);
		const authHeaders: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};

		// 依次尝试：Ollama 原生 → OpenAI 兼容 → LM Studio 新版 REST API
		// 解析器：Ollama 返回 { models: [{name}] }，OpenAI/LM Studio 返回 { data: [{id}] }
		const sources: { path: string; parse: (data: unknown) => string[] }[] = [
			{
				path: "/v1/models",
				parse: (data) => ((data as { data?: { id: string }[] }).data || []).map((m) => m.id),
			},
			{
				path: "/api/v1/models",
				parse: (data) => ((data as { data?: { id: string }[] }).data || []).map((m) => m.id),
			},
		];

		for (const { path, parse } of sources) {
			try {
				const resp = await fetch(`${base}${path}`, {
					headers: authHeaders,
					signal: AbortSignal.timeout(5000),
				});
				if (resp.ok) {
					const data = await resp.json();
					const models = parse(data);
					set({ state: { ...get().state, availableModels: models } });
					return models;
				}
			} catch {
				// 继续尝试下一个接口
			}
		}

		return [];
	},

	testInference: async (endpoint: string, model: string, apiKey?: string) => {
		set({ state: { ...get().state, status: "loading", errorMessage: null } });
		const base = normalizeLocalEndpoint(endpoint);

		try {
			const resp = await fetch(`${base}/v1/chat/completions`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
				},
				body: JSON.stringify({
					model,
					messages: [{ role: "user", content: "你好" }],
					max_tokens: 50,
					stream: false,
				}),
				signal: AbortSignal.timeout(30000),
			});

			if (resp.ok) {
				set({
					state: {
						...get().state,
						status: "ready",
						loadedModel: model,
					},
				});
				return true;
			}
		} catch {
			// 推理失败
		}

		set({
			state: {
				...get().state,
				status: "error",
				errorMessage: "模型推理测试失败",
			},
		});
		return false;
	},

	setState: (newState) => {
		set({ state: { ...get().state, ...newState } });
	},

	refreshBuiltinStatus: async () => {
		if (!isTauri()) return;
		try {
			const { invoke } = await import("@tauri-apps/api/core");
			const status = await invoke<{
				loaded: boolean;
				model_id: string | null;
				engine_ready: boolean;
				downloaded_models: BuiltinModelInfo[];
				preset_models: BuiltinModelInfo[];
				system: LlmSystemInfo;
				models_dir: string;
			}>("llm_get_status");
			const { invoke: scanInvoke } = await import("@tauri-apps/api/core");
			const scanned = await scanInvoke<BuiltinModelInfo[]>("llm_scan_models");
			const imported = scanned.filter((m) => m.description === "用户导入模型");
			set({
				builtin: {
					...get().builtin,
					engineReady: status.engine_ready,
					downloadedModels: status.downloaded_models,
					presetModels: status.preset_models,
					importedModels: imported,
					loadedModelId: status.model_id,
					systemInfo: status.system,
					modelsDir: status.models_dir,
				},
			});
		} catch (err) {
				logger.errorGeneric("[LocalModel] 刷新内置模型状态失败", err);
				// 非 Tauri 环境或命令不可用时静默失败
			}
	},

	downloadBuiltinModel: async (modelId: string) => {
			if (!isTauri()) {
				logger.warn("[LocalModel] 非 Tauri 环境，无法下载");
				return false;
			}
			const { builtin } = get();
			set({ builtin: { ...builtin, downloading: { ...builtin.downloading, [modelId]: 0 } } });
			logger.info(`[LocalModel] 开始下载模型: ${modelId}`);
			try {
				const { invoke } = await import("@tauri-apps/api/core");
				await invoke("llm_download_model", { modelId });
				await get().refreshBuiltinStatus();
				logger.info(`[LocalModel] 模型下载完成: ${modelId}`);
				return true;
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				logger.errorGeneric(`[LocalModel] 模型下载失败: ${modelId}`, msg);
				return false;
			} finally {
				const cur = get().builtin;
				const next = { ...cur.downloading };
				delete next[modelId];
				set({ builtin: { ...cur, downloading: next } });
			}
		},

	loadBuiltinModel: async (modelId: string, contextSize?: number, gpuLayers?: number) => {
		if (!isTauri()) return false;
		set({ builtin: { ...get().builtin, loading: true } });
		try {
			const { invoke } = await import("@tauri-apps/api/core");
			await invoke("llm_load_model", {
				modelId,
				contextSize: contextSize ?? null,
				gpuLayers: gpuLayers ?? null,
				silentLlamaLogs: get().builtin.silentLlamaLogs,
			});
			await get().refreshBuiltinStatus();
			return true;
		} catch {
			return false;
		} finally {
			set({ builtin: { ...get().builtin, loading: false } });
		}
	},

	unloadBuiltinModel: async () => {
		if (!isTauri()) return;
		try {
			const { invoke } = await import("@tauri-apps/api/core");
			await invoke("llm_unload_model");
		} catch {
			// 忽略
		}
		await get().refreshBuiltinStatus();
	},

	deleteBuiltinModel: async (modelId: string) => {
		if (!isTauri()) return;
		try {
			const { invoke } = await import("@tauri-apps/api/core");
			await invoke("llm_delete_model", { modelId });
		} catch {
			// 忽略
		}
		await get().refreshBuiltinStatus();
	},

	importBuiltinModel: async (srcPath: string) => {
			if (!isTauri()) {
				logger.warn("[LocalModel] 非 Tauri 环境，无法导入");
				return false;
			}
			set({ builtin: { ...get().builtin, importing: true } });
			logger.info(`[LocalModel] 开始导入模型: ${srcPath}`);
			try {
				const { invoke } = await import("@tauri-apps/api/core");
				const result = await invoke<BuiltinModelInfo>("llm_import_model", { path: srcPath });
				await get().refreshBuiltinStatus();
				logger.info(`[LocalModel] 模型导入成功: ${result.filename} (${result.size_mb} MB)`);
				return true;
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				logger.errorGeneric(`[LocalModel] 模型导入失败: ${srcPath}`, msg);
				return false;
			} finally {
				set({ builtin: { ...get().builtin, importing: false } });
			}
		},

	openModelsDir: async () => {
		if (!isTauri()) {
			logger.warn("[LocalModel] 非 Tauri 环境，无法打开目录");
			return false;
		}
		try {
			const { invoke } = await import("@tauri-apps/api/core");
			await invoke("llm_open_models_dir");
			logger.info("[LocalModel] 已打开模型目录");
			return true;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			logger.errorGeneric("[LocalModel] 打开模型目录失败", msg);
			return false;
		}
	},

	listenDownloadProgress: async () => {
		if (!isTauri()) return () => {};
		const { listen } = await import("@tauri-apps/api/event");
		const unlisten = await listen<{ model_id: string; downloaded: number; total: number }>(
			"llm-download-progress",
			(event) => {
				const { model_id, downloaded, total } = event.payload;
				const cur = get().builtin;
				const pct = total > 0 ? Math.round((downloaded / total) * 100) : 0;
				set({ builtin: { ...cur, downloading: { ...cur.downloading, [model_id]: pct } } });
			},
		);
		return unlisten;
	},

	setBuiltin: (newState) => {
                set({ builtin: { ...get().builtin, ...newState } });
        },
}),
		{
			name: "novel-proofreader-local-model",
			partialize: (state) => ({ localGuideShown: state.localGuideShown }),
		},
	),
);
