import { describe, it, expect } from 'vitest'
import { repairTruncatedJson, extractJSON, normalizeErrors, parseMultiRoleplayResponse, hasSubstantiveContent, isBracketOnlyContent } from '../aiClient'

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

	it('extracts multi-line formatted JSON array (章节标题候选等场景)', () => {
		const text = `AI返回内容：
[
  {
    "title": "京城寻踪"
  },
  {
    "title": "铁匠传说"
  }
]
以上是建议。`
		const result = extractJSON(text)
		expect(result).toEqual([{ title: '京城寻踪' }, { title: '铁匠传说' }])
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
describe('parseMultiRoleplayResponse', () => {
	it('parses pure JSON array with multiple characters', () => {
		const reply = '[{"character":"林晚","content":"你来了。"},{"character":"阿九","content":"我也在。"}]'
		const segments = parseMultiRoleplayResponse(reply)
		expect(segments).toEqual([
			{ character: '林晚', content: '你来了。' },
			{ character: '阿九', content: '我也在。' },
		])
	})

	it('parses JSON array wrapped in markdown code block', () => {
		const reply = '```json\n[{"character":"林晚","content":"第一句"}]\n```'
		const segments = parseMultiRoleplayResponse(reply)
		expect(segments).toEqual([{ character: '林晚', content: '第一句' }])
	})

	it('parses JSON array with surrounding explanation text', () => {
		const reply = '好的，以下是回复：\n[{"character":"林晚","content":"你好"},{"character":"阿九","content":"你好呀"}]\n希望你喜欢'
		const segments = parseMultiRoleplayResponse(reply)
		expect(segments).toHaveLength(2)
		expect(segments?.[0]).toEqual({ character: '林晚', content: '你好' })
	})

	it('parses text format "角色名：内容"', () => {
		const reply = '林晚：你终于来了。\n阿九：（微微一笑）是啊，我等很久了。'
		const segments = parseMultiRoleplayResponse(reply)
		expect(segments).toEqual([
			{ character: '林晚', content: '你终于来了。' },
			{ character: '阿九', content: '（微微一笑）是啊，我等很久了。' },
		])
	})

	it('parses text format with bracket prefix "（角色名）内容"', () => {
		const reply = '（林晚）你来了。\n（阿九）我也在。'
		const segments = parseMultiRoleplayResponse(reply)
		expect(segments).toEqual([
			{ character: '林晚', content: '你来了。' },
			{ character: '阿九', content: '我也在。' },
		])
	})

	it('returns null for plain text without character markers', () => {
		expect(parseMultiRoleplayResponse('这是一段普通的旁白文字，没有角色名。')).toBeNull()
	})

	it('returns null for empty or invalid input', () => {
		expect(parseMultiRoleplayResponse('')).toBeNull()
		expect(parseMultiRoleplayResponse('not json at all')).toBeNull()
	})

	it('filters out items missing character or content', () => {
		const reply = '[{"character":"林晚","content":"有效"},{"character":"","content":"缺名字"},{"name":"阿九"}]'
		const segments = parseMultiRoleplayResponse(reply)
		expect(segments).toEqual([{ character: '林晚', content: '有效' }])
	})
})

describe('parseMultiRoleplayResponse - 非标准格式', () => {
	it('parses concatenated JSON objects separated by newline', () => {
		const reply = '{"character":"林晚","content":"你来了。"}\n{"character":"阿九","content":"我也在。"}'
		const segments = parseMultiRoleplayResponse(reply)
		expect(segments).toEqual([
			{ character: '林晚', content: '你来了。' },
			{ character: '阿九', content: '我也在。' },
		])
	})

	it('parses concatenated JSON objects with no separator', () => {
		const reply = '{"character":"林晚","content":"你好"}{"character":"阿九","content":"你好呀"}'
		const segments = parseMultiRoleplayResponse(reply)
		expect(segments).toHaveLength(2)
	})

	it('parses a single JSON object (not array)', () => {
		const reply = '{"character":"林晚","content":"只有我说话"}'
		const segments = parseMultiRoleplayResponse(reply)
		expect(segments).toEqual([{ character: '林晚', content: '只有我说话' }])
	})

	it('parses concatenated objects with surrounding text', () => {
		const reply = '好的：\n{"character":"林晚","content":"第一句"}\n{"character":"阿九","content":"第二句"}'
		const segments = parseMultiRoleplayResponse(reply)
		expect(segments).toHaveLength(2)
	})

	it('parses objects with name/text field aliases', () => {
		const reply = '{"name":"林晚","text":"你好"}'
		const segments = parseMultiRoleplayResponse(reply)
		expect(segments).toEqual([{ character: '林晚', content: '你好' }])
	})

	it('skips non-object noise in concatenated mode', () => {
		const reply = '{"character":"林晚","content":"你好"}\n然后阿九说道：\n{"character":"阿九","content":"来了"}'
		const segments = parseMultiRoleplayResponse(reply)
		expect(segments).toEqual([
			{ character: '林晚', content: '你好' },
			{ character: '阿九', content: '来了' },
		])
	})
})

describe('hasSubstantiveContent - 必须包含括号外实质台词', () => {
	it('accepts content with dialogue outside brackets', () => {
		expect(hasSubstantiveContent('你终于来了，（轻轻松了口气）我等了很久。')).toBe(true)
		expect(hasSubstantiveContent('（微微一笑）是啊，我等很久了。')).toBe(true)
		expect(hasSubstantiveContent('普通的一句话')).toBe(true)
	})

	it('rejects content that is only bracketed description', () => {
		expect(hasSubstantiveContent('（沉默地看向窗外）')).toBe(false)
		expect(hasSubstantiveContent('（他轻轻叹了口气）')).toBe(false)
		expect(hasSubstantiveContent('（眼神微微一黯）')).toBe(false)
	})

	it('rejects empty or whitespace content', () => {
		expect(hasSubstantiveContent('')).toBe(false)
		expect(hasSubstantiveContent('   ')).toBe(false)
	})

	it('parseMultiRoleplayResponse keeps all segments (校验移到 requestReply 层)', () => {
		const reply = '[{"character":"林晚","content":"（沉默地看向窗外）"},{"character":"阿九","content":"（笑了）你来了。"}]'
		const segments = parseMultiRoleplayResponse(reply)
		// 解析层不再过滤，由上层（requestReply）识别纯描写并触发重新生成
		expect(segments).toEqual([
			{ character: '林晚', content: '（沉默地看向窗外）' },
			{ character: '阿九', content: '（笑了）你来了。' },
		])
	})
})

describe('isBracketOnlyContent - 整段仅为一对括号包裹的描写', () => {
	it('detects content that is exactly one bracketed description', () => {
		expect(isBracketOnlyContent('（沉默地看向窗外）')).toBe(true)
		expect(isBracketOnlyContent('（他轻轻叹了口气）')).toBe(true)
		expect(isBracketOnlyContent('(微微一笑)')).toBe(true)
	})

	it('rejects content with dialogue outside or extra brackets', () => {
		expect(isBracketOnlyContent('你终于来了，（轻轻松了口气）我等了很久。')).toBe(false)
		expect(isBracketOnlyContent('（微微一笑）是啊，我等很久了。')).toBe(false)
		expect(isBracketOnlyContent('（沉默）（又沉默）')).toBe(false)
		expect(isBracketOnlyContent('普通的一句话')).toBe(false)
		expect(isBracketOnlyContent('')).toBe(false)
	})
})
