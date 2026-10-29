import { assertSafeKey } from '@/lib/storage/buckets'
import { bucketLocation, optionBoolean, optionString, type StorageOptions } from './options'
import { loadOptionalSdk } from './optional-sdk'
import { providerPublicUrl } from './urls'
import {
  StorageObjectExistsError, cacheControlHeader, listLimit, readAll, toBytes,
  type StorageProvider, type StoredObjectInfo,
} from './types'

/**
 * S3 and S3-compatible stores (AWS S3, MinIO, Ceph RGW, SeaweedFS, Garage,
 * Cloudflare R2, Backblaze B2, Wasabi, …) via the AWS SDK v3, loaded on
 * first use (optional dependency @aws-sdk/client-s3 + s3-request-presigner).
 *
 * Options: endpoint (omit for AWS), region (default us-east-1),
 * access_key_id / secret_access_key (omit to use the SDK's default chain:
 * env, IAM role, IRSA), force_path_style (MinIO / Ceph), plus the shared
 * bucket mapping and public_base_url (./options).
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- SDK error shapes */

type S3Module = typeof import('@aws-sdk/client-s3')

function isMissing(e: any): boolean {
  const name = String(e?.name ?? e?.Code ?? '')
  return name === 'NoSuchKey' || name === 'NotFound' || e?.$metadata?.httpStatusCode === 404
}

