/**
 * Who sees which workflow runs and queue items — the ONE scoping rule every
 * queue / run list and run lookup uses (UI reads, REST, MCP, queue and run
 * actions). Governance audit 2026-11:
 *
 *  - workflows.view_runs ("View all runs"): every run and queue item of the
 *    workspace (Owner, Admin, Manager by default).
 *  - workflows.view_queue ("View queue", implied by view_runs): the runs the
 *    person is INVOLVED in — they started it, their form submission started
 *    it, or they are / were the assignee or a collaborator of a task in it
 *    (the same facts as Home's can_view_run_progress) — plus EVERY run of a
 *    workflow they hold an explicit View grant on (object_permissions, type
 *    workflow, can_view, naming them, a role they hold or a team they are in).
 *  - neither: no queue / run list at all (403). Their own runs stay on Home
 *    (Following, My submissions).
 *
 * Tenant-wide credentials (API keys / tokens without a user) are nobody to be
 * involved and grants name people, so with view_queue alone they see nothing:
 * they need view_runs (documented).
 * API-key workflow allowlists (resourceScopes.workflow_ids) still apply on top,
 * in the callers, as before.
 *
 * The scope is resolved server-side with the service-role client (grants,
 * memberships and tasks of the caller's workspace, all tenant-filtered) and
 * applied as a query filter — never filtered in the browser.
 */

import { hasPerm, requirePerm, ServiceError, type ServiceContext } from './context'
import { dbError, serviceRoleClient } from './_shared'
import { workflowGrantIds } from '@/lib/workflow-grants'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped joins */

export type RunScope =
  | { kind: 'all' }
  | { kind: 'scoped'; userId: string | null; workflowIds: string[]; runIds: string[] }

/** Most recent involved runs considered (lists show the newest 200 anyway). */
export const INVOLVED_RUN_LIMIT = 1000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NO_MATCH = '00000000-0000-0000-0000-000000000000'

/** Throw 403 unless the context may open queue / run lists at all. */
export function requireRunListAccess(ctx: ServiceContext): void {
  if (hasPerm(ctx, 'workflows.view_runs')) return
  requirePerm(ctx, 'workflows.view_queue')
}

/** The workflows the person holds an explicit View grant on (directly, by role or by team). */
export async function grantedWorkflowIds(db: any, tenantId: string, userId: string): Promise<string[]> {
  try {
    return await workflowGrantIds(db, tenantId, userId, 'can_view')
  } catch (error) {
    throw dbError({ message: (error as Error).message })
  }
}

/** Runs the person is involved in: started it, their submission started it, or a task of theirs is in it. */
export async function involvedRunIds(db: any, tenantId: string, userId: string, limit = INVOLVED_RUN_LIMIT): Promise<string[]> {
  const [started, submitted, assigned, collaborating] = await Promise.all([
    db.from('workflow_runs').select('id').eq('tenant_id', tenantId).eq('started_by', userId)
      .order('started_at', { ascending: false }).limit(limit),
    db.from('form_submissions').select('id').eq('tenant_id', tenantId).eq('submitted_by', userId)
      .order('created_at', { ascending: false }).limit(limit),
    db.from('tasks').select('workflow_run_id').eq('tenant_id', tenantId).eq('assignee_id', userId)
      .order('created_at', { ascending: false }).limit(limit * 2),
    db.from('task_assignees').select('task_id').eq('tenant_id', tenantId).eq('user_id', userId).limit(limit * 2),
  ])
  for (const r of [started, submitted, assigned, collaborating]) if (r.error) throw dbError(r.error)
  const ids = new Set<string>()
  for (const r of (started.data ?? []) as any[]) ids.add(String(r.id))
  for (const t of (assigned.data ?? []) as any[]) if (t.workflow_run_id) ids.add(String(t.workflow_run_id))
  const collaboratorTaskIds = ((collaborating.data ?? []) as any[]).map((c) => c.task_id).filter(Boolean)
  if (collaboratorTaskIds.length) {
    const { data, error } = await db.from('tasks').select('workflow_run_id').eq('tenant_id', tenantId).in('id', collaboratorTaskIds)
    if (error) throw dbError(error)
    for (const t of (data ?? []) as any[]) if (t.workflow_run_id) ids.add(String(t.workflow_run_id))
  }
  const submissionIds = ((submitted.data ?? []) as any[]).map((s) => s.id)
  if (submissionIds.length) {
    const { data, error } = await db.from('workflow_runs').select('id').eq('tenant_id', tenantId)
      .in('form_submission_id', submissionIds).order('started_at', { ascending: false }).limit(limit)
    if (error) throw dbError(error)
    for (const r of (data ?? []) as any[]) ids.add(String(r.id))
  }
  return [...ids].filter((id) => UUID_RE.test(id)).slice(0, limit)
}

