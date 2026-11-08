// ============================================================
// Web 模式下的 Tauri 事件适配：单例 EventSource 订阅 /api/events
// 仅在 Web 构建时通过 Vite alias 替换 @tauri-apps/api/event
// ============================================================

type EventHandler = (event: { event: string; payload: unknown }) => void;

interface Envelope {
	event: string;
	payload: unknown;
}

const listeners = new Map<string, Set<EventHandler>>();
let source: EventSource | null = null;

function ensureSource(): void {
	if (source) return;
	source = new EventSource("/api/events");
	source.onmessage = (message) => {
		try {
			const envelope = JSON.parse(message.data) as Envelope;
			const handlers = listeners.get(envelope.event);
			if (handlers) {
				handlers.forEach((handler) => handler(envelope));
			}
		} catch {
			// 非 JSON 消息忽略
		}
	};
}

/** 订阅事件，返回取消订阅函数（与 Tauri listen 一致） */
export async function listen<T>(
	event: string,
	handler: (event: { event: string; payload: T }) => void,
): Promise<() => void> {
	ensureSource();
	const set = listeners.get(event) ?? new Set<EventHandler>();
	set.add(handler as EventHandler);
	listeners.set(event, set);
	return () => {
		set.delete(handler as EventHandler);
		if (set.size === 0) listeners.delete(event);
	};
}

/** 只订阅一次 */
export async function once<T>(
	event: string,
	handler: (event: { event: string; payload: T }) => void,
): Promise<() => void> {
	const unlisten = await listen<T>(event, (payload) => {
		unlisten();
		handler(payload);
	});
	return unlisten;
}

/** Web 端无前端主动发事件的能力，保持空实现 */
export async function emit(): Promise<void> {
	// no-op
}
