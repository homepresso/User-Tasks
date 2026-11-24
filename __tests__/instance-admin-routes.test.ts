import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type FakeSupabase } from './helpers/fake-supabase'

/**
 * Every /api/v1/instance route answers 404 to anyone who is not an instance
 * admin — a workspace owner's user API key, a tenant-wide key — for every
 * method, before reading or writing anything.
 */

vi.mock('@/lib/api-auth', () => ({ validateApiKey: vi.fn() }))
vi.mock('@/lib/admin/infrastructure', () => ({ viewerCanSeeInfrastructure: vi.fn(async () => false) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(async () => ({ ok: true, remaining: 1, retryAfterMs: 0 })), resetRateLimit: vi.fn() }))
vi.mock('@/lib/services/instance-admin/auth-state', () => ({
  unlockAccount: vi.fn(), revokeSessions: vi.fn(), sendPasswordReset: vi.fn(), accountStates: vi.fn(async () => new Map()), lockedAccounts: vi.fn(async () => []), authKind: vi.fn(async () => 'builtin'),
}))
vi.mock('@/lib/providers/db', () => ({ getServiceDb: () => { throw new Error('injected') } }))

import { NextRequest } from 'next/server'
import { validateApiKey } from '@/lib/api-auth'
import { setInstanceAdminCheckForTests, setInstanceServiceDbForTests } from '@/lib/services/instance-admin/access'

const OWNER = '22222222-2222-4222-8222-222222222222'
const ACME = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddd01'

const ROOT = join(process.cwd(), 'app/api/v1/instance')
function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? routeFiles(p) : name === 'route.ts' ? [p] : []
  })
}

let fake: FakeSupabase
beforeEach(() => {
  fake = createFakeSupabase({ users: [{ id: OWNER, email: 'owner@acme.example', deleted_at: null }], tenants: [{ id: ACME, name: 'Acme', slug: 'acme', deleted_at: null }] })
  setInstanceServiceDbForTests(() => fake.client as never)
  setInstanceAdminCheckForTests(async (v) => v.email === 'ops@cloud.example')
})

const files = routeFiles(ROOT)

describe('/api/v1/instance refuses non-admins', () => {
  it('has the routes', () => expect(files.length).toBeGreaterThanOrEqual(28))

  for (const keyType of ['user', 'tenant'] as const) {
    it.each(files.map((f) => relative(ROOT, f)))(`%s → 404 for a workspace owner's ${keyType} key`, async (rel) => {
      vi.mocked(validateApiKey).mockResolvedValue({
        success: true, supabase: fake.client, tenantId: ACME, actingUserId: keyType === 'user' ? OWNER : null, createdBy: OWNER,
        permissions: ['settings.view', 'team.invite', 'team.change_roles'], keyType, authKind: 'api_key', keyId: 'k1',
      } as never)
      const mod = await import(join(ROOT, rel))
      const path = rel.replace(/\/route\.ts$/, '').replace(/\[[a-z_]+\]/g, (m) => (m === '[extension_id]' ? 'sharepoint' : ID))
      const params = Object.fromEntries([...rel.matchAll(/\[([a-z_]+)\]/g)].map((m) => [m[1], m[1] === 'extension_id' ? 'sharepoint' : ID]))
      for (const method of ['GET', 'POST'] as const) {
        if (!mod[method]) continue
        const req = new NextRequest(`http://localhost/api/v1/instance/${path}`, {
          method, headers: { authorization: 'Bearer ut_test', 'content-type': 'application/json' },
          ...(method === 'POST' ? { body: JSON.stringify({ reason: 'Testing refusal', workspace_id: ACME, email: 'x@acme.example', role: 'admin', days: 5 }) } : {}),
        })
        const res = await mod[method](req, { params: Promise.resolve(params) })
        expect(res.status, `${method} ${path}`).toBe(404)
        const body = await res.json()
        expect(body.success).toBe(false)
      }
      expect(fake.calls.filter((c) => c.op !== 'select')).toEqual([])
    })
  }
})
