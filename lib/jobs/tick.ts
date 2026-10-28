import type { SupabaseClient } from '@supabase/supabase-js'
import { JOBS, dueJobs, floorToMinute, type JobContext, type JobDefinition, type Probe } from '@/lib/jobs/registry'

/**
 * The scheduler tick: runs every job from lib/jobs/registry.ts that is due in
 * the current minute, in-process, so pg_cron needs one job and one pg_net
 * request per minute instead of one per job.
 *
 * - Overlap guard: public.cron_tick_acquire() takes a lease row
 *   (app_cron.tick_lock) for TICK_LOCK_TTL_S. A tick that finds it held returns
 *   `{ skipped: 'locked' }` and runs nothing. The lease expires on its own if
 *   a tick dies, so a crashed tick never blocks the next minute's.
 * - Feature probe: public.cron_tick_probe() answers every job's isEnabled
 *   in one query (queue non-empty, feature configured).
 * - Budget: jobs start in registry order, `concurrency` at a time; each gets
 *   min(its budgetMs, what is left of the tick's budget). A job still running
 *   past its deadline (+ grace) is reported as `timeout` and left to finish
 *   in the background — every job is claim- or lease-based, so the next tick
 *   cannot double-run its work.
 * - History: app_cron.tick_runs keeps each job's last start/finish/status
 *   (written by public.cron_tick_record); daily jobs use it to catch up a
 *   missed slot.
 *
 * Without the consolidation migration (RPCs missing) the tick still works:
 * no lock, every due job enabled, exact-minute daily jobs.
 */

export const TICK_BUDGET_MS = 50_000
export const TICK_LOCK_TTL_S = 55
export const TICK_CONCURRENCY = 4
/** How long past its deadline a job may run before the tick stops waiting for it. */
export const JOB_GRACE_MS = 3_000
/** isEnabled checks are meant to be instant; a slow one counts as enabled. */
const ENABLED_CHECK_TIMEOUT_MS = 5_000

export type JobStatus = 'ok' | 'error' | 'timeout' | 'disabled' | 'not_started'

export type JobOutcome = {
  name: string
  status: JobStatus
  duration_ms: number
  result?: unknown
  error?: string
}

export type TickSummary = {
  ok: boolean
  minute: string
  skipped?: 'locked'
  lock: 'acquired' | 'held' | 'unavailable'
  due: string[]
  jobs: JobOutcome[]
  duration_ms: number
}

export type TickOptions = {
  supabase: SupabaseClient
  /** The minute to run (defaults to now); floored to the minute, UTC. */
  minute?: Date
  jobs?: JobDefinition[]
  budgetMs?: number
  concurrency?: number
  holder?: string
  now?: () => number
  /** Lease length (default TICK_LOCK_TTL_S). */
  lockTtlSeconds?: number
  /**
   * Keep the lease when done instead of releasing it, so it expires on its
   * own after lockTtlSeconds. The in-process worker uses this when several
   * replicas tick the same minute and only the lease elects one of them
   * (lib/scheduler/worker.ts): a release would let a later replica rerun it.
   */
  keepLock?: boolean
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value >= min ? Math.min(Math.floor(value), max) : fallback
}

