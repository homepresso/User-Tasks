/**
 * Autocomplete / lookup fields: config schema + designer problems, the data
 * table query plan (columns restricted, filters with expressions, special
 * characters), reference lookups (mapping via the results path, caching,
 * served items at completion), free-text vs must-exist validation, fill
 * other fields, authorisation by the task (assignee / other user / other
 * tenant / closed task / client config ignored), workflow-variable
 * pre-resolution, the data picker's `_item`, and the export / package id
 * remap. DB semantics (real PostgREST) are in form-lookup-db.test.ts.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- rows and manifests are free-form JSON */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LOOKUP_ROW_ID, lookupConfigProblem, lookupFillValues, lookupItemFields, lookupResultsArray, normalizeLookupConfig,
  preResolveLookupConfig, resolveLookupTemplate, storedItemLabel, templateFieldKeys, toLookupItem,
} from '@/lib/forms/lookup'
import {
  coerceTaskFieldValues, defaultTaskFieldValues, fieldDefinitionProblems, normalizeTaskFields, validateTaskFieldValues,
} from '@/lib/task-field-schema'
import {
  buildTableQueryPlan, clearLookupCache, lookupDeps, lookupScopeValues, lookupSearchTerm, lookupTaskField, previewLookup,
  referenceLookupInputs, resolveLookupSelections,
} from '@/lib/services/form-lookup'
import { remapKnownIds, createEmptyAssetIdMaps } from '@/lib/portability/id-maps'
import { scanAssetReferences } from '@/lib/portability/dependencies'
import { buildDataTree } from '@/lib/workflow-data-picker'
import type { ServiceContext } from '@/lib/services/context'

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const TENANT = u(1)
const OTHER_TENANT = u(2)
const TABLE = u(10)
const REF = u(20)
const ASSIGNEE = u(30)
const OTHER_USER = u(31)
const TASK = u(40)

const tableLookup = {
  source: 'table', table_id: TABLE, search_columns: ['name', 'email'], display_columns: ['name', 'email'],
  filters: [{ column: 'region', operator: 'eq', value: '{{task_data.region}}' }],
  fill: [{ from: 'email', to: 'contact_email' }, { from: 'phone', to: 'contact_phone' }],
}
const FIELDS = [
  { key: 'region', label: 'Region', type: 'text' },
  { key: 'customer', label: 'Customer', type: 'lookup', required: true, lookup: tableLookup },
  { key: 'contact_email', label: 'Email', type: 'email' },
  { key: 'contact_phone', label: 'Phone', type: 'phone' },
]

