/**
 * RealtimeProvider contract (providers phase 5): both browser
 * implementations — Supabase Realtime (postgres_changes) and SSE (one
 * EventSource per tab to /api/internal/realtime) — subscribe to a topic +
 * filter, deliver { topic, op, ids } changes to the right handlers, report
 * status, and stop delivering after unsubscribe. Plus topic/key validation
 * and how the browser learns which provider to use.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RealtimeChange, RealtimeStatus } from '@/lib/realtime/topics'

const TASK = '11111111-1111-4111-8111-111111111111'
const USER = '22222222-2222-4222-8222-222222222222'

// ── Supabase fake (getBrowserDb) ──

interface FakeChannel {
  name: string
  bindings: Array<{ type: string; opts: Record<string, unknown>; cb: (payload: unknown) => void }>
  statusCb?: (status: string) => void
  on(type: string, opts: Record<string, unknown>, cb: (payload: unknown) => void): FakeChannel
  subscribe(cb?: (status: string) => void): FakeChannel
}
const supa = {
  channels: [] as FakeChannel[],
  removed: [] as FakeChannel[],
  setAuth: vi.fn(async () => undefined),
}
vi.mock('@/lib/providers/db/browser', () => ({
  getBrowserDb: () => ({
    channel(name: string) {
      const ch: FakeChannel = {
        name,
        bindings: [],
        on(type, opts, cb) { ch.bindings.push({ type, opts, cb }); return ch },
        subscribe(cb) { ch.statusCb = cb; return ch },
      }
      supa.channels.push(ch)
      return ch
    },
    removeChannel: async (ch: FakeChannel) => { supa.removed.push(ch) },
    realtime: { setAuth: supa.setAuth },
  }),
}))

// ── EventSource fake ──

class FakeEventSource {
  static instances: FakeEventSource[] = []
  readyState = 0
  onerror: ((ev: Event) => unknown) | null = null
  closed = false
  listeners = new Map<string, Array<(ev: MessageEvent) => void>>()
  constructor(public url: string, public init?: EventSourceInit) { FakeEventSource.instances.push(this) }
  addEventListener(type: string, fn: (ev: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn])
  }
  close() { this.closed = true; this.readyState = 2 }
  emit(type: string, data: unknown, lastEventId = '') {
    this.readyState = 1
    for (const fn of this.listeners.get(type) ?? []) fn({ data: JSON.stringify(data), lastEventId } as MessageEvent)
  }
  fail(httpError: boolean) {
    this.readyState = httpError ? 2 : 0
    this.onerror?.(new Event('error'))
  }
  keys() {
    return new URL(this.url, 'http://x').searchParams.getAll('s')
  }
}
const lastSource = () => FakeEventSource.instances[FakeEventSource.instances.length - 1]

beforeEach(() => {
  supa.channels = []
  supa.removed = []
  FakeEventSource.instances = []
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('topics and subscription keys', () => {
  it('validates topics, filter columns, uuids and per-user topics', async () => {
    const { validateSubscription, subscriptionKey, parseSubscriptionKey } = await import('@/lib/realtime/topics')
    expect(validateSubscription('tasks', {})).toBeNull()
    expect(validateSubscription('tasks', { column: 'assignee_id', value: USER })).toBeNull()
    expect(validateSubscription('nope', {})).toMatch(/unknown topic/)
    expect(validateSubscription('tasks', { column: 'title', value: USER })).toMatch(/cannot be filtered/)
    expect(validateSubscription('tasks', { column: 'id', value: "x' or 1=1" })).toMatch(/uuid/)
    expect(validateSubscription('notifications', {})).toMatch(/filtered by user/)
    expect(validateSubscription('tasks', { event: 'TRUNCATE' as never })).toMatch(/invalid event/)

    const key = subscriptionKey('lifecycle_events', { column: 'task_id', value: TASK, event: 'INSERT' })
    expect(key).toBe(`lifecycle_events|task_id=eq.${TASK}|INSERT`)
    expect(parseSubscriptionKey(key)).toEqual({ key, topic: 'lifecycle_events', filter: { column: 'task_id', value: TASK, event: 'INSERT' } })
    expect(parseSubscriptionKey('tasks||*')).toMatchObject({ topic: 'tasks', filter: { event: '*' } })
    for (const bad of ['tasks', 'tasks|x|*|y', 'notifications||*', `tasks|title=eq.${TASK}|*`, 'x'.repeat(300)]) {
      expect(parseSubscriptionKey(bad)).toBeNull()
    }
  })
})

describe('provider selection', () => {
  const saved = process.env.REALTIME_PROVIDER
  afterEach(() => {
    if (saved === undefined) delete process.env.REALTIME_PROVIDER
    else process.env.REALTIME_PROVIDER = saved
    delete (globalThis as { window?: unknown }).window
  })

  it('resolves both providers; sse is on-prem capable', async () => {
    const { resolveRealtimeProvider } = await import('@/lib/providers/realtime')
    expect(resolveRealtimeProvider()).toMatchObject({ id: 'supabase', onPrem: false })
    expect(resolveRealtimeProvider('sse')).toMatchObject({ id: 'sse', onPrem: true })
  })

  it('the public config names the provider only when it is not the default', async () => {
    const { buildPublicConfig } = await import('@/lib/config/public')
    delete process.env.REALTIME_PROVIDER
    expect(buildPublicConfig()).not.toHaveProperty('realtimeProvider')
    process.env.REALTIME_PROVIDER = 'sse'
    expect(buildPublicConfig().realtimeProvider).toBe('sse')
  })

  it('the browser uses the provider from the injected runtime config', async () => {
    const { getRealtimeProvider } = await import('@/lib/providers/realtime')
    ;(globalThis as { window?: unknown }).window = { __USERTASKS_CONFIG__: { supabaseUrl: 'https://x', supabaseAnonKey: 'k', appUrl: '', ssoMicrosoft: false, realtimeProvider: 'sse' } }
    expect(getRealtimeProvider().id).toBe('sse')
    ;(globalThis as { window?: unknown }).window = { __USERTASKS_CONFIG__: { supabaseUrl: 'https://x', supabaseAnonKey: 'k', appUrl: '', ssoMicrosoft: false } }
    expect(getRealtimeProvider().id).toBe('supabase')
  })

  it('the SSE provider and the provider index never load supabase-js eagerly', async () => {
    const { readFileSync } = await import('node:fs')
    for (const file of ['lib/providers/realtime/index.ts', 'lib/providers/realtime/sse.ts', 'hooks/use-realtime.ts', 'lib/realtime/topics.ts']) {
      const src = readFileSync(file, 'utf8')
      expect(src, file).not.toMatch(/from\s+['"](?:@supabase\/|@\/lib\/supabase\/client|@\/lib\/providers\/db\/browser|\.\/supabase)['"]/)
    }
  })
})

/**
 * One scenario, both implementations: subscribe to a user's tasks, receive a
 * change with the row id, then unsubscribe and receive nothing more.
 */
