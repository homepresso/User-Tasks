import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '93.184.216.34', family: 4 }] }))

import {
  basetenConnector, basetenModel, BASETEN_DEFAULT_MODEL, BASETEN_MODEL_API_MODELS, normalizeBasetenDeploymentUrl,
} from '@/lib/connectors/definitions/baseten'
import { getConnectorDefinition } from '@/lib/connectors/registry'
import { connectorTemplateVars } from '@/lib/connectors/template-vars'
import { runConnectorProbe } from '@/lib/connectors/test-probes'
import { runConnectorPreflight } from '@/lib/connectors/preflight'
import {
  agentProviderKind, isAiProviderIntegration, providerErrorMessage, resolveAgentEndpoint, resolveChatUrl, chatBodyParams,
} from '@/lib/agents/provider'
import { executeAgent, type AgentConfig } from '@/lib/agent-executor'
import { costOf, resolvePrice, DEFAULT_MODEL_PRICES, PRICE_SOURCES } from '@/lib/agents/pricing'
import { assertNoSecretInUrls, runConnectorTemplate } from './helpers/connector-contract'

/**
 * Baseten (lib/connectors/definitions/baseten.ts): one connector for Model
 * APIs and dedicated deployments, used by agents (lib/agents/provider.ts)
 * and workflow integration calls. Mocked fetch only — no real key, no
 * network.
 */

const FAKE_KEY = 'bt-fake-key-0000'
const DEDICATED = 'https://model-abcd1234.api.baseten.co/environments/production/sync'
const modelApis = (extra: Record<string, any> = {}) => ({ mode: 'model_apis', default_model: BASETEN_DEFAULT_MODEL, custom_model: '', deployment_url: '', ...extra })
const dedicated = (extra: Record<string, any> = {}) => ({ mode: 'dedicated', deployment_url: `${DEDICATED}/v1`, custom_model: 'my-llm', ...extra })

afterEach(() => { vi.unstubAllGlobals() })

describe('deployment URL normalisation', () => {
  it.each([
    ['abcd1234', DEDICATED],
    ['https://model-abcd1234.api.baseten.co', DEDICATED],
    ['https://model-abcd1234.api.baseten.co/environments/production/sync/v1', DEDICATED],
    ['https://model-abcd1234.api.baseten.co/environments/production/sync/v1/chat/completions', DEDICATED],
    ['https://model-abcd1234.api.baseten.co/environments/production/predict', DEDICATED],
    ['https://model-abcd1234.api.baseten.co/environments/staging/sync/v1/', 'https://model-abcd1234.api.baseten.co/environments/staging/sync'],
    ['https://model-abcd1234.api.baseten.co/deployment/q1w2e3/predict', 'https://model-abcd1234.api.baseten.co/deployment/q1w2e3/sync'],
    ['https://model-abcd1234-production.api.baseten.co', 'https://model-abcd1234-production.api.baseten.co/sync'],
    // Baseten Self-hosted: the customer's own load balancer.
    ['https://llm.internal.example.com/environments/production/sync/v1', 'https://llm.internal.example.com/environments/production/sync'],
  ])('%s', (input, expected) => {
    expect(normalizeBasetenDeploymentUrl(input)).toBe(expected)
  })

  it('rejects empty, non-https and credential-carrying URLs', () => {
    expect(() => normalizeBasetenDeploymentUrl('')).toThrow(/deployment URL/)
    expect(() => normalizeBasetenDeploymentUrl('http://model-abcd1234.api.baseten.co')).toThrow(/https/)
    expect(() => normalizeBasetenDeploymentUrl('https://u:p@model-abcd1234.api.baseten.co')).toThrow(/credentials/)
    expect(() => normalizeBasetenDeploymentUrl('https://model-abcd1234.api.baseten.co/sync?key=x')).toThrow(/query/)
  })
})

