/**
 * The Agent's model rules (version 2 — since Agent profiles they are read and
 * accepted as model-only profiles; __tests__/assistant-profiles.test.ts covers
 * profiles themselves): first match wins (top to bottom), none → the
 * default; rule keys are encrypted and never returned; usage records the
 * model actually used (and the rule); the "who gets what" preview and the
 * per-rule test need assistants.manage; first-release rows still work.
 */
import { randomBytes } from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { matchModelRule, normalizeModelRules, ruleSummary, type ModelRule } from '@/lib/assistants/model-rules'
import { profilesFromModelRules, resolvePersonModel } from '@/lib/assistants/profiles'
import { normalizeAgentSettings } from '@/lib/assistants/config'
import { normalizeRow, resolvePersonConnection } from '@/lib/assistants/settings'
import { getAssistantSettings, previewPersonModel, testModelRuleConnection, updateAssistantSettings } from '@/lib/services/assistants'
import { runPreparedTurn, type PreparedTurn } from '@/lib/assistants/chat'
import { UI_READS } from '@/lib/services/ui-reads'
import { installEncryptionKey, isEncrypted } from '@/lib/secret-crypto'
import type { ServiceContext } from '@/lib/services/context'

/* eslint-disable @typescript-eslint/no-explicit-any */

/* ── A tiny in-memory PostgREST-ish client (eq / in / gte / is, count head, upsert) ── */
type Row = Record<string, any>
function fakeDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {}
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }))
  const queries: string[] = []
  const from = (table: string) => {
    let op: 'select' | 'insert' | 'update' | 'upsert' = 'select'
    let payload: any
    let head = false
    let mode: 'many' | 'single' = 'many'
    let lim: number | undefined
    const filters: Array<(r: Row) => boolean> = []
    const rows = () => (tables[table] ??= [])
    const run = () => {
      queries.push(`${op}:${table}`)
      if (op === 'insert') { for (const r of [].concat(payload)) rows().push({ id: `id${rows().length + 1}`, ...(r as Row) }); return { data: null, error: null } }
      if (op === 'upsert') {
        const existing = rows().find((r) => r.tenant_id === payload.tenant_id)
        if (existing) Object.assign(existing, payload); else rows().push({ ...payload })
        return { data: null, error: null }
      }
      const matched = rows().filter((r) => filters.every((f) => f(r)))
      if (op === 'update') { for (const r of matched) Object.assign(r, payload); return { data: null, error: null } }
      if (head) return { data: null, error: null, count: matched.length }
      const list = (lim === undefined ? matched : matched.slice(0, lim)).map((r) => ({ ...r }))
      return mode === 'single' ? { data: list[0] ?? null, error: null } : { data: list, error: null }
    }
    const api: any = {
      select: (_c?: string, o?: { head?: boolean }) => { if (o?.head) head = true; return api },
      insert: (r: any) => { op = 'insert'; payload = r; return api },
      update: (p: any) => { op = 'update'; payload = p; return api },
      upsert: (p: any) => { op = 'upsert'; payload = p; return api },
      eq: (c: string, v: any) => { filters.push((r) => r[c] === v); return api },
      in: (c: string, v: any[]) => { filters.push((r) => v.includes(r[c])); return api },
      gte: (c: string, v: any) => { filters.push((r) => String(r[c]) >= String(v)); return api },
      is: (c: string, v: any) => { filters.push((r) => (r[c] ?? null) === v); return api },
      order: () => api,
      limit: (n: number) => { lim = n; return api },
      maybeSingle: () => { mode = 'single'; return Promise.resolve(run()) },
      single: () => { mode = 'single'; return Promise.resolve(run()) },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    }
    return api
  }
  return { client: { from } as any, tables, queries }
}

const T = 'tenant-1'
const ADMIN = ['assistants.manage']
const ctxFor = (db: any, perms: string[]): ServiceContext => ({ db, supabase: db, tenantId: T, actorId: 'admin', permissions: new Set(perms), authKind: 'api_key', source: 'api' })
const rule = (over: Partial<ModelRule>): ModelRule => normalizeModelRules([{ id: 'r', model: 'm', ...over }])[0]

