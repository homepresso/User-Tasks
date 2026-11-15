/**
 * The gateway job queue (public.gateway_jobs): enqueue a request for a
 * gateway and wait for its answer (the connection transport), claim jobs
 * (the gateway's long poll), store answers.
 *
 * Serverless-friendly: no sockets are held between functions. A waiting
 * caller polls its job row (25 ms, backing off to 250 ms); the long poll
 * claims every 200 ms. An in-process wake-up bus short-cuts both when the
 * enqueuing function and the poll (or the answer and the waiter) run in the
 * same process — always on a self-hosted server, often on Vercel Fluid
 * compute (concurrent requests share an instance).
 *
 * Server-only.
 */
import { EventEmitter } from 'node:events'
import { gatewayNotifier, type GatewayNotifier } from './notify'
import { getServiceDb } from '@/lib/providers/db'
import {
  BODY_PART_BYTES,
  INLINE_BODY_MAX_BYTES,
  REPLAYABLE_METHODS,
  sha256Hex,
  splitParts,
  type GatewayJob,
  type GatewayJobResult,
  type JobBodyRef,
  type JobMethod,
} from './protocol'

/* eslint-disable @typescript-eslint/no-explicit-any -- service-role client, untyped tables */

/**
 * A claimed job's lease. Renewed only by messages the instance itself sends:
 * the start of each poll and a heartbeat every 5 s while it runs jobs. An
 * instance that dies loses its leases within this time.
 */
export const LEASE_MS = 15_000
/**
 * Claiming while no LISTEN / NOTIFY wake-ups are available: first after
 * 250 ms, then doubling up to 4 s (about 9 claims per 25 s long poll; a
 * notified poll claims once). In-process wake-ups short-cut every wait.
 */
export const CLAIM_BACKOFF_START_MS = 250
export const CLAIM_BACKOFF_MAX_MS = 4_000
/** A waiting caller re-reads its job at most this often when notifications arrive (a safety net only). */
const NOTIFIED_JOB_RECHECK_MS = 2_000
export const MISSING_TABLE_HINT = 'apply migration 20270114200000_onprem_gateways'

const db = () => getServiceDb() as any

/* ── in-process wake-ups ───────────────────────────────────────────── */

const BUS_SLOT = Symbol.for('usertasks.gateway.bus')
const bus: EventEmitter = ((globalThis as any)[BUS_SLOT] ??= (() => { const e = new EventEmitter(); e.setMaxListeners(0); return e })())

export function wakeGateway(gatewayId: string): void { bus.emit(`gw:${gatewayId}`) }
export function wakeJob(jobId: string): void { bus.emit(`job:${jobId}`) }

/** Resolve after `ms`, on the event, or when the listener reconnects (events may have been missed). */
function waitFor(event: string, ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); bus.off(event, done); bus.off('gateway:resync', done); signal?.removeEventListener('abort', done); resolve() }
    const timer = setTimeout(done, ms)
    bus.once(event, done)
    bus.once('gateway:resync', done)
    signal?.addEventListener('abort', done, { once: true })
  })
}

/** LISTEN / NOTIFY wake-ups across processes (lib/gateway/notify.ts), when available. */
async function notifier(): Promise<GatewayNotifier> {
  return gatewayNotifier(bus)
}

export class GatewayQueueError extends Error {
  constructor(message: string, readonly code: string, readonly status = 502) {
    super(message)
    this.name = 'GatewayQueueError'
  }
}

export function isMissingTableError(error: { code?: string; message?: string } | null | undefined): boolean {
  return Boolean(error && (error.code === '42P01' || error.code === 'PGRST205' || /relation .*gateway.* does not exist|Could not find the table/i.test(error.message ?? '')))
}

function fail(error: any, what: string): void {
  if (!error) return
  if (isMissingTableError(error)) throw new GatewayQueueError(`${what}: on-premises gateways are not set up in this database (${MISSING_TABLE_HINT})`, 'gateway_not_installed', 503)
  throw new GatewayQueueError(`${what}: ${error.message ?? String(error)}`, 'gateway_store_error', 500)
}

