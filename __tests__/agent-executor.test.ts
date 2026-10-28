import { describe, it, expect, vi, afterEach } from 'vitest'
import { executeAgent, parseStructuredOutputs, type AgentConfig } from '@/lib/agent-executor'

// Minimal OpenAI-style chat response helper.
function chatResponse(opts: { content?: string; toolCalls?: any[] }) {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { role: 'assistant', content: opts.content ?? null, ...(opts.toolCalls ? { tool_calls: opts.toolCalls } : {}) } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
  }
}

const baseConfig: AgentConfig = {
  baseUrl: 'http://llm.test/v1',
  apiKey: 'k',
  model: 'test-model',
  systemPrompt: 'You are a test.',
  temperature: 0.2,
  maxTokens: 256,
  maxIterations: 5,
  tools: [],
}

afterEach(() => { vi.unstubAllGlobals() })

describe('parseStructuredOutputs', () => {
  const vars = [{ name: 'summary' }, { name: 'score' }]

  it('extracts a fenced json block', () => {
    const { outputs, warning } = parseStructuredOutputs('Here you go:\n```json\n{"summary":"ok","score":9}\n```', vars)
    expect(outputs).toEqual({ summary: 'ok', score: 9 })
    expect(warning).toBeUndefined()
  })

  it('uses the LAST fenced block when several exist', () => {
    const text = '```json\n{"summary":"old","score":1}\n```\nthen\n```json\n{"summary":"new","score":2}\n```'
    expect(parseStructuredOutputs(text, vars).outputs).toEqual({ summary: 'new', score: 2 })
  })

  it('falls back to a trailing bare object', () => {
    expect(parseStructuredOutputs('answer: {"summary":"x","score":3}', vars).outputs).toEqual({ summary: 'x', score: 3 })
  })

  it('nulls missing declared keys and warns', () => {
    const { outputs, warning } = parseStructuredOutputs('```json\n{"summary":"only"}\n```', vars)
    expect(outputs).toEqual({ summary: 'only', score: null })
    expect(warning).toMatch(/score/)
  })

  it('warns and nulls everything when no JSON is present', () => {
    const { outputs, warning } = parseStructuredOutputs('no json here at all', vars)
    expect(outputs).toEqual({ summary: null, score: null })
    expect(warning).toMatch(/parseable JSON/)
  })
})

describe('executeAgent failure semantics', () => {
  it('returns status "failed" (not a silent completed) when the LLM errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, text: async () => 'boom' })))
    const result = await executeAgent(baseConfig, 'hi')
    expect(result.status).toBe('failed')
    expect(result.error).toContain('500')
    expect(result.response).toContain('Agent error')
  })

  it('returns status "completed" on a normal response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => chatResponse({ content: 'done' })))
    const result = await executeAgent(baseConfig, 'hi')
    expect(result.status).toBe('completed')
    expect(result.response).toBe('done')
    expect(result.error).toBeUndefined()
  })

  it('fails when the wall-clock budget is exceeded', async () => {
    // maxDurationMs 0 → the very first iteration is already over budget.
    vi.stubGlobal('fetch', vi.fn(async () => chatResponse({ content: 'x' })))
    const result = await executeAgent(baseConfig, 'hi', { maxDurationMs: 0 })
    expect(result.status).toBe('failed')
    expect(result.error).toMatch(/time budget/)
  })
})

describe('executeAgent structured outputs', () => {
  it('parses declared outputs from the final message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => chatResponse({ content: 'Result:\n```json\n{"summary":"hello","score":7}\n```' })))
    const result = await executeAgent(baseConfig, 'hi', { outputVariables: [{ name: 'summary' }, { name: 'score' }] })
    expect(result.status).toBe('completed')
    expect(result.outputs).toEqual({ summary: 'hello', score: 7 })
  })
})

describe('executeAgent internal tool auth', () => {
  it('sends the processor secret + tenant/agent context when calling internal tool routes', async () => {
    process.env.WORKFLOW_PROCESSOR_SECRET = 'test-secret'
    const calls: { url: string; init: any }[] = []
    const fetchMock = vi.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), init })
      // First LLM call → ask for a tool; second → finish.
      if (String(url).includes('/chat/completions')) {
        if (calls.filter(c => c.url.includes('/chat/completions')).length === 1) {
          return chatResponse({ toolCalls: [{ id: 't1', type: 'function', function: { name: 'query_data_table', arguments: '{"table_name":"x"}' } }] }) as any
        }
        return chatResponse({ content: 'finished' }) as any
      }
      // Internal tool route
      return { ok: true, json: async () => ({ rows: [] }) } as any
    })
    vi.stubGlobal('fetch', fetchMock)

    await executeAgent(
      { ...baseConfig, tools: [{ id: 'builtin_query_data', type: 'builtin', name: 'query_data_table', description: 'q' }] },
      'go',
      { appBaseUrl: 'http://app.test', _tenantId: 'tenant-1', _agentId: 'agent-1', _actingUserId: 'user-1' },
    )

    const toolCall = calls.find(c => c.url.includes('/api/agents/data-tool'))
    expect(toolCall).toBeTruthy()
    expect(toolCall!.init.headers['x-processor-secret']).toBe('test-secret')
    const body = JSON.parse(toolCall!.init.body)
    expect(body.tenant_id).toBe('tenant-1')
    expect(body.agent_id).toBe('agent-1')
    expect(body.acting_user_id).toBe('user-1')
  })
})
