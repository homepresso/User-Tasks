/**
 * Authorisation for the session routes that run workflows directly:
 * POST /api/workflows/execute (a run, or a designer test run) and
 * POST /api/workflows/execute-stream (the designer's Test runner: start and
 * resume a test run).
 *
 * The engine runs with a service-role client, so these checks are the only
 * thing between a signed-in user and another tenant's workflow:
 *
 *  - The workflow is read through the caller's own (RLS-scoped) client, so it
 *    must be in the workspace they are in (or, from the unified view, one they
 *    belong to); the context then carries that tenant's permissions (explicit
 *    membership check). Anything else is a plain 404.
 *  - Test runs need `workflows.edit` (what the designer's Save needs); real
 *    runs `workflows.activate` (what POST /api/v1/workflows/start needs).
 *  - A task attached to a run must be in the same tenant and visible to the
 *    caller.
 *  - Resuming is only for designer test runs the caller started
 *    (`workflow_started_via` = test, `workflow_started_by` = them, both
 *    engine-owned run variables) — a production run waiting on a real user
 *    task or server event resumes through task / event completion, which
 *    has its own checks.
 */

import { fromSession, hasPerm, isServiceError, ServiceError, type ServiceContext } from './context'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped rows */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const RESUMABLE = new Set(['waiting_for_event', 'paused'])

const NOT_FOUND = 'Workflow not found'
const RUN_NOT_FOUND = 'Run not found'

async function serviceDb(): Promise<any> {
  const { createServiceClient } = await import('@/lib/cron-auth')
  return createServiceClient()
}

export interface AuthorizedWorkflow {
  ctx: ServiceContext
  workflow: { id: string; tenant_id: string }
}

/**
 * The caller's context for a workflow they can see, in that workflow's
 * tenant. Throws 401 (signed out), 404 (missing, not visible, another
 * tenant) or 403 (lacks `permission`).
 */
export async function authorizeWorkflowAccess(workflowId: unknown, permission: string, session?: ServiceContext): Promise<AuthorizedWorkflow> {
  // Signed in first, so a signed-out caller gets 401, never 404.
  const base = session ?? await fromSession()
  if (typeof workflowId !== 'string' || !UUID.test(workflowId)) throw ServiceError.notFound(NOT_FOUND)
  const { data: workflow, error } = await (base.supabase as any)
    .from('workflows').select('id, tenant_id').eq('id', workflowId).maybeSingle()
  if (error && !/invalid input syntax/i.test(error.message ?? '')) throw new ServiceError('internal', 'Failed to load workflow')
  if (!workflow?.tenant_id) throw ServiceError.notFound(NOT_FOUND)

  let ctx = base
  if (String(workflow.tenant_id) !== base.tenantId) {
    // Opened from the unified view: act in the workflow's tenant (membership checked).
    try {
      ctx = await fromSession({ tenantId: String(workflow.tenant_id) })
    } catch (err) {
      if (isServiceError(err) && err.code === 'unauthorized') throw err
      throw ServiceError.notFound(NOT_FOUND)
    }
  }
  if (!hasPerm(ctx, permission)) throw ServiceError.forbidden(`Forbidden: you lack the '${permission}' permission`)
  return { ctx, workflow: { id: String(workflow.id), tenant_id: String(workflow.tenant_id) } }
}

/** Start (or test) a workflow: the workflow, the permission, and the task when one is given. */
export async function authorizeWorkflowExecute(input: { workflowId: unknown; taskId?: unknown; test: boolean }): Promise<AuthorizedWorkflow & { taskId?: string }> {
  const authorized = await authorizeWorkflowAccess(input.workflowId, input.test ? 'workflows.edit' : 'workflows.activate')
  if (input.taskId === undefined || input.taskId === null || input.taskId === '') return authorized

  const taskId = input.taskId
  if (typeof taskId !== 'string' || !UUID.test(taskId)) throw ServiceError.notFound('Task not found')
  // The caller's own client: the task must be one they can see, in the workflow's tenant.
  const { data: task, error } = await (authorized.ctx.supabase as any)
    .from('tasks').select('id, tenant_id').eq('id', taskId).eq('tenant_id', authorized.workflow.tenant_id).maybeSingle()
  if (error && !/invalid input syntax/i.test(error.message ?? '')) throw new ServiceError('internal', 'Failed to load task')
  if (!task || String(task.tenant_id) !== authorized.workflow.tenant_id) throw ServiceError.notFound('Task not found')
  return { ...authorized, taskId }
}

export interface AuthorizedResume extends AuthorizedWorkflow {
  run: { id: string; workflow_id: string; tenant_id: string; event_id: string | null }
}

/**
 * Resume a paused designer test run. `resumeKey` is the run id or its
 * event id (the Test runner sends either); `workflowId`, when given, must be
 * the run's workflow.
 */
export async function authorizeTestRunResume(input: { resumeKey: unknown; workflowId?: unknown }): Promise<AuthorizedResume> {
  // Signed in before anything is looked up.
  const session = await fromSession()
  const key = input.resumeKey
  if (typeof key !== 'string' || !key.trim() || key.length > 200) throw ServiceError.notFound(RUN_NOT_FOUND)

  const admin = await serviceDb()
  let query = admin.from('workflow_runs').select('id, workflow_id, tenant_id, status, event_id, pause_variables')
  query = UUID.test(key) ? query.eq('id', key) : query.eq('event_id', key)
  const { data: run } = await query.maybeSingle()
  if (!run?.workflow_id) throw ServiceError.notFound(RUN_NOT_FOUND)
  if (input.workflowId !== undefined && input.workflowId !== null && input.workflowId !== '' && input.workflowId !== run.workflow_id) {
    throw ServiceError.notFound(RUN_NOT_FOUND)
  }

  // The run's workflow must be one the caller can see (else 404) and edit (else 403).
  let authorized: AuthorizedWorkflow
  try {
    authorized = await authorizeWorkflowAccess(run.workflow_id, 'workflows.edit', session)
  } catch (err) {
    if (isServiceError(err) && err.code === 'not_found') throw ServiceError.notFound(RUN_NOT_FOUND)
    throw err
  }
  if (String(run.tenant_id) !== authorized.workflow.tenant_id) throw ServiceError.notFound(RUN_NOT_FOUND)

  if (!RESUMABLE.has(String(run.status))) throw ServiceError.conflict('Run is not waiting to be resumed')
  const vars = (run.pause_variables ?? {}) as Record<string, unknown>
  const isOwnTestRun = vars.workflow_started_via === 'test' && vars.workflow_started_by === session.actorId
  if (!isOwnTestRun) {
    throw ServiceError.forbidden('Forbidden: only your own designer test runs can be resumed here — complete the task or event instead')
  }

  return {
    ...authorized,
    run: { id: String(run.id), workflow_id: String(run.workflow_id), tenant_id: String(run.tenant_id), event_id: run.event_id ?? null },
  }
}

/** A JSON error body + status for a thrown authorisation error (generic for anything unexpected). */
export function authzErrorResponse(err: unknown): { status: number; body: { error: string } } {
  if (isServiceError(err)) {
    if (err.code === 'unauthorized') return { status: 401, body: { error: 'Unauthorized' } }
    if (err.code === 'internal') return { status: 500, body: { error: 'Workflow execution failed' } }
    return { status: err.status, body: { error: err.message } }
  }
  console.error('[workflow-authz]', err instanceof Error ? err.message : err)
  return { status: 500, body: { error: 'Workflow execution failed' } }
}
