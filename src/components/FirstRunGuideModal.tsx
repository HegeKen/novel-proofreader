// ============================================================
// 首次启动引导弹窗：选择 AI 模型来源（云端 / 本地外部服务 / 内置模型）
// ============================================================
import { useEffect, useState } from "react";
import { useAIConfigStore } from "../stores/aiConfigStore";
import { useLocalModelStore } from "../stores/localModelStore";
import { Icons } from "./Icons";
import { Modal } from "./Modal";
import type { ModelSource } from "../types";

interface Props {
	open: boolean;
	onClose: () => void;
	/** 打开完整配置弹窗（选择云端时引导用户去填 API Key） */
	onOpenConfig?: () => void;
}

export function FirstRunGuideModal({ open, onClose, onOpenConfig }: Props) {
	const setLocalModelConfig = useAIConfigStore((s) => s.setLocalModelConfig);
	const builtin = useLocalModelStore((s) => s.builtin);
	const refreshBuiltinStatus = useLocalModelStore((s) => s.refreshBuiltinStatus);
	const downloadBuiltinModel = useLocalModelStore((s) => s.downloadBuiltinModel);
	const listenDownloadProgress = useLocalModelStore((s) => s.listenDownloadProgress);
	const [downloading, setDownloading] = useState(false);

	// 打开时拉取系统资源信息（磁盘空间 / 内存 / 推荐模型）
	useEffect(() => {
		if (!open) return;
		refreshBuiltinStatus();
		listenDownloadProgress();
	}, [open, refreshBuiltinStatus, listenDownloadProgress]);

	if (!open) return null;

	const sys = builtin.systemInfo;
	const diskLow = sys !== null && sys.disk_available_mb < 2048;
	const recommended = builtin.presetModels.find(
		(m) => m.id === sys?.recommended_model_id,
	) ?? builtin.presetModels[0];

	const handleChoose = (source: ModelSource) => {
		setLocalModelConfig({ modelSource: source, enabled: source !== "cloud" });
		onClose();
		if (source === "cloud") {
			onOpenConfig?.();
		}
	};

	const handleDownloadRecommended = async () => {
		if (!recommended) return;
		setDownloading(true);
		const ok = await downloadBuiltinModel(recommended.id);
		setDownloading(false);
		if (ok) {
			setLocalModelConfig({ modelSource: "local-builtin", enabled: true });
			onClose();
			onOpenConfig?.();
		}
	};

	return (
		<Modal open onClose={onClose} title="欢迎使用 AI 排版校对助手" icon={<Icons.sparkles size={18} />}>
			<p className="modal-description">
				校对功能由大语言模型驱动，请选择模型来源（之后可随时在「设置 → AI 配置」中更改）。
			</p>

			{/* 系统资源检测 */}
			{sys && (
				<div className="guide-system-info">
					<Icons.monitor size={14} style={{ verticalAlign: "middle", marginRight: "4px" }} />
					本机内存 {Math.round(sys.total_memory_mb / 1024)} GB · 磁盘可用{" "}
					{Math.round(sys.disk_available_mb / 1024)} GB
					{diskLow && (
						<span className="guide-disk-low">
							磁盘空间偏低，不建议下载内置模型
						</span>
					)}
				</div>
			)}

			<div className="guide-option-list">
				{/* 云端 API */}
				<button
					className="btn guide-option-btn"
					onClick={() => handleChoose("cloud")}
				>
					<Icons.globe size={16} />
					<span>
						<strong>云端 API</strong>（推荐新用户）
						<br />
						<span className="guide-option-hint">
							DeepSeek 等，校对质量最佳，按量计费
						</span>
					</span>
				</button>

				{/* 本地外部服务 */}
				<button
					className="btn guide-option-btn"
					onClick={() => handleChoose("local-external")}
				>
					<Icons.server size={16} />
					<span>
						<strong>本地外部服务</strong>（Ollama / LM Studio）
						<br />
						<span className="guide-option-hint">
							零支出、数据不离开本机，需先安装并启动服务
						</span>
					</span>
				</button>

				{/* 内置模型 */}
				<button
					className="btn guide-option-btn"
					onClick={handleDownloadRecommended}
					disabled={!recommended || diskLow || downloading}
				>
					<Icons.downloadCloud size={16} />
					<span>
						<strong>下载内置模型</strong>
						{recommended && `（${recommended.name}，约 ${(recommended.size_mb / 1024).toFixed(1)} GB）`}
						<br />
						<span className="guide-option-hint">
							{downloading
								? `下载中 ${builtin.downloading[recommended?.id ?? ""] ?? 0}%…`
								: diskLow
									? "磁盘空间不足"
									: "完全离线可用，需重新编译启用推理引擎"}
						</span>
					</span>
				</button>
			</div>
		</Modal>
	);
}
