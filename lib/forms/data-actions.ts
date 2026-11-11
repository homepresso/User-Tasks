/**
 * Form rules' data and API actions (lib/forms/field-buttons.ts):
 *
 *   table_read     one row by id or filter      → outputs (fields, variables…)
 *   table_list     rows (filter, sort, limit)   → a List field, a choice's options…
 *   table_create   insert a row from mappings   → the new row id
 *   table_update   update by id or filter
 *   table_delete   delete by id (optionally after a confirmation)
 *   call_reference an Integrations reference    → outputs; wait for it, or fire and forget
 *
 * Every action runs on the server (lib/services/form-rule-actions.ts), read
 * from the SAVED form by rule id + action index; the browser only sends the
 * values and the event. What the result writes is the saved action's
 * `outputs` (and the older `results` map of call_reference).
 *
 * Inputs, filter values and column values are templates over the form's
 * values ({{form.x}} / {{x}}), the list row of a row event ({{row.x}}),
 * parameters and variables ({{param.x}}, {{var.x}}), the user
 * ({{user.id|email|name}}), dates ({{today}}, {{now}}, {{today+7d}}) and the
 * event ({{event.*}}); anything else is a constant.
 *
 * Outputs: { path, to, as?, mode?, columns?, value_path?, label_path? }
 *   path        a result path (`name`, `data.items`, `[0].email`, '' = all)
 *   to          a field key (an input, a Label, a read-only field), a List
 *               field, or `var.<name>`
 *   as          'options' — `to` is a choice / multi-select: the array at
 *               `path` becomes its options (value_path / label_path per item)
 *   mode        List targets: 'replace' (default) or 'append'
 *   columns     List targets: column key → item path (`sku` ← `item.sku`);
 *               default: the item's field of the same name
 *
 * The result each action gives (what `path` reads, and {{result.*}} in its
 * on-success actions): table_read → the row ({ row_id, …columns }, null when
 * none); table_list → the rows (an array); table_create → { row_id, row };
 * table_update → { count, row_ids }; table_delete → { count, row_ids };
 * call_reference → the response body (after its optional local filter /
 * sort / limit on `rows_path`).
 *
 * Pure and isomorphic.
 */

import { isPlainObject } from '@/lib/utils/guards'
import { splitPath, valueAtPath } from '@/lib/response-schema'
import {
  DATA_TABLE_LIMITS, dateExpression, isConditionGroup, normalizeConditionGroup, rowMeets,
  type DataTableColumnType, type DataTableCondition, type DataTableConditionGroup, type DataTableOperator, type DataTableSort,
} from './data-table'
import { FORBIDDEN_RESULT_SEGMENTS, isResultPath, normalizeResultPath } from './result-paths'

export type TableActionType = 'table_read' | 'table_list' | 'table_create' | 'table_update' | 'table_delete'
export const TABLE_ACTION_TYPES: TableActionType[] = ['table_read', 'table_list', 'table_create', 'table_update', 'table_delete']
export const TABLE_WRITE_ACTIONS: ReadonlySet<string> = new Set(['table_create', 'table_update', 'table_delete'])

export const DATA_ACTION_LIMITS = { outputs: 30, columns: 40, listRows: 200, updateRows: 50, timeoutMinMs: 1000, timeoutMaxMs: 30_000, timeoutDefaultMs: 10_000, sorts: 3, values: 40 } as const

export interface ActionOutput {
  path: string
  to: string
  as?: 'options'
  mode?: 'replace' | 'append'
  columns?: Record<string, string>
  value_path?: string
  label_path?: string
}

/** A choice's options loaded by a rule (values[OPTIONS_KEY][field]). */
export interface RuleOption { value: string; label: string }

/** Where a form's rule-loaded options live in the values (never stored with a submission). */
export const OPTIONS_KEY = '__options'
/** Under OPTIONS_KEY: the fields whose options a running step is loading. */
export const OPTIONS_LOADING = '__loading'

/** Fields whose rule-loaded options are loading right now. */
export function optionsLoading(values: Record<string, unknown> | null | undefined): string[] {
  const all = values?.[OPTIONS_KEY]
  const list = isPlainObject(all) ? all[OPTIONS_LOADING] : undefined
  return Array.isArray(list) ? list.filter((k): k is string => typeof k === 'string') : []
}

const KEY_RE = /^[a-z0-9_]{1,64}$/
const VAR_TARGET_RE = /^var\.[a-z][a-z0-9_]{0,39}$/
const COLUMN_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/

