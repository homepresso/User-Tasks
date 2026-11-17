/**
 * Form Data table columns on the shared grid engine: a bound column's
 * options run through forms.lookup with the key `<field>.<column>` (config
 * from the SAVED form, {{row.<column>}} cascading from the row being edited),
 * signature cells as uploads of the form (`<field>.<column>`), stamped and
 * re-read in the change set — and the shared UI: the cell editor / display
 * per control and the designer's Columns editor.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createMemorySupabase } from './fixtures/supabase-memory'

let db: any
vi.mock('@/lib/services/_shared', async (orig) => ({ ...(await orig() as object), serviceRoleClient: async () => db }))
vi.mock('@/lib/cron-auth', () => ({ createServiceClient: () => db }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/providers/cache', async (orig) => {
  const mod = await orig() as typeof import('@/lib/providers/cache')
  const store = mod.resolveCacheStore('memory')
  return { ...mod, getCacheStore: async () => store }
})

import { clearLookupCache, lookupTaskField, lookupTargetField } from '@/lib/services/form-lookup'
import { LOOKUP_ROW_KEY } from '@/lib/forms/lookup'
import { normalizeTaskFields } from '@/lib/task-field-schema'
import { holdsNestedSignatures, listSignatureUploadKeys, mapNestedSignatures, nestedSignatureCells, resolveFileControl } from '@/lib/forms/signature-cells'
import type { ServiceContext } from '@/lib/services/context'
import { GridCellDisplay } from '@/components/grid/cell-display'
import { GridCellEditor } from '@/components/grid/cell-editor'
import { ColumnControlFields, GridColumnsEditor } from '@/components/grid/column-editor'
import { GridSurfaceProvider, GridLabelsProvider } from '@/components/grid/grid-context'
import { formColumnPatch } from '@/components/forms/designer/data-table-properties'
import type { GridColumnDef } from '@/lib/grid/column-model'

const TENANT = '0f000000-0000-4000-8000-00000000e000'
const TABLE = '0f000000-0000-4000-8000-00000000e001'
const CITIES = '0f000000-0000-4000-8000-00000000e002'
const TASK = '0f000000-0000-4000-8000-00000000e003'
const USER = '0f000000-0000-4000-8000-00000000e004'
const u = (n: number) => `0f000000-0000-4000-8000-00000000f${String(n).padStart(3, '0')}`

const FIELDS = normalizeTaskFields([{
  key: 'orders', label: 'Orders', type: 'data_table',
  data_table: {
    source: 'table', table_id: TABLE, mode: 'edit',
    columns: [
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'country', label: 'Country', type: 'text', control: 'dropdown', control_options: { choices: ['NZ', 'AU'] } },
      { key: 'city', label: 'City', type: 'text', control: 'autocomplete', binding: { source: 'table', table_id: CITIES, value_column: 'code', display_columns: ['name'], search_columns: ['name'], filters: [{ column: 'country', operator: 'eq', value: '{{row.country}}' }] } },
      { key: 'signed', label: 'Signed', type: 'text', control: 'signature' },
    ],
  },
}])

function seed() {
  return createMemorySupabase({
    custom_tables: [{ id: CITIES, tenant_id: TENANT, name: 'Cities', columns: [{ key: 'code', name: 'Code' }, { key: 'name', name: 'Name' }, { key: 'country', name: 'Country' }] }],
    custom_table_rows: [
      { id: u(1), tenant_id: TENANT, table_id: CITIES, data: { code: 'AKL', name: 'Auckland', country: 'NZ' }, created_at: '2026-01-01' },
      { id: u(2), tenant_id: TENANT, table_id: CITIES, data: { code: 'ADL', name: 'Adelaide', country: 'AU' }, created_at: '2026-01-02' },
      { id: u(3), tenant_id: TENANT, table_id: CITIES, data: { code: 'WLG', name: 'Wellington', country: 'NZ' }, created_at: '2026-01-03' },
    ],
    tasks: [{ id: TASK, tenant_id: TENANT, title: 'Orders', status: 'todo', priority: 'medium', assignee_id: USER, assigned_team_id: null, deleted_at: null, metadata: { fields: FIELDS, template_values: {} } }],
    task_assignees: [],
    user_teams: [],
  })
}

const ctx = (): ServiceContext => ({ supabase: db, tenantId: TENANT, actorId: USER, permissions: new Set(['tasks.complete']), authKind: 'session', source: 'ui' })

describe('bound Data table columns through forms.lookup', () => {
  beforeEach(() => { db = seed(); clearLookupCache() })

  it('names a bound column `<field>.<column>`; unbound columns and unknown keys are not lookups', () => {
    expect(lookupTargetField(FIELDS, 'orders.city')).toMatchObject({ key: 'orders.city', type: 'lookup', lookup: { table_id: CITIES } })
    expect(lookupTargetField(FIELDS, 'orders.title')).toBeNull()
    expect(lookupTargetField(FIELDS, 'orders.ghost')).toBeNull()
  })

  it('searches the saved binding with the row being edited ({{row.country}}: cascading)', async () => {
    const nz = await lookupTaskField(ctx(), TASK, { field_key: 'orders.city', query: 'a', values: { [LOOKUP_ROW_KEY]: { country: 'NZ' } } })
    // (the memory DB ignores the search's `or`; the country filter is what cascades)
    expect(nz.items.map((i) => [i.value, i.label])).toEqual([['AKL', 'Auckland'], ['WLG', 'Wellington']])
    const au = await lookupTaskField(ctx(), TASK, { field_key: 'orders.city', query: 'a', values: { [LOOKUP_ROW_KEY]: { country: 'AU' } } })
    expect(au.items.map((i) => i.value)).toEqual(['ADL'])
    // A row value that is not one of the table's declared columns is ignored (no widening).
    const resolved = await lookupTaskField(ctx(), TASK, { field_key: 'orders.city', resolve: ['WLG'], values: { [LOOKUP_ROW_KEY]: { country: 'NZ', secret: 'x' } } })
    expect(resolved.items).toEqual([expect.objectContaining({ value: 'WLG', label: 'Wellington' })])
  })
})

describe('signature cells of a Data table', () => {
  const sig = (id: string) => ({ file: { id, name: 'signature.png', size: 10, mime_type: 'image/png', url: `/attachments/${id}`, storage_ref: 'storage://x', uploaded_by: null, uploaded_at: '2026-11-15T00:00:00Z', checksum_sha256: 'a' }, method: 'draw', signed_at: '2026-11-15T00:00:00Z' })

  it('uploads under `<field>.<column>` and repeats per row', () => {
    expect(resolveFileControl(FIELDS, 'orders.signed')).toMatchObject({ field: { key: 'orders.signed', type: 'signature' }, repeated: true })
    expect(resolveFileControl(FIELDS, 'orders.title')).toBeNull()
    expect(listSignatureUploadKeys(FIELDS)).toContain('orders.signed')
    expect(holdsNestedSignatures(FIELDS[0])).toBe(true)
    expect(holdsNestedSignatures({ ...FIELDS[0], data_table: { ...FIELDS[0].data_table!, mode: 'display' } })).toBe(false)
  })

  it('visits the signature cells of new and changed rows (stamping / re-reading), leaving the rest', () => {
    const value = { added: [{ title: 'n', signed: sig('a1') }], updated: [{ key: 'r1', before: {}, after: { signed: sig('b2') }, changed_fields: ['signed'] }, { key: 'r2', before: {}, after: { title: 'x' }, changed_fields: ['title'] }], deleted: [] }
    expect(nestedSignatureCells(FIELDS[0], value).map((c) => c.path)).toEqual(['orders.added[0].signed', 'orders.updated[0].after.signed'])
    const out = mapNestedSignatures(FIELDS[0], value, (_f, v: any) => ({ ...v, user_name: 'Ana' })) as any
    expect(out.added[0].signed.user_name).toBe('Ana')
    expect(out.updated[0].after.signed.user_name).toBe('Ana')
    expect(out.updated[1]).toBe(value.updated[1])
    expect(mapNestedSignatures(FIELDS[0], value, (_f, v) => v)).toBe(value)
  })
})

describe('the shared cell UI', () => {
  const render = (node: any, surface: any = { scope: 's', people: [{ id: USER, display_name: 'Ana Admin', email: 'ana@example.com' }] }, labels: any = {}) =>
    renderToStaticMarkup(createElement(GridSurfaceProvider as any, { value: surface }, createElement(GridLabelsProvider, { value: labels }, node)))
  const col = (control: GridColumnDef['control'], extra: Partial<GridColumnDef> = {}): GridColumnDef => ({ key: 'c', label: 'Cell', control, ...extra })

  it('shows each control: bound labels, choice labels, chips, people, signature, link, calculated value', () => {
    expect(render(createElement(GridCellDisplay, { col: col('dropdown', { binding: { source: 'table', table_id: CITIES } }), value: 'AKL' }), undefined, { c: new Map([['AKL', 'Auckland']]) })).toContain('Auckland')
    expect(render(createElement(GridCellDisplay, { col: col('dropdown', { control_options: { choices: [{ value: 'o', label: 'Open' }] } }), value: 'o' }))).toContain('Open')
    const chips = render(createElement(GridCellDisplay, { col: col('multiselect'), value: ['a', 'b'] }))
    expect(chips).toContain('data-grid-chips')
    expect(render(createElement(GridCellDisplay, { col: col('people'), value: [{ kind: 'user', id: USER }] }))).toContain('Ana Admin')
    const signature = render(createElement(GridCellDisplay, { col: col('signature'), value: { file: { name: 's.png', url: 'https://files.example/s.png' }, method: 'draw', signed_at: '2026-11-15T00:00:00Z', user_name: 'Ana' } }))
    expect(signature).toContain('data-grid-signature="signed"')
    expect(signature).toContain('alt="Signature of Ana"')
    expect(render(createElement(GridCellDisplay, { col: col('link'), value: 'javascript:alert(1)' }))).not.toContain('href')
    expect(render(createElement(GridCellDisplay, { col: col('display', { control_options: { formula: 'qty * price' } }), value: null, row: { qty: 2, price: 3 } }))).toContain('6')
    expect(render(createElement(GridCellDisplay, { col: col('text'), value: null }))).toContain('empty')
  })

  it('edits by control with an accessible name: combobox for autocomplete, switch for a toggle, pad dialog for a signature', () => {
    const props = { value: null, row: {}, label: 'City, row 1', onCommit: () => {}, onCancel: () => {} }
    const auto = render(createElement(GridCellEditor, { ...props, col: col('autocomplete', { binding: { source: 'table', table_id: CITIES } }) }))
    expect(auto).toContain('role="combobox"')
    expect(auto).toContain('aria-label="City, row 1"')
    expect(auto).toContain('role="listbox"')
    expect(render(createElement(GridCellEditor, { ...props, col: col('boolean', { control_options: { boolean_style: 'toggle' } }) }))).toContain('role="switch"')
    expect(render(createElement(GridCellEditor, { ...props, col: col('dropdown', { control_options: { choices: [{ value: 'a', label: 'A' }] } }) }))).toContain('<option value="a">A</option>')
    expect(render(createElement(GridCellEditor, { ...props, col: col('currency') }))).toContain('USD')
    expect(render(createElement(GridCellEditor, { ...props, col: col('display') }))).toBe('')
  })
})

describe('the Columns editor', () => {
  it('per column: control (suited first), read-only, required, width, choices or a binding', () => {
    const html = renderToStaticMarkup(createElement(ColumnControlFields, {
      idBase: 'x', col: { key: 'status', label: 'Status', control: 'dropdown', control_options: { choices: [{ value: 'open' }] } }, typeHint: 'select', onChange: () => {},
      renderBinding: () => createElement('div', { 'data-binding-editor': true }),
    }))
    expect(html).toContain('data-testid="grid-col-control"')
    expect(html).toMatch(/<optgroup label="Suits this column"><option value="dropdown"[^>]*>Dropdown<\/option>/)
    expect(html).toContain('Signature pad')
    expect(html).toContain('data-testid="grid-col-readonly"')
    expect(html).toContain('data-testid="grid-col-choices"')
    expect(html).toContain('A list of choices')
    const bound = renderToStaticMarkup(createElement(ColumnControlFields, { idBase: 'y', col: { key: 'city', label: 'City', control: 'autocomplete' }, onChange: () => {}, renderBinding: () => createElement('div', { 'data-binding-editor': true }) }))
    expect(bound).toContain('data-binding-editor')
    expect(bound).toContain('bind it to a data table or an API reference')
  })

  it('the view editor lists the columns with lock markers and offers the rest to add', () => {
    const html = renderToStaticMarkup(createElement(GridColumnsEditor, {
      columns: [{ key: 'title', label: 'Title', control: 'text' }, { key: 'amount', label: 'Amount', control: 'currency', editable: false }],
      tableColumns: [{ key: 'title', name: 'Title', type: 'text' }, { key: 'amount', name: 'Amount', type: 'number' }, { key: 'notes', name: 'Notes', type: 'longtext' }],
      onChange: () => {},
    }))
    expect(html).toContain('Title<span class="text-fg-muted"> · Text</span>')
    expect(html).toContain('aria-label="Read-only"')
    expect(html).toContain('<option value="notes">Notes</option>')
  })

  it('maps an engine change onto a form column (editable ↔ read_only; a non-bound control drops the binding)', () => {
    expect(formColumnPatch({ editable: false })).toEqual({ read_only: true })
    expect(formColumnPatch({ editable: undefined })).toEqual({ read_only: undefined })
    expect(formColumnPatch({ control: 'signature' })).toEqual({ control: 'signature', control_options: undefined, binding: undefined })
    expect(formColumnPatch({ control: 'autocomplete' })).toEqual({ control: 'autocomplete', control_options: undefined })
  })
})
