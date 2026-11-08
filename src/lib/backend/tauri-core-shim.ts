// ============================================================
// Web 模式下的 Tauri invoke 适配：POST /api/rpc
// 仅在 Web 构建时通过 Vite alias 替换 @tauri-apps/api/core
// ============================================================

/** RPC 请求体 */
interface RpcRequest {
	command: string;
	args: Record<string, unknown>;
}

/** 调用后端命令，语义与 Tauri invoke 一致（失败抛出 Error） */
export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
	const payload: RpcRequest = { command, args: args ?? {} };
	const response = await fetch("/api/rpc", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(payload),
	});
	const text = await response.text();
	if (!response.ok) {
		throw new Error(text || `HTTP ${response.status}`);
	}
	if (!text) return null as T;
	const data = JSON.parse(text) as unknown;
	if (
		data !== null &&
		typeof data === "object" &&
		"error" in data &&
		typeof (data as { error?: unknown }).error === "string"
	) {
		throw new Error((data as { error: string }).error);
	}
	return data as T;
}
