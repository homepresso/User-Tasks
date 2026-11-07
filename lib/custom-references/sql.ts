/**
 * Database table/view sources: the whole shaping config compiles to ONE
 * parameterised SELECT.
 *
 *  - Identifiers (schema, table, columns) must be names from the
 *    introspected column list saved with the reference, and are quoted per
 *    dialect. Quote characters, NUL and ';' are refused outright.
 *  - Every value (filter constants, `{{input.x}}` values, the read key) is a
 *    `{{cvN}}` token that lib/db-reference binds as a driver parameter — no
 *    value is ever spliced into the SQL text.
 *  - LIMIT / OFFSET are integers computed here (never caller text).
 *
 * Pure and client-safe (the builder shows the SQL it will run).
 */

import { CustomReferenceError, maxRowsOf, pageSizeOf } from './inputs'
import { conditionValue } from './shaping'
import { columnName, isFilterGroup, CUSTOM_LIMITS, type CustomReferenceConfig, type FilterCondition, type FilterGroup } from './types'

export type SqlDialect = 'postgres' | 'mssql' | 'mysql' | 'oracle' | 'snowflake'

export const SQL_DIALECTS: readonly SqlDialect[] = ['postgres', 'mssql', 'mysql', 'oracle', 'snowflake']

export interface CompiledTableQuery {
  /** SQL with {{cvN}} tokens (bound by lib/db-reference). */
  sql: string
  countSql?: string
  values: Record<string, unknown>
  /** Synthetic inputs for the tokens (all bound parameters). */
  inputs: Array<{ name: string; type: 'string' }>
}

