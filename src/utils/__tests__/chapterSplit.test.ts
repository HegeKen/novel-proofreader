import { describe, it, expect } from 'vitest'
import { splitChapters, splitParagraphs, splitTextChunks } from '../chapterSplit'

describe('splitParagraphs', () => {
	it('splits text by newlines', () => {
		expect(splitParagraphs('a\nb\nc')).toEqual(['a', 'b', 'c'])
	})

	it('preserves empty lines', () => {
		expect(splitParagraphs('a\n\nb')).toEqual(['a', '', 'b'])
	})

	it('handles single line', () => {
		expect(splitParagraphs('hello')).toEqual(['hello'])
	})

	it('handles empty string', () => {
		expect(splitParagraphs('')).toEqual([''])
	})
})

describe('splitTextChunks', () => {
	it('returns single chunk if text is short enough', () => {
		expect(splitTextChunks('hello', 100)).toEqual(['hello'])
	})

	it('splits long text into chunks', () => {
		const text = 'a'.repeat(50) + '\n\n' + 'b'.repeat(50)
		const chunks = splitTextChunks(text, 60)
		expect(chunks.length).toBe(2)
	})

	it('handles single paragraph longer than maxChars', () => {
		const text = 'a'.repeat(200)
		const chunks = splitTextChunks(text, 100)
		expect(chunks.length).toBe(2)
		expect(chunks[0]).toBe('a'.repeat(100))
		expect(chunks[1]).toBe('a'.repeat(100))
	})
})

describe('splitChapters', () => {
	it('returns single chapter for text without chapter markers', () => {
		const text = '这是一段没有章节标记的文本。'.repeat(10)
		const chapters = splitChapters(text)
		expect(chapters.length).toBe(1)
		expect(chapters[0].title).toContain('段')
	})

	it('detects chapters with 第X章 pattern', () => {
		const text = '第一章 开始\n这是第一章的内容\n第二章 继续\n这是第二章的内容'
		const chapters = splitChapters(text)
		expect(chapters.length).toBe(2)
		expect(chapters[0].title).toContain('第一章')
		expect(chapters[1].title).toContain('第二章')
	})

	it('detects chapters with numeric pattern', () => {
		const text = '第1章 开始\n内容\n第2章 继续\n内容'
		const chapters = splitChapters(text)
		expect(chapters.length).toBe(2)
	})

	it('detects volume markers', () => {
		const text = '第一卷 风起\n第一章 开始\n内容\n第二章 继续\n内容'
		const chapters = splitChapters(text)
		const volumes = chapters.filter(ch => ch.isVolume)
		expect(volumes.length).toBe(1)
		expect(volumes[0].title).toContain('第一卷')
	})

	it('handles preamble before first chapter', () => {
		const text = '这是前言内容\n\n第一章 开始\n正文内容'
		const chapters = splitChapters(text)
		expect(chapters[0].title).toBe('前言')
	})

	it('detects 序章 and 楔子', () => {
		const text = '楔子\n一些内容\n第一章 开始\n正文'
		const chapters = splitChapters(text)
		expect(chapters.some(ch => ch.title.includes('楔子'))).toBe(true)
	})
})