/* ── bodies ────────────────────────────────────────────────────────── */

async function storeBody(jobId: string, direction: 'request' | 'response', body: Buffer): Promise<JobBodyRef> {
  const sha256 = sha256Hex(body)
  if (body.length <= INLINE_BODY_MAX_BYTES) return { inline: body.toString('base64'), size: body.length, sha256 }
  const parts = splitParts(body)
  const rows = parts.map((data, seq) => ({ job_id: jobId, direction, seq, data: data.toString('base64') }))
  // Insert in small batches (each part is up to 2.7 MB of base64).
  for (let i = 0; i < rows.length; i += 4) {
    const { error } = await db().from('gateway_job_parts').upsert(rows.slice(i, i + 4), { onConflict: 'job_id,direction,seq' })
    fail(error, 'Store body part')
  }
  return { parts: parts.length, size: body.length, sha256 }
}

export async function readPart(jobId: string, direction: 'request' | 'response', seq: number): Promise<Buffer | null> {
  const { data, error } = await db().from('gateway_job_parts').select('data').eq('job_id', jobId).eq('direction', direction).eq('seq', seq).maybeSingle()
  fail(error, 'Read body part')
  return data ? Buffer.from(String(data.data), 'base64') : null
}

export async function writePart(jobId: string, seq: number, data: Buffer): Promise<void> {
  if (data.length > BODY_PART_BYTES) throw new GatewayQueueError('Body part too large', 'payload_too_large', 413)
  const { error } = await db().from('gateway_job_parts').upsert({ job_id: jobId, direction: 'response', seq, data: data.toString('base64') }, { onConflict: 'job_id,direction,seq' })
  fail(error, 'Store body part')
}

async function loadBody(jobId: string, ref: JobBodyRef | null, direction: 'request' | 'response', maxBytes: number): Promise<Buffer> {
  if (!ref) return Buffer.alloc(0)
  if (ref.size > maxBytes) throw new GatewayQueueError(`The response is larger than ${Math.round(maxBytes / 1048576)} MB`, 'payload_too_large', 413)
  let body: Buffer
  if (typeof ref.inline === 'string') body = Buffer.from(ref.inline, 'base64')
  else {
    const chunks: Buffer[] = []
    for (let seq = 0; seq < (ref.parts ?? 0); seq++) {
      const part = await readPart(jobId, direction, seq)
      if (!part) throw new GatewayQueueError('A body part is missing', 'gateway_incomplete_body')
      chunks.push(part)
    }
    body = Buffer.concat(chunks)
  }
  if (body.length !== ref.size || sha256Hex(body) !== ref.sha256) throw new GatewayQueueError('The body does not match its checksum', 'gateway_corrupt_body')
  return body
}

async function dropParts(jobId: string): Promise<void> {
  await db().from('gateway_job_parts').delete().eq('job_id', jobId)
}

/* ── enqueue + wait (cloud side of a connector request) ────────────── */

export interface EnqueueInput {
  tenantId: string
  gatewayId: string
  target: string
  method: JobMethod
  path: string
  headers: Record<string, string>
  body: Buffer | null
  anonymous: boolean
  timeoutMs: number
  integrationId?: string | null
  source?: string | null
  /** Re-run on another instance if the first vanishes mid-request (default: GET / HEAD / OPTIONS). */
  replayable?: boolean
}

export interface JobOutcome {
  status: number
  headers: Record<string, string>
  body: Buffer
  gatewayMs: number | null
  totalMs: number
  jobId: string
}

