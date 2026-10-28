/**
 * Security audit additions feeding the event stream (log export phase 1):
 *   - sampled API-key auth-failure audits in validateApiKey
 *   - OAuth token issued / revoked audits (app/api/oauth/token, /revoke)
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'

// The sampling window is driven by a faked Date: keep it in-process even when
// the suite runs with a shared cache store (CACHE_PROVIDER=postgres|redis),
// whose TTLs follow the server's clock.
vi.mock('@/lib/providers/cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/providers/cache')>()
  const store = actual.resolveCacheStore('memory')
  return { ...actual, getCacheStore: async () => store }
})

type Row = Record<string, unknown>
const tables: Record<string, Row[]> = {}
const inserts: Array<{ table: string; row: Row }> = []
const updates: Array<{ table: string; values: Row }> = []

/** Minimal PostgREST-ish builder: eq/is filters, insert/update recording. */
function builder(table: string) {
  const filters: Array<(row: Row) => boolean> = []
  let op: 'select' | 'insert' | 'update' = 'select'
  let payload: Row | null = null
  let limit = Infinity
  const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r))).slice(0, limit)
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (col: string, value: unknown) => { filters.push((r) => r[col] === value); return b },
    is: (col: string, value: unknown) => { filters.push((r) => (r[col] ?? null) === value); return b },
    limit: (n: number) => { limit = n; return b },
    insert: (row: Row) => { op = 'insert'; payload = row; return b },
    update: (values: Row) => { op = 'update'; payload = values; return b },
    single: async () => {
      if (op !== 'insert') return { data: rows()[0] ?? null, error: null }
      inserts.push({ table, row: payload! })
      return { data: { id: `${table}-${inserts.length}`, ...payload }, error: null }
    },
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
      if (op === 'insert') {
        inserts.push({ table, row: payload! })
        return Promise.resolve({ data: [{ id: `${table}-${inserts.length}`, ...payload }], error: null }).then(resolve, reject)
      }
      if (op === 'update') updates.push({ table, values: payload! })
      return Promise.resolve({ data: rows(), error: null }).then(resolve, reject)
    },
  }
  return b
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => builder(table), rpc: async () => ({ data: null, error: null }) }),
}))

import { validateApiKey } from '@/lib/api-auth'
import { POST as tokenPOST } from '@/app/api/oauth/token/route'
import { POST as revokePOST } from '@/app/api/oauth/revoke/route'
import { hashOAuthToken } from '@/lib/oauth/tokens'

const auditRows = () => inserts.filter((i) => i.table === 'object_audit_log').map((i) => i.row)

beforeEach(() => {
  for (const key of Object.keys(tables)) delete tables[key]
  inserts.length = 0
  updates.length = 0
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-24T00:00:00Z'))
})
afterEach(() => { vi.useRealTimers() })

