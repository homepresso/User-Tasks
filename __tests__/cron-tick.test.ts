import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { JobDefinition, Probe } from '@/lib/jobs/registry'
import { runTick } from '@/lib/jobs/tick'

/** In-memory stand-in for the cron_tick_* RPCs (same lease semantics as the SQL). */
function fakeDb(options: { missingRpcs?: boolean; probe?: Probe; lastStarted?: Record<string, string | null> } = {}) {
  const state = {
    lock: { holder: null as string | null, until: 0 },
    runs: new Map<string, Record<string, unknown>>(Object.entries(options.lastStarted ?? {}).map(([k, v]) => [k, { job_name: k, last_started_at: v }])),
    calls: [] as string[],
  }
  const missing = { data: null, error: { code: 'PGRST202', message: 'not found' } }
  const supabase = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.calls.push(fn)
      if (options.missingRpcs) return missing
      if (fn === 'cron_tick_acquire') {
        if (state.lock.until > Date.now()) return { data: { acquired: false }, error: null }
        state.lock = { holder: String(args.p_holder), until: Date.now() + Number(args.p_ttl_seconds) * 1000 }
        const lastStarted = Object.fromEntries([...state.runs].map(([k, v]) => [k, v.last_started_at ?? null]))
        return { data: { acquired: true, last_started: lastStarted }, error: null }
      }
      if (fn === 'cron_tick_release') {
        if (state.lock.holder === args.p_holder) state.lock.until = 0
        return { data: null, error: null }
      }
      if (fn === 'cron_tick_record') {
        for (const row of args.p_runs as Array<Record<string, unknown>>) {
          state.runs.set(String(row.job_name), { ...state.runs.get(String(row.job_name)), ...row })
        }
        return { data: null, error: null }
      }
      if (fn === 'cron_tick_probe') return { data: options.probe ?? {}, error: null }
      return missing
    },
  } as unknown as SupabaseClient
  return { supabase, state }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function job(name: string, over: Partial<JobDefinition> = {}): JobDefinition {
  return {
    name,
    cadence: { every: 1 },
    endpoint: `/api/test/${name}`,
    budgetMs: 10_000,
    isEnabled: async () => true,
    run: async () => ({ ran: name }),
    ...over,
  }
}

const MINUTE = new Date('2026-10-25T07:05:00Z')

