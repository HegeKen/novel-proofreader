// ============================================================
// 错误边界 — 捕获渲染异常并展示友好的错误页面
// ============================================================
import { Component, type ReactNode } from "react";
import { Icons } from "./Icons";
import { logger } from "../utils/logger";

interface Props {
	children: ReactNode;
	fallback?: ReactNode;
}

interface State {
	hasError: boolean;
	error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
	state: State = { hasError: false };

	static getDerivedStateFromError(error: Error): State {
		return { hasError: true, error };
	}

	componentDidCatch(error: Error, info: React.ErrorInfo) {
		logger.errorGeneric("[ErrorBoundary]", error, info.componentStack);
	}

	handleReset = () => {
		this.setState({ hasError: false, error: undefined });
	};

	handleReload = () => {
		window.location.reload();
	};

	handleCopy = () => {
		const text = `${this.state.error?.message}\n${this.state.error?.stack}`;
		navigator.clipboard.writeText(text).catch(() => {});
	};

	render() {
		if (this.state.hasError) {
			if (this.props.fallback) return this.props.fallback;

			return (
				<div className="error-boundary">
					<div className="error-boundary-icon">
						<Icons.alertCircle size={28} />
					</div>
					<h2 className="error-boundary-title">应用出现异常</h2>
					<p className="error-boundary-message">
						{this.state.error?.message}
					</p>
					<div className="error-boundary-actions">
						<button className="btn" onClick={this.handleReset}>
							<Icons.reset size={16} />
							<span>重试</span>
						</button>
						<button className="btn" onClick={this.handleReload}>
							<Icons.refreshCw size={16} />
							<span>重新加载</span>
						</button>
						<button className="btn" onClick={this.handleCopy}>
							<Icons.copy size={16} />
							<span>复制错误</span>
						</button>
					</div>
				</div>
			);
		}
		return this.props.children;
	}
}
