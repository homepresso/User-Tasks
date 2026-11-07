/**
 * The shaping pipeline of a custom reference:
 *
 *   source call → extract collection → filter → distinct → sort → project → limit / page
 *
 * `planShaping` decides which stages the API does (REST parameters the
 * designer mapped; for database tables everything runs in SQL) and which the
 * server applies after fetching (at most CUSTOM_LIMITS.serverRows rows).
 * `shapeResult` runs the server stages. Values are compared as data; nothing
 * a caller sends is ever evaluated.
 *
 * Pure and client-safe (the builder previews which stages run where).
 */

import { collectionAt } from '@/lib/response-collections'
import { CustomReferenceError, maxRowsOf, pageSizeOf, renderTemplateValue } from './inputs'
import { describeWrite } from './write'
import {
  CUSTOM_LIMITS,
  isWriteKind,
  columnName,
  isFilterGroup,
  wholeInputToken,
  type CustomColumn,
  type CustomReferenceConfig,
  type FilterCondition,
  type FilterGroup,
  type SortSpec,
} from './types'


export interface ShapingPlan {
  /** Root-level AND conditions sent to the API as parameters (indexes into filter.conditions). */
  apiConditions: Set<number>
  /** The API sorts (sort_param mapped). */
  apiSort: boolean
  /** The API pages (limit_param mapped). */
  apiPaging: boolean
  /** Everything runs at the source (database SQL). */
  allAtSource: boolean
}

export interface ShapingStageSummary {
  api: string[]
  server: string[]
}

const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype'])

export function planShaping(config: CustomReferenceConfig): ShapingPlan {
  if (config.source.type === 'table') return { apiConditions: new Set(), apiSort: true, apiPaging: true, allAtSource: true }
  const apiConditions = new Set<number>()
  const filter = config.filter
  if (filter && filter.op === 'and') {
    filter.conditions.forEach((node, index) => {
      if (!isFilterGroup(node) && node.api_param) apiConditions.add(index)
    })
  }
  return {
    apiConditions,
    apiSort: Boolean(config.api?.sort_param) && (config.sort ?? []).length > 0,
    apiPaging: Boolean(config.api?.limit_param),
    allAtSource: false,
  }
}

/** Plain-language summary of where each stage runs (builder + preview). */
export function describeShaping(config: CustomReferenceConfig): ShapingStageSummary {
  if (isWriteKind(config.kind)) return describeWrite(config)
  const plan = planShaping(config)
  const api: string[] = []
  const server: string[] = []
  const conditions = config.filter?.conditions ?? []
  const filterCount = countConditions(config.filter)
  if (plan.allAtSource) {
    const where = 'In the database (one parameterised SQL query)'
    const parts = [
      filterCount ? `filter (${filterCount})` : null,
      config.distinct ? 'distinct' : null,
      (config.sort ?? []).length ? 'sort' : null,
      'columns',
      'limit',
    ].filter(Boolean)
    api.push(`${where}: ${parts.join(', ')}`)
    return { api, server: ['Output shape (read / list)'] }
  }
  if (plan.apiConditions.size) api.push(`Filter: ${Array.from(plan.apiConditions).map((i) => describeCondition(conditions[i] as FilterCondition)).join('; ')}`)
  const serverFilters = filterCount - plan.apiConditions.size
  if (serverFilters > 0) server.push(`Filter (${serverFilters} condition${serverFilters === 1 ? '' : 's'})`)
  if (config.kind === 'read' && config.read?.key_field && config.read?.key_input) server.push(`Match ${config.read.key_field} = ${config.read.key_input}`)
  if (config.distinct) server.push('Distinct')
  if ((config.sort ?? []).length) (plan.apiSort ? api : server).push(`Sort by ${(config.sort ?? []).map((s) => `${s.field} ${s.direction}`).join(', ')}`)
  server.push(`Columns (${config.columns.length || 'all'})`)
  if (plan.apiPaging) api.push(`Paging (${[config.api?.limit_param, config.api?.offset_param, config.api?.page_param].filter(Boolean).join(', ')})`)
  else server.push(`Paging (at most ${maxRowsOf(config)} rows)`)
  return { api, server }
}

function describeCondition(condition: FilterCondition): string {
  return `${condition.field} ${condition.operator} → ${condition.api_param}`
}

