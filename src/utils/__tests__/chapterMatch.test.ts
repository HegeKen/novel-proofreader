import { describe, it, expect } from 'vitest'
import { findMatchedChapter, normalizeChapterTitle, normalizeEventChapter, parseChapterInfo } from '../chapterMatch'
import type { Chapter } from '../../types'

/** 构造章节结构：卷 + 卷下章节 */
function buildChapters(): Chapter[] {
	return [
		{ id: 1, title: '第1卷 正文1', startIndex: 0, endIndex: 100, content: '', isVolume: true },
		{ id: 2, title: '第1章', startIndex: 0, endIndex: 50, content: '', parentId: 1 },
		{ id: 3, title: '第2章', startIndex: 51, endIndex: 100, content: '', parentId: 1 },
		{ id: 4, title: '第2卷 正文2', startIndex: 101, endIndex: 200, content: '', isVolume: true },
		{ id: 5, title: '第1章', startIndex: 101, endIndex: 150, content: '', parentId: 4 },
		{ id: 6, title: '第2章', startIndex: 151, endIndex: 200, content: '', parentId: 4 },
		{ id: 7, title: '第3卷', startIndex: 201, endIndex: 250, content: '', isVolume: true },
		{ id: 8, title: '第1章', startIndex: 201, endIndex: 250, content: '', parentId: 7 },
	]
}

describe('parseChapterInfo', () => {
	it('解析"第2卷·第1章"', () => {
		expect(parseChapterInfo('第2卷·第1章')).toEqual({
			volumeNum: 2, chapterNum: 1, volumeName: '第2卷', chapterName: '第1章', hasVolume: true, hasChapter: true,
		})
	})

	it('解析纯章节名', () => {
		expect(parseChapterInfo('第1章')).toEqual({
			volumeNum: 0, chapterNum: 1, volumeName: '', chapterName: '第1章', hasVolume: false, hasChapter: true,
		})
	})

	it('解析中文数字卷号', () => {
		expect(parseChapterInfo('第二卷·第三章').volumeNum).toBe(2)
		expect(parseChapterInfo('第二卷·第三章').chapterNum).toBe(3)
	})

	it('解析"第0章"为章节号 0', () => {
		expect(parseChapterInfo('第0章')).toEqual({
			volumeNum: 0, chapterNum: 0, volumeName: '', chapterName: '第0章', hasVolume: false, hasChapter: true,
		})
	})

	it('解析"第〇章"为章节号 0', () => {
		expect(parseChapterInfo('第〇章')).toEqual({
			volumeNum: 0, chapterNum: 0, volumeName: '', chapterName: '第〇章', hasVolume: false, hasChapter: true,
		})
	})

	it('解析无"第"前缀的"〇章"为章节号 0', () => {
		expect(parseChapterInfo('〇章')).toEqual({
			volumeNum: 0, chapterNum: 0, volumeName: '', chapterName: '〇章', hasVolume: false, hasChapter: true,
		})
	})

	it('无法解析时 hasChapter 为 false', () => {
		expect(parseChapterInfo('番外篇').hasChapter).toBe(false)
		expect(parseChapterInfo('番外篇').hasVolume).toBe(false)
	})
})

describe('normalizeChapterTitle', () => {
	it('中文数字归一化为阿拉伯数字', () => {
		expect(normalizeChapterTitle('第二章')).toBe('第2章')
		expect(normalizeChapterTitle('第十二章')).toBe('第12章')
	})
})