describe('connector definition', () => {
  it('is registered as an AI connector with a password API key', () => {
    expect(getConnectorDefinition('baseten')).toBe(basetenConnector)
    expect(basetenConnector.category).toBe('ai')
    const key = basetenConnector.credentialFields.find((f) => f.key === 'api_key')!
    expect(key).toMatchObject({ type: 'password', required: true })
    expect(BASETEN_MODEL_API_MODELS.map((m) => m.value)).toContain(BASETEN_DEFAULT_MODEL)
  })

  it('Model APIs: bare inference host, Bearer key, the chosen model', () => {
    const built = basetenConnector.buildIntegrationConfig(modelApis({ default_model: 'moonshotai/Kimi-K3' }), { api_key: FAKE_KEY })
    expect(built).toMatchObject({ base_url: 'https://inference.baseten.co', auth_type: 'bearer', auth_config: { token: FAKE_KEY }, default_model: 'moonshotai/Kimi-K3' })
    expect(basetenModel(modelApis({ custom_model: ' zai-org/GLM-9 ' }))).toBe('zai-org/GLM-9')
    expect(basetenModel({})).toBe(BASETEN_DEFAULT_MODEL)
  })

  it('dedicated: the deployment\'s …/sync root and the custom model name', () => {
    const built = basetenConnector.buildIntegrationConfig(dedicated(), { api_key: FAKE_KEY })
    expect(built).toMatchObject({ base_url: DEDICATED, default_model: 'my-llm' })
    expect(() => basetenConnector.buildIntegrationConfig(dedicated({ deployment_url: 'http://x' }), { api_key: FAKE_KEY })).toThrow()
  })

  it('the API key never becomes a template variable', () => {
    const vars = connectorTemplateVars(basetenConnector, modelApis(), { api_key: FAKE_KEY })
    expect(JSON.stringify(vars)).not.toContain(FAKE_KEY)
    expect(vars.default_model).toBe(BASETEN_DEFAULT_MODEL)
  })

  it('preflight explains a bad deployment URL or a missing model name before any call', () => {
    expect(runConnectorPreflight('baseten', dedicated({ deployment_url: 'ftp://x' }), { api_key: FAKE_KEY })).toMatchObject({ status: 'error' })
    expect(runConnectorPreflight('baseten', dedicated({ custom_model: '' }), { api_key: FAKE_KEY })?.message).toMatch(/model name/)
    expect(runConnectorPreflight('baseten', dedicated(), { api_key: FAKE_KEY })).toBeNull()
    expect(runConnectorPreflight('baseten', modelApis(), { api_key: FAKE_KEY })).toBeNull()
  })
})

describe('agent endpoint (lib/agents/provider.ts)', () => {
  const integration = (config: Record<string, any>) => ({ type: 'baseten', config: { ...basetenConnector.buildIntegrationConfig(config, { api_key: FAKE_KEY }) } })

  it('Model APIs → inference.baseten.co/v1/chat/completions with Bearer', () => {
    const endpoint = resolveAgentEndpoint(integration(modelApis()))
    expect(endpoint).toMatchObject({ kind: 'baseten', url: 'https://inference.baseten.co/v1/chat/completions', apiKey: FAKE_KEY })
    expect(endpoint.headers).toEqual({ 'Content-Type': 'application/json', Authorization: `Bearer ${FAKE_KEY}` })
  })

  it('dedicated → …/sync/v1/chat/completions with Bearer', () => {
    const endpoint = resolveAgentEndpoint(integration(dedicated()))
    expect(endpoint.url).toBe(`${DEDICATED}/v1/chat/completions`)
    expect(endpoint.headers.Authorization).toBe(`Bearer ${FAKE_KEY}`)
  })

  it('recognises Baseten hosts behind a generic OpenAI-compatible connection', () => {
    expect(agentProviderKind('openai_compatible', 'https://inference.baseten.co/v1')).toBe('baseten')
    expect(agentProviderKind('rest_api', `${DEDICATED}/v1`)).toBe('baseten')
    expect(isAiProviderIntegration({ type: 'rest_api', config: { base_url: 'https://inference.baseten.co' } })).toBe(true)
    expect(resolveChatUrl('baseten', 'https://inference.baseten.co/v1')).toBe('https://inference.baseten.co/v1/chat/completions')
    expect(resolveChatUrl('baseten', `${DEDICATED}/v1/chat/completions`)).toBe(`${DEDICATED}/v1/chat/completions`)
  })

  it('sends max_tokens and temperature (OpenAI-compatible body)', () => {
    expect(chatBodyParams('baseten', BASETEN_DEFAULT_MODEL, { maxTokens: 512, temperature: 0.3 })).toEqual({ max_tokens: 512, temperature: 0.3 })
  })
})

