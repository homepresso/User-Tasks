import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'

/**
 * Credential validation cache (lib/api-auth-cache) as used by validateApiKey:
 * repeat requests skip bcrypt and the DB, revocation through the service /
 * OAuth paths is visible immediately on the same instance, credential expiry
 * caps the cache lifetime, and last_used_at writes are throttled.
 */

type Row = Record<string, unknown>
const db: Record<string, Row[]> = {}
const calls: string[] = []

function matches(row: Row, filters: Array<[string, string, unknown]>) {
  return filters.every(([op, col, value]) => {
    if (op === 'eq') return row[col] === value
    if (op === 'is') return (row[col] ?? null) === value
    if (op === 'in') return (value as unknown[]).includes(row[col])
    return true
  })
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table: string) {
      let op = 'select'
      let patch: Row | null = null
      const filters: Array<[string, string, unknown]> = []
      const run = () => {
        calls.push(`${op}:${table}`)
        const rows = db[table] ?? (db[table] = [])
        if (op === 'insert') return []
        const hit = rows.filter((row) => matches(row, filters))
        if (op === 'update') hit.forEach((row) => Object.assign(row, patch))
        if (op === 'delete') db[table] = rows.filter((row) => !hit.includes(row))
        return hit
      }
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (col: string, value: unknown) => { filters.push(['eq', col, value]); return builder },
        is: (col: string, value: unknown) => { filters.push(['is', col, value]); return builder },
        in: (col: string, value: unknown[]) => { filters.push(['in', col, value]); return builder },
        neq: () => builder,
        limit: () => builder,
        order: () => builder,
        update: (value: Row) => { op = 'update'; patch = value; return builder },
        insert: () => { op = 'insert'; return builder },
        delete: () => { op = 'delete'; return builder },
        maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
        single: async () => ({ data: run()[0] ?? null, error: null }),
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve({ data: run(), error: null }).then(resolve, reject),
      }
      return builder
    },
    rpc: async () => ({ data: null, error: null }),
  }),
}))

import { validateApiKey } from '@/lib/api-auth'
import {
  credentialCacheSize,
  LAST_USED_WRITE_INTERVAL_MS,
  resetCredentialCacheForTests,
  shouldWriteLastUsed,
  CREDENTIAL_CACHE_MAX_ENTRIES,
  credentialCacheGeneration,
  setCachedCredential,
  getCachedCredential,
  invalidateCredentialCache,
} from '@/lib/api-auth-cache'
import { revokeApiKey, deleteApiKey } from '@/lib/services/api-keys'
import { updateRole } from '@/lib/services/roles'
import { hashOAuthToken } from '@/lib/oauth/tokens'
import { POST as revokeOAuthToken } from '@/app/api/oauth/revoke/route'
import type { ServiceContext } from '@/lib/services/context'

const API_KEY = 'ut_cache_0123456789abcdef0123456789'
const OAUTH_TOKEN = 'uoa_cache_test_access_token'
let keyHash = ''
const bcryptCompare = vi.spyOn(bcrypt, 'compare')

beforeAll(async () => {
  keyHash = await bcrypt.hash(API_KEY, 4)
})

beforeEach(() => {
  for (const table of Object.keys(db)) delete db[table]
  calls.length = 0
  bcryptCompare.mockClear()
  resetCredentialCacheForTests()
})

afterEach(() => {
  vi.useRealTimers()
})

const request = (token: string) => new NextRequest('https://app.test/api/v1/me', { headers: { authorization: `Bearer ${token}` } })
const count = (call: string) => calls.filter((c) => c === call).length

function seedApiKey(overrides: Row = {}) {
  db.api_keys = [{
    id: 'key-1', tenant_id: 'tenant-1', key_hash: keyHash, key_prefix: API_KEY.slice(0, 8), key_type: 'tenant', name: 'CI',
    permissions: ['workflows.view'], scopes: {}, expires_at: null, created_by: 'u-1', user_id: null, is_revoked: false,
    ...overrides,
  }]
}