describe('findMatchedChapter', () => {
	const chapters = buildChapters()

	it('卷标题不一致时宽容匹配：事件"第2卷·第1章"定位到"第2卷 正文2"下的"第1章"', () => {
		const matched = findMatchedChapter(chapters, '第1章', '第2卷')
		expect(matched).toBeDefined()
		expect(matched!.id).toBe(5)
	})

	it('卷标题完全一致时精确匹配', () => {
		const matched = findMatchedChapter(chapters, '第2章', '第2卷 正文2')
		expect(matched).toBeDefined()
		expect(matched!.id).toBe(6)
	})

	it('chapter 字符串含卷前缀且 volume 为空时按卷号定位', () => {
		const matched = findMatchedChapter(chapters, '第2卷·第1章')
		expect(matched).toBeDefined()
		expect(matched!.id).toBe(5)
	})

	it('事件卷名为"第2卷"而卷标题为"第二卷 正文"时按卷号一致匹配', () => {
		const chapters2: Chapter[] = [
			{ id: 10, title: '第二卷 正文', startIndex: 0, endIndex: 100, content: '', isVolume: true },
			{ id: 11, title: '第1章', startIndex: 0, endIndex: 50, content: '', parentId: 10 },
			{ id: 12, title: '第2章', startIndex: 51, endIndex: 100, content: '', parentId: 10 },
		]
		const matched = findMatchedChapter(chapters2, '第1章', '第2卷')
		expect(matched).toBeDefined()
		expect(matched!.id).toBe(11)
	})

	it('不同卷的同名章节不误匹配', () => {
		// 事件在第1卷，不应匹配到第2卷的"第1章"
		const matched = findMatchedChapter(chapters, '第1章', '第1卷 正文1')
		expect(matched).toBeDefined()
		expect(matched!.id).toBe(2)
	})

	it('中文数字章节名与阿拉伯数字章节名互相匹配', () => {
		const matched = findMatchedChapter(chapters, '第二章', '第2卷 正文2')
		expect(matched).toBeDefined()
		expect(matched!.id).toBe(6)
	})

	it('不存在的章节返回 undefined', () => {
		expect(findMatchedChapter(chapters, '第9章', '第2卷')).toBeUndefined()
	})

	it('空章节字符串返回 undefined', () => {
		expect(findMatchedChapter(chapters, '')).toBeUndefined()
	})

	it('"第0章"匹配结构中的第0章（排在最前）', () => {
		const chapters0: Chapter[] = [
			{ id: 30, title: '第0章 序章', startIndex: 0, endIndex: 10, content: '' },
			{ id: 31, title: '第1章', startIndex: 11, endIndex: 20, content: '' },
		]
		const matched = findMatchedChapter(chapters0, '第0章')
		expect(matched).toBeDefined()
		expect(matched!.id).toBe(30)
	})

	it('"〇章"与"第0章"结构章节互相匹配', () => {
		const chapters0: Chapter[] = [
			{ id: 32, title: '第0章', startIndex: 0, endIndex: 10, content: '' },
			{ id: 33, title: '第1章', startIndex: 11, endIndex: 20, content: '' },
		]
		expect(findMatchedChapter(chapters0, '〇章')?.id).toBe(32)
		expect(findMatchedChapter(chapters0, '第〇章')?.id).toBe(32)
	})

	it('事件"第0章"能匹配结构"第〇章 引子"', () => {
		const chapters0: Chapter[] = [
			{ id: 34, title: '第〇章 引子', startIndex: 0, endIndex: 10, content: '' },
			{ id: 35, title: '第一章', startIndex: 11, endIndex: 20, content: '' },
		]
		expect(findMatchedChapter(chapters0, '第0章')?.id).toBe(34)
	})
})

describe('normalizeEventChapter', () => {
	const chapters = buildChapters()

	it('老格式"第2卷·第1章"（无 volume）匹配到结构后拆分为纯章节名与卷标题', () => {
		const result = normalizeEventChapter(chapters, '第2卷·第1章')
		expect(result).toEqual({ chapter: '第1章', volume: '第2卷 正文2', matched: true })
	})

	it('事件卷名"第2卷"与卷标题"第2卷 正文2"不一致时仍能正确拆分', () => {
		const result = normalizeEventChapter(chapters, '第1章', '第2卷')
		expect(result).toEqual({ chapter: '第1章', volume: '第2卷 正文2', matched: true })
	})

	it('匹配不到章节结构但含卷前缀时，按解析结果回退拆分', () => {
		const result = normalizeEventChapter(chapters, '第5卷·第3章')
		expect(result).toEqual({ chapter: '第3章', volume: '第5卷', matched: false })
	})

	it('纯章节名匹配到结构后自动补上所属卷', () => {
		const result = normalizeEventChapter(chapters, '第2章', '第2卷 正文2')
		expect(result).toEqual({ chapter: '第2章', volume: '第2卷 正文2', matched: true })
	})

	it('无法解析时原样返回', () => {
		const result = normalizeEventChapter(chapters, '番外篇', '第2卷')
		expect(result).toEqual({ chapter: '番外篇', volume: '第2卷', matched: false })
	})

	it('空章节字符串原样返回', () => {
		expect(normalizeEventChapter(chapters, '')).toEqual({ chapter: '', volume: '', matched: false })
	})
})
