import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServiceContext } from '@/lib/services/context'

/* eslint-disable @typescript-eslint/no-explicit-any -- fake rows */

const TENANT = 'dddddddd-0000-4000-8000-000000000001'
const FORM = 'dddddddd-0000-4000-8000-000000000002'
const TABLE = 'dddddddd-0000-4000-8000-000000000003'
const OTHER_TABLE = 'dddddddd-0000-4000-8000-000000000004'

const COUNTRY = {
  key: 'country', label: 'Country', type: 'choice', options: ['Preview'],
  dynamic: { options: { kind: 'table', table_id: TABLE, value: 'code', label: 'name', base_filter: { match: 'all', conditions: [{ column: 'region', operator: 'eq', value: '{{param.region}}' }] }, sort: [{ column: 'name', direction: 'asc' }] } },
}
const CHART = {
  key: 'chart', label: 'Chart', type: 'custom', custom: { tag: 'ut-chart', version: '1.2.0', value_type: 'json', props: { data: [] } },
  dynamic: { 'props.data': { kind: 'reference', reference_id: 'ref-sales', input_mappings: { region: '{{param.region}}' }, results_path: 'items', columns: [{ key: 'month', as: 'label' }, { key: 'total', as: 'value' }], expects: 'any' } },
}
const QTY = { key: 'qty', label: 'Quantity', type: 'number', max: 100, dynamic: { max: { kind: 'expr', expr: '{{var.limit}}' } } }
const LAYOUT = {
  rows: [],
  params: [{ name: 'region', type: 'text', source: 'url', allowed: ['Oceania', 'Europe', 'Oceania") or (1=1'] }],
  variables: [{ name: 'limit', type: 'number', initial: { kind: 'constant', value: '5' } }],
}

let forms: Record<string, any>
let orCalls: string[]
let ranges: Array<[number, number]>
let clientUsed: string[]
let tableRows: Array<{ id: string; data: Record<string, unknown> }>

function fakeDb(label: string) {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = []
      const api: any = {
        select() { return api }, eq(f: string, v: unknown) { filters.push([f, v]); return api }, in() { return api }, order() { return api },
        range(a: number, b: number) { ranges.push([a, b]); return api }, limit() { return api }, abortSignal() { return api }, maybeSingle() { return api }, is() { return api },
        or(expr: string) { orCalls.push(expr); return api },
        then(resolve: (v: unknown) => unknown) {
          clientUsed.push(`${label}:${table}`)
          const get = (f: string) => filters.find(([k]) => k === f)?.[1]
          if (table === 'forms') return Promise.resolve({ data: get('tenant_id') === TENANT ? forms[String(get('id'))] ?? null : null, error: null }).then(resolve)
          if (table === 'custom_tables') return Promise.resolve({ data: get('id') === TABLE ? { columns: [{ key: 'code', type: 'text' }, { key: 'name', type: 'text' }, { key: 'region', type: 'text' }, { key: 'secret', type: 'text' }] } : null, error: null }).then(resolve)
          if (table === 'custom_table_rows') return Promise.resolve({ data: tableRows, error: null }).then(resolve)
          return Promise.resolve({ data: null, error: null }).then(resolve)
        },
      }
      return api
    },
  }
}

const serviceDb = fakeDb('service')
const callerDb = fakeDb('caller')
vi.mock('@/lib/services/_shared', async (orig) => ({ ...(await orig() as object), serviceRoleClient: async () => serviceDb }))
vi.mock('@/lib/cron-auth', async (orig) => ({ ...(await orig() as object), createServiceClient: () => serviceDb }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: async () => ({ ok: true }) }))

const { resolveDynamicValue, resolveDynamicFields } = await import('@/lib/services/form-dynamic-values')
const { dataTableDeps } = await import('@/lib/services/form-data-table')
const { mergeTaskFieldValuesChecked } = await import('@/lib/forms/task-values')
const { normalizeTaskFields } = await import('@/lib/task-field-schema')

const ctx = (perms: string[], over: Partial<ServiceContext> = {}): ServiceContext => ({ supabase: callerDb as any, tenantId: TENANT, actorId: null, permissions: new Set(perms), authKind: 'api_key', source: 'api', ...over })
const anon = (): ServiceContext => ({ ...ctx([]), authKind: 'anonymous', anonymous: { formId: FORM, ipHash: 'ip', uploads: { enabled: false } } as any })
let refCalls: any[]

beforeEach(() => {
  forms = { [FORM]: { id: FORM, fields: [COUNTRY, CHART, QTY, { key: 'notes', label: 'Notes', type: 'text' }], layout: LAYOUT } }
  orCalls = []
  ranges = []
  clientUsed = []
  refCalls = []
  tableRows = [{ id: 'r1', data: { code: 'NZ', name: 'New Zealand', region: 'Oceania', secret: 'S1' } }, { id: 'r2', data: { code: 'AU', name: 'Australia', region: 'Oceania', secret: 'S2' } }]
  dataTableDeps.executeReference = async (opts: any) => {
    refCalls.push(opts)
    return { status: 200, data: { items: [{ month: 'Jan', total: 3, token: 'LEAK' }, { month: 'Feb', total: 5, token: 'LEAK' }] } } as any
  }
})

describe('server resolution security', () => {
  it('only a source the saved form declares answers: an unbound property or an unknown field is refused', async () => {
    await expect(resolveDynamicValue(ctx(['forms.submit', 'data.view']), { form_id: FORM }, { field_key: 'notes', prop: 'options' })).rejects.toThrow(/no dynamic "options"/)
    await expect(resolveDynamicValue(ctx(['forms.submit', 'data.view']), { form_id: FORM }, { field_key: 'country', prop: 'placeholder' })).rejects.toThrow(/no dynamic/)
    await expect(resolveDynamicValue(ctx(['forms.submit', 'data.view']), { form_id: FORM }, { field_key: 'nope', prop: 'options' })).rejects.toThrow(/no field/)
    await expect(resolveDynamicValue(ctx([]), { form_id: FORM }, { field_key: 'country', prop: 'options' })).rejects.toThrow(/forms.submit/)
  })

  it('a data table runs as the caller (data.view, RLS), projected to the declared columns, the allowlist applies', async () => {
    await expect(resolveDynamicValue(ctx(['forms.submit']), { form_id: FORM }, { field_key: 'country', prop: 'options', params: { region: 'Oceania' } })).rejects.toThrow(/data.view/)
    const res = await resolveDynamicValue(ctx(['forms.submit', 'data.view']), { form_id: FORM }, { field_key: 'country', prop: 'options', values: { __form_params: { region: 'Oceania' } } })
    expect(res.value).toEqual([{ value: 'NZ', label: 'New Zealand' }, { value: 'AU', label: 'Australia' }])
    expect(JSON.stringify(res)).not.toMatch(/S1|S2|secret|Oceania/)
    expect(clientUsed).toContain('caller:custom_table_rows')
    await expect(resolveDynamicValue(ctx(['forms.submit', 'data.view'], { resourceScopes: { table_ids: [OTHER_TABLE] } as any }), { form_id: FORM }, { field_key: 'country', prop: 'options' })).rejects.toThrow(/not allowed to access that table/)
  })

  it('placeholders only narrow: the value is quoted inside the base filter, which is never dropped', async () => {
    await resolveDynamicValue(ctx(['forms.submit', 'data.view']), { form_id: FORM }, { field_key: 'country', prop: 'options', values: { __form_params: { region: 'Oceania") or (1=1' } } })
    expect(orCalls).toEqual(['and(and(data->>region.eq."Oceania\\") or (1=1"))'])
    // A parameter that fails its declaration is refused (nothing is guessed); one left out keeps the filter (matching nothing here).
    await expect(resolveDynamicValue(ctx(['forms.submit', 'data.view']), { form_id: FORM }, { field_key: 'country', prop: 'options', values: { __form_params: { region: 'Mars' } } })).rejects.toThrow(/not one of the allowed values/)
    orCalls = []
    await resolveDynamicValue(ctx(['forms.submit', 'data.view']), { form_id: FORM }, { field_key: 'country', prop: 'options' })
    expect(orCalls).toEqual(['and(and(data->>region.eq.""))'])
  })

  it('caps: options at 500 (or the binding limit), rows at 1,000', async () => {
    await resolveDynamicValue(ctx(['forms.submit', 'data.view']), { form_id: FORM }, { field_key: 'country', prop: 'options' })
    expect(ranges.at(-1)).toEqual([0, 500])
    forms[FORM].fields[0] = { ...COUNTRY, dynamic: { options: { ...COUNTRY.dynamic.options, limit: 20 } } }
    await resolveDynamicValue(ctx(['forms.submit', 'data.view']), { form_id: FORM }, { field_key: 'country', prop: 'options' })
    expect(ranges.at(-1)).toEqual([0, 20])
    tableRows = Array.from({ length: 21 }, (_, i) => ({ id: `r${i}`, data: { code: `C${i}`, name: `N${i}` } }))
    const res = await resolveDynamicValue(ctx(['forms.submit', 'data.view']), { form_id: FORM }, { field_key: 'country', prop: 'options' })
    expect((res.value as unknown[]).length).toBe(20)
    expect(res.truncated).toBe(true)
  })

  it('an API reference runs on the server with the mapped inputs; only the declared fields come back, renamed', async () => {
    const res = await resolveDynamicValue(ctx(['forms.submit']), { form_id: FORM }, { field_key: 'chart', prop: 'props.data', values: { __form_params: { region: 'Europe' } } })
    expect(refCalls[0]).toMatchObject({ referenceId: 'ref-sales', inputValues: { region: 'Europe' }, expectedTenantId: TENANT, readOnly: true })
    expect(res.value).toEqual([{ label: 'Jan', value: 3 }, { label: 'Feb', value: 5 }])
    expect(JSON.stringify(res)).not.toContain('LEAK')
  })

  it('anonymous visitors: refused unless the binding allows anonymous read — then tenant-scoped, still projected', async () => {
    await expect(resolveDynamicValue(anon(), { form_id: FORM }, { field_key: 'country', prop: 'options' })).rejects.toThrow(/not available on a public form/)
    await expect(resolveDynamicValue(anon(), { form_id: FORM }, { field_key: 'chart', prop: 'props.data' })).rejects.toThrow(/not available on a public form/)
    forms[FORM].fields[0] = { ...COUNTRY, dynamic: { options: { ...COUNTRY.dynamic.options, anonymous_read: true } } }
    const res = await resolveDynamicValue(anon(), { form_id: FORM }, { field_key: 'country', prop: 'options' })
    expect(res.value).toHaveLength(2)
    expect(clientUsed).toContain('service:custom_table_rows')
    // Another form's link never reaches this form.
    await expect(resolveDynamicValue({ ...anon(), anonymous: { formId: OTHER_TABLE } as any }, { form_id: FORM }, { field_key: 'country', prop: 'options' })).rejects.toThrow(/Form not found/)
  })

  it('the designer preview needs edit rights (and data.view for a table, integrations.view for an API)', async () => {
    await expect(resolveDynamicValue(ctx(['forms.submit', 'data.view']), { preview_field: COUNTRY }, { field_key: 'country', prop: 'options' })).rejects.toThrow(/forms.edit/)
    await expect(resolveDynamicValue(ctx(['forms.edit']), { preview_field: COUNTRY }, { field_key: 'country', prop: 'options' })).rejects.toThrow(/data.view/)
    await expect(resolveDynamicValue(ctx(['forms.edit']), { preview_field: CHART }, { field_key: 'chart', prop: 'props.data' })).rejects.toThrow(/integrations.view/)
    const res = await resolveDynamicValue(ctx(['forms.edit']), { preview_field: QTY }, { field_key: 'qty', prop: 'max', values: { __form_vars: { limit: '12' } } })
    expect(res.value).toBe(12)
  })

  it('a column the table does not have is refused', async () => {
    forms[FORM].fields[0] = { ...COUNTRY, dynamic: { options: { ...COUNTRY.dynamic.options, value: 'missing' } } }
    await expect(resolveDynamicValue(ctx(['forms.submit', 'data.view']), { form_id: FORM }, { field_key: 'country', prop: 'options' })).rejects.toThrow(/column "missing"/)
  })
})