function countConditions(group: FilterGroup | undefined): number {
  if (!group) return 0
  return group.conditions.reduce((n, node) => n + (isFilterGroup(node) ? countConditions(node) : 1), 0)
}

// ─── Values ─────────────────────────────────────────────────────────────

/** Value at a dotted path in a row (own properties only; no prototype walking). */
export function readPath(row: unknown, path: string): unknown {
  if (row === null || typeof row !== 'object') return undefined
  if (Object.prototype.hasOwnProperty.call(row, path)) return (row as Record<string, unknown>)[path]
  let cursor: unknown = row
  for (const segment of path.split('.')) {
    if (FORBIDDEN.has(segment)) return undefined
    if (cursor === null || typeof cursor !== 'object') return undefined
    if (Array.isArray(cursor)) {
      if (!/^\d+$/.test(segment)) return undefined
      cursor = cursor[Number(segment)]
      continue
    }
    if (!Object.prototype.hasOwnProperty.call(cursor, segment)) return undefined
    cursor = (cursor as Record<string, unknown>)[segment]
  }
  return cursor
}

const NUMERIC = /^\s*-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?\s*$/i
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/

function asNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && NUMERIC.test(v)) return Number(v)
  return null
}

function asDate(v: unknown): number | null {
  if (typeof v !== 'string' || !ISO_DATE.test(v.trim())) return null
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : t
}

function asText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function isBlank(v: unknown): boolean {
  if (v === null || v === undefined || v === '') return true
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === 'object') return Object.keys(v as object).length === 0
  return false
}

function equalValues(a: unknown, b: unknown): boolean {
  const na = asNumber(a)
  const nb = asNumber(b)
  if (na !== null && nb !== null) return na === nb
  if (typeof a === 'boolean' || typeof b === 'boolean') return asText(a).toLowerCase() === asText(b).toLowerCase()
  return asText(a) === asText(b)
}

/** -1 / 0 / 1; numbers numerically, ISO dates chronologically, text naturally (case-insensitive). */
export function compareValues(a: unknown, b: unknown): number {
  const na = asNumber(a)
  const nb = asNumber(b)
  if (na !== null && nb !== null) return na < nb ? -1 : na > nb ? 1 : 0
  const da = asDate(a)
  const db = asDate(b)
  if (da !== null && db !== null) return da < db ? -1 : da > db ? 1 : 0
  return asText(a).localeCompare(asText(b), undefined, { numeric: true, sensitivity: 'base' })
}

function listOf(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.slice(0, CUSTOM_LIMITS.maxInValues)
  if (typeof value === 'string') return value.split(',').map((s) => s.trim()).filter(Boolean).slice(0, CUSTOM_LIMITS.maxInValues)
  return value === undefined || value === null ? [] : [value]
}

export function testCondition(fieldValue: unknown, operator: FilterCondition['operator'], expected: unknown): boolean {
  const text = () => asText(fieldValue).toLowerCase()
  const needle = () => asText(expected).toLowerCase().slice(0, CUSTOM_LIMITS.maxValueLength)
  switch (operator) {
    case 'eq': return equalValues(fieldValue, expected)
    case 'neq': return !equalValues(fieldValue, expected)
    case 'gt': return !isBlank(fieldValue) && compareValues(fieldValue, expected) > 0
    case 'gte': return !isBlank(fieldValue) && compareValues(fieldValue, expected) >= 0
    case 'lt': return !isBlank(fieldValue) && compareValues(fieldValue, expected) < 0
    case 'lte': return !isBlank(fieldValue) && compareValues(fieldValue, expected) <= 0
    case 'contains': return text().includes(needle())
    case 'not_contains': return !text().includes(needle())
    case 'starts_with': return text().startsWith(needle())
    case 'ends_with': return text().endsWith(needle())
    case 'in': return listOf(expected).some((v) => equalValues(fieldValue, v))
    case 'not_in': return !listOf(expected).some((v) => equalValues(fieldValue, v))
    case 'is_empty': return isBlank(fieldValue)
    case 'is_not_empty': return !isBlank(fieldValue)
    default: return false
  }
}

const UNARY = new Set(['is_empty', 'is_not_empty'])

/**
 * A condition's value, or SKIP when it is a lone `{{input.x}}` whose input is
 * empty (an optional filter input left blank does not filter).
 */
