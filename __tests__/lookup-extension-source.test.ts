import { beforeEach, describe, expect, it, vi } from 'vitest'

const query = vi.fn()
const lists = vi.fn()
vi.mock('@/lib/extensions/server-registry', () => {
  const ext = { id: 'sp', lookupSources: { list: { label: 'SharePoint', query: (i: unknown) => query(i), lists: (i: unknown) => lists(i) } } }
  return { getServerExtension: (id: string) => (id === 'sp' ? ext : null), getServerExtensions: () => [ext] }
})
vi.mock('@/lib/extensions/host', () => ({ createExtensionContext: (o: unknown) => ({ host: o }) }))

import { lookupConfigProblem, lookupValueField, normalizeLookupConfig, toLookupItem, type LookupConfig } from '@/lib/forms/lookup'
import { buildExtensionQueryPlan, extensionLookupLists, queryExtensionList } from '@/lib/services/form-lookup'
import { describeBinding, isSourceBinding, normalizeDynamicBinding, shapeRows, type ExtensionBinding } from '@/lib/forms/dynamic-values'
import { runSourceBinding } from '@/lib/services/form-dynamic-values'

const CONFIG: LookupConfig = normalizeLookupConfig({
  source: 'extension', extension: 'sp', provider: 'list', source_id: 'lookup:11111111-1111-4111-8111-111111111111:Dept', source_label: 'SharePoint: <b>Departments</b>',
  search_columns: ['Title'], display_columns: ['Title'], value_column: 'id', multiple: true,
  filters: [{ column: 'Country', operator: 'eq', value: '{{task_data.country}}' }, { column: 'Active', operator: 'is_set' }],
  sort: { column: 'Title', direction: 'asc' },
})

describe('Autocomplete bound to a connected list (lookup source extension)', () => {
  it('keeps the list, columns, filters and sort; the item id is the stored value', () => {
    expect(CONFIG).toMatchObject({ source: 'extension', extension: 'sp', provider: 'list', source_label: 'SharePoint: bDepartments/b', value_column: 'id', multiple: true })
    expect(lookupValueField(CONFIG)).toBe('id')
    expect(lookupValueField({ source: 'extension' })).toBe('id')
    expect(normalizeLookupConfig({ source: 'extension', extension: 'Bad Id!', provider: 'list', source_id: 'x' }).extension).toBeUndefined()
  })

  it('flags a lookup without its list or columns', () => {
    expect(lookupConfigProblem({ source: 'extension' }, 'k', [])).toBe('Choose the list the suggestions come from')
    expect(lookupConfigProblem({ ...CONFIG, search_columns: undefined }, 'k', [])).toBe('Choose at least one column to search')
    expect(lookupConfigProblem(CONFIG, 'k', [])).toBeNull()
  })

  it('resolves cascading filters against the other fields as they are now', () => {
    const plan = buildExtensionQueryPlan(CONFIG, { search: 'sal', values: { country: 'NZ' } })
    expect(plan).toMatchObject({
      listId: 'lookup:11111111-1111-4111-8111-111111111111:Dept', search: 'sal', match: 'contains', searchColumns: ['Title'],
      filters: [{ column: 'Country', operator: 'eq', value: 'NZ' }, { column: 'Active', operator: 'is_set' }],
      sort: { column: 'Title', direction: 'asc' }, offset: 0, valueColumn: 'id',
    })
    expect(plan.limit).toBe(11)
    expect(plan.columns).toEqual(expect.arrayContaining(['Title', 'id']))
  })

  it('checks stored values by value, not by search', () => {
    const plan = buildExtensionQueryPlan(CONFIG, { search: 'ignored', values: {} }, { byValues: ['3', '9'] })
    expect(plan).toMatchObject({ search: '', values: ['3', '9'], limit: 2 })
  })

  it('maps a row to an item (value = item id, label = shown column)', () => {
    expect(toLookupItem(CONFIG, { id: '3', Title: 'Sales', Secret: 'x' })).toEqual({ value: '3', label: 'Sales', fields: { Title: 'Sales', id: '3' } })
  })

  beforeEach(() => { query.mockReset(); lists.mockReset() })

  it('asks the provider with no permissions and keeps only the requested columns', async () => {
    query.mockResolvedValue({ rows: [{ id: '3', Title: 'Sales', Budget: 1e6 }], more: true })
    const plan = buildExtensionQueryPlan(CONFIG, { search: '', values: { country: 'NZ' } })
    const out = await queryExtensionList('tenant', CONFIG, plan)
    expect(out).toEqual({ rows: [{ Title: 'Sales', id: '3' }], more: true })
    expect(query.mock.calls[0][0].ctx.host).toMatchObject({ extensionId: 'sp', tenantId: 'tenant', permissions: [] })
  })

  it('a missing extension is a clear error', async () => {
    await expect(queryExtensionList('tenant', { extension: 'gone', provider: 'list' }, buildExtensionQueryPlan(CONFIG, { search: '', values: {} }))).rejects.toThrow(/not available/)
  })

  it('lists every provider\'s lists, and reports a failing provider without failing the others', async () => {
    lists.mockResolvedValue([{ id: 'L1', label: 'Departments', columns: [{ key: 'id', label: 'ID' }, { key: 'Title', label: 'Title' }], valueColumn: 'id', labelColumn: 'Title' }])
    const ctx = { tenantId: 't', actorId: 'u', permissions: new Set(['forms.view']) } as any
    expect(await extensionLookupLists(ctx)).toEqual([{ extension: 'sp', provider: 'list', label: 'SharePoint', lists: [expect.objectContaining({ id: 'L1' })] }])
    lists.mockRejectedValue(new Error('farm down'))
    expect((await extensionLookupLists(ctx))[0]).toMatchObject({ lists: [], error: 'farm down' })
  })
})

describe('Dropdown options from a connected list (dynamic binding extension)', () => {
  const binding = normalizeDynamicBinding({
    kind: 'extension', extension: 'sp', provider: 'list', source_id: 'L1', source_label: 'SharePoint: Cities', value: 'id', label: 'Title',
    base_filter: { match: 'any', conditions: [{ column: 'Country', operator: 'eq', value: '{{form.country}}' }, { match: 'all', conditions: [{ column: 'Active', operator: 'is_set' }] }] },
    sort: [{ column: 'Title', direction: 'asc' }],
  }) as ExtensionBinding

  it('normalises to "all conditions" and is a source binding', () => {
    expect(binding.base_filter).toEqual({ match: 'all', conditions: [{ column: 'Country', operator: 'eq', value: '{{form.country}}' }, { column: 'Active', operator: 'is_set' }] })
    expect(isSourceBinding(binding)).toBe(true)
    expect(describeBinding(binding)).toMatch(/^list SharePoint: Cities/)
    expect(normalizeDynamicBinding({ kind: 'extension', extension: 'sp', provider: 'list' })).toBeNull()
  })

  beforeEach(() => query.mockReset())

  it('cascades: filtered by another field\'s value, and no options while that field is empty', async () => {
    query.mockResolvedValue({ rows: [{ id: '1', Title: 'Auckland' }, { id: '2', Title: 'Wellington' }] })
    const scope = { values: { country: 'NZ' }, user: null, now: new Date(), task: null } as any
    const { rows } = await runSourceBinding({} as any, {} as any, 'tenant', binding, 'options', scope, null)
    expect(query.mock.calls[0][0]).toMatchObject({ listId: 'L1', filters: [{ column: 'Country', operator: 'eq', value: 'NZ' }, { column: 'Active', operator: 'is_set' }], sort: { column: 'Title', direction: 'asc' }, valueColumn: 'id' })
    expect(shapeRows(binding, rows, 'options')).toEqual({ ok: true, value: [{ value: '1', label: 'Auckland' }, { value: '2', label: 'Wellington' }] })
    query.mockClear()
    const empty = await runSourceBinding({} as any, {} as any, 'tenant', binding, 'options', { ...scope, values: { country: '' } }, null)
    expect(empty.rows).toEqual([])
    expect(query).not.toHaveBeenCalled()
  })
})

describe('Data table / Data grid columns bound to a connected list (the shared column binding model)', () => {
  it('keeps a connected-list binding on a dropdown column (listed without typing) and drops an incomplete one', async () => {
    const { normalizeGridColumn, bindingDisplayFields } = await import('@/lib/grid/column-model')
    const col = normalizeGridColumn({ key: 'dept', label: 'Department', control: 'dropdown', binding: { source: 'extension', extension: 'sp', provider: 'list', source_id: 'L1', search_columns: ['Title'], display_columns: ['Title'], value_column: 'id' } })
    expect(col?.binding).toMatchObject({ source: 'extension', source_id: 'L1', value_column: 'id', min_chars: 0, max_results: 50 })
    expect(bindingDisplayFields(col?.binding)).toEqual(['Title'])
    expect(normalizeGridColumn({ key: 'dept', label: 'D', control: 'dropdown', binding: { source: 'extension', extension: 'sp' } })?.binding).toBeUndefined()
  })
})
