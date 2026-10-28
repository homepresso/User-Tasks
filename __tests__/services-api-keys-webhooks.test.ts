import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'

vi.mock('@/lib/api-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-auth')>()
  return { ...actual, validateApiKey: vi.fn() }
})
vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/github-sync/enqueue', () => ({ recordAssetChange: vi.fn(async () => {}) }))

import { validateApiKey, type ApiKeySuccessResult } from '@/lib/api-auth'
import { writeAudit } from '@/lib/audit-log'
import { PERMISSION_KEYS } from '@/lib/permissions'
import type { ServiceContext } from '@/lib/services/context'
import * as apiKeys from '@/lib/services/api-keys'
import * as webhooks from '@/lib/services/webhooks'
import { GET as listKeysRoute, POST as createKeyRoute } from '@/app/api/v1/api-keys/route'
import { POST as rotateRoute } from '@/app/api/v1/webhooks/[id]/rotate/route'
import { POST as createWebhookRoute } from '@/app/api/v1/workflows/[id]/webhooks/route'
import { createMemorySupabase } from './fixtures/supabase-memory'

const page = { limit: 50, offset: 0 }
let caller = 0

/** Each context is a distinct caller so the per-caller creation rate limit doesn't leak across tests. */
function context(supabase: ReturnType<typeof createMemorySupabase>, permissions: readonly string[], extra: Partial<ServiceContext> = {}): ServiceContext {
  return {
    supabase: supabase as unknown as ServiceContext['supabase'],
    tenantId: 'tenant-a',
    actorId: null,
    credentialOwnerId: `owner-${++caller}`,
    permissions: new Set(permissions),
    resourceScopes: { workflow_ids: [], table_ids: [] },
    authKind: 'api_key',
    source: 'api',
    keyType: 'tenant',
    ...extra,
  }
}

const MANAGER = ['settings.manage_api_keys', 'workflows.view', 'tasks.view_all']

function seed() {
  return createMemorySupabase({
    api_keys: [
      { id: 'key-a', tenant_id: 'tenant-a', name: 'CI', key_prefix: 'ut_abcde', key_hash: 'HASH', key_type: 'tenant', permissions: null, scopes: {}, is_revoked: false, expires_at: null, created_at: '2026-01-01' },
      { id: 'key-b', tenant_id: 'tenant-b', name: 'Foreign', key_prefix: 'ut_zzzzz', key_hash: 'HASH', key_type: 'tenant', permissions: null, scopes: {}, is_revoked: false, expires_at: null, created_at: '2026-01-01' },
    ],
    users: [
      { id: 'user-1', tenant_id: 'tenant-a', display_name: 'Ada' },
      { id: 'user-2', tenant_id: 'tenant-a', display_name: 'Bob' },
      { id: 'user-b', tenant_id: 'tenant-b', display_name: 'Eve' },
    ],
    roles: [{ id: 'role-viewer', tenant_id: 'tenant-a', permissions: ['workflows.view', 'tasks.view_all'] }],
    user_roles: [{ id: 'ur-1', tenant_id: 'tenant-a', user_id: 'user-2', role_id: 'role-viewer' }],
    workflows: [
      { id: 'wf-a', tenant_id: 'tenant-a', name: 'Intake' },
      { id: 'wf-b', tenant_id: 'tenant-b', name: 'Foreign' },
    ],
    workflow_webhooks: [
      { id: 'wh-a', tenant_id: 'tenant-a', workflow_id: 'wf-a', slug: 'wh-intake', api_key_hash: 'OLD', api_key_prefix: 'oldoldol', is_active: true, payload_mapping: [], created_at: '2026-01-01' },
      { id: 'wh-b', tenant_id: 'tenant-b', workflow_id: 'wf-b', slug: 'wh-foreign', api_key_hash: 'OLD', api_key_prefix: 'oldoldol', is_active: true, payload_mapping: [], created_at: '2026-01-01' },
    ],
  })
}

beforeEach(() => vi.mocked(writeAudit).mockClear())

