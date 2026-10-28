/**
 * Active Directory sync and bind login end to end against a Samba AD domain
 * controller (LDAPS with the DC's CA): objectGUID ids, the
 * userAccountControl disabled bit, nested groups through
 * LDAP_MATCHING_RULE_IN_CHAIN, uSNChanged delta syncs, and sign-in with the
 * userPrincipalName or sAMAccountName and the AD password.
 *
 * Needs EVENT_STREAM_DB_URL and a DC, e.g.
 *   docker run -d --privileged --hostname dc1 -p 6361:636 -e REALM=CORP.DIRSYNC.TEST -e DOMAIN=CORP \
 *     -e ADMIN_PASS='Passw0rd-Admin!' -e DNS_FORWARDER=1.1.1.1 -e BIND_NETWORK_INTERFACES=false diegogslomp/samba-ad-dc
 *   docker exec <container> cat /usr/local/samba/private/tls/ca.pem > ad-ca.pem
 *   AD_TEST_URL=ldaps://127.0.0.1:6361 AD_TEST_BIND_DN=Administrator@corp.dirsync.test AD_TEST_BIND_PASSWORD='Passw0rd-Admin!' \
 *   AD_TEST_BASE_DN=DC=corp,DC=dirsync,DC=test AD_TEST_CA_FILE=ad-ca.pem AD_TEST_TLS_NAME=dc1.corp.dirsync.test \
 *   EVENT_STREAM_DB_URL=… npx vitest run __tests__/directory-ad-db.test.ts
 */
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Client as PgClient } from 'pg'
import { Attribute, Change, Client as LdapClient } from 'ldapts'
import { dataApiProvider, dbCapabilities } from './helpers/db-capabilities'
import { resetRequest } from './helpers/next-headers-mock'

/* eslint-disable @typescript-eslint/no-explicit-any -- the service-role client is untyped */

vi.mock('next/headers', () => import('./helpers/next-headers-mock'))

