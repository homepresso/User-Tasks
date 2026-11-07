/**
 * Official action ut_data (gallery/actions/data-transform): contract checks
 * and every operation run in the QuickJS sandbox from the built module.
 */
import { describe, expect, it } from 'vitest'
import { contractSuite, fails, ok } from '../gallery/actions/scripts/test-kit'

const action = contractSuite('data-transform', {
  key: 'ut_data',
  operations: ['select', 'map', 'filter', 'sort', 'group', 'pivot', 'unpivot', 'dedupe', 'join', 'csv_to_json', 'json_to_csv'],
  capabilities: [],
  dynamicLists: true,
})

const ORDERS = [
  { id: 'SO-1', region: 'North', product: 'Desk', status: 'paid', amount: 1200, qty: 2 },
  { id: 'SO-2', region: 'South', product: 'Chair', status: 'paid', amount: 300, qty: 3 },
  { id: 'SO-3', region: 'North', product: 'Chair', status: 'open', amount: 450, qty: 5 },
  { id: 'SO-4', region: 'North', product: 'Desk', status: 'paid', amount: 600, qty: 1 },
  { id: 'SO-5', region: 'South', product: 'Lamp', status: 'void', amount: 80, qty: 2 },
]
const ids = (items: Array<{ id: string }>) => items.map((r) => r.id)

describe('ut_data select', () => {
  const data = { order: { id: 'SO-1', lines: [{ sku: 'A1', qty: 2 }, { sku: 'B2', qty: 1 }], 'ship to': { city: 'Auckland' } } }
  it('reads paths, indexes, wildcards and quoted keys', async () => {
    expect(await ok(action, 'select', { data, path: 'order.lines[0].sku' })).toEqual({ value: 'A1', values: ['A1'], found: true, count: 1 })
    expect((await ok(action, 'select', { data, path: '$.order.lines[-1].qty' })).value).toBe(1)
    expect(await ok(action, 'select', { data, path: 'order.lines[*].sku' })).toEqual({ value: ['A1', 'B2'], values: ['A1', 'B2'], found: true, count: 2 })
    expect((await ok(action, 'select', { data, path: 'order["ship to"].city' })).value).toBe('Auckland')
    expect((await ok(action, 'select', { data, path: 'order.*' })).count).toBe(3)
    expect((await ok(action, 'select', { data: [{ a: 1 }, { a: 2 }], path: '[*].a' })).value).toEqual([1, 2])
    expect((await ok(action, 'select', { data: '{"x":{"y":5}}', path: 'x.y' })).value).toBe(5)
  })

  it('reports missing values', async () => {
    expect(await ok(action, 'select', { data, path: 'order.customer.name' })).toEqual({ value: null, values: [], found: false, count: 0 })
    expect((await ok(action, 'select', { data, path: 'order.lines[*].missing' })).value).toEqual([])
    await fails(action, 'select', { data, path: 'order.lines[x' }, /not valid/)
  })
})

describe('ut_data map', () => {
  it('picks, renames and nests fields', async () => {
    const out = await ok(action, 'map', { items: ORDERS.slice(0, 2), fields: ['id', 'product as item', 'amount as total.value', { from: 'discount', to: 'discount', default: 0 }] })
    expect(out).toEqual({
      items: [
        { id: 'SO-1', item: 'Desk', total: { value: 1200 }, discount: 0 },
        { id: 'SO-2', item: 'Chair', total: { value: 300 }, discount: 0 },
      ],
      count: 2,
    })
  })

  it('keeps other fields on request', async () => {
    const out = await ok(action, 'map', { items: [{ a: 1, b: 2 }], fields: ['a as x'], keep_other_fields: true })
    expect(out.items).toEqual([{ b: 2, x: 1 }])
  })

  it('rejects non-objects', async () => {
    await fails(action, 'map', { items: [1, 2], fields: ['a'] }, /items\[0\] is not an object/)
  })
})

