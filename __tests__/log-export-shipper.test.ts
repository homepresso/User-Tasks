import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.hoisted(() => {
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64')
})

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))

import { classifyStatus, parseRetryAfter, redactSecrets } from '@/lib/log-export/deliver'
import { verifyWebhookSignature } from '@/lib/log-export/formats/webhook'
import {
  applyDestinationFilters,
  backoffMs,
  FAILING_AFTER,
  retryDelayMs,
  runShipper,
  shipDestination,
  Watermark,
  type ClaimedDestination,
  type ShipContext,
} from '@/lib/log-export/shipper'
import { encryptSecret } from '@/lib/secret-crypto'
import { PERMISSION_KEYS } from '@/lib/permissions'
import type { ServiceContext } from '@/lib/services/context'
import { testLogDestination } from '@/lib/services/log-destinations'
import { GET as shipRoute } from '@/app/api/cron/ship-events/route'
import { createMemorySupabase } from './fixtures/supabase-memory'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows and fetch stubs */

const A = 'tenant-a'
const B = 'tenant-b'
const ADMIN = 'user-admin'
const OWNER = 'user-owner'
const TOKEN = 'hec-token-SUPER-SECRET-1'
const SIGNING = 'whsec_signing_secret_for_tests_123'
const URL_HEC = 'https://93.184.216.34:8088'
const URL_HOOK = 'https://93.184.216.34/hook'
const T0 = Date.parse('2026-10-24T12:00:00.000Z')

function ev(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id, tenant_id: A, occurred_at: new Date(T0 - 60_000 + id).toISOString(), type: 'workflow.run.completed', category: 'workflow',
    severity: 'info', message: `event ${id}`, source_table: 'workflow_runs', source_id: `r${id}`, trace_id: null, run_id: null,
    workflow_id: null, task_id: null, actor_id: null, attributes: {}, ...overrides,
  }
}

function destination(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dest-1', tenant_id: A, name: 'Splunk', type: 'splunk_hec', config: { url: URL_HEC }, credentials: { token: encryptSecret(TOKEN) },
    filters: {}, enabled: true, cursor: 0, status: 'healthy', next_attempt_at: null, locked_by: null, locked_at: null,
    events_sent: 0, last_success_at: null, last_error: null, last_error_at: null, consecutive_failures: 0, ...overrides,
  }
}

interface Setup {
  events?: any[]
  destinations?: any[]
  purged?: Record<string, number>
}

/** Memory DB plus a claim_next_log_destination stand-in with the SQL's due/lease rules. */
function makeDb(setup: Setup, clock: { now: number }) {
  const db = createMemorySupabase({
    event_stream: setup.events ?? [],
    log_destinations: setup.destinations ?? [destination()],
    notifications: [],
    users: [{ id: ADMIN, tenant_id: A, role: 'admin' }, { id: 'user-member', tenant_id: A, role: 'member' }, { id: 'user-b', tenant_id: B, role: 'admin' }],
    user_roles: [{ user_id: OWNER, tenant_id: A, role: { slug: 'owner', name: 'Owner' } }],
  })
  const marks = setup.purged ?? {}
  const rpc = vi.fn(async (name: string, args: any) => {
    if (name !== 'claim_next_log_destination') return { data: null, error: { message: `unknown rpc ${name}` } }
    const row = db.tables.log_destinations
      .filter((d) => d.enabled
        && (!d.next_attempt_at || Date.parse(d.next_attempt_at) <= clock.now)
        && (!d.locked_by || Date.parse(d.locked_at) < clock.now - args.p_lock_seconds * 1000))
      .sort((x, y) => String(x.next_attempt_at ?? '').localeCompare(String(y.next_attempt_at ?? '')))[0]
    if (!row) return { data: null, error: null }
    Object.assign(row, { locked_by: args.p_worker_id, locked_at: new Date(clock.now).toISOString() })
    return { data: { ...JSON.parse(JSON.stringify(row)), purged_through: marks[row.tenant_id] ?? 0 }, error: null }
  })
  return Object.assign(db, { rpc })
}
type Db = ReturnType<typeof makeDb>

