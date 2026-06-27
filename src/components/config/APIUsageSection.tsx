import { useState, useMemo } from "react";
import { useAppMetaStore } from "../../stores/appMetaStore";
import { formatLargeNumber } from "../../utils/formatters";
import { Icons } from "../Icons";

export function APIUsageSection() {
	const apiUsage = useAppMetaStore((s) => s.apiUsage);
	const resetAPIUsage = useAppMetaStore((s) => s.resetAPIUsage);
	const [hoveredDay, setHoveredDay] = useState<string | null>(null);

	const successRate = apiUsage.totalRequests > 0
		? Math.round((apiUsage.successfulRequests / apiUsage.totalRequests) * 100) : 0;
	const errorRate = apiUsage.totalRequests > 0
		? Math.round((apiUsage.failedRequests / apiUsage.totalRequests) * 100) : 0;

	const recentDays = useMemo(() => {
		const days: string[] = [];
		for (let i = 6; i >= 0; i--) {
			const date = new Date();
			date.setDate(date.getDate() - i);
			days.push(date.toISOString().split('T')[0]);
		}
		return days;
	}, []);

	const maxTokenValue = useMemo(() => {
		let max = 0;
		recentDays.forEach(day => {
			const dayStats = (apiUsage.dailyStats ?? {})[day];
			if (dayStats) {
				const total = (dayStats.inputTokens ?? 0) + (dayStats.outputTokens ?? 0);
				max = Math.max(max, total);
			}
		});
		return max || 1;
	}, [apiUsage.dailyStats, recentDays]);

	const formatDate = (dateStr: string) => {
		const date = new Date(dateStr);
		return `${date.getMonth() + 1}-${date.getDate().toString().padStart(2, '0')}`;
	};

	const formatTooltipDate = (dateStr: string) => {
		const date = new Date(dateStr);
		return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
	};

	return (
		<div className="config-section">
			<div className="section-label"><Icons.barChart3 size={14} />API 使用统计</div>
			<div className="usage-stats">
				<div className="usage-stat-card total">
					<div className="usage-stat-header"><div className="usage-stat-icon"><Icons.barChart3 size={16} /></div></div>
					<div className="usage-stat-value">{apiUsage.totalRequests}</div>
					<div className="usage-stat-label">总请求数</div>
				</div>
				<div className="usage-stat-card success">
					<div className="usage-stat-header"><div className="usage-stat-icon"><Icons.checkCircle size={16} /></div></div>
					<div className="usage-stat-value">{apiUsage.successfulRequests}</div>
					<div className="usage-stat-label">成功请求</div>
				</div>
				<div className="usage-stat-card failed">
					<div className="usage-stat-header"><div className="usage-stat-icon"><Icons.alertCircle size={16} /></div></div>
					<div className="usage-stat-value">{apiUsage.failedRequests}</div>
					<div className="usage-stat-label">失败请求</div>
				</div>
				<div className="usage-stat-card tokens">
					<div className="usage-stat-header"><div className="usage-stat-icon"><Icons.barChart3 size={16} /></div></div>
					<div className="usage-stat-value">{formatLargeNumber(apiUsage.totalTokens)}</div>
					<div className="usage-stat-label">Token 总量</div>
				</div>
				<div className="usage-stat-card input-tokens">
					<div className="usage-stat-header"><div className="usage-stat-icon"><Icons.upload size={16} /></div></div>
					<div className="usage-stat-value">{formatLargeNumber(apiUsage.inputTokens)}</div>
					<div className="usage-stat-label">输入 Token</div>
				</div>
				<div className="usage-stat-card output-tokens">
					<div className="usage-stat-header"><div className="usage-stat-icon"><Icons.download size={16} /></div></div>
					<div className="usage-stat-value">{formatLargeNumber(apiUsage.outputTokens)}</div>
					<div className="usage-stat-label">输出 Token</div>
				</div>
			</div>
			<div className="usage-progress">
				<div className="usage-progress-header">
					<span className="usage-progress-label">成功率</span>
					<span className="usage-progress-value">{successRate}%</span>
				</div>
				<div className="usage-progress-bar"><div className="usage-progress-fill success" style={{ width: `${successRate}%` }} /></div>
			</div>
			<div className="usage-progress">
				<div className="usage-progress-header">
					<span className="usage-progress-label">失败率</span>
					<span className="usage-progress-value">{errorRate}%</span>
				</div>
				<div className="usage-progress-bar"><div className="usage-progress-fill error" style={{ width: `${errorRate}%` }} /></div>
			</div>

			{/* 近七天柱状图 */}
			{Object.keys(apiUsage.dailyStats ?? {}).length > 0 && (
				<div className="token-chart-section">
					<div className="token-chart-header">
						<Icons.calendar size={14} />
						近七天用量统计
					</div>
					<div className="token-chart">
						<div className="token-chart-y-axis">
							{[maxTokenValue, maxTokenValue * 0.75, maxTokenValue * 0.5, maxTokenValue * 0.25, 0].map((value, index) => (
								<div key={index} className="y-axis-label">
									{value >= 1000000 ? `${(value / 1000000).toFixed(0)}M` : value >= 1000 ? `${(value / 1000).toFixed(0)}K` : value}
								</div>
							))}
						</div>
						<div className="token-chart-bars">
							{recentDays.map(day => {
								const dayStats = (apiUsage.dailyStats ?? {})[day];
								if (!dayStats) return null;

								const inputTokens = dayStats.inputTokens ?? 0;
								const outputTokens = dayStats.outputTokens ?? 0;
								const dayTotal = inputTokens + outputTokens;
								const inputHeight = (inputTokens / maxTokenValue) * 100;
								const outputHeight = (outputTokens / maxTokenValue) * 100;
								const isHovered = hoveredDay === day;

								return (
									<div
										key={day}
										className="token-chart-bar-group"
										onMouseEnter={() => setHoveredDay(day)}
										onMouseLeave={() => setHoveredDay(null)}
									>
										<div className="token-chart-bar-stack">
											<div
												className={`token-chart-bar input-bar ${isHovered ? "hovered" : ""}`}
												style={{ height: `${inputHeight}%` }}
											/>
											<div
												className={`token-chart-bar output-bar ${isHovered ? "hovered" : ""}`}
												style={{ height: `${outputHeight}%` }}
											/>
										</div>
										<div className="token-chart-bar-label">{formatDate(day)}</div>
										{isHovered && (
											<div className="token-chart-tooltip">
												<div className="tooltip-date">{formatTooltipDate(day)}</div>
												<div className="tooltip-total">{formatLargeNumber(dayTotal)} tokens</div>
												<div className="tooltip-items">
													<div className="tooltip-item input">
														<span className="tooltip-color input-color" />
														<span className="tooltip-text">输入: {formatLargeNumber(inputTokens)} tokens</span>
													</div>
													<div className="tooltip-item output">
														<span className="tooltip-color output-color" />
														<span className="tooltip-text">输出: {formatLargeNumber(outputTokens)} tokens</span>
													</div>
												</div>
											</div>
										)}
									</div>
								);
							})}
						</div>
					</div>
					<div className="token-chart-legend">
						<div className="legend-item">
							<span className="legend-color input-color" />
							<span className="legend-text">输入</span>
						</div>
						<div className="legend-item">
							<span className="legend-color output-color" />
							<span className="legend-text">输出</span>
						</div>
					</div>
				</div>
			)}

			{/* 提供商统计 */}
			{Object.keys(apiUsage.providerStats ?? {}).length > 0 && (
				<div className="provider-stats">
					<div className="provider-stats-header"><Icons.cache size={12} />按提供商统计</div>
					{Object.entries(apiUsage.providerStats ?? {}).map(([provider, stats], index) => (
						<div key={provider} className="provider-stat-item">
							<div className="provider-stat-info">
								<div className="provider-stat-icon">{index + 1}</div>
								<span className="provider-stat-name">{provider}</span>
							</div>
							<div className="provider-stat-details">
								<span className="provider-stat-requests">{stats.requests} 请求</span>
								<span className="provider-stat-success"><Icons.check size={12} />{stats.success} 成功</span>
							</div>
						</div>
					))}
				</div>
			)}
			<button className="btn-reset-usage" onClick={resetAPIUsage}>
				<Icons.refresh size={14} />重置统计
			</button>
		</div>
	);
}