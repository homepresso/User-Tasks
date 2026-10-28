import { after } from 'next/server'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient, getProcessorSecret } from '@/lib/cron-auth'
import { appUrlOrLocalhost } from '@/lib/config/bootstrap'
import { isServiceError, ServiceError, type ServiceContext } from '@/lib/services/context'
import { getJobKind } from './kinds'
import { isContinue, type JobKind, type JobOrigin, type JobOutput, type JobRun, type StoredJobResult, type UserJobRow } from './define'
import { deleteJobObjects, jobFileKey, putJobObject, readJobObject, safeFileName } from './store'
import { toJobView } from './view'
import type { UserJobView } from './types'

/**
 * Background job runner (public.user_jobs, migration 20261114000000).
 *
 *   enqueueUserJob()  validates the params, checks permissions as the caller,
 *                     stores the job (and its large input) and starts it right
 *                     after the response with next/server after(); outside a
 *                     request it starts unawaited.
 *   runUserJob()      claims one job (lease), rebuilds the caller's context
 *                     with LIVE permissions (user_jobs_actor; API keys must
 *                     still be valid, and keep their permission ceiling),
 *                     re-runs the kind's permission check and runs it.
 *   processUserJobs() the scheduler tick (lib/jobs/registry.ts `user-jobs`)
 *                     and /api/cron/user-jobs: queued jobs whose start was
 *                     lost, jobs whose invocation died (expired lease), retries
 *                     that are due, and the next chunk of long jobs.
 *
 * A job holds a lease that its heartbeat and progress() calls extend; every
 * write the runner makes is guarded by the lease holder, so a runner that
 * lost its lease cannot overwrite the job. Jobs that need longer than one
 * invocation return { continue: state } before timeLeft() runs out; the
 * runner saves the checkpoint, requeues the job and kicks a fresh
 * invocation (the tick picks it up otherwise). Unexpected errors are retried
 * with backoff up to the kind's maxAttempts; permission and validation
 * errors (ServiceError) fail at once. Cancelling a running job is
 * cooperative: progress() throws once a cancel was requested.
 *
 * Finished jobs keep their result until expires_at (USER_JOB_RESULT_TTL_HOURS,
 * default 7 days); purgeExpiredUserJobs() deletes the rows and their files.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped service-role rows */

export const JOB_LEASE_SECONDS = 120
const HEARTBEAT_MS = 30_000
const PROGRESS_WRITE_MS = 1_000
/** Inline JSON results above this are stored as a file. */
export const MAX_INLINE_RESULT_BYTES = 256 * 1024
export const MAX_RESULT_FILE_BYTES = 200 * 1024 * 1024

function envInt(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value >= min ? Math.min(Math.floor(value), max) : fallback
}

/** Time one invocation spends on a job before it hands back (env USER_JOB_BUDGET_MS, default 50 s). */
export function jobBudgetMs(): number {
  return envInt('USER_JOB_BUDGET_MS', 50_000, 2_000, 800_000)
}

/** How long finished jobs and their files are kept (env USER_JOB_RESULT_TTL_HOURS, default 168 = 7 days). */
export function resultTtlHours(): number {
  return envInt('USER_JOB_RESULT_TTL_HOURS', 168, 1, 24 * 90)
}

const hoursFromNow = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString()

/** Backoff before retry n (1-based): 15 s, 1 min, 4 min, … capped at 30 min. */
export function retryDelayMs(attempt: number): number {
  return Math.min(15_000 * 4 ** Math.max(0, attempt - 1), 30 * 60_000)
}

export class JobCancelledError extends Error {
  constructor() { super('Cancelled'); this.name = 'JobCancelledError' }
}
export class JobLeaseLostError extends Error {
  constructor() { super('The job lease was taken over by another runner'); this.name = 'JobLeaseLostError' }
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 2000)

export interface RunnerDeps {
  supabase?: SupabaseClient
  /** Kind lookup (tests). */
  kinds?: (name: string) => JobKind<any> | undefined
  /** Start the job after enqueueing (default true). */
  start?: boolean
  /** Ask for a fresh invocation after a chunk (default kickUserJobRunner). */
  kick?: () => void
  now?: () => number
}