type Harness = {
  name: string
  subscribe: (onChange: (c: RealtimeChange) => void, onStatus: (s: RealtimeStatus) => void) => Promise<() => void>
  /** Make the backend report a change to task TASK. */
  emitChange: () => void
  goLive: () => void
}

const harnesses: Harness[] = [
  {
    name: 'supabase',
    async subscribe(onChange, onStatus) {
      const { supabaseRealtimeProvider } = await import('@/lib/providers/realtime')
      const unsub = supabaseRealtimeProvider.subscribe('tasks', { column: 'assignee_id', value: USER }, onChange, onStatus)
      await vi.waitFor(() => expect(supa.channels.length).toBe(1))
      return unsub
    },
    emitChange() {
      // Supabase stops calling a removed channel's handlers.
      if (supa.removed.includes(supa.channels[0])) return
      supa.channels[0].bindings[0].cb({ eventType: 'UPDATE', new: { id: TASK, title: 't' }, old: {} })
    },
    goLive() { supa.channels[0].statusCb?.('SUBSCRIBED') },
  },
  {
    name: 'sse',
    async subscribe(onChange, onStatus) {
      const { SseRealtimeClient } = await import('@/lib/providers/realtime/sse')
      const client = new SseRealtimeClient({ EventSource: FakeEventSource as never })
      const unsub = client.subscribe('tasks', { column: 'assignee_id', value: USER }, onChange, onStatus)
      await vi.advanceTimersByTimeAsync(60)
      return unsub
    },
    emitChange() {
      lastSource().emit('change', { changes: [{ key: `tasks|assignee_id=eq.${USER}|*`, ops: ['UPDATE'], ids: [TASK] }] }, '1700000000000')
    },
    goLive() { lastSource().emit('ready', { subscriptions: [], rejected: [] }) },
  },
]

