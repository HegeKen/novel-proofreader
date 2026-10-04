import { describe, it, expect } from 'vitest'
import { formatFileSize, formatTextSize, formatDateTime } from '../formatters'
import { buildParagraphIndexMap, buildOriginalToFilteredMap } from '../chapterSplit'

describe('formatFileSize', () => {
	it('formats bytes', () => {
		expect(formatFileSize(5)).toBe('5 B')
	})

	it('formats kilobytes', () => {
		expect(formatFileSize(2000)).toContain('KB')
	})

	it('formats megabytes', () => {
		expect(formatFileSize(2 * 1024 * 1024)).toContain('MB')
	})
})

describe('formatTextSize', () => {
	it('formats text by byte length', () => {
		expect(formatTextSize('hello')).toBe('5 B')
	})
})

describe('formatDateTime', () => {
	it('formats timestamp', () => {
		const ts = new Date(2024, 0, 15, 10, 30, 45).getTime()
		expect(formatDateTime(ts)).toBe('2024-01-15 10:30:45')
	})

	it('formats Date object', () => {
		const date = new Date(2024, 11, 25, 8, 5, 3)
		expect(formatDateTime(date)).toBe('2024-12-25 08:05:03')
	})

	it('pads single digits', () => {
		const date = new Date(2024, 0, 1, 1, 1, 1)
		expect(formatDateTime(date)).toBe('2024-01-01 01:01:01')
	})
})

describe('buildParagraphIndexMap', () => {
	it('maps non-empty lines', () => {
		expect(buildParagraphIndexMap('a\n\nb\nc')).toEqual([0, 2, 3])
	})

	it('returns empty for all-empty content', () => {
		expect(buildParagraphIndexMap('\n\n\n')).toEqual([])
	})

	it('handles single line', () => {
		expect(buildParagraphIndexMap('hello')).toEqual([0])
	})
})

describe('buildOriginalToFilteredMap', () => {
	it('maps original indices to filtered indices', () => {
		const map = buildOriginalToFilteredMap('a\n\nb')
		expect(map[0]).toBe(0)
		expect(map[1]).toBeUndefined()
		expect(map[2]).toBe(1)
	})
})
