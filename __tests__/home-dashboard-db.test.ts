/**
 * Home (/home) against a LOCAL Supabase stack (migration
 * 20261217000000_home_dashboard.sql + lib/services/home.ts):
 *  - metrics: my tasks (open, overdue, completed in 30 days, queue),
 *    submissions in progress / completed, followed runs;
 *  - My tasks with process + stage; Task queue (accept / claim) and the
 *    claim rules (team members only, first claim wins);
 *  - Following: auto-follow of runs I start (preference off → no follow;
 *    sub-workflows never), follow only runs I can see, RLS on run_followers;
 *  - My submissions: the run each started, its current stage and assignees;
 *  - the submitter-safe progress view: no configs, outputs, errors,
 *    variables or form values; others get 404;
 *  - favourites: RLS, only forms I can open, hidden when access is revoked;
 *  - tenant isolation (other workspaces, signed-in callers asking for others);
 *  - a performance smoke on seeded volume (2,000 tasks, 500 submissions).
 *
 * Runs only when EVENT_STREAM_DB_URL is set, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/home-dashboard-db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client } from 'pg'
import { createClient } from './helpers/db-test-client'

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))

import * as home from '@/lib/services/home'
import type { ServiceContext } from '@/lib/services/context'

/* eslint-disable @typescript-eslint/no-explicit-any -- rows are loose JSON */

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.LOCKDOWN_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.LOCKDOWN_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const id = (n: number) => `bd0bd000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
// Personal workspaces take the first 8 characters of the user id as slug: keep those distinct.
const uid = (n: number) => `bd${n.toString(16).padStart(6, '0')}-0000-4000-8000-0000000000bd`
const A = id(0xa)
const B = id(0xb)
const SUB = uid(0x101)       // submitter (member)
const ASSIGNEE = uid(0x102)  // has the approval task
const ADMIN = uid(0x103)     // workflows.view_runs
const OTHER = uid(0x104)     // member, unrelated
const TEAMER = uid(0x105)    // team member (queue / claim)
const OUTSIDER = uid(0x106)  // workspace B
const NOAUTO = uid(0x107)    // auto-follow off
const USERS = [SUB, ASSIGNEE, ADMIN, OTHER, TEAMER, OUTSIDER, NOAUTO]
const TEAM = id(0x201)
const WF = id(0x301)
const VERSION = id(0x302)
const FORM_A = id(0x401)
const FORM_B = id(0x402)
const SUBMISSION = id(0x501)
const SUBMISSION_DONE = id(0x502)
const RUN = id(0x601)
const RUN_DONE = id(0x602)
const RUN_SUB = id(0x603)     // sub-workflow run started by SUB: never auto-followed
const RUN_NOAUTO = id(0x604)
const RUN_OTHER = id(0x605)   // nobody here is involved
const T_APPROVE = id(0x701)
const T_TEAM = id(0x702)
const T_MINE = id(0x703)
const T_OVERDUE = id(0x704)
const T_DONE = id(0x705)
const T_PENDING = id(0x706)
const SECRET = 'TOP-SECRET-7f3a'
const opts = { auth: { persistSession: false, autoRefreshToken: false } }

const NODES = [
  { id: 'start', type: 'form_submitted', label: 'Form submitted', position: { x: 0, y: 0 }, config: { form_id: FORM_A } },
  { id: 'check', type: 'http_request', label: 'Check budget', position: { x: 0, y: 150 }, config: { url: `https://internal.example/${SECRET}`, method: 'POST', headers: { Authorization: SECRET } } },
  { id: 'approve', type: 'user_task', label: 'Manager approval', position: { x: 0, y: 300 }, config: { title: `Approve ${SECRET}`, outcomes: ['Approve', 'Reject'], node_color: '#336699' } },
  { id: 'notify', type: 'send_email', label: 'Tell requester', position: { x: 0, y: 450 }, config: { to: `${SECRET}@example.com` } },
]
const EDGES = [
  { id: 'e1', source: 'start', target: 'check' },
  { id: 'e2', source: 'check', target: 'approve' },
  { id: 'e3', source: 'approve', target: 'notify', label: 'Approve' },
]