const db = (deps: RunnerDeps = {}): SupabaseClient => deps.supabase ?? createServiceClient()
const kindOf = (name: string, deps: RunnerDeps = {}) => (deps.kinds ?? getJobKind)(name)

function originOf(ctx: ServiceContext, hasInput: boolean): JobOrigin {
  if (ctx.authKind === 'job') throw new ServiceError('validation_error', 'A background job cannot start another job')
  const credential = ctx.authKind === 'api_key' || ctx.authKind === 'oauth' || ctx.authKind === 'mcp'
  return {
    source: ctx.source === 'job' ? 'api' : ctx.source,
    auth_kind: ctx.authKind,
    ...(credential ? {
      key_id: ctx.credentialId ?? null,
      key_type: ctx.keyType,
      permissions: ctx.permissions ? [...ctx.permissions].sort() : undefined,
      resource_scopes: ctx.resourceScopes,
      oauth_scopes: ctx.oauthScopes ? [...ctx.oauthScopes] : undefined,
      credential_owner_id: ctx.credentialOwnerId ?? null,
    } : {}),
    ...(hasInput ? { has_input: true } : {}),
  }
}

function parseParams<P>(kind: JobKind<P>, raw: unknown): P {
  const parsed = kind.params.safeParse(raw ?? {})
  if (!parsed.success) {
    throw ServiceError.validation(`Invalid job input: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'params'}: ${i.message}`).join(', ')}`, z.treeifyError(parsed.error))
  }
  return parsed.data
}

export interface EnqueueOptions extends RunnerDeps {
  /** Large input (an uploaded file) stored next to the job. */
  input?: Uint8Array
  /** Same key (per user + kind) returns the existing job instead of a new one. */
  idempotencyKey?: string | null
}

/** Enqueue a job for the caller and start it. Throws ServiceError when refused. */
export async function enqueueUserJob(ctx: ServiceContext, kindName: string, rawParams: unknown, options: EnqueueOptions = {}): Promise<UserJobView> {
  const kind = kindOf(kindName, options)
  if (!kind) throw ServiceError.validation(`Unknown job kind "${kindName}"`)
  const params = parseParams(kind, rawParams)
  await kind.authorize(ctx, params)

  if (options.input && !kind.input) throw ServiceError.validation(`${kind.kind} jobs take no file input`)
  if (options.input && options.input.byteLength > (kind.input?.maxBytes ?? 0)) {
    throw ServiceError.validation(`The file is too large (limit ${Math.round((kind.input?.maxBytes ?? 0) / 1048576)} MB)`)
  }

  const supabase = db(options)
  const key = options.idempotencyKey?.trim() || null
  if (key) {
    const { data: existing } = await (supabase as any).from('user_jobs').select('*')
      .eq('tenant_id', ctx.tenantId).eq('kind', kind.kind).eq('idempotency_key', key)
      .filter('user_id', ctx.actorId ? 'eq' : 'is', ctx.actorId ?? null)
      .maybeSingle()
    if (existing) return toJobView(existing as UserJobRow)
  }

  const id = crypto.randomUUID()
  if (options.input) await putJobObject(`${ctx.tenantId}/${id}/input`, options.input, 'application/octet-stream')

  const { data, error } = await (supabase as any).from('user_jobs').insert({
    id,
    tenant_id: ctx.tenantId,
    user_id: ctx.actorId,
    kind: kind.kind,
    title: kind.title(params).slice(0, 200) || kind.kind,
    params,
    origin: originOf(ctx, Boolean(options.input)),
    max_attempts: Math.min(Math.max(kind.maxAttempts ?? 1, 1), 10),
    idempotency_key: key,
    // A job that never starts is still cleaned up eventually.
    expires_at: hoursFromNow(24 * 30),
  }).select('*').single()
  if (error) {
    if (options.input) await deleteJobObjects(ctx.tenantId, id).catch(() => undefined)
    throw new Error(`Could not queue the job: ${error.message}`)
  }

  if (options.start !== false) startUserJob(id, options)
  return toJobView(data as UserJobRow)
}

/**
 * Run a job right after the current response (after()), or unawaited when
 * there is no request scope (scripts, the worker).
 */
export function startUserJob(jobId: string, deps: RunnerDeps = {}): void {
  const run = () => runUserJob(jobId, deps).catch((error) => console.error('[user-jobs] run failed:', errorMessage(error)))
  try {
    after(run)
  } catch {
    void run()
  }
}

/** Ask a fresh invocation to drain due jobs (the next chunk of a long job). Best effort. */
export function kickUserJobRunner(): void {
  const secret = getProcessorSecret()
  const send = fetch(`${appUrlOrLocalhost()}/api/cron/user-jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(secret ? { 'X-Processor-Secret': secret } : {}) },
    body: '{}',
    signal: AbortSignal.timeout(10_000),
  }).then((response) => response.body?.cancel()).catch(() => undefined)
  try {
    after(() => send)
  } catch {
    // Outside a request: the fetch runs on its own; the tick catches up otherwise.
  }
}

