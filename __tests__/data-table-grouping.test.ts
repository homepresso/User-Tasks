/**
 * Grouping and child records of a Data table grid — the pure logic
 * (lib/grid/grouping.ts): group keys and the "(empty)" group, the in-memory
 * grouping that stands in for data_table_row_groups (counts and sums that
 * add up across levels), the filters that select one group's rows (they
 * must select exactly the rows the group counted), row filters / sort with
 * the database's semantics, view group_by normalisation, child relation
 * config validation, the parent link value and the hierarchy cycle guard.
 */
import { describe, expect, it } from 'vitest'
import {
  EMPTY_GROUP_LABEL, GROUPING_LIMITS, buildGroupTree, cellText, childRelationProblems, compareGroupValues, expandStateKey, groupFilters, groupKeyOf, groupLabel,
  groupRowsInMemory, isSafeColumnKey, lookupColumnsTo, nextAncestors, normalizeChildRelations, normalizeGroupBy, parentLinkValue, parseExpandState,
  relationLookupColumn, rootsOnlyFilter, rowMatchesFilters, rowMatchesSearch, sortRowsLikeDatabase, splitRootFilter, filterRoots,
} from '@/lib/grid/grouping'
import { normalizeGridViews } from '@/lib/grid/column-model'

const rows = [
  { id: 'r1', data: { status: 'open', region: 'east', amount: 10 }, updated_at: '2026-11-01T00:00:00Z' },
  { id: 'r2', data: { status: 'open', region: 'west', amount: '5.5' }, updated_at: '2026-11-02T00:00:00Z' },
  { id: 'r3', data: { status: 'closed', region: 'east', amount: 1 }, updated_at: '2026-11-03T00:00:00Z' },
  { id: 'r4', data: { status: '  ', amount: 'n/a' }, updated_at: '2026-11-04T00:00:00Z' },
  { id: 'r5', data: { region: 'east' }, updated_at: '2026-11-05T00:00:00Z' },
  { id: 'r6', data: { status: 'Open', region: 'east', amount: 2 }, updated_at: '2026-11-06T00:00:00Z' },
]

describe('group keys', () => {
  it('uses the cell text; blank cells (missing, null, spaces) are the empty group', () => {
    expect(groupKeyOf('open')).toBe('open')
    expect(groupKeyOf(12)).toBe('12')
    expect(groupKeyOf(true)).toBe('true')
    expect(groupKeyOf(undefined)).toBeNull()
    expect(groupKeyOf(null)).toBeNull()
    expect(groupKeyOf('   ')).toBeNull()
    expect(groupKeyOf('')).toBeNull()
    expect(cellText({ a: 1 })).toBe('{"a":1}')
  })

  it('labels the empty group and yes / no columns', () => {
    expect(groupLabel(null)).toBe(EMPTY_GROUP_LABEL)
    expect(groupLabel('true', 'boolean')).toBe('Yes')
    expect(groupLabel('false', 'boolean')).toBe('No')
    expect(groupLabel('east', 'text')).toBe('east')
  })

  it('orders groups: empty first, numbers numerically, text naturally', () => {
    const values = ['10', null, '9', 'b', 'A']
    expect([...values].sort(compareGroupValues)).toEqual([null, '9', '10', 'A', 'b'])
  })
})

