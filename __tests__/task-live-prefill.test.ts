import { beforeEach, describe, expect, it, vi } from 'vitest'

const readRecord = vi.fn()
vi.mock('@/lib/extensions/server-registry', () => ({
  getServerExtension: (id: string) => (id === 'sp' ? { id: 'sp', triggers: { item_changed: { readRecord } } } : null),
  getServerExtensions: () => [],
}))
vi.mock('@/lib/extensions/host', () => ({ createExtensionContext: (o: unknown) => ({ host: o }) }))
vi.mock('@/lib/services/form-targets', () => ({
  mapPeopleValues: async (_db: unknown, _t: string, fields: Array<{ key: string }>, values: Record<string, unknown>) => {
    const out = { ...values }
    for (const f of fields) {
      const v = values[f.key] as { email?: string } | undefined
      out[f.key] = v?.email === 'ada@example.com' ? '11111111-1111-4111-8111-111111111111' : null
    }
    return { values: out, missing: [] }
  },
}))
vi.mock('@/lib/extensions/nodes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/extensions/nodes')>()
  const entry = { type: 'ext.sp.item_changed', category: 'trigger', extensionId: 'sp', key: 'item_changed', outputs: [], inputs: [], record: { variable: 'after', fieldsFrom: 'f', idFrom: ['list_id', 'item_id'] } }
  return { ...actual, extensionCatalogEntry: (type: string) => (type === entry.type ? entry : actual.extensionCatalogEntry(type)) }
})

import { livePrefillFields, pickRecordValues, planLiveRefresh, readLivePrefill, samePrefillValue, type LivePrefill } from '@/lib/forms/live-prefill'
import { planTaskLivePrefill, prefilledPeople } from '@/lib/tasks/live-prefill-engine'
import { clearLivePrefillThrottle, refreshTaskLivePrefill } from '@/lib/services/task-live-prefill'
import { defaultTaskFieldValues, stepFieldValues, type TaskFieldDef } from '@/lib/task-field-schema'
import { UPDATABLE_TASK_FIELDS } from '@/lib/task-fields'

const FIELDS: TaskFieldDef[] = [
  { key: 'title', label: 'Title', type: 'text', default: '{{after.Title}}' },
  { key: 'amount', label: 'Amount', type: 'currency', default: '{{after.Amount}}', read_only: true },
  { key: 'dept', label: 'Department', type: 'text', default: '{{after.Dept.value}}' },
  { key: 'owner', label: 'Owner', type: 'user', default: '{{after.Owner}}' },
  { key: 'notes', label: 'Notes', type: 'textarea' },
  { key: 'token', label: 'Token', type: 'text', default: '{{after.api_token}}' },
  { key: 'files', label: 'Files', type: 'attachments' },
  { key: 'greeting', label: 'Greeting', type: 'text', default: 'Hi {{after.Title}}' },
  { key: 'other', label: 'Other', type: 'text', default: '{{row.name}}' },
]

describe('which fields follow the record', () => {
  it('notes fields whose prefill is exactly one record token (step prefill first), never secrets, files or templates', () => {
    expect(livePrefillFields(FIELDS, { notes: '{{after.Notes}}', title: '' }, 'after')).toEqual({ title: 'Title', amount: 'Amount', dept: 'Dept.value', owner: 'Owner', notes: 'Notes' })
  })
  it('picks the record values at those paths', () => {
    expect(pickRecordValues({ title: 'Title', dept: 'Dept.value', missing: 'Nope' }, { Title: 'T', Dept: { id: 3, value: 'Sales' } })).toEqual({ title: 'T', dept: 'Sales' })
  })
})

