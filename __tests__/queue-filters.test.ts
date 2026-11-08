/**
 * Workflow queue views and filters (lib/automations/queue-filters): the
 * default Active view, the view switcher mapping, search fields, advanced
 * filter combinations, URL round-trip and the last-used view in storage.
 * The database applies the same rules (public.workflow_queue_list; see
 * queue-list-db.test.ts).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ACTIVE_STATUSES, advancedFilterCount, chipsForView, clearQueueFilters, defaultQueueFilters, effectiveQueueStatus,
  inQueueView, matchesQueueFilters, nextQueueFilters, parseQueueFilters, readLastQueueView, serializeQueueFilters,
  sortQueueItems, toReadFilters, toRpcFilters, viewCountsOf, viewForChip, writeLastQueueView,
  type QueueFilters, type QueueItem,
} from '@/lib/automations/queue-filters'

const U = (n: number) => `0b000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function item(over: Partial<QueueItem> & { id: string; effective_status: string }): QueueItem {
  return {
    job_id: over.id, synthetic_run: false, workflow_id: U(1), workflow: { id: U(1), name: 'Leave request' },
    status: 'completed', trigger_type: 'form_submitted', trigger_data: null, result: null, error: null,
    created_at: '2026-11-05T10:00:00Z', started_at: '2026-11-05T10:00:01Z', completed_at: null, updated_at: '2026-11-05T10:00:01Z',
    run: null, step_label: null, started_by: null, assignee: null,
    ...over,
  }
}

const ALL_STATUSES = ['pending', 'processing', 'running', 'waiting_for_event', 'paused', 'completed', 'failed', 'dead', 'migrated', 'cancelled']

describe('views', () => {
  it('the default view is Active and excludes terminal statuses', () => {
    expect(defaultQueueFilters().view).toBe('active')
    expect(parseQueueFilters(new URLSearchParams('')).view).toBe('active')
    const shown = ALL_STATUSES.filter((s) => inQueueView(item({ id: s, effective_status: s }), 'active'))
    expect(shown).toEqual(['pending', 'processing', 'running', 'waiting_for_event', 'paused'])
    for (const terminal of ['completed', 'failed', 'dead', 'migrated', 'cancelled']) expect(shown).not.toContain(terminal)
  })

  it('maps each view to its statuses; Needs attention adds active runs past their SLA', () => {
    const at = (view: Parameters<typeof inQueueView>[1]) => ALL_STATUSES.filter((s) => inQueueView(item({ id: s, effective_status: s }), view))
    expect(at('attention')).toEqual(['failed', 'dead'])
    expect(at('completed')).toEqual(['completed', 'migrated', 'cancelled'])
    expect(at('all')).toEqual(ALL_STATUSES)
    const breached = (status: string) => item({ id: 'b', effective_status: status, run: { sla_status: 'breached', sla_due_at: '2026-11-01T00:00:00Z' } as QueueItem['run'] })
    expect(inQueueView(breached('waiting_for_event'), 'attention')).toBe(true)
    expect(inQueueView(breached('completed'), 'attention')).toBe(false)
  })

  it('offers the status chips of the view; stat cards pick the view of their chip', () => {
    expect(chipsForView('active').map((c) => c.value)).toEqual(['pending', 'processing', 'waiting', 'paused'])
    expect(chipsForView('completed').map((c) => c.value)).toEqual(['completed', 'cancelled', 'migrated'])
    expect(viewForChip('failed')).toBe('attention')
    expect(viewForChip('waiting')).toBe('active')
    expect(viewForChip('completed')).toBe('completed')
    // Switching view drops chips the new view does not offer.
    const f = nextQueueFilters(defaultQueueFilters(), { statuses: ['pending', 'waiting'] })
    expect(nextQueueFilters(f, { view: 'attention' }).statuses).toEqual(['waiting'])
  })

  it('effective status: the job while queued / failed, else the run', () => {
    expect(effectiveQueueStatus('pending', 'waiting_for_event')).toBe('pending')
    expect(effectiveQueueStatus('dead', 'waiting_for_event')).toBe('dead')
    expect(effectiveQueueStatus('completed', 'waiting_for_event')).toBe('waiting_for_event')
    expect(effectiveQueueStatus('completed', null)).toBe('completed')
  })

  it('counts per view honour the other filters', () => {
    const items = [
      item({ id: 'a', effective_status: 'pending' }),
      item({ id: 'b', effective_status: 'failed', workflow_id: U(2), workflow: { id: U(2), name: 'PO' } }),
      item({ id: 'c', effective_status: 'completed' }),
    ]
    expect(viewCountsOf(items, { view: 'active' })).toEqual({ active: 1, attention: 1, completed: 1, all: 3 })
    expect(viewCountsOf(items, { view: 'active', workflowIds: [U(1)] })).toEqual({ active: 1, attention: 0, completed: 1, all: 2 })
  })
})

describe('search', () => {
  const run = { id: U(50), workflow_id: U(1), version_id: null, status: 'waiting_for_event', event_id: null, paused_node_id: null, started_at: null, title: 'PO-1042 laptops', sla_label: null, sla_due_at: null, sla_warning_at: null, sla_status: null }
  const it1 = item({
    id: U(40), effective_status: 'waiting_for_event', result: { run_id: U(50) }, run,
    step_label: 'Manager approval', started_by: { id: U(9), name: 'Grace Liu', email: 'grace@example.com' },
  })
  it.each([
    ['workflow name', 'leave REQ'],
    ['item id', U(40)],
    ['short id', U(40).slice(0, 8)],
    ['run id', U(50)],
    ['run title', 'po-1042'],
    ['current step', 'manager appro'],
    ['starter name', 'grace'],
    ['starter email', 'grace@example'],
  ])('matches the %s', (_label, q) => {
    expect(matchesQueueFilters(it1, { view: 'active', search: q })).toBe(true)
  })
  it('misses other text', () => {
    expect(matchesQueueFilters(it1, { view: 'active', search: 'invoice' })).toBe(false)
  })
})

describe('advanced filters', () => {
  const a = item({
    id: 'a', effective_status: 'waiting_for_event', trigger_type: 'schedule', error: null,
    started_by: { id: U(9), name: 'Grace', email: null }, assignee: { id: U(8), name: 'Aisha', email: null },
    run: { id: U(60), workflow_id: U(1), version_id: U(70), status: 'waiting_for_event', event_id: 'e', paused_node_id: null, started_at: null, title: null, sla_label: 'SLA', sla_due_at: '2026-11-09T00:00:00Z', sla_warning_at: null, sla_status: 'warning' },
  })
  const b = item({ id: 'b', effective_status: 'failed', trigger_type: 'webhook_received', error: 'boom', workflow_id: U(2), workflow: { id: U(2), name: 'PO' }, created_at: '2026-11-01T10:00:00Z' })
  const items = [a, b]
  const ids = (f: Parameters<typeof matchesQueueFilters>[1]) => items.filter((i) => matchesQueueFilters(i, f)).map((i) => i.id)

  it('combine with AND', () => {
    expect(ids({ view: 'all', workflowIds: [U(1)] })).toEqual(['a'])
    expect(ids({ view: 'all', startedBy: [U(9)], assigneeIds: [U(8)] })).toEqual(['a'])
    expect(ids({ view: 'all', startedBy: [U(9)], hasErrors: true })).toEqual([])
    expect(ids({ view: 'all', hasErrors: true })).toEqual(['b'])
    expect(ids({ view: 'all', sla: ['warning'] })).toEqual(['a'])
    expect(ids({ view: 'all', sla: ['breached'] })).toEqual([])
    expect(ids({ view: 'all', triggers: ['schedule', 'webhook'] })).toEqual(['a', 'b'])
    expect(ids({ view: 'all', triggers: ['form'] })).toEqual([])
    expect(ids({ view: 'all', versionIds: [U(70)] })).toEqual(['a'])
    expect(ids({ view: 'all', dateField: 'created', dateFrom: '2026-11-03T00:00:00Z' })).toEqual(['a'])
    expect(ids({ view: 'all', dateField: 'created', dateTo: '2026-11-03T00:00:00Z' })).toEqual(['b'])
    expect(ids({ view: 'active', triggers: ['webhook'] })).toEqual([])
    expect(ids({ view: 'attention', statuses: ['failed'], workflowIds: [U(2)] })).toEqual(['b'])
  })

  it('reach the RPC as effective statuses and trigger types', () => {
    const f: QueueFilters = { ...defaultQueueFilters(), statuses: ['processing'], triggers: ['manual'], search: '  x ', dateFrom: '2026-11-01', sla: ['breached'] }
    const rpc = toRpcFilters(toReadFilters(f))
    expect(rpc).toMatchObject({ view: 'active', statuses: ['processing', 'running'], trigger_types: ['manual', 'api'], search: 'x', date_field: 'created', sla: ['breached'] })
    expect(typeof rpc.date_from).toBe('string')
    expect(rpc).not.toHaveProperty('date_to')
    expect(toRpcFilters({ view: 'all' }, true)).toEqual({ view: 'all', facets: true })
  })

  it('count, and Clear all keeps the view and sort', () => {
    const f: QueueFilters = { ...defaultQueueFilters('attention'), workflowIds: [U(1)], hasErrors: true, search: 'x', sort: 'status' }
    expect(advancedFilterCount(f)).toBe(2)
    expect(clearQueueFilters(f)).toEqual({ ...defaultQueueFilters('attention'), sort: 'status' })
  })

  it('a version filter needs exactly one workflow', () => {
    const f = { ...defaultQueueFilters(), workflowIds: [U(1)], versionIds: [U(70)] }
    expect(nextQueueFilters(f, { workflowIds: [U(1), U(2)] }).versionIds).toEqual([])
  })
})

describe('URL', () => {
  it('round-trips every filter', () => {
    const f: QueueFilters = {
      view: 'attention', statuses: ['failed', 'dead'], search: 'PO 1042', workflowIds: [U(1), U(2)], startedBy: [U(3)], assigneeIds: [U(4)],
      dateField: 'updated', dateFrom: '2026-11-01', dateTo: '2026-11-07', sla: ['breached'], triggers: ['form', 'data_event'], versionIds: [U(5)],
      hasErrors: true, sort: 'started_at', dir: 'asc', page: 3, pageSize: 50,
    }
    const qs = serializeQueueFilters(f)
    expect(parseQueueFilters(new URLSearchParams(qs))).toEqual(f)
  })

  it('leaves defaults out (but writes the view) and keeps other keys', () => {
    expect(serializeQueueFilters(defaultQueueFilters(), new URLSearchParams('tab=x&page=4'))).toBe('tab=x&view=active')
  })

  it('drops invalid values', () => {
    const f = parseQueueFilters(new URLSearchParams('view=nope&status=pending,bogus&wf=abc&sla=late&trigger=form,x&from=yesterday&size=7&page=-2&sort=name'), 'completed')
    expect(f).toEqual({ ...defaultQueueFilters('completed'), statuses: ['pending'], triggers: ['form'] })
  })

  it('any change but the page goes back to page 1', () => {
    const f = { ...defaultQueueFilters(), page: 4 }
    expect(nextQueueFilters(f, { search: 'x' }).page).toBe(1)
    expect(nextQueueFilters(f, { page: 5 }).page).toBe(5)
  })
})

describe('sorting (fallback)', () => {
  it('orders by created, started or status', () => {
    const items = [
      item({ id: 'a', effective_status: 'pending', created_at: '2026-11-01T00:00:00Z', started_at: null }),
      item({ id: 'b', effective_status: 'failed', created_at: '2026-11-03T00:00:00Z', started_at: '2026-11-03T00:00:00Z' }),
      item({ id: 'c', effective_status: 'completed', created_at: '2026-11-02T00:00:00Z', started_at: '2026-11-02T00:00:00Z' }),
    ]
    expect(sortQueueItems(items, 'created_at', 'desc').map((i) => i.id)).toEqual(['b', 'c', 'a'])
    expect(sortQueueItems(items, 'started_at', 'desc').map((i) => i.id)).toEqual(['b', 'c', 'a'])
    expect(sortQueueItems(items, 'status', 'asc').map((i) => i.id)).toEqual(['c', 'b', 'a'])
  })
})

describe('last-used view', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is remembered per user', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) })
    writeLastQueueView('u1', 'completed')
    expect(readLastQueueView('u1')).toBe('completed')
    expect(readLastQueueView('u2')).toBeNull()
    store.set('usertasks:queue-view:u3', 'bogus')
    expect(readLastQueueView('u3')).toBeNull()
  })

  it('survives storage that throws', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('quota') } })
    expect(() => writeLastQueueView('u1', 'all')).not.toThrow()
    expect(readLastQueueView('u1')).toBeNull()
  })
})

it('ACTIVE_STATUSES matches the RPC', () => {
  expect([...ACTIVE_STATUSES]).toEqual(['pending', 'processing', 'running', 'waiting_for_event', 'paused'])
})
