// ============================================================
// proofreadPipeline 单元测试
// 覆盖三种校对模式共享的过滤/定位/解析/合并管线
// ============================================================
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
	locateTextInParagraph,
	locateTextWithFallback,
	parseProofreadErrors,
	parseDualParagraphErrors,
	parseChapterErrors,
	buildErrorsFromCorrectedText,
	resolveProofreadReply,
	mergeErrorsIntoStore,
} from '../proofreadPipeline'
import { useProofreadStore } from '../../stores/proofreadStore'
import type { ProofreadError } from '../../types'

/** 构造标准 ProofreadError（合并测试用） */
function makeError(overrides: Partial<ProofreadError> & { id: string }): ProofreadError {
	return {
		startIndex: 0,
		endIndex: 1,
		errorType: 'typo',
		suggestion: '',
		originalText: 'x',
		correctedText: 'y',
		applied: false,
		skipped: false,
		...overrides,
	}
}

beforeEach(() => {
	useProofreadStore.getState().clearAllResults()
})

afterEach(() => {
	useProofreadStore.getState().clearAllResults()
})

describe('locateTextInParagraph', () => {
	it('精确匹配返回位置', () => {
		const r = locateTextInParagraph('他高兴得笑了。', '高兴得')
		expect(r).toEqual({ start: 1, end: 4 })
	})

	it('column 定位优先', () => {
		const r = locateTextInParagraph('他高兴得笑了。', '高兴得', 2)
		expect(r).toEqual({ start: 1, end: 4 })
	})

	it('找不到返回 null', () => {
		expect(locateTextInParagraph('他高兴得笑了。', '完全不存在的文字')).toBeNull()
	})
})

describe('locateTextWithFallback', () => {
	it('当前段命中直接返回', () => {
		const paragraphs = ['倾盘大雨来了。', '另一段落。']
		const r = locateTextWithFallback(paragraphs, 0, '倾盘大雨')
		expect(r?.paragraphIndex).toBe(0)
	})

	it('当前段找不到时在邻段命中', () => {
		const paragraphs = ['第一段内容。', '天空下起倾盘大雨。', '第三段。']
		const r = locateTextWithFallback(paragraphs, 0, '倾盘大雨')
		expect(r?.paragraphIndex).toBe(1)
	})

	it('超出半径范围返回 null', () => {
		const paragraphs = ['第0段。', '第1段。', '第2段。', '第3段。', '藏着倾盘大雨。']
		const r = locateTextWithFallback(paragraphs, 0, '倾盘大雨', undefined, 2)
		expect(r).toBeNull()
	})
})

describe('parseProofreadErrors（单段落模式）', () => {
	const baseParams = {
		chapterId: 1,
		paragraphIndex: 0,
		paragraphs: ['他高兴得笑了起来。'],
		ignoredWords: [] as string[],
	}

	it('正确解析并定位错误', () => {
		const errors = parseProofreadErrors(
			[{ find: '他高兴得笑', replace: '他高兴地笑', type: 'grammar' }],
			baseParams,
		)
		expect(errors).toHaveLength(1)
		expect(errors[0]).toMatchObject({
			startIndex: 0,
			endIndex: 5,
			errorType: 'grammar',
			originalText: '他高兴得笑',
			correctedText: '他高兴地笑',
		})
		expect(errors[0].id).toBe('err-1-0-0')
	})

	it('过滤无错误标记', () => {
		const errors = parseProofreadErrors(
			[{ find: '某文本', replace: '某文本', type: '无错误' }],
			baseParams,
		)
		expect(errors).toHaveLength(0)
	})

	it('过滤空 matchText', () => {
		const errors = parseProofreadErrors(
			[{ find: '', replace: 'x', type: 'typo' }],
			baseParams,
		)
		expect(errors).toHaveLength(0)
	})

	it('过滤原文与修改完全相同', () => {
		const errors = parseProofreadErrors(
			[{ find: '高兴', replace: '高兴', type: 'typo' }],
			baseParams,
		)
		expect(errors).toHaveLength(0)
	})

	it('过滤忽略词（角色名等）', () => {
		const errors = parseProofreadErrors(
			[{ find: '张三笑了', replace: '张三笑了', type: 'typo' }],
			{ ...baseParams, ignoredWords: ['张三'] },
		)
		// find===replace 也会被过滤，这里换为不同文本验证忽略词优先路径
		expect(errors).toHaveLength(0)

		const errors2 = parseProofreadErrors(
			[{ find: '张三你好', replace: '张三您好', type: 'typo' }],
			{ ...baseParams, paragraphs: ['张三你好啊。'], ignoredWords: ['张三'] },
		)
		expect(errors2).toHaveLength(0)
	})

	it('无法定位时过滤', () => {
		const errors = parseProofreadErrors(
			[{ find: '不存在的文本内容', replace: '其他内容', type: 'typo' }],
			baseParams,
		)
		expect(errors).toHaveLength(0)
	})

	it('当前段找不到时跨段落 fallback 定位并修正 id 中的段落索引', () => {
		const errors = parseProofreadErrors(
			[{ find: '倾盘大雨', replace: '倾盆大雨', type: 'typo' }],
			{
				chapterId: 7,
				paragraphIndex: 0,
				paragraphs: ['第一段内容。', '天空下起倾盘大雨。', '第三段。'],
				ignoredWords: [],
			},
		)
		expect(errors).toHaveLength(1)
		expect(errors[0].originalText).toBe('倾盘大雨')
		expect(errors[0].id.startsWith('err-7-1-')).toBe(true)
	})
})

