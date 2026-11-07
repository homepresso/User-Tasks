/**
 * Database writes of custom references: ONE parameterised statement per
 * call — INSERT, UPDATE … WHERE, upsert, DELETE … WHERE — or a call of an
 * introspected stored procedure / function.
 *
 *  - Column, table and parameter names come from introspection (saved with
 *    the reference) and are quoted per dialect; anything else is refused.
 *  - Every value is a `{{cvN}}` token that lib/db-reference binds as a
 *    driver parameter. No value is ever spliced into the SQL text.
 *  - Update / Delete always carry a WHERE (key columns AND filter
 *    conditions). A blank key value or a WHERE that ends up empty is
 *    refused at run time.
 *  - Upsert per dialect: PostgreSQL ON CONFLICT … DO UPDATE, MySQL ON
 *    DUPLICATE KEY UPDATE, SQL Server / Oracle / Snowflake MERGE.
 *  - Written rows come back with RETURNING (PostgreSQL) or OUTPUT (SQL
 *    Server). Other dialects return the values written.
 *
 * Execute support: PostgreSQL (functions via SELECT, procedures via CALL),
 * SQL Server (EXEC with named parameters), MySQL (CALL) and Oracle
 * (anonymous block with named parameters, functions via SELECT … FROM dual).
 * Snowflake procedures are not supported yet (their arguments are not
 * introspected by name).
 *
 * Pure and client-safe.
 */

import { CustomReferenceError, renderTemplateValue } from './inputs'
import { quoteIdent, sqlContext, type CompiledTableQuery, type SqlDialect } from './sql'
import { columnName, KIND_INFO, type CustomReferenceConfig } from './types'

export interface CompiledWrite extends CompiledTableQuery {
  /** The statement returns the written rows (RETURNING / OUTPUT / procedure result). */
  returnsRows: boolean
  /** Statement kind, for the dry run and the call log. */
  statement: 'insert' | 'update' | 'upsert' | 'delete' | 'call'
}

export const EXECUTE_DIALECTS: readonly SqlDialect[] = ['postgres', 'mssql', 'mysql', 'oracle']
export const RETURNING_DIALECTS: readonly SqlDialect[] = ['postgres', 'mssql']

