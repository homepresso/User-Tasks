import { describe, expect, it } from 'vitest'
import {
  addToDraft, dependenciesToLeaveOut, filterContents, isSelectable, membershipIndex, pickerKey, scrollToRow, shouldLoadMore, toggle, visibleWindow,
  type Membership, type PickerState,
} from '@/lib/packages/asset-picker'
import { decodeCursor, encodeCursor, mergeByType, parseTypes, parseUpdatedSince, quoteFilterValue, substringPattern } from '@/lib/services/package-assets'

const ref = (n: number, type = 'workflow') => ({ type, id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}` })
const rows = [ref(1), ref(2), ref(3, 'data_table'), ref(4)]
const none = new Map<string, Membership>()
const base: PickerState = { open: true, active: -1, selected: new Map() }

describe('picker keyboard', () => {
  it('moves with arrows, page keys, Home / End and clamps at the ends', () => {
    let state = base
    state = pickerKey(state, { key: 'ArrowDown' }, rows, none, '').state
    expect(state.active).toBe(0)
    state = pickerKey(state, { key: 'ArrowDown' }, rows, none, '').state
    expect(state.active).toBe(1)
    state = pickerKey(state, { key: 'End' }, rows, none, '').state
    expect(state.active).toBe(3)
    state = pickerKey(state, { key: 'ArrowDown' }, rows, none, '').state
    expect(state.active).toBe(3)
    state = pickerKey(state, { key: 'PageUp' }, rows, none, '').state
    expect(state.active).toBe(0)
    state = pickerKey(state, { key: 'ArrowUp' }, rows, none, '').state
    expect(state.active).toBe(0)
    expect(pickerKey(base, { key: 'ArrowDown' }, [], none, '').state.active).toBe(-1)
  })

  it('opens a closed list on ArrowDown; Home/End stay with the text box while closed', () => {
    const closed = { ...base, open: false }
    const down = pickerKey(closed, { key: 'ArrowDown' }, rows, none, '')
    expect(down.state).toMatchObject({ open: true, active: 0 })
    expect(pickerKey(closed, { key: 'Home' }, rows, none, '').handled).toBe(false)
    expect(pickerKey(closed, { key: 'a' }, rows, none, '').handled).toBe(false)
  })

  it('Enter selects and unselects the highlighted row; rows already in the package are not selectable', () => {
    const membership = new Map<string, Membership>([[`${rows[1].type}:${rows[1].id}`, 'dependency'], [`${rows[2].type}:${rows[2].id}`, 'excluded']])
    let state = { ...base, active: 0 }
    state = pickerKey(state, { key: 'Enter' }, rows, membership, '').state
    expect([...state.selected.keys()]).toEqual([`workflow:${rows[0].id}`])
    state = pickerKey({ ...state, active: 1 }, { key: 'Enter' }, rows, membership, '').state
    expect(state.selected.size).toBe(1)
    state = pickerKey({ ...state, active: 2 }, { key: 'Enter' }, rows, membership, '').state
    expect(state.selected.size).toBe(2)
    state = pickerKey({ ...state, active: 0 }, { key: 'Enter' }, rows, membership, '').state
    expect([...state.selected.values()]).toEqual([rows[2]])
  })

  it('Ctrl/⌘/Shift+Enter adds the selection, or the highlighted row when nothing is selected', () => {
    const selected = new Map([[`workflow:${rows[0].id}`, rows[0]], [`workflow:${rows[3].id}`, rows[3]]])
    const added = pickerKey({ ...base, active: 1, selected }, { key: 'Enter', metaKey: true }, rows, none, '')
    expect(added.action).toEqual({ kind: 'add', refs: [rows[0], rows[3]] })
    expect(added.state.selected.size).toBe(0)
    expect(pickerKey({ ...base, active: 1 }, { key: 'Enter', ctrlKey: true }, rows, none, '').action).toEqual({ kind: 'add', refs: [rows[1]] })
    expect(pickerKey({ ...base, active: 1 }, { key: 'Enter', shiftKey: true }, rows, none, '').action).toEqual({ kind: 'add', refs: [rows[1]] })
    const inPackage = new Map<string, Membership>([[`workflow:${rows[1].id}`, 'root']])
    expect(pickerKey({ ...base, active: 1 }, { key: 'Enter', ctrlKey: true }, rows, inPackage, '').action).toEqual({ kind: 'none' })
  })

  it('Escape closes the list first, then clears the search, then lets the dialog have it', () => {
    expect(pickerKey(base, { key: 'Escape' }, rows, none, 'inv')).toMatchObject({ action: { kind: 'close' }, handled: true, state: { open: false } })
    expect(pickerKey({ ...base, open: false }, { key: 'Escape' }, rows, none, 'inv')).toMatchObject({ action: { kind: 'clear-search' }, handled: true })
    expect(pickerKey({ ...base, open: false }, { key: 'Escape' }, rows, none, '').handled).toBe(false)
  })

  it('toggle keeps pick order and refuses rows in the package', () => {
    let selected = toggle(new Map(), rows[3], none)
    selected = toggle(selected, rows[0], none)
    expect([...selected.values()]).toEqual([rows[3], rows[0]])
    expect(toggle(selected, rows[1], new Map([[`workflow:${rows[1].id}`, 'manual']])).size).toBe(2)
    expect(isSelectable('excluded')).toBe(true)
    expect(isSelectable('root')).toBe(false)
  })
})

describe('adding to the package', () => {
  it('starts an empty package from the picked assets; later picks are added items; left-out ones come back', () => {
    const first = addToDraft({ roots: [], items: [], excluded: [] }, [rows[0], rows[1], rows[0]])
    expect(first).toEqual({ roots: [rows[0], rows[1]], items: [], excluded: [] })
    const second = addToDraft({ ...first, excluded: [rows[2]] }, [rows[2], rows[0], rows[3]])
    expect(second).toEqual({ roots: [rows[0], rows[1]], items: [rows[2], rows[3]], excluded: [] })
  })

  it('without dependencies leaves out only what the new items pulled in', () => {
    const table = ref(10, 'data_table')
    const shared = ref(11, 'integration')
    const nested = ref(12, 'decision_table')
    const preview = [
      { ...rows[0], included_as: 'root' as const, required_by: 'root' as const },
      { ...rows[3], included_as: 'manual' as const, required_by: 'root' as const },
      { ...table, included_as: 'dependency' as const, required_by: rows[3] },
      { ...shared, included_as: 'dependency' as const, required_by: rows[3] },
      { ...nested, included_as: 'dependency' as const, required_by: table },
    ]
    const before = new Set([`workflow:${rows[0].id}`, `integration:${shared.id}`])
    expect(dependenciesToLeaveOut(preview, [rows[3]], before)).toEqual([table])
  })

  it('indexes membership from the preview and the left-out list', () => {
    const index = membershipIndex([{ ...rows[0], included_as: 'root' }, { ...rows[1], included_as: 'dependency' }], [rows[2], rows[1]])
    expect(index.get(`workflow:${rows[0].id}`)).toBe('root')
    expect(index.get(`workflow:${rows[1].id}`)).toBe('dependency')
    expect(index.get(`data_table:${rows[2].id}`)).toBe('excluded')
  })
})

describe('windowing and paging', () => {
  it('renders only the visible rows plus overscan', () => {
    expect(visibleWindow(0, 336, 56, 3000, 6)).toEqual({ start: 0, end: 12, offsetTop: 0, totalHeight: 168000 })
    expect(visibleWindow(56 * 1000, 336, 56, 3000, 6)).toEqual({ start: 994, end: 1012, offsetTop: 994 * 56, totalHeight: 168000 })
    expect(visibleWindow(56 * 2999, 336, 56, 3000, 6).end).toBe(3000)
    expect(visibleWindow(0, 336, 56, 0)).toEqual({ start: 0, end: 0, offsetTop: 0, totalHeight: 0 })
  })

  it('scrolls the highlighted row into view', () => {
    expect(scrollToRow(0, 112, 336, 56)).toBe(0)
    expect(scrollToRow(10, 0, 336, 56)).toBe(56 * 11 - 336)
    expect(scrollToRow(3, 0, 336, 56)).toBe(0)
  })

  it('asks for the next page near the end only', () => {
    expect(shouldLoadMore(45, 50, true, false)).toBe(true)
    expect(shouldLoadMore(20, 50, true, false)).toBe(false)
    expect(shouldLoadMore(50, 50, false, false)).toBe(false)
    expect(shouldLoadMore(50, 50, true, true)).toBe(false)
  })
})

describe('package item filter', () => {
  const items = [
    { type: 'workflow', name: 'Invoice approval', label: 'Workflow', included_as: 'root' },
    { type: 'data_table', name: 'Vendors', label: 'Data table', included_as: 'dependency' },
    { type: 'decision_table', name: 'Approval policy', label: 'Decision table', included_as: 'manual' },
  ]
  it('filters by text, type and how the item is included', () => {
    expect(filterContents(items, { text: 'approv' }).map((i) => i.name)).toEqual(['Invoice approval', 'Approval policy'])
    expect(filterContents(items, { type: 'data_table' }).map((i) => i.name)).toEqual(['Vendors'])
    expect(filterContents(items, { show: 'added' }).map((i) => i.name)).toEqual(['Invoice approval', 'Approval policy'])
    expect(filterContents(items, { show: 'dependency' }).map((i) => i.name)).toEqual(['Vendors'])
    expect(filterContents(items, { text: 'decision' }).map((i) => i.name)).toEqual(['Approval policy'])
  })
})

describe('asset search helpers', () => {
  it('parses types and relative dates', () => {
    expect(parseTypes('workflow, data-table,workflow')).toEqual(['workflow', 'data_table'])
    expect(parseTypes(undefined)).toBeNull()
    expect(() => parseTypes('widgets')).toThrow(/unknown type/)
    const now = Date.parse('2026-10-26T12:00:00Z')
    expect(parseUpdatedSince('7d', now)).toBe('2026-10-19T12:00:00.000Z')
    expect(parseUpdatedSince('24h', now)).toBe('2026-10-25T12:00:00.000Z')
    expect(parseUpdatedSince('2w', now)).toBe('2026-10-12T12:00:00.000Z')
    expect(parseUpdatedSince('2026-10-01', now)).toBe('2026-10-01T00:00:00.000Z')
    expect(() => parseUpdatedSince('soon', now)).toThrow()
  })

  it('escapes LIKE wildcards and quotes PostgREST values', () => {
    expect(substringPattern('50%_a\\b')).toBe('%50\\%\\_a\\\\b%')
    expect(quoteFilterValue('say "hi", (x)\\')).toBe('"say \\"hi\\", (x)\\\\"')
  })

  it('round-trips cursors and rejects tampered ones', () => {
    const state = { s: 'name' as const, f: 'abc', p: { workflow: ['Flow 9', '00000000-0000-4000-8000-000000000009'] as [string, string] } }
    expect(decodeCursor(encodeCursor(state))).toEqual(state)
    expect(() => decodeCursor('xyz')).toThrow(/cursor/)
    expect(() => decodeCursor(encodeCursor({ ...state, p: { widget: ['a', 'b'] } } as never))).toThrow(/cursor/)
  })

  it('merges per-type lists without reordering within a type', () => {
    const a = [{ t: 'a', v: 'b' }, { t: 'a', v: 'a' }]
    const b = [{ t: 'b', v: 'a' }, { t: 'b', v: 'c' }]
    const merged = mergeByType([a, b], (x, y) => x.v.localeCompare(y.v), 3)
    expect(merged).toEqual([{ t: 'b', v: 'a' }, { t: 'a', v: 'b' }, { t: 'a', v: 'a' }])
  })
})
