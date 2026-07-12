import { describe, it, expect } from 'vitest'
import { normalizeWhitespace, findExactMatch, findLocalMatch, findGlobalMatch, replaceTextInParagraph } from '../novelStore'

describe('normalizeWhitespace', () => {
	it('removes all whitespace', () => {
		expect(normalizeWhitespace('hello world')).toBe('helloworld')
		expect(normalizeWhitespace('hello\nworld')).toBe('helloworld')
		expect(normalizeWhitespace('hello  \tworld')).toBe('helloworld')
		expect(normalizeWhitespace('  hello  world  ')).toBe('helloworld')
	})

	it('returns empty string for whitespace-only input', () => {
		expect(normalizeWhitespace('   \n\t  ')).toBe('')
	})
})

describe('findExactMatch', () => {
	it('finds exact match with valid indices', () => {
		const result = findExactMatch('hello world', 'world', 6, 11)
		expect(result.found).toBe(true)
		expect(result.start).toBe(6)
		expect(result.end).toBe(11)
	})

	it('finds match with whitespace normalization', () => {
		const result = findExactMatch('hello   world', 'hello world', 0, 13)
		expect(result.found).toBe(true)
	})

	it('returns not found for invalid indices', () => {
		const result = findExactMatch('hello', 'world', 0, 5)
		expect(result.found).toBe(false)
	})

	it('returns not found for out of bounds indices', () => {
		const result = findExactMatch('hello', 'world', 10, 15)
		expect(result.found).toBe(false)
	})
})

describe('findLocalMatch', () => {
	it('finds local exact match', () => {
		const result = findLocalMatch('hello world hello', 'world', 6)
		expect(result.found).toBe(true)
		expect(result.start).toBe(6)
		expect(result.end).toBe(11)
	})

	it('finds local match with whitespace normalization', () => {
		const result = findLocalMatch('hello   world', 'world', 6)
		expect(result.found).toBe(true)
	})

	it('returns not found when text not in range', () => {
		const result = findLocalMatch('hello world', 'test', 6)
		expect(result.found).toBe(false)
	})

	it('returns not found when startIndex is undefined', () => {
		const result = findLocalMatch('hello world', 'world', undefined)
		expect(result.found).toBe(false)
	})
})

describe('findGlobalMatch', () => {
	it('finds global exact match', () => {
		const result = findGlobalMatch('hello world hello', 'world')
		expect(result.found).toBe(true)
		expect(result.start).toBe(6)
		expect(result.end).toBe(11)
	})

	it('finds global match with whitespace normalization', () => {
		const result = findGlobalMatch('hello   world', 'hello world')
		expect(result.found).toBe(true)
	})

	it('returns not found when text not present', () => {
		const result = findGlobalMatch('hello world', 'test')
		expect(result.found).toBe(false)
	})
})

describe('replaceTextInParagraph', () => {
	it('returns unchanged when oldText equals newText', () => {
		const result = replaceTextInParagraph('hello world', 'world', 'world')
		expect(result.replaced).toBe(false)
		expect(result.result).toBe('hello world')
	})

	it('replaces with exact match', () => {
		const result = replaceTextInParagraph('hello world', 'world', 'there')
		expect(result.replaced).toBe(true)
		expect(result.result).toBe('hello there')
	})

	it('replaces with index match', () => {
		const result = replaceTextInParagraph('hello world', 'world', 'there', 6, 11)
		expect(result.replaced).toBe(true)
		expect(result.result).toBe('hello there')
	})

	it('replaces with whitespace-insensitive match', () => {
		const result = replaceTextInParagraph('hello   world', 'hello world', 'hi there')
		expect(result.replaced).toBe(true)
		expect(result.result).toBe('hi there')
	})

	it('returns not replaced when text not found', () => {
		const result = replaceTextInParagraph('hello world', 'test', 'replacement')
		expect(result.replaced).toBe(false)
		expect(result.result).toBe('hello world')
	})
})