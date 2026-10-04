// ============================================================
// 本地大模型配置面板（云端 / Ollama 外部服务 / 内置模型）
// ============================================================
import { useState, useEffect, useCallback } from "react";
import { useAIConfigStore } from "../stores/aiConfigStore";
import { useLocalModelStore } from "../stores/localModelStore";
import { useUIStore } from "../stores/uiStore";
import { isAndroidPlatform } from "../utils/mobile";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { Icons } from "./Icons";
import { Select } from "./Select";

/** 推荐外部模型列表 */
const RECOMMENDED_MODELS = [
	{
		name: "qwen2.5:7b",
		size: "~4.1 GB",
		desc: "中文校对首选，平衡性能与精度",
		pullCmd: "ollama pull qwen2.5:7b",
	},
	{
		name: "qwen2.5:3b",
		size: "~2.0 GB",
		desc: "轻量快速，适合日常校对",
		pullCmd: "ollama pull qwen2.5:3b",
	},
	{
		name: "qwen2.5:1.5b",
		size: "~1.0 GB",
		desc: "极轻量，适合简单错别字检测",
		pullCmd: "ollama pull qwen2.5:1.5b",
	},
] as const;

export function LocalModelSettings() {
	const localModelConfig = useAIConfigStore((s) => s.localModelConfig);
	const setLocalModelConfig = useAIConfigStore((s) => s.setLocalModelConfig);
	const { state: localState, checkService, fetchModels, testInference, builtin, refreshBuiltinStatus, downloadBuiltinModel, loadBuiltinModel, unloadBuiltinModel, deleteBuiltinModel, importBuiltinModel, openModelsDir, listenDownloadProgress } = useLocalModelStore();
	const [selectedModel, setSelectedModel] = useState(localModelConfig.externalModel);
	const { copiedId: copiedCmd, copy: copyCmd } = useCopyToClipboard();
	const showToast = useUIStore((s) => s.showToast);
	const [listenCleanup, setListenCleanup] = useState<(() => void) | null>(null);

	// 当选中本地外部服务时，自动检测服务并获取模型列表
	useEffect(() => {
		if (localModelConfig.enabled && localModelConfig.modelSource === "local-external") {
			checkService(localModelConfig.externalEndpoint, localModelConfig.externalApiKey || undefined).then((ok) => {
				if (ok) fetchModels(localModelConfig.externalEndpoint, localModelConfig.externalApiKey || undefined);
			});
		}
	}, [localModelConfig.enabled, localModelConfig.modelSource, localModelConfig.externalEndpoint, localModelConfig.externalApiKey, checkService, fetchModels]);

	// 内置模型：挂载时拉取状态并监听下载进度
	useEffect(() => {
		if (localModelConfig.enabled && localModelConfig.modelSource === "local-builtin") {
			refreshBuiltinStatus();
			listenDownloadProgress().then((cleanup) => setListenCleanup(() => cleanup));
		}
		return () => {
			listenCleanup?.();
		};
	}, [localModelConfig.enabled, localModelConfig.modelSource, refreshBuiltinStatus, listenDownloadProgress]);

	// 同步外部模型选择到配置
	useEffect(() => {
		setSelectedModel(localModelConfig.externalModel);
	}, [localModelConfig.externalModel]);

	const handleRefresh = useCallback(async () => {
		const ok = await checkService(localModelConfig.externalEndpoint, localModelConfig.externalApiKey || undefined);
		if (ok) {
			await fetchModels(localModelConfig.externalEndpoint, localModelConfig.externalApiKey || undefined);
			showToast("本地服务连接正常", "success");
		} else {
			showToast(localState.errorMessage || "无法连接到本地服务，请确认已启动", "error");
		}
	}, [localModelConfig.externalEndpoint, localModelConfig.externalApiKey, checkService, fetchModels, showToast, localState.errorMessage]);

	const handleTestModel = useCallback(async () => {
		if (!selectedModel) return;
		const ok = await testInference(localModelConfig.externalEndpoint, selectedModel, localModelConfig.externalApiKey || undefined);
		if (ok) {
			setLocalModelConfig({ externalModel: selectedModel });
			showToast(`模型 ${selectedModel} 测试通过`, "success");
		} else {
			showToast(localState.errorMessage || "模型测试失败", "error");
		}
	}, [selectedModel, localModelConfig.externalEndpoint, localModelConfig.externalApiKey, testInference, setLocalModelConfig, showToast, localState.errorMessage]);

	const handleCopyCmd = useCallback(async (cmd: string) => {
		try {
			await copyCmd(cmd, cmd);
		} catch {
			showToast("复制失败", "error");
		}
	}, [copyCmd, showToast]);

	const handleDownloadBuiltin = useCallback(async (id: string) => {
		const ok = await downloadBuiltinModel(id);
		if (ok) {
			showToast("模型下载完成", "success");
		} else {
			showToast("模型下载失败，请检查网络", "error");
		}
	}, [downloadBuiltinModel, showToast]);

	const handleLoadBuiltin = useCallback(async (id: string) => {
		const ok = await loadBuiltinModel(id, localModelConfig.builtinContextSize, localModelConfig.gpuLayers);
		if (ok) {
			showToast("模型加载完成", "success");
		} else {
			showToast("模型加载失败", "error");
		}
	}, [loadBuiltinModel, localModelConfig.builtinContextSize, localModelConfig.gpuLayers, showToast]);

	const handleUnloadBuiltin = useCallback(async () => {
		await unloadBuiltinModel();
		showToast("模型已卸载", "info");
	}, [unloadBuiltinModel, showToast]);

	const handleDeleteBuiltin = useCallback(async (id: string) => {
		if (!confirm("确定要删除该模型文件吗？删除后需要重新下载。")) return;
		await deleteBuiltinModel(id);
		showToast("模型文件已删除", "info");
	}, [deleteBuiltinModel, showToast]);

	/** 导入本地 GGUF 模型 */
	const handleImportBuiltin = useCallback(async () => {
		try {
			const { open } = await import("@tauri-apps/plugin-dialog");
			const selected = await open({
				multiple: false,
				filters: [{ name: "GGUF 模型", extensions: ["gguf"] }],
			});
			if (!selected || typeof selected !== "string") return;
			const ok = await importBuiltinModel(selected);
			if (ok) {
				showToast("模型导入成功", "success");
			} else {
				showToast("模型导入失败", "error");
			}
		} catch {
			showToast("无法打开文件选择器", "error");
		}
	}, [importBuiltinModel, showToast]);

	/** 在文件管理器中打开模型存储目录 */
	const handleOpenModelsDir = useCallback(async () => {
		const ok = await openModelsDir();
		if (ok) {
			showToast("已打开模型目录", "info");
		} else {
			showToast("打开目录失败，路径: " + (builtin.modelsDir ?? "未知"), "error");
		}
	}, [openModelsDir, builtin.modelsDir, showToast]);

	const source = localModelConfig.modelSource;
	const sys = builtin.systemInfo;
	const isAndroid = isAndroidPlatform();

	return (
		<div className="config-section">
			{/* ========== 本地外部服务配置 ========== */}
			{source === "local-external" && (
				<>
					{/* 服务状态 */}
					<div className="form-field">
						<label>服务状态</label>
						<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
							<span
								style={{
									display: "inline-block",
									width: "8px",
									height: "8px",
									borderRadius: "50%",
									background:
										localState.status === "ready"
											? "var(--green)"
											: localState.status === "connecting" || localState.status === "loading"
												? "var(--yellow)"
												: "var(--red)",
								}}
							/>
							<span style={{ fontSize: "13px" }}>
								{localState.status === "ready" && "服务运行中"}
								{localState.status === "connecting" && "正在连接…"}
								{localState.status === "loading" && "模型推理测试中…"}
								{localState.status === "error" && (localState.errorMessage || "服务异常")}
								{localState.status === "idle" && "未检测"}
							</span>
							<button className="btn" onClick={handleRefresh} disabled={localState.status === "connecting"}>
								<Icons.reset size={14} />
								刷新
							</button>
						</div>
					</div>

					{/* 服务地址 */}
						<div className="form-field">
							<label>服务地址</label>
							<div className="input-wrapper">
								<input
									type="text"
									value={localModelConfig.externalEndpoint}
									onChange={(e) => setLocalModelConfig({ externalEndpoint: e.target.value })}
									placeholder="http://localhost:11434"
									className="config-input"
								/>
							</div>
							<div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "4px" }}>
								Ollama 默认 http://localhost:11434，LM Studio 默认 http://localhost:1234
							</div>
						</div>

						{/* API Key（可选，LM Studio 启用鉴权时必填） */}
						<div className="form-field">
							<label>API Key（可选）</label>
							<div className="input-wrapper">
								<input
									type="password"
									value={localModelConfig.externalApiKey}
									onChange={(e) => setLocalModelConfig({ externalApiKey: e.target.value })}
									placeholder="服务未启用鉴权时留空"
									className="config-input"
									autoComplete="new-password"
								/>
							</div>
							<div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "4px" }}>
								LM Studio 在「Server → Require API Key」开启后需填写对应密钥
							</div>
						</div>

					{/* 模型选择 */}
					<div className="form-field">
						<label>模型</label>
						<div className="model-select-row">
							<Select
								value={selectedModel}
								onChange={(v) => setSelectedModel(v)}
								options={localState.availableModels.length === 0
									? [{ value: "", label: "暂无可用模型" }]
									: localState.availableModels.map((m) => ({ value: m, label: m }))
								}
							/>
							<button
								className="btn"
								onClick={handleTestModel}
								disabled={!selectedModel || localState.status === "loading"}
							>
								{localState.status === "loading" ? (
									<><Icons.loader2 size={14} className="spinning" />测试中</>
								) : (
									<><Icons.play size={14} />测试</>
								)}
							</button>
						</div>
						{localState.loadedModel && (
							<div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "4px" }}>
								当前已加载模型：{localState.loadedModel}
							</div>
						)}
					</div>

					{/* 推荐模型 */}
					<div className="form-field">
						<label>推荐模型</label>
						<div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
							{RECOMMENDED_MODELS.map((m) => (
								<div
									key={m.name}
									style={{
										display: "flex",
										alignItems: "center",
										justifyContent: "space-between",
										padding: "8px 12px",
										borderRadius: "var(--r-sm)",
										background: "var(--bg-hover)",
										fontSize: "13px",
									}}
								>
									<div>
										<div style={{ fontWeight: 500 }}>
											{m.name}{" "}
											<span style={{ color: "var(--text-muted)", fontWeight: 400 }}>{m.size}</span>
										</div>
										<div style={{ color: "var(--text-secondary)", fontSize: "12px" }}>{m.desc}</div>
									</div>
									<button
										className="btn"
										style={{ flexShrink: 0, padding: "4px 8px", fontSize: "12px" }}
										onClick={() => handleCopyCmd(m.pullCmd)}
										title={m.pullCmd}
									>
										{copiedCmd === m.pullCmd ? <Icons.check size={12} /> : <Icons.copy size={12} />}
										复制命令
									</button>
								</div>
							))}
						</div>
						<div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "8px" }}>
							提示：请先安装{" "}
							<a href="https://ollama.ai" target="_blank" rel="noreferrer">
								Ollama
							</a>{" "}
							并运行 <code>ollama serve</code>，然后执行上方命令下载模型。
						</div>
					</div>
				</>
			)}

			{/* ========== 内置模型配置 ========== */}
			{source === "local-builtin" && (
				<>
					{/* 引擎状态 */}
						<div className="form-field">
							<label>引擎状态</label>
							<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
								<span
									style={{
										display: "inline-block",
										width: "8px",
										height: "8px",
										borderRadius: "50%",
										background: builtin.engineReady ? "var(--green)" : "var(--yellow)",
									}}
								/>
								<span style={{ fontSize: "13px" }}>
									{builtin.engineReady
										? "推理引擎就绪"
										: isAndroid
											? "Android 端暂不支持内置推理引擎，请使用云端 API 或本地外部服务"
											: "当前编译未启用推理引擎（cargo build --features local-llm）"}
								</span>
								<button className="btn" onClick={() => refreshBuiltinStatus()}>
									<Icons.reset size={14} />
									刷新
								</button>
							</div>
						</div>

					{/* 日志静默开关 */}
					<div className="form-field">
						<label>日志设置</label>
						<label
							style={{
								display: "flex",
								alignItems: "center",
								gap: "8px",
								fontSize: "13px",
								color: "var(--text-secondary)",
								cursor: "pointer",
							}}
						>
							<input
								type="checkbox"
								checked={builtin.silentLlamaLogs}
								onChange={(e) =>
									useLocalModelStore.setState({
										builtin: { ...useLocalModelStore.getState().builtin, silentLlamaLogs: e.target.checked },
									})
								}
							/>
							静默 llama.cpp 详细日志（仅保留输入输出结果）
						</label>
					</div>

					{/* 系统资源 */}
					{sys && (
						<div
							className="form-field"
							style={{
								padding: "8px 12px",
								borderRadius: "var(--r-sm)",
								background: "var(--bg-hover)",
								fontSize: "13px",
								color: "var(--text-secondary)",
							}}
						>
							<div>
								<Icons.monitor size={14} style={{ verticalAlign: "middle", marginRight: "4px" }} />
								内存 {sys.total_memory_mb} MB · 磁盘可用 {sys.disk_available_mb} MB
							</div>
							{sys.disk_available_mb < 2048 && (
								<div style={{ color: "var(--red)", fontSize: "12px", marginTop: "4px" }}>
									磁盘空间不足，建议清理空间后再下载模型。
								</div>
							)}
						</div>
					)}

					{/* 内置模型列表 */}
						<div className="form-field">
							<label>预置模型</label>
							<div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
								{builtin.presetModels.map((m) => {
								const isDownloaded = builtin.downloadedModels.some((d) => d.id === m.id);
								const isLoaded = builtin.loadedModelId === m.id;
								const isDownloading = m.id in builtin.downloading;
								const progress = builtin.downloading[m.id] ?? 0;

								return (
									<div
										key={m.id}
										style={{
											display: "flex",
											alignItems: "center",
											justifyContent: "space-between",
											padding: "8px 12px",
											borderRadius: "var(--r-sm)",
											background: isLoaded ? "rgba(0,0,0,0.04)" : "var(--bg-hover)",
											fontSize: "13px",
											border: isLoaded ? "1px solid var(--green)" : "1px solid transparent",
										}}
									>
										<div style={{ flex: 1, minWidth: 0 }}>
											<div style={{ fontWeight: 500 }}>
												{m.name}{" "}
												<span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
													{Math.round(m.size_mb / 1024 * 10) / 10} GB
												</span>
												{m.recommended && (
													<span
														style={{
															marginLeft: "6px",
															padding: "1px 6px",
															borderRadius: "var(--r-xs)",
															background: "var(--accent)",
															color: "#fff",
															fontSize: "11px",
														}}
													>
														推荐
													</span>
												)}
											</div>
											<div style={{ color: "var(--text-secondary)", fontSize: "12px" }}>{m.description}</div>
											{isDownloading && (
												<div
													style={{
														marginTop: "4px",
														width: "100%",
														height: "4px",
														borderRadius: "2px",
														background: "var(--bg-raised)",
														overflow: "hidden",
													}}
												>
													<div
														style={{
															width: `${progress}%`,
															height: "100%",
															background: "var(--accent)",
															transition: "width 0.3s",
														}}
													/>
												</div>
											)}
										</div>
										<div style={{ display: "flex", gap: "6px", flexShrink: 0, marginLeft: "8px" }}>
											{!isDownloaded && (
												<button
													className="btn"
													disabled={isDownloading}
														onClick={() => handleDownloadBuiltin(m.id)}
													>
													{isDownloading ? (
														<>{progress}%</>
													) : (
														<><Icons.download size={12} />下载</>
													)}
												</button>
											)}
											{isDownloaded && !isLoaded && (
												<button
													className="btn"
													onClick={() => handleLoadBuiltin(m.id)}
													disabled={builtin.loading}
												>
													{builtin.loading ? "加载中…" : "加载模型"}
												</button>
											)}
											{isLoaded && (
												<button className="btn" onClick={handleUnloadBuiltin}>
													卸载
												</button>
											)}
											{isDownloaded && (
												<button
													className="btn"
													style={{ color: "var(--red)" }}
													onClick={() => handleDeleteBuiltin(m.id)}
												>
													<Icons.trash2 size={12} />
												</button>
											)}
										</div>
									</div>
								);
							})}
								</div>
							</div>

							{/* 导入本地模型 */}
							<div className="form-field">
								<label>
									导入模型
									{builtin.modelsDir && (
										<span style={{ fontWeight: 400, fontSize: "12px", color: "var(--text-muted)", marginLeft: "8px" }}>
											存储目录: {builtin.modelsDir}
										</span>
									)}
								</label>
								<div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
									<button
										className="btn"
										onClick={handleImportBuiltin}
										disabled={builtin.importing}
									>
										{builtin.importing ? (
											<><Icons.loader2 size={14} className="spinning" />导入中</>
										) : (
											<><Icons.upload size={14} />导入本地 GGUF 模型</>
										)}
									</button>
									{builtin.modelsDir && (
										<button
											className="btn btn-secondary"
											onClick={handleOpenModelsDir}
											title="在文件管理器中打开模型存储目录"
										>
											<Icons.externalLink size={14} />打开文件夹
										</button>
									)}
									<span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
										选择已下载的 .gguf 文件导入
									</span>
								</div>
							</div>

							{/* 已导入模型 */}
							{builtin.importedModels.length > 0 && (
								<div className="form-field">
									<label>已导入模型</label>
									<div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
										{builtin.importedModels.map((m) => {
											const isLoaded = builtin.loadedModelId === m.id;
											return (
												<div
													key={m.id}
													style={{
														display: "flex",
														alignItems: "center",
														justifyContent: "space-between",
														padding: "8px 12px",
														borderRadius: "var(--r-sm)",
														background: isLoaded ? "rgba(0,0,0,0.04)" : "var(--bg-hover)",
														fontSize: "13px",
														border: isLoaded ? "1px solid var(--green)" : "1px solid transparent",
													}}
												>
													<div style={{ flex: 1, minWidth: 0 }}>
														<div style={{ fontWeight: 500 }}>
															{m.name}
															<span style={{ color: "var(--text-muted)", fontWeight: 400, marginLeft: "8px" }}>
																{Math.round(m.size_mb / 1024 * 10) / 10} GB
															</span>
														</div>
														<div style={{ color: "var(--text-secondary)", fontSize: "12px" }}>{m.description}</div>
													</div>
													<div style={{ display: "flex", gap: "6px", flexShrink: 0, marginLeft: "8px" }}>
														{!isLoaded && (
															<button
																className="btn"
																onClick={() => handleLoadBuiltin(m.id)}
																disabled={builtin.loading}
															>
																{builtin.loading ? "加载中…" : "加载模型"}
															</button>
														)}
														{isLoaded && (
															<button className="btn" onClick={handleUnloadBuiltin}>
																卸载
															</button>
														)}
														<button
															className="btn"
															style={{ color: "var(--red)" }}
															onClick={() => handleDeleteBuiltin(m.id)}
														>
															<Icons.trash2 size={12} />
														</button>
													</div>
												</div>
											);
										})}
									</div>
								</div>
							)}
						</>
				)}
		</div>
	);
}
