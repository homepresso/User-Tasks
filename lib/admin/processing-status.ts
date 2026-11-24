/**
 * Settings → Infrastructure → Processing (and GET /api/v1/admin/processing):
 * where queued work runs, queue health, and stuck jobs (worker lost: lease
 * expired) across the instance, with Retry / Cancel.
 *
 * Core reports the web-app mode and the queue; a processing provider (the
 * separate-workers add-on, an extension) adds its own status block and page
 * (ProcessingProvider.status). Instance admins only — callers check.
 *
 * Server-only.
 */
import { writeAudit } from '@/lib/audit-log'
import { queueLeaseExpired } from '@/lib/automations/queue-filters'
import type { ProcessingStatus, QueueHealth } from '@/lib/extensions/sdk'
import { kickQueueProcessor } from '@/lib/process-queue'
import { invalidateProcessingHandoff, processingHandoff, resolveProcessingProvider, type HandoffMode } from '@/lib/processing/handoff'
import { getServiceDb } from '@/lib/providers/db'

/* eslint-disable @typescript-eslint/no-explicit-any -- RPC rows */

export const PROCESSING_DOCS_HREF = '/docs/self-hosting/infrastructure#processing-tier'

export interface StuckJob {
  id: string
  tenant_id: string
  workflow_id: string
  workflow_name: string | null
  trigger_type: string | null
  locked_by: string | null
  locked_at: string | null
  lease_expires_at: string | null
  attempts: number
  max_attempts: number
  lease_lost_count: number
  /** Lease expired (worker lost); false = still running, can only be force-cancelled. */
  stuck: boolean
}

export interface ProcessingStatusView {
  mode: HandoffMode
  provider: (ProcessingStatus & { extension_id: string }) | null
  /** null before migration 20270124090000. */
  queue: QueueHealth | null
  /** Processing jobs, stuck ones first (at most 50). */
  jobs: StuckJob[]
  docs_href: string
}

export async function loadProcessingStatus(): Promise<ProcessingStatusView> {
  invalidateProcessingHandoff()
  const db = getServiceDb() as any
  const [mode, resolved, health, processing] = await Promise.all([
    processingHandoff(),
    resolveProcessingProvider().catch(() => null),
    db.rpc('get_queue_health', { p_tenant_id: null }).then((r: any) => (r.error ? null : (r.data as QueueHealth)), () => null),
    db.from('workflow_queue')
      .select('id, tenant_id, workflow_id, trigger_type, locked_by, locked_at, lease_expires_at, attempts, max_attempts, lease_lost_count')
      .eq('status', 'processing')
      .order('locked_at', { ascending: true })
      .limit(200)
      .then((r: any) => (r.error ? [] : (r.data ?? [])), () => []),
  ])
  let provider: ProcessingStatusView['provider'] = null
  if (resolved) {
    const status = await resolved.provider.status?.({ ctx: resolved.ctx }).catch(() => null)
    provider = {
      extension_id: resolved.extensionId,
      ...(status ?? { mode, label: mode === 'queue' ? 'Separate workers' : 'In the web app' }),
    }
  }
  const now = Date.now()
  const rows = (processing as any[]).map((row) => ({
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    workflow_id: String(row.workflow_id),
    workflow_name: null as string | null,
    trigger_type: row.trigger_type ?? null,
    locked_by: row.locked_by ?? null,
    locked_at: row.locked_at ?? null,
    lease_expires_at: row.lease_expires_at ?? null,
    attempts: Number(row.attempts) || 0,
    max_attempts: Number(row.max_attempts) || 3,
    lease_lost_count: Number(row.lease_lost_count) || 0,
    stuck: queueLeaseExpired(row.lease_expires_at, row.locked_at, now),
  }))
  rows.sort((a, b) => Number(b.stuck) - Number(a.stuck))
  const jobs = rows.slice(0, 50)
  const ids = [...new Set(jobs.map((j) => j.workflow_id))]
  if (ids.length) {
    const { data } = await db.from('workflows').select('id, name').in('id', ids)
    const names = new Map(((data ?? []) as any[]).map((w) => [w.id, w.name]))
    for (const job of jobs) job.workflow_name = names.get(job.workflow_id) ?? null
  }
  return { mode, provider, queue: health, jobs, docs_href: PROCESSING_DOCS_HREF }
}

