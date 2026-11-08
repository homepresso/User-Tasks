/**
 * The Agent's thinking level: the per-provider mapping, unsupported models
 * send nothing, a 400 for the parameter is retried without it (and
 * remembered), the resolution order (rule → help group → default card →
 * provider default), and the settings round-trip. All HTTP is mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeThinkingLevel, rememberThinkingRejected, resetThinkingRejections, resolveThinkingLevel, thinkingParams, thinkingRejected, thinkingSupport } from '@/lib/agents/reasoning'
import { toMessagesBody } from '@/lib/agents/anthropic-messages'
import { runAssistantTurn } from '@/lib/assistants/engine'
import { mergeAgentSettings, normalizeAgentSettings, storedAgentSettings } from '@/lib/assistants/config'
import { normalizeModelRule } from '@/lib/assistants/model-rules'
import { parseChatRequest, prepareAssistantTurn } from '@/lib/assistants/chat'
import type { AssistantConnection } from '@/lib/assistants/settings'
import type { ServiceContext } from '@/lib/services/context'

/* eslint-disable @typescript-eslint/no-explicit-any */

beforeEach(() => resetThinkingRejections())

describe('mapping per provider', () => {
  it('Anthropic: output_config.effort on the native API only, for models that take it', () => {
    expect(thinkingParams('anthropic', 'claude-sonnet-5-5', 'high', { native: true })).toEqual({ output_config: { effort: 'high' } })
    expect(thinkingParams('anthropic', 'claude-opus-5-5', 'max', { native: true })).toEqual({ output_config: { effort: 'max' } })
    expect(thinkingParams('anthropic', 'claude-fable-5-1', 'low', { native: true })).toEqual({ output_config: { effort: 'low' } })
    expect(thinkingParams('anthropic', 'claude-opus-4-8', 'medium', { native: true })).toEqual({ output_config: { effort: 'medium' } })
    // The compatibility endpoint ignores reasoning_effort: nothing is sent there.
    expect(thinkingParams('anthropic', 'claude-sonnet-5-5', 'high', { native: false })).toEqual({})
    // Opus 4.5: no max; Haiku / Sonnet 4.5: no effort at all.
    expect(thinkingParams('anthropic', 'claude-opus-4-5', 'max', { native: true })).toEqual({})
    expect(thinkingParams('anthropic', 'claude-opus-4-5', 'high', { native: true })).toEqual({ output_config: { effort: 'high' } })
    expect(thinkingParams('anthropic', 'claude-haiku-4-5', 'high', { native: true })).toEqual({})
    expect(thinkingParams('anthropic', 'claude-sonnet-4-5-20250929', 'low', { native: true })).toEqual({})
  })

  it('OpenAI / Azure: reasoning_effort for reasoning models; Max = xhigh where offered', () => {
    expect(thinkingParams('openai', 'gpt-5.5', 'high')).toEqual({ reasoning_effort: 'high' })
    expect(thinkingParams('openai', 'gpt-5.5', 'max')).toEqual({ reasoning_effort: 'xhigh' })
    expect(thinkingParams('openai', 'gpt-5-mini', 'max')).toEqual({})
    expect(thinkingParams('openai', 'o3-mini', 'low')).toEqual({ reasoning_effort: 'low' })
    expect(thinkingParams('azure_openai', 'gpt-5.4', 'medium')).toEqual({ reasoning_effort: 'medium' })
    expect(thinkingParams('openai', 'gpt-4.1', 'high')).toEqual({})
    expect(thinkingParams('openai', 'gpt-5-chat-latest', 'high')).toEqual({})
  })

  it('xAI, Gemini; others unsupported; Default sends nothing', () => {
    expect(thinkingParams('xai', 'grok-4.7', 'max')).toEqual({ reasoning_effort: 'xhigh' })
    expect(thinkingParams('xai', 'grok-4.5', 'max')).toEqual({})
    expect(thinkingParams('xai', 'grok-4.5', 'low')).toEqual({ reasoning_effort: 'low' })
    expect(thinkingParams('xai', 'grok-4.3', 'low')).toEqual({})
    expect(thinkingParams('gemini', 'gemini-2.5-pro', 'high')).toEqual({ reasoning_effort: 'high' })
    expect(thinkingParams('gemini', 'gemini-3.1-flash-lite', 'max')).toEqual({})
    expect(thinkingParams('mistral', 'mistral-large-latest', 'high')).toEqual({})
    expect(thinkingParams('ollama', 'llama3.1', 'high')).toEqual({})
    expect(thinkingParams('openai', 'gpt-5.5', 'default')).toEqual({})
    expect(thinkingSupport('mistral', 'mistral-large-latest').levels).toEqual([])
    expect(thinkingSupport('anthropic', 'claude-sonnet-5-5')).toMatchObject({ levels: ['low', 'medium', 'high', 'max'], nativeOnly: true })
  })

  it('the native Messages body carries output_config', () => {
    expect(toMessagesBody({ model: 'm', messages: [{ role: 'user', content: 'hi' }], output_config: { effort: 'high' } })).toMatchObject({ output_config: { effort: 'high' } })
  })
})

