import { getProviderConfig } from '@/lib/config'
import { readEnv } from '@/lib/config/bootstrap'
import { isSecretRef, resolveSecretRef } from '@/lib/config/secret-refs'
import { installEncryptionKey } from '@/lib/secret-crypto'
import { secretOption } from './options'
import { secretStoreFor } from './index'
import type { SecretStore } from './types'

/**
 * ENCRYPTION_KEY bootstrap, run once at startup (instrumentation.ts, the
 * worker): environment first, then the secret store.
 *
 *  1. ENCRYPTION_KEY set to a key: used as is (nothing to do).
 *  2. ENCRYPTION_KEY=secret://<name>[#field]: read from the configured store;
 *     failure is fatal (the app must not start encrypting with no key).
 *  3. ENCRYPTION_KEY unset and an external store (not env / db — db needs
 *     the key to decrypt itself): looked up as secrets.encryption_key_name
 *     (default `encryption_key`). Not found keeps today's behaviour without a
 *     key (stored secrets stay plaintext) and logs a warning; a store error
 *     is fatal.
 *
 * Envelope encryption (a KMS-wrapped data key: AWS KMS, Azure Key Vault
 * keys, Google Cloud KMS, Vault Transit) is a planned follow-up; today the
 * store holds the 32-byte key itself.
 */

export type EncryptionKeySource = 'env' | 'secret_ref' | 'secret_store' | 'none'

export async function bootstrapEncryptionKey(deps: { store?: SecretStore; log?: (message: string) => void } = {}): Promise<EncryptionKeySource> {
  const log = deps.log ?? ((message: string) => console.warn(`[secrets] ${message}`))
  const raw = readEnv('ENCRYPTION_KEY')?.trim()
  if (raw && !isSecretRef(raw)) return 'env'

  const config = await getProviderConfig('secrets')
  const store = deps.store ?? secretStoreFor(config.id, config.options)

  if (raw) {
    // Resolution errors are ConfigErrors naming the secret and the store, never a value.
    const value = await resolveSecretRef(raw, store, { label: 'ENCRYPTION_KEY', ttlMs: 0 })
    installEncryptionKey(value.trim())
    return 'secret_ref'
  }

  if (store.id === 'env' || store.id === 'db') return 'none'
  const name = secretOption(config.options, 'encryption_key_name') ?? 'encryption_key'
  const value = await store.get(name)
  if (!value) {
    log(`ENCRYPTION_KEY is not set and "${name}" was not found in the ${store.id} secret store; stored secrets stay unencrypted`)
    return 'none'
  }
  installEncryptionKey(value.trim())
  return 'secret_store'
}
