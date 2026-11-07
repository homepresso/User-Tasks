/**
 * #5 POST / GET /api/v1/admin/workspaces (instance admin API):
 *  - off (404) unless INSTANCE_ADMIN_TOKEN is set (32+ characters);
 *  - only that token: none → 401, a workspace API key or any other token → 403;
 *    failed attempts rate limited per IP (429);
 *  - creates the workspace with its owner (an existing user is added as owner;
 *    an unknown email gets a new account), audited;
 *  - idempotent on slug (200, created: false, unchanged; a key only when asked);
 *  - the first API key is minted once and returned once;
 *  - slugs follow the workspace address rules.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rate-limit')>()
  return { ...actual, rateLimit: async (key: string, opts: { max: number; windowMs: number }) => actual.checkRateLimit(key, opts) }
})

import { POST } from '@/app/api/v1/admin/workspaces/route'
import { GET } from '@/app/api/v1/admin/workspaces/[slug]/route'
import { instanceWorkspaceDeps, workspaceSlugProblem } from '@/lib/services/instance-workspaces'
import { createFakeSupabase, type FakeSupabase } from './helpers/fake-supabase'

const TOKEN = 'i'.repeat(48)
const EXISTING_USER = '0f000000-0000-4000-8000-0000000000e1'
let fake: FakeSupabase
let createdUsers: Array<{ email: string; password: string }>
let ipCounter = 0
let ip: string
const savedToken = process.env.INSTANCE_ADMIN_TOKEN

beforeEach(() => {
  process.env.INSTANCE_ADMIN_TOKEN = TOKEN
  ip = `203.0.113.${++ipCounter}`
  fake = createFakeSupabase({
    tenants: [
      { id: 'home-tenant', slug: 'home', name: 'Home', deleted_at: null },
      { id: 'gone-tenant', slug: 'gone-co', name: 'Gone', deleted_at: '2026-01-01T00:00:00Z' },
    ],
    users: [{ id: EXISTING_USER, email: 'ada@example.com', tenant_id: 'home-tenant', current_tenant_id: 'home-tenant' }],
  })
  createdUsers = []
  instanceWorkspaceDeps.db = async () => fake.client as never
  instanceWorkspaceDeps.authAdmin = async () => ({
    createUser: async ({ email, password }: { email: string; password: string }) => {
      createdUsers.push({ email, password })
      return { id: `0f000000-0000-4000-8000-00000000010${createdUsers.length}` }
    },
    deleteUser: async () => {},
  }) as never
})
afterEach(() => {
  if (savedToken === undefined) delete process.env.INSTANCE_ADMIN_TOKEN
  else process.env.INSTANCE_ADMIN_TOKEN = savedToken
})

function post(body: unknown, auth: string | null = `Bearer ${TOKEN}`) {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-forwarded-for': ip }
  if (auth) headers.authorization = auth
  return POST(new NextRequest('http://localhost/api/v1/admin/workspaces', { method: 'POST', headers, body: JSON.stringify(body) }))
}
function get(slug: string, auth: string | null = `Bearer ${TOKEN}`) {
  const headers: Record<string, string> = { 'x-forwarded-for': ip }
  if (auth) headers.authorization = auth
  return GET(new NextRequest(`http://localhost/api/v1/admin/workspaces/${slug}`, { headers }), { params: Promise.resolve({ slug }) })
}

const BODY = { slug: 'acme', name: 'Acme Inc', owner_email: 'Ada@Example.com' }

describe('auth', () => {
  it('is off (404) without INSTANCE_ADMIN_TOKEN, even with a bearer token', async () => {
    delete process.env.INSTANCE_ADMIN_TOKEN
    expect((await post(BODY)).status).toBe(404)
    expect((await get('home')).status).toBe(404)
    expect(fake.tables.tenants).toHaveLength(2)
  })

  it('stays off with a token shorter than 32 characters', async () => {
    process.env.INSTANCE_ADMIN_TOKEN = 'short-token'
    expect((await post(BODY, 'Bearer short-token')).status).toBe(404)
  })

  it('401 without a bearer token; 403 for a workspace API key, an OAuth token or a wrong token', async () => {
    expect((await post(BODY, null)).status).toBe(401)
    for (const credential of [`ut_${'a'.repeat(64)}`, 'uoa_something', TOKEN.slice(1), `${TOKEN}x`]) {
      const res = await post(BODY, `Bearer ${credential}`)
      expect(res.status, credential).toBe(403)
      expect((await res.json()).code).toBe('forbidden')
    }
    expect(fake.tables.tenants).toHaveLength(2)
  })

  it('rate limits failed attempts per IP', async () => {
    const statuses: number[] = []
    for (let i = 0; i < 12; i++) statuses.push((await post(BODY, 'Bearer wrong')).status)
    expect(statuses.slice(0, 10).every((s) => s === 403)).toBe(true)
    expect(statuses[11]).toBe(429)
  })
})

describe('create', () => {
  it('creates the workspace and adds an existing user as owner (home workspace unchanged), audited', async () => {
    const res = await post(BODY)
    expect(res.status).toBe(201)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const { data } = await res.json()
    expect(data.created).toBe(true)
    expect(data.workspace).toMatchObject({ slug: 'acme', name: 'Acme Inc' })
    expect(data.owner).toEqual({ id: EXISTING_USER, email: 'ada@example.com', created: false })
    expect(data.key).toBeUndefined()
    expect(createdUsers).toEqual([])

    const tenantId = data.workspace.id
    const ownerRole = fake.tables.roles.find((r) => r.tenant_id === tenantId && r.slug === 'owner')!
    expect(fake.tables.user_roles).toEqual([expect.objectContaining({ tenant_id: tenantId, user_id: EXISTING_USER, role_id: ownerRole.id })])
    expect(fake.tables.user_memberships).toEqual([expect.objectContaining({ tenant_id: tenantId, user_id: EXISTING_USER, is_active: true })])
    expect(fake.tables.users[0]).toMatchObject({ tenant_id: 'home-tenant', current_tenant_id: 'home-tenant' })
    expect(fake.tables.object_audit_log).toEqual([expect.objectContaining({ tenant_id: tenantId, object_type: 'workspace', action: 'create', actor_id: null })])
    expect(fake.tables.object_audit_log[0].metadata).toMatchObject({ via: 'instance_admin_api', ip })
  })

  it('is idempotent on slug: 200, created false, nothing changed, no key unless asked', async () => {
    const first = await (await post(BODY)).json()
    const tenants = fake.tables.tenants.length
    const again = await post({ ...BODY, name: 'Renamed', owner_email: 'someone-else@example.com' })
    expect(again.status).toBe(200)
    const { data } = await again.json()
    expect(data).toMatchObject({ created: false, owner: null, workspace: { id: first.data.workspace.id, name: 'Acme Inc' } })
    expect(data.key).toBeUndefined()
    expect(fake.tables.tenants).toHaveLength(tenants)
    expect(createdUsers).toEqual([])
  })

  it('mints the first API key once (returned once); a repeat mints only when asked again', async () => {
    const res = await post({ ...BODY, create_api_key: true, api_key_name: 'LeForge' })
    const { data } = await res.json()
    expect(data.key).toMatch(/^ut_[0-9a-f]{64}$/)
    expect(data.api_key).toMatchObject({ name: 'LeForge', key_type: 'tenant' })
    expect(JSON.stringify(data.api_key)).not.toContain(data.key)
    expect(fake.tables.api_keys).toHaveLength(1)
    expect(fake.tables.api_keys[0]).toMatchObject({ tenant_id: data.workspace.id, permissions: null, created_by: EXISTING_USER })
    expect(fake.tables.api_keys[0].key_hash).not.toBe(data.key)

    const repeat = await (await post(BODY)).json()
    expect(repeat.data.key).toBeUndefined()
    expect(fake.tables.api_keys).toHaveLength(1)

    const asked = await (await post({ ...BODY, create_api_key: true, api_key_permissions: ['tasks.view_own'] })).json()
    expect(asked.data.created).toBe(false)
    expect(asked.data.key).toMatch(/^ut_/)
    expect(fake.tables.api_keys).toHaveLength(2)
    expect(fake.tables.api_keys[1].permissions).toEqual(['tasks.view_own'])
  })

  it('creates an account for an unknown owner email (random password unless one is given)', async () => {
    const res = await post({ slug: 'globex', name: 'Globex', owner_email: 'hank@globex.example' })
    expect(res.status).toBe(201)
    const { data } = await res.json()
    expect(data.owner).toMatchObject({ email: 'hank@globex.example', created: true })
    expect(createdUsers).toHaveLength(1)
    expect(createdUsers[0].password.length).toBeGreaterThanOrEqual(32)
    expect(fake.tables.users.find((u) => u.id === data.owner.id)).toMatchObject({ tenant_id: data.workspace.id, role: 'owner' })

    await post({ slug: 'initech', name: 'Initech', owner_email: 'bill@initech.example', owner_password: 'correct horse battery' })
    expect(createdUsers[1]).toEqual({ email: 'bill@initech.example', password: 'correct horse battery' })
  })

  it('validates the slug (workspace address rules), the name, the email and key permissions', async () => {
    for (const slug of ['Acme', 'ab', 'admin', 'api', '-acme', 'ac--me', 'personal-1234abcd', 'a'.repeat(41)]) {
      const res = await post({ ...BODY, slug })
      expect(res.status, slug).toBe(400)
    }
    expect((await post({ ...BODY, owner_email: 'not-an-email' })).status).toBe(400)
    expect((await post({ ...BODY, name: '' })).status).toBe(400)
    expect((await post({ ...BODY, create_api_key: true, api_key_permissions: ['nope.perm'] })).status).toBe(400)
    expect(fake.tables.tenants).toHaveLength(2)
    expect(workspaceSlugProblem('acme-corp')).toBeNull()
  })

  it('409 for the slug of a deleted workspace', async () => {
    const res = await post({ ...BODY, slug: 'gone-co' })
    expect(res.status).toBe(409)
  })
})

describe('get', () => {
  it('returns a live workspace by slug; 404 for unknown or deleted', async () => {
    const res = await get('home')
    expect(res.status).toBe(200)
    expect((await res.json()).data.workspace).toMatchObject({ id: 'home-tenant', slug: 'home', name: 'Home' })
    expect((await get('missing')).status).toBe(404)
    expect((await get('gone-co')).status).toBe(404)
    expect((await get('home', `Bearer ut_${'b'.repeat(64)}`)).status).toBe(403)
  })
})
