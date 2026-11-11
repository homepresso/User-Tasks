/**
 * Invite (read only) against a LOCAL Supabase stack (migration
 * 20270105000000_task_viewers.sql + lib/services/task-viewers.ts):
 *  - visibility through an invite naming the person, a team they are in or a
 *    role they hold (task_viewer_grant / task_view_access / canViewTask),
 *    subtasks through include_subtasks, and a removed invite loses access;
 *  - a viewer can't act (complete, form, subtask, reassign, invite) but can
 *    comment;
 *  - who may invite (assignee, assigner, manager; not viewers / unrelated);
 *  - the tracker (Following + shared_with_me, team / role without follow
 *    rows) and the dependency search (search_visible_tasks) include them;
 *  - RLS: SELECT only for people who can see the task, no client writes;
 *    tenant isolation.
 *
 * Runs only when EVENT_STREAM_DB_URL is set, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/task-viewers-db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client, Pool } from 'pg'
import { createPgQuery } from '@user-tasks/pg-query'
import { createClient } from './helpers/db-test-client'
import type { ServiceContext } from '@/lib/services/context'

vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async () => ({ success: true })) }))

/* eslint-disable @typescript-eslint/no-explicit-any -- rows are loose JSON */

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.LOCKDOWN_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.LOCKDOWN_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const id = (n: number) => `7e0e7e00-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const uid = (n: number) => `7e${n.toString(16).padStart(6, '0')}-0000-4000-8000-00000000007e`
const A = id(0xa)
const B = id(0xb)
const ASSIGNER = uid(0x201)  // assigned T_MAIN
const ASSIGNEE = uid(0x202)  // has T_MAIN
const MANAGER = uid(0x203)   // ASSIGNEE's manager
const PERSON = uid(0x204)    // invited directly
const TEAMER = uid(0x205)    // in TEAM (invited)
const ROLER = uid(0x206)     // holds ROLE (invited)
const MEMBER = uid(0x207)    // unrelated member of A
const OUTSIDER = uid(0x208)  // member of B only
const USERS = [ASSIGNER, ASSIGNEE, MANAGER, PERSON, TEAMER, ROLER, MEMBER, OUTSIDER]
const TEAM = id(0x301)
const ROLE = id(0x302)
const T_MAIN = id(0x401)
const T_SUB = id(0x402)      // subtask of T_MAIN
const T_OTHER = id(0x403)    // unrelated, ASSIGNEE's
const T_B = id(0x404)        // workspace B
const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const memberPerms = ['tasks.view_own', 'tasks.complete', 'tasks.assign']

describe.skipIf(!DB_URL)('task viewers — Invite, read only (local stack)', () => {
  const db = new Client({ connectionString: DB_URL })
  const pool = new Pool({ connectionString: DB_URL, max: 2 })
  const admin = createClient(API_URL, SERVICE_KEY, opts)
  const pgq = createPgQuery({ pool, maxRows: 1000 })

  const api = (tenantId: string, actorId: string | null, permissions: string[] = memberPerms): ServiceContext =>
    ({ supabase: admin, db: admin, tenantId, actorId, permissions: new Set(permissions), authKind: 'api_key', source: 'api' } as ServiceContext)
  const session = (tenantId: string, actorId: string, permissions: string[] = memberPerms): ServiceContext => {
    const client = pgq.client({ role: 'authenticated', claims: { sub: actorId, role: 'authenticated', aud: 'authenticated' } }) as any
    return { supabase: client, db: client, tenantId, actorId, permissions: new Set(permissions), authKind: 'session', source: 'ui' } as ServiceContext
  }
  const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows
  const viewers = () => import('@/lib/services/task-viewers')
  const authz = () => import('@/lib/task-authz')

  async function as(user: string, sql: string, params: unknown[] = []) {
    await db.query('BEGIN')
    try {
      await db.query('SET LOCAL ROLE authenticated')
      await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: user, role: 'authenticated' })])
      return { rows: (await db.query(sql, params)).rows as any[], error: null as null | { code?: string } }
    } catch (e) {
      return { rows: [] as any[], error: e as { code?: string } }
    } finally {
      await db.query('ROLLBACK')
    }
  }

  async function cleanup() {
    const personal = (await q('SELECT tenant_id FROM public.users WHERE id = ANY($1::uuid[])', [USERS])).map((r: any) => r.tenant_id)
    for (const t of [A, B]) {
      for (const table of ['task_viewers', 'task_followers', 'notifications', 'lifecycle_events', 'object_audit_log', 'task_assignees']) {
        await db.query(`DELETE FROM public.${table} WHERE tenant_id = $1`, [t]).catch(() => undefined)
      }
      await db.query('DELETE FROM public.tasks WHERE tenant_id = $1 AND parent_task_id IS NOT NULL', [t]).catch(() => undefined)
      await db.query('DELETE FROM public.tasks WHERE tenant_id = $1', [t]).catch(() => undefined)
      await db.query('DELETE FROM public.user_teams WHERE team_id IN (SELECT id FROM public.teams WHERE tenant_id = $1)', [t]).catch(() => undefined)
      await db.query('DELETE FROM public.teams WHERE tenant_id = $1', [t]).catch(() => undefined)
    }
    await db.query('DELETE FROM auth.users WHERE id = ANY($1::uuid[])', [USERS])
    await db.query('DELETE FROM public.tenants WHERE id = ANY($1::uuid[])', [[A, B, ...personal.filter((t: string | null) => t && ![A, B].includes(t))]])
  }

  beforeAll(async () => {
    await db.connect()
    await cleanup()
    await q(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Viewers A', 'viewers-a-test'), ($2, 'Viewers B', 'viewers-b-test')`, [A, B])
    for (const user of USERS) {
      await q(`INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`,
        [user, `v${user.slice(2, 8)}.${Date.now().toString(36)}@viewers.test`])
      const home = user === OUTSIDER ? B : A
      await q(`INSERT INTO public.user_memberships (user_id, tenant_id, role) VALUES ($1, $2, 'member') ON CONFLICT (user_id, tenant_id) DO NOTHING`, [user, home])
      await q('UPDATE public.users SET current_tenant_id = $2, display_name = $3 WHERE id = $1', [user, home, `User ${user.slice(2, 8)}`])
    }
    await q('UPDATE public.user_memberships SET manager_user_id = $1 WHERE user_id = $2 AND tenant_id = $3', [MANAGER, ASSIGNEE, A])
    const roleId = async (tenant: string, slug: string) => (await q('SELECT id FROM public.roles WHERE tenant_id = $1 AND slug = $2', [tenant, slug]))[0].id as string
    const memberRole = await roleId(A, 'member')
    for (const user of [ASSIGNER, ASSIGNEE, MANAGER, PERSON, TEAMER, ROLER, MEMBER]) await q('INSERT INTO public.user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3)', [A, user, memberRole])
    await q(`INSERT INTO public.roles (id, tenant_id, name, slug, permissions) VALUES ($1, $2, 'Auditors', 'auditors-viewers-test', ARRAY['tasks.view_own'])`, [ROLE, A])
    await q('INSERT INTO public.user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3)', [A, ROLER, ROLE])
    await q('INSERT INTO public.user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3)', [B, OUTSIDER, await roleId(B, 'member')])
    await q(`INSERT INTO public.teams (id, tenant_id, name) VALUES ($1, $2, 'Finance')`, [TEAM, A])
    await q('INSERT INTO public.user_teams (user_id, team_id) VALUES ($1, $2)', [TEAMER, TEAM])
    const task = (tid: string, o: { tenant?: string; title: string; assignee?: string | null; assigner?: string | null; parent?: string }) =>
      q(`INSERT INTO public.tasks (id, tenant_id, title, status, priority, assignee_id, assigner_id, parent_task_id, assignment_type, acceptance_status)
         VALUES ($1, $2, $3, 'todo', 'medium', $4, $5, $6, 'individual', 'accepted')`,
      [tid, o.tenant ?? A, o.title, o.assignee ?? null, o.assigner ?? null, o.parent ?? null])
    await task(T_MAIN, { title: 'Quarterly close', assignee: ASSIGNEE, assigner: ASSIGNER })
    await task(T_SUB, { title: 'Reconcile accounts', assignee: ASSIGNEE, assigner: ASSIGNER, parent: T_MAIN })
    await task(T_OTHER, { title: 'Unrelated close task', assignee: ASSIGNEE, assigner: ASSIGNEE })
    await task(T_B, { tenant: B, title: 'B close task', assignee: OUTSIDER, assigner: OUTSIDER })
  }, 60_000)

  afterAll(async () => {
    await cleanup().catch(() => undefined)
    await db.end()
    await pool.end()
  })

  const canSee = async (user: string, task = T_MAIN) => (await q('SELECT public.task_view_access($1, $2) AS ok', [task, user]))[0].ok as boolean

  it('nobody outside the task sees it before an invite', async () => {
    for (const user of [PERSON, TEAMER, ROLER, MEMBER]) expect(await canSee(user), user).toBe(false)
  })

  it('who may invite: assignee, assigner, manager — not unrelated members (404) — and principals must be in the workspace', async () => {
    const svc = await viewers()
    await expect(svc.addTaskViewers(api(A, MEMBER), T_MAIN, { principals: [{ type: 'user', id: PERSON }], via: 'api' })).rejects.toMatchObject({ code: 'not_found' })
    await expect(svc.addTaskViewers(api(A, ASSIGNEE), T_MAIN, { principals: [{ type: 'user', id: OUTSIDER }], via: 'api' })).rejects.toMatchObject({ code: 'validation_error' })
    await expect(svc.addTaskViewers(api(A, ASSIGNEE), T_MAIN, { principals: [{ type: 'team', id: id(0x999) }], via: 'api' })).rejects.toMatchObject({ code: 'validation_error' })
    // Another workspace's caller can't reach the task at all.
    await expect(svc.addTaskViewers(api(B, OUTSIDER), T_MAIN, { principals: [{ type: 'user', id: OUTSIDER }], via: 'api' })).rejects.toMatchObject({ code: 'not_found' })

    const byAssignee = await svc.addTaskViewers(api(A, ASSIGNEE), T_MAIN, { principals: [{ type: 'user', id: PERSON }], note: 'FYI', via: 'api' })
    expect(byAssignee.basis).toBe('assignee')
    expect(byAssignee.added.map((v) => v.principal_type)).toEqual(['user'])
    const byAssigner = await svc.addTaskViewers(api(A, ASSIGNER), T_MAIN, { principals: [{ type: 'team', id: TEAM }], via: 'api' })
    expect(byAssigner.basis).toBe('assigner')
    const byManager = await svc.addTaskViewers(api(A, MANAGER), T_MAIN, { principals: [{ type: 'role', id: ROLE }, { type: 'team', id: TEAM }], via: 'api' })
    expect(byManager.basis).toBe('manager')
    expect(byManager.added.map((v) => v.principal_type)).toEqual(['role'])
    expect(byManager.existing).toBe(1)
  })

  it('visibility through a person, a team and a role — and their subtasks', async () => {
    for (const user of [PERSON, TEAMER, ROLER]) {
      expect(await canSee(user), user).toBe(true)
      expect(await canSee(user, T_SUB), `${user} subtask`).toBe(true)
      expect(await canSee(user, T_OTHER), `${user} other`).toBe(false)
    }
    expect(await canSee(MEMBER)).toBe(false)
    const { canViewTask, canReachTask } = await authz()
    const params = { tenantId: A, taskId: T_MAIN, actorId: TEAMER, permissions: new Set(memberPerms) }
    expect(await canViewTask(admin, params)).toBe(true)
    // Reach (every write check) ignores invites.
    expect(await canReachTask(admin, params)).toBe(false)
    // The task page read (session, RLS client).
    const tasks = await import('@/lib/services/tasks')
    expect((await tasks.getTaskTree(session(A, ROLER), T_MAIN))?.task?.id).toBe(T_MAIN)
    expect(await tasks.getTaskTree(session(A, MEMBER), T_MAIN)).toBeNull()
  })

  it('the history and the audit log record the invites; people invited directly are notified and follow it', async () => {
    const events = await q(`SELECT metadata->>'action' AS action, metadata->>'message' AS message FROM public.lifecycle_events WHERE task_id = $1 AND metadata->>'action' = 'viewers_invited' ORDER BY created_at`, [T_MAIN])
    expect(events.map((e: any) => e.message)).toEqual([expect.stringMatching(/^invited User .+ to view$/), 'invited Finance (team) to view', 'invited Auditors (role) to view'])
    const audits = await q(`SELECT action FROM public.object_audit_log WHERE tenant_id = $1 AND object_id = $2`, [A, T_MAIN])
    expect(audits.filter((a: any) => a.action === 'share')).toHaveLength(3)
    const notes = await q(`SELECT user_id FROM public.notifications WHERE task_id = $1 AND type = 'task_shared'`, [T_MAIN])
    expect(new Set(notes.map((n: any) => n.user_id))).toEqual(new Set([PERSON, TEAMER, ROLER]))
    expect((await q('SELECT count(*)::int AS n FROM public.task_followers WHERE task_id = $1 AND user_id = $2', [T_MAIN, PERSON]))[0].n).toBe(1)
    // Team / role members get no follow rows (the tracker lists them dynamically).
    expect((await q('SELECT count(*)::int AS n FROM public.task_followers WHERE task_id = $1 AND user_id = ANY($2::uuid[])', [T_MAIN, [TEAMER, ROLER]]))[0].n).toBe(0)
  })

  it('a viewer cannot act: complete, form, subtasks, reassign or invite', async () => {
    const { authorizeTaskAction, authorizeTaskAssignment, describeTaskAccess } = await authz()
    const perms = new Set(memberPerms)
    await expect(authorizeTaskAction(admin, { tenantId: A, taskId: T_MAIN, actorId: PERSON, permissions: perms })).rejects.toMatchObject({ status: 403 })
    await expect(authorizeTaskAssignment(admin, { tenantId: A, taskId: T_MAIN, actorId: PERSON, permissions: perms, action: 'assign' })).rejects.toMatchObject({ status: 403 })
    const tasks = await import('@/lib/services/tasks')
    await expect(tasks.completeStandardTask(session(A, PERSON), T_MAIN, { outcome: 'completed' })).rejects.toMatchObject({ code: 'not_found' })
    await expect(tasks.addSubtask(session(A, TEAMER), T_MAIN, { title: 'Sneaky' })).rejects.toMatchObject({ code: 'not_found' })
    await expect(tasks.updateTask(session(A, ROLER), T_MAIN, { title: 'Renamed' } as any)).rejects.toBeTruthy()
    const svc = await viewers()
    await expect(svc.addTaskViewers(api(A, PERSON), T_MAIN, { principals: [{ type: 'user', id: MEMBER }], via: 'api' })).rejects.toMatchObject({ code: 'forbidden' })
    const access = await describeTaskAccess(admin, { tenantId: A, taskId: T_MAIN, actorId: TEAMER, permissions: perms })
    expect(access).toMatchObject({ mode: 'none', canManageViewers: false, viewer: { principalType: 'team', inherited: false } })
    const sub = await describeTaskAccess(admin, { tenantId: A, taskId: T_SUB, actorId: ROLER, permissions: perms })
    expect(sub?.viewer).toMatchObject({ principalType: 'role', inherited: true })
    expect((await q('SELECT title FROM public.tasks WHERE id = $1', [T_MAIN]))[0].title).toBe('Quarterly close')
  })

  it('a viewer can comment (and an unrelated member cannot)', async () => {
    const tasks = await import('@/lib/services/tasks')
    await expect(tasks.addTaskComment(session(A, TEAMER), T_MAIN, 'Looks fine from Finance')).resolves.toEqual({ message: 'Looks fine from Finance' })
    // A viewer whose role has only tasks.view_own comments too.
    await expect(tasks.addTaskComment(session(A, ROLER, ['tasks.view_own']), T_MAIN, 'Audit note')).resolves.toEqual({ message: 'Audit note' })
    await expect(tasks.addTaskComment(session(A, MEMBER), T_MAIN, 'Hello?')).rejects.toMatchObject({ code: 'not_found' })
  })

  it('the tracker lists shared tasks (person, team and role) with shared_with_me; sharedOnly narrows to them', async () => {
    const follows = await import('@/lib/services/task-follows')
    for (const [user, via] of [[PERSON, 'user'], [TEAMER, 'team'], [ROLER, 'role']] as const) {
      const rows = await follows.listFollowedTasks(session(A, user))
      const row = rows.find((r) => r.id === T_MAIN)
      expect(row, user).toBeTruthy()
      expect(row.shared_with_me).toMatchObject({ via })
      expect((await follows.listFollowedTasks(session(A, user), { sharedOnly: true })).map((r) => r.id)).toEqual([T_MAIN])
      expect((await follows.countFollowedTasks(session(A, user))).total).toBeGreaterThanOrEqual(1)
    }
    expect((await follows.listFollowedTasks(session(A, MEMBER))).map((r) => r.id)).not.toContain(T_MAIN)
    // The API caller (service role) gets the same.
    expect((await follows.listFollowedTasks(api(A, TEAMER))).map((r) => r.id)).toContain(T_MAIN)
  })

  it('the dependency search finds shared tasks for viewers, never unrelated ones', async () => {
    const search = async (user: string, text: string) => (await as(user, 'SELECT id FROM public.search_visible_tasks($1, $2, $3, NULL, 8)', [user, A, text])).rows.map((r) => r.id)
    expect(await search(TEAMER, 'close')).toEqual([T_MAIN])
    expect(await search(ROLER, 'reconcile')).toEqual([T_SUB])
    expect(await search(MEMBER, 'close')).toEqual([])
    expect(await search(ASSIGNEE, 'close')).toEqual(expect.arrayContaining([T_MAIN, T_OTHER]))
    // A signed-in caller can't search as someone else.
    expect((await as(MEMBER, 'SELECT count(*)::int AS n FROM public.search_visible_tasks($1, $2, $3, NULL, 8)', [TEAMER, A, 'close'])).rows[0].n).toBe(0)
  })

  it('RLS: invites are readable by people who can see the task; no client writes; other workspaces see nothing', async () => {
    const seen = async (user: string) => (await as(user, 'SELECT principal_type FROM public.task_viewers WHERE task_id = $1 ORDER BY principal_type', [T_MAIN])).rows.map((r) => r.principal_type)
    expect(await seen(ASSIGNEE)).toEqual(['role', 'team', 'user'])
    expect(await seen(TEAMER)).toEqual(['role', 'team', 'user'])
    expect(await seen(MEMBER)).toEqual([])
    expect(await seen(OUTSIDER)).toEqual([])
    const insert = await as(ASSIGNEE, `INSERT INTO public.task_viewers (tenant_id, task_id, principal_type, principal_id) VALUES ($1, $2, 'user', $3)`, [A, T_MAIN, MEMBER])
    expect(insert.error?.code).toBe('42501')
    expect((await as(ASSIGNEE, 'DELETE FROM public.task_viewers WHERE task_id = $1', [T_MAIN])).error?.code).toBe('42501')
    expect((await as(ASSIGNEE, `UPDATE public.task_viewers SET note = 'x' WHERE task_id = $1`, [T_MAIN])).error?.code).toBe('42501')
    // Workspace B's member: no grant, no listing, no search.
    expect(await canSee(OUTSIDER)).toBe(false)
    expect((await as(OUTSIDER, 'SELECT count(*)::int AS n FROM public.list_viewer_tasks($1, NULL)', [OUTSIDER])).rows[0].n).toBe(0)
    expect((await as(MEMBER, 'SELECT count(*)::int AS n FROM public.list_viewer_tasks($1, NULL)', [TEAMER])).rows[0].n).toBe(0)
    expect((await q('SELECT public.task_viewer_grant($1, $2) AS g', [T_B, TEAMER]))[0].g).toBeNull()
  })

  it('removing an invite takes access away (and the follow it created); viewers cannot remove', async () => {
    const svc = await viewers()
    const list = await svc.listTaskViewers(api(A, TEAMER), T_MAIN)
    expect(list.can_manage).toBe(false)
    const team = list.viewers.find((v) => v.principal_type === 'team')!
    const person = list.viewers.find((v) => v.principal_type === 'user')!
    await expect(svc.removeTaskViewer(api(A, TEAMER), T_MAIN, team.id, { via: 'api' })).rejects.toMatchObject({ code: 'forbidden' })
    await svc.removeTaskViewer(api(A, ASSIGNEE), T_MAIN, team.id, { via: 'api' })
    expect(await canSee(TEAMER)).toBe(false)
    expect(await canSee(TEAMER, T_SUB)).toBe(false)
    await expect(svc.listTaskViewers(api(A, TEAMER), T_MAIN)).rejects.toMatchObject({ code: 'not_found' })
    await svc.removeTaskViewer(api(A, ASSIGNER), T_MAIN, person.id, { via: 'api' })
    expect(await canSee(PERSON)).toBe(false)
    expect((await q('SELECT count(*)::int AS n FROM public.task_followers WHERE task_id = $1 AND user_id = $2', [T_MAIN, PERSON]))[0].n).toBe(0)
    const removed = await q(`SELECT metadata->>'message' AS m FROM public.lifecycle_events WHERE task_id = $1 AND metadata->>'action' = 'viewer_removed' ORDER BY created_at`, [T_MAIN])
    expect(removed.map((r: any) => r.m)).toEqual(['stopped sharing with Finance (team)', expect.stringMatching(/^stopped sharing with User /)])
    // The role invite remains.
    expect(await canSee(ROLER)).toBe(true)
  })

  it('include_subtasks false shares the task only', async () => {
    const svc = await viewers()
    await svc.addTaskViewers(api(A, ASSIGNEE), T_MAIN, { principals: [{ type: 'user', id: MEMBER }], include_subtasks: false, via: 'api' })
    expect(await canSee(MEMBER)).toBe(true)
    expect(await canSee(MEMBER, T_SUB)).toBe(false)
  })
})
