import os from 'node:os'
import pg from 'pg'
import { pgConnectionConfig } from '@/lib/providers/db/pg-auth'
import { resolveInstanceConfig, type InstanceConfig } from '@/lib/config'
import { InstanceSettingKeySchema, PROVIDER_AREAS, PROVIDER_ENV, providerIdSchema, type ProviderArea } from '@/lib/config/schema'
import { decryptSecret, encryptSecret, isEncrypted } from '@/lib/secret-crypto'
import { isBootstrapSetting, isCredentialKey } from '@/lib/config/instance-settings'
import { isSecretRef } from '@/lib/config/secret-refs'
import { validateHousekeepingSetting } from '@/lib/config/housekeeping'

/**
 * The app database as the admin CLI sees it: a direct `pg` connection
 * (DATABASE_URL / --db-url), instance_settings read and written over it, and
 * the config the app would resolve from those rows plus this environment.
 * The CLI never goes through the app's cached service client, so every
 * command can be pointed at any database (a scratch copy, a new target).
 */

export interface SqlClient {
  query<R extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: R[]; rowCount?: number | null }>
}

/** An instance_settings row exactly as stored (secret values stay ciphertext). */
export interface SettingRow {
  key: string
  value: unknown
  secret: boolean
}

export async function connect(url: string, application = 'usertasks-admin'): Promise<pg.Client> {
  const client = new pg.Client(pgConnectionConfig(url, { application_name: application, connectionTimeoutMillis: 15_000 }))
  client.on('error', () => undefined)
  await client.connect()
  return client
}

export async function tableExists(db: SqlClient, name: string): Promise<boolean> {
  const { rows } = await db.query<{ ok: boolean }>('SELECT to_regclass($1) IS NOT NULL AS ok', [name])
  return rows[0]?.ok === true
}

export async function readSettingRows(db: SqlClient): Promise<SettingRow[]> {
  if (!(await tableExists(db, 'public.instance_settings'))) return []
  const { rows } = await db.query<{ key: string; value: unknown; secret: boolean }>('SELECT key, value, secret FROM public.instance_settings ORDER BY key')
  return rows.map((r) => ({ key: r.key, value: r.value, secret: r.secret }))
}

/** Decoded settings (secrets decrypted; undecryptable rows skipped with a warning). */
export function decodeSettings(rows: SettingRow[], warn: (line: string) => void = () => undefined): Map<string, unknown> {
  const map = new Map<string, unknown>()
  for (const row of rows) {
    if (!row.secret) { map.set(row.key, row.value); continue }
    try {
      if (typeof row.value !== 'string' || !isEncrypted(row.value)) throw new Error('not encrypted')
      map.set(row.key, JSON.parse(decryptSecret(row.value)))
    } catch (error) {
      warn(`instance setting ${row.key} ignored: ${(error as Error).message}`)
    }
  }
  return map
}

export async function loadInstanceConfig(db: SqlClient, warn?: (line: string) => void): Promise<{ config: InstanceConfig; rows: SettingRow[] }> {
  const rows = await readSettingRows(db)
  return { config: resolveInstanceConfig(decodeSettings(rows, warn)), rows }
}

export function validateSetting(key: string, value: unknown): void {
  if (!InstanceSettingKeySchema.safeParse(key).success) throw new Error(`Unknown instance setting key "${key}"`)
  if (key.startsWith('providers.')) {
    const area = key.slice('providers.'.length) as ProviderArea
    if (!(PROVIDER_AREAS as readonly string[]).includes(area) || !providerIdSchema(area).safeParse(value).success) {
      throw new Error(`instance setting ${key}: unknown provider ${JSON.stringify(value)}`)
    }
  }
  validateHousekeepingSetting(key, value)
}

