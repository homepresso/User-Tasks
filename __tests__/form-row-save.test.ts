/**
 * Editable table rules' "Save now" on the server (lib/services/form-rule-actions.ts
 * runRowSave): the step and the Data table field come from the SAVED form
 * (a stage-mode step can't be forced to write), the row is checked like a
 * submitted change set (types, required, read-only columns stripped / a
 * named change refused, allow add / delete), written with the person's
 * data.manage_rows or the author's open access, audited, and the stored
 * row's id comes back as {{result.id}}.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fakes */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServiceContext } from '@/lib/services/context'

const TENANT = 'eeeeeeee-0000-4000-8000-000000000001'
const FORM = 'eeeeeeee-0000-4000-8000-000000000002'
const PRODUCTS = 'eeeeeeee-0000-4000-8000-000000000003'
const ROW1 = 'eeeeeeee-0000-4000-8000-0000000000a1'

let forms: Record<string, any>
const fake = vi.hoisted(() => ({ upsert: [] as any[], update: [] as any[], del: [] as any[], audits: [] as any[], verified: [] as any[] }))

function fakeDb() {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = []
      const api: any = {
        select() { return api }, eq(f: string, v: unknown) { filters.push([f, v]); return api }, limit() { return api }, maybeSingle() { return api },
        then(resolve: (v: unknown) => unknown) {
          const get = (f: string) => filters.find(([k]) => k === f)?.[1]
          if (table === 'forms') return Promise.resolve({ data: get('tenant_id') === TENANT ? forms[String(get('id'))] ?? null : null, error: null }).then(resolve)
          if (table === 'users') return Promise.resolve({ data: { id: 'u1', email: 'ada@example.com', display_name: 'Ada' }, error: null }).then(resolve)
          return Promise.resolve({ data: null, error: null }).then(resolve)
        },
      }
      return api
    },
  }
}
const db = fakeDb()
vi.mock('@/lib/services/_shared', async (orig) => ({ ...(await orig() as object), serviceRoleClient: async () => db, audit: async (_ctx: any, entry: any) => { fake.audits.push(entry) } }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: async () => ({ ok: true }) }))
vi.mock('@/lib/providers/cache', () => ({ getCacheStore: async () => null }))
vi.mock('@/lib/services/data-tables', () => ({
  getDataTable: async () => ({ id: PRODUCTS }),
  upsertRows: async (ctx: any, tableId: string, list: any[]) => { if (ctx.permissions && !ctx.permissions.has('data.manage_rows')) throw new Error('Forbidden'); fake.upsert.push({ tableId, list }); return [{ row_id: 'new-row-1', action: 'created', row: { data: list[0].data } }] },
  updateRow: async (_ctx: any, tableId: string, rowId: string, cells: any) => { fake.update.push({ tableId, rowId, cells }); return {} },
  deleteRow: async (_ctx: any, tableId: string, rowId: string) => { fake.del.push({ tableId, rowId }); return { deleted: true } },
}))
// The source's own rows (the person's access / base filter): r1 exists, anything else doesn't.
vi.mock('@/lib/services/form-data-table', async (orig) => ({
  ...(await orig() as object),
  resolveDataTableValues: async (_ctx: any, _tenant: string, fields: any[], values: Record<string, any>) => {
    const field = fields[0]
    const cs = values[field.key]
    fake.verified.push(cs)
    const keys = [...cs.updated.map((u: any) => u.key), ...cs.deleted.map((d: any) => d.key)]
    if (keys.some((k: string) => k !== ROW1)) return { errors: { [field.key]: `${field.label}: row "${keys[0]}" is no longer available` }, values: {} }
    const before = { name: 'Anvil', price: 30, owner: 'ada', sku: 'S-1' }
    return { errors: {}, values: { [field.key]: { added: cs.added, updated: cs.updated.map((u: any) => ({ key: u.key, before, after: u.after, changed_fields: Object.keys(u.after) })), deleted: cs.deleted.map((d: any) => ({ key: d.key, before })) } } }
  },
}))

const { runRuleAction } = await import('@/lib/services/form-rule-actions')

const ctx = (perms: string[]): ServiceContext => ({ supabase: db as any, tenantId: TENANT, actorId: 'u1', permissions: new Set(perms), authKind: 'session', source: 'ui' } as ServiceContext)
const WRITER = ctx(['forms.submit', 'data.view', 'data.manage_rows'])
const READER = ctx(['forms.submit', 'data.view'])

const TABLE = {
  source: 'table', mode: 'edit', table_id: PRODUCTS, allow_add: true, allow_delete: true,
  columns: [
    { key: 'name', label: 'Name', type: 'text', required: true },
    { key: 'price', label: 'Price', type: 'number' },
    { key: 'sku', label: 'SKU', type: 'text', read_only: true, default: 'SKU-1' },
    { key: 'owner', label: 'Owner', type: 'text', read_only: true },
  ],
}
const LAYOUT = {
  rules: [
    { id: 'r_save', event: 'button_click', target: 'save', then: [{ type: 'commit_row', field: 'products', commit_mode: 'save_now' }] },
    { id: 'r_stage', event: 'button_click', target: 'save', then: [{ type: 'commit_row', field: 'products' }] },
    { id: 'r_open', event: 'button_click', target: 'save', then: [{ type: 'commit_row', field: 'products', commit_mode: 'save_now', open_access: true }] },
    { id: 'r_delete', event: 'button_click', target: 'del', then: [{ type: 'delete_row', field: 'products', commit_mode: 'save_now' }] },
  ],
}

beforeEach(() => {
  forms = { [FORM]: { id: FORM, name: 'Products', fields: [{ key: 'products', label: 'Products', type: 'data_table', data_table: TABLE }], layout: LAYOUT } }
  fake.upsert = []; fake.update = []; fake.del = []; fake.audits = []; fake.verified = []
})

const run = (c: ServiceContext, rule: string, commit: Record<string, unknown>) =>
  runRuleAction(c, { form_id: FORM }, { rule_id: rule, action_index: 0, values: {}, event: { commit }, idempotency_key: `key-${Math.random().toString(36).slice(2)}` })

describe('Save now (server)', () => {
  it('a new row: checked, read-only columns without a default dropped, written with the person\'s rights, audited; {{result.id}}', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await run(WRITER, 'r_save', { added: { name: 'Nut', price: '2', sku: 'SKU-1', owner: 'eve', __draft: 'new', __rid: 'n1' } })
    expect(fake.upsert).toEqual([{ tableId: PRODUCTS, list: [{ data: { name: 'Nut', price: 2, sku: 'SKU-1' } }] }])
    expect(res.result).toEqual({ id: 'new-row-1', row_id: 'new-row-1', row: { name: 'Nut', price: 2, sku: 'SKU-1', row_id: 'new-row-1' } })
    expect(fake.audits[0]).toMatchObject({ objectType: 'data_table', objectId: PRODUCTS, action: 'create', metadata: { rule_id: 'r_save', row_ids: ['new-row-1'], field: 'products' } })
    expect(warn.mock.calls[0][0]).toMatch(/read-only column "owner" was ignored/)
    warn.mockRestore()
  })

  it('refuses a row that fails its checks, and a person without Manage rows (unless the author opened the step)', async () => {
    await expect(run(WRITER, 'r_save', { added: { price: 'lots' } })).rejects.toThrow(/Name is required|Price must be a number/)
    await expect(run(READER, 'r_save', { added: { name: 'Nut' } })).rejects.toThrow(/data\.manage_rows|Forbidden/)
    expect(fake.upsert).toEqual([])
    await run(READER, 'r_open', { added: { name: 'Nut' } })
    expect(fake.upsert).toHaveLength(1)
  })

  it('the saved step decides: a stage-mode step (or a step that is not there) never writes, whatever the browser sends', async () => {
    await expect(run(WRITER, 'r_stage', { added: { name: 'Nut' } })).rejects.toThrow(/no server action/)
    await expect(runRuleAction(WRITER, { form_id: FORM }, { rule_id: 'r_save', action_index: 3, values: {}, event: { commit: { added: { name: 'X' } } }, idempotency_key: 'key-tamper-123' })).rejects.toThrow(/no server action/)
    expect(fake.upsert).toEqual([])
  })

  it('an existing row: only rows the person can see; read-only changes dropped; updated by its row id', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await run(WRITER, 'r_save', { updated: { key: ROW1, after: { price: 31, owner: 'eve' } } })
    expect(fake.verified[0].updated[0].after).toEqual({ price: 31 })
    expect(fake.update).toEqual([{ tableId: PRODUCTS, rowId: ROW1, cells: { price: 31 } }])
    expect(res.result).toMatchObject({ id: ROW1, row: { name: 'Anvil', price: 31, owner: 'ada' } })
    await expect(run(WRITER, 'r_save', { updated: { key: 'eeeeeeee-0000-4000-8000-0000000000ff', after: { price: 1 } } })).rejects.toThrow(/no longer available/)
    warn.mockRestore()
  })

  it('delete now: the row id; a table without Delete rows refuses', async () => {
    const res = await run(WRITER, 'r_delete', { deleted: { key: ROW1 } })
    expect(fake.del).toEqual([{ tableId: PRODUCTS, rowId: ROW1 }])
    expect(res.result).toMatchObject({ id: ROW1, count: 1 })
    expect(fake.audits.at(-1)).toMatchObject({ action: 'delete' })
    forms[FORM].fields[0].data_table = { ...TABLE, allow_delete: false }
    await expect(run(WRITER, 'r_delete', { deleted: { key: ROW1 } })).rejects.toThrow(/Deleting rows is not allowed/)
  })
})