function fakeFetch(handler: (url: string, init: RequestInit) => { status: number; body?: string; headers?: Record<string, string> }) {
  return vi.fn(async (url: string, init: RequestInit) => {
    const { status, body = '', headers = {} } = handler(url, init)
    return new Response(status === 204 ? null : body, { status, headers })
  })
}

function shipCtx(db: Db, clock: { now: number }, fetch: any, logs: string[] = []): ShipContext {
  return { supabase: db, workerId: 'w1', now: () => clock.now, random: () => 0.5, pollMs: 2000, fetch, log: (m) => logs.push(m) }
}

/** Claim like the RPC does, then ship. */
async function claimAndShip(db: Db, clock: { now: number }, fetch: any, through: number, logs: string[] = []) {
  const { data } = await db.rpc('claim_next_log_destination', { p_worker_id: 'w1', p_lock_seconds: 120 })
  if (!data) return null
  return shipDestination(shipCtx(db, clock, fetch, logs), data as ClaimedDestination, through)
}

const row = (db: Db, id = 'dest-1') => db.tables.log_destinations.find((d) => d.id === id)!

beforeEach(() => {
  process.env.ALLOW_PRIVATE_EGRESS = 'false'
})
afterEach(() => {
  delete process.env.ALLOW_PRIVATE_EGRESS
  vi.unstubAllGlobals()
})

describe('backoff schedule', () => {
  it('doubles from 5 s and caps at 5 minutes', () => {
    const mid = () => 0.5
    expect([1, 2, 3, 4, 5, 6, 7, 8, 20].map((n) => backoffMs(n, mid) / 1000)).toEqual([5, 10, 20, 40, 80, 160, 300, 300, 300])
  })

  it('jitters ±20% without exceeding the cap', () => {
    expect(backoffMs(1, () => 0)).toBe(4000)
    expect(backoffMs(1, () => 1)).toBe(6000)
    expect(backoffMs(10, () => 1)).toBe(300_000)
  })

  it('honours Retry-After when longer than the backoff', () => {
    expect(retryDelayMs(1, 120_000, () => 0.5)).toBe(120_000)
    expect(retryDelayMs(4, 1_000, () => 0.5)).toBe(40_000)
    expect(parseRetryAfter('30')).toBe(30_000)
    expect(parseRetryAfter(new Date(T0 + 90_000).toUTCString(), T0)).toBe(90_000)
    expect(parseRetryAfter('999999')).toBe(3_600_000)
    expect(parseRetryAfter('soon')).toBeNull()
  })

  it('classifies responses', () => {
    expect([200, 204, 301, 400, 401, 403, 404, 408, 413, 429, 500, 503].map(classifyStatus))
      .toEqual(['success', 'success', 'permanent', 'permanent', 'permanent', 'permanent', 'permanent', 'retry', 'permanent', 'retry', 'retry', 'retry'])
  })
})

describe('watermark', () => {
  it('only exposes ids observed at least settleMs ago', () => {
    const w = new Watermark(2000)
    w.observe(10, 1000)
    expect(w.settled(2000)).toBeNull()
    expect(w.waitMs(2000)).toBe(1000)
    w.observe(15, 2500)
    expect(w.settled(3000)).toBe(10)
    expect(w.settled(4500)).toBe(15)
  })
})

