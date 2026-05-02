export interface URLParams {
	bookId?: number;
	chapter?: number;
	readingMode?: "true" | "false";
}

export function parseURLParams(): URLParams {
	if (typeof window === "undefined") return {};

	const params = new URLSearchParams(window.location.search);
	return {
		bookId: params.has("bookId") ? parseInt(params.get("bookId")!, 10) : undefined,
		chapter: params.has("chapter") ? parseInt(params.get("chapter")!, 10) : undefined,
		readingMode: (params.get("readingMode") as URLParams["readingMode"]) ?? undefined,
	};
}

export function updateURLParams(updates: Partial<URLParams>) {
	if (typeof window === "undefined") return;

	const params = new URLSearchParams(window.location.search);

	for (const [key, value] of Object.entries(updates)) {
		if (value === undefined || value === null) {
			params.delete(key);
		} else {
			params.set(key, String(value));
		}
	}

	const newURL = params.toString()
		? `${window.location.pathname}?${params.toString()}`
		: window.location.pathname;

	window.history.replaceState(null, "", newURL);
}

export function getCurrentURLParams(): URLParams {
	return parseURLParams();
}