export async function enqueueJob(input: EnqueueInput): Promise<string> {
  const now = Date.now()
  const expiresAt = new Date(now + input.timeoutMs).toISOString()
  const replayable = input.replayable ?? REPLAYABLE_METHODS.has(input.method)
  const body = input.body && input.body.length ? input.body : null
  const large = Boolean(body && body.length > INLINE_BODY_MAX_BYTES)
  const inlineRef: JobBodyRef | null = body && !large ? { inline: body.toString('base64'), size: body.length, sha256: sha256Hex(body) } : null
  const { data, error } = await db().from('gateway_jobs').insert({
    tenant_id: input.tenantId,
    gateway_id: input.gatewayId,
    target: input.target,
    method: input.method,
    path: input.path.slice(0, 2048),
    request: { headers: input.headers, anonymous: input.anonymous, body: inlineRef },
    request_bytes: body?.length ?? 0,
    integration_id: input.integrationId ?? null,
    source: input.source ?? null,
    replayable,
    // A large body is stored in parts first; the job is claimable only once they are all there.
    status: large ? 'staging' : 'queued',
    expires_at: expiresAt,
  }).select('id').single()
  fail(error, 'Queue the request')
  const jobId = String(data.id)
  if (large && body) {
    const ref = await storeBody(jobId, 'request', body)
    const { error: updError } = await db().from('gateway_jobs').update({
      request: { headers: input.headers, anonymous: input.anonymous, body: ref },
      status: 'queued',
    }).eq('id', jobId).eq('status', 'staging')
    fail(updError, 'Queue the request')
  }
  wakeGateway(input.gatewayId)
  return jobId
}

/** Wait for a job's answer until `deadline` (epoch ms) or the signal aborts. */
export async function awaitJob(jobId: string, gatewayId: string, deadline: number, options: { signal?: AbortSignal; maxResponseBytes: number }): Promise<JobOutcome> {
  const started = Date.now()
  const wakeups = await notifier()
  let interval = 25
  for (;;) {
    if (options.signal?.aborted) {
      await cancelJob(jobId)
      throw new GatewayQueueError('The request was cancelled', 'cancelled', 499)
    }
    const { data, error } = await db().from('gateway_jobs')
      .select('id, status, response, response_status, error_code, error_message, gateway_ms, lease_until, replayable, attempts, expires_at')
      .eq('id', jobId).maybeSingle()
    fail(error, 'Read the request')
    if (!data) throw new GatewayQueueError('The request disappeared from the queue', 'gateway_job_missing')
    if (data.status === 'done') {
      const response = (data.response ?? {}) as { headers?: Record<string, string>; body?: JobBodyRef | null }
      const body = await loadBody(jobId, response.body ?? null, 'response', options.maxResponseBytes)
      await dropParts(jobId).catch(() => {})
      return { status: Number(data.response_status), headers: response.headers ?? {}, body, gatewayMs: data.gateway_ms ?? null, totalMs: Date.now() - started, jobId }
    }
    if (data.status === 'failed' || data.status === 'expired' || data.status === 'cancelled') {
      await dropParts(jobId).catch(() => {})
      throw new GatewayQueueError(String(data.error_message ?? 'The gateway could not run the request'), String(data.error_code ?? 'gateway_failed'), data.error_code === 'gateway_timeout' ? 504 : 502)
    }
    if (data.status === 'claimed' && data.lease_until && Date.parse(data.lease_until) < Date.now()) await releaseLostJob(data, gatewayId)
    if (Date.now() >= deadline) {
      await expireJob(jobId)
      throw new GatewayQueueError(data.status === 'queued'
        ? 'No gateway instance took the request in time (is the gateway running and connected?)'
        : 'The gateway did not answer in time', 'gateway_timeout', 504)
    }
    await waitFor(`job:${jobId}`, Math.min(interval, Math.max(1, deadline - Date.now())), options.signal)
    interval = Math.min(wakeups.listening() ? NOTIFIED_JOB_RECHECK_MS : 250, Math.round(interval * 1.5))
  }
}

