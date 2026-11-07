/**
 * When to load: a step / tab or a section can load after the form opens,
 * so a long form shows its first part quickly and the rest only when the
 * person (or a rule) gets to it.
 *
 *   layout.pages[].load / layout.sections[].load
 *     'eager'    on form open (the default; absent = eager — older forms)
 *     'visible'  when first shown: a tab / step when it is first opened, a
 *                section when it is expanded or first scrolled into view
 *     'rule'     when a rule's "Load section / tab" action runs
 *   …and `preload: true` (lazy parts only): once the form is idle, warm the
 *   part's control frames and resolve its bound properties in the
 *   background, without mounting it.
 *
 * What loading means. Until a lazy part loads its controls are NOT MOUNTED:
 * no Data table query, no lookup, no custom control frame, no file widget,
 * no dynamic-property request (except a bound DEFAULT — that is a value),
 * and no Label aggregate over a table there (it has no rows yet). A
 * skeleton with the part's title stands in.
 *
 * Values are independent of mounting. Defaults, prefilled and task values,
 * and values rules set all live in the form's values whether or not the
 * control is mounted, so they are submitted the same; a control that mounts
 * later shows what the values hold.
 *
 * Validation is definition-based (the values against the fields), so a lazy
 * part's required field is still required. To SHOW such an error, a submit
 * first loads every visible unloaded part (partsToLoad), and any error on a
 * field of an unloaded part loads it (partsHoldingFields). Hidden parts, and
 * optional sections left out, follow the existing rules (not required).
 * The server never sees any of this: loading is presentation only — the
 * state's `loaded` list (`__form_state.loaded`, like `collapsed`) is never
 * trusted, stored or needed by the server.
 *
 * Read-only views (completed tasks, the review step, print) load
 * everything; the accessibility checker reads the definition, so lazy parts
 * are checked like the rest.
 *
 * Rules: action `load_part` (targets `section:<key>` / `page:<id>`), event
 * `part_loaded` (target the part, `{{event.part}}`), conditions
 * `section.<key>.loaded` / `step.<id>.loaded`, controls
 * `{{control.<section>.loaded}}` / `{{control.form.loaded.<page id>}}`.
 *
 * Pure and isomorphic; reads stored layouts structurally.
 */

import { isPlainObject } from '@/lib/utils/guards'
import { FORM_STATE_KEY, parseTarget, type FormUiState } from './form-state'
import type { FormPartLoad } from './layout'

export interface LazyPart {
  /** `page:<id>` or `section:<key>`. */
  target: string
  kind: 'page' | 'section'
  id: string
  title: string
  load: Exclude<FormPartLoad, 'eager'>
  preload: boolean
  /** The page a section sits on ('' on single-page forms). */
  page: string
  /** Field keys in the part. */
  fieldKeys: string[]
}

interface RowLike { cells?: unknown; section?: unknown }

function rowKeys(rows: unknown): Array<{ section: string | null; keys: string[] }> {
  return (Array.isArray(rows) ? rows : []).filter(isPlainObject).map((r: RowLike) => ({
    section: typeof r.section === 'string' ? r.section : null,
    keys: (Array.isArray(r.cells) ? r.cells : []).filter(isPlainObject).map((c) => c.field_key).filter((k): k is string => typeof k === 'string'),
  }))
}

function loadOf(raw: Record<string, unknown>): Exclude<FormPartLoad, 'eager'> | null {
  return raw.load === 'visible' || raw.load === 'rule' ? raw.load : null
}

/** Every part of the layout that does not load on open (pages first, then sections, in reading order). */
export function lazyParts(layout: unknown): LazyPart[] {
  if (!isPlainObject(layout)) return []
  const paged = (layout.mode === 'steps' || layout.mode === 'tabs') && Array.isArray(layout.pages) && layout.pages.length > 0
  const grids = paged
    ? (layout.pages as unknown[]).filter(isPlainObject).map((p) => ({ raw: p, id: typeof p.id === 'string' ? p.id : '', rows: rowKeys(p.rows) }))
    : [{ raw: null as Record<string, unknown> | null, id: '', rows: rowKeys(layout.rows) }]
  const out: LazyPart[] = []
  for (const g of grids) {
    const load = g.raw ? loadOf(g.raw) : null
    if (g.raw && load) out.push({ target: `page:${g.id}`, kind: 'page', id: g.id, title: typeof g.raw.title === 'string' ? g.raw.title : g.id, load, preload: g.raw.preload === true, page: g.id, fieldKeys: g.rows.flatMap((r) => r.keys) })
  }
  const sections = Array.isArray(layout.sections) ? layout.sections.filter(isPlainObject) : []
  for (const s of sections) {
    const load = loadOf(s)
    if (!load || typeof s.key !== 'string') continue
    const grid = grids.find((g) => g.rows.some((r) => r.section === s.key))
    if (!grid) continue
    out.push({ target: `section:${s.key}`, kind: 'section', id: s.key, title: typeof s.title === 'string' && s.title ? s.title : s.key, load, preload: s.preload === true, page: grid.id, fieldKeys: grid.rows.filter((r) => r.section === s.key).flatMap((r) => r.keys) })
  }
  return out
}

