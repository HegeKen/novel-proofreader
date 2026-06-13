import { describe, it, expect, beforeEach } from 'vitest'
import { parseURLParams, updateURLParams } from '../urlParams'

describe('parseURLParams', () => {
	beforeEach(() => {
		window.history.replaceState(null, '', '/')
	})

	it('returns empty object when no params', () => {
		expect(parseURLParams()).toEqual({})
	})

	it('parses bookId param', () => {
		window.history.replaceState(null, '', '/?bookId=3')
		expect(parseURLParams().bookId).toBe(3)
	})

	it('parses chapter param', () => {
		window.history.replaceState(null, '', '/?chapter=5')
		expect(parseURLParams().chapter).toBe(5)
	})

	it('parses readingMode param', () => {
		window.history.replaceState(null, '', '/?readingMode=true')
		expect(parseURLParams().readingMode).toBe('true')
	})

	it('parses multiple params', () => {
		window.history.replaceState(null, '', '/?bookId=1&chapter=2&readingMode=false')
		const params = parseURLParams()
		expect(params.bookId).toBe(1)
		expect(params.chapter).toBe(2)
		expect(params.readingMode).toBe('false')
	})
})

describe('updateURLParams', () => {
	beforeEach(() => {
		window.history.replaceState(null, '', '/')
	})

	it('adds new params', () => {
		updateURLParams({ bookId: 3 })
		expect(window.location.search).toContain('bookId=3')
	})

	it('updates existing params', () => {
		window.history.replaceState(null, '', '/?bookId=1')
		updateURLParams({ bookId: 5 })
		expect(window.location.search).toContain('bookId=5')
	})

	it('removes params when undefined', () => {
		window.history.replaceState(null, '', '/?bookId=1&chapter=2')
		updateURLParams({ bookId: undefined })
		expect(window.location.search).not.toContain('bookId')
		expect(window.location.search).toContain('chapter=2')
	})
})
