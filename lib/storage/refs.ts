import { getPublicConfig, type PublicConfig } from '@/lib/config/public'
import { isKnownBucket, isSafeStorageKey } from './buckets'

/**
 * Storage references.
 *
 * The canonical form persisted for files the app renders itself (workspace
 * logo, theme logos / favicon / fonts, integration and reference icons) is
 *
 *     storage://<bucket>/<key>[?query]
 *
 * (key segments percent-encoded; a query such as the logo's `?t=` cache
 * buster is kept). It names an object independently of the provider, so the
 * storage backend can change without rewriting the database.
 * resolveStorageUrl() turns a reference into a URL for the configured
 * provider; any other value passes through, so legacy full URLs written
 * before this (Supabase public URLs) keep working.
 *
 * Browser-safe: everything comes from the public runtime config.
 */

export const STORAGE_REF_PREFIX = 'storage://'
export const FILES_ROUTE_PREFIX = '/files/'
const SUPABASE_PUBLIC_PATH = '/storage/v1/object/public/'

export interface StorageObjectRef {
  bucket: string
  key: string
  /** Query string including `?`, or ''. */
  search: string
}

export type StorageUrlForm = 'ref' | 'files' | 'supabase' | 'public_base'

export function formatStorageRef(bucket: string, key: string, search = ''): string {
  return `${STORAGE_REF_PREFIX}${bucket}/${key.split('/').map(encodeURIComponent).join('/')}${search}`
}

export function isStorageRef(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(STORAGE_REF_PREFIX)
}

function decodeKey(path: string): string | null {
  try {
    return path.split('/').map((segment) => decodeURIComponent(segment)).join('/')
  } catch {
    return null
  }
}

/** `<bucket>/<encoded key>` → parts, when the bucket is ours and the key is safe. */
function splitBucketPath(path: string, search: string): StorageObjectRef | null {
  const slash = path.indexOf('/')
  if (slash <= 0) return null
  const bucket = path.slice(0, slash)
  const key = decodeKey(path.slice(slash + 1))
  if (!isKnownBucket(bucket) || key === null || !isSafeStorageKey(key)) return null
  return { bucket, key, search }
}

