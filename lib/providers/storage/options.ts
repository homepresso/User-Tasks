// Relative imports: next.config.ts loads this module (through lib/csp.ts), where the @/ alias isn't available.
import { readEnv } from '../../config/bootstrap'
import { readSettingsCacheStale } from '../../config/settings-cache'
import { DEFAULT_PROVIDERS, PROVIDER_ENV, providerIdSchema, type ProviderId } from '../../config/schema'
import { STORAGE_BUCKETS, STORAGE_BUCKET_NAMES, assertBucketName } from '../../storage/buckets'

/**
 * Storage provider options (`storage.<option>` instance settings, or the
 * environment variables below, which win). Browser-safe: no SDKs here, the
 * public config uses publicBasesFor() to tell the browser where public
 * objects live.
 *
 * Bucket mapping (s3 / azure_blob / gcs; the app's logical buckets are
 * task-files, logos, brand-fonts):
 *  - bucket_map     JSON {"logos": "acme-logos", "task-files": "acme-files/prod"}
 *                   (physical bucket or container, optional key prefix)
 *  - bucket         one physical bucket/container for everything; objects
 *                   live under `<logical bucket>/<key>`
 *  - bucket_prefix  physical name = prefix + logical name (default: same name)
 *  - public_base_url  serve public objects straight from the store / a CDN:
 *                   `{bucket}` is replaced by the physical bucket, otherwise
 *                   `/<physical bucket>` is appended. Without it public
 *                   objects are served by the app at /files/<bucket>/<key>.
 */

export const STORAGE_OPTION_ENV: Record<string, string> = {
  bucket: 'STORAGE_BUCKET',
  bucket_prefix: 'STORAGE_BUCKET_PREFIX',
  bucket_map: 'STORAGE_BUCKET_MAP',
  public_base_url: 'STORAGE_PUBLIC_BASE_URL',
  local_root: 'STORAGE_LOCAL_ROOT',
  endpoint: 'S3_ENDPOINT',
  region: 'S3_REGION',
  access_key_id: 'S3_ACCESS_KEY_ID',
  secret_access_key: 'S3_SECRET_ACCESS_KEY',
  force_path_style: 'S3_FORCE_PATH_STYLE',
  azure_connection_string: 'AZURE_STORAGE_CONNECTION_STRING',
  azure_account_name: 'AZURE_STORAGE_ACCOUNT',
  azure_account_key: 'AZURE_STORAGE_KEY',
  azure_sas_token: 'AZURE_STORAGE_SAS_TOKEN',
  azure_endpoint: 'AZURE_STORAGE_BLOB_ENDPOINT',
  gcs_project_id: 'GCS_PROJECT_ID',
  gcs_credentials_json: 'GCS_CREDENTIALS_JSON',
  gcs_endpoint: 'GCS_API_ENDPOINT',
}

/** Options that are credentials: instance settings must store them encrypted (secret). */
export const STORAGE_SECRET_OPTIONS = new Set([
  'secret_access_key', 'azure_connection_string', 'azure_account_key', 'azure_sas_token', 'gcs_credentials_json',
])

export type StorageOptions = Record<string, unknown>

export function optionString(options: StorageOptions, name: string): string | undefined {
  const value = options[name]
  if (value === undefined || value === null) return undefined
  const text = typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value)
  return text.trim() === '' ? undefined : text.trim()
}

export function optionBoolean(options: StorageOptions, name: string): boolean {
  const value = options[name]
  if (typeof value === 'boolean') return value
  return /^(1|true|yes|on)$/i.test(String(value ?? '').trim())
}

export interface StorageLocation {
  /** Physical bucket / container. */
  container: string
  /** Prepended to every key ('' or ending in '/'). */
  keyPrefix: string
}

function splitTarget(target: string): StorageLocation {
  const [container, ...rest] = target.split('/').filter(Boolean)
  const prefix = rest.join('/')
  return { container, keyPrefix: prefix ? `${prefix}/` : '' }
}

/** Where a logical bucket lives in the provider (see bucket_map / bucket / bucket_prefix). */
export function bucketLocation(bucket: string, options: StorageOptions): StorageLocation {
  const map = optionString(options, 'bucket_map')
  if (map) {
    let parsed: unknown
    try { parsed = JSON.parse(map) } catch { throw new Error('storage bucket_map must be a JSON object') }
    const target = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>)[bucket] : undefined
    if (typeof target === 'string' && target.trim()) {
      const location = splitTarget(target.trim())
      assertBucketName(location.container)
      return location
    }
  }
  const single = optionString(options, 'bucket')
  if (single) {
    const location = splitTarget(single)
    assertBucketName(location.container)
    return { container: location.container, keyPrefix: `${location.keyPrefix}${bucket}/` }
  }
  const container = `${optionString(options, 'bucket_prefix') ?? ''}${bucket}`
  assertBucketName(container)
  return { container, keyPrefix: '' }
}

/** Encode each key segment for a URL path. */
export function encodeKeyPath(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/')
}

/**
 * Base URL under which `<key>` of a public bucket is directly readable, or
 * null when objects are served through the app's /files route.
 */
export function publicBaseFor(bucket: string, options: StorageOptions): string | null {
  const base = optionString(options, 'public_base_url')
  if (!base) return null
  const { container, keyPrefix } = bucketLocation(bucket, options)
  const root = base.includes('{bucket}') ? base.replace('{bucket}', container) : `${base.replace(/\/+$/, '')}/${container}`
  return `${root.replace(/\/+$/, '')}${keyPrefix ? `/${encodeKeyPath(keyPrefix.replace(/\/$/, ''))}` : ''}`
}

/** publicBaseFor() for every public app bucket that has one (public config). */
export function publicBasesFor(options: StorageOptions): Record<string, string> | undefined {
  const out: Record<string, string> = {}
  for (const bucket of STORAGE_BUCKET_NAMES) {
    // Private buckets (job results) are never linked directly.
    if (!STORAGE_BUCKETS[bucket].public) continue
    try {
      const base = publicBaseFor(bucket, options)
      if (base) out[bucket] = base
    } catch {
      // A broken bucket_map surfaces when the provider is used; URLs fall back to /files.
    }
  }
  return Object.keys(out).length ? out : undefined
}

/** `storage.<option>` values from a settings map, then env overrides. */
export function storageOptionsFrom(settings: Map<string, unknown> | null): StorageOptions {
  const options: StorageOptions = {}
  for (const [key, value] of settings ?? []) {
    if (key.startsWith('storage.')) options[key.slice('storage.'.length)] = value
  }
  for (const [option, name] of Object.entries(STORAGE_OPTION_ENV)) {
    const value = readEnv(name)
    if (value !== undefined && value !== '') options[option] = value
  }
  return options
}

/**
 * Storage provider id + options, synchronously: STORAGE_PROVIDER, else the
 * `providers.storage` setting from the last instance-settings load, else the
 * default. Used where an await isn't possible (URL resolution while
 * rendering, the public config).
 */
export function storageConfigSync(): { id: ProviderId<'storage'>; options: StorageOptions } {
  const settings = readSettingsCacheStale()
  const raw = readEnv(PROVIDER_ENV.storage)?.trim().toLowerCase()
  const fromEnv = raw ? providerIdSchema('storage').safeParse(raw) : null
  const stored = providerIdSchema('storage').safeParse(settings?.get('providers.storage'))
  const id = fromEnv?.success ? fromEnv.data : stored.success ? stored.data : DEFAULT_PROVIDERS.storage
  return { id, options: storageOptionsFrom(settings) }
}
