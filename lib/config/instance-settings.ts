import { decryptSecret, encryptSecret, isEncrypted } from '@/lib/secret-crypto'
import { getServiceDb, hasServiceDb, type ServiceDb } from '@/lib/providers/db'
import { INSTANCE_SETTINGS_TTL_MS, readSettingsCache, writeSettingsCache } from './settings-cache'
import { STORAGE_SECRET_OPTIONS } from '@/lib/providers/storage/options'
import { EMAIL_SECRET_OPTIONS } from '@/lib/providers/email/options'
import { AUTH_SECRET_OPTIONS } from '@/lib/providers/auth/options'
import { SECRETS_OPTION_ENV, SECRETS_SECRET_OPTIONS } from '@/lib/providers/secrets/options'
import { CACHE_SECRET_OPTIONS } from '@/lib/providers/cache/options'
import { KMS_SECRET_OPTIONS } from '@/lib/providers/kms/options'
import { isSecretRef } from './secret-refs'
import { validateHousekeepingSetting } from './housekeeping'
import { ConfigError, InstanceSettingKeySchema, PROVIDER_AREAS, providerIdSchema, type ProviderArea } from './schema'

/**
 * `instance_settings` service (migration 20261104000000).
 *
 * Instance-wide, not per workspace, so it only ever runs with the service-role
 * client: the table has no grants for anon/authenticated and there is no
 * member-facing path to it. Writers are operator tools (the admin CLI in a
 * later phase); readers are lib/config's getters.
 *
 * Secrets are encrypted with lib/secret-crypto before they leave the process
 * and stored as the ciphertext string; writing one without ENCRYPTION_KEY is
 * refused rather than stored in clear text.
 *
 * Reads go through a short-TTL in-process cache. With a shared cache store
 * (CACHE_PROVIDER=postgres|redis) a write anywhere — this app, another
 * replica, `usertasks-admin` — also invalidates every other process's copy
 * within cache.invalidation_check_ms (lib/providers/cache/invalidation).
 * When the table can't be read
 * (no service-role key, migration not applied yet, database down) the
 * settings are treated as empty, so config falls back to env and defaults —
 * exactly today's behaviour.
 */

export { INSTANCE_SETTINGS_TTL_MS }
const TABLE = 'instance_settings'
const MASK = '********'

export interface InstanceSettingSummary {
  key: string
  /** Secret values are masked. */
  value: unknown
  secret: boolean
  updatedAt: string | null
  updatedBy: string | null
}

interface Row {
  key: string
  value: unknown
  secret: boolean
  updated_at?: string | null
  updated_by?: string | null
}

let warned = false

export function invalidateInstanceSettingsCache(): void {
  writeSettingsCache(null)
}

function db(): ServiceDb {
  return getServiceDb()
}

function decode(row: Row): unknown {
  if (!row.secret) return row.value
  if (typeof row.value !== 'string' || !isEncrypted(row.value)) {
    throw new ConfigError(`instance setting ${row.key}: secret is not encrypted`)
  }
  return JSON.parse(decryptSecret(row.value))
}

/** All settings, secrets decrypted. Cached for INSTANCE_SETTINGS_TTL_MS. */
export async function loadInstanceSettings(): Promise<Map<string, unknown>> {
  const cached = readSettingsCache()
  if (cached) {
    const { configChangedElsewhere } = await import('@/lib/providers/cache/invalidation')
    if (!(await configChangedElsewhere(cached))) return cached
  }
  const values = new Map<string, unknown>()
  if (hasServiceDb()) {
    try {
      const { data, error } = await db().from(TABLE).select('key, value, secret')
      if (error) throw new Error(error.message)
      for (const row of (data ?? []) as Row[]) {
        try {
          values.set(row.key, decode(row))
        } catch (e) {
          console.warn(`[config] ignoring instance setting ${row.key}: ${(e as Error).message}`)
        }
      }
    } catch (e) {
      if (!warned) {
        warned = true
        console.warn(`[config] instance_settings unavailable, using environment and defaults: ${(e as Error).message}`)
      }
    }
  }
  writeSettingsCache(values)
  return values
}

export async function getInstanceSetting(key: string): Promise<unknown> {
  return (await loadInstanceSettings()).get(key)
}

