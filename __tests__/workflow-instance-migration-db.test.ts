/**
 * Live instance migration end to end against a LOCAL Supabase stack:
 * v1 (start → user_task A → log) with 3 live runs, v2 (start → A → new step
 * B → log). Two runs move to A (same id), one to B. Old runs end `migrated`
 * with their tasks cancelled and queued resumes killed; new runs wait at A
 * with fresh tasks / ran B; completing the new tasks finishes them on the v2
 * path. Also the RPC's conflict rules (running run, changed event).
 *
 * Runs only when EVENT_STREAM_DB_URL is set, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/workflow-instance-migration-db.test.ts
 * The engine and services talk to the stack's API (ENGINE_SMOKE_SUPABASE_URL /
 * ENGINE_SMOKE_SERVICE_ROLE_KEY, defaulting to the standard local stack).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client } from 'pg'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from './helpers/db-test-client'

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.ENGINE_SMOKE_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.ENGINE_SMOKE_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

// The engine creates its own client from these when none is passed.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= process.env.ENGINE_SMOKE_SUPABASE_URL ?? 'http://127.0.0.1:54321'
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= process.env.ENGINE_SMOKE_SERVICE_ROLE_KEY
    ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
})

import { executeWorkflow, resumeWorkflow } from '@/lib/workflow-engine'
import { listLiveInstances, migrateInstances } from '@/lib/services/workflow-runs'
import type { ServiceContext } from '@/lib/services/context'

const TENANT = '0d5e0000-0000-4000-8000-00000000000b'
const WF = '0d5e0000-0000-4000-8000-0000000000b1'
const V1 = '0d5e0000-0000-4000-8000-0000000000b2'
const V2 = '0d5e0000-0000-4000-8000-0000000000b3'

const taskA = { id: 'A', type: 'user_task', label: 'Approve', config: { task_title: 'Approve {{invoice}}', outcomes: ['Approved', 'Rejected'] } }
const v1Nodes = [
  { id: 'start', type: 'manual', label: 'Start', config: {} },
  taskA,
  { id: 'done', type: 'log', label: 'Log', config: { message: 'v1 {{outcome}}', level: 'info' } },
]
const v1Edges = [{ id: 'e1', source: 'start', target: 'A' }, { id: 'e2', source: 'A', target: 'done' }]
const v2Nodes = [
  ...v1Nodes.slice(0, 2),
  { id: 'B', type: 'set_variable', label: 'Stamp', config: { name: 'stamp', expression: 'v2-{{invoice}}' } },
  { id: 'done', type: 'log', label: 'Log', config: { message: 'v2 {{outcome}} {{stamp}} {{region}}', level: 'info' } },
]
const v2Edges = [{ id: 'e1', source: 'start', target: 'A' }, { id: 'e2', source: 'A', target: 'B' }, { id: 'e3', source: 'B', target: 'done' }]

async function cleanup(db: Client) {
  await db.query('UPDATE public.workflow_runs SET migrated_to_run_id = NULL, migrated_from_run_id = NULL WHERE tenant_id = $1', [TENANT]).catch(() => undefined)
  for (const table of ['event_stream', 'object_audit_log', 'workflow_logs', 'workflow_queue', 'workflow_runs', 'task_reminders', 'lifecycle_events', 'notifications', 'tasks', 'workflow_versions', 'workflows']) {
    await db.query(`DELETE FROM public.${table} WHERE tenant_id = $1`, [TENANT]).catch(() => undefined)
  }
  await db.query('DELETE FROM public.tenants WHERE id = $1', [TENANT])
}

describe.skipIf(!DB_URL)('live instance migration against the local DB', () => {
  const db = new Client({ connectionString: DB_URL })
  let supabase: SupabaseClient
  let ctx: ServiceContext
  const started: Array<{ run_id: string; event_id: string }> = []

  beforeAll(async () => {
    await db.connect()
    await cleanup(db)
    await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Migration E2E', 'migration-e2e')`, [TENANT])
    await db.query(
      `INSERT INTO public.workflows (id, tenant_id, name, is_active, trigger_type, nodes, edges, published_version_id)
       VALUES ($1, $2, 'Invoice approval', true, 'manual', $3::jsonb, $4::jsonb, NULL)`,
      [WF, TENANT, JSON.stringify(v1Nodes), JSON.stringify(v1Edges)],
    )
    await db.query(
      `INSERT INTO public.workflow_versions (id, workflow_id, tenant_id, version_number, nodes, edges, user_variables, is_active, trigger_type)
       VALUES ($1, $2, $3, 1, $4::jsonb, $5::jsonb, '[]'::jsonb, true, 'manual')`,
      [V1, WF, TENANT, JSON.stringify(v1Nodes), JSON.stringify(v1Edges)],
    )
    await db.query('UPDATE public.workflows SET published_version_id = $1 WHERE id = $2', [V1, WF])
    supabase = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
    ctx = {
      supabase, tenantId: TENANT, actorId: null,
      permissions: new Set(['workflows.view', 'workflows.view_runs', 'workflows.activate', 'workflows.manage_runs']),
      authKind: 'api_key', source: 'api',
    }
    for (const invoice of ['INV-1', 'INV-2', 'INV-3']) {
      const run = await executeWorkflow(WF, undefined, false, { invoice }, undefined, V1, undefined, { supabase })
      expect(run.status).toBe('waiting_for_event')
      started.push({ run_id: String(run.run_id), event_id: String(run.event_id) })
    }
    // Publish v2 (adds B after A and a new user variable).
    await db.query(
      `INSERT INTO public.workflow_versions (id, workflow_id, tenant_id, version_number, nodes, edges, user_variables, is_active, trigger_type)
       VALUES ($1, $2, $3, 2, $4::jsonb, $5::jsonb, $6::jsonb, true, 'manual')`,
      [V2, WF, TENANT, JSON.stringify(v2Nodes), JSON.stringify(v2Edges), JSON.stringify([{ id: 'u1', name: 'region', type: 'string', defaultValue: 'EU' }])],
    )
    await db.query('UPDATE public.workflow_versions SET is_active = false WHERE id = $1', [V1])
    await db.query('UPDATE public.workflows SET published_version_id = $1 WHERE id = $2', [V2, WF])
  }, 60_000)

  afterAll(async () => {
    await cleanup(db)
    await db.end()
  })

  it('lists the live instances with their node, version and open task', async () => {
    const list = await listLiveInstances(ctx, WF)
    expect(list.total).toBe(3)
    expect(list.on_older_versions).toBe(3)
    expect(list.versions).toEqual([expect.objectContaining({ version_id: V1, version_number: 1, is_published: false, instances: 3 })])
    expect(list.instances[0]).toMatchObject({ version_number: 1, current_node_id: 'A', current_node_label: 'Approve', current_node_type: 'user_task' })
    expect(list.instances[0].open_task?.title).toMatch(/^Approve INV-/)
  })

  it('refuses running runs and runs whose event changed (conflict, nothing changed)', async () => {
    const [first] = started
    const call = (expected: string) => supabase.rpc('migrate_workflow_instance', {
      p_tenant_id: TENANT, p_run_id: first.run_id, p_expected_event_id: expected,
      p_from_version_id: V1, p_to_version_id: V2, p_target_node_id: 'A',
    })
    const changed = await call('some-other-event')
    expect(changed.error).toBeNull()
    expect(changed.data).toMatchObject({ ok: false, conflict: true })
    await db.query(`UPDATE public.workflow_runs SET status = 'running' WHERE id = $1`, [first.run_id])
    const running = await call(first.event_id)
    expect(running.data).toMatchObject({ ok: false, conflict: true, status: 'running' })
    await db.query(`UPDATE public.workflow_runs SET status = 'waiting_for_event' WHERE id = $1`, [first.run_id])
    const { rows } = await db.query('SELECT count(*)::int AS n FROM public.workflow_runs WHERE migrated_from_run_id = $1', [first.run_id])
    expect(rows[0].n).toBe(0)
  })

  it('the migrate RPC is not callable by signed-in clients', async () => {
    const { rows } = await db.query(`SELECT has_function_privilege('authenticated', 'public.migrate_workflow_instance(uuid, uuid, text, uuid, uuid, text, jsonb, jsonb)', 'EXECUTE') AS ok`)
    expect(rows[0].ok).toBe(false)
  })

  it('dry run plans every instance, then migrates two to A and one to B', async () => {
    // A queued resume for the third run (its task was "completed" just before).
    await db.query(
      `INSERT INTO public.workflow_queue (workflow_id, tenant_id, trigger_type, trigger_data, status)
       VALUES ($1, $2, 'task_resume', $3::jsonb, 'pending')`,
      [WF, TENANT, JSON.stringify({ _task_resume: { run_id: started[2].run_id, event_id: started[2].event_id, payload: '{}', sig: 'x' } })],
    )
    const input = { workflowId: WF, toVersionId: V2, runIds: started.map((s) => s.run_id) }
    const dry = await migrateInstances(ctx, { ...input, dryRun: true })
    expect(dry.dry_run).toBe(true)
    expect(dry.plan.summary).toMatchObject({ total: 3, ready: 3, blocked: 0 })
    expect(dry.plan.items[0]).toMatchObject({ target_node_id: 'A', target_via: 'same_id', create: expect.objectContaining({ creates_task: true, defaulted_variables: ['region'] }) })
    expect(dry.plan.items[2].warnings.join(' ')).toMatch(/resume is queued/)
    const { rows: untouched } = await db.query(`SELECT count(*)::int AS n FROM public.workflow_runs WHERE tenant_id = $1 AND status = 'migrated'`, [TENANT])
    expect(untouched[0].n).toBe(0)

    // Two runs → A (same id), one → B (override for its node).
    const toA = await migrateInstances(ctx, { ...input, runIds: [started[0].run_id, started[1].run_id] })
    const toB = await migrateInstances(ctx, { ...input, runIds: [started[2].run_id], nodeMap: { A: 'B' } })
    expect(toA.summary).toMatchObject({ migrated: 2, failed: 0 })
    expect(toB.summary).toMatchObject({ migrated: 1, failed: 0 })
    expect(toA.results.map((r) => r.new_status)).toEqual(['waiting_for_event', 'waiting_for_event'])
    expect(toB.results[0]).toMatchObject({ ok: true, new_status: 'completed', target_node_id: 'B' })
    expect(toB.results[0].cancelled_job_ids).toHaveLength(1)

    for (const [i, result] of [...toA.results, ...toB.results].entries()) {
      const old = started[i]
      const { rows: [oldRun] } = await db.query('SELECT status, event_id, paused_node_id, migrated_to_run_id, trace_id FROM public.workflow_runs WHERE id = $1', [old.run_id])
      expect(oldRun).toMatchObject({ status: 'migrated', event_id: null, paused_node_id: null, migrated_to_run_id: result.new_run_id })
      const { rows: [oldTask] } = await db.query('SELECT status FROM public.tasks WHERE event_id = $1', [old.event_id])
      expect(oldTask.status).toBe('cancelled')
      const { rows: [newRun] } = await db.query('SELECT version_id, migrated_from_run_id, trace_id, pause_variables, node_results FROM public.workflow_runs WHERE id = $1', [result.new_run_id])
      expect(newRun).toMatchObject({ version_id: V2, migrated_from_run_id: old.run_id, trace_id: oldRun.trace_id })
    }

    // Events: workflow.run.migrated on both sides.
    const { rows: events } = await db.query(
      `SELECT type, run_id, attributes FROM public.event_stream WHERE tenant_id = $1 AND type = 'workflow.run.migrated' ORDER BY id`, [TENANT])
    expect(events).toHaveLength(6)
    expect(events.filter((e) => e.attributes.direction === 'out').map((e) => e.run_id).sort()).toEqual(started.map((s) => s.run_id).sort())

    // Run B: executed the new step and finished on the v2 path with the carried + defaulted variables.
    const { rows: [bRun] } = await db.query('SELECT status, node_results FROM public.workflow_runs WHERE id = $1', [toB.results[0].new_run_id])
    expect(bRun.status).toBe('completed')
    expect(bRun.node_results.done.output).toEqual({ logged: 'v2  v2-INV-3 EU' })

    // Runs at A: fresh tasks; completing them follows A → B → log.
    for (const result of toA.results) {
      const { rows: [run] } = await db.query('SELECT event_id, paused_node_id FROM public.workflow_runs WHERE id = $1', [result.new_run_id])
      expect(run.paused_node_id).toBe('A')
      const { rows: tasks } = await db.query(`SELECT status FROM public.tasks WHERE event_id = $1`, [run.event_id])
      expect(tasks).toEqual([{ status: 'todo' }])
      const resumed = await resumeWorkflow(run.event_id, { outcome: 'Approved' }, undefined, { supabase })
      expect(resumed.status).toBe('completed')
      expect(resumed.node_results.B?.status).toBe('success')
      expect(String(resumed.node_results.done?.output?.logged)).toMatch(/^v2 Approved v2-INV-[12] EU$/)
    }
  }, 60_000)

  it('migrating again is a no-op per instance (already migrated → blocked)', async () => {
    const again = await migrateInstances(ctx, { workflowId: WF, toVersionId: V2, runIds: [started[0].run_id] })
    expect(again.results[0]).toMatchObject({ ok: false })
    expect(again.plan.items[0].blocked_reason).toMatch(/migrated/)
  })
})
