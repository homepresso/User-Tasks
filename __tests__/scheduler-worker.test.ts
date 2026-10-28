/**
 * The in-process scheduler worker (lib/scheduler/worker.ts) and its leader
 * electors (lib/scheduler/leader.ts), without a database: loop timing, the
 * per-tick budget, busy/duplicate-minute guards, and leader election between
 * two workers — advisory locks (fake sessions sharing one lock table) and
 * the tick lease (the real runTick against an in-memory cron_tick_acquire).
 * scheduler-leader-db.test.ts repeats the advisory-lock case on Postgres.
 */
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { runTick, type TickSummary } from '@/lib/jobs/tick'
import type { JobDefinition } from '@/lib/jobs/registry'
import { AdvisoryLockElector, LeaseElector, type LeaderElector, type SessionClient } from '@/lib/scheduler/leader'
import { SchedulerWorker, leaseSecondsUntilNextMinute, nextMinuteStart, type MinuteOutcome, type TickRequest } from '@/lib/scheduler/worker'

const T0 = Date.UTC(2026, 9, 25, 12, 0, 0)
const MIN = 60_000

const leader = (value = true): LeaderElector => ({ mode: 'advisory_lock', isLeader: async () => value, release: async () => {} })
const quiet = () => undefined

describe('timing helpers', () => {
  it('computes the next minute boundary and a lease that ends before it', () => {
    expect(nextMinuteStart(T0)).toBe(T0 + MIN)
    expect(nextMinuteStart(T0 + 59_999)).toBe(T0 + MIN)
    expect(leaseSecondsUntilNextMinute(T0 + 1_000)).toBe(58)
    expect(leaseSecondsUntilNextMinute(T0 + 59_500)).toBe(1)
  })
})

describe('SchedulerWorker loop', () => {
  it('wakes just after each minute boundary and ticks that minute with the budget', async () => {
    let clock = T0 + 12_345
    const sleeps: number[] = []
    const requests: TickRequest[] = []
    const sleep = vi.fn(async (ms: number, signal: AbortSignal) => {
      sleeps.push(ms)
      await new Promise((resolve) => setTimeout(resolve, 0)) // let the previous minute's tick settle
      clock += ms
      if (sleeps.length >= 4) void worker.stop()
      expect(signal).toBeInstanceOf(AbortSignal)
    })
    const worker: SchedulerWorker = new SchedulerWorker({
      elector: leader(),
      tick: async (request) => {
        requests.push(request)
      },
      now: () => clock,
      sleep,
      log: quiet,
    })
    worker.start()
    await vi.waitFor(() => expect(sleeps.length).toBeGreaterThanOrEqual(4))
    await worker.stop()

    // First wake: next boundary + 1 s offset; then a minute apart (recomputed from the clock).
    expect(sleeps[0]).toBe(T0 + MIN + 1_000 - (T0 + 12_345))
    expect(sleeps.slice(1, 3)).toEqual([MIN, MIN])
    expect(requests.map((r) => r.minute.getTime())).toEqual([T0 + MIN, T0 + 2 * MIN, T0 + 3 * MIN])
    for (const request of requests) {
      expect(request.budgetMs).toBe(50_000)
      expect(request.keepLock).toBe(false)
    }
  })

  it('does not drift when ticks wake late', async () => {
    let clock = T0
    const sleeps: number[] = []
    const worker: SchedulerWorker = new SchedulerWorker({
      elector: leader(),
      tick: async () => {},
      now: () => clock,
      sleep: async (ms, signal) => {
        sleeps.push(ms)
        clock += ms + 700 // the timer fires late
        if (sleeps.length >= 3) void worker.stop()
        expect(signal.aborted).toBe(sleeps.length >= 3)
      },
      log: quiet,
    })
    worker.start()
    await vi.waitFor(() => expect(sleeps.length).toBeGreaterThanOrEqual(3))
    await worker.stop()
    expect(sleeps).toEqual([MIN + 1_000, MIN - 700, MIN - 700])
  })

  it('skips a minute while the previous tick is still running, and never ticks a minute twice', async () => {
    let release!: () => void
    const outcomes: MinuteOutcome[] = []
    const tick = vi.fn(() => new Promise<void>((resolve) => (release = resolve)))
    const worker = new SchedulerWorker({ elector: leader(), tick, log: quiet, onMinute: (_m, outcome) => outcomes.push(outcome) })

    const first = worker.runMinute(new Date(T0 + 1_000))
    await vi.waitFor(() => expect(tick).toHaveBeenCalledTimes(1))
    expect(await worker.runMinute(new Date(T0 + MIN + 1_000))).toBe('busy')
    release()
    expect(await first).toBe('ticked')
    expect(await worker.runMinute(new Date(T0 + 30_000))).toBe('busy') // same minute again
    expect(tick).toHaveBeenCalledTimes(1)
    expect(outcomes).toEqual(['busy', 'ticked', 'busy'])
  })

  it('reports followers and failed ticks without throwing', async () => {
    const follower = new SchedulerWorker({ elector: leader(false), tick: vi.fn(), log: quiet })
    expect(await follower.runMinute(new Date(T0))).toBe('follower')
    const failing = new SchedulerWorker({ elector: leader(), tick: async () => { throw new Error('boom') }, log: quiet })
    expect(await failing.runMinute(new Date(T0))).toBe('error')
    const throwingElector = new SchedulerWorker({
      elector: { mode: 'advisory_lock', isLeader: async () => { throw new Error('db down') }, release: async () => {} },
      tick: vi.fn(),
      log: quiet,
    })
    expect(await throwingElector.runMinute(new Date(T0))).toBe('follower')
  })

  it('asks for a lease that ends before the next minute when the lease elects', async () => {
    const requests: TickRequest[] = []
    const worker = new SchedulerWorker({ elector: new LeaseElector(), tick: async (r) => void requests.push(r), now: () => T0 + 2_000, log: quiet })
    await worker.runMinute(new Date(T0 + 2_000))
    expect(requests[0]).toMatchObject({ keepLock: true, lockTtlSeconds: 57 })
  })
})

