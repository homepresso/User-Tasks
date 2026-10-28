/**
 * State for the theme designer (/settings/theme): the draft theme plus an
 * undo/redo history. Pure — the designer component drives it with
 * useReducer, and the tests drive it directly.
 *
 * Rapid edits to the same field (dragging a colour picker or a slider) are
 * coalesced into one history entry when they arrive within COALESCE_MS of
 * each other, so one undo reverts the whole gesture.
 */

import { WorkspaceThemeSchema, formatThemeIssues, type WorkspaceTheme } from './schema'

export type ThemePath = ReadonlyArray<string | number>

export interface DesignerState {
  /** Older drafts, oldest first. */
  past: WorkspaceTheme[]
  present: WorkspaceTheme
  /** Undone drafts, next redo first. */
  future: WorkspaceTheme[]
  /** Last saved theme and its version (what Save compares against). */
  saved: WorkspaceTheme
  version: number
  /** Coalescing: key and time of the last `set`. */
  lastKey: string | null
  lastAt: number
}

export type DesignerAction =
  /** Set one field; `undefined` removes an optional field. */
  | { type: 'set'; path: ThemePath; value: unknown; at?: number }
  /** Replace the whole draft (template, import, reset). */
  | { type: 'replace'; theme: WorkspaceTheme }
  | { type: 'undo' }
  | { type: 'redo' }
  /** Back to the last saved theme (one undoable step). */
  | { type: 'revert' }
  /** A save went through: the draft becomes the saved theme. */
  | { type: 'saved'; theme: WorkspaceTheme; version: number }

export const HISTORY_LIMIT = 100
export const COALESCE_MS = 800

export function initDesigner(theme: WorkspaceTheme, version: number): DesignerState {
  return { past: [], present: theme, future: [], saved: theme, version, lastKey: null, lastAt: 0 }
}

/** Immutable set at a path (objects and arrays copied along the way). */
export function setIn<T>(target: T, path: ThemePath, value: unknown): T {
  if (path.length === 0) return value as T
  const [head, ...rest] = path
  const source = (target ?? (typeof head === 'number' ? [] : {})) as Record<string | number, unknown>
  const copy: Record<string | number, unknown> = Array.isArray(source) ? [...source] as unknown as Record<number, unknown> : { ...source }
  const next = setIn(source[head], rest, value)
  if (next === undefined && rest.length === 0 && !Array.isArray(copy)) delete copy[head]
  else copy[head] = next
  return copy as T
}

export function getIn(target: unknown, path: ThemePath): unknown {
  let node: unknown = target
  for (const key of path) {
    if (node === null || typeof node !== 'object') return undefined
    node = (node as Record<string | number, unknown>)[key]
  }
  return node
}

/** Structural equality for JSON values (key order ignored). */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a as object).filter((k) => (a as Record<string, unknown>)[k] !== undefined)
  const kb = Object.keys(b as object).filter((k) => (b as Record<string, unknown>)[k] !== undefined)
  if (ka.length !== kb.length) return false
  return ka.every((k) => sameJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

function push(state: DesignerState, next: WorkspaceTheme, key: string | null, at: number): DesignerState {
  if (sameJson(next, state.present)) return state
  const past = [...state.past, state.present].slice(-HISTORY_LIMIT)
  return { ...state, past, present: next, future: [], lastKey: key, lastAt: at }
}

export function designerReducer(state: DesignerState, action: DesignerAction): DesignerState {
  switch (action.type) {
    case 'set': {
      const at = action.at ?? Date.now()
      const key = action.path.join('.')
      const next = setIn(state.present, action.path, action.value)
      if (sameJson(next, state.present)) return state
      // Same field again within the window: amend the current entry.
      if (state.lastKey === key && at - state.lastAt <= COALESCE_MS && state.past.length > 0) {
        return { ...state, present: next, future: [], lastAt: at }
      }
      return push(state, next, key, at)
    }
    case 'replace':
      return push(state, action.theme, null, 0)
    case 'revert':
      return push(state, state.saved, null, 0)
    case 'undo': {
      if (!state.past.length) return state
      const previous = state.past[state.past.length - 1]
      return { ...state, past: state.past.slice(0, -1), present: previous, future: [state.present, ...state.future], lastKey: null }
    }
    case 'redo': {
      if (!state.future.length) return state
      const [next, ...future] = state.future
      return { ...state, past: [...state.past, state.present], present: next, future, lastKey: null }
    }
    case 'saved':
      return { ...state, present: action.theme, saved: action.theme, version: action.version, lastKey: null }
  }
}

export function isDirty(state: DesignerState): boolean {
  return !sameJson(state.present, state.saved)
}

/**
 * Theme JSON from an import: a theme, the GET /workspace-theme response
 * (`{ workspace_theme: … }`) or its `{ data: … }` envelope.
 */
export function parseThemeImport(text: string): { theme: WorkspaceTheme } | { error: string } {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { error: 'The file is not valid JSON' }
  }
  const unwrap = (v: unknown): unknown => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return v
    const record = v as Record<string, unknown>
    if (record.data && typeof record.data === 'object') return unwrap(record.data)
    if (record.workspace_theme && typeof record.workspace_theme === 'object') return record.workspace_theme
    return v
  }
  const candidate = unwrap(value)
  if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) delete (candidate as Record<string, unknown>).expected_version
  const parsed = WorkspaceThemeSchema.safeParse(candidate)
  if (!parsed.success) return { error: `Not a valid theme: ${formatThemeIssues(parsed.error)}` }
  return { theme: parsed.data }
}

/** Pretty JSON for export (accepted by `usertasks workspace-theme update -f`). */
export function exportThemeJson(theme: WorkspaceTheme): string {
  return `${JSON.stringify(theme, null, 2)}\n`
}