describe.each(harnesses)('RealtimeProvider contract: $name', (h) => {
  it('delivers changes with ids and status, and nothing after unsubscribe', async () => {
    const changes: RealtimeChange[] = []
    const statuses: RealtimeStatus[] = []
    const unsub = await h.subscribe((c) => changes.push(c), (s) => statuses.push(s))
    expect(statuses[0]).toBe('connecting')
    h.goLive()
    expect(statuses.at(-1)).toBe('live')
    h.emitChange()
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ topic: 'tasks', op: 'UPDATE', ids: [TASK] })
    unsub()
    await vi.advanceTimersByTimeAsync(60)
    try { h.emitChange() } catch { /* the backend may be gone */ }
    expect(changes).toHaveLength(1)
  })
})

describe('supabase implementation', () => {
  it('maps topic + filter onto postgres_changes and fetches the server-issued token before joining', async () => {
    const { supabaseRealtimeProvider } = await import('@/lib/providers/realtime')
    const unsubA = supabaseRealtimeProvider.subscribe('lifecycle_events', { column: 'task_id', value: TASK, event: 'INSERT' }, () => {})
    const unsubB = supabaseRealtimeProvider.subscribe('workflow_logs', { event: 'INSERT' }, () => {})
    await vi.waitFor(() => expect(supa.channels.length).toBe(2))
    expect(supa.channels[0].bindings[0]).toMatchObject({
      type: 'postgres_changes',
      opts: { event: 'INSERT', schema: 'public', table: 'lifecycle_events', filter: `task_id=eq.${TASK}` },
    })
    expect(supa.channels[1].bindings[0].opts).toEqual({ event: 'INSERT', schema: 'public', table: 'workflow_logs' })
    // No argument: supabase-js asks the accessToken callback (lib/supabase/client → getRealtimeTokenAction).
    expect(supa.setAuth).toHaveBeenCalledWith()
    const changes: RealtimeChange[] = []
    const unsubC = supabaseRealtimeProvider.subscribe('workflow_logs', {}, (c) => changes.push(c))
    await vi.waitFor(() => expect(supa.channels.length).toBe(3))
    supa.channels[2].bindings[0].cb({ eventType: 'INSERT', new: { id: 'r1', message: 'hi' }, old: {} })
    expect(changes[0]).toEqual({ topic: 'workflow_logs', op: 'INSERT', ids: ['r1'], record: { id: 'r1', message: 'hi' } })
    supa.channels[2].bindings[0].cb({ eventType: 'DELETE', new: {}, old: { id: 'r1' } })
    expect(changes[1]).toEqual({ topic: 'workflow_logs', op: 'DELETE', ids: ['r1'] })
    for (const u of [unsubA, unsubB, unsubC]) u()
    expect(supa.removed).toHaveLength(3)
  })

  it('reports channel failures as error/closed', async () => {
    const { supabaseRealtimeProvider } = await import('@/lib/providers/realtime')
    const statuses: RealtimeStatus[] = []
    supabaseRealtimeProvider.subscribe('tasks', {}, () => {}, (s) => statuses.push(s))
    await vi.waitFor(() => expect(supa.channels.length).toBe(1))
    supa.channels[0].statusCb?.('TIMED_OUT')
    supa.channels[0].statusCb?.('CLOSED')
    expect(statuses).toEqual(['connecting', 'error', 'closed'])
  })
})