describe('api keys: permission and listing', () => {
  it.each([
    ['list', (ctx: ServiceContext) => apiKeys.listApiKeys(ctx, {}, page)],
    ['create', (ctx: ServiceContext) => apiKeys.createApiKey(ctx, { name: 'x' })],
    ['revoke', (ctx: ServiceContext) => apiKeys.revokeApiKey(ctx, 'key-a')],
    ['delete', (ctx: ServiceContext) => apiKeys.deleteApiKey(ctx, 'key-a')],
  ])('%s needs settings.manage_api_keys', async (_name, call) => {
    const supabase = seed()
    await expect(call(context(supabase, ['workflows.view']))).rejects.toMatchObject({ status: 403 })
    expect(supabase.calls).toEqual([])
  })

  it('lists tenant keys without hashes', async () => {
    const { api_keys: rows } = await apiKeys.listApiKeys(context(seed(), MANAGER), {}, page)
    expect(rows.map((r) => r.id)).toEqual(['key-a'])
    expect(JSON.stringify(rows)).not.toContain('HASH')
    expect(rows[0].status).toBe('active')
  })

  it('revoke and delete stay inside the tenant and are audited', async () => {
    const supabase = seed()
    const ctx = context(supabase, MANAGER)
    await expect(apiKeys.revokeApiKey(ctx, 'key-b')).rejects.toMatchObject({ status: 404 })
    await expect(apiKeys.deleteApiKey(ctx, 'key-b')).rejects.toMatchObject({ status: 404 })
    await apiKeys.revokeApiKey(ctx, 'key-a')
    expect(supabase.tables.api_keys.find((k) => k.id === 'key-a')?.is_revoked).toBe(true)
    await apiKeys.deleteApiKey(ctx, 'key-a')
    expect(supabase.tables.api_keys.map((k) => k.id)).toEqual(['key-b'])
    expect(vi.mocked(writeAudit).mock.calls.map(([e]) => e.action)).toEqual(['revoke', 'delete'])
  })
})

