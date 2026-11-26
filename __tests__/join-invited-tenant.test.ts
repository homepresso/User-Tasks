/**
 * joinInvitedTenant (/api/auth/verify-tenant, sign-in with ?org=): a
 * deactivated member must not restore their own access and invited role, and
 * only an unaccepted, unexpired invitation lets a non-member in.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/providers/db', () => ({ getServiceDb: () => { throw new Error('pass a service db') } }))

import { joinInvitedTenant } from '@/lib/providers/auth/provisioning'

type Row = Record<string, unknown>

/** Minimal in-memory PostgREST-ish fake: eq / is filters, single / maybeSingle / limit / order, insert, update. */
function fakeDb(tables: Record<string, Row[]>) {
  const writes: Array<{ table: string; op: string; values: Row }> = []
  function builder(table: string) {
    const filters: Array<(r: Row) => boolean> = []
    let op: 'select' | 'update' | 'insert' = 'select'
    let values: Row = {}
    const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)))
    const q: any = {
      select: () => q,
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q },
      is: (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return q },
      order: () => q,
      limit: () => q,
      update: (v: Row) => { op = 'update'; values = v; return q },
      insert: (v: Row) => { op = 'insert'; values = v; writes.push({ table, op, values: v }); (tables[table] ??= []).push(v); return q },
      single: async () => { const r = rows(); return r.length === 1 ? { data: r[0], error: null } : { data: null, error: { code: 'PGRST116' } } },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
        if (op === 'update') { for (const r of rows()) Object.assign(r, values); writes.push({ table, op, values }) }
        return Promise.resolve({ data: op === 'select' ? rows() : null, error: null }).then(res, rej)
      },
    }
    return q
  }
  return { db: { from: builder } as any, writes, tables }
}

const T = 'tenant-acme'
const U = 'user-bob'
const base = () => ({
  tenants: [{ id: T, name: 'Acme', slug: 'acme' }],
  roles: [{ id: 'role-admin', tenant_id: T, slug: 'admin', is_system: true }, { id: 'role-viewer', tenant_id: T, slug: 'viewer', is_system: true }],
  users: [{ id: U, email: 'bob@acme.test', tenant_id: T, current_tenant_id: T }],
  user_roles: [] as Row[],
  user_memberships: [] as Row[],
  invitations: [] as Row[],
})

describe('joinInvitedTenant', () => {
  it('refuses a deactivated member even with an accepted invitation and a stale home tenant', async () => {
    const t = base()
    t.user_memberships.push({ id: 'm1', user_id: U, tenant_id: T, is_active: false })
    t.invitations.push({ id: 'i1', email: 'bob@acme.test', tenant_id: T, role: 'admin', token: 'tok', accepted_at: '2026-01-01T00:00:00Z', expires_at: null })
    const { db, writes } = fakeDb(t)
    const res = await joinInvitedTenant({ id: U, email: 'bob@acme.test' }, 'acme', null, db)
    expect(res.ok).toBe(false)
    expect(res.status).toBe(403)
    expect(writes.filter((w) => w.table === 'user_roles')).toEqual([])
  })

  it('refuses a non-member whose only invitation is expired or accepted', async () => {
    const t = base()
    t.users[0].tenant_id = 'other'
    t.users[0].current_tenant_id = 'other'
    t.invitations.push(
      { id: 'i1', email: 'bob@acme.test', tenant_id: T, role: 'admin', accepted_at: null, expires_at: '2000-01-01T00:00:00Z' },
      { id: 'i2', email: 'bob@acme.test', tenant_id: T, role: 'admin', accepted_at: '2026-01-01T00:00:00Z', expires_at: null },
    )
    const { db } = fakeDb(t)
    expect((await joinInvitedTenant({ id: U, email: 'bob@acme.test' }, 'acme', null, db)).ok).toBe(false)
  })

  it('lets a deactivated member back in when they were invited again', async () => {
    const t = base()
    t.user_memberships.push({ id: 'm1', user_id: U, tenant_id: T, is_active: false })
    t.invitations.push({ id: 'i2', email: 'bob@acme.test', tenant_id: T, role: 'viewer', accepted_at: null, expires_at: '2999-01-01T00:00:00Z' })
    const { db } = fakeDb(t)
    expect((await joinInvitedTenant({ id: U, email: 'bob@acme.test' }, 'acme', null, db)).ok).toBe(true)
  })

  it('still lets an active member and a legacy home-tenant user (no membership row) in', async () => {
    const t = base()
    const { db } = fakeDb(t)
    expect((await joinInvitedTenant({ id: U, email: 'bob@acme.test' }, 'acme', null, db)).ok).toBe(true)
    const t2 = base()
    t2.users[0].tenant_id = 'other'
    t2.users[0].current_tenant_id = 'other'
    t2.user_memberships.push({ id: 'm1', user_id: U, tenant_id: T, is_active: true })
    expect((await joinInvitedTenant({ id: U, email: 'bob@acme.test' }, 'acme', null, fakeDb(t2).db)).ok).toBe(true)
  })
})

describe('invitation tokens never leave the server', () => {
  it('no API route exposes checkInvitation (it returns the invite token, which proves the address at sign-up)', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs')
    const { join } = await import('node:path')
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) walk(p)
        else if (/route\.tsx?$/.test(name) && /checkInvitation|inviteToken:\s*\w+\.inviteToken/.test(readFileSync(p, 'utf8'))) hits.push(p)
      }
    }
    walk(join(process.cwd(), 'app'))
    expect(hits).toEqual([])
  })
})
