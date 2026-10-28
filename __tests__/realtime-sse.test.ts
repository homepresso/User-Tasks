/**
 * SSE realtime provider, server side (providers phase 5): NOTIFY payload
 * parsing, per-subscriber visibility (tenant isolation, own notifications
 * only), subscription authorisation, the SSE stream (batching, heartbeat,
 * planned reconnect, Last-Event-ID replay vs resync, backpressure, session
 * end), the hub's replay buffer and poll mode, and the route's auth.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deliveriesFor, parseNotifyPayload, type Audience, type ChangeEvent } from '@/lib/realtime/events'
import { parseSubscriptionKey, type ParsedSubscription } from '@/lib/realtime/topics'

const A = 'aaaaaaaa-0000-4000-8000-00000000000a'
const B = 'bbbbbbbb-0000-4000-8000-00000000000b'
const ME = '11111111-0000-4000-8000-000000000001'
const OTHER = '22222222-0000-4000-8000-000000000002'
const TASK_A = 'a0000000-0000-4000-8000-0000000000a1'
const TASK_B = 'b0000000-0000-4000-8000-0000000000b1'

const audience: Audience = { userId: ME, visible: new Set([A]), current: A, agent: new Set([A]), member: new Set([A]) }

function sub(key: string): ParsedSubscription {
  const parsed = parseSubscriptionKey(key)
  if (!parsed) throw new Error(`bad key ${key}`)
  return parsed
}
function taskEvent(rows: Array<{ id: string; tenant: string; assignee?: string[]; parent?: string[] }>, op: ChangeEvent['op'] = 'UPDATE', ts = 1000): ChangeEvent {
  return {
    ts, table: 'tasks', op,
    rows: rows.map((r) => ({ id: r.id, tenant_id: r.tenant, cols: { assignee_id: r.assignee ?? [], assigner_id: [], parent_task_id: r.parent ?? [] } })),
  }
}

describe('NOTIFY payloads', () => {
  it('parses row and bulk payloads; ignores malformed or foreign ones', () => {
    const rows = parseNotifyPayload(JSON.stringify({
      table: 'tasks', op: 'UPDATE', ts: 5,
      rows: [{ id: TASK_A, tenant_id: A, assignee_id: [ME, OTHER], assigner_id: [], parent_task_id: [], extra: 'x' }, { tenant_id: A }],
    }))
    expect(rows).toEqual({ ts: 5, table: 'tasks', op: 'UPDATE', rows: [{ id: TASK_A, tenant_id: A, cols: { assignee_id: [ME, OTHER], assigner_id: [], parent_task_id: [] } }] })
    expect(parseNotifyPayload(JSON.stringify({ table: 'workflow_logs', op: 'INSERT', ts: 6, bulk: true, tenants: [A] })))
      .toEqual({ ts: 6, table: 'workflow_logs', op: 'INSERT', tenants: [A] })
    for (const bad of [undefined, '', 'nope', '{}', JSON.stringify({ table: 'users', op: 'INSERT', ts: 1, rows: [] }), JSON.stringify({ table: 'tasks', op: 'TRUNCATE', ts: 1, rows: [] })]) {
      expect(parseNotifyPayload(bad)).toBeNull()
    }
  })
})

describe('visibility and matching', () => {
  it('a user in tenant A never receives tenant B rows, on any subscription', () => {
    const subs = ['tasks||*', `tasks|tenant_id=eq.${B}|*`, `tasks|id=eq.${TASK_B}|*`, `tasks|assignee_id=eq.${ME}|*`].map(sub)
    // Even a B task assigned to me is invisible while my visible tenants are [A].
    const out = deliveriesFor(taskEvent([{ id: TASK_B, tenant: B, assignee: [ME] }]), subs, audience)
    expect(out).toEqual([])
    const mixed = deliveriesFor(taskEvent([{ id: TASK_A, tenant: A, assignee: [ME] }, { id: TASK_B, tenant: B, assignee: [ME] }]), subs, audience)
    expect(mixed).toEqual([
      { key: 'tasks||*', op: 'UPDATE', ids: [TASK_A] },
      { key: `tasks|assignee_id=eq.${ME}|*`, op: 'UPDATE', ids: [TASK_A] },
    ])
    expect(JSON.stringify(mixed)).not.toContain(TASK_B)
  })

  it('notifications reach only their own user, whatever the tenant', () => {
    const subs = [sub(`notifications|user_id=eq.${ME}|*`)]
    const event: ChangeEvent = {
      ts: 1, table: 'notifications', op: 'INSERT',
      rows: [
        { id: 'n-mine-b', tenant_id: B, cols: { user_id: [ME] } },
        { id: 'n-other-a', tenant_id: A, cols: { user_id: [OTHER] } },
      ],
    }
    expect(deliveriesFor(event, subs, audience)).toEqual([{ key: subs[0].key, op: 'INSERT', ids: ['n-mine-b'] }])
  })

  it('applies each log table\'s own policy (current tenant / agent tenants / visible tenants)', () => {
    const aud: Audience = { ...audience, visible: new Set([A, B]), current: A, agent: new Set([B]) }
    const ev = (table: ChangeEvent['table'], tenant: string): ChangeEvent => ({ ts: 1, table, op: 'INSERT', rows: [{ id: `${table}-${tenant}`, tenant_id: tenant, cols: {} }] })
    const subs = ['object_audit_log||INSERT', 'integration_call_logs||INSERT', 'agent_runs||INSERT', 'workflow_logs||INSERT'].map(sub)
    expect(deliveriesFor(ev('object_audit_log', B), subs, aud)).toEqual([])
    expect(deliveriesFor(ev('integration_call_logs', A), subs, aud)).toHaveLength(1)
    expect(deliveriesFor(ev('agent_runs', A), subs, aud)).toEqual([])
    expect(deliveriesFor(ev('agent_runs', B), subs, aud)).toHaveLength(1)
    expect(deliveriesFor(ev('workflow_logs', B), subs, aud)).toHaveLength(1)
  })

  it('matches filters on id, parent, tenant and operation, including old values of updates', () => {
    const subs = [`tasks|id=eq.${TASK_A}|*`, `tasks|parent_task_id=eq.${TASK_A}|*`, `tasks|assignee_id=eq.${ME}|DELETE`, `tasks|tenant_id=eq.${A}|INSERT`].map(sub)
    // Reassigned from ME to OTHER: ME's queue still hears about it (old value).
    const update = taskEvent([{ id: 'child', tenant: A, parent: [TASK_A], assignee: [OTHER, ME] }])
    expect(deliveriesFor(update, subs, audience).map((d) => d.key)).toEqual([subs[1].key])
    const del = taskEvent([{ id: TASK_A, tenant: A, assignee: [ME] }], 'DELETE')
    expect(deliveriesFor(del, subs, audience).map((d) => d.key)).toEqual([subs[0].key, subs[2].key])
    const ins = taskEvent([{ id: 'x', tenant: A }], 'INSERT')
    expect(deliveriesFor(ins, subs, audience).map((d) => d.key)).toEqual([subs[3].key])
  })

  it('bulk statements notify (without ids) only when a touched tenant is visible', () => {
    const subs = ['workflow_logs||INSERT', `notifications|user_id=eq.${ME}|*`].map(sub)
    expect(deliveriesFor({ ts: 1, table: 'workflow_logs', op: 'INSERT', tenants: [B] }, subs, audience)).toEqual([])
    expect(deliveriesFor({ ts: 1, table: 'workflow_logs', op: 'INSERT', tenants: [B, A] }, subs, audience))
      .toEqual([{ key: 'workflow_logs||INSERT', op: 'INSERT', ids: null }])
    expect(deliveriesFor({ ts: 1, table: 'notifications', op: 'INSERT', tenants: [A] }, subs, audience)).toHaveLength(1)
    expect(deliveriesFor({ ts: 1, table: 'notifications', op: 'INSERT', tenants: [B] }, subs, audience)).toEqual([])
  })
})

// ── authorizeSubscriptions ──

function fakeDb(visibleTasks: string[]) {
  const calls: string[] = []
  return {
    calls,
    from(table: string) {
      calls.push(table)
      return {
        select: () => ({
          in: async (_col: string, ids: string[]) => ({ data: ids.filter((i) => visibleTasks.includes(i)).map((id) => ({ id })), error: null }),
          eq: () => ({ maybeSingle: async () => ({ data: { tenant_id: A, current_tenant_id: null }, error: null }) }),
        }),
      }
    },
    rpc: async (name: string) => {
      calls.push(name)
      if (name === 'rls_visible_tenant_ids') return { data: [A], error: null }
      if (name === 'get_user_tenant_ids') return { data: [{ get_user_tenant_ids: A }], error: null }
      return { data: null, error: { message: 'unknown' } }
    },
  }
}

describe('authorizeSubscriptions', () => {
  it('rejects other users\' queues and notifications, invisible tasks, and logs without settings.view', async () => {
    const { authorizeSubscriptions } = await import('@/lib/realtime/authorize')
    const keys = [
      `notifications|user_id=eq.${ME}|*`,
      `notifications|user_id=eq.${OTHER}|*`,
      `tasks|assignee_id=eq.${OTHER}|*`,
      `task_assignees|user_id=eq.${OTHER}|*`,
      `tasks|id=eq.${TASK_A}|*`,
      `tasks|parent_task_id=eq.${TASK_B}|*`,
      `lifecycle_events|task_id=eq.${TASK_B}|INSERT`,
      'workflow_logs||INSERT',
      'notifications||*',
      'garbage',
      `notifications|user_id=eq.${ME}|*`,
    ]
    const res = await authorizeSubscriptions({ userId: ME, permissions: new Set(['tasks.view']), db: fakeDb([TASK_A]) }, keys)
    expect(res.accepted.map((s) => s.key)).toEqual([`notifications|user_id=eq.${ME}|*`, `tasks|id=eq.${TASK_A}|*`])
    expect(Object.fromEntries(res.rejected.map((r) => [r.key, r.reason]))).toEqual({
      [`notifications|user_id=eq.${OTHER}|*`]: 'forbidden',
      [`tasks|assignee_id=eq.${OTHER}|*`]: 'forbidden',
      [`task_assignees|user_id=eq.${OTHER}|*`]: 'forbidden',
      [`tasks|parent_task_id=eq.${TASK_B}|*`]: 'not_found',
      [`lifecycle_events|task_id=eq.${TASK_B}|INSERT`]: 'not_found',
      'workflow_logs||INSERT': 'forbidden',
      'notifications||*': 'invalid',
      garbage: 'invalid',
    })
  })

  it('accepts log topics with settings.view and loads the audience from the RLS functions', async () => {
    const { authorizeSubscriptions, loadAudience } = await import('@/lib/realtime/authorize')
    const res = await authorizeSubscriptions({ userId: ME, permissions: new Set(['settings.view']), db: fakeDb([]) }, ['workflow_logs||INSERT', 'agent_runs||INSERT'])
    expect(res.accepted).toHaveLength(2)
    const aud = await loadAudience(fakeDb([]), ME)
    expect(aud).toEqual({ userId: ME, visible: new Set([A]), member: new Set([A]), current: A, agent: new Set([A]) })
  })
})

// ── Stream ──

type Msg = { event?: string; id?: string; data?: unknown }

function parseSse(text: string): Msg[] {
  return text.split('\n\n').filter((b) => b.trim() && !b.startsWith(':') && !b.startsWith('retry:')).map((block) => {
    const msg: Msg = {}
    for (const line of block.split('\n')) {
      const [field, ...rest] = line.split(': ')
      const value = rest.join(': ')
      if (field === 'event') msg.event = value
      else if (field === 'id') msg.id = value
      else if (field === 'data') msg.data = JSON.parse(value)
    }
    return msg
  })
}

class FakeHub {
  mode: 'listen' | 'poll' = 'listen'
  listeners = new Set<(m: import('@/lib/realtime/hub').HubMessage) => void>()
  replay: ChangeEvent[] | null = []
  mark: number | null = 500
  subscribe(fn: (m: import('@/lib/realtime/hub').HubMessage) => void) {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }
  replaySince() { return this.replay }
  watermark() { return this.mark }
  emit(event: ChangeEvent) { for (const l of this.listeners) l({ kind: 'change', event }) }
  resync() { for (const l of this.listeners) l({ kind: 'resync' }) }
}

async function collect(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let done = false
  const pump = (async () => {
    for (;;) {
      const r = await reader.read()
      if (r.done) { done = true; return }
      text += decoder.decode(r.value)
    }
  })()
  return { messages: () => parseSse(text), isDone: () => done, pump, cancel: () => reader.cancel() }
}

describe('SSE stream', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  async function open(overrides: Partial<import('@/lib/realtime/stream').RealtimeStreamOptions> = {}, keys = ['tasks||*', `notifications|user_id=eq.${ME}|*`]) {
    const { createRealtimeStream } = await import('@/lib/realtime/stream')
    const hub = new FakeHub()
    const onClose = vi.fn()
    const stream = createRealtimeStream({ hub, subscriptions: keys.map(sub), audience, maxMs: 60_000, heartbeatMs: 5_000, onClose, ...overrides, ...(overrides.hub ? {} : { hub }) })
    const reader = await collect(stream)
    await vi.advanceTimersByTimeAsync(0)
    return { hub: (overrides.hub as FakeHub | undefined) ?? hub, reader, onClose }
  }

  it('starts with ready, batches changes per subscription, ids only, never other tenants', async () => {
    const { hub, reader } = await open({ rejected: [{ key: 'x', reason: 'invalid' }] })
    expect(reader.messages()[0]).toEqual({ event: 'ready', data: { subscriptions: ['tasks||*', `notifications|user_id=eq.${ME}|*`], rejected: [{ key: 'x', reason: 'invalid' }], mode: 'listen' } })
    hub.emit(taskEvent([{ id: TASK_A, tenant: A }], 'INSERT', 1001))
    hub.emit(taskEvent([{ id: TASK_B, tenant: B }], 'UPDATE', 1002))
    hub.emit(taskEvent([{ id: 'a2', tenant: A }], 'UPDATE', 1003))
    hub.emit({ ts: 1004, table: 'notifications', op: 'INSERT', rows: [{ id: 'n-other', tenant_id: A, cols: { user_id: [OTHER] } }] })
    await vi.advanceTimersByTimeAsync(150)
    const changes = reader.messages().filter((m) => m.event === 'change')
    expect(changes).toEqual([{ event: 'change', id: '1003', data: { changes: [{ key: 'tasks||*', ops: ['INSERT', 'UPDATE'], ids: [TASK_A, 'a2'] }] } }])
    expect(JSON.stringify(reader.messages())).not.toMatch(new RegExp(`${TASK_B}|n-other`))
  })

  it('sends heartbeats carrying the watermark, then a planned reconnect at maxMs', async () => {
    const { reader, onClose, hub } = await open({ maxMs: 20_000 })
    await vi.advanceTimersByTimeAsync(6_000)
    expect(reader.messages().find((m) => m.event === 'ping')).toEqual({ event: 'ping', id: '500', data: {} })
    hub.mark = 900
    await vi.advanceTimersByTimeAsync(15_000)
    const last = reader.messages().at(-1)
    expect(last).toEqual({ event: 'reconnect', id: '900', data: {} })
    await reader.pump
    expect(reader.isDone()).toBe(true)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(hub.listeners.size).toBe(0)
  })

  it('replays from Last-Event-ID when the hub covers the gap, else resyncs', async () => {
    const hub = new FakeHub()
    hub.replay = [taskEvent([{ id: TASK_A, tenant: A }], 'UPDATE', 990), taskEvent([{ id: TASK_B, tenant: B }], 'UPDATE', 995)]
    const { reader } = await open({ hub: hub as never, lastEventId: 980 })
    await vi.advanceTimersByTimeAsync(150)
    expect(reader.messages().filter((m) => m.event === 'change')).toEqual([{ event: 'change', id: '990', data: { changes: [{ key: 'tasks||*', ops: ['UPDATE'], ids: [TASK_A] }] } }])

    const gap = new FakeHub()
    gap.replay = null
    const second = await open({ hub: gap as never, lastEventId: 10 })
    expect(second.reader.messages().map((m) => m.event)).toEqual(['ready', 'resync'])
  })

  it('forwards hub resyncs', async () => {
    const { hub, reader } = await open()
    hub.resync()
    await vi.advanceTimersByTimeAsync(0)
    expect(reader.messages().at(-1)?.event).toBe('resync')
  })

  it('backpressure: drops changes while the client is not reading, then sends one resync', async () => {
    const { createRealtimeStream } = await import('@/lib/realtime/stream')
    const hub = new FakeHub()
    const stream = createRealtimeStream({ hub, subscriptions: [sub('tasks||*')], audience, maxMs: 60_000, maxQueued: 2 })
    // Nobody reads: the queue fills with retry + ready.
    for (let i = 0; i < 5; i++) {
      hub.emit(taskEvent([{ id: `t${i}`, tenant: A }], 'UPDATE', 2000 + i))
      await vi.advanceTimersByTimeAsync(150)
    }
    const reader = await collect(stream)
    await vi.advanceTimersByTimeAsync(1_100)
    const events = reader.messages().map((m) => m.event)
    expect(events).toEqual(['ready', 'resync'])
    hub.emit(taskEvent([{ id: 'after', tenant: A }], 'UPDATE', 3000))
    await vi.advanceTimersByTimeAsync(150)
    expect(reader.messages().at(-1)).toMatchObject({ event: 'change', data: { changes: [{ ids: ['after'] }] } })
    await reader.cancel()
  })

  it('closes with fatal when the session can no longer be read', async () => {
    const refreshAudience = vi.fn(async () => { throw new Error('JWT expired') })
    const { reader, onClose } = await open({ refreshAudience, audienceRefreshMs: 1_000 })
    await vi.advanceTimersByTimeAsync(1_100)
    expect(reader.messages().at(-1)).toEqual({ event: 'fatal', data: { reason: 'session' } })
    await reader.pump
    expect(onClose).toHaveBeenCalled()
  })

  it('applies a refreshed audience (tenant switch)', async () => {
    const refreshAudience = vi.fn(async () => ({ ...audience, visible: new Set([B]) }))
    const { hub, reader } = await open({ refreshAudience, audienceRefreshMs: 1_000 })
    await vi.advanceTimersByTimeAsync(1_100)
    hub.emit(taskEvent([{ id: TASK_A, tenant: A }]))
    hub.emit(taskEvent([{ id: TASK_B, tenant: B }]))
    await vi.advanceTimersByTimeAsync(150)
    expect(reader.messages().filter((m) => m.event === 'change').map((m) => (m.data as any).changes[0].ids)).toEqual([[TASK_B]]) // eslint-disable-line @typescript-eslint/no-explicit-any
  })

  it('stops (and unsubscribes) when the request is aborted', async () => {
    const abort = new AbortController()
    const { hub, onClose } = await open({ signal: abort.signal })
    expect(hub.listeners.size).toBe(1)
    abort.abort()
    expect(hub.listeners.size).toBe(0)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

// ── Hub ──

describe('RealtimeHub', () => {
  it('replays with an overlap, and refuses gaps it cannot vouch for', async () => {
    const { RealtimeHub, REPLAY_OVERLAP_MS } = await import('@/lib/realtime/hub')
    let now = 100_000
    const hub = new RealtimeHub({ connectionString: null, pollReader: async () => [], now: () => now, bufferSize: 3, pollMs: 60_000 })
    const unsub = hub.subscribe(() => {})
    await vi.waitFor(() => expect(hub.watermark()).not.toBeNull())
    expect(hub.mode).toBe('poll')
    expect(hub.replaySince(50_000)).toBeNull() // before the hub started
    for (const ts of [101_000, 102_000, 103_000]) hub.ingest(taskEvent([{ id: `t${ts}`, tenant: A }], 'UPDATE', ts))
    expect(hub.replaySince(102_000 + REPLAY_OVERLAP_MS)?.map((e) => e.ts)).toEqual([102_000, 103_000])
    expect(hub.replaySince(101_000 + REPLAY_OVERLAP_MS)?.length).toBe(3)
    expect(hub.replaySince(110_000)).toEqual([])
    hub.ingest(taskEvent([{ id: 'x', tenant: A }], 'UPDATE', 104_000)) // drops 101_000
    expect(hub.replaySince(101_000 + REPLAY_OVERLAP_MS)).toBeNull()
    expect(hub.replaySince(102_000 + REPLAY_OVERLAP_MS)?.length).toBe(3)
    now = 200_000
    unsub()
    await hub.stop()
  })

  it('poll mode: reads changed rows by cursor, de-duplicates, and maps routing columns', async () => {
    const { RealtimeHub } = await import('@/lib/realtime/hub')
    const reads: Array<{ table: string; since: string }> = []
    const stamp = new Date(Date.now() + 1_000).toISOString()
    const rowsFor: Record<string, Array<Record<string, unknown>>> = {
      tasks: [{ id: TASK_A, tenant_id: A, updated_at: stamp, created_at: '2020-01-01T00:00:00Z', assignee_id: ME, assigner_id: null, parent_task_id: null }],
      notifications: [{ id: 'n1', tenant_id: A, created_at: stamp, user_id: ME }],
    }
    const hub = new RealtimeHub({
      connectionString: null,
      pollMs: 20,
      pollReader: async (table, since) => { reads.push({ table, since }); return rowsFor[table] ?? [] },
    })
    const events: ChangeEvent[] = []
    const unsub = hub.subscribe((m) => { if (m.kind === 'change') events.push(m.event) })
    await vi.waitFor(() => expect(reads.length).toBeGreaterThan(16)) // two full rounds
    unsub()
    await hub.stop()
    expect(events).toEqual([
      { ts: Date.parse(stamp), table: 'tasks', op: 'UPDATE', rows: [{ id: TASK_A, tenant_id: A, cols: { assignee_id: [ME], assigner_id: [], parent_task_id: [] } }] },
      { ts: Date.parse(stamp), table: 'notifications', op: 'INSERT', rows: [{ id: 'n1', tenant_id: A, cols: { user_id: [ME] } }] },
    ])
  })

  it('listen mode falls back to polling when the NOTIFY migration is missing', async () => {
    vi.resetModules()
    const queries: string[] = []
    vi.doMock('pg', () => ({
      Client: class {
        on() { return this }
        async connect() {}
        async query(sql: string) {
          queries.push(sql)
          if (sql.includes('mark_listening')) throw new Error('function app_realtime.mark_listening(integer) does not exist')
          return { rows: [] }
        }
        async end() {}
      },
    }))
    const { RealtimeHub } = await import('@/lib/realtime/hub')
    const hub = new RealtimeHub({ connectionString: 'postgres://x', pollReader: async () => [], pollMs: 60_000, log: () => {} })
    const unsub = hub.subscribe(() => {})
    await vi.waitFor(() => expect(hub.mode).toBe('poll'))
    expect(queries[0]).toBe('LISTEN usertasks_realtime')
    expect(hub.watermark()).not.toBeNull()
    unsub()
    await hub.stop()
    vi.doUnmock('pg')
    vi.resetModules()
  })

  it('resolves the LISTEN connection string from REALTIME_DATABASE_URL, DATABASE_URL, SUPABASE_DB_URL', async () => {
    const { resolveListenUrl } = await import('@/lib/realtime/hub')
    const saved = { r: process.env.REALTIME_DATABASE_URL, d: process.env.DATABASE_URL, s: process.env.SUPABASE_DB_URL }
    try {
      delete process.env.REALTIME_DATABASE_URL
      delete process.env.DATABASE_URL
      delete process.env.SUPABASE_DB_URL
      expect(resolveListenUrl()).toBeNull()
      process.env.SUPABASE_DB_URL = 'postgres://supa'
      expect(resolveListenUrl()).toBe('postgres://supa')
      process.env.DATABASE_URL = 'postgres://db'
      expect(resolveListenUrl()).toBe('postgres://db')
      process.env.REALTIME_DATABASE_URL = 'postgres://rt'
      expect(resolveListenUrl()).toBe('postgres://rt')
    } finally {
      for (const [k, v] of [['REALTIME_DATABASE_URL', saved.r], ['DATABASE_URL', saved.d], ['SUPABASE_DB_URL', saved.s]] as const) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
    }
  })
})

// ── Route ──

describe('GET /api/internal/realtime', () => {
  afterEach(() => {
    vi.doUnmock('@/lib/services/context')
    vi.resetModules()
  })

  async function loadRoute(session: { actorId: string; permissions?: Set<string> } | 'anon') {
    vi.resetModules()
    vi.doMock('@/lib/services/context', async (orig) => {
      const real = await orig<typeof import('@/lib/services/context')>()
      return {
        ...real,
        fromSession: async () => {
          if (session === 'anon') throw new real.ServiceError('unauthorized', 'Not authenticated')
          const db = fakeDb([TASK_A])
          return { db, supabase: db, tenantId: A, actorId: session.actorId, permissions: session.permissions ?? new Set(), authKind: 'session', source: 'ui' }
        },
      }
    })
    const hubMod = await import('@/lib/realtime/hub')
    const hub = new FakeHub()
    hubMod.setRealtimeHubForTests(hub as never)
    const route = await import('@/app/api/internal/realtime/route')
    return { route, hub }
  }

  function req(query: string, headers: Record<string, string> = {}) {
    const { NextRequest } = require('next/server') as typeof import('next/server') // eslint-disable-line @typescript-eslint/no-require-imports
    const abort = new AbortController()
    return { request: new NextRequest(`http://localhost/api/internal/realtime?${query}`, { headers, signal: abort.signal }), abort }
  }

  it('401 without a session; 400 on no/too many subscriptions or a bad Last-Event-ID', async () => {
    const { route } = await loadRoute('anon')
    expect((await route.GET(req(`s=${encodeURIComponent('tasks||*')}`).request)).status).toBe(401)
    const { route: r2 } = await loadRoute({ actorId: ME })
    expect((await r2.GET(req('').request)).status).toBe(400)
    expect((await r2.GET(req(Array.from({ length: 33 }, () => 's=tasks%7C%7C*').join('&')).request)).status).toBe(400)
    expect((await r2.GET(req('s=tasks%7C%7C*', { 'last-event-id': 'abc' }).request)).status).toBe(400)
  })

  it('streams only the caller\'s rows: tenant A tasks and their own notifications', async () => {
    const { route, hub } = await loadRoute({ actorId: ME })
    const keys = ['tasks||*', `notifications|user_id=eq.${ME}|*`, `notifications|user_id=eq.${OTHER}|*`]
    const { request, abort } = req(keys.map((k) => `s=${encodeURIComponent(k)}`).join('&'))
    const res = await route.GET(request)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const reader = await collect(res.body!)
    await vi.waitFor(() => expect(reader.messages().length).toBeGreaterThan(0))
    expect(reader.messages()[0]).toMatchObject({ event: 'ready', data: { rejected: [{ key: `notifications|user_id=eq.${OTHER}|*`, reason: 'forbidden' }] } })
    hub.emit(taskEvent([{ id: TASK_A, tenant: A }, { id: TASK_B, tenant: B }]))
    hub.emit({ ts: 2, table: 'notifications', op: 'INSERT', rows: [{ id: 'mine', tenant_id: A, cols: { user_id: [ME] } }, { id: 'theirs', tenant_id: A, cols: { user_id: [OTHER] } }] })
    await vi.waitFor(() => expect(reader.messages().filter((m) => m.event === 'change').length).toBeGreaterThan(0))
    const text = JSON.stringify(reader.messages())
    expect(text).toContain(TASK_A)
    expect(text).toContain('mine')
    expect(text).not.toContain(TASK_B)
    expect(text).not.toContain('theirs')
    abort.abort()
    await reader.pump
    expect(hub.listeners.size).toBe(0)
  })

  it('caps concurrent streams per user', async () => {
    const { route } = await loadRoute({ actorId: OTHER })
    const open: AbortController[] = []
    for (let i = 0; i < 12; i++) {
      const { request, abort } = req('s=tasks%7C%7C*')
      expect((await route.GET(request)).status).toBe(200)
      open.push(abort)
    }
    expect((await route.GET(req('s=tasks%7C%7C*').request)).status).toBe(429)
    open[0].abort()
    expect((await route.GET(req('s=tasks%7C%7C*').request)).status).toBe(200)
    for (const a of open) a.abort()
  })
})
