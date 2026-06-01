import { Component, type ReactNode } from "react";

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

	handleReset = () => {
		this.setState({ hasError: false, error: undefined });
	};

	render() {
		if (this.state.hasError) {
			return (
				this.props.fallback || (
					<div className="app" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", gap: "12px", padding: "24px", textAlign: "center" }}>
						<div style={{ fontSize: "48px", opacity: 0.6 }}>💥</div>
						<h2 style={{ margin: 0, color: "var(--text-primary)" }}>应用出现异常</h2>
						<p style={{ color: "var(--text-muted)", fontSize: "13px", maxWidth: "400px", lineHeight: 1.6 }}>
							{this.state.error?.message}
						</p>
						<button
							className="btn"
							onClick={this.handleReset}
							style={{ marginTop: "8px" }}
						>
							重试
						</button>
					</div>
				)
			);
		}
		return this.props.children;
	}
}