describe('parseDualParagraphErrors（双段落模式）', () => {
	it('对象格式按 line 分配错误并解析合并建议', () => {
		const result = parseDualParagraphErrors(
			{
				errors: [
					{ line: 1, find: '今天天气错', replace: '今天天气不错', type: 'typo' },
					{ line: 2, find: '倾盘大雨', replace: '倾盆大雨', type: 'typo' },
				],
				merge_suggestion: { should_merge: true, reason: '语义连贯' },
			},
			3, 10, 11,
			'今天天气错。',
			'天空下起倾盘大雨。',
			[],
		)
		expect(result.errors1).toHaveLength(1)
		expect(result.errors2).toHaveLength(1)
		expect(result.errors1[0].id).toContain('d1')
		expect(result.errors2[0].id).toContain('d2')
		expect(result.mergeSuggestion).toEqual({
			targetParagraphIndex: 11,
			reason: '语义连贯',
			applied: false,
		})
	})

	it('should_merge 为 false 时合并建议为 null', () => {
		const result = parseDualParagraphErrors(
			{ errors: [], merge_suggestion: { should_merge: false, reason: '独立' } },
			3, 10, 11,
			'第一段内容。',
			'第二段内容。',
			[],
		)
		expect(result.mergeSuggestion).toBeNull()
	})

	it('数组格式无行号时优先第1段，找不到则 fallback 到第2段', () => {
		const result = parseDualParagraphErrors(
			[{ find: '倾盘大雨', replace: '倾盆大雨', type: 'typo' }],
			3, 10, 11,
			'今天天气不错。',
			'天空下起倾盘大雨。',
			[],
		)
		expect(result.errors1).toHaveLength(0)
		expect(result.errors2).toHaveLength(1)
		expect(result.errors2[0].id).toBe('err-3-11-d2-0')
	})
})

describe('parseChapterErrors（章节批次模式）', () => {
	const paragraphs = ['章节标题', '天空下起倾盘大雨。', '他很高兴地走来。', '第四章末尾。']

	it('行号有效时按行分组', () => {
		const errorsByLine = parseChapterErrors(
			[{ lineNumber: '1', find: '倾盘大雨', replace: '倾盆大雨', type: 'typo' }],
			{ chapterId: 5, paragraphs, batchStart: 1, batchEnd: 3, ignoredWords: [] },
		)
		expect(errorsByLine[1]).toHaveLength(1)
		expect(errorsByLine[1][0].id).toBe('err-5-1-0')
	})

	it('行号越界时在批次内文本匹配路由', () => {
		const errorsByLine = parseChapterErrors(
			[{ lineNumber: '9', find: '他很高兴', replace: '他很高兴呀', type: 'typo' }],
			{ chapterId: 5, paragraphs, batchStart: 1, batchEnd: 3, ignoredWords: [] },
		)
		expect(errorsByLine[2]).toHaveLength(1)
	})

	it('批次内找不到时在全章范围文本匹配', () => {
		const errorsByLine = parseChapterErrors(
			[{ lineNumber: '9', find: '第四章末尾', replace: '第四章结尾', type: 'typo' }],
			{ chapterId: 5, paragraphs, batchStart: 1, batchEnd: 3, ignoredWords: [] },
		)
		expect(errorsByLine[3]).toHaveLength(1)
	})

	it('全文都无法定位时过滤', () => {
		const errorsByLine = parseChapterErrors(
			[{ lineNumber: '1', find: '完全不存在的片段', replace: 'xxx', type: 'typo' }],
			{ chapterId: 5, paragraphs, batchStart: 1, batchEnd: 3, ignoredWords: [] },
		)
		expect(errorsByLine.flat()).toHaveLength(0)
	})

	it('忽略词在章节模式同样被客户端过滤', () => {
		const errorsByLine = parseChapterErrors(
			[{ lineNumber: '1', find: '倾盘大雨', replace: '倾盆大雨', type: 'typo' }],
			{ chapterId: 5, paragraphs, batchStart: 1, batchEnd: 3, ignoredWords: ['倾盘大雨'] },
		)
		expect(errorsByLine.flat()).toHaveLength(0)
	})
})