describe('ut_data filter', () => {
  it('combines conditions with all / any', async () => {
    const all = await ok(action, 'filter', { items: ORDERS, conditions: [{ field: 'status', operator: 'eq', value: 'paid' }, { field: 'amount', operator: 'gte', value: 500 }] })
    expect(ids(all.items)).toEqual(['SO-1', 'SO-4'])
    expect(all.removed).toBe(3)
    const any = await ok(action, 'filter', { items: ORDERS, conditions: [{ field: 'status', operator: 'eq', value: 'void' }, { field: 'amount', operator: '>', value: 1000 }], combine: 'any' })
    expect(ids(any.items)).toEqual(['SO-1', 'SO-5'])
  })

  it('supports every operator', async () => {
    const f = async (operator: string, field: string, value?: unknown, extra: Record<string, unknown> = {}) => ids((await ok(action, 'filter', { items: ORDERS, conditions: [{ field, operator, value }], ...extra })).items)
    expect(await f('ne', 'region', 'north')).toEqual(['SO-2', 'SO-5'])
    expect(await f('eq', 'region', 'north', { case_sensitive: true })).toEqual([])
    expect(await f('lt', 'amount', '300')).toEqual(['SO-5'])
    expect(await f('lte', 'amount', 300)).toEqual(['SO-2', 'SO-5'])
    expect(await f('gt', 'qty', 2)).toEqual(['SO-2', 'SO-3'])
    expect(await f('contains', 'product', 'ha')).toEqual(['SO-2', 'SO-3'])
    expect(await f('not_contains', 'product', 'ha')).toEqual(['SO-1', 'SO-4', 'SO-5'])
    expect(await f('starts_with', 'id', 'so-')).toEqual(ids(ORDERS))
    expect(await f('ends_with', 'id', '5')).toEqual(['SO-5'])
    expect(await f('in', 'status', ['open', 'void'])).toEqual(['SO-3', 'SO-5'])
    expect(await f('in', 'status', 'open, void')).toEqual(['SO-3', 'SO-5'])
    expect(await f('not_in', 'status', ['open', 'void'])).toEqual(['SO-1', 'SO-2', 'SO-4'])
    const sparse = [{ id: 'a', note: '' }, { id: 'b', note: 'x' }, { id: 'c' }, { id: 'd', note: [] }]
    expect(ids((await ok(action, 'filter', { items: sparse, conditions: [{ field: 'note', operator: 'empty' }] })).items)).toEqual(['a', 'c', 'd'])
    expect(ids((await ok(action, 'filter', { items: sparse, conditions: [{ field: 'note', operator: 'not_empty' }] })).items)).toEqual(['b'])
    const tags = [{ id: 'a', tags: ['x', 'y'] }, { id: 'b', tags: ['z'] }]
    expect(ids((await ok(action, 'filter', { items: tags, conditions: [{ field: 'tags', operator: 'contains', value: 'y' }] })).items)).toEqual(['a'])
    const dates = [{ id: 'a', due: '2026-11-01' }, { id: 'b', due: '2026-12-01' }]
    expect(ids((await ok(action, 'filter', { items: dates, conditions: [{ field: 'due', operator: 'gte', value: '2026-11-15' }] })).items)).toEqual(['b'])
  })

  it('rejects bad conditions', async () => {
    await fails(action, 'filter', { items: ORDERS, conditions: [{ field: 'x', operator: 'like' }] }, /operator must be one of/)
    await fails(action, 'filter', { items: ORDERS, conditions: [{ operator: 'eq' }] }, /field is required/)
    await fails(action, 'filter', { items: ORDERS, conditions: ['status = paid'] }, /must be an object/)
  })
})