async function claim(supabase: SupabaseClient, holder: string, options: { jobId?: string; limit?: number }): Promise<UserJobRow[]> {
  const { data, error } = await (supabase as any).rpc('user_jobs_claim', {
    p_holder: holder,
    p_lease_seconds: JOB_LEASE_SECONDS,
    p_limit: options.limit ?? 1,
    p_job_id: options.jobId ?? null,
  })
  if (error) throw new Error(`user_jobs_claim failed: ${error.message}`)
  return (Array.isArray(data) ? data : data ? [data] : []) as UserJobRow[]
}

const newHolder = () => `jobs-${crypto.randomUUID().slice(0, 12)}`

/** Claim and run one job by id (no-op when it is not due, or another runner holds it). */
export async function runUserJob(jobId: string, deps: RunnerDeps & { budgetMs?: number } = {}): Promise<UserJobRow | null> {
  const supabase = db(deps)
  const holder = newHolder()
  const [job] = await claim(supabase, holder, { jobId })
  if (!job) return null
  return executeJob(supabase, job, holder, deps)
}

export interface ProcessSummary { claimed: number; succeeded: number; failed: number; requeued: number; cancelled: number }

/** Drain due jobs until the budget is spent (scheduler tick, /api/cron/user-jobs). */
export async function processUserJobs(options: RunnerDeps & { budgetMs?: number; concurrency?: number } = {}): Promise<ProcessSummary> {
  const supabase = db(options)
  const now = options.now ?? Date.now
  const deadline = now() + (options.budgetMs ?? jobBudgetMs())
  const summary: ProcessSummary = { claimed: 0, succeeded: 0, failed: 0, requeued: 0, cancelled: 0 }
  const workers = Array.from({ length: Math.max(1, Math.min(options.concurrency ?? 2, 8)) }, async () => {
    while (deadline - now() > 2_000) {
      const holder = newHolder()
      const [job] = await claim(supabase, holder, { limit: 1 })
      if (!job) return
      summary.claimed++
      const done = await executeJob(supabase, job, holder, { ...options, budgetMs: deadline - now() })
      if (!done) continue
      if (done.status === 'succeeded') summary.succeeded++
      else if (done.status === 'failed') summary.failed++
      else if (done.status === 'cancelled') summary.cancelled++
      else summary.requeued++
    }
  })
  await Promise.all(workers)
  return summary
}

/**
 * Cheap check for the tick: is any job due (queued and due, or running with
 * an expired lease)? A failing check counts as "yes".
 */
export async function hasDueUserJobs(supabase: SupabaseClient): Promise<boolean> {
  try {
    const now = new Date().toISOString()
    const { data, error } = await (supabase as any).from('user_jobs').select('id')
      .or(`and(status.eq.queued,run_after.lte.${now}),and(status.eq.running,lease_expires_at.lt.${now})`)
      .limit(1)
    if (error) return !/user_jobs/.test(error.message ?? '') // table missing (migration not applied): skip
    return (data ?? []).length > 0
  } catch {
    return true
  }
}

// ── Context ─────────────────────────────────────────────────────────────────

/**
 * The context a job runs with: the starting user's LIVE permissions in the
 * job's tenant (membership required); for API credentials, the key must
 * still be valid and the permissions are its ceiling (intersected with the
 * user's live permissions for user-bound keys). Service-role client with
 * explicit tenant filters — the same semantics API callers get.
 */