describe('api keys: creation caps', () => {
  it('returns the plaintext key once, storing only a bcrypt hash', async () => {
    const supabase = seed()
    const { api_key, key } = await apiKeys.createApiKey(context(supabase, MANAGER), { name: 'Deploy', permissions: ['workflows.view'], expires_in_days: 30 })
    expect(key).toMatch(/^ut_[0-9a-f]{64}$/)
    const stored = supabase.tables.api_keys.find((k) => k.id === api_key.id)!
    expect(stored.key_prefix).toBe(key.slice(0, 8))
    expect(await bcrypt.compare(key, stored.key_hash)).toBe(true)
    expect(JSON.stringify(api_key)).not.toContain(key)
    expect(JSON.stringify(api_key)).not.toContain(stored.key_hash)
    expect(stored.permissions).toEqual(['workflows.view'])
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ objectType: 'api_key', action: 'create' }))
    // Nothing that lists keys can recover it afterwards.
    const { api_keys: rows } = await apiKeys.listApiKeys(context(supabase, MANAGER), {}, page)
    expect(JSON.stringify(rows)).not.toContain(key)
  })

  it('refuses permissions the caller lacks (superset escalation)', async () => {
    const supabase = seed()
    await expect(apiKeys.createApiKey(context(supabase, MANAGER), { name: 'x', permissions: ['workflows.view', 'workflows.delete'] }))
      .rejects.toMatchObject({ status: 403, message: expect.stringContaining('workflows.delete') })
    await expect(apiKeys.createApiKey(context(supabase, MANAGER), { name: 'x', permissions: ['root.everything'] }))
      .rejects.toMatchObject({ status: 400 })
    expect(supabase.tables.api_keys).toHaveLength(2)
  })

  it('a non-admin caller that omits permissions gets exactly its own, never a legacy full key', async () => {
    const supabase = seed()
    const { api_key } = await apiKeys.createApiKey(context(supabase, MANAGER), { name: 'inherit' })
    expect(supabase.tables.api_keys.find((k) => k.id === api_key.id)?.permissions).toEqual(MANAGER)
  })

  it('a full-admin tenant caller still mints a legacy full key when no list is given', async () => {
    const supabase = seed()
    const { api_key } = await apiKeys.createApiKey(context(supabase, PERMISSION_KEYS), { name: 'admin' })
    expect(supabase.tables.api_keys.find((k) => k.id === api_key.id)?.permissions).toBeNull()
  })

  it('caps resource scopes to a scoped caller (superset refused, omitted inherits)', async () => {
    const supabase = seed()
    const scoped = () => context(supabase, MANAGER, { resourceScopes: { workflow_ids: ['wf-a'], table_ids: [] } })
    await expect(apiKeys.createApiKey(scoped(), { name: 'x', workflow_ids: ['wf-a', 'wf-other'] }))
      .rejects.toMatchObject({ status: 403, message: expect.stringContaining('wf-other') })
    const { api_key } = await apiKeys.createApiKey(scoped(), { name: 'inherit' })
    expect(supabase.tables.api_keys.find((k) => k.id === api_key.id)?.scopes).toEqual({ workflow_ids: ['wf-a'], table_ids: [] })
  })

  it('user-context callers cannot mint tenant keys or keys for other users', async () => {
    const supabase = seed()
    const asUser = () => context(supabase, MANAGER, { keyType: 'user', actorId: 'user-2' })
    await expect(apiKeys.createApiKey(asUser(), { name: 'x', key_type: 'tenant' })).rejects.toMatchObject({ status: 403 })
    await expect(apiKeys.createApiKey(asUser(), { name: 'x', key_type: 'user', user_id: 'user-1' })).rejects.toMatchObject({ status: 403 })
    const { api_key } = await apiKeys.createApiKey(asUser(), { name: 'mine' })
    const stored = supabase.tables.api_keys.find((k) => k.id === api_key.id)!
    expect(stored).toMatchObject({ key_type: 'user', user_id: 'user-2' })
    // Inherited permissions are the caller's AND the bound user's (settings.manage_api_keys is not a role permission of user-2).
    expect(stored.permissions).toEqual(['workflows.view', 'tasks.view_all'])
  })

  it('user keys made by a tenant admin stay within the bound user and the tenant', async () => {
    const supabase = seed()
    await expect(apiKeys.createApiKey(context(supabase, PERMISSION_KEYS), { name: 'x', key_type: 'user', user_id: 'user-2', permissions: ['workflows.delete'] }))
      .rejects.toMatchObject({ status: 403 })
    await expect(apiKeys.createApiKey(context(supabase, PERMISSION_KEYS), { name: 'x', key_type: 'user', user_id: 'user-b' }))
      .rejects.toMatchObject({ status: 400 })
    await expect(apiKeys.createApiKey(context(supabase, PERMISSION_KEYS), { name: 'x', key_type: 'user' }))
      .rejects.toMatchObject({ status: 400 })
  })

  describe('OAuth callers', () => {
    const oauth = (supabase: ReturnType<typeof createMemorySupabase>, scopes: string[]) =>
      context(supabase, MANAGER, { authKind: 'oauth', keyType: 'user', actorId: 'user-2', oauthScopes: scopes })

    it('need keys:write (403 insufficient_scope naming the granted scopes) for every key change', async () => {
      const supabase = seed()
      const ctx = oauth(supabase, ['admin'])
      for (const call of [
        () => apiKeys.createApiKey(ctx, { name: 'x', expires_in_days: 30 }),
        () => apiKeys.revokeApiKey(ctx, 'key-a'),
        () => apiKeys.deleteApiKey(ctx, 'key-a'),
      ]) {
        await expect(call()).rejects.toMatchObject({
          status: 403, code: 'insufficient_scope', details: { required_scope: 'keys:write', granted_scopes: ['admin'] },
        })
      }
      expect(supabase.tables.api_keys).toHaveLength(2)
      expect(supabase.tables.api_keys[0].is_revoked).toBe(false)
    })

    it('must set an expiry of at most 90 days', async () => {
      const supabase = seed()
      await expect(apiKeys.createApiKey(oauth(supabase, ['keys:write']), { name: 'x' })).rejects.toMatchObject({ status: 400 })
      await expect(apiKeys.createApiKey(oauth(supabase, ['keys:write']), { name: 'x', expires_in_days: 91 })).rejects.toMatchObject({ status: 400 })
      const before = Date.now()
      const { api_key } = await apiKeys.createApiKey(oauth(supabase, ['keys:write']), { name: 'ok', expires_in_days: 90 })
      const expires = new Date(api_key.expires_at!).getTime()
      expect(expires - before).toBeGreaterThan(89 * 86_400_000)
      expect(expires - before).toBeLessThanOrEqual(90 * 86_400_000 + 5_000)
    })
  })

  it('rate-limits creation per caller', async () => {
    const supabase = seed()
    const ctx = context(supabase, MANAGER)
    for (let i = 0; i < apiKeys.API_KEY_LIMITS.perCallerPerHour; i++) await apiKeys.createApiKey(ctx, { name: `k${i}`, expires_in_days: 1 })
    await expect(apiKeys.createApiKey(ctx, { name: 'one too many' })).rejects.toMatchObject({ status: 429, code: 'rate_limited' })
  })
})

