/**
 * Realtime hooks (providers phase 5): every hook subscribes through
 * useRealtime with the right topic + filter, and a change invalidates the
 * right React Query keys (debounced where bursts are expected). The live log
 * tail turns provider changes into entries — from the row (Supabase) or by
 * reading the source's newest rows (SSE, ids only).
 *
 * The suite runs in node without a DOM, so React's hooks are replaced by a
 * minimal single-component runtime (state, refs, callbacks, effects with
 * dependency tracking and cleanups) — enough to drive the real hook code.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RealtimeChange, RealtimeFilter, RealtimeStatus, RealtimeTopic } from '@/lib/realtime/topics'

/* eslint-disable @typescript-eslint/no-explicit-any -- hook runtime slots hold anything */

// ── Minimal hook runtime ──

const rt = {
  slots: [] as any[],
  i: 0,
  pending: [] as Array<() => void>,
  render: null as null | (() => unknown),
  result: undefined as unknown,
  scheduled: false,
}

function depsChanged(a: unknown[] | undefined, b: unknown[] | undefined) {
  if (!a || !b) return true
  return a.length !== b.length || a.some((x, i) => !Object.is(x, b[i]))
}

function renderOnce() {
  rt.i = 0
  rt.result = rt.render!()
  const effects = rt.pending
  rt.pending = []
  for (const run of effects) run()
}

function scheduleRender() {
  if (rt.scheduled || !rt.render) return
  rt.scheduled = true
  queueMicrotask(() => {
    rt.scheduled = false
    if (rt.render) renderOnce()
  })
}

vi.mock('react', () => ({
  useRef(init: unknown) {
    const i = rt.i++
    if (!(i in rt.slots)) rt.slots[i] = { current: init }
    return rt.slots[i]
  },
  useState(init: unknown) {
    const i = rt.i++
    if (!(i in rt.slots)) rt.slots[i] = { v: typeof init === 'function' ? (init as () => unknown)() : init }
    const slot = rt.slots[i]
    return [slot.v, (next: unknown) => {
      const v = typeof next === 'function' ? (next as (p: unknown) => unknown)(slot.v) : next
      if (!Object.is(v, slot.v)) {
        slot.v = v
        scheduleRender()
      }
    }]
  },
  useCallback(fn: unknown, deps: unknown[]) {
    const i = rt.i++
    const prev = rt.slots[i]
    if (!prev || depsChanged(prev.deps, deps)) rt.slots[i] = { fn, deps }
    return rt.slots[i].fn
  },
  useEffect(fn: () => void | (() => void), deps?: unknown[]) {
    const i = rt.i++
    const prev = rt.slots[i]
    if (prev && deps && !depsChanged(prev.deps, deps)) return
    rt.slots[i] = { deps, cleanup: prev?.cleanup }
    rt.pending.push(() => {
      rt.slots[i].cleanup?.()
      const cleanup = fn()
      rt.slots[i].cleanup = typeof cleanup === 'function' ? cleanup : undefined
    })
  },
}))

function mount<T>(hook: () => T) {
  rt.slots = []
  rt.render = hook
  renderOnce()
  return {
    get current() { return rt.result as T },
    rerender(next: () => T) { rt.render = next; renderOnce() },
    unmount() {
      rt.render = null
      for (const slot of rt.slots) slot?.cleanup?.()
    },
  }
}

// ── Fakes ──

interface Sub { topic: RealtimeTopic; filter: RealtimeFilter; onChange: (c: RealtimeChange) => void; onStatus?: (s: RealtimeStatus) => void; active: boolean }
const subs: Sub[] = []
vi.mock('@/lib/providers/realtime', () => ({
  getRealtimeProvider: () => ({
    id: 'sse',
    onPrem: true,
    subscribe(topic: RealtimeTopic, filter: RealtimeFilter, onChange: Sub['onChange'], onStatus?: Sub['onStatus']) {
      const s: Sub = { topic, filter, onChange, onStatus, active: true }
      subs.push(s)
      onStatus?.('connecting')
      return () => { s.active = false }
    },
  }),
}))

const USER = '11111111-1111-4111-8111-111111111111'
const TENANT = '22222222-2222-4222-8222-222222222222'
const TASK = '33333333-3333-4333-8333-333333333333'
let currentTenant: string | null = TENANT
vi.mock('@/lib/get-user-id', () => ({
  getUserId: async () => USER,
  getCurrentTenantId: async () => currentTenant,
}))

const invalidateQueries = vi.fn()
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined }),
  useQueryClient: () => ({ invalidateQueries }),
}))

const serverQuery = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => [])
vi.mock('@/lib/server-read', () => ({
  serverQuery: (...args: unknown[]) => serverQuery(...args),
  serverRead: async () => ({ data: [] }),
}))
vi.mock('@/app/actions/notifications', () => ({ listMyNotifications: async () => ({ ok: true, data: [] }) }))