beforeAll(() => installEncryptionKey(randomBytes(32).toString('base64')))

describe('rule resolution', () => {
  const priya = { userId: 'priya', roleIds: ['r-member'], teamIds: ['t-finance'] }
  it('first match wins, top to bottom; a rule naming the person placed first beats their team', () => {
    const rules = [rule({ id: 'user', users: ['priya'], model: 'claude-sonnet-4-6' }), rule({ id: 'team', teams: ['t-finance'], model: 'gpt-4.1-mini' })]
    expect(matchModelRule(rules, priya)?.id).toBe('user')
    expect(matchModelRule([...rules].reverse(), priya)?.id).toBe('team')
  })
  it('a role matches too; nobody matched → the default', () => {
    expect(matchModelRule([rule({ roles: ['r-member'] })], priya)?.id).toBe('r')
    const row = { provider: 'openai' as const, model: 'gpt-4.1', agent: { profiles: profilesFromModelRules([rule({ users: ['someone-else'] })]) } }
    expect(resolvePersonModel(row, priya)).toEqual({ profile: null, provider: 'openai', model: 'gpt-4.1' })
  })
  it('summary reads "Who → Model"', () => {
    expect(ruleSummary(rule({ users: ['priya'], teams: ['t1'], roles: ['r1'], label: 'Claude Sonnet' }), { users: new Map([['priya', 'Priya']]), teams: new Map([['t1', 'Finance']]), roles: new Map([['r1', 'Builders']]) }))
      .toBe('Priya, Finance (team), Builders (role) → Claude Sonnet')
  })
  it('back-compat: first-release and rule-less rows have no rules (everyone on the default)', () => {
    expect(normalizeAgentSettings({ form: { enabled: true } }).profiles).toEqual([])
    expect(normalizeAgentSettings({ version: 2, enabled: true }).profiles).toEqual([])
  })
})

describe('rule keys and connections', () => {
  it('a rule key is encrypted into model_rule_keys, never returned (only last 4), and kept when not re-sent', async () => {
    const db = fakeDb()
    const key = 'sk-ant-RULE-SECRET-4321'
    await updateAssistantSettings(ctxFor(db.client, ADMIN), { provider: 'openai', api_key: 'sk-default-0000', agent: { enabled: true, model_rules: [{ id: 'builders', roles: ['r-build'], connection: 'key', provider: 'anthropic', model: 'claude-sonnet-4-6', api_key: key }] } })
    const stored = db.tables.assistant_settings[0]
    expect(isEncrypted(stored.model_rule_keys.builders)).toBe(true)
    expect(JSON.stringify(stored.capabilities)).not.toContain(key)
    const view = await getAssistantSettings(ctxFor(db.client, ADMIN))
    const json = JSON.stringify(view)
    expect(json).not.toContain(key)
    expect(json).not.toContain(stored.model_rule_keys.builders)
    expect(view.agent.profiles[0].key_last4).toBe('4321')
    const cipher = stored.model_rule_keys.builders
    await updateAssistantSettings(ctxFor(db.client, ADMIN), { agent: { profiles: [{ ...view.agent.profiles[0], api_key: '' }] } })
    expect(db.tables.assistant_settings[0].model_rule_keys.builders).toBe(cipher)
    // Removing the rule drops its key.
    await updateAssistantSettings(ctxFor(db.client, ADMIN), { agent: { model_rules: [] } })
    expect(db.tables.assistant_settings[0].model_rule_keys).toEqual({})
  })

  it('the person\'s connection follows their rule (its provider, key and model)', async () => {
    const db = fakeDb()
    await updateAssistantSettings(ctxFor(db.client, ADMIN), { provider: 'openai', api_key: 'sk-default-0000', agent: { enabled: true, model_rules: [{ id: 'b', roles: ['r-build'], connection: 'key', provider: 'anthropic', model: 'claude-sonnet-4-6', api_key: 'sk-ant-xyz-1111' }] } })
    const row = normalizeRow(db.tables.assistant_settings[0])!
    const builder = await resolvePersonConnection(db.client, row, { userId: 'u', roleIds: ['r-build'], teamIds: [] })
    expect(builder.profile?.id).toBe('b')
    expect(builder.connection.model).toBe('claude-sonnet-4-6')
    expect(builder.connection.url).toContain('api.anthropic.com')
    const other = await resolvePersonConnection(db.client, row, { userId: 'v', roleIds: [], teamIds: [] })
    expect(other.profile).toBeNull()
    expect(other.connection.url).toContain('api.openai.com')
  })

  it('per-rule Test connection uses the rule\'s connection and stores the result; needs assistants.manage', async () => {
    const db = fakeDb()
    await updateAssistantSettings(ctxFor(db.client, ADMIN), { provider: 'openai', api_key: 'sk-default-0000', agent: { enabled: true, model_rules: [{ id: 'cheap', teams: ['t'], connection: 'default', model: 'gpt-4.1-mini' }] } })
    const fetchImpl = vi.fn(async (_u: any, init: any) => new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }], model: JSON.parse(init.body).model }), { status: 200 }))
    const r = await testModelRuleConnection(ctxFor(db.client, ADMIN), 'cheap', fetchImpl as any)
    expect(r.ok).toBe(true)
    expect(JSON.parse((fetchImpl.mock.calls[0][1] as any).body).model).toBe('gpt-4.1-mini')
    expect(db.tables.assistant_settings[0].capabilities.model_rules[0].last_test_status).toBe('ok')
    await expect(testModelRuleConnection(ctxFor(db.client, []), 'cheap')).rejects.toThrow(/assistants.manage/)
  })
})