describe('shipDestination', () => {
  it('advances the cursor only after a 2xx and records stats', async () => {
    const clock = { now: T0 }
    const db = makeDb({ events: [ev(1), ev(2), ev(3), ev(4, { tenant_id: B })] }, clock)
    const fetch = fakeFetch(() => ({ status: 200, body: '{"text":"Success","code":0}' }))
    const outcome = await claimAndShip(db, clock, fetch, 4)
    expect(outcome).toMatchObject({ sent: 3, status: 'healthy', cursor: 4, error: null })
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe(`${URL_HEC}/services/collector/event`)
    expect((init.headers as any).Authorization).toBe(`Splunk ${TOKEN}`)
    expect(String(init.body).split('\n').map((l) => JSON.parse(l).event.id)).toEqual([1, 2, 3]) // tenant B's event never leaves
    expect(init.redirect).toBe('manual')
    expect(row(db)).toMatchObject({ cursor: 4, events_sent: 3, status: 'healthy', consecutive_failures: 0, locked_by: null })
    expect(row(db).next_attempt_at).toBe(new Date(T0 + 2000).toISOString())
  })

  it('stops at the watermark (in-flight ids are not skipped)', async () => {
    const clock = { now: T0 }
    const db = makeDb({ events: [ev(1), ev(2), ev(3)] }, clock)
    const fetch = fakeFetch(() => ({ status: 200 }))
    await claimAndShip(db, clock, fetch, 2)
    expect(row(db).cursor).toBe(2)
  })

  it('does not advance the cursor on 5xx; retrying with backoff', async () => {
    const clock = { now: T0 }
    const db = makeDb({ events: [ev(1), ev(2)] }, clock)
    const fetch = fakeFetch(() => ({ status: 503, body: 'busy' }))
    const outcome = await claimAndShip(db, clock, fetch, 2)
    expect(outcome).toMatchObject({ sent: 0, status: 'retrying', cursor: 0 })
    expect(row(db)).toMatchObject({ cursor: 0, status: 'retrying', consecutive_failures: 1, events_sent: 0, locked_by: null })
    expect(row(db).last_error).toContain('HTTP 503')
    expect(row(db).next_attempt_at).toBe(new Date(T0 + 5000).toISOString())

    // Not due again until the backoff passes.
    expect(await claimAndShip(db, clock, fetch, 2)).toBeNull()
    clock.now += 5000
    await claimAndShip(db, clock, fetch, 2)
    expect(row(db)).toMatchObject({ consecutive_failures: 2, status: 'retrying' })
    expect(row(db).next_attempt_at).toBe(new Date(clock.now + 10_000).toISOString())
  })

  it('honours Retry-After on 429', async () => {
    const clock = { now: T0 }
    const db = makeDb({ events: [ev(1)] }, clock)
    await claimAndShip(db, clock, fakeFetch(() => ({ status: 429, headers: { 'Retry-After': '120' } })), 1)
    expect(row(db).next_attempt_at).toBe(new Date(T0 + 120_000).toISOString())
    expect(row(db).status).toBe('retrying')
  })

  it('treats network errors and timeouts as retryable', async () => {
    const clock = { now: T0 }
    const db = makeDb({ events: [ev(1)] }, clock)
    const fetch = vi.fn(async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }) })
    const outcome = await claimAndShip(db, clock, fetch, 1)
    expect(outcome?.status).toBe('retrying')
    expect(row(db).last_error).toBe('network error: fetch failed (ECONNREFUSED)')
    expect(row(db).cursor).toBe(0)
  })

  it('goes failing after 5 consecutive 4xx and notifies owners/admins exactly once', async () => {
    const clock = { now: T0 }
    const db = makeDb({ events: [ev(1)] }, clock)
    const fetch = fakeFetch(() => ({ status: 403, body: '{"text":"Invalid token","code":4}' }))
    const statuses: string[] = []
    for (let i = 0; i < FAILING_AFTER + 2; i++) {
      const outcome = await claimAndShip(db, clock, fetch, 1)
      statuses.push(outcome!.status)
      clock.now += 400_000
    }
    expect(statuses).toEqual(['retrying', 'retrying', 'retrying', 'retrying', 'failing', 'failing', 'failing'])
    expect(row(db)).toMatchObject({ status: 'failing', consecutive_failures: 7, cursor: 0 })
    const notes = db.tables.notifications
    expect(notes.map((n) => n.user_id).sort()).toEqual([ADMIN, OWNER].sort())
    expect(notes.every((n) => n.tenant_id === A && n.type === 'log_export' && /failing/i.test(n.title))).toBe(true)

    // Recovery resets the failure count; a later failing streak notifies again.
    fetch.mockImplementation(async () => new Response('', { status: 200 }))
    await claimAndShip(db, clock, fetch, 1)
    expect(row(db)).toMatchObject({ status: 'healthy', consecutive_failures: 0, cursor: 1 })
  })

  it('advances past delivered requests when a later request fails', async () => {
    const clock = { now: T0 }
    const big = 'x'.repeat(400_000)
    const db = makeDb({ events: [1, 2, 3, 4].map((id) => ev(id, { attributes: { blob: big } })) }, clock)
    let call = 0
    const fetch = fakeFetch(() => ({ status: ++call === 1 ? 200 : 500 }))
    const outcome = await claimAndShip(db, clock, fetch, 4)
    expect(fetch.mock.calls.length).toBe(2)
    expect(outcome).toMatchObject({ sent: 2, status: 'retrying', cursor: 2 })
    expect(row(db)).toMatchObject({ cursor: 2, events_sent: 2, consecutive_failures: 1 })
  })

  it('applies filters and skips non-matching events without sending', async () => {
    const clock = { now: T0 }
    const db = makeDb({
      events: [ev(1, { category: 'audit', type: 'audit.role.update' }), ev(2, { severity: 'debug' }), ev(3, { severity: 'error', type: 'workflow.run.failed' }), ev(4, { category: 'task', type: 'task.completed' })],
      destinations: [destination({ filters: { categories: ['workflow'], min_severity: 'info' } })],
    }, clock)
    const fetch = fakeFetch(() => ({ status: 200 }))
    await claimAndShip(db, clock, fetch, 4)
    expect(String(fetch.mock.calls[0][1].body).split('\n').map((l) => JSON.parse(l).event.id)).toEqual([3])
    expect(row(db).cursor).toBe(4)

    // Nothing matching: cursor moves to the watermark without a request.
    db.tables.event_stream.push(ev(5, { category: 'task' }))
    clock.now += 2000
    await claimAndShip(db, clock, fetch, 5)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(row(db).cursor).toBe(5)
  })

  it('builds SQL filters for types and workflow ids', () => {
    const calls: string[] = []
    const q: any = new Proxy({}, { get: (_t, name: string) => (...args: unknown[]) => { calls.push(`${name}(${JSON.stringify(args)})`); return q } })
    applyDestinationFilters(q, { types: ['workflow.*', 'task.completed'], workflow_ids: ['w1'], min_severity: 'warn' })
    expect(calls).toEqual([
      'in(["severity",["warn","error"]])',
      'or(["type.like.workflow.*,type.eq.task.completed"])',
      'in(["workflow_id",["w1"]])',
    ])
    calls.length = 0
    applyDestinationFilters(q, { types: ['agent.run.*'] })
    expect(calls).toEqual(['like(["type","agent.run.%"])'])
  })

  it('marks lagging_data_lost when retention purged unsent events, once per transition', async () => {
    const clock = { now: T0 }
    const db = makeDb({ events: [ev(60), ev(61)], destinations: [destination({ cursor: 10 })], purged: { [A]: 50 } }, clock)
    const fetch = fakeFetch(() => ({ status: 200 }))
    const outcome = await claimAndShip(db, clock, fetch, 61)
    expect(outcome).toMatchObject({ dataLost: true, status: 'lagging_data_lost', sent: 2, cursor: 61 })
    expect(row(db)).toMatchObject({ status: 'lagging_data_lost', cursor: 61 })
    expect(row(db).last_error).toMatch(/events 11–50 were purged/)
    const system = db.tables.event_stream.filter((e) => e.type === 'system.log_export.data_lost')
    expect(system).toHaveLength(1)
    expect(system[0]).toMatchObject({ tenant_id: A, category: 'system', severity: 'warn', source_table: 'log_destinations', source_id: 'dest-1' })
    expect(system[0].attributes).toMatchObject({ cursor_before: 10, cursor_after: 50, destination_id: 'dest-1' })
    expect(db.tables.notifications).toHaveLength(2)

    // Sticky status, no second notification while already lagging.
    Object.assign(row(db), { cursor: 20, next_attempt_at: null })
    await claimAndShip(db, clock, fetch, 61)
    expect(db.tables.notifications).toHaveLength(2)
    expect(row(db).status).toBe('lagging_data_lost')
  })

  it('never puts credentials in errors, logs or the run summary', async () => {
    const clock = { now: T0 }
    const db = makeDb({ events: [ev(1)] }, clock)
    const logs: string[] = []
    const fetch = fakeFetch(() => ({ status: 401, body: `{"text":"Invalid token ${TOKEN}"}` }))
    await claimAndShip(db, clock, fetch, 1, logs)
    expect(row(db).last_error).toContain('***')
    expect(JSON.stringify(db.tables)).not.toContain(TOKEN)
    expect(logs.join('\n')).not.toContain(TOKEN)
    expect(logs.join('\n')).toContain('***')

    const thrown = vi.fn(async () => { throw new Error(`connect failed for Splunk ${TOKEN}`) })
    clock.now += 400_000
    await claimAndShip(db, clock, thrown, 1, logs)
    expect(row(db).last_error).not.toContain(TOKEN)
  })

  it('rejects private targets at send time unless ALLOW_PRIVATE_EGRESS', async () => {
    const clock = { now: T0 }
    const db = makeDb({ events: [ev(1)], destinations: [destination({ config: { url: 'http://127.0.0.1:8088' } })] }, clock)
    const fetch = fakeFetch(() => ({ status: 200 }))
    await claimAndShip(db, clock, fetch, 1)
    expect(fetch).not.toHaveBeenCalled()
    expect(row(db)).toMatchObject({ status: 'retrying', cursor: 0 })
    expect(row(db).last_error).toMatch(/not allowed/)
  })
})

