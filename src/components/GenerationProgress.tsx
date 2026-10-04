// ============================================================
// 通用 AI 生成进度条组件 — 阶段文字 + 进度条 + 已耗时 + 状态色
// ============================================================
import { Icons } from "./Icons";
import { formatElapsedTime } from "../utils/formatters";

interface GenerationProgressProps {
	/** 当前阶段文字，如"分析中"、"合并中" */
	phase: string;
	/** 进度消息文字 */
	message: string;
	/** 进度数据 */
	progress: { current: number; total: number };
	/** 已耗时（秒），传入则显示"已耗时 xx:xx" */
	elapsed?: number;
	/** 状态：info（默认）| success | error */
	status: "info" | "success" | "error" | null;
	/** 是否正在生成中（控制 spinner 和关闭按钮） */
	isRunning: boolean;
	/** 关闭进度条回调（仅在非运行中且有点击意义时传入） */
	onClose?: () => void;
}

/** 通用 AI 生成进度展示，消除各弹窗中的重复进度 UI */
export function GenerationProgress({ phase, message, progress, elapsed, status, isRunning, onClose }: GenerationProgressProps) {
	return (
		<div className={`generation-progress ${status || "info"}`}>
			<div className="generation-progress-header">
				<Icons.brain size={16} />
				<span className="generation-progress-phase">{phase}</span>
				{isRunning && (
					<Icons.loader2 size={14} className="generation-spinner" />
				)}
				{!isRunning && status && onClose && (
					<button className="generation-progress-close" onClick={onClose}>
						<Icons.x size={14} />
					</button>
				)}
			</div>
			<div className="generation-progress-bar">
				<div
					className="generation-progress-fill"
					style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }}
				/>
			</div>
			<div className="generation-progress-footer">
				<span className="generation-progress-message">{message}</span>
				{isRunning && elapsed !== undefined && (
					<span className="generation-progress-counter">
						已耗时 {formatElapsedTime(elapsed)}
					</span>
				)}
				{progress.total > 1 && (
					<span className="generation-progress-counter">{progress.current}/{progress.total}</span>
				)}
			</div>
		</div>
	);
}