const NAME_RE = /^[^"`[\]\u0000;]{1,128}$/

export function quoteIdent(name: string, dialect: SqlDialect): string {
  // `{{` would be read as a value token by the statement binder.
  if (!NAME_RE.test(name) || /--|\/\*|\*\/|\{\{|\}\}/.test(name)) throw new CustomReferenceError(`"${name}" is not a valid name`)
  if (dialect === 'mssql') return `[${name}]`
  if (dialect === 'mysql') return `\`${name}\``
  return `"${name}"`
}

function textCast(expr: string, dialect: SqlDialect): string {
  switch (dialect) {
    case 'postgres': return `CAST(${expr} AS text)`
    case 'mssql': return `CAST(${expr} AS NVARCHAR(MAX))`
    case 'mysql': return `CAST(${expr} AS CHAR)`
    case 'oracle': return `TO_CHAR(${expr})`
    default: return `TO_VARCHAR(${expr})`
  }
}

const likeEscape = (value: string) => value.replace(/[!%_]/g, (c) => `!${c}`)

/** Shared pieces of the table compilers: checked column names, bound values, WHERE groups. */
export interface SqlContext {
  /** A column of the table, quoted (unknown names are refused). */
  col: (name: string) => string
  /** A value as a bound-parameter token. */
  bind: (value: unknown) => string
  /** A filter group as SQL (null when every condition was skipped). */
  groupSql: (group: FilterGroup, depth: number) => string | null
  /** A field given by column name or by its output alias. */
  field: (name: string) => string
  aliasOf: Map<string, string>
  tokens: Record<string, unknown>
  inputs: CompiledTableQuery['inputs']
  from: string
}

export function sqlContext(config: CustomReferenceConfig, values: Record<string, unknown>, dialect: SqlDialect): SqlContext {
  if (config.source.type !== 'table') throw new CustomReferenceError('Not a table source')
  if (!SQL_DIALECTS.includes(dialect)) throw new CustomReferenceError(`Table sources are not supported for ${dialect} — use an operation source instead`)
  const source = config.source
  const known = new Set(source.columns.map((c) => c.name))
  const col = (name: string): string => {
    if (!known.has(name)) throw new CustomReferenceError(`"${name}" is not a column of ${source.table}`)
    return quoteIdent(name, dialect)
  }
  const tokens: Record<string, unknown> = {}
  const inputs: CompiledTableQuery['inputs'] = []
  const bind = (value: unknown): string => {
    const name = `cv${inputs.length}`
    if (inputs.length >= 400) throw new CustomReferenceError('Too many filter values')
    const v = typeof value === 'string' ? value.slice(0, CUSTOM_LIMITS.maxValueLength) : value
    tokens[name] = v === undefined ? null : typeof v === 'object' && v !== null ? JSON.stringify(v) : v
    inputs.push({ name, type: 'string' })
    return `{{${name}}}`
  }
  const aliasOf = new Map<string, string>()
  for (const c of config.columns) aliasOf.set(columnName(c), c.path)
  // A field may be given by alias (sort by `size` when `size` aliases `Size`).
  const field = (name: string) => col(known.has(name) ? name : aliasOf.get(name) ?? name)

  const conditionSql = (c: FilterCondition): string | null => {
    const value = conditionValue(c, values)
    if (typeof value === 'symbol') return null // optional input left blank
    const f = field(c.field)
    switch (c.operator) {
      case 'eq': return `${f} = ${bind(value)}`
      case 'neq': return `${f} <> ${bind(value)}`
      case 'gt': return `${f} > ${bind(value)}`
      case 'gte': return `${f} >= ${bind(value)}`
      case 'lt': return `${f} < ${bind(value)}`
      case 'lte': return `${f} <= ${bind(value)}`
      case 'contains':
      case 'not_contains':
      case 'starts_with':
      case 'ends_with': {
        const text = likeEscape(String(value ?? '').toLowerCase())
        const pattern = c.operator === 'starts_with' ? `${text}%` : c.operator === 'ends_with' ? `%${text}` : `%${text}%`
        return `LOWER(${textCast(f, dialect)}) ${c.operator === 'not_contains' ? 'NOT LIKE' : 'LIKE'} ${bind(pattern)} ESCAPE '!'`
      }
      case 'in':
      case 'not_in': {
        const list = Array.isArray(value) ? value : String(value ?? '').split(',').map((s) => s.trim()).filter(Boolean)
        if (!list.length) return c.operator === 'in' ? '1 = 0' : null
        return `${f} ${c.operator === 'in' ? 'IN' : 'NOT IN'} (${list.slice(0, CUSTOM_LIMITS.maxInValues).map(bind).join(', ')})`
      }
      case 'is_empty': return `${f} IS NULL`
      case 'is_not_empty': return `${f} IS NOT NULL`
      default: throw new CustomReferenceError(`Unknown operator "${String((c as FilterCondition).operator)}"`)
    }
  }
  const groupSql = (group: FilterGroup, depth: number): string | null => {
    if (depth > CUSTOM_LIMITS.maxGroupDepth) throw new CustomReferenceError('Filter groups are nested too deeply')
    const parts = group.conditions
      .map((node) => (isFilterGroup(node) ? groupSql(node, depth + 1) : conditionSql(node)))
      .filter((part): part is string => !!part)
    if (!parts.length) return null
    return parts.length === 1 ? parts[0] : `(${parts.join(group.op === 'or' ? ' OR ' : ' AND ')})`
  }
  const from = source.schema ? `${quoteIdent(source.schema, dialect)}.${quoteIdent(source.table, dialect)}` : quoteIdent(source.table, dialect)
  return { col, bind, groupSql, field, aliasOf, tokens, inputs, from }
}

export function compileTableQuery(config: CustomReferenceConfig, values: Record<string, unknown>, dialect: SqlDialect): CompiledTableQuery {
  const ctx = sqlContext(config, values, dialect)
  const { col, bind, groupSql, field, tokens, inputs, from } = ctx
  if (config.source.type !== 'table') throw new CustomReferenceError('Not a table source')
  const source = config.source
  const columns = config.columns.length ? config.columns : source.columns.map((c) => ({ path: c.name }))
  const select = columns.map((c) => {
    const alias = columnName(c)
    const expr = col(c.path)
    return alias === c.path ? expr : `${expr} AS ${quoteIdent(alias, dialect)}`
  })

  const where: string[] = []
  const filter = config.filter ? groupSql(config.filter, 0) : null
  if (filter) where.push(filter)
  if (config.kind === 'read' && config.read?.key_input && config.read?.key_field) {
    const key = values[config.read.key_input]
    if (key === undefined || key === null || key === '') throw new CustomReferenceError(`Input "${config.read.key_input}" is required`)
    where.push(`${field(config.read.key_field)} = ${bind(key)}`)
  }

  const distinct = config.distinct ? 'DISTINCT ' : ''
  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : ''
  const base = `SELECT ${distinct}${select.join(', ')} FROM ${from}${whereSql}`

  let sort = (config.sort ?? []).map((s) => `${field(s.field)} ${s.direction === 'desc' ? 'DESC' : 'ASC'}`)
  if (!sort.length && config.distinct) sort = columns.map((c) => `${col(c.path)} ASC`)

  const max = maxRowsOf(config)
  const limit = config.kind === 'read' ? 1 : Math.min(config.paging_inputs ? Number(values.limit) || pageSizeOf(config) : pageSizeOf(config), max)
  const page = config.kind === 'list' && config.paging_inputs ? Math.max(1, Math.floor(Number(values.page) || 1)) : 1
  const offset = (page - 1) * limit
  const n = (v: number) => String(Math.max(0, Math.floor(v)))

  let sql = base
  if (dialect === 'mssql') {
    sql += ` ORDER BY ${sort.length ? sort.join(', ') : '(SELECT NULL)'} OFFSET ${n(offset)} ROWS FETCH NEXT ${n(limit)} ROWS ONLY`
  } else if (dialect === 'oracle') {
    if (sort.length) sql += ` ORDER BY ${sort.join(', ')}`
    sql += ` OFFSET ${n(offset)} ROWS FETCH NEXT ${n(limit)} ROWS ONLY`
  } else {
    if (sort.length) sql += ` ORDER BY ${sort.join(', ')}`
    sql += ` LIMIT ${n(limit)}${offset ? ` OFFSET ${n(offset)}` : ''}`
  }
  const countSql = config.kind === 'list' && config.include_total ? `SELECT COUNT(*) AS total FROM (${base}) counted` : undefined
  return { sql, ...(countSql ? { countSql } : {}), values: tokens, inputs }
}