/** A claimed job whose instance stopped renewing its lease: back to the queue (replayable, once) or failed. */
async function releaseLostJob(row: any, gatewayId: string): Promise<void> {
  const requeue = row.replayable && Number(row.attempts) < 2 && Date.parse(row.expires_at) > Date.now()
  await db().from('gateway_jobs').update(requeue
    ? { status: 'queued', claimed_by: null, lease_until: null }
    : { status: 'failed', claimed_by: null, lease_until: null, completed_at: new Date().toISOString(), error_code: 'gateway_instance_lost', error_message: 'The gateway instance running this request stopped answering' })
    .eq('id', row.id).eq('status', 'claimed').lt('lease_until', new Date().toISOString())
  if (requeue) wakeGateway(gatewayId)
}

async function cancelJob(jobId: string): Promise<void> {
  await db().from('gateway_jobs').update({ status: 'cancelled', completed_at: new Date().toISOString(), error_code: 'cancelled', error_message: 'Cancelled by the caller' })
    .eq('id', jobId).in('status', ['staging', 'queued', 'claimed'])
  await dropParts(jobId).catch(() => {})
}

async function expireJob(jobId: string): Promise<void> {
  await db().from('gateway_jobs').update({ status: 'expired', completed_at: new Date().toISOString(), error_code: 'gateway_timeout', error_message: 'No answer before the deadline' })
    .eq('id', jobId).in('status', ['staging', 'queued', 'claimed'])
  await dropParts(jobId).catch(() => {})
}

/* ── gateway side: claim, renew, release, complete ─────────────────── */

function toJob(row: any): GatewayJob {
  const request = (row.request ?? {}) as { headers?: Record<string, string>; anonymous?: boolean; body?: JobBodyRef | null }
  return {
    v: 1,
    id: String(row.id),
    gatewayId: String(row.gateway_id),
    target: String(row.target),
    method: String(row.method) as JobMethod,
    path: String(row.path),
    headers: request.headers ?? {},
    body: request.body ?? null,
    anonymous: request.anonymous === true,
    issuedAt: Date.parse(row.created_at),
    expiresAt: Date.parse(row.expires_at),
    attempt: Number(row.attempts ?? 1),
  }
}

export async function claimJobs(gatewayId: string, keyId: string, max: number): Promise<GatewayJob[]> {
  if (max <= 0) return []
  const { data, error } = await db().rpc('claim_gateway_jobs', { p_gateway_id: gatewayId, p_key_id: keyId, p_max: max, p_lease_ms: LEASE_MS })
  fail(error, 'Claim requests')
  return ((data ?? []) as any[]).map(toJob)
}

/**
 * Long poll: claim now; then wait for a wake-up (NOTIFY from any process, or
 * the in-process bus) and claim again — or, without notifications, claim
 * with an adaptive back-off — until something arrives or `waitMs` passes.
 * An idle gateway on a deployment with LISTEN therefore costs one claim per
 * poll.
 */
export async function pollJobs(gatewayId: string, keyId: string, max: number, waitMs: number, signal?: AbortSignal): Promise<GatewayJob[]> {
  const deadline = Date.now() + waitMs
  const wakeups = await notifier()
  let interval = CLAIM_BACKOFF_START_MS
  for (;;) {
    if (signal?.aborted) return []
    const jobs = await claimJobs(gatewayId, keyId, max)
    if (jobs.length) {
      // The instance hung up while we claimed (it is stopping, or the connection dropped): hand
      // the jobs straight back instead of leaving them to a lease expiry.
      if (signal?.aborted) { await releaseClaimed(keyId, jobs.map((j) => j.id)); return [] }
      return jobs
    }
    const left = deadline - Date.now()
    if (left <= 0) return []
    await waitFor(`gw:${gatewayId}`, wakeups.listening() ? left : Math.min(interval, left), signal)
    interval = Math.min(CLAIM_BACKOFF_MAX_MS, interval * 2)
    // Woken by the deadline itself: nothing arrived, no need for another claim.
    if (Date.now() >= deadline) return []
  }
}

