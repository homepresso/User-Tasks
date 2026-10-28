/**
 * Background jobs as their owners see them: the top-bar Jobs panel (server
 * actions), GET/POST /api/v1/jobs*, and the download routes. Rows are read
 * and written with the service-role client and filtered explicitly:
 *
 *  - signed-in users: their own jobs (every workspace, like notifications);
 *    workspace admins (settings.edit) can also list the workspace's jobs
 *  - API keys / OAuth tokens: jobs of their workspace started by the same
 *    user, or — for tenant keys, which have no user — by the same key
 *
 * Downloads, results and retries are for the job's owner only; cancel also
 * for workspace admins. The RLS policy (migration 20261114000000) mirrors the
 * read rule for direct (Supabase realtime) reads.
 */

import { hasPerm, ServiceError, type ServiceContext } from './context'
import { dbError, serviceRoleClient } from './_shared'
import type { UserJobRow } from '@/lib/user-jobs/define'
import { toJobView, isExpired } from '@/lib/user-jobs/view'
import type { UserJobStatus, UserJobView } from '@/lib/user-jobs/types'
import { USER_JOB_STATUSES } from '@/lib/user-jobs/types'
import { openJobObject, readJobObject } from '@/lib/user-jobs/store'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped service-role rows */

export const JOB_LIST_LIMIT = 50
const ADMIN_PERMISSION = 'settings.edit'

export interface JobListFilters {
  /** `tenant`: every job of the workspace (admins). Default `mine`. */
  scope?: 'mine' | 'tenant'
  status?: UserJobStatus[]
  /** Only jobs that are queued or running. */
  active?: boolean
  limit?: number
  /** Created after (ISO) — the panel's "since I last looked". */
  since?: string | null
}

function isApiCaller(ctx: ServiceContext) {
  return ctx.authKind === 'api_key' || ctx.authKind === 'oauth' || ctx.authKind === 'mcp'
}

/** Is the caller the job's owner? */
export function ownsJob(ctx: ServiceContext, row: Pick<UserJobRow, 'tenant_id' | 'user_id' | 'origin'>): boolean {
  if (isApiCaller(ctx)) {
    if (row.tenant_id !== ctx.tenantId) return false
    if (ctx.actorId) return row.user_id === ctx.actorId
    return !row.user_id && Boolean(ctx.credentialId) && row.origin?.key_id === ctx.credentialId
  }
  return Boolean(ctx.actorId) && row.user_id === ctx.actorId
}

function canAdminister(ctx: ServiceContext, row: Pick<UserJobRow, 'tenant_id'>): boolean {
  return row.tenant_id === ctx.tenantId && hasPerm(ctx, ADMIN_PERMISSION) && ctx.permissions !== null
}

async function admin(ctx: ServiceContext) {
  return (await serviceRoleClient(ctx)) as any
}

export async function listJobs(ctx: ServiceContext, filters: JobListFilters = {}): Promise<{ jobs: UserJobView[] }> {
  const db = await admin(ctx)
  const limit = Math.min(Math.max(Math.trunc(filters.limit ?? JOB_LIST_LIMIT) || JOB_LIST_LIMIT, 1), 200)
  let query = db.from('user_jobs').select('*').order('created_at', { ascending: false }).limit(limit)

  if (filters.scope === 'tenant') {
    if (!hasPerm(ctx, ADMIN_PERMISSION) || ctx.permissions === null) throw ServiceError.forbidden(`Forbidden: listing the workspace's jobs needs the '${ADMIN_PERMISSION}' permission`)
    query = query.eq('tenant_id', ctx.tenantId)
  } else if (isApiCaller(ctx)) {
    query = query.eq('tenant_id', ctx.tenantId)
    if (ctx.actorId) query = query.eq('user_id', ctx.actorId)
    else if (ctx.credentialId) query = query.is('user_id', null).eq('origin->>key_id', ctx.credentialId)
    else return { jobs: [] }
  } else {
    if (!ctx.actorId) throw ServiceError.forbidden('Forbidden: jobs belong to a signed-in user')
    query = query.eq('user_id', ctx.actorId)
  }

  const statuses = filters.active ? ['queued', 'running'] : (filters.status ?? []).filter((s) => (USER_JOB_STATUSES as readonly string[]).includes(s))
  if (statuses.length) query = query.in('status', statuses)
  if (filters.since) query = query.gte('updated_at', filters.since)

  const { data, error } = await query
  if (error) throw dbError(error)
  return { jobs: ((data ?? []) as UserJobRow[]).map((row) => toJobView(row)) }
}

async function loadJob(ctx: ServiceContext, jobId: string, access: 'owner' | 'owner_or_admin' = 'owner_or_admin'): Promise<UserJobRow> {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) throw ServiceError.notFound('Job not found')
  const db = await admin(ctx)
  const { data, error } = await db.from('user_jobs').select('*').eq('id', jobId).maybeSingle()
  if (error) throw dbError(error)
  const row = data as UserJobRow | null
  // Someone else's job is "not found", so ids don't leak.
  if (!row || !(ownsJob(ctx, row) || (access === 'owner_or_admin' && canAdminister(ctx, row)))) throw ServiceError.notFound('Job not found')
  return row
}

