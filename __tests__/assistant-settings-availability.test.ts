/**
 * AI assistants: the availability rule (nothing shows without a key, the
 * capability on and the person allowed; per-form opt-in / opt-out), the
 * settings service (the key is write-only and encrypted), xAI provider
 * config, and the daily / monthly limits.
 */
import { randomBytes } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { formAllows, normalizeAgentSettings, resolveAvailability, userAllowed, type AvailabilitySettings } from '@/lib/assistants/config'
import { presentSettings, resolveConnection, normalizeRow } from '@/lib/assistants/settings'
import { AssistantLimitError, checkAssistantLimits } from '@/lib/assistants/limits'
import { getAssistantAvailability, getAssistantSettings, updateAssistantSettings } from '@/lib/services/assistants'
import { agentProviderKind, DEFAULT_MODEL, resolveAgentEndpoint, resolveChatUrl } from '@/lib/agents/provider'
import { getConnectorDefinition } from '@/lib/connectors/registry'
import { encryptSecret, installEncryptionKey, isEncrypted } from '@/lib/secret-crypto'
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
const U = 'user-1'
const ctxFor = (db: any, perms: string[]): ServiceContext => ({
  db, supabase: db, tenantId: T, actorId: U, permissions: new Set(perms), authKind: 'api_key', source: 'api',
})

const settings = (agent: any, usable = true): AvailabilitySettings => ({ provider: 'openai', usable, agent: normalizeAgentSettings(agent) })
const person = (perms: string[], roleIds: string[] = [], teamIds: string[] = []) => ({ permissions: new Set(perms), roleIds, teamIds })
const ALL_ON = { version: 2, enabled: true }
const NONE = { agent: false, form_read: false, form: false, task: false, designer: false, admin: false }
const WORKER = ['forms.submit', 'tasks.view_own']
const BUILDER = [...WORKER, 'forms.edit', 'workflows.edit']

describe('availability rule (one Agent)', () => {
  it('no settings / no usable key → nothing, even when on', () => {
    expect(resolveAvailability(null, person(BUILDER))).toEqual(NONE)
    expect(resolveAvailability(settings(ALL_ON, false), person(BUILDER))).toEqual(NONE)
  })

  it('the single switch: off → nothing at all; on → the Agent for everyone allowed', () => {
    expect(resolveAvailability(settings({ version: 2, enabled: false }), person(BUILDER))).toEqual(NONE)
    expect(resolveAvailability(settings(ALL_ON), person([])).agent).toBe(true)
  })

  it('one access list: empty = everyone; else a listed role or a listed team', () => {
    const rule = { enabled: true, roles: ['r-admin'], teams: ['t-ops'] }
    expect(userAllowed({ enabled: true, roles: [], teams: [] }, person([]))).toBe(true)
    expect(userAllowed(rule, person([], ['r-member']))).toBe(false)
    expect(userAllowed(rule, person([], ['r-admin']))).toBe(true)
    expect(userAllowed(rule, person([], [], ['t-ops']))).toBe(true)
    expect(userAllowed({ ...rule, enabled: false }, person([], ['r-admin']))).toBe(false)
    const s = settings({ version: 2, enabled: true, roles: ['r-admin'] })
    expect(resolveAvailability(s, person(BUILDER, ['r-member']))).toEqual(NONE)
    expect(resolveAvailability(s, person(BUILDER, ['r-admin'])).designer).toBe(true)
  })

  it('what a person can do follows their permissions: viewer → read help only; member → form + task; builder → building', () => {
    expect(resolveAvailability(settings(ALL_ON), person(['tasks.view_own']))).toEqual({ agent: true, form_read: true, form: false, task: true, designer: false, admin: false })
    expect(resolveAvailability(settings(ALL_ON), person(WORKER))).toEqual({ agent: true, form_read: true, form: true, task: true, designer: false, admin: false })
    expect(resolveAvailability(settings(ALL_ON), person(BUILDER)).designer).toBe(true)
  })

  it('Advanced tool groups turn a kind of help off for everyone', () => {
    const s = settings({ version: 2, enabled: true, tools: { designer: false, task: false } })
    expect(resolveAvailability(s, person(BUILDER))).toEqual({ agent: true, form_read: true, form: true, task: false, designer: false, admin: false })
  })

  it('per-form setting: off turns off form help on that form only (never the Agent or task help); on opts in when all_forms is false', () => {
    const on = settings(ALL_ON)
    expect(resolveAvailability(on, person(BUILDER), { formKnown: true, formSetting: 'off' })).toEqual({ agent: true, form_read: false, form: false, task: true, designer: true, admin: false })
    expect(resolveAvailability(on, person(BUILDER), { formKnown: true, formSetting: null }).form).toBe(true)
    const optIn = settings({ version: 2, enabled: true, all_forms: false })
    expect(resolveAvailability(optIn, person(BUILDER), { formKnown: true, formSetting: null }).form).toBe(false)
    expect(resolveAvailability(optIn, person(BUILDER), { formKnown: true, formSetting: 'on' }).form).toBe(true)
    expect(formAllows(normalizeAgentSettings({}), null)).toBe(true)
  })
})