/* ── Filters and sorts ──────────────────────────────────────────────── */

/**
 * Data step operator names (eq, neq, gt, gte, lt, lte, like, ilike,
 * starts_with, ends_with, is_null, not_null, in) and the condition spellings
 * → the Data table field's operators (lib/forms/data-table.ts).
 */
const OPERATOR_ALIASES: Record<string, DataTableOperator> = {
  eq: 'eq', equals: 'eq', '=': 'eq', '==': 'eq',
  neq: 'neq', not_equals: 'neq', '!=': 'neq',
  gt: 'gt', gte: 'gte', lt: 'lt', lte: 'lte',
  like: 'contains', ilike: 'contains', contains: 'contains',
  starts_with: 'starts_with', ends_with: 'ends_with',
  is_null: 'is_not_set', is_empty: 'is_not_set', is_not_set: 'is_not_set',
  not_null: 'is_set', is_not_empty: 'is_set', is_set: 'is_set',
  in: 'in',
}

function canonicalGroup(raw: unknown, depth = 0): unknown {
  if (!isPlainObject(raw) || depth > 3) return raw
  const conditions = Array.isArray(raw.conditions) ? raw.conditions : []
  return {
    ...raw,
    conditions: conditions.map((c) => {
      if (!isPlainObject(c)) return c
      if (Array.isArray(c.conditions)) return canonicalGroup(c, depth + 1)
      const op = OPERATOR_ALIASES[String(c.operator ?? '').trim().toLowerCase()]
      return { ...c, column: c.column ?? c.field, ...(op ? { operator: op } : {}) }
    }),
  }
}

/** A filter: AND / OR groups of { column, operator, value } (templates allowed in values). */
export function normalizeActionFilter(raw: unknown): DataTableConditionGroup | undefined {
  // A plain list of conditions reads as "all of".
  const group = Array.isArray(raw) ? { match: 'all', conditions: raw } : raw
  return normalizeConditionGroup(canonicalGroup(group))
}

export function normalizeActionSort(raw: unknown): DataTableSort[] | undefined {
  const list = Array.isArray(raw) ? raw : isPlainObject(raw) ? [raw] : []
  const out: DataTableSort[] = []
  for (const s of list) {
    if (!isPlainObject(s)) continue
    const column = String(s.column ?? s.field ?? '').trim()
    if (!COLUMN_RE.test(column) || out.some((x) => x.column === column)) continue
    out.push({ column, direction: s.direction === 'desc' ? 'desc' : 'asc' })
    if (out.length >= DATA_ACTION_LIMITS.sorts) break
  }
  return out.length ? out : undefined
}

export function clampLimit(raw: unknown, fallback: number, max: number): number {
  const n = Math.floor(Number(raw))
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback
}

/* ── Templates ──────────────────────────────────────────────────────── */

export interface ActionScope {
  /** Form values (params / variables under their reserved keys). */
  values: Record<string, unknown>
  user?: Record<string, unknown> | null
  event?: Record<string, unknown> | null
  now?: Date
}

/** Resolve a path the way rules do, plus {{today+7d}}-style dates (the caller's `ruleValue`). */
export type PathReader = (path: string, scope: ActionScope) => unknown

const TEMPLATE_RE = /\{\{\s*([\w.\-[\]$+*]+)\s*\}\}/g

function text(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') { try { return JSON.stringify(v) } catch { return '' } }
  return String(v)
}

/** A template's value: a whole {{path}} keeps its type; text with placeholders is interpolated; anything else is a constant. */
export function resolveActionTemplate(template: string | undefined, scope: ActionScope, read: PathReader): unknown {
  if (typeof template !== 'string') return template ?? ''
  const value = (path: string) => dateExpression(path, scope.now ?? new Date()) ?? read(path, scope)
  const whole = /^\{\{\s*([\w.\-[\]$+*]+)\s*\}\}$/.exec(template.trim())
  if (whole) { const v = value(whole[1]); return v === undefined ? null : v }
  if (!template.includes('{{')) return template
  return template.replace(TEMPLATE_RE, (_m, path: string) => text(value(path)))
}

