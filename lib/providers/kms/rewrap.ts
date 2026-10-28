import os from 'node:os'
import { isBootstrapSetting } from '@/lib/config/instance-settings'
import { ciphertextKeyId, decryptSecret, encryptSecret, hasDataKey, hasEncryptionKey, isEncrypted } from '@/lib/secret-crypto'
import { describeError, KmsError } from './types'

/**
 * `usertasks-admin kms rewrap`: re-encrypt every secret stored at rest under
 * one target data key, resumably.
 *
 * Each secret column is scanned in primary-key order in batches. A batch is
 * one transaction: its rows are locked (FOR UPDATE, so the app can't write
 * them meanwhile), every ciphertext not already under the target key is
 * decrypted and re-encrypted, changed rows are written, and the column's
 * cursor in app_kms.rewrap_runs is advanced — all committed together. A run
 * that stops for any reason (KMS down, an undecryptable value, Ctrl+C, a
 * crash) has therefore re-encrypted exactly the batches before its cursor;
 * running the command again resumes from there. Values already under the
 * target key are left alone, so re-running is always safe.
 *
 * Only one rewrap runs at a time (advisory lock). Plaintext exists only in
 * this process's memory for the duration of a row; errors name the table,
 * column and row key, never a value.
 */

export interface SecretColumn {
  table: string
  /** Primary key column and its type (for the cursor comparison). */
  key: string
  keyType: 'uuid' | 'text'
  column: string
  /** jsonb: any string at any depth may be ciphertext; text: the value itself. */
  kind: 'jsonb' | 'text'
  /** Extra row filter. */
  where?: string
  /** Rows to leave alone (by key). */
  skip?: (key: string) => boolean
}

/**
 * Every column that holds lib/secret-crypto ciphertext. instance_settings
 * rows that configure the KMS / the secret store stay on the bootstrap key
 * (enc:v1): they are needed before data keys can be unwrapped.
 */
export const SECRET_COLUMNS: SecretColumn[] = [
  { table: 'public.instance_settings', key: 'key', keyType: 'text', column: 'value', kind: 'jsonb', where: 'secret', skip: isBootstrapSetting },
  { table: 'public.integrations', key: 'id', keyType: 'uuid', column: 'config', kind: 'jsonb' },
  { table: 'public.tenant_connectors', key: 'id', keyType: 'uuid', column: 'config', kind: 'jsonb' },
  { table: 'public.tenant_connectors', key: 'id', keyType: 'uuid', column: 'credentials', kind: 'jsonb' },
  { table: 'public.log_destinations', key: 'id', keyType: 'uuid', column: 'credentials', kind: 'jsonb' },
  { table: 'public.oauth_connect_states', key: 'id', keyType: 'uuid', column: 'payload', kind: 'jsonb' },
  { table: 'public.package_signing_keys', key: 'id', keyType: 'uuid', column: 'private_key_encrypted', kind: 'text' },
]

export const columnName = (c: SecretColumn) => `${c.table.replace(/^public\./, '')}.${c.column}`

export interface SqlClient {
  query<R extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: R[]; rowCount?: number | null }>
}

export interface ColumnProgress {
  cursor: string | null
  scanned: number
  rewrapped: number
  done: boolean
}

export interface RewrapRun {
  id: string
  target_key_id: number
  status: 'running' | 'completed' | 'failed'
  progress: Record<string, ColumnProgress>
  error: string | null
  started_at: string
  finished_at: string | null
}

const LOCK_KEY = 'usertasks:kms-rewrap'
const MAX_DEPTH = 40

/** Walk a JSON value, mapping every string; reports whether anything changed. */
function mapStrings(value: unknown, fn: (s: string) => string, depth = 0): { value: unknown; changed: boolean } {
  if (depth > MAX_DEPTH) return { value, changed: false }
  if (typeof value === 'string') {
    const next = fn(value)
    return { value: next, changed: next !== value }
  }
  if (Array.isArray(value)) {
    let changed = false
    const out = value.map((item) => {
      const r = mapStrings(item, fn, depth + 1)
      changed ||= r.changed
      return r.value
    })
    return { value: out, changed }
  }
  if (value && typeof value === 'object') {
    let changed = false
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      const r = mapStrings(v, fn, depth + 1)
      changed ||= r.changed
      out[k] = r.value
    }
    return { value: out, changed }
  }
  return { value, changed: false }
}

