import { getStorageProvider, type StorageProvider } from '@/lib/providers/storage'
import { readAll } from '@/lib/providers/storage/types'
import { formatStorageRef, parseStorageRef } from '@/lib/storage/refs'

/**
 * Files of background jobs, in the private `job-results` bucket of the
 * configured storage provider:
 *
 *   <tenant>/<job>/input            the job's large input (an uploaded package, report rows)
 *   <tenant>/<job>/parts/<n>        chunks written by a job that runs in several invocations
 *   <tenant>/<job>/<file name>      the result file
 *
 * Nothing in the bucket is reachable by URL: /files refuses it (no tenant
 * from the key, no public read), and downloads go through the job download
 * routes, which check the job's owner on every request.
 */

export const JOB_RESULTS_BUCKET = 'job-results'

let ensured: Promise<void> | null = null

async function provider(): Promise<StorageProvider> {
  const storage = await getStorageProvider()
  // Create the private bucket once per process where the provider can
  // (Supabase: the migration already did; local: a directory). A provider
  // without create rights fails the put below with its own message.
  ensured ??= storage.ensureBucket(JOB_RESULTS_BUCKET, { public: false }).catch(() => { ensured = null })
  await ensured
  return storage
}

/** File names as stored: no path separators or control characters, at most 120 characters. */
export function safeFileName(name: string, fallback = 'export'): string {
  const clean = String(name ?? '')
    .normalize('NFKC')
    .replace(/[\\/\u0000-\u001f\u007f]+/g, '-')
    .replace(/^[.\s-]+/, '')
    .trim()
    .slice(0, 120)
  return clean || fallback
}

export function jobFileKey(tenantId: string, jobId: string, name: string): string {
  return `${tenantId}/${jobId}/${safeFileName(name)}`
}

export async function putJobObject(key: string, body: Uint8Array, contentType: string): Promise<string> {
  const storage = await provider()
  await storage.put(JOB_RESULTS_BUCKET, key, body, { contentType, cacheControl: 'private, no-store', upsert: true })
  return formatStorageRef(JOB_RESULTS_BUCKET, key)
}

export async function readJobObject(ref: string): Promise<Uint8Array | null> {
  const parsed = parseStorageRef(ref)
  if (!parsed || parsed.bucket !== JOB_RESULTS_BUCKET) return null
  const storage = await provider()
  const object = await storage.get(JOB_RESULTS_BUCKET, parsed.key)
  return object ? readAll(object.body) : null
}

/** Stream + metadata for a download (null when gone). */
export async function openJobObject(ref: string) {
  const parsed = parseStorageRef(ref)
  if (!parsed || parsed.bucket !== JOB_RESULTS_BUCKET) return null
  const storage = await provider()
  return storage.get(JOB_RESULTS_BUCKET, parsed.key)
}

/** Every object of one job (input, parts, result). Missing objects are ignored. */
export async function deleteJobObjects(tenantId: string, jobId: string): Promise<number> {
  const storage = await provider()
  const prefix = `${tenantId}/${jobId}/`
  let removed = 0
  let cursor: string | null = null
  do {
    const page = await storage.list(JOB_RESULTS_BUCKET, prefix, { limit: 1000, cursor })
    cursor = page.cursor
    const keys = page.objects.map((object) => object.key).filter((key) => key.startsWith(prefix))
    if (keys.length) {
      await storage.delete(JOB_RESULTS_BUCKET, keys)
      removed += keys.length
    }
  } while (cursor)
  return removed
}
