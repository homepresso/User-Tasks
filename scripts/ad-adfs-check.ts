/**
 * Manual check of an Active Directory + AD FS setup from the command line,
 * with the same code the app runs (no database, nothing written):
 *
 *   LDAP   bind as the service account, count users and groups (the LDAP
 *          connection's Test connection), find the login user by UPN,
 *          sAMAccountName and DOMAIN\sAMAccountName and verify their password
 *          with a bind; report whether plain ldap:// simple binds are refused
 *          (LDAP signing).
 *   AD FS  OIDC discovery + signing keys and SAML metadata + certificates
 *          (usertasks-admin doctor's SSO check), for the redirect URI / ACS of
 *          UT_APP_URL.
 *
 * Everything comes from the environment; nothing secret is printed:
 *
 *   AD_LDAP_URL=ldaps://dc1.contoso.com:636   AD_BASE_DN=DC=contoso,DC=com
 *   AD_BIND_DN=svc-usertasks@contoso.com      AD_BIND_PASSWORD=…
 *   AD_CA_FILE=corp-ca.pem                    AD_TLS_NAME=dc1.contoso.com   (optional)
 *   AD_USER_FILTER='(&(objectCategory=person)(objectClass=user)(memberOf:…))'  (optional)
 *   AD_LOGIN=jdoe@contoso.com AD_LOGIN_PASSWORD=…  AD_NETBIOS=CONTOSO         (optional: bind login)
 *   AD_PLAIN_LDAP_URL=ldap://dc1.contoso.com:389                             (optional: signing check)
 *   ADFS_BASE_URL=https://adfs.contoso.com    UT_APP_URL=https://tasks.contoso.com
 *   ADFS_OIDC_CLIENT_ID=…                     (optional: OIDC check)
 *   NODE_EXTRA_CA_CERTS=corp-ca.pem           (AD FS on an internal CA)
 *   ALLOW_PRIVATE_EGRESS=true                 (a DC on a private address)
 *
 *   npx tsx scripts/ad-adfs-check.ts
 *
 * Exit code 1 when a check fails. See docs/services/active-directory.md.
 */
import { readFileSync } from 'node:fs'
import { createLdapClient, verifyLdapPassword } from '../lib/directory-sync/ldap'
import { parseSsoProviders } from '../lib/providers/auth/sso/config'
import { checkSsoProvider } from '../lib/providers/auth/sso/check'

const env = (name: string) => process.env[name]?.trim() || undefined
let failed = false
const line = (status: 'ok' | 'warn' | 'fail' | 'skip', name: string, detail: string) => {
  if (status === 'fail') failed = true
  console.log(`  [${status.padEnd(4)}] ${name.padEnd(22)} ${detail}`)
}
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