const active = () => subs.filter((s) => s.active)
const describeSubs = () => active().map((s) => `${s.topic}:${s.filter.column ?? '*'}=${s.filter.value ?? ''}:${s.filter.event ?? '*'}`)
const change = (s: Sub, op: RealtimeChange['op'] = 'UPDATE', extra: Partial<RealtimeChange> = {}) => s.onChange({ topic: s.topic, op, ids: [TASK], ...extra })
const flush = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  subs.length = 0
  invalidateQueries.mockClear()
  serverQuery.mockClear()
  currentTenant = TENANT
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('task and notification hooks', () => {
  it('useTaskQueue: the user\'s tasks and assignments; bursts invalidate once', async () => {
    const { useTaskQueue } = await import('@/hooks/use-task-queue')
    const h = mount(() => useTaskQueue())
    expect(active()).toEqual([]) // user id not known yet: no subscription
    await flush()
    expect(describeSubs()).toEqual([`tasks:assignee_id=${USER}:*`, `task_assignees:user_id=${USER}:*`])
    change(active()[0])
    change(active()[1], 'INSERT')
    change(active()[0])
    expect(invalidateQueries).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(300)
    expect(invalidateQueries).toHaveBeenCalledTimes(1)
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['task-queue'] })
    h.unmount()
    expect(active()).toEqual([])
  })

  it('useTasks: scoped to the current workspace, unfiltered in the unified view', async () => {
    const { useTasks } = await import('@/hooks/use-tasks')
    const h = mount(() => useTasks({}))
    await flush()
    expect(describeSubs()).toEqual([`tasks:tenant_id=${TENANT}:*`])
    change(active()[0], 'RESYNC', { ids: null })
    await vi.advanceTimersByTimeAsync(300)
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['tasks'] })
    h.unmount()

    currentTenant = null
    subs.length = 0
    const h2 = mount(() => useTasks({}))
    await flush()
    expect(describeSubs()).toEqual(['tasks:*=:*'])
    h2.unmount()
  })

  it('useAssignedTasks: tasks the user assigned', async () => {
    const { useAssignedTasks } = await import('@/hooks/use-assigned-tasks')
    const h = mount(() => useAssignedTasks())
    await flush()
    expect(describeSubs()).toEqual([`tasks:assigner_id=${USER}:*`])
    change(active()[0])
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['assigned-tasks'] })
    h.unmount()
  })

  it('useNotifications: only the user\'s own notifications', async () => {
    const { useNotifications } = await import('@/hooks/use-notifications')
    const h = mount(() => useNotifications())
    await flush()
    expect(describeSubs()).toEqual([`notifications:user_id=${USER}:*`])
    change(active()[0], 'INSERT')
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['notifications'] })
    expect(h.current.unreadCount).toBe(0)
    h.unmount()
  })

  it('useTaskRealtime: the task, its subtasks and its timeline; follows the task id', async () => {
    const { useTaskRealtime } = await import('@/hooks/use-task-realtime')
    const h = mount(() => useTaskRealtime(TASK))
    expect(describeSubs()).toEqual([`tasks:id=${TASK}:*`, `tasks:parent_task_id=${TASK}:*`, `lifecycle_events:task_id=${TASK}:INSERT`])
    change(active()[1])
    expect(invalidateQueries).toHaveBeenLastCalledWith({ queryKey: ['task-tree', TASK] })
    change(active()[2], 'INSERT')
    expect(invalidateQueries).toHaveBeenLastCalledWith({ queryKey: ['timeline', TASK] })

    const OTHER = '44444444-4444-4444-8444-444444444444'
    h.rerender(() => useTaskRealtime(OTHER))
    expect(describeSubs()).toEqual([`tasks:id=${OTHER}:*`, `tasks:parent_task_id=${OTHER}:*`, `lifecycle_events:task_id=${OTHER}:INSERT`])
    h.unmount()
    expect(active()).toEqual([])
  })
})

describe('useLiveLogs', () => {
  beforeEach(() => {
    ;(globalThis as any).window = globalThis
    ;(globalThis as any).requestAnimationFrame = (cb: () => void) => setTimeout(cb, 16) as unknown as number
    ;(globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id)
  })
  afterEach(() => {
    delete (globalThis as any).window
    delete (globalThis as any).requestAnimationFrame
    delete (globalThis as any).cancelAnimationFrame
  })

  it('subscribes per selected source; Supabase rows become entries; SSE ids trigger a read', async () => {
    const { useLiveLogs } = await import('@/hooks/use-live-logs')
    const sources = new Set(['workflow', 'agent'] as const)
    const h = mount(() => useLiveLogs({ enabled: true, sources: sources as any }))
    expect(describeSubs()).toEqual(['workflow_logs:*=:INSERT', 'agent_runs:*=:INSERT'])
    await flush()
    expect(h.current.status).toBe('connecting')

    for (const s of active()) s.onStatus?.('live')
    await flush()
    expect(h.current.status).toBe('live')
    expect(h.current.transport).toBe('realtime')

    // Supabase provider: the row comes with the change.
    const wf = active()[0]
    change(wf, 'INSERT', { ids: ['w1'], record: { id: 'w1', message: 'from row', level: 'info', created_at: new Date().toISOString() } })
    await vi.advanceTimersByTimeAsync(20)
    expect(h.current.entries.map((e) => e.key)).toEqual(['workflow:w1'])
    expect(serverQuery).not.toHaveBeenCalled()

    // SSE provider: ids only → the hook reads the source's newest rows.
    serverQuery.mockResolvedValueOnce([{ id: 'w2', message: 'read back', level: 'warn', created_at: new Date(Date.now() + 1000).toISOString() }])
    change(wf, 'INSERT', { ids: ['w2'] })
    await vi.advanceTimersByTimeAsync(20)
    expect(serverQuery).toHaveBeenCalledWith('automations.liveLogs', expect.objectContaining({ source: 'workflow' }))
    expect(h.current.entries.map((e) => e.key)).toEqual(['workflow:w2', 'workflow:w1'])

    h.unmount()
    expect(active()).toEqual([])
  })

  it('falls back to polling when a subscription fails', async () => {
    const { useLiveLogs } = await import('@/hooks/use-live-logs')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const h = mount(() => useLiveLogs({ enabled: true, sources: new Set(['audit']) as any }))
    active()[0].onStatus?.('error')
    await vi.advanceTimersByTimeAsync(10)
    expect(h.current.transport).toBe('polling')
    expect(serverQuery).toHaveBeenCalledWith('automations.liveLogs', expect.objectContaining({ source: 'audit' }))
    h.unmount()
    warn.mockRestore()
  })
})