/** Resolve the context's run scope (403 without view_queue / view_runs). */
export async function resolveRunScope(ctx: ServiceContext): Promise<RunScope> {
  requireRunListAccess(ctx)
  if (hasPerm(ctx, 'workflows.view_runs')) return { kind: 'all' }
  if (!ctx.actorId || !ctx.tenantId) return { kind: 'scoped', userId: null, workflowIds: [], runIds: [] }
  const db = await serviceRoleClient(ctx)
  const [workflowIds, runIds] = await Promise.all([
    grantedWorkflowIds(db, ctx.tenantId, ctx.actorId),
    involvedRunIds(db, ctx.tenantId, ctx.actorId),
  ])
  return { kind: 'scoped', userId: ctx.actorId, workflowIds, runIds }
}

const valid = (ids: string[]) => ids.filter((id) => UUID_RE.test(id))

/** PostgREST `or` filter for workflow_runs rows in scope; null = no filter (all). */
export function runScopeFilter(scope: RunScope): string | null {
  if (scope.kind === 'all') return null
  const parts: string[] = []
  const workflows = valid(scope.workflowIds)
  const runs = valid(scope.runIds)
  if (workflows.length) parts.push(`workflow_id.in.(${workflows.join(',')})`)
  if (runs.length) parts.push(`id.in.(${runs.join(',')})`)
  return parts.length ? parts.join(',') : `id.eq.${NO_MATCH}`
}

/**
 * PostgREST `or` filter for workflow_queue rows in scope: a granted workflow,
 * a job whose run is in scope, or a job the person queued (its signed
 * initiator). null = no filter.
 */
export function queueScopeFilter(scope: RunScope): string | null {
  if (scope.kind === 'all') return null
  const parts: string[] = []
  const workflows = valid(scope.workflowIds)
  const runs = valid(scope.runIds)
  if (workflows.length) parts.push(`workflow_id.in.(${workflows.join(',')})`)
  if (runs.length) parts.push(`result->>run_id.in.(${runs.join(',')})`)
  if (scope.userId && UUID_RE.test(scope.userId)) parts.push(`trigger_data->_started_by->>user_id.eq.${scope.userId}`)
  return parts.length ? parts.join(',') : `id.eq.${NO_MATCH}`
}

/** Apply a filter (from runScopeFilter / queueScopeFilter) to a query. */
export function applyScope<Q>(query: Q, filter: string | null): Q {
  return filter ? (query as any).or(filter) : query
}

/** Is this run (id + workflow) in scope? */
export function runInScope(scope: RunScope, run: { id: string; workflow_id: string | null }): boolean {
  if (scope.kind === 'all') return true
  return (run.workflow_id != null && scope.workflowIds.includes(run.workflow_id)) || scope.runIds.includes(run.id)
}

/** Is this queue job in scope? */
export function queueJobInScope(scope: RunScope, job: { workflow_id: string | null; result?: any; trigger_data?: any }): boolean {
  if (scope.kind === 'all') return true
  if (job.workflow_id != null && scope.workflowIds.includes(job.workflow_id)) return true
  const runId = job.result?.run_id
  if (typeof runId === 'string' && scope.runIds.includes(runId)) return true
  const queuedBy = job.trigger_data?._started_by?.user_id
  return Boolean(scope.userId && queuedBy === scope.userId)
}

/** 404 unless the run is visible to the context (also for another tenant's run). */
export async function requireVisibleRun(ctx: ServiceContext, run: { id: string; workflow_id: string | null }): Promise<void> {
  const scope = await resolveRunScope(ctx)
  if (!runInScope(scope, run)) throw ServiceError.notFound('Run not found')
}