describe('SSE implementation', () => {
  async function client() {
    const { SseRealtimeClient } = await import('@/lib/providers/realtime/sse')
    return new SseRealtimeClient({ EventSource: FakeEventSource as never, minBackoffMs: 1000, maxBackoffMs: 4000 })
  }

  it('multiplexes every subscription of the tab onto one EventSource', async () => {
    const c = await client()
    const a: RealtimeChange[] = []
    const b: RealtimeChange[] = []
    c.subscribe('tasks', { column: 'assignee_id', value: USER }, (x) => a.push(x))
    c.subscribe('notifications', { column: 'user_id', value: USER }, (x) => b.push(x))
    c.subscribe('notifications', { column: 'user_id', value: USER }, (x) => b.push(x))
    await vi.advanceTimersByTimeAsync(60)
    expect(FakeEventSource.instances).toHaveLength(1)
    const src = lastSource()
    expect(src.url.startsWith('/api/internal/realtime?')).toBe(true)
    expect(src.init).toEqual({ withCredentials: true })
    expect(src.keys().sort()).toEqual([`notifications|user_id=eq.${USER}|*`, `tasks|assignee_id=eq.${USER}|*`])
    src.emit('change', { changes: [{ key: `notifications|user_id=eq.${USER}|*`, ops: ['INSERT', 'UPDATE'], ids: ['n1'] }] }, '5')
    expect(a).toEqual([])
    // Two handlers on the same key, two ops each.
    expect(b.map((x) => `${x.topic}:${x.op}:${x.ids}`).sort()).toEqual([
      'notifications:INSERT:n1', 'notifications:INSERT:n1', 'notifications:UPDATE:n1', 'notifications:UPDATE:n1',
    ])
  })

  it('reconnects with the new key set and resumes after the last event id', async () => {
    const c = await client()
    const unsubA = c.subscribe('tasks', {}, () => {})
    await vi.advanceTimersByTimeAsync(60)
    lastSource().emit('ping', {}, '1700000000123')
    c.subscribe('notifications', { column: 'user_id', value: USER }, () => {})
    await vi.advanceTimersByTimeAsync(60)
    expect(FakeEventSource.instances).toHaveLength(2)
    expect(FakeEventSource.instances[0].closed).toBe(true)
    const url = new URL(lastSource().url, 'http://x')
    expect(url.searchParams.getAll('s')).toHaveLength(2)
    expect(url.searchParams.get('after')).toBe('1700000000123')
    unsubA()
    await vi.advanceTimersByTimeAsync(60)
    expect(lastSource().keys()).toEqual([`notifications|user_id=eq.${USER}|*`])
  })

  it('resync reaches every handler; rejected subscriptions report error', async () => {
    const c = await client()
    const got: RealtimeChange[] = []
    const st: RealtimeStatus[] = []
    c.subscribe('tasks', {}, (x) => got.push(x), (s) => st.push(s))
    c.subscribe('tasks', { column: 'id', value: TASK }, (x) => got.push(x), (s) => st.push(`id:${s}` as RealtimeStatus))
    await vi.advanceTimersByTimeAsync(60)
    lastSource().emit('ready', { rejected: [{ key: `tasks|id=eq.${TASK}|*`, reason: 'not_found' }] })
    expect(st).toContain('live')
    expect(st).toContain('id:error')
    lastSource().emit('resync', {})
    expect(got.map((x) => x.op)).toEqual(['RESYNC', 'RESYNC'])
    expect(got.every((x) => x.ids === null && x.topic === 'tasks')).toBe(true)
  })

  it('retries with backoff after an HTTP error or a fatal event; network errors are left to EventSource', async () => {
    const c = await client()
    const st: RealtimeStatus[] = []
    c.subscribe('tasks', {}, () => {}, (s) => st.push(s))
    await vi.advanceTimersByTimeAsync(60)
    lastSource().fail(false) // network blip: EventSource reconnects itself
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(st.at(-1)).toBe('connecting')
    lastSource().fail(true) // HTTP 401/429: closed for good
    expect(st.at(-1)).toBe('error')
    await vi.advanceTimersByTimeAsync(999)
    expect(FakeEventSource.instances).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(2)
    expect(FakeEventSource.instances).toHaveLength(2)
    lastSource().emit('fatal', { reason: 'session' })
    expect(lastSource().closed).toBe(true)
    await vi.advanceTimersByTimeAsync(2001)
    expect(FakeEventSource.instances).toHaveLength(3)
    lastSource().emit('ready', {})
    expect(st.at(-1)).toBe('live')
  })

  it('closes the connection when the last subscription goes', async () => {
    const c = await client()
    const unsub = c.subscribe('tasks', {}, () => {})
    await vi.advanceTimersByTimeAsync(60)
    unsub()
    await vi.advanceTimersByTimeAsync(60)
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(FakeEventSource.instances[0].closed).toBe(true)
  })
})
