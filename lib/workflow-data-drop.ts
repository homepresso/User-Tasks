/**
 * Drag-and-drop of workflow data (form fields, step outputs, variables) into
 * expression inputs, plus the helpers the inputs share: where a dropped
 * token goes, how `{{tokens}}` render as readable chips, and the per-viewer
 * "Recently used" list.
 *
 * Pure except the recent-list storage (browser-only, try/catch guarded).
 */

import { splitPickPath } from './workflow-data-picker'

/** dataTransfer type carrying a {@link DataDragPayload} (text/plain carries `{{path}}`). */
export const DATA_DRAG_MIME = 'application/x-usertasks-data'

export interface DataDragPayload {
  /** Tree path (`[]` = inside each item of a list). */
  path: string
  label: string
  /** Schema type of the value ('array' for lists). */
  type: string
  /** The value is a list or inside one: dropping offers first / all / loop. */
  needsChoices: boolean
}

export function encodeDragPayload(payload: DataDragPayload): string {
  return JSON.stringify(payload)
}

export function decodeDragPayload(raw: string | null | undefined): DataDragPayload | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw)
    if (!value || typeof value.path !== 'string' || !value.path) return null
    return { path: value.path, label: String(value.label ?? value.path), type: String(value.type ?? 'any'), needsChoices: value.needsChoices === true }
  } catch {
    return null
  }
}

/**
 * Insert `token` into `value` at `offset` (clamped); an empty (or
 * whitespace-only) value is replaced. Returns the new value and the caret
 * position after the token.
 */
export function insertTokenAt(value: string, offset: number | null | undefined, token: string): { value: string; caret: number } {
  const current = String(value ?? '')
  if (!current.trim()) return { value: token, caret: token.length }
  const at = Math.min(Math.max(Number.isFinite(offset as number) ? Number(offset) : current.length, 0), current.length)
  return { value: current.slice(0, at) + token + current.slice(at), caret: at + token.length }
}

/** What a list (or a field inside a list) dropped on a Loop's "Items to loop through" sets. */
export function loopItemsFromDrop(payload: Pick<DataDragPayload, 'path' | 'type'>): string | null {
  const parts = splitPickPath(payload.path, payload.type === 'array' ? { type: 'array' } : null)
  return parts.arrayPath ? `{{${parts.arrayPath}}}` : null
}

// ─── Chips ─────────────────────────────────────────────────────────────

export interface TemplateSegment {
  type: 'text' | 'var'
  value: string
  isExpression?: boolean
  /** Readable label for a known path (form field, workflow input). */
  label?: string
}

const TOKEN_RE = /\{\{\s*(=\s*)?([^{}]+?)\s*\}\}/g

/** Split a template into text and `{{token}}` segments; tokens of known paths carry their label. */
export function tokenizeTemplate(text: string, labels?: ReadonlyMap<string, string> | null): TemplateSegment[] {
  const parts: TemplateSegment[] = []
  let lastIndex = 0
  const re = new RegExp(TOKEN_RE.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) parts.push({ type: 'text', value: text.slice(lastIndex, m.index) })
    const isExpression = !!m[1]
    const segment: TemplateSegment = { type: 'var', value: m[2], isExpression }
    const label = !isExpression ? labels?.get(m[2]) : undefined
    if (label) segment.label = label
    parts.push(segment)
    lastIndex = m.index + m[0].length
  }
  if (lastIndex < text.length) parts.push({ type: 'text', value: text.slice(lastIndex) })
  return parts
}

// ─── Recently used ─────────────────────────────────────────────────────

const RECENT_KEY = 'ut.workflow.recentData'
const RECENT_MAX = 12

/** `paths` with `path` moved to the front (deduped, bounded). */
export function withRecent(paths: string[], path: string, max = RECENT_MAX): string[] {
  const clean = String(path ?? '').trim()
  if (!clean) return paths
  return [clean, ...paths.filter((p) => p !== clean)].slice(0, max)
}

/** Paths of the expressions a pick inserted (`{{a.b}}` → `a.b`; functions skipped). */
export function pathsInExpression(expression: string): string[] {
  const out: string[] = []
  for (const segment of tokenizeTemplate(String(expression ?? ''))) {
    if (segment.type === 'var' && !segment.isExpression && /^[\w.\-[\]]+$/.test(segment.value)) out.push(segment.value)
  }
  return out
}

export function readRecentData(): string[] {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(RECENT_KEY) : null
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string').slice(0, RECENT_MAX) : []
  } catch {
    return []
  }
}

/** Remember the paths an inserted expression uses; returns the new list. */
export function rememberRecentData(expression: string): string[] {
  let next = readRecentData()
  for (const path of pathsInExpression(expression).reverse()) next = withRecent(next, path)
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(RECENT_KEY, JSON.stringify(next))
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('ut-recent-data'))
  } catch { /* storage unavailable: recent list is a convenience */ }
  return next
}
