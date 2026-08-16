// ============================================================
// 账户余额显示 — 查询并展示 DeepSeek 账户余额
// 仅当 API Key 已配置且 baseURL 指向 DeepSeek 官方时启用
// ============================================================
import { useCallback, useEffect, useState } from "react";
import { fetchAccountBalance, detectProvider, type AccountBalance } from "../../utils/aiClient";
import { Icons } from "../Icons";

interface BalanceSectionProps {
	/** API baseURL */
	baseUrl: string;
	/** API Key */
	apiKey: string;
}

type BalanceState =
	| { status: "idle" }
	| { status: "loading" }
	| { status: "success"; data: AccountBalance }
	| { status: "error"; message: string };

/** 判断 baseURL 是否指向 DeepSeek 官方 API（余额接口仅官方提供） */
function isDeepSeekOfficial(baseUrl: string): boolean {
	const provider = detectProvider(baseUrl);
	return provider === "deepseek" && baseUrl.toLowerCase().includes("deepseek");
}

export function BalanceSection({ baseUrl, apiKey }: BalanceSectionProps) {
	const [state, setState] = useState<BalanceState>({ status: "idle" });

	const loadBalance = useCallback(async () => {
		if (!apiKey) {
			setState({ status: "idle" });
			return;
		}
		setState({ status: "loading" });
		try {
			const data = await fetchAccountBalance({ baseURL: baseUrl, apiKey });
			setState({ status: "success", data });
		} catch (err) {
			setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
		}
	}, [baseUrl, apiKey]);

	// 配置变化后自动刷新一次（微任务延迟，避免 effect 中同步 setState 触发级联渲染）
	useEffect(() => {
		queueMicrotask(() => {
			if (isDeepSeekOfficial(baseUrl) && apiKey) {
				void loadBalance();
			} else {
				setState({ status: "idle" });
			}
		});
	}, [baseUrl, apiKey, loadBalance]);

	// 非 DeepSeek 官方或未配置 Key 时不渲染
	if (!isDeepSeekOfficial(baseUrl) || !apiKey) return null;

	return (
		<div className="config-section">
			<div className="section-label">
				<Icons.wallet size={14} />
				账户余额
				<span className="balance-actions">
					<button
						className="btn btn-sm"
						onClick={loadBalance}
						disabled={state.status === "loading"}
						title="刷新余额"
					>
						<Icons.refreshCw size={12} className={state.status === "loading" ? "spinning" : ""} />
					</button>
				</span>
			</div>

			{state.status === "loading" && (
				<div className="test-row">
					<span className="balance-loading"><Icons.loader2 size={14} className="spinning" />查询中...</span>
				</div>
			)}

			{state.status === "error" && (
				<div className="test-row">
					<div className="test-result error">
						<div className="result-header">
							<Icons.xCircle size={16} />
							<span className="result-status">余额查询失败</span>
						</div>
						<div className="result-message"><p>{state.message}</p></div>
					</div>
				</div>
			)}

			{state.status === "success" && state.data.balance_infos.length > 0 && (
				<div className="balance-list">
					{!state.data.is_available && (
						<div className="balance-unavailable">
							<Icons.alertTriangle size={14} />
							账户当前不可用，请检查账户状态
						</div>
					)}
					{state.data.balance_infos.map((info) => (
						<div key={info.currency} className="balance-item">
							<span className="balance-currency">{info.currency}</span>
							<span className="balance-total">
								<strong>{Number(info.total_balance).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}</strong>
							</span>
							<span className="balance-detail">
								赠送 {Number(info.granted_balance).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}
								· 充值 {Number(info.topped_up_balance).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}
							</span>
						</div>
					))}
				</div>
			)}

			{state.status === "success" && state.data.balance_infos.length === 0 && (
				<div className="test-row">
					<span className="balance-empty">账户暂无余额信息</span>
				</div>
			)}
		</div>
	);
}