describe('runShipper', () => {
  it('drains due destinations, polls for new events and releases leases', async () => {
    const clock = { now: T0 }
    const db = makeDb({
      events: [ev(1), ev(2)],
      destinations: [destination(), destination({ id: 'dest-2', name: 'Hook', type: 'webhook', config: { url: URL_HOOK }, credentials: { signing_secret: encryptSecret(SIGNING) } })],
    }, clock)
    const received: Array<{ url: string; init: RequestInit }> = []
    const fetch = fakeFetch((url, init) => { received.push({ url, init }); return { status: 200 } })
    let injected = false
    const sleep = async (ms: number) => {
      clock.now += ms
      if (!injected && clock.now > T0 + 5000) { injected = true; db.tables.event_stream.push(ev(3)) }
    }
    const summary = await runShipper({ supabase: db, fetch, now: () => clock.now, sleep, random: () => 0.5, settleMs: 0, budgetMs: 20_000, workerId: 'w-run', log: () => {} })
    expect(summary.events_sent).toBe(6)
    expect(summary.failures).toBe(0)
    expect(row(db)).toMatchObject({ cursor: 3, events_sent: 3, locked_by: null })
    expect(row(db, 'dest-2')).toMatchObject({ cursor: 3, events_sent: 3, locked_by: null })
    const hooks = received.filter((r) => r.url === URL_HOOK)
    expect(hooks).toHaveLength(2)
    for (const { init } of hooks) {
      expect(verifyWebhookSignature(SIGNING, (init.headers as any)['X-UserTasks-Signature'], String(init.body), { now: clock.now })).toBe(true)
    }
    expect(JSON.stringify(summary)).not.toContain(TOKEN)
  })

  it('waits for the settle window before shipping', async () => {
    const clock = { now: T0 }
    const db = makeDb({ events: [ev(1)] }, clock)
    const fetch = fakeFetch(() => ({ status: 200 }))
    const sleeps: number[] = []
    await runShipper({ supabase: db, fetch, now: () => clock.now, sleep: async (ms) => { sleeps.push(ms); clock.now += ms }, settleMs: 2000, budgetMs: 6000, log: () => {} })
    expect(sleeps[0]).toBe(2000)
    expect(row(db).cursor).toBe(1)
  })
})