/** Whether the form has any lazy part (forms without one take none of this code path). */
export function hasLazyParts(layout: unknown): boolean {
  return lazyParts(layout).length > 0
}

/** The runtime state of a form's values (lenient). */
function stateOf(values: Record<string, unknown> | null | undefined): Partial<FormUiState> {
  const raw = values?.[FORM_STATE_KEY]
  return isPlainObject(raw) ? raw as Partial<FormUiState> : {}
}

/** The lazy targets that have loaded. */
export function loadedTargets(values: Record<string, unknown> | null | undefined): Set<string> {
  const list = stateOf(values).loaded
  return new Set(Array.isArray(list) ? list.filter((t): t is string => typeof t === 'string') : [])
}

/** Is a part loaded? Eager (non-lazy) parts always are. */
export function isPartLoaded(layout: unknown, values: Record<string, unknown> | null | undefined, target: string): boolean {
  const part = lazyParts(layout).find((p) => p.target === target)
  return !part || loadedTargets(values).has(target)
}

/**
 * Field keys whose controls are not mounted yet: in a lazy part that has
 * not loaded (a field in a lazy section on a lazy page waits for both).
 * `readOnly` views load everything (empty set).
 */
export function unloadedFieldKeys(layout: unknown, values: Record<string, unknown> | null | undefined, readOnly = false): Set<string> {
  const out = new Set<string>()
  if (readOnly) return out
  const loaded = loadedTargets(values)
  for (const part of lazyParts(layout)) if (!loaded.has(part.target)) for (const key of part.fieldKeys) out.add(key)
  return out
}

/** Field keys of unloaded parts whose bound properties are prefetched in the background (`preload`), once idle. */
export function preloadFieldKeys(layout: unknown, values: Record<string, unknown> | null | undefined): Set<string> {
  const loaded = loadedTargets(values)
  const out = new Set<string>()
  for (const part of lazyParts(layout)) if (part.preload && !loaded.has(part.target)) for (const key of part.fieldKeys) out.add(key)
  return out
}

/**
 * The parts a submit (or a whole-form Validate) loads first: every lazy
 * part not loaded yet holding a shown field that `needs(key)` says must be
 * checked (by default: any field; the runtime passes "is required") — so a
 * required field there is validated in a mounted control and shows its
 * error. `isHidden(key)` is the form's own visibility (hidden pages, hidden
 * / excluded sections, field rules): hidden fields are not required, so a
 * part with only hidden ones is left alone. Order: reading order.
 */
export function partsToLoad(
  layout: unknown,
  values: Record<string, unknown> | null | undefined,
  isHidden: (fieldKey: string) => boolean = () => false,
  needs: (fieldKey: string) => boolean = () => true,
): string[] {
  const loaded = loadedTargets(values)
  return lazyParts(layout)
    .filter((p) => !loaded.has(p.target))
    .filter((p) => p.fieldKeys.some((k) => !isHidden(k) && needs(k)))
    .map((p) => p.target)
}

/** The unloaded parts holding any of these fields (an error to show there loads them). */
export function partsHoldingFields(layout: unknown, values: Record<string, unknown> | null | undefined, keys: Iterable<string>): string[] {
  const wanted = new Set(keys)
  if (!wanted.size) return []
  const loaded = loadedTargets(values)
  return lazyParts(layout).filter((p) => !loaded.has(p.target) && p.fieldKeys.some((k) => wanted.has(k))).map((p) => p.target)
}

/** Targets loaded now that were not before (the "Section / tab loaded" events to dispatch). */
export function newlyLoaded(before: ReadonlySet<string>, after: ReadonlySet<string>): string[] {
  return [...after].filter((t) => !before.has(t))
}

/**
 * `section.<key>.loaded` / `step.<id>.loaded` in rule conditions: true for
 * an eager part (it loaded with the form) or a lazy part that has loaded.
 * Null when the path is not one of these, or names no part.
 */
export function loadedConditionValue(path: string, values: Record<string, unknown>, layout?: unknown): boolean | null {
  const m = /^(section|step)\.([A-Za-z0-9_-]{1,64})\.loaded$/.exec(path)
  if (!m) return null
  const target = `${m[1] === 'step' ? 'page' : 'section'}:${m[2]}`
  if (layout !== undefined) return isPartLoaded(layout, values, target)
  return loadedTargets(values).has(target) || null
}