describe('server-side validation of dynamic choice values', () => {
  const meta = () => ({ fields: forms[FORM].fields, template_values: {}, form_layout: LAYOUT })
  const context = { __form_params: { region: 'Oceania' }, __form_vars: { limit: 5 } }

  it('a value outside the options the server resolves is refused — whatever the browser had', async () => {
    const bad = await mergeTaskFieldValuesChecked(serviceDb as any, TENANT, meta(), { country: 'Preview', qty: 1, ...context }, { ctx: ctx(['forms.submit', 'data.view']), contextFromValues: true })
    expect(bad.errors.country).toMatch(/must be one of: NZ, AU/)
    const ok = await mergeTaskFieldValuesChecked(serviceDb as any, TENANT, meta(), { country: 'AU', qty: 1, ...context }, { ctx: ctx(['forms.submit', 'data.view']), contextFromValues: true })
    expect(ok.errors).toEqual({})
    expect(ok.templateValues.country).toBe('AU')
  })

  it('bounds from a variable are re-resolved on the server', async () => {
    const res = await mergeTaskFieldValuesChecked(serviceDb as any, TENANT, meta(), { country: 'AU', qty: 9, ...context }, { ctx: ctx(['forms.submit', 'data.view']), contextFromValues: true })
    expect(res.errors).toEqual({ qty: 'Quantity must be at most 5' })
  })

  it('a source that fails offers no options: the value is refused with a retry message', async () => {
    forms[FORM].fields[0] = { ...COUNTRY, dynamic: { options: { ...COUNTRY.dynamic.options, table_id: OTHER_TABLE } } }
    const res = await mergeTaskFieldValuesChecked(serviceDb as any, TENANT, meta(), { country: 'AU', qty: 1, ...context }, { ctx: ctx(['forms.submit', 'data.view']), contextFromValues: true })
    expect(res.errors.country).toMatch(/options could not be checked/)
  })

  it('restrict to the list off: other values pass; anonymous without anonymous read gets no options', async () => {
    const fields = normalizeTaskFields([{ ...COUNTRY, dynamic: { options: { ...COUNTRY.dynamic.options, restrict: false } } }])
    const open = await resolveDynamicFields(ctx(['data.view']), TENANT, fields, { country: 'FJ', ...context })
    expect(open.fields[0].options).toEqual(['NZ', 'AU', 'FJ'])
    const blocked = await resolveDynamicFields(anon(), TENANT, normalizeTaskFields([COUNTRY]), { country: 'NZ' })
    expect(blocked.fields[0].options).toEqual([])
    expect(blocked.fields[0].dynamic).toBeUndefined()
  })

  it('drafts (partial saves) do not resolve sources', async () => {
    tableRows = []
    const res = await mergeTaskFieldValuesChecked(serviceDb as any, TENANT, meta(), { country: 'Whatever' }, { partial: true })
    expect(res.errors).toEqual({})
  })
})
