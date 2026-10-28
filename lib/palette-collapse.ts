/**
 * Collapse state of the designer's action palette groups.
 *
 * `saved` is the user's own choice (persisted in localStorage, default: all
 * expanded). While a search is active the palette shows every group with a
 * match expanded; toggles made during the search go to a temporary `search`
 * map, so the saved state comes back untouched when the search is cleared.
 */

export type CollapseMap = Record<string, boolean>

export interface PaletteCollapseState {
  saved: CollapseMap
  search: CollapseMap
  /** The saved map has been read from storage (only then is it written back). */
  loaded?: boolean
}

export type PaletteCollapseAction =
  | { type: 'toggle'; key: string; searching: boolean }
  | { type: 'setAll'; keys: string[]; collapsed: boolean; searching: boolean }
  | { type: 'searchChanged' }
  | { type: 'load'; saved: CollapseMap }

export const PALETTE_STORAGE_KEY = 'usertasks:designer-palette:collapsed:v1'
export const PALETTE_RAIL_STORAGE_KEY = 'usertasks:designer-palette:rail:v1'

export function initialPaletteCollapse(saved: CollapseMap = {}): PaletteCollapseState {
  return { saved, search: {} }
}

export function paletteCollapseReducer(state: PaletteCollapseState, action: PaletteCollapseAction): PaletteCollapseState {
  switch (action.type) {
    case 'toggle': {
      const field = action.searching ? 'search' : 'saved'
      const map = state[field]
      return { ...state, [field]: { ...map, [action.key]: !map[action.key] } }
    }
    case 'setAll': {
      const field = action.searching ? 'search' : 'saved'
      const next: CollapseMap = { ...state[field] }
      for (const k of action.keys) next[k] = action.collapsed
      return { ...state, [field]: next }
    }
    case 'searchChanged':
      // A new query re-expands every group with matches.
      return Object.keys(state.search).length === 0 ? state : { ...state, search: {} }
    case 'load':
      return { ...state, saved: { ...action.saved }, loaded: true }
  }
}

/** Whether a group renders collapsed now. */
export function isGroupCollapsed(state: PaletteCollapseState, key: string, searching: boolean): boolean {
  return searching ? !!state.search[key] : !!state.saved[key]
}

export function allCollapsed(state: PaletteCollapseState, keys: string[], searching: boolean): boolean {
  return keys.length > 0 && keys.every((k) => isGroupCollapsed(state, k, searching))
}

export function allExpanded(state: PaletteCollapseState, keys: string[], searching: boolean): boolean {
  return keys.every((k) => !isGroupCollapsed(state, k, searching))
}

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** Read the saved map; anything unreadable (no storage, private mode, junk) → all expanded. */
export function loadCollapseMap(storage: StorageLike | null | undefined, key = PALETTE_STORAGE_KEY): CollapseMap {
  try {
    const raw = storage?.getItem(key)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: CollapseMap = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) if (v === true) out[k] = true
    return out
  } catch {
    return {}
  }
}

/** Persist only collapsed groups (expanded is the default). Returns false when storage is unavailable. */
export function saveCollapseMap(storage: StorageLike | null | undefined, map: CollapseMap, key = PALETTE_STORAGE_KEY): boolean {
  try {
    if (!storage) return false
    const compact: CollapseMap = {}
    for (const [k, v] of Object.entries(map)) if (v) compact[k] = true
    storage.setItem(key, JSON.stringify(compact))
    return true
  } catch {
    return false
  }
}

export function loadFlag(storage: StorageLike | null | undefined, key: string): boolean {
  try { return storage?.getItem(key) === '1' } catch { return false }
}

export function saveFlag(storage: StorageLike | null | undefined, key: string, value: boolean): void {
  try { storage?.setItem(key, value ? '1' : '0') } catch { /* storage unavailable */ }
}

/** `window.localStorage`, or null where touching it throws (blocked site data). */
export function safeLocalStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}
