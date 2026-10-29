import { Readable } from 'node:stream'
import { assertSafeKey } from '@/lib/storage/buckets'
import { bucketLocation, optionString, type StorageOptions } from './options'
import { loadOptionalSdk } from './optional-sdk'
import { providerPublicUrl } from './urls'
import {
  StorageObjectExistsError, cacheControlHeader, listLimit, readAll, toBytes,
  type StorageProvider, type StoredObjectInfo,
} from './types'

/**
 * Azure Blob Storage via @azure/storage-blob (optional dependency, loaded on
 * first use). Each logical bucket is a container (or a prefix in one
 * container: shared bucket mapping in ./options).
 *
 * Authentication, first match wins:
 *  - azure_connection_string                       (AZURE_STORAGE_CONNECTION_STRING)
 *  - azure_account_name + azure_account_key        shared key
 *  - azure_account_name + azure_sas_token          SAS (account or container scope)
 *  - azure_account_name alone                      Microsoft Entra ID via
 *    DefaultAzureCredential (@azure/identity): managed identity, workload
 *    identity, Azure CLI, environment credentials
 * azure_endpoint overrides `https://<account>.blob.core.windows.net` (Azurite,
 * sovereign clouds, private endpoints).
 *
 * signedUrl(): a blob SAS signed with the account key, or a user-delegation
 * SAS under Entra ID. Not available with a pre-issued SAS token.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- SDK error / credential shapes */

type BlobModule = typeof import('@azure/storage-blob')

function isMissing(e: any): boolean {
  return e?.statusCode === 404 || e?.code === 'BlobNotFound' || e?.code === 'ContainerNotFound'
}

