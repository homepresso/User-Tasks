import { resolveInstanceConfig, resolveProviderSecretRefs, type InstanceConfig } from '@/lib/config'
import type { ProviderId } from '@/lib/config/schema'
import { activeDataKeyId, hasDataKey, installDataKeys } from '@/lib/secret-crypto'
import { kmsProviderFor, resolveKmsProvider } from '@/lib/providers/kms'
import type { KmsProvider } from '@/lib/providers/kms/types'
import { activeRow, dataKeyCheckValue, loadDataKeys, newDataKey, resolverFor, sqlDataKeys, unwrapDataKey, type DataKeyRow } from '@/lib/providers/kms/keyring'
import { kmsSeconds } from '@/lib/providers/kms/options'
import { ciphertextInventory, listRewrapRuns, rewrapSecrets, type RewrapResult } from '@/lib/providers/kms/rewrap'
import { dataKeyContext, describeError, KmsError } from '@/lib/providers/kms/types'
import { decodeSettings, readSettingRows, tableExists, type SqlClient } from './instance-db'

/**
 * `usertasks-admin kms …`: data keys and envelope encryption, over the CLI's
 * direct connection. Nothing here prints key material — data keys are shown
 * by id, provider, KEK and dates only.
 *
 *  status       provider, KEK, data keys, ciphertext per key, recent rewraps
 *  rotate       a new data key wrapped by the configured KMS (used for new
 *               values once active, after kms.activation_seconds)
 *  rewrap       re-encrypt every stored secret under the newest data key
 *               (resumable; see lib/providers/kms/rewrap)
 *  rewrap-keys  re-wrap every data key with the configured KMS / its newest
 *               KEK version (after rotating the KEK, or moving KMS)
 *  prune        delete data keys no stored secret uses any more
 */

export async function hasKmsSchema(db: SqlClient): Promise<boolean> {
  return tableExists(db, 'app_kms.data_keys')
}

/** The kms provider config from the stored settings (kms.* rows are enc:v1, readable before any data key). */
export async function kmsConfig(db: SqlClient): Promise<InstanceConfig> {
  return resolveInstanceConfig(decodeSettings(await readSettingRows(db)))
}

export async function configuredKms(config: InstanceConfig): Promise<KmsProvider> {
  const kms = await resolveProviderSecretRefs(config, 'kms')
  return kmsProviderFor(kms.id, kms.options)
}

/**
 * Load the data keys into this process (before commands that read or write
 * secrets). Returns warnings instead of throwing: commands that need a key
 * that didn't load fail with their own error.
 */
export async function loadCliKeyring(db: SqlClient): Promise<string[]> {
  if (!(await hasKmsSchema(db).catch(() => false))) return []
  try {
    const provider = await configuredKms(await kmsConfig(db))
    const rows = await sqlDataKeys(db).list()
    const result = await loadDataKeys(rows, resolverFor(provider), { only: (id) => !hasDataKey(id) })
    return result.failures.map((f) => `data key ${f.id} not loaded: ${f.error}`)
  } catch (error) {
    return [`data keys not loaded: ${describeError(error)}`]
  }
}

export async function listDataKeys(db: SqlClient): Promise<DataKeyRow[]> {
  return (await hasKmsSchema(db)) ? sqlDataKeys(db).list() : []
}

export interface CreatedKey {
  id: number
  provider: string
  kekRef: string
  activatesAt: Date
}