describe('ut_data sort', () => {
  it('sorts on several keys, stably, with empty values last', async () => {
    expect(ids((await ok(action, 'sort', { items: ORDERS, keys: ['region', 'amount desc'] })).items)).toEqual(['SO-1', 'SO-4', 'SO-3', 'SO-2', 'SO-5'])
    expect(ids((await ok(action, 'sort', { items: ORDERS, keys: ['-qty'] })).items)).toEqual(['SO-3', 'SO-2', 'SO-1', 'SO-5', 'SO-4'])
    expect(ids((await ok(action, 'sort', { items: ORDERS, keys: [{ field: 'product', direction: 'asc' }] })).items)).toEqual(['SO-2', 'SO-3', 'SO-1', 'SO-4', 'SO-5'])
    const mixed = [{ id: 'a', v: '10' }, { id: 'b', v: 9 }, { id: 'c' }, { id: 'd', v: '9.5' }]
    expect(ids((await ok(action, 'sort', { items: mixed, keys: ['v'] })).items)).toEqual(['b', 'd', 'a', 'c'])
    expect(ids((await ok(action, 'sort', { items: mixed, keys: ['v desc'] })).items)).toEqual(['a', 'd', 'b', 'c'])
    expect(ids((await ok(action, 'sort', { items: mixed, keys: ['v asc text'] })).items)).toEqual(['a', 'b', 'd', 'c'])
    const dates = [{ id: 'a', d: '2026-11-02T10:00:00Z' }, { id: 'b', d: '2026-11-02T09:00:00+13:00' }]
    expect(ids((await ok(action, 'sort', { items: dates, keys: ['d asc date'] })).items)).toEqual(['b', 'a'])
  })

  it('rejects bad keys', async () => {
    await fails(action, 'sort', { items: ORDERS, keys: ['amount sideways'] }, /direction must be asc or desc/)
  })
})

describe('ut_data group', () => {
  it('groups with aggregates', async () => {
    const out = await ok(action, 'group', { items: ORDERS, group_by: ['region'], aggregates: ['sum:amount', 'avg(amount) as average', { op: 'max', field: 'amount' }, 'min:amount', 'count_distinct:product', 'list:id', 'first:id', 'last:id'] })
    expect(out).toEqual({
      count: 2,
      groups: [
        { region: 'North', count: 3, sum_amount: 2250, average: 750, max_amount: 1200, min_amount: 450, count_distinct_product: 2, list_id: ['SO-1', 'SO-3', 'SO-4'], first_id: 'SO-1', last_id: 'SO-4' },
        { region: 'South', count: 2, sum_amount: 380, average: 190, max_amount: 300, min_amount: 80, count_distinct_product: 2, list_id: ['SO-2', 'SO-5'], first_id: 'SO-2', last_id: 'SO-5' },
      ],
    })
  })

  it('groups by several fields and counts', async () => {
    const out = await ok(action, 'group', { items: ORDERS, group_by: 'region, product', aggregates: ['count', 'sum:qty'] })
    expect(out.groups).toEqual([
      { region: 'North', product: 'Desk', count: 2, sum_qty: 3 },
      { region: 'South', product: 'Chair', count: 1, sum_qty: 3 },
      { region: 'North', product: 'Chair', count: 1, sum_qty: 5 },
      { region: 'South', product: 'Lamp', count: 1, sum_qty: 2 },
    ])
  })

  it('rejects unknown aggregates', async () => {
    await fails(action, 'group', { items: ORDERS, group_by: ['region'], aggregates: ['median:amount'] }, /op must be one of/)
    await fails(action, 'group', { items: ORDERS, group_by: ['region'], aggregates: ['sum'] }, /sum needs a field/)
  })
})

describe('ut_data pivot and unpivot', () => {
  it('pivots values into columns', async () => {
    expect(await ok(action, 'pivot', { items: ORDERS, rows: ['region'], column: 'product', value: 'amount', fill: 0 })).toEqual({
      items: [{ region: 'North', Desk: 1800, Chair: 450, Lamp: 0 }, { region: 'South', Desk: 0, Chair: 300, Lamp: 80 }],
      columns: ['Desk', 'Chair', 'Lamp'],
      count: 2,
    })
    const counts = await ok(action, 'pivot', { items: ORDERS, rows: ['region'], column: 'status', aggregate: 'count' })
    expect(counts.items[0]).toEqual({ region: 'North', paid: 2, open: 1, void: null })
    await fails(action, 'pivot', { items: ORDERS, rows: ['region'], column: 'status' }, /value is required for sum/)
  })

  it('unpivots columns into rows', async () => {
    const out = await ok(action, 'unpivot', { items: [{ region: 'North', Desk: 1800, Chair: 450 }, { region: 'South', Desk: null, Chair: 300 }], keep_fields: ['region'], name_field: 'product', value_field: 'amount', skip_empty: true })
    expect(out).toEqual({
      items: [
        { region: 'North', product: 'Desk', amount: 1800 },
        { region: 'North', product: 'Chair', amount: 450 },
        { region: 'South', product: 'Chair', amount: 300 },
      ],
      count: 3,
    })
    expect((await ok(action, 'unpivot', { items: [{ a: 1, b: 2, c: 3 }], columns: ['b'] })).items).toEqual([{ name: 'b', value: 2 }])
  })
})

describe('ut_data dedupe', () => {
  const people = [{ email: 'a@x.io', n: 1 }, { email: 'A@x.io', n: 2 }, { email: 'b@x.io', n: 3 }, { email: 'a@x.io', n: 4 }]
  it('removes duplicates by fields, first or last', async () => {
    expect(await ok(action, 'dedupe', { items: people, fields: ['email'] })).toEqual({ items: [people[0], people[1], people[2]], count: 3, removed: 1 })
    expect((await ok(action, 'dedupe', { items: people, fields: ['email'], case_sensitive: false })).items).toEqual([people[0], people[2]])
    expect((await ok(action, 'dedupe', { items: people, fields: ['email'], case_sensitive: false, keep: 'last' })).items).toEqual([people[2], people[3]])
  })

  it('removes duplicate plain values and whole objects', async () => {
    expect((await ok(action, 'dedupe', { items: [3, 1, 3, 2, 1] })).items).toEqual([3, 1, 2])
    expect((await ok(action, 'dedupe', { items: [{ a: 1 }, { a: 1 }, { a: 2 }] })).removed).toBe(1)
  })
})

describe('ut_data join', () => {
  const managers = [{ region: 'North', manager: 'Aroha' }, { region: 'West', manager: 'Cai' }]
  it('inner, left, right and full joins', async () => {
    const inner = await ok(action, 'join', { left: ORDERS, right: managers, left_key: ['region'] })
    expect(ids(inner.items)).toEqual(['SO-1', 'SO-3', 'SO-4'])
    expect(inner.items[0]).toEqual({ ...ORDERS[0], manager: 'Aroha' })
    expect(inner).toMatchObject({ count: 3, unmatched_left: 2, unmatched_right: 1 })
    const left = await ok(action, 'join', { left: ORDERS, right: managers, left_key: ['region'], type: 'left' })
    expect(left.count).toBe(5)
    expect(left.items[1]).toEqual(ORDERS[1])
    const right = await ok(action, 'join', { left: ORDERS, right: managers, left_key: ['region'], type: 'right' })
    expect(right.items[right.count - 1]).toEqual({ region: 'West', manager: 'Cai' })
    expect(right.count).toBe(4)
    const full = await ok(action, 'join', { left: ORDERS, right: managers, left_key: ['region'], type: 'full' })
    expect(full.count).toBe(6)
  })

  it('joins on differently named and multiple keys, prefixes and clashes', async () => {
    const people = [{ code: 'north', name: 'Aroha', status: 'active' }]
    const out = await ok(action, 'join', { left: ORDERS.slice(0, 1), right: people, left_key: ['region'], right_key: ['code'], case_sensitive: false })
    expect(out.items).toEqual([{ ...ORDERS[0], code: 'north', name: 'Aroha', right_status: 'active' }])
    const prefixed = await ok(action, 'join', { left: ORDERS.slice(0, 1), right: people, left_key: 'region', right_key: 'code', right_prefix: 'mgr_', case_sensitive: false })
    expect(prefixed.items[0]).toMatchObject({ mgr_code: 'north', mgr_name: 'Aroha', mgr_status: 'active', status: 'paid' })
    const multi = await ok(action, 'join', { left: [{ a: 1, b: 'x', v: 1 }, { a: 1, b: 'y', v: 2 }], right: [{ a: '1', b: 'y', w: 9 }], left_key: ['a', 'b'] })
    expect(multi.items).toEqual([{ a: 1, b: 'y', v: 2, w: 9 }])
    await fails(action, 'join', { left: [], right: [], left_key: ['a', 'b'], right_key: ['a'] }, /same number of fields/)
  })
})

describe('ut_data CSV', () => {
  it('parses RFC 4180 CSV with types', async () => {
    const csv = '﻿id,name,amount,active,zip,note\r\n1,"Smith, Jo",12.50,TRUE,007,"line 1\nline 2 ""quoted"""\r\n2,Ana,7,false,,\r\n'
    const out = await ok(action, 'csv_to_json', { csv })
    expect(out).toEqual({
      columns: ['id', 'name', 'amount', 'active', 'zip', 'note'],
      count: 2,
      items: [
        { id: 1, name: 'Smith, Jo', amount: 12.5, active: true, zip: '007', note: 'line 1\nline 2 "quoted"' },
        { id: 2, name: 'Ana', amount: 7, active: false, zip: null, note: null },
      ],
    })
  })

  it('detects delimiters and works without a header or type inference', async () => {
    expect((await ok(action, 'csv_to_json', { csv: 'a;b\n1;2' })).items).toEqual([{ a: 1, b: 2 }])
    expect((await ok(action, 'csv_to_json', { csv: 'a\tb\n1\t2', delimiter: 'tab', infer_types: false })).items).toEqual([{ a: '1', b: '2' }])
    expect(await ok(action, 'csv_to_json', { csv: 'x,y\n\n1,2,3', header: false })).toEqual({ columns: ['column_1', 'column_2', 'column_3'], count: 2, items: [{ column_1: 'x', column_2: 'y', column_3: null }, { column_1: 1, column_2: 2, column_3: 3 }] })
    expect((await ok(action, 'csv_to_json', { csv: 'a,a,\n1,2,3' })).columns).toEqual(['a', 'a_2', 'column_3'])
    expect((await ok(action, 'csv_to_json', { csv: 'n\n12345678901234567890' })).items[0].n).toBe('12345678901234567890')
    await fails(action, 'csv_to_json', { csv: 'a\n"open' }, /unclosed quote/)
  })

  it('writes CSV with quoting, headers and formula escaping', async () => {
    const items = [{ id: 1, name: 'Smith, Jo', note: 'say "hi"', formula: '=SUM(A1)', tags: ['a', 'b'], empty: null }, { id: 2, name: ' Ana', note: 'two\nlines', formula: '-5' }]
    const out = await ok(action, 'json_to_csv', { items })
    expect(out.columns).toEqual(['id', 'name', 'note', 'formula', 'tags', 'empty'])
    expect(out.csv).toBe('id,name,note,formula,tags,empty\r\n1,"Smith, Jo","say ""hi""",\'=SUM(A1),"[""a"",""b""]",\r\n2," Ana","two\nlines",\'-5,,\r\n')
    expect(out.count).toBe(2)
    const custom = await ok(action, 'json_to_csv', { items: [{ a: { b: 1 }, c: 2 }], columns: ['a.b as B', 'c'], delimiter: ';', line_ending: 'lf', escape_formulas: false })
    expect(custom.csv).toBe('B;c\n1;2\n')
    expect((await ok(action, 'json_to_csv', { items: [{ a: 1 }], header: false })).csv).toBe('1\r\n')
  })

  it('round-trips', async () => {
    const items = [{ id: 1, text: 'a, "b"\nc', ok: true }]
    const csv = (await ok(action, 'json_to_csv', { items })).csv
    expect((await ok(action, 'csv_to_json', { csv, trim: false })).items).toEqual(items)
  })
})
