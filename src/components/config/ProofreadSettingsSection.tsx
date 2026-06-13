import { useConfigStore } from "../../stores/configStore";
import { Icons } from "../Icons";

export function ProofreadSettingsSection() {
	const proofreadConfig = useConfigStore((s) => s.proofreadConfig);
	const updateProofreadConfig = useConfigStore((s) => s.updateProofreadConfig);

	return (
		<div className="config-section">
			<div className="section-label"><Icons.bolt size={14} />校对设置</div>
			<div className="toggle-item">
				<label className="toggle-label">
					<div className="toggle-switch">
						<input type="checkbox" checked={proofreadConfig.enableParallelProcessing}
							onChange={(e) => updateProofreadConfig({ enableParallelProcessing: e.target.checked })} />
						<span className="toggle-slider"></span>
					</div>
					<span className="toggle-text">启用多线程并发</span>
				</label>
				<span className="toggle-hint">启用后，校对将使用多线程并发处理，提高检测速度</span>
			</div>
			{proofreadConfig.enableParallelProcessing && (
				<div className="form-field">
					<label>最大并发数</label>
					<div className="input-wrapper">
						<input type="number" min="1" max="10" value={proofreadConfig.maxConcurrentBatches}
							onChange={(e) => updateProofreadConfig({ maxConcurrentBatches: parseInt(e.target.value) || 4 })}
							className="config-input" />
					</div>
					<p className="field-hint">建议根据您的 API 限制和网络状况调整（默认：4）</p>
				</div>
			)}
		</div>
	);
}