function seedOAuth(overrides: Row = {}) {
  db.oauth_tokens = [{
    id: 'tok-1', tenant_id: 'tenant-1', token_type: 'access', token_hash: hashOAuthToken(OAUTH_TOKEN), client_id: 'client-1',
    user_id: null, grant_type: 'client_credentials', scopes: ['workflows:read'], refresh_parent: null,
    expires_at: '2099-01-01T00:00:00.000Z', revoked_at: null, ...overrides,
  }]
  db.oauth_clients = [{ id: 'c-1', client_id: 'client-1', tenant_id: 'tenant-1', client_type: 'public', revoked_at: null, created_by: null }]
}

async function serviceCtx(): Promise<ServiceContext> {
  // Same mocked client the auth path uses (state lives in `db`); permissions
  // null = ungated, like a full admin.
  const { createClient } = await import('@supabase/supabase-js')
  return {
    supabase: createClient('http://x', 'y'),
    tenantId: 'tenant-1', actorId: 'u-1', permissions: null, authKind: 'session', source: 'ui',
  } as unknown as ServiceContext
}

describe('validateApiKey credential cache', () => {
  it('serves repeat requests from the cache (no bcrypt, no key lookup)', async () => {
    seedApiKey()
    const first = await validateApiKey(request(API_KEY))
    const second = await validateApiKey(request(API_KEY))
    expect(first.success && second.success).toBe(true)
    expect(bcryptCompare).toHaveBeenCalledTimes(1)
    expect(count('select:api_keys')).toBe(1)
    if (!second.success || !first.success) return
    expect(second.permissions).toEqual(['workflows.view'])
    expect(second.tenantId).toBe('tenant-1')
    // Callers get copies: mutating one result never leaks into the cache.
    second.permissions.push('settings.manage_api_keys')
    const third = await validateApiKey(request(API_KEY))
    expect(third.success && third.permissions).toEqual(['workflows.view'])
  })

  it('does not cache failures', async () => {
    seedApiKey({ key_hash: await bcrypt.hash('ut_cache_something_else', 4) })
    expect((await validateApiKey(request(API_KEY))).success).toBe(false)
    expect((await validateApiKey(request(API_KEY))).success).toBe(false)
    expect(count('select:api_keys')).toBe(2)
    expect(credentialCacheSize()).toBe(0)
  })

  it('rejects a revoked key immediately on the same instance', async () => {
    seedApiKey()
    expect((await validateApiKey(request(API_KEY))).success).toBe(true)
    await revokeApiKey(await serviceCtx(), 'key-1')
    const after = await validateApiKey(request(API_KEY))
    expect(after.success).toBe(false)
  })

  it('rejects a deleted key immediately on the same instance', async () => {
    seedApiKey()
    expect((await validateApiKey(request(API_KEY))).success).toBe(true)
    await deleteApiKey(await serviceCtx(), 'key-1')
    expect((await validateApiKey(request(API_KEY))).success).toBe(false)
  })

  it('re-resolves a user key after a role permission change', async () => {
    seedApiKey({ key_type: 'user', user_id: 'u-2', permissions: null })
    db.user_roles = [{ tenant_id: 'tenant-1', user_id: 'u-2', role: { permissions: ['workflows.view', 'workflows.edit'] } }]
    db.roles = [{ id: 'r-1', tenant_id: 'tenant-1', name: 'Editor', is_system: false, permissions: ['workflows.view', 'workflows.edit'] }]
    const before = await validateApiKey(request(API_KEY))
    expect(before.success && before.permissions.sort()).toEqual(['workflows.edit', 'workflows.view'])

    // Narrow the role through the roles service (invalidates the cache).
    db.user_roles[0].role = { permissions: ['workflows.view'] }
    await updateRole(await serviceCtx(), 'r-1', { permissions: ['workflows.view'] })
    const after = await validateApiKey(request(API_KEY))
    expect(after.success && after.permissions).toEqual(['workflows.view'])
  })

  it('never serves a key past its own expiry', async () => {
    vi.useFakeTimers({ now: new Date('2030-01-01T00:00:00.000Z') })
    seedApiKey({ expires_at: '2030-01-01T00:00:10.000Z' })
    expect((await validateApiKey(request(API_KEY))).success).toBe(true)
    vi.setSystemTime(new Date('2030-01-01T00:00:11.000Z'))
    const after = await validateApiKey(request(API_KEY))
    expect(after.success).toBe(false)
    if (!after.success) expect(after.response.status).toBe(401)
  })

  it('expires entries after the TTL so other instances catch up', async () => {
    vi.useFakeTimers({ now: new Date('2030-01-01T00:00:00.000Z') })
    seedApiKey()
    await validateApiKey(request(API_KEY))
    // Revoked directly in the DB (e.g. by another instance): still cached...
    db.api_keys[0].is_revoked = true
    expect((await validateApiKey(request(API_KEY))).success).toBe(true)
    // ...until the TTL passes.
    vi.setSystemTime(new Date('2030-01-01T00:01:01.000Z'))
    expect((await validateApiKey(request(API_KEY))).success).toBe(false)
  })

  it('throttles last_used_at to one write per minute per key', async () => {
    vi.useFakeTimers({ now: new Date('2030-01-01T00:00:00.000Z') })
    seedApiKey()
    for (let i = 0; i < 5; i++) await validateApiKey(request(API_KEY))
    expect(count('update:api_keys')).toBe(1)
    vi.setSystemTime(new Date('2030-01-01T00:00:30.000Z'))
    await validateApiKey(request(API_KEY))
    expect(count('update:api_keys')).toBe(1)
    vi.setSystemTime(new Date('2030-01-01T00:01:01.000Z'))
    await validateApiKey(request(API_KEY))
    expect(count('update:api_keys')).toBe(2)
  })

  it('caches OAuth access tokens and drops them when revoked via /api/oauth/revoke', async () => {
    seedOAuth()
    expect((await validateApiKey(request(OAUTH_TOKEN))).success).toBe(true)
    expect((await validateApiKey(request(OAUTH_TOKEN))).success).toBe(true)
    expect(count('select:oauth_tokens')).toBe(1)

    const res = await revokeOAuthToken(new NextRequest('https://app.test/api/oauth/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: 'client-1', token: OAUTH_TOKEN }).toString(),
    }))
    expect(res.status).toBe(200)
    expect(db.oauth_tokens[0].revoked_at).toBeTruthy()
    const after = await validateApiKey(request(OAUTH_TOKEN))
    expect(after.success).toBe(false)
  })

  it('respects OAuth access-token expiry', async () => {
    vi.useFakeTimers({ now: new Date('2030-01-01T00:00:00.000Z') })
    seedOAuth({ expires_at: '2030-01-01T00:00:05.000Z' })
    expect((await validateApiKey(request(OAUTH_TOKEN))).success).toBe(true)
    vi.setSystemTime(new Date('2030-01-01T00:00:06.000Z'))
    const after = await validateApiKey(request(OAUTH_TOKEN))
    expect(after.success).toBe(false)
    if (!after.success) expect(await after.response.json()).toMatchObject({ error: 'Access token expired' })
  })
})

describe('credential cache primitives', () => {
  it('drops a result computed across an invalidation', () => {
    const startedAt = credentialCacheGeneration()
    invalidateCredentialCache()
    setCachedCredential('k', { ok: true }, { startedAt })
    expect(getCachedCredential('k')).toBeNull()
  })

  it('evicts the least recently used entry beyond the size cap', () => {
    const startedAt = credentialCacheGeneration()
    for (let i = 0; i < CREDENTIAL_CACHE_MAX_ENTRIES; i++) setCachedCredential(`k${i}`, i, { startedAt })
    expect(getCachedCredential('k0')).toBe(0) // touch k0 so k1 is now oldest
    setCachedCredential('extra', 'x', { startedAt })
    expect(credentialCacheSize()).toBe(CREDENTIAL_CACHE_MAX_ENTRIES)
    expect(getCachedCredential('k1')).toBeNull()
    expect(getCachedCredential('k0')).toBe(0)
  })

  it('throttles last-used writes per credential', () => {
    expect(shouldWriteLastUsed('a', 0)).toBe(true)
    expect(shouldWriteLastUsed('a', LAST_USED_WRITE_INTERVAL_MS - 1)).toBe(false)
    expect(shouldWriteLastUsed('b', 1)).toBe(true)
    expect(shouldWriteLastUsed('a', LAST_USED_WRITE_INTERVAL_MS)).toBe(true)
  })
})