export type RecoverStuckJobResult =
  | { ok: true; action: 'retry' | 'cancel'; lease_expired: boolean; forced: boolean }
  | { ok: false; status: number; error: string }

/**
 * Retry / cancel a processing job anywhere on the instance
 * (recover_queue_job, in the job's own workspace): allowed when its lease
 * expired; cancel also with force. Audited in the job's workspace.
 */
export async function recoverStuckJob(input: {
  jobId: string
  action: 'retry' | 'cancel'
  force?: boolean
  actorId: string | null
  via: 'ui' | 'api'
}): Promise<RecoverStuckJobResult> {
  const db = getServiceDb() as any
  if (!/^[0-9a-f-]{36}$/i.test(input.jobId)) return { ok: false, status: 404, error: 'Queue job not found' }
  const { data: job } = await db.from('workflow_queue').select('id, tenant_id, workflow_id').eq('id', input.jobId).maybeSingle()
  if (!job) return { ok: false, status: 404, error: 'Queue job not found' }
  const { data, error } = await db.rpc('recover_queue_job', {
    p_job_id: job.id,
    p_tenant_id: job.tenant_id,
    p_action: input.action,
    p_force: input.force === true,
  })
  if (error) {
    if (['PGRST202', '42883'].includes(String(error.code))) {
      return { ok: false, status: 409, error: 'Apply migration 20270124090000_queue_leases.sql to recover processing jobs.' }
    }
    return { ok: false, status: 500, error: error.message }
  }
  const out = (data ?? {}) as { ok?: boolean; reason?: string; status?: string; lease_expired?: boolean; locked_by?: string; run_id?: string }
  if (!out.ok) {
    if (out.reason === 'not_found') return { ok: false, status: 404, error: 'Queue job not found' }
    if (out.reason === 'not_processing') return { ok: false, status: 409, error: `The job is no longer being processed (status '${out.status}').` }
    return {
      ok: false,
      status: 409,
      error: input.action === 'retry'
        ? 'A worker is still processing this job (its lease has not expired); retrying it would run it twice.'
        : 'A worker is still processing this job (its lease has not expired). Force-cancel it to stop tracking it.',
    }
  }
  const forced = input.action === 'cancel' && !out.lease_expired
  await writeAudit({
    supabase: db,
    tenantId: job.tenant_id,
    actorId: input.actorId,
    objectType: 'workflow',
    objectId: job.workflow_id,
    action: input.action === 'retry' ? 'retry_queue_job' : forced ? 'force_cancel_queue_job' : 'cancel_queue_job',
    summary: `${input.action === 'retry' ? 'Retried' : forced ? 'Force-cancelled' : 'Cancelled'} processing queue job ${job.id} (instance admin)`,
    metadata: { job_id: job.id, lease_expired: out.lease_expired ?? null, worker: out.locked_by ?? null, run_id: out.run_id ?? null, forced, via: input.via, scope: 'instance' },
  })
  if (input.action === 'retry') kickQueueProcessor()
  return { ok: true, action: input.action, lease_expired: out.lease_expired === true, forced }
}

export type ConfigureProcessingResult =
  | { ok: true; status: ProcessingStatus }
  | { ok: false; status: number; error: string }

/** PATCH /admin/processing: hand the change to the processing provider (the add-on); 409 without one. */
export async function configureProcessing(changes: { mode?: 'web' | 'workers'; test_runs_on_workers?: boolean }): Promise<ConfigureProcessingResult> {
  const resolved = await resolveProcessingProvider().catch(() => null)
  if (!resolved?.provider.configure) {
    return { ok: false, status: 409, error: 'Separate processing workers need the processing add-on and its licence; without it the web app runs queued work.' }
  }
  try {
    const status = await resolved.provider.configure({ ctx: resolved.ctx, changes })
    invalidateProcessingHandoff()
    return { ok: true, status }
  } catch (error) {
    const e = error as { status?: number; message?: string }
    return { ok: false, status: typeof e.status === 'number' ? e.status : 500, error: e.message ?? 'Could not change the processing settings' }
  }
}