describe.skipIf(!DB_URL)('home dashboard (local stack)', () => {
  const db = new Client({ connectionString: DB_URL })
  const admin = createClient(API_URL, SERVICE_KEY, opts)
  const member = ['tasks.view_own', 'tasks.complete', 'forms.submit', 'forms.view']
  const ctx = (tenantId: string, actorId: string | null, permissions: string[] = member): ServiceContext =>
    ({ supabase: admin, db: admin, tenantId, actorId, permissions: new Set(permissions), authKind: 'api_key', source: 'api' } as ServiceContext)
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
      await db.query('DELETE FROM public.run_followers WHERE tenant_id = $1', [t]).catch(() => undefined)
      await db.query('DELETE FROM public.form_favorites WHERE tenant_id = $1', [t]).catch(() => undefined)
      await db.query('DELETE FROM public.tasks WHERE tenant_id = $1', [t]).catch(() => undefined)
      await db.query('DELETE FROM public.workflow_runs WHERE tenant_id = $1', [t]).catch(() => undefined)
      await db.query('DELETE FROM public.form_submissions WHERE tenant_id = $1', [t]).catch(() => undefined)
      await db.query('DELETE FROM public.user_teams WHERE team_id IN (SELECT id FROM public.teams WHERE tenant_id = $1)', [t]).catch(() => undefined)
      for (const table of ['workflow_versions', 'workflows', 'forms', 'teams', 'object_audit_log']) {
        await db.query(`DELETE FROM public.${table} WHERE tenant_id = $1`, [t]).catch((e) => console.warn(`[home test cleanup] ${table}: ${e.message}`))
      }
    }
    await db.query('DELETE FROM auth.users WHERE id = ANY($1::uuid[])', [USERS])
    await db.query('DELETE FROM public.tenants WHERE id = ANY($1::uuid[])', [[A, B, ...personal.filter((t: string | null) => t && ![A, B].includes(t))]])
    // Personal workspaces left by an interrupted run.
    await db.query(`DELETE FROM public.tenants WHERE slug LIKE 'personal-bd0001%'`).catch(() => undefined)
  }

  const run = (rid: string, o: { status: string; started_by?: string | null; via?: string; submission?: string | null; event?: string | null; paused?: string | null; completed?: boolean; tenant?: string }) =>
    q(`INSERT INTO public.workflow_runs (id, workflow_id, tenant_id, status, version_id, started_by, started_via, form_submission_id, event_id, paused_node_id, paused_at, completed_at,
         node_results, pause_variables, execution_trace)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CASE WHEN $10::text IS NULL THEN NULL ELSE now() - interval '1 hour' END, CASE WHEN $11 THEN now() - interval '2 days' END,
         $12::jsonb, $13::jsonb, '[]'::jsonb)`,
    [rid, WF, o.tenant ?? A, o.status, VERSION, o.started_by ?? null, o.via ?? 'form', o.submission ?? null, o.event ?? null, o.paused ?? null, o.completed === true,
      JSON.stringify({ start: { status: 'success', output: { amount: SECRET } }, check: { status: 'success', output: { body: SECRET }, error: SECRET } }),
      JSON.stringify({ requester_note: SECRET, form_values: { salary: SECRET } })])

  beforeAll(async () => {
    await db.connect()
    await cleanup()
    await q(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Home A', 'home-a-test'), ($2, 'Home B', 'home-b-test')`, [A, B])
    const names: Record<string, string> = { [SUB]: 'Sam Submitter', [ASSIGNEE]: 'Ann Approver', [ADMIN]: 'Ada Admin', [OTHER]: 'Olly Other', [TEAMER]: 'Tia Team', [OUTSIDER]: 'Oscar Outside', [NOAUTO]: 'Nora Noauto' }
    for (const user of USERS) {
      await q(`INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`,
        [user, `h${user.slice(2, 8)}.${Date.now().toString(36)}@home.test`])
      const home_ = user === OUTSIDER ? B : A
      await q(`INSERT INTO public.user_memberships (user_id, tenant_id, role) VALUES ($1, $2, 'member') ON CONFLICT (user_id, tenant_id) DO NOTHING`, [user, home_])
      await q('UPDATE public.users SET current_tenant_id = $2, display_name = $3 WHERE id = $1', [user, home_, names[user]])
    }
    await q(`UPDATE public.users SET preferences = coalesce(preferences, '{}'::jsonb) || '{"auto_follow_runs": false}' WHERE id = $1`, [NOAUTO])
    const roleId = async (tenant: string, slug: string) => (await q('SELECT id FROM public.roles WHERE tenant_id = $1 AND slug = $2', [tenant, slug]))[0].id as string
    const memberRole = await roleId(A, 'member')
    for (const user of [SUB, ASSIGNEE, OTHER, TEAMER, NOAUTO]) await q('INSERT INTO public.user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3)', [A, user, memberRole])
    await q('INSERT INTO public.user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3)', [A, ADMIN, await roleId(A, 'admin')])
    await q('INSERT INTO public.user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3)', [B, OUTSIDER, await roleId(B, 'member')])
    await q(`INSERT INTO public.teams (id, tenant_id, name) VALUES ($1, $2, 'Finance')`, [TEAM, A])
    await q('INSERT INTO public.user_teams (user_id, team_id) VALUES ($1, $2)', [TEAMER, TEAM])

    await q(`INSERT INTO public.forms (id, tenant_id, name, description, fields) VALUES ($1, $3, 'Expense claim', 'Claim expenses', '[{"key":"salary","label":"Salary","type":"text"}]'), ($2, $4, 'B form', null, '[]')`, [FORM_A, FORM_B, A, B])
    await q(`INSERT INTO public.workflows (id, tenant_id, name, nodes, edges) VALUES ($1, $2, 'Expense approval', $3::jsonb, $4::jsonb)`, [WF, A, JSON.stringify(NODES), JSON.stringify(EDGES)])
    await q(`INSERT INTO public.workflow_versions (id, workflow_id, tenant_id, version_number, trigger_type, nodes, edges) VALUES ($1, $2, $3, 1, 'form_submitted', $4::jsonb, $5::jsonb)`, [VERSION, WF, A, JSON.stringify(NODES), JSON.stringify(EDGES)])
    await q(`INSERT INTO public.form_submissions (id, tenant_id, form_id, form_name, submitted_by, values, created_at) VALUES
      ($1, $3, $4, 'Expense claim', $5, $6::jsonb, now() - interval '3 hours'),
      ($2, $3, $4, 'Expense claim', $5, '{}'::jsonb, now() - interval '3 days')`, [SUBMISSION, SUBMISSION_DONE, A, FORM_A, SUB, JSON.stringify({ salary: SECRET })])

    await run(RUN, { status: 'waiting_for_event', started_by: SUB, submission: SUBMISSION, event: 'evt_home_1', paused: 'approve' })
    await run(RUN_DONE, { status: 'completed', started_by: SUB, submission: SUBMISSION_DONE, completed: true })
    await run(RUN_SUB, { status: 'running', started_by: SUB, via: 'subworkflow' })
    await run(RUN_NOAUTO, { status: 'running', started_by: NOAUTO, via: 'ui' })
    await run(RUN_OTHER, { status: 'running', started_by: null, via: 'schedule' })

    const task = (tid: string, o: { title: string; assignee?: string | null; team?: string | null; status?: string; due?: string | null; run?: string | null; step?: string | null; event?: string | null; acceptance?: string; completed?: boolean }) =>
      q(`INSERT INTO public.tasks (id, tenant_id, title, status, priority, assignee_id, assigned_team_id, due_date, workflow_run_id, workflow_id, workflow_step_id, event_id, is_workflow_task, acceptance_status, completed_at, assignment_type)
         VALUES ($1, $2, $3, $4::task_status, 'high', $5, $6, $7, $8, $9, $10, $11, $12, $13, CASE WHEN $14 THEN now() - interval '1 day' END, $15)`,
      [tid, A, o.title, o.status ?? 'todo', o.assignee ?? null, o.team ?? null, o.due ?? null, o.run ?? null, o.run ? WF : null, o.step ?? null, o.event ?? null, !!o.run, o.acceptance ?? 'accepted', o.completed === true, o.team ? 'team' : 'individual'])
    await task(T_APPROVE, { title: `Approve claim ${SECRET}`, assignee: ASSIGNEE, run: RUN, step: 'approve', event: 'evt_home_1', due: new Date(Date.now() + 86_400_000).toISOString() })
    await task(T_TEAM, { title: 'Team review', team: TEAM })
    await task(T_MINE, { title: 'Prepare report', assignee: SUB, run: RUN, step: 'approve' })
    await task(T_OVERDUE, { title: 'Overdue thing', assignee: SUB, due: new Date(Date.now() - 86_400_000).toISOString() })
    await task(T_DONE, { title: 'Done thing', assignee: SUB, status: 'completed', completed: true })
    await task(T_PENDING, { title: 'Please accept', assignee: SUB, acceptance: 'pending' })
  }, 60_000)

  afterAll(async () => {
    await cleanup().catch(() => undefined)
    await db.end()
  })

  /* ── auto-follow ───────────────────────────────────────────────────── */

  it('auto-follows runs a person starts (form submissions included), not sub-workflows, not with the preference off', async () => {
    const rows = await q('SELECT user_id, run_id, source FROM public.run_followers WHERE tenant_id = $1 ORDER BY run_id', [A])
    const pairs = rows.map((r: any) => `${r.user_id}:${r.run_id}:${r.source}`)
    expect(pairs).toContain(`${SUB}:${RUN}:auto`)
    expect(pairs).toContain(`${SUB}:${RUN_DONE}:auto`)
    expect(pairs.some((p: string) => p.includes(RUN_SUB))).toBe(false)
    expect(pairs.some((p: string) => p.includes(RUN_NOAUTO))).toBe(false)
    expect(pairs.some((p: string) => p.includes(RUN_OTHER))).toBe(false)
  })

  it('the auto-follow preference round-trips through the service', async () => {
    // auto_follow_acted_runs ("Follow processes I act on", task-views-review) defaults on and is independent.
    expect(await home.getHomePreferences(ctx(A, NOAUTO))).toEqual({ auto_follow_runs: false, auto_follow_acted_runs: true })
    expect(await home.getHomePreferences(ctx(A, SUB))).toEqual({ auto_follow_runs: true, auto_follow_acted_runs: true })
    await home.setHomePreferences(ctx(A, OTHER), { auto_follow_runs: false })
    expect(await home.getHomePreferences(ctx(A, OTHER))).toEqual({ auto_follow_runs: false, auto_follow_acted_runs: true })
    await home.setHomePreferences(ctx(A, OTHER), { auto_follow_acted_runs: false })
    expect(await home.getHomePreferences(ctx(A, OTHER))).toEqual({ auto_follow_runs: false, auto_follow_acted_runs: false })
    await home.setHomePreferences(ctx(A, OTHER), { auto_follow_runs: true, auto_follow_acted_runs: true })
  })

  /* ── metrics ───────────────────────────────────────────────────────── */

  it('counts my tasks: open (not pending acceptance), overdue, completed in 30 days, queue', async () => {
    expect(await home.getTaskMetrics(ctx(A, SUB))).toMatchObject({ open: 2, overdue: 1, completed_30d: 1, queue: 1 })
    expect(await home.getTaskMetrics(ctx(A, TEAMER))).toMatchObject({ open: 0, queue: 1 })
    expect(await home.getTaskMetrics(ctx(A, OTHER))).toMatchObject({ open: 0, overdue: 0, completed_30d: 0, queue: 0 })
  })

  it('counts my submissions in progress / completed and the runs I follow', async () => {
    expect(await home.getSubmissionMetrics(ctx(A, SUB))).toMatchObject({ in_progress: 1, completed_30d: 1, submitted_30d: 2 })
    expect(await home.getSubmissionMetrics(ctx(A, OTHER))).toMatchObject({ in_progress: 0, completed_30d: 0 })
    expect(await home.getFollowMetrics(ctx(A, SUB))).toMatchObject({ active: 1, total: 2 })
    expect(await home.getFollowMetrics(ctx(A, SUB))).toHaveProperty('updated_today')
  })

  it('needs a person: tenant-wide credentials are refused', async () => {
    await expect(home.getFollowMetrics(ctx(A, null))).rejects.toThrow(/bound to a user/)
  })

  /* ── My tasks / queue / claim ──────────────────────────────────────── */

  it('My tasks: my open tasks with process and stage, nobody else’s', async () => {
    const { tasks, total } = await home.listMyTasks(ctx(A, SUB), {}, { limit: 25, offset: 0 })
    expect(total).toBe(2)
    expect(tasks.map((t) => t.title).sort()).toEqual(['Overdue thing', 'Prepare report'])
    const wfTask = tasks.find((t) => t.id === T_MINE)!
    expect(wfTask.process?.name).toBe('Expense approval')
    expect(wfTask.stage).toBe('Manager approval')
    expect(tasks.find((t) => t.id === T_OVERDUE)!.overdue).toBe(true)
    // Search and sort.
    expect((await home.listMyTasks(ctx(A, SUB), { search: 'report' }, { limit: 25, offset: 0 })).tasks.map((t) => t.id)).toEqual([T_MINE])
    expect((await home.listMyTasks(ctx(A, OTHER), {}, { limit: 25, offset: 0 })).total).toBe(0)
  })

  it('Task queue: pending acceptance → accept; my teams’ unassigned tasks → claim', async () => {
    expect((await home.listQueueTasks(ctx(A, SUB), {}, { limit: 25, offset: 0 })).tasks.map((t) => [t.id, t.action])).toEqual([[T_PENDING, 'accept']])
    const team = await home.listQueueTasks(ctx(A, TEAMER), {}, { limit: 25, offset: 0 })
    expect(team.tasks.map((t) => [t.id, t.action, t.team])).toEqual([[T_TEAM, 'claim', 'Finance']])
    expect((await home.listQueueTasks(ctx(A, OTHER), {}, { limit: 25, offset: 0 })).total).toBe(0)
  })

  it('Unified My tasks (include_queued): my tasks plus the queued ones, each queued row with its action', async () => {
    const mine = await home.listMyTasks(ctx(A, SUB), { include_queued: true }, { limit: 25, offset: 0 })
    expect(mine.total).toBe(3)
    expect(Object.fromEntries(mine.tasks.map((t) => [t.id, t.action ?? null]))).toEqual({ [T_MINE]: null, [T_OVERDUE]: null, [T_PENDING]: 'accept' })
    const team = await home.listMyTasks(ctx(A, TEAMER), { include_queued: true }, { limit: 25, offset: 0 })
    expect(team.tasks.map((t) => [t.id, t.action])).toEqual([[T_TEAM, 'claim']])
    // queued_only = the queue list.
    expect((await home.listMyTasks(ctx(A, SUB), { queued_only: true }, { limit: 25, offset: 0 })).tasks.map((t) => t.id)).toEqual([T_PENDING])
    expect((await home.listMyTasks(ctx(A, OTHER), { include_queued: true }, { limit: 25, offset: 0 })).total).toBe(0)
  })

  it('Claim: team members only; the first claim wins', async () => {
    await expect(home.claimTask(ctx(A, OTHER), T_TEAM)).rejects.toThrow(/team/)
    await expect(home.claimTask(ctx(B, OUTSIDER), T_TEAM)).rejects.toThrow(/not found/i)
    await expect(home.claimTask(ctx(A, TEAMER, ['tasks.view_own']), T_TEAM)).rejects.toThrow(/tasks.complete/)
    expect(await home.claimTask(ctx(A, TEAMER), T_TEAM)).toEqual({ claimed: true, task_id: T_TEAM })
    const [row] = await q('SELECT assignee_id, acceptance_status, status FROM public.tasks WHERE id = $1', [T_TEAM])
    expect(row).toMatchObject({ assignee_id: TEAMER, acceptance_status: 'accepted', status: 'in_progress' })
    await q(`INSERT INTO public.user_teams (user_id, team_id) VALUES ($1, $2)`, [OTHER, TEAM])
    await expect(home.claimTask(ctx(A, OTHER), T_TEAM)).rejects.toThrow(/already claimed/)
    await q('DELETE FROM public.user_teams WHERE user_id = $1 AND team_id = $2', [OTHER, TEAM])
    expect((await home.listMyTasks(ctx(A, TEAMER), {}, { limit: 25, offset: 0 })).tasks.map((t) => t.id)).toContain(T_TEAM)
  })

  /* ── My submissions ────────────────────────────────────────────────── */

  it('My submissions: each with its run, current stage and the people it is with', async () => {
    const { submissions, total } = await home.listMySubmissions(ctx(A, SUB), {}, { limit: 25, offset: 0 })
    expect(total).toBe(2)
    const live = submissions.find((s) => s.submission_id === SUBMISSION)!
    expect(live).toMatchObject({ run_id: RUN, status: 'waiting', process: { name: 'Expense approval' }, following: true })
    expect(live.stages.map((s) => s.name)).toEqual(['Manager approval', 'Manager approval'])
    expect(live.people).toEqual(['Ann Approver', 'Sam Submitter'])
    expect(live.status_label).toBe('Waiting on Manager approval')
    const done = submissions.find((s) => s.submission_id === SUBMISSION_DONE)!
    expect(done).toMatchObject({ run_id: RUN_DONE, status: 'completed', stages: [] })
    expect((await home.listMySubmissions(ctx(A, SUB), { status: 'active' }, { limit: 25, offset: 0 })).submissions.map((s) => s.submission_id)).toEqual([SUBMISSION])
    expect((await home.listMySubmissions(ctx(A, SUB), { status: 'completed' }, { limit: 25, offset: 0 })).submissions.map((s) => s.submission_id)).toEqual([SUBMISSION_DONE])
    // Never in the list: values.
    expect(JSON.stringify(submissions)).not.toContain(SECRET)
  })

  it('My submissions: only my own (others, admins and other workspaces see none of them)', async () => {
    expect((await home.listMySubmissions(ctx(A, OTHER), {}, { limit: 25, offset: 0 })).total).toBe(0)
    expect((await home.listMySubmissions(ctx(A, ADMIN), {}, { limit: 25, offset: 0 })).total).toBe(0)
    expect((await home.listMySubmissions(ctx(B, OUTSIDER), {}, { limit: 25, offset: 0 })).total).toBe(0)
    // A signed-in caller cannot ask the SQL function for someone else's.
    const asked = await as(OTHER, 'SELECT * FROM public.list_my_submissions($1, $2)', [A, SUB])
    expect(asked.rows).toEqual([])
  })

  /* ── Submitter-safe progress view ──────────────────────────────────── */

  it('the progress view shows steps, statuses, assignees and dates — and nothing internal', async () => {
    const p = await home.getRunProgress(ctx(A, SUB), RUN)
    expect(p.process.name).toBe('Expense approval')
    expect(p.run.status).toBe('waiting')
    expect(p.flow.nodes.map((n) => n.label)).toEqual(['Form submitted', 'Check budget', 'Manager approval', 'Tell requester'])
    for (const n of p.flow.nodes) {
      expect(Object.keys(n.config).every((k) => ['__safe', '__branch_labels', 'node_color', 'node_icon_svg', 'node_icon_url', 'node_icon_lucide', 'node_icon_color'].includes(k))).toBe(true)
    }
    expect(p.flow.nodes.find((n) => n.id === 'approve')!.config).toMatchObject({ node_color: '#336699', __branch_labels: ['Approve', 'Reject'] })
    expect(p.flow.overlay.nodes.approve?.current).toBe(true)
    expect(p.flow.overlay.nodes.check?.status).toBe('completed')
    expect(p.stages.map((s) => s.name)).toContain('Manager approval')
    expect(p.steps.find((s) => s.name === 'Manager approval' && s.assignees.includes('Ann Approver'))).toBeTruthy()
    expect(p.submission?.id).toBe(SUBMISSION)
    expect(p.can_view_full).toBe(false)
    // Process view task links: the submitter sees who has the waiting step, but can't open / act on it.
    const waiting = p.tasks.find((t) => t.open && t.step_name === 'Manager approval')!
    expect(waiting).toMatchObject({ can_open: false, can_act: 'none', href: null, title: null })
    expect(waiting.assignees.map((a) => a.name)).toContain('Ann Approver')
    // No configs, outputs, errors, variables, form values or task titles anywhere.
    const json = JSON.stringify(p)
    expect(json).not.toContain(SECRET)
    expect(json).not.toContain('internal.example')
  })

  it('the progress view: people with a task in the run and run viewers see it; others get 404', async () => {
    const mine = await home.getRunProgress(ctx(A, ASSIGNEE), RUN)
    expect(mine.submission).toBeNull()
    expect(mine.tasks.find((t) => t.open && t.step_name === 'Manager approval')).toMatchObject({ can_open: true, access: 'assignee' })
    expect((await home.getRunProgress(ctx(A, ADMIN, ['tasks.view_own', 'workflows.view_runs']), RUN)).can_view_full).toBe(true)
    await expect(home.getRunProgress(ctx(A, OTHER), RUN)).rejects.toThrow(/not found/i)
    await expect(home.getRunProgress(ctx(B, OUTSIDER), RUN)).rejects.toThrow(/not found/i)
    // Even naming workspace A: the outsider is not a member there.
    await expect(home.getRunProgress(ctx(A, OUTSIDER), RUN)).rejects.toThrow(/not found/i)
  })

  /* ── Following ─────────────────────────────────────────────────────── */

  it('Following: only runs I can see; follow / unfollow are idempotent', async () => {
    await expect(home.setRunFollowed(ctx(A, OTHER), RUN, true)).rejects.toThrow(/not found/i)
    await expect(home.setRunFollowed(ctx(A, OTHER), RUN_OTHER, true)).rejects.toThrow(/not found/i)
    expect(await home.setRunFollowed(ctx(A, ASSIGNEE), RUN, true)).toEqual({ run_id: RUN, following: true })
    expect(await home.setRunFollowed(ctx(A, ASSIGNEE), RUN, true)).toEqual({ run_id: RUN, following: true })
    const { runs } = await home.listFollowedRuns(ctx(A, ASSIGNEE), {}, { limit: 25, offset: 0 })
    expect(runs.map((r) => [r.run_id, r.follow_source, r.status])).toEqual([[RUN, 'manual', 'waiting']])
    expect(runs[0].people).toContain('Ann Approver')
    expect(await home.setRunFollowed(ctx(A, ASSIGNEE), RUN, false)).toEqual({ run_id: RUN, following: false })
    expect((await home.listFollowedRuns(ctx(A, ASSIGNEE), {}, { limit: 25, offset: 0 })).total).toBe(0)
    // An admin with workflows.view_runs may follow any run of the workspace.
    expect(await home.setRunFollowed(ctx(A, ADMIN), RUN_OTHER, true)).toEqual({ run_id: RUN_OTHER, following: true })
    const sub = await home.listFollowedRuns(ctx(A, SUB), { status: 'active' }, { limit: 25, offset: 0 })
    expect(sub.runs.map((r) => r.run_id)).toEqual([RUN])
  })

  it('run_followers RLS: own rows only, and only for runs the caller can see', async () => {
    expect((await as(OTHER, 'INSERT INTO public.run_followers (tenant_id, user_id, run_id) VALUES ($1, $2, $3)', [A, OTHER, RUN])).error?.code).toBe('42501')
    expect((await as(OTHER, 'INSERT INTO public.run_followers (tenant_id, user_id, run_id) VALUES ($1, $2, $3)', [A, SUB, RUN])).error?.code).toBe('42501')
    expect((await as(ASSIGNEE, 'INSERT INTO public.run_followers (tenant_id, user_id, run_id) VALUES ($1, $2, $3) RETURNING tenant_id', [B, ASSIGNEE, RUN])).rows[0]?.tenant_id).toBe(A)
    expect((await as(OTHER, 'SELECT * FROM public.run_followers WHERE user_id = $1', [SUB])).rows).toEqual([])
    expect((await as(SUB, 'SELECT run_id FROM public.run_followers WHERE user_id = $1', [SUB])).rows.length).toBeGreaterThanOrEqual(2)
    expect((await as(OUTSIDER, 'SELECT public.can_view_run_progress($1, $2) AS ok', [RUN, SUB])).rows[0].ok).toBe(false)
    expect((await as(SUB, 'SELECT * FROM public.list_followed_runs($1, $2)', [A, ASSIGNEE])).rows).toEqual([])
  })

  /* ── Favourites ────────────────────────────────────────────────────── */

  it('favourites: only forms I can open; hidden when access is revoked; other workspaces never', async () => {
    expect(await home.setFormFavorite(ctx(A, SUB), FORM_A, true)).toEqual({ form_id: FORM_A, favorite: true })
    expect(await home.setFormFavorite(ctx(A, SUB), FORM_A, true)).toEqual({ form_id: FORM_A, favorite: true })
    expect((await home.listFavoriteForms(ctx(A, SUB))).map((f) => f.name)).toEqual(['Expense claim'])
    await expect(home.setFormFavorite(ctx(A, SUB), FORM_B, true)).rejects.toThrow(/not found/i)
    await expect(home.setFormFavorite(ctx(B, OUTSIDER), FORM_A, true)).rejects.toThrow(/not found/i)
    // Revoke forms.submit (a role without it): the favourite is hidden, not deleted.
    const noSubmit = id(0x801)
    await q(`INSERT INTO public.roles (id, tenant_id, name, slug, permissions) VALUES ($1, $2, 'No forms', 'no-forms-home', '{tasks.view_own}')`, [noSubmit, A])
    await q('DELETE FROM public.user_roles WHERE tenant_id = $1 AND user_id = $2', [A, SUB])
    await q('INSERT INTO public.user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3)', [A, SUB, noSubmit])
    expect((await q('SELECT * FROM public.list_favorite_forms($1, $2)', [A, SUB])).length).toBe(0)
    expect((await q('SELECT count(*)::int AS n FROM public.form_favorites WHERE user_id = $1', [SUB]))[0].n).toBe(1)
    // RLS: no forms.submit → cannot star.
    expect((await as(SUB, 'INSERT INTO public.form_favorites (tenant_id, user_id, form_id) VALUES ($1, $2, $3)', [A, SUB, FORM_A])).error?.code).toBeTruthy()
    await q('DELETE FROM public.user_roles WHERE tenant_id = $1 AND user_id = $2', [A, SUB])
    await q(`INSERT INTO public.user_roles (tenant_id, user_id, role_id) SELECT $1, $2, id FROM public.roles WHERE tenant_id = $1 AND slug = 'member'`, [A, SUB])
    expect((await q('SELECT name FROM public.list_favorite_forms($1, $2)', [A, SUB])).map((r: any) => r.name)).toEqual(['Expense claim'])
    // RLS: someone else's favourites are invisible; starring for someone else is refused.
    expect((await as(OTHER, 'SELECT * FROM public.form_favorites WHERE user_id = $1', [SUB])).rows).toEqual([])
    expect((await as(OTHER, 'INSERT INTO public.form_favorites (tenant_id, user_id, form_id) VALUES ($1, $2, $3)', [A, SUB, FORM_A])).error?.code).toBe('42501')
    expect((await as(OTHER, 'INSERT INTO public.form_favorites (tenant_id, user_id, form_id) VALUES ($1, $2, $3)', [A, OTHER, FORM_B])).error?.code).toBe('42501')
    expect(await home.setFormFavorite(ctx(A, SUB), FORM_A, false)).toEqual({ form_id: FORM_A, favorite: false })
    expect(await home.listFavoriteForms(ctx(A, SUB))).toEqual([])
  })

  /* ── Performance smoke ─────────────────────────────────────────────── */

  /* ── expanded task rows (home.taskDetails) ──────────────────────────── */

  it('task details: description, fields and subtasks for people who can see the task on Home, not found for others', async () => {
    const SUBTASK = id(0x707)
    await q(`UPDATE public.tasks SET description = $2, metadata = $3::jsonb WHERE id = $1`, [T_MINE, '<p>Gather the <b>numbers</b></p>',
      JSON.stringify({ fields: [{ key: 'amount', label: 'Amount', type: 'number' }], template_values: { amount: 42 } })])
    await q(`INSERT INTO public.tasks (id, tenant_id, title, status, priority, assignee_id, parent_task_id) VALUES ($1, $2, 'Collect receipts', 'completed'::task_status, 'medium', $3, $4)`, [SUBTASK, A, ASSIGNEE, T_MINE])
    try {
      const mine = await home.getTaskDetails(ctx(A, SUB), T_MINE)
      expect(mine.description).toContain('Gather the numbers')
      expect(mine.fields).toEqual([expect.objectContaining({ label: 'Amount' })])
      expect(mine.subtasks).toEqual([expect.objectContaining({ id: SUBTASK, title: 'Collect receipts', status: 'completed', assignee: 'Ann Approver' })])
      expect([mine.completed, mine.total]).toEqual([1, 1])
      // An unassigned team task: its team's members see it (the queue), others don't.
      await expect(home.getTaskDetails(ctx(A, TEAMER), T_TEAM)).resolves.toMatchObject({ subtasks: [] })
      await expect(home.getTaskDetails(ctx(A, OTHER), T_TEAM)).rejects.toMatchObject({ code: 'not_found' })
      // Someone else's task, another workspace, a malformed id, no tasks.view_own.
      await expect(home.getTaskDetails(ctx(A, OTHER), T_MINE)).rejects.toMatchObject({ code: 'not_found' })
      await expect(home.getTaskDetails(ctx(B, OUTSIDER), T_MINE)).rejects.toMatchObject({ code: 'not_found' })
      await expect(home.getTaskDetails(ctx(A, SUB), 'nope')).rejects.toMatchObject({ code: 'not_found' })
      await expect(home.getTaskDetails(ctx(A, SUB, ['forms.submit']), T_MINE)).rejects.toMatchObject({ code: 'forbidden' })
    } finally {
      await q('DELETE FROM public.tasks WHERE id = $1', [SUBTASK])
    }
  })

  it('stays fast with 2,000 tasks and 500 submissions', async () => {
    await q(`INSERT INTO public.tasks (tenant_id, title, status, priority, assignee_id, due_date, completed_at)
      SELECT $1, 'Bulk task ' || g, CASE WHEN g % 4 = 0 THEN 'completed' ELSE 'todo' END::task_status, 'medium', $2,
             now() + (g - 1000) * interval '1 hour', CASE WHEN g % 4 = 0 THEN now() - (g % 60) * interval '1 day' END
        FROM generate_series(1, 2000) g`, [A, SUB])
    await q(`WITH s AS (
        INSERT INTO public.form_submissions (tenant_id, form_id, form_name, submitted_by, values, created_at)
        SELECT $1, $2, 'Expense claim', $3, '{}'::jsonb, now() - g * interval '10 minutes' FROM generate_series(1, 500) g RETURNING id
      )
      INSERT INTO public.workflow_runs (workflow_id, tenant_id, status, version_id, started_by, started_via, form_submission_id, event_id, paused_node_id)
      SELECT $4, $1, CASE WHEN row_number() OVER () % 3 = 0 THEN 'completed' ELSE 'waiting_for_event' END, $5, $3, 'form', s.id, 'evt_bulk_' || s.id, 'approve' FROM s`,
    [A, FORM_A, SUB, WF, VERSION])
    // Fresh statistics, as a live database has: right after a bulk insert the
    // planner still thinks these tables are tiny and picks plans (hashed
    // subplans over all tasks per followed run in can_view_run_progress) that
    // made "following" 10–20x slower until autovacuum's ANALYZE caught up —
    // which is what timed out on CI.
    await q('ANALYZE public.tasks, public.form_submissions, public.workflow_runs, public.run_followers')
    const timed = async (label: string, fn: () => Promise<unknown>) => {
      const t0 = performance.now()
      await fn()
      const ms = performance.now() - t0
      return [label, ms] as const
    }
    const c = ctx(A, SUB)
    const page = { limit: 25, offset: 0 }
    const results = [
      await timed('task metrics', () => home.getTaskMetrics(c)),
      await timed('submission metrics', () => home.getSubmissionMetrics(c)),
      await timed('follow metrics', () => home.getFollowMetrics(c)),
      await timed('my tasks', () => home.listMyTasks(c, {}, page)),
      await timed('queue', () => home.listQueueTasks(c, {}, page)),
      await timed('following', () => home.listFollowedRuns(c, {}, page)),
      await timed('submissions', () => home.listMySubmissions(c, {}, page)),
      await timed('submissions page 10', () => home.listMySubmissions(c, { search: 'expense' }, { limit: 25, offset: 225 })),
    ]
    console.info('[home perf]', results.map(([l, ms]) => `${l} ${ms.toFixed(0)}ms`).join(', '))
    // 2 s per read on a developer machine. CI runners (shared 4 vCPU, the
    // whole suite in 4 workers beside the Supabase stack and emulators)
    // measured 2–4x slower for the same plans, so allow 3x there: still an
    // order of magnitude below what a bad plan costs at this size.
    const limitMs = process.env.CI ? 6000 : 2000
    for (const [label, ms] of results) expect(ms, label).toBeLessThan(limitMs)
    expect((await home.getSubmissionMetrics(c)).in_progress).toBeGreaterThan(300)
    expect((await home.listMyTasks(c, {}, page)).total).toBeGreaterThan(1500)
  }, 120_000)
})
