/**
 * Task tracker → Following against a LOCAL Supabase stack (migration
 * 20261226000000_task_followers.sql + lib/services/task-follows.ts):
 *  - RLS on task_followers: own rows only, member workspaces only, INSERT
 *    only for a task the person can see (task_view_access), no UPDATE;
 *  - task_view_access: assignee, assigner, collaborator, team member,
 *    manager, tasks.view_all; a signed-in caller can't ask about others;
 *  - the service as an API / MCP caller (service role) and as a signed-in
 *    user (RLS client): follow / unfollow (idempotent, 404 for tasks they
 *    can't see or in another workspace, 403 without a user), the bells'
 *    batch read, the Following list in the tracker's row shape (completed
 *    stays, hide completed, soft-deleted and no-longer-visible tasks drop
 *    out) and its count.
 *
 * Runs only when EVENT_STREAM_DB_URL is set, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/task-followers-db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client, Pool } from 'pg'
import { createPgQuery } from '@user-tasks/pg-query'
import { createClient } from './helpers/db-test-client'
import * as follows from '@/lib/services/task-follows'
import type { ServiceContext } from '@/lib/services/context'

/* eslint-disable @typescript-eslint/no-explicit-any -- rows are loose JSON */

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.LOCKDOWN_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.LOCKDOWN_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const id = (n: number) => `7f0f7f00-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
// Personal workspaces take the first 8 characters of the user id as slug: keep those distinct.
const uid = (n: number) => `7f${n.toString(16).padStart(6, '0')}-0000-4000-8000-00000000007f`
const A = id(0xa)
const B = id(0xb)
const ASSIGNER = uid(0x101)  // member; assigned T_MAIN
const ASSIGNEE = uid(0x102)  // member; has T_MAIN
const MEMBER = uid(0x103)    // member; unrelated to T_MAIN
const ADMIN = uid(0x104)     // admin (tasks.view_all)
const TEAMER = uid(0x105)    // member of TEAM
const MANAGER = uid(0x106)   // ASSIGNEE's manager
const OUTSIDER = uid(0x107)  // member of B only
const COLLAB = uid(0x108)    // collaborator on T_MAIN
const USERS = [ASSIGNER, ASSIGNEE, MEMBER, ADMIN, TEAMER, MANAGER, OUTSIDER, COLLAB]
const TEAM = id(0x201)
const T_MAIN = id(0x301)
const T_SUB = id(0x302)      // subtask of T_MAIN
const T_TEAM = id(0x303)     // unassigned team task
const T_DONE = id(0x304)     // completed, assignee ASSIGNEE
const T_GONE = id(0x305)     // soft-deleted later
const T_OTHER = id(0x306)    // ADMIN's own task
const T_B = id(0x307)        // workspace B
const opts = { auth: { persistSession: false, autoRefreshToken: false } }

describe.skipIf(!DB_URL)('task followers (local stack)', () => {
  const db = new Client({ connectionString: DB_URL })
  const pool = new Pool({ connectionString: DB_URL, max: 2 })
  const admin = createClient(API_URL, SERVICE_KEY, opts)
  const pgq = createPgQuery({ pool, maxRows: 1000 })
  const memberPerms = ['tasks.view_own', 'tasks.complete']

  /** API / MCP caller: the workspace's service-role client. */
  const api = (tenantId: string, actorId: string | null, permissions: string[] = memberPerms): ServiceContext =>
    ({ supabase: admin, db: admin, tenantId, actorId, permissions: new Set(permissions), authKind: 'api_key', source: 'api' } as ServiceContext)
  /** Signed-in user: an RLS-bound client (as the dashboard's session client). */
  const session = (tenantId: string, actorId: string, permissions: string[] = memberPerms): ServiceContext => {
    const client = pgq.client({ role: 'authenticated', claims: { sub: actorId, role: 'authenticated', aud: 'authenticated' } }) as any
    return { supabase: client, db: client, tenantId, actorId, permissions: new Set(permissions), authKind: 'session', source: 'ui' } as ServiceContext
  }
  const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows

  /** SQL as a signed-in user (PostgREST style), rolled back. */
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
      await db.query('DELETE FROM public.task_followers WHERE tenant_id = $1', [t]).catch(() => undefined)
      await db.query('DELETE FROM public.task_assignees WHERE tenant_id = $1', [t]).catch(() => undefined)
      await db.query('DELETE FROM public.tasks WHERE tenant_id = $1 AND parent_task_id IS NOT NULL', [t]).catch(() => undefined)
      await db.query('DELETE FROM public.tasks WHERE tenant_id = $1', [t]).catch(() => undefined)
      await db.query('DELETE FROM public.user_teams WHERE team_id IN (SELECT id FROM public.teams WHERE tenant_id = $1)', [t]).catch(() => undefined)
      await db.query('DELETE FROM public.teams WHERE tenant_id = $1', [t]).catch(() => undefined)
    }
    await db.query('DELETE FROM auth.users WHERE id = ANY($1::uuid[])', [USERS])
    await db.query('DELETE FROM public.tenants WHERE id = ANY($1::uuid[])', [[A, B, ...personal.filter((t: string | null) => t && ![A, B].includes(t))]])
    await db.query(`DELETE FROM public.tenants WHERE slug LIKE 'personal-7f0001%'`).catch(() => undefined)
  }

  beforeAll(async () => {
    await db.connect()
    await cleanup()
    await q(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Follow A', 'follow-a-test'), ($2, 'Follow B', 'follow-b-test')`, [A, B])
    for (const user of USERS) {
      await q(`INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`,
        [user, `f${user.slice(2, 8)}.${Date.now().toString(36)}@follow.test`])
      const home = user === OUTSIDER ? B : A
      await q(`INSERT INTO public.user_memberships (user_id, tenant_id, role) VALUES ($1, $2, 'member') ON CONFLICT (user_id, tenant_id) DO NOTHING`, [user, home])
      await q('UPDATE public.users SET current_tenant_id = $2, display_name = $3 WHERE id = $1', [user, home, `User ${user.slice(2, 8)}`])
    }
    await q('UPDATE public.user_memberships SET manager_user_id = $1 WHERE user_id = $2 AND tenant_id = $3', [MANAGER, ASSIGNEE, A])
    const roleId = async (tenant: string, slug: string) => (await q('SELECT id FROM public.roles WHERE tenant_id = $1 AND slug = $2', [tenant, slug]))[0].id as string
    const memberRole = await roleId(A, 'member')
    for (const user of [ASSIGNER, ASSIGNEE, MEMBER, TEAMER, MANAGER, COLLAB]) await q('INSERT INTO public.user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3)', [A, user, memberRole])
    await q('INSERT INTO public.user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3)', [A, ADMIN, await roleId(A, 'admin')])
    await q('INSERT INTO public.user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3)', [B, OUTSIDER, await roleId(B, 'member')])
    await q(`INSERT INTO public.teams (id, tenant_id, name) VALUES ($1, $2, 'Ops')`, [TEAM, A])
    await q('INSERT INTO public.user_teams (user_id, team_id) VALUES ($1, $2)', [TEAMER, TEAM])

    const task = (tid: string, o: { tenant?: string; title: string; assignee?: string | null; assigner?: string | null; team?: string | null; status?: string; parent?: string; due?: string }) =>
      q(`INSERT INTO public.tasks (id, tenant_id, title, status, priority, assignee_id, assigner_id, assigned_team_id, parent_task_id, due_date, assignment_type)
         VALUES ($1, $2, $3, $4::task_status, 'medium', $5, $6, $7, $8, $9, $10)`,
      [tid, o.tenant ?? A, o.title, o.status ?? 'todo', o.assignee ?? null, o.assigner ?? null, o.team ?? null, o.parent ?? null, o.due ?? null, o.team ? 'team' : 'individual'])
    await task(T_MAIN, { title: 'Main followed task', assignee: ASSIGNEE, assigner: ASSIGNER, due: new Date(Date.now() + 86_400_000).toISOString() })
    await task(T_SUB, { title: 'Sub step', assignee: ASSIGNEE, assigner: ASSIGNER, parent: T_MAIN })
    await task(T_TEAM, { title: 'Team task', team: TEAM, assigner: ASSIGNER })
    await task(T_DONE, { title: 'Done task', assignee: ASSIGNEE, assigner: ASSIGNER, status: 'completed' })
    await task(T_GONE, { title: 'Gone task', assignee: ASSIGNEE, assigner: ASSIGNER })
    await task(T_OTHER, { title: 'Admin task', assignee: ADMIN, assigner: ADMIN })
    await task(T_B, { tenant: B, title: 'B task', assignee: OUTSIDER, assigner: OUTSIDER })
    await q(`INSERT INTO public.task_assignees (tenant_id, task_id, user_id) VALUES ($1, $2, $3)`, [A, T_MAIN, COLLAB])
  }, 60_000)

  afterAll(async () => {
    await cleanup().catch(() => undefined)
    await db.end()
    await pool.end()
  })

  /* ── visibility rule ───────────────────────────────────────────────── */

  it('task_view_access: assignee, assigner, collaborator, team member, manager, view_all — not unrelated members or other workspaces', async () => {
    const access = async (task: string, user: string) => (await q('SELECT public.task_view_access($1, $2) AS ok', [task, user]))[0].ok
    for (const user of [ASSIGNEE, ASSIGNER, COLLAB, MANAGER, ADMIN]) expect(await access(T_MAIN, user), user).toBe(true)
    expect(await access(T_MAIN, MEMBER)).toBe(false)
    expect(await access(T_MAIN, TEAMER)).toBe(false)
    expect(await access(T_TEAM, TEAMER)).toBe(true)
    expect(await access(T_MAIN, OUTSIDER)).toBe(false)
    expect(await access(T_B, ADMIN)).toBe(false)
    expect(await access(T_B, OUTSIDER)).toBe(true)
  })

  it('a signed-in caller can only ask task_view_access about themselves', async () => {
    expect((await as(MEMBER, 'SELECT public.task_view_access($1, $2) AS ok', [T_MAIN, ASSIGNEE])).rows[0].ok).toBe(false)
    expect((await as(ASSIGNEE, 'SELECT public.task_view_access($1, $2) AS ok', [T_MAIN, ASSIGNEE])).rows[0].ok).toBe(true)
    expect((await as(MEMBER, 'SELECT count(*)::int AS n FROM public.list_followed_tasks($1, NULL)', [ASSIGNEE])).rows[0].n).toBe(0)
    const anon = await (async () => {
      await db.query('BEGIN')
      try {
        await db.query('SET LOCAL ROLE anon')
        await db.query('SELECT public.task_view_access($1, $2)', [T_MAIN, ASSIGNEE])
        return null
      } catch (e) { return e as { code?: string } } finally { await db.query('ROLLBACK') }
    })()
    expect(anon?.code).toBe('42501')
  })

  /* ── RLS ───────────────────────────────────────────────────────────── */

  it('RLS: INSERT only your own row, for a task you can see, in a member workspace', async () => {
    const insert = (user: string, row: { user_id: string; task_id: string; tenant_id?: string }) =>
      as(user, 'INSERT INTO public.task_followers (tenant_id, user_id, task_id) VALUES ($1, $2, $3) RETURNING tenant_id', [row.tenant_id ?? A, row.user_id, row.task_id])
    const ok = await insert(ASSIGNEE, { user_id: ASSIGNEE, task_id: T_MAIN })
    expect(ok.error).toBeNull()
    expect(ok.rows[0].tenant_id).toBe(A)
    expect((await insert(TEAMER, { user_id: TEAMER, task_id: T_TEAM })).error).toBeNull()
    expect((await insert(MANAGER, { user_id: MANAGER, task_id: T_MAIN })).error).toBeNull()
    // Can't see it / someone else's row / another workspace's task (tenant_id spoofing is overridden by the trigger).
    expect((await insert(MEMBER, { user_id: MEMBER, task_id: T_MAIN })).error?.code).toBe('42501')
    expect((await insert(MEMBER, { user_id: ASSIGNEE, task_id: T_MAIN })).error?.code).toBe('42501')
    expect((await insert(ADMIN, { user_id: ADMIN, task_id: T_B })).error?.code).toBe('42501')
    expect((await insert(ADMIN, { user_id: ADMIN, task_id: T_B, tenant_id: A })).error?.code).toBe('42501')
    expect((await insert(OUTSIDER, { user_id: OUTSIDER, task_id: T_MAIN, tenant_id: B })).error?.code).toBe('42501')
  })

  it('RLS: SELECT and DELETE your own rows only; no UPDATE', async () => {
    await q('INSERT INTO public.task_followers (tenant_id, user_id, task_id) VALUES ($1, $2, $3), ($1, $4, $3) ON CONFLICT DO NOTHING', [A, ASSIGNEE, T_MAIN, ADMIN])
    try {
      const seen = await as(ASSIGNEE, 'SELECT user_id FROM public.task_followers')
      expect(seen.rows.map((r) => r.user_id)).toEqual([ASSIGNEE])
      expect((await as(OUTSIDER, 'SELECT count(*)::int AS n FROM public.task_followers')).rows[0].n).toBe(0)
      const del = await as(ASSIGNEE, 'DELETE FROM public.task_followers WHERE task_id = $1 RETURNING user_id', [T_MAIN])
      expect(del.rows.map((r) => r.user_id)).toEqual([ASSIGNEE])
      expect((await as(ASSIGNEE, 'UPDATE public.task_followers SET created_at = now() WHERE task_id = $1', [T_MAIN])).error?.code).toBe('42501')
    } finally {
      await q('DELETE FROM public.task_followers WHERE task_id = $1', [T_MAIN])
    }
  })

  /* ── service: API / MCP caller ─────────────────────────────────────── */

  it('follow / unfollow: idempotent; 404 for tasks you cannot see or in another workspace; 403 without a user', async () => {
    expect(await follows.setTaskFollowed(api(A, ASSIGNER), T_MAIN, true)).toEqual({ task_id: T_MAIN, following: true })
    expect(await follows.setTaskFollowed(api(A, ASSIGNER), T_MAIN, true)).toEqual({ task_id: T_MAIN, following: true })
    await expect(follows.setTaskFollowed(api(A, MEMBER), T_MAIN, true)).rejects.toMatchObject({ status: 404 })
    await expect(follows.setTaskFollowed(api(A, ADMIN), T_B, true)).rejects.toMatchObject({ status: 404 })
    await expect(follows.setTaskFollowed(api(B, OUTSIDER), T_MAIN, true)).rejects.toMatchObject({ status: 404 })
    await expect(follows.setTaskFollowed(api(A, ASSIGNER), 'not-a-uuid', true)).rejects.toMatchObject({ status: 404 })
    await expect(follows.setTaskFollowed(api(A, null), T_MAIN, true)).rejects.toMatchObject({ status: 403 })
    await expect(follows.listFollowedTasks(api(A, null))).rejects.toMatchObject({ status: 403 })
    expect(await follows.setTaskFollowed(api(A, ASSIGNER), T_MAIN, false)).toEqual({ task_id: T_MAIN, following: false })
    expect(await follows.setTaskFollowed(api(A, ASSIGNER), T_MAIN, false)).toEqual({ task_id: T_MAIN, following: false })
    expect((await q('SELECT count(*)::int AS n FROM public.task_followers WHERE user_id = $1', [ASSIGNER]))[0].n).toBe(0)
  })

  it('the Following list: tracker rows with followed_at; completed stays; hide completed; deleted and no-longer-visible tasks drop out', async () => {
    const me = api(A, ASSIGNER)
    for (const t of [T_MAIN, T_DONE, T_GONE, T_TEAM, T_SUB]) await follows.setTaskFollowed(me, t, true)

    const ids = await follows.followedTaskIds(me, [T_MAIN, T_DONE, T_OTHER, T_B, 'junk'])
    expect(ids.sort()).toEqual([T_DONE, T_MAIN].sort())

    let list = await follows.listFollowedTasks(me)
    expect(list.map((t: any) => t.id).sort()).toEqual([T_MAIN, T_DONE, T_GONE, T_TEAM, T_SUB].sort())
    const main = list.find((t: any) => t.id === T_MAIN)
    expect(main.followed_at).toBeTruthy()
    expect(main.assignee?.id).toBe(ASSIGNEE)
    expect(main.subtasks.map((s: any) => s.id)).toEqual([T_SUB])
    expect(main.collaborators.map((c: any) => c.user_id)).toEqual([COLLAB])
    expect(main.subtask_count).toBe(1)
    expect(list[0].id).toBe(T_MAIN) // the only one with a due date sorts first
    expect(await follows.countFollowedTasks(me)).toEqual({ total: 5, open: 4 })

    expect((await follows.listFollowedTasks(me, { hideCompleted: true })).map((t: any) => t.id)).not.toContain(T_DONE)
    expect((await follows.listFollowedTasks(me, { status: ['completed'] })).map((t: any) => t.id)).toEqual([T_DONE])
    expect((await follows.listFollowedTasks(me, { search: 'gone' })).map((t: any) => t.id)).toEqual([T_GONE])
    expect(await follows.pageFollowedTasks(me, {}, { limit: 2, offset: 0 })).toMatchObject({ total: 5 })

    // Soft-deleted: drops out. Lost access (no longer the assigner): drops out, without leaking.
    await q('UPDATE public.tasks SET deleted_at = now() WHERE id = $1', [T_GONE])
    await q('UPDATE public.tasks SET assigner_id = $2 WHERE id = $1', [T_TEAM, ADMIN])
    list = await follows.listFollowedTasks(me)
    expect(list.map((t: any) => t.id).sort()).toEqual([T_MAIN, T_DONE, T_SUB].sort())
    expect(await follows.countFollowedTasks(me)).toEqual({ total: 3, open: 2 })

    // Someone else's follows are not mine; another workspace's caller sees none of them.
    expect(await follows.listFollowedTasks(api(A, ASSIGNEE))).toEqual([])
    expect(await follows.listFollowedTasks(api(B, ASSIGNER))).toEqual([])
    expect(await follows.followedTaskIds(api(B, ASSIGNER), [T_MAIN])).toEqual([])
  })

  /* ── service: signed-in user (RLS client) ──────────────────────────── */

  it('a signed-in user follows, lists and unfollows through RLS', async () => {
    const me = session(A, MANAGER)
    expect(await follows.setTaskFollowed(me, T_MAIN, true)).toEqual({ task_id: T_MAIN, following: true })
    await expect(follows.setTaskFollowed(me, T_OTHER, true)).rejects.toMatchObject({ status: 404 })
    await expect(follows.setTaskFollowed(me, T_B, true)).rejects.toMatchObject({ status: 404 })
    expect(await follows.followedTaskIds(me, [T_MAIN, T_OTHER])).toEqual([T_MAIN])
    const list = await follows.listFollowedTasks(me)
    expect(list.map((t: any) => t.id)).toEqual([T_MAIN])
    expect(list[0].tenant?.id).toBe(A)
    expect(await follows.countFollowedTasks(me)).toEqual({ total: 1, open: 1 })
    expect(await follows.setTaskFollowed(me, T_MAIN, false)).toEqual({ task_id: T_MAIN, following: false })
    expect(await follows.listFollowedTasks(me)).toEqual([])
  })
})
