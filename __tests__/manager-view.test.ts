/**
 * Reporting lines and the manager view (lib/services/manager-tasks.ts),
 * GET /api/v1/tasks?scope=reports, the users/{id}/manager endpoints, and
 * directory sync's manager mapping (lib/directory-sync/managers.ts + the
 * provider clients).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/github-sync/enqueue', () => ({ recordAssetChange: vi.fn(async () => {}) }))
vi.mock('@/lib/api-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-auth')>()
  return { ...actual, validateApiKey: vi.fn() }
})

import { NextRequest } from 'next/server'
import { validateApiKey, type ApiKeySuccessResult } from '@/lib/api-auth'
import { isManager, listReportTasks, listReportsOf, reassignReportTask, setManager, getReportingLine } from '@/lib/services/manager-tasks'
import type { ServiceContext } from '@/lib/services/context'
import { GET as listTasks } from '@/app/api/v1/tasks/route'
import { GET as getManager, PUT as putManager } from '@/app/api/v1/users/[id]/manager/route'
import { planManagerChanges, syncDirectoryManagers } from '@/lib/directory-sync/managers'
import { createEntraClient } from '@/lib/directory-sync/entra'
import { createOktaClient } from '@/lib/directory-sync/okta'
import { createMemorySupabase } from './fixtures/supabase-memory'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */

const FUTURE = new Date(Date.now() + 3 * 86400_000).toISOString()
const PAST = new Date(Date.now() - 86400_000).toISOString()

let db: ReturnType<typeof createMemorySupabase>
function seed() {
  const t = { tenant_id: 'ta', deleted_at: null, is_workflow_task: false, priority: 'medium', created_at: '2026-10-01T00:00:00Z' }
  return createMemorySupabase({
    user_memberships: [
      { tenant_id: 'ta', user_id: 'carl', manager_user_id: null, is_active: true },
      { tenant_id: 'ta', user_id: 'mia', manager_user_id: 'carl', is_active: true },
      { tenant_id: 'ta', user_id: 'alice', manager_user_id: 'mia', is_active: true },
      { tenant_id: 'ta', user_id: 'ben', manager_user_id: 'mia', is_active: true },
      { tenant_id: 'ta', user_id: 'bob', manager_user_id: null, is_active: true },
    ],
    users: ['carl', 'mia', 'alice', 'ben', 'bob'].map((id) => ({ id, display_name: id[0].toUpperCase() + id.slice(1), email: `${id}@example.test` })),
    tasks: [
      { ...t, id: 'a1', title: 'Alice overdue', status: 'todo', assignee_id: 'alice', due_date: PAST },
      { ...t, id: 'a2', title: 'Alice soon', status: 'in_progress', assignee_id: 'alice', due_date: FUTURE, priority: 'high', is_workflow_task: true, event_id: 'evt-a2', workflow_id: 'wf-1', allow_reassign: true },
      { ...t, id: 'a3', title: 'Alice done', status: 'completed', assignee_id: 'alice' },
      { ...t, id: 'b1', title: 'Ben locked step', status: 'todo', assignee_id: 'ben', is_workflow_task: true, event_id: 'evt-b1', allow_reassign: false },
      { ...t, id: 'm1', title: 'Mia own', status: 'todo', assignee_id: 'mia' },
      { ...t, id: 'x1', title: 'Other tenant', status: 'todo', assignee_id: 'alice', tenant_id: 'tb' },
      { ...t, id: 'bob1', title: 'Bob', status: 'todo', assignee_id: 'bob' },
    ],
    workflow_runs: [{ tenant_id: 'ta', event_id: 'evt-a2', sla_status: 'breached', sla_due_at: PAST }],
    task_escalations: [], workflows: [{ id: 'wf-1', tenant_id: 'ta', name: 'Invoice approval' }],
    lifecycle_events: [], notifications: [],
  })
}
const ctxAs = (actorId: string | null, perms: string[] = ['tasks.view_own', 'tasks.assign', 'team.view_members']): ServiceContext => ({
  supabase: db as any, db: db as any, tenantId: 'ta', actorId, permissions: new Set(perms), authKind: 'api_key', source: 'api',
})