const SKIP = Symbol('skip')
export function conditionValue(condition: FilterCondition, values: Record<string, unknown>): unknown | typeof SKIP {
  if (UNARY.has(condition.operator)) return undefined
  const token = wholeInputToken(condition.value)
  const value = renderTemplateValue(condition.value ?? '', values)
  if (token && isBlank(value)) return SKIP
  return value
}

// ─── Stages ─────────────────────────────────────────────────────────────

interface Budget { deadline: number; now: () => number }

function checkBudget(budget: Budget) {
  if (budget.now() > budget.deadline) throw new CustomReferenceError('Shaping took too long — narrow the filter or reduce the rows', 504)
}

/** Columns resolve fields by alias too: sort/filter on `size` works when `size` is an alias of `Size`. */
function fieldPath(field: string, columns: CustomColumn[]): string {
  const byAlias = columns.find((c) => columnName(c) === field && c.path !== field)
  return byAlias && !columns.some((c) => c.path === field) ? byAlias.path : field
}

export function matchesGroup(
  row: unknown,
  group: FilterGroup,
  values: Record<string, unknown>,
  columns: CustomColumn[],
  skipRootIndexes: Set<number> = new Set(),
  depth = 0,
): boolean {
  if (depth > CUSTOM_LIMITS.maxGroupDepth) return true
  let evaluated = 0
  let anyTrue = false
  for (let i = 0; i < group.conditions.length; i++) {
    if (depth === 0 && skipRootIndexes.has(i)) continue
    const node = group.conditions[i]
    let ok: boolean
    if (isFilterGroup(node)) {
      if (!node.conditions.length) continue
      ok = matchesGroup(row, node, values, columns, new Set(), depth + 1)
    } else {
      const expected = conditionValue(node, values)
      if (expected === SKIP) continue
      ok = testCondition(readPath(row, fieldPath(node.field, columns)), node.operator, expected)
    }
    evaluated++
    if (group.op === 'or' && ok) anyTrue = true
    if (group.op === 'and' && !ok) return false
  }
  if (group.op === 'or') return evaluated === 0 ? true : anyTrue
  return true
}

export function projectRow(row: unknown, columns: CustomColumn[]): Record<string, unknown> {
  if (!columns.length) return row && typeof row === 'object' && !Array.isArray(row) ? { ...(row as Record<string, unknown>) } : { value: row }
  const out: Record<string, unknown> = {}
  for (const column of columns) {
    const value = readPath(row, column.path)
    out[columnName(column)] = value === undefined ? null : value
  }
  return out
}

export function distinctRows<T>(rows: T[], keyOf: (row: T) => string): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const row of rows) {
    const key = keyOf(row)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  return out
}

/** Stable multi-column sort; empty values last in either direction. */
export function sortRows<T>(rows: T[], sort: SortSpec[], valueOf: (row: T, field: string) => unknown): T[] {
  if (!sort.length) return rows
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      for (const spec of sort) {
        const va = valueOf(a.row, spec.field)
        const vb = valueOf(b.row, spec.field)
        const ea = isBlank(va)
        const eb = isBlank(vb)
        if (ea || eb) {
          if (ea && eb) continue
          return ea ? 1 : -1
        }
        const c = compareValues(va, vb)
        if (c !== 0) return spec.direction === 'desc' ? -c : c
      }
      return a.index - b.index
    })
    .map((entry) => entry.row)
}

export interface ShapeOptions {
  plan?: ShapingPlan
  now?: () => number
}

export interface ShapeStats {
  fetched: number
  truncated: boolean
  matched: number
  returned: number
}

export interface ShapedResult {
  data: unknown
  stats: ShapeStats
  /** Read kind with no row and not_found = 'error'. */
  notFound?: boolean
}

