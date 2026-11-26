/**
 * Engine scenarios against a LOCAL Supabase stack through the real queue
 * (enqueue_workflow → claimed by hand → runJob), from the 2026-11 QA pass:
 * loops (for-each, nested, Loop N Times), the step budget (Go To cycle),
 * condition match modes, workflow_error triggers, a waiting run resumed after
 * a new version is published (stays on its version), and Runs → Cancel on a
 * running run.
 *
 * Runs only when EVENT_STREAM_DB_URL is set (plus ENGINE_SMOKE_SUPABASE_URL /
 * ENGINE_SMOKE_SERVICE_ROLE_KEY for the stack's API, defaulting to the
 * standard local stack). Rows are committed and deleted afterwards; jobs are
 * claimed by id, never from the shared queue.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client } from 'pg'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from './helpers/db-test-client'

vi.mock('@/lib/process-queue', async (importOriginal) => ({ ...(await importOriginal<object>()), kickQueueProcessor: vi.fn() }))

import { executeWorkflow, resumeWorkflow } from '@/lib/workflow-engine'
import { runJob } from '@/lib/workflow-queue-processor'

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.ENGINE_SMOKE_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.ENGINE_SMOKE_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const TENANT = '0a1f0000-0000-4000-8000-00000000000a'
const OTHER = '0a1f0000-0000-4000-8000-00000000000b'
let seq = 0
const nextId = () => `0a1f0000-0000-4000-8000-0000000001${(seq++).toString(16).padStart(2, '0')}`

/* eslint-disable @typescript-eslint/no-explicit-any -- queue rows / node results are free-form JSON */

async function cleanup(db: Client) {
  for (const t of ['workflow_logs', 'workflow_queue', 'workflow_runs', 'task_assignees', 'lifecycle_events', 'notifications', 'tasks', 'workflow_versions', 'workflows']) {
    await db.query(`DELETE FROM public.${t} WHERE tenant_id = $1`, [TENANT]).catch(() => undefined)
  }
  for (const t of ['custom_table_rows', 'custom_tables', 'integration_references', 'integrations']) {
    await db.query(`DELETE FROM public.${t} WHERE tenant_id = ANY($1::uuid[])`, [[TENANT, OTHER]]).catch(() => undefined)
  }
  await db.query('DELETE FROM public.tenants WHERE id = ANY($1::uuid[])', [[TENANT, OTHER]])
}

const start = { id: 's', type: 'manual', label: 'Start', config: {} }
const setVar = (id: string, name: string, expression: string) => ({ id, type: 'set_variable', label: id, config: { name, expression } })
const edge = (source: string, target: string, label?: string) => ({ id: `${source}-${target}`, source, target, ...(label ? { label } : {}) })