describe('webhooks', () => {
  const PERM = ['settings.manage_webhooks']

  it.each([
    ['list', (ctx: ServiceContext) => webhooks.listWorkflowWebhooks(ctx, 'wf-a')],
    ['create', (ctx: ServiceContext) => webhooks.createWorkflowWebhook(ctx, 'wf-a')],
    ['delete', (ctx: ServiceContext) => webhooks.deleteWebhook(ctx, 'wh-a')],
    ['rotate', (ctx: ServiceContext) => webhooks.rotateWebhookSecret(ctx, 'wh-a')],
  ])('%s needs settings.manage_webhooks', async (_name, call) => {
    const supabase = seed()
    await expect(call(context(supabase, ['workflows.edit']))).rejects.toMatchObject({ status: 403 })
    expect(supabase.calls).toEqual([])
  })

  it('creates a webhook whose secret is returned once and verifies against the stored hash', async () => {
    const supabase = seed()
    const { webhook, secret } = await webhooks.createWorkflowWebhook(context(supabase, PERM), 'wf-a', { slug: 'orders-in' })
    expect(webhook.url).toContain('/api/webhooks/inbound?hook=orders-in')
    const stored = supabase.tables.workflow_webhooks.find((w) => w.id === webhook.id)!
    expect(stored).toMatchObject({ tenant_id: 'tenant-a', workflow_id: 'wf-a', api_key_prefix: secret.slice(0, 8) })
    expect(await bcrypt.compare(secret, stored.api_key_hash)).toBe(true)
    const { webhooks: rows } = await webhooks.listWorkflowWebhooks(context(supabase, PERM), 'wf-a')
    expect(JSON.stringify(rows)).not.toContain(secret)
    expect(JSON.stringify(rows)).not.toContain(stored.api_key_hash)
  })

  it('rotate replaces the secret (old one stops verifying) and shows the new one once', async () => {
    const supabase = seed()
    const ctx = context(supabase, PERM)
    const first = await webhooks.rotateWebhookSecret(ctx, 'wh-a')
    const second = await webhooks.rotateWebhookSecret(ctx, 'wh-a')
    expect(first.secret).not.toBe(second.secret)
    const stored = supabase.tables.workflow_webhooks.find((w) => w.id === 'wh-a')!
    expect(await bcrypt.compare(second.secret, stored.api_key_hash)).toBe(true)
    expect(await bcrypt.compare(first.secret, stored.api_key_hash)).toBe(false)
    expect(JSON.stringify(second.webhook)).not.toContain(second.secret)
  })

  it('stays inside the tenant and rejects taken or malformed slugs', async () => {
    const supabase = seed()
    const ctx = context(supabase, PERM)
    await expect(webhooks.createWorkflowWebhook(ctx, 'wf-b')).rejects.toMatchObject({ status: 404 })
    await expect(webhooks.rotateWebhookSecret(ctx, 'wh-b')).rejects.toMatchObject({ status: 404 })
    await expect(webhooks.deleteWebhook(ctx, 'wh-b')).rejects.toMatchObject({ status: 404 })
    await expect(webhooks.createWorkflowWebhook(ctx, 'wf-a', { slug: 'wh-foreign' })).rejects.toMatchObject({ status: 409 })
    await expect(webhooks.createWorkflowWebhook(ctx, 'wf-a', { slug: 'a b' })).rejects.toMatchObject({ status: 400 })
    await webhooks.deleteWebhook(ctx, 'wh-a')
    expect(supabase.tables.workflow_webhooks.map((w) => w.id)).toEqual(['wh-b'])
  })
})

