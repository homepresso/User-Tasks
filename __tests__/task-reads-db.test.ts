/**
 * Unread tasks against a LOCAL database (migration
 * 20270115300000_task_reads.sql + lib/services/task-reads.ts):
 *  - the rule (task_unread_ids): assignment, reassignment (away and back),
 *    team tasks and claiming, collaborators added later, edits that don't
 *    count, completed / draft never unread, reopened ("sent back") unread
 *    again, people who only see a task never unread;
 *  - routed_at can't be set by hand;
 *  - RLS on task_reads: own rows only, member workspaces only, INSERT /
 *    UPDATE only for a task the person can see; DELETE own;
 *  - guards: a signed-in caller can only ask about / write for themselves;
 *    anon can't call the functions;
 *  - the service as an API / MCP caller (service role) and as a signed-in
 *    user (RLS client): mark read / unread (404 for tasks they can't see,
 *    403 without a user), mark all read, the count, `unread` on list rows
 *    (My tasks read, Home), nothing for a credential with no user;
 *  - hard-deleting a task removes its reads.
 *
 * Runs only when EVENT_STREAM_DB_URL is set, e.g. against the local stack
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/task-reads-db.test.ts
 * or a plain Postgres with every migration applied (usertasks-admin db migrate):
 *   EVENT_STREAM_DB_URL=$URL DATABASE_URL=$URL DB_PROVIDER=postgres npx vitest run __tests__/task-reads-db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client, Pool } from 'pg'
import { createPgQuery } from '@user-tasks/pg-query'
import { createClient } from './helpers/db-test-client'
import * as reads from '@/lib/services/task-reads'
import * as home from '@/lib/services/home'
import { UI_READS } from '@/lib/services/ui-reads'
import type { ServiceContext } from '@/lib/services/context'

/* eslint-disable @typescript-eslint/no-explicit-any -- rows are loose JSON */

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.LOCKDOWN_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.LOCKDOWN_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const id = (n: number) => `7e0e7e00-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
// Personal workspaces take the first 8 characters of the user id as slug: keep those distinct.
const uid = (n: number) => `7e${n.toString(16).padStart(6, '0')}-0000-4000-8000-00000000007e`
const A = id(0xa)
const B = id(0xb)
const ASSIGNER = uid(0x101)  // member; assigns the tasks
const ASSIGNEE = uid(0x102)  // member; holds T_MAIN
const OTHER = uid(0x103)     // member; reassignment target
const TEAMER = uid(0x104)    // member of TEAM
const TEAMER2 = uid(0x105)   // member of TEAM
const MANAGER = uid(0x106)   // ASSIGNEE's manager (sees T_MAIN, never holds it)
const COLLAB = uid(0x107)    // collaborator on T_MAIN
const OUTSIDER = uid(0x108)  // member of B only
const USERS = [ASSIGNER, ASSIGNEE, OTHER, TEAMER, TEAMER2, MANAGER, COLLAB, OUTSIDER]
const TEAM = id(0x201)
const T_MAIN = id(0x301)
const T_TEAM = id(0x302)
const T_DONE = id(0x303)
const T_DRAFT = id(0x304)
const T_SUB = id(0x305)      // subtask of T_MAIN, also ASSIGNEE's
const T_B = id(0x306)
const T_TEMP = id(0x307)     // hard-deleted
const opts = { auth: { persistSession: false, autoRefreshToken: false } }

describe.skipIf(!DB_URL)('task reads / unread tasks (local database)', () => {
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
  /** Is it unread for this person (the SQL rule, as the service role asks)? */
  const unread = async (task: string, user: string) =>
    (await q('SELECT count(*)::int AS n FROM public.task_unread_ids($1, NULL, ARRAY[$2]::uuid[])', [user, task]))[0].n === 1
  const read = (task: string, user: string) => q('SELECT public.mark_tasks_read($1, NULL, ARRAY[$2]::uuid[]) AS n', [user, task])

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
      await db.query('DELETE FROM public.task_reads WHERE tenant_id = $1', [t]).catch(() => undefined)
      await db.query('DELETE FROM public.task_assignees WHERE tenant_id = $1', [t]).catch(() => undefined)
      await db.query('DELETE FROM public.tasks WHERE tenant_id = $1 AND parent_task_id IS NOT NULL', [t]).catch(() => undefined)
      await db.query('DELETE FROM public.tasks WHERE tenant_id = $1', [t]).catch(() => undefined)
      await db.query('DELETE FROM public.user_teams WHERE team_id IN (SELECT id FROM public.teams WHERE tenant_id = $1)', [t]).catch(() => undefined)
      await db.query('DELETE FROM public.teams WHERE tenant_id = $1', [t]).catch(() => undefined)
    }
    await db.query('DELETE FROM auth.users WHERE id = ANY($1::uuid[])', [USERS])
    await db.query('DELETE FROM public.tenants WHERE id = ANY($1::uuid[])', [[A, B, ...personal.filter((t: string | null) => t && ![A, B].includes(t))]])
    await db.query(`DELETE FROM public.tenants WHERE slug LIKE 'personal-7e0001%'`).catch(() => undefined)
  }

  const task = (tid: string, o: { tenant?: string; title: string; assignee?: string | null; team?: string | null; status?: string; parent?: string }) =>
    q(`INSERT INTO public.tasks (id, tenant_id, title, status, priority, assignee_id, assigner_id, assigned_team_id, parent_task_id, assignment_type)
       VALUES ($1, $2, $3, $4::task_status, 'medium', $5, $6, $7, $8, $9)`,
    [tid, o.tenant ?? A, o.title, o.status ?? 'todo', o.assignee ?? null, ASSIGNER, o.team ?? null, o.parent ?? null, o.team ? 'team' : 'individual'])

  // The services under test read through the service client (serviceRoleClient):
  // point it at the same stack (CI sets no NEXT_PUBLIC_SUPABASE_URL / service key).
  const prevEnv = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY }
  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = API_URL
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY
    await db.connect()
    await cleanup()
    await q(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Reads A', 'reads-a-test'), ($2, 'Reads B', 'reads-b-test')`, [A, B])
    for (const user of USERS) {
      await q(`INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`,
        [user, `r${user.slice(2, 8)}.${Date.now().toString(36)}@reads.test`])
      const homeTenant = user === OUTSIDER ? B : A
      await q(`INSERT INTO public.user_memberships (user_id, tenant_id, role) VALUES ($1, $2, 'member') ON CONFLICT (user_id, tenant_id) DO NOTHING`, [user, homeTenant])
      await q('UPDATE public.users SET current_tenant_id = $2, display_name = $3 WHERE id = $1', [user, homeTenant, `User ${user.slice(2, 8)}`])
    }
    await q('UPDATE public.user_memberships SET manager_user_id = $1 WHERE user_id = $2 AND tenant_id = $3', [MANAGER, ASSIGNEE, A])
    const roleId = async (tenant: string, slug: string) => (await q('SELECT id FROM public.roles WHERE tenant_id = $1 AND slug = $2', [tenant, slug]))[0].id as string
    const memberRole = await roleId(A, 'member')
    for (const user of USERS.filter((u) => u !== OUTSIDER)) await q('INSERT INTO public.user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3)', [A, user, memberRole])
    await q('INSERT INTO public.user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3)', [B, OUTSIDER, await roleId(B, 'member')])
    await q(`INSERT INTO public.teams (id, tenant_id, name) VALUES ($1, $2, 'Ops')`, [TEAM, A])
    await q('INSERT INTO public.user_teams (user_id, team_id) VALUES ($1, $2), ($3, $2)', [TEAMER, TEAM, TEAMER2])

    await task(T_MAIN, { title: 'Approve purchase request', assignee: ASSIGNEE })
    await task(T_SUB, { title: 'Check the quote', assignee: ASSIGNEE, parent: T_MAIN })
    await task(T_TEAM, { title: 'Team task', team: TEAM })
    await task(T_DONE, { title: 'Done task', assignee: ASSIGNEE, status: 'completed' })
    await task(T_DRAFT, { title: 'Draft task', assignee: ASSIGNEE, status: 'draft' })
    await task(T_B, { tenant: B, title: 'B task', assignee: OUTSIDER })
    await q(`INSERT INTO public.task_assignees (tenant_id, task_id, user_id) VALUES ($1, $2, $3)`, [A, T_MAIN, COLLAB])
  }, 60_000)

  afterAll(async () => {
    await cleanup().catch(() => undefined)
    await db.end()
    await pool.end()
    for (const [name, value] of [['NEXT_PUBLIC_SUPABASE_URL', prevEnv.url], ['SUPABASE_SERVICE_ROLE_KEY', prevEnv.key]] as const) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }, 60_000)

  /* ── the rule ──────────────────────────────────────────────────────── */

  it('a new task is unread for its holders (assignee, collaborator, team members) — not for people who only see it', async () => {
    expect(await unread(T_MAIN, ASSIGNEE)).toBe(true)
    expect(await unread(T_MAIN, COLLAB)).toBe(true)
    expect(await unread(T_TEAM, TEAMER)).toBe(true)
    expect(await unread(T_TEAM, TEAMER2)).toBe(true)
    for (const user of [MANAGER, ASSIGNER, OTHER]) expect(await unread(T_MAIN, user), user).toBe(false)
  })

  it('completed and draft tasks are never unread', async () => {
    expect(await unread(T_DONE, ASSIGNEE)).toBe(false)
    expect(await unread(T_DRAFT, ASSIGNEE)).toBe(false)
  })

  it('opening it marks it read; edits that are not routing (title, progress, fields) leave it read', async () => {
    expect((await read(T_MAIN, ASSIGNEE))[0].n).toBe(1)
    expect(await unread(T_MAIN, ASSIGNEE)).toBe(false)
    expect(await unread(T_MAIN, COLLAB)).toBe(true) // per person
    await q(`UPDATE public.tasks SET title = 'Approve purchase request (v2)', progress_pct = 40, status = 'in_progress', metadata = '{"x":1}' WHERE id = $1`, [T_MAIN])
    expect(await unread(T_MAIN, ASSIGNEE)).toBe(false)
    // Read again: a no-op (only unread tasks get a write).
    expect((await read(T_MAIN, ASSIGNEE))[0].n).toBe(0)
  })

  it('reassignment: the new assignee has it unread; reassigned back, it is unread again for the first person', async () => {
    await q('UPDATE public.tasks SET assignee_id = $2 WHERE id = $1', [T_MAIN, OTHER])
    expect(await unread(T_MAIN, OTHER)).toBe(true)
    expect(await unread(T_MAIN, ASSIGNEE)).toBe(false) // no longer holds it
    await read(T_MAIN, OTHER)
    await q('UPDATE public.tasks SET assignee_id = $2 WHERE id = $1', [T_MAIN, ASSIGNEE])
    expect(await unread(T_MAIN, ASSIGNEE)).toBe(true)
    expect(await unread(T_MAIN, OTHER)).toBe(false)
    await read(T_MAIN, ASSIGNEE)
  })

  it('sent back / reopened: completed → todo makes it unread again; completing clears it', async () => {
    await q(`UPDATE public.tasks SET status = 'completed', completed_at = now() WHERE id = $1`, [T_MAIN])
    expect(await unread(T_MAIN, ASSIGNEE)).toBe(false)
    await q(`UPDATE public.tasks SET status = 'todo', completed_at = NULL WHERE id = $1`, [T_MAIN])
    expect(await unread(T_MAIN, ASSIGNEE)).toBe(true)
    await read(T_MAIN, ASSIGNEE)
    // A draft published to someone is new to them.
    await q(`UPDATE public.tasks SET status = 'todo' WHERE id = $1`, [T_DRAFT])
    expect(await unread(T_DRAFT, ASSIGNEE)).toBe(true)
    await q(`UPDATE public.tasks SET status = 'draft' WHERE id = $1`, [T_DRAFT])
  })

  it('team tasks: read per member; once claimed, only the claimer holds it', async () => {
    await read(T_TEAM, TEAMER)
    expect(await unread(T_TEAM, TEAMER)).toBe(false)
    expect(await unread(T_TEAM, TEAMER2)).toBe(true)
    await q('UPDATE public.tasks SET assignee_id = $2 WHERE id = $1', [T_TEAM, TEAMER2])
    expect(await unread(T_TEAM, TEAMER2)).toBe(true)
    expect(await unread(T_TEAM, TEAMER)).toBe(false) // a claimed team task is no longer the team's
    await q('UPDATE public.tasks SET assignee_id = NULL WHERE id = $1', [T_TEAM]) // released back to the team
    expect(await unread(T_TEAM, TEAMER)).toBe(true)
  })

  it('claimTask: the claimer acted on it, so the claimed task is read for them', async () => {
    await home.claimTask(api(A, TEAMER, ['tasks.view_own', 'tasks.complete']), T_TEAM)
    expect((await q('SELECT assignee_id FROM public.tasks WHERE id = $1', [T_TEAM]))[0].assignee_id).toBe(TEAMER)
    expect(await unread(T_TEAM, TEAMER)).toBe(false)
  })

  it('collaborators: added after the routing, they have it unread from when they were added; declined holds nothing', async () => {
    await read(T_MAIN, COLLAB)
    expect(await unread(T_MAIN, COLLAB)).toBe(false)
    await q(`INSERT INTO public.task_assignees (tenant_id, task_id, user_id) VALUES ($1, $2, $3)`, [A, T_MAIN, OTHER])
    expect(await unread(T_MAIN, OTHER)).toBe(true) // OTHER read it while assignee, but was added since
    await q(`UPDATE public.task_assignees SET acceptance_status = 'declined' WHERE task_id = $1 AND user_id = $2`, [T_MAIN, OTHER])
    expect(await unread(T_MAIN, OTHER)).toBe(false)
    await q('DELETE FROM public.task_assignees WHERE task_id = $1 AND user_id = $2', [T_MAIN, OTHER])
  })

  it('routed_at cannot be moved by hand (the trigger keeps it)', async () => {
    const [{ routed_at: before }] = await q('SELECT routed_at FROM public.tasks WHERE id = $1', [T_MAIN])
    await q(`UPDATE public.tasks SET routed_at = now() + interval '1 day' WHERE id = $1`, [T_MAIN])
    const [{ routed_at: after }] = await q('SELECT routed_at FROM public.tasks WHERE id = $1', [T_MAIN])
    expect(new Date(after).getTime()).toBe(new Date(before).getTime())
  })

  /* ── RLS and guards ────────────────────────────────────────────────── */

  it('RLS: INSERT / UPDATE only your own row, for a task you can see, in a member workspace', async () => {
    const insert = (user: string, row: { user_id: string; task_id: string; tenant_id?: string }) =>
      as(user, 'INSERT INTO public.task_reads (tenant_id, user_id, task_id) VALUES ($1, $2, $3) ON CONFLICT (task_id, user_id) DO UPDATE SET seen_at = now() RETURNING tenant_id', [row.tenant_id ?? A, row.user_id, row.task_id])
    const ok = await insert(MANAGER, { user_id: MANAGER, task_id: T_MAIN })
    expect(ok.error).toBeNull()
    expect(ok.rows[0].tenant_id).toBe(A)
    expect((await insert(ASSIGNEE, { user_id: ASSIGNEE, task_id: T_MAIN })).error).toBeNull() // upsert over an existing row (UPDATE)
    expect((await insert(OTHER, { user_id: OTHER, task_id: T_TEAM })).error?.code).toBe('42501') // can't see it
    expect((await insert(OTHER, { user_id: ASSIGNEE, task_id: T_MAIN })).error?.code).toBe('42501') // someone else's row
    expect((await insert(ASSIGNEE, { user_id: ASSIGNEE, task_id: T_B })).error?.code).toBe('42501')
    expect((await insert(ASSIGNEE, { user_id: ASSIGNEE, task_id: T_B, tenant_id: A })).error?.code).toBe('42501') // tenant spoof: the trigger sets B
    expect((await insert(OUTSIDER, { user_id: OUTSIDER, task_id: T_MAIN, tenant_id: B })).error?.code).toBe('42501')
  })

  it('RLS: SELECT and DELETE your own rows only', async () => {
    await read(T_MAIN, COLLAB)
    const mine = await as(ASSIGNEE, 'SELECT user_id FROM public.task_reads')
    expect(new Set(mine.rows.map((r) => r.user_id))).toEqual(new Set([ASSIGNEE]))
    expect((await as(OUTSIDER, 'SELECT count(*)::int AS n FROM public.task_reads')).rows[0].n).toBe(0)
    const del = await as(ASSIGNEE, 'DELETE FROM public.task_reads WHERE task_id = $1 RETURNING user_id', [T_MAIN])
    expect(del.rows.map((r) => r.user_id)).toEqual([ASSIGNEE]) // not COLLAB's
    const upd = await as(ASSIGNEE, 'UPDATE public.task_reads SET seen_at = now() WHERE user_id = $1 RETURNING user_id', [COLLAB])
    expect(upd.rows).toEqual([])
  })

  it('a signed-in caller can only ask about, or write for, themselves; anon can call nothing', async () => {
    expect((await as(OTHER, 'SELECT count(*)::int AS n FROM public.task_unread_ids($1, NULL, NULL)', [COLLAB])).rows[0].n).toBe(0)
    expect((await as(OTHER, 'SELECT public.mark_tasks_read($1, NULL, NULL) AS n', [TEAMER2])).rows[0].n).toBe(0)
    expect((await as(OTHER, 'SELECT public.task_unread_count($1, NULL, true) AS n', [TEAMER2])).rows[0].n).toBe(0)
    expect((await as(TEAMER2, 'SELECT public.task_unread_count($1, NULL, true) AS n', [TEAMER2])).rows[0].n).toBeGreaterThanOrEqual(0)
    for (const sql of ['SELECT * FROM public.task_unread_ids($1, NULL, NULL)', 'SELECT public.mark_tasks_read($1, NULL, NULL)', 'SELECT * FROM public.task_reads']) {
      await db.query('BEGIN')
      const error = await db.query('SET LOCAL ROLE anon').then(() => db.query(sql, sql.includes('$1') ? [ASSIGNEE] : [])).then(() => null, (e) => e)
      await db.query('ROLLBACK')
      expect(error?.code, sql).toBe('42501')
    }
  })

  /* ── service ───────────────────────────────────────────────────────── */

  it('API caller: mark unread / read, idempotent; 404 for tasks you cannot see or in another workspace; 403 without a user', async () => {
    const me = api(A, ASSIGNEE)
    expect(await reads.markTaskUnread(me, T_MAIN)).toEqual({ task_id: T_MAIN, unread: true })
    expect(await reads.markTaskUnread(me, T_MAIN)).toEqual({ task_id: T_MAIN, unread: true })
    expect(await reads.isTaskUnreadFor(me, T_MAIN)).toBe(true)
    expect(await reads.markTaskRead(me, T_MAIN)).toEqual({ task_id: T_MAIN, unread: false })
    expect(await reads.isTaskUnreadFor(me, T_MAIN)).toBe(false)
    // A task I can see but don't hold stays read; a closed one too.
    expect(await reads.markTaskUnread(api(A, MANAGER), T_MAIN)).toEqual({ task_id: T_MAIN, unread: false })
    expect(await reads.markTaskUnread(me, T_DONE)).toEqual({ task_id: T_DONE, unread: false })
    await expect(reads.markTaskRead(api(A, OTHER), T_TEAM)).rejects.toMatchObject({ status: 404 })
    await expect(reads.markTaskRead(me, T_B)).rejects.toMatchObject({ status: 404 })
    await expect(reads.markTaskUnread(api(B, OUTSIDER), T_MAIN)).rejects.toMatchObject({ status: 404 })
    await expect(reads.markTaskRead(me, 'not-a-uuid')).rejects.toMatchObject({ status: 404 })
    await expect(reads.markTaskRead(api(A, null), T_MAIN)).rejects.toMatchObject({ status: 403 })
    await expect(reads.markAllTasksRead(api(A, null))).rejects.toMatchObject({ status: 403 })
    // No person: nothing is unread (list rows say false).
    expect(await reads.unreadTaskIds(api(A, null), [T_MAIN])).toEqual(new Set())
  })

  it('count and Mark all as read (top-level tasks, this workspace)', async () => {
    const me = api(A, ASSIGNEE)
    await reads.markTaskUnread(me, T_MAIN)
    await q('DELETE FROM public.task_reads WHERE task_id = $1 AND user_id = $2', [T_SUB, ASSIGNEE])
    expect(await unread(T_SUB, ASSIGNEE)).toBe(true)
    // The subtask is unread but not counted (My tasks lists top-level tasks).
    expect(await reads.countUnreadTasks(me)).toEqual({ unread: 1 })
    expect((await home.getNavCounts({ ...me, permissions: new Set(['tasks.view_own']) })).unread).toBe(1)
    expect(await reads.markAllTasksRead(me)).toEqual({ marked: 2 })
    expect(await reads.countUnreadTasks(me)).toEqual({ unread: 0 })
    expect(await reads.markAllTasksRead(me)).toEqual({ marked: 0 })
    // Another workspace's caller marks nothing here.
    expect(await reads.markAllTasksRead(api(B, OUTSIDER))).toEqual({ marked: 1 })
    expect(await unread(T_B, OUTSIDER)).toBe(false)
  })

  it('signed-in user (RLS client): opens, marks unread, sees unread on the My tasks rows and Home, marks all read', async () => {
    const me = session(A, COLLAB)
    await q('DELETE FROM public.task_reads WHERE task_id = $1 AND user_id = $2', [T_MAIN, COLLAB])
    const list = async () => {
      const rows = await (UI_READS as any)['tasks.list'].run(me, { mine: true })
      return new Map((rows as any[]).map((r) => [r.id, r.unread]))
    }
    expect((await list()).get(T_MAIN)).toBe(true)
    const homeRows = (await home.listMyTasks(me, { include_queued: true }, { limit: 25, offset: 0 })).tasks
    expect(homeRows.find((t) => t.id === T_MAIN)?.unread).toBe(true)

    expect(await reads.markTaskRead(me, T_MAIN)).toEqual({ task_id: T_MAIN, unread: false })
    expect((await list()).get(T_MAIN)).toBe(false)
    expect(await reads.markTaskUnread(me, T_MAIN)).toEqual({ task_id: T_MAIN, unread: true })
    expect((await list()).get(T_MAIN)).toBe(true)
    await expect(reads.markTaskRead(me, T_B)).rejects.toMatchObject({ status: 404 })
    expect(await reads.countUnreadTasks(me)).toEqual({ unread: 1 })
    expect(await reads.markAllTasksRead(me)).toEqual({ marked: 1 })
    expect((await list()).get(T_MAIN)).toBe(false)
  })

  it('hard-deleting a task removes its reads (FK cascade)', async () => {
    await task(T_TEMP, { title: 'Temporary', assignee: ASSIGNEE })
    await read(T_TEMP, ASSIGNEE)
    expect((await q('SELECT count(*)::int AS n FROM public.task_reads WHERE task_id = $1', [T_TEMP]))[0].n).toBe(1)
    await q('DELETE FROM public.tasks WHERE id = $1', [T_TEMP])
    expect((await q('SELECT count(*)::int AS n FROM public.task_reads WHERE task_id = $1', [T_TEMP]))[0].n).toBe(0)
  })
})