/** One ciphertext re-encrypted under `target` (unchanged when it already is). */
export function rewrapCiphertext(value: string, target: number): string {
  if (!isEncrypted(value)) return value
  const kind = ciphertextKeyId(value)
  if (kind?.version === 2 && kind.keyId === target) return value
  if (kind?.version === 1 && !hasEncryptionKey()) throw new KmsError('an enc:v1 value needs ENCRYPTION_KEY to be re-encrypted')
  return encryptSecret(decryptSecret(value), { keyId: target })
}

/** Counts of ciphertext per key in one value (status). */
export function countCiphertext(value: unknown, into: Map<string, number>): void {
  mapStrings(value, (s) => {
    const kind = isEncrypted(s) ? ciphertextKeyId(s) : null
    if (kind) {
      const label = kind.version === 1 ? 'enc:v1' : `enc:v2#${kind.keyId}`
      into.set(label, (into.get(label) ?? 0) + 1)
    }
    return s
  })
}

async function tableExists(db: SqlClient, table: string): Promise<boolean> {
  const { rows } = await db.query<{ ok: boolean }>('SELECT to_regclass($1) IS NOT NULL AS ok', [table])
  return rows[0]?.ok === true
}

/** Ciphertext per key across every secret column (`kms status`, prune). */
export async function ciphertextInventory(db: SqlClient, columns: SecretColumn[] = SECRET_COLUMNS, batch = 500): Promise<Record<string, Record<string, number>>> {
  const out: Record<string, Record<string, number>> = {}
  for (const col of columns) {
    if (!(await tableExists(db, col.table))) continue
    const counts = new Map<string, number>()
    let cursor: string | null = null
    for (;;) {
      const { rows }: { rows: Array<{ k: string; v: unknown }> } = await db.query<{ k: string; v: unknown }>(
        `SELECT ${col.key}::text AS k, ${col.column} AS v FROM ${col.table}
          WHERE ${col.column}::text LIKE '%enc:v%' ${col.where ? `AND ${col.where}` : ''} AND ($1::text IS NULL OR ${col.key} > $1::${col.keyType})
          ORDER BY ${col.key} LIMIT ${batch}`,
        [cursor],
      )
      for (const row of rows) countCiphertext(row.v, counts)
      if (rows.length < batch) break
      cursor = rows[rows.length - 1].k
    }
    out[columnName(col)] = Object.fromEntries(counts)
  }
  return out
}

export interface RewrapOptions {
  target: number
  batchSize?: number
  /** Start over (ignore an unfinished run's cursors). */
  restart?: boolean
  dryRun?: boolean
  actor?: string
  columns?: SecretColumn[]
  log?: (line: string) => void
  /** Progress table (tests point it at a scratch copy). */
  runsTable?: string
  /** Test hook: runs inside each batch's transaction, before its commit. */
  onBatch?: (column: string, batch: number) => void | Promise<void>
}

export interface RewrapResult {
  runId: string | null
  status: 'completed' | 'failed' | 'dry_run'
  resumed: boolean
  progress: Record<string, ColumnProgress>
  error: string | null
}

async function latestUnfinished(db: SqlClient, target: number, runs: string): Promise<RewrapRun | null> {
  const { rows } = await db.query<RewrapRun & Record<string, unknown>>(
    `SELECT id, target_key_id, status, progress, error, started_at, finished_at FROM ${runs}
      WHERE status <> 'completed' ORDER BY started_at DESC LIMIT 1`,
  )
  const run = rows[0]
  return run && Number(run.target_key_id) === target ? run : null
}

export async function listRewrapRuns(db: SqlClient, limit = 5): Promise<RewrapRun[]> {
  const { rows } = await db.query<RewrapRun & Record<string, unknown>>(
    `SELECT id, target_key_id, status, progress, error, started_at, finished_at FROM app_kms.rewrap_runs ORDER BY started_at DESC LIMIT $1`,
    [limit],
  )
  return rows
}

