import type { ReactNode } from "react";

/**
 * 可复用的格式化函数
 */

/** 按字节数格式化文件大小 */
export function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 按文本内容格式化大小（内部转为字节数） */
export function formatTextSize(text: string): string {
    return formatFileSize(new TextEncoder().encode(text).length);
}

export function formatDateTime(timestamp: number | Date): string {
    const date = typeof timestamp === 'number' ? new Date(timestamp) : timestamp;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/** 将秒数格式化为 分:秒（如 3:45），不足 1 秒显示 0:00 */
export function formatElapsedTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatLargeNumber(value: number | undefined): ReactNode {
    if (value === undefined || value === null || isNaN(value)) return '0';
    const detailed = value.toLocaleString();
    if (value >= 1_000_000_000) {
        return (
            <>
                {(value / 1_000_000_000).toFixed(1)}B{" "}
                <span className="token-detailed">({detailed})</span>
            </>
        );
    }
    if (value >= 1_000_000) {
        return (
            <>
                {(value / 1_000_000).toFixed(1)}M{" "}
                <span className="token-detailed">({detailed})</span>
            </>
        );
    }
    if (value >= 1_000) {
        return (
            <>
                {(value / 1_000).toFixed(1)}K{" "}
                <span className="token-detailed">({detailed})</span>
            </>
        );
    }
    return detailed;
}