async function checkLdap(): Promise<void> {
  console.log('Active Directory (LDAP)')
  const url = env('AD_LDAP_URL')
  if (!url || !env('AD_BIND_DN') || !env('AD_BASE_DN') || !env('AD_BIND_PASSWORD')) {
    line('skip', 'ldap', 'set AD_LDAP_URL, AD_BIND_DN, AD_BIND_PASSWORD and AD_BASE_DN')
    return
  }
  const settings = {
    url,
    flavor: 'active_directory',
    bind_dn: env('AD_BIND_DN'),
    base_dn: env('AD_BASE_DN'),
    ...(env('AD_CA_FILE') ? { ca_cert: readFileSync(env('AD_CA_FILE')!, 'utf8') } : {}),
    ...(env('AD_TLS_NAME') ? { tls_server_name: env('AD_TLS_NAME') } : {}),
    ...(env('AD_USER_FILTER') ? { user_filter: env('AD_USER_FILTER') } : {}),
    ...(env('AD_GROUP_FILTER') ? { group_filter: env('AD_GROUP_FILTER') } : {}),
  }
  const client = createLdapClient({ settings, bindPassword: env('AD_BIND_PASSWORD')! })
  try {
    const result = await client.test()
    line(result.warnings.length ? 'warn' : 'ok', 'connection', `${result.server}: ${result.users} users, ${result.groups} groups, ${result.encrypted ? 'encrypted' : 'NOT encrypted'}${result.warnings.length ? ` — ${result.warnings.join(' ')}` : ''}`)
    const inactive = result.sample.filter((u) => !u.active).length
    line('ok', 'sample', `${result.sample.length} sample entries (${inactive} disabled), ids like ${result.sample[0]?.externalId ?? '—'}`)

    const login = env('AD_LOGIN')
    if (login) {
      const entry = await client.findLoginUser(login)
      if (!entry) line('fail', 'login lookup', `no single enabled entry matches ${login} in the user filter`)
      else {
        line('ok', 'login lookup', `${login} → ${entry.dn} (${entry.email ?? 'no email'})`)
        if (entry.username) {
          const bySam = await client.findLoginUser(entry.username)
          line(bySam?.dn === entry.dn ? 'ok' : 'fail', 'login by sAMAccountName', entry.username)
          if (env('AD_NETBIOS')) {
            const downLevel = `${env('AD_NETBIOS')}\\${entry.username}`
            const byDownLevel = await client.findLoginUser(downLevel)
            line(byDownLevel?.dn === entry.dn ? 'ok' : 'fail', 'login by DOMAIN\\user', downLevel)
          }
        }
        if (env('AD_LOGIN_PASSWORD')) {
          const ok = await verifyLdapPassword({ settings, dn: entry.dn, password: env('AD_LOGIN_PASSWORD')! })
          line(ok ? 'ok' : 'fail', 'password bind', ok ? 'the password is accepted' : 'the directory refused the password')
          const wrong = await verifyLdapPassword({ settings, dn: entry.dn, password: `${env('AD_LOGIN_PASSWORD')}-wrong` })
          line(wrong ? 'fail' : 'ok', 'wrong password', wrong ? 'a wrong password was accepted!' : 'refused')
        }
      }
    }
  } catch (error) {
    line('fail', 'connection', message(error))
  } finally {
    await client.close?.()
  }

  const plain = env('AD_PLAIN_LDAP_URL')
  if (plain) {
    const plainClient = createLdapClient({ settings: { ...settings, url: plain, ca_cert: undefined, tls_server_name: undefined }, bindPassword: env('AD_BIND_PASSWORD')! })
    try {
      await plainClient.verify()
      line('warn', 'LDAP signing', `${plain} accepts simple binds without TLS: require LDAP signing on the domain controllers`)
    } catch (error) {
      const text = message(error)
      line(/LDAP signing/.test(text) ? 'ok' : 'warn', 'LDAP signing', /LDAP signing/.test(text) ? 'plain ldap:// simple binds are refused (use ldaps:// or StartTLS)' : text)
    } finally {
      await plainClient.close?.()
    }
  }
}

async function checkAdfs(): Promise<void> {
  console.log('AD FS')
  const base = env('ADFS_BASE_URL')
  const appUrl = (env('UT_APP_URL') ?? 'https://localhost:3000').replace(/\/+$/, '')
  if (!base) {
    line('skip', 'adfs', 'set ADFS_BASE_URL (and UT_APP_URL, ADFS_OIDC_CLIENT_ID)')
    return
  }
  const idps = parseSsoProviders([
    ...(env('ADFS_OIDC_CLIENT_ID') ? [{ id: 'adfs', type: 'oidc', preset: 'adfs', baseUrl: base, clientId: env('ADFS_OIDC_CLIENT_ID'), clientSecret: 'not-used-by-the-check' }] : []),
    { id: 'adfs-saml', type: 'saml', preset: 'adfs', metadataUrl: `${base.replace(/\/+$/, '')}/FederationMetadata/2007-06/FederationMetadata.xml` },
  ])
  for (const idp of idps) {
    const result = await checkSsoProvider(idp, appUrl)
    line(!result.ok ? 'fail' : result.warnings.length ? 'warn' : 'ok', `${idp.type}:${idp.id}`, [result.detail, ...result.warnings].join(' '))
  }
}

async function main() {
  await checkLdap()
  await checkAdfs()
  console.log(failed ? 'Some checks failed.' : 'Done.')
  process.exit(failed ? 1 : 0)
}

main().catch((error) => {
  console.error(message(error))
  process.exit(1)
})
