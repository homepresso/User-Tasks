import { describe, expect, it } from 'vitest'
import {
  applyPick, chipInfo, chipSegments, detectTrigger, legacyPickerEntries, matchScore, pickerRows, searchVariables, segmentsText, templatePaths,
  templateProblems, withRecentVariable, type PickerScope, type PickerVariable,
} from '@/lib/variable-picker'

const items: PickerVariable[] = [
  { path: 'event.row_id', label: 'Selected row › ID', group: 'This event', type: 'text', keywords: 'row id key Order ID OrderID Orders' },
  { path: 'event.row', label: 'Selected row', group: 'This event', type: 'row' },
  { path: 'event.row.OrderID', label: 'Selected row › Order ID', group: 'This event', type: 'number', parent: 'event.row' },
  { path: 'event.row.ShipCity', label: 'Selected row › Ship city', group: 'This event', type: 'text', parent: 'event.row' },
  { path: 'control.orders.row_count', label: 'Orders › Row count', group: 'Controls', type: 'number' },
  { path: 'user.email', label: 'Current user › Email', group: 'Current user', type: 'text' },
  { path: 'section.x.visible', label: 'X › Visible', group: 'Sections', type: 'boolean', hidden: true },
]

describe('detectTrigger: {{ and { open the picker at the caret', () => {
  it('{{ at the end', () => {
    expect(detectTrigger('Order {{', 8)).toEqual({ start: 6, end: 8, query: '', braces: 2 })
  })
  it('{{ with a query, anywhere in the text', () => {
    const text = 'Order {{row id and more'
    expect(detectTrigger(text, 'Order {{row id'.length)).toEqual({ start: 6, end: 14, query: 'row id', braces: 2 })
  })
  it('a single { opens it too', () => {
    expect(detectTrigger('Total {tot', 10)).toEqual({ start: 6, end: 10, query: 'tot', braces: 1 })
    expect(detectTrigger('{', 1)).toEqual({ start: 0, end: 1, query: '', braces: 1 })
  })
  it('an auto-closed }} / } after the caret is replaced with the pick', () => {
    expect(detectTrigger('a {{ro}} b', 6)).toEqual({ start: 2, end: 8, query: 'ro', braces: 2 })
    expect(detectTrigger('a {ro} b', 5)).toEqual({ start: 2, end: 6, query: 'ro', braces: 1 })
  })
  it('closed tokens, expressions, JSON and new lines do not open it', () => {
    expect(detectTrigger('{{event.row_id}} ', 17)).toBeNull()
    expect(detectTrigger('{{=UPPER(', 9)).toBeNull()
    expect(detectTrigger('{"a": ', 6)).toBeNull()
    expect(detectTrigger('{\n', 2)).toBeNull()
    expect(detectTrigger('no braces', 9)).toBeNull()
    expect(detectTrigger('{{{x', 4)).toBeNull()
  })
})

describe('applyPick: the stored format is {{path}}', () => {
  it('replaces what was typed after {{ / {', () => {
    const text = 'Order {{row id'
    expect(applyPick(text, detectTrigger(text, text.length), text.length, { path: 'event.row_id' })).toEqual({ value: 'Order {{event.row_id}}', caret: 22 })
    const single = 'Total {tot)'
    expect(applyPick(single, detectTrigger(single, 10), 10, { path: 'x.total' }).value).toBe('Total {{x.total}})')
  })
  it('without a trigger ({x} button) inserts at the caret', () => {
    expect(applyPick('Hello  there', null, 6, { path: 'user.name' })).toEqual({ value: 'Hello {{user.name}} there', caret: 19 })
  })
  it('a plain entry (workflow status values) sets the value', () => {
    expect(applyPick('anything', null, 3, { path: 'completed', plain: true })).toEqual({ value: 'completed', caret: 9 })
  })
})

