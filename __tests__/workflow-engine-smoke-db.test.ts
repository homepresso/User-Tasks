/**
 * Engine smoke test against a LOCAL Supabase stack: a real run of
 * manual start → user_task (with fields) → log, through PostgREST, so the
 * task insert meets the real constraints (fk_tasks_workflow_source once
 * failed every User Task step — the in-memory fake has no foreign keys).
 *
 * Runs only when EVENT_STREAM_DB_URL is set, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/workflow-engine-smoke-db.test.ts
 * The engine talks to the stack's API: ENGINE_SMOKE_SUPABASE_URL /
 * ENGINE_SMOKE_SERVICE_ROLE_KEY, defaulting to the standard local stack
 * (http://127.0.0.1:54321 and the public local demo service-role key).
 * Rows are committed (the engine uses its own connections) and deleted after.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from './helpers/db-test-client'
import { executeWorkflow, resumeWorkflow } from '@/lib/workflow-engine'

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.ENGINE_SMOKE_SUPABASE_URL ?? 'http://127.0.0.1:54321'
// The well-known service-role key every `supabase start` stack ships with.
const SERVICE_KEY = process.env.ENGINE_SMOKE_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const TENANT = '0d5e0000-0000-4000-8000-00000000000a'
const WF = '0d5e0000-0000-4000-8000-0000000000a1'

const nodes = [
  { id: 'start', type: 'manual', label: 'Start', config: {} },
  {
    id: 'approve', type: 'user_task', label: 'Approve invoice',
    config: {
      task_title: 'Approve {{invoice}}',
      task_priority: 'high',
      outcomes: ['Approved', 'Rejected'],
      fields: [
        { id: 'f1', key: 'amount', label: 'Amount', type: 'number', required: true },
        { id: 'f2', key: 'comment', label: 'Comment', type: 'text' },
      ],
    },
  },
  { id: 'done', type: 'log', label: 'Log', config: { message: 'Decision {{outcome}}', level: 'info' } },
]
const edges = [
  { id: 'e1', source: 'start', target: 'approve' },
  { id: 'e2', source: 'approve', target: 'done' },
]

async function cleanup(db: Client) {
  for (const table of ['workflow_logs', 'workflow_queue', 'workflow_runs', 'task_reminders', 'task_responses', 'task_assignees', 'lifecycle_events', 'notifications', 'tasks', 'workflow_versions', 'workflows']) {
    await db.query(`DELETE FROM public.${table} WHERE tenant_id = $1`, [TENANT]).catch(() => undefined)
  }
  await db.query('DELETE FROM public.tenants WHERE id = $1', [TENANT])
}

describe.skipIf(!DB_URL)('engine smoke: user_task run against the local DB', () => {
  const db = new Client({ connectionString: DB_URL })
  let supabase: SupabaseClient

  beforeAll(async () => {
    await db.connect()
    await cleanup(db)
    await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Engine smoke', 'engine-smoke')`, [TENANT])
    await db.query(
      `INSERT INTO public.workflows (id, tenant_id, name, is_active, trigger_type, nodes, edges)
       VALUES ($1, $2, 'Smoke: user task', true, 'manual', $3::jsonb, $4::jsonb)`,
      [WF, TENANT, JSON.stringify(nodes), JSON.stringify(edges)],
    )
    supabase = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  })
  afterAll(async () => {
    await cleanup(db)
    await db.end()
  })

  it('creates the task linked to the workflow, pauses, and finishes on resume', async () => {
    const started = await executeWorkflow(WF, undefined, false, { invoice: 'INV-7' }, undefined, undefined, undefined, { supabase })
    expect(started.error).toBeUndefined()
    expect(started.status).toBe('waiting_for_event')
    expect(started.paused_node_id).toBe('approve')

    const { rows: [task] } = await db.query(
      `SELECT id, title, priority, workflow_id, workflow_source_id, workflow_step_id, is_workflow_task, event_id, available_outcomes, metadata
       FROM public.tasks WHERE tenant_id = $1`,
      [TENANT],
    )
    expect(task).toMatchObject({
      title: 'Approve INV-7',
      priority: 'high',
      workflow_id: WF,
      workflow_source_id: null,
      workflow_step_id: 'approve',
      is_workflow_task: true,
      event_id: started.event_id,
      available_outcomes: ['Approved', 'Rejected'],
    })
    expect(task.metadata.fields.map((f: { key: string }) => f.key)).toEqual(['amount', 'comment'])

    const resumed = await resumeWorkflow(String(started.event_id), { outcome: 'Approved', amount: 120 }, undefined, { supabase })
    expect(resumed.error).toBeUndefined()
    expect(resumed.status).toBe('completed')
    expect(resumed.node_results.done?.status).toBe('success')
    expect(resumed.node_results.done?.output).toEqual({ logged: 'Decision Approved' })

    const { rows: [run] } = await db.query('SELECT status FROM public.workflow_runs WHERE id = $1', [started.run_id])
    expect(run.status).toBe('completed')
  })

  it('a workflow-scoped task survives the workflow being deleted (link set null)', async () => {
    const { rows: [task] } = await db.query('SELECT id FROM public.tasks WHERE tenant_id = $1', [TENANT])
    await db.query('BEGIN')
    try {
      await db.query('DELETE FROM public.workflow_runs WHERE workflow_id = $1', [WF])
      await db.query('DELETE FROM public.workflow_logs WHERE workflow_id = $1', [WF])
      await db.query('DELETE FROM public.workflows WHERE id = $1', [WF])
      const { rows: [after] } = await db.query('SELECT workflow_id FROM public.tasks WHERE id = $1', [task.id])
      expect(after.workflow_id).toBeNull()
    } finally {
      await db.query('ROLLBACK')
    }
  })
})