describe('agent runs against Baseten (mocked)', () => {
  const enc = new TextEncoder()
  const data = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`
  const sse = (chunks: string[]) => new Response(new ReadableStream({
    start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); c.close() },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } })

  const endpoint = resolveAgentEndpoint({ type: 'baseten', config: basetenConnector.buildIntegrationConfig(modelApis(), { api_key: FAKE_KEY }) })
  const config: AgentConfig = {
    baseUrl: 'https://inference.baseten.co', apiKey: FAKE_KEY, model: 'deepseek-ai/DeepSeek-V4.1-Flash', systemPrompt: 'Be brief', temperature: null,
    maxTokens: 256, maxIterations: 4, provider: 'baseten', endpoint: { url: endpoint.url, headers: endpoint.headers },
    tools: [{ id: 'calc', type: 'builtin', name: 'calculate', description: 'math', inputSchema: [{ name: 'expression', type: 'string', description: 'e', required: true }] }],
  }

  it('streams a tool call, runs it, and adds up usage including cached tokens', async () => {
    const calls: Array<{ url: string; init: any }> = []
    const replies = [
      sse([
        data({ choices: [{ delta: { reasoning_content: 'thinking…' } }] }),
        data({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'calculate', arguments: '{"expression":' } }] } }] }),
        data({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"6*7"}' } }] }, finish_reason: 'tool_calls' }] }),
        data({ choices: [], usage: { prompt_tokens: 1000, completion_tokens: 20, total_tokens: 1020, prompt_tokens_details: { cached_tokens: 400 } } }),
        'data: [DONE]\n\n',
      ]),
      sse([data({ choices: [{ delta: { content: '42' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1100, completion_tokens: 2, total_tokens: 1102 } }), 'data: [DONE]\n\n']),
    ]
    const fetchImpl = vi.fn(async (url: any, init: any) => { calls.push({ url: String(url), init }); const r = replies.shift(); if (!r) throw new Error('extra call ' + calls.length + ' ' + init.body.slice(-600)); return r })
    const result = await executeAgent(config, 'what is 6*7?', { stream: true, onEvent: () => {}, fetchImpl: fetchImpl as any, sleep: async () => {} })
    expect(result.error).toBeUndefined()
    expect(result.status).toBe('completed')
    expect(result.response).toBe('42')
    expect(result.toolCalls[0]).toMatchObject({ toolName: 'calculate', result: { result: 42 } })
    expect(calls[0].url).toBe('https://inference.baseten.co/v1/chat/completions')
    expect(calls[0].init.headers.Authorization).toBe(`Bearer ${FAKE_KEY}`)
    const body = JSON.parse(calls[0].init.body)
    expect(body).toMatchObject({ model: 'deepseek-ai/DeepSeek-V4.1-Flash', stream: true, stream_options: { include_usage: true }, max_tokens: 256 })
    expect(body.tools[0].function.name).toBe('calculate')
    expect(result.usage).toMatchObject({ prompt_tokens: 2100, completion_tokens: 22, total_tokens: 2122, cached_tokens: 400 })
    // The key never reaches the run's stored result.
    expect(JSON.stringify(result)).not.toContain(FAKE_KEY)
  })

  it('prices usage from the shipped Baseten table (cached input at the cache price)', () => {
    const price = resolvePrice({}, 'baseten', 'deepseek-ai/DeepSeek-V4.1-Flash', '2026-12-01')!
    expect(price).toMatchObject({ source: 'default', input_per_1m: 0.3, output_per_1m: 1.2, cached_input_per_1m: 0.007, currency: 'USD' })
    // 600 uncached × 0.3 + 400 cached × 0.007 + 20 out × 1.2, per 1M
    expect(costOf({ prompt_tokens: 1000, completion_tokens: 20, cached_tokens: 400 }, price)).toBeCloseTo((600 * 0.3 + 400 * 0.007 + 20 * 1.2) / 1e6, 12)
    expect(PRICE_SOURCES.baseten.url).toContain('baseten.co/pricing')
    // Every curated slug has a price; a dedicated deployment's model has none (cost unknown, never zero).
    for (const m of BASETEN_MODEL_API_MODELS) expect(resolvePrice({}, 'baseten', m.value, '2026-12-01')).not.toBeNull()
    expect(resolvePrice({}, 'baseten', 'my-llm', '2026-12-01')).toBeNull()
    expect(DEFAULT_MODEL_PRICES.filter((p) => p.provider === 'baseten').every((p) => p.currency === 'USD')).toBe(true)
  })

  it('retries 429 (Retry-After) and 529 overloaded, then succeeds', async () => {
    const replies = [
      new Response('{"error":"rate limited"}', { status: 429, headers: { 'retry-after': '0' } }),
      new Response('{"error":"overloaded"}', { status: 529 }),
      Response.json({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 } }),
    ]
    const fetchImpl = vi.fn(async () => replies.shift()!)
    const result = await executeAgent({ ...config, tools: [] }, 'hi', { fetchImpl: fetchImpl as any, sleep: async () => {} })
    expect(result.status).toBe('completed')
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('a 401 fails with the auth hint and without echoing the key', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"error":"Invalid API key"}', { status: 401 }))
    const result = await executeAgent({ ...config, tools: [] }, 'hi', { fetchImpl: fetchImpl as any, sleep: async () => {} })
    expect(result.status).toBe('failed')
    expect(result.error).toMatch(/API key/)
    expect(JSON.stringify(result)).not.toContain(FAKE_KEY)
  })

  it('a model without tool calling gets a clear hint', () => {
    const msg = providerErrorMessage('bad_request', 400, '{"error":"Tool calling is not supported for this model"}', `${DEDICATED}/v1/chat/completions`)
    expect(msg).toMatch(/doesn't support tool calling/)
    expect(providerErrorMessage('bad_request', 400, '{"error":"max_tokens too large"}', 'https://inference.baseten.co/v1/chat/completions')).not.toMatch(/tool calling/)
  })
})

describe('workflow integration calls (reference templates)', () => {
  const run = (template: string, config: Record<string, any>, inputs: Record<string, unknown> = {}) => runConnectorTemplate({
    connector: 'baseten', template, config, credentials: { api_key: FAKE_KEY }, inputs: { user_message: 'Summarise the ticket', ...inputs },
    respond: () => Response.json({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } }),
  })

  it('templates: chat and JSON completion', () => {
    expect(basetenConnector.referenceTemplates.map((t) => t.key)).toEqual(['chat_completion', 'json_completion'])
  })

  it('Model APIs chat: POST inference.baseten.co, Bearer, the connection\'s model fills an empty model input, empty temperature omitted', async () => {
    const { call, requests, result } = await run('chat_completion', modelApis({ default_model: 'zai-org/GLM-5.3' }))
    expect(call.method).toBe('POST')
    expect(call.url).toBe('https://inference.baseten.co/v1/chat/completions')
    expect(call.headers.authorization).toBe('Bearer ***')
    const body = JSON.parse(call.body!)
    expect(body).toEqual({
      model: 'zai-org/GLM-5.3',
      messages: [{ role: 'system', content: 'You are a helpful assistant.' }, { role: 'user', content: 'Summarise the ticket' }],
      max_tokens: 4096,
    })
    assertNoSecretInUrls(requests, [FAKE_KEY])
    expect(call.body).not.toContain(FAKE_KEY)
    expect(result.status).toBe(200)
    expect(result.data.choices[0].message.content).toBe('{"ok":true}')
    expect(JSON.stringify(result.log ?? {})).not.toContain(FAKE_KEY)
  })

  it('a call can name another model and typed numbers', async () => {
    const { call } = await run('chat_completion', modelApis(), { model: 'moonshotai/Kimi-K3', max_tokens: '128', temperature: '0.2' })
    expect(JSON.parse(call.body!)).toMatchObject({ model: 'moonshotai/Kimi-K3', max_tokens: 128, temperature: 0.2 })
  })

  it('dedicated deployment: the deployment\'s /sync/v1 route and its model name', async () => {
    const { call } = await run('chat_completion', dedicated())
    expect(call.url).toBe(`${DEDICATED}/v1/chat/completions`)
    expect(JSON.parse(call.body!).model).toBe('my-llm')
  })

  it('JSON completion sends response_format json_object', async () => {
    const { call } = await run('json_completion', modelApis())
    const body = JSON.parse(call.body!)
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.messages[0].content).toMatch(/JSON/)
  })

  it('escapes user text into the JSON body', async () => {
    const { call } = await run('chat_completion', modelApis(), { user_message: 'say "hi"\n","model":"evil' })
    const body = JSON.parse(call.body!)
    expect(body.messages[1].content).toBe('say "hi"\n","model":"evil')
    expect(body.model).toBe(BASETEN_DEFAULT_MODEL)
  })
})

describe('test connection probe', () => {
  const probe = (config: Record<string, any>, respond: () => Response) => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: any, init: any) => { calls.push({ url: String(url), init }); return respond() }))
    const creds = { api_key: FAKE_KEY }
    return runConnectorProbe('baseten', config, creds, basetenConnector.buildIntegrationConfig(config, creds) as any).then((r) => ({ r, calls }))
  }

  it('Model APIs: a 1-token completion with the chosen model', async () => {
    const { r, calls } = await probe(modelApis(), () => Response.json({ choices: [] }))
    expect(r.ok).toBe(true)
    expect(calls[0].url).toBe('https://inference.baseten.co/v1/chat/completions')
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ model: BASETEN_DEFAULT_MODEL, max_tokens: 1 })
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${FAKE_KEY}`)
    expect(r.message).not.toContain(FAKE_KEY)
  })

  it('dedicated: probes the deployment; a 404 points at the URL', async () => {
    const { r, calls } = await probe(dedicated(), () => new Response('not found', { status: 404, statusText: 'Not Found' }))
    expect(calls[0].url).toBe(`${DEDICATED}/v1/chat/completions`)
    expect(r).toMatchObject({ ok: false, statusCode: 404 })
    expect(r.message).toMatch(/deployment URL/)
  })

  it('401 → check the API key (no key echoed)', async () => {
    const { r } = await probe(modelApis(), () => Response.json({ error: 'Unauthorized' }, { status: 401 }))
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/API key/)
    expect(r.message).not.toContain(FAKE_KEY)
  })
})
