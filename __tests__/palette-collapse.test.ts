import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import {
  allCollapsed, allExpanded, initialPaletteCollapse, isGroupCollapsed, loadCollapseMap, loadFlag, paletteCollapseReducer as reduce,
  PALETTE_STORAGE_KEY, saveCollapseMap, saveFlag,
} from '@/lib/palette-collapse'

const KEYS = ['trigger', 'action', 'logic']

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial }
  return { data, getItem: (k: string) => (k in data ? data[k] : null), setItem: (k: string, v: string) => { data[k] = v } }
}

describe('palette group collapse', () => {
  it('defaults to all expanded', () => {
    const s = initialPaletteCollapse()
    expect(KEYS.some((k) => isGroupCollapsed(s, k, false))).toBe(false)
    expect(allExpanded(s, KEYS, false)).toBe(true)
  })

  it('toggles one group', () => {
    let s = reduce(initialPaletteCollapse(), { type: 'toggle', key: 'action', searching: false })
    expect(isGroupCollapsed(s, 'action', false)).toBe(true)
    expect(isGroupCollapsed(s, 'trigger', false)).toBe(false)
    s = reduce(s, { type: 'toggle', key: 'action', searching: false })
    expect(isGroupCollapsed(s, 'action', false)).toBe(false)
  })

  it('expand all / collapse all', () => {
    let s = reduce(initialPaletteCollapse(), { type: 'setAll', keys: KEYS, collapsed: true, searching: false })
    expect(allCollapsed(s, KEYS, false)).toBe(true)
    s = reduce(s, { type: 'setAll', keys: KEYS, collapsed: false, searching: false })
    expect(allExpanded(s, KEYS, false)).toBe(true)
    expect(allCollapsed(initialPaletteCollapse(), [], false)).toBe(false)
  })

  it('searching shows matching groups expanded without losing the saved state, which returns when search clears', () => {
    let s = reduce(initialPaletteCollapse(), { type: 'setAll', keys: KEYS, collapsed: true, searching: false })
    // Search active: everything with matches is expanded.
    expect(allExpanded(s, KEYS, true)).toBe(true)
    // Toggling during search only affects the search view.
    s = reduce(s, { type: 'toggle', key: 'logic', searching: true })
    expect(isGroupCollapsed(s, 'logic', true)).toBe(true)
    s = reduce(s, { type: 'setAll', keys: KEYS, collapsed: true, searching: true })
    expect(allCollapsed(s, KEYS, true)).toBe(true)
    // Saved state untouched.
    expect(allCollapsed(s, KEYS, false)).toBe(true)
    expect(s.saved).toEqual({ trigger: true, action: true, logic: true })
    // A new query re-expands.
    s = reduce(s, { type: 'searchChanged' })
    expect(allExpanded(s, KEYS, true)).toBe(true)
    // Clear search: saved state is back.
    expect(allCollapsed(s, KEYS, false)).toBe(true)
  })

  it('searchChanged is a no-op without search overrides (no re-render churn)', () => {
    const s = initialPaletteCollapse({ action: true })
    expect(reduce(s, { type: 'searchChanged' })).toBe(s)
  })

  it('load replaces the saved state', () => {
    const s = reduce(initialPaletteCollapse(), { type: 'load', saved: { logic: true } })
    expect(isGroupCollapsed(s, 'logic', false)).toBe(true)
  })
})

describe('persistence', () => {
  it('round-trips collapsed groups only', () => {
    const st = memoryStorage()
    expect(saveCollapseMap(st, { action: true, logic: false })).toBe(true)
    expect(JSON.parse(st.data[PALETTE_STORAGE_KEY])).toEqual({ action: true })
    expect(loadCollapseMap(st)).toEqual({ action: true })
  })

  it('falls back to all expanded on missing, junk or throwing storage', () => {
    expect(loadCollapseMap(null)).toEqual({})
    expect(loadCollapseMap(memoryStorage())).toEqual({})
    expect(loadCollapseMap(memoryStorage({ [PALETTE_STORAGE_KEY]: '{not json' }))).toEqual({})
    expect(loadCollapseMap(memoryStorage({ [PALETTE_STORAGE_KEY]: '[1,2]' }))).toEqual({})
    expect(loadCollapseMap(memoryStorage({ [PALETTE_STORAGE_KEY]: '{"a":"yes","b":true}' }))).toEqual({ b: true })
    const throwing = { getItem: () => { throw new Error('SecurityError') }, setItem: () => { throw new Error('QuotaExceeded') } }
    expect(loadCollapseMap(throwing)).toEqual({})
    expect(saveCollapseMap(throwing, { a: true })).toBe(false)
    expect(saveCollapseMap(null, { a: true })).toBe(false)
  })

  it('sidebar rail flag', () => {
    const st = memoryStorage()
    expect(loadFlag(st, 'rail')).toBe(false)
    saveFlag(st, 'rail', true)
    expect(loadFlag(st, 'rail')).toBe(true)
    const throwing = { getItem: () => { throw new Error('x') }, setItem: () => { throw new Error('x') } }
    expect(loadFlag(throwing, 'rail')).toBe(false)
    expect(() => saveFlag(throwing, 'rail', true)).not.toThrow()
  })
})

describe('palette wiring', () => {
  const src = readFileSync(path.join(process.cwd(), 'components/automations/node-palette.tsx'), 'utf8')
  it('headers are buttons with aria-expanded and counts; expand / collapse all exist', () => {
    expect(src).toContain('aria-expanded={!collapsed}')
    expect(src).toContain('aria-label="Expand all groups"')
    expect(src).toContain('aria-label="Collapse all groups"')
    expect(src).toContain('useDraggable(')
  })
  it('theme tokens only for the group chrome (no raw amber)', () => {
    expect(src).not.toContain('#F59E0B')
  })
})

describe('hydration guard', () => {
  it('state is marked loaded only by the load action', () => {
    const s = initialPaletteCollapse()
    expect(s.loaded).toBeFalsy()
    expect(reduce(s, { type: 'toggle', key: 'a', searching: false }).loaded).toBeFalsy()
    expect(reduce(s, { type: 'load', saved: {} }).loaded).toBe(true)
  })
})
