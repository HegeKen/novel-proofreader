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
