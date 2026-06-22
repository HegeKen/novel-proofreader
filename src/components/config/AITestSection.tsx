import { useState } from "react";
import { testConnection } from "../../utils/aiClient";
import { Icons } from "../Icons";

export function AITestSection({ config }: { config: { baseUrl: string; apiKey: string; model: string } }) {
	const [testText, setTestText] = useState("请回复\"测试成功\"这四个字。");
	const [isTesting, setIsTesting] = useState(false);
	const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

	const handleTest = async () => {
		setIsTesting(true);
		setTestResult(null);
		try {
			const result = await testConnection({
				baseURL: config.baseUrl,
				apiKey: config.apiKey,
				model: config.model,
				maxCharsPerRequest: 5000,
				enableLogging: true,
				customHeaders: {},
			}, testText);
			setTestResult(result);
		} catch (err) {
			setTestResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
		} finally {
			setIsTesting(false);
		}
	};

	const renderInline = (text: string): string => {
		return text
			.replace(/<script[\s\S]*?<\/script>/gi, '')
			.replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
			.replace(/on\w+="[^"]*"/gi, '')
			.replace(/on\w+='[^']*'/gi, '')
			.replace(/javascript:/gi, '')
			.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
			.replace(/\*(.+?)\*/g, '<em>$1</em>')
			.replace(/`(.+?)`/g, '<code>$1</code>');
	};

	return (
		<div className="config-section">
			<div className="section-label">
				<Icons.bolt size={14} />
				测试 AI 连接
			</div>
			<div className="test-row test-row-1">
				<input
					type="text"
					value={testText}
					onChange={(e) => setTestText(e.target.value)}
					placeholder="输入测试文本..."
					className="test-input"
				/>
				<button
					className="btn"
					onClick={handleTest}
					disabled={isTesting || !config.baseUrl || !config.apiKey || !config.model}
				>
					{isTesting ? (
						<><Icons.loader2 size={14} className="spinning" />测试中...</>
					) : (
						<><Icons.play size={14} />测试</>
					)}
				</button>
			</div>
			{testResult && (
				<div className="test-row test-row-2">
					<div className={`test-result ${testResult.ok ? "success" : "error"}`}>
						<div className="result-header">
							{testResult.ok ? <Icons.checkCircle size={16} /> : <Icons.xCircle size={16} />}
							<span className="result-status">{testResult.ok ? "测试成功" : "测试失败"}</span>
						</div>
						<div className="result-message">
							<p dangerouslySetInnerHTML={{ __html: renderInline(testResult.message) }} />
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
