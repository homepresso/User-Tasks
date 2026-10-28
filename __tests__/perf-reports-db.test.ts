/**
 * SQL-level checks for supabase/migrations/20261028000000_perf_api_reports.sql:
 * workflows.node_count trigger, the tag_definitions insert policy and the
 * run-report RPCs (results match the report pages' former JS aggregation and
 * respect workflow_runs RLS).
 *
 * Runs only against a LOCAL Supabase stack — set EVENT_STREAM_DB_URL, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/perf-reports-db.test.ts
 * Every test runs in a transaction that is rolled back.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Client } from 'pg'

const DB_URL = process.env.EVENT_STREAM_DB_URL

const TENANT_A = '0f000000-0000-4000-8000-00000000000a'
const TENANT_B = '0f000000-0000-4000-8000-00000000000b'
const USER = '0f000001-0000-4000-8000-000000000001' // home A
const WF_A = '0f000010-0000-4000-8000-00000000000a'
const WF_B = '0f000010-0000-4000-8000-00000000000b'

const node = (id: string) => ({ type: 'node', phase: 'enter', node_id: id })
const edge = { type: 'edge', edge_id: 'e1', source: 'n1', target: 'n2' }

describe.skipIf(!DB_URL)('perf phase 4 SQL: node_count, tag policy, report RPCs (local DB)', () => {
  const db = new Client({ connectionString: DB_URL })

  beforeAll(async () => { await db.connect() })
  afterAll(async () => { await db.end() })

  beforeEach(async () => {
    await db.query('BEGIN')
    await db.query(
      `INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Reports A', 'reports-a'), ($2, 'Reports B', 'reports-b')`,
      [TENANT_A, TENANT_B],
    )
    await db.query(
      `INSERT INTO auth.users (id, email, instance_id, aud, role)
       VALUES ($1, 'reports-user@perf.test', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`,
      [USER],
    )
    await db.query(`DELETE FROM public.user_memberships WHERE user_id = $1`, [USER])
    await db.query(`UPDATE public.users SET tenant_id = $2, current_tenant_id = $2 WHERE id = $1`, [USER, TENANT_A])
    await db.query(
      `INSERT INTO public.workflows (id, tenant_id, name, nodes) VALUES
         ($1, $3, 'A', '[{"id":"n1"},{"id":"n2"},{"id":"n3"}]'), ($2, $4, 'B', '[{"id":"x"}]')`,
      [WF_A, WF_B, TENANT_A, TENANT_B],
    )
    const day = '2030-01-0'
    const runs: Array<[string, string, string, string, string | null, unknown[], Record<string, unknown>]> = [
      // workflow, tenant, status, started, completed, trace, node_results
      [WF_A, TENANT_A, 'completed', `${day}1T10:00:00Z`, `${day}1T10:00:02Z`, [node('n1'), edge, node('n2')], { n1: {}, n2: {} }],
      [WF_A, TENANT_A, 'failed', `${day}1T11:00:00Z`, `${day}1T11:00:01Z`, [], { n1: {}, n3: {} }],
      [WF_A, TENANT_A, 'completed', `${day}2T09:00:00Z`, `${day}2T09:00:06Z`, [], {}],
      [WF_A, TENANT_A, 'running', `${day}2T12:00:00Z`, null, [node('n1')], {}],
      [WF_B, TENANT_B, 'completed', `${day}1T10:00:00Z`, `${day}1T10:00:09Z`, [], { x: {} }],
    ]
    for (const [wf, tenant, status, started, completed, trace, results] of runs) {
      await db.query(
        `INSERT INTO public.workflow_runs (workflow_id, tenant_id, status, started_at, completed_at, execution_trace, node_results)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
        [wf, tenant, status, started, completed, JSON.stringify(trace), JSON.stringify(results)],
      )
    }
  })
  afterEach(async () => { await db.query('ROLLBACK') })

  /** Run `sql` as USER (authenticated) or anon inside a savepoint. */
  async function as(role: 'authenticated' | 'anon', sql: string, params: unknown[] = []) {
    await db.query('SAVEPOINT caller')
    try {
      await db.query(`SET LOCAL ROLE ${role}`)
      const claims = role === 'anon' ? { role: 'anon' } : { sub: USER, role: 'authenticated' }
      await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)])
      const { rows } = await db.query(sql, params)
      await db.query('RELEASE SAVEPOINT caller')
      return { rows, error: null as null | { code?: string; message: string } }
    } catch (e) {
      await db.query('ROLLBACK TO SAVEPOINT caller')
      const err = e as { code?: string; message: string }
      return { rows: [], error: { code: err.code, message: err.message } }
    } finally {
      await db.query('RESET ROLE')
    }
  }

  it('maintains workflows.node_count on insert and update', async () => {
    const { rows } = await db.query(`SELECT node_count FROM public.workflows WHERE id = $1`, [WF_A])
    expect(rows[0].node_count).toBe(3)
    await db.query(`UPDATE public.workflows SET nodes = '[{"id":"only"}]' WHERE id = $1`, [WF_A])
    const after = await db.query(`SELECT node_count FROM public.workflows WHERE id = $1`, [WF_A])
    expect(after.rows[0].node_count).toBe(1)
    await db.query(`UPDATE public.workflows SET nodes = '{}' WHERE id = $1`, [WF_A])
    expect((await db.query(`SELECT node_count FROM public.workflows WHERE id = $1`, [WF_A])).rows[0].node_count).toBe(0)
  })

  it('tag_definitions: members insert into their tenant; anon and other tenants are denied', async () => {
    const own = await as('authenticated', `INSERT INTO public.tag_definitions (name) VALUES ('mine') RETURNING tenant_id`)
    expect(own.error).toBeNull()
    expect(own.rows[0].tenant_id).toBe(TENANT_A)
    const other = await as('authenticated', `INSERT INTO public.tag_definitions (name, tenant_id) VALUES ('theirs', $1)`, [TENANT_B])
    expect(other.error?.code).toBe('42501')
    const anon = await as('anon', `INSERT INTO public.tag_definitions (name) VALUES ('global')`)
    expect(anon.error).not.toBeNull()
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM public.tag_definitions WHERE tenant_id IS NULL AND name = 'global'`)
    expect(rows[0].n).toBe(0)
  })

  it('workflow_run_daily_stats aggregates per workflow and UTC day, within RLS', async () => {
    const { rows, error } = await as('authenticated',
      `SELECT * FROM public.workflow_run_daily_stats('2029-12-01') ORDER BY workflow_id, day`)
    expect(error).toBeNull()
    expect(rows.map((r) => r.workflow_id)).toEqual([WF_A, WF_A]) // WF_B is another tenant's
    const [d1, d2] = rows
    expect(d1).toMatchObject({ runs: 2, active: 0, errors: 1, completed: 1, timed: 2 })
    expect(d1.completed_ms).toBe(2000)
    expect(d1.timed_ms).toBe(3000)
    // trace node visits (2) for run 1, node_results fallback (2) for run 2
    expect(Number(d1.node_visits)).toBe(4)
    expect(Number(d1.edge_traversals)).toBe(1)
    expect(d2).toMatchObject({ runs: 2, active: 1, errors: 0, completed: 1, timed: 1 })
    expect(d2.completed_ms).toBe(6000)
    expect(Number(d2.node_visits)).toBe(1)
    expect(new Date(d2.last_started_at).toISOString()).toBe('2030-01-02T12:00:00.000Z')
    expect(new Date(d2.last_completed_at).toISOString()).toBe('2030-01-02T09:00:06.000Z')
  })

  it('workflow_run_duration_stats returns per-workflow and overall percentiles', async () => {
    const { rows } = await as('authenticated', `SELECT * FROM public.workflow_run_duration_stats('2029-12-01')`)
    const overall = rows.find((r) => r.workflow_id === null)
    const perWf = rows.find((r) => r.workflow_id === WF_A)
    expect(rows.some((r) => r.workflow_id === WF_B)).toBe(false)
    for (const row of [overall, perWf]) {
      expect(row).toMatchObject({ runs: 4, completed: 2, failed: 1, active: 1 })
      expect(row.avg_ms).toBe(4000)
      expect(row.p50_ms).toBe(4000)
      expect(row.p95_ms).toBeCloseTo(5800)
    }
  })

  it('workflow_run_summaries returns rows without traces, with trace-derived counts', async () => {
    const { rows } = await as('authenticated',
      `SELECT * FROM public.workflow_run_summaries(ARRAY[$1, $2]::uuid[], NULL, 10)`, [WF_A, WF_B])
    expect(rows).toHaveLength(4)
    expect(rows.every((r) => r.workflow_id === WF_A)).toBe(true)
    expect(rows[0].status).toBe('running') // newest first
    expect(Object.keys(rows[0])).not.toContain('execution_trace')
    const completedFirst = rows.find((r) => r.started_at.toISOString() === '2030-01-01T10:00:00.000Z')
    expect(completedFirst).toMatchObject({ trace_node_visits: 2, edge_traversals: 1, result_node_count: 2 })
    const failed = rows.find((r) => r.status === 'failed')
    expect(failed).toMatchObject({ trace_node_visits: 0, edge_traversals: 0, result_node_count: 2 })
    const limited = await as('authenticated', `SELECT id FROM public.workflow_run_summaries(ARRAY[$1]::uuid[], NULL, 1)`, [WF_A])
    expect(limited.rows).toHaveLength(1)
  })

  it('workflow_node_visit_stats counts trace visits, else node_results presence', async () => {
    const { rows } = await as('authenticated',
      `SELECT node_id, visits FROM public.workflow_node_visit_stats(ARRAY[$1, $2]::uuid[]) ORDER BY node_id`, [WF_A, WF_B])
    // n1: run1 trace + run2 results + run4 trace; n2: run1 trace (results ignored); n3: run2 results
    expect(rows.map((r) => [r.node_id, Number(r.visits)])).toEqual([['n1', 3], ['n2', 1], ['n3', 1]])
  })

  it('report RPCs are not executable by anon', async () => {
    const { error } = await as('anon', `SELECT * FROM public.workflow_run_daily_stats(now())`)
    expect(error?.code).toBe('42501')
  })
})