describe('refreshing at open time', () => {
  const live: LivePrefill = { source: { kind: 'table', table_id: 'T', row_id: 'R' }, fields: { title: 'Title', amount: 'Amount', notes: 'Notes' }, values: { title: 'Old', amount: 100, notes: null } }
  it('refreshes fields that still hold the value they were given; keeps edited ones', () => {
    const plan = planLiveRefresh({ title: 'Old', amount: 250, notes: '' }, live, { title: 'New', amount: 300, notes: 'From the list' })
    expect(plan.changed).toEqual(['title', 'notes'])
    expect(plan.values).toEqual({ title: 'New', notes: 'From the list' })
    expect(plan.live.values).toMatchObject({ title: 'New', amount: 100, notes: 'From the list' })
  })
  it('does nothing when the record did not change', () => {
    expect(planLiveRefresh({ title: 'Old', amount: 100 }, live, { title: 'Old', amount: 100 }).changed).toEqual([])
    expect(samePrefillValue(null, '')).toBe(true)
    expect(samePrefillValue([], undefined)).toBe(true)
    expect(samePrefillValue({ a: 1 }, { a: 1 })).toBe(true)
  })
  it('refuses a malformed stored note', () => {
    expect(readLivePrefill({ source: { kind: 'table' }, fields: { title: 'Title' } })).toBeNull()
    expect(readLivePrefill({ source: { kind: 'extension', trigger: 'javascript:x' }, fields: { title: 'Title' } })).toBeNull()
    expect(readLivePrefill({ source: { kind: 'table', table_id: 'T', row_id: 'R' }, fields: { 'Bad Key': 'x', title: 'Title' } })?.fields).toEqual({ title: 'Title' })
  })
})

describe('the engine at task creation', () => {
  const nodes = [{ id: 't', type: 'ext.sp.item_changed', label: 'Item changed', config: { list: 'L1', filters: { match: 'all', rules: [] }, client_secret: 'x' } }, { id: 'a', type: 'user_task', label: 'Approve', config: {} }]
  it('resolves prefills with the existing resolver and defaults', () => {
    const vars = { after: { Title: 'Laptop', Amount: 1200, Dept: { id: 3, value: 'Sales' } } }
    const resolve = (t: string) => { const m = /^\{\{after\.([\w.]+)\}\}$/.exec(t); return m ? m[1].split('.').reduce<any>((o, k) => o?.[k], vars.after) : t }
    const values = { ...defaultTaskFieldValues(FIELDS, resolve), ...stepFieldValues(FIELDS, { notes: '{{after.Title}}' }, resolve) }
    expect(values).toMatchObject({ title: 'Laptop', amount: 1200, dept: 'Sales', notes: 'Laptop' })
  })
  it('notes where the record lives (scalar settings only, no secrets) and the values given', () => {
    const out = planTaskLivePrefill(nodes, { list_id: 'L1', item_id: 12, after: {} }, FIELDS, {}, { title: 'Laptop', amount: 1200 })
    expect(out?.source).toEqual({ kind: 'extension', trigger: 'ext.sp.item_changed', ids: { list_id: 'L1', item_id: 12 }, config: { list: 'L1' } })
    expect(out?.values).toMatchObject({ title: 'Laptop', amount: 1200, dept: null })
    expect(planTaskLivePrefill(nodes, { after: {} }, FIELDS, {}, {})).toBeNull()
    expect(planTaskLivePrefill([{ id: 'a', type: 'user_task', label: 'A', config: {} }], {}, FIELDS, {}, {})).toBeNull()
  })
  it('maps a person given as { email } to a workspace member', async () => {
    const out = await prefilledPeople({}, 'tenant', FIELDS, {}, () => ({ id: 7, name: 'Ada', email: 'ada@example.com' }))
    expect(out).toEqual({ owner: '11111111-1111-4111-8111-111111111111' })
    expect(await prefilledPeople({}, 'tenant', FIELDS, {}, () => 'plain')).toEqual({})
  })
})

function fakeSys(opts: { row?: Record<string, unknown> | null; updateRows?: number }) {
  const updates: any[] = []
  const sys = {
    updates,
    from(table: string) {
      const filters: Record<string, unknown> = {}
      const chain: any = {
        select: () => chain,
        eq: (k: string, v: unknown) => { filters[k] = v; return chain },
        maybeSingle: async () => ({ data: table === 'custom_table_rows' && opts.row ? { data: opts.row } : null }),
        update: (patch: unknown) => { updates.push({ table, patch, filters }); return chain },
      }
      chain.select = (cols?: string) => (cols === 'updated_at' ? Promise.resolve({ data: Array.from({ length: opts.updateRows ?? 1 }, () => ({ updated_at: 'later' })), error: null }) : chain)
      return chain
    },
  }
  return sys
}

const ctx = { tenantId: 'tenant', actorId: 'u1', permissions: new Set<string>() } as any
const task = (meta: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ id: 'task1', tenant_id: 'tenant', status: 'todo', updated_at: 'now', metadata: meta, ...extra })