export async function jobServiceContext(supabase: SupabaseClient, job: UserJobRow): Promise<ServiceContext> {
  const origin = (job.origin ?? {}) as JobOrigin
  let live: Set<string> | null = null
  if (job.user_id) {
    const { data, error } = await (supabase as any).rpc('user_jobs_actor', { p_user: job.user_id, p_tenant: job.tenant_id })
    if (error) throw new Error(`user_jobs_actor failed: ${error.message}`)
    const actor = (data ?? {}) as { member?: boolean; permissions?: string[] }
    if (!actor.member) throw ServiceError.forbidden('Forbidden: you are no longer a member of this workspace')
    live = new Set((actor.permissions ?? []).map(String))
  }

  let permissions: Set<string>
  if (origin.auth_kind === 'api_key' || origin.auth_kind === 'oauth' || origin.auth_kind === 'mcp') {
    if (origin.key_id) await assertCredentialValid(supabase, job.tenant_id, origin)
    else if (origin.auth_kind !== 'mcp') throw ServiceError.forbidden('Forbidden: the credential that started this job is unknown')
    const ceiling = new Set(origin.permissions ?? [])
    permissions = live ? new Set([...ceiling].filter((p) => live!.has(p))) : ceiling
  } else {
    if (!live) throw ServiceError.forbidden('Forbidden: this job has no user to act as')
    permissions = live
  }

  return {
    db: supabase,
    supabase,
    tenantId: job.tenant_id,
    actorId: job.user_id,
    permissions,
    resourceScopes: origin.resource_scopes,
    authKind: 'job',
    source: 'job',
    keyType: origin.key_type,
    oauthScopes: origin.oauth_scopes,
    credentialOwnerId: origin.credential_owner_id ?? null,
    jobId: job.id,
  }
}

async function assertCredentialValid(supabase: SupabaseClient, tenantId: string, origin: JobOrigin): Promise<void> {
  if (origin.auth_kind === 'oauth') {
    const { data } = await (supabase as any).from('oauth_tokens').select('id, revoked_at').eq('id', origin.key_id).eq('tenant_id', tenantId).maybeSingle()
    if (!data || data.revoked_at) throw ServiceError.forbidden('Forbidden: the access token that started this job was revoked')
    return
  }
  const { data } = await (supabase as any).from('api_keys').select('id, is_revoked, expires_at').eq('id', origin.key_id).eq('tenant_id', tenantId).maybeSingle()
  if (!data || data.is_revoked) throw ServiceError.forbidden('Forbidden: the API key that started this job was revoked')
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) throw ServiceError.forbidden('Forbidden: the API key that started this job has expired')
}

// ── Execution ───────────────────────────────────────────────────────────────

async function guardedUpdate(supabase: SupabaseClient, job: UserJobRow, holder: string, patch: Record<string, unknown>): Promise<UserJobRow | null> {
  const { data, error } = await (supabase as any).from('user_jobs').update(patch)
    .eq('id', job.id).eq('lease_owner', holder).select('*').maybeSingle()
  if (error) throw new Error(`Could not update job ${job.id}: ${error.message}`)
  return (data as UserJobRow | null) ?? null
}

const encoder = new TextEncoder()
const toBytes = (body: Uint8Array | string) => (typeof body === 'string' ? encoder.encode(body) : body)

async function storeResult(job: UserJobRow, output: JobOutput): Promise<StoredJobResult> {
  const result: StoredJobResult = {}
  if (output.summary) result.summary = output.summary.slice(0, 500)
  if (output.counts) result.counts = output.counts
  if (output.file) {
    const bytes = toBytes(output.file.body)
    if (bytes.byteLength > MAX_RESULT_FILE_BYTES) throw ServiceError.validation(`The result is too large (limit ${MAX_RESULT_FILE_BYTES / 1048576} MB)`)
    const filename = safeFileName(output.file.name)
    const ref = await putJobObject(jobFileKey(job.tenant_id, job.id, filename), bytes, output.file.contentType)
    result.file = { ref, filename, content_type: output.file.contentType, size: bytes.byteLength }
  }
  if (output.data !== undefined) {
    const json = JSON.stringify(output.data) ?? 'null'
    if (json.length <= MAX_INLINE_RESULT_BYTES) result.data = output.data
    else result.data_ref = await putJobObject(`${job.tenant_id}/${job.id}/result.json`, encoder.encode(json), 'application/json')
  }
  return result
}