describe('lookup config schema', () => {
  it('normalises: unknown props dropped, columns validated, bounds clamped, defaults omitted', () => {
    const config = normalizeLookupConfig({
      source: 'table', table_id: TABLE, search_columns: ['name', 'name', 'data->>x', 'bad col', 'email'],
      display_columns: ['name'], value_column: LOOKUP_ROW_ID, max_results: 999, min_chars: 1, extra: 'x',
      filters: [{ column: 'region', operator: 'nope', value: 7 }, { column: '1; drop', operator: 'eq' }, { column: 'active', operator: 'is_set', value: 'ignored' }],
      sort: { column: 'name', direction: 'sideways' }, fill: [{ from: 'email', to: 'Contact Email' }, { from: 'email', to: 'contact_email' }],
    })
    expect(config).toEqual({
      source: 'table', table_id: TABLE, search_columns: ['name', 'email'], display_columns: ['name'], max_results: 50,
      filters: [{ column: 'region', operator: 'eq', value: '7' }, { column: 'active', operator: 'is_set' }],
      sort: { column: 'name', direction: 'asc' }, fill: [{ from: 'email', to: 'contact_email' }],
    })
    expect(normalizeLookupConfig(null)).toEqual({ source: 'table' })
    const ref = normalizeLookupConfig({ source: 'reference', reference_id: REF, input_mappings: { q: '{{search}}', __proto__: 'x', 'bad name!': 'y' }, results_path: 'data.items[]', display_fields: ['name', 'address.city'], value_field: 'id', debounce_ms: 99999, cache_ttl_s: 60, table_id: TABLE })
    expect(ref).toEqual({ source: 'reference', reference_id: REF, input_mappings: { q: '{{search}}' }, results_path: 'data.items', display_fields: ['name', 'address.city'], value_field: 'id', debounce_ms: 2000, cache_ttl_s: 60 })
  })

  it('is part of the field schema (normalizeTaskFields keeps it only on lookups)', () => {
    const [lookup, text] = normalizeTaskFields([
      { key: 'customer', label: 'Customer', type: 'lookup', lookup: { source: 'table', table_id: TABLE } },
      { key: 'note', label: 'Note', type: 'text', lookup: { source: 'table' } },
    ])
    expect(lookup.lookup).toEqual({ source: 'table', table_id: TABLE })
    expect(text.lookup).toBeUndefined()
  })

  it('designer / save problems: source, columns, fill targets, the _item key', () => {
    expect(lookupConfigProblem({ source: 'table' }, 'c', [])).toBe('Choose a data table')
    expect(lookupConfigProblem({ source: 'table', table_id: TABLE }, 'c', [])).toBe('Choose at least one column to search')
    expect(lookupConfigProblem({ source: 'table', table_id: TABLE, search_columns: ['a'] }, 'c', [])).toBe('Choose at least one column to show')
    expect(lookupConfigProblem({ source: 'reference', reference_id: REF, display_fields: ['n'] }, 'c', [])).toBe('Choose the field to store as the value')
    expect(lookupConfigProblem({ source: 'table', table_id: TABLE, search_columns: ['a'], display_columns: ['a'], fill: [{ from: 'a', to: 'ghost' }] }, 'c', ['x'])).toMatch(/unknown field "ghost"/)
    expect(fieldDefinitionProblems(normalizeTaskFields(FIELDS))).toEqual({})
    const clash = normalizeTaskFields([...FIELDS, { key: 'customer_item', label: 'Clash', type: 'text' }])
    expect(fieldDefinitionProblems(clash).customer).toMatch(/customer_item/)
  })

  it('values: single string / multi array, coerced; defaults', () => {
    const fields = normalizeTaskFields([
      { key: 'one', label: 'One', type: 'lookup', lookup: { source: 'table' } },
      { key: 'many', label: 'Many', type: 'lookup', lookup: { source: 'table', multiple: true } },
    ])
    expect(validateTaskFieldValues(fields, { one: { x: 1 }, many: 'a' })).toEqual({ one: 'One has an invalid value' })
    expect(coerceTaskFieldValues(fields, { one: 'v1', many: '["a","b"]' })).toEqual({ one: 'v1', many: ['a', 'b'] })
    expect(defaultTaskFieldValues(fields)).toEqual({ one: null, many: [] })
  })
})

describe('items, templates, fill', () => {
  const config = normalizeLookupConfig({ source: 'reference', reference_id: REF, results_path: 'data.results', display_fields: ['name', 'address.city'], value_field: 'id', fill: [{ from: 'contact.email', to: 'email' }] })

  it('keeps only the configured fields of an item', () => {
    const item = toLookupItem(config, { id: 7, name: 'Alfreds', address: { city: 'Berlin', street: 'Obere Str. 57' }, contact: { email: 'a@x.test', secret: 'nope' }, credit_limit: 5000 })
    expect(item).toEqual({ value: '7', label: 'Alfreds', description: 'Berlin', fields: { name: 'Alfreds', address: { city: 'Berlin' }, id: 7, contact: { email: 'a@x.test' } } })
    expect(lookupItemFields(config)).toEqual(['name', 'address.city', 'id', 'contact.email'])
    expect(toLookupItem(config, { name: 'no id' })).toBeNull()
    expect(storedItemLabel(config, item!.fields, '7')).toBe('Alfreds')
  })

  it('finds the results array by path', () => {
    expect(lookupResultsArray(config, { data: { results: [1, 2] } })).toEqual([1, 2])
    expect(lookupResultsArray({ source: 'reference' }, [3])).toEqual([3])
    expect(lookupResultsArray(config, { data: {} })).toEqual([])
  })

  it('resolves lookup-time templates; workflow variables pre-resolved at task creation', () => {
    const scope = { search: 'al', values: { region: 'EU', tags: ['a'] }, task: { title: 'Complaint 42' } }
    expect(resolveLookupTemplate('{{search}}', scope)).toBe('al')
    expect(resolveLookupTemplate('{{task_data.region}}', scope)).toBe('EU')
    expect(resolveLookupTemplate('{{form.tags}}', scope)).toEqual(['a'])
    expect(resolveLookupTemplate('{{task.title}} / {{task.data.region}} / {{unknown}}', scope)).toBe('Complaint 42 / EU / ')
    expect(templateFieldKeys('{{task_data.region}} {{form.x}} {{search}}')).toEqual(['region', 'x'])
    const pre = preResolveLookupConfig(normalizeLookupConfig({ ...tableLookup, filters: [{ column: 'region', operator: 'eq', value: '{{order_region}}-{{task_data.region}}' }] }), (path) => (path === 'order_region' ? 'NZ' : undefined))
    expect(pre.filters![0].value).toBe('NZ-{{task_data.region}}')
  })

  it('fills other fields from the selected item (null when cleared)', () => {
    const item = toLookupItem(config, { id: 1, name: 'A', contact: { email: 'a@x.test' } })
    expect(lookupFillValues(config, item)).toEqual({ email: 'a@x.test' })
    expect(lookupFillValues(config, null)).toEqual({ email: null })
  })
})

