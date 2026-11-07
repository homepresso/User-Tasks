/**
 * The variable picker's pure core (components/automations/variable-input.tsx):
 * what a picker entry is, how `{{` / `{` opens the menu at the caret, how a
 * pick replaces what was typed, search that forgives spacing and
 * underscores ("row id", "rowid"), recently used paths, and a stored
 * template's tokens with their readable labels and problems.
 *
 * The stored format never changes: an entry inserts `{{path}}`; chips only
 * change how a token is drawn.
 *
 * Pure and isomorphic. Form-specific catalogs: lib/forms/variable-catalog.ts.
 */

import { tokenizeTemplate } from './workflow-data-drop'

export type PickerType ='text' | 'number' | 'date' | 'boolean' | 'row' | 'list' | 'value'

export const PICKER_TYPE_LABELS: Record<PickerType, string> = {
  text: 'text', number: 'number', date: 'date', boolean: 'yes / no', row: 'row', list: 'list', value: 'value',
}

export interface PickerVariable {
  /** The placeholder path: inserted as `{{path}}` (a plain entry inserts `path` itself). */
  path: string
  /** Human label, breadcrumbs joined with › ("Selected row › ID"). */
  label: string
  group: string
  type: PickerType
  /** More words search matches (a key column's label, a table's name…). */
  keywords?: string
  /** Other names for exactly this value, matched like the label (a row id: its key column's label, "Order ID"). */
  synonyms?: string[]
  /** Drill-down: the row / object entry this one belongs to (listed under it until expanded or searched). */
  parent?: string
  /** A sample or current value (the designer's live preview, a parameter's default…). */
  sample?: unknown
  /** One line of help shown under the label. */
  hint?: string
  /** Inserts the bare value, not a placeholder (workflow "Status values"). */
  plain?: boolean
  /** Known to resolve but not listed (older names): chips and checks only. */
  hidden?: boolean
}

/** What the picker knows about where an input is (for the menu note and wrong-context warnings). */
export interface PickerScope {
  /** Every entry, in group order. */
  items: PickerVariable[]
  /** Short line shown at the top of the menu ("Event values aren't available in a Button's steps…"). */
  note?: string
  /** Why a path would not resolve here (null: fine). Paths the scope doesn't know about are only checked when this says so. */
  problem?: (path: string) => string | null
  /** localStorage key of the recently used paths. */
  recentKey?: string
}

/* ── Trigger ─────────────────────────────────────────────────────────── */

export interface PickerTrigger {
  /** Offset of the first `{`. */
  start: number
  /** Offset the pick replaces up to (the caret, plus an auto-closed `}}` / `}` right after it). */
  end: number
  /** What was typed after the braces. */
  query: string
  braces: 1 | 2
}

/**
 * The open `{{…` or `{…` the caret is in, if any: `{{` takes any text up to
 * 60 characters on one line; a single `{` only a short search (letters,
 * digits, spaces, `_ . › -`) so JSON like `{"a": 1}` closes it at once.
 * `{{=` (an expression) never opens the picker.
 */
export function detectTrigger(text: string, caret: number): PickerTrigger | null {
  const at = Math.max(0, Math.min(caret, text.length))
  const before = text.slice(0, at)
  const open = before.lastIndexOf('{')
  if (open < 0) return null
  const typed = before.slice(open + 1)
  if (/[{}\n]/.test(typed)) return null
  const braces: 1 | 2 = open > 0 && before[open - 1] === '{' ? 2 : 1
  const start = braces === 2 ? open - 1 : open
  // `{{{x` / a `{` right after a closed token's braces: not a trigger.
  if (start > 0 && before[start - 1] === '{') return null
  if (braces === 2) {
    if (/^\s*=/.test(typed) || typed.length > 60) return null
  } else if (!/^[\p{L}\p{N} _.›-]{0,40}$/u.test(typed)) return null
  const after = text.slice(at)
  const close = braces === 2 ? (after.startsWith('}}') ? 2 : 0) : (after.startsWith('}') && !after.startsWith('}}') ? 1 : 0)
  return { start, end: at + close, query: typed.trim(), braces }
}

/** `text` with the trigger replaced by the pick (`{{path}}`, or the bare value of a plain entry); `caret` lands after it. */
export function applyPick(text: string, trigger: PickerTrigger | null, caret: number, entry: Pick<PickerVariable, 'path' | 'plain'>): { value: string; caret: number } {
  const token = entry.plain ? entry.path : `{{${entry.path}}}`
  if (entry.plain) return { value: token, caret: token.length }
  const from = trigger ? trigger.start : Math.max(0, Math.min(caret, text.length))
  const to = trigger ? trigger.end : from
  return { value: text.slice(0, from) + token + text.slice(to), caret: from + token.length }
}

/* ── Search ──────────────────────────────────────────────────────────── */

