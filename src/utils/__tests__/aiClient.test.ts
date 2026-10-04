import { describe, it, expect, vi } from 'vitest'
import { repairTruncatedJson, extractJSON, normalizeErrors, parseMultiRoleplayResponse, hasSubstantiveContent, isBracketOnlyContent, parseBatchParagraphEmotionResult } from '../aiClient'
import { isLocalModel, getEffectiveBaseURL, sendChatCompletionAuto, normalizeLocalEndpoint } from '../aiClient'
import type { AIConfig, LocalModelConfig } from '../../types'

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

describe('parseBatchParagraphEmotionResult - 整段朗读批量情感分析', () => {
	it('parses valid JSON with multiple paragraphs', () => {
		const reply = '{"paragraphs":[{"index":0,"characters":["李明"],"segments":[{"type":"narration","speaker":"旁白","emotion":"怅然","tone":"深沉","speed":4,"text":"(怅然,深沉)李明叹了口气。"},{"type":"dialogue","speaker":"李明","emotion":"无奈","tone":"温柔","speed":5,"text":"(无奈,温柔)\'你好吗\'"}]},{"index":1,"characters":[],"segments":[{"type":"narration","speaker":"旁白","emotion":"平静","tone":"温柔","speed":5,"text":"(平静,温柔)夜风轻轻吹过。"}]}]}'
		const result = parseBatchParagraphEmotionResult(reply)
		expect(result).not.toBeNull()
		expect(result!.size).toBe(2)
		expect(result!.get(0)?.characters).toEqual(['李明'])
		expect(result!.get(0)?.segments).toHaveLength(2)
		expect(result!.get(1)?.segments[0].text).toBe('(平静,温柔)夜风轻轻吹过。')
	})

	it('parses JSON wrapped in markdown code block', () => {
		const reply = '```json\n{"paragraphs":[{"index":3,"characters":["王芳"],"segments":[{"type":"dialogue","speaker":"王芳","emotion":"开心","tone":"活泼","speed":5,"text":"(开心,活泼)今天天气真好！"}]}]}\n```'
		const result = parseBatchParagraphEmotionResult(reply)
		expect(result).not.toBeNull()
		expect(result!.get(3)?.segments[0].speaker).toBe('王芳')
	})

	it('parses truncated JSON by extracting complete paragraph objects', () => {
		const reply = '{"paragraphs":[{"index":0,"characters":["李明"],"segments":[{"type":"narration","speaker":"旁白","emotion":"平静","tone":"温柔","speed":5,"text":"(平静,温柔)第一段。"}]},{"index":1,"characters":[],"segments":[{"type":"narration","speaker":"旁白","emotion":"平静","tone":"温柔","speed":5,"text":"(平静,温柔)第二段。"}]}]}'
		const result = parseBatchParagraphEmotionResult(reply)
		expect(result).not.toBeNull()
		expect(result!.get(1)?.segments[0].text).toBe('(平静,温柔)第二段。')
	})

	it('returns null for invalid input', () => {
		expect(parseBatchParagraphEmotionResult('完全不是JSON')).toBeNull()
		expect(parseBatchParagraphEmotionResult('')).toBeNull()
		expect(parseBatchParagraphEmotionResult('{"foo":"bar"}')).toBeNull()
	})
})

describe('normalizeLocalEndpoint', () => {
	it('剥离误粘贴的 API 路径后缀', () => {
		expect(normalizeLocalEndpoint('http://localhost:1234/api/v1/chat')).toBe('http://localhost:1234')
		expect(normalizeLocalEndpoint('http://localhost:1234/v1/chat/completions')).toBe('http://localhost:1234')
		expect(normalizeLocalEndpoint('http://localhost:11434/api/tags')).toBe('http://localhost:11434')
		expect(normalizeLocalEndpoint('http://localhost:1234/v1/models')).toBe('http://localhost:1234')
	})

	it('剥离 /v1 后缀', () => {
		expect(normalizeLocalEndpoint('http://localhost:1234/v1')).toBe('http://localhost:1234')
		expect(normalizeLocalEndpoint('http://localhost:1234/v1/')).toBe('http://localhost:1234')
	})

	it('保留干净的基地址不变', () => {
		expect(normalizeLocalEndpoint('http://localhost:11434')).toBe('http://localhost:11434')
		expect(normalizeLocalEndpoint('http://127.0.0.1:61843')).toBe('http://127.0.0.1:61843')
	})

	it('去除首尾空白和尾部斜杠', () => {
		expect(normalizeLocalEndpoint('  http://localhost:1234/  ')).toBe('http://localhost:1234')
	})
})

