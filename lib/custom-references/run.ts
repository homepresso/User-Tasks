/**
 * Server runtime of a custom reference (called by lib/reference-executor for
 * every caller: workflows, forms, agents, MCP, the REST API and the CLI).
 *
 *   1. Validate inputs against their declared types; unknown inputs are
 *      dropped; Fixed inputs take their constant / integration setting and
 *      never the caller's value.
 *   2. Source call through the normal executor path (same base URL, egress
 *      guard, credentials, retries and size caps) — an operation with the
 *      API-side filter/sort/paging parameters, or ONE parameterised SQL
 *      query for a table/view source.
 *   3. Shape: extract collection → filter → distinct → sort → project →
 *      limit / page (lib/custom-references/shaping), bounded in rows and time.
 *
 * Write kinds (Create, Update, Upsert, Delete, Execute) run in
 * lib/custom-references/run-write: one transactional statement (capped,
 * dry-runnable) or the REST request with its built body and idempotency key.
 * Callers that only read (form lookups, Data table sources, reports) pass
 * `readOnly` and a write reference is refused.
 */

import type { ExecuteReferenceResult } from '@/lib/reference-executor'
import { CustomReferenceError, resolveCustomInputs } from './inputs'
import { normalizeCustomConfig } from './normalize'
import { runCustomWrite, type IdempotencyStore, type RunSourceExtra, type WriteMode } from './run-write'
import { isWriteKind } from './types'
import { apiParameterValues, describeShaping, planShaping, shapeResult } from './shaping'
import { compileTableQuery, SQL_DIALECTS, type SqlDialect } from './sql'

/* eslint-disable @typescript-eslint/no-explicit-any -- reference rows are free-form JSON */

/** Keys of a custom reference's request_config that are not part of the source request. */
const NON_SOURCE_KEYS = new Set(['origin', 'custom', 'response_schema'])

/** The source operation's request config (what the executor sends). */
export function sourceRequestConfig(requestConfig: Record<string, any> | null | undefined): Record<string, any> {
  const out: Record<string, any> = {}
  for (const [key, value] of Object.entries(requestConfig ?? {})) if (!NON_SOURCE_KEYS.has(key)) out[key] = value
  return out
}

export interface RunCustomReferenceOptions {
  ref: any
  integrationConfig: any
  inputValues: Record<string, any>
  /** The integration's settings and credentials (loaded only when a Fixed input uses one). */
  loadSettings: () => Promise<Record<string, any>>
  /** Run a request through the executor (source operation or SQL). */
  runSource: (sourceRef: any, values: Record<string, any>, extra?: RunSourceExtra) => Promise<ExecuteReferenceResult>
  /** Return the source response unshaped (builder "Load sample" on a draft). */
  sourceOnly?: boolean
  /** Write kinds: run for real (default) or dry run (DB: rolled back; REST: request rendered, not sent). */
  writeMode?: WriteMode
  /** The caller only reads: a write reference is refused. */
  readOnly?: boolean
  /** Idempotency ledger for Create / Execute with a key (server). */
  idempotency?: (key: string) => IdempotencyStore
}

