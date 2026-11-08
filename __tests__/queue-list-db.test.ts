/**
 * public.workflow_queue_list (migration 20270101000000) against a LOCAL
 * Supabase stack:
 *  - the default Active view excludes terminal statuses, even when active
 *    items sit behind many newer finished ones (paging is in the database);
 *  - view counts, status totals, the Needs attention rule (failed, dead,
 *    active past SLA), completed resume jobs folded into their run;
 *  - search fields (workflow, id / short id, run title, open task title,
 *    starter name / email) and advanced filter combinations;
 *  - visibility tiers via the scope (granted workflow, involved run, queued
 *    by me, nothing) and tenant isolation (explicit tenant, and RLS for a
 *    signed-in member who passes none); anon may not call it.
 *
 * Runs only when EVENT_STREAM_DB_URL is set, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/queue-list-db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'

/* eslint-disable @typescript-eslint/no-explicit-any -- rows are loose JSON */

const DB_URL = process.env.EVENT_STREAM_DB_URL
const id = (n: number) => `9e0e0000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const A = id(0xa), B = id(0xb)
const ME = `9e${'0'.repeat(6)}-0000-4000-8000-0000000000e1`
const OTHER = `9e${'0'.repeat(5)}2-0000-4000-8000-0000000000e2`
const WF_LEAVE = id(0x101), WF_PO = id(0x102), WF_B = id(0x103)
const R_WAIT = id(0x201), R_PAUSED = id(0x202), R_BREACH = id(0x203), R_DONE = id(0x204), R_B = id(0x205)

describe.skipIf(!DB_URL)('workflow_queue_list (local stack)', () => {
  const db = new Client({ connectionString: DB_URL })
  const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows
  const list = async (filters: Record<string, unknown>, opts: { scope?: unknown; tenant?: string | null; limit?: number; offset?: number; sort?: string; dir?: string } = {}) =>
    (await q(`SELECT public.workflow_queue_list($1, $2::jsonb, $3::jsonb, $4, $5, $6, $7) AS r`, [
      opts.tenant === undefined ? A : opts.tenant, JSON.stringify(filters), opts.scope === undefined ? null : JSON.stringify(opts.scope),
      opts.sort ?? 'created_at', opts.dir ?? 'desc', opts.limit ?? 100, opts.offset ?? 0,
    ]))[0].r as any
  const ids = (r: any) => r.rows.map((x: any) => x.run?.id ?? x.id)

  async function cleanup() {
    const personal = (await q('SELECT tenant_id FROM public.users WHERE id = ANY($1::uuid[])', [[ME, OTHER]])).map((r: any) => r.tenant_id)
    for (const t of [A, B]) {
      for (const table of ['tasks', 'workflow_queue', 'workflow_runs', 'workflow_versions', 'workflows']) {
        await db.query(`DELETE FROM public.${table} WHERE tenant_id = $1`, [t]).catch(() => {})
      }
    }
    await db.query('DELETE FROM auth.users WHERE id = ANY($1::uuid[])', [[ME, OTHER]])
    await db.query('DELETE FROM public.tenants WHERE id = ANY($1::uuid[]) OR slug = ANY($2::text[])', [[A, B, ...personal], ['personal-9e000000', 'personal-9e000002']])
  }

  beforeAll(async () => {
    await db.connect()
    await cleanup()
    await q(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Queue A', 'queue-list-a-test'), ($2, 'Queue B', 'queue-list-b-test')`, [A, B])
    for (const [user, email] of [[ME, 'queue-me@example.com'], [OTHER, 'queue-other@example.com']]) {
      await q(`INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`, [user, email])
      await q(`INSERT INTO public.user_memberships (user_id, tenant_id, role) VALUES ($1, $2, 'member') ON CONFLICT (user_id, tenant_id) DO NOTHING`, [user, A])
    }
    await q(`UPDATE public.users SET display_name = 'Grace Liu' WHERE id = $1`, [OTHER])
    await q(`INSERT INTO public.workflows (id, tenant_id, name, trigger_type, nodes, edges) VALUES
      ($1, $4, 'Leave request', 'form_submitted', '[{"id":"n_approve","label":"Manager approval"}]', '[]'),
      ($2, $4, 'Purchase order', 'schedule', '[]', '[]'),
      ($3, $5, 'Other tenant flow', 'manual', '[]', '[]')`, [WF_LEAVE, WF_PO, WF_B, A, B])
    await q(`INSERT INTO public.workflow_runs (id, tenant_id, workflow_id, status, title, started_by, event_id, paused_node_id, sla_due_at, sla_status, started_at, execution_trace) VALUES
      ($1, $6, $8, 'waiting_for_event', 'Leave: Grace, 3 days', $10, 'evt-wait', 'n_approve', NULL, 'on_track', now() - interval '5 days', '[]'),
      ($2, $6, $8, 'paused', 'Leave: paused one', $11, NULL, NULL, NULL, 'on_track', now() - interval '4 days', '[]'),
      ($3, $6, $9, 'waiting_for_event', 'PO-1042 laptops', NULL, NULL, NULL, now() - interval '1 day', 'breached', now() - interval '3 days', '[]'),
      ($4, $6, $9, 'completed', 'PO-1000 done', NULL, NULL, NULL, NULL, 'on_track', now() - interval '2 days', '[]'),
      ($5, $7, $12, 'waiting_for_event', 'Tenant B run', NULL, NULL, NULL, NULL, 'on_track', now() - interval '2 days', '[]')`,
    [R_WAIT, R_PAUSED, R_BREACH, R_DONE, R_B, A, B, WF_LEAVE, WF_PO, OTHER, ME, WF_B])
    await q(`INSERT INTO public.tasks (id, tenant_id, title, status, priority, assignee_id, event_id, workflow_run_id) VALUES ($1, $2, 'Approve Grace''s leave', 'todo', 'medium', $3, 'evt-wait', $4)`, [id(0x301), A, ME, R_WAIT])
    const job = (n: number, wf: string, status: string, trigger: string, result: unknown, ageMin: number, extra: { error?: string; data?: unknown; tenant?: string } = {}) =>
      q(`INSERT INTO public.workflow_queue (id, tenant_id, workflow_id, status, trigger_type, trigger_data, result, error, created_at, scheduled_for, next_retry_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, now() - make_interval(mins => $9), now() + interval '1 year', now() + interval '1 year')`,
      [id(n), extra.tenant ?? A, wf, status, trigger, JSON.stringify(extra.data ?? {}), result == null ? null : JSON.stringify(result), extra.error ?? null, ageMin])
    await job(0x401, WF_LEAVE, 'completed', 'form_submitted', { run_id: R_WAIT }, 7000)
    // A completed resume job of the same run: folded into the start job.
    await job(0x402, WF_LEAVE, 'completed', 'task_resume', { run_id: R_WAIT }, 6000)
    await job(0x403, WF_LEAVE, 'completed', 'form_submitted', { run_id: R_PAUSED }, 5800)
    await job(0x404, WF_PO, 'completed', 'manual', { run_id: R_BREACH }, 4300)
    await job(0x405, WF_PO, 'completed', 'schedule', { run_id: R_DONE }, 2900)
    await job(0x406, WF_PO, 'dead', 'webhook_received', null, 2000, { error: 'Workflow is not published' })
    await job(0x407, WF_LEAVE, 'failed', 'data_table_event', null, 1500, { error: 'Timeout after 30s' })
    await job(0x408, WF_LEAVE, 'pending', 'form_submitted', null, 3000, { data: { _started_by: { user_id: ME } } })
    await job(0x409, WF_B, 'completed', 'manual', { run_id: R_B }, 100, { tenant: B })
    // 60 newer finished jobs ahead of every active item.
    await q(`INSERT INTO public.workflow_queue (tenant_id, workflow_id, status, trigger_type, result, created_at, scheduled_for)
             SELECT $1, $2, 'completed', 'schedule', NULL, now() - make_interval(mins => g), now() FROM generate_series(1, 60) g`, [A, WF_PO])
  })

  afterAll(async () => {
    await cleanup()
    await db.end()
  })

  it('Active by default: no terminal statuses, active items behind 60 newer finished ones still listed', async () => {
    const r = await list({})
    expect(r.rows.map((x: any) => x.effective_status).sort()).toEqual(['paused', 'pending', 'waiting_for_event', 'waiting_for_event'])
    expect(r.total).toBe(4)
    expect(ids(r)).toEqual([id(0x408), R_BREACH, R_PAUSED, R_WAIT])
    expect(r.view_counts).toEqual({ active: 4, attention: 3, completed: 61, all: 67 })
    expect(r.status_counts).toMatchObject({ waiting_for_event: 2, paused: 1, pending: 1, failed: 1, dead: 1, completed: 61 })
  })

  it('views and status chips', async () => {
    expect(ids(await list({ view: 'attention' })).sort()).toEqual([R_BREACH, id(0x406), id(0x407)].sort())
    expect((await list({ view: 'completed' })).total).toBe(61)
    expect(ids(await list({ view: 'active', statuses: ['paused'] }))).toEqual([R_PAUSED])
    expect((await list({ view: 'all' }, { limit: 0 })).rows).toEqual([])
  })

  it('pages and sorts in the database', async () => {
    const p1 = await list({ view: 'completed' }, { limit: 25, offset: 0 })
    const p3 = await list({ view: 'completed' }, { limit: 25, offset: 50 })
    expect(p1.rows).toHaveLength(25)
    expect(p3.rows).toHaveLength(11)
    expect(p1.total).toBe(61)
    const asc = await list({}, { sort: 'created_at', dir: 'asc' })
    expect(ids(asc)[0]).toBe(R_WAIT)
  })

  it('enriches rows: step, assignee, starter, run', async () => {
    const row = (await list({ search: 'Grace, 3' })).rows[0]
    expect(row).toMatchObject({ id: id(0x401), effective_status: 'waiting_for_event', step_label: "Approve Grace's leave",
      assignee: { id: ME }, started_by: { id: OTHER, name: 'Grace Liu' }, run: { id: R_WAIT, title: 'Leave: Grace, 3 days' } })
  })

  it.each([
    ['workflow name', 'leave req', [R_WAIT, R_PAUSED, id(0x408)]],
    ['run title', 'po-1042', [R_BREACH]],
    ['short id', id(0x408).slice(-12), [id(0x408)]],
    ['run id', R_PAUSED, [R_PAUSED]],
    ['open task title', "grace's leave", [R_WAIT]],
    ['starter name', 'grace liu', [R_WAIT]],
    ['starter email', 'queue-me@', [R_PAUSED, id(0x408)]],
    ['LIKE wildcards literally', '%', []],
  ])('search: %s', async (_label, search, expected) => {
    expect(ids(await list({ search })).sort()).toEqual([...expected].sort())
  })

  it('advanced filters combine', async () => {
    expect(ids(await list({ view: 'all', workflow_ids: [WF_PO], has_errors: true }))).toEqual([id(0x406)])
    expect(ids(await list({ view: 'all', sla: ['breached'] }))).toEqual([R_BREACH])
    expect(ids(await list({ started_by: [ME] })).sort()).toEqual([R_PAUSED, id(0x408)].sort())
    expect(ids(await list({ assignee_ids: [ME] }))).toEqual([R_WAIT])
    expect(ids(await list({ view: 'all', trigger_types: ['webhook_received', 'data_table_event'] })).sort()).toEqual([id(0x406), id(0x407)].sort())
    expect(ids(await list({ view: 'all', date_field: 'created', date_from: new Date(Date.now() - 2100 * 60_000).toISOString(), date_to: new Date(Date.now() - 1000 * 60_000).toISOString() })).sort())
      .toEqual([id(0x406), id(0x407)].sort())
    const counts = (await list({ workflow_ids: [WF_LEAVE] })).view_counts
    expect(counts).toEqual({ active: 3, attention: 1, completed: 0, all: 4 })
  })

  it('visibility tiers: granted workflow, involved run, queued by me, nothing', async () => {
    const scope = (s: Record<string, unknown>) => ({ workflow_ids: [], run_ids: [], user_id: null, ...s })
    expect(ids(await list({ view: 'all' }, { scope: scope({ workflow_ids: [WF_PO] }) })).length).toBe(63)
    expect(ids(await list({ view: 'all' }, { scope: scope({ run_ids: [R_PAUSED] }) }))).toEqual([R_PAUSED])
    expect(ids(await list({ view: 'all' }, { scope: scope({ user_id: ME }) }))).toEqual([id(0x408)])
    const none = await list({ view: 'all' }, { scope: scope({}) })
    expect(none.total).toBe(0)
    expect(none.status_counts).toEqual({})
  })

  it('tenant isolation: explicit tenant, and RLS for a member passing none; anon may not call', async () => {
    expect(ids(await list({ view: 'all' }, { tenant: B }))).toEqual([R_B])
    expect(ids(await list({ view: 'all' }))).not.toContain(R_B)
    await db.query('BEGIN')
    try {
      await db.query('SET LOCAL ROLE authenticated')
      await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: ME, role: 'authenticated' })])
      const r = (await db.query(`SELECT public.workflow_queue_list(NULL, '{"view":"all"}'::jsonb, NULL, 'created_at', 'desc', 100, 0) AS r`)).rows[0].r
      expect(r.rows.map((x: any) => x.run?.id ?? x.id)).not.toContain(R_B)
      expect(r.total).toBeGreaterThanOrEqual(66)
    } finally {
      await db.query('ROLLBACK')
    }
    await db.query('BEGIN')
    try {
      await db.query('SET LOCAL ROLE anon')
      await expect(db.query(`SELECT public.workflow_queue_list(NULL, '{}'::jsonb)`)).rejects.toThrow(/permission denied/)
    } finally {
      await db.query('ROLLBACK')
    }
  })
})
