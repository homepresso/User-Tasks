import { getServiceDb } from '@/lib/providers/db'
import { assertBucketName, assertSafeKey } from '@/lib/storage/buckets'
import {
  StorageObjectExistsError, cacheControlSeconds, pageByKey, streamFromBytes, toBytes,
  type StorageProvider, type StoredObjectInfo,
} from './types'

/**
 * Supabase Storage (default): the service-role client's storage API, exactly
 * the calls the app made before the provider existed. Public URLs are the
 * project's `/storage/v1/object/public/…` URLs.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- storage-js result shapes */

/** Anything with supabase-js's `.storage` (the service-role client by default). */
export type SupabaseStorageClient = { storage: any }

function isNotFound(error: any): boolean {
  const status = String(error?.statusCode ?? error?.status ?? '')
  return status === '404' || /not.?found/i.test(String(error?.message ?? ''))
}

function isDuplicate(error: any): boolean {
  return String(error?.statusCode ?? '') === '409' || /already exists|duplicate/i.test(String(error?.message ?? ''))
}

function fail(error: any): never {
  throw new Error(error?.message ?? 'Storage request failed')
}

function objectInfo(key: string, row: any): StoredObjectInfo {
  return {
    key,
    size: Number(row?.metadata?.size ?? 0),
    contentType: row?.metadata?.mimetype ?? null,
    etag: row?.metadata?.eTag ?? null,
    lastModified: row?.updated_at ?? row?.metadata?.lastModified ?? null,
    cacheControl: row?.metadata?.cacheControl ?? null,
  }
}

/** Provider over a given client's storage API (services pass their context's service-role client). */
export function createSupabaseStorageProvider(client: () => SupabaseStorageClient): StorageProvider {
  const bucketApi = (bucket: string) => {
    assertBucketName(bucket)
    return client().storage.from(bucket)
  }

  /** Recursive walk (storage-js lists one folder level at a time; folders have id null). */
  async function walk(bucket: string, prefix: string): Promise<StoredObjectInfo[]> {
    const slash = prefix.lastIndexOf('/')
    const dir = slash === -1 ? '' : prefix.slice(0, slash)
    const namePrefix = slash === -1 ? prefix : prefix.slice(slash + 1)
    const out: StoredObjectInfo[] = []
    const visit = async (folder: string, filter: string) => {
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await bucketApi(bucket).list(folder, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } })
        if (error) fail(error)
        const rows = (data ?? []) as any[]
        for (const row of rows) {
          if (filter && !String(row.name).startsWith(filter)) continue
          const key = folder ? `${folder}/${row.name}` : row.name
          if (row.id === null || row.id === undefined) await visit(key, '')
          else out.push(objectInfo(key, row))
        }
        if (rows.length < 1000) break
      }
    }
    await visit(dir, namePrefix)
    return out
  }

  const provider: StorageProvider = {
    id: 'supabase',
    onPrem: false,

    async put(bucket, key, body, options = {}) {
      assertSafeKey(key)
      const { error } = await bucketApi(bucket).upload(key, await toBytes(body), {
        ...(options.contentType ? { contentType: options.contentType } : {}),
        upsert: options.upsert ?? false,
        ...(options.cacheControl !== undefined ? { cacheControl: cacheControlSeconds(options.cacheControl) } : {}),
      })
      if (error) {
        if (!options.upsert && isDuplicate(error)) throw new StorageObjectExistsError(bucket, key)
        fail(error)
      }
    },

    async get(bucket, key) {
      assertSafeKey(key)
      const { data, error } = await bucketApi(bucket).download(key)
      if (error) {
        if (isNotFound(error)) return null
        fail(error)
      }
      const blob = data as Blob
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const info = await provider.head(bucket, key).catch(() => null)
      return {
        key,
        size: bytes.byteLength,
        contentType: info?.contentType ?? (blob.type || null),
        etag: info?.etag ?? null,
        lastModified: info?.lastModified ?? null,
        cacheControl: info?.cacheControl ?? null,
        body: streamFromBytes(bytes),
      }
    },

    /** Looked up in the object's folder listing (the API the app always used for this check). */
    async head(bucket, key) {
      assertSafeKey(key)
      const slash = key.lastIndexOf('/')
      const folder = slash === -1 ? '' : key.slice(0, slash)
      const name = key.slice(slash + 1)
      const { data, error } = await bucketApi(bucket).list(folder, { search: name, limit: 100 })
      if (error) {
        if (isNotFound(error)) return null
        fail(error)
      }
      const row = ((data ?? []) as any[]).find((o) => o.name === name && o.id !== null)
      return row ? objectInfo(key, row) : null
    },

    async delete(bucket, keys) {
      keys.forEach(assertSafeKey)
      for (let i = 0; i < keys.length; i += 100) {
        const { error } = await bucketApi(bucket).remove(keys.slice(i, i + 100))
        if (error) fail(error)
      }
    },

    async list(bucket, prefix, options) {
      return pageByKey(await walk(bucket, prefix), options)
    },

    publicUrl(bucket, key) {
      return bucketApi(bucket).getPublicUrl(key).data.publicUrl
    },

    async signedUrl(bucket, key, ttlSeconds) {
      assertSafeKey(key)
      const { data, error } = await bucketApi(bucket).createSignedUrl(key, Math.max(1, Math.floor(ttlSeconds)))
      if (error) fail(error)
      return (data as any).signedUrl as string
    },

    /** Supabase signed upload URL (valid for two hours; the caller enforces its own, shorter window). */
    async createUploadUrl(bucket, key, options) {
      assertSafeKey(key)
      const { data, error } = await bucketApi(bucket).createSignedUploadUrl(key)
      if (error) fail(error)
      // The app's Supabase URL is the one browsers use too (lib/config/public).
      const url = String((data as any).signedUrl)
      return { url, method: 'PUT' as const, headers: { 'Content-Type': options.contentType || 'application/octet-stream', 'x-upsert': 'false' } }
    },

    async copy(bucket, fromKey, toKey, options = {}) {
      assertSafeKey(fromKey)
      assertSafeKey(toKey)
      const toBucket = options.toBucket ?? bucket
      if (options.upsert) await provider.delete(toBucket, [toKey])
      const { error } = await bucketApi(bucket).copy(fromKey, toKey, toBucket !== bucket ? { destinationBucket: toBucket } : undefined)
      if (error) {
        if (isDuplicate(error)) throw new StorageObjectExistsError(toBucket, toKey)
        fail(error)
      }
    },

    async ensureBucket(bucket, options = {}) {
      assertBucketName(bucket)
      const storage = client().storage
      const { data } = await storage.getBucket(bucket)
      if (data) return
      const { error } = await storage.createBucket(bucket, { public: options.public ?? true })
      if (error && !isDuplicate(error)) fail(error)
    },
  }
  return provider
}

export const supabaseStorageProvider: StorageProvider = createSupabaseStorageProvider(() => getServiceDb())
