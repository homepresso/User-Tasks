import { getProviderConfig } from '@/lib/config'
import { DEFAULT_PROVIDERS, type ProviderId } from '@/lib/config/schema'
import { pickProvider } from '../registry'
import { createAzureBlobStorageProvider } from './azure-blob'
import { createGcsStorageProvider } from './gcs'
import { createLocalStorageProvider } from './local'
import type { StorageOptions } from './options'
import { createS3StorageProvider } from './s3'
import { createSupabaseStorageProvider, supabaseStorageProvider, type SupabaseStorageClient } from './supabase'
import type { StorageProvider } from './types'

/**
 * StorageProvider: object storage for uploads (logos, brand fonts, data-table
 * files, workflow documents). Server only; the browser never talks to the
 * store (uploads go through server actions, downloads through public URLs
 * or the /files route).
 *
 *  - supabase (default)  Supabase Storage, as before
 *  - s3                  AWS S3 and S3-compatible stores (MinIO, Ceph, R2, …)
 *  - local               filesystem / NFS / SMB volume
 *  - azure_blob          Azure Blob Storage (key, SAS or Entra ID)
 *  - gcs                 Google Cloud Storage (service account or ADC)
 *
 * Selected by STORAGE_PROVIDER or the `providers.storage` instance setting;
 * options in ./options. The cloud SDKs are optional dependencies loaded on
 * first use. Persisted references use `storage://bucket/key`
 * (lib/storage/refs.ts).
 */

export type { StorageProvider, StorageObject, StoredObjectInfo, PutOptions, ListResult, StorageBody } from './types'
export { StorageObjectExistsError } from './types'
export { supabaseStorageProvider }

export function resolveStorageProvider(id: ProviderId<'storage'> = DEFAULT_PROVIDERS.storage, options: StorageOptions = {}): StorageProvider {
  return pickProvider('storage', id, {
    supabase: () => supabaseStorageProvider,
    s3: () => createS3StorageProvider(options),
    local: () => createLocalStorageProvider(options),
    azure_blob: () => createAzureBlobStorageProvider(options),
    gcs: () => createGcsStorageProvider(options),
  })
}

// One instance per configuration (SDK clients are reused across requests).
let cached: { signature: string; provider: StorageProvider } | null = null

export async function getStorageProvider(): Promise<StorageProvider> {
  const config = await getProviderConfig('storage')
  const signature = JSON.stringify([config.id, config.options])
  if (cached?.signature === signature) return cached.provider
  const provider = resolveStorageProvider(config.id, config.options)
  cached = { signature, provider }
  return provider
}

/**
 * The configured provider's id, without constructing it (no SDK load, no
 * option validation): enough to decide how a reference is persisted.
 */
export async function getStorageProviderId(): Promise<ProviderId<'storage'>> {
  return (await getProviderConfig('storage')).id
}

/**
 * The configured provider, bound to a caller's service-role client when it is
 * Supabase Storage: services keep using their context's client (as before
 * the provider existed); other providers ignore it.
 */
export async function getStorageProviderFor(client: SupabaseStorageClient): Promise<StorageProvider> {
  const provider = await getStorageProvider()
  return provider.id === 'supabase' ? createSupabaseStorageProvider(() => client) : provider
}
