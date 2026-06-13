import { describe, it, expect } from 'vitest'
import { formatFileSize, formatDateTime, buildParagraphIndexMap, buildOriginalToFilteredMap } from '../formatters'

describe('formatFileSize', () => {
	it('formats bytes', () => {
		expect(formatFileSize('hello')).toBe('5 B')
	})

	it('formats kilobytes', () => {
		const text = 'a'.repeat(2000)
		expect(formatFileSize(text)).toContain('KB')
	})

	it('formats megabytes', () => {
		const text = 'a'.repeat(2 * 1024 * 1024)
		expect(formatFileSize(text)).toContain('MB')
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