/** Keep the leases of an instance's in-flight jobs (on every message the instance sends). */
export async function renewLeases(keyId: string): Promise<void> {
  const { error } = await db().from('gateway_jobs').update({ lease_until: new Date(Date.now() + LEASE_MS).toISOString() })
    .eq('claimed_by', keyId).eq('status', 'claimed')
  fail(error, 'Renew leases')
}

/**
 * Put jobs an instance claimed but never started back in the queue (attempt
 * not counted): `jobIds` = those jobs, or `{ except }` = every job it holds
 * but the ones it is running (graceful shutdown).
 */
export async function releaseClaimed(keyId: string, jobIds: string[] | { except: string[] }): Promise<number> {
  let query = db().from('gateway_jobs').select('id, attempts, gateway_id').eq('claimed_by', keyId).eq('status', 'claimed')
  if (Array.isArray(jobIds)) {
    if (!jobIds.length) return 0
    query = query.in('id', jobIds)
  }
  const { data } = await query
  const keep = new Set(Array.isArray(jobIds) ? [] : jobIds.except)
  let released = 0
  for (const row of (data ?? []) as any[]) {
    if (keep.has(row.id)) continue
    await db().from('gateway_jobs').update({ status: 'queued', claimed_by: null, claimed_at: null, lease_until: null, attempts: Math.max(0, Number(row.attempts) - 1) })
      .eq('id', row.id).eq('claimed_by', keyId).eq('status', 'claimed')
    wakeGateway(row.gateway_id)
    released++
  }
  return released
}

/** Store the answer of a job claimed by this instance. */
export async function completeJob(gatewayId: string, keyId: string, jobId: string, result: GatewayJobResult): Promise<'stored' | 'stale'> {
  const { data: row, error } = await db().from('gateway_jobs').select('id, status, claimed_by, gateway_id').eq('id', jobId).maybeSingle()
  fail(error, 'Load the request')
  if (!row || row.gateway_id !== gatewayId) throw new GatewayQueueError('Unknown request', 'not_found', 404)
  if (row.status !== 'claimed' || row.claimed_by !== keyId) {
    // Expired / cancelled / taken over meanwhile: the answer is not used.
    await dropParts(jobId).catch(() => {})
    return 'stale'
  }
  const ok = !result.error
  const update = ok
    ? {
      status: 'done', response_status: result.status, response: { headers: result.headers ?? {}, body: result.body ?? null },
      response_bytes: result.body?.size ?? 0, gateway_ms: Math.max(0, Math.round(result.durationMs || 0)), completed_at: new Date().toISOString(), lease_until: null,
    }
    : {
      status: 'failed', error_code: String(result.error!.code).slice(0, 60), error_message: String(result.error!.message).slice(0, 1000),
      gateway_ms: Math.max(0, Math.round(result.durationMs || 0)), completed_at: new Date().toISOString(), lease_until: null,
    }
  const { data: updated, error: updError } = await db().from('gateway_jobs').update(update).eq('id', jobId).eq('status', 'claimed').eq('claimed_by', keyId).select('id')
  fail(updError, 'Store the answer')
  wakeJob(jobId)
  return (updated ?? []).length ? 'stored' : 'stale'
}

/** Can this instance read / write this job's body parts? */
export async function jobVisibleTo(gatewayId: string, keyId: string, jobId: string): Promise<boolean> {
  const { data, error } = await db().from('gateway_jobs').select('gateway_id, claimed_by, status').eq('id', jobId).maybeSingle()
  fail(error, 'Load the request')
  return Boolean(data && data.gateway_id === gatewayId && data.claimed_by === keyId && data.status === 'claimed')
}

/** Housekeeping: job rows older than `days` (audit trail), stale nonces, old events. */
export async function purgeGatewayData(days = 30): Promise<void> {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()
  await db().from('gateway_jobs').delete().lt('created_at', cutoff)
  await db().from('gateway_nonces').delete().lt('expires_at', new Date().toISOString())
  await db().from('gateway_events').delete().lt('created_at', new Date(Date.now() - 90 * 86_400_000).toISOString())
}