describe('runTick', () => {
  it('runs the jobs due in the minute and records them', async () => {
    const { supabase, state } = fakeDb()
    const ran: string[] = []
    const jobs = [
      job('every-minute', { run: async () => { ran.push('every-minute'); return 1 } }),
      job('every-five', { cadence: { every: 5 }, run: async () => { ran.push('every-five'); return 5 } }),
      job('every-ten', { cadence: { every: 10 }, run: async () => { ran.push('every-ten'); return 10 } }),
      job('daily', { cadence: { daily: '12:00' } }),
    ]
    const summary = await runTick({ supabase, minute: MINUTE, jobs })
    expect(summary.ok).toBe(true)
    expect(summary.lock).toBe('acquired')
    expect(summary.minute).toBe('2026-10-25T07:05:00.000Z')
    expect(summary.due).toEqual(['every-minute', 'every-five'])
    expect(ran.sort()).toEqual(['every-five', 'every-minute'])
    expect(summary.jobs.map((j) => [j.name, j.status, j.result])).toEqual([['every-minute', 'ok', 1], ['every-five', 'ok', 5]])
    expect(state.runs.get('every-five')).toMatchObject({ last_status: 'ok' })
    expect(state.lock.until).toBe(0) // released
  })

  it('skips jobs whose isEnabled is false, without running them', async () => {
    const { supabase, state } = fakeDb({ probe: { queue: false } })
    const run = vi.fn(async () => 'x')
    const jobs = [
      job('empty-queue', { isEnabled: async (ctx) => (await ctx.probe()).queue !== false, run }),
      job('other'),
    ]
    const summary = await runTick({ supabase, minute: MINUTE, jobs })
    expect(run).not.toHaveBeenCalled()
    expect(summary.jobs.find((j) => j.name === 'empty-queue')?.status).toBe('disabled')
    expect(summary.jobs.find((j) => j.name === 'other')?.status).toBe('ok')
    expect(state.runs.has('empty-queue')).toBe(false)
    // One probe call shared by every job in the tick.
    expect(state.calls.filter((c) => c === 'cron_tick_probe')).toHaveLength(1)
  })

  it('a throwing isEnabled does not stop the job', async () => {
    const { supabase } = fakeDb()
    const summary = await runTick({
      supabase, minute: MINUTE,
      jobs: [job('flaky-check', { isEnabled: async () => { throw new Error('boom') } })],
    })
    expect(summary.jobs[0].status).toBe('ok')
  })

  it('reports a failing job and keeps running the others', async () => {
    const { supabase, state } = fakeDb()
    const summary = await runTick({
      supabase, minute: MINUTE,
      jobs: [job('bad', { run: async () => { throw new Error('kaput') } }), job('good')],
    })
    expect(summary.ok).toBe(false)
    expect(summary.jobs).toEqual([
      expect.objectContaining({ name: 'bad', status: 'error', error: 'kaput' }),
      expect.objectContaining({ name: 'good', status: 'ok' }),
    ])
    expect(state.runs.get('bad')).toMatchObject({ last_status: 'error', last_error: 'kaput' })
  })

  it('a second concurrent tick skips while the first holds the lock', async () => {
    const { supabase, state } = fakeDb()
    const ran: string[] = []
    const jobs = [job('slow', { run: async () => { ran.push('slow'); await sleep(80); return 'done' } })]
    const first = runTick({ supabase, minute: MINUTE, jobs })
    await sleep(10)
    const second = await runTick({ supabase, minute: MINUTE, jobs })
    expect(second).toMatchObject({ skipped: 'locked', lock: 'held', jobs: [] })
    expect((await first).jobs[0].status).toBe('ok')
    expect(ran).toEqual(['slow'])
    // Released: the next tick runs.
    expect((await runTick({ supabase, minute: MINUTE, jobs })).lock).toBe('acquired')
    expect(state.calls.filter((c) => c === 'cron_tick_acquire')).toHaveLength(3)
  })

  it('an expired lease (crashed tick) does not block the next tick', async () => {
    const { supabase, state } = fakeDb()
    state.lock = { holder: 'dead-tick', until: Date.now() - 1 }
    expect((await runTick({ supabase, minute: MINUTE, jobs: [job('a')] })).lock).toBe('acquired')
  })

  it('runs without lock, probe or history when the RPCs are missing', async () => {
    const { supabase } = fakeDb({ missingRpcs: true })
    const summary = await runTick({
      supabase,
      minute: new Date('2026-10-25T04:00:00Z'),
      jobs: [job('a'), job('daily-3', { cadence: { daily: '03:00' } }), job('daily-4', { cadence: { daily: '04:00' } })],
    })
    expect(summary.lock).toBe('unavailable')
    // No history: daily jobs only at their exact minute.
    expect(summary.due).toEqual(['a', 'daily-4'])
    expect(summary.jobs.every((j) => j.status === 'ok')).toBe(true)
  })

  it('catches up a daily job missed earlier today, once', async () => {
    const { supabase } = fakeDb({ lastStarted: { 'daily-3': '2026-10-24T03:00:01Z' } })
    const jobs = [job('daily-3', { cadence: { daily: '03:00' } })]
    const first = await runTick({ supabase, minute: new Date('2026-10-25T03:20:00Z'), jobs })
    expect(first.jobs.map((j) => j.status)).toEqual(['ok'])
    const second = await runTick({ supabase, minute: new Date('2026-10-25T03:21:00Z'), jobs })
    expect(second.due).toEqual([])
  })

  describe('budgets', () => {
    it('passes each job a deadline capped by its budget and the tick budget', async () => {
      const { supabase } = fakeDb()
      const deadlines: Record<string, number> = {}
      // A frozen clock: the deadlines are exact, however slow the machine is.
      const start = Date.parse('2026-10-25T07:05:01Z')
      const capture = (name: string) => async (ctx: { deadline: number }) => { deadlines[name] = ctx.deadline - start }
      await runTick({
        supabase, minute: MINUTE, budgetMs: 5_000, now: () => start,
        jobs: [job('short', { budgetMs: 1_000, run: capture('short') }), job('long', { budgetMs: 60_000, run: capture('long') })],
      })
      expect(deadlines.short).toBe(1_000)
      expect(deadlines.long).toBe(5_000)
    })

    it('reports a job that overruns its budget as timeout and returns without waiting for it', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
      try {
        const { supabase, state } = fakeDb()
        let finished = false
        const hang = job('hang', { budgetMs: 1_000, run: () => new Promise<void>((resolve) => setTimeout(() => { finished = true; resolve() }, 60_000)) })
        const pending = runTick({ supabase, minute: MINUTE, budgetMs: 10_000, jobs: [hang, job('quick')] })
        await vi.advanceTimersByTimeAsync(5_000)
        const summary = await pending
        expect(finished).toBe(false)
        expect(summary.jobs.find((j) => j.name === 'hang')?.status).toBe('timeout')
        expect(summary.jobs.find((j) => j.name === 'quick')?.status).toBe('ok')
        expect(state.runs.get('hang')).toMatchObject({ last_status: 'timeout' })
      } finally {
        vi.useRealTimers()
      }
    })

    it('does not start jobs once the tick budget is spent', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
      try {
        const { supabase } = fakeDb()
        const slow = job('slow', { budgetMs: 8_000, run: () => new Promise((resolve) => setTimeout(resolve, 6_000)) })
        const later = vi.fn(async () => 'x')
        const pending = runTick({ supabase, minute: MINUTE, budgetMs: 5_000, concurrency: 1, jobs: [slow, job('later', { run: later })] })
        await vi.advanceTimersByTimeAsync(10_000)
        const summary = await pending
        expect(summary.jobs.map((j) => [j.name, j.status])).toEqual([['slow', 'ok'], ['later', 'not_started']])
        expect(later).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })

    it('runs at most `concurrency` jobs at once', async () => {
      const { supabase } = fakeDb()
      let active = 0
      let peak = 0
      const tracked = (name: string) => job(name, { run: async () => { active++; peak = Math.max(peak, active); await sleep(15); active-- } })
      await runTick({ supabase, minute: MINUTE, concurrency: 2, jobs: ['a', 'b', 'c', 'd', 'e'].map(tracked) })
      expect(peak).toBe(2)
    })
  })
})

