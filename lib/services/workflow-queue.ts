/**
 * Workflow queue job management: cancel / retry / delete. One implementation
 * behind POST /api/v1/workflows/queue/{id}/action and the queue UI's delete
 * (app/actions/workflow-queue.ts). The UI used to delete straight from the
 * browser, which RLS silently turned into a no-op (workflow_queue has no
 * DELETE policy, on purpose — deletes go through here).
 *
 * Rules: `workflows.activate`; the job must belong to ctx.tenantId (and the
 * credential's workflow allowlist) and be in the caller's run scope
 * (lib/services/run-visibility: all with view_runs, involved / granted with
 * view_queue); every change is audited.
 *  - A job a worker holds (`processing`) is never deleted. It can be retried
 *    or cancelled once its lease expired (the worker crashed, was OOM-killed
 *    or timed out — recover_queue_job, migration 20270124090000), and
 *    force-cancelled (`force: true`, the UI asks for confirmation) while its
 *    worker is still alive: the worker's result is then discarded by the
 *    lease fence (complete_leased_job). Retrying a live job is refused (it
 *    would run twice).
 *  - delete: pending / failed / dead / completed jobs only. The status is
 *    re-checked in the DELETE itself, so a job claimed in the meantime is
 *    refused (409) rather than pulled from under the worker.
 *  - cancel: status → dead ("Cancelled via API"). Pending / failed jobs only
 *    (completed and dead jobs are already finished).
 *  - retry: a failed or dead job goes back to pending.
 */

import { requirePerm, ServiceError, type ServiceContext } from './context'
import { queueJobInScope, resolveRunScope } from './run-visibility'
import { audit, dbError } from './_shared'
import { kickQueueProcessor } from '@/lib/process-queue'

/* eslint-disable @typescript-eslint/no-explicit-any -- workflow_queue rows are untyped here */

export const DELETABLE_QUEUE_STATUSES = ['pending', 'failed', 'dead', 'completed'] as const
export const CANCELLABLE_QUEUE_STATUSES = ['pending', 'failed'] as const
const RETRYABLE_QUEUE_STATUSES = ['failed', 'dead']

export type QueueJobAction = 'cancel' | 'retry'

export interface QueueJob {
  id: string
  status: string
  workflow_id: string | null
  trigger_type: string | null
  result?: unknown
  trigger_data?: unknown
}

export type QueueJobActionResult =
  | { action: 'cancelled'; previous_status: string; forced?: boolean; lease_expired?: boolean }
  | { action: 'retried'; previous_status?: string; lease_expired?: boolean }

export interface QueueJobActionOptions {
  /** Cancel a `processing` job whose worker is still alive (its lease has not expired). */
  force?: boolean
}

export interface QueueJobDeleteResult {
  deleted: true
  id: string
  previous_status: string
}