const openai: AssistantConnection = { provider: 'openai', model: 'gpt-5.5', url: 'https://llm.test/v1/chat/completions', headers: {}, baseUrl: 'https://llm.test' }
const ok = () => new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { status: 200, headers: { 'content-type': 'application/json' } })

describe('the turn', () => {
  it('sends the level for a supported model, nothing for an unsupported one', async () => {
    const bodies: any[] = []
    const fetchImpl = vi.fn(async (_u: any, init: any) => { bodies.push(JSON.parse(init.body)); return ok() }) as unknown as typeof fetch
    await runAssistantTurn({ connection: { ...openai, thinking: 'high' }, instructions: 'X', context: null, history: [{ role: 'user', content: 'hi' }], tools: [], onEvent: () => {}, fetchImpl })
    expect(bodies[0].reasoning_effort).toBe('high')
    await runAssistantTurn({ connection: { ...openai, model: 'gpt-4.1', thinking: 'high' }, instructions: 'X', context: null, history: [{ role: 'user', content: 'hi' }], tools: [], onEvent: () => {}, fetchImpl })
    expect(bodies[1]).not.toHaveProperty('reasoning_effort')
    // Claude over the native API: output_config.effort.
    const claude: AssistantConnection = { provider: 'anthropic', model: 'claude-sonnet-5-5', url: 'https://api.anthropic.com/v1/chat/completions', headers: { Authorization: 'Bearer k' }, baseUrl: 'https://api.anthropic.com', thinking: 'low' }
    const native: any[] = []
    const nativeFetch = vi.fn(async (_u: any, init: any) => { native.push(JSON.parse(init.body)); return new Response(JSON.stringify({ type: 'message', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } }) }) as unknown as typeof fetch
    await runAssistantTurn({ connection: claude, instructions: 'X', context: null, history: [{ role: 'user', content: 'hi' }], tools: [], onEvent: () => {}, fetchImpl: nativeFetch })
    expect(native[0].output_config).toEqual({ effort: 'low' })
  })

  it('a 400 for the parameter is retried once without it, and remembered for the model', async () => {
    const bodies: any[] = []
    const fetchImpl = vi.fn(async (_u: any, init: any) => {
      const body = JSON.parse(init.body)
      bodies.push(body)
      if (body.reasoning_effort) return new Response('{"error":{"message":"Unsupported parameter: reasoning_effort"}}', { status: 400, headers: { 'content-type': 'application/json' } })
      return ok()
    }) as unknown as typeof fetch
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await runAssistantTurn({ connection: { ...openai, thinking: 'medium' }, instructions: 'X', context: null, history: [{ role: 'user', content: 'hi' }], tools: [], onEvent: () => {}, fetchImpl })
    warn.mockRestore()
    expect(r.status).toBe('completed')
    expect(bodies.map((b) => b.reasoning_effort ?? null)).toEqual(['medium', null])
    expect(thinkingRejected('openai', 'gpt-5.5')).toBe(true)
    // The next request skips it from the start.
    await runAssistantTurn({ connection: { ...openai, thinking: 'medium' }, instructions: 'X', context: null, history: [{ role: 'user', content: 'again' }], tools: [], onEvent: () => {}, fetchImpl })
    expect(bodies).toHaveLength(3)
    expect(bodies[2]).not.toHaveProperty('reasoning_effort')
    rememberThinkingRejected('xai', 'grok-4.7')
    expect(thinkingRejected('xai', 'GROK-4.7')).toBe(true)
  })
})