describe('redaction', () => {
  it('replaces every credential value, including header values', () => {
    expect(redactSecrets('a hec-token-SUPER-SECRET-1 b hdr-value-9', { token: TOKEN, headers: { 'X-Key': 'hdr-value-9' } })).toBe('a *** b ***')
  })
})

describe('POST /log-destinations/{id}/test (service)', () => {
  const ALL = [...PERMISSION_KEYS]
  const svc = (db: Db, permissions: readonly string[] = ALL): ServiceContext =>
    ({ supabase: db as any, tenantId: A, actorId: 'user-1', permissions: new Set(permissions), authKind: 'api_key', source: 'api' })

  it('sends one synthetic system.test event and leaves the cursor alone', async () => {
    const clock = { now: T0 }
    const db = makeDb({ destinations: [destination({ id: 'd-hook', type: 'webhook', config: { url: URL_HOOK }, credentials: { signing_secret: encryptSecret(SIGNING) }, cursor: 7 })] }, clock)
    const fetch = fakeFetch(() => ({ status: 202 }))
    vi.stubGlobal('fetch', fetch)
    const result = await testLogDestination(svc(db), 'd-hook')
    expect(result).toMatchObject({ ok: true, status_code: 202, error: null, retryable: false, requests: 1 })
    expect(typeof result.latency_ms).toBe('number')
    const body = JSON.parse(String(fetch.mock.calls[0][1].body))
    expect(body.events).toHaveLength(1)
    expect(body.events[0]).toMatchObject({ type: 'system.test', category: 'system', tenant_id: A, source_id: 'd-hook' })
    expect(verifyWebhookSignature(SIGNING, (fetch.mock.calls[0][1].headers as any)['X-UserTasks-Signature'], String(fetch.mock.calls[0][1].body))).toBe(true)
    expect(row(db, 'd-hook')).toMatchObject({ cursor: 7, events_sent: 0, status: 'healthy' })
  })

  it('returns the redacted failure', async () => {
    const clock = { now: T0 }
    const db = makeDb({}, clock)
    vi.stubGlobal('fetch', fakeFetch(() => ({ status: 403, body: `bad token ${TOKEN}` })))
    const result = await testLogDestination(svc(db), 'dest-1')
    expect(result).toMatchObject({ ok: false, status_code: 403, retryable: false })
    expect(result.error).toContain('***')
    expect(result.error).not.toContain(TOKEN)
  })

  it('needs settings.edit and observability.view, and stays inside the tenant', async () => {
    const clock = { now: T0 }
    const db = makeDb({}, clock)
    const fetch = fakeFetch(() => ({ status: 200 }))
    vi.stubGlobal('fetch', fetch)
    await expect(testLogDestination(svc(db, ['observability.view']), 'dest-1')).rejects.toThrow(/settings\.edit/)
    await expect(testLogDestination(svc(db, ['settings.edit']), 'dest-1')).rejects.toThrow(/observability\.view/)
    await expect(testLogDestination({ ...svc(db), tenantId: B }, 'dest-1')).rejects.toThrow(/not found/i)
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('/api/cron/ship-events', () => {
  it('requires the service secret', async () => {
    process.env.CRON_SECRET = 'cron-secret-for-test'
    try {
      const res = await shipRoute(new NextRequest('http://localhost/api/cron/ship-events'))
      expect(res.status).toBe(401)
    } finally {
      delete process.env.CRON_SECRET
    }
  })
})
