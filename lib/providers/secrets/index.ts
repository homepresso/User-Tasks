import { getProviderConfig } from '@/lib/config'
import { DEFAULT_PROVIDERS, type ProviderId } from '@/lib/config/schema'
import { pickProvider } from '../registry'
import { createAwsSecretsManagerStore } from './aws-secrets-manager'
import { createAzureKeyVaultSecretStore } from './azure-key-vault'
import { createDbSecretStore } from './db'
import { createEnvSecretStore, envSecretStore } from './env'
import { createGcpSecretManagerStore } from './gcp-secret-manager'
import { createHashicorpVaultSecretStore } from './hashicorp-vault'
import type { SecretStoreOptions } from './options'
import { createSupabaseVaultSecretStore } from './supabase-vault'
import type { SecretStore as BaseSecretStore } from './types'

/**
 * SecretStore: where named instance secrets live — credentials for the
 * other providers (storage keys, SMTP passwords, API keys …) and, optionally,
 * ENCRYPTION_KEY itself. Any provider option can name one with a
 * `secret://<name>[#field]` reference; lib/config resolves references at
 * runtime with a TTL cache (lib/config/secret-refs.ts).
 *
 *  - env (default)        environment variables, `<VAR>_FILE`, a secrets directory
 *  - db                   encrypted `secrets.<name>` instance settings
 *  - supabase_vault       Supabase Vault (vault.decrypted_secrets)
 *  - hashicorp_vault      HashiCorp Vault / OpenBao KV v2 (token, AppRole, Kubernetes)
 *  - azure_key_vault      Azure Key Vault (managed identity)
 *  - gcp_secret_manager   Google Secret Manager (workload identity / ADC)
 *  - aws_secrets_manager  AWS Secrets Manager (IAM role)
 */

export type SecretStore = BaseSecretStore & { readonly id: ProviderId<'secrets'> }
export { envSecretStore }
export { SecretStoreError } from './types'

export function resolveSecretStore(id: ProviderId<'secrets'> = DEFAULT_PROVIDERS.secrets, options: SecretStoreOptions = {}): SecretStore {
  return pickProvider<'secrets', BaseSecretStore>('secrets', id, {
    env: () => (Object.keys(options).length ? createEnvSecretStore(options) : envSecretStore),
    db: () => createDbSecretStore(),
    supabase_vault: () => createSupabaseVaultSecretStore(options),
    hashicorp_vault: () => createHashicorpVaultSecretStore(options),
    azure_key_vault: () => createAzureKeyVaultSecretStore(options),
    gcp_secret_manager: () => createGcpSecretManagerStore(options),
    aws_secrets_manager: () => createAwsSecretsManagerStore(options),
  }) as SecretStore
}

// One instance per configuration (logins and SDK clients are reused).
let cached: { signature: string; store: SecretStore } | null = null

/** The store for a secrets provider config (cached by id + options). */
export function secretStoreFor(id: ProviderId<'secrets'>, options: SecretStoreOptions): SecretStore {
  const signature = JSON.stringify([id, options])
  if (cached?.signature !== signature) cached = { signature, store: resolveSecretStore(id, options) }
  return cached.store
}

export async function getSecretStore(): Promise<SecretStore> {
  const config = await getProviderConfig('secrets')
  return secretStoreFor(config.id, config.options)
}