describe('validateApiKey auth-failure audit sampling', () => {
  const GOOD = 'ut_aaaaa_correct_secret_value'
  const WRONG = 'ut_aaaaa_wrong_secret_value!!'
  let hash = ''
  beforeAll(async () => { hash = await bcrypt.hash(GOOD, 4) })

  const call = (token: string) =>
    validateApiKey(new NextRequest('https://app.test/api/v1/me', { headers: { authorization: `Bearer ${token}` } }))

  const activeKey = (over: Row = {}) => ({
    id: 'key-1', tenant_id: 'tenant-a', key_hash: hash, key_prefix: GOOD.slice(0, 8), key_type: 'tenant',
    permissions: [], scopes: {}, expires_at: null, created_by: null, user_id: null, is_revoked: false, ...over,
  })

  it('records one audit row per tenant+prefix per 5 minutes and never the key itself', async () => {
    tables.api_keys = [activeKey()]
    for (let i = 0; i < 5; i++) expect((await call(WRONG)).success).toBe(false)
    expect(auditRows()).toHaveLength(1)
    const row = auditRows()[0]
    expect(row).toMatchObject({
      tenant_id: 'tenant-a', actor_id: null, object_type: 'api_key', object_id: 'key-1', action: 'auth_failed',
      metadata: { event: 'auth_failed', key_prefix: 'ut_aaaaa', reason: 'invalid_secret' },
    })
    expect(JSON.stringify(row)).not.toContain(WRONG)
    expect(JSON.stringify(row)).not.toContain('wrong_secret')

    vi.setSystemTime(new Date('2026-10-24T00:05:01Z'))
    await call(WRONG)
    expect(auditRows()).toHaveLength(2)
  })

  it('audits expired keys with reason expired', async () => {
    tables.api_keys = [activeKey({ id: 'key-exp', tenant_id: 'tenant-exp', expires_at: '2020-01-01T00:00:00Z' })]
    const result = await call(GOOD)
    expect(result.success).toBe(false)
    expect(auditRows()).toEqual([expect.objectContaining({ object_id: 'key-exp', metadata: expect.objectContaining({ reason: 'expired' }) })])
  })

  it('attributes use of a revoked key to its tenant', async () => {
    tables.api_keys = [activeKey({ id: 'key-rev', tenant_id: 'tenant-rev', is_revoked: true })]
    expect((await call(GOOD)).success).toBe(false)
    expect(auditRows()).toEqual([expect.objectContaining({ tenant_id: 'tenant-rev', object_id: 'key-rev', metadata: expect.objectContaining({ reason: 'revoked' }) })])
  })

  it('does not audit unattributable failures or successful auth', async () => {
    tables.api_keys = [activeKey({ tenant_id: 'tenant-ok' })]
    expect((await call('ut_zzzzz_unknown_prefix_key')).success).toBe(false)
    expect((await call(GOOD)).success).toBe(true)
    expect(auditRows()).toHaveLength(0)
  })
})

describe('OAuth token audits', () => {
  const SECRET = 'confidential-client-secret'
  const form = (fields: Record<string, string>) => new NextRequest('https://app.test/api/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  })

  beforeEach(() => {
    tables.oauth_clients = [{
      id: 'c1', tenant_id: 'tenant-o', client_id: 'svc-client', client_secret_hash: hashOAuthToken(SECRET),
      client_type: 'confidential', grant_types: ['client_credentials', 'refresh_token'], allowed_scopes: ['tasks:read'],
      revoked_at: null, created_by: 'u1',
    }]
  })

  it('client_credentials issuance writes security.oauth.token_issued metadata without token material', async () => {
    const res = await tokenPOST(form({ grant_type: 'client_credentials', client_id: 'svc-client', client_secret: SECRET }))
    expect(res.status).toBe(200)
    const body = await res.json()
    const rows = auditRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      tenant_id: 'tenant-o', object_type: 'oauth_client', object_id: 'svc-client', action: 'grant',
      metadata: { event: 'token_issued', client_id: 'svc-client', grant_type: 'client_credentials', scopes: ['tasks:read'] },
    })
    expect(JSON.stringify(rows[0])).not.toContain(body.access_token)
    expect(JSON.stringify(rows[0])).not.toContain(SECRET)
  })

  it('a rejected client secret issues no token and no issuance audit', async () => {
    const res = await tokenPOST(form({ grant_type: 'client_credentials', client_id: 'svc-client', client_secret: 'nope' }))
    expect(res.status).toBe(401)
    expect(auditRows()).toHaveLength(0)
  })

  it('revocation writes security.oauth.token_revoked', async () => {
    const raw = 'uoa_some_access_token'
    tables.oauth_tokens = [{
      id: 't1', tenant_id: 'tenant-o', token_type: 'access', token_hash: hashOAuthToken(raw), client_id: 'svc-client',
      user_id: null, grant_type: 'client_credentials', scopes: ['tasks:read'], refresh_parent: null,
      expires_at: '2099-01-01T00:00:00Z', revoked_at: null,
    }]
    const res = await revokePOST(new NextRequest('https://app.test/api/oauth/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: raw, client_id: 'svc-client', client_secret: SECRET }).toString(),
    }))
    expect(res.status).toBe(200)
    expect(auditRows()).toEqual([expect.objectContaining({
      action: 'revoke',
      metadata: { event: 'token_revoked', client_id: 'svc-client', token_type: 'access', grant_type: 'client_credentials' },
    })])
    expect(JSON.stringify(auditRows())).not.toContain(raw)
  })
})
