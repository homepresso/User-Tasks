/**
 * Auth operations (until the admin CLI's `switch auth` lands).
 *
 * Usage:
 *   npm run auth -- migrate-users [--dry-run] [--map google=oidc:google,azure=oidc:entra]
 *   npm run auth -- redirect-uris
 *
 * migrate-users copies Supabase Auth accounts (auth.users, auth.identities)
 * into the built-in auth store with the same ids and bcrypt hashes, so people
 * keep their passwords (lib/auth/migrate.ts). Idempotent; --dry-run reports
 * without writing. Run it before setting AUTH_PROVIDER=builtin (and again
 * just before the switch to pick up accounts created meanwhile).
 *
 * redirect-uris prints the URLs to register at each configured IdP.
 *
 * Needs a direct database connection: AUTH_DATABASE_URL or DATABASE_URL
 * (postgres on Supabase: it reads auth.*).
 */
import { Pool } from 'pg'
import { getProviderConfig } from '../lib/config'
import { appUrlOrLocalhost, databaseUrl, readEnv } from '../lib/config/bootstrap'
import { formatMigrationReport, migrateSupabaseUsers } from '../lib/auth/migrate'
import { poolAuthDb } from '../lib/providers/auth/builtin/db'
import { parseSsoProviders } from '../lib/providers/auth/sso/config'
import { pgConnectionConfig } from '../lib/providers/db/pg-auth'

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return undefined
  const value = process.argv[index + 1]
  return value && !value.startsWith('--') ? value : ''
}

async function main() {
  const command = process.argv[2]
  if (command === 'redirect-uris') {
    const origin = appUrlOrLocalhost().replace(/\/+$/, '')
    const idps = parseSsoProviders((await getProviderConfig('auth')).options.sso_providers)
    if (idps.length === 0) console.log('No AUTH_SSO_PROVIDERS configured.')
    for (const idp of idps) {
      if (idp.type === 'oidc') console.log(`${idp.id} (OIDC)  redirect URI: ${origin}/auth/sso/${idp.id}/callback`)
      else console.log(`${idp.id} (SAML)  ACS: ${origin}/auth/saml/${idp.id}/acs  entity id / metadata: ${idp.spEntityId ?? `${origin}/auth/saml/${idp.id}/metadata`}`)
    }
    return
  }
  if (command !== 'migrate-users') {
    console.error('Usage: npm run auth -- migrate-users [--dry-run] [--map google=oidc:google,…] | redirect-uris')
    process.exit(2)
  }
  const url = readEnv('AUTH_DATABASE_URL') || databaseUrl()
  if (!url) {
    console.error('Set DATABASE_URL (or AUTH_DATABASE_URL) to the database that holds auth.users.')
    process.exit(2)
  }
  const map = Object.fromEntries((arg('map') ?? '').split(',').filter(Boolean).map((pair) => pair.split('=').map((s) => s.trim()) as [string, string]))
  const pool = new Pool(pgConnectionConfig(url, { max: 2, application_name: 'usertasks-auth-migrate' }))
  try {
    const report = await migrateSupabaseUsers({ db: poolAuthDb(pool), dryRun: process.argv.includes('--dry-run'), identityProviders: map })
    console.log(formatMigrationReport(report))
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(`auth: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
