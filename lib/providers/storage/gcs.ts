import { Readable } from 'node:stream'
import { assertSafeKey } from '@/lib/storage/buckets'
import { bucketLocation, optionString, type StorageOptions } from './options'
import { loadOptionalSdk } from './optional-sdk'
import { providerPublicUrl } from './urls'
import {
  StorageObjectExistsError, cacheControlHeader, listLimit, toBytes,
  type StorageProvider, type StoredObjectInfo,
} from './types'

/**
 * Google Cloud Storage via @google-cloud/storage (optional dependency,
 * loaded on first use). Buckets map like the other cloud providers (./options).
 *
 * Authentication: gcs_credentials_json (a service-account key, stored as an
 * encrypted instance setting or GCS_CREDENTIALS_JSON), otherwise Application
 * Default Credentials: workload identity / the attached service account on
 * GKE, Cloud Run and Compute Engine, or GOOGLE_APPLICATION_CREDENTIALS.
 * gcs_endpoint points at an emulator (fake-gcs-server) or a private endpoint;
 * with an endpoint and no credentials, requests are unauthenticated.
 *
 * signedUrl(): V4 signed URLs (needs a service-account key, or ADC with
 * the iam.serviceAccounts.signBlob permission).
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- SDK error / metadata shapes */

type GcsModule = typeof import('@google-cloud/storage')

function isMissing(e: any): boolean {
  return e?.code === 404 || e?.response?.status === 404
}

function info(key: string, metadata: any): StoredObjectInfo {
  return {
    key,
    size: Number(metadata?.size ?? 0),
    contentType: metadata?.contentType ?? null,
    etag: metadata?.md5Hash ?? metadata?.etag ?? null,
    lastModified: metadata?.updated ?? null,
    cacheControl: metadata?.cacheControl ?? null,
  }
}

export function createGcsStorageProvider(options: StorageOptions): StorageProvider {
  let storagePromise: Promise<InstanceType<GcsModule['Storage']>> | null = null

  function connect() {
    storagePromise ??= (async () => {
      const { Storage } = await loadOptionalSdk('@google-cloud/storage', () => import('@google-cloud/storage'))
      const json = optionString(options, 'gcs_credentials_json')
      let credentials: Record<string, unknown> | undefined
      if (json) {
        try { credentials = JSON.parse(json) } catch { throw new Error('gcs_credentials_json must be a service-account key (JSON)') }
      }
      const apiEndpoint = optionString(options, 'gcs_endpoint')
      return new Storage({
        projectId: optionString(options, 'gcs_project_id') ?? (credentials?.project_id as string | undefined),
        ...(credentials ? { credentials } : {}),
        ...(apiEndpoint ? { apiEndpoint, useAuthWithCustomEndpoint: Boolean(credentials) } : {}),
      })
    })()
    return storagePromise
  }

  async function file(bucket: string, key: string) {
    assertSafeKey(key)
    const location = bucketLocation(bucket, options)
    return (await connect()).bucket(location.container).file(`${location.keyPrefix}${key}`)
  }

  const provider: StorageProvider = {
    id: 'gcs',
    onPrem: false,

    async put(bucket, key, body, opts = {}) {
      const target = await file(bucket, key)
      try {
        await target.save(Buffer.from(await toBytes(body)), {
          resumable: false,
          contentType: opts.contentType || undefined,
          metadata: opts.cacheControl !== undefined ? { cacheControl: cacheControlHeader(opts.cacheControl) } : undefined,
          ...(opts.upsert ? {} : { preconditionOpts: { ifGenerationMatch: 0 } }),
        })
      } catch (e: any) {
        if (!opts.upsert && e?.code === 412) throw new StorageObjectExistsError(bucket, key)
        throw e
      }
    },

    async get(bucket, key) {
      const target = await file(bucket, key)
      let metadata
      try {
        [metadata] = await target.getMetadata()
      } catch (e) {
        if (isMissing(e)) return null
        throw e
      }
      const stream = target.createReadStream()
      return { ...info(key, metadata), body: Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array> }
    },

    async head(bucket, key) {
      const target = await file(bucket, key)
      try {
        const [metadata] = await target.getMetadata()
        return info(key, metadata)
      } catch (e) {
        if (isMissing(e)) return null
        throw e
      }
    },

    async delete(bucket, keys) {
      for (const key of keys) await (await file(bucket, key)).delete({ ignoreNotFound: true })
    },

    async list(bucket, prefix, opts = {}) {
      const location = bucketLocation(bucket, options)
      const [files, next] = await (await connect()).bucket(location.container).getFiles({
        prefix: `${location.keyPrefix}${prefix}`,
        maxResults: listLimit(opts),
        pageToken: opts.cursor ?? undefined,
        autoPaginate: false,
      })
      const objects = files.map((f) => info(f.name.slice(location.keyPrefix.length), f.metadata))
      return { objects, cursor: (next as { pageToken?: string } | null)?.pageToken ?? null }
    },

    publicUrl(bucket, key) {
      return providerPublicUrl(bucket, key, options)
    },

    async signedUrl(bucket, key, ttlSeconds) {
      const [url] = await (await file(bucket, key)).getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + Math.max(1, Math.min(Math.floor(ttlSeconds), 7 * 24 * 3600)) * 1000,
      })
      return url
    },

    /** V4 signed PUT URL (the bucket's CORS must allow PUT from the app's origin). */
    async createUploadUrl(bucket, key, opts) {
      const contentType = opts.contentType || 'application/octet-stream'
      const [url] = await (await file(bucket, key)).getSignedUrl({
        version: 'v4',
        action: 'write',
        contentType,
        expires: Date.now() + Math.max(1, Math.min(Math.floor(opts.ttlSeconds), 7 * 24 * 3600)) * 1000,
      })
      return { url, method: 'PUT' as const, headers: { 'Content-Type': contentType } }
    },

    async copy(bucket, fromKey, toKey, opts = {}) {
      const toBucket = opts.toBucket ?? bucket
      if (!opts.upsert && await provider.head(toBucket, toKey)) throw new StorageObjectExistsError(toBucket, toKey)
      await (await file(bucket, fromKey)).copy(await file(toBucket, toKey))
    },

    async ensureBucket(bucket) {
      const target = (await connect()).bucket(bucketLocation(bucket, options).container)
      const [exists] = await target.exists()
      if (!exists) await target.create()
    },
  }
  return provider
}