export function createS3StorageProvider(options: StorageOptions): StorageProvider {
  let clientPromise: Promise<{ sdk: S3Module; client: InstanceType<S3Module['S3Client']> }> | null = null

  function connect() {
    clientPromise ??= (async () => {
      const sdk = await loadOptionalSdk('@aws-sdk/client-s3', () => import('@aws-sdk/client-s3'))
      const accessKeyId = optionString(options, 'access_key_id')
      const secretAccessKey = optionString(options, 'secret_access_key')
      const client = new sdk.S3Client({
        region: optionString(options, 'region') ?? 'us-east-1',
        endpoint: optionString(options, 'endpoint'),
        forcePathStyle: optionBoolean(options, 'force_path_style'),
        ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
        // S3-compatible stores (older MinIO, Ceph) reject the SDK's default extra checksums.
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      })
      return { sdk, client }
    })()
    return clientPromise
  }

  const where = (bucket: string, key: string) => {
    assertSafeKey(key)
    const location = bucketLocation(bucket, options)
    return { Bucket: location.container, Key: `${location.keyPrefix}${key}` }
  }

  const provider: StorageProvider = {
    id: 's3',
    onPrem: true,

    async put(bucket, key, body, opts = {}) {
      const { sdk, client } = await connect()
      try {
        await client.send(new sdk.PutObjectCommand({
          ...where(bucket, key),
          Body: await toBytes(body),
          ContentType: opts.contentType || undefined,
          CacheControl: opts.cacheControl !== undefined ? cacheControlHeader(opts.cacheControl) : undefined,
          ...(opts.upsert ? {} : { IfNoneMatch: '*' }),
        }))
      } catch (e: any) {
        if (!opts.upsert && (e?.$metadata?.httpStatusCode === 412 || e?.name === 'PreconditionFailed')) throw new StorageObjectExistsError(bucket, key)
        throw e
      }
    },

    async get(bucket, key) {
      const { sdk, client } = await connect()
      try {
        const out = await client.send(new sdk.GetObjectCommand(where(bucket, key)))
        const body = (out.Body as any).transformToWebStream() as ReadableStream<Uint8Array>
        return {
          key,
          size: Number(out.ContentLength ?? 0),
          contentType: out.ContentType ?? null,
          etag: out.ETag?.replace(/"/g, '') ?? null,
          lastModified: out.LastModified?.toISOString() ?? null,
          cacheControl: out.CacheControl ?? null,
          body,
        }
      } catch (e) {
        if (isMissing(e)) return null
        throw e
      }
    },

    async head(bucket, key) {
      const { sdk, client } = await connect()
      try {
        const out = await client.send(new sdk.HeadObjectCommand(where(bucket, key)))
        return {
          key,
          size: Number(out.ContentLength ?? 0),
          contentType: out.ContentType ?? null,
          etag: out.ETag?.replace(/"/g, '') ?? null,
          lastModified: out.LastModified?.toISOString() ?? null,
          cacheControl: out.CacheControl ?? null,
        }
      } catch (e) {
        if (isMissing(e)) return null
        throw e
      }
    },

    async delete(bucket, keys) {
      if (keys.length === 0) return
      const { sdk, client } = await connect()
      const targets = keys.map((key) => where(bucket, key))
      for (let i = 0; i < targets.length; i += 1000) {
        const chunk = targets.slice(i, i + 1000)
        const out = await client.send(new sdk.DeleteObjectsCommand({
          Bucket: chunk[0].Bucket,
          Delete: { Objects: chunk.map((t) => ({ Key: t.Key })), Quiet: true },
        }))
        const failed = (out.Errors ?? []).filter((err) => err.Code !== 'NoSuchKey')
        if (failed.length) throw new Error(`Delete failed for ${failed.length} object(s): ${failed[0].Message ?? failed[0].Code}`)
      }
    },

    async list(bucket, prefix, opts = {}) {
      const { sdk, client } = await connect()
      const location = bucketLocation(bucket, options)
      const out = await client.send(new sdk.ListObjectsV2Command({
        Bucket: location.container,
        Prefix: `${location.keyPrefix}${prefix}`,
        MaxKeys: listLimit(opts),
        ContinuationToken: opts.cursor ?? undefined,
      }))
      const objects: StoredObjectInfo[] = (out.Contents ?? []).map((o) => ({
        key: String(o.Key).slice(location.keyPrefix.length),
        size: Number(o.Size ?? 0),
        contentType: null,
        etag: o.ETag?.replace(/"/g, '') ?? null,
        lastModified: o.LastModified?.toISOString() ?? null,
        cacheControl: null,
      }))
      return { objects, cursor: out.IsTruncated ? out.NextContinuationToken ?? null : null }
    },

    publicUrl(bucket, key) {
      return providerPublicUrl(bucket, key, options)
    },

    async signedUrl(bucket, key, ttlSeconds) {
      const { sdk, client } = await connect()
      const { getSignedUrl } = await loadOptionalSdk('@aws-sdk/s3-request-presigner', () => import('@aws-sdk/s3-request-presigner'))
      return getSignedUrl(client, new sdk.GetObjectCommand(where(bucket, key)), { expiresIn: Math.max(1, Math.min(Math.floor(ttlSeconds), 604800)) })
    },

    /** Presigned PUT (the bucket's CORS must allow PUT from the app's origin). */
    async createUploadUrl(bucket, key, opts) {
      const { sdk, client } = await connect()
      const { getSignedUrl } = await loadOptionalSdk('@aws-sdk/s3-request-presigner', () => import('@aws-sdk/s3-request-presigner'))
      const contentType = opts.contentType || 'application/octet-stream'
      const url = await getSignedUrl(client, new sdk.PutObjectCommand({ ...where(bucket, key), ContentType: contentType }), {
        expiresIn: Math.max(1, Math.min(Math.floor(opts.ttlSeconds), 604800)),
      })
      return { url, method: 'PUT' as const, headers: { 'Content-Type': contentType } }
    },

    async copy(bucket, fromKey, toKey, opts = {}) {
      const { sdk, client } = await connect()
      const from = where(bucket, fromKey)
      const to = where(opts.toBucket ?? bucket, toKey)
      if (!opts.upsert && await provider.head(opts.toBucket ?? bucket, toKey)) throw new StorageObjectExistsError(opts.toBucket ?? bucket, toKey)
      try {
        await client.send(new sdk.CopyObjectCommand({ ...to, CopySource: `${from.Bucket}/${from.Key.split('/').map(encodeURIComponent).join('/')}` }))
      } catch (e: any) {
        // Some S3-compatible stores lack server-side copy across buckets: fall back to read + write.
        if (e?.$metadata?.httpStatusCode !== 501) throw e
        const source = await provider.get(bucket, fromKey)
        if (!source) throw new Error(`The object ${bucket}/${fromKey} does not exist`)
        await provider.put(opts.toBucket ?? bucket, toKey, await readAll(source.body), { contentType: source.contentType ?? undefined, upsert: true })
      }
    },

    async ensureBucket(bucket) {
      const { sdk, client } = await connect()
      const { container } = bucketLocation(bucket, options)
      try {
        await client.send(new sdk.HeadBucketCommand({ Bucket: container }))
      } catch (e) {
        if (!isMissing(e)) throw e
        await client.send(new sdk.CreateBucketCommand({ Bucket: container }))
      }
    },
  }
  return provider
}