beforeEach(() => { db = seed() })

describe('listReportTasks', () => {
  it('direct reports\' open tasks with workload; indirect on request', async () => {
    const mine = await listReportTasks(ctxAs('mia'))
    expect(mine.tasks.map((t) => t.id).sort()).toEqual(['a1', 'a2', 'b1'])
    const alice = mine.reports.find((r) => r.user.id === 'alice')!
    expect(alice).toMatchObject({ open: 2, overdue: 1, sla_breached: 1, due_soon: 0, depth: 1 })
    expect(mine.tasks.find((t) => t.id === 'a2')).toMatchObject({ sla_breached: true, workflow_name: 'Invoice approval', is_overdue: false })
    expect(mine.tasks.find((t) => t.id === 'a1')).toMatchObject({ is_overdue: true })

    expect((await listReportTasks(ctxAs('carl'))).tasks.map((t) => t.id)).toEqual(['m1'])
    const all = await listReportTasks(ctxAs('carl'), { indirect: true })
    expect(all.tasks.map((t) => t.id).sort()).toEqual(['a1', 'a2', 'b1', 'm1'])
    expect(all.reports.find((r) => r.user.id === 'alice')).toMatchObject({ depth: 2, manager_user_id: 'mia' })
  })

  it('filters: person, priority, workflow, overdue, SLA', async () => {
    expect((await listReportTasks(ctxAs('mia'), { person: 'ben' })).tasks.map((t) => t.id)).toEqual(['b1'])
    await expect(listReportTasks(ctxAs('mia'), { person: 'bob' })).rejects.toMatchObject({ status: 400 })
    expect((await listReportTasks(ctxAs('mia'), { priority: ['high'] })).tasks.map((t) => t.id)).toEqual(['a2'])
    expect((await listReportTasks(ctxAs('mia'), { workflow_id: 'wf-1' })).tasks.map((t) => t.id)).toEqual(['a2'])
    expect((await listReportTasks(ctxAs('mia'), { overdue: true })).tasks.map((t) => t.id)).toEqual(['a1'])
    expect((await listReportTasks(ctxAs('mia'), { sla_breached: true })).tasks.map((t) => t.id)).toEqual(['a2'])
  })

  it('non-managers get an empty view; no user → 403', async () => {
    expect(await listReportTasks(ctxAs('bob'))).toMatchObject({ reports: [], tasks: [] })
    await expect(listReportTasks(ctxAs(null))).rejects.toMatchObject({ status: 403 })
    expect(await isManager(ctxAs('mia'))).toBe(true)
    expect(await isManager(ctxAs('bob'))).toBe(false)
  })
})

describe('reassignReportTask', () => {
  it('to another report or to self; respects the step\'s redirect rule', async () => {
    await expect(reassignReportTask(ctxAs('mia'), 'a1', { target_user_id: 'ben', comment: 'Ben has capacity' })).resolves.toMatchObject({ assignee_id: 'ben' })
    const { data: notes } = await (db as any).from('notifications').select('*')
    expect(notes.map((n: any) => n.user_id).sort()).toEqual(['alice', 'ben'])
    await expect(reassignReportTask(ctxAs('mia'), 'a2', { target_user_id: 'mia' })).resolves.toMatchObject({ assignee_id: 'mia' })
    await expect(reassignReportTask(ctxAs('mia'), 'b1', { target_user_id: 'alice' })).rejects.toMatchObject({ status: 409 })
    await expect(reassignReportTask(ctxAs('mia'), 'bob1', { target_user_id: 'mia' })).rejects.toMatchObject({ status: 403 })
    await expect(reassignReportTask(ctxAs('mia'), 'a1', { target_user_id: 'bob' })).rejects.toMatchObject({ status: 400 })
    await expect(reassignReportTask(ctxAs('mia'), 'x1', { target_user_id: 'ben' })).rejects.toMatchObject({ status: 404 })
    await expect(reassignReportTask(ctxAs('mia', ['tasks.view_own']), 'a1', { target_user_id: 'ben' })).rejects.toMatchObject({ status: 403 })
  })
})

