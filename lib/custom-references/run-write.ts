/**
 * Server runtime of custom reference WRITES (Create, Update, Upsert,
 * Delete, Execute), called by lib/custom-references/run.
 *
 *  - Database tables: ONE compiled statement (lib/custom-references/write-sql)
 *    in a transaction. More affected rows than the cap rolls it back (409);
 *    a dry run always rolls back and reports the SQL, its bound parameters
 *    (credentials masked) and the rows it would affect.
 *  - REST operations: the source request with the write method, the body
 *    from the body builder and the idempotency key header. A dry run renders
 *    the request without sending it.
 *  - Idempotency: with a key, the first call claims it; a retry with the
 *    same key gets the first call's result instead of writing again.
 *  - Output: `{ status, affected_rows, id, record }` (record projected
 *    through the columns).
 */

import type { ExecuteReferenceResult } from '@/lib/reference-executor'
import { collectionAt } from '@/lib/response-collections'
import { CustomReferenceError } from './inputs'
import { apiParameterValues, describeShaping, projectRow, readPath } from './shaping'
import type { SqlDialect } from './sql'
import { columnName, type CustomReferenceConfig } from './types'
import { compileWriteStatement } from './write-sql'
import { assertIdentified, buildRequestBody, DEFAULT_IDEMPOTENCY_HEADER, isSuccessStatus, maxAffectedOf, recordId, writeMethodOf } from './write'

/* eslint-disable @typescript-eslint/no-explicit-any -- reference rows are free-form JSON */

export type WriteMode = 'run' | 'dry_run'

export interface IdempotencyStore {
  claim: () => Promise<{ kind: 'claimed' | 'unavailable' } | { kind: 'replay'; result: ExecuteReferenceResult } | { kind: 'busy' }>
  complete: (result: ExecuteReferenceResult) => Promise<void>
  release: () => Promise<void>
}

export interface RunSourceExtra {
  dbWrite?: { maxAffected?: number; dryRun?: boolean }
  previewRequest?: boolean
}

export interface RunWriteOptions {
  ref: any
  config: CustomReferenceConfig
  values: Record<string, unknown>
  sensitive: Set<string>
  secrets: string[]
  dialect: SqlDialect | 'mongodb' | null
  mode: WriteMode
  runSource: (sourceRef: any, values: Record<string, any>, extra?: RunSourceExtra) => Promise<ExecuteReferenceResult>
  /** Keys of the source request config (without the custom reference keys). */
  sourceRequest: Record<string, any>
  idempotency?: (key: string) => IdempotencyStore
  scrubUrl: (url: string | null | undefined) => string | null
}

const isBlank = (v: unknown) => v === undefined || v === null || v === ''

/** Replace credential values inside bound parameters (dry run display). */
function maskParams(params: unknown, secrets: string[]): unknown {
  if (!secrets.length) return params
  const mask = (v: unknown) => (typeof v === 'string' && secrets.some((s) => s.length >= 4 && v.includes(s)) ? '***' : v)
  if (Array.isArray(params)) return params.map(mask)
  if (params && typeof params === 'object') return Object.fromEntries(Object.entries(params).map(([k, v]) => [k, mask(v)]))
  return params
}

function stagesOf(config: CustomReferenceConfig) {
  return describeShaping(config)
}

/** The written values as a record (dialects without RETURNING), restricted to the projection. */
function writtenRecord(config: CustomReferenceConfig, values: Record<string, unknown>): Record<string, unknown> | null {
  const cols = [...(config.write?.key ?? []), ...(config.write?.set ?? [])]
  if (!cols.length || config.kind === 'delete') return null
  const row: Record<string, unknown> = {}
  for (const c of cols) {
    const token = /^\s*\{\{\s*input\.([A-Za-z_][A-Za-z0-9_]{0,63})\s*\}\}\s*$/.exec(c.value)
    row[c.column] = token ? values[token[1]] ?? null : c.value
  }
  if (!config.columns.length) return row
  const out: Record<string, unknown> = {}
  for (const column of config.columns) if (column.path in row) out[columnName(column)] = row[column.path]
  return out
}

