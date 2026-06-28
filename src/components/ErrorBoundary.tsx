import { Component, type ReactNode } from "react";
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
		logger.errorGeneric('[ErrorBoundary]', error, info.componentStack);
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
				<div className="app" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", gap: "12px", padding: "24px", textAlign: "center" }}>
					<div style={{ fontSize: "48px", opacity: 0.6 }}>💥</div>
					<h2 style={{ margin: 0, color: "var(--text-primary)" }}>应用出现异常</h2>
					<p style={{ color: "var(--text-muted)", fontSize: "13px", maxWidth: "400px", lineHeight: 1.6 }}>
						{this.state.error?.message}
					</p>
					<div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
						<button className="btn" onClick={this.handleReset}>重试</button>
						<button className="btn" onClick={this.handleReload}>重新加载</button>
						<button className="btn" onClick={this.handleCopy}>复制错误</button>
					</div>
				</div>
			);
		}
		return this.props.children;
	}
}
