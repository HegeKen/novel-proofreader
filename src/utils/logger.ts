// ============================================================
// 调试日志工具 — 通过 AIConfig.enableLogging 控制开关
// ============================================================

let enabled = false;

export function setLoggerEnabled(v: boolean) {
  enabled = v;
}

function ts(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}

export const logger = {
  /** AI 请求发起 */
  request(url: string, headers: Record<string, string>, body: unknown) {
    if (!enabled) return;
    console.groupCollapsed(`%c[AI →] ${ts()} ${url}`, 'color:#2196F3;font-weight:bold');
    console.log('Headers:', { ...headers, Authorization: headers.Authorization ? '***已隐藏***' : '(无)' });
    console.log('Body:', body);
    console.groupEnd();
  },

  /** AI 响应成功 */
  response(url: string, status: number, data: unknown, elapsed: number) {
    if (!enabled) return;
    console.groupCollapsed(`%c[AI ←] ${ts()} ${url} ${status} (${elapsed}ms)`, 'color:#4CAF50;font-weight:bold');
    console.log('Response:', data);
    console.groupEnd();
  },

  /** AI 请求失败 */
  error(url: string, status: number, body: string, elapsed: number) {
    if (!enabled) return;
    console.groupCollapsed(`%c[AI ✗] ${ts()} ${url} ${status} (${elapsed}ms)`, 'color:#F44336;font-weight:bold');
    console.log('Error body:', body);
    console.groupEnd();
  },

  /** 通用信息 */
  info(label: string, ...args: unknown[]) {
    if (!enabled) return;
    console.log(`%c[${label}] ${ts()}`, 'color:#9C27B0;font-weight:bold', ...args);
  },
};
