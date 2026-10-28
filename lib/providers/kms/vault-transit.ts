import { createVaultClient, vaultErrors, type VaultClientDeps } from '../secrets/vault-client'
import { kmsOption, type KmsOptions } from './options'
import { bindContext, describeError, KmsError, unbindContext, type KmsProvider } from './types'

/**
 * vault_transit: HashiCorp Vault / OpenBao Transit secrets engine
 * (`transit/encrypt/<key>`, `transit/decrypt/<key>`), over the same HTTP
 * client and auth (token, AppRole, Kubernetes; namespaces) as the Vault
 * secret store. The key never leaves Vault; rotating it in Vault
 * (`vault write -f transit/keys/<key>/rotate`) is picked up by
 * `usertasks-admin kms rewrap-keys`, which re-wraps every data key with the
 * newest key version; older versions keep decrypting until Vault's
 * min_decryption_version is raised.
 *
 * The app's policy needs update on transit/encrypt/<key> and
 * transit/decrypt/<key>.
 */

export function createVaultTransitKmsProvider(options: KmsOptions, deps: VaultClientDeps = {}): KmsProvider {
  const key = kmsOption(options, 'vault_transit_key')
  const mount = (kmsOption(options, 'vault_transit_mount') ?? 'transit').replace(/^\/+|\/+$/g, '')
  const client = createVaultClient(options, deps, 'KMS_PROVIDER=vault_transit')
  const keyPath = () => {
    if (!key) throw new KmsError('KMS_PROVIDER=vault_transit requires VAULT_TRANSIT_KEY')
    return encodeURIComponent(key)
  }

  async function post(op: 'encrypt' | 'decrypt' | 'rewrap', body: Record<string, string>) {
    let res
    try {
      res = await client.request('POST', `${mount}/${op}/${keyPath()}`, body)
    } catch (error) {
      if (error instanceof KmsError) throw error
      throw new KmsError(describeError(error))
    }
    if (!res.ok) throw new KmsError(`Vault Transit ${op} with key "${key}" failed (${res.status})${vaultErrors(res.json)}`)
    return res.json as { data?: { ciphertext?: string; plaintext?: string } }
  }

  return {
    id: 'vault_transit',
    onPrem: true,
    describe: () => `Vault Transit key ${mount}/${key ?? '(VAULT_TRANSIT_KEY not set)'} at ${client.addr ?? '(VAULT_ADDR not set)'}`,
    async wrap(dek, context) {
      const json = await post('encrypt', { plaintext: bindContext(dek, context).toString('base64') })
      const ciphertext = json.data?.ciphertext
      if (!ciphertext) throw new KmsError('Vault Transit returned no ciphertext')
      return { wrapped: ciphertext, kekRef: `vault_transit:${mount}/${key}` }
    },
    async unwrap({ wrapped }, context) {
      const json = await post('decrypt', { ciphertext: wrapped })
      const plaintext = json.data?.plaintext
      if (!plaintext) throw new KmsError('Vault Transit returned no plaintext')
      return unbindContext(Buffer.from(plaintext, 'base64'), context)
    },
  }
}
