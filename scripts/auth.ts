/**
 * Auth operations.
 *
 * Usage:
 *   npm run auth -- redirect-uris
 *
 * migrate-users (Supabase Auth → built-in accounts) moved to the
 * Infrastructure add-on: usertasks-admin switch auth --to builtin.
 *
 * redirect-uris prints the URLs to register at each configured IdP.
 */
import { getProviderConfig } from '../lib/config'
import { appUrlOrLocalhost } from '../lib/config/bootstrap'
import { parseSsoProviders } from '../lib/providers/auth/sso/config'

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
  if (command === 'migrate-users') {
    // Copying Supabase Auth accounts into the built-in store is part of the Infrastructure add-on
    // (usertasks-admin switch auth --to builtin), a paid extension.
    console.error('migrate-users moved to the Infrastructure add-on: usertasks-admin switch auth --to builtin (see /docs/self-hosting/infrastructure-add-on).')
    process.exit(2)
  }
  console.error('Usage: npm run auth -- redirect-uris')
  process.exit(2)
}

main().catch((error) => {
  console.error(`auth: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
