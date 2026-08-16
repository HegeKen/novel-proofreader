import { useState, useCallback } from "react";
import { logger } from "../utils/logger";

interface SearchResult {
	paraIndex: number;
	matchStart: number;
	matchEnd: number;
	text: string;
}

export function useSearch(paragraphs: string[], paragraphIndexMap: number[]) {
	const [showSearch, setShowSearch] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
	const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

	const performSearch = useCallback((query: string) => {
		if (!query.trim()) {
			setSearchResults([]);
			return;
		}
		logger.search(`搜索: "${query}"`);
		const results: SearchResult[] = [];
		const lowerQuery = query.toLowerCase();
		paragraphs.forEach((para, filteredIndex) => {
			const originalIndex = paragraphIndexMap[filteredIndex];
			let startIndex = 0;
			const lowerPara = para.toLowerCase();
			while (startIndex < lowerPara.length) {
				const matchIndex = lowerPara.indexOf(lowerQuery, startIndex);
				if (matchIndex === -1) break;
				results.push({
					paraIndex: originalIndex,
					matchStart: matchIndex,
					matchEnd: matchIndex + query.length,
					text: para.slice(Math.max(0, matchIndex - 20), matchIndex) +
						"【" + para.slice(matchIndex, matchIndex + query.length) + "】" +
						para.slice(matchIndex + query.length, Math.min(para.length, matchIndex + query.length + 20)),
				});
				startIndex = matchIndex + 1;
			}
		});
		setSearchResults(results);
		setCurrentMatchIndex(results.length > 0 ? 0 : -1);
		logger.search(`搜索完成, 找到 ${results.length} 个匹配`);
	}, [paragraphs, paragraphIndexMap]);

	const resetSearch = useCallback(() => {
		setShowSearch(false);
		setSearchResults([]);
		setCurrentMatchIndex(0);
		setSearchQuery("");
	}, []);

	const prevMatch = useCallback(() => {
		if (searchResults.length === 0) return null;
		const newIndex = currentMatchIndex > 0 ? currentMatchIndex - 1 : searchResults.length - 1;
		setCurrentMatchIndex(newIndex);
		return searchResults[newIndex]?.paraIndex ?? null;
	}, [searchResults, currentMatchIndex]);

	const nextMatch = useCallback(() => {
		if (searchResults.length === 0) return null;
		const newIndex = currentMatchIndex < searchResults.length - 1 ? currentMatchIndex + 1 : 0;
		setCurrentMatchIndex(newIndex);
		return searchResults[newIndex]?.paraIndex ?? null;
	}, [searchResults, currentMatchIndex]);

	const handleSearchResultClick = useCallback((index: number) => {
		setCurrentMatchIndex(index);
		const match = searchResults[index];
		resetSearch();
		return match?.paraIndex ?? null;
	}, [searchResults, resetSearch]);

	const closeSearch = useCallback(() => {
		resetSearch();
	}, [resetSearch]);

	return {
		showSearch,
		setShowSearch,
		searchQuery,
		setSearchQuery,
		searchResults,
		currentMatchIndex,
		performSearch,
		prevMatch,
		nextMatch,
		handleSearchResultClick,
		closeSearch,
	};
}