/** Stored form of a setting (secrets encrypted; refused without ENCRYPTION_KEY). */
export function encodeSetting(key: string, value: unknown, secret: boolean): SettingRow {
  validateSetting(key, value)
  if (!secret && isCredentialKey(key) && !isSecretRef(value)) {
    throw new Error(`${key} is a credential: pass it with --secret (stored encrypted) or as a secret:// reference`)
  }
  if (!secret) return { key, value, secret: false }
  const ciphertext = encryptSecret(JSON.stringify(value), { bootstrap: isBootstrapSetting(key) })
  if (!isEncrypted(ciphertext)) throw new Error(`instance setting ${key}: ENCRYPTION_KEY must be set to store secrets`)
  return { key, value: ciphertext, secret: true }
}

export async function upsertSettingRow(db: SqlClient, row: SettingRow, updatedBy: string | null = null): Promise<void> {
  await db.query(
    `INSERT INTO public.instance_settings (key, value, secret, updated_at, updated_by)
     VALUES ($1, $2::jsonb, $3, now(), $4)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, secret = EXCLUDED.secret, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [row.key, JSON.stringify(row.value), row.secret, updatedBy],
  )
}

/**
 * Tell running app processes that instance settings changed: bump the
 * shared `config` generation in each shared cache store the given configs
 * use (before and after a switch may differ). With the memory store there
 * is nothing to tell; apps pick the change up within the settings TTL (30 s).
 * Never throws (a warning is returned instead).
 */
export async function notifyConfigChanged(db: SqlClient, configs: InstanceConfig[]): Promise<string | null> {
  const { resolveProviderSecretRefs } = await import('@/lib/config')
  const { resolveCacheStore } = await import('@/lib/providers/cache')
  const { pgCacheSql } = await import('@/lib/providers/cache/postgres')
  const { publishInvalidation } = await import('@/lib/providers/cache/invalidation')
  const seen = new Set<string>()
  try {
    for (const config of configs) {
      if (config.providers.cache.id === 'memory') continue
      const cache = await resolveProviderSecretRefs(config, 'cache')
      const signature = JSON.stringify([cache.id, cache.options])
      if (seen.has(signature)) continue
      seen.add(signature)
      const store = resolveCacheStore(cache.id, cache.options, { sql: pgCacheSql(db) })
      try {
        await publishInvalidation('config', store)
      } finally {
        await store.close?.().catch(() => undefined)
      }
    }
    return null
  } catch (error) {
    return `running app instances could not be notified of the change (they pick it up within 30 s): ${(error as Error).message}`
  }
}

export async function deleteSetting(db: SqlClient, key: string): Promise<void> {
  await db.query('DELETE FROM public.instance_settings WHERE key = $1', [key])
}

/**
 * Put the given keys back to how `before` had them: rows present before are
 * restored verbatim (ciphertext included), the rest are deleted.
 */
export async function restoreSettings(db: SqlClient, before: SettingRow[], keys: Iterable<string>): Promise<string[]> {
  const byKey = new Map(before.map((row) => [row.key, row]))
  const touched: string[] = []
  for (const key of keys) {
    const row = byKey.get(key)
    if (row) await upsertSettingRow(db, row)
    else await deleteSetting(db, key)
    touched.push(key)
  }
  return touched
}

/** Keys whose stored row differs between two snapshots. */
export function changedSettingKeys(before: SettingRow[], after: SettingRow[]): string[] {
  const a = new Map(before.map((r) => [r.key, JSON.stringify([r.value, r.secret])]))
  const b = new Map(after.map((r) => [r.key, JSON.stringify([r.value, r.secret])]))
  return [...new Set([...a.keys(), ...b.keys()])].filter((key) => a.get(key) !== b.get(key)).sort()
}

/** The <AREA>_PROVIDER variables as set in this environment (for the config snapshot). */
export function envProviderVars(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return Object.fromEntries(Object.values(PROVIDER_ENV).filter((name) => env[name]).map((name) => [name, String(env[name])]))
}

/** A connection string with its password masked. */
export function maskUrl(url: string): string {
  try {
    const u = new URL(url)
    if (u.password) u.password = '****'
    return u.toString()
  } catch {
    return url.replace(/:[^:@/]+@/, ':****@')
  }
}

export function defaultActor(): string {
  try {
    return `${os.userInfo().username}@${os.hostname()}`
  } catch {
    return 'usertasks-admin'
  }
}