describe('data table query plan', () => {
  const config = normalizeLookupConfig(tableLookup)
  const columns = ['name', 'email', 'phone', 'region']

  it('searches only the configured columns, filters with expressions, limit + 1 for truncation', () => {
    const plan = buildTableQueryPlan(config, columns, { search: 'alf', values: { region: 'EU' } })
    expect(plan).toEqual({
      search: 'data->>name.ilike."%alf%",data->>email.ilike."%alf%"',
      filters: [{ column: 'data->>region', op: 'eq', value: 'EU' }],
      sort: null, limit: 11,
    })
    const prefix = buildTableQueryPlan({ ...config, match: 'prefix', sort: { column: 'name', direction: 'desc' } }, columns, { search: 'alf', values: {} })
    expect(prefix.search).toBe('data->>name.ilike."alf%",data->>email.ilike."alf%"')
    expect(prefix.sort).toEqual({ column: 'data->>name', ascending: false })
  })

  it('refuses columns the table does not have (no arbitrary columns)', () => {
    expect(() => buildTableQueryPlan(config, ['name'], { search: 'a', values: {} })).toThrow(/column "email"/)
  })

  it('escapes the typed text: LIKE wildcards literal, or-filter values quoted, `*` dropped', () => {
    const term = lookupSearchTerm('50%_off, (now) "x"*\\  \u0007')
    expect(term).toBe('50%_off, (now) "x" \\')
    const plan = buildTableQueryPlan({ ...config, search_columns: ['name'] }, columns, { search: term, values: {} })
    // LIKE: \% \_ \\ ; or-filter quoting: \ → \\ and " → \"
    expect(plan.search).toBe('data->>name.ilike."%50\\\\%\\\\_off, (now) \\"x\\" \\\\\\\\%"')
    expect(lookupSearchTerm('x'.repeat(500))).toHaveLength(200)
  })

  it('by-value plans (completion) look up the value column, row ids must be uuids', () => {
    const plan = buildTableQueryPlan(config, columns, { search: '', values: { region: 'EU' } }, { byValues: [u(5), 'not-a-uuid'] })
    expect(plan.filters).toEqual([{ column: 'data->>region', op: 'eq', value: 'EU' }, { column: 'id', op: 'in', value: [u(5)] }])
    expect(plan.search).toBeNull()
    const byEmail = buildTableQueryPlan({ ...config, value_column: 'email' }, columns, { search: '', values: {} }, { byValues: ['a@x.test'] })
    expect(byEmail.filters.at(-1)).toEqual({ column: 'data->>email', op: 'in', value: ['a@x.test'] })
  })

  it('contains filters escape their resolved value', () => {
    const plan = buildTableQueryPlan({ ...config, filters: [{ column: 'name', operator: 'contains', value: '{{task_data.q}}' }] }, columns, { search: '', values: { q: '100%' } })
    expect(plan.filters[0]).toEqual({ column: 'data->>name', op: 'ilike', value: '%100\\%%' })
  })

  it('form values for placeholders: editable fields from the request, read-only from the task', () => {
    const fields = normalizeTaskFields([{ key: 'region', label: 'R', type: 'text', read_only: true }, { key: 'q', label: 'Q', type: 'text' }])
    expect(lookupScopeValues(fields, { region: 'EU', q: 'old' }, { region: 'US', q: 'new', other: 1 })).toEqual({ region: 'EU', q: 'new' })
  })
})

/* ── Service flows with a fake database ─────────────────────────────── */

type Row = Record<string, any>