describe('grouping rows (data_table_row_groups in memory)', () => {
  it('counts one level, keeps distinct texts apart (case matters) and sums numbers only', () => {
    const tree = buildGroupTree(groupRowsInMemory(rows, ['status'], ['amount']), 1)
    expect(tree.map((g) => [g.value, g.count])).toEqual([[null, 2], ['closed', 1], ['open', 2], ['Open', 1]])
    expect(tree.find((g) => g.value === 'open')!.sums).toEqual({ amount: 15.5 })
    expect(tree.find((g) => g.value === null)!.sums).toEqual({})
    expect(tree.reduce((n, g) => n + g.count, 0)).toBe(rows.length)
  })

  it('nests two levels: level-1 counts and sums add up their level-2 groups', () => {
    const tree = buildGroupTree(groupRowsInMemory(rows, ['region', 'status'], ['amount']), 2)
    const east = tree.find((g) => g.value === 'east')!
    expect(east.count).toBe(4)
    expect(east.groups!.map((g) => [g.value, g.count])).toEqual([[null, 1], ['closed', 1], ['open', 1], ['Open', 1]])
    expect(east.sums.amount).toBe(13)
    expect(east.groups!.reduce((n, g) => n + g.count, 0)).toBe(east.count)
  })

  it('sorts groups descending per level when asked', () => {
    const tree = buildGroupTree(groupRowsInMemory(rows, ['region', 'status']), 2, ['desc', 'asc'])
    expect(tree.map((g) => g.value)).toEqual(['west', 'east', null])
    expect(tree[1].groups!.map((g) => g.value)[0]).toBeNull()
  })

  it('builds the same tree from the database\'s flat rows (string sums are accepted)', () => {
    const tree = buildGroupTree([
      { g1: 'a', g2: 'x', row_count: 2, sums: { amount: 3 } },
      { g1: 'a', g2: null, row_count: 1, sums: { amount: '4.5' as unknown as number } },
      { g1: null, g2: null, row_count: 5, sums: null },
    ], 2)
    expect(tree).toEqual([
      { value: null, count: 5, sums: {}, groups: [{ value: null, count: 5, sums: {} }] },
      { value: 'a', count: 3, sums: { amount: 7.5 }, groups: [{ value: null, count: 1, sums: { amount: 4.5 } }, { value: 'x', count: 2, sums: { amount: 3 } }] },
    ])
  })

  it('selects exactly the rows each group counted (so a group\'s rows match its header)', () => {
    const groupBy = ['region', 'status']
    const tree = buildGroupTree(groupRowsInMemory(rows, groupBy), 2)
    for (const g of tree) {
      for (const sub of g.groups!) {
        const members = rows.filter((r) => rowMatchesFilters(r, groupFilters(groupBy, [g.value, sub.value])))
        expect(members.length, `${g.value}/${sub.value}`).toBe(sub.count)
      }
      expect(rows.filter((r) => rowMatchesFilters(r, groupFilters(groupBy, [g.value]))).length).toBe(g.count)
    }
  })
})

describe('row filters and sort (data_table_row_matches / data_table_rows_page semantics)', () => {
  const row = { id: 'abc', data: { name: 'Acme Paper', amount: '12.5', empty: ' ' }, created_at: '2026-01-01T00:00:00Z' }
  it.each([
    [{ field: 'name', operator: 'equals', value: 'acme paper' }, true],
    [{ field: 'name', operator: 'not_equals', value: 'x' }, true],
    [{ field: 'name', operator: 'contains', value: 'PAP' }, true],
    [{ field: 'name', operator: 'starts_with', value: 'acme' }, true],
    [{ field: 'name', operator: 'ends_with', value: 'paper' }, true],
    [{ field: 'amount', operator: 'gt', value: 12 }, true],
    [{ field: 'amount', operator: 'lte', value: '12' }, false],
    [{ field: 'name', operator: 'gt', value: 1 }, false],
    [{ field: 'empty', operator: 'is_empty' }, true],
    [{ field: 'missing', operator: 'is_empty' }, true],
    [{ field: 'name', operator: 'not_empty' }, true],
    [{ field: 'name', operator: 'in', value: ['Acme Paper'] }, true],
    [{ field: 'name', operator: 'in', value: ['acme paper'] }, false],
    [{ field: 'id', operator: 'equals', value: 'ABC' }, true],
  ] as const)('%o → %s', (filter, expected) => {
    expect(rowMatchesFilters(row, [filter as never])).toBe(expected)
  })

  it('searches the row id and every cell, case-insensitively', () => {
    expect(rowMatchesSearch(row, 'ACME')).toBe(true)
    expect(rowMatchesSearch(row, 'ab')).toBe(true)
    expect(rowMatchesSearch(row, 'zzz')).toBe(false)
    expect(rowMatchesSearch(row, '  ')).toBe(true)
  })

  it('sorts numbers numerically (text after), then text; system fields by time', () => {
    expect(sortRowsLikeDatabase(rows, 'amount', 'desc').map((r) => r.id).slice(0, 4)).toEqual(['r1', 'r2', 'r6', 'r3'])
    expect(sortRowsLikeDatabase(rows, 'amount', 'asc').map((r) => r.id).slice(0, 4)).toEqual(['r3', 'r6', 'r2', 'r1'])
    expect(sortRowsLikeDatabase(rows, undefined, 'desc')[0].id).toBe('r6')
    expect(sortRowsLikeDatabase(rows, '_updated_at', 'asc')[0].id).toBe('r1')
  })
})