describe('buildErrorsFromCorrectedText（内置模型纯文本输出）', () => {
	it('的/地/得差异生成 grammar 错误', () => {
		const errors = buildErrorsFromCorrectedText('他高兴得笑了。', '他高兴地笑了。', 1, 0)
		expect(errors).toHaveLength(1)
		expect(errors[0].errorType).toBe('grammar')
		expect(errors[0].correctedText).toContain('地')
	})

	it('无差异返回空数组', () => {
		expect(buildErrorsFromCorrectedText('完全相同的句子。', '完全相同的句子。', 1, 0)).toHaveLength(0)
	})

	it('输出与原文重合度过低时丢弃', () => {
		const errors = buildErrorsFromCorrectedText('今天天气不错啊。', '哦哦哦哦哦哦哦哦哦哦！', 1, 0)
		expect(errors).toHaveLength(0)
	})
})

describe('resolveProofreadReply（统一响应入口）', () => {
	it('JSON 数组走标准解析', () => {
		const errors = resolveProofreadReply(
			'[{"find":"倾盘大雨","replace":"倾盆大雨","type":"typo"}]',
			{
				chapterId: 1,
				paragraphIndex: 0,
				paragraphs: ['天空下起倾盘大雨。'],
				ignoredWords: [],
			},
		)
		expect(errors).toHaveLength(1)
		expect(errors[0].correctedText).toBe('倾盆大雨')
	})

	it('内置模型纯纠正文本走 diff', () => {
		const errors = resolveProofreadReply(
			'他高兴地笑了。',
			{
				chapterId: 1,
				paragraphIndex: 0,
				paragraphs: ['他高兴得笑了。'],
				ignoredWords: [],
				correctedTextMode: true,
			},
		)
		expect(errors).toHaveLength(1)
		expect(errors[0].errorType).toBe('grammar')
	})

	it('非 JSON 且未启用纠正文本模式时返回空', () => {
		const errors = resolveProofreadReply('他高兴地笑了。', {
			chapterId: 1,
			paragraphIndex: 0,
			paragraphs: ['他高兴得笑了。'],
			ignoredWords: [],
		})
		expect(errors).toHaveLength(0)
	})

	it('空响应返回空数组', () => {
		const errors = resolveProofreadReply('', {
			chapterId: 1,
			paragraphIndex: 0,
			paragraphs: ['随便一段文本。'],
			ignoredWords: [],
			correctedTextMode: true,
		})
		expect(errors).toHaveLength(0)
	})
})

describe('mergeErrorsIntoStore（结果写入合并）', () => {
	it('主段落去重合并、跨段落错误分发且不覆盖已有错误', () => {
		const store = useProofreadStore.getState()
		store.setResults(9, [
			{ paragraphIndex: 0, originalText: '第0段', errors: [makeError({ id: 'err-9-0-0' })], status: 'done' },
			{ paragraphIndex: 1, originalText: '第1段', errors: [makeError({ id: 'err-9-1-9' })], status: 'pending' },
			{ paragraphIndex: 2, originalText: '第2段', errors: [], status: 'pending' },
		])

		mergeErrorsIntoStore(9, 0, [
			makeError({ id: 'err-9-0-0' }), // 与已有错误重复，应去重
			makeError({ id: 'err-9-0-2', originalText: '新错误', correctedText: '新修复' }),
			makeError({ id: 'err-9-1-0', originalText: '邻段错误', correctedText: '邻段修复' }),
		])

		const results = useProofreadStore.getState().results[9]
		expect(results[0].errors.map(e => e.id)).toEqual(['err-9-0-0', 'err-9-0-2'])
		expect(results[0].status).toBe('done')
		expect(results[1].errors.map(e => e.id)).toEqual(['err-9-1-9', 'err-9-1-0'])
		// 邻段合并不改变其状态
		expect(results[1].status).toBe('pending')
		expect(results[2].errors).toHaveLength(0)
	})
})
