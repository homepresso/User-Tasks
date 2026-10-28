/**
 * Designer test runs left waiting (Save & Test paused at a User Task or
 * server event, then the Test runner was closed, the tab reloaded or the
 * browser quit): they would stay `waiting_for_event` forever.
 *
 * A test run is identified by its engine-owned pause variables
 * (`workflow_started_via` = test, set only by the designer's
 * /api/workflows/execute-stream) — a production run is never matched, and
 * every candidate is re-checked here after the query.
 *
 * Cancelling a test run marks it failed ("Test run closed"), clears its
 * pause state, and cancels the open tasks waiting on its event (test runs
 * create no tasks, but runs resumed before the resume-keeps-test-mode fix
 * could have created a real one).
 *
 * Used by: the Test runner on close and on open (POST
 * /api/workflows/cleanup-test, the caller's own runs of that workflow), and
 * the daily cleanup job (lib/jobs/cleanup-logs.ts, any test run paused for
 * longer than STALE_TEST_RUN_HOURS).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped rows */

export const STALE_TEST_RUN_HOURS = 24
export const TEST_RUN_CLOSED_ERROR = 'Test run closed'

const WAITING = ['waiting_for_event', 'paused']
const OPEN_TASK_STATUSES = ['draft', 'todo', 'in_progress', 'blocked']
const BATCH = 500

export function isDesignerTestRun(run: { pause_variables?: unknown } | null | undefined): boolean {
  const vars = run?.pause_variables
  return !!vars && typeof vars === 'object' && (vars as Record<string, unknown>).workflow_started_via === 'test'
}

export interface TestRunScope {
  tenantId?: string
  workflowId?: string
  /** Only runs this user started. */
  startedBy?: string
  runIds?: string[]
  /** Only runs paused at or before this time (ISO). */
  pausedBefore?: string
}

/** Cancel the open tasks waiting on a run's event (tenant-scoped). */
async function cancelRunTasks(db: any, tenantId: string, eventId: string | null): Promise<string[]> {
  if (!eventId) return []
  const { data, error } = await db.from('tasks')
    .update({ status: 'cancelled' })
    .eq('tenant_id', tenantId)
    .eq('event_id', eventId)
    .in('status', OPEN_TASK_STATUSES)
    .select('id')
  if (error) {
    console.warn('[test-runs] cancelling tasks failed:', error.message)
    return []
  }
  return ((data ?? []) as Array<{ id: string }>).map((t) => String(t.id))
}

/** Cancel one already-loaded waiting test run (no-op for anything else). */
export async function cancelTestRun(
  db: SupabaseClient<any, any, any>,
  run: { id: string; tenant_id: string; status: string; event_id: string | null; pause_variables?: unknown },
): Promise<{ cancelled: boolean; tasks: string[] }> {
  if (!isDesignerTestRun(run) || !WAITING.includes(run.status)) return { cancelled: false, tasks: [] }
  const { data, error } = await (db as any).from('workflow_runs')
    .update({
      status: 'failed',
      error: TEST_RUN_CLOSED_ERROR,
      completed_at: new Date().toISOString(),
      event_id: null,
      paused_at: null,
      paused_node_id: null,
      pause_variables: null,
    })
    .eq('id', run.id)
    .eq('tenant_id', run.tenant_id)
    .eq('status', run.status)
    .select('id')
  if (error || !data?.length) return { cancelled: false, tasks: [] }
  return { cancelled: true, tasks: await cancelRunTasks(db, run.tenant_id, run.event_id) }
}

/** Cancel the waiting designer test runs in `scope`. Production runs are never touched. */
export async function cancelWaitingTestRuns(
  db: SupabaseClient<any, any, any>,
  scope: TestRunScope,
): Promise<{ runs: string[]; tasks: string[] }> {
  let query = (db as any).from('workflow_runs')
    .select('id, tenant_id, workflow_id, status, event_id, paused_at, pause_variables')
    .in('status', WAITING)
    .filter('pause_variables->>workflow_started_via', 'eq', 'test')
  if (scope.tenantId) query = query.eq('tenant_id', scope.tenantId)
  if (scope.workflowId) query = query.eq('workflow_id', scope.workflowId)
  if (scope.startedBy) query = query.filter('pause_variables->>workflow_started_by', 'eq', scope.startedBy)
  if (scope.runIds) {
    if (!scope.runIds.length) return { runs: [], tasks: [] }
    query = query.in('id', scope.runIds)
  }
  if (scope.pausedBefore) query = query.lte('paused_at', scope.pausedBefore)
  const { data, error } = await query.limit(BATCH)
  if (error) {
    console.warn('[test-runs] listing waiting test runs failed:', error.message)
    return { runs: [], tasks: [] }
  }
  const runs: string[] = []
  const tasks: string[] = []
  for (const run of (data ?? []) as Array<any>) {
    // Defence in depth: re-check what the query matched.
    if (!isDesignerTestRun(run)) continue
    if (scope.startedBy && run.pause_variables.workflow_started_by !== scope.startedBy) continue
    if (scope.tenantId && run.tenant_id !== scope.tenantId) continue
    const result = await cancelTestRun(db, run)
    if (result.cancelled) {
      runs.push(String(run.id))
      tasks.push(...result.tasks)
    }
  }
  return { runs, tasks }
}

/** Housekeeping: every test run paused for longer than STALE_TEST_RUN_HOURS (all tenants). */
export function cancelStaleTestRuns(db: SupabaseClient<any, any, any>, now: Date = new Date()) {
  const pausedBefore = new Date(now.getTime() - STALE_TEST_RUN_HOURS * 3_600_000).toISOString()
  return cancelWaitingTestRuns(db, { pausedBefore })
}