describe('view group_by', () => {
  it('keeps up to two distinct safe keys (known, groupable columns only when checked)', () => {
    expect(normalizeGroupBy(['status', 'status', 'region', 'amount'])).toEqual(['status', 'region'])
    expect(normalizeGroupBy('status,region')).toEqual(['status', 'region'])
    expect(normalizeGroupBy(['bad key!', 'status'])).toEqual(['status'])
    expect(normalizeGroupBy(['ghost', 'status'], new Set(['status']))).toEqual(['status'])
    expect(normalizeGroupBy(null)).toEqual([])
    expect(isSafeColumnKey("x'); drop")).toBe(false)
  })

  it('is saved with a view and dropped for unknown or ungroupable columns', () => {
    const tableColumns = [{ key: 'status', name: 'Status', type: 'select' }, { key: 'notes', name: 'Notes', type: 'longtext' }, { key: 'region', name: 'Region', type: 'text' }]
    const [view] = normalizeGridViews([{ id: 'v1', name: 'V', columns: [{ key: 'status' }], group_by: ['notes', 'status', 'ghost', 'region'] }], tableColumns)
    expect(view.group_by).toEqual(['status', 'region'])
    const [plain] = normalizeGridViews([{ id: 'v2', name: 'V', columns: [{ key: 'status' }], group_by: [] }], tableColumns)
    expect(plain.group_by).toBeUndefined()
  })
})

describe('child relations', () => {
  const ORDERS = '0f000000-0000-4000-8000-0000000000a1'
  const LINES = '0f000000-0000-4000-8000-0000000000a2'
  const TASKS = '0f000000-0000-4000-8000-0000000000a3'
  const lines = { id: LINES, name: 'Order lines', columns: [
    { key: 'order', name: 'Order', type: 'lookup', lookup: { sourceTableId: ORDERS, sourceColumn: 'Order No' } },
    { key: 'other', name: 'Other', type: 'lookup', lookup: { sourceTableId: TASKS, sourceColumn: 'title' } },
    { key: 'qty', name: 'Qty', type: 'number' },
  ] }
  const tasks = { id: TASKS, name: 'Tasks', columns: [{ key: 'parent', name: 'Parent', type: 'lookup', lookup: { sourceTableId: TASKS, sourceColumn: 'title' } }, { key: 'title', name: 'Title', type: 'text' }] }

  it('normalises the shape: ids kept or made, duplicates and junk dropped, at most five', () => {
    const out = normalizeChildRelations([
      { id: 'r_1', table_id: LINES, lookup_column: 'order', label: '  Lines  ', roots_only: 'yes' },
      { id: 'r_1', table_id: TASKS, lookup_column: 'parent', roots_only: true },
      { table_id: LINES, lookup_column: 'order' },
      { table_id: '', lookup_column: 'x' },
      { table_id: LINES, lookup_column: 'bad key' },
      'nope',
    ])
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({ id: 'r_1', table_id: LINES, lookup_column: 'order', label: 'Lines' })
    expect(out[1].id).not.toBe('r_1')
    expect(out[1].roots_only).toBe(true)
    expect(normalizeChildRelations(Array.from({ length: 9 }, (_, i) => ({ table_id: `t${i}`, lookup_column: 'c' })))).toHaveLength(GROUPING_LIMITS.relations)
  })

  it('accepts a lookup column of the child table whose source is this table', () => {
    const tables = new Map([[LINES, lines], [TASKS, tasks]])
    expect(childRelationProblems(ORDERS, [{ id: 'r', table_id: LINES, lookup_column: 'order' }], tables)).toEqual([])
    expect(childRelationProblems(TASKS, [{ id: 'r', table_id: TASKS, lookup_column: 'parent', roots_only: true }], tables)).toEqual([])
    expect(relationLookupColumn({ lookup_column: 'order' }, ORDERS, lines)).toEqual({ key: 'order', name: 'Order', sourceColumn: 'Order No' })
    expect(lookupColumnsTo(ORDERS, lines).map((c) => c.key)).toEqual(['order'])
  })

  it('refuses a missing table, a missing / non-lookup column, a lookup to another table, roots_only across tables', () => {
    const tables = new Map([[LINES, lines], [TASKS, tasks]])
    const problems = (rel: object) => childRelationProblems(ORDERS, [{ id: 'r', ...rel } as never], tables)
    expect(problems({ table_id: 'ghost', lookup_column: 'order' })[0]).toMatch(/was not found/)
    expect(problems({ table_id: LINES, lookup_column: 'nope' })[0]).toMatch(/has no column/)
    expect(problems({ table_id: LINES, lookup_column: 'qty' })[0]).toMatch(/is not a lookup column/)
    expect(problems({ table_id: LINES, lookup_column: 'other' })[0]).toMatch(/does not look up this table/)
    expect(problems({ table_id: LINES, lookup_column: 'order', roots_only: true })[0]).toMatch(/with itself/)
  })

  it('links children by the parent\'s value of the lookup\'s source column (name or key)', () => {
    expect(parentLinkValue({ order_no: 'A-1' }, 'Order No')).toBe('A-1')
    expect(parentLinkValue({ 'Order No': 'A-2' }, 'Order No')).toBe('A-2')
    expect(parentLinkValue({ id: 7 }, 'id')).toBe('7')
    expect(parentLinkValue({ order_no: ' ' }, 'Order No')).toBeNull()
    expect(parentLinkValue(null, 'Order No')).toBeNull()
  })

  it('stops a hierarchy at a cycle and at the depth limit', () => {
    expect(nextAncestors(['a'], 'b')).toEqual(['a', 'b'])
    expect(nextAncestors(['a', 'b'], 'a')).toBeNull()
    expect(nextAncestors(Array.from({ length: GROUPING_LIMITS.depth }, (_, i) => `r${i}`), 'x')).toBeNull()
  })

  it('lists only top-level rows of a same-table hierarchy when asked (the lookup\'s source name resolved to its key)', () => {
    const relations = [{ id: 'r', table_id: TASKS, lookup_column: 'parent', roots_only: true }, { id: 's', table_id: LINES, lookup_column: 'order', roots_only: true }]
    expect(rootsOnlyFilter(relations, TASKS, tasks.columns)).toEqual([{ field: 'parent', operator: 'is_root', value: 'title' }])
    expect(rootsOnlyFilter([{ id: 'r', table_id: TASKS, lookup_column: 'parent' }], TASKS, tasks.columns)).toEqual([])
    expect(splitRootFilter([{ field: 'parent', operator: 'is_root', value: 'title' }, { field: 'x', operator: 'is_empty' }]))
      .toEqual({ filters: [{ field: 'x', operator: 'is_empty' }], root: { field: 'parent', source: 'title' } })
  })

  it('keeps rows without a parent, with a missing parent, or that are their own parent at the top', () => {
    const tree = [
      { id: '1', data: { title: 'Launch' } },
      { id: '2', data: { title: 'Design', parent: 'Launch' } },
      { id: '3', data: { title: 'Orphan', parent: 'Deleted task' } },
      { id: '4', data: { title: 'Loop', parent: 'Loop' } },
      { id: '5', data: { title: 'Blank', parent: '  ' } },
    ]
    expect(filterRoots(tree, { field: 'parent', source: 'title' }).map((r) => r.id)).toEqual(['1', '3', '4', '5'])
  })
})

describe('expand state', () => {
  it('is keyed per user, table and view, and tolerates junk', () => {
    expect(expandStateKey('children', 't1', 'v1', 'u1')).toBe('ut-dt-children:u1:t1:v1')
    expect(expandStateKey('groups', 't1', 'default', null)).toBe('ut-dt-groups:anon:t1:default')
    expect(parseExpandState('["a",1,"b"]')).toEqual(['a', 'b'])
    expect(parseExpandState('{')).toEqual([])
    expect(parseExpandState(null)).toEqual([])
    expect(parseExpandState(JSON.stringify(Array.from({ length: 10 }, (_, i) => `k${i}`)), 3)).toEqual(['k7', 'k8', 'k9'])
  })
})
