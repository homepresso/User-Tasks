import { getStorageProvider, getStorageProviderFor } from '@/lib/providers/storage'
import type { SupabaseStorageClient } from '@/lib/providers/storage/supabase'
import { fileRefFields } from './persist'
import { isStorageRef, parseOwnStorageUrl, resolveStorageUrl } from './refs'

/**
 * Server helpers for files the workflow engine and document handlers write
 * and read (task-files bucket).
 */

export const TASK_FILES_BUCKET = 'task-files'
export const WORKFLOW_FILES_PREFIX = 'workflow-files/'

export interface StoredWorkflowFile {
  /** Usable absolute URL (the Supabase public URL by default, as before). */
  url: string
  path: string
  /** `storage://task-files/<path>` when the provider isn't supabase. */
  ref?: string
}

/**
 * Store a generated / downloaded file at task-files/workflow-files/<tenant>/<uuid>.<ext>.
 * `client` is the caller's service client, used when the provider is Supabase
 * Storage (exactly the upload + getPublicUrl calls made before).
 */
export async function storeWorkflowFile(
  client: SupabaseStorageClient,
  tenantId: string,
  body: Uint8Array | ArrayBuffer,
  ext: string,
  contentType: string,
): Promise<StoredWorkflowFile> {
  const path = `${WORKFLOW_FILES_PREFIX}${tenantId}/${crypto.randomUUID()}.${ext}`
  const storage = await getStorageProviderFor(client)
  await storage.put(TASK_FILES_BUCKET, path, body, { contentType })
  return { url: storage.publicUrl(TASK_FILES_BUCKET, path), path, ...fileRefFields(TASK_FILES_BUCKET, path, storage.id) }
}

/**
 * fetch() for a file URL a workflow references. Own stored objects are read
 * through the storage provider when it isn't Supabase (no HTTP round trip to
 * the app's own /files route, and it works where APP_URL isn't reachable
 * from the server); `storage://` references are resolved first. Everything
 * else, and every URL under the default provider, is a plain fetch as before.
 */
export async function fetchFile(url: string, init?: RequestInit): Promise<Response> {
  const target = isStorageRef(url) ? resolveStorageUrl(url, { absolute: true }) : url
  const own = parseOwnStorageUrl(url)
  if (own) {
    const storage = await getStorageProvider()
    if (storage.id !== 'supabase') {
      const object = await storage.get(own.bucket, own.key)
      if (!object) return new Response('Not found', { status: 404 })
      const headers: Record<string, string> = { 'content-type': object.contentType ?? 'application/octet-stream' }
      if (object.size) headers['content-length'] = String(object.size)
      const name = own.key.split('/').pop()
      if (name) headers['content-disposition'] = `attachment; filename="${name.replace(/["\\]/g, '_')}"`
      return new Response(object.body, { status: 200, headers })
    }
  }
  return fetch(target, init)
}
