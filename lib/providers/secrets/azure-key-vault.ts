import { DefaultAzureCredential } from '@azure/identity'
import { secretOption, type SecretStoreOptions } from './options'
import { SecretStoreError, describeError, loadSecretsSdk, type SecretStore } from './types'

/**
 * Azure Key Vault secrets (@azure/keyvault-secrets, an optional dependency)
 * with Microsoft Entra ID via DefaultAzureCredential: managed identity on
 * Container Apps / App Service / AKS (workload identity), or AZURE_TENANT_ID
 * + AZURE_CLIENT_ID + AZURE_CLIENT_SECRET. The identity needs "Key Vault
 * Secrets User" (RBAC) or a get-secret access policy.
 *
 * Key Vault names allow letters, digits and dashes only: `_`, `.` and `/`
 * in a name become `-` (secret://smtp_password → smtp-password).
 */

export function keyVaultName(name: string): string {
  const mapped = name.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  if (!/^[A-Za-z0-9-]{1,127}$/.test(mapped)) throw new SecretStoreError(`Invalid Key Vault secret name "${name.slice(0, 80)}"`)
  return mapped
}

type SecretClientLike = { getSecret(name: string): Promise<{ value?: string }> }

export interface KeyVaultDeps {
  client?: SecretClientLike
}

export function createAzureKeyVaultSecretStore(options: SecretStoreOptions, deps: KeyVaultDeps = {}): SecretStore {
  const url = secretOption(options, 'azure_key_vault_url')
  const prefix = secretOption(options, 'name_prefix') ?? ''
  let client: SecretClientLike | undefined = deps.client
  return {
    id: 'azure_key_vault',
    onPrem: false,
    async get(name) {
      if (!client) {
        if (!url) throw new SecretStoreError('SECRETS_PROVIDER=azure_key_vault requires AZURE_KEY_VAULT_URL')
        const { SecretClient } = await loadSecretsSdk('@azure/keyvault-secrets', 'azure_key_vault', () => import('@azure/keyvault-secrets'))
        client = new SecretClient(url, new DefaultAzureCredential())
      }
      try {
        const secret = await client.getSecret(keyVaultName(`${prefix}${name}`))
        return secret.value === undefined || secret.value === '' ? undefined : secret.value
      } catch (error) {
        const e = error as { statusCode?: number; code?: string }
        if (e.statusCode === 404 || e.code === 'SecretNotFound') return undefined
        if (error instanceof SecretStoreError) throw error
        throw new SecretStoreError(`Azure Key Vault: ${describeError(error)}`)
      }
    },
  }
}