/** A filter with its values resolved (constants), ready for the table plan or local evaluation. */
export function resolveFilter(group: DataTableConditionGroup | undefined, scope: ActionScope, read: PathReader): DataTableConditionGroup | undefined {
  if (!group) return undefined
  const walk = (g: DataTableConditionGroup): DataTableConditionGroup => ({
    match: g.match,
    conditions: g.conditions.map((c) => (isConditionGroup(c) ? walk(c) : { ...c, value: c.operator === 'is_set' || c.operator === 'is_not_set' ? '' : text(resolveActionTemplate(c.value ?? '', scope, read)) } as DataTableCondition)),
  })
  return walk(group)
}

/* ── Local query (API results): the Data table field's own evaluation ─ */

function guessType(values: unknown[]): DataTableColumnType {
  const set = values.filter((v) => v !== null && v !== undefined && v !== '')
  if (set.length && set.every((v) => typeof v === 'number')) return 'number'
  if (set.length && set.every((v) => typeof v === 'boolean')) return 'boolean'
  return 'text'
}

function itemValues(item: unknown): Record<string, unknown> {
  return isPlainObject(item) ? item : { value: item }
}

/** Rows meeting a resolved filter (paths into each item; numbers / booleans compared as such). */
function meetsGroup(item: Record<string, unknown>, group: DataTableConditionGroup, rows: Record<string, unknown>[]): boolean {
  const results = group.conditions.map((c) => {
    if (isConditionGroup(c)) return meetsGroup(item, c, rows)
    const cell = valueAtPath(item, c.column)
    const type = guessType(rows.map((r) => valueAtPath(r, c.column)))
    return rowMeets({ v: cell }, 'v', type, c.operator, c.value ?? '')
  })
  return group.match === 'any' ? results.some(Boolean) : results.every(Boolean)
}

function compareValues(a: unknown, b: unknown): number {
  const blankA = a === null || a === undefined || a === ''
  const blankB = b === null || b === undefined || b === ''
  if (blankA || blankB) return blankA === blankB ? 0 : blankA ? 1 : -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return text(a).localeCompare(text(b), undefined, { numeric: true, sensitivity: 'base' })
}

/** Filter / sort / offset / limit an array of results in memory (an API's rows). */
export function applyLocalQuery(items: unknown[], query: { filter?: DataTableConditionGroup; sort?: DataTableSort[]; limit?: number; offset?: number }): unknown[] {
  const rows = items.map(itemValues)
  let out = rows.map((r, i) => ({ r, item: items[i] }))
  if (query.filter) out = out.filter(({ r }) => meetsGroup(r, query.filter!, rows))
  if (query.sort?.length) {
    out = [...out].sort((x, y) => {
      for (const s of query.sort!) {
        const cmp = compareValues(valueAtPath(x.r, s.column), valueAtPath(y.r, s.column))
        if (cmp) return s.direction === 'desc' ? -cmp : cmp
      }
      return 0
    })
  }
  const offset = Math.max(0, query.offset ?? 0)
  const limit = query.limit ?? DATA_TABLE_LIMITS.referenceRows
  return out.slice(offset, offset + limit).map(({ item }) => item)
}

/* ── Result paths ───────────────────────────────────────────────────── */

/** The value at a result path ('' = the whole result); undefined when it has none. */
export function readActionResult(result: unknown, path: string | undefined): unknown {
  const p = normalizeResultPath(path ?? '')
  if (!p) return result
  if (!isResultPath(p)) return undefined
  for (const segment of splitPath(p)) if (FORBIDDEN_RESULT_SEGMENTS.has(segment)) return undefined
  return valueAtPath(result, p)
}

/** Write a value at a dot / bracket path, creating objects and arrays on the way (for {{result.*}} projections). */
export function setAtPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = splitPath(path)
  if (!parts.length || parts.some((p) => FORBIDDEN_RESULT_SEGMENTS.has(p))) return
  let cursor: any = target
  parts.forEach((part, i) => {
    const last = i === parts.length - 1
    const key: string | number = /^\d+$/.test(part) ? Number(part) : part
    if (last) { cursor[key] = value; return }
    const nextIsIndex = /^\d+$/.test(parts[i + 1])
    if (cursor[key] === undefined || cursor[key] === null || typeof cursor[key] !== 'object') cursor[key] = nextIsIndex ? [] : {}
    cursor = cursor[key]
  })
}

function bounded(v: unknown, max = 20_000): unknown {
  if (v === null || v === undefined || typeof v === 'number' || typeof v === 'boolean') return v ?? null
  if (typeof v === 'string') return v.slice(0, 5000)
  try {
    const json = JSON.stringify(v)
    return json !== undefined && json.length <= max ? JSON.parse(json) : null
  } catch { return null }
}