/** Every stored setting with secrets masked (safe to print in operator tools). */
export async function listInstanceSettings(): Promise<InstanceSettingSummary[]> {
  const { data, error } = await db().from(TABLE).select('key, value, secret, updated_at, updated_by').order('key')
  if (error) throw new Error(error.message)
  return ((data ?? []) as Row[]).map((row) => ({
    key: row.key,
    value: row.secret ? MASK : row.value,
    secret: row.secret,
    updatedAt: row.updated_at ?? null,
    updatedBy: row.updated_by ?? null,
  }))
}

function validate(key: string, value: unknown): void {
  const parsedKey = InstanceSettingKeySchema.safeParse(key)
  if (!parsedKey.success) throw new ConfigError(`Unknown instance setting key "${key}"`)
  if (value === undefined) throw new ConfigError(`instance setting ${key}: value is required`)
  if (key.startsWith('providers.')) {
    const area = key.slice('providers.'.length) as ProviderArea
    if (!(PROVIDER_AREAS as readonly string[]).includes(area) || !providerIdSchema(area).safeParse(value).success) {
      throw new ConfigError(`instance setting ${key}: unknown provider ${JSON.stringify(value)}`)
    }
  }
  try {
    validateHousekeepingSetting(key, value)
  } catch (e) {
    throw new ConfigError((e as Error).message)
  }
}

/** Settings that hold credentials (provider secrets, and the db secret store's values). */
const CREDENTIAL_OPTIONS: Partial<Record<ProviderArea, Set<string>>> = {
  auth: AUTH_SECRET_OPTIONS,
  storage: STORAGE_SECRET_OPTIONS,
  email: EMAIL_SECRET_OPTIONS,
  secrets: SECRETS_SECRET_OPTIONS,
  cache: CACHE_SECRET_OPTIONS,
  kms: KMS_SECRET_OPTIONS,
}

/** Whether a setting holds a credential (must be stored encrypted, or as a secret:// reference). */
export function isCredentialKey(key: string): boolean {
  const dot = key.indexOf('.')
  const area = key.slice(0, dot) as ProviderArea
  const option = key.slice(dot + 1)
  if (area === 'providers' as string) return false
  // secrets.<name> rows that aren't secrets-provider options are values of the db secret store.
  if (area === 'secrets' && !(option in SECRETS_OPTION_ENV)) return true
  return CREDENTIAL_OPTIONS[area]?.has(option) ?? false
}

/**
 * Settings needed before data keys can be unwrapped — the KMS provider's
 * options and the secret store's own (KMS options may reference it) — are
 * encrypted with the bootstrap ENCRYPTION_KEY (enc:v1), never with a data
 * key: the KMS can't protect the credentials needed to reach it.
 */
export function isBootstrapSetting(key: string): boolean {
  if (key.startsWith('kms.') || key === 'providers.kms') return true
  return key.startsWith('secrets.') && key.slice('secrets.'.length) in SECRETS_OPTION_ENV
}

/** Insert or replace a setting. Secrets are encrypted; without ENCRYPTION_KEY they are refused. */
export async function setInstanceSetting(
  key: string,
  value: unknown,
  options: { secret?: boolean; updatedBy?: string | null } = {},
): Promise<void> {
  validate(key, value)
  const secret = options.secret === true
  if (!secret && isCredentialKey(key) && !isSecretRef(value)) {
    throw new ConfigError(`instance setting ${key} is a credential: store it as a secret (encrypted) or as a secret:// reference`)
  }
  let stored: unknown = value
  if (secret) {
    const ciphertext = encryptSecret(JSON.stringify(value), { bootstrap: isBootstrapSetting(key) })
    if (!isEncrypted(ciphertext)) {
      throw new ConfigError(`instance setting ${key}: ENCRYPTION_KEY must be set to store ${isBootstrapSetting(key) ? 'KMS / secret store credentials (or use a secret:// reference or the environment)' : 'secrets'}`)
    }
    stored = ciphertext
  }
  const { error } = await db().from(TABLE).upsert(
    { key, value: stored, secret, updated_at: new Date().toISOString(), updated_by: options.updatedBy ?? null },
    { onConflict: 'key' },
  )
  if (error) throw new Error(error.message)
  await settingsChanged()
}

export async function deleteInstanceSetting(key: string): Promise<void> {
  const { error } = await db().from(TABLE).delete().eq('key', key)
  if (error) throw new Error(error.message)
  await settingsChanged()
}

/** Drop this process's copy and tell the others (shared cache store). */
async function settingsChanged(): Promise<void> {
  invalidateInstanceSettingsCache()
  const { publishInvalidation } = await import('@/lib/providers/cache/invalidation')
  await publishInvalidation('config')
}