async function runTableWrite(opts: RunWriteOptions): Promise<ExecuteReferenceResult> {
  const { config, values, dialect, mode, ref } = opts
  if (!dialect || dialect === 'mongodb') throw new CustomReferenceError('Table writes need a SQL database integration (PostgreSQL, SQL Server, MySQL, Oracle or Snowflake)')
  const compiled = compileWriteStatement(config, values, dialect)
  const capped = config.kind === 'update' || config.kind === 'delete' || config.kind === 'upsert'
  const maxAffected = capped ? maxAffectedOf(config) : undefined
  const sqlRef = {
    ...ref,
    inputs: compiled.inputs,
    request_config: { method: 'POST', path_template: '/_internal/db/write', body_template: JSON.stringify({ sql: compiled.sql }) },
  }
  const stages = stagesOf(config)
  let result: ExecuteReferenceResult
  try {
    result = await opts.runSource(sqlRef, compiled.values, { dbWrite: { ...(maxAffected !== undefined ? { maxAffected } : {}), dryRun: mode === 'dry_run' } })
  } catch (error: any) {
    if (error?.name === 'AffectedRowsLimitError') {
      return {
        status: 409,
        data: { status: 409, affected_rows: Number(error.affectedRows ?? 0), id: null, record: null, max_affected_rows: Number(error.maxAffected ?? maxAffected), rolled_back: true },
        error_message: String(error.message),
        shaping: { stages, stage: 'write' },
      }
    }
    throw error
  }
  const d: any = result.data ?? {}
  let affected = Number(d.affected_rows ?? 0)
  // MySQL counts an upsert that updated as 2 affected rows.
  if (dialect === 'mysql' && config.kind === 'upsert' && affected === 2) affected = 1
  const rows: any[] = Array.isArray(d.rows) ? d.rows : []
  const first = rows[0]
  const record = compiled.returnsRows && first && typeof first === 'object'
    ? (config.kind === 'execute' && config.columns.length ? projectRow(first, config.columns) : { ...first })
    : config.kind === 'execute' ? null : writtenRecord(config, values)
  const data: Record<string, unknown> = {
    status: 200,
    affected_rows: affected,
    id: recordId(config, record, values),
    record,
    ...(config.kind === 'execute' ? { rows: config.columns.length ? rows.map((r) => projectRow(r, config.columns)) : rows } : {}),
  }
  const log = result.log
  if (mode === 'dry_run') {
    return {
      status: 200,
      data: {
        ...data,
        dry_run: true,
        rolled_back: true,
        sql: d.statement?.sql ?? compiled.sql,
        params: maskParams(d.statement?.params ?? [], opts.secrets),
        ...(maxAffected !== undefined ? { max_affected_rows: maxAffected, would_exceed: affected > maxAffected } : {}),
      },
      log,
      shaping: { stages, stage: 'dry_run' },
    }
  }
  if ((config.kind === 'update' || config.kind === 'delete') && affected === 0 && config.write?.not_found !== 'noop') {
    return { status: 404, data: { ...data, status: 404 }, error_message: 'No matching record — nothing was changed', log, shaping: { stages, stage: 'write' } }
  }
  return { status: 200, data, log, shaping: { stages, stage: 'write' } }
}

/** The record of a REST write response: at the rows path (first item of a list), projected. */
function responseRecord(config: CustomReferenceConfig, body: unknown): Record<string, unknown> | null {
  let node: unknown = body
  const path = config.rows_path ?? ''
  if (path) {
    const list = collectionAt(body, path)
    node = list.length ? list[0] : readPath(body, path)
  } else if (Array.isArray(body)) node = body[0]
  if (!node || typeof node !== 'object' || Array.isArray(node)) return null
  return projectRow(node, config.columns)
}

/** Drop header keys equal (case-insensitively) to `name`. */
function withoutHeader(headers: Record<string, any>, name: string) {
  const lower = name.toLowerCase()
  return Object.fromEntries(Object.entries(headers ?? {}).filter(([k]) => k.toLowerCase() !== lower))
}