describe('isLocalModel', () => {
	const localConfig: LocalModelConfig = {
		modelSource: 'local-external',
		externalEndpoint: 'http://localhost:11434',
		externalApiKey: '',
		externalModel: 'qwen2.5:7b',
		builtinModelPath: '',
		builtinContextSize: 4096,
		gpuLayers: -1,
		enabled: true,
	}

	it('returns true for local-external when enabled', () => {
		expect(isLocalModel(localConfig)).toBe(true)
	})

	it('returns false when disabled', () => {
		expect(isLocalModel({ ...localConfig, enabled: false })).toBe(false)
	})

	it('returns false for cloud source even when enabled', () => {
		expect(isLocalModel({ ...localConfig, modelSource: 'cloud' })).toBe(false)
	})

	it('returns true for local-builtin when enabled', () => {
		expect(isLocalModel({ ...localConfig, modelSource: 'local-builtin' })).toBe(true)
	})
})

describe('getEffectiveBaseURL', () => {
	const cloudConfig: AIConfig = {
		baseURL: 'https://api.deepseek.com/v1',
		apiKey: 'test-key',
		model: 'deepseek-chat',
		customHeaders: {},
		maxCharsPerRequest: 2000,
		enableLogging: false,
		apiFormat: 'openai',
	}

	const localConfig: LocalModelConfig = {
		modelSource: 'local-external',
		externalEndpoint: 'http://localhost:11434',
		externalApiKey: '',
		externalModel: 'qwen2.5:7b',
		builtinModelPath: '',
		builtinContextSize: 4096,
		gpuLayers: -1,
		enabled: true,
	}

	it('returns cloud baseURL when local model disabled', () => {
		expect(getEffectiveBaseURL(cloudConfig, { ...localConfig, enabled: false })).toBe('https://api.deepseek.com/v1')
	})

	it('returns cloud baseURL when modelSource is cloud', () => {
		expect(getEffectiveBaseURL(cloudConfig, { ...localConfig, modelSource: 'cloud' })).toBe('https://api.deepseek.com/v1')
	})

	it('returns external endpoint for local-external', () => {
		expect(getEffectiveBaseURL(cloudConfig, localConfig)).toBe('http://localhost:11434')
	})

	it('returns builtin placeholder for local-builtin', () => {
		expect(getEffectiveBaseURL(cloudConfig, { ...localConfig, modelSource: 'local-builtin' })).toBe('builtin://local')
	})
})

describe('sendChatCompletionAuto - 模型来源路由', () => {
	const cloudConfig: AIConfig = {
		baseURL: 'https://api.deepseek.com/v1',
		apiKey: 'test-key',
		model: 'deepseek-chat',
		customHeaders: {},
		maxCharsPerRequest: 2000,
		enableLogging: false,
		apiFormat: 'openai',
	}

	const messages = [{ role: 'user' as const, content: '测试' }]

	const makeLocal = (overrides: Partial<LocalModelConfig> = {}): LocalModelConfig => ({
		modelSource: 'local-external',
		externalEndpoint: 'http://localhost:11434',
		externalApiKey: '',
		externalModel: 'qwen2.5:7b',
		builtinModelPath: '',
		builtinContextSize: 4096,
		gpuLayers: -1,
		enabled: true,
		...overrides,
	})

	it('云端模式走 fetch 请求', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ choices: [{ message: { content: '云端回复' } }] }),
		})
		vi.stubGlobal('fetch', fetchMock)
		try {
			const reply = await sendChatCompletionAuto(messages, cloudConfig, makeLocal({ enabled: false }))
			expect(reply).toBe('云端回复')
			expect(fetchMock).toHaveBeenCalledOnce()
			expect(String(fetchMock.mock.calls[0][0])).toContain('api.deepseek.com')
		} finally {
			vi.unstubAllGlobals()
		}
	})

	it('本地外部服务模式覆盖 baseURL 与 model，不携带 API Key', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ choices: [{ message: { content: '本地回复' } }] }),
		})
		vi.stubGlobal('fetch', fetchMock)
		try {
			const reply = await sendChatCompletionAuto(messages, cloudConfig, makeLocal())
			expect(reply).toBe('本地回复')
			const [url, init] = fetchMock.mock.calls[0]
			expect(String(url)).toContain('localhost:11434')
			const body = JSON.parse(String(init?.body))
			expect(body.model).toBe('qwen2.5:7b')
			expect(init?.headers?.Authorization).toBeUndefined()
		} finally {
			vi.unstubAllGlobals()
		}
	})

	it('内置模型模式在非 Tauri 环境抛出明确错误', async () => {
		await expect(
			sendChatCompletionAuto(messages, cloudConfig, makeLocal({ modelSource: 'local-builtin' })),
		).rejects.toThrow('内置模型推理失败')
	})

	it('signal 已中止时内置模型模式直接抛 AbortError', async () => {
		const controller = new AbortController()
		controller.abort()
		await expect(
			sendChatCompletionAuto(messages, cloudConfig, makeLocal({ modelSource: 'local-builtin' }), controller.signal),
		).rejects.toThrow('请求已取消')
	})
})