describe('setManager / reports', () => {
  it('needs team.change_roles; refuses self, non-members and loops', async () => {
    await expect(setManager(ctxAs('mia'), 'bob', 'mia')).rejects.toMatchObject({ status: 403 })
    const admin = ctxAs('carl', ['team.change_roles', 'team.view_members'])
    await expect(setManager(admin, 'bob', 'bob')).rejects.toMatchObject({ status: 400 })
    await expect(setManager(admin, 'bob', 'nobody')).rejects.toMatchObject({ status: 400 })
    await expect(setManager(admin, 'carl', 'alice')).rejects.toMatchObject({ status: 400 })
    await expect(setManager(admin, 'nobody', 'mia')).rejects.toMatchObject({ status: 404 })
    const line = await setManager(admin, 'bob', 'mia')
    expect(line).toMatchObject({ manager: { id: 'mia' }, manager_source: 'manual', chain: [{ id: 'mia' }, { id: 'carl' }] })
    expect((await listReportsOf(admin, 'mia')).reports.map((r) => r.id).sort()).toEqual(['alice', 'ben', 'bob'])
    expect((await listReportsOf(admin, 'carl', { indirect: true })).reports).toHaveLength(4)
    await setManager(admin, 'bob', null)
    expect((await getReportingLine(admin, 'bob')).manager).toBeNull()
  })
})

describe('REST', () => {
  function apiAs(userId: string | null, permissions: string[]) {
    vi.mocked(validateApiKey).mockResolvedValue({
      success: true, tenantId: 'ta', keyId: 'k', keyType: userId ? 'user' : 'tenant', createdBy: 'carl', actingUserId: userId,
      scopes: { workflow_ids: [], table_ids: [] }, permissions, supabase: db as unknown as ApiKeySuccessResult['supabase'], authKind: 'api_key', expiresAt: null,
    } as any)
  }
  const get = (url: string) => new NextRequest(`https://app.test${url}`, { headers: { authorization: 'Bearer x' } })

  it('GET /tasks?scope=reports needs only tasks.view_own and a user', async () => {
    apiAs('mia', ['tasks.view_own'])
    const res = await listTasks(get('/api/v1/tasks?scope=reports&overdue=true'))
    expect(res.status).toBe(200)
    const body = (await res.json()).data
    expect(body.tasks.map((t: any) => t.id)).toEqual(['a1'])
    expect(body.reports).toHaveLength(2)
    apiAs(null, ['tasks.view_own', 'tasks.view_all'])
    expect((await listTasks(get('/api/v1/tasks?scope=reports'))).status).toBe(403)
    apiAs('mia', ['reports.view'])
    expect((await listTasks(get('/api/v1/tasks?scope=reports'))).status).toBe(403)
    apiAs('mia', ['tasks.view_all'])
    expect((await listTasks(get('/api/v1/tasks?scope=nope'))).status).toBe(400)
  })

  it('GET / PUT /users/{id}/manager', async () => {
    apiAs('mia', ['team.view_members'])
    const me = await getManager(get('/api/v1/users/me/manager'), { params: Promise.resolve({ id: 'me' }) })
    expect((await me.json()).data).toMatchObject({ user: { id: 'mia' }, manager: { id: 'carl' } })
    const put = (body: unknown) => putManager(new NextRequest('https://app.test/api/v1/users/bob/manager', { method: 'PUT', headers: { authorization: 'Bearer x', 'content-type': 'application/json' }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: 'bob' }) })
    expect((await put({ manager_user_id: '00000000-0000-4000-8000-000000000001' })).status).toBe(403)
    apiAs('carl', ['team.change_roles', 'team.view_members'])
    expect((await put({ manager_user_id: '00000000-0000-4000-8000-000000000001' })).status).toBe(400) // not a member
  })
})

