import crypto from 'node:crypto'
import { installDataKeys } from '@/lib/secret-crypto'
import { createEnvKmsProvider } from './env'
import { dataKeyContext, DEK_BYTES, describeError, KmsError, type KmsProvider } from './types'

/**
 * Data keys (app_kms.data_keys, migration 20261108100000): reading the
 * wrapped rows, unwrapping them with the KMS that wrapped them, verifying
 * the result against the row's check value, and installing the plaintext
 * keys into lib/secret-crypto. Plaintext keys exist only in process memory.
 */

export interface DataKeyRow {
  id: number
  provider: string
  kek_ref: string
  wrapped_key: string
  check_value: string
  created_at: string | Date
  activates_at: string | Date
}

export interface DataKeySource {
  list(): Promise<DataKeyRow[]>
}

interface QueryClient {
  query<R extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: R[] }>
}

/** The app: through the service database client (app_kms_data_keys(), service role only). */
export function serviceDbDataKeys(): DataKeySource {
  return {
    async list() {
      const { getServiceDb } = await import('@/lib/providers/db')
      const { data, error } = await getServiceDb().rpc('app_kms_data_keys')
      if (error) throw new Error(error.message)
      return ((Array.isArray(data) ? data : []) as DataKeyRow[]).map(normalise)
    },
  }
}

/** The admin CLI: a direct connection (the table itself). */
export function sqlDataKeys(db: QueryClient): DataKeySource {
  return {
    async list() {
      const { rows } = await db.query<Record<string, unknown>>(
        `SELECT id, provider, kek_ref, wrapped_key, check_value, created_at, activates_at FROM app_kms.data_keys ORDER BY id`,
      )
      return rows.map((r) => normalise(r as unknown as DataKeyRow))
    },
  }
}

function normalise(row: DataKeyRow): DataKeyRow {
  return { ...row, id: Number(row.id) }
}

/** Whether an error means the KMS tables / function aren't there yet (migration not applied). */
export function isMissingKmsSchema(error: unknown): boolean {
  const message = describeError(error)
  return /app_kms|data_keys/i.test(message) && /does not exist|could not find|schema cache|not found/i.test(message)
}

/** HMAC of the key with itself: proves an unwrap produced the right bytes (not reversible). */
export function dataKeyCheckValue(dek: Buffer): string {
  return crypto.createHmac('sha256', dek).update('usertasks:dek-check').digest('hex').slice(0, 32)
}

export function newDataKey(): Buffer {
  return crypto.randomBytes(DEK_BYTES)
}

/**
 * The provider for a row: the configured one when it wrapped the row, the
 * env provider for rows wrapped with ENCRYPTION_KEY, else null.
 */
export function resolverFor(configured: KmsProvider): (providerId: string) => KmsProvider | null {
  const env = configured.id === 'env' ? configured : createEnvKmsProvider()
  return (id) => (id === configured.id ? configured : id === 'env' ? env : null)
}

export async function unwrapDataKey(row: DataKeyRow, resolve: (providerId: string) => KmsProvider | null): Promise<Buffer> {
  const provider = resolve(row.provider)
  if (!provider) {
    throw new KmsError(`data key ${row.id} is wrapped by the ${row.provider} KMS provider, which is not configured (KMS_PROVIDER), or run usertasks-admin kms rewrap-keys`)
  }
  const key = await provider.unwrap({ wrapped: row.wrapped_key, kekRef: row.kek_ref }, dataKeyContext(row.id))
  if (key.length !== DEK_BYTES || dataKeyCheckValue(key) !== row.check_value) {
    key.fill(0)
    throw new KmsError(`data key ${row.id} unwrapped to the wrong value (check value mismatch)`)
  }
  return key
}

export interface LoadResult {
  loaded: number[]
  failures: Array<{ id: number; error: string }>
}

/** Unwrap rows (optionally only some ids) and install them into lib/secret-crypto. */
export async function loadDataKeys(
  rows: DataKeyRow[],
  resolve: (providerId: string) => KmsProvider | null,
  options: { only?: (id: number) => boolean } = {},
): Promise<LoadResult> {
  const result: LoadResult = { loaded: [], failures: [] }
  for (const row of rows) {
    if (options.only && !options.only(row.id)) continue
    try {
      const key = await unwrapDataKey(row, resolve)
      installDataKeys([{ id: row.id, key, activatesAt: new Date(row.activates_at).getTime() }])
      key.fill(0)
      result.loaded.push(row.id)
    } catch (error) {
      result.failures.push({ id: row.id, error: describeError(error) })
    }
  }
  return result
}

/** The row that encrypts new values at `now` (highest id already active). */
export function activeRow(rows: DataKeyRow[], now = Date.now()): DataKeyRow | null {
  let best: DataKeyRow | null = null
  for (const row of rows) if (new Date(row.activates_at).getTime() <= now && (!best || row.id > best.id)) best = row
  return best
}