/** Max jobs run at once by one tick (env CRON_TICK_CONCURRENCY, default 4). */
export function tickConcurrency(): number {
  return envInt('CRON_TICK_CONCURRENCY', TICK_CONCURRENCY, 1, 16)
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

const isMissingRpc = (error: { code?: string } | null | undefined) =>
  !!error && (error.code === 'PGRST202' || error.code === '42883')

type LockResult = { lock: 'acquired' | 'held' | 'unavailable'; lastStarted?: Map<string, Date | null> }

/**
 * Takes the tick lease. When acquired, also returns each job's last start
 * (app_cron.tick_runs) for the daily catch-up; undefined history means "unknown".
 */
async function acquireLock(supabase: SupabaseClient, holder: string, ttlSeconds: number): Promise<LockResult> {
  try {
    const { data, error } = await supabase.rpc('cron_tick_acquire', { p_holder: holder, p_ttl_seconds: ttlSeconds })
    if (error) {
      if (!isMissingRpc(error)) console.warn('[cron-tick] lock unavailable:', error.message)
      return { lock: 'unavailable' }
    }
    const result = (data ?? {}) as { acquired?: boolean; last_started?: Record<string, string | null> | null }
    if (result.acquired !== true) return { lock: 'held' }
    const lastStarted = new Map<string, Date | null>()
    for (const [name, at] of Object.entries(result.last_started ?? {})) lastStarted.set(name, at ? new Date(at) : null)
    return { lock: 'acquired', lastStarted }
  } catch (error) {
    console.warn('[cron-tick] lock unavailable:', message(error))
    return { lock: 'unavailable' }
  }
}

async function releaseLock(supabase: SupabaseClient, holder: string): Promise<void> {
  try {
    await supabase.rpc('cron_tick_release', { p_holder: holder })
  } catch {
    // The lease expires on its own.
  }
}

/** Upserts job history rows into app_cron.tick_runs (best effort). */
async function recordRuns(supabase: SupabaseClient, rows: Array<Record<string, unknown>>): Promise<void> {
  if (!rows.length) return
  try {
    await supabase.rpc('cron_tick_record', { p_runs: rows })
  } catch {
    // History is best effort.
  }
}

function memoProbe(supabase: SupabaseClient): () => Promise<Probe> {
  let pending: Promise<Probe> | null = null
  return () => {
    pending ??= (async () => {
      try {
        const { data, error } = await supabase.rpc('cron_tick_probe')
        if (error || !data || typeof data !== 'object') {
          if (error && !isMissingRpc(error)) console.warn('[cron-tick] probe failed:', error.message)
          return {}
        }
        return data as Probe
      } catch (error) {
        console.warn('[cron-tick] probe failed:', message(error))
        return {}
      }
    })()
    return pending
  }
}

const TIMED_OUT = Symbol('timed-out')

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), Math.max(0, ms))
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/** Runs one tick. Never throws: job failures are reported per job. */
export async function runTick(options: TickOptions): Promise<TickSummary> {
  const now = options.now ?? Date.now
  const started = now()
  const supabase = options.supabase
  const minute = floorToMinute(options.minute ?? new Date(started))
  const budgetMs = options.budgetMs ?? TICK_BUDGET_MS
  const tickDeadline = started + budgetMs
  const concurrency = Math.max(1, options.concurrency ?? tickConcurrency())
  const holder = options.holder ?? `tick-${minute.toISOString()}-${Math.random().toString(36).slice(2, 8)}`
  const jobs = options.jobs ?? JOBS

  const summary: TickSummary = { ok: true, minute: minute.toISOString(), lock: 'unavailable', due: [], jobs: [], duration_ms: 0 }

  const { lock, lastStarted } = await acquireLock(supabase, holder, Math.max(1, Math.floor(options.lockTtlSeconds ?? TICK_LOCK_TTL_S)))
  summary.lock = lock
  if (summary.lock === 'held') {
    summary.skipped = 'locked'
    summary.duration_ms = now() - started
    return summary
  }

  try {
    const due = dueJobs(minute, lastStarted, jobs)
    summary.due = due.map((job) => job.name)
    const probe = memoProbe(supabase)
    const outcomes = new Map<string, JobOutcome>()
    const startRows: Array<Record<string, unknown>> = []

    const runOne = async (job: JobDefinition): Promise<void> => {
      const jobStart = now()
      const ctx: JobContext = { supabase, minute, deadline: Math.min(tickDeadline, jobStart + job.budgetMs), probe }

      let enabled = true
      try {
        const check = await withTimeout(job.isEnabled(ctx), ENABLED_CHECK_TIMEOUT_MS)
        enabled = check !== false
      } catch {
        enabled = true // a failing check must not silently stop a job
      }
      if (!enabled) {
        outcomes.set(job.name, { name: job.name, status: 'disabled', duration_ms: now() - jobStart })
        return
      }

      const startedAt = new Date(now()).toISOString()
      startRows.push({ job_name: job.name, last_started_at: startedAt })
      // Daily jobs: persist the start right away so a tick that dies mid-job
      // does not make the catch-up rerun it all day.
      if ('daily' in job.cadence) await recordRuns(supabase, [{ job_name: job.name, last_started_at: startedAt }])

      try {
        const result = await withTimeout(Promise.resolve().then(() => job.run(ctx)), ctx.deadline - now() + JOB_GRACE_MS)
        if (result === TIMED_OUT) {
          outcomes.set(job.name, { name: job.name, status: 'timeout', duration_ms: now() - jobStart })
        } else {
          outcomes.set(job.name, { name: job.name, status: 'ok', duration_ms: now() - jobStart, result })
        }
      } catch (error) {
        outcomes.set(job.name, { name: job.name, status: 'error', duration_ms: now() - jobStart, error: message(error) })
      }
    }

    // Bounded pool, registry order. A job is not started once the tick's
    // budget is spent (it runs again at its next due minute).
    const queue = [...due]
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        if (now() >= tickDeadline) {
          outcomes.set(job.name, { name: job.name, status: 'not_started', duration_ms: 0 })
          continue
        }
        await runOne(job)
      }
    })
    await Promise.all(workers)

    summary.jobs = due.map((job) => outcomes.get(job.name)!).filter(Boolean)
    summary.ok = summary.jobs.every((job) => job.status !== 'error')

    const finishedAt = new Date(now()).toISOString()
    await recordRuns(
      supabase,
      summary.jobs
        .filter((job) => job.status !== 'disabled' && job.status !== 'not_started')
        .map((job) => ({
          job_name: job.name,
          last_started_at: startRows.find((row) => row.job_name === job.name)?.last_started_at ?? finishedAt,
          last_finished_at: finishedAt,
          last_status: job.status,
          last_error: job.error ?? null,
          last_duration_ms: job.duration_ms,
        })),
    )
  } finally {
    if (summary.lock === 'acquired' && !options.keepLock) await releaseLock(supabase, holder)
  }

  summary.duration_ms = now() - started
  return summary
}