describe('who gets what (preview)', () => {
  it('is gated by assistants.manage (service and ui read)', async () => {
    expect((UI_READS as any)['assistants.modelPreview'].perm).toBe('assistants.manage')
    await expect(previewPersonModel(ctxFor(fakeDb().client, []), 'u')).rejects.toThrow(/assistants.manage/)
  })
  it('shows the rule and model a member gets; the default otherwise', async () => {
    const db = fakeDb({ user_memberships: [{ tenant_id: T, user_id: 'priya' }, { tenant_id: T, user_id: 'sam' }], user_teams: [{ user_id: 'priya', team_id: 't-fin' }], teams: [{ id: 't-fin', tenant_id: T }] })
    await updateAssistantSettings(ctxFor(db.client, ADMIN), { provider: 'openai', api_key: 'sk-default-0000', model: 'gpt-4.1', agent: { enabled: true, model_rules: [{ id: 'fin', label: 'Mini for finance', teams: ['t-fin'], connection: 'default', model: 'gpt-4.1-mini' }] } })
    expect(await previewPersonModel(ctxFor(db.client, ADMIN), 'priya')).toMatchObject({ source: 'profile', model: 'gpt-4.1-mini', rule: { id: 'fin', index: 0 }, profile: { id: 'fin', name: 'Mini for finance' } })
    expect(await previewPersonModel(ctxFor(db.client, ADMIN), 'sam')).toMatchObject({ source: 'default', model: 'gpt-4.1' })
    await expect(previewPersonModel(ctxFor(db.client, ADMIN), 'stranger')).rejects.toThrow(/member/)
  })
})

describe('usage records the model actually used', () => {
  it('provider, model and the rule go on the usage row', async () => {
    const db = fakeDb()
    const prepared: PreparedTurn = {
      capability: 'designer', profile: { id: 'builders', name: 'Builders' }, instructions: 'I', context: null, tools: [],
      limits: { maxIterations: 2, maxTokens: 1000, maxOutputTokens: 100, timeoutMs: 10_000 },
      connection: { provider: 'anthropic', model: 'claude-sonnet-4-6', url: 'https://api.anthropic.com/v1/chat/completions', headers: {}, baseUrl: 'https://api.anthropic.com' },
    }
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { status: 200 }))
    await runPreparedTurn(ctxFor(db.client, []), prepared, { messages: [{ role: 'user', content: 'hello' }] }, { serviceDb: db.client, onEvent: () => {}, fetchImpl: fetchImpl as any })
    expect(db.tables.assistant_usage[0]).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-4-6', model_rule: 'builders' })
  })
})