/** Lower-case words: `event.row_id` → "event row id", "OrderID" → "order id orderid". */
export function searchWords(text: string): string[] {
  const spaced = String(text ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
  const words = spaced.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  const joined = String(text ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  return [...new Set([...words, ...joined])]
}

const compact = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

/**
 * How well an entry matches (0: not at all). Every word of the query must
 * start a word of the label / path / keywords (or occur in them); a query
 * typed without spaces ("rowid") also matches the words run together.
 */
export function matchScore(entry: PickerVariable, query: string): number {
  const q = query.trim()
  if (!q) return 1
  const labelWords = searchWords([entry.label, ...(entry.synonyms ?? [])].join(' '))
  const pathWords = searchWords(entry.path)
  const keyWords = searchWords(`${entry.keywords ?? ''} ${entry.group}`)
  const all = [...labelWords, ...pathWords, ...keyWords]
  const queryTerms = q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  let score = 0
  const everyTerm = queryTerms.length > 0 && queryTerms.every((t) => {
    if (labelWords.some((w) => w.startsWith(t))) { score += 4; return true }
    if (pathWords.some((w) => w.startsWith(t))) { score += 3; return true }
    if (keyWords.some((w) => w.startsWith(t))) { score += 2; return true }
    if (all.some((w) => w.includes(t))) { score += 1; return true }
    return false
  })
  const cq0 = compact(q)
  if (everyTerm) return score + (compact(entry.label).startsWith(cq0) || (entry.synonyms ?? []).some((n) => compact(n) === cq0) ? 3 : 0)
  // "rowid", "orderid": the query run together inside the words run together.
  const cq = compact(q)
  if (cq.length >= 3) {
    if (compact(entry.label).includes(cq)) return 3
    if (compact(entry.path).includes(cq)) return 2
    if (compact(entry.keywords ?? '').includes(cq)) return 1.5
  }
  return 0
}

/**
 * Entries matching the query, best first (recently used first among
 * equals). Hidden entries never show; with no query the order is the
 * catalog's own.
 */
export function searchVariables(items: PickerVariable[], query: string, recent: string[] = []): PickerVariable[] {
  const visible = items.filter((i) => !i.hidden)
  if (!query.trim()) return visible
  const rank = new Map(recent.map((p, i) => [p, recent.length - i]))
  return visible
    .map((item, index) => ({ item, index, score: matchScore(item, query) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => (b.score - a.score) || ((rank.get(b.item.path) ?? 0) - (rank.get(a.item.path) ?? 0)) || (a.item.label.length - b.item.label.length) || (a.index - b.index))
    .map((x) => x.item)
}

/* ── Menu rows ───────────────────────────────────────────────────────── */

export interface PickerRow {
  /** 'item': an entry; 'whole': "Insert the whole row" under an expanded row. */
  kind: 'item' | 'whole'
  item: PickerVariable
  group: string
  /** The entry has children (a row / object): collapsed rows show a chevron. */
  expandable: boolean
  expanded: boolean
  depth: number
}

/**
 * The rows the menu draws, in order. Without a query: "Recently used"
 * first, then each group with children folded under their row (expanded:
 * "Insert the whole row" then its columns). With a query: the matches, flat,
 * in their groups.
 */
export function pickerRows(items: PickerVariable[], query: string, expanded: ReadonlySet<string>, recent: string[] = []): PickerRow[] {
  const visible = items.filter((i) => !i.hidden)
  const hasChildren = new Set(visible.filter((i) => i.parent).map((i) => i.parent as string))
  const rows: PickerRow[] = []
  if (query.trim()) {
    const found = searchVariables(visible, query, recent)
    const groups = [...new Set(found.map((f) => f.group))]
    for (const g of groups) for (const item of found.filter((f) => f.group === g)) rows.push({ kind: 'item', item, group: g, expandable: false, expanded: false, depth: 0 })
    return rows
  }
  const byPath = new Map(visible.map((i) => [i.path, i]))
  const recentItems = recent.map((p) => byPath.get(p)).filter((i): i is PickerVariable => Boolean(i)).slice(0, 5)
  for (const item of recentItems) rows.push({ kind: 'item', item, group: 'Recently used', expandable: false, expanded: false, depth: 0 })
  const groups = [...new Set(visible.map((i) => i.group))]
  for (const g of groups) {
    for (const item of visible.filter((i) => i.group === g && (!i.parent || !byPath.has(i.parent)))) {
      const expandable = hasChildren.has(item.path)
      const open = expandable && expanded.has(item.path)
      rows.push({ kind: 'item', item, group: g, expandable, expanded: open, depth: 0 })
      if (open) {
        rows.push({ kind: 'whole', item, group: g, expandable: false, expanded: false, depth: 1 })
        for (const child of visible.filter((i) => i.parent === item.path)) rows.push({ kind: 'item', item: child, group: g, expandable: false, expanded: false, depth: 1 })
      }
    }
  }
  return rows
}

/* ── Recently used ───────────────────────────────────────────────────── */

export const RECENT_VARIABLES_MAX = 8

export function withRecentVariable(recent: string[], path: string, max = RECENT_VARIABLES_MAX): string[] {
  const clean = String(path ?? '').trim()
  if (!clean) return recent
  return [clean, ...recent.filter((p) => p !== clean)].slice(0, max)
}

export function readRecentVariables(key: string | undefined): string[] {
  if (!key || typeof window === 'undefined') return []
  try {
    const raw = JSON.parse(window.localStorage.getItem(key) ?? '[]')
    return Array.isArray(raw) ? raw.filter((p): p is string => typeof p === 'string').slice(0, RECENT_VARIABLES_MAX) : []
  } catch { return [] }
}

export function rememberRecentVariable(key: string | undefined, path: string): string[] {
  const next = withRecentVariable(readRecentVariables(key), path)
  if (key && typeof window !== 'undefined') { try { window.localStorage.setItem(key, JSON.stringify(next)) } catch { /* private mode */ } }
  return next
}

/* ── Tokens, chips and problems ──────────────────────────────────────── */

const TOKEN_RE = /\{\{(\s*=)?\s*([^{}]+?)\s*\}\}/g

/** The `{{path}}` tokens of a template (expressions skipped), in order. */
export function templatePaths(text: string): string[] {
  const out: string[] = []
  for (const m of String(text ?? '').matchAll(TOKEN_RE)) if (!m[1]) out.push(m[2])
  return out
}

export interface ChipInfo {
  label: string
  /** Why it won't resolve here (underlined, in the tooltip). */
  problem?: string
  sample?: unknown
  type?: PickerType
}

/** How a token draws: its readable label, its problem and sample (null: an unknown token in a scope that doesn't check). */
export function chipInfo(path: string, scope: PickerScope | null | undefined): ChipInfo | null {
  if (!scope) return null
  const item = scope.items.find((i) => i.path === path && !i.plain)
  const problem = scope.problem?.(path) ?? null
  if (item) return { label: item.label, type: item.type, ...(problem ? { problem } : {}), ...(item.sample !== undefined ? { sample: item.sample } : {}) }
  return problem ? { label: path, problem } : null
}

/** The problems of a template's tokens in this scope (deduplicated, in order). */
export function templateProblems(text: string, scope: PickerScope | null | undefined): Array<{ path: string; problem: string }> {
  if (!scope?.problem) return []
  const seen = new Set<string>()
  const out: Array<{ path: string; problem: string }> = []
  for (const path of templatePaths(text)) {
    if (seen.has(path)) continue
    seen.add(path)
    const problem = scope.problem(path)
    if (problem) out.push({ path, problem })
  }
  return out
}

/** A sample value as one short line. */
export function sampleText(v: unknown): string {
  if (v === undefined) return ''
  if (v === null || v === '') return '(empty)'
  if (typeof v === 'object') { try { return JSON.stringify(v).slice(0, 80) } catch { return '' } }
  return String(v).slice(0, 80)
}

/**
 * The legacy `{ name, group, label }` lists (workflow designer, local
 * extras) as picker entries: labels kept, the path as secondary text.
 */
export function legacyPickerEntries(list: Array<{ name: string; group: string; label?: string }>, plainGroups: (group: string) => boolean = () => false): PickerVariable[] {
  return list.map((v) => {
    // "Label · type" (older typed lists): the type becomes the badge.
    const m = v.label ? /^(.*?) · (text|number|date|yes \/ no|list|row \/ object|row|value|boolean|list of text)$/i.exec(v.label) : null
    const type: PickerType = m ? LEGACY_TYPES[m[2].toLowerCase()] ?? 'value' : 'value'
    return { path: v.name, label: m ? m[1] : v.label ?? v.name, group: v.group, type, ...(plainGroups(v.group) ? { plain: true } : {}) }
  })
}

const LEGACY_TYPES: Record<string, PickerType> = {
  text: 'text', number: 'number', date: 'date', 'yes / no': 'boolean', boolean: 'boolean', list: 'list', 'list of text': 'list', 'row / object': 'row', row: 'row', value: 'value',
}

/* ── Chips ↔ stored text ─────────────────────────────────────────────── */

export interface ChipSegment {
  type: 'text' | 'chip'
  /** Text, or the token's path / expression. */
  value: string
  expression?: boolean
  /** How the chip reads (label, problem, sample); null: drawn as its path. */
  chip?: ChipInfo | null
}

/** A stored template as the editor draws it: text and chips (VariableInput renders these). */
export function chipSegments(text: string, lookup?: ((path: string) => ChipInfo | null) | null): ChipSegment[] {
  return tokenizeTemplate(text).map((s): ChipSegment => (s.type === 'text'
    ? { type: 'text', value: s.value }
    : { type: 'chip', value: s.value, ...(s.isExpression ? { expression: true } : { chip: lookup?.(s.value) ?? null }) }))
}

/** The stored text of drawn segments (what the editor serializes back): a chip is `{{path}}` whatever its label. */
export function segmentsText(segments: ChipSegment[]): string {
  return segments.map((s) => (s.type === 'text' ? s.value : s.expression ? `{{= ${s.value} }}` : `{{${s.value}}}`)).join('')
}