describe('resolution order and settings', () => {
  it('rule → help group → default card → provider default', () => {
    expect(resolveThinkingLevel({ rule: 'low', group: 'high', base: 'medium' })).toBe('low')
    expect(resolveThinkingLevel({ rule: 'default', group: 'high', base: 'medium' })).toBe('high')
    expect(resolveThinkingLevel({ rule: null, group: undefined, base: 'medium' })).toBe('medium')
    expect(resolveThinkingLevel({})).toBe('default')
  })

  it('settings round-trip in capabilities (absent = Default); bad values become Default', () => {
    expect(normalizeAgentSettings({ version: 2, enabled: true })).toMatchObject({ thinking_level: 'default', thinking_levels: {} })
    const merged = mergeAgentSettings(normalizeAgentSettings({ version: 2, enabled: true }), { thinking_level: 'high', thinking_levels: { designer: 'max', form: 'low', task: 'bogus' } })
    const stored = storedAgentSettings(merged)
    const back = normalizeAgentSettings(JSON.parse(JSON.stringify(stored)))
    expect(back.thinking_level).toBe('high')
    expect(back.thinking_levels).toEqual({ designer: 'max', form: 'low' })
    expect(normalizeModelRule({ id: 'r', users: ['u'], model: 'gpt-5.5', thinking_level: 'medium' })!.thinking_level).toBe('medium')
    expect(normalizeModelRule({ id: 'r', users: ['u'], model: 'gpt-5.5' })!.thinking_level).toBe('default')
    expect(normalizeThinkingLevel('xhigh')).toBe('default')
  })

  it('the prepared turn carries the resolved level (the default card, a group override, a rule)', async () => {
    const rowsDb = (row: any) => {
      const from = (table: string) => {
        const filters: Array<(r: any) => boolean> = []
        let single = false
        const tables: Record<string, any[]> = { assistant_settings: [row], user_teams: [{ user_id: 'u1', team_id: 't-build' }] }
        const run = () => { const list = (tables[table] ?? []).filter((r) => filters.every((f) => f(r))); return { data: single ? list[0] ?? null : list, error: null, count: list.length } }
        const api: any = {
          select: () => api, eq: (c: string, v: any) => { filters.push((r) => r[c] === v); return api }, in: () => api, gte: () => api, is: () => api, order: () => api, limit: () => api, ilike: () => api, or: () => api,
          maybeSingle: () => { single = true; return Promise.resolve(run()) }, then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
        }
        return api
      }
      return { from } as any
    }
    const base = { tenant_id: 't1', provider: 'ollama', key_source: 'key', api_key: null, base_url: null, model: 'llama3.1', limits: {} }
    const ctx: ServiceContext = { tenantId: 't1', actorId: 'u1', permissions: new Set(['workflows.view', 'workflows.create', 'forms.view', 'forms.edit']), supabase: {} as any, authKind: 'session', source: 'ui' }
    const req = parseChatRequest({ messages: [{ role: 'user', content: 'hi' }] })
    const prep = (caps: any) => prepareAssistantTurn(ctx, req, { serviceDb: rowsDb({ ...base, capabilities: { version: 2, enabled: true, ...caps } }), skipBurst: true })
    expect((await prep({})).connection.thinking).toBe('default')
    expect((await prep({ thinking_level: 'medium' })).connection.thinking).toBe('medium')
    expect((await prep({ thinking_level: 'medium', thinking_levels: { designer: 'high' } })).connection.thinking).toBe('high')
    const withRule = await prep({ thinking_level: 'medium', thinking_levels: { designer: 'high' }, model_rules: [{ id: 'r1', users: ['u1'], connection: 'default', model: 'llama3.2', thinking_level: 'low' }] })
    expect(withRule.connection.thinking).toBe('low')
    expect(withRule.profile?.id).toBe('r1')
  }, 30_000) // four full turn preparations (MCP server, designer tools): slow on a loaded machine
})
