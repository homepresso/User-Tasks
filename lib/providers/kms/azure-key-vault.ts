import { DefaultAzureCredential } from '@azure/identity'
import { kmsOption, type KmsOptions } from './options'
import { bindContext, describeError, KmsError, loadKmsSdk, unbindContext, type KmsProvider } from './types'

/**
 * azure_key_vault: a Key Vault or Managed HSM key (@azure/keyvault-keys, an
 * optional dependency) with Microsoft Entra ID through DefaultAzureCredential
 * (managed identity on Container Apps / App Service, AKS workload identity,
 * or AZURE_TENANT_ID + AZURE_CLIENT_ID + AZURE_CLIENT_SECRET). Data keys are
 * wrapped with wrapKey / unwrapKey: RSA-OAEP-256 (default) for RSA keys, or
 * A256KW for Managed HSM AES keys. The wrap result names the key *version*,
 * which is stored with the data key, so rotating the key in Key Vault keeps
 * every existing data key unwrappable; `usertasks-admin kms rewrap-keys`
 * moves them to the newest version.
 *
 * The identity needs the "Key Vault Crypto Service Encryption User" role (or
 * wrapKey / unwrapKey key permissions).
 */

export type AzureKeyAlgorithm = 'RSA-OAEP-256' | 'RSA-OAEP' | 'A256KW'

export interface CryptoClientLike {
  wrapKey(algorithm: string, key: Uint8Array): Promise<{ result: Uint8Array; keyID?: string }>
  unwrapKey(algorithm: string, encryptedKey: Uint8Array): Promise<{ result: Uint8Array }>
}

export interface AzureKmsDeps {
  /** Client for a (versioned or unversioned) key id. */
  client?: (keyId: string) => CryptoClientLike
}

const KEY_URL = /^https:\/\/[^/]+\/keys\/[^/]+(\/[^/]+)?\/?$/

export function createAzureKeyVaultKmsProvider(options: KmsOptions, deps: AzureKmsDeps = {}): KmsProvider {
  const keyId = kmsOption(options, 'azure_key_id')?.replace(/\/+$/, '')
  const algorithm = (kmsOption(options, 'azure_key_algorithm') ?? 'RSA-OAEP-256') as AzureKeyAlgorithm
  if (!['RSA-OAEP-256', 'RSA-OAEP', 'A256KW'].includes(algorithm)) throw new KmsError('AZURE_KMS_KEY_ALGORITHM must be RSA-OAEP-256, RSA-OAEP or A256KW')
  let credential: DefaultAzureCredential | null = null
  const clients = new Map<string, CryptoClientLike>()

  async function clientFor(id: string): Promise<CryptoClientLike> {
    if (!KEY_URL.test(id)) throw new KmsError(`Invalid Key Vault key id "${id.slice(0, 120)}" (https://<vault>.vault.azure.net/keys/<name>[/<version>])`)
    const hit = clients.get(id)
    if (hit) return hit
    let made: CryptoClientLike
    if (deps.client) made = deps.client(id)
    else {
      const { CryptographyClient } = await loadKmsSdk('@azure/keyvault-keys', 'azure_key_vault', () => import('@azure/keyvault-keys'))
      credential ??= new DefaultAzureCredential()
      made = new CryptographyClient(id, credential) as unknown as CryptoClientLike
    }
    clients.set(id, made)
    return made
  }

  return {
    id: 'azure_key_vault',
    onPrem: false,
    describe: () => `Key Vault key ${keyId ?? '(AZURE_KMS_KEY_ID not set)'} (${algorithm})`,
    async wrap(dek, context) {
      if (!keyId) throw new KmsError('KMS_PROVIDER=azure_key_vault requires AZURE_KMS_KEY_ID')
      const client = await clientFor(keyId)
      try {
        const out = await client.wrapKey(algorithm, bindContext(dek, context))
        // keyID is the versioned key that did the wrapping: unwrap must use the same version.
        return { wrapped: Buffer.from(out.result).toString('base64'), kekRef: `${out.keyID ?? keyId}#${algorithm}` }
      } catch (error) {
        throw new KmsError(`Key Vault wrapKey with ${keyId}: ${describeError(error)}`)
      }
    },
    async unwrap({ wrapped, kekRef }, context) {
      const hash = kekRef.lastIndexOf('#')
      const id = hash === -1 ? kekRef : kekRef.slice(0, hash)
      const alg = hash === -1 ? algorithm : kekRef.slice(hash + 1)
      const client = await clientFor(id)
      let bound: Buffer
      try {
        bound = Buffer.from((await client.unwrapKey(alg, Buffer.from(wrapped, 'base64'))).result)
      } catch (error) {
        throw new KmsError(`Key Vault unwrapKey with ${id}: ${describeError(error)}`)
      }
      return unbindContext(bound, context)
    },
  }
}