const CANCEL_NOTES: Record<ServiceContext['source'], string> = {
  api: 'Cancelled via API',
  mcp: 'Cancelled via MCP',
  anonymous: 'Cancelled',
  ui: 'Cancelled from queue',
  job: 'Cancelled by a background job',
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function requireWorkflowScope(ctx: ServiceContext, workflowId: string | null) {
  const allow = ctx.resourceScopes?.workflow_ids
  if (allow?.length && (!workflowId || !allow.includes(workflowId))) {
    throw ServiceError.forbidden('This API key is not allowed to access that workflow')
  }
}

/** The tenant's queue job, or a 404 (also for another tenant's job or a malformed id). */
export async function loadQueueJob(ctx: ServiceContext, jobId: string): Promise<QueueJob> {
  if (!jobId || !UUID_RE.test(jobId)) throw ServiceError.notFound('Queue job not found')
  const { data, error } = await (ctx.supabase as any)
    .from('workflow_queue')
    .select('id, status, workflow_id, trigger_type, result, trigger_data')
    .eq('id', jobId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Queue job not found')
  requireWorkflowScope(ctx, data.workflow_id ?? null)
  // The job must also be in the person's run scope (lib/services/run-visibility).
  if (!queueJobInScope(await resolveRunScope(ctx), data)) throw ServiceError.notFound('Queue job not found')
  return data as QueueJob
}

function busyError(status: string, verb: string): ServiceError {
  return status === 'processing'
    ? ServiceError.conflict(`Cannot ${verb} a job that is being processed. Wait for it to finish, then try again.`)
    : ServiceError.conflict(`Cannot ${verb} a job with status '${status}'.`)
}

export async function deleteQueueJob(ctx: ServiceContext, jobId: string): Promise<QueueJobDeleteResult> {
  requirePerm(ctx, 'workflows.activate')
  const job = await loadQueueJob(ctx, jobId)
  if (!(DELETABLE_QUEUE_STATUSES as readonly string[]).includes(job.status)) throw busyError(job.status, 'delete')

  const { data, error } = await (ctx.supabase as any)
    .from('workflow_queue')
    .delete()
    .eq('id', job.id)
    .eq('tenant_id', ctx.tenantId)
    .in('status', DELETABLE_QUEUE_STATUSES as unknown as string[])
    .select('id')
  if (error) throw dbError(error)
  // Claimed by a worker between the read and the delete.
  if (!data?.length) throw busyError('processing', 'delete')

  await audit(ctx, {
    objectType: 'workflow',
    objectId: job.workflow_id ?? job.id,
    action: 'delete_queue_job',
    summary: `Deleted ${job.status} queue job ${job.id}`,
    metadata: { job_id: job.id, status: job.status, trigger_type: job.trigger_type },
  })
  return { deleted: true, id: job.id, previous_status: job.status }
}

/**
 * Retry / cancel of a `processing` job (recover_queue_job): allowed once its
 * lease expired; cancel also with force. Audited.
 */
async function recoverProcessingJob(ctx: ServiceContext, job: QueueJob, action: QueueJobAction, force: boolean): Promise<QueueJobActionResult> {
  const { data, error } = await (ctx.supabase as any).rpc('recover_queue_job', {
    p_job_id: job.id,
    p_tenant_id: ctx.tenantId,
    p_action: action,
    p_force: force,
  })
  if (error) {
    // Before migration 20270124090000 there are no leases to judge by.
    if (['PGRST202', '42883'].includes(String(error.code))) throw busyError('processing', action)
    throw dbError(error)
  }
  const out = (data ?? {}) as { ok?: boolean; reason?: string; status?: string; lease_expired?: boolean; locked_by?: string; run_id?: string }
  if (!out.ok) {
    if (out.reason === 'not_found') throw ServiceError.notFound('Queue job not found')
    if (out.reason === 'not_processing') throw ServiceError.conflict(`The job is no longer being processed (status '${out.status}'). Refresh and try again.`)
    if (action === 'retry') {
      throw ServiceError.conflict('A worker is still processing this job (its lease has not expired), so retrying it would run it twice. Wait for it to finish or for the lease to expire.')
    }
    throw ServiceError.conflict('A worker is still processing this job (its lease has not expired). Force-cancel it to stop tracking it; the worker\'s result will then be discarded.')
  }
  const forced = action === 'cancel' && !out.lease_expired
  await audit(ctx, {
    objectType: 'workflow',
    objectId: job.workflow_id ?? job.id,
    action: action === 'retry' ? 'retry_queue_job' : forced ? 'force_cancel_queue_job' : 'cancel_queue_job',
    summary: action === 'retry'
      ? `Retried stuck queue job ${job.id} (worker lost)`
      : forced
        ? `Force-cancelled processing queue job ${job.id}`
        : `Cancelled stuck queue job ${job.id} (worker lost)`,
    metadata: {
      job_id: job.id,
      status: 'processing',
      lease_expired: out.lease_expired ?? null,
      worker: out.locked_by ?? null,
      run_id: out.run_id ?? null,
      forced,
    },
  })
  if (action === 'retry') {
    kickQueueProcessor()
    return { action: 'retried', previous_status: 'processing', lease_expired: out.lease_expired }
  }
  return { action: 'cancelled', previous_status: 'processing', forced, lease_expired: out.lease_expired }
}

export async function actOnQueueJob(
  ctx: ServiceContext,
  jobId: string,
  action: QueueJobAction,
  options: QueueJobActionOptions = {},
): Promise<QueueJobActionResult> {
  requirePerm(ctx, 'workflows.activate')
  const job = await loadQueueJob(ctx, jobId)
  const db = ctx.supabase as any

  if (job.status === 'processing') return recoverProcessingJob(ctx, job, action, options.force === true)

  if (action === 'cancel') {
    if (!(CANCELLABLE_QUEUE_STATUSES as readonly string[]).includes(job.status)) throw busyError(job.status, 'cancel')
    const { data, error } = await db.from('workflow_queue').update({
      status: 'dead',
      completed_at: new Date().toISOString(),
      error: CANCEL_NOTES[ctx.source],
    }).eq('id', job.id).eq('tenant_id', ctx.tenantId)
      .in('status', CANCELLABLE_QUEUE_STATUSES as unknown as string[])
      .select('id')
    if (error) throw dbError(error)
    if (!data?.length) throw busyError('processing', 'cancel')
    await audit(ctx, {
      objectType: 'workflow',
      objectId: job.workflow_id ?? job.id,
      action: 'cancel_queue_job',
      summary: `Cancelled ${job.status} queue job ${job.id}`,
      metadata: { job_id: job.id, status: job.status },
    })
    return { action: 'cancelled', previous_status: job.status }
  }

  if (!RETRYABLE_QUEUE_STATUSES.includes(job.status)) {
    throw ServiceError.validation(`Cannot retry a job with status '${job.status}'. Only failed or dead jobs can be retried.`)
  }
  const { error } = await db.from('workflow_queue').update({
    status: 'pending',
    error: null,
    attempts: 0,
    locked_by: null,
    locked_at: null,
    next_retry_at: null,
    started_at: null,
    completed_at: null,
  }).eq('id', job.id).eq('tenant_id', ctx.tenantId)
  if (error) throw dbError(error)
  await audit(ctx, {
    objectType: 'workflow',
    objectId: job.workflow_id ?? job.id,
    action: 'retry_queue_job',
    summary: `Retried ${job.status} queue job ${job.id}`,
    metadata: { job_id: job.id, status: job.status },
  })

  // Kick the queue processor (best effort; it used to call the endpoint
  // without the processor secret, which refused it).
  kickQueueProcessor()

  return { action: 'retried' }
}
