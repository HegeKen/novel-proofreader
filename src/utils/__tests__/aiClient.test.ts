import { describe, it, expect } from 'vitest'
import { repairTruncatedJson, extractJSON, normalizeErrors } from '../aiClient'

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

	it('extracts JSON object from valid JSON', () => {
		const result = extractJSON('{"errors": [], "merge_suggestion": null}')
		expect(result).toEqual({ errors: [], merge_suggestion: null })
	})

	it('extracts JSON from markdown code block', () => {
		const text = '```json\n[1, 2, 3]\n```'
		const result = extractJSON(text)
		expect(result).toEqual([1, 2, 3])
	})

	it('extracts JSON object from markdown code block', () => {
		const text = '```json\n{"errors": [], "merge_suggestion": null}\n```'
		const result = extractJSON(text)
		expect(result).toEqual({ errors: [], merge_suggestion: null })
	})

	it('extracts JSON from text with surrounding content', () => {
		const text = 'Some text [{"a": 1}, {"b": 2}] more text'
		const result = extractJSON(text)
		expect(result).toEqual([{ a: 1 }, { b: 2 }])
	})

	it('extracts JSON object from text with surrounding content', () => {
		const text = 'Some text {"errors": [{"line": 1}]} more text'
		const result = extractJSON(text)
		expect(result).toEqual({ errors: [{ line: 1 }] })
	})

	it('returns empty array for invalid input', () => {
		expect(extractJSON('not json')).toEqual([])
	})
})

describe('normalizeErrors', () => {
	it('returns array as-is', () => {
		const errors = [{ line: 1 }, { line: 2 }]
		expect(normalizeErrors(errors)).toEqual(errors)
	})

	it('extracts errors from object with errors field', () => {
		const obj = { errors: [{ line: 1 }], merge_suggestion: null }
		expect(normalizeErrors(obj)).toEqual([{ line: 1 }])
	})

	it('returns empty array for object without errors field', () => {
		expect(normalizeErrors({ key: 'value' })).toEqual([])
	})

	it('returns empty array for null/undefined', () => {
		expect(normalizeErrors(null)).toEqual([])
		expect(normalizeErrors(undefined)).toEqual([])
	})
})