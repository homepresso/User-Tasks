/**
 * Workflow queue job management: cancel / retry / delete. One implementation
 * behind POST /api/v1/workflows/queue/{id}/action and the queue UI's delete
 * (app/actions/workflow-queue.ts). The UI used to delete straight from the
 * browser, which RLS silently turned into a no-op (workflow_queue has no
 * DELETE policy, on purpose — deletes go through here).
 *
 * Rules: `workflows.activate`; the job must belong to ctx.tenantId (and the
 * credential's workflow allowlist); every change is audited.
 *  - A job a worker holds (`processing`) is never cancelled or deleted: the
 *    worker would carry on and write its result over the change.
 *  - delete: pending / failed / dead / completed jobs only. The status is
 *    re-checked in the DELETE itself, so a job claimed in the meantime is
 *    refused (409) rather than pulled from under the worker.
 *  - cancel: status → dead ("Cancelled via API"). Pending / failed jobs only
 *    (completed and dead jobs are already finished).
 *  - retry: a failed or dead job goes back to pending.
 */

import { requirePerm, ServiceError, type ServiceContext } from './context'
import { audit, dbError } from './_shared'
import { appUrlOrLocalhost } from '@/lib/config/bootstrap'

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
}

export type QueueJobActionResult =
  | { action: 'cancelled'; previous_status: string }
  | { action: 'retried' }

export interface QueueJobDeleteResult {
  deleted: true
  id: string
  previous_status: string
}

const CANCEL_NOTES: Record<ServiceContext['source'], string> = {
  api: 'Cancelled via API',
  mcp: 'Cancelled via MCP',
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
    .select('id, status, workflow_id, trigger_type')
    .eq('id', jobId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Queue job not found')
  requireWorkflowScope(ctx, data.workflow_id ?? null)
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

export async function actOnQueueJob(ctx: ServiceContext, jobId: string, action: QueueJobAction): Promise<QueueJobActionResult> {
  requirePerm(ctx, 'workflows.activate')
  const job = await loadQueueJob(ctx, jobId)
  const db = ctx.supabase as any

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

  // Kick the queue processor (best effort).
  const baseUrl = appUrlOrLocalhost()
  fetch(`${baseUrl}/api/workflows/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ batch_size: 5 }),
  }).catch(() => {})

  return { action: 'retried' }
}