async function notify(supabase: SupabaseClient, job: UserJobRow, outcome: 'succeeded' | 'failed', body: string | null): Promise<void> {
  if (!job.user_id) return
  try {
    await (supabase as any).from('notifications').insert({
      user_id: job.user_id,
      tenant_id: job.tenant_id,
      type: outcome === 'succeeded' ? 'job_succeeded' : 'job_failed',
      title: outcome === 'failed' ? `${job.title} failed` : job.result?.file ? `${job.title} is ready` : `${job.title}: done`,
      body: body?.slice(0, 500) ?? null,
      job_id: job.id,
    })
  } catch {
    // The jobs panel still shows the outcome.
  }
}

/** Run a claimed job until it finishes, fails, is cancelled or hands back a chunk. Never throws. */
async function executeJob(supabase: SupabaseClient, claimed: UserJobRow, holder: string, deps: RunnerDeps & { budgetMs?: number }): Promise<UserJobRow | null> {
  const now = deps.now ?? Date.now
  const started = now()
  const budget = Math.max(1_000, Math.min(deps.budgetMs ?? jobBudgetMs(), jobBudgetMs()))
  let job = claimed
  let lastProgressWrite = 0
  let leaseLost = false

  const extendLease = () => new Date(now() + JOB_LEASE_SECONDS * 1000).toISOString()
  const heartbeat = setInterval(() => {
    void guardedUpdate(supabase, job, holder, { heartbeat_at: new Date().toISOString(), lease_expires_at: extendLease() })
      .then((row) => { if (!row) leaseLost = true })
      .catch(() => undefined)
  }, HEARTBEAT_MS)
  heartbeat.unref?.()

  const finish = async (patch: Record<string, unknown>) => {
    const row = await guardedUpdate(supabase, job, holder, { lease_owner: null, lease_expires_at: null, ...patch })
    return row
  }

  try {
    if (job.cancel_requested_at) throw new JobCancelledError()
    const kind = kindOf(job.kind, deps)
    if (!kind) throw ServiceError.validation(`Unknown job kind "${job.kind}"`)
    const ctx = await jobServiceContext(supabase, job)
    const params = parseParams(kind, job.params)
    // Re-check as the user / credential, with what they may do NOW.
    await kind.authorize(ctx, params)

    const run: JobRun<unknown> = {
      job,
      ctx,
      params,
      checkpoint: job.checkpoint ?? null,
      async progress(percent, message) {
        if (leaseLost) throw new JobLeaseLostError()
        const t = now()
        const pct = Math.max(0, Math.min(99, Math.round(percent)))
        if (t - lastProgressWrite < PROGRESS_WRITE_MS && pct < 99) return
        lastProgressWrite = t
        const row = await guardedUpdate(supabase, job, holder, {
          progress: pct, message: message?.slice(0, 500) ?? job.message, heartbeat_at: new Date(t).toISOString(), lease_expires_at: extendLease(),
        })
        if (!row) { leaseLost = true; throw new JobLeaseLostError() }
        job = row
        if (row.cancel_requested_at) throw new JobCancelledError()
      },
      async saveCheckpoint(state) {
        const row = await guardedUpdate(supabase, job, holder, { checkpoint: state ?? null, heartbeat_at: new Date().toISOString(), lease_expires_at: extendLease() })
        if (!row) { leaseLost = true; throw new JobLeaseLostError() }
        job = row
        if (row.cancel_requested_at) throw new JobCancelledError()
      },
      timeLeft: () => budget - (now() - started),
      async readInput() {
        if (!(job.origin as JobOrigin)?.has_input) return null
        return readJobObject(`storage://job-results/${job.tenant_id}/${job.id}/input`)
      },
      async putPart(index, body) {
        await putJobObject(`${job.tenant_id}/${job.id}/parts/${String(index).padStart(5, '0')}`, toBytes(body), 'application/octet-stream')
      },
      async readParts(count) {
        const parts: Uint8Array[] = []
        for (let i = 0; i < count; i++) {
          const part = await readJobObject(`storage://job-results/${job.tenant_id}/${job.id}/parts/${String(i).padStart(5, '0')}`)
          if (!part) throw new Error(`Chunk ${i} of the result is missing`)
          parts.push(part)
        }
        return parts
      },
    }

    const step = await kind.run(run)
    if (leaseLost) throw new JobLeaseLostError()

    if (isContinue(step)) {
      const row = await finish({
        status: 'queued',
        checkpoint: step.continue ?? null,
        run_after: new Date(now()).toISOString(),
        // A chunk boundary is not a failed attempt.
        attempts: Math.max(0, job.attempts - 1),
        ...(step.progress !== undefined ? { progress: Math.max(0, Math.min(99, Math.round(step.progress))) } : {}),
        ...(step.message ? { message: step.message.slice(0, 500) } : {}),
      })
      if (row) (deps.kick ?? kickUserJobRunner)()
      return row
    }

    const result = await storeResult(job, step)
    const row = await finish({
      status: 'succeeded', progress: 100, message: result.summary ?? job.message, result, error: null, checkpoint: null,
      finished_at: new Date(now()).toISOString(), expires_at: hoursFromNow(resultTtlHours()),
    })
    if (row) await notify(supabase, row, 'succeeded', result.summary ?? null)
    return row
  } catch (error) {
    if (error instanceof JobLeaseLostError || leaseLost) return null
    if (error instanceof JobCancelledError) {
      return finish({ status: 'cancelled', message: 'Cancelled', finished_at: new Date(now()).toISOString(), expires_at: hoursFromNow(resultTtlHours()) })
        .catch(() => null)
    }
    const message = isServiceError(error) ? error.message : errorMessage(error)
    const retry = !isServiceError(error) && job.attempts < job.max_attempts
    if (!isServiceError(error)) console.error(`[user-jobs] ${job.kind} ${job.id} attempt ${job.attempts} failed:`, message)
    try {
      if (retry) {
        return await finish({ status: 'queued', error: message, run_after: new Date(now() + retryDelayMs(job.attempts)).toISOString() })
      }
      const row = await finish({ status: 'failed', error: message, finished_at: new Date(now()).toISOString(), expires_at: hoursFromNow(resultTtlHours()) })
      if (row) await notify(supabase, row, 'failed', message)
      return row
    } catch {
      return null
    }
  } finally {
    clearInterval(heartbeat)
  }
}

