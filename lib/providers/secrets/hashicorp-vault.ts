import { secretOption, type SecretStoreOptions } from './options'
import { SecretStoreError, assertSecretName, type SecretStore } from './types'
import { createVaultClient, vaultErrors, type VaultClientDeps } from './vault-client'

/**
 * HashiCorp Vault / OpenBao, KV secrets engine v2, over the HTTP API (no SDK).
 *
 * A name is a path under the mount: `secret://usertasks/smtp#password`
 * reads field `password` of `<mount>/data/<name_prefix>usertasks/smtp`.
 * Without a field the secret's `value` key is used, or its only key.
 *
 * Auth (token, AppRole, Kubernetes), namespaces and login reuse: see
 * ./vault-client (shared with the Vault Transit KMS provider).
 */

export { K8S_TOKEN_PATH } from './vault-client'

export type VaultStoreDeps = VaultClientDeps

export function createHashicorpVaultSecretStore(options: SecretStoreOptions, deps: VaultStoreDeps = {}): SecretStore {
  const client = createVaultClient(options, deps)
  const mount = (secretOption(options, 'vault_mount') ?? 'secret').replace(/^\/+|\/+$/g, '')
  const prefix = secretOption(options, 'name_prefix') ?? ''

  async function readSecret(name: string): Promise<Record<string, unknown> | undefined> {
    assertSecretName(name)
    const path = `${mount}/data/${`${prefix}${name}`.split('/').map(encodeURIComponent).join('/')}`
    const res = await client.request('GET', path)
    if (res.status === 404) return undefined
    if (!res.ok) throw new SecretStoreError(`Vault read of "${name}" failed (${res.status})${vaultErrors(res.json)}`)
    // A deleted (soft-deleted) version has data: null.
    return (res.json as { data?: { data?: Record<string, unknown> | null } } | null)?.data?.data ?? undefined
  }

  const asString = (value: unknown) => (value === undefined || value === null ? undefined : typeof value === 'string' ? value : JSON.stringify(value))

  return {
    id: 'hashicorp_vault',
    onPrem: true,
    async get(name) {
      const data = await readSecret(name)
      if (!data) return undefined
      if ('value' in data) return asString(data.value)
      const keys = Object.keys(data)
      if (keys.length === 1) return asString(data[keys[0]])
      throw new SecretStoreError(`Vault secret "${name}" has several keys (${keys.join(', ')}): name one with secret://${name}#<key>`)
    },
    async getField(name, field) {
      const data = await readSecret(name)
      return data ? asString(data[field]) : undefined
    },
  }
}