function dialectOf(integrationConfig: any): SqlDialect | 'mongodb' | null {
  const db = integrationConfig?.db_config ?? {}
  const headers = integrationConfig?.headers ?? {}
  const urlType = String(integrationConfig?.base_url ?? '').match(/^([a-z+]+):\/\//i)?.[1]?.replace('+srv', '').toLowerCase()
  const t = String(db.db_type ?? headers.db_type ?? (urlType === 'postgresql' ? 'postgres' : urlType) ?? '').toLowerCase()
  if (t === 'postgresql') return 'postgres'
  if (t === 'mongodb') return 'mongodb'
  return (SQL_DIALECTS as readonly string[]).includes(t) ? (t as SqlDialect) : null
}

/** Replace credential values that might appear in a logged URL. */
function scrubSecrets(text: string | null | undefined, secrets: string[]): string | null {
  if (!text) return text ?? null
  let out = text
  for (const secret of secrets) {
    if (secret.length < 4) continue
    out = out.split(secret).join('***').split(encodeURIComponent(secret)).join('***')
  }
  return out
}

export async function runCustomReference(opts: RunCustomReferenceOptions): Promise<ExecuteReferenceResult> {
  const { ref, integrationConfig } = opts
  let config
  try {
    // Runtime is lenient about an empty projection (whole rows are returned).
    config = normalizeCustomConfig(ref.request_config?.custom, { allowNoColumns: true })
  } catch (error: any) {
    throw new Error(`Custom reference "${ref.name ?? ''}" is not valid: ${error?.message ?? error}`)
  }
  const writes = isWriteKind(config.kind)
  if (writes && opts.readOnly) {
    throw new CustomReferenceError(`"${ref.name ?? 'This reference'}" writes data — it can run from workflows, form rule actions and buttons, table changes, agents and the API, not as a data source`, 403)
  }
  const needsSettings = config.inputs.some((input) => input.mode === 'fixed' && input.fixed_setting)
  const settings = needsSettings ? await opts.loadSettings() : {}
  const { values, sensitive } = resolveCustomInputs(config, opts.inputValues ?? {}, settings)
  const secrets = Array.from(sensitive, (name) => String(values[name] ?? '')).filter(Boolean)
  if (writes) {
    return runCustomWrite({
      ref,
      config,
      values,
      sensitive,
      secrets,
      dialect: config.source.type === 'table' ? dialectOf(integrationConfig) : null,
      mode: opts.writeMode === 'dry_run' ? 'dry_run' : 'run',
      runSource: opts.runSource,
      sourceRequest: sourceRequestConfig(ref.request_config),
      idempotency: opts.idempotency,
      scrubUrl: (url) => scrubSecrets(url, secrets),
    })
  }
  const plan = planShaping(config)
  const stages = describeShaping(config)

  let result: ExecuteReferenceResult
  let total: number | undefined
  if (config.source.type === 'table') {
    const dialect = dialectOf(integrationConfig)
    if (!dialect || dialect === 'mongodb') throw new CustomReferenceError('Table sources need a SQL database integration (PostgreSQL, SQL Server, MySQL, Oracle or Snowflake)')
    const compiled = compileTableQuery(config, values, dialect)
    const sqlRef = (sql: string) => ({
      ...ref,
      inputs: compiled.inputs,
      request_config: { method: 'POST', path_template: '/_internal/db/query', body_template: JSON.stringify({ sql }) },
    })
    result = await opts.runSource(sqlRef(compiled.sql), compiled.values)
    if (compiled.countSql && (result.status ?? 200) < 400) {
      const counted = await opts.runSource(sqlRef(compiled.countSql), compiled.values)
      const row = Array.isArray(counted.data) ? counted.data[0] : counted.data
      const n = Number(row?.total ?? row?.TOTAL)
      if (Number.isFinite(n)) total = n
    }
  } else {
    const sourceRef = { ...ref, inputs: config.source.inputs, request_config: sourceRequestConfig(ref.request_config) }
    result = await opts.runSource(sourceRef, apiParameterValues(config, values, plan))
  }

  const log = result.log ? { ...result.log, url: scrubSecrets(result.log.url, secrets) } : undefined
  // Builder "Load sample" (drafts only): the unshaped source response.
  if (opts.sourceOnly) return { ...result, log, shaping: { stages, stage: 'source' } }
  if ((result.status ?? 200) >= 400) {
    return { ...result, log, shaping: { stages, stage: 'source' } }
  }

  const shaped = shapeResult(result.data, config, values, { plan })
  let data = shaped.data
  if (total !== undefined && data && typeof data === 'object' && !Array.isArray(data) && 'rows' in data) data = { ...(data as object), total }
  const shaping = { stages, stats: { ...shaped.stats, ...(total !== undefined ? { matched: total } : {}) } }
  if (shaped.notFound) {
    return { status: 404, data: null, error_message: 'No matching record', log, shaping }
  }
  return { status: result.status ?? 200, data, ...(result.headers ? { headers: result.headers } : {}), log, shaping }
}
