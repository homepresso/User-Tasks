import { describe, expect, it } from 'vitest'
import {
  applyLocally, buildTablePlan, changeCount, conditionTerm, dataTableConfigProblem, dataTableDependencies, normalizeDataTableConfig, normalizeUserQuery,
  preResolveDataTableConfig, projectRow, remoteCapabilities, resolveDataTableTemplate, rowMeetsGroup, validateChangeSet, validateSelection,
  type DataTableFieldConfig,
} from '@/lib/forms/data-table'
import {
  coerceTaskFieldValues, isRuleMet, normalizeTaskFields, validateTaskFieldValues, fieldDefinitionProblems,
} from '@/lib/task-field-schema'
import { normalizeFormButtons } from '@/lib/forms/buttons'
import { normalizeFieldButton } from '@/lib/forms/field-buttons'
import { dataTableValueSchema } from '@/lib/workflow-data-picker'

const TABLE = '11111111-1111-4111-8111-111111111111'
const now = new Date('2026-10-31T12:00:00Z')

function vendors(over: Partial<DataTableFieldConfig> = {}): DataTableFieldConfig {
  return normalizeDataTableConfig({
    source: 'table', table_id: TABLE, mode: 'edit', key_column: 'vendor_id', allow_add: true, allow_delete: true,
    columns: [
      { key: 'vendor_id', label: 'Vendor', type: 'text', sortable: true, filterable: true },
      { key: 'name', label: 'Name', type: 'text', sortable: true, filterable: true, required: true },
      { key: 'payment_terms', label: 'Terms', type: 'number', sortable: true, filterable: true, min: 0, max: 120 },
      { key: 'risk', label: 'Risk', type: 'choice', options: ['Low', 'Medium', 'High'] },
      { key: 'active', label: 'Active', type: 'boolean' },
      { key: 'iban', label: 'IBAN', type: 'text', hidden: true },
    ],
    base_filter: { match: 'all', conditions: [{ column: 'country', operator: 'eq', value: '{{form.country}}' }, { match: 'any', conditions: [{ column: 'active', operator: 'eq', value: 'true' }, { column: 'owner', operator: 'eq', value: '{{user.email}}' }] }] },
    sort: [{ column: 'payment_terms', direction: 'desc' }, { column: 'name', direction: 'asc' }],
    page_size: 5,
    ...over,
  })
}

describe('Data table config', () => {
  it('normalizes: keys validated, unknown props dropped, bounds clamped, one nested group level', () => {
    const c = normalizeDataTableConfig({
      source: 'table', table_id: TABLE, mode: 'nope', page_size: 5000, evil: 1,
      columns: [{ key: 'ok', label: 'OK', type: 'weird' }, { key: 'bad key', label: 'x' }, { key: '__proto__' }, { key: 'ok', label: 'dup' }],
      base_filter: { match: 'all', conditions: [{ match: 'any', conditions: [{ match: 'all', conditions: [{ column: 'deep', operator: 'eq', value: '1' }] }, { column: 'a', operator: 'gt', value: '1' }] }] },
    })
    expect(c.mode).toBe('display')
    expect(c.page_size).toBe(100)
    expect(c.columns).toEqual([{ key: 'ok', label: 'OK', type: 'text' }])
    expect(JSON.stringify(c.base_filter)).not.toContain('deep')
    expect((c as unknown as Record<string, unknown>).evil).toBeUndefined()
  })

  it('flags missing sources / columns / keys', () => {
    expect(dataTableConfigProblem(normalizeDataTableConfig({ source: 'table' }))).toBe('Choose a data table')
    expect(dataTableConfigProblem(normalizeDataTableConfig({ source: 'reference' }))).toBe('Choose an API reference')
    expect(dataTableConfigProblem(normalizeDataTableConfig({ source: 'table', table_id: TABLE }))).toBe('Choose at least one column')
    expect(dataTableConfigProblem(normalizeDataTableConfig({ source: 'reference', reference_id: 'r', mode: 'select', columns: [{ key: 'id', label: 'Id' }], key_column: 'missing' }))).toMatch(/key column/)
    expect(dataTableConfigProblem(vendors())).toBeNull()
  })

  it('old forms are unchanged: other field types keep their stored shape', () => {
    const old = [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'customer', label: 'Customer', type: 'lookup', lookup: { source: 'table', table_id: TABLE, search_columns: ['name'], display_columns: ['name'] } },
      { key: 'go', label: 'Go', type: 'button', button: { style: 'primary', actions: [{ type: 'message', text: 'Hi' }] } },
    ]
    expect(normalizeTaskFields(old)).toEqual(normalizeTaskFields(normalizeTaskFields(old)))
    expect(JSON.stringify(normalizeTaskFields(old))).not.toContain('data_table')
    expect(normalizeFormButtons([{ id: 'submit', label: 'Submit', kind: 'submit', style: 'primary', actions: [{ type: 'start_workflow', workflow_id: TABLE }] }])[0].actions).toEqual([{ type: 'start_workflow', workflow_id: TABLE }])
    expect(normalizeFieldButton({ style: 'primary', actions: [{ type: 'apply_table_changes', table_changes: { field: 'lines', target: 'table', table_id: TABLE, mapping: { name: '{{row.name}}' } } }] }).actions[0].type).toBe('apply_table_changes')
  })

  it('round-trips through the field schema with fieldDefinitionProblems', () => {
    const [field] = normalizeTaskFields([{ key: 'lines', label: 'Lines', type: 'data_table', data_table: vendors() }])
    expect(field.data_table).toEqual(vendors())
    expect(fieldDefinitionProblems([field])).toEqual({})
    expect(fieldDefinitionProblems(normalizeTaskFields([{ key: 'x', label: 'X', type: 'data_table', data_table: { source: 'table' } }]))).toEqual({ x: 'Choose a data table' })
  })
})

describe('templates and dependencies', () => {
  it('form values, the current user and date expressions', () => {
    const scope = { values: { country: 'NZ', n: 5 }, user: { id: 'u1', email: 'ada@x.test', name: 'Ada' }, now }
    expect(resolveDataTableTemplate('{{form.country}}', scope)).toBe('NZ')
    expect(resolveDataTableTemplate('{{task_data.n}}', scope)).toBe(5)
    expect(resolveDataTableTemplate('{{user.email}}', scope)).toBe('ada@x.test')
    expect(resolveDataTableTemplate('{{today}}', scope)).toBe('2026-10-31')
    expect(resolveDataTableTemplate('{{today-7d}}', scope)).toBe('2026-10-24')
    expect(resolveDataTableTemplate('{{today+1m}}', scope)).toBe('2026-12-01')
    expect(resolveDataTableTemplate('{{start_of_month}}', scope)).toBe('2026-10-01')
    expect(resolveDataTableTemplate('Hi {{user.name}} ({{unknown.x}})', scope)).toBe('Hi Ada ()')
  })

  it('refreshes on the form fields the config reads', () => {
    expect(dataTableDependencies(vendors())).toEqual(['country'])
  })

  it('workflow variables are pre-resolved at task creation; query-time paths stay', () => {
    const c = preResolveDataTableConfig(vendors({ base_filter: { match: 'all', conditions: [{ column: 'region', operator: 'eq', value: '{{order_region}} {{form.country}} {{today}}' }] } }), (p) => (p === 'order_region' ? 'EU' : undefined))
    expect((c.base_filter!.conditions[0] as { value: string }).value).toBe('EU {{form.country}} {{today}}')
  })
})

describe('the user query is bounded by the author', () => {
  it('filters only on filterable columns, sorts only on sortable ones', () => {
    const c = vendors()
    expect(() => normalizeUserQuery(c, { filters: [{ column: 'iban', operator: 'eq', value: 'x' }] })).toThrow(/can't filter/)
    expect(() => normalizeUserQuery(c, { filters: [{ column: 'country', operator: 'eq', value: 'x' }] })).toThrow(/can't filter/)
    expect(() => normalizeUserQuery(c, { sort: [{ column: 'risk' }] })).toThrow(/can't sort/)
    expect(() => normalizeUserQuery(c, { filters: [{ column: 'payment_terms', operator: 'contains', value: '3' }] })).toThrow(/not available/)
    const q = normalizeUserQuery(c, { search: 'ac*me\u0000', filters: [{ column: 'payment_terms', operator: 'gte', value: '30' }], page: 3, page_size: 500 })
    expect(q).toMatchObject({ search: 'ac me', page: 3, page_size: 5, sort: c.sort })
  })

  it('the base filter is always first and the user only adds AND terms', () => {
    const c = vendors()
    const scope = { values: { country: 'NZ' }, user: { email: 'ada@x.test' }, now }
    const q = normalizeUserQuery(c, { search: 'o', filters: [{ column: 'payment_terms', operator: 'gte', value: '30' }] })
    const plan = buildTablePlan(c, q, scope, { country: 'text', owner: 'text', active: 'boolean' })
    expect(plan.where).toBe('and(and(data->>country.eq."NZ",or(data->active.eq.true,data->>owner.eq."ada@x.test")),data->payment_terms.gte.30,or(data->>vendor_id.ilike."*o*",data->>name.ilike."*o*",data->>risk.ilike."*o*"))')
    expect(plan.order).toEqual([{ column: 'data->payment_terms', ascending: false }, { column: 'data->name', ascending: true }])
    expect(plan).toMatchObject({ offset: 0, limit: 5 })
    // A user trying to smuggle an OR into a value: it is quoted, never parsed.
    const sneaky = buildTablePlan(c, normalizeUserQuery(c, { filters: [{ column: 'name', operator: 'eq', value: 'x",or(id.not.is.null' }] }), scope)
    expect(sneaky.where).toContain('data->>name.eq."x\\",or(id.not.is.null"')
    expect(sneaky.where!.startsWith('and(and(data->>country.eq."NZ"')).toBe(true)
  })

  it('a missing form value still constrains (empty string, not "no filter")', () => {
    const plan = buildTablePlan(vendors(), normalizeUserQuery(vendors(), {}), { values: {}, now })
    expect(plan.where).toContain('data->>country.eq.""')
  })

  it('a base-filter value that does not fit (a number left blank) matches nothing instead of being dropped', () => {
    const c = vendors({ base_filter: { match: 'all', conditions: [{ column: 'payment_terms', operator: 'gte', value: '{{form.min_terms}}' }] } })
    expect(buildTablePlan(c, normalizeUserQuery(c, {}), { values: {}, now }).where).toBe('and(and(id.is.null))')
    expect(buildTablePlan(c, normalizeUserQuery(c, {}), { values: { min_terms: 30 }, now }).where).toBe('and(and(data->payment_terms.gte.30))')
    expect(rowMeetsGroup(c, { payment_terms: 50 }, c.base_filter, { values: {}, now })).toBe(false)
  })

  it('condition terms: LIKE wildcards literal, numbers checked, lists', () => {
    expect(conditionTerm('name', 'text', 'contains', '50%_off')).toBe('data->>name.ilike."*50\\\\%\\\\_off*"')
    expect(() => conditionTerm('n', 'number', 'gt', 'abc')).toThrow('Enter a number')
    expect(conditionTerm('n', 'number', 'in', '1, 2')).toBe('data->n.in.(1,2)')
    expect(conditionTerm('s', 'text', 'in', 'a,b"c')).toBe('data->>s.in.("a","b\\"c")')
    expect(conditionTerm('row_id', 'text', 'eq', 'not-a-uuid')).toBe('id.is.null')
  })
})

describe('projection and local evaluation (API sources)', () => {
  const api = normalizeDataTableConfig({
    source: 'reference', reference_id: 'r1', mode: 'select', multiple: true, key_column: 'id', results_path: 'data.items',
    input_mappings: { q: '{{search}}', p: '{{page}}' },
    columns: [{ key: 'id', label: 'Id', type: 'text' }, { key: 'name', label: 'Name', type: 'text', sortable: true, filterable: true }, { key: 'meta.score', label: 'Score', type: 'number', sortable: true, filterable: true }],
    base_filter: { match: 'all', conditions: [{ column: 'meta.score', operator: 'gte', value: '10' }] },
  })

  it('only the declared columns leave the server', () => {
    const row = projectRow(api, { id: 7, name: 'Acme', secret: 'x', meta: { score: 42, token: 't' } })
    expect(row).toEqual({ key: '7', values: { id: 7, name: 'Acme', 'meta.score': 42 } })
    expect(JSON.stringify(row)).not.toMatch(/secret|token/)
    expect(projectRow(api, { name: 'no key' })).toBeNull()
  })

  it('what the API does vs what the server applies to the fetched rows', () => {
    expect(remoteCapabilities(api)).toEqual({ search: true, sort: false, page: true, filters: [] })
    const rows = [5, 50, 20, 15].map((s, i) => projectRow(api, { id: i, name: `n${i}`, meta: { score: s } })!)
    const q = normalizeUserQuery(api, { sort: [{ column: 'meta.score', direction: 'desc' }], filters: [{ column: 'meta.score', operator: 'lt', value: '40' }] })
    const out = applyLocally(api, rows, q, { values: {}, now }, remoteCapabilities(api))
    expect(out.rows.map((r) => r.values['meta.score'])).toEqual([20, 15]) // base filter (>= 10) applied, then the user's < 40
    expect(out.local).toEqual(['filters', 'sort'])
    expect(out.total).toBeNull()
  })

  it('local paging and search when the API does neither', () => {
    const plain = normalizeDataTableConfig({ ...api, input_mappings: undefined, page_size: 2 })
    const rows = ['alpha', 'beta', 'alphabet', 'gamma', 'alps'].map((n, i) => projectRow(plain, { id: i, name: n, meta: { score: 99 } })!)
    const out = applyLocally(plain, rows, normalizeUserQuery(plain, { search: 'alp', page: 2 }), { values: {}, now }, remoteCapabilities(plain))
    expect(out).toMatchObject({ total: 3, local: ['search', 'page'] })
    expect(out.rows.map((r) => r.values.name)).toEqual(['alps'])
  })

  it('base filter groups evaluate AND / OR', () => {
    const c = vendors()
    const scope = { values: { country: 'NZ' }, user: { email: 'ada@x.test' }, now }
    expect(rowMeetsGroup(c, { country: 'NZ', active: false, owner: 'ada@x.test' }, c.base_filter, scope)).toBe(true)
    expect(rowMeetsGroup(c, { country: 'NZ', active: false, owner: 'bob' }, c.base_filter, scope)).toBe(false)
    expect(rowMeetsGroup(c, { country: 'AU', active: true }, c.base_filter, scope)).toBe(false)
  })
})

describe('values: selections and change sets', () => {
  it('a change set is validated against the declared columns and key', () => {
    const { changes, errors } = validateChangeSet(vendors(), {
      added: [{ vendor_id: 'V-9', name: 'New', payment_terms: '30', risk: 'Low', iban: 'sneaky', not_a_column: 1 }],
      updated: [{ key: 'V-1', before: { name: 'Old', payment_terms: 30 }, after: { name: 'Renamed', payment_terms: 30, vendor_id: 'V-HIJACK' } }],
      deleted: [{ key: 'V-2', before: {} }],
    })
    expect(errors).toEqual([])
    // Unknown keys and hidden columns (people can't see them) are dropped; cells are typed.
    expect(changes.added).toEqual([{ vendor_id: 'V-9', name: 'New', payment_terms: 30, risk: 'Low' }])
    expect(changes.updated).toEqual([{ key: 'V-1', before: { name: 'Old', payment_terms: 30 }, after: { name: 'Renamed', payment_terms: 30 }, changed_fields: ['name'] }])
    expect(changes.deleted).toEqual([{ key: 'V-2', before: {} }])
  })

  it('type, required, choice and bounds errors; adds / deletes only when allowed; caps', () => {
    const c = vendors({ allow_add: false, allow_delete: false, max_rows: 2 })
    expect(validateChangeSet(c, { added: [{ name: 'x' }], deleted: [{ key: 'a' }] }).errors).toEqual(['Adding rows is not allowed on this table', 'Deleting rows is not allowed on this table'])
    expect(validateChangeSet(c, { updated: [{ key: 'a', after: {} }, { key: 'b', after: {} }, { key: 'c', after: {} }] }).errors[0]).toMatch(/At most 2/)
    const bad = validateChangeSet(vendors(), { added: [{ payment_terms: 'abc', risk: 'Extreme' }], updated: [{ key: 'V-1', after: { payment_terms: 500 } }, { key: 'V-1', after: {} }], deleted: [{ key: '' }] })
    expect(bad.errors).toEqual(expect.arrayContaining([
      'New row 1: Terms must be a number', 'New row 1: Risk must be one of: Low, Medium, High', 'New row 1: Name is required',
      'Row V-1: Terms must be at most 120', 'Row "V-1" is changed twice', 'Deleted row 1 has no key',
    ]))
    expect(validateChangeSet(vendors(), 'not an object').errors).toEqual(['The table changes are not in the expected shape'])
  })

  it('selections: keys, uniqueness, single vs multiple, declared columns only', () => {
    const sel = normalizeDataTableConfig({ ...vendors(), mode: 'select', multiple: false })
    expect(validateSelection(sel, [{ vendor_id: 'V-1', name: 'A', secret: 'x' }]).rows).toEqual([{ vendor_id: 'V-1', name: 'A', payment_terms: null, risk: null, active: null, iban: null }])
    expect(validateSelection(sel, [{ vendor_id: 'V-1' }, { vendor_id: 'V-2' }]).errors).toEqual(['Choose one row'])
    expect(validateSelection(sel, [{ name: 'no key' }]).errors).toEqual(['A selected row has no key'])
  })

  it('field validation, coercion, the visible-when rule and the data picker model', () => {
    const fields = normalizeTaskFields([
      { key: 'lines', label: 'Lines', type: 'data_table', required: true, data_table: vendors() },
      { key: 'note', label: 'Note', type: 'text', visible_when: { field: 'lines', operator: 'is_set' } },
    ])
    expect(validateTaskFieldValues(fields, { lines: null })).toEqual({ lines: 'Lines: make at least one change' })
    expect(validateTaskFieldValues(fields, { lines: { added: [{ payment_terms: 'x', name: 'n' }] } }).lines).toMatch(/Terms must be a number/)
    const value = { updated: [{ key: 'V-1', before: { name: 'a' }, after: { name: 'b' } }] }
    expect(validateTaskFieldValues(fields, { lines: value })).toEqual({})
    expect(coerceTaskFieldValues(fields, { lines: value }).lines).toEqual({ added: [], updated: [{ key: 'V-1', before: { name: 'a' }, after: { name: 'b' }, changed_fields: ['name'] }], deleted: [] })
    expect(isRuleMet(fields[1].visible_when, { lines: value })).toBe(true)
    expect(isRuleMet(fields[1].visible_when, { lines: { added: [], updated: [], deleted: [] } })).toBe(false)
    expect(changeCount(value)).toBe(1)
    const schema = dataTableValueSchema(fields[0])
    expect(schema.fields?.map((f) => f.name)).toEqual(['added', 'updated', 'deleted'])
    expect(schema.fields?.[0].items?.fields?.find((f) => f.name === 'payment_terms')?.type).toBe('number')
    const select = dataTableValueSchema(normalizeTaskFields([{ key: 's', label: 'S', type: 'data_table', data_table: { ...vendors(), mode: 'select' } }])[0])
    expect(select.type).toBe('array')
  })
})

describe('exports and packages carry the field and its rules', () => {
  it('ids inside the field and the rules are dependencies and are remapped on install', async () => {
    const { scanAssetReferences } = await import('@/lib/portability/dependencies')
    const { createEmptyAssetIdMaps, remapKnownIds } = await import('@/lib/portability/id-maps')
    const { normalizeFormDefinition } = await import('@/lib/forms/definition')
    const REF = '22222222-2222-4222-8222-222222222222'
    const INTEG = '33333333-3333-4333-8333-333333333333'
    const WF = '44444444-4444-4444-8444-444444444444'
    const form = {
      fields: [{ key: 'lines', label: 'Lines', type: 'data_table', data_table: { ...vendors(), source: 'table' } },
        { key: 'go', label: 'Apply', type: 'button', button: { style: 'primary', actions: [{ type: 'apply_table_changes', table_changes: { field: 'lines', target: 'reference', reference_id: REF, integration_id: INTEG } }] } }],
      buttons: [{ id: 'submit', label: 'Submit', kind: 'submit', style: 'primary', actions: [{ type: 'apply_table_changes', table_changes: { field: 'lines', target: 'workflow', workflow_id: WF } }] }],
    }
    const def = normalizeFormDefinition(form)
    const { refs } = scanAssetReferences(def)
    expect([...new Set(refs.map((r) => `${r.type}:${r.id}`))].sort()).toEqual([`data_table:${TABLE}`, `integration:${INTEG}`, `reference:${REF}`, `workflow:${WF}`].sort())
    const maps = createEmptyAssetIdMaps()
    maps.data_table[TABLE] = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    maps.reference[REF] = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    maps.workflow[WF] = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    const remapped = remapKnownIds(def, maps)
    expect(JSON.stringify(remapped)).not.toMatch(new RegExp(`${TABLE}|${REF}|${WF}`))
    expect(normalizeFormDefinition(remapped).fields[0].data_table?.table_id).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  })
})