describe('getAssistantAvailability (service)', () => {
  it('no settings row → all false', async () => {
    const db = fakeDb()
    expect(await getAssistantAvailability(ctxFor(db.client, BUILDER))).toEqual(NONE)
  })

  it('a saved key and the Agent on → available; a form turned off → no form help there', async () => {
    const db = fakeDb({
      assistant_settings: [{ tenant_id: T, provider: 'openai', key_source: 'key', api_key: 'enc:v1:whatever', key_last4: 'abcd', model: '', capabilities: ALL_ON, limits: {} }],
      user_roles: [{ tenant_id: T, user_id: U, role_id: 'r1' }],
      forms: [{ id: 'f-off', tenant_id: T, layout: { rows: [], assistant: 'off' } }, { id: 'f-on', tenant_id: T, layout: { rows: [] } }],
    })
    expect(await getAssistantAvailability(ctxFor(db.client, BUILDER))).toEqual({ agent: true, form_read: true, form: true, task: true, designer: true, admin: false })
    const off = await getAssistantAvailability(ctxFor(db.client, BUILDER), { formId: 'f-off' })
    expect(off.form).toBe(false)
    expect(off.agent).toBe(true)
    expect((await getAssistantAvailability(ctxFor(db.client, BUILDER), { formId: 'f-on' })).form).toBe(true)
  })

  it('a first-release row (three capabilities) still works: the Agent is on', async () => {
    const db = fakeDb({
      assistant_settings: [{ tenant_id: T, provider: 'openai', key_source: 'key', api_key: 'enc:v1:whatever', key_last4: 'abcd', model: '', capabilities: { form: { enabled: true } }, limits: {} }],
    })
    expect(await getAssistantAvailability(ctxFor(db.client, BUILDER))).toEqual({ agent: true, form_read: true, form: true, task: false, designer: false, admin: false })
  })
})

describe('xAI Grok provider', () => {
  beforeAll(() => installEncryptionKey(randomBytes(32).toString('base64')))

  it('is a provider kind with the OpenAI-compatible endpoint and Bearer auth', () => {
    expect(agentProviderKind('xai', null)).toBe('xai')
    expect(agentProviderKind(null, 'https://api.x.ai')).toBe('xai')
    expect(resolveChatUrl('xai', 'https://api.x.ai')).toBe('https://api.x.ai/v1/chat/completions')
    const ep = resolveAgentEndpoint({ type: 'xai', config: { base_url: 'https://api.x.ai', auth_config: { token: 'xai-key' } } })
    expect(ep.headers.Authorization).toBe('Bearer xai-key')
    expect(DEFAULT_MODEL.xai).toBe('grok-4')
    expect(getConnectorDefinition('xai')?.category).toBe('ai')
  })

  it('a settings row for xAI with an encrypted key resolves to the xAI endpoint', async () => {
    const row = normalizeRow({ tenant_id: T, provider: 'xai', key_source: 'key', api_key: encryptSecret('xai-secret-123'), model: '' })!
    const conn = await resolveConnection(fakeDb().client, row)
    expect(conn.provider).toBe('xai')
    expect(conn.url).toBe('https://api.x.ai/v1/chat/completions')
    expect(conn.headers.Authorization).toBe('Bearer xai-secret-123')
    expect(conn.model).toBe('grok-4')
  })
})