describe('search: forgiving about spaces, underscores and case', () => {
  const first = (q: string) => searchVariables(items, q)[0]?.path
  it('"row id", "rowid", "ROW_ID" and "order id" all find the row id first', () => {
    expect(first('row id')).toBe('event.row_id')
    expect(first('rowid')).toBe('event.row_id')
    expect(first('ROW_ID')).toBe('event.row_id')
    // "order id": the row id (the key column's label is Order ID), beside that column itself.
    expect(searchVariables(items, 'order id').slice(0, 2).map((i) => i.path)).toContain('event.row_id')
  })
  it('matches labels and paths; nothing for nonsense; hidden entries never show', () => {
    expect(searchVariables(items, 'ship').map((i) => i.path)).toEqual(['event.row.ShipCity'])
    expect(searchVariables(items, 'control.orders').map((i) => i.path)).toEqual(['control.orders.row_count'])
    expect(searchVariables(items, 'zzz')).toEqual([])
    expect(searchVariables(items, 'visible')).toEqual([])
    expect(matchScore(items[0], '')).toBe(1)
  })
  it('recently used rank first among equals', () => {
    const two: PickerVariable[] = [
      { path: 'a', label: 'Alpha', group: 'G', type: 'text' },
      { path: 'b', label: 'Alpha', group: 'G', type: 'text' },
    ]
    expect(searchVariables(two, 'alp', ['b']).map((i) => i.path)).toEqual(['b', 'a'])
    expect(withRecentVariable(['a', 'b'], 'b')).toEqual(['b', 'a'])
  })
})

describe('pickerRows: groups, recently used and drill-down', () => {
  it('folds a row\'s columns under it; expanding lists "the whole row" then the columns', () => {
    const folded = pickerRows(items, '', new Set())
    expect(folded.map((r) => r.item.path)).toEqual(['event.row_id', 'event.row', 'control.orders.row_count', 'user.email'])
    expect(folded[1]).toMatchObject({ expandable: true, expanded: false })
    const open = pickerRows(items, '', new Set(['event.row']))
    expect(open.map((r) => `${r.kind}:${r.item.path}`)).toEqual(['item:event.row_id', 'item:event.row', 'whole:event.row', 'item:event.row.OrderID', 'item:event.row.ShipCity', 'item:control.orders.row_count', 'item:user.email'])
  })
  it('recently used come first; a search shows matches flat', () => {
    expect(pickerRows(items, '', new Set(), ['user.email', 'gone'])[0]).toMatchObject({ group: 'Recently used', item: { path: 'user.email' } })
    expect(pickerRows(items, 'ship', new Set()).map((r) => r.item.path)).toEqual(['event.row.ShipCity'])
  })
})

describe('chips ↔ stored string', () => {
  const scope: PickerScope = {
    items,
    problem: (p) => (p.startsWith('event.') && !items.some((i) => i.path === p) ? `No ${p} here` : null),
  }
  const lookup = (p: string) => chipInfo(p, scope)
  it('a chip reads as its label; the stored text is unchanged', () => {
    const text = 'Order {{event.row_id}} to {{event.row.ShipCity}} — {{= UPPER(x) }} {{unknown}}'
    const segments = chipSegments(text, lookup)
    expect(segments.filter((s) => s.type === 'chip').map((s) => s.chip?.label ?? (s.expression ? `ƒ ${s.value}` : s.value))).toEqual(['Selected row › ID', 'Selected row › Ship city', 'ƒ UPPER(x)', 'unknown'])
    expect(segmentsText(segments)).toBe(text)
    // Round trip of what a pick inserts.
    const picked = applyPick('Order {{row', detectTrigger('Order {{row', 11), 11, { path: 'event.row_id' }).value
    expect(segmentsText(chipSegments(picked, lookup))).toBe('Order {{event.row_id}}')
  })
  it('deleting a chip removes the whole token', () => {
    const segments = chipSegments('A {{event.row_id}} B', lookup).filter((s) => s.type === 'text')
    expect(segmentsText(segments)).toBe('A  B')
  })
  it('an unknown or wrong-context token carries its problem', () => {
    expect(chipInfo('event.nope', scope)).toEqual({ label: 'event.nope', problem: 'No event.nope here' })
    expect(templateProblems('{{event.nope}} {{event.row_id}} {{event.nope}}', scope)).toEqual([{ path: 'event.nope', problem: 'No event.nope here' }])
    expect(templatePaths('{{a}} {{= b }} {{ c }}')).toEqual(['a', 'c'])
  })
})

describe('legacy lists (workflow designer, local extras)', () => {
  it('keep their groups and labels; a "label · type" suffix becomes the badge; plain groups insert values', () => {
    const out = legacyPickerEntries([
      { name: 'task_id', group: 'Workflow' },
      { name: 'event.row_id', group: 'This event', label: 'Row id · text' },
      { name: 'completed', group: 'Status values' },
    ], (g) => g === 'Status values')
    expect(out).toEqual([
      { path: 'task_id', label: 'task_id', group: 'Workflow', type: 'value' },
      { path: 'event.row_id', label: 'Row id', group: 'This event', type: 'text' },
      { path: 'completed', label: 'completed', group: 'Status values', type: 'value', plain: true },
    ])
  })
})