/**
 * The part of a result the browser gets for {{result.*}} placeholders: only
 * the paths the action's on-success / on-failure steps read (scanned from
 * their templates), bounded — never the whole response.
 */
export function resultProjection(result: unknown, templates: string[]): unknown {
  const paths = new Set<string>()
  // {{result.x}}, {{result[0].x}}, {{result[*].x}}, and inside {{= … }} formulas.
  for (const t of templates) for (const m of String(t ?? '').matchAll(/\bresult((?:\.[\w$-]+|\[(?:\d+|\*)?\])+)/g)) paths.add(m[1].replace(/^\./, ''))
  for (const t of templates) if (/\{\{\s*result\s*\}\}/.test(String(t ?? ''))) paths.add('')
  if (!paths.size) return null
  if (paths.has('')) { const b = bounded(result); return b }
  let out: unknown = Array.isArray(result) ? [] : {}
  for (const p of paths) out = mergeProjection(out, projectPath(result, pathSegments(p)))
  return out
}

/** Path segments: names, [n] indexes and [*] (every item). */
export function pathSegments(path: string): Array<string | number | '*'> {
  const out: Array<string | number | '*'> = []
  for (const m of String(path ?? '').matchAll(/([^.[\]]+)|\[(\d+|\*)?\]/g)) {
    if (m[1] !== undefined) out.push(m[1])
    else out.push(m[2] === undefined || m[2] === '*' ? '*' : Number(m[2]))
  }
  return out
}

/**
 * A value at a path with [n] indexes and [*] (every item → a list):
 * `items[0].sku`, `[*].name`, `data.rows[*].id`. Unsafe names read nothing.
 */
export function readDeepPath(value: unknown, path: string): unknown {
  const walk = (cursor: unknown, segs: Array<string | number | '*'>): unknown => {
    if (!segs.length) return cursor
    if (cursor === null || cursor === undefined) return undefined
    const [head, ...rest] = segs
    if (head === '*') return Array.isArray(cursor) ? cursor.map((item) => walk(item, rest)).filter((v) => v !== undefined) : undefined
    if (typeof head === 'number') return Array.isArray(cursor) ? walk(cursor[head], rest) : undefined
    if (FORBIDDEN_RESULT_SEGMENTS.has(head) || typeof cursor !== 'object') return undefined
    // A key with dots wins (OData '@odata.count') — only as the whole remaining path.
    return walk((cursor as Record<string, unknown>)[head], rest)
  }
  return walk(value, pathSegments(path))
}

/** Just the part of `value` at a path (same shape: objects and arrays kept, everything else dropped). */
function projectPath(value: unknown, segs: Array<string | number | '*'>): unknown {
  if (!segs.length) return bounded(value, 4000)
  if (value === null || value === undefined) return undefined
  const [head, ...rest] = segs
  if (head === '*') return Array.isArray(value) ? value.slice(0, 200).map((item) => projectPath(item, rest) ?? null) : undefined
  if (typeof head === 'number') {
    if (!Array.isArray(value) || head >= value.length) return undefined
    const arr: unknown[] = []
    arr[head] = projectPath(value[head], rest)
    return arr
  }
  if (FORBIDDEN_RESULT_SEGMENTS.has(head) || typeof value !== 'object' || Array.isArray(value)) return undefined
  const inner = projectPath((value as Record<string, unknown>)[head], rest)
  return inner === undefined ? undefined : { [head]: inner }
}

function mergeProjection(a: unknown, b: unknown): unknown {
  if (b === undefined) return a
  if (Array.isArray(a) && Array.isArray(b)) { const out = [...a]; b.forEach((v, i) => { if (v !== undefined) out[i] = mergeProjection(out[i], v) }); return out }
  if (isPlainObject(a) && isPlainObject(b)) { const out: Record<string, unknown> = { ...a }; for (const [k, v] of Object.entries(b)) out[k] = mergeProjection(out[k], v); return out }
  return b
}

/* ── Outputs ────────────────────────────────────────────────────────── */