// ── Cleanup ─────────────────────────────────────────────────────────────────

/** Delete expired jobs and their stored files (scheduler tick, daily cleanup). */
export async function purgeExpiredUserJobs(options: { supabase?: SupabaseClient; limit?: number; deadline?: number } = {}): Promise<{ jobs: number; files: number }> {
  const supabase = options.supabase ?? createServiceClient()
  const limit = Math.max(1, Math.min(options.limit ?? 500, 5_000))
  const totals = { jobs: 0, files: 0 }
  while (totals.jobs < limit && (!options.deadline || Date.now() < options.deadline)) {
    const { data, error } = await (supabase as any).from('user_jobs').select('id, tenant_id, origin, result, status')
      .lt('expires_at', new Date().toISOString()).order('expires_at', { ascending: true }).limit(Math.min(100, limit - totals.jobs))
    if (error) throw new Error(`Could not list expired jobs: ${error.message}`)
    const rows = (data ?? []) as Array<Pick<UserJobRow, 'id' | 'tenant_id' | 'origin' | 'result' | 'status'>>
    if (rows.length === 0) break
    const deletable: string[] = []
    for (const row of rows) {
      const hasFiles = Boolean(row.result?.file || row.result?.data_ref || row.origin?.has_input || row.status !== 'succeeded')
      try {
        if (hasFiles) totals.files += await deleteJobObjects(row.tenant_id, row.id)
        deletable.push(row.id)
      } catch (error) {
        // Keep the row so the next pass retries its files.
        console.warn(`[user-jobs] could not delete files of job ${row.id}:`, errorMessage(error))
      }
    }
    if (deletable.length === 0) break
    const { error: deleteError } = await (supabase as any).from('user_jobs').delete().in('id', deletable)
    if (deleteError) throw new Error(`Could not delete expired jobs: ${deleteError.message}`)
    totals.jobs += deletable.length
    if (rows.length < 100) break
  }
  return totals
}
