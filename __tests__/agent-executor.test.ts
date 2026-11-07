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

describe('executeAgent tool runtime', () => {
  it('runs tools in-process with the run\'s runtime (no internal HTTP route, no processor secret)', async () => {
    const calls: string[] = []
    let llm = 0
    vi.stubGlobal('fetch', vi.fn(async (url: any) => {
      calls.push(String(url))
      llm++
      return llm === 1
        ? chatResponse({ toolCalls: [{ id: 't1', type: 'function', function: { name: 'query_data_table', arguments: '{"table_name":"Orders"}' } }] }) as any
        : chatResponse({ content: 'finished' }) as any
    }))
    const { normalizeAgentOutputConfig } = await import('@/lib/agent-knowledge')
    const rows = [{ id: 'r1', data: { status: 'open' } }]
    const query: any = {
      select: () => query, eq: () => query, limit: () => query, filter: () => query, in: () => query,
      maybeSingle: async () => ({ data: { id: 'tbl-1', name: 'Orders' } }),
      then: (resolve: any) => resolve({ data: rows, error: null }),
    }
    const db: any = { from: vi.fn(() => query) }
    const result = await executeAgent(
      { ...baseConfig, tools: [{ id: 'builtin_query_data', type: 'builtin', name: 'query_data_table', description: 'q' }] },
      'go',
      {
        toolRuntime: {
          tenantId: 'tenant-1', agentId: 'agent-1', actingUserId: null, outputConfig: normalizeAgentOutputConfig({ data_access: { grants: [{ table_id: 'tbl-1', read: true }] } }),
          db: () => db, permissions: async () => null, allowedHosts: [], generatedFiles: [],
        },
      },
    )
    expect(result.status).toBe('completed')
    expect(calls.every((u) => u.includes('/chat/completions'))).toBe(true)
    expect(db.from).toHaveBeenCalledWith('custom_tables')
    expect(result.toolCalls[0]).toMatchObject({ toolName: 'query_data_table', status: 'ok', result: { table: 'Orders', count: 1 } })
  })
})