export function createAzureBlobStorageProvider(options: StorageOptions): StorageProvider {
  let servicePromise: Promise<{ sdk: BlobModule; service: InstanceType<BlobModule['BlobServiceClient']>; sharedKey: any; entra: boolean }> | null = null

  function connect() {
    servicePromise ??= (async () => {
      const sdk = await loadOptionalSdk('@azure/storage-blob', () => import('@azure/storage-blob'))
      const connectionString = optionString(options, 'azure_connection_string')
      if (connectionString) {
        const service = sdk.BlobServiceClient.fromConnectionString(connectionString)
        return { sdk, service, sharedKey: (service as any).credential instanceof sdk.StorageSharedKeyCredential ? (service as any).credential : null, entra: false }
      }
      const account = optionString(options, 'azure_account_name')
      if (!account) throw new Error('The azure_blob storage provider needs AZURE_STORAGE_CONNECTION_STRING or AZURE_STORAGE_ACCOUNT')
      const endpoint = (optionString(options, 'azure_endpoint') ?? `https://${account}.blob.core.windows.net`).replace(/\/+$/, '')
      const key = optionString(options, 'azure_account_key')
      if (key) {
        const sharedKey = new sdk.StorageSharedKeyCredential(account, key)
        return { sdk, service: new sdk.BlobServiceClient(endpoint, sharedKey), sharedKey, entra: false }
      }
      const sas = optionString(options, 'azure_sas_token')
      if (sas) return { sdk, service: new sdk.BlobServiceClient(`${endpoint}?${sas.replace(/^\?/, '')}`), sharedKey: null, entra: false }
      const { DefaultAzureCredential } = await import('@azure/identity')
      return { sdk, service: new sdk.BlobServiceClient(endpoint, new DefaultAzureCredential()), sharedKey: null, entra: true }
    })()
    return servicePromise
  }

  async function blob(bucket: string, key: string) {
    assertSafeKey(key)
    const { service } = await connect()
    const location = bucketLocation(bucket, options)
    return service.getContainerClient(location.container).getBlockBlobClient(`${location.keyPrefix}${key}`)
  }

  const provider: StorageProvider = {
    id: 'azure_blob',
    onPrem: false,

    async put(bucket, key, body, opts = {}) {
      const client = await blob(bucket, key)
      try {
        await client.uploadData(await toBytes(body), {
          blobHTTPHeaders: {
            blobContentType: opts.contentType || undefined,
            blobCacheControl: opts.cacheControl !== undefined ? cacheControlHeader(opts.cacheControl) : undefined,
          },
          ...(opts.upsert ? {} : { conditions: { ifNoneMatch: '*' } }),
        })
      } catch (e: any) {
        if (!opts.upsert && (e?.statusCode === 409 || e?.statusCode === 412)) throw new StorageObjectExistsError(bucket, key)
        throw e
      }
    },

    async get(bucket, key) {
      const client = await blob(bucket, key)
      try {
        const out = await client.download()
        const stream = out.readableStreamBody
        if (!stream) return null
        return {
          key,
          size: Number(out.contentLength ?? 0),
          contentType: out.contentType ?? null,
          etag: out.etag?.replace(/"/g, '') ?? null,
          lastModified: out.lastModified?.toISOString() ?? null,
          cacheControl: out.cacheControl ?? null,
          body: Readable.toWeb(stream as Readable) as unknown as ReadableStream<Uint8Array>,
        }
      } catch (e) {
        if (isMissing(e)) return null
        throw e
      }
    },

    async head(bucket, key) {
      const client = await blob(bucket, key)
      try {
        const out = await client.getProperties()
        return {
          key,
          size: Number(out.contentLength ?? 0),
          contentType: out.contentType ?? null,
          etag: out.etag?.replace(/"/g, '') ?? null,
          lastModified: out.lastModified?.toISOString() ?? null,
          cacheControl: out.cacheControl ?? null,
        }
      } catch (e) {
        if (isMissing(e)) return null
        throw e
      }
    },

    async delete(bucket, keys) {
      for (const key of keys) {
        const client = await blob(bucket, key)
        try {
          await client.deleteIfExists()
        } catch (e) {
          if (!isMissing(e)) throw e
        }
      }
    },

    async list(bucket, prefix, opts = {}) {
      const { service } = await connect()
      const location = bucketLocation(bucket, options)
      const container = service.getContainerClient(location.container)
      const pages = container.listBlobsFlat({ prefix: `${location.keyPrefix}${prefix}` })
        .byPage({ maxPageSize: listLimit(opts), continuationToken: opts.cursor ?? undefined })
      let page
      try {
        page = (await pages.next()).value
      } catch (e) {
        if (isMissing(e)) return { objects: [], cursor: null }
        throw e
      }
      const objects: StoredObjectInfo[] = (page?.segment?.blobItems ?? []).map((item: any) => ({
        key: String(item.name).slice(location.keyPrefix.length),
        size: Number(item.properties?.contentLength ?? 0),
        contentType: item.properties?.contentType ?? null,
        etag: item.properties?.etag?.replace(/"/g, '') ?? null,
        lastModified: item.properties?.lastModified?.toISOString?.() ?? null,
        cacheControl: item.properties?.cacheControl ?? null,
      }))
      return { objects, cursor: page?.continuationToken || null }
    },

    publicUrl(bucket, key) {
      return providerPublicUrl(bucket, key, options)
    },

    async signedUrl(bucket, key, ttlSeconds) {
      const { sdk, service, sharedKey, entra } = await connect()
      const client = await blob(bucket, key)
      const startsOn = new Date(Date.now() - 60_000)
      const expiresOn = new Date(Date.now() + Math.max(1, Math.min(Math.floor(ttlSeconds), 7 * 24 * 3600)) * 1000)
      const permissions = sdk.BlobSASPermissions.parse('r')
      if (sharedKey) {
        const sas = sdk.generateBlobSASQueryParameters({ containerName: client.containerName, blobName: client.name, permissions, startsOn, expiresOn }, sharedKey)
        return `${client.url}?${sas.toString()}`
      }
      if (entra) {
        const delegationKey = await service.getUserDelegationKey(startsOn, expiresOn)
        const accountName = new URL(client.url).hostname.split('.')[0]
        const sas = sdk.generateBlobSASQueryParameters({ containerName: client.containerName, blobName: client.name, permissions, startsOn, expiresOn }, delegationKey, accountName)
        return `${client.url.split('?')[0]}?${sas.toString()}`
      }
      throw new Error('azure_blob signed URLs need an account key or Entra ID (a pre-issued SAS token cannot sign)')
    },

    /** A create/write blob SAS (the account's CORS must allow PUT from the app's origin). */
    async createUploadUrl(bucket, key, opts) {
      const { sdk, service, sharedKey, entra } = await connect()
      const client = await blob(bucket, key)
      const startsOn = new Date(Date.now() - 60_000)
      const expiresOn = new Date(Date.now() + Math.max(1, Math.min(Math.floor(opts.ttlSeconds), 7 * 24 * 3600)) * 1000)
      const permissions = sdk.BlobSASPermissions.parse('cw')
      let sas: string
      if (sharedKey) sas = sdk.generateBlobSASQueryParameters({ containerName: client.containerName, blobName: client.name, permissions, startsOn, expiresOn }, sharedKey).toString()
      else if (entra) {
        const delegationKey = await service.getUserDelegationKey(startsOn, expiresOn)
        const accountName = new URL(client.url).hostname.split('.')[0]
        sas = sdk.generateBlobSASQueryParameters({ containerName: client.containerName, blobName: client.name, permissions, startsOn, expiresOn }, delegationKey, accountName).toString()
      } else throw new Error('azure_blob direct uploads need an account key or Entra ID')
      return { url: `${client.url.split('?')[0]}?${sas}`, method: 'PUT' as const, headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': opts.contentType || 'application/octet-stream' } }
    },

    async copy(bucket, fromKey, toKey, opts = {}) {
      const toBucket = opts.toBucket ?? bucket
      if (!opts.upsert && await provider.head(toBucket, toKey)) throw new StorageObjectExistsError(toBucket, toKey)
      const source = await provider.get(bucket, fromKey)
      if (!source) throw new Error(`The object ${bucket}/${fromKey} does not exist`)
      await provider.put(toBucket, toKey, await readAll(source.body), {
        contentType: source.contentType ?? undefined,
        cacheControl: source.cacheControl ?? undefined,
        upsert: true,
      })
    },

    async ensureBucket(bucket) {
      const { service } = await connect()
      await service.getContainerClient(bucketLocation(bucket, options).container).createIfNotExists()
    },
  }
  return provider
}
