/**
 * Storage buckets the app uses, and the rules for object keys.
 *
 * Every bucket but `job-results` is public-read (Supabase buckets created by the
 * storage migrations): anyone with the URL can fetch the object, exactly as
 * with Supabase public URLs. Private buckets are supported by the /files
 * route (session + tenant check, or an app-signed URL) for later use.
 */

export interface BucketPolicy {
  /** Readable without a session (served with public cache headers). */
  public: boolean
  /**
   * Tenant that owns an object, from its key. Private buckets only serve
   * objects whose tenant the caller belongs to; null = nobody (deny).
   */
  tenantFromKey?: (key: string) => string | null
  /** Short-lived objects an instance migration does not copy (job results). */
  transient?: boolean
  /** Never served by /files, even with a signed URL (served by its own authorised route). */
  unserved?: boolean
}

const firstSegment = (key: string) => key.split('/')[0] || null

export const STORAGE_BUCKETS = {
  /** Uploaded documents, data-table files, integration/reference icons, workflow files (`workflow-files/<tenant>/…`). */
  'task-files': {
    public: true,
    tenantFromKey: (key: string) => (key.startsWith('workflow-files/') ? key.split('/')[1] || null : null),
  },
  /** Workspace logos and favicons (`<tenant>/<variant>.<ext>`). */
  logos: { public: true, tenantFromKey: firstSegment },
  /** Uploaded theme fonts (`<tenant>/<family>-<hash>.woff2`). */
  'brand-fonts': { public: true, tenantFromKey: firstSegment },
  /**
   * Background job inputs and results (`<tenant>/<job>/…`, lib/user-jobs/store.ts).
   * Private and never served by /files (no owner from the key): job results
   * belong to one user, so only the job download routes serve them.
   */
  'job-results': { public: false, tenantFromKey: () => null, transient: true },
  /**
   * Form attachments (`<tenant>/<context>-<id>/<uuid>/<name>`, lib/services/form-files.ts).
   * Private and never served by /files: /attachments/<id> authorises every
   * download (task / submission access) and streams the object itself.
   */
  'form-files': { public: false, tenantFromKey: () => null, unserved: true },
} as const satisfies Record<string, BucketPolicy>

export type StorageBucket = keyof typeof STORAGE_BUCKETS
export const STORAGE_BUCKET_NAMES = Object.keys(STORAGE_BUCKETS) as StorageBucket[]

export function isKnownBucket(name: unknown): name is StorageBucket {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(STORAGE_BUCKETS, name)
}

export function bucketPolicy(name: string): BucketPolicy | null {
  return isKnownBucket(name) ? STORAGE_BUCKETS[name] : null
}

/** Bucket names providers accept (also physical names after mapping). */
export const BUCKET_NAME_RE = /^[a-z0-9][a-z0-9.-]{1,62}$/

export const MAX_KEY_LENGTH = 1024

/**
 * Object keys: `/`-separated segments, none empty, `.` or `..`, no
 * backslashes or control characters, at most 1024 characters. Every provider
 * checks this before touching storage (the local provider also confines the
 * resolved path to its root).
 */
export function isSafeStorageKey(key: unknown): key is string {
  if (typeof key !== 'string' || key.length === 0 || key.length > MAX_KEY_LENGTH) return false
  if (/[\\\u0000-\u001f\u007f]/.test(key)) return false
  return key.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

export class StorageKeyError extends Error {
  constructor(message = 'Invalid storage key') {
    super(message)
    this.name = 'StorageKeyError'
  }
}

export function assertSafeKey(key: string): void {
  if (!isSafeStorageKey(key)) throw new StorageKeyError(`Invalid storage key: ${JSON.stringify(String(key).slice(0, 80))}`)
}

export function assertBucketName(bucket: string): void {
  if (!BUCKET_NAME_RE.test(bucket) || bucket.includes('..')) throw new StorageKeyError(`Invalid bucket name: ${JSON.stringify(bucket)}`)
}
