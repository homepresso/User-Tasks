import { Client } from 'pg'
import { databaseUrl } from '@/lib/config/bootstrap'
import { secretOption, type SecretStoreOptions } from './options'
import { SecretStoreError, describeError, type SecretStore } from './types'

/**
 * Supabase Vault: `vault.decrypted_secrets` by name, over a direct database
 * connection (database_url, else DATABASE_URL) with a role allowed to read
 * it (postgres). PostgREST does not expose the vault schema, so the
 * service-role key alone is not enough.
 */

export function createSupabaseVaultSecretStore(options: SecretStoreOptions = {}): SecretStore {
  return {
    id: 'supabase_vault',
    onPrem: true,
    async get(name) {
      const url = secretOption(options, 'database_url') ?? databaseUrl()
      if (!url) throw new SecretStoreError('SECRETS_PROVIDER=supabase_vault requires DATABASE_URL (or SECRETS_DATABASE_URL)')
      const client = new Client({ connectionString: url, application_name: 'usertasks-secrets', connectionTimeoutMillis: 10_000 })
      client.on('error', () => undefined)
      try {
        await client.connect()
        const { rows } = await client.query<{ value: string | null }>('SELECT decrypted_secret AS value FROM vault.decrypted_secrets WHERE name = $1 LIMIT 1', [name])
        const value = rows[0]?.value
        return value === null || value === undefined || value === '' ? undefined : value
      } catch (error) {
        throw new SecretStoreError(`Supabase Vault: ${describeError(error)}`)
      } finally {
        await client.end().catch(() => undefined)
      }
    },
  }
}
