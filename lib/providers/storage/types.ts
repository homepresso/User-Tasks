import type { ProviderId } from '@/lib/config/schema'

/**
 * StorageProvider contract (server only). Buckets are the app's logical
 * buckets (lib/storage/buckets.ts); providers map them to physical
 * buckets/containers/directories. Keys are validated by every provider.
 */

export type StorageBody = Uint8Array | ArrayBuffer | Blob

export interface PutOptions {
  contentType?: string
  /** Max-age in seconds (Supabase semantics: '3600' by default) or a full Cache-Control value. */
  cacheControl?: string | number
  /** Replace an existing object (default false: fail if it exists). */
  upsert?: boolean
}

export interface StoredObjectInfo {
  key: string
  size: number
  contentType: string | null
  etag: string | null
  lastModified: string | null
  cacheControl: string | null
}

export interface StorageObject extends StoredObjectInfo {
  body: ReadableStream<Uint8Array>
}

export interface ListOptions {
  /** Page size (default 1000). */
  limit?: number
  /** Opaque cursor from the previous page. */
  cursor?: string | null
}

export interface ListResult {
  /** Objects whose key starts with the prefix, at any depth, in key order where the store allows. */
  objects: StoredObjectInfo[]
  cursor: string | null
}

export interface StorageProvider {
  readonly id: ProviderId<'storage'>
  /** Runs fully on-premises / air-gapped (plan: provider catalogue). */
  readonly onPrem: boolean
  put(bucket: string, key: string, body: StorageBody, options?: PutOptions): Promise<void>
  /** Object stream and metadata, or null when it doesn't exist. */
  get(bucket: string, key: string): Promise<StorageObject | null>
  head(bucket: string, key: string): Promise<StoredObjectInfo | null>
  /** Missing keys are ignored. */
  delete(bucket: string, keys: string[]): Promise<void>
  list(bucket: string, prefix: string, options?: ListOptions): Promise<ListResult>
  /** Absolute URL a browser can load a public object from. */
  publicUrl(bucket: string, key: string): string
  /** Time-limited read URL (for private buckets). */
  signedUrl(bucket: string, key: string, ttlSeconds: number): Promise<string>
  copy(bucket: string, fromKey: string, toKey: string, options?: { toBucket?: string; upsert?: boolean }): Promise<void>
  /** Create the bucket / container / directory when missing (setup, tests, migration). */
  ensureBucket(bucket: string, options?: { public?: boolean }): Promise<void>
}

export class StorageObjectExistsError extends Error {
  constructor(bucket: string, key: string) {
    super(`The object ${bucket}/${key} already exists`)
    this.name = 'StorageObjectExistsError'
  }
}

export async function toBytes(body: StorageBody): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return body
  if (body instanceof ArrayBuffer) return new Uint8Array(body)
  return new Uint8Array(await body.arrayBuffer())
}

/** Cache-Control header for a put option ('31536000' → 'public, max-age=31536000'). */
export function cacheControlHeader(value: string | number | undefined, fallbackSeconds = 3600): string {
  if (value === undefined || value === null || value === '') return `public, max-age=${fallbackSeconds}`
  const text = String(value).trim()
  return /^\d+$/.test(text) ? `public, max-age=${text}` : text
}

/** Supabase-style seconds for a put option ('public, max-age=60' → '60'). */
export function cacheControlSeconds(value: string | number | undefined): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const text = String(value).trim()
  if (/^\d+$/.test(text)) return text
  return /max-age=(\d+)/.exec(text)?.[1]
}

export async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.byteLength
  }
  const out = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength }
  return out
}

export function streamFromBytes(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } })
}

const DEFAULT_LIST_LIMIT = 1000

/** Page an already-sorted full listing with a key cursor (providers without native cursors). */
export function pageByKey(objects: StoredObjectInfo[], options: ListOptions = {}): ListResult {
  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_LIST_LIMIT, 10_000))
  const sorted = [...objects].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  const after = options.cursor ?? null
  const start = after === null ? 0 : sorted.findIndex((o) => o.key > after)
  const page = start === -1 ? [] : sorted.slice(start, start + limit)
  const more = start !== -1 && start + limit < sorted.length
  return { objects: page, cursor: more ? page[page.length - 1].key : null }
}

export function listLimit(options: ListOptions = {}): number {
  return Math.max(1, Math.min(options.limit ?? DEFAULT_LIST_LIMIT, 1000))
}