async function runRestWrite(opts: RunWriteOptions): Promise<ExecuteReferenceResult> {
  const { config, values, mode, ref, sourceRequest } = opts
  if (config.source.type !== 'operation') throw new CustomReferenceError('Not an operation source')
  const apiValues: Record<string, any> = apiParameterValues(config, values)
  assertIdentified(config, apiValues)
  const inputs: any[] = [...config.source.inputs]
  const request: Record<string, any> = { ...sourceRequest, method: writeMethodOf(config, sourceRequest.method) }
  const body = buildRequestBody(config, values, opts.sensitive)
  if (config.write?.body?.mode === 'none') request.body_template = ''
  if (body !== undefined) {
    request.body_template = '{{__cr_body}}'
    request.headers = { ...withoutHeader(request.headers ?? {}, 'content-type'), 'Content-Type': 'application/json' }
    inputs.push({ name: '__cr_body', type: 'object', location: 'body' })
    apiValues.__cr_body = body
  }
  const idem = config.write?.idempotency
  const key = idem ? values[idem.input] : undefined
  if (idem && !isBlank(key)) {
    const header = idem.header ?? DEFAULT_IDEMPOTENCY_HEADER
    request.headers = { ...withoutHeader(request.headers ?? {}, header), [header]: '{{__cr_idem}}' }
    inputs.push({ name: '__cr_idem', type: 'string', location: 'header' })
    apiValues.__cr_idem = String(key)
  }
  const stages = stagesOf(config)
  const result = await opts.runSource({ ...ref, inputs, request_config: request }, apiValues, mode === 'dry_run' ? { previewRequest: true } : undefined)
  const log = result.log ? { ...result.log, url: opts.scrubUrl(result.log.url) } : undefined
  if (mode === 'dry_run') {
    return { status: 200, data: { dry_run: true, sent: false, request: result.data?.request ?? null }, log, shaping: { stages, stage: 'dry_run' } }
  }
  const status = result.status ?? 200
  if (!isSuccessStatus(status, config.write?.success_statuses)) {
    if (status === 404 && (config.kind === 'update' || config.kind === 'delete') && config.write?.not_found === 'noop') {
      return { status: 200, data: { status: 404, affected_rows: 0, id: null, record: null }, log, shaping: { stages, stage: 'write' } }
    }
    return {
      status: status >= 400 ? status : 502,
      data: result.data,
      error_message: result.error_message ?? `HTTP ${status} is not a success status for this reference`,
      log,
      shaping: { stages, stage: 'write' },
    }
  }
  const record = responseRecord(config, result.data)
  return {
    status,
    data: { status, affected_rows: 1, id: recordId(config, record, values), record },
    ...(result.headers ? { headers: result.headers } : {}),
    log,
    shaping: { stages, stage: 'write' },
  }
}

/** Run a write-kind custom reference (idempotency, then the table or REST write). */
export async function runCustomWrite(opts: RunWriteOptions): Promise<ExecuteReferenceResult> {
  const { config, values, mode } = opts
  const idem = config.write?.idempotency
  const key = idem ? values[idem.input] : undefined
  const store = mode === 'run' && idem && !isBlank(key) && opts.idempotency ? opts.idempotency(String(key)) : null
  let claimed = false
  if (store) {
    const claim = await store.claim()
    if (claim.kind === 'replay') return { ...claim.result, shaping: { ...(claim.result.shaping ?? {}), idempotent_replay: true } }
    if (claim.kind === 'busy') return { status: 409, data: null, error_message: 'A call with this idempotency key is still running — try again shortly' }
    claimed = claim.kind === 'claimed'
  }
  try {
    const result = config.source.type === 'table' ? await runTableWrite(opts) : await runRestWrite(opts)
    if (claimed) {
      if ((result.status ?? 200) < 400) await store!.complete(result)
      else await store!.release()
    }
    return result
  } catch (error) {
    if (claimed) await store!.release().catch(() => {})
    throw error
  }
}