describe('POST /api/cron/tick', () => {
  const ORIGINAL = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    process.env.CRON_SECRET = 'tick-secret'
    delete process.env.WORKFLOW_PROCESSOR_SECRET
  })
  afterEach(() => {
    process.env = { ...ORIGINAL }
    vi.doUnmock('@/lib/jobs/tick')
  })

  async function loadRoute(runTickMock = vi.fn(async (opts: { minute?: Date }) => ({ ok: true, minute: opts.minute?.toISOString() ?? null }))) {
    vi.doMock('@/lib/jobs/tick', () => ({ runTick: runTickMock }))
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
    const route = await import('@/app/api/cron/tick/route')
    return { route, runTickMock }
  }

  it('rejects calls without the service secret', async () => {
    const { route, runTickMock } = await loadRoute()
    const response = await route.POST(new NextRequest('https://app.test/api/cron/tick', { method: 'POST', body: '{}' }))
    expect(response.status).toBe(401)
    const wrong = await route.POST(new NextRequest('https://app.test/api/cron/tick', { method: 'POST', headers: { authorization: 'Bearer nope' } }))
    expect(wrong.status).toBe(401)
    expect(runTickMock).not.toHaveBeenCalled()
  })

  it('fails closed when no secret is configured', async () => {
    delete process.env.CRON_SECRET
    const { route } = await loadRoute()
    const response = await route.GET(new NextRequest('https://app.test/api/cron/tick', { headers: { authorization: 'Bearer ' } }))
    expect(response.status).toBe(503)
  })

  it('runs the tick for the minute pg_cron sent (Bearer, as app_cron.invoke_endpoint sends it)', async () => {
    const { route, runTickMock } = await loadRoute()
    const minute = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString()
    const response = await route.POST(new NextRequest('https://app.test/api/cron/tick', {
      method: 'POST', headers: { authorization: 'Bearer tick-secret', 'content-type': 'application/json' }, body: JSON.stringify({ minute }),
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, minute })
    expect(runTickMock).toHaveBeenCalledTimes(1)
  })

  it('ignores a minute far from the server clock', async () => {
    const { route, runTickMock } = await loadRoute()
    await route.POST(new NextRequest('https://app.test/api/cron/tick', {
      method: 'POST', headers: { 'x-processor-secret': 'tick-secret' }, body: JSON.stringify({ minute: '2020-01-01T03:00:00Z' }),
    }))
    expect(runTickMock.mock.calls[0][0].minute).toBeUndefined()
  })

  it('GET works for schedulers that only send GETs', async () => {
    const { route } = await loadRoute()
    const response = await route.GET(new NextRequest('https://app.test/api/cron/tick', { headers: { authorization: 'Bearer tick-secret' } }))
    expect(response.status).toBe(200)
  })
})