describe('settings: the key is write-only', () => {
  beforeAll(() => installEncryptionKey(randomBytes(32).toString('base64')))
  const ADMIN = [...BUILDER, 'assistants.manage']

  it('needs assistants.manage', async () => {
    const db = fakeDb()
    await expect(getAssistantSettings(ctxFor(db.client, BUILDER))).rejects.toThrow(/assistants.manage/)
    await expect(updateAssistantSettings(ctxFor(db.client, BUILDER), { model: 'gpt-4.1' })).rejects.toThrow(/assistants.manage/)
  })

  it('stores the key encrypted with its last 4, never returns it, and keeps it on "" / __SECRET__', async () => {
    const db = fakeDb()
    const key = 'sk-test-PLAINTEXT-9876'
    const view = await updateAssistantSettings(ctxFor(db.client, ADMIN), { provider: 'openai', api_key: key, agent: { enabled: true } })
    const stored = db.tables.assistant_settings[0]
    expect(stored.api_key).not.toBe(key)
    expect(isEncrypted(stored.api_key)).toBe(true)
    expect(stored.key_last4).toBe('9876')
    expect(view.key_hint).toBe('•••• 9876')
    expect(view.key_saved).toBe(true)
    expect(view).not.toHaveProperty('api_key')
    const full = await getAssistantSettings(ctxFor(db.client, ADMIN))
    const json = JSON.stringify(full)
    expect(json).not.toContain(key)
    expect(json).not.toContain(stored.api_key)
    expect(full.configured).toBe(true)

    const cipher = stored.api_key
    await updateAssistantSettings(ctxFor(db.client, ADMIN), { api_key: '' , model: 'gpt-4.1-mini' })
    expect(db.tables.assistant_settings[0].api_key).toBe(cipher)
    await updateAssistantSettings(ctxFor(db.client, ADMIN), { api_key: '__SECRET__' })
    expect(db.tables.assistant_settings[0].api_key).toBe(cipher)
  })

  it('presentSettings never carries the ciphertext', () => {
    const view = presentSettings(normalizeRow({ tenant_id: T, provider: 'openai', api_key: 'enc:v1:SECRETCIPHER', key_last4: 'wxyz' }))
    expect(JSON.stringify(view)).not.toContain('SECRETCIPHER')
    expect(view.key_hint).toBe('•••• wxyz')
  })
})

describe('limits', () => {
  const now = new Date('2026-11-15T12:00:00Z')
  const recent = '2026-11-15T10:00:00Z'

  it('no limits → nothing is queried', async () => {
    const db = fakeDb()
    await checkAssistantLimits(db.client, T, U, { messages_per_user_per_day: 0, monthly_cost_cap: 0, cost_currency: 'USD' }, now)
    expect(db.queries).toEqual([])
  })

  it('daily messages per person', async () => {
    const db = fakeDb({ assistant_usage: [1, 2, 3].map(() => ({ tenant_id: T, user_id: U, created_at: recent, cost_status: 'unknown' })) })
    await expect(checkAssistantLimits(db.client, T, U, { messages_per_user_per_day: 3, monthly_cost_cap: 0, cost_currency: 'USD' }, now))
      .rejects.toMatchObject({ code: 'daily_messages' })
    await expect(checkAssistantLimits(db.client, T, 'someone-else', { messages_per_user_per_day: 3, monthly_cost_cap: 0, cost_currency: 'USD' }, now)).resolves.toBeUndefined()
  })

  it('monthly cost cap counts priced spend in the cap currency only', async () => {
    const rows = [
      { tenant_id: T, user_id: U, created_at: recent, cost_status: 'priced', cost_amount: 6, cost_currency: 'USD' },
      { tenant_id: T, user_id: U, created_at: recent, cost_status: 'unknown', cost_amount: null, cost_currency: null },
      { tenant_id: T, user_id: U, created_at: recent, cost_status: 'priced', cost_amount: 50, cost_currency: 'EUR' },
    ]
    const limits = { messages_per_user_per_day: 0, monthly_cost_cap: 10, cost_currency: 'USD' }
    await expect(checkAssistantLimits(fakeDb({ assistant_usage: rows }).client, T, U, limits, now)).resolves.toBeUndefined()
    const over = [...rows, { tenant_id: T, user_id: 'u2', created_at: recent, cost_status: 'priced', cost_amount: 4.5, cost_currency: 'USD' }]
    const err = await checkAssistantLimits(fakeDb({ assistant_usage: over }).client, T, U, limits, now).catch((e) => e)
    expect(err).toBeInstanceOf(AssistantLimitError)
    expect(err.code).toBe('monthly_cost')
  })
})
