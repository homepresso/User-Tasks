import { getProviderConfig } from '@/lib/config'
import { DEFAULT_PROVIDERS, type ProviderId } from '@/lib/config/schema'
import { pickProvider } from '../registry'
import { createAwsKmsProvider } from './aws-kms'
import { createAzureKeyVaultKmsProvider } from './azure-key-vault'
import { createEnvKmsProvider } from './env'
import { createGcpKmsProvider } from './gcp-kms'
import type { KmsOptions } from './options'
import type { KmsProvider as BaseKmsProvider } from './types'
import { createVaultTransitKmsProvider } from './vault-transit'

/**
 * KMS provider: the key-encryption key that wraps the data keys secrets at
 * rest are encrypted with (envelope encryption; lib/secret-crypto `enc:v2:`).
 *
 *  - env (default)     ENCRYPTION_KEY — and without data keys, today's enc:v1
 *  - vault_transit     HashiCorp Vault / OpenBao Transit
 *  - aws_kms           AWS KMS
 *  - azure_key_vault   Azure Key Vault keys / Managed HSM
 *  - gcp_kms           Google Cloud KMS (incl. Cloud HSM / EKM keys)
 *
 * Selected by KMS_PROVIDER or the `providers.kms` instance setting; options
 * in ./options. Data keys: ./keyring (startup unwrap), `usertasks-admin kms`.
 */

export type KmsProvider = BaseKmsProvider & { readonly id: ProviderId<'kms'> }
export { KmsError, dataKeyContext, type WrappedKey } from './types'

export function resolveKmsProvider(id: ProviderId<'kms'> = DEFAULT_PROVIDERS.kms, options: KmsOptions = {}): KmsProvider {
  return pickProvider<'kms', BaseKmsProvider>('kms', id, {
    env: () => createEnvKmsProvider(),
    vault_transit: () => createVaultTransitKmsProvider(options),
    aws_kms: () => createAwsKmsProvider(options),
    azure_key_vault: () => createAzureKeyVaultKmsProvider(options),
    gcp_kms: () => createGcpKmsProvider(options),
  }) as KmsProvider
}

let cached: { signature: string; provider: KmsProvider } | null = null

export function kmsProviderFor(id: ProviderId<'kms'>, options: KmsOptions): KmsProvider {
  const signature = JSON.stringify([id, options])
  if (cached?.signature !== signature) cached = { signature, provider: resolveKmsProvider(id, options) }
  return cached.provider
}

export async function getKmsProvider(): Promise<KmsProvider> {
  const config = await getProviderConfig('kms')
  return kmsProviderFor(config.id, config.options)
}