/** A new data key wrapped by `provider` (round-trip verified), installed in this process too. */
export async function createDataKey(db: SqlClient, provider: KmsProvider, options: { activateInSeconds: number; actor?: string }): Promise<CreatedKey> {
  // Ids are sequential; the table lock makes concurrent rotations take turns.
  await db.query('BEGIN')
  const dek = newDataKey()
  try {
    await db.query('LOCK TABLE app_kms.data_keys IN EXCLUSIVE MODE')
    const { rows } = await db.query<{ id: number }>('SELECT coalesce(max(id), 0) + 1 AS id FROM app_kms.data_keys')
    const id = Number(rows[0].id)
    const wrapped = await provider.wrap(dek, dataKeyContext(id))
    const back = await provider.unwrap(wrapped, dataKeyContext(id))
    const same = back.equals(dek)
    back.fill(0)
    if (!same) throw new KmsError('the KMS returned a different key on unwrap (round trip failed)')
    const activatesAt = new Date(Date.now() + options.activateInSeconds * 1000)
    await db.query(
      `INSERT INTO app_kms.data_keys (id, provider, kek_ref, wrapped_key, check_value, activates_at, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, provider.id, wrapped.kekRef, wrapped.wrapped, dataKeyCheckValue(dek), activatesAt.toISOString(), options.actor ?? null],
    )
    await db.query('COMMIT')
    installDataKeys([{ id, key: dek, activatesAt: activatesAt.getTime() }])
    return { id, provider: provider.id, kekRef: wrapped.kekRef, activatesAt }
  } catch (error) {
    await db.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    dek.fill(0)
  }
}

export interface RewrapKeysResult {
  rewrapped: number[]
  unchanged: number[]
}

/**
 * Re-wrap every data key with `target` (unwrapping each with the provider
 * that wrapped it). Each row is updated on its own and only after the new
 * wrap round-trips, so a failure leaves every row usable; re-running is
 * safe. `force` re-wraps rows already wrapped by the target too (a new KEK
 * version).
 */
export async function rewrapDataKeys(
  db: SqlClient,
  target: KmsProvider,
  resolve: (providerId: string) => KmsProvider | null,
  options: { force?: boolean; dryRun?: boolean; log?: (line: string) => void } = {},
): Promise<RewrapKeysResult> {
  const result: RewrapKeysResult = { rewrapped: [], unchanged: [] }
  for (const row of await sqlDataKeys(db).list()) {
    if (row.provider === target.id && !options.force) { result.unchanged.push(row.id); continue }
    const dek = await unwrapDataKey(row, resolve)
    try {
      if (options.dryRun) { result.rewrapped.push(row.id); continue }
      const wrapped = await target.wrap(dek, dataKeyContext(row.id))
      const back = await target.unwrap(wrapped, dataKeyContext(row.id))
      const same = back.equals(dek)
      back.fill(0)
      if (!same) throw new KmsError(`data key ${row.id}: the ${target.id} KMS returned a different key on unwrap`)
      await db.query(
        `UPDATE app_kms.data_keys SET provider = $2, kek_ref = $3, wrapped_key = $4, rewrapped_at = now() WHERE id = $1`,
        [row.id, target.id, wrapped.kekRef, wrapped.wrapped],
      )
      result.rewrapped.push(row.id)
      options.log?.(`  data key ${row.id}: ${row.provider} → ${target.id}`)
    } finally {
      dek.fill(0)
    }
  }
  return result
}

export interface KmsStatus {
  provider: string
  source: string
  kek: string
  keys: Array<{ id: number; provider: string; kekRef: string; createdAt: string; activatesAt: string; active: boolean; loaded: boolean; values: number }>
  activeKeyId: number | null
  ciphertext: Record<string, Record<string, number>>
  rewraps: Array<{ id: string; target: number; status: string; startedAt: string; finishedAt: string | null; error: string | null }>
}

export async function kmsStatus(db: SqlClient, config: InstanceConfig): Promise<KmsStatus> {
  const provider = await configuredKms(config).catch(() => null)
  const rows = await listDataKeys(db)
  const ciphertext = await ciphertextInventory(db)
  const uses = new Map<string, number>()
  for (const counts of Object.values(ciphertext)) for (const [label, n] of Object.entries(counts)) uses.set(label, (uses.get(label) ?? 0) + n)
  const active = activeRow(rows)
  const rewraps = (await hasKmsSchema(db)) ? await listRewrapRuns(db) : []
  return {
    provider: config.providers.kms.id,
    source: config.providers.kms.source,
    kek: provider?.describe() ?? '(provider not configured)',
    keys: rows.map((r) => ({
      id: r.id, provider: r.provider, kekRef: r.kek_ref, createdAt: new Date(r.created_at).toISOString(), activatesAt: new Date(r.activates_at).toISOString(),
      active: active?.id === r.id, loaded: hasDataKey(r.id), values: uses.get(`enc:v2#${r.id}`) ?? 0,
    })),
    activeKeyId: active?.id ?? null,
    ciphertext,
    rewraps: rewraps.map((r) => ({ id: r.id, target: Number(r.target_key_id), status: r.status, startedAt: new Date(r.started_at).toISOString(), finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null, error: r.error })),
  }
}

/** Data keys no stored secret uses (never the active or the newest one). */
export async function unusedDataKeys(db: SqlClient): Promise<number[]> {
  const rows = await listDataKeys(db)
  if (!rows.length) return []
  const inventory = await ciphertextInventory(db)
  const used = new Set<number>()
  for (const counts of Object.values(inventory)) for (const label of Object.keys(counts)) if (label.startsWith('enc:v2#')) used.add(Number(label.slice(7)))
  const keep = new Set([activeRow(rows)?.id, rows[rows.length - 1].id])
  return rows.map((r) => r.id).filter((id) => !used.has(id) && !keep.has(id))
}

export async function pruneDataKeys(db: SqlClient, ids: number[]): Promise<void> {
  if (ids.length) await db.query('DELETE FROM app_kms.data_keys WHERE id = ANY($1::int[])', [ids])
}

export function activationSeconds(config: InstanceConfig): number {
  return kmsSeconds(config.providers.kms.options, 'activation_seconds', 120)
}

export async function runRewrap(db: SqlClient, options: { batchSize?: number; restart?: boolean; dryRun?: boolean; actor?: string; log?: (line: string) => void }): Promise<RewrapResult> {
  const target = activeDataKeyId()
  if (target === null) throw new KmsError('no active data key (create one with `usertasks-admin kms rotate`, or wait until a new one is active)')
  return rewrapSecrets(db, { target, ...options })
}

/** A provider for a KMS config other than the stored one (switch targets, probes). */
export async function kmsProviderForConfig(config: InstanceConfig): Promise<KmsProvider> {
  const kms = await resolveProviderSecretRefs(config, 'kms')
  return resolveKmsProvider(kms.id as ProviderId<'kms'>, kms.options)
}