describe.skipIf(!DB_URL)('engine QA scenarios (local stack, through the queue)', () => {
  const db = new Client({ connectionString: DB_URL })
  let supabase: SupabaseClient

  async function workflow(nodes: unknown[], edges: unknown[], trigger = 'manual') {
    const id = nextId()
    await db.query(
      `INSERT INTO public.workflows (id, tenant_id, name, is_active, trigger_type, nodes, edges) VALUES ($1, $2, $3, true, $4, $5::jsonb, $6::jsonb)`,
      [id, TENANT, `qa-wf ${id.slice(-4)}`, trigger, JSON.stringify(nodes), JSON.stringify(edges)],
    )
    return id
  }

  /** Enqueue a start through the real RPC and run it as a worker would. */
  async function runQueued(workflowId: string, data: Record<string, unknown> = {}) {
    const { data: jobId, error } = await (supabase.rpc as any)('enqueue_workflow', {
      p_workflow_id: workflowId, p_tenant_id: TENANT, p_trigger_type: 'manual', p_trigger_data: data,
    })
    expect(error).toBeNull()
    const { rows: [job] } = await db.query(
      `UPDATE public.workflow_queue SET status = 'processing', locked_at = now(), locked_by = 'qa-wf-test', attempts = attempts + 1
       WHERE id = $1 AND status = 'pending' RETURNING *`,
      [jobId],
    )
    expect(job).toBeTruthy()
    const summary = await runJob(supabase, job)
    const { rows: [done] } = await db.query('SELECT status, result FROM public.workflow_queue WHERE id = $1', [jobId])
    const { rows: [run] } = await db.query('SELECT status, error, node_results FROM public.workflow_runs WHERE id = $1', [done.result?.run_id])
    return { summary, job: done, run }
  }

  beforeAll(async () => {
    await db.connect()
    await cleanup(db)
    await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'qa-wf engine', 'qa-wf-engine'), ($2, 'qa-wf other', 'qa-wf-other')`, [TENANT, OTHER])
    supabase = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  })
  afterAll(async () => {
    await cleanup(db)
    await db.end()
  })

  it('for-each over 2,000 items, then Done', async () => {
    const wf = await workflow(
      [start, { id: 'l', type: 'loop', label: 'Each', config: { items: '{{items}}' } }, setVar('v', 'last', '{{item}}'), setVar('d', 'done', 'yes {{last}}')],
      [edge('s', 'l'), edge('l', 'v', 'Each Item'), edge('l', 'd', 'Done')],
    )
    const { job, run } = await runQueued(wf, { items: Array.from({ length: 2000 }, (_, i) => i) })
    expect(job.status).toBe('completed')
    expect(run.status).toBe('completed')
    expect(run.node_results.d.output.value).toBe('yes 1999')
  }, 120_000)

  it('nested loops see parent_item', async () => {
    const wf = await workflow(
      [start, { id: 'o', type: 'loop', label: 'Orders', config: { items: '{{orders}}' } },
        { id: 'i', type: 'loop', label: 'Lines', config: { items: '{{item.lines}}', item_var: 'line' } },
        setVar('v', 'acc', '{{acc}}|{{parent_item.id}}:{{line}}')],
      [edge('s', 'o'), edge('o', 'i', 'Each Item'), edge('i', 'v', 'Each Item')],
    )
    const { run } = await runQueued(wf, { acc: '', orders: [{ id: 'A', lines: [1, 2] }, { id: 'B', lines: [3] }] })
    expect(run.status).toBe('completed')
    expect(run.node_results.v.output.value).toBe('|A:1|A:2|B:3')
  }, 60_000)

  it('a Go To cycle with no exit fails the run at the step budget (the job completes, no retry storm)', async () => {
    const wf = await workflow(
      [start, setVar('a', 'x', '1'), { id: 'g', type: 'goto_activity', label: 'Again', config: { target_node_id: 'a' } }],
      [edge('s', 'a'), edge('a', 'g')],
    )
    const { job, run } = await runQueued(wf)
    expect(job.status).toBe('completed')
    expect(run.status).toBe('failed')
    expect(run.error).toMatch(/Step limit reached/)
  }, 120_000)

  it('condition match modes: all fires every matching branch, first only the first', async () => {
    const branches = [
      { label: 'Big', logic: 'and', rules: [{ field: '{{amount}}', operator: 'greater_than', value: '100' }] },
      { label: 'Huge', logic: 'and', rules: [{ field: '{{amount}}', operator: 'greater_than', value: '1000' }] },
    ]
    const nodesFor = (mode: string) => [start, { id: 'c', type: 'condition', label: 'C', config: { branches, match_mode: mode } }, setVar('big', 'big', 'y'), setVar('huge', 'huge', 'y'), setVar('else', 'else', 'y')]
    const edges = [edge('s', 'c'), edge('c', 'big', 'Big'), edge('c', 'huge', 'Huge'), edge('c', 'else', 'Else')]
    const all = await runQueued(await workflow(nodesFor('all'), edges), { amount: 5000 })
    expect(Object.keys(all.run.node_results).sort()).toEqual(['big', 'c', 'huge', 's'])
    const first = await runQueued(await workflow(nodesFor('first'), edges), { amount: 5000 })
    expect(Object.keys(first.run.node_results).sort()).toEqual(['big', 'c', 's'])
    const none = await runQueued(await workflow(nodesFor('first'), edges), { amount: 5 })
    expect(Object.keys(none.run.node_results).sort()).toEqual(['c', 'else', 's'])
  }, 60_000)

  it('a failed run fires the workspace workflow_error workflow with the error details', async () => {
    const handler = await workflow(
      [{ id: 'e', type: 'workflow_error', label: 'On error', config: { error_scope: 'all' } }, setVar('h', 'seen', '{{error_message}} @ {{error_node}}')],
      [edge('e', 'h')],
      'workflow_error',
    )
    const failing = await workflow(
      [start, { id: 'end', type: 'end_workflow', label: 'Boom', config: { status: 'failed', reason: 'qa-wf boom' } }],
      [edge('s', 'end')],
    )
    const { run } = await runQueued(failing)
    expect(run.status).toBe('failed')
    // Queued as a workflow_error job (not an unawaited run inside the worker).
    const { rows: [job] } = await db.query(
      `UPDATE public.workflow_queue SET status = 'processing', locked_at = now(), locked_by = 'qa-wf-test', attempts = attempts + 1
       WHERE tenant_id = $1 AND workflow_id = $2 AND status = 'pending' RETURNING *`,
      [TENANT, handler],
    )
    expect(job?.trigger_type).toBe('workflow_error')
    await runJob(supabase, job)
    const { rows: [seen] } = await db.query(`SELECT status, node_results FROM public.workflow_runs WHERE workflow_id = $1`, [handler])
    expect(seen?.node_results?.h?.output?.value).toBe('qa-wf boom @ Boom')
  }, 60_000)

  it('a run waiting on a task resumes on ITS version after a new version is published', async () => {
    const wf = nextId()
    const v1 = nextId()
    const v2 = nextId()
    const graph = (tag: string) => ({
      nodes: [start, { id: 'task', type: 'user_task', label: 'Approve', config: { task_title: 'qa-wf approve', outcomes: ['Approved'] } }, setVar('ver', 'ver', tag)],
      edges: [edge('s', 'task'), edge('task', 'ver')],
    })
    await db.query(
      `INSERT INTO public.workflows (id, tenant_id, name, is_active, trigger_type, nodes, edges) VALUES ($1, $2, 'qa-wf versions', true, 'manual', $3::jsonb, $4::jsonb)`,
      [wf, TENANT, JSON.stringify(graph('draft').nodes), JSON.stringify(graph('draft').edges)],
    )
    for (const [id, n, tag] of [[v1, 1, 'v1'], [v2, 2, 'v2']] as const) {
      await db.query(
        `INSERT INTO public.workflow_versions (id, workflow_id, tenant_id, version_number, nodes, edges, trigger_type) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, 'manual')`,
        [id, wf, TENANT, n, JSON.stringify(graph(tag).nodes), JSON.stringify(graph(tag).edges)],
      )
    }
    await db.query('UPDATE public.workflows SET published_version_id = $1 WHERE id = $2', [v1, wf])
    const started = await executeWorkflow(wf, undefined, false, {}, undefined, undefined, undefined, { supabase })
    expect(started.status).toBe('waiting_for_event')
    await db.query('UPDATE public.workflows SET published_version_id = $1 WHERE id = $2', [v2, wf])
    const resumed = await resumeWorkflow(String(started.event_id), { outcome: 'Approved' }, undefined, { supabase })
    expect(resumed.status).toBe('completed')
    expect(resumed.node_results.ver?.output).toEqual({ variable: 'ver', value: 'v1' })
    const fresh = await executeWorkflow(wf, undefined, false, {}, undefined, undefined, undefined, { supabase })
    const resumedFresh = await resumeWorkflow(String(fresh.event_id), { outcome: 'Approved' }, undefined, { supabase })
    expect(resumedFresh.node_results.ver?.output).toEqual({ variable: 'ver', value: 'v2' })
  }, 60_000)

  it('Runs → Cancel on a running run stops it and keeps it cancelled', async () => {
    const wf = await workflow(
      [start, { id: 'l', type: 'loop_n_times', label: 'Loop', config: { count: 8 } },
        { id: 'w', type: 'delay', label: 'Wait', config: { duration: 1, unit: 'seconds' } }, setVar('m', 'last', '{{i}}')],
      [edge('s', 'l'), edge('l', 'w', 'Each Item'), edge('w', 'm')],
    )
    const running = runQueued(wf)
    let runId: string | undefined
    for (let i = 0; i < 40 && !runId; i++) {
      await new Promise((r) => setTimeout(r, 250))
      const { rows } = await db.query(`SELECT id FROM public.workflow_runs WHERE workflow_id = $1 AND status = 'running'`, [wf])
      runId = rows[0]?.id
    }
    expect(runId).toBeTruthy()
    await new Promise((r) => setTimeout(r, 2500))
    await db.query(`UPDATE public.workflow_runs SET status = 'failed', error = 'Manually cancelled', completed_at = now() WHERE id = $1`, [runId])
    const { run } = await running
    expect(run.status).toBe('failed')
    expect(run.error).toBe('Manually cancelled')
    expect(run.node_results.m?.output?.value ?? -1).toBeLessThan(7)
  }, 60_000)

  it('ids of another workspace in node configs are not found (reference, data table, row)', async () => {
    const { rows: [integration] } = await db.query(
      `INSERT INTO public.integrations (tenant_id, name, type, config) VALUES ($1, 'qa-wf other ERP', 'rest', '{"base_url":"https://erp-other.example.com","auth_type":"none"}'::jsonb) RETURNING id`, [OTHER])
    const { rows: [ref] } = await db.query(
      `INSERT INTO public.integration_references (tenant_id, integration_id, name, request_config) VALUES ($1, $2, 'qa-wf other ref', '{"method":"GET","path_template":"/x"}'::jsonb) RETURNING id`, [OTHER, integration.id])
    const { rows: [table] } = await db.query(
      `INSERT INTO public.custom_tables (tenant_id, name, slug, columns) VALUES ($1, 'qa-wf other table', 'qa-wf-other-table', '[{"key":"salary","label":"Salary"}]'::jsonb) RETURNING id`, [OTHER])
    const { rows: [row] } = await db.query(
      `INSERT INTO public.custom_table_rows (tenant_id, table_id, data) VALUES ($1, $2, '{"salary":250000}'::jsonb) RETURNING id`, [OTHER, table.id])
    const { rows: [ownTable] } = await db.query(
      `INSERT INTO public.custom_tables (tenant_id, name, slug, columns) VALUES ($1, 'qa-wf own table', 'qa-wf-own-table', '[{"key":"salary","label":"Salary"}]'::jsonb) RETURNING id`, [TENANT])

    const callRef = await runQueued(await workflow([start, { id: 'r', type: 'call_reference', label: 'R', config: { reference_id: ref.id } }], [edge('s', 'r')]))
    expect(callRef.run.status).toBe('failed')
    expect(callRef.run.error).toMatch(/Reference not found/)

    const list = await runQueued(await workflow([start, { id: 'd', type: 'update_data_table', label: 'D', config: { table_id: table.id, operation: 'list' } }], [edge('s', 'd')]))
    expect(list.run.status).toBe('failed')
    expect(JSON.stringify(list.run.node_results)).not.toContain('250000')

    for (const operation of ['get', 'update', 'delete']) {
      const res = await runQueued(await workflow(
        [start, { id: 'd', type: 'update_data_table', label: 'D', config: { table_id: ownTable.id, operation, row_id: row.id, column_values: { salary: '1' } } }], [edge('s', 'd')]))
      expect(JSON.stringify(res.run.node_results)).not.toContain('250000')
    }
    const { rows: [after] } = await db.query('SELECT data FROM public.custom_table_rows WHERE id = $1', [row.id])
    expect(after?.data).toEqual({ salary: 250000 })
  }, 60_000)
})
