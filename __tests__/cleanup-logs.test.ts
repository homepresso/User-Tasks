import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

type Call = { table: string; op: 'count' | 'delete'; filters: Array<[string, string, unknown]> }
const calls: Call[] = []
const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = []
let tenants: Array<Record<string, unknown>> = []
let failDeleteFor: string | null = null
let rpcResults: number[] = []
let queuePurgeResults: Array<Record<string, number>> = []

function builder(table: string) {
  const call: Call = { table, op: 'count', filters: [] }
  const b: Record<string, unknown> = {
    select: () => b,
    delete: () => { call.op = 'delete'; return b },
    eq: (c: string, v: unknown) => { call.filters.push(['eq', c, v]); return b },
    lt: (c: string, v: unknown) => { call.filters.push(['lt', c, v]); return b },
    in: (c: string, v: unknown) => { call.filters.push(['in', c, v]); return b },
    or: (v: unknown) => { call.filters.push(['or', '', v]); return b },
    then: (resolve: (v: unknown) => unknown) => {
      calls.push(call)
      if (table === 'tenants') return Promise.resolve({ data: tenants, error: null }).then(resolve)
      if (call.op === 'delete' && failDeleteFor === table) {
        return Promise.resolve({ data: null, error: { message: 'boom' } }).then(resolve)
      }
      return Promise.resolve({ count: 3, data: null, error: null }).then(resolve)
    },
  }
  return b
}

vi.mock('@/lib/cron-auth', () => ({
  requireServiceAuth: () => null,
  createServiceClient: () => ({
    from: builder,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args })
      if (fn === 'purge_queue_history') return { data: queuePurgeResults.shift() ?? { workflow_queue: 0, agent_queue: 0 }, error: null }
      return { data: rpcResults.shift() ?? 0, error: null }
    },
  }),
}))

const staleTestRuns = vi.hoisted(() => ({ calls: [] as Date[], result: { runs: [] as string[], tasks: [] as string[] } }))
vi.mock('@/lib/workflow-test-runs', () => ({
  cancelStaleTestRuns: vi.fn(async (_db: unknown, now: Date) => { staleTestRuns.calls.push(now); return staleTestRuns.result }),
}))

import { GET } from '@/app/api/cron/cleanup-logs/route'
import { eventStreamRetentionHours, EVENT_STREAM_PURGE_BATCH } from '@/lib/log-export/retention'

const run = async () => (await GET(new NextRequest('https://app.test/api/cron/cleanup-logs'))).json()

beforeEach(() => {
  calls.length = 0
  rpcCalls.length = 0
  failDeleteFor = null
  rpcResults = []
  queuePurgeResults = []
  delete process.env.QUEUE_RETENTION_DAYS
  tenants = [{ id: 't1', log_retention_days: 30, agent_run_retention_days: null, settings: {} }]
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-24T12:00:00Z'))
})

describe('eventStreamRetentionHours', () => {
  it('defaults to 72h and clamps overrides to 1..168h', () => {
    expect(eventStreamRetentionHours(undefined)).toBe(72)
    expect(eventStreamRetentionHours({})).toBe(72)
    expect(eventStreamRetentionHours({ event_stream_retention_hours: 24 })).toBe(24)
    expect(eventStreamRetentionHours({ event_stream_retention_hours: '12' })).toBe(12)
    expect(eventStreamRetentionHours({ event_stream_retention_hours: 1000 })).toBe(168)
    expect(eventStreamRetentionHours({ event_stream_retention_hours: 0.5 })).toBe(1)
    expect(eventStreamRetentionHours({ event_stream_retention_hours: -5 })).toBe(72)
    expect(eventStreamRetentionHours({ event_stream_retention_hours: 'abc' })).toBe(72)
  })
})

describe('GET /api/cron/cleanup-logs', () => {
  it('ages integration_call_logs by started_at and workflow_logs by created_at', async () => {
    await run()
    const icl = calls.filter((c) => c.table === 'integration_call_logs')
    expect(icl.map((c) => c.op)).toEqual(['count', 'delete'])
    for (const c of icl) {
      expect(c.filters.find(([op]) => op === 'lt')?.[1]).toBe('started_at')
    }
    const wl = calls.filter((c) => c.table === 'workflow_logs')
    expect(wl.every((c) => c.filters.find(([op]) => op === 'lt')?.[1] === 'created_at')).toBe(true)
  })

  it('does not count rows whose delete failed', async () => {
    failDeleteFor = 'integration_call_logs'
    const body = await run()
    expect(body.cleaned.integration_call_logs).toBe(0)
    expect(body.cleaned.workflow_logs).toBe(3)
  })

  it('purges event_stream in batches with the tenant retention window', async () => {
    tenants = [
      { id: 't1', settings: {} },
      { id: 't2', settings: { event_stream_retention_hours: 24 } },
    ]
    rpcResults = [EVENT_STREAM_PURGE_BATCH, EVENT_STREAM_PURGE_BATCH, 10, 0]
    const body = await run()
    const purges = rpcCalls.filter((c) => c.fn === 'purge_event_stream')
    expect(purges.map((c) => [c.args.p_tenant_id, c.args.p_before])).toEqual([
      ['t1', '2026-10-21T12:00:00.000Z'],
      ['t1', '2026-10-21T12:00:00.000Z'],
      ['t1', '2026-10-21T12:00:00.000Z'],
      ['t2', '2026-10-23T12:00:00.000Z'],
    ])
    expect(purges.every((c) => c.args.p_batch_size === EVENT_STREAM_PURGE_BATCH)).toBe(true)
    expect(body.cleaned.event_stream).toBe(EVENT_STREAM_PURGE_BATCH * 2 + 10)
  })

  it('purges finished workflow_queue and agent_queue rows older than 7 days in batches', async () => {
    queuePurgeResults = [
      { workflow_queue: 5000, agent_queue: 12 },
      { workflow_queue: 5000, agent_queue: 0 },
      { workflow_queue: 40, agent_queue: 0 },
    ]
    const body = await run()
    const purges = rpcCalls.filter((c) => c.fn === 'purge_queue_history')
    expect(purges).toHaveLength(3)
    expect(purges.every((c) => c.args.p_before === '2026-10-17T12:00:00.000Z' && c.args.p_batch_size === 5000)).toBe(true)
    expect(body.cleaned.workflow_queue).toBe(10_040)
    expect(body.cleaned.agent_queue).toBe(12)
    // No per-tenant agent_queue deletes any more.
    expect(calls.some((c) => c.table === 'agent_queue')).toBe(false)
  })

  it('honours QUEUE_RETENTION_DAYS', async () => {
    process.env.QUEUE_RETENTION_DAYS = '2'
    await run()
    expect(rpcCalls.find((c) => c.fn === 'purge_queue_history')!.args.p_before).toBe('2026-10-22T12:00:00.000Z')
  })

  it('cancels designer test runs left waiting for more than 24h (and counts them)', async () => {
    staleTestRuns.calls.length = 0
    staleTestRuns.result = { runs: ['r1', 'r2'], tasks: ['t1'] }
    const body = await run()
    expect(staleTestRuns.calls).toHaveLength(1)
    expect(body.cleaned.stale_test_runs).toBe(2)
    expect(body.cleaned.stale_test_run_tasks).toBe(1)
  })
})