export async function rewrapSecrets(db: SqlClient, options: RewrapOptions): Promise<RewrapResult> {
  const { target } = options
  const log = options.log ?? (() => undefined)
  const batchSize = Math.max(1, Math.min(10_000, options.batchSize ?? 200))
  const columns = options.columns ?? SECRET_COLUMNS
  const runs = options.runsTable ?? 'app_kms.rewrap_runs'
  if (!/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(runs)) throw new KmsError('invalid runs table')
  if (!hasDataKey(target)) throw new KmsError(`data key ${target} is not loaded`)

  const lockKey = `${LOCK_KEY}:${runs}`
  const { rows: lock } = await db.query<{ ok: boolean }>('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [lockKey])
  if (!lock[0]?.ok) throw new KmsError('another kms rewrap is running against this database')
  try {
    const previous = options.restart || options.dryRun ? null : await latestUnfinished(db, target, runs)
    const progress: Record<string, ColumnProgress> = {}
    for (const col of columns) {
      progress[columnName(col)] = previous?.progress?.[columnName(col)] ?? { cursor: null, scanned: 0, rewrapped: 0, done: false }
    }
    let runId: string | null = previous?.id ?? null
    if (!options.dryRun) {
      if (runId) {
        await db.query(`UPDATE ${runs} SET status = 'running', error = NULL, updated_at = now() WHERE id = $1`, [runId])
        log(`Resuming rewrap ${runId} (target data key ${target})`)
      } else {
        const { rows } = await db.query<{ id: string }>(
          `INSERT INTO ${runs} (target_key_id, progress, actor, host) VALUES ($1, $2::jsonb, $3, $4) RETURNING id`,
          [target, JSON.stringify(progress), options.actor ?? null, os.hostname()],
        )
        runId = rows[0].id
        log(`Rewrap ${runId}: re-encrypting every stored secret under data key ${target}`)
      }
    }

    try {
      for (const col of columns) {
        const name = columnName(col)
        const p = progress[name]
        if (p.done) { log(`  ${name}: done earlier (${p.rewrapped} of ${p.scanned} rows re-encrypted)`); continue }
        if (!(await tableExists(db, col.table))) { p.done = true; continue }
        let batchNo = 0
        for (;;) {
          batchNo++
          await db.query('BEGIN')
          try {
            const { rows } = await db.query<{ k: string; v: unknown }>(
              `SELECT ${col.key}::text AS k, ${col.column} AS v FROM ${col.table}
                WHERE ${col.column}::text LIKE '%enc:v%' ${col.where ? `AND ${col.where}` : ''} AND ($1::text IS NULL OR ${col.key} > $1::${col.keyType})
                ORDER BY ${col.key} LIMIT ${batchSize} FOR UPDATE`,
              [p.cursor],
            )
            let changed = 0
            for (const row of rows) {
              if (col.skip?.(row.k)) continue
              let next: { value: unknown; changed: boolean }
              try {
                next = col.kind === 'text'
                  ? (() => { const v = rewrapCiphertext(String(row.v), target); return { value: v, changed: v !== row.v } })()
                  : mapStrings(row.v, (s) => rewrapCiphertext(s, target))
              } catch (error) {
                throw new KmsError(`${name} row ${row.k}: ${describeError(error)}`)
              }
              if (!next.changed) continue
              changed++
              if (!options.dryRun) {
                await db.query(
                  `UPDATE ${col.table} SET ${col.column} = $2${col.kind === 'jsonb' ? '::jsonb' : ''} WHERE ${col.key} = $1::${col.keyType}`,
                  [row.k, col.kind === 'jsonb' ? JSON.stringify(next.value) : next.value],
                )
              }
            }
            const last = rows.length ? rows[rows.length - 1].k : p.cursor
            const nextProgress: ColumnProgress = { cursor: last, scanned: p.scanned + rows.length, rewrapped: p.rewrapped + changed, done: rows.length < batchSize }
            await options.onBatch?.(name, batchNo)
            if (!options.dryRun) {
              await db.query(`UPDATE ${runs} SET progress = $2::jsonb, updated_at = now() WHERE id = $1`, [runId, JSON.stringify({ ...progress, [name]: nextProgress })])
            }
            await db.query(options.dryRun ? 'ROLLBACK' : 'COMMIT')
            progress[name] = nextProgress
            Object.assign(p, nextProgress)
            if (nextProgress.done) break
          } catch (error) {
            await db.query('ROLLBACK').catch(() => undefined)
            throw error
          }
        }
        log(`  ${name}: ${p.rewrapped} of ${p.scanned} rows ${options.dryRun ? 'would be ' : ''}re-encrypted`)
      }
    } catch (error) {
      const message = describeError(error)
      if (runId && !options.dryRun) {
        await db.query(`UPDATE ${runs} SET status = 'failed', error = $2, updated_at = now() WHERE id = $1`, [runId, message]).catch(() => undefined)
      }
      return { runId, status: 'failed', resumed: Boolean(previous), progress, error: message }
    }

    if (options.dryRun) return { runId: null, status: 'dry_run', resumed: false, progress, error: null }
    await db.query(`UPDATE ${runs} SET status = 'completed', progress = $2::jsonb, updated_at = now(), finished_at = now() WHERE id = $1`, [runId, JSON.stringify(progress)])
    return { runId, status: 'completed', resumed: Boolean(previous), progress, error: null }
  } finally {
    await db.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]).catch(() => undefined)
  }
}