export async function getJob(ctx: ServiceContext, jobId: string): Promise<UserJobView> {
  return toJobView(await loadJob(ctx, jobId))
}

/** Queued jobs stop at once; running jobs stop at their next progress report. */
export async function cancelJob(ctx: ServiceContext, jobId: string): Promise<UserJobView> {
  const row = await loadJob(ctx, jobId)
  if (row.status !== 'queued' && row.status !== 'running') throw ServiceError.conflict(`The job is already ${row.status}`)
  const db = await admin(ctx)
  const now = new Date().toISOString()
  if (row.status === 'queued') {
    const { data } = await db.from('user_jobs').update({ status: 'cancelled', cancel_requested_at: now, finished_at: now, message: 'Cancelled', lease_owner: null, expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString() })
      .eq('id', row.id).eq('status', 'queued').select('*').maybeSingle()
    if (data) return toJobView(data as UserJobRow)
  }
  const { data, error } = await db.from('user_jobs').update({ cancel_requested_at: now, message: 'Cancelling…' })
    .eq('id', row.id).in('status', ['queued', 'running']).select('*').maybeSingle()
  if (error) throw dbError(error)
  if (!data) return toJobView((await loadJob(ctx, jobId)))
  return toJobView(data as UserJobRow)
}

/** Start a failed or cancelled job again (a new job with the same input), as the caller. */
export async function retryJob(ctx: ServiceContext, jobId: string): Promise<UserJobView> {
  const row = await loadJob(ctx, jobId, 'owner')
  if (row.status !== 'failed' && row.status !== 'cancelled') throw ServiceError.conflict('Only failed or cancelled jobs can be retried')
  const input = row.origin?.has_input ? await readJobObject(`storage://job-results/${row.tenant_id}/${row.id}/input`) : null
  if (row.origin?.has_input && !input) throw ServiceError.conflict('The job input has expired; start it again from the page')
  const { enqueueUserJob } = await import('@/lib/user-jobs/runner')
  const jobCtx = row.tenant_id === ctx.tenantId || isApiCaller(ctx) ? ctx : await switchTenant(ctx, row.tenant_id)
  return enqueueUserJob(jobCtx, row.kind, row.params, input ? { input } : {})
}

/** Act in the job's workspace (a session user retrying from another workspace). */
async function switchTenant(ctx: ServiceContext, tenantId: string): Promise<ServiceContext> {
  const { fromSession } = await import('./context')
  return fromSession({ tenantId })
}

export interface JobDownload {
  body: ReadableStream<Uint8Array>
  filename: string
  contentType: string
  size: number | null
}

function requireDownloadable(row: UserJobRow) {
  if (row.status !== 'succeeded') throw ServiceError.conflict(`The job is ${row.status}; there is nothing to download yet`)
  if (isExpired(row)) throw new ServiceError('not_found', 'This download has expired', { status: 410 })
}

/** The job's result file (owner only). */
export async function openJobDownload(ctx: ServiceContext, jobId: string): Promise<JobDownload> {
  const row = await loadJob(ctx, jobId, 'owner')
  requireDownloadable(row)
  const file = row.result?.file
  if (!file) throw ServiceError.notFound('This job has no file')
  const object = await openJobObject(file.ref)
  if (!object) throw new ServiceError('not_found', 'This download has expired', { status: 410 })
  return { body: object.body, filename: file.filename, contentType: file.content_type || 'application/octet-stream', size: object.size ?? file.size ?? null }
}

/** The job's JSON result (what the synchronous call returns), owner only. */
export async function getJobResult(ctx: ServiceContext, jobId: string): Promise<unknown> {
  const row = await loadJob(ctx, jobId, 'owner')
  requireDownloadable(row)
  const result = row.result ?? {}
  if (result.data_ref) {
    const bytes = await readJobObject(result.data_ref)
    if (!bytes) throw new ServiceError('not_found', 'This result has expired', { status: 410 })
    return JSON.parse(new TextDecoder().decode(bytes))
  }
  if (result.data !== undefined) return result.data
  if (result.file) throw ServiceError.validation('This job produced a file: GET /jobs/{id}/download')
  return { summary: result.summary ?? null, counts: result.counts ?? {} }
}

/** Mark the bell notifications of a job read (the completion popup was seen). */
export async function markJobNotificationsRead(ctx: ServiceContext, jobId: string): Promise<{ updated: number }> {
  if (!ctx.actorId) return { updated: 0 }
  const db = await admin(ctx)
  const { data, error } = await db.from('notifications').update({ is_read: true })
    .eq('user_id', ctx.actorId).eq('job_id', jobId).eq('is_read', false).select('id')
  if (error) throw dbError(error)
  return { updated: (data ?? []).length }
}
