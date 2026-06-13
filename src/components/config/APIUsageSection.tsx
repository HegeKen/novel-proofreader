
import { useAppMetaStore } from "../../stores/appMetaStore";
import { formatLargeNumber } from "../../utils/formatters";
import { Icons } from "../Icons";

export function APIUsageSection() {
	const apiUsage = useAppMetaStore((s) => s.apiUsage);
	const resetAPIUsage = useAppMetaStore((s) => s.resetAPIUsage);

	const successRate = apiUsage.totalRequests > 0
		? Math.round((apiUsage.successfulRequests / apiUsage.totalRequests) * 100) : 0;
	const errorRate = apiUsage.totalRequests > 0
		? Math.round((apiUsage.failedRequests / apiUsage.totalRequests) * 100) : 0;

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
					<div className="usage-stat-label">Token 使用量</div>
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
			{Object.keys(apiUsage.providerStats).length > 0 && (
				<div className="provider-stats">
					<div className="provider-stats-header"><Icons.cache size={12} />按提供商统计</div>
					{Object.entries(apiUsage.providerStats).map(([provider, stats], index) => (
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