// ── Advisory-lock election between two workers (fake sessions, shared lock table) ──

function fakeLockServer() {
  const locks = new Map<string, number>() // key → session id
  let nextId = 1
  const sessions = new Set<number>()
  return {
    locks,
    create(): SessionClient & { id: number; kill: () => void } {
      const id = nextId++
      let alive = false
      let onError: ((e: Error) => void) | null = null
      return {
        id,
        async connect() {
          alive = true
          sessions.add(id)
        },
        async query<R>(text: string, values?: unknown[]) {
          if (!alive) throw new Error('connection terminated')
          if (text.startsWith('SELECT pg_try_advisory_lock')) {
            const key = String(values?.[0])
            const holder = locks.get(key)
            if (holder === undefined || !sessions.has(holder)) locks.set(key, id)
            return { rows: [{ ok: locks.get(key) === id }] as unknown as R[] }
          }
          if (text.startsWith('SELECT pg_advisory_unlock')) {
            if (locks.get(String(values?.[0])) === id) locks.delete(String(values?.[0]))
            return { rows: [] as R[] }
          }
          return { rows: [{}] as unknown as R[] }
        },
        async end() {
          alive = false
          sessions.delete(id)
        },
        on(_event: 'error', listener: (e: Error) => void) {
          onError = listener
          return this
        },
        kill() {
          alive = false
          sessions.delete(id)
          onError?.(new Error('terminated by administrator'))
        },
      }
    },
  }
}

describe('two workers, advisory-lock election', () => {
  it('only one ticks per minute, and the other takes over when the leader dies', async () => {
    const server = fakeLockServer()
    const clients: Array<ReturnType<typeof server.create>> = []
    const elector = () =>
      new AdvisoryLockElector({ connectionString: 'postgres://fake', createClient: () => { const c = server.create(); clients.push(c); return c }, log: quiet })
    const ticks: string[] = []
    const make = (name: string) => new SchedulerWorker({ elector: elector(), tick: async () => void ticks.push(name), log: quiet })
    const a = make('a')
    const b = make('b')

    for (let i = 0; i < 3; i++) {
      const at = new Date(T0 + i * MIN + 1_000)
      const outcomes = await Promise.all([a.runMinute(at), b.runMinute(at)])
      expect(outcomes.filter((o) => o === 'ticked')).toHaveLength(1)
    }
    expect(new Set(ticks).size).toBe(1)
    const leaderName = ticks[0]

    // The leader's session dies; the follower wins the next election.
    const leaderClient = clients[leaderName === 'a' ? 0 : 1]
    leaderClient.kill()
    const at = new Date(T0 + 3 * MIN + 1_000)
    const [oa, ob] = await Promise.all([a.runMinute(at), b.runMinute(at)])
    expect([oa, ob].filter((o) => o === 'ticked')).toHaveLength(1)
    expect(ticks.at(-1)).not.toBe(leaderName)
    await a.stop()
    await b.stop()
  })
})

// ── Lease election between two workers (real runTick, in-memory lease) ──

function leaseSupabase(clock: () => number) {
  const state = { holder: null as string | null, until: -Infinity }
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    if (fn === 'cron_tick_acquire') {
      if (state.until >= clock()) return { data: { acquired: false }, error: null }
      state.holder = String(args.p_holder)
      state.until = clock() + Number(args.p_ttl_seconds) * 1000
      return { data: { acquired: true, last_started: {} }, error: null }
    }
    if (fn === 'cron_tick_release') {
      if (state.holder === args.p_holder) state.until = -Infinity
      return { data: null, error: null }
    }
    if (fn === 'cron_tick_probe') return { data: {}, error: null }
    return { data: null, error: null }
  })
  return { client: { rpc } as unknown as SupabaseClient, state }
}

describe('two workers, tick-lease election (Supabase only)', () => {
  it('only one runs each minute even when the other arrives later in the same minute', async () => {
    let clock = T0 + 1_000
    const { client } = leaseSupabase(() => clock)
    const runs: string[] = []
    const job: JobDefinition = { name: 'probe-job', cadence: { every: 1 }, endpoint: '/x', budgetMs: 1_000, isEnabled: async () => true, run: async () => void runs.push(new Date(clock).toISOString()) }
    const tickWith = (holder: string) => (request: TickRequest): Promise<TickSummary> =>
      runTick({ supabase: client, minute: request.minute, jobs: [job], keepLock: request.keepLock, lockTtlSeconds: request.lockTtlSeconds, holder, now: () => clock })
    const a = new SchedulerWorker({ elector: new LeaseElector(), tick: tickWith('a'), now: () => clock, log: quiet })
    const b = new SchedulerWorker({ elector: new LeaseElector(), tick: tickWith('b'), now: () => clock, log: quiet })

    for (let i = 0; i < 3; i++) {
      clock = T0 + i * MIN + 1_000
      expect(await a.runMinute(new Date(clock))).toBe('ticked')
      clock = T0 + i * MIN + 20_000 // b wakes late, after a finished
      expect(await b.runMinute(new Date(clock))).toBe('follower')
    }
    expect(runs).toHaveLength(3)

    // Next minute b is first: it wins, a follows.
    clock = T0 + 3 * MIN + 1_000
    expect(await b.runMinute(new Date(clock))).toBe('ticked')
    clock = T0 + 3 * MIN + 2_000
    expect(await a.runMinute(new Date(clock))).toBe('follower')
    expect(runs).toHaveLength(4)
  })
})