/** Tiny PostgREST stand-in with `data->>col` paths, `or` of ilikes, `in`, `not is null`. */
function fakeDb(tables: Record<string, Row[]>) {
  const log: Array<{ table: string; filters: string[] }> = []
  const get = (row: Row, field: string) => {
    const [col, key] = field.split('->>')
    if (key === undefined) return row[col]
    const v = row[col]?.[key]
    return v === undefined || v === null ? null : String(v)
  }
  const like = (pattern: string) => {
    let source = ''
    for (let i = 0; i < pattern.length; i++) {
      const ch = pattern[i]
      if (ch === '\\' && i + 1 < pattern.length) source += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      else if (ch === '%') source += '.*'
      else if (ch === '_') source += '.'
      else source += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
    return new RegExp(`^${source}$`, 'i')
  }
  return {
    log,
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = []
      const desc: string[] = []
      let limit = Infinity
      let single = false
      const api: any = {
        select() { return api },
        eq(f: string, v: unknown) { desc.push(`${f}=${v}`); filters.push((r) => String(get(r, f)) === String(v)); return api },
        neq(f: string, v: unknown) { filters.push((r) => String(get(r, f)) !== String(v)); return api },
        is(f: string, v: unknown) { filters.push((r) => (get(r, f) ?? null) === v); return api },
        not(f: string) { filters.push((r) => get(r, f) !== null); return api },
        in(f: string, vs: unknown[]) { desc.push(`${f} in ${vs.join('|')}`); filters.push((r) => vs.map(String).includes(String(get(r, f)))); return api },
        ilike(f: string, p: string) { const re = like(p); filters.push((r) => re.test(String(get(r, f) ?? ''))); return api },
        or(expr: string) {
          desc.push(`or(${expr})`)
          const parts = [...expr.matchAll(/([^,]+?)\.ilike\."((?:[^"\\]|\\.)*)"/g)].map((m) => ({ f: m[1], re: like(m[2].replace(/\\(.)/g, '$1')) }))
          filters.push((r) => parts.some((p) => p.re.test(String(get(r, p.f) ?? ''))))
          return api
        },
        order() { return api },
        limit(n: number) { limit = n; return api },
        abortSignal() { return api },
        maybeSingle() { single = true; return api },
        then(resolve: (v: unknown) => unknown) {
          log.push({ table, filters: desc })
          const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r))).slice(0, limit)
          return Promise.resolve(single ? { data: rows[0] ?? null, error: null } : { data: rows, error: null }).then(resolve)
        },
      }
      return api
    },
  }
}

function seed(overrides: { task?: Partial<Row>; fields?: unknown[] } = {}) {
  return {
    custom_tables: [{ id: TABLE, tenant_id: TENANT, columns: [{ key: 'name' }, { key: 'email' }, { key: 'phone' }, { key: 'region' }, { key: 'secret' }] }],
    custom_table_rows: [
      { id: u(101), tenant_id: TENANT, table_id: TABLE, data: { name: 'Alfreds Futterkiste', email: 'maria@alfreds.test', phone: '030-0074321', region: 'EU', secret: 's1' } },
      { id: u(102), tenant_id: TENANT, table_id: TABLE, data: { name: 'Ana Trujillo', email: 'ana@trujillo.test', phone: '(5) 555-4729', region: 'LATAM', secret: 's2' } },
      { id: u(103), tenant_id: TENANT, table_id: TABLE, data: { name: '50% Off Store', email: 'deals@off.test', phone: '1', region: 'EU', secret: 's3' } },
      { id: u(104), tenant_id: OTHER_TENANT, table_id: TABLE, data: { name: 'Alfa Other Tenant', email: 'x@y.test', region: 'EU' } },
    ],
    tasks: [{ id: TASK, tenant_id: TENANT, title: 'Complaint', status: 'todo', priority: 'medium', assignee_id: ASSIGNEE, assigned_team_id: null, deleted_at: null, metadata: { fields: overrides.fields ?? FIELDS, template_values: { region: 'EU' } }, ...overrides.task }],
    task_assignees: [],
    user_teams: [],
  }
}

let db: ReturnType<typeof fakeDb>
vi.mock('@/lib/services/_shared', async (orig) => ({ ...(await orig() as object), serviceRoleClient: async () => db }))
vi.mock('@/lib/cron-auth', () => ({ createServiceClient: () => db }))

const ctx = (over: Partial<ServiceContext> = {}): ServiceContext => ({
  supabase: db as any, tenantId: TENANT, actorId: ASSIGNEE, permissions: new Set(['tasks.complete']), authKind: 'session', source: 'ui', ...over,
})

describe('lookupTaskField (authorised by the task)', () => {
  beforeEach(() => { db = fakeDb(seed()); clearLookupCache() })

  it('the assignee gets suggestions from the stored config: filtered, tenant-scoped, trimmed', async () => {
    const result = await lookupTaskField(ctx(), TASK, { field_key: 'customer', query: 'alf', values: { region: 'EU' } })
    expect(result.items.map((i) => i.label)).toEqual(['Alfreds Futterkiste'])
    expect(result.items[0]).toEqual({ value: u(101), label: 'Alfreds Futterkiste', description: 'maria@alfreds.test', fields: { name: 'Alfreds Futterkiste', email: 'maria@alfreds.test', row_id: u(101), phone: '030-0074321' } })
    expect(JSON.stringify(result)).not.toContain('s1')
    const rowsQuery = db.log.find((q) => q.table === 'custom_table_rows')!
    expect(rowsQuery.filters).toContain(`tenant_id=${TENANT}`)
  })

  it('filters use the form values: another region, another result', async () => {
    const result = await lookupTaskField(ctx(), TASK, { field_key: 'customer', query: 'a', values: { region: 'LATAM' } })
    expect(result.items.map((i) => i.label)).toEqual(['Ana Trujillo'])
  })

  it('special characters match literally', async () => {
    const result = await lookupTaskField(ctx(), TASK, { field_key: 'customer', query: '50%', values: { region: 'EU' } })
    expect(result.items.map((i) => i.label)).toEqual(['50% Off Store'])
    const none = await lookupTaskField(ctx(), TASK, { field_key: 'customer', query: '5_%', values: { region: 'EU' } })
    expect(none.items).toEqual([])
  })

  it('client-supplied config is ignored: only the field key is used', async () => {
    const result = await lookupTaskField(ctx(), TASK, { field_key: 'customer', query: 'a', values: { region: 'EU' }, ...({ field: { lookup: { search_columns: ['secret'], display_columns: ['secret'] } } } as any) })
    expect(JSON.stringify(result)).not.toMatch(/"s\d"/)
    await expect(lookupTaskField(ctx(), TASK, { field_key: 'region', query: 'a' })).rejects.toThrow(/no lookup field "region"/)
  })

  it('another user, another tenant, a closed task, no permission → refused', async () => {
    await expect(lookupTaskField(ctx({ actorId: OTHER_USER }), TASK, { field_key: 'customer', query: 'a' })).rejects.toThrow(/cannot act on that task/)
    await expect(lookupTaskField(ctx({ tenantId: OTHER_TENANT }), TASK, { field_key: 'customer', query: 'a' })).rejects.toThrow(/Task not found/)
    await expect(lookupTaskField(ctx({ permissions: new Set() }), TASK, { field_key: 'customer', query: 'a' })).rejects.toThrow(/tasks.complete/)
    db = fakeDb(seed({ task: { status: 'completed' } }))
    await expect(lookupTaskField(ctx(), TASK, { field_key: 'customer', query: 'a' })).rejects.toThrow(/closed/)
  })

  it('collaborators, team members and queue managers may act; tenant API keys too', async () => {
    const tables = seed({ task: { assignee_id: null, assigned_team_id: u(50) } })
    tables.user_teams.push({ team_id: u(50), user_id: OTHER_USER } as never)
    db = fakeDb(tables)
    await expect(lookupTaskField(ctx({ actorId: OTHER_USER }), TASK, { field_key: 'customer', query: 'alf', values: { region: 'EU' } })).resolves.toMatchObject({ items: [{ label: 'Alfreds Futterkiste' }] })
    await expect(lookupTaskField(ctx({ actorId: u(77), permissions: new Set(['tasks.complete', 'tasks.manage_queue']) }), TASK, { field_key: 'customer', query: 'al', values: { region: 'EU' } })).resolves.toBeTruthy()
    await expect(lookupTaskField(ctx({ actorId: null, authKind: 'api_key', source: 'api' }), TASK, { field_key: 'customer', query: 'al', values: { region: 'EU' } })).resolves.toBeTruthy()
  })

  it('too few characters → nothing queried', async () => {
    const fields = FIELDS.map((f) => (f.key === 'customer' ? { ...f, lookup: { ...tableLookup, min_chars: 3 } } : f))
    db = fakeDb(seed({ fields }))
    const result = await lookupTaskField(ctx(), TASK, { field_key: 'customer', query: 'al' })
    expect(result).toEqual({ items: [], too_short: true })
    expect(db.log.some((q) => q.table === 'custom_table_rows')).toBe(false)
  })

  it('designer preview needs edit rights and runs the unsaved config', async () => {
    await expect(previewLookup(ctx(), { field: FIELDS[1], query: 'al' })).rejects.toThrow(/workflows.edit/)
    const result = await previewLookup(ctx({ permissions: new Set(['forms.edit']) }), { field: FIELDS[1], query: 'an', values: { region: 'LATAM' } })
    expect(result.items.map((i) => i.label)).toEqual(['Ana Trujillo'])
  })
})

describe('reference lookups', () => {
  const refField = {
    key: 'vendor', label: 'Vendor', type: 'lookup',
    lookup: { source: 'reference', reference_id: REF, input_mappings: { q: '{{search}}', country: '{{task_data.country}}' }, results_path: 'data.items', display_fields: ['name', 'city'], value_field: 'code', cache_ttl_s: 60, fill: [{ from: 'city', to: 'city' }] },
  }
  const fields = [{ key: 'country', label: 'Country', type: 'text' }, refField, { key: 'city', label: 'City', type: 'text' }]
  let calls: any[] = []

  beforeEach(() => {
    db = fakeDb(seed({ fields }))
    clearLookupCache()
    calls = []
    lookupDeps.executeReference = vi.fn(async (opts: any) => {
      calls.push(opts)
      const all = [{ code: 'V1', name: 'Contoso', city: 'Auckland', token: 'secret' }, { code: 'V2', name: 'Litware', city: 'Wellington', token: 'secret' }]
      return { status: 200, data: { data: { items: all.filter((v) => v.name.toLowerCase().includes(String(opts.inputValues.q).toLowerCase()) || v.code === opts.inputValues.q) } } }
    }) as any
  })

  it('maps the typed text + other fields into inputs; results via the path; trimmed; credentials stay server-side', async () => {
    const result = await lookupTaskField(ctx(), TASK, { field_key: 'vendor', query: 'cont', values: { country: 'NZ' } })
    expect(calls[0]).toMatchObject({ referenceId: REF, inputValues: { q: 'cont', country: 'NZ' }, expectedTenantId: TENANT, caller: { callerType: 'form_lookup', callerId: TASK } })
    expect(result.items).toEqual([{ value: 'V1', label: 'Contoso', description: 'Auckland', fields: { name: 'Contoso', city: 'Auckland', code: 'V1' } }])
    expect(referenceLookupInputs(normalizeLookupConfig(refField.lookup), { search: 'x', values: { country: 'AU' } })).toEqual({ q: 'x', country: 'AU' })
  })

  it('caches responses for the TTL (same inputs), not across different inputs', async () => {
    let now = 1_000_000
    lookupDeps.now = () => now
    await lookupTaskField(ctx(), TASK, { field_key: 'vendor', query: 'cont', values: { country: 'NZ' } })
    const second = await lookupTaskField(ctx(), TASK, { field_key: 'vendor', query: 'cont', values: { country: 'NZ' } })
    expect(second.cached).toBe(true)
    expect(calls).toHaveLength(1)
    await lookupTaskField(ctx(), TASK, { field_key: 'vendor', query: 'lit', values: { country: 'NZ' } })
    expect(calls).toHaveLength(2)
    now += 61_000
    await lookupTaskField(ctx(), TASK, { field_key: 'vendor', query: 'cont', values: { country: 'NZ' } })
    expect(calls).toHaveLength(3)
    lookupDeps.now = () => Date.now()
  })

  it('API failures become friendly errors', async () => {
    lookupDeps.executeReference = vi.fn(async () => { throw new Error('connect ECONNREFUSED 10.0.0.1:443 with api key abc') }) as any
    await expect(lookupTaskField(ctx(), TASK, { field_key: 'vendor', query: 'x' })).rejects.toThrow('The lookup service is not available right now')
    lookupDeps.executeReference = vi.fn(async () => { throw new Error('The operation was aborted due to timeout') }) as any
    await expect(lookupTaskField(ctx(), TASK, { field_key: 'vendor', query: 'y' })).rejects.toThrow(/took too long/)
  })

  it('completion confirms a served value without calling the API again, and stores the item', async () => {
    await lookupTaskField(ctx(), TASK, { field_key: 'vendor', query: 'lit', values: { country: 'NZ' } })
    const before = calls.length
    const res = await resolveLookupSelections(db as any, TENANT, normalizeTaskFields(fields), { vendor: 'V2', country: 'NZ' }, { strict: true, taskId: TASK })
    expect(res).toEqual({ errors: {}, items: { vendor_item: { name: 'Litware', city: 'Wellington', code: 'V2' } }, fills: { city: 'Wellington' } })
    expect(calls.length).toBe(before)
  })

  it('a value never served is re-queried by value; unknown values are refused unless free text is allowed', async () => {
    const parsed = normalizeTaskFields(fields)
    const ok = await resolveLookupSelections(db as any, TENANT, parsed, { vendor: 'V1' }, { strict: true, taskId: u(999) })
    expect(ok.items.vendor_item).toEqual({ name: 'Contoso', city: 'Auckland', code: 'V1' })
    const bad = await resolveLookupSelections(db as any, TENANT, parsed, { vendor: 'V9' }, { strict: true, taskId: u(999) })
    expect(bad.errors.vendor).toMatch(/choose one of the suggestions/)
    const free = normalizeTaskFields(fields.map((f) => (f.key === 'vendor' ? { ...refField, lookup: { ...refField.lookup, allow_free_text: true } } : f)))
    const allowed = await resolveLookupSelections(db as any, TENANT, free, { vendor: 'Typed by hand' }, { strict: true })
    expect(allowed).toEqual({ errors: {}, items: { vendor_item: null }, fills: { city: null } })
    const draft = await resolveLookupSelections(db as any, TENANT, parsed, { vendor: 'V9' }, { strict: false })
    expect(draft.errors).toEqual({})
  })
})

describe('completion checks for table lookups (mergeTaskFieldValuesChecked)', () => {
  beforeEach(() => { db = fakeDb(seed()); clearLookupCache() })

  it('stores <key>_item from the source, never from the client; refuses values not in the source', async () => {
    const { mergeTaskFieldValuesChecked } = await import('@/lib/forms/task-values')
    const meta = seed().tasks[0].metadata
    const ok = await mergeTaskFieldValuesChecked(db as any, TENANT, meta, { customer: u(101), customer_item: { name: 'Forged' }, region: 'EU' }, { taskId: TASK })
    expect(ok.errors).toEqual({})
    expect(ok.templateValues.customer).toBe(u(101))
    expect(ok.templateValues.customer_item).toEqual({ name: 'Alfreds Futterkiste', email: 'maria@alfreds.test', row_id: u(101), phone: '030-0074321' })
    // The filter applies at completion too: an EU customer with region LATAM is refused.
    const filtered = await mergeTaskFieldValuesChecked(db as any, TENANT, meta, { customer: u(101), region: 'LATAM' }, { taskId: TASK })
    expect(filtered.errors.customer).toMatch(/choose one of the suggestions/)
    const otherTenant = await mergeTaskFieldValuesChecked(db as any, TENANT, meta, { customer: u(104), region: 'EU' }, { taskId: TASK })
    expect(otherTenant.errors.customer).toBeTruthy()
    const missing = await mergeTaskFieldValuesChecked(db as any, TENANT, meta, { region: 'EU' }, { taskId: TASK })
    expect(missing.errors.customer).toBe('Customer is required')
  })

  it('drafts resolve what they can without errors; an unchanged value keeps its stored item', async () => {
    const { mergeTaskFieldValuesChecked } = await import('@/lib/forms/task-values')
    const meta = { ...seed().tasks[0].metadata, template_values: { region: 'EU', customer: u(101), customer_item: { name: 'Stored' } } }
    const draft = await mergeTaskFieldValuesChecked(db as any, TENANT, meta, { customer: 'nonsense' }, { partial: true, taskId: TASK })
    expect(draft.errors).toEqual({})
    expect(draft.templateValues.customer_item).toBeNull()
    const unchanged = await mergeTaskFieldValuesChecked(db as any, TENANT, meta, { customer: u(101) }, { taskId: TASK })
    expect(unchanged.templateValues.customer_item).toEqual({ name: 'Stored' })
  })

  it('fill other fields: read-only targets are computed from the server-verified item, never from the client', async () => {
    const { mergeTaskFieldValuesChecked } = await import('@/lib/forms/task-values')
    const fields = FIELDS.map((f) => (f.key === 'contact_email' || f.key === 'contact_phone' ? { ...f, read_only: true } : f))
    const meta = { fields, template_values: {} }
    const ok = await mergeTaskFieldValuesChecked(db as any, TENANT, meta, { region: 'EU', customer: u(101), contact_email: 'forged@evil.test' }, { taskId: TASK })
    expect(ok.errors).toEqual({})
    expect(ok.templateValues.contact_email).toBe('maria@alfreds.test')
    expect(ok.templateValues.contact_phone).toBe('030-0074321')
    // Cleared lookup: its read-only fill targets are cleared too.
    const fields2 = fields.map((f) => (f.key === 'customer' ? { ...f, required: false } : f))
    const cleared = await mergeTaskFieldValuesChecked(db as any, TENANT, { fields: fields2, template_values: { customer: u(101), contact_email: 'maria@alfreds.test' } }, { region: 'EU', customer: null, contact_email: 'forged@evil.test' }, { taskId: TASK })
    expect(cleared.templateValues.contact_email).toBeNull()
    // An unchanged value fills from its stored item; a draft fills the submitted lookup only.
    const stored = { region: 'EU', customer: u(101), customer_item: { row_id: u(101), email: 'stored@alfreds.test', phone: '1' } }
    const unchanged = await mergeTaskFieldValuesChecked(db as any, TENANT, { fields, template_values: stored }, { customer: u(101), contact_email: 'x' }, { taskId: TASK })
    expect(unchanged.templateValues.contact_email).toBe('stored@alfreds.test')
    const draft = await mergeTaskFieldValuesChecked(db as any, TENANT, { fields, template_values: { region: 'EU' } }, { customer: u(103) }, { partial: true, taskId: TASK })
    expect(draft.templateValues.contact_email).toBe('deals@off.test')
    // Numbers are coerced to the target field's type.
    const typed = FIELDS.map((f) => (f.key === 'contact_phone' ? { ...f, type: 'number', read_only: true } : f))
    const n = await mergeTaskFieldValuesChecked(db as any, TENANT, { fields: typed, template_values: {} }, { region: 'EU', customer: u(103) }, { taskId: TASK })
    expect(n.templateValues.contact_phone).toBe(1)
  })

  it('fill other fields: an editable target always gets the item value, even over typed text', async () => {
    const { mergeTaskFieldValuesChecked } = await import('@/lib/forms/task-values')
    const meta = { fields: FIELDS, template_values: {} }
    const typed = await mergeTaskFieldValuesChecked(db as any, TENANT, meta, { region: 'EU', customer: u(101), contact_email: 'billing@alfreds.test' }, { taskId: TASK })
    expect(typed.templateValues.contact_email).not.toBe('billing@alfreds.test')
    expect(typed.templateValues.contact_email).toBeTruthy()
    expect(typed.templateValues.contact_phone).toBe('030-0074321')
  })

  it('multi-select: every value must exist; the item is an array', async () => {
    const fields = FIELDS.map((f) => (f.key === 'customer' ? { ...f, lookup: { ...tableLookup, multiple: true, filters: [], fill: [] } } : f))
    const { mergeTaskFieldValuesChecked } = await import('@/lib/forms/task-values')
    const meta = { fields, template_values: {} }
    const ok = await mergeTaskFieldValuesChecked(db as any, TENANT, meta, { customer: [u(101), u(102)] }, { taskId: TASK })
    expect(ok.errors).toEqual({})
    expect((ok.templateValues.customer_item as any[]).map((i) => i.name)).toEqual(['Alfreds Futterkiste', 'Ana Trujillo'])
    const bad = await mergeTaskFieldValuesChecked(db as any, TENANT, meta, { customer: [u(101), u(999)] }, { taskId: TASK })
    expect(bad.errors.customer).toMatch(/not one of the available options/)
  })
})

describe('downstream data and portability', () => {
  it('the data picker exposes the value and <key>_item with its item model', () => {
    const groups = buildDataTree({
      nodes: [
        { id: 'ut', type: 'user_task', label: 'Review', config: { fields: FIELDS } },
        { id: 'log', type: 'log', label: 'Log', config: {} },
      ] as any,
      edges: [{ source: 'ut', target: 'log' }] as any,
      currentNodeId: 'log',
    })
    const roots = groups.flatMap((g) => g.roots)
    expect(roots.find((r) => r.path === 'task_data.customer')?.schema).toMatchObject({ type: 'string' })
    const item = roots.find((r) => r.path === 'task_data.customer_item')
    expect(item?.schema).toMatchObject({ type: 'object', fields: expect.arrayContaining([expect.objectContaining({ name: 'name' }), expect.objectContaining({ name: 'email' }), expect.objectContaining({ name: 'row_id' }), expect.objectContaining({ name: 'phone' })]) })
  })

  it('table / reference / integration ids are dependencies and are remapped on import', () => {
    const form = { id: u(60), name: 'Complaint', fields: [FIELDS[1], { key: 'vendor', label: 'Vendor', type: 'lookup', lookup: { source: 'reference', integration_id: u(70), reference_id: REF, display_fields: ['n'], value_field: 'id' } }] }
    const { refs } = scanAssetReferences(form)
    expect(refs).toEqual(expect.arrayContaining([
      { type: 'data_table', id: TABLE, path: ['fields', 0, 'lookup', 'table_id'] },
      { type: 'integration', id: u(70), path: ['fields', 1, 'lookup', 'integration_id'] },
      { type: 'reference', id: REF, path: ['fields', 1, 'lookup', 'reference_id'] },
    ]))
    const maps = createEmptyAssetIdMaps()
    maps.data_table[TABLE] = u(11)
    maps.reference[REF] = u(21)
    maps.integration[u(70)] = u(71)
    const remapped = remapKnownIds(form, maps)
    expect((remapped.fields[0] as any).lookup.table_id).toBe(u(11))
    expect((remapped.fields[1] as any).lookup).toMatchObject({ reference_id: u(21), integration_id: u(71) })
  })
})