describe('directory sync → reporting lines', () => {
  const links = new Map([['ext-alice', 'alice'], ['ext-mia', 'mia'], ['ext-bob', 'bob']])
  const current = new Map([
    ['alice', { manager_user_id: null, manager_source: null }],
    ['mia', { manager_user_id: 'carl', manager_source: 'manual' }],
    ['bob', { manager_user_id: 'mia', manager_source: 'directory' }],
  ])
  const user = (externalId: string, manager: any) => ({ externalId, displayName: externalId, email: null, active: true, ...(manager === undefined ? {} : { manager }) })

  it('plans: resolve by id or email, replace manual lines, clear only directory lines, skip unknowns', () => {
    const changes = planManagerChanges({
      users: [
        user('ext-alice', { externalId: 'ext-mia' }),
        user('ext-mia', { email: 'Bob@Example.test' }),
        user('ext-bob', null),
        user('ext-unknown', { externalId: 'ext-mia' }),
        user('ext-alice', undefined),
      ],
      localIdByExternalId: links,
      localIdByEmail: new Map([['bob@example.test', 'bob']]),
      current,
    })
    expect(changes).toEqual([
      { user_id: 'alice', manager_user_id: 'mia' },
      { user_id: 'mia', manager_user_id: 'bob' },
      { user_id: 'bob', manager_user_id: null },
    ])
    // A manual line is not cleared by "no manager"; an unresolvable manager changes nothing.
    expect(planManagerChanges({ users: [user('ext-mia', null), user('ext-alice', { externalId: 'ext-gone' })], localIdByExternalId: links, localIdByEmail: new Map(), current })).toEqual([])
  })

  it('applies to user_memberships with manager_source directory', async () => {
    const mem = createMemorySupabase({
      directory_links: [{ tenant_id: 'ta', provider: 'entra', object_type: 'user', external_id: 'ext-alice', local_id: 'alice' }, { tenant_id: 'ta', provider: 'entra', object_type: 'user', external_id: 'ext-mia', local_id: 'mia' }],
      user_memberships: [{ tenant_id: 'ta', user_id: 'alice', manager_user_id: null, is_active: true }, { tenant_id: 'ta', user_id: 'mia', manager_user_id: null, is_active: true }],
      users: [],
    })
    expect(await syncDirectoryManagers(mem, 'ta', 'entra', [user('ext-alice', { externalId: 'ext-mia' })] as any)).toBe(1)
    const { data } = await (mem as any).from('user_memberships').select('*').eq('user_id', 'alice').maybeSingle()
    expect(data).toMatchObject({ manager_user_id: 'mia', manager_source: 'directory' })
    expect(await syncDirectoryManagers(mem, 'ta', 'entra', [user('ext-alice', undefined)] as any)).toBe(0)
  })

  it('Entra expands manager; Okta reads profile.managerId', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const json = (body: unknown) => ({ ok: true, status: 200, headers: new Headers(), json: async () => body })
      if (url.includes('login.microsoftonline.com')) return json({ access_token: 't', expires_in: 3600 })
      if (url.includes('graph.microsoft.com')) {
        expect(url).toContain('$expand=manager')
        return json({ value: [{ id: 'u1', mail: 'a@x.test', accountEnabled: true, manager: { id: 'u2', mail: 'Boss@x.test' } }, { id: 'u2', mail: 'boss@x.test', accountEnabled: true }] })
      }
      if (url.includes('okta')) return json([{ id: 'o1', status: 'ACTIVE', profile: { email: 'a@x.test', managerId: 'o2' } }, { id: 'o2', status: 'ACTIVE', profile: { email: 'b@x.test', managerId: '' } }, { id: 'o3', status: 'ACTIVE', profile: { email: 'c@x.test' } }])
      throw new Error(url)
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const entra = await createEntraClient({ tenantId: 't', clientId: 'c', clientSecret: 's' }).listUsers()
      expect(entra[0].manager).toEqual({ externalId: 'u2', email: 'boss@x.test' })
      expect('manager' in entra[1]).toBe(false)
      const okta = await createOktaClient({ orgUrl: 'https://acme.okta.com', apiToken: 'tok' } as any).listUsers()
      expect(okta.map((u) => u.manager)).toEqual([{ externalId: 'o2', email: null }, null, undefined])
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
