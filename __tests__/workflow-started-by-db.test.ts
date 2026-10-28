/**
 * `workflow_started_by` through the real queue on a LOCAL Supabase stack:
 *  - an API start queued with enqueue_workflow keeps its signed initiator
 *    through jsonb (keys reordered) and the worker runs it as that user;
 *  - a task insert fires fn_enqueue_task_workflows; the worker takes the
 *    actor from the task row (task_created → the assigner);
 *  - a member copying that signature onto other variables through their own
 *    enqueue_workflow call gets a run attributed to the owner.
 *
 * Runs only when EVENT_STREAM_DB_URL is set, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/workflow-started-by-db.test.ts
 * The engine talks to the stack's API (ENGINE_SMOKE_SUPABASE_URL /
 * ENGINE_SMOKE_SERVICE_ROLE_KEY, defaulting to the standard local stack).
 * Rows are committed (the engine uses its own connections) and deleted after;
 * only this suite's jobs are run (never the shared queue).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client } from 'pg'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from './helpers/db-test-client'

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/process-queue', async (importOriginal) => ({ ...(await importOriginal<object>()), kickQueueProcessor: vi.fn() }))

import { runJob } from '@/lib/workflow-queue-processor'
import { startWorkflow } from '@/lib/services/workflow-start'
import type { ServiceContext } from '@/lib/services/context'

/* eslint-disable @typescript-eslint/no-explicit-any -- queue rows are free-form JSON */

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.ENGINE_SMOKE_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.ENGINE_SMOKE_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const id = (n: number) => `0f5b0000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const TENANT = id(0xa)
// Distinct first 8 characters: each auth user gets a personal workspace slug from them.
const OWNER = '0f5b0001-0000-4000-8000-000000000001'
const ALICE = '0f5b0002-0000-4000-8000-000000000002'
const BOB = '0f5b0003-0000-4000-8000-000000000003'
const USERS = [OWNER, ALICE, BOB]
const WF = id(0xa1)
const TASK_WF = id(0xa2)
const TASK = id(0xc1)

const who = { id: 'who', type: 'set_variable', label: 'Who', config: { name: 'who', expression: '{{workflow_started_by}}|{{workflow_started_via}}|{{workflow_owner_id}}' } }
const nodesFor = (trigger: string) => [{ id: 'start', type: trigger, label: 'Start', config: {} }, who]
const edges = [{ id: 'e1', source: 'start', target: 'who' }]

describe.skipIf(!DB_URL)('workflow_started_by through the queue (local stack)', () => {
  const db = new Client({ connectionString: DB_URL })
  let admin: SupabaseClient
  const prev = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY }

  async function cleanup() {
    for (const table of ['workflow_logs', 'workflow_queue', 'workflow_runs', 'task_assignees', 'lifecycle_events', 'notifications', 'tasks', 'workflow_versions', 'workflows', 'user_memberships']) {
      await db.query(`DELETE FROM public.${table} WHERE tenant_id = $1`, [TENANT]).catch(() => undefined)
    }
    await db.query('DELETE FROM public.user_memberships WHERE user_id = ANY($1::uuid[])', [USERS]).catch(() => undefined)
    const { rows } = await db.query('SELECT DISTINCT tenant_id FROM public.users WHERE id = ANY($1::uuid[])', [USERS]).catch(() => ({ rows: [] as any[] }))
    await db.query('DELETE FROM public.users WHERE id = ANY($1::uuid[])', [USERS]).catch(() => undefined)
    await db.query('DELETE FROM auth.users WHERE id = ANY($1::uuid[])', [USERS]).catch(() => undefined)
    for (const row of rows) if (row.tenant_id !== TENANT) await db.query('DELETE FROM public.tenants WHERE id = $1', [row.tenant_id]).catch(() => undefined)
    await db.query('DELETE FROM public.tenants WHERE id = $1', [TENANT])
  }

  /** Run this suite's pending jobs of `workflowId` (claimed by hand, never the shared queue). */
  async function runPending(workflowId: string): Promise<string[]> {
    const { rows } = await db.query(
      `UPDATE public.workflow_queue SET status = 'processing', locked_at = now(), locked_by = 'started-by-test', attempts = attempts + 1
       WHERE tenant_id = $1 AND workflow_id = $2 AND status = 'pending' RETURNING *`,
      [TENANT, workflowId],
    )
    const out: string[] = []
    for (const job of rows) {
      const summary = await runJob(admin, job)
      expect(summary.status).toBe('completed')
      const { rows: [done] } = await db.query('SELECT result FROM public.workflow_queue WHERE id = $1', [job.id])
      const { rows: [run] } = await db.query('SELECT node_results FROM public.workflow_runs WHERE id = $1', [done.result.run_id])
      out.push(run.node_results.who.output.value)
    }
    return out
  }

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = API_URL
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY
    await db.connect()
    await cleanup()
    await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Started by', 'started-by-test')`, [TENANT])
    for (const [i, user] of USERS.entries()) {
      await db.query(
        `INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`,
        [user, `started-by-${i}@test.local`],
      )
      await db.query(`INSERT INTO public.user_memberships (user_id, tenant_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`, [user, TENANT])
    }
    await db.query(
      `INSERT INTO public.workflows (id, tenant_id, name, is_active, trigger_type, nodes, edges, created_by)
       VALUES ($1, $3, 'Started by: manual', true, 'manual', $4::jsonb, $6::jsonb, $7),
              ($2, $3, 'Started by: task', true, 'task_created', $5::jsonb, $6::jsonb, $7)`,
      [WF, TASK_WF, TENANT, JSON.stringify(nodesFor('manual')), JSON.stringify(nodesFor('task_created')), JSON.stringify(edges), OWNER],
    )
    admin = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  })
  afterAll(async () => {
    await cleanup()
    await db.end()
    process.env.NEXT_PUBLIC_SUPABASE_URL = prev.url
    process.env.SUPABASE_SERVICE_ROLE_KEY = prev.key
  })

  it('an API start queued through jsonb runs as the key\'s user', async () => {
    const ctx: ServiceContext = { supabase: admin, tenantId: TENANT, actorId: ALICE, permissions: null, authKind: 'api_key', source: 'api' }
    const started = await startWorkflow(ctx, { workflow_id: WF, async: true, variables: { zeta: 1, alpha: { b: 2, a: [1.5, 'x'] }, workflow_started_by: BOB } })
    expect(started.mode).toBe('async')
    expect(await runPending(WF)).toEqual([`${ALICE}|api|${OWNER}`])
  })

  it('a task insert (task_created trigger) runs as the task\'s assigner', async () => {
    await db.query(`INSERT INTO public.tasks (id, tenant_id, title, assigner_id, assignee_id) VALUES ($1, $2, 'Started by task', $3, $4)`, [TASK, TENANT, BOB, ALICE])
    expect(await runPending(TASK_WF)).toEqual([`${BOB}|task|${OWNER}`])
  })

  it('a copied signature on other variables (a member\'s own enqueue_workflow) runs as the owner', async () => {
    const ctx: ServiceContext = { supabase: admin, tenantId: TENANT, actorId: ALICE, permissions: null, authKind: 'api_key', source: 'api' }
    await startWorkflow(ctx, { workflow_id: WF, async: true, variables: { amount: 1 } })
    const { rows: [job] } = await db.query(`SELECT trigger_data FROM public.workflow_queue WHERE tenant_id = $1 AND workflow_id = $2 AND status = 'pending'`, [TENANT, WF])
    await db.query(`UPDATE public.workflow_queue SET status = 'cancelled' WHERE tenant_id = $1 AND workflow_id = $2 AND status = 'pending'`, [TENANT, WF])
    const forged = { ...job.trigger_data, amount: 1_000_000 }
    // Since 20261118000000 members cannot call enqueue_workflow at all; the
    // signature check still guards jobs that reach the queue another way.
    const { rows: [grant] } = await db.query(`SELECT has_function_privilege('authenticated', 'public.enqueue_workflow(uuid, uuid, uuid, text, jsonb, integer, integer)', 'EXECUTE') AS open`)
    await db.query('BEGIN')
    try {
      await db.query(`SET LOCAL ROLE ${grant.open ? 'authenticated' : 'service_role'}`)
      await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(grant.open ? { sub: BOB, role: 'authenticated' } : { role: 'service_role' })])
      await db.query(`SELECT public.enqueue_workflow($1, $2, NULL, 'api', $3::jsonb, 0, 0)`, [WF, TENANT, JSON.stringify(forged)])
      await db.query('COMMIT')
    } catch (error) {
      await db.query('ROLLBACK')
      throw error
    }
    expect(await runPending(WF)).toEqual([`${OWNER}|api|${OWNER}`])
  })
})
