/**
 * SQL-level checks for supabase/migrations/20270115000000_run_and_submission_stats.sql:
 * public.workflow_run_stats and public.form_submission_stats are service-role
 * only, count only the given workflows / forms of the given workspace in the
 * period, and agree with the bounded fallback in lib/extensions/insights-host
 * (same counts, avg / p95 durations, UTC days, running / waiting / queued now).
 *
 * Runs against the local Supabase stack or plain PostgreSQL — set
 * EVENT_STREAM_DB_URL. Everything runs inside one transaction that is rolled back.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { aggregateRuns } from '@/lib/extensions/insights-host'

const DB_URL = process.env.EVENT_STREAM_DB_URL

const T1 = '0e000000-0000-4000-8000-0000000d0001'
const T2 = '0e000000-0000-4000-8000-0000000d0002'
const WA = '0e000000-0000-4000-8000-0000000d0101'
const WB = '0e000000-0000-4000-8000-0000000d0102'
const WX = '0e000000-0000-4000-8000-0000000d0103'
const FA = '0e000000-0000-4000-8000-0000000d0201'
const FX = '0e000000-0000-4000-8000-0000000d0202'

const iso = (d: string) => new Date(d).toISOString()
const RUNS = [
  { workflow_id: WA, status: 'completed', started_at: '2026-11-10T08:00:00Z', completed_at: '2026-11-10T08:00:01Z' },
  { workflow_id: WA, status: 'completed', started_at: '2026-11-10T23:59:00Z', completed_at: '2026-11-11T00:00:03Z' },
  { workflow_id: WA, status: 'completed', started_at: '2026-11-12T09:00:00Z', completed_at: '2026-11-12T09:00:10Z' },
  { workflow_id: WA, status: 'failed', started_at: '2026-11-12T10:00:00Z', completed_at: '2026-11-12T10:00:02Z' },
  { workflow_id: WA, status: 'paused', started_at: '2026-11-13T10:00:00Z', completed_at: null },
  { workflow_id: WB, status: 'cancelled', started_at: '2026-11-13T11:00:00Z', completed_at: '2026-11-13T11:00:00Z' },
  { workflow_id: WB, status: 'running', started_at: '2026-11-14T11:00:00Z', completed_at: null },
  { workflow_id: WB, status: 'waiting_for_event', started_at: '2026-10-01T11:00:00Z', completed_at: null }, // before the period, waiting now
  { workflow_id: WA, status: 'completed', started_at: '2026-11-01T08:00:00Z', completed_at: '2026-11-01T08:00:01Z' }, // before the period
  { workflow_id: WX, status: 'completed', started_at: '2026-11-12T08:00:00Z', completed_at: '2026-11-12T08:00:01Z' }, // not asked for
]
const SINCE = '2026-11-08T00:00:00Z'
const UNTIL = '2026-11-14T12:00:00Z'

describe.skipIf(!DB_URL)('workflow_run_stats / form_submission_stats (local DB)', () => {
  const db = new Client({ connectionString: DB_URL })

  async function asService<T = any>(sql: string, params: unknown[]): Promise<T> { // eslint-disable-line @typescript-eslint/no-explicit-any
    await db.query('SAVEPOINT svc')
    try {
      await db.query('SET LOCAL ROLE service_role')
      const { rows } = await db.query(sql, params)
      await db.query('RESET ROLE')
      await db.query('RELEASE SAVEPOINT svc')
      return rows[0].r as T
    } catch (error) {
      await db.query('ROLLBACK TO SAVEPOINT svc')
      throw error
    }
  }

  beforeAll(async () => {
    await db.connect()
    await db.query('BEGIN')
    await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Stats A', 'stats-a'), ($2, 'Stats B', 'stats-b')`, [T1, T2])
    await db.query(`INSERT INTO public.workflows (id, tenant_id, name, trigger_type) VALUES ($1, $4, 'A', 'ext.acme.changed'), ($2, $4, 'B', 'ext.acme.changed'), ($3, $4, 'X', 'manual')`, [WA, WB, WX, T1])
    for (const r of RUNS) {
      await db.query(`INSERT INTO public.workflow_runs (tenant_id, workflow_id, status, started_at, completed_at) VALUES ($1, $2, $3, $4, $5)`, [T1, r.workflow_id, r.status, r.started_at, r.completed_at])
    }
    await db.query(`INSERT INTO public.workflow_queue (tenant_id, workflow_id, trigger_type, status, trigger_data) VALUES
      ($1, $2, 'ext.acme.changed', 'pending', '{}'), ($1, $2, 'task_resume', 'pending', '{}'), ($1, $2, 'ext.acme.changed', 'completed', '{}')`, [T1, WA])
    await db.query(`INSERT INTO public.forms (id, tenant_id, name) VALUES ($1, $3, 'Form A'), ($2, $3, 'Form X')`, [FA, FX, T1])
    for (const [form, at] of [[FA, '2026-11-09T10:00:00Z'], [FA, '2026-11-14T10:00:00Z'], [FA, '2026-11-14T11:00:00Z'], [FA, '2026-10-01T10:00:00Z'], [FX, '2026-11-14T10:00:00Z']]) {
      await db.query(`INSERT INTO public.form_submissions (tenant_id, form_id, form_name, values, created_at) VALUES ($1, $2, 'f', '{"secret":"x"}', $3)`, [T1, form, at])
    }
  })

  afterAll(async () => {
    await db.query('ROLLBACK').catch(() => undefined)
    await db.end()
  })

  it('aggregates the given workflows in the period, and matches the bounded fallback', async () => {
    const r = await asService(`SELECT public.workflow_run_stats($1, $2::uuid[], $3, $4) AS r`, [T1, [WA, WB], SINCE, UNTIL])
    const a = r.workflows.find((w: { workflow_id: string }) => w.workflow_id === WA)
    const b = r.workflows.find((w: { workflow_id: string }) => w.workflow_id === WB)
    expect(a).toMatchObject({ started: 5, completed: 3, failed: 1, cancelled: 0, avg_ms: 24667, running: 0, waiting: 1, queued: 1 })
    expect(a.p95_ms).toBe(57700)
    expect(a.per_day).toEqual([
      { day: '2026-11-10', started: 2, completed: 2, failed: 0, avg_ms: 32000 },
      { day: '2026-11-12', started: 2, completed: 1, failed: 1, avg_ms: 10000 },
      { day: '2026-11-13', started: 1, completed: 0, failed: 0, avg_ms: null },
    ])
    expect(b).toMatchObject({ started: 2, completed: 0, cancelled: 1, avg_ms: null, p95_ms: null, running: 1, waiting: 1, queued: 0 })
    expect(r.total).toMatchObject({ started: 7, completed: 3, failed: 1, cancelled: 1, running: 1, waiting: 2, queued: 1 })

    const inPeriod = RUNS.filter((x) => [WA, WB].includes(x.workflow_id) && x.started_at >= SINCE && x.started_at < UNTIL).map((x) => ({ ...x, started_at: iso(x.started_at), completed_at: x.completed_at && iso(x.completed_at) }))
    const live = RUNS.filter((x) => [WA, WB].includes(x.workflow_id) && ['running', 'paused', 'waiting_for_event', 'waiting'].includes(x.status))
    const js = aggregateRuns([WA, WB], inPeriod, live, [{ workflow_id: WA }])
    for (const k of ['started', 'completed', 'failed', 'cancelled', 'running', 'waiting', 'queued', 'per_day'] as const) expect(js.total[k]).toEqual(r.total[k])
    expect(Math.round(js.total.avg_ms!)).toBe(r.total.avg_ms)
    expect(Math.round(js.total.p95_ms!)).toBe(r.total.p95_ms)
  })

  it('scopes to the workspace and the ids, and is refused to anon / authenticated', async () => {
    const other = await asService(`SELECT public.workflow_run_stats($1, $2::uuid[], $3, $4) AS r`, [T2, [WA, WB], SINCE, UNTIL])
    expect(other.total.started).toBe(0)
    const none = await asService(`SELECT public.workflow_run_stats($1, $2::uuid[], $3, $4) AS r`, [T1, [], SINCE, UNTIL])
    expect(none).toMatchObject({ workflows: [], total: { started: 0 } })
    for (const role of ['anon', 'authenticated']) {
      await db.query('SAVEPOINT r')
      await db.query(`SET LOCAL ROLE ${role}`)
      await expect(db.query(`SELECT public.workflow_run_stats($1, $2::uuid[], $3, $4)`, [T1, [WA], SINCE, UNTIL])).rejects.toThrow(/permission denied/)
      await db.query('ROLLBACK TO SAVEPOINT r')
      await db.query('SAVEPOINT r')
      await db.query(`SET LOCAL ROLE ${role}`)
      await expect(db.query(`SELECT public.form_submission_stats($1, $2::uuid[], $3, $4)`, [T1, [FA], SINCE, UNTIL])).rejects.toThrow(/permission denied/)
      await db.query('ROLLBACK TO SAVEPOINT r')
    }
  })

  it('counts submissions per form and UTC day, the last one at any time, never values', async () => {
    const r = await asService(`SELECT public.form_submission_stats($1, $2::uuid[], $3, $4) AS r`, [T1, [FA], SINCE, UNTIL])
    expect(r.forms).toHaveLength(1)
    expect(r.forms[0]).toMatchObject({ form_id: FA, total: 3, per_day: [{ day: '2026-11-09', count: 1 }, { day: '2026-11-14', count: 2 }] })
    expect(new Date(r.forms[0].last_at).toISOString()).toBe('2026-11-14T11:00:00.000Z')
    expect(JSON.stringify(r)).not.toMatch(/secret/)
  })
})
