import { describe, it, expect } from 'vitest'
import { repairTruncatedJson, extractJSON } from '../aiClient'

describe('repairTruncatedJson', () => {
	it('returns valid JSON unchanged', () => {
		const json = '{"key": "value"}'
		expect(repairTruncatedJson(json)).toBe(json)
	})

	it('returns null for unrepairable JSON', () => {
		expect(repairTruncatedJson('invalid json')).toBe(null)
	})

	it('repairs truncated JSON with missing closing brace', () => {
		const truncated = '{"key": "value"'
		const repaired = repairTruncatedJson(truncated)
		expect(repaired).not.toBe(null)
		if (repaired) {
			expect(() => JSON.parse(repaired)).not.toThrow()
		}
	})

	it('repairs truncated JSON array', () => {
		const truncated = '[1, 2, 3'
		const repaired = repairTruncatedJson(truncated)
		expect(repaired).not.toBe(null)
		if (repaired) {
			expect(() => JSON.parse(repaired)).not.toThrow()
		}
	})
})

describe('extractJSON', () => {
	it('extracts JSON array from valid JSON', () => {
		const result = extractJSON('[1, 2, 3]')
		expect(result).toEqual([1, 2, 3])
	})

	it('extracts JSON from markdown code block', () => {
		const text = '```json\n[1, 2, 3]\n```'
		const result = extractJSON(text)
		expect(result).toEqual([1, 2, 3])
	})

	it('extracts JSON from text with surrounding content', () => {
		const text = 'Some text [{"a": 1}, {"b": 2}] more text'
		const result = extractJSON(text)
		expect(result).toEqual([{ a: 1 }, { b: 2 }])
	})

	it('returns empty array for invalid input', () => {
		expect(extractJSON('not json')).toEqual([])
		expect(extractJSON('{"not": "array"}')).toEqual([])
	})
})