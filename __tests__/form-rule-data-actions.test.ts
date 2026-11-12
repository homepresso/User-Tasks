/**
 * Form rules' data and API actions (lib/forms/data-actions.ts,
 * lib/forms/action-outputs.ts, lib/services/form-rule-actions.ts):
 * normalisation, inputs from every source, filter / sort translation (table
 * and local), outputs into fields / Labels / read-only fields / variables /
 * Lists (column paths, append) / options, TOP 1, each table action on the
 * server with the SAVED form's allowlist (a tampered client config reaches
 * nothing), permissions and anonymous forms, wait vs fire-and-forget, the
 * error path, on-success / on-failure steps, row buttons ({{row.*}}),
 * update row, cascading options (stale children, blank parents) and the
 * designer's Test.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fake rows */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServiceContext } from '@/lib/services/context'

const TENANT = 'dddddddd-0000-4000-8000-000000000001'
const FORM = 'dddddddd-0000-4000-8000-000000000002'
const PRODUCTS = 'dddddddd-0000-4000-8000-000000000003'
const ROW1 = 'dddddddd-0000-4000-8000-0000000000a1'
const ROW2 = 'dddddddd-0000-4000-8000-0000000000a2'

let rows: Array<{ id: string; data: Record<string, unknown> }>
let calls: Array<{ table: string; op: string; args?: unknown }>
let forms: Record<string, any>

function fakeDb() {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = []
      let range: [number, number] | null = null
      const api: any = {
        select() { return api }, eq(f: string, v: unknown) { filters.push([f, v]); return api }, in() { return api }, is() { return api },
        order(col: string, opts: any) { calls.push({ table, op: 'order', args: [col, opts?.ascending] }); return api },
        range(a: number, b: number) { range = [a, b]; calls.push({ table, op: 'range', args: [a, b] }); return api },
        limit() { return api }, abortSignal() { return api }, maybeSingle() { return api },
        or(expr: string) { calls.push({ table, op: 'or', args: expr }); return api },
        then(resolve: (v: unknown) => unknown) {
          const get = (f: string) => filters.find(([k]) => k === f)?.[1]
          if (table === 'forms') return Promise.resolve({ data: get('tenant_id') === TENANT ? forms[String(get('id'))] ?? null : null, error: null }).then(resolve)
          if (table === 'custom_tables') return Promise.resolve({ data: get('id') === PRODUCTS ? { columns: [{ key: 'sku', type: 'text' }, { key: 'name', type: 'text' }, { key: 'price', type: 'number' }, { key: 'country', type: 'text' }] } : null, error: null }).then(resolve)
          if (table === 'custom_table_rows') {
            let out = rows
            if (get('id')) out = out.filter((r) => r.id === get('id'))
            if (range) out = out.slice(range[0], range[1] + 1)
            return Promise.resolve({ data: out, error: null }).then(resolve)
          }
          if (table === 'users') return Promise.resolve({ data: { id: 'u1', email: 'ada@example.com', display_name: 'Ada' }, error: null }).then(resolve)
          return Promise.resolve({ data: null, error: null }).then(resolve)
        },
      }
      return api
    },
  }
}

const db = fakeDb()
const writes = vi.hoisted(() => ({ upsert: [] as any[], update: [] as any[], del: [] as any[] }))
vi.mock('@/lib/services/_shared', async (orig) => ({ ...(await orig() as object), serviceRoleClient: async () => db, audit: async () => {} }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: async () => ({ ok: true }) }))
vi.mock('@/lib/providers/cache', () => ({ getCacheStore: async () => null }))
vi.mock('@/lib/services/data-tables', () => ({
  getDataTable: async (ctx: any) => { if (ctx.permissions && !ctx.permissions.has('data.manage_rows') && !ctx.permissions.has('data.view')) throw new Error('no'); return { id: PRODUCTS } },
  upsertRows: async (ctx: any, tableId: string, list: any[]) => { if (ctx.permissions && !ctx.permissions.has('data.manage_rows')) throw Object.assign(new Error('Forbidden'), { status: 403 }); writes.upsert.push({ tableId, list, supabase: ctx.supabase }); return [{ row_id: 'new-row-1', action: 'created', row: { data: list[0].data } }] },
  updateRow: async (_ctx: any, tableId: string, rowId: string, cells: any) => { writes.update.push({ tableId, rowId, cells }); return {} },
  deleteRow: async (_ctx: any, tableId: string, rowId: string) => { writes.del.push({ tableId, rowId }); return { deleted: true } },
}))

const { runRuleAction, ruleActionDeps, testRuleAction } = await import('@/lib/services/form-rule-actions')
const { normalizeFieldButtonAction, runFieldButton } = await import('@/lib/forms/field-buttons')
const { applyLocalQuery, normalizeActionFilter, resolveActionTemplate, resolveFilter, topOneNotice, singleRowOnly, pinsUniqueRow, resultProjection } = await import('@/lib/forms/data-actions')
const { mapActionOutputs, outputProblems } = await import('@/lib/forms/action-outputs')
const { ruleValue, normalizeFormRules, formRuleProblem, mergeless } = await import('@/lib/forms/form-rules').then((m) => ({ ...m, mergeless: null }))
const { normalizeTaskFields, mergeTaskFieldValues } = await import('@/lib/task-field-schema')
const { staleChoiceValue, blankInputsBehaviour, normalizeDynamicBinding } = await import('@/lib/forms/dynamic-values')
void mergeless

const ctx = (perms: string[], extra: Partial<ServiceContext> = {}): ServiceContext => ({ supabase: db as any, tenantId: TENANT, actorId: 'u1', permissions: new Set(perms), authKind: 'session', source: 'ui', ...extra } as ServiceContext)
const USER = ctx(['forms.submit', 'data.view', 'data.manage_rows'])
const anon = (perms: string[] = ['forms.submit']) => ctx(perms, { actorId: null, authKind: 'anonymous', anonymous: { formId: FORM, ipHash: 'ip', uploads: { enabled: false }, uploadSession: null } as any })

const FIELDS = [
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'country', label: 'Country', type: 'choice', options: ['NZ', 'AU'] },
  { key: 'state', label: 'State', type: 'choice', options: [] },
  { key: 'customer_name', label: 'Customer', type: 'text' },
  { key: 'address', label: 'Address', type: 'text', read_only: true },
  { key: 'summary', label: 'Summary', type: 'label', label_config: { include: true } },
  { key: 'new_id', label: 'New id', type: 'text' },
  { key: 'products', label: 'Products', type: 'list', list: { columns: [{ key: 'sku', label: 'SKU', type: 'text' }, { key: 'name', label: 'Name', type: 'text' }, { key: 'price', label: 'Price', type: 'number' }, { key: 'source_id', label: 'Source', type: 'text', hidden: true }], row_buttons: [{ id: 'delete', label: 'Delete', style: 'danger' }] } },
]
const LAYOUT = {
  variables: [{ name: 'customer_tier', type: 'text' }],
  rules: [
    { id: 'r_list', event: 'button_click', target: 'load', then: [{ type: 'table_list', table_id: PRODUCTS, table_name: 'Products', filter: { match: 'all', conditions: [{ column: 'country', operator: 'eq', value: '{{form.country}}' }] }, sort: [{ column: 'price', direction: 'desc' }], limit: 10, outputs: [{ path: '', to: 'products', columns: { source_id: 'row_id' } }] }] },
    { id: 'r_top', event: 'button_click', target: 'load', then: [{ type: 'table_list', table_id: PRODUCTS, sort: [{ column: 'price', direction: 'desc' }], outputs: [{ path: 'name', to: 'customer_name' }] }] },
    { id: 'r_read', event: 'button_click', target: 'load', then: [{ type: 'table_read', table_id: PRODUCTS, row_id: '{{row.row_id}}', outputs: [{ path: 'name', to: 'summary' }, { path: 'country', to: 'address' }, { path: 'sku', to: 'var.customer_tier' }] }] },
    { id: 'r_create', event: 'button_click', target: 'load', then: [{ type: 'table_create', table_id: PRODUCTS, column_values: { sku: '{{form.email}}', name: 'Created by {{user.name}}', price: '5' }, outputs: [{ path: 'row_id', to: 'new_id' }], on_success: [{ type: 'message', text: 'Created {{result.row_id}}' }] }] },
    { id: 'r_update', event: 'list_row_button', target: 'products', then: [{ type: 'table_update', table_id: PRODUCTS, filter: { conditions: [{ column: 'sku', operator: 'eq', value: '{{row.sku}}' }] }, column_values: { price: '{{row.price}}' } }] },
    { id: 'r_delete', event: 'list_row_button', target: 'products', then: [{ type: 'table_delete', table_id: PRODUCTS, row_id: '{{row.source_id}}', allow_anonymous: true }, { type: 'remove_list_row', list_field: 'products', row: '{{event.row_number}}' }] },
    { id: 'r_states', event: 'value_change', target: 'country', then: [{ type: 'call_reference', reference_id: 'ref-states', inputs: { country: '{{form.country}}' }, rows_path: 'states', filter: [{ column: 'active', operator: 'eq', value: 'true' }], sort: [{ column: 'name', direction: 'asc' }], outputs: [{ path: 'states', to: 'state', as: 'options', value_path: 'code', label_path: 'name' }] }] },
    { id: 'r_fire', event: 'button_click', target: 'load', then: [{ type: 'call_reference', reference_id: 'ref-ping', wait: false, inputs: { email: '{{email}}' } }] },
    { id: 'r_lookup', event: 'button_click', target: 'load', then: [{ type: 'call_reference', reference_id: 'ref-crm', timeout_ms: 4000, inputs: { email: '{{form.email}}' }, outputs: [{ path: 'customer.name', to: 'customer_name' }, { path: 'customer.address.city', to: 'address' }], on_failure: [{ type: 'set_values', assign: { customer_name: 'Not found: {{error.message}}' } }] }] },
  ],
}
const P = (data: Record<string, unknown>, id: string) => ({ id, data })

let refCalls: any[]
let deferred: Array<() => Promise<void>>
beforeEach(() => {
  forms = { [FORM]: { id: FORM, name: 'Orders', fields: FIELDS, layout: LAYOUT } }
  rows = [P({ sku: 'A-1', name: 'Anvil', price: 30, country: 'NZ' }, ROW1), P({ sku: 'B-2', name: 'Bolt', price: 50, country: 'NZ' }, ROW2)]
  calls = []
  writes.upsert = []; writes.update = []; writes.del = []
  refCalls = []
  deferred = []
  ruleActionDeps.defer = async (work) => { deferred.push(work) }
  ruleActionDeps.executeReference = async (opts: any) => {
    refCalls.push(opts)
    if (opts.referenceId === 'ref-states') return { status: 200, data: { states: [{ code: 'WLG', name: 'Wellington', active: true }, { code: 'AKL', name: 'Auckland', active: true }, { code: 'OLD', name: 'Old', active: false }], secret: 'LEAK' } } as any
    if (opts.referenceId === 'ref-crm') {
      if (opts.inputValues.email === 'nobody@example.com') throw Object.assign(new Error('status 404'), { status: 404 })
      return { status: 200, data: { customer: { name: 'Acme Ltd', address: { city: 'Wellington' }, card: '4111' } } } as any
    }
    return { status: 200, data: { ok: true } } as any
  }
})

const run = (c: ServiceContext, rule: string, values: Record<string, unknown> = {}, event: Record<string, unknown> | null = null, index = 0, branch: any = null) =>
  runRuleAction(c, { form_id: FORM }, { rule_id: rule, action_index: index, values, event, idempotency_key: `key-${Math.random().toString(36).slice(2)}`, branch })

