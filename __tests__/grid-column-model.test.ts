/**
 * The shared grid column model (lib/grid/column-model.ts) — the engine of
 * the form Data table control and the Data section's grid views: control
 * inference, normalisation, value coercion per control, bindings
 * (cascading dependencies, caching keys), the server's inline-write gate
 * (read-only columns refused) and the last-write-wins conflict check — and
 * how a form Data table column maps onto it (lib/forms/data-table.ts).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */
import { describe, expect, it } from 'vitest'
import {
  BOUND_CONTROLS, bindingCacheKey, bindingClientTtl, bindingForControl, bindingRowDependencies, builtInView, calculatedValue, coerceGridValue, conflictMessage,
  controlsForType, defaultGridColumns, dependentColumns, gridCellWrite, gridColumnFromForm, gridColumnProblem, gridViewProblem, hasCustomControl,
  inferGridControl, inferredColumn, isColumnEditable, isStaleWrite, legacyLookupBinding, normalizeControlOptions, normalizeGridColumn, normalizeGridViews,
  pickView, safeLink, schemaColumns, type GridColumnDef,
} from '@/lib/grid/column-model'
import {
  addableColumns, coerceCell, dataTableConfigProblem, editableColumns, normalizeDataTableConfig, validateChangeSet,
} from '@/lib/forms/data-table'

const TABLE = '0f000000-0000-4000-8000-00000000a001'
const REGIONS = '0f000000-0000-4000-8000-00000000a002'
const REF = '0f000000-0000-4000-8000-00000000a003'

const SCHEMA = schemaColumns([
  { key: 'id', name: 'ID', type: 'number' },
  { key: 'date_created', name: 'Date Created', type: 'date' },
  { key: 'title', name: 'Title', type: 'text' },
  { key: 'notes', name: 'Notes', type: 'longtext' },
  { key: 'amount', name: 'Amount', type: 'number' },
  { key: 'due', name: 'Due', type: 'date' },
  { key: 'done', name: 'Done', type: 'boolean' },
  { key: 'status', name: 'Status', type: 'select', options: ['open', 'closed'] },
  { key: 'contract', name: 'Contract', type: 'file' },
  { key: 'region', name: 'Region', type: 'lookup', lookup: { sourceTableId: REGIONS, sourceColumn: 'Name', sortBy: 'Name', filters: [{ column: 'Active', operator: 'equals', value: 'yes' }] } },
  { name: 'Legacy Name', type: 'text' },
])

describe('control inference', () => {
  it('infers the control from the data type (Data table and form column types)', () => {
    expect(inferGridControl('text')).toBe('text')
    expect(inferGridControl('longtext')).toBe('multiline')
    expect(inferGridControl('number')).toBe('number')
    expect(inferGridControl('currency')).toBe('currency')
    expect(inferGridControl('date')).toBe('date')
    expect(inferGridControl('datetime')).toBe('datetime')
    expect(inferGridControl('boolean')).toBe('boolean')
    expect(inferGridControl('select')).toBe('dropdown')
    expect(inferGridControl('choice')).toBe('dropdown')
    expect(inferGridControl('file')).toBe('file')
    expect(inferGridControl('lookup')).toBe('dropdown')
    expect(inferGridControl('url')).toBe('link')
    expect(inferGridControl(undefined)).toBe('text')
  })

  it('offers the controls that suit a type first, the inferred one leading', () => {
    expect(controlsForType('text')[0]).toBe('text')
    expect(controlsForType('text')).toEqual(expect.arrayContaining(['dropdown', 'autocomplete', 'rich_text']))
    expect(controlsForType('file')).toEqual(['file', 'signature', 'display'])
    expect(controlsForType('boolean')).toEqual(['boolean', 'display'])
  })

  it('builds the default view from the schema: custom columns only, select choices and legacy lookups carried over', () => {
    const cols = defaultGridColumns(SCHEMA)
    expect(cols.map((c) => c.key)).toEqual(['title', 'notes', 'amount', 'due', 'done', 'status', 'contract', 'region', 'legacy_name'])
    expect(cols.find((c) => c.key === 'status')).toMatchObject({ control: 'dropdown', control_options: { choices: [{ value: 'open' }, { value: 'closed' }] } })
    const region = cols.find((c) => c.key === 'region')!
    expect(region.control).toBe('dropdown')
    expect(region.binding).toMatchObject({ source: 'table', table_id: REGIONS, value_column: 'name', display_columns: ['name'], filters: [{ column: 'active', operator: 'eq', value: 'yes' }], sort: { column: 'name', direction: 'asc' } })
    expect(inferredColumn(SCHEMA[0]).editable).toBe(false)
    const view = builtInView(SCHEMA)
    expect(view).toMatchObject({ id: 'default', name: 'All columns' })
    expect(view.inline_edit).toBeUndefined()
  })

  it('reads a legacy lookup config as a binding (source column = value and display)', () => {
    expect(legacyLookupBinding({ sourceTableId: REGIONS, sourceColumn: 'Region Code' })).toMatchObject({ table_id: REGIONS, value_column: 'region_code', min_chars: 0 })
    expect(legacyLookupBinding({ sourceColumn: 'x' })).toBeUndefined()
  })
})

describe('normalisation', () => {
  it('keeps only what the control reads, bounded; drops unknown props', () => {
    expect(normalizeControlOptions('currency', { currency: 'eur', decimals: 14, min: '1', choices: ['a'], formula: 'x' })).toEqual({ currency: 'EUR', decimals: 10, min: 1 })
    expect(normalizeControlOptions('currency', { currency: 'USD' })).toBeUndefined()
    expect(normalizeControlOptions('dropdown', { choices: ['a', { value: 'b', label: 'Bee' }, 'a', '', { value: 'c', label: 'c' }] })).toEqual({ choices: [{ value: 'a' }, { value: 'b', label: 'Bee' }, { value: 'c' }] })
    expect(normalizeControlOptions('display', { formula: 'qty * price' })).toEqual({ formula: 'qty * price' })
    expect(normalizeControlOptions('display', { formula: 'alert(1); x' })).toBeUndefined()
    expect(normalizeControlOptions('boolean', { boolean_style: 'toggle', placeholder: 'x' })).toEqual({ boolean_style: 'toggle' })
    expect(normalizeControlOptions('signature', { signature: { mode: 'draw', statement: 'I agree' } })).toEqual({ signature: { mode: 'draw', statement: 'I agree' } })
  })

  it('validates column keys and controls; display columns are never editable; bindings only on bound controls', () => {
    expect(normalizeGridColumn({ key: '__proto__', control: 'text' })).toBeNull()
    expect(normalizeGridColumn({ key: 'a b' })).toBeNull()
    expect(normalizeGridColumn({ key: 'total', control: 'display', required: true })).toEqual({ key: 'total', label: 'total', control: 'display', editable: false })
    expect(normalizeGridColumn({ key: 'x', control: 'nope' }, { fallbackControl: 'number' })?.control).toBe('number')
    const bound = normalizeGridColumn({ key: 'region', control: 'dropdown', binding: { source: 'table', table_id: REGIONS, display_columns: ['name'], fill: [{ from: 'a', to: 'b' }], multiple: true } })!
    expect(bound.binding).toMatchObject({ source: 'table', table_id: REGIONS, min_chars: 0, max_results: 50 })
    expect(bound.binding).not.toHaveProperty('fill')
    expect(bound.binding).not.toHaveProperty('multiple')
    expect(normalizeGridColumn({ key: 'title', control: 'text', binding: { source: 'table', table_id: REGIONS } })!.binding).toBeUndefined()
    expect(normalizeGridColumn({ key: 'a', control: 'autocomplete', binding: { source: 'table' } })!.binding).toBeUndefined()
    expect(normalizeGridColumn({ key: 'w', width: 9999 })!.width).toBe(800)
  })

  it('normalises views: ids unique, columns limited to the table, one default, page size bounded', () => {
    const views = normalizeGridViews([
      { id: 'v1', name: 'Main', inline_edit: true, default: true, page_size: 5, columns: [{ key: 'title' }, { key: 'ghost' }, { key: 'title' }, { key: 'id', control: 'number' }, { key: 'amount', control: 'currency', editable: false }] },
      { id: 'v1', name: '', default: true, columns: [{ key: 'notes' }] },
      'junk',
    ], SCHEMA)
    expect(views).toHaveLength(2)
    expect(views[0]).toMatchObject({ id: 'v1', name: 'Main', inline_edit: true, default: true, page_size: 10 })
    expect(views[0].columns.map((c) => c.key)).toEqual(['title', 'id', 'amount'])
    expect(views[0].columns[0].control).toBe('text')
    expect(views[0].columns[1].editable).toBe(false) // system column
    expect(views[1].id).not.toBe('v1')
    expect(views[1].name).toBe('View')
    expect(views[1].default).toBeUndefined()
    expect(views[1].columns[0].control).toBe('multiline') // inferred from the schema
    expect(pickView(views, 'nope', SCHEMA).id).toBe('v1')
    expect(pickView([], null, SCHEMA).id).toBe('default')
  })

  it('flags bound controls without a source or choices, and empty views', () => {
    expect(gridColumnProblem({ key: 'a', label: 'A', control: 'dropdown' })).toMatch(/add the choices or bind/)
    expect(gridColumnProblem({ key: 'a', label: 'A', control: 'dropdown', control_options: { choices: [{ value: 'x' }] } })).toBeNull()
    expect(gridColumnProblem({ key: 'a', label: 'A', control: 'autocomplete', control_options: { choices: [{ value: 'x' }] } })).toMatch(/bind it/)
    expect(gridColumnProblem({ key: 'a', label: 'A', control: 'number', control_options: { min: 5, max: 1 } })).toMatch(/minimum/)
    expect(gridViewProblem({ id: 'v', name: 'V', columns: [] })).toMatch(/at least one column/)
  })
})

describe('values per control', () => {
  const col = (control: GridColumnDef['control'], extra: Partial<GridColumnDef> = {}): GridColumnDef => ({ key: 'c', label: 'Cell', control, ...extra })

  it('coerces text-like, numeric, date and yes / no values', () => {
    expect(coerceGridValue(col('text'), 'a\nb')).toEqual({ value: 'a b' })
    expect(coerceGridValue(col('multiline'), 'a\nb')).toEqual({ value: 'a\nb' })
    expect(coerceGridValue(col('text', { control_options: { max_length: 3 } }), 'abcd')).toEqual({ error: 'Cell is too long' })
    expect(coerceGridValue(col('number', { control_options: { min: 0, max: 10 } }), '1,5')).toEqual({ error: 'Cell must be at most 10' })
    expect(coerceGridValue(col('number'), 'x')).toEqual({ error: 'Cell must be a number' })
    expect(coerceGridValue(col('currency'), '$1,234.567')).toEqual({ value: 1234.57 })
    expect(coerceGridValue(col('currency', { control_options: { decimals: 0 } }), 9.6)).toEqual({ value: 10 })
    expect(coerceGridValue(col('date'), '2026-11-15T10:00:00Z')).toEqual({ value: '2026-11-15' })
    expect(coerceGridValue(col('date'), '15/11/2026')).toHaveProperty('error')
    expect(coerceGridValue(col('datetime'), '2026-11-15T10:00:00Z')).toEqual({ value: '2026-11-15T10:00:00.000Z' })
    expect(coerceGridValue(col('boolean'), 'yes')).toEqual({ value: true })
    expect(coerceGridValue(col('boolean'), '')).toEqual({ value: false })
    expect(coerceGridValue(col('boolean'), 'maybe')).toHaveProperty('error')
  })

  it('checks required, links and calculated columns', () => {
    expect(coerceGridValue(col('text', { required: true }), '  ')).toEqual({ error: 'Cell is required' })
    expect(coerceGridValue(col('text'), null)).toEqual({ value: null })
    expect(coerceGridValue(col('link'), 'javascript:alert(1)')).toHaveProperty('error')
    expect(coerceGridValue(col('link'), 'example.com/a')).toEqual({ value: 'https://example.com/a' })
    expect(coerceGridValue(col('link'), 'ana@example.com')).toEqual({ value: 'mailto:ana@example.com' })
    expect(safeLink('//evil.example')).toBeNull()
    expect(coerceGridValue(col('display'), 5)).toEqual({ error: 'Cell is calculated and can\'t be edited' })
    expect(calculatedValue(col('display', { control_options: { formula: 'qty * price' } }), { qty: 3, price: 2.5 })).toBe(7.5)
    expect(calculatedValue(col('display'), { qty: 3 })).toBeNull()
  })

  it('checks static choices; bound values are only shape-checked here (the server confirms them in the source)', () => {
    const choices = { control_options: { choices: [{ value: 'open' }, { value: 'closed', label: 'Closed' }] } }
    expect(coerceGridValue(col('dropdown', choices), 'open')).toEqual({ value: 'open' })
    expect(coerceGridValue(col('dropdown', choices), 'other')).toEqual({ error: 'Cell must be one of: open, Closed' })
    const bound = { binding: { source: 'table' as const, table_id: REGIONS } }
    expect(coerceGridValue(col('dropdown', bound), 'anything')).toEqual({ value: 'anything' })
    expect(coerceGridValue(col('autocomplete', bound), { x: 1 })).toHaveProperty('error')
    expect(coerceGridValue(col('multiselect', choices), ['open', 'closed', 'open'])).toEqual({ value: ['open', 'closed'] })
    expect(coerceGridValue(col('multiselect', choices), 'open, bad')).toEqual({ error: 'Cell: "bad" is not one of the choices' })
    expect(coerceGridValue(col('multiselect', { required: true }), [])).toEqual({ error: 'Cell is required' })
    expect(coerceGridValue(col('multiselect'), null)).toEqual({ value: [] })
  })

  it('takes people, files, signatures and rich text in their shapes', () => {
    const uid = '0f000000-0000-4000-8000-0000000000a1'
    expect(coerceGridValue(col('people'), [{ kind: 'user', id: uid, name: 'X' }, { kind: 'user', id: uid }])).toEqual({ value: [{ kind: 'user', id: uid, name: 'X' }] })
    expect(coerceGridValue(col('people'), [{ kind: 'team', id: uid }])).toEqual({ error: 'Cell takes people, not teams' })
    expect(coerceGridValue(col('file'), { name: 'a.pdf', url: '/storage/a.pdf', path: `data-tables/${TABLE}/a.pdf`, size: 12 })).toEqual({ value: { name: 'a.pdf', url: '/storage/a.pdf', path: `data-tables/${TABLE}/a.pdf`, size: 12 } })
    expect(coerceGridValue(col('file'), { name: 'a', url: 'javascript:x' })).toHaveProperty('error')
    const sig = { file: { name: 'signature.png', url: 'https://files.example/s.png', path: `data-tables/${TABLE}/s.png` }, method: 'draw', signed_at: '2026-11-15T00:00:00Z' }
    expect(coerceGridValue(col('signature'), sig)).toEqual({ value: sig })
    expect(coerceGridValue(col('signature'), { file: { name: 'x', url: '/a' }, method: 'scribble' })).toEqual({ error: 'Cell is not a valid signature' })
    expect(coerceGridValue(col('rich_text'), '<p>Hi <script>x</script><b>there</b></p>')).toEqual({ value: '<p>Hi <b>there</b></p>' })
  })
})

describe('bindings', () => {
  const binding = { source: 'table' as const, table_id: REGIONS, filters: [{ column: 'country', operator: 'eq' as const, value: '{{row.country}}' }, { column: 'kind', operator: 'eq' as const, value: '{{form.kind}}' }] }
  const cols: GridColumnDef[] = [
    { key: 'country', label: 'Country', control: 'dropdown', binding: { source: 'table', table_id: REGIONS } },
    { key: 'region', label: 'Region', control: 'dropdown', binding },
    { key: 'city', label: 'City', control: 'autocomplete', binding: { source: 'reference', reference_id: REF, input_mappings: { region: '{{row.region}}', q: '{{search}}' } } },
  ]

  it('finds the row columns a binding reads (cascading) and the columns to clear when one changes', () => {
    expect(bindingRowDependencies(binding)).toEqual(['country'])
    expect(bindingRowDependencies(cols[2].binding)).toEqual(['region'])
    expect(dependentColumns(cols, 'country')).toEqual(['region'])
    expect(dependentColumns(cols, 'region')).toEqual(['city'])
    expect(dependentColumns(cols, 'city')).toEqual([])
  })

  it('caches per binding, row inputs and typed text; TTL from the reference cache', () => {
    const a = bindingCacheKey('grid:t:v', 'region', binding, { country: 'NZ' }, '')
    expect(bindingCacheKey('grid:t:v', 'region', binding, { country: 'AU' }, '')).not.toBe(a)
    expect(bindingCacheKey('grid:t:v', 'region', binding, { country: 'NZ' }, 'auck')).not.toBe(a)
    expect(bindingClientTtl({ source: 'reference', cache_ttl_s: 300 })).toBe(300_000)
    expect(bindingClientTtl(undefined)).toBe(60_000)
  })

  it('makes a bound dropdown list without typing; autocompletes keep their minimum', () => {
    expect(bindingForControl('dropdown', { source: 'table', table_id: REGIONS })).toMatchObject({ min_chars: 0, max_results: 50 })
    expect(bindingForControl('autocomplete', { source: 'table', table_id: REGIONS, min_chars: 2 })).toMatchObject({ min_chars: 2 })
    expect(BOUND_CONTROLS.has('lookup')).toBe(true)
  })
})

describe('inline writes (the server gate) and conflicts', () => {
  const view = {
    inline_edit: true,
    columns: [
      { key: 'title', label: 'Title', control: 'text' as const, required: true },
      { key: 'amount', label: 'Amount', control: 'currency' as const, editable: false },
      { key: 'secret', label: 'Secret', control: 'text' as const, hidden: true },
      { key: 'total', label: 'Total', control: 'display' as const, editable: false },
      { key: 'id', label: 'ID', control: 'number' as const },
      { key: 'status', label: 'Status', control: 'dropdown' as const, control_options: { choices: [{ value: 'open' }] } },
    ],
  }

  it('writes editable cells, coerced', () => {
    expect(gridCellWrite(view, { title: 'Hello', status: 'open' })).toEqual({ cells: { title: 'Hello', status: 'open' }, errors: {} })
  })

  it('refuses read-only, hidden, calculated, system and unknown columns even when sent', () => {
    const res = gridCellWrite(view, { amount: 5, secret: 'x', total: 1, id: 9, ghost: 1, title: 'ok' })
    expect(res.cells).toEqual({ title: 'ok' })
    expect(res.errors).toEqual({ amount: 'Amount is read-only', secret: 'Secret is read-only', total: 'Total is read-only', id: 'ID is read-only', ghost: '"ghost" is not a column of this view' })
  })

  it('refuses everything when inline editing is off, and invalid values per control', () => {
    expect(gridCellWrite({ ...view, inline_edit: false }, { title: 'x' }).errors._).toMatch(/turned off/)
    expect(gridCellWrite(view, { title: '' }).errors.title).toBe('Title is required')
    expect(gridCellWrite(view, { status: 'closed' }).errors.status).toMatch(/must be one of/)
    expect(gridCellWrite(view, {}).errors._).toMatch(/No cells/)
    expect(isColumnEditable({ control: 'text', editable: false })).toBe(false)
    expect(isColumnEditable({ control: 'text' })).toBe(true)
  })

  it('detects a stale write by updated_at (last write wins without one)', () => {
    const row = { updated_at: '2026-11-15T10:00:00.000Z', created_at: '2026-11-01T00:00:00Z' }
    expect(isStaleWrite('2026-11-15T10:00:00Z', row)).toBe(false)
    expect(isStaleWrite('2026-11-15T09:59:59Z', row)).toBe(true)
    expect(isStaleWrite(null, row)).toBe(false)
    expect(isStaleWrite('2026-11-01T00:00:00Z', { updated_at: null, created_at: '2026-11-01T00:00:00Z' })).toBe(false)
    expect(conflictMessage('Ana')).toMatch(/^Ana changed this row after you opened it/)
    expect(conflictMessage(null)).toMatch(/^Someone else changed/)
  })
})

describe('form Data table columns on the engine', () => {
  const config = normalizeDataTableConfig({
    source: 'table', table_id: TABLE, mode: 'edit', allow_add: true,
    columns: [
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'signed', label: 'Signed', type: 'text', control: 'signature', control_options: { signature: { mode: 'type' }, currency: 'EUR' } },
      { key: 'region', label: 'Region', type: 'text', control: 'dropdown', binding: { source: 'table', table_id: REGIONS, display_columns: ['name'], filters: [{ column: 'country', operator: 'eq', value: '{{row.country}}' }] } },
      { key: 'customer', label: 'Customer', type: 'text', control: 'autocomplete', binding: { source: 'reference', reference_id: REF, value_field: 'id', display_fields: ['name'] } },
      { key: 'tags', label: 'Tags', type: 'text', control: 'multiselect', control_options: { choices: ['a', 'b'] } },
      { key: 'total', label: 'Total', type: 'number', control: 'display', control_options: { formula: 'qty * price' } },
      { key: 'status', label: 'Status', type: 'choice', control: 'dropdown', binding: { source: 'table', table_id: REGIONS } },
      { key: 'ref', label: 'Ref', type: 'text', control: 'bogus' },
    ],
  })

  it('keeps the control, its options and the binding (dropdown bindings list without typing)', () => {
    const by = Object.fromEntries(config.columns.map((c) => [c.key, c]))
    expect(by.signed).toMatchObject({ control: 'signature', control_options: { signature: { mode: 'type' } } })
    expect(by.signed.control_options).not.toHaveProperty('currency')
    expect(by.region.binding).toMatchObject({ table_id: REGIONS, min_chars: 0 })
    expect(by.customer.binding).toMatchObject({ source: 'reference', reference_id: REF, value_field: 'id' })
    expect(by.ref.control).toBeUndefined()
    expect(hasCustomControl(by.signed)).toBe(true)
    expect(hasCustomControl(by.status)).toBe(false) // a choice column's own control (bound)
    expect(gridColumnFromForm(by.tags)).toMatchObject({ control: 'multiselect', control_options: { choices: [{ value: 'a' }, { value: 'b' }] } })
    expect(dataTableConfigProblem(config)).toBeNull()
  })

  it('a calculated column is never edited or added; a bound choice column needs no choices', () => {
    expect(editableColumns(config).map((c) => c.key)).not.toContain('total')
    expect(addableColumns(config).map((c) => c.key)).not.toContain('total')
    expect(dataTableConfigProblem({ ...config, columns: [{ key: 'region', label: 'Region', type: 'text', control: 'autocomplete' }] })).toMatch(/bind it/)
  })

  it('validates cells by their control on submit (the server shares this check)', () => {
    const by = Object.fromEntries(config.columns.map((c) => [c.key, c]))
    expect(coerceCell(by.tags, ['a', 'z'])).toEqual({ error: 'Tags: "z" is not one of the choices' })
    expect(coerceCell(by.tags, 'a,b')).toEqual({ value: ['a', 'b'] })
    expect(coerceCell(by.title, 'plain')).toEqual({ value: 'plain' })
    const res = validateChangeSet(config, {
      added: [{ title: 'New', tags: ['b'], total: 99 }],
      updated: [{ key: 'r1', before: { title: 'A', total: 1 }, after: { title: 'B', total: 5 }, changed_fields: ['title', 'total'] }],
      deleted: [],
    })
    expect(res.errors).toEqual(['Row r1: Total is read-only'])
    expect(res.changes.added[0]).toEqual({ title: 'New', tags: ['b'] })
  })
})

describe('Data table schema columns', () => {
  it('canonicalises keys (legacy name-only columns get the slug), drops duplicates', () => {
    expect(SCHEMA.find((c) => c.name === 'Legacy Name')?.key).toBe('legacy_name')
    expect(schemaColumns([{ key: 'a', name: 'A' }, { key: 'a', name: 'B' }, 'x'])).toEqual([{ key: 'a', name: 'A', type: 'text' }])
    expect(schemaColumns(null)).toEqual([])
  })

  it('never offers system columns as editable cells', () => {
    const [id] = normalizeGridViews([{ id: 'v', name: 'V', inline_edit: true, columns: [{ key: 'id', label: 'ID', control: 'number', editable: true }] }], SCHEMA)
    expect(id.columns[0].editable).toBe(false)
    expect(gridCellWrite(id, { id: 3 }).errors.id).toBe('ID is read-only')
  })
})

describe('the Data grid autosave (optimistic, rollback, conflict)', async () => {
  const { expectedVersion, optimisticRow, settleSave } = await import('@/lib/grid/inline-save')
  const row = { id: 'r1', data: { title: 'A', region: 'N' }, updated_at: '2026-11-15T10:00:00Z', created_at: '2026-11-01T00:00:00Z' }
  const col = { key: 'title', label: 'Title' }

  it('shows the edit at once and names the version it read', () => {
    expect(optimisticRow(row, { title: 'B', region: null })).toEqual({ ...row, data: { title: 'B', region: null } })
    expect(expectedVersion(row)).toBe('2026-11-15T10:00:00Z')
    expect(expectedVersion({ ...row, updated_at: null })).toBe('2026-11-01T00:00:00Z')
  })

  it('a saved cell takes the server row (its new version) and announces it', () => {
    const out = settleSave(row, col, { ok: true, data: { row: { data: { title: 'B', region: 'N' }, updated_at: '2026-11-15T10:05:00Z' }, changed: ['title'] } })
    expect(out.row).toMatchObject({ data: { title: 'B' }, updated_at: '2026-11-15T10:05:00Z' })
    expect(out.announce).toBe('Saved Title')
    expect(out.cellError).toBeUndefined()
  })

  it('a refused cell rolls back to the row as it was and shows the error on the cell', () => {
    const out = settleSave(row, col, { ok: false, error: 'Title is read-only', cells: { title: 'Title is read-only' } })
    expect(out.row).toBe(row)
    expect(out.cellError).toBe('Title is read-only')
    expect(out.announce).toBe('Title not saved: Title is read-only')
  })

  it('a conflict shows the current row from the server and a friendly warning', () => {
    const out = settleSave(row, col, { ok: false, error: conflictMessage('Ana'), conflict: { row: { data: { title: 'Theirs', region: 'S' }, updated_at: '2026-11-15T11:00:00Z', updated_by: 'u2' } } })
    expect(out.row).toMatchObject({ data: { title: 'Theirs', region: 'S' }, updated_at: '2026-11-15T11:00:00Z' })
    expect(out.notice).toEqual({ tone: 'warning', message: expect.stringMatching(/^Ana changed this row/) })
    expect(settleSave(row, col, { ok: false, error: 'x', conflict: { row: null } }).row).toBe(row)
  })
})
