import type { TickSummary } from '@/lib/jobs/tick'
import type { LeaderElector } from './leader'

/**
 * The in-process scheduler (SCHEDULER_PROVIDER=worker): a loop that wakes
 * shortly after every minute boundary (UTC), asks its elector whether this
 * replica leads, and if so runs that minute's tick (lib/jobs/tick.ts) by
 * calling the job registry directly — no HTTP, no pg_cron, no Vault.
 *
 * - Timing: wakes at `minute + offsetMs` (default 1 s, slack for clock skew
 *   between replicas) and ticks the minute it woke in. Sleeps are recomputed
 *   from the clock every time, so timer drift never accumulates.
 * - Budget: a tick gets `budgetMs` (default 50 s) and runs in the background,
 *   so the loop keeps its rhythm. While a tick is still running the next
 *   minute is skipped (`busy`) rather than started on top of it; every job
 *   is claim- or lease-based, so its work is picked up again later.
 * - Each minute is ticked at most once per process, even if the clock steps
 *   back.
 */

export const WORKER_TICK_BUDGET_MS = 50_000
export const WORKER_OFFSET_MS = 1_000
const MINUTE_MS = 60_000

export type MinuteOutcome = 'ticked' | 'follower' | 'busy' | 'error' | 'stopped'

export interface TickRequest {
  minute: Date
  budgetMs: number
  /** Lease-elected: keep the tick lease until just before the next minute. */
  keepLock: boolean
  lockTtlSeconds?: number
}

export interface SchedulerWorkerOptions {
  elector: LeaderElector
  tick: (request: TickRequest) => Promise<TickSummary | void>
  budgetMs?: number
  offsetMs?: number
  now?: () => number
  /** Resolves after `ms` or when `signal` aborts. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  log?: (message: string) => void
  /** Called after every minute (tests, status). */
  onMinute?: (minute: Date, outcome: MinuteOutcome, summary?: TickSummary | void) => void
}

const defaultSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(done, Math.max(0, ms))
    // The worker must never keep a process alive on its own (tests, scripts);
    // the server / worker entry keeps the event loop busy.
    timer.unref?.()
    signal.addEventListener('abort', done, { once: true })
    function done() {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
  })

/** Start of the minute after `ms` (UTC). */
export function nextMinuteStart(ms: number): number {
  return (Math.floor(ms / MINUTE_MS) + 1) * MINUTE_MS
}

/** Lease length that ends ~1 s before the next minute boundary (at least 1 s). */
export function leaseSecondsUntilNextMinute(ms: number): number {
  return Math.max(1, Math.floor((nextMinuteStart(ms) - ms) / 1000) - 1)
}

export class SchedulerWorker {
  private readonly opts: Required<Omit<SchedulerWorkerOptions, 'onMinute'>> & Pick<SchedulerWorkerOptions, 'onMinute'>
  private abort = new AbortController()
  private loop: Promise<void> | null = null
  private running: Promise<unknown> | null = null
  private lastMinute = -1

  constructor(options: SchedulerWorkerOptions) {
    this.opts = {
      budgetMs: WORKER_TICK_BUDGET_MS,
      offsetMs: WORKER_OFFSET_MS,
      now: Date.now,
      sleep: defaultSleep,
      log: (message) => console.log(`[scheduler] ${message}`),
      ...options,
    }
  }

  get started(): boolean {
    return this.loop !== null
  }

  /** Starts the loop (idempotent). */
  start(): void {
    if (this.loop) return
    this.abort = new AbortController()
    this.loop = this.run()
  }

  /** Stops the loop, waits for a running tick, gives up leadership. */
  async stop(): Promise<void> {
    this.abort.abort()
    await this.loop?.catch(() => undefined)
    this.loop = null
    await this.running?.catch(() => undefined)
    await this.opts.elector.release()
  }

  private async run(): Promise<void> {
    const { signal } = this.abort
    while (!signal.aborted) {
      const now = this.opts.now()
      await this.opts.sleep(nextMinuteStart(now) + this.opts.offsetMs - now, signal)
      if (signal.aborted) break
      // Not awaited: a long tick must not shift the next wake-up.
      void this.runMinute(new Date(this.opts.now()))
    }
  }

  /**
   * One minute: elect, then tick (unless a tick is still running or this
   * minute already ran here). Exposed for `usertasks worker --once` and tests.
   */
  async runMinute(at: Date): Promise<MinuteOutcome> {
    const minuteMs = Math.floor(at.getTime() / MINUTE_MS) * MINUTE_MS
    const minute = new Date(minuteMs)
    const finish = (outcome: MinuteOutcome, summary?: TickSummary | void) => {
      this.opts.onMinute?.(minute, outcome, summary)
      return outcome
    }
    if (minuteMs <= this.lastMinute) return finish('busy')
    if (this.running) {
      this.opts.log(`tick for ${minute.toISOString()} skipped: the previous tick is still running`)
      return finish('busy')
    }

    let leader = false
    try {
      leader = await this.opts.elector.isLeader()
    } catch {
      leader = false
    }
    if (!leader) return finish('follower')
    // Re-check: another call may have started while the election ran.
    if (this.running || minuteMs <= this.lastMinute) return finish('busy')
    this.lastMinute = minuteMs

    const lease = this.opts.elector.mode === 'lease'
    const request: TickRequest = {
      minute,
      budgetMs: this.opts.budgetMs,
      keepLock: lease,
      ...(lease ? { lockTtlSeconds: leaseSecondsUntilNextMinute(this.opts.now()) } : {}),
    }
    const run = (async () => {
      try {
        const summary = await this.opts.tick(request)
        return finish(summary && summary.skipped === 'locked' ? 'follower' : 'ticked', summary)
      } catch (error) {
        this.opts.log(`tick for ${minute.toISOString()} failed: ${(error as Error).message}`)
        return finish('error')
      }
    })()
    this.running = run
    try {
      return await run
    } finally {
      this.running = null
    }
  }
}
