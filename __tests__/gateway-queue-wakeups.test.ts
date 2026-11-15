import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Cost of an idle gateway: how many claim queries one 25 s long poll makes,
 * with LISTEN / NOTIFY wake-ups (direct connection) and without (Supabase
 * transaction pooler, no session connection).
 */

const rpc = vi.fn()
vi.mock('@/lib/providers/db', () => ({ getServiceDb: () => ({ rpc }) }))

const GW = '11111111-2222-3333-4444-555555555555'
const KEY = '99999999-8888-7777-6666-555555555555'
const JOB_ROW = {
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', gateway_id: GW, target: 'sp', method: 'GET', path: '/x',
  request: { headers: {}, anonymous: false, body: null }, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60_000).toISOString(), attempts: 1,
}

async function load() {
  const queue = await import('@/lib/gateway/queue')
  const notify = await import('@/lib/gateway/notify')
  return { queue, notify }
}

describe('gateway long poll: claim queries per poll', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    rpc.mockReset()
    rpc.mockResolvedValue({ data: [], error: null })
  })
  afterEach(async () => {
    const { notify } = await load()
    notify.setGatewayNotifierForTests(null)
    vi.useRealTimers()
  })

  it('with LISTEN / NOTIFY: an idle 25 s poll claims exactly once', async () => {
    const { queue, notify } = await load()
    notify.setGatewayNotifierForTests({ listening: () => true })
    const poll = queue.pollJobs(GW, KEY, 8, 25_000)
    await vi.advanceTimersByTimeAsync(25_000)
    expect(await poll).toEqual([])
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('with LISTEN / NOTIFY: a notified job is claimed at once (2 claims, no polling in between)', async () => {
    const { queue, notify } = await load()
    notify.setGatewayNotifierForTests({ listening: () => true })
    rpc.mockResolvedValueOnce({ data: [], error: null }).mockResolvedValueOnce({ data: [JOB_ROW], error: null })
    const poll = queue.pollJobs(GW, KEY, 8, 25_000)
    await vi.advanceTimersByTimeAsync(7_000)
    expect(rpc).toHaveBeenCalledTimes(1)
    queue.wakeGateway(GW) // what a NOTIFY 'q:<gateway>' turns into
    await vi.advanceTimersByTimeAsync(1)
    const jobs = await poll
    expect(jobs.map((j) => j.id)).toEqual([JOB_ROW.id])
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it('without notifications (transaction pooler): adaptive back-off, about 9 claims per 25 s instead of ~125', async () => {
    const { queue, notify } = await load()
    notify.setGatewayNotifierForTests({ listening: () => false })
    const poll = queue.pollJobs(GW, KEY, 8, 25_000)
    await vi.advanceTimersByTimeAsync(25_000)
    await poll
    // claims at 0, 0.25, 0.75, 1.75, 3.75, 7.75, 11.75, 15.75, 19.75, 23.75 s
    expect(rpc.mock.calls.length).toBeLessThanOrEqual(10)
    expect(rpc.mock.calls.length).toBeGreaterThanOrEqual(8)
  })

  it('maps NOTIFY payloads to queue events and ignores anything else', async () => {
    const { notify } = await load()
    expect(notify.eventForPayload(`q:${GW}`)).toBe(`gw:${GW}`)
    expect(notify.eventForPayload(`j:${JOB_ROW.id}`)).toBe(`job:${JOB_ROW.id}`)
    expect(notify.eventForPayload('q:not-a-uuid')).toBeNull()
    expect(notify.eventForPayload(null)).toBeNull()
  })

  it('picks a session-level connection for LISTEN, never a guess', async () => {
    const { notify } = await load()
    expect(notify.listenUrl({ GATEWAY_LISTEN_DATABASE_URL: 'postgres://direct' })).toBe('postgres://direct')
    expect(notify.listenUrl({ GATEWAY_LISTEN_DATABASE_URL: 'off', POSTGRES_URL_NON_POOLING: 'postgres://x' })).toBeNull()
    expect(notify.listenUrl({ POSTGRES_URL_NON_POOLING: 'postgres://np' })).toBe('postgres://np')
    expect(notify.listenUrl({ SUPABASE_DB_URL: 'postgres://sb' })).toBe('postgres://sb')
    expect(notify.listenUrl({ DB_PROVIDER: 'postgres', DATABASE_URL: 'postgres://pg' })).toBe('postgres://pg')
    // Supabase via PostgREST without a direct URL: no LISTEN, polling fallback.
    expect(notify.listenUrl({ DB_PROVIDER: 'supabase', DATABASE_URL: 'postgres://pooler:6543' })).toBeNull()
  })
})