export function normalizeOutputs(raw: unknown): ActionOutput[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: ActionOutput[] = []
  for (const o of raw.slice(0, DATA_ACTION_LIMITS.outputs)) {
    if (!isPlainObject(o)) continue
    const path = normalizeResultPath(String(o.path ?? ''))
    const to = String(o.to ?? '').trim()
    if (!isResultPath(path) || !(KEY_RE.test(to) || VAR_TARGET_RE.test(to))) continue
    const entry: ActionOutput = { path, to }
    if (o.as === 'options' && KEY_RE.test(to)) {
      entry.as = 'options'
      const vp = normalizeResultPath(String(o.value_path ?? ''))
      const lp = normalizeResultPath(String(o.label_path ?? ''))
      if (vp && isResultPath(vp)) entry.value_path = vp
      if (lp && isResultPath(lp)) entry.label_path = lp
    }
    if (o.mode === 'append') entry.mode = 'append'
    if (isPlainObject(o.columns)) {
      const cols: Record<string, string> = {}
      for (const [k, p] of Object.entries(o.columns).slice(0, DATA_ACTION_LIMITS.columns)) {
        const cp = normalizeResultPath(String(p ?? ''))
        if (COLUMN_RE.test(k) && isResultPath(cp)) cols[k] = cp
      }
      if (Object.keys(cols).length) entry.columns = cols
    }
    out.push(entry)
  }
  return out.length ? out : undefined
}

/** The rule-loaded options of a field (values[OPTIONS_KEY]), or null. */
export function ruleOptions(values: Record<string, unknown> | null | undefined, key: string): RuleOption[] | null {
  const all = values?.[OPTIONS_KEY]
  const list = isPlainObject(all) ? all[key] : undefined
  return Array.isArray(list) ? list.filter((o): o is RuleOption => isPlainObject(o) && typeof o.value === 'string').map((o) => ({ value: o.value, label: typeof o.label === 'string' ? o.label : o.value })) : null
}

/** Fields whose options a rule of the saved form loads (their values are judged against what the rule loaded). */
export function ruleOptionFields(actions: Array<{ outputs?: ActionOutput[] }>): Set<string> {
  const out = new Set<string>()
  for (const a of actions) for (const o of a.outputs ?? []) if (o.as === 'options') out.add(o.to)
  return out
}

/* ── TOP 1: a list result into a single-value target ─────────────────── */

export const TOP_ONE_NOTICE = 'This returns a list. Only the first row is used (TOP 1).'
export const TOP_ONE_HINT = 'Use filters and sort to get the right row — e.g. filter by ID, or sort by date, newest first.'

/** Does the filter pin one row (row id / id equals …, in an all-of group)? */
export function pinsUniqueRow(filter: DataTableConditionGroup | undefined, rowId?: string): boolean {
  if (rowId && rowId.trim()) return true
  if (!filter || filter.match === 'any') return false
  return filter.conditions.some((c) => !isConditionGroup(c) && c.operator === 'eq' && ['row_id', 'id', 'key', 'uuid'].includes(c.column.toLowerCase()) && String(c.value ?? '').trim() !== '')
}

/** Whether an output takes the whole list (a List field, a choice's options) rather than one value. */
export function takesWholeList(output: Pick<ActionOutput, 'as'>, targetType: string | undefined): boolean {
  return output.as === 'options' || targetType === 'list' || targetType === 'multi_choice'
}

/**
 * The designer's / Agent's TOP 1 notice for one output (null = none): the
 * step returns a list (table_list, or an API path that reads a list —
 * `resultIsList`) and the output writes one value. Not for a read by id, a
 * filter pinning a unique key, an explicit limit of 1, or a List / options
 * target.
 */
export function topOneNotice(
  action: { type: string; row_id?: string; filter?: DataTableConditionGroup; limit?: number },
  output: Pick<ActionOutput, 'as' | 'path'>,
  targetType: string | undefined,
  resultIsList = action.type === 'table_list',
): string | null {
  if (!resultIsList || action.type === 'table_read') return null
  if (takesWholeList(output, targetType)) return null
  if (output.path && /^\[\d+\]/.test(output.path)) return null
  if (action.limit === 1 || pinsUniqueRow(action.filter, action.row_id)) return null
  return TOP_ONE_NOTICE
}

/** table_list whose every output is a single value: fetch one row (TOP 1). */
export function singleRowOnly(action: { type: string; outputs?: ActionOutput[]; on_success?: unknown[] }, typeOf: (key: string) => string | undefined): boolean {
  const outputs = action.outputs ?? []
  if (action.type !== 'table_list' || !outputs.length || (action.on_success?.length ?? 0) > 0) return false
  return outputs.every((o) => !o.to.startsWith('var.') && !takesWholeList(o, typeOf(o.to)))
}