describe('normalisation and templates', () => {
  it('table actions keep their table, filter (Data step operator names), sort, limit, columns and outputs; branches are one level', () => {
    const a = normalizeFieldButtonAction({
      type: 'table_list', table_id: PRODUCTS, filter: [{ column: 'name', operator: 'like', value: 'an' }, { column: 'sku', operator: 'ends_with', value: '1' }, { column: 'price', operator: 'not_null' }, { column: 'x', operator: 'is_null' }],
      sort: [{ column: 'price', direction: 'desc' }], limit: 9999, outputs: [{ path: '', to: 'products' }, { path: '__proto__.x', to: 'email' }, { path: 'name', to: 'BAD KEY' }],
      on_success: [{ type: 'message', text: 'ok', on_success: [{ type: 'message', text: 'deeper' }] }, { type: 'prompt', text: 'no questions here' }],
    }, { rule: true })!
    expect(a.filter!.conditions.map((c: any) => c.operator)).toEqual(['contains', 'ends_with', 'is_set', 'is_not_set'])
    expect(a.limit).toBe(200)
    expect(a.outputs).toEqual([{ path: '', to: 'products' }])
    expect(a.on_success).toEqual([{ type: 'message', text: 'ok' }])
    expect(normalizeFieldButtonAction({ type: 'table_create', table_id: 'not-a-uuid' }, { rule: true })!.table_id).toBeUndefined()
    expect(normalizeFieldButtonAction({ type: 'table_read', table_id: PRODUCTS })).toBeNull() // a Button can't carry it
    const ref = normalizeFieldButtonAction({ type: 'call_reference', reference_id: 'r', wait: false, timeout_ms: 999_999 }, { rule: true })!
    expect(ref).toMatchObject({ wait: false, timeout_ms: 30_000 })
  })

  it('inputs come from the form, the row, variables, parameters, the user, dates and constants', () => {
    const scope = { values: { email: 'ada@example.com', __form_vars: { tier: 'gold' }, __form_params: { region: 'EU' } }, user: { id: 'u1', email: 'me@example.com', name: 'Me' }, event: { row: { sku: 'A-1' } }, now: new Date('2026-11-11T10:00:00Z') }
    const r = (t: string) => resolveActionTemplate(t, scope as any, (p, s) => ruleValue(p, s as any))
    expect(r('{{form.email}}')).toBe('ada@example.com')
    expect(r('{{email}}')).toBe('ada@example.com')
    expect(r('{{row.sku}}')).toBe('A-1')
    expect(r('{{var.tier}}')).toBe('gold')
    expect(r('{{param.region}}')).toBe('EU')
    expect(r('{{user.email}}')).toBe('me@example.com')
    expect(r('{{today}}')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(r('{{today+7d}}')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(r('Order for {{user.name}}')).toBe('Order for Me')
    expect(r('ACME')).toBe('ACME')
  })

  it('filters translate to the table query (AND / OR) and run locally on API rows', () => {
    const filter = normalizeActionFilter({ match: 'any', conditions: [{ column: 'price', operator: 'gte', value: '40' }, { match: 'all', conditions: [{ column: 'name', operator: 'starts_with', value: 'an' }] }] })!
    const items = [{ name: 'Anvil', price: 30 }, { name: 'Bolt', price: 50 }, { name: 'Cog', price: 10 }]
    expect(applyLocalQuery(items, { filter: resolveFilter(filter, { values: {} }, () => undefined), sort: [{ column: 'price', direction: 'desc' }] })).toEqual([{ name: 'Bolt', price: 50 }, { name: 'Anvil', price: 30 }])
    expect(applyLocalQuery(items, { sort: [{ column: 'name', direction: 'desc' }], limit: 1, offset: 1 })).toEqual([{ name: 'Bolt', price: 50 }])
  })
})

describe('outputs', () => {
  const fields = normalizeTaskFields(FIELDS)
  it('write fields, Labels, read-only fields, variables, Lists (column paths, append) and options; TOP 1 for single values', () => {
    const result = [{ row_id: 'r1', sku: 'A', name: 'Anvil', price: '30' }, { row_id: 'r2', sku: 'B', name: 'Bolt', price: 50 }]
    const mapped = mapActionOutputs(result, [
      { path: '', to: 'products', columns: { source_id: 'row_id' } },
      { path: 'name', to: 'customer_name' },
      { path: '[1].name', to: 'summary' },
      { path: 'sku', to: 'address' },
      { path: '', to: 'state', as: 'options', value_path: 'sku', label_path: 'name' },
      { path: '[0].sku', to: 'var.customer_tier' },
    ], fields, [{ name: 'customer_tier', type: 'text' } as any])
    expect(mapped.values.products).toEqual([{ sku: 'A', name: 'Anvil', price: 30, source_id: 'r1' }, { sku: 'B', name: 'Bolt', price: 50, source_id: 'r2' }])
    expect(mapped.values.customer_name).toBe('Anvil') // TOP 1
    expect(mapped.values.summary).toBe('Bolt')
    expect(mapped.values.address).toBe('A')
    expect(mapped.options.state).toEqual([{ value: 'A', label: 'Anvil' }, { value: 'B', label: 'Bolt' }])
    expect(mapped.vars.customer_tier).toBe('A')
    const appended = mapActionOutputs([{ sku: 'C' }], [{ path: '', to: 'products', mode: 'append' }], fields, [], { products: [{ sku: 'A' }] })
    expect((appended.values.products as any[]).map((r) => r.sku)).toEqual(['A', 'C'])
    expect(outputProblems([{ path: '', to: 'products', columns: { nope: 'x' } }, { path: 'a', to: 'email', as: 'options' }], { fields, variables: [] })).toEqual(['the List "Products" has no column "nope"', 'options go into a single or multi-select ("Email" is not one)'])
  })

  it('the TOP 1 notice: a list into one value warns; a read by id, a unique-key filter, limit 1 or a List / options target do not', () => {
    const list = { type: 'table_list' }
    expect(topOneNotice(list, { path: 'name' }, 'text')).toMatch(/TOP 1/)
    expect(topOneNotice({ type: 'table_read', row_id: '{{x}}' }, { path: 'name' }, 'text')).toBeNull()
    expect(topOneNotice({ type: 'table_list', filter: { match: 'all', conditions: [{ column: 'row_id', operator: 'eq', value: '{{x}}' }] } }, { path: 'name' }, 'text')).toBeNull()
    expect(topOneNotice({ type: 'table_list', limit: 1 }, { path: 'name' }, 'text')).toBeNull()
    expect(topOneNotice(list, { path: '' }, 'list')).toBeNull()
    expect(topOneNotice(list, { path: '', as: 'options' }, 'choice')).toBeNull()
    expect(topOneNotice({ type: 'call_reference' }, { path: 'items' }, 'text', true)).toMatch(/TOP 1/)
    expect(pinsUniqueRow({ match: 'any', conditions: [{ column: 'row_id', operator: 'eq', value: 'x' }] })).toBe(false)
    expect(singleRowOnly({ type: 'table_list', outputs: [{ path: 'name', to: 'customer_name' }] }, () => 'text')).toBe(true)
    expect(singleRowOnly({ type: 'table_list', outputs: [{ path: '', to: 'products' }] }, () => 'list')).toBe(false)
  })

  it('{{result.*}} reaches the browser only as the paths the step’s own steps read', () => {
    expect(resultProjection({ customer: { name: 'Acme', card: '4111' }, list: [{ id: 1 }] }, ['Hi {{result.customer.name}}', '{{result.list[0].id}}'])).toEqual({ customer: { name: 'Acme' }, list: [{ id: 1 }] })
    expect(resultProjection({ a: 1 }, ['no result here'])).toBeNull()
  })
})

describe('table actions on the server (the saved form decides)', () => {
  it('table_list: the saved filter / sort run as one query; the rows fill the List (row_id → hidden column)', async () => {
    const res = await run(USER, 'r_list', { country: 'NZ' })
    expect(calls.find((c) => c.op === 'or')!.args).toBe('and(data->>country.eq."NZ")')
    expect(calls.filter((c) => c.op === 'order').map((c) => c.args)).toContainEqual(['data->price', false])
    expect((res.values!.products as any[]).map((r) => r.source_id)).toEqual([ROW1, ROW2])
  })

  it('table_list into a single field fetches one row (limit 1), the first after the sort', async () => {
    rows = [P({ name: 'Bolt', price: 50 }, ROW2)]
    const res = await run(USER, 'r_top', {})
    expect(calls.find((c) => c.op === 'range')!.args).toEqual([0, 0])
    expect(res.values!.customer_name).toBe('Bolt')
  })

  it('table_read by {{row.row_id}}: a Label, a read-only field and a variable', async () => {
    const res = await run(USER, 'r_read', {}, { row: { row_id: ROW2 } })
    expect(res.values).toMatchObject({ summary: 'Bolt', address: 'NZ' })
    expect(res.vars).toEqual({ customer_tier: 'B-2' })
    // The browser sends the read-only value back with the submission: kept (a rule of the saved form fills it).
    const merged = mergeTaskFieldValues({ fields: FIELDS, form_layout: LAYOUT }, { address: 'NZ' })
    expect(merged.templateValues.address).toBe('NZ')
  })

  it('table_create: mapped values (form, user), the new row id into a field and {{result.row_id}} for its steps', async () => {
    const res = await run(USER, 'r_create', { email: 'ada@example.com' })
    expect(writes.upsert[0].list).toEqual([{ data: { sku: 'ada@example.com', name: 'Created by Ada', price: '5' } }])
    expect(res.values!.new_id).toBe('new-row-1')
    expect(res.result).toEqual({ row_id: 'new-row-1' })
  })

  it('table_update by a filter from the row; table_delete by the row\'s hidden id', async () => {
    await run(USER, 'r_update', {}, { row: { sku: 'A-1', price: 99 } })
    expect(writes.update).toEqual([{ tableId: PRODUCTS, rowId: ROW1, cells: { price: 99 } }, { tableId: PRODUCTS, rowId: ROW2, cells: { price: 99 } }].slice(0, 2))
    await run(USER, 'r_delete', {}, { row: { source_id: ROW1 } })
    expect(writes.del).toEqual([{ tableId: PRODUCTS, rowId: ROW1 }])
  })

  it('a tampered client reaches nothing: an unknown rule, a client-only step, or another index', async () => {
    await expect(run(USER, 'r_nope')).rejects.toThrow(/no server action/)
    await expect(run(USER, 'r_delete', {}, null, 1)).rejects.toThrow(/no server action/) // remove_list_row runs in the browser
    await expect(runRuleAction(USER, { form_id: FORM }, { rule_id: 'r_list', action_index: 0, values: {}, idempotency_key: 'key-tamper-1', ...( { action: { type: 'table_delete', table_id: PRODUCTS } } as any) })).resolves.toBeTruthy()
    expect(writes.del).toEqual([]) // the sent "action" is ignored: the saved list step ran
  })

  it('permissions: reads need data.view and writes data.manage_rows of the person — unless the author opened the step', async () => {
    await expect(run(ctx(['forms.submit']), 'r_list', { country: 'NZ' })).rejects.toThrow(/data\.view/)
    await expect(run(ctx(['forms.submit', 'data.view']), 'r_create', { email: 'x' })).rejects.toThrow(/data\.manage_rows/)
    forms[FORM].layout = { ...LAYOUT, rules: LAYOUT.rules.map((r: any) => (r.id === 'r_create' ? { ...r, then: [{ ...r.then[0], open_access: true }] } : r)) }
    await expect(run(ctx(['forms.submit']), 'r_create', { email: 'x' })).resolves.toMatchObject({ values: { new_id: 'new-row-1' } })
  })

  it('anonymous forms: only steps marked "Allow for anonymous"', async () => {
    await expect(run(anon(), 'r_list', { country: 'NZ' })).rejects.toThrow(/not available on a public form/)
    await expect(run(anon(), 'r_delete', {}, { row: { source_id: ROW2 } })).resolves.toBeTruthy()
    expect(writes.del).toEqual([{ tableId: PRODUCTS, rowId: ROW2 }])
  })
})

describe('API references', () => {
  it('waits: inputs mapped, timeout, the response rows filtered / sorted locally → options (nothing else leaves the server)', async () => {
    const res = await run(USER, 'r_states', { country: 'NZ' })
    expect(refCalls[0].inputValues).toEqual({ country: 'NZ' })
    expect(res.options).toEqual({ state: [{ value: 'AKL', label: 'Auckland' }, { value: 'WLG', label: 'Wellington' }] })
    expect(JSON.stringify(res)).not.toContain('LEAK')
    const crm = await run(USER, 'r_lookup', { email: 'ada@example.com' })
    expect(refCalls[1].timeout).toBe(4000)
    expect(crm.values).toEqual({ customer_name: 'Acme Ltd', address: 'Wellington' })
    expect(JSON.stringify(crm)).not.toContain('4111')
  })

  it('fire and forget: queued, "Sent", nothing written', async () => {
    const res = await run(USER, 'r_fire', { email: 'ada@example.com' })
    expect(res).toMatchObject({ queued: true, text: 'Sent' })
    expect(refCalls).toEqual([])
    await deferred[0]()
    expect(refCalls[0].inputValues).toEqual({ email: 'ada@example.com' })
  })

  it('the error path: a friendly message (the browser runs the step\'s on-failure steps with it)', async () => {
    await expect(run(USER, 'r_lookup', { email: 'nobody@example.com' })).rejects.toThrow(/found nothing/)
  })
})

describe('in the browser: branches, row buttons, update row, cascades', () => {
  function host(values: Record<string, unknown>, answer: (action: any) => any) {
    const state = { values: { ...values }, messages: [] as string[] }
    const fields = normalizeTaskFields(FIELDS)
    const h: any = {
      values: () => state.values, state: () => ({ flags: {}, hidden: [] }), setValues: (p: any) => { state.values = { ...state.values, ...p } }, setState: () => {}, flush: async () => {},
      goTo: () => true, next: () => true, back: () => true, validate: () => true, submit: () => true, saveDraft: () => true, print: () => {}, openLink: () => true,
      message: (t: string) => { state.messages.push(t) }, editableKeys: new Set(fields.map((f) => f.key)), blank: () => null, field: (k: string) => fields.find((f) => f.key === k),
      runExtra: async (_i: number, action: any) => answer(action),
    }
    return { h, state }
  }

  it('on success: {{result.*}} in its steps; on failure: {{error.message}}, then the rule stops', async () => {
    const [create] = normalizeFormRules(LAYOUT.rules).filter((r) => r.id === 'r_create')
    const ok = host({}, () => ({ values: { new_id: 'new-row-1' }, result: { row_id: 'new-row-1' } }))
    await runFieldButton({ actions: create.then }, ok.h)
    expect(ok.state.messages).toEqual(['Created new-row-1'])
    const [lookup] = normalizeFormRules(LAYOUT.rules).filter((r) => r.id === 'r_lookup')
    const failed = host({}, () => { throw new Error('The service found nothing for these values') })
    const r = await runFieldButton({ actions: [...lookup.then, { type: 'message', text: 'never' }] }, failed.h)
    expect(failed.state.values.customer_name).toBe('Not found: The service found nothing for these values')
    expect(failed.state.messages).toEqual([])
    expect(r.stopped).toBe('call_reference_failed')
  })

  it('a row button: {{row.*}} and {{event.row_number}} reach the steps; update a row of the list', async () => {
    expect(ruleValue('row.sku', { values: {}, event: { row: { sku: 'A-1' } } })).toBe('A-1')
    expect(ruleValue('row', { values: { row: 'a field' } })).toBe('a field') // no row event: a field named row
    const t = host({ products: [{ sku: 'A', price: 1 }, { sku: 'B', price: 2 }] }, () => ({}))
    const update = normalizeFieldButtonAction({ type: 'update_list_row', list_field: 'products', row: '{{event.row_number}}', values: { price: '{{event.row.price}}0' } }, { rule: true })!
    await runFieldButton({ actions: [update] }, t.h, { extras: { event: { row_number: 2, row: { price: 7 } } } })
    expect((t.state.values.products as any[]).map((r) => r.price)).toEqual([1, 70])
  })

  it('rule checks: a table step needs its table and a row id / filter; outputs aim at what the form has', () => {
    const known: any = { fieldKeys: new Set(FIELDS.map((f) => f.key).concat('load')), valueKeys: new Set(FIELDS.map((f) => f.key)), pageIds: new Set(), flags: new Set(), fieldTypes: new Map<string, string>([...FIELDS.map((f) => [f.key, f.type] as [string, string]), ['load', 'button']]), variables: new Set(['customer_tier']) }
    for (const r of normalizeFormRules(LAYOUT.rules)) expect(formRuleProblem(r, known), r.id).toBeNull()
    const bad = normalizeFormRules([{ id: 'x', event: 'button_click', target: 'load', then: [{ type: 'table_update', table_id: PRODUCTS, column_values: { price: '1' } }] }])[0]
    expect(formRuleProblem(bad, known)).toMatch(/row id or a filter/)
    const fire = normalizeFormRules([{ id: 'y', event: 'button_click', target: 'load', then: [{ type: 'call_reference', reference_id: 'r', wait: false, outputs: [{ path: 'a', to: 'email' }] }] }])[0]
    expect(formRuleProblem(fire, known)).toMatch(/doesn't wait/)
  })

  it('cascades: a child the new options no longer offer is cleared, a valid one kept; a blank parent clears (or keeps) the options', () => {
    expect(staleChoiceValue('choice', 'OLD', [{ value: 'WLG' }, { value: 'AKL' }])).toBeNull()
    expect(staleChoiceValue('choice', 'WLG', [{ value: 'WLG' }])).toBeUndefined()
    expect(staleChoiceValue('multi_choice', ['WLG', 'OLD'], [{ value: 'WLG' }])).toEqual(['WLG'])
    const binding = normalizeDynamicBinding({ kind: 'table', table_id: PRODUCTS, value: 'code', label: 'name', base_filter: { match: 'all', conditions: [{ column: 'country', operator: 'eq', value: '{{form.country}}' }] } })!
    expect(blankInputsBehaviour(binding, { country: '' })).toBe('clear')
    expect(blankInputsBehaviour(binding, { country: 'NZ' })).toBeNull()
    expect(blankInputsBehaviour({ ...binding, when_inputs_blank: 'keep' } as any, {})).toBe('keep')
    expect((normalizeDynamicBinding({ ...binding, when_inputs_blank: 'keep' }) as any).when_inputs_blank).toBe('keep')
  })

  it('a two- and three-level cascade by rules: each change loads the next control\'s options and clears what no longer fits', async () => {
    const OPTIONS: Record<string, any> = { 'state:NZ': [{ value: 'WLG', label: 'Wellington' }], 'state:AU': [{ value: 'NSW', label: 'New South Wales' }], 'city:WLG': [{ value: 'PNE', label: 'Petone' }], 'city:': [] }
    const values: Record<string, unknown> = { country: 'NZ', state: 'WLG', city: 'PNE' }
    const step = (parent: string, child: string) => normalizeFieldButtonAction({ type: 'call_reference', reference_id: `ref-${child}`, inputs: { parent: `{{form.${parent}}}` }, outputs: [{ path: '', to: child, as: 'options' }] }, { rule: true })!
    const answer = (child: string) => (vals: Record<string, unknown>, parent: string) => {
      const options = OPTIONS[`${child}:${vals[parent] ?? ''}`] ?? []
      const v = vals[child]
      return { values: { __options: { [child]: options }, ...(options.some((o: any) => o.value === v) ? {} : { [child]: null }) } }
    }
    // Country → AU: the state options change and WLG is cleared; then the cleared state empties the cities and clears PNE.
    const cur = { ...values, country: 'AU' }
    const t = host(cur, () => answer('state')(cur, 'country'))
    await runFieldButton({ actions: [step('country', 'state')] }, t.h)
    expect(t.state.values.state).toBeNull()
    const t2 = host(t.state.values, () => answer('city')(t.state.values, 'state'))
    await runFieldButton({ actions: [step('state', 'city')] }, t2.h)
    expect(t2.state.values.city).toBeNull()
    // Draft resume: the saved parent loads options that include the saved child — kept.
    const resume = host(values, () => answer('city')(values, 'state'))
    await runFieldButton({ actions: [step('state', 'city')] }, resume.h)
    expect(resume.state.values.city).toBe('PNE')
  })
})

describe('the designer\'s Test', () => {
  it('runs a list read with sample values and the author\'s rights; paths to click and the TOP 1 note', async () => {
    const out = await testRuleAction(ctx(['forms.edit', 'data.view']), { action: { type: 'table_list', table_id: PRODUCTS, outputs: [{ path: 'name', to: 'customer_name' }] }, fields: FIELDS, layout: LAYOUT })
    expect(out.paths.map((p) => p.path)).toEqual(expect.arrayContaining(['[0].name', '[0].price']))
    expect(out.notice).toMatch(/2 rows returned: only the first is used/)
    expect(out.preview.values.customer_name).toBe('Anvil')
    await expect(testRuleAction(ctx(['forms.edit']), { action: { type: 'table_list', table_id: PRODUCTS } })).rejects.toThrow(/data\.view/)
    await expect(testRuleAction(ctx(['forms.edit', 'data.view']), { action: { type: 'table_delete', table_id: PRODUCTS, row_id: ROW1 } })).rejects.toThrow(/Test runs/)
  })
})

describe('the Agent: reference patterns and build_plan checks', () => {
  it('offers rule_data_actions and cascading_options; the cascade fields pass the designer checks', async () => {
    const { buildReference, SOLUTION_PATTERNS } = await import('@/lib/assistants/tools/node-reference')
    const out: any = buildReference({ patterns: ['solution'] }, { itemSchema: () => null })
    expect(Object.keys(out.patterns)).toEqual(expect.arrayContaining(['rule_data_actions', 'cascading_options']))
    const fake = (v: unknown) => JSON.parse(JSON.stringify(v).replace(/\{\{ref:[a-z_]+\.id\}\}/g, PRODUCTS))
    const cascade = normalizeTaskFields(fake((SOLUTION_PATTERNS as any).cascading_options.fields))
    const { fieldDefinitionProblems } = await import('@/lib/task-field-schema')
    expect(fieldDefinitionProblems(cascade)).toEqual({})
    expect(cascade[1].dynamic?.options).toMatchObject({ kind: 'table', base_filter: { conditions: [{ value: '{{form.country}}' }] } })
  })

  it('build_plan: a list result into one field without a pinning filter / sort is sent back (TOP 1); outputs must aim at the form', async () => {
    const { formRulesProblems } = await import('@/lib/assistants/tools/build-plan')
    const fields = normalizeTaskFields([...FIELDS, { key: 'load', label: 'Load', type: 'button', button: { style: 'secondary', actions: [] } }])
    const layout = (then: any[]) => ({ rules: [{ id: 'r', event: 'button_click', target: 'load', then }] })
    const top = formRulesProblems(fields, layout([{ type: 'table_list', table_id: PRODUCTS, outputs: [{ path: 'name', to: 'customer_name' }] }]))
    expect(top.join(' | ')).toMatch(/TOP 1/)
    expect(formRulesProblems(fields, layout([{ type: 'table_list', table_id: PRODUCTS, limit: 1, sort: [{ column: 'created_at', direction: 'desc' }], outputs: [{ path: 'name', to: 'customer_name' }] }])).filter((p) => /TOP 1/.test(p))).toEqual([])
    expect(formRulesProblems(fields, layout([{ type: 'table_list', table_id: PRODUCTS, outputs: [{ path: '', to: 'products', columns: { nope: 'x' } }] }])).join(' | ')).toMatch(/no column "nope"/)
  })
})

describe('options a rule loaded are checked on submit', () => {
  it('a value the person was offered passes; another is refused (the saved step runs again when nothing is remembered)', async () => {
    const { verifyRuleOptions } = await import('@/lib/services/form-rule-actions')
    expect(await verifyRuleOptions(USER, { form_id: FORM }, { country: 'NZ', state: 'AKL' })).toEqual({})
    const bad = await verifyRuleOptions(USER, { form_id: FORM }, { country: 'NZ', state: 'OLD' }) // inactive: filtered out by the step
    expect(bad.state).toMatch(/"OLD" is not one of the options/)
    expect(await verifyRuleOptions(USER, { form_id: FORM }, { country: 'NZ', state: '' })).toEqual({})
    // Fields no rule loads are not touched.
    expect(await verifyRuleOptions(USER, { form_id: FORM }, { country: 'XX' })).toEqual({})
  })

  it('the submission path refuses it (a reusable form)', async () => {
    const { mergeTaskFieldValuesChecked } = await import('@/lib/forms/task-values')
    const meta = { fields: FIELDS, template_values: {}, form_layout: LAYOUT }
    const ok = await mergeTaskFieldValuesChecked(db as any, TENANT, meta, { country: 'NZ', state: 'WLG' }, { ctx: USER, ruleTarget: { form_id: FORM } })
    expect(ok.errors).toEqual({})
    const bad = await mergeTaskFieldValuesChecked(db as any, TENANT, meta, { country: 'NZ', state: 'NOPE' }, { ctx: USER, ruleTarget: { form_id: FORM } })
    expect(bad.errors.state).toMatch(/not one of the options/)
  })
})

describe('on-load data (form_load rules) and role-gated server steps', () => {
  const ONLOAD = [
    // Options for a choice from a table when the form opens.
    { id: 'r_onload_opts', event: 'form_load', then: [{ type: 'table_list', table_id: PRODUCTS, sort: [{ column: 'name', direction: 'asc' }], outputs: [{ path: '', to: 'state', as: 'options', value_path: 'sku', label_path: 'name' }] }] },
    // A field from an API reference when the form opens.
    { id: 'r_onload_ref', event: 'form_load', then: [{ type: 'call_reference', reference_id: 'ref-crm', inputs: { email: '{{form.email}}' }, outputs: [{ path: 'customer.name', to: 'customer_name' }] }] },
    // Only managers load the price list (judged on the server with its own view of the person).
    { id: 'r_onload_mgr', event: 'form_load', if: { match: 'all', conditions: [{ column: 'user.roles', operator: 'contains', value: 'Manager' }] }, then: [{ type: 'table_list', table_id: PRODUCTS, outputs: [{ path: '', to: 'products' }] }] },
  ]
  beforeEach(() => { forms[FORM].layout = { ...LAYOUT, rules: [...LAYOUT.rules, ...ONLOAD] } })

  it('table_list on form load fills a choice\'s options; call_reference on form load fills a field', async () => {
    const opts = await run(USER, 'r_onload_opts', {})
    expect(opts.options).toEqual({ state: [{ value: 'A-1', label: 'Anvil' }, { value: 'B-2', label: 'Bolt' }] })
    const ref = await run(USER, 'r_onload_ref', { email: 'ada@example.com' })
    expect(ref.values).toEqual({ customer_name: 'Acme Ltd' })
    // The browser dispatches form_load once when the form opens; these rules are what it finds.
    const { rulesForEvent } = await import('@/lib/forms/form-rules')
    expect(rulesForEvent(normalizeFormRules(forms[FORM].layout.rules), { type: 'form_load' }).map((r) => r.id)).toEqual(['r_onload_opts', 'r_onload_ref', 'r_onload_mgr'])
    // A choice whose options a rule loads takes the loaded value on submit (checked against the saved step).
    const { verifyRuleOptions } = await import('@/lib/services/form-rule-actions')
    expect(await verifyRuleOptions(USER, { form_id: FORM }, { state: 'B-2' })).toEqual({})
  })

  it('a step whose condition reads the user runs only when the server\'s own user meets it (roles never taken from the browser)', async () => {
    // u1 has no roles in this workspace: refused, whatever the browser claims.
    await expect(run(USER, 'r_onload_mgr', { user: { roles: ['Manager'] } }, { user: { roles: ['Manager'] } })).rejects.toThrow(/conditions do not hold/)
    // Anonymous visitors have no roles either.
    forms[FORM].layout.rules = forms[FORM].layout.rules.map((r: any) => (r.id === 'r_onload_mgr' ? { ...r, then: [{ ...r.then[0], allow_anonymous: true }] } : r))
    await expect(run(anon(), 'r_onload_mgr', {})).rejects.toThrow(/conditions do not hold/)
  })
})