/** A lazy part's display name (designer / rules). */
export function partLabel(layout: unknown, target: string): string {
  const part = lazyParts(layout).find((p) => p.target === target)
  if (part) return part.title
  const t = parseTarget(target)
  return t?.id ?? target
}

/** The parts a "Load section / tab" may target: every page of a paged form and every section. */
export function loadableTargets(layout: unknown): Array<{ target: string; kind: 'page' | 'section'; label: string; load: FormPartLoad }> {
  if (!isPlainObject(layout)) return []
  const out: Array<{ target: string; kind: 'page' | 'section'; label: string; load: FormPartLoad }> = []
  if ((layout.mode === 'steps' || layout.mode === 'tabs') && Array.isArray(layout.pages)) {
    for (const p of layout.pages.filter(isPlainObject)) if (typeof p.id === 'string') out.push({ target: `page:${p.id}`, kind: 'page', label: typeof p.title === 'string' ? p.title : p.id, load: loadOf(p) ?? 'eager' })
  }
  for (const s of (Array.isArray(layout.sections) ? layout.sections : []).filter(isPlainObject)) {
    if (typeof s.key === 'string') out.push({ target: `section:${s.key}`, kind: 'section', label: typeof s.title === 'string' && s.title ? s.title : s.key, load: loadOf(s) ?? 'eager' })
  }
  return out
}

interface RuleLike { disabled?: unknown; then?: unknown }
interface ActionLike { type?: unknown; targets?: unknown; prompt?: { buttons?: Array<{ then?: unknown }> } }

function actionsOf(list: unknown): ActionLike[] {
  const out: ActionLike[] = []
  for (const a of Array.isArray(list) ? list.filter(isPlainObject) as ActionLike[] : []) {
    out.push(a)
    for (const b of Array.isArray(a.prompt?.buttons) ? a.prompt!.buttons : []) out.push(...actionsOf(b?.then))
  }
  return out
}

/** Targets some enabled rule (or in-form Button) of the form can load. */
export function ruleLoadedTargets(layout: unknown, fields: Array<{ type?: string; button?: { actions?: unknown } | null }> = []): Set<string> {
  const out = new Set<string>()
  const lists: unknown[] = []
  if (isPlainObject(layout) && Array.isArray(layout.rules)) for (const r of layout.rules.filter(isPlainObject) as RuleLike[]) if (r.disabled !== true) lists.push(r.then)
  for (const f of fields) if (f.type === 'button') lists.push(f.button?.actions)
  for (const list of lists) for (const a of actionsOf(list)) if (a.type === 'load_part' && Array.isArray(a.targets)) for (const t of a.targets) if (typeof t === 'string') out.add(t)
  return out
}

/** Designer warnings: "When a rule loads it" parts no rule loads (they would never show their fields). target → message. */
export function lazyLoadProblems(layout: unknown, fields: Array<{ type?: string; button?: { actions?: unknown } | null }> = []): Record<string, string> {
  const reachable = ruleLoadedTargets(layout, fields)
  const out: Record<string, string> = {}
  for (const part of lazyParts(layout)) {
    if (part.load !== 'rule' || reachable.has(part.target)) continue
    out[part.target] = `No rule loads ${part.kind === 'page' ? 'this step / tab' : 'this section'}: add a rule with "Load section / tab", or it shows a placeholder until the form is submitted.`
  }
  return out
}

interface FieldSizeLike { type?: string; data_table?: { page_size?: number } | null; custom?: { size?: { default_height?: number } | null } | null }

/**
 * About how tall a part's controls will be (px), so its placeholder keeps
 * the page's layout: a later "when first shown" section is not pulled into
 * view by the skeletons above it being shorter than the real controls (and
 * the page does not jump when they load). Per row, the tallest cell.
 */
export function estimatePartHeight(rows: Array<{ cells: Array<{ field_key: string }> }>, fields: ReadonlyMap<string, FieldSizeLike>, gap = 12): number {
  const cell = (f: FieldSizeLike | undefined): number => {
    switch (f?.type) {
      case 'data_table': return 110 + Math.min(Math.max(f.data_table?.page_size ?? 10, 1), 50) * 29
      case 'custom': return 24 + Math.min(Math.max(f.custom?.size?.default_height ?? 200, 40), 1400)
      case 'textarea': return 124
      case 'attachments': return 110
      case 'multi_choice': return 120
      default: return 64
    }
  }
  const heights = rows.filter((r) => r.cells.length).map((r) => Math.max(...r.cells.map((c) => cell(fields.get(c.field_key)))))
  return heights.reduce((sum, h) => sum + h, 0) + Math.max(0, heights.length - 1) * gap
}
