import type { ReactNode } from "react";

/**
 * 可复用的格式化函数
 */

export function formatFileSize(text: string): string {
    const bytes = new TextEncoder().encode(text).length;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDateTime(timestamp: number): string {
    const d = new Date(timestamp);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function buildParagraphIndexMap(content: string): number[] {
    const lines = content.split("\n");
    const map: number[] = [];
    lines.forEach((line, i) => {
        if (line.trim() !== "") {
            map.push(i);
        }
    });
    return map;
}

// 新增：构建原始索引到过滤后索引的反向映射
export function buildOriginalToFilteredMap(content: string): Record<number, number> {
    const lines = content.split("\n");
    const map: Record<number, number> = {};
    let filteredIndex = 0;
    lines.forEach((line, originalIndex) => {
        if (line.trim() !== "") {
            map[originalIndex] = filteredIndex;
            filteredIndex++;
        }
    });
    return map;
}

export function formatLargeNumber(value: number): ReactNode {
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