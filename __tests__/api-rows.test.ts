import { describe, expect, it } from 'vitest'
import { inferSchema } from '@/lib/response-schema'
import {
  addFieldColumn, applyRowsPath, badgeActions, bindingSetLabel, bindingSetValue, bindingUseRows, decodeBadgeDrag, detectRowArrays,
  encodeBadgeDrag, explainApiError, flattenBadges, generateColumns, humanizeLabel, inferColumnType, pagingSupport, parseApiAddress,
  refreshChoices, responseBadges, responseView, rowFieldOrder, sampleRows, setPaging, setShownColumns, suggestInputMappings, suggestKeyField, suggestValueLabel,
} from '@/lib/data-sources/api-rows'
import { normalizeDataTableConfig, type DataTableFieldConfig } from '@/lib/forms/data-table'
import type { LookupConfig } from '@/lib/forms/lookup'

// A fictional billing API (USD amounts).
const invoicesResponse = {
  data: {
    invoices: [
      { id: 'INV-1001', number: '1001', customer: { name: 'Acme Supplies', city: 'Denver' }, amount_usd: 1250.5, status: 'open', due_date: '2026-12-01', paid: false, lines: [{ sku: 'P-1', qty: 2 }] },
      { id: 'INV-1002', number: '1002', customer: { name: 'Apex Office', city: 'Austin' }, amount_usd: 980, status: 'paid', due_date: '2026-11-10', paid: true, lines: [] },
      { id: 'INV-1003', number: '1003', customer: { name: 'Blue River Paper', city: 'Boise' }, amount_usd: 4420.75, status: 'overdue', due_date: '2026-12-15', paid: false, lines: [] },
    ],
  },
  meta: { total: 3, page: 1 },
  links: [{ rel: 'self', href: '/invoices' }],
}
const root = inferSchema(invoicesResponse)

describe('response array detection', () => {
  it('picks the list of records over metadata lists and sub-lists', () => {
    const { best, candidates } = detectRowArrays(root, invoicesResponse)
    expect(best).toBe('data.invoices')
    expect(candidates[0]).toMatchObject({ path: 'data.invoices', count: 3, objectItems: true, nested: false })
    // links (a metadata list) and the per-row lines rank lower.
    const paths = candidates.map((c) => c.path)
    expect(paths.indexOf('links')).toBeGreaterThan(0)
    expect(candidates.find((c) => c.path === 'data.invoices[].lines')?.nested).toBe(true)
  })

  it('takes the response itself when it is the list', () => {
    const list = [{ id: 'C-1', name: 'Acme' }, { id: 'C-2', name: 'Apex' }]
    expect(detectRowArrays(inferSchema(list), list).best).toBe('')
  })

  it('prefers conventionally named lists and lists of records', () => {
    const body = { tags: ['a', 'b', 'c', 'd'], results: [{ id: 1 }] }
    expect(detectRowArrays(inferSchema(body), body).best).toBe('results')
  })

  it('has nothing to pick in a response without lists', () => {
    const body = { id: 1, name: 'x' }
    expect(detectRowArrays(inferSchema(body), body)).toEqual({ best: null, candidates: [] })
    expect(detectRowArrays(null)).toEqual({ best: null, candidates: [] })
  })

  it('reads a stored model, unwrapping a whole test result', () => {
    const wrapped = { version: 1 as const, source: 'sample' as const, root: inferSchema({ status: 200, data: invoicesResponse }), sample: { status: 200, data: invoicesResponse } }
    const view = responseView(wrapped)
    expect(detectRowArrays(view.root, view.sample).best).toBe('data.invoices')
  })

  it('reads sample rows, flattening a[].b', () => {
    expect(sampleRows(invoicesResponse, 'data.invoices')).toHaveLength(3)
    expect(sampleRows(invoicesResponse, 'data.invoices[].lines')).toEqual([{ sku: 'P-1', qty: 2 }])
    expect(sampleRows(['x'], '')).toEqual([{ value: 'x' }])
  })
})

describe('badge model', () => {
  const tree = responseBadges(root, invoicesResponse, 'data.invoices')
  const all = flattenBadges(tree)
  const at = (path: string) => all.find((b) => b.path === path)!

  it('badges every list with its row count, and marks the recommended and selected one', () => {
    expect(at('data.invoices')).toMatchObject({ kind: 'rows', label: 'invoices · 3 rows', count: 3, recommended: true, selected: true, icon: 'list' })
    expect(at('links')).toMatchObject({ kind: 'rows', label: 'links · 1 row' })
  })

  it('shows lists inside a row as sub-lists ("items (per row)")', () => {
    expect(at('data.invoices[].lines')).toMatchObject({ kind: 'sublist', label: 'lines · items (per row)' })
    expect(at('data.invoices[].lines').count).toBeUndefined()
  })

  it('badges objects and fields with a type icon; fields of the rows carry their row path', () => {
    expect(at('data')).toMatchObject({ kind: 'object', icon: 'object' })
    expect(at('data.invoices[].amount_usd')).toMatchObject({ kind: 'field', icon: 'number', rowPath: 'amount_usd', example: '1250.5' })
    expect(at('data.invoices[].customer.name')).toMatchObject({ rowPath: 'customer.name', icon: 'text' })
    expect(at('data.invoices[].customer')).toMatchObject({ kind: 'object', rowPath: 'customer' })
    expect(at('data.invoices[].due_date').icon).toBe('date')
    expect(at('data.invoices[].paid').icon).toBe('boolean')
    // Outside the rows: no row path.
    expect(at('meta.total').rowPath).toBeUndefined()
    // Inside a sub-list: not a column of these rows.
    expect(at('data.invoices[].lines[].sku').rowPath).toBeUndefined()
  })

  it('offers the right actions per badge and mode', () => {
    expect(badgeActions(at('links'), 'rows')).toEqual(['use_rows'])
    expect(badgeActions(at('data.invoices'), 'rows')).toEqual([])
    expect(badgeActions(at('data.invoices[].lines'), 'rows')).toEqual(['use_rows'])
    expect(badgeActions(at('data.invoices[].amount_usd'), 'rows')).toEqual(['add_column'])
    expect(badgeActions(at('data.invoices[].customer'), 'rows')).toEqual(['add_columns'])
    expect(badgeActions(at('data.invoices[].customer.name'), 'options')).toEqual(['set_value', 'set_label'])
    expect(badgeActions(at('meta.total'), 'rows')).toEqual(['use_total'])
    expect(badgeActions(at('meta.total'), 'options')).toEqual([])
  })

  it('has no row paths before rows are chosen', () => {
    const free = flattenBadges(responseBadges(root, invoicesResponse))
    expect(free.some((b) => b.rowPath !== undefined)).toBe(false)
    expect(free.find((b) => b.path === 'data.invoices')?.selected).toBeUndefined()
  })

  it('round-trips a drag payload and refuses anything else', () => {
    const payload = encodeBadgeDrag(at('data.invoices[].customer.name'))
    expect(decodeBadgeDrag(payload)).toEqual({ path: 'data.invoices[].customer.name', kind: 'field', rowPath: 'customer.name' })
    expect(decodeBadgeDrag('not json')).toBeNull()
    expect(decodeBadgeDrag(JSON.stringify({ path: 'a', kind: 'evil' }))).toBeNull()
    expect(decodeBadgeDrag(JSON.stringify({ path: 'a b c', kind: 'rows' }))).toBeNull()
    expect(decodeBadgeDrag(JSON.stringify({ path: 'a', kind: 'field', rowPath: '__proto__ x' }))).toBeNull()
    expect(decodeBadgeDrag(null)).toBeNull()
  })
})

describe('columns from sample rows', () => {
  const rows = sampleRows(invoicesResponse, 'data.invoices')
  const cols = generateColumns(rows)

  it('flattens nested objects, skips sub-lists and keeps first-seen order', () => {
    expect(cols.map((c) => c.key)).toEqual(['id', 'number', 'customer.name', 'customer.city', 'amount_usd', 'status', 'due_date', 'paid'])
  })

  it('types columns sensibly with plain labels', () => {
    const by = (k: string) => cols.find((c) => c.key === k)!
    expect(by('amount_usd')).toMatchObject({ type: 'number', format: { kind: 'currency', currency: 'USD' }, label: 'Amount USD' })
    expect(by('due_date')).toMatchObject({ type: 'date', label: 'Due date' })
    expect(by('paid')).toMatchObject({ type: 'boolean' })
    expect(by('status')).toMatchObject({ type: 'choice', options: ['open', 'overdue', 'paid'] })
    expect(by('customer.name').label).toBe('Customer name')
    expect(by('id').label).toBe('ID')
  })

  it('keeps the API’s field order when the stored sample’s keys were reordered (JSONB)', () => {
    // Postgres jsonb returns shorter keys first: id, paid, number, status, …
    const reordered = rows.map((r) => Object.fromEntries(Object.entries(r).sort(([a], [b]) => a.length - b.length || a.localeCompare(b))))
    expect(generateColumns(reordered).map((c) => c.key)[1]).toBe('paid')
    const order = rowFieldOrder(root, 'data.invoices')
    expect(order.slice(0, 3)).toEqual(['id', 'number', 'customer.name'])
    expect(generateColumns(reordered, { order }).map((c) => c.key)).toEqual(cols.map((c) => c.key))
    expect(rowFieldOrder(null, 'x')).toEqual([])
  })

  it('ticks the first six to show', () => {
    expect(cols.filter((c) => c.show).map((c) => c.key)).toHaveLength(6)
    expect(generateColumns(rows, { showFirst: 2 }).filter((c) => c.show)).toHaveLength(2)
  })

  it('infers types from values', () => {
    expect(inferColumnType('created', ['2026-11-01T10:00:00Z'])).toEqual({ type: 'datetime' })
    expect(inferColumnType('site', ['https://example.com'])).toEqual({ type: 'text', format: { kind: 'link' } })
    expect(inferColumnType('email', ['ap@example.com'])).toEqual({ type: 'text', format: { kind: 'link', link_type: 'email' } })
    expect(inferColumnType('order_id', [12, 13])).toEqual({ type: 'number' })
    expect(inferColumnType('x', [null, ''])).toEqual({ type: 'text' })
  })

  it('labels', () => {
    expect(humanizeLabel('dueDate')).toBe('Due date')
    expect(humanizeLabel('customer.customer_id')).toBe('Customer ID')
    expect(humanizeLabel('po_number')).toBe('PO number')
  })

  it('suggests a key, and a value and label for dropdowns', () => {
    expect(suggestKeyField(['name', 'id'])).toBe('id')
    expect(suggestKeyField(['name', 'customer_id'])).toBe('customer_id')
    expect(suggestKeyField(['name'])).toBeNull()
    expect(suggestValueLabel([{ key: 'id', type: 'text' }, { key: 'name', type: 'text' }, { key: 'city', type: 'text' }])).toEqual({ value: 'id', label: 'name' })
    expect(suggestValueLabel([{ key: 'code', type: 'text' }, { key: 'city', type: 'text' }])).toEqual({ value: 'code', label: 'city' })
  })
})

describe('the binding saved: form Data table control', () => {
  const empty: DataTableFieldConfig = { source: 'table', mode: 'display', columns: [] }

  it('uses a list as rows: source, path, shown columns, a hidden key and the total', () => {
    const next = applyRowsPath({ ...empty, reference_id: 'r1' }, 'data.invoices', root, invoicesResponse)
    expect(next).toMatchObject({ source: 'reference', reference_id: 'r1', results_path: 'data.invoices', key_column: 'id', total_path: 'meta.total' })
    expect(next.columns.map((c) => c.key)).toEqual(['id', 'number', 'customer.name', 'customer.city', 'amount_usd', 'status'])
    // It survives the server's normalisation as saved.
    const saved = normalizeDataTableConfig(next)
    expect(saved).toMatchObject({ source: 'reference', reference_id: 'r1', results_path: 'data.invoices', key_column: 'id' })
    expect(saved?.columns.find((c) => c.key === 'amount_usd')?.format).toEqual({ kind: 'currency', currency: 'USD' })
  })

  it('keeps the key column (hidden) when it is not among the shown ones', () => {
    const body = { rows: [{ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, id: 'x' }] }
    const next = applyRowsPath(empty, 'rows', inferSchema(body), body)
    expect(next.columns.find((c) => c.key === 'id')).toMatchObject({ hidden: true })
    expect(next.key_column).toBe('id')
  })

  it('adds a dropped field as a typed column, once', () => {
    const base = applyRowsPath(empty, 'data.invoices', root, invoicesResponse)
    const next = addFieldColumn(base, 'paid', invoicesResponse)
    expect(next.columns.at(-1)).toMatchObject({ key: 'paid', type: 'boolean', label: 'Paid' })
    expect(addFieldColumn(next, 'paid', invoicesResponse)).toBe(next)
    expect(addFieldColumn(next, 'bad path!', invoicesResponse)).toBe(next)
  })

  it('shows exactly the ticked columns, keeping edits and hand-added columns', () => {
    const base = applyRowsPath(empty, 'data.invoices', root, invoicesResponse)
    const edited = { ...base, columns: [...base.columns.map((c) => (c.key === 'number' ? { ...c, label: 'Invoice #' } : c)), { key: 'extra.path', label: 'Extra', type: 'text' as const }] }
    const generated = generateColumns(sampleRows(invoicesResponse, 'data.invoices'))
    const next = setShownColumns(edited, generated, ['number', 'paid'])
    expect(next.columns.map((c) => [c.key, c.hidden ?? false])).toEqual([['id', true], ['number', false], ['paid', false], ['extra.path', false]])
    expect(next.columns.find((c) => c.key === 'number')?.label).toBe('Invoice #')
  })

  it('stores the refresh choices', () => {
    const saved = normalizeDataTableConfig({ ...empty, table_id: 't', columns: [{ key: 'a', label: 'A', type: 'text' }], refresh_on_change: false, refresh_button: true })
    expect(saved).toMatchObject({ refresh_on_change: false, refresh_button: true })
    expect(refreshChoices(saved!)).toEqual(['on_open', 'button'])
    expect(refreshChoices({})).toEqual(['on_open', 'on_change'])
    expect(normalizeDataTableConfig({ ...empty, table_id: 't', refresh_on_change: true, refresh_button: 'yes' })).not.toHaveProperty('refresh_on_change')
  })
})

describe('the binding saved: a Data grid / Data table column (dropdown options)', () => {
  const customers = [{ id: 'C-100', name: 'Acme Supplies', city: 'Denver' }, { id: 'C-101', name: 'Apex Office', city: 'Austin' }]

  it('uses a list as options with a suggested value and label (the shared LookupConfig)', () => {
    const binding: LookupConfig = { source: 'reference', reference_id: 'r2', integration_id: 'i1', fill: [{ from: 'x', to: 'y' }] }
    const next = bindingUseRows(binding, '', customers)
    expect(next).toEqual({ source: 'reference', reference_id: 'r2', integration_id: 'i1', results_path: undefined, value_field: 'id', display_fields: ['name'], fill: undefined })
  })

  it('sets the value or the label from a dropped field', () => {
    const b: LookupConfig = { source: 'reference', reference_id: 'r2', value_field: 'id', display_fields: ['name', 'city'] }
    expect(bindingSetValue(b, 'city').value_field).toBe('city')
    expect(bindingSetLabel(b, 'city').display_fields).toEqual(['city', 'name'])
    expect(bindingSetValue(b, 'no good')).toBe(b)
  })
})

describe('parameters', () => {
  const inputs = [{ name: 'q' }, { name: 'page' }, { name: 'per_page' }, { name: 'status' }, { name: 'region' }, { name: 'x' }]
  it('suggests mappings from names and form fields', () => {
    expect(suggestInputMappings(inputs, [{ key: 'status', label: 'Invoice status' }, { key: 'area', label: 'Region' }])).toEqual({
      q: '{{search}}', page: '{{page}}', per_page: '{{page_size}}', status: '{{form.status}}', region: '{{form.area}}',
    })
    expect(suggestInputMappings(inputs, [], { q: 'fixed' }, { tableState: false })).toEqual({})
    expect(suggestInputMappings([{ name: 'customer' }], [{ key: 'customer' }], {}, { fieldPrefix: 'task_data' })).toEqual({ customer: '{{task_data.customer}}' })
  })

  it('turns API paging on and off', () => {
    expect(pagingSupport(inputs, undefined)).toEqual({ possible: true, on: false })
    const on = setPaging(inputs, { status: 'open' }, true)
    expect(on).toEqual({ status: 'open', page: '{{page}}', per_page: '{{page_size}}' })
    expect(pagingSupport(inputs, on).on).toBe(true)
    expect(setPaging(inputs, on, false)).toEqual({ status: 'open' })
    expect(pagingSupport([{ name: 'q' }], undefined).possible).toBe(false)
  })
})

describe('errors in plain words', () => {
  it('points a missing key at the reference settings', () => {
    expect(explainApiError('The API answered 401: Missing or invalid API key')).toMatchObject({ title: 'The API needs a key or a sign-in', settings: true })
    expect(explainApiError('The API answered 404')).toMatchObject({ settings: true })
    expect(explainApiError('The API answered 503').title).toBe('The API had a problem')
    expect(explainApiError('The API returned an empty response — there is nothing to build a model from').title).toBe('The API returned nothing')
    expect(explainApiError('weird')).toEqual({ title: 'The test call failed', fix: 'weird' })
  })
})

describe('a pasted API address', () => {
  it('matches an existing connection and turns query parameters into inputs', () => {
    const parsed = parseApiAddress('https://api.example.com/v2/invoices?status=open&limit=50', [{ id: 'c1', base_url: 'https://api.example.com/v2/' }, { id: 'c2', base_url: 'https://api.example.com' }])
    expect(parsed).toEqual({ baseUrl: 'https://api.example.com/v2', path: '/invoices', params: [{ name: 'status', value: 'open' }, { name: 'limit', value: '50' }], connectionId: 'c1', name: 'Invoices' })
  })
  it('falls back to the origin, and refuses non-http or credentialled addresses', () => {
    expect(parseApiAddress('https://billing.example.com/customers')).toMatchObject({ baseUrl: 'https://billing.example.com', path: '/customers', name: 'Customers' })
    expect(parseApiAddress('ftp://x.example.com/a')).toBeNull()
    expect(parseApiAddress('https://user:pw@x.example.com/a')).toBeNull()
    expect(parseApiAddress('not a url')).toBeNull()
  })
})