describe('routes', () => {
  function authAs(supabase: ReturnType<typeof createMemorySupabase>, permissions: string[], extra: Partial<ApiKeySuccessResult> = {}) {
    vi.mocked(validateApiKey).mockResolvedValue({
      success: true, tenantId: 'tenant-a', keyId: 'k', keyType: 'tenant', createdBy: `route-owner-${++caller}`, actingUserId: null,
      scopes: { workflow_ids: [], table_ids: [] }, permissions,
      supabase: supabase as unknown as ApiKeySuccessResult['supabase'], authKind: 'api_key', expiresAt: null, ...extra,
    })
  }
  const req = (path: string, method = 'GET', body?: unknown) => new NextRequest(`https://app.test/api/v1${path}`, {
    method, headers: { authorization: 'Bearer ut_test', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const params = (p: Record<string, string>) => ({ params: Promise.resolve(p) })

  it('POST /api-keys: 403 without the permission, 201 with the key, insufficient_scope for OAuth without keys:write', async () => {
    const supabase = seed()
    authAs(supabase, ['workflows.view'])
    expect((await createKeyRoute(req('/api-keys', 'POST', { name: 'x' }))).status).toBe(403)

    authAs(supabase, MANAGER)
    const created = await createKeyRoute(req('/api-keys', 'POST', { name: 'x', permissions: ['workflows.view'] }))
    expect(created.status).toBe(201)
    expect((await created.json()).data.key).toMatch(/^ut_/)

    authAs(supabase, MANAGER, { authKind: 'oauth', keyType: 'user', actingUserId: 'user-2', oauthScopes: ['workflows:read'] })
    const denied = await createKeyRoute(req('/api-keys', 'POST', { name: 'x', expires_in_days: 30 }))
    expect(denied.status).toBe(403)
    expect(await denied.json()).toMatchObject({ code: 'insufficient_scope', details: { required_scope: 'keys:write', granted_scopes: ['workflows:read'] } })

    authAs(supabase, MANAGER)
    const list = await (await listKeysRoute(req('/api-keys'))).json()
    expect(JSON.stringify(list)).not.toContain('HASH')
  })

  it('webhook routes: 403 without settings.manage_webhooks; create/rotate return the secret', async () => {
    const supabase = seed()
    authAs(supabase, ['workflows.edit'])
    expect((await createWebhookRoute(req('/workflows/wf-a/webhooks', 'POST', {}), params({ id: 'wf-a' }))).status).toBe(403)
    authAs(supabase, ['settings.manage_webhooks'])
    const created = await createWebhookRoute(req('/workflows/wf-a/webhooks', 'POST', {}), params({ id: 'wf-a' }))
    expect(created.status).toBe(201)
    expect((await created.json()).data.secret).toMatch(/^[0-9a-f]{64}$/)
    const rotated = await rotateRoute(req('/webhooks/wh-a/rotate', 'POST'), params({ id: 'wh-a' }))
    expect((await rotated.json()).data.secret).toMatch(/^[0-9a-f]{64}$/)
  })
})