const DB_URL = process.env.EVENT_STREAM_DB_URL
const AD_URL = process.env.AD_TEST_URL
const AD_BIND_DN = process.env.AD_TEST_BIND_DN ?? ''
const AD_BIND_PASSWORD = process.env.AD_TEST_BIND_PASSWORD ?? ''
const AD_BASE = process.env.AD_TEST_BASE_DN ?? ''
const AD_CA = process.env.AD_TEST_CA_FILE ? readFileSync(process.env.AD_TEST_CA_FILE, 'utf8') : undefined
const AD_TLS_NAME = process.env.AD_TEST_TLS_NAME
const DATA_API = dataApiProvider(await dbCapabilities())
const API_URL = process.env.ENGINE_SMOKE_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.ENGINE_SMOKE_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const RUN = randomUUID().slice(0, 6)
const DOMAIN = `ad-${RUN}.test`
const SLUG = `ad-${RUN}`
const OU = `OU=run-${RUN},${AD_BASE}`
const REALM = AD_BASE.split(',').map((part) => part.replace(/^DC=/i, '')).join('.')
const ENV_KEYS = ['AUTH_PROVIDER', 'DB_PROVIDER', 'DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'APP_URL', 'EMAIL_PROVIDER', 'ALLOW_PRIVATE_EGRESS'] as const
const saved: Record<string, string | undefined> = {}

const unicodePwd = (password: string) => Buffer.from(`"${password}"`, 'utf16le')

describe.skipIf(!DB_URL || !AD_URL)('Active Directory sync + bind login (Samba AD DC, local stack)', () => {
  const pg = new PgClient({ connectionString: DB_URL })
  // Created only when the suite runs (the describe body runs even when skipped).
  const admin = AD_URL
    ? new LdapClient({ url: AD_URL, tlsOptions: { ca: AD_CA ? [AD_CA] : undefined, servername: AD_TLS_NAME, rejectUnauthorized: Boolean(AD_CA) } })
    : (null as unknown as LdapClient)
  let tenantId = ''
  let directory: typeof import('@/lib/services/directory-sync')
  let sync: typeof import('@/lib/directory-sync/sync')
  let login: typeof import('@/lib/directory-sync/ldap-login')
  let db: any
  let ctx: import('@/lib/services/context').ServiceContext

  const settings = {
    url: AD_URL, flavor: 'active_directory', bind_dn: AD_BIND_DN, base_dn: AD_BASE,
    user_base_dn: OU, group_base_dn: OU, bind_login: true,
    ...(AD_CA ? { ca_cert: AD_CA } : { tls_reject_unauthorized: false }),
    ...(AD_TLS_NAME ? { tls_server_name: AD_TLS_NAME } : {}),
  }
  async function addUser(name: string, attrs: { mail?: string; display?: string; disabled?: boolean; password: string }) {
    await admin.add(`CN=${name},${OU}`, {
      objectClass: ['top', 'person', 'organizationalPerson', 'user'],
      sAMAccountName: `${name}${RUN}`,
      userPrincipalName: `${name}${RUN}@${REALM}`,
      givenName: name,
      sn: 'Test',
      ...(attrs.mail ? { mail: attrs.mail } : {}),
      ...(attrs.display ? { displayName: attrs.display } : {}),
      unicodePwd: unicodePwd(attrs.password) as unknown as string,
      userAccountControl: attrs.disabled ? '514' : '512',
    })
  }
  async function localUser(email: string) {
    const { rows } = await pg.query('SELECT id, display_name FROM public.users WHERE lower(email) = lower($1)', [email])
    return rows[0] as { id: string; display_name: string } | undefined
  }
  async function teamMembers(name: string) {
    const { rows } = await pg.query(
      `SELECT u.email FROM public.teams t JOIN public.user_teams ut ON ut.team_id = t.id JOIN public.users u ON u.id = ut.user_id
        WHERE t.tenant_id = $1 AND t.name = $2 ORDER BY u.email`, [tenantId, name])
    return rows.map((r) => r.email)
  }

  beforeAll(async () => {
    for (const key of ENV_KEYS) saved[key] = process.env[key]
    Object.assign(process.env, {
      AUTH_PROVIDER: 'builtin', DB_PROVIDER: DATA_API, DATABASE_URL: DB_URL,
      ...(DATA_API === 'supabase' ? { SUPABASE_URL: API_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY } : {}),
      APP_URL: 'https://app.test', EMAIL_PROVIDER: 'console', ALLOW_PRIVATE_EGRESS: 'true',
    })
    await pg.connect()
    const { rows } = await pg.query<{ id: string }>(`INSERT INTO public.tenants (name, slug) VALUES ($1, $2) RETURNING id`, [`AD ${RUN}`, SLUG])
    tenantId = rows[0].id

    await admin.bind(AD_BIND_DN, AD_BIND_PASSWORD)
    await admin.add(OU, { objectClass: ['top', 'organizationalUnit'], ou: `run-${RUN}` })
    await addUser('ada', { mail: `ada@${DOMAIN}`, display: 'Ada Lovelace', password: 'Passw0rd-Ada!1' })
    await addUser('bob', { mail: `bob@${DOMAIN}`, password: 'Passw0rd-Bob!1' })
    await addUser('cyd', { mail: `cyd@${DOMAIN}`, password: 'Passw0rd-Cyd!1', disabled: true })
    await addUser('dee', { password: 'Passw0rd-Dee!1' }) // no mail: falls back to the UPN
    await admin.add(`CN=Platform ${RUN},${OU}`, { objectClass: ['top', 'group'], sAMAccountName: `plat${RUN}`, member: [`CN=bob,${OU}`, `CN=cyd,${OU}`] })
    await admin.add(`CN=Engineering ${RUN},${OU}`, { objectClass: ['top', 'group'], sAMAccountName: `eng${RUN}`, description: 'All engineers', member: [`CN=ada,${OU}`, `CN=Platform ${RUN},${OU}`] })

    directory = await import('@/lib/services/directory-sync')
    sync = await import('@/lib/directory-sync/sync')
    login = await import('@/lib/directory-sync/ldap-login')
    db = (await import('@/lib/providers/db')).getServiceDb()
    ctx = { db, supabase: db, tenantId, actorId: null, permissions: null, authKind: 'api_key', source: 'api' }
  }, 120_000)

  afterAll(async () => {
    const { rows } = await pg.query<{ id: string }>(`SELECT id FROM public.users WHERE email LIKE $1 OR email LIKE $2`, [`%@${DOMAIN}`, `%${RUN}@${REALM.toLowerCase()}`])
    const ids = rows.map((r) => r.id)
    if (ids.length) {
      for (const table of ['user_teams', 'user_roles', 'user_memberships']) await pg.query(`DELETE FROM public.${table} WHERE user_id = ANY($1)`, [ids]).catch(() => undefined)
      await pg.query(`DELETE FROM app_auth.sessions WHERE user_id = ANY($1)`, [ids]).catch(() => undefined)
      await pg.query(`DELETE FROM app_auth.credentials WHERE user_id = ANY($1)`, [ids]).catch(() => undefined)
      await pg.query(`DELETE FROM public.users WHERE id = ANY($1)`, [ids]).catch(() => undefined)
      await pg.query(`DELETE FROM public.tenants WHERE slug = ANY($1)`, [ids.map((id) => `personal-${id.slice(0, 8)}`)]).catch(() => undefined)
    }
    for (const table of ['directory_sync_runs', 'directory_links', 'teams', 'tenant_connectors', 'object_audit_log', 'user_roles', 'user_memberships', 'roles', 'workspace_themes']) {
      await pg.query(`DELETE FROM public.${table} WHERE tenant_id = $1`, [tenantId]).catch(() => undefined)
    }
    await pg.query(`DELETE FROM public.tenants WHERE id = $1`, [tenantId]).catch(() => undefined)
    await pg.end()
    try {
      const { searchEntries } = await admin.search(OU, { scope: 'sub', filter: '(objectClass=*)', attributes: ['1.1'] })
      for (const entry of searchEntries.sort((a, b) => b.dn.length - a.dn.length)) await admin.del(entry.dn).catch(() => undefined)
    } finally {
      await admin.unbind()
    }
    await (await import('@/lib/providers/auth/builtin/db')).closeAuthDb()
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  }, 60_000)

  beforeEach(() => resetRequest())

  it('connects over LDAPS with the DC certificate', async () => {
    const result = await directory.createDirectoryConnection(ctx, { provider: 'ldap', settings, credentials: { bind_password: AD_BIND_PASSWORD } })
    expect(result.test).toMatchObject({ ok: true, encrypted: true, users: 4, groups: 2 })
    // objectGUIDs in Windows string form.
    expect(result.test!.sample.every((u) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(u.externalId))).toBe(true)
    expect(result.test!.sample.find((u) => u.dn.startsWith('CN=cyd'))?.active).toBe(false)
  })

  it('syncs enabled users, skips the disabled one, and resolves nested groups with IN_CHAIN', async () => {
    const stats = await sync.runDirectorySync(db, tenantId, 'ldap')
    expect(stats).toMatchObject({ users_seen: 4, users_created: 3, groups_created: 2 })
    expect(await localUser(`cyd@${DOMAIN}`)).toBeUndefined()
    expect(await localUser(`dee${RUN}@${REALM}`)).toBeTruthy()
    expect((await localUser(`ada@${DOMAIN}`))!.display_name).toBe('Ada Lovelace')
    expect(await teamMembers(`Engineering ${RUN}`)).toEqual([`ada@${DOMAIN}`, `bob@${DOMAIN}`])
    expect(await teamMembers(`Platform ${RUN}`)).toEqual([`bob@${DOMAIN}`])
    const { rows } = await pg.query(`SELECT config FROM public.tenant_connectors WHERE tenant_id = $1 AND connector_key = 'ldap_directory'`, [tenantId])
    expect(rows[0].config.delta_cursor).toMatch(/^usn:\d+$/)
  })

  it('delta sync by uSNChanged: a rename and a disabled account', async () => {
    const before = (await pg.query(`SELECT config FROM public.tenant_connectors WHERE tenant_id = $1 AND connector_key = 'ldap_directory'`, [tenantId])).rows[0].config.delta_cursor
    await admin.modify(`CN=ada,${OU}`, new Change({ operation: 'replace', modification: new Attribute({ type: 'displayName', values: ['Countess Lovelace'] }) }))
    await admin.modify(`CN=bob,${OU}`, new Change({ operation: 'replace', modification: new Attribute({ type: 'userAccountControl', values: ['514'] }) }))
    let mode = ''
    const stats = await sync.runDirectorySync(db, tenantId, 'ldap', { onMode: (m) => { mode = m } })
    expect(mode).toBe('delta')
    expect(stats.users_seen).toBe(2) // only the two changed entries
    expect(stats.users_deactivated).toBe(1)
    expect((await localUser(`ada@${DOMAIN}`))!.display_name).toBe('Countess Lovelace')
    const bob = (await localUser(`bob@${DOMAIN}`))!
    expect((await pg.query('SELECT is_active FROM public.user_memberships WHERE user_id = $1 AND tenant_id = $2', [bob.id, tenantId])).rows[0].is_active).toBe(false)
    const after = (await pg.query(`SELECT config FROM public.tenant_connectors WHERE tenant_id = $1 AND connector_key = 'ldap_directory'`, [tenantId])).rows[0].config.delta_cursor
    expect(Number(after.slice(4))).toBeGreaterThan(Number(before.slice(4)))
  })

  it('signs in with the UPN or the sAMAccountName and the AD password; disabled accounts cannot', async () => {
    expect((await login.tryLdapLogin(SLUG, `ada${RUN}@${REALM}`, 'Passw0rd-Ada!1')).status).toBe('signed_in')
    resetRequest()
    expect((await login.tryLdapLogin(SLUG, `ada${RUN}`, 'Passw0rd-Ada!1')).status).toBe('signed_in')
    expect((await login.tryLdapLogin(SLUG, `ada@${DOMAIN}`, 'Passw0rd-Ada!1')).status).toBe('signed_in')
    expect(await login.tryLdapLogin(SLUG, `ada${RUN}`, 'wrong-password')).toMatchObject({ status: 'failed', code: 'invalid_credentials' })
    expect(await login.tryLdapLogin(SLUG, `bob${RUN}`, 'Passw0rd-Bob!1')).toMatchObject({ status: 'failed', code: 'invalid_credentials' })
  })
})
