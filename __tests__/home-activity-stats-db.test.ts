/**
 * Home → My activity stats against a LOCAL Supabase stack (migration
 * 20261220000000_home_activity_stats.sql + lib/services/home-stats.ts):
 *  - aggregates on seeded data: counts per bucket, decisions and approval
 *    rate with custom outcomes, median / p90 time to complete and to pick
 *    up (reassignment moves "assigned"), on time vs late (due date, else the
 *    run's SLA), top processes, submission statuses and end-to-end time;
 *  - the outcome → decision mapping;
 *  - strict isolation: other people, other workspaces, signed-in callers
 *    asking about someone else, anon;
 *  - periods (7 / 30 / 90, invalid → 30) and the bucket time zone
 *    (explicit, profile, UTC fallback);
 *  - empty states for a new person; permissions null a part;
 *  - a performance smoke (2,000 completed tasks).
 *
 * Runs only when EVENT_STREAM_DB_URL is set, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/home-activity-stats-db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client } from 'pg'
import { createClient } from './helpers/db-test-client'

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))

import { getHomeActivityStats } from '@/lib/services/home-stats'
import type { ServiceContext } from '@/lib/services/context'

/* eslint-disable @typescript-eslint/no-explicit-any -- rows are loose JSON */

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.LOCKDOWN_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.LOCKDOWN_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const id = (n: number) => `ac0ac000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
// Personal workspaces take the first 8 characters of the user id as slug: keep those distinct.
const uid = (n: number) => `ac${n.toString(16).padStart(6, '0')}-0000-4000-8000-0000000000ac`
const A = id(0xa)
const B = id(0xb)
const ME = uid(0x101)
const OTHER = uid(0x102)
const NEWBIE = uid(0x103)
const TZUSER = uid(0x104)
const PERF = uid(0x105)
const USERS = [ME, OTHER, NEWBIE, TZUSER, PERF]
const WF1 = id(0x301)
const WF2 = id(0x302)
const FORM = id(0x401)
const H = 3600
const opts = { auth: { persistSession: false, autoRefreshToken: false } }

describe.skipIf(!DB_URL)('home activity stats (local stack)', () => {
  const db = new Client({ connectionString: DB_URL })
  const admin = createClient(API_URL, SERVICE_KEY, opts)
  const member = ['tasks.view_own', 'tasks.complete', 'forms.submit', 'forms.view']
  const ctx = (tenantId: string, actorId: string | null, permissions: string[] = member): ServiceContext =>
    ({ supabase: admin, db: admin, tenantId, actorId, permissions: new Set(permissions), authKind: 'api_key', source: 'api' } as ServiceContext)
  const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows

  async function as(user: string | null, sql: string, params: unknown[] = []) {
    await db.query('BEGIN')
    try {
      await db.query(user ? 'SET LOCAL ROLE authenticated' : 'SET LOCAL ROLE anon')
      if (user) await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: user, role: 'authenticated' })])
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
      for (const table of ['task_responses', 'lifecycle_events', 'run_followers', 'tasks', 'workflow_runs', 'form_submissions', 'workflows', 'forms', 'object_audit_log']) {
        await db.query(`DELETE FROM public.${table} WHERE tenant_id = $1`, [t]).catch((e) => console.warn(`[activity test cleanup] ${table}: ${e.message}`))
      }
    }
    await db.query('DELETE FROM auth.users WHERE id = ANY($1::uuid[])', [USERS])
    await db.query('DELETE FROM public.tenants WHERE id = ANY($1::uuid[])', [[A, B, ...personal.filter((t: string | null) => t && ![A, B].includes(t))]])
    await db.query(`DELETE FROM public.tenants WHERE slug LIKE 'personal-ac0001%'`).catch(() => undefined)
  }

  /** A completed task: times are hours ago. */
  const task = (o: { n: number; assignee?: string | null; tenant?: string; created: number; completed: number; outcome?: string | null; outcomes?: string[] | null;
    due?: number | null; accepted?: number | null; wf?: string | null; run?: string | null; deleted?: boolean; status?: string }) =>
    q(`INSERT INTO public.tasks (id, tenant_id, title, status, priority, assignee_id, created_at, completed_at, outcome, available_outcomes, due_date, accepted_at, workflow_id, workflow_run_id, deleted_at, assignment_type)
       VALUES ($1, $2, 'Activity task', $3::task_status, 'medium', $4, now() - $5 * interval '1 hour', now() - $6 * interval '1 hour', $7, $8::jsonb,
               CASE WHEN $9::float8 IS NULL THEN NULL ELSE now() - $9 * interval '1 hour' END,
               CASE WHEN $10::float8 IS NULL THEN NULL ELSE now() - $10 * interval '1 hour' END, $11, $12, CASE WHEN $13 THEN now() END, 'individual')`,
    [id(0x700 + o.n), o.tenant ?? A, o.status ?? 'completed', o.assignee === undefined ? ME : o.assignee, o.created, o.completed, o.outcome ?? null,
      o.outcomes === undefined ? null : JSON.stringify(o.outcomes), o.due ?? null, o.accepted ?? null, o.wf ?? null, o.run ?? null, o.deleted === true])

  beforeAll(async () => {
    await db.connect()
    await cleanup()
    await q(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Activity A', 'activity-a-test'), ($2, 'Activity B', 'activity-b-test')`, [A, B])
    for (const user of USERS) {
      await q(`INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`,
        [user, `a${user.slice(2, 8)}.${Date.now().toString(36)}@activity.test`])
      for (const t of [A, B]) await q(`INSERT INTO public.user_memberships (user_id, tenant_id, role) VALUES ($1, $2, 'member') ON CONFLICT (user_id, tenant_id) DO NOTHING`, [user, t])
      await q('UPDATE public.users SET current_tenant_id = $2 WHERE id = $1', [user, A])
    }
    await q(`UPDATE public.users SET timezone = 'UTC' WHERE id = ANY($1::uuid[])`, [USERS])
    await q(`INSERT INTO public.workflows (id, tenant_id, name, nodes, edges) VALUES ($1, $3, 'Expense approval', '[]', '[]'), ($2, $3, 'Onboarding', '[]', '[]')`, [WF1, WF2, A])
    await q(`INSERT INTO public.forms (id, tenant_id, name, fields) VALUES ($1, $2, 'Request', '[]')`, [FORM, A])
    const RUN_SLA = id(0x601)
    await q(`INSERT INTO public.workflow_runs (id, workflow_id, tenant_id, status, sla_due_at, node_results, execution_trace) VALUES ($1, $2, $3, 'completed', now() - interval '1 hour', '{}'::jsonb, '[]'::jsonb)`, [RUN_SLA, WF1, A])

    // ME, workspace A, last 30 days. Durations (h): 2, 24, 1, 1, 2 (reassigned), 1, 1 (collaborative), 0.5.
    await task({ n: 1, created: 10, completed: 8, outcome: 'Approved', outcomes: ['Approve', 'Reject'], due: 7, wf: WF1 })        // approve, on time
    await task({ n: 2, created: 30, completed: 6, outcome: 'Reject', outcomes: ['Approve', 'Reject'], due: 10, wf: WF1 })          // reject, late
    await task({ n: 3, created: 5, completed: 4, outcome: 'Send back', outcomes: ['Approve', 'Send back'], wf: WF2 })               // return
    await task({ n: 4, created: 3, completed: 2, outcome: 'Escalate', outcomes: ['Approve', 'Escalate'], run: RUN_SLA })            // other; SLA due 1 h ago → on time
    await task({ n: 5, created: 50, completed: 1, outcome: 'Done', outcomes: ['Done'], accepted: 2 })                               // completion; reassigned 3 h ago
    await task({ n: 6, created: 4, completed: 3, outcome: 'Records gathered', outcomes: null })                                     // completion (one option)
    await task({ n: 7, assignee: null, created: 2, completed: 1, outcome: 'Reject', outcomes: ['Approve', 'Reject'] })             // collaborative: MY response is Approve
    await task({ n: 8, created: 1, completed: 0.5, outcome: 'Disapproved', outcomes: ['Approve', 'Disapprove'] })                   // reject
    await task({ n: 9, created: 41 * 24, completed: 40 * 24, outcome: 'Approved', outcomes: ['Approve', 'Reject'] })                // only in 90 days
    await task({ n: 10, created: 5, completed: 4, outcome: 'Approved', outcomes: ['Approve', 'Reject'], deleted: true })            // deleted
    await task({ n: 11, assignee: OTHER, created: 5, completed: 4, outcome: 'Rejected', outcomes: ['Approve', 'Reject'] })         // someone else's
    await task({ n: 12, tenant: B, created: 5, completed: 4, outcome: 'Approved', outcomes: ['Approve', 'Reject'] })               // my task in B
    await task({ n: 13, assignee: null, created: 5, completed: 4, outcome: 'Approve', outcomes: ['Approve', 'Reject'] })           // collaborative, I didn't respond
    await task({ n: 14, created: 5, completed: 4, outcome: null, status: 'todo' })                                                  // not completed (completed_at set but open)
    await q(`INSERT INTO public.task_responses (task_id, tenant_id, user_id, outcome, responded_at) VALUES ($1, $2, $3, 'Approve', now() - interval '90 minutes'), ($1, $2, $4, 'Reject', now() - interval '1 hour')`,
      [id(0x707), A, ME, OTHER])
    await q(`INSERT INTO public.task_responses (task_id, tenant_id, user_id, outcome) VALUES ($1, $2, $3, 'Approve')`, [id(0x70d), A, OTHER])
    await q(`INSERT INTO public.lifecycle_events (tenant_id, task_id, event_type, created_at) VALUES ($1, $2, 'reassigned', now() - interval '3 hours'), ($1, $2, 'reassigned', now() + interval '1 hour')`, [A, id(0x705)])

    // Submissions (ME unless noted): completed 2 h and 4 h end-to-end, running, failed, cancelled, no process, task-form, OTHER's, old.
    const sub = async (n: number, o: { by?: string; source?: string; ago: number; run?: { status: string; e2e?: number } }) => {
      await q(`INSERT INTO public.form_submissions (id, tenant_id, form_id, form_name, submitted_by, source, values, created_at) VALUES ($1, $2, $3, 'Request', $4, $5, '{}'::jsonb, now() - $6 * interval '1 hour')`,
        [id(0x500 + n), A, FORM, o.by ?? ME, o.source ?? 'standalone', o.ago])
      if (o.run) {
        await q(`INSERT INTO public.workflow_runs (workflow_id, tenant_id, status, started_at, completed_at, form_submission_id, node_results, execution_trace)
                 VALUES ($1, $2, $3, now() - $4 * interval '1 hour', CASE WHEN $5::float8 IS NULL THEN NULL ELSE now() - ($4 - $5) * interval '1 hour' END, $6, '{}'::jsonb, '[]'::jsonb)`,
        [WF1, A, o.run.status, o.ago, o.run.e2e ?? null, id(0x500 + n)])
      }
    }
    await sub(1, { ago: 10, run: { status: 'completed', e2e: 2 } })
    await sub(2, { ago: 9, run: { status: 'waiting_for_event' } })
    await sub(3, { ago: 8, run: { status: 'failed' } })
    await sub(4, { ago: 7, run: { status: 'cancelled' } })
    await sub(5, { ago: 6 })
    await sub(6, { ago: 20, run: { status: 'completed', e2e: 4 } })
    await sub(7, { ago: 5, source: 'task' })
    await sub(8, { ago: 5, by: OTHER, run: { status: 'completed', e2e: 1 } })
    await sub(9, { ago: 40 * 24, run: { status: 'completed', e2e: 1 } })
  }, 60_000)

  afterAll(async () => {
    await cleanup().catch(() => undefined)
    await db.end()
  })

  /* ── aggregates ─────────────────────────────────────────────────────── */

  it('counts my completed tasks per bucket (assigned to me, or shared ones I responded to)', async () => {
    const s = await getHomeActivityStats(ctx(A, ME), { period: 30, timezone: 'UTC' })
    const t = s.tasks!
    expect(s.period).toBe(30)
    expect(t.period).toMatchObject({ days: 30, unit: 'day', timezone: 'UTC' })
    expect(t.completed.total).toBe(8)
    expect(t.completed.buckets).toHaveLength(30)
    expect(t.completed.buckets.reduce((n, b) => n + b.count, 0)).toBe(8)
    // Each bucket holds the tasks completed on that UTC date.
    const expected = new Map<string, number>()
    for (const hours of [8, 6, 4, 2, 1, 3, 1, 0.5]) {
      const day = new Date(Date.now() - hours * H * 1000).toISOString().slice(0, 10)
      expected.set(day, (expected.get(day) ?? 0) + 1)
    }
    for (const [day, n] of expected) expect(t.completed.buckets.find((b) => b.start === day)?.count).toBe(n)
    expect(t.completed.buckets[t.completed.buckets.length - 1].start).toBe(new Date().toISOString().slice(0, 10))
  })

  it('decisions: approval rate over decisions, custom outcomes mapped, my own response counts', async () => {
    const d = (await getHomeActivityStats(ctx(A, ME), { period: 30 })).tasks!.decisions
    expect(d).toMatchObject({ total: 6, approved: 2, rejected: 2, returned: 1, non_decision: 2 })
    expect(d.approval_rate).toBeCloseTo(2 / 6, 3)
    expect(d.groups).toEqual([
      { kind: 'approve', label: 'Approved', count: 2 },
      { kind: 'reject', label: 'Rejected', count: 2 },
      { kind: 'return', label: 'Sent back', count: 1 },
      { kind: 'other', label: 'Escalate', count: 1 },
    ])
    expect(d.non_decision_labels.sort()).toEqual(['Done', 'Records Gathered'])
  })

  it('time to complete: median and p90 from assignment (reassignment moves it); time to pick up', async () => {
    const du = (await getHomeActivityStats(ctx(A, ME), { period: 30 })).tasks!.durations
    // Sorted (h): 0.5, 1, 1, 1, 1, 2, 2, 24 → median 1 h; p90 = 2 + 0.3 × 22 = 8.6 h.
    expect(du.count).toBe(8)
    expect(du.median_s).toBe(H)
    expect(du.p90_s).toBeCloseTo(8.6 * H, -1)
    expect(du.pickup).toMatchObject({ count: 1, median_s: H, p90_s: H })
  })

  it('on time vs late: due date, else the run SLA; no deadline left out', async () => {
    const o = (await getHomeActivityStats(ctx(A, ME), { period: 30 })).tasks!.on_time
    expect(o).toMatchObject({ with_deadline: 3, on_time: 2, late: 1, no_deadline: 5 })
    expect(o.rate).toBeCloseTo(2 / 3, 3)
  })

  it('top processes by tasks completed', async () => {
    const top = (await getHomeActivityStats(ctx(A, ME), { period: 30 })).tasks!.top_processes
    expect(top).toEqual([
      { workflow_id: WF1, name: 'Expense approval', count: 2 },
      { workflow_id: WF2, name: 'Onboarding', count: 1 },
    ])
  })

  it('submissions: status of the process each started and the end-to-end time of completed ones', async () => {
    const s = (await getHomeActivityStats(ctx(A, ME), { period: 30 })).submissions!
    expect(s).toMatchObject({ total: 6, completed: 2, in_progress: 1, failed: 1, cancelled: 1, no_process: 1 })
    expect(s.median_s).toBe(3 * H)
    expect(s.p90_s).toBe(3.8 * H)
  })

  it('maps outcome labels to decision kinds', async () => {
    const cases: Array<[string | null, string[] | null, string]> = [
      ['Approve', null, 'approve'], ['APPROVED with conditions', null, 'approve'], ['Accept', null, 'approve'], ['Sign off', null, 'approve'],
      ['Authorised', null, 'approve'], ['Yes', null, 'approve'], ['Go ahead', null, 'approve'],
      ['Reject', null, 'reject'], ['Disapprove', null, 'reject'], ['Not approved', null, 'reject'], ['Declined', null, 'reject'], ['No', null, 'reject'], ['Denied', null, 'reject'],
      ['Send back', null, 'return'], ['Request changes', null, 'return'], ['Return to sender', null, 'return'], ['Needs more info', null, 'return'],
      ['completed', ['Approve', 'Reject'], 'completion'], ['Done', null, 'completion'], ['Submitted', null, 'completion'], ['', null, 'completion'], [null, null, 'completion'],
      ['Escalate', ['Approve', 'Escalate'], 'other'], ['Escalate', ['Escalate'], 'completion'], ['Partial release', null, 'completion'],
    ]
    for (const [outcome, available, kind] of cases) {
      const [row] = await q('SELECT public.home_outcome_kind($1, $2::jsonb) AS k', [outcome, available ? JSON.stringify(available) : null])
      expect([outcome, row.k]).toEqual([outcome, kind])
    }
  })

  /* ── isolation ──────────────────────────────────────────────────────── */

  it('only ever counts the caller\'s own tasks, in the current workspace', async () => {
    const other = (await getHomeActivityStats(ctx(A, OTHER), { period: 30 })).tasks!
    // Their own task, plus the two shared tasks they responded to — with their own answers.
    expect(other.completed.total).toBe(3)
    expect(other.decisions.groups).toEqual([{ kind: 'approve', label: 'Approved', count: 1 }, { kind: 'reject', label: 'Rejected', count: 2 }])
    const other2 = (await getHomeActivityStats(ctx(A, OTHER), { period: 30 })).submissions!
    expect(other2.total).toBe(1)
    const inB = (await getHomeActivityStats(ctx(B, ME), { period: 30 })).tasks!
    expect(inB.completed.total).toBe(1)
    expect(inB.top_processes).toEqual([])
    expect((await getHomeActivityStats(ctx(B, ME), { period: 30 })).submissions!.total).toBe(0)
  })

  it('a signed-in caller cannot ask about someone else; anon cannot call it', async () => {
    const own = await as(ME, 'SELECT public.home_task_stats($1, $2, 30, $3) AS s', [A, ME, 'UTC'])
    expect(own.error).toBeNull()
    expect(own.rows[0].s.completed.total).toBe(8)
    const spy = await as(OTHER, 'SELECT public.home_task_stats($1, $2, 30, $3) AS s', [A, ME, 'UTC'])
    expect(spy.error).toBeNull()
    expect(spy.rows[0].s.completed.total).toBe(0)
    expect(spy.rows[0].s.completed.buckets).toEqual([])
    const spySubs = await as(OTHER, 'SELECT public.home_submission_stats($1, $2, 30) AS s', [A, ME])
    expect(spySubs.rows[0].s.total).toBe(0)
    const anon = await as(null, 'SELECT public.home_task_stats($1, $2, 30) AS s', [A, ME])
    expect(anon.error?.code).toBe('42501')
  })

  it('needs a person; a part without its permission is null', async () => {
    await expect(getHomeActivityStats(ctx(A, null))).rejects.toThrow(/personal/i)
    const tasksOnly = await getHomeActivityStats(ctx(A, ME, ['tasks.view_own']))
    expect(tasksOnly.tasks?.completed.total).toBe(8)
    expect(tasksOnly.submissions).toBeNull()
    const formsOnly = await getHomeActivityStats(ctx(A, ME, ['forms.submit']))
    expect(formsOnly.tasks).toBeNull()
    expect(formsOnly.submissions?.total).toBe(6)
  })

  /* ── periods and time zones ─────────────────────────────────────────── */

  it('periods: 7 and 30 days in day buckets, 90 in ISO weeks; anything else is 30', async () => {
    const seven = (await getHomeActivityStats(ctx(A, ME), { period: '7d', timezone: 'UTC' })).tasks!
    expect(seven.period).toMatchObject({ days: 7, unit: 'day' })
    expect(seven.completed.buckets).toHaveLength(7)
    const today = new Date()
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 6)).toISOString().slice(0, 10)
    expect(seven.period.start).toBe(start)
    expect(seven.completed.buckets[0].start).toBe(start)

    const ninety = (await getHomeActivityStats(ctx(A, ME), { period: 90, timezone: 'UTC' })).tasks!
    expect(ninety.period).toMatchObject({ days: 90, unit: 'week' })
    expect(ninety.completed.total).toBe(9)
    expect(ninety.decisions.approved).toBe(3)
    for (const b of ninety.completed.buckets) expect(new Date(`${b.start}T00:00:00Z`).getUTCDay()).toBe(1) // Mondays
    expect(ninety.completed.buckets.length).toBeGreaterThanOrEqual(13)
    expect(ninety.completed.buckets.length).toBeLessThanOrEqual(14)
    expect((await getHomeActivityStats(ctx(A, ME), { period: 90 })).submissions!.total).toBe(7)

    const odd = await getHomeActivityStats(ctx(A, ME), { period: 45 })
    expect(odd.period).toBe(30)
    const [row] = await q('SELECT public.home_task_stats($1, $2, 45, NULL) AS s', [A, ME])
    expect(row.s.period.days).toBe(30)
  })

  it('day buckets follow the time zone: explicit, else the profile\'s, else UTC', async () => {
    // One task completed at 23:00 UTC yesterday: "yesterday" in UTC, "today" (UTC date) in Auckland (+12 / +13).
    const now = new Date()
    const utcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    const completedAt = new Date(utcMidnight - H * 1000)
    const hoursAgo = (Date.now() - completedAt.getTime()) / (H * 1000)
    await task({ n: 0x40, assignee: TZUSER, created: hoursAgo + 1, completed: hoursAgo, outcome: 'Done' })
    const yesterdayUtc = completedAt.toISOString().slice(0, 10)
    const todayUtc = new Date(utcMidnight).toISOString().slice(0, 10)
    const dayOf = (t: any) => t.completed.buckets.filter((b: any) => b.count > 0).map((b: any) => b.start)

    const utc = (await getHomeActivityStats(ctx(A, TZUSER), { period: 7, timezone: 'UTC' })).tasks!
    expect(dayOf(utc)).toEqual([yesterdayUtc])
    const akl = await getHomeActivityStats(ctx(A, TZUSER), { period: 7, timezone: 'Pacific/Auckland' })
    expect(akl.timezone).toBe('Pacific/Auckland')
    expect(dayOf(akl.tasks!)).toEqual([todayUtc])

    // No zone sent: the profile's; an invalid one: the profile's; no valid profile zone: UTC.
    await q(`UPDATE public.users SET timezone = 'Pacific/Auckland' WHERE id = $1`, [TZUSER])
    expect((await getHomeActivityStats(ctx(A, TZUSER), { period: 7 })).timezone).toBe('Pacific/Auckland')
    expect((await getHomeActivityStats(ctx(A, TZUSER), { period: 7, timezone: 'Mars/Olympus_Mons' })).timezone).toBe('Pacific/Auckland')
    await q(`UPDATE public.users SET timezone = 'Not/AZone' WHERE id = $1`, [TZUSER])
    const fallback = await getHomeActivityStats(ctx(A, TZUSER), { period: 7 })
    expect(fallback.timezone).toBe('UTC')
    expect(dayOf(fallback.tasks!)).toEqual([yesterdayUtc])
  })

  /* ── empty states ───────────────────────────────────────────────────── */

  it('a new person gets zeros and nulls, with every bucket present', async () => {
    const s = await getHomeActivityStats(ctx(A, NEWBIE), { period: 30 })
    const t = s.tasks!
    expect(t.completed.total).toBe(0)
    expect(t.completed.buckets).toHaveLength(30)
    expect(t.completed.buckets.every((b) => b.count === 0 && b.median_s === null && b.p90_s === null)).toBe(true)
    expect(t.decisions).toMatchObject({ total: 0, approval_rate: null, groups: [], non_decision: 0, non_decision_labels: [] })
    expect(t.durations).toEqual({ count: 0, median_s: null, p90_s: null, pickup: { count: 0, median_s: null, p90_s: null } })
    expect(t.on_time).toEqual({ with_deadline: 0, on_time: 0, late: 0, no_deadline: 0, rate: null })
    expect(t.top_processes).toEqual([])
    expect(s.submissions).toMatchObject({ total: 0, completed: 0, median_s: null, p90_s: null })
  })

  /* ── performance ────────────────────────────────────────────────────── */

  it('stays fast with 2,000 completed tasks for one person', async () => {
    await q(`INSERT INTO public.tasks (tenant_id, title, status, priority, assignee_id, created_at, completed_at, outcome, available_outcomes, due_date, workflow_id)
      SELECT $1, 'Bulk ' || g, 'completed', 'medium', $2, now() - (g % 85) * interval '1 day' - interval '5 hours', now() - (g % 85) * interval '1 day' - (g % 4) * interval '1 hour',
             CASE g % 3 WHEN 0 THEN 'Approve' WHEN 1 THEN 'Reject' ELSE 'Done' END, '["Approve","Reject"]'::jsonb,
             now() - (g % 85) * interval '1 day' - interval '2 hours', CASE WHEN g % 2 = 0 THEN $3::uuid END
        FROM generate_series(1, 2000) g`, [A, PERF, WF1])
    await getHomeActivityStats(ctx(A, PERF), { period: 90 }) // warm
    const t0 = performance.now()
    const s = await getHomeActivityStats(ctx(A, PERF), { period: 90 })
    const ms = performance.now() - t0
    expect(s.tasks!.completed.total).toBe(2000)
    expect(s.tasks!.decisions.total + s.tasks!.decisions.non_decision).toBe(2000)
    expect(s.tasks!.decisions.approval_rate).toBeCloseTo(667 / 1334, 2)
    expect(ms).toBeLessThan(1500)
    const plan = (await q(`EXPLAIN (FORMAT JSON) SELECT t.id FROM public.tasks t WHERE t.tenant_id = $1 AND t.assignee_id = $2 AND t.status = 'completed' AND t.deleted_at IS NULL AND t.completed_at >= now() - interval '90 days'`, [A, PERF]))
    expect(JSON.stringify(plan)).not.toMatch(/"Seq Scan"/)
  }, 30_000)
})