const isBlank = (v: unknown) => v === undefined || v === null || v === ''
const PARAM_NAME = /^[A-Za-z_][A-Za-z0-9_$#]{0,127}$/

/** Compile a Create / Update / Upsert / Delete / Execute config for a table source. */
export function compileWriteStatement(config: CustomReferenceConfig, values: Record<string, unknown>, dialect: SqlDialect): CompiledWrite {
  if (config.kind === 'execute') return compileExecute(config, values, dialect)
  const ctx = sqlContext(config, values, dialect)
  const { col, bind, groupSql, tokens, inputs, from } = ctx
  const write = config.write ?? {}
  const kindLabel = KIND_INFO[config.kind]?.label ?? config.kind
  const valueOf = (template: string) => {
    const v = renderTemplateValue(template, values)
    return v === '' ? null : v
  }

  // RETURNING / OUTPUT columns: the projection (or every column).
  const returning = Boolean(write.returning) && RETURNING_DIALECTS.includes(dialect)
  const source = config.source.type === 'table' ? config.source : null
  const projected = config.columns.length ? config.columns : (source?.columns ?? []).map((c) => ({ path: c.name }))
  const returnList = (prefix: string) => projected.map((c) => {
    const alias = columnName(c)
    const expr = `${prefix}${col(c.path)}`
    return alias === c.path ? expr : `${expr} AS ${quoteIdent(alias, dialect)}`
  }).join(', ')
  const pgReturning = returning && dialect === 'postgres' ? ` RETURNING ${returnList('')}` : ''
  const mssqlOutput = (pseudo: 'INSERTED' | 'DELETED') => (returning && dialect === 'mssql' ? ` OUTPUT ${returnList(`${pseudo}.`)}` : '')

  // WHERE: key columns AND filter conditions (Update / Delete).
  const whereSql = (): string => {
    const parts: string[] = []
    for (const k of write.key ?? []) {
      const v = renderTemplateValue(k.value, values)
      if (isBlank(v)) throw new CustomReferenceError(`${kindLabel} refused: the key "${k.column}" is empty — an unbounded ${config.kind} is not allowed`)
      parts.push(`${col(k.column)} = ${bind(v)}`)
    }
    const filter = config.filter ? groupSql(config.filter, 0) : null
    if (filter) parts.push(filter)
    if (!parts.length) throw new CustomReferenceError(`${kindLabel} refused: no key or condition applies — an unbounded ${config.kind} is not allowed`)
    return ` WHERE ${parts.join(' AND ')}`
  }

  const set = write.set ?? []
  switch (config.kind) {
    case 'create': {
      if (!set.length) throw new CustomReferenceError('Create: choose the columns to write')
      const cols = set.map((c) => col(c.column)).join(', ')
      const vals = set.map((c) => bind(valueOf(c.value))).join(', ')
      const sql = `INSERT INTO ${from} (${cols})${mssqlOutput('INSERTED')} VALUES (${vals})${pgReturning}`
      return { sql, values: tokens, inputs, returnsRows: returning, statement: 'insert' }
    }
    case 'update': {
      if (!set.length) throw new CustomReferenceError('Update: choose the columns to SET')
      const assignments = set.map((c) => `${col(c.column)} = ${bind(valueOf(c.value))}`).join(', ')
      const sql = `UPDATE ${from} SET ${assignments}${mssqlOutput('INSERTED')}${whereSql()}${pgReturning}`
      return { sql, values: tokens, inputs, returnsRows: returning, statement: 'update' }
    }
    case 'delete': {
      const sql = `DELETE FROM ${from}${mssqlOutput('DELETED')}${whereSql()}${pgReturning}`
      return { sql, values: tokens, inputs, returnsRows: returning, statement: 'delete' }
    }
    case 'upsert':
      return { sql: upsertSql(config, values, dialect, ctx, returning ? returnList : null), values: tokens, inputs, returnsRows: returning, statement: 'upsert' }
    default:
      throw new CustomReferenceError(`"${config.kind}" is not a write kind`)
  }
}

function upsertSql(
  config: CustomReferenceConfig,
  values: Record<string, unknown>,
  dialect: SqlDialect,
  ctx: ReturnType<typeof sqlContext>,
  returnList: ((prefix: string) => string) | null,
): string {
  const { col, bind, from } = ctx
  const keys = config.write?.key ?? []
  const set = config.write?.set ?? []
  if (!keys.length) throw new CustomReferenceError('Upsert: choose the key columns')
  if (!set.length) throw new CustomReferenceError('Upsert: choose the columns to write')
  const keyValues = keys.map((k) => {
    const v = renderTemplateValue(k.value, values)
    if (isBlank(v)) throw new CustomReferenceError(`Upsert refused: the key "${k.column}" is empty`)
    return { column: k.column, token: bind(v) }
  })
  const setValues = set.map((c) => {
    const v = renderTemplateValue(c.value, values)
    return { column: c.column, token: bind(v === '' ? null : v) }
  })
  const all = [...keyValues, ...setValues]
  const cols = all.map((c) => col(c.column)).join(', ')

  switch (dialect) {
    case 'postgres': {
      const updates = setValues.map((c) => `${col(c.column)} = EXCLUDED.${col(c.column)}`).join(', ')
      return `INSERT INTO ${from} (${cols}) VALUES (${all.map((c) => c.token).join(', ')}) ON CONFLICT (${keyValues.map((k) => col(k.column)).join(', ')}) DO UPDATE SET ${updates}${returnList ? ` RETURNING ${returnList('')}` : ''}`
    }
    case 'mysql': {
      const updates = setValues.map((c) => `${col(c.column)} = VALUES(${col(c.column)})`).join(', ')
      return `INSERT INTO ${from} (${cols}) VALUES (${all.map((c) => c.token).join(', ')}) ON DUPLICATE KEY UPDATE ${updates}`
    }
    default: {
      // MERGE (SQL Server, Oracle, Snowflake).
      const srcCols = all.map((c) => `${c.token} AS ${col(c.column)}`).join(', ')
      const using = dialect === 'oracle' ? `(SELECT ${srcCols} FROM dual)` : `(SELECT ${srcCols})`
      const on = keyValues.map((k) => `tgt.${col(k.column)} = src.${col(k.column)}`).join(' AND ')
      const updates = setValues.map((c) => `tgt.${col(c.column)} = src.${col(c.column)}`).join(', ')
      const insertVals = all.map((c) => `src.${col(c.column)}`).join(', ')
      if (dialect === 'mssql') {
        const output = returnList ? ` OUTPUT ${returnList('INSERTED.')}` : ''
        return `MERGE INTO ${from} WITH (HOLDLOCK) AS tgt USING ${using} AS src ON ${on} WHEN MATCHED THEN UPDATE SET ${updates} WHEN NOT MATCHED THEN INSERT (${cols}) VALUES (${insertVals})${output};`
      }
      if (dialect === 'oracle') {
        return `MERGE INTO ${from} tgt USING ${using} src ON (${on}) WHEN MATCHED THEN UPDATE SET ${updates} WHEN NOT MATCHED THEN INSERT (${cols}) VALUES (${insertVals})`
      }
      return `MERGE INTO ${from} AS tgt USING ${using} AS src ON ${on} WHEN MATCHED THEN UPDATE SET ${updates} WHEN NOT MATCHED THEN INSERT (${cols}) VALUES (${insertVals})`
    }
  }
}

/** Execute: call the introspected procedure / function with its parameters bound. */
export function compileExecute(config: CustomReferenceConfig, values: Record<string, unknown>, dialect: SqlDialect): CompiledWrite {
  const proc = config.write?.procedure
  if (!proc?.name) throw new CustomReferenceError('Pick the stored procedure or function to run')
  if (!EXECUTE_DIALECTS.includes(dialect)) {
    throw new CustomReferenceError(`Execute is not supported for ${dialect} yet — supported: PostgreSQL, SQL Server, MySQL and Oracle`)
  }
  const tokens: Record<string, unknown> = {}
  const inputs: CompiledTableQuery['inputs'] = []
  const bind = (value: unknown): string => {
    const name = `cv${inputs.length}`
    tokens[name] = value === undefined || value === '' ? null : typeof value === 'object' && value !== null ? JSON.stringify(value) : value
    inputs.push({ name, type: 'string' })
    return `{{${name}}}`
  }
  const name = proc.schema ? `${quoteIdent(proc.schema, dialect)}.${quoteIdent(proc.name, dialect)}` : quoteIdent(proc.name, dialect)
  const params = proc.params.map((p) => ({ ...p, name: p.name.replace(/^@/, '') }))
  for (const p of params) if (!PARAM_NAME.test(p.name)) throw new CustomReferenceError(`"${p.name}" is not a valid parameter name`)
  const valueOf = (p: { value?: string }) => (p.value === undefined ? null : renderTemplateValue(p.value, values))
  const isFunction = proc.routine_type !== 'procedure'

  let sql: string
  switch (dialect) {
    case 'postgres': {
      const args = params.map((p) => (p.is_output ? 'NULL' : bind(valueOf(p)))).join(', ')
      sql = isFunction ? `SELECT * FROM ${name}(${args})` : `CALL ${name}(${args})`
      break
    }
    case 'mssql': {
      const ins = params.filter((p) => !p.is_output)
      if (isFunction) sql = `SELECT ${name}(${ins.map((p) => bind(valueOf(p))).join(', ')}) AS result`
      else {
        const args = ins.map((p) => `@${p.name} = ${bind(valueOf(p))}`).join(', ')
        sql = `EXEC ${name}${args ? ` ${args}` : ''}`
      }
      break
    }
    case 'mysql': {
      if (params.some((p) => p.is_output)) throw new CustomReferenceError('MySQL procedures with OUT parameters are not supported yet')
      const args = params.map((p) => bind(valueOf(p))).join(', ')
      sql = isFunction ? `SELECT ${name}(${args}) AS result` : `CALL ${name}(${args})`
      break
    }
    default: {
      // oracle
      if (params.some((p) => p.is_output)) throw new CustomReferenceError('Oracle procedures with OUT parameters are not supported yet')
      if (isFunction) sql = `SELECT ${name}(${params.map((p) => `${p.name} => ${bind(valueOf(p))}`).join(', ')}) AS result FROM dual`
      else sql = `BEGIN ${name}(${params.map((p) => `${p.name} => ${bind(valueOf(p))}`).join(', ')}); END;`
    }
  }
  return { sql, values: tokens, inputs, returnsRows: true, statement: 'call' }
}