describe('refreshTaskLivePrefill (task opens)', () => {
  beforeEach(() => { clearLivePrefillThrottle(); readRecord.mockReset() })
  const fields = [{ key: 'title', label: 'Title', type: 'text' }, { key: 'amount', label: 'Amount', type: 'number' }, { key: 'owner', label: 'Owner', type: 'user' }]

  it('writes only the form\'s declared fields into template_values, conditionally on updated_at', async () => {
    const sys = fakeSys({ row: { name: 'New name', amount: '42', tenant_id: 'evil' } })
    const t = task({ fields, template_values: { title: 'Old', amount: 5 }, live_prefill: { source: { kind: 'table', table_id: 'T', row_id: 'R' }, fields: { title: 'name', amount: 'amount' }, values: { title: 'Old', amount: 1 } } })
    const out = await refreshTaskLivePrefill(ctx, t, { sys })
    expect(out.metadata.template_values).toEqual({ title: 'New name', amount: 5 })
    expect(sys.updates).toHaveLength(1)
    expect(sys.updates[0].filters).toMatchObject({ id: 'task1', tenant_id: 'tenant', updated_at: 'now' })
    // Only metadata is written: never a task column (the task field allowlist is untouched).
    expect(Object.keys(sys.updates[0].patch)).toEqual(['metadata'])
    expect([...UPDATABLE_TASK_FIELDS].includes('metadata')).toBe(false)
  })

  it('keeps the task when a concurrent save changed it, when completed, or within the throttle', async () => {
    const meta = { fields, template_values: { title: 'Old' }, live_prefill: { source: { kind: 'table', table_id: 'T', row_id: 'R' }, fields: { title: 'name' }, values: { title: 'Old' } } }
    const lost = await refreshTaskLivePrefill(ctx, task(meta), { sys: fakeSys({ row: { name: 'New' }, updateRows: 0 }) })
    expect(lost.metadata.template_values).toEqual({ title: 'Old' })
    clearLivePrefillThrottle()
    const sys = fakeSys({ row: { name: 'New' } })
    expect(await refreshTaskLivePrefill(ctx, task(meta, { status: 'completed' }), { sys })).toMatchObject({ status: 'completed' })
    expect(sys.updates).toHaveLength(0)
    await refreshTaskLivePrefill(ctx, task(meta), { sys, now: () => 1000 })
    await refreshTaskLivePrefill(ctx, task(meta), { sys, now: () => 2000 })
    expect(sys.updates).toHaveLength(1)
  })

  it('reads an extension record as the person, maps people, and never follows secret paths', async () => {
    readRecord.mockResolvedValue({ Title: 'From SharePoint', Owner: { email: 'ada@example.com' }, api_token: 'leak' })
    const meta = { fields: [...fields, { key: 'tok', label: 'Tok', type: 'text' }], template_values: { title: 'Old', owner: null }, live_prefill: { source: { kind: 'extension', trigger: 'ext.sp.item_changed', ids: { list_id: 'L1', item_id: 3 }, config: { list: 'L1' } }, fields: { title: 'Title', owner: 'Owner', tok: 'api_token' }, values: { title: 'Old', owner: null, tok: null } } }
    const out = await refreshTaskLivePrefill(ctx, task(meta), { sys: fakeSys({}) })
    expect(readRecord).toHaveBeenCalledWith(expect.objectContaining({ ids: { list_id: 'L1', item_id: 3 }, config: { list: 'L1' } }))
    expect(readRecord.mock.calls[0][0].ctx.host).toMatchObject({ extensionId: 'sp', tenantId: 'tenant', actorId: 'u1' })
    expect(out.metadata.template_values).toEqual({ title: 'From SharePoint', owner: '11111111-1111-4111-8111-111111111111' })
  })

  it('never throws (a failing record read leaves the task as it was)', async () => {
    readRecord.mockRejectedValue(new Error('farm down'))
    const meta = { fields, template_values: { title: 'Old' }, live_prefill: { source: { kind: 'extension', trigger: 'ext.sp.item_changed', ids: { item_id: 1 } }, fields: { title: 'Title' }, values: { title: 'Old' } } }
    const t = task(meta)
    expect(await refreshTaskLivePrefill(ctx, t, { sys: fakeSys({}) })).toBe(t)
  })
})