export function parseStorageRef(value: unknown): StorageObjectRef | null {
  if (typeof value !== 'string' || !isStorageRef(value) || value.length > 2048) return null
  const rest = value.slice(STORAGE_REF_PREFIX.length)
  const q = rest.search(/[?#]/)
  const path = q === -1 ? rest : rest.slice(0, q)
  const search = q === -1 ? '' : rest.slice(q).replace(/#.*$/, '')
  return splitBucketPath(path, search)
}

function sameOrigin(url: URL, base: string | undefined): boolean {
  if (!base) return false
  try { return new URL(base).origin === url.origin } catch { return false }
}

/**
 * The object an own-storage value points at, in any accepted form:
 *  - `storage://bucket/key`
 *  - `/files/bucket/key` (relative, or absolute on the app origin)
 *  - a Supabase public URL (`…/storage/v1/object/public/bucket/key`) on the
 *    configured Supabase origin (any origin when none is configured, as the
 *    validators always allowed)
 *  - a configured public base (S3 / CDN) + key
 * Anything else (foreign URLs, other buckets, traversal) → null.
 */
export function parseOwnStorageUrl(value: unknown, config: PublicConfig = getPublicConfig()): (StorageObjectRef & { form: StorageUrlForm }) | null {
  if (typeof value !== 'string' || value.length > 2048) return null
  if (/[\s'"()<>\\]/.test(value)) return null
  if (isStorageRef(value)) {
    const ref = parseStorageRef(value)
    return ref ? { ...ref, form: 'ref' } : null
  }
  if (value.startsWith(FILES_ROUTE_PREFIX)) {
    let url: URL
    try { url = new URL(value, 'http://relative.invalid') } catch { return null }
    const ref = splitBucketPath(url.pathname.slice(FILES_ROUTE_PREFIX.length), url.search)
    return ref ? { ...ref, form: 'files' } : null
  }
  let url: URL
  try { url = new URL(value) } catch { return null }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.username || url.password) return null
  if (url.pathname.includes('//')) return null

  if (url.pathname.startsWith(SUPABASE_PUBLIC_PATH)) {
    if (config.supabaseUrl && !sameOrigin(url, config.supabaseUrl)) return null
    const ref = splitBucketPath(url.pathname.slice(SUPABASE_PUBLIC_PATH.length), url.search)
    return ref ? { ...ref, form: 'supabase' } : null
  }
  if (url.pathname.startsWith(FILES_ROUTE_PREFIX) && sameOrigin(url, config.appUrl)) {
    const ref = splitBucketPath(url.pathname.slice(FILES_ROUTE_PREFIX.length), url.search)
    return ref ? { ...ref, form: 'files' } : null
  }
  for (const [bucket, base] of Object.entries(config.storage?.publicBases ?? {})) {
    const prefix = `${base.replace(/\/+$/, '')}/`
    const plain = `${url.origin}${url.pathname}`
    if (!plain.startsWith(prefix)) continue
    const key = decodeKey(plain.slice(prefix.length))
    if (key !== null && isSafeStorageKey(key)) return { bucket, key, search: url.search, form: 'public_base' }
  }
  return null
}

/** Own-storage value → `storage://` reference; anything else is returned unchanged. */
export function toStorageRef<T>(value: T, config?: PublicConfig): T | string {
  const ref = parseOwnStorageUrl(value, config)
  return ref ? formatStorageRef(ref.bucket, ref.key, ref.search) : value
}

function encodePath(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/')
}

/**
 * URL for an object with the configured provider:
 *  - supabase   the Supabase public URL (what was stored before references)
 *  - public base the configured direct URL (S3 / CDN)
 *  - otherwise  /files/<bucket>/<key>, absolute on APP_URL when `absolute`
 */
export function storageObjectUrl(bucket: string, key: string, options: { absolute?: boolean; config?: PublicConfig } = {}): string {
  const config = options.config ?? getPublicConfig()
  const path = encodePath(key)
  if (!config.storage) {
    const base = String(config.supabaseUrl ?? '').replace(/\/+$/, '')
    return `${base}${SUPABASE_PUBLIC_PATH}${bucket}/${path}`
  }
  const publicBase = config.storage.publicBases?.[bucket]
  if (publicBase) return `${publicBase.replace(/\/+$/, '')}/${path}`
  const relative = `${FILES_ROUTE_PREFIX}${bucket}/${path}`
  if (!options.absolute) return relative
  const appUrl = String(config.appUrl ?? '').trim().replace(/\/+$/, '')
  return appUrl ? `${appUrl}${relative}` : relative
}

/**
 * A usable URL for a stored value: references resolve through the provider
 * config; under a non-Supabase provider, legacy Supabase public URLs of this
 * project resolve to the same object served by the app (objects are copied
 * by the storage migration); everything else is returned as is.
 */
export function resolveStorageUrl(value: string, options?: { absolute?: boolean; config?: PublicConfig }): string
export function resolveStorageUrl(value: string | null | undefined, options?: { absolute?: boolean; config?: PublicConfig }): string | null
export function resolveStorageUrl(value: string | null | undefined, options: { absolute?: boolean; config?: PublicConfig } = {}): string | null {
  if (value === null || value === undefined || value === '') return value ?? null
  if (typeof value !== 'string') return value
  const config = options.config ?? getPublicConfig()
  if (isStorageRef(value)) {
    const ref = parseStorageRef(value)
    if (!ref) return value
    return `${storageObjectUrl(ref.bucket, ref.key, { ...options, config })}${ref.search}`
  }
  if (config.storage && value.includes(SUPABASE_PUBLIC_PATH) && config.supabaseUrl) {
    const ref = parseOwnStorageUrl(value, config)
    if (ref?.form === 'supabase') return `${storageObjectUrl(ref.bucket, ref.key, { ...options, config })}${ref.search}`
  }
  return value
}

/** True when the value is an own-storage object in one of `buckets`. */
export function isOwnStorageObject(value: unknown, buckets: readonly string[], config?: PublicConfig): value is string {
  const ref = parseOwnStorageUrl(value, config)
  return Boolean(ref && buckets.includes(ref.bucket))
}

/** Own-storage object of `bucket` in the tenant's folder (`<tenant>/…`): the file name, else null. */
export function tenantFolderObject(value: unknown, bucket: string, tenantId: string, config?: PublicConfig): string | null {
  const ref = parseOwnStorageUrl(value, config)
  if (!ref || ref.bucket !== bucket) return null
  const prefix = `${tenantId}/`
  return ref.key.startsWith(prefix) && ref.key.length > prefix.length ? ref.key.slice(prefix.length) : null
}
