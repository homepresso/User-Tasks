/**
 * Parallel approvals against a LOCAL Supabase stack (PostgREST + Postgres):
 * two real User Tasks in parallel branches that meet at a join. The run
 * waits on the first task; the second task is completed first — its
 * completion is found through the jsonb containment lookup on
 * pause_variables and stored with the JSON-path revision check — and the
 * join runs once, after both, when the first one is completed.
 *
 * Runs only when EVENT_STREAM_DB_URL is set (see workflow-engine-smoke-db).
 * Queue jobs are captured instead of enqueued, so a running dev server's
 * worker never picks them up.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client } from 'pg'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from './helpers/db-test-client'

vi.mock('@/lib/process-queue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/process-queue')>()),
  kickQueueProcessor: () => {},
}))

import { executeWorkflow } from '@/lib/workflow-engine'
import { enqueueResume, runQueuedResume } from '@/lib/workflow-resume-queue'

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.ENGINE_SMOKE_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.ENGINE_SMOKE_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const TENANT = '0d5e0000-0000-4000-8000-00000000010a'
const WF = '0d5e0000-0000-4000-8000-0000000001a1'

const task = (id: string) => ({ id, type: 'user_task', label: `Approve ${id}`, config: { task_title: `Approve ${id}`, outcomes: ['Approved', 'Rejected'] } })
const setVar = (id: string, name: string, expression: string) => ({ id, type: 'set_variable', label: `Set ${id}`, config: { name, expression } })
const nodes = [
  { id: 'start', type: 'manual', label: 'Start', config: {} },
  { id: 'p', type: 'parallel', label: 'Approvals', config: { mode: 'parallel', branches: [{ label: 'Finance', order: 0 }, { label: 'Legal', order: 1 }] } },
  task('fin'), setVar('finout', 'finance', '{{outcome}}'),
  task('leg'), setVar('legout', 'legal', '{{outcome}}'),
  setVar('join', 'both', '{{finance}}/{{legal}}'),
]
const edges = [
  { id: 'e1', source: 'start', target: 'p' },
  { id: 'e2', source: 'p', target: 'fin', label: 'Finance' },
  { id: 'e3', source: 'fin', target: 'finout' },
  { id: 'e4', source: 'p', target: 'leg', label: 'Legal' },
  { id: 'e5', source: 'leg', target: 'legout' },
  { id: 'e6', source: 'finout', target: 'join' },
  { id: 'e7', source: 'legout', target: 'join' },
]

async function cleanup(db: Client) {
  for (const table of ['workflow_logs', 'workflow_queue', 'workflow_runs', 'task_reminders', 'task_responses', 'task_assignees', 'lifecycle_events', 'notifications', 'tasks', 'workflow_versions', 'workflows']) {
    await db.query(`DELETE FROM public.${table} WHERE tenant_id = $1`, [TENANT]).catch(() => undefined)
  }
  await db.query('DELETE FROM public.tenants WHERE id = $1', [TENANT])
}

describe.skipIf(!DB_URL)('parallel join: two user tasks against the local DB', () => {
  const db = new Client({ connectionString: DB_URL })
  let supabase: SupabaseClient
  const jobs: Array<Record<string, unknown>> = []

  beforeAll(async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY ??= SERVICE_KEY
    await db.connect()
    await cleanup(db)
    await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Parallel join', 'parallel-join-db')`, [TENANT])
    await db.query(
      `INSERT INTO public.workflows (id, tenant_id, name, is_active, trigger_type, nodes, edges)
       VALUES ($1, $2, 'Parallel approvals', true, 'manual', $3::jsonb, $4::jsonb)`,
      [WF, TENANT, JSON.stringify(nodes), JSON.stringify(edges)],
    )
    const real = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
    // Capture queue jobs (a dev server's worker must not run them).
    supabase = new Proxy(real, {
      get(target, key, receiver) {
        if (key === 'rpc') {
          return (name: string, args: Record<string, unknown>) => {
            if (name === 'enqueue_workflow') {
              jobs.push(args)
              return Promise.resolve({ data: crypto.randomUUID(), error: null })
            }
            return target.rpc(name, args)
          }
        }
        return Reflect.get(target, key, receiver)
      },
    }) as SupabaseClient
  })
  afterAll(async () => {
    await cleanup(db)
    await db.end()
  })

  it('keeps the early completion, then joins once after both tasks', async () => {
    const started = await executeWorkflow(WF, undefined, false, {}, undefined, undefined, undefined, { supabase })
    expect(started.error).toBeUndefined()
    expect(started.status).toBe('waiting_for_event')
    const { rows: tasks } = await db.query(
      'SELECT workflow_step_id, event_id FROM public.tasks WHERE tenant_id = $1 ORDER BY workflow_step_id',
      [TENANT],
    )
    expect(tasks.map((t) => t.workflow_step_id)).toEqual(['fin', 'leg'])
    const finEvent = tasks[0].event_id as string
    const legEvent = tasks[1].event_id as string
    const runRow = async () => (await db.query('SELECT status, event_id, pause_variables, node_results FROM public.workflow_runs WHERE id = $1', [started.run_id])).rows[0]
    // The run waits on the first branch's task (Finance), however the task inserts raced.
    expect((await runRow()).event_id).toBe(finEvent)

    const scope = { workflowId: WF, tenantId: TENANT }
    const runJob = (job: Record<string, unknown>) =>
      runQueuedResume((job.p_trigger_data as { _task_resume: unknown })._task_resume, scope, { supabase })

    // Legal first: found by its deferred event id and kept on the run.
    await enqueueResume({ tenantId: TENANT, eventId: legEvent, variables: { outcome: 'Rejected' }, supabase })
    const early = await runJob(jobs.shift()!)
    expect(early.status).toBe('skipped')
    let row = await runRow()
    expect(row.status).toBe('waiting_for_event')
    expect(row.pause_variables._parallel.completed[legEvent]).toEqual({ outcome: 'Rejected' })

    await enqueueResume({ tenantId: TENANT, eventId: finEvent, variables: { outcome: 'Approved' }, supabase })
    const done = await runJob(jobs.shift()!)
    expect(done.status).toBe('completed')
    row = await runRow()
    expect(row.status).toBe('completed')
    expect(row.node_results.join.output.value).toBe('Approved/Rejected')
  })
})
