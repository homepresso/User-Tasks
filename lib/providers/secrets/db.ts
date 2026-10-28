import { loadInstanceSettings } from '@/lib/config/instance-settings'
import { SECRETS_OPTION_ENV } from './options'
import { SecretStoreError, type SecretStore } from './types'

/**
 * Encrypted in Postgres: the `secrets.<name>` row of `instance_settings`,
 * stored as a secret (AES-256-GCM with ENCRYPTION_KEY, see
 * lib/config/instance-settings.ts). Names are normalised to the setting key
 * form (lowercase, `_` for anything else). Option names of the secrets
 * area itself (vault_addr, …) are reserved.
 */

export function dbSecretKey(name: string): string {
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(key)) throw new SecretStoreError(`Invalid secret name "${name.slice(0, 80)}" for the db secret store`)
  if (key in SECRETS_OPTION_ENV) throw new SecretStoreError(`"${key}" is a secrets option name and can't be used as a secret name`)
  return `secrets.${key}`
}

export function createDbSecretStore(): SecretStore {
  return {
    id: 'db',
    onPrem: true,
    async get(name) {
      const value = (await loadInstanceSettings()).get(dbSecretKey(name))
      if (value === undefined || value === null) return undefined
      return typeof value === 'string' ? value : JSON.stringify(value)
    },
  }
}
