import { logger } from "../../utils/logger";
import { Icons } from "../Icons";
import type { PromptConfig } from "./promptConfig";
import { DEFAULTS, LABELS } from "./promptConfig";

export function PromptSettingsSection({
	prompts,
	onChange,
}: {
	prompts: PromptConfig;
	onChange: (key: keyof PromptConfig, value: string) => void;
}) {
	const handleCopy = async (text: string, label: string) => {
		try { await navigator.clipboard.writeText(text); logger.ui(`已复制: ${label}`); }
		catch (err) { logger.errorGeneric('复制失败:', err); }
	};

	return (
		<div className="config-section prompt-section">
			<div className="section-label"><Icons.punctuation size={14} />PROMPT</div>
			{(Object.keys(LABELS) as (keyof PromptConfig)[]).map((key) => (
				<div key={key} className="prompt-item">
					<div className="prompt-header">
						<label className="prompt-label">{LABELS[key].label}</label>
						<div className="prompt-actions">
							<button className="prompt-btn" onClick={() => handleCopy(prompts[key], LABELS[key].label)} title="复制">
								<Icons.copy size={14} />
							</button>
							<button className="prompt-btn" onClick={() => onChange(key, DEFAULTS[key])} title="重置">
								<Icons.reset size={14} />
							</button>
						</div>
					</div>
					<textarea className="prompt-textarea" value={prompts[key]}
						onChange={(e) => onChange(key, e.target.value)}
						rows={LABELS[key].rows} />
					<p className="prompt-hint">{LABELS[key].hint}</p>
				</div>
			))}
		</div>
	);
}