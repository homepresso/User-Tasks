import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'

const timing = vi.hoisted(() => ({ calls: 0 }))
vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('crypto')>()
  const timingSafeEqual: typeof actual.timingSafeEqual = (a, b) => { timing.calls++; return actual.timingSafeEqual(a, b) }
  return { ...actual, default: { ...actual, timingSafeEqual }, timingSafeEqual }
})

// The inbound route's collaborators: after() runs at once (collected), the DB is the memory fake.
const pending = vi.hoisted(() => ({ list: [] as Promise<unknown>[], db: null as unknown }))
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: (fn: () => unknown) => { pending.list.push(Promise.resolve().then(fn)) } }
})
vi.mock('@/lib/providers/db', () => ({ getServiceDb: () => pending.db }))
vi.mock('@/lib/workflow-engine', () => ({ executeWorkflow: vi.fn() }))
vi.mock('@/lib/workflow-queue-processor', () => ({ processWorkflowQueueBatch: vi.fn() }))
vi.mock('@/lib/process-queue', () => ({ kickQueueProcessor: vi.fn() }))
vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/github-sync/enqueue', () => ({ recordAssetChange: vi.fn(async () => {}) }))

import {
  hashWebhookSecret, isMissingSha256Column, resetWebhookSecretCacheForTests, sha256HexEqual,
  VERIFIED_CACHE_MAX_ENTRIES, VERIFIED_CACHE_TTL_MS, verifiedCacheSize, verifyWebhookSecret,
} from '@/lib/webhook-secret'
import { POST as inbound } from '@/app/api/webhooks/inbound/route'
import * as webhooks from '@/lib/services/webhooks'
import type { ServiceContext } from '@/lib/services/context'
import { createMemorySupabase } from './fixtures/supabase-memory'

const SECRET = 'a1b2c3d4'.repeat(8)
const OTHER = 'ffffffff'.repeat(8)
// Cost 4 keeps the legacy-path tests fast; the cost does not change the logic.
const LEGACY_HASH = bcrypt.hashSync(SECRET, 4)

let compareSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  resetWebhookSecretCacheForTests()
  timing.calls = 0
  pending.list = []
  compareSpy = vi.spyOn(bcrypt, 'compare')
})
afterEach(() => { compareSpy.mockRestore() })

describe('verifyWebhookSecret', () => {
  it('accepts the secret by SHA-256 without bcrypt', async () => {
    const row = { id: 'wh', api_key_hash: LEGACY_HASH, api_key_prefix: SECRET.slice(0, 8), api_key_sha256: hashWebhookSecret(SECRET) }
    expect(await verifyWebhookSecret(row, SECRET)).toEqual({ valid: true, via: 'sha256' })
    expect(compareSpy).not.toHaveBeenCalled()
  })

  it('rejects a wrong secret with a constant-time compare and no bcrypt', async () => {
    const row = { id: 'wh', api_key_hash: LEGACY_HASH, api_key_prefix: SECRET.slice(0, 8), api_key_sha256: hashWebhookSecret(SECRET) }
    // Same prefix, different tail; a different prefix; a short value: all go through timingSafeEqual.
    for (const wrong of [SECRET.slice(0, 8) + 'x'.repeat(56), OTHER, 'short']) {
      const before = timing.calls
      expect(await verifyWebhookSecret(row, wrong)).toEqual({ valid: false, via: 'sha256' })
      expect(timing.calls).toBe(before + 1)
    }
    expect(await verifyWebhookSecret(row, '')).toMatchObject({ valid: false })
    expect(compareSpy).not.toHaveBeenCalled()
  })

  it('sha256HexEqual refuses malformed digests', () => {
    const h = hashWebhookSecret(SECRET)
    expect(sha256HexEqual(h, h)).toBe(true)
    expect(sha256HexEqual(h, h.slice(1))).toBe(false)
    expect(sha256HexEqual(h, 'z'.repeat(64))).toBe(false)
    expect(sha256HexEqual(h, null as unknown as string)).toBe(false)
  })

  it('verifies a legacy row once by bcrypt, returns the upgrade hash, then hits the cache', async () => {
    const row = { id: 'wh', api_key_hash: LEGACY_HASH, api_key_prefix: SECRET.slice(0, 8) }
    expect(await verifyWebhookSecret(row, SECRET)).toEqual({ valid: true, via: 'bcrypt', upgradeSha256: hashWebhookSecret(SECRET) })
    expect(await verifyWebhookSecret(row, SECRET)).toEqual({ valid: true, via: 'cache', upgradeSha256: hashWebhookSecret(SECRET) })
    expect(compareSpy).toHaveBeenCalledTimes(1)
  })

  it('never caches failures, and a rotated bcrypt hash misses the cache', async () => {
    const row = { id: 'wh', api_key_hash: LEGACY_HASH, api_key_prefix: null }
    expect(await verifyWebhookSecret(row, OTHER)).toMatchObject({ valid: false })
    expect(await verifyWebhookSecret(row, OTHER)).toMatchObject({ valid: false })
    expect(compareSpy).toHaveBeenCalledTimes(2)
    expect(verifiedCacheSize()).toBe(0)

    expect(await verifyWebhookSecret(row, SECRET)).toMatchObject({ valid: true, via: 'bcrypt' })
    const rotated = { ...row, api_key_hash: bcrypt.hashSync(OTHER, 4) }
    expect(await verifyWebhookSecret(rotated, SECRET)).toMatchObject({ valid: false, via: 'bcrypt' })
  })

  it('skips bcrypt when the public prefix cannot match', async () => {
    const row = { id: 'wh', api_key_hash: LEGACY_HASH, api_key_prefix: SECRET.slice(0, 8) }
    expect(await verifyWebhookSecret(row, OTHER)).toEqual({ valid: false, via: 'none' })
    expect(compareSpy).not.toHaveBeenCalled()
  })

  it('expires cache entries after the TTL', async () => {
    const row = { id: 'wh', api_key_hash: LEGACY_HASH, api_key_prefix: null }
    await verifyWebhookSecret(row, SECRET, 1_000)
    expect((await verifyWebhookSecret(row, SECRET, 1_000 + VERIFIED_CACHE_TTL_MS - 1)).via).toBe('cache')
    expect((await verifyWebhookSecret(row, SECRET, 1_000 + 2 * VERIFIED_CACHE_TTL_MS)).via).toBe('bcrypt')
  })

  it('keeps the cache bounded, evicting the least recently used', async () => {
    const total = VERIFIED_CACHE_MAX_ENTRIES + 25
    for (let i = 0; i < total; i++) {
      await verifyWebhookSecret({ id: `wh-${i}`, api_key_hash: LEGACY_HASH, api_key_prefix: null }, SECRET)
    }
    expect(verifiedCacheSize()).toBe(VERIFIED_CACHE_MAX_ENTRIES)
    compareSpy.mockClear()
    expect((await verifyWebhookSecret({ id: 'wh-0', api_key_hash: LEGACY_HASH, api_key_prefix: null }, SECRET)).via).toBe('bcrypt')
    expect((await verifyWebhookSecret({ id: `wh-${total - 1}`, api_key_hash: LEGACY_HASH, api_key_prefix: null }, SECRET)).via).toBe('cache')
    expect(compareSpy).toHaveBeenCalledTimes(1)
  })

  it('recognises the missing-column errors', () => {
    expect(isMissingSha256Column({ code: '42703', message: 'column workflow_webhooks.api_key_sha256 does not exist' })).toBe(true)
    expect(isMissingSha256Column({ code: 'PGRST204', message: "Could not find the 'api_key_sha256' column" })).toBe(true)
    expect(isMissingSha256Column({ code: '23505', message: 'duplicate key' })).toBe(false)
    expect(isMissingSha256Column(null)).toBe(false)
  })
})

/* ── The inbound route and the service ─────────────────────────────────── */

function seedDb(row: Record<string, unknown>) {
  return createMemorySupabase({
    workflows: [{ id: 'wf-a', tenant_id: 'tenant-a', name: 'Intake' }],
    workflow_webhooks: [{ id: 'wh-a', tenant_id: 'tenant-a', workflow_id: 'wf-a', slug: 'orders-in', is_active: true, payload_mapping: [], receive_count: 0, created_at: '2026-01-01', ...row }],
  })
}

/** The memory fake with the api_key_sha256 column missing (migration not applied). */
function withoutSha256Column(db: ReturnType<typeof createMemorySupabase>) {
  const missing = { data: null, error: { code: '42703', message: 'column workflow_webhooks.api_key_sha256 does not exist' } }
  const fail = () => {
    const chain: Record<string, unknown> = {}
    for (const m of ['eq', 'neq', 'is', 'select', 'single', 'maybeSingle']) chain[m] = () => chain
    chain.then = (resolve: (v: unknown) => unknown) => resolve(missing)
    return chain
  }
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop !== 'from') return Reflect.get(target, prop, receiver)
      return (table: string) => {
        const builder = target.from(table) as unknown as Record<string, (...args: unknown[]) => unknown>
        return new Proxy(builder, {
          get(b, method) {
            const original = b[method as string]
            if (method === 'select') return (cols?: string, ...rest: unknown[]) => (String(cols ?? '').includes('api_key_sha256') ? fail() : original.call(b, cols, ...rest))
            if (method === 'insert' || method === 'update') return (payload: Record<string, unknown>, ...rest: unknown[]) => ('api_key_sha256' in payload ? fail() : original.call(b, payload, ...rest))
            return typeof original === 'function' ? original.bind(b) : original
          },
        })
      }
    },
  })
}

async function call(token: string) {
  const response = await inbound(new NextRequest('http://localhost/api/webhooks/inbound?hook=orders-in', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}',
  }))
  await Promise.all(pending.list)
  pending.list = []
  return response.status
}

function context(supabase: unknown): ServiceContext {
  return {
    supabase: supabase as ServiceContext['supabase'], tenantId: 'tenant-a', actorId: null, credentialOwnerId: 'owner-wh',
    permissions: new Set(['settings.manage_webhooks']), resourceScopes: { workflow_ids: [], table_ids: [] },
    authKind: 'api_key', source: 'api', keyType: 'tenant',
  }
}

describe('POST /api/webhooks/inbound', () => {
  it('upgrades a legacy bcrypt row on first use; later requests use no bcrypt', async () => {
    const db = seedDb({ api_key_hash: LEGACY_HASH, api_key_prefix: SECRET.slice(0, 8) })
    pending.db = db
    expect(await call(SECRET)).toBe(200)
    expect(compareSpy).toHaveBeenCalledTimes(1)
    expect(db.tables.workflow_webhooks[0].api_key_sha256).toBe(hashWebhookSecret(SECRET))
    expect(db.tables.workflow_webhooks[0].api_key_hash).toBe(LEGACY_HASH)

    resetWebhookSecretCacheForTests()
    expect(await call(SECRET)).toBe(200)
    expect(await call(SECRET.slice(0, 8) + '0'.repeat(56))).toBe(401)
    expect(compareSpy).toHaveBeenCalledTimes(1)
  })

  it('rejects a wrong secret on a legacy row and does not upgrade it', async () => {
    const db = seedDb({ api_key_hash: LEGACY_HASH, api_key_prefix: SECRET.slice(0, 8) })
    pending.db = db
    expect(await call(SECRET.slice(0, 8) + '0'.repeat(56))).toBe(401)
    expect(db.tables.workflow_webhooks[0].api_key_sha256).toBeUndefined()
  })

  it('created and rotated secrets verify by SHA-256; rotation retires the old secret', async () => {
    const db = createMemorySupabase({ workflows: [{ id: 'wf-a', tenant_id: 'tenant-a', name: 'Intake' }], workflow_webhooks: [] })
    pending.db = db
    const { webhook, secret } = await webhooks.createWorkflowWebhook(context(db), 'wf-a', { slug: 'orders-in' })
    const stored = db.tables.workflow_webhooks.find((w) => w.id === webhook.id)!
    expect(stored.api_key_sha256).toBe(hashWebhookSecret(secret))
    expect(JSON.stringify(webhook)).not.toContain(stored.api_key_sha256)
    compareSpy.mockClear()
    expect(await call(secret)).toBe(200)

    const rotated = await webhooks.rotateWebhookSecret(context(db), webhook.id)
    expect(await call(secret)).toBe(401)
    expect(await call(rotated.secret)).toBe(200)
    expect(compareSpy).not.toHaveBeenCalled()
  })

  it('works before the migration: bcrypt, then the cache; the service writes without the column', async () => {
    const db = seedDb({ api_key_hash: LEGACY_HASH, api_key_prefix: SECRET.slice(0, 8) })
    const legacy = withoutSha256Column(db)
    pending.db = legacy
    expect(await call(SECRET)).toBe(200)
    expect(await call(SECRET)).toBe(200)
    expect(compareSpy).toHaveBeenCalledTimes(1)
    expect(db.tables.workflow_webhooks[0].api_key_sha256).toBeUndefined()

    const rotated = await webhooks.rotateWebhookSecret(context(legacy), 'wh-a')
    expect(db.tables.workflow_webhooks[0].api_key_sha256).toBeUndefined()
    expect(await call(SECRET)).toBe(401)
    expect(await call(rotated.secret)).toBe(200)
  })
})