/** The server-side pipeline over a source response. */
export function shapeResult(
  sourceData: unknown,
  config: CustomReferenceConfig,
  values: Record<string, unknown>,
  options: ShapeOptions = {},
): ShapedResult {
  const plan = options.plan ?? planShaping(config)
  const now = options.now ?? Date.now
  const budget: Budget = { deadline: now() + CUSTOM_LIMITS.shapingMs, now }
  const columns = config.columns ?? []

  // 1. Extract the collection.
  const all = plan.allAtSource
    ? (Array.isArray(sourceData) ? sourceData : sourceData && typeof sourceData === 'object' ? [sourceData] : [])
    : collectionAt(sourceData, config.rows_path ?? '')
  const truncated = all.length > CUSTOM_LIMITS.serverRows
  let rows: unknown[] = all.slice(0, CUSTOM_LIMITS.serverRows)
  const fetched = rows.length

  if (!plan.allAtSource) {
    // 2. Filter (conditions the API did not take).
    if (config.filter?.conditions?.length) {
      const group = config.filter
      rows = rows.filter((row, i) => {
        if (i % 200 === 0) checkBudget(budget)
        return matchesGroup(row, group, values, columns, plan.apiConditions)
      })
    }
    // Read: match the key on the server when a key field is set.
    if (config.kind === 'read' && config.read?.key_field && config.read?.key_input) {
      const key = values[config.read.key_input]
      const path = fieldPath(config.read.key_field, columns)
      if (!isBlank(key)) rows = rows.filter((row) => equalValues(readPath(row, path), key))
    }
    checkBudget(budget)
    // 3. Distinct (by the projected columns' values).
    if (config.distinct) rows = distinctRows(rows, (row) => JSON.stringify(projectRow(row, columns)))
    // 4. Sort (the API's order is kept when it sorted). Distinct without a
    //    sort is ordered by its columns, so the result is stable.
    const sort = plan.apiSort ? [] : (config.sort ?? []).length ? (config.sort ?? []) : config.distinct ? columns.map((c) => ({ field: c.path, direction: 'asc' as const })) : []
    rows = sortRows(rows, sort, (row, field) => readPath(row, fieldPath(field, columns)))
    checkBudget(budget)
  }
  const matched = rows.length

  // 5. Project.
  let projected = plan.allAtSource ? rows.map((row) => (row && typeof row === 'object' ? (row as Record<string, unknown>) : { value: row })) : rows.map((row) => projectRow(row, columns))

  // 6. Limit / page.
  if (config.kind === 'read') {
    const first = projected[0] ?? null
    const notFound = first === null && config.read?.not_found === 'error'
    return { data: first, stats: { fetched, truncated, matched, returned: first ? 1 : 0 }, ...(notFound ? { notFound } : {}) }
  }
  const max = maxRowsOf(config)
  const limit = config.paging_inputs ? Math.min(Number(values.limit) || pageSizeOf(config), max) : Math.min(pageSizeOf(config), max)
  if (!plan.apiPaging && !plan.allAtSource) {
    const page = config.paging_inputs ? Math.max(1, Number(values.page) || 1) : 1
    projected = projected.slice((page - 1) * limit, (page - 1) * limit + limit)
  } else {
    projected = projected.slice(0, limit)
  }
  const data = config.include_total ? { rows: projected, total: matched } : projected
  return { data, stats: { fetched, truncated, matched, returned: projected.length } }
}

/**
 * REST: operation parameter values for what the API does — mapped filter
 * conditions, sort and paging — merged over the designer's own parameters.
 */
export function apiParameterValues(config: CustomReferenceConfig, values: Record<string, unknown>, plan: ShapingPlan = planShaping(config)): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (config.source.type !== 'operation') return out
  for (const param of config.source.params ?? []) {
    const value = renderTemplateValue(param.value, values)
    if (!isBlank(value)) out[param.name] = value
  }
  const conditions = config.filter?.conditions ?? []
  for (const index of plan.apiConditions) {
    const condition = conditions[index] as FilterCondition
    const value = conditionValue(condition, values)
    if (value === SKIP || isBlank(value) || !condition.api_param) continue
    out[condition.api_param] = value
  }
  if (plan.apiSort && config.api?.sort_param) {
    const first = (config.sort ?? [])[0]
    if (first) {
      out[config.api.sort_param] = first.field
      if (config.api.order_param) out[config.api.order_param] = first.direction
    }
  }
  if (plan.apiPaging && config.api?.limit_param) {
    const max = maxRowsOf(config)
    const limit = config.paging_inputs ? Math.min(Number(values.limit) || pageSizeOf(config), max) : pageSizeOf(config)
    const page = config.paging_inputs ? Math.max(1, Number(values.page) || 1) : 1
    out[config.api.limit_param] = limit
    if (config.api.offset_param) out[config.api.offset_param] = (page - 1) * limit
    if (config.api.page_param) out[config.api.page_param] = page
  }
  return out
}
