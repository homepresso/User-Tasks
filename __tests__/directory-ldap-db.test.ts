/**
 * LDAP directory sync and LDAP bind login end to end: a real LDAP server
 * (OpenLDAP in a container) and the local stack's database. Seeds its own
 * subtree, connects through the service (verified before saving), runs full
 * and delta syncs (users, nested groups → teams, deprovisioning of removed
 * entries), and signs in with directory passwords.
 *
 * Needs EVENT_STREAM_DB_URL and an LDAP server whose admin can add entries:
 *   docker run -d --name ut-openldap -p 3890:389 -p 6360:636 -e LDAP_DOMAIN=acme.test \
 *     -e LDAP_ADMIN_PASSWORD=admin-pass osixia/openldap:1.5.0
 *   LDAP_TEST_URL=ldap://127.0.0.1:3890 LDAP_TEST_BIND_DN=cn=admin,dc=acme,dc=test \
 *   LDAP_TEST_BIND_PASSWORD=admin-pass LDAP_TEST_BASE_DN=dc=acme,dc=test \
 *   [LDAP_TEST_LDAPS_URL=ldaps://127.0.0.1:6360 LDAP_TEST_CA_FILE=ca.crt LDAP_TEST_TLS_NAME=ldap.dirsync.test] \
 *   EVENT_STREAM_DB_URL=… npx vitest run __tests__/directory-ldap-db.test.ts
 */
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Client as PgClient } from 'pg'
import { Attribute, Change, Client as LdapClient } from 'ldapts'
import { dataApiProvider, dbCapabilities } from './helpers/db-capabilities'
import { jar, resetRequest } from './helpers/next-headers-mock'

/* eslint-disable @typescript-eslint/no-explicit-any -- test fixtures */

vi.mock('next/headers', () => import('./helpers/next-headers-mock'))

const DB_URL = process.env.EVENT_STREAM_DB_URL
const LDAP_URL = process.env.LDAP_TEST_URL
const LDAP_BIND_DN = process.env.LDAP_TEST_BIND_DN ?? 'cn=admin,dc=acme,dc=test'
const LDAP_BIND_PASSWORD = process.env.LDAP_TEST_BIND_PASSWORD ?? 'admin-pass'
const LDAP_BASE = process.env.LDAP_TEST_BASE_DN ?? 'dc=acme,dc=test'
const LDAPS_URL = process.env.LDAP_TEST_LDAPS_URL
const CA = process.env.LDAP_TEST_CA_FILE ? readFileSync(process.env.LDAP_TEST_CA_FILE, 'utf8') : null
const TLS_NAME = process.env.LDAP_TEST_TLS_NAME
const DATA_API = dataApiProvider(await dbCapabilities())
const API_URL = process.env.ENGINE_SMOKE_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.ENGINE_SMOKE_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const RUN = randomUUID().slice(0, 8)
const DOMAIN = `ldap-${RUN}.test`
const SLUG = `ldap-${RUN}`
const OU = `ou=run-${RUN},${LDAP_BASE}`
const ENV_KEYS = ['AUTH_PROVIDER', 'DB_PROVIDER', 'DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'APP_URL', 'EMAIL_PROVIDER', 'ALLOW_PRIVATE_EGRESS'] as const
const saved: Record<string, string | undefined> = {}

describe.skipIf(!DB_URL || !LDAP_URL)('LDAP directory sync + bind login (OpenLDAP container, local stack)', () => {
  const pg = new PgClient({ connectionString: DB_URL })
  // Created only when the suite runs (the describe body runs even when skipped).
  const admin = LDAP_URL ? new LdapClient({ url: LDAP_URL }) : (null as unknown as LdapClient)
  let tenantId = ''
  let directory: typeof import('@/lib/services/directory-sync')
  let sync: typeof import('@/lib/directory-sync/sync')
  let login: typeof import('@/lib/directory-sync/ldap-login')
  let db: any
  let ctx: import('@/lib/services/context').ServiceContext

  const settings = (extra: Record<string, unknown> = {}) => ({
    url: LDAP_URL, bind_dn: LDAP_BIND_DN, base_dn: OU, flavor: 'openldap', bind_login: true, ...extra,
  })
  const person = (uid: string, attrs: Record<string, string>) => admin.add(`uid=${uid},ou=people,${OU}`, {
    objectClass: ['inetOrgPerson'], uid, sn: attrs.sn ?? uid, cn: attrs.cn ?? uid, ...attrs,
  })

  async function localUser(email: string) {
    const { rows } = await pg.query('SELECT id, display_name FROM public.users WHERE lower(email) = lower($1)', [email])
    return rows[0] as { id: string; display_name: string } | undefined
  }
  async function member(userId: string) {
    const { rows } = await pg.query('SELECT is_active FROM public.user_memberships WHERE user_id = $1 AND tenant_id = $2', [userId, tenantId])
    return rows[0]?.is_active ?? null
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
      AUTH_PROVIDER: 'builtin',
      DB_PROVIDER: DATA_API,
      DATABASE_URL: DB_URL,
      ...(DATA_API === 'supabase' ? { SUPABASE_URL: API_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY } : {}),
      APP_URL: 'https://app.test',
      EMAIL_PROVIDER: 'console',
      ALLOW_PRIVATE_EGRESS: 'true',
    })
    await pg.connect()
    const { rows } = await pg.query<{ id: string }>(`INSERT INTO public.tenants (name, slug) VALUES ($1, $2) RETURNING id`, [`LDAP ${RUN}`, SLUG])
    tenantId = rows[0].id

    await admin.bind(LDAP_BIND_DN, LDAP_BIND_PASSWORD)
    await admin.add(OU, { objectClass: ['organizationalUnit'], ou: `run-${RUN}` })
    await admin.add(`ou=people,${OU}`, { objectClass: ['organizationalUnit'], ou: 'people' })
    await admin.add(`ou=groups,${OU}`, { objectClass: ['organizationalUnit'], ou: 'groups' })
    await person('alice', { cn: 'Alice Liddell', sn: 'Liddell', givenName: 'Alice', displayName: 'Alice Liddell', mail: `Alice@${DOMAIN}`, userPassword: 'alice-pass-1' })
    await person('bob', { cn: 'Bob Builder', mail: `bob@${DOMAIN}`, userPassword: 'bob-pass-1' })
    await person('carol', { cn: 'Carol', mail: `carol@${DOMAIN}`, userPassword: 'carol-pass-1' })
    await person('nomail', { cn: 'No Mail', userPassword: 'nomail-pass-1' })
    await person('st*r', { cn: 'Star', mail: `star@${DOMAIN}`, userPassword: 'star-pass-1' })
    await admin.add(`cn=platform,ou=groups,${OU}`, { objectClass: ['groupOfNames'], cn: 'platform', description: 'Platform', member: [`uid=bob,ou=people,${OU}`] })
    await admin.add(`cn=engineering,ou=groups,${OU}`, { objectClass: ['groupOfNames'], cn: 'engineering', member: [`uid=alice,ou=people,${OU}`, `cn=platform,ou=groups,${OU}`] })

    directory = await import('@/lib/services/directory-sync')
    sync = await import('@/lib/directory-sync/sync')
    login = await import('@/lib/directory-sync/ldap-login')
    const { getServiceDb } = await import('@/lib/providers/db')
    db = getServiceDb()
    ctx = { db, supabase: db, tenantId, actorId: null, permissions: null, authKind: 'api_key', source: 'api' }
  }, 60_000)

  afterAll(async () => {
    const { rows } = await pg.query<{ id: string }>(`SELECT id FROM public.users WHERE email LIKE $1`, [`%@${DOMAIN}`])
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
    // Remove the run's subtree (children first).
    try {
      const { searchEntries } = await admin.search(OU, { scope: 'sub', filter: '(objectClass=*)', attributes: ['1.1'] })
      for (const entry of searchEntries.sort((a, b) => b.dn.length - a.dn.length)) await admin.del(entry.dn).catch(() => undefined)
    } finally {
      await admin.unbind()
    }
    const { closeAuthDb } = await import('@/lib/providers/auth/builtin/db')
    await closeAuthDb()
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  }, 60_000)

  beforeEach(() => resetRequest())

  it('refuses a wrong bind password and a missing base DN before saving', async () => {
    await expect(directory.createDirectoryConnection(ctx, { provider: 'ldap', settings: settings(), credentials: { bind_password: 'wrong' } }))
      .rejects.toMatchObject({ code: 'validation_error', message: expect.stringContaining('invalid credentials') })
    await expect(directory.createDirectoryConnection(ctx, { provider: 'ldap', settings: settings({ base_dn: `ou=missing,${OU}` }), credentials: { bind_password: LDAP_BIND_PASSWORD } }))
      .rejects.toMatchObject({ code: 'validation_error' })
    expect((await pg.query(`SELECT 1 FROM public.tenant_connectors WHERE tenant_id = $1`, [tenantId])).rowCount).toBe(0)
  })

  it('connects, reporting what it found', async () => {
    const result = await directory.createDirectoryConnection(ctx, { provider: 'ldap', settings: settings(), credentials: { bind_password: LDAP_BIND_PASSWORD } })
    expect(result.test).toMatchObject({ ok: true, users: 5, groups: 2, encrypted: false })
    expect(result.test!.warnings.join(' ')).toMatch(/not encrypted/)
    expect(result.connection.credentials).toEqual({ bind_password: '__SECRET__' })
    const { rows } = await pg.query(`SELECT credentials::text AS c FROM public.tenant_connectors WHERE tenant_id = $1 AND connector_key = 'ldap_directory'`, [tenantId])
    if (process.env.ENCRYPTION_KEY) expect(rows[0].c).not.toContain(LDAP_BIND_PASSWORD)
  })

  it('full sync: accounts for users with an email, nested groups become teams', async () => {
    const stats = await sync.runDirectorySync(db, tenantId, 'ldap')
    expect(stats).toMatchObject({ users_seen: 5, users_created: 4, groups_created: 2 })
    for (const email of [`alice@${DOMAIN}`, `bob@${DOMAIN}`, `carol@${DOMAIN}`, `star@${DOMAIN}`]) {
      const user = await localUser(email)
      expect(user, email).toBeTruthy()
      expect(await member(user!.id)).toBe(true)
    }
    expect((await localUser(`alice@${DOMAIN}`))!.display_name).toBe('Alice Liddell')
    expect(await teamMembers('engineering')).toEqual([`alice@${DOMAIN}`, `bob@${DOMAIN}`]) // bob through platform
    expect(await teamMembers('platform')).toEqual([`bob@${DOMAIN}`])
    const { rows } = await pg.query(`SELECT config FROM public.tenant_connectors WHERE tenant_id = $1 AND connector_key = 'ldap_directory'`, [tenantId])
    expect(rows[0].config.delta_cursor).toMatch(/^ts:\d{14}Z$/)
    expect(rows[0].config.last_full_sync_at).toBeTruthy()
  })

  it('delta sync picks up changes; a full sync deprovisions entries that left the directory', async () => {
    await admin.modify(`uid=carol,ou=people,${OU}`, new Change({ operation: 'replace', modification: new Attribute({ type: 'displayName', values: ['Carol Changed'] }) }))
    let mode: string | null = null
    await sync.runDirectorySync(db, tenantId, 'ldap', { onMode: (m) => { mode = m } })
    expect(mode).toBe('delta')
    expect((await localUser(`carol@${DOMAIN}`))!.display_name).toBe('Carol Changed')

    await admin.modify(`cn=platform,ou=groups,${OU}`, new Change({ operation: 'replace', modification: new Attribute({ type: 'member', values: [`uid=carol,ou=people,${OU}`] }) }))
    await admin.del(`uid=bob,ou=people,${OU}`)
    const bob = (await localUser(`bob@${DOMAIN}`))!
    // A delta sync can't see a deletion…
    await sync.runDirectorySync(db, tenantId, 'ldap')
    expect(await member(bob.id)).toBe(true)
    // …a full one can.
    const stats = await sync.runDirectorySync(db, tenantId, 'ldap', { mode: 'full', onMode: (m) => { mode = m } })
    expect(mode).toBe('full')
    expect(stats.users_deactivated).toBe(1)
    expect(await member(bob.id)).toBe(false)
    expect((await pg.query('SELECT count(*)::int AS n FROM public.user_roles WHERE user_id = $1 AND tenant_id = $2', [bob.id, tenantId])).rows[0].n).toBe(0)
    expect(await localUser(`bob@${DOMAIN}`)).toBeTruthy() // the account itself stays
    expect(await teamMembers('platform')).toEqual([`carol@${DOMAIN}`])
    expect(await teamMembers('engineering')).toEqual([`alice@${DOMAIN}`, `carol@${DOMAIN}`])
  })

  it('a background run records its mode and the scheduler enqueues due connectors', async () => {
    const started = await directory.startDirectorySyncRun(ctx, 'ldap', { full: true })
    expect(started.already_running).toBe(false)
    expect(await directory.startDirectorySyncRun(ctx, 'ldap')).toEqual({ run_id: started.run_id, already_running: true })
    const { rows } = await pg.query('SELECT * FROM public.directory_sync_runs WHERE id = $1', [started.run_id])
    await sync.executeDirectorySyncRun(db, rows[0])
    const { rows: done } = await pg.query('SELECT status, mode, stats FROM public.directory_sync_runs WHERE id = $1', [started.run_id])
    expect(done[0]).toMatchObject({ status: 'completed', mode: 'full' })
    const runs = await directory.listDirectorySyncRuns(ctx, { limit: 10, offset: 0 }, { provider: 'ldap' })
    expect(runs.runs[0]).toMatchObject({ id: started.run_id, provider: 'ldap', mode: 'full' })
    const { rows: probe } = await pg.query(`SELECT public.cron_tick_probe()->>'directory_sync' AS v`)
    expect(probe[0].v).toBe('true')
  })

  describe('bind login', () => {
    it('signs a directory user in with their LDAP password (built-in session)', async () => {
      const result = await login.tryLdapLogin(SLUG, `alice@${DOMAIN}`, 'alice-pass-1', { ip: '203.0.113.5' })
      expect(result.status).toBe('signed_in')
      const alice = (await localUser(`alice@${DOMAIN}`))!
      expect((result as { userId: string }).userId).toBe(alice.id)
      expect([...jar.keys()].some((name) => name.endsWith('ut_session'))).toBe(true)
      const { rows } = await pg.query(`SELECT method FROM app_auth.sessions WHERE user_id = $1`, [alice.id])
      expect(rows.map((r) => r.method)).toContain('ldap')
      // By username too, and escaped: "st*r" is a literal.
      expect((await login.tryLdapLogin(SLUG, 'st*r', 'star-pass-1')).status).toBe('signed_in')
    })

    it('refuses wrong and empty passwords without trying the local password', async () => {
      expect(await login.tryLdapLogin(SLUG, `alice@${DOMAIN}`, 'nope')).toMatchObject({ status: 'failed', code: 'invalid_credentials' })
      expect(await login.tryLdapLogin(SLUG, `alice@${DOMAIN}`, '')).toMatchObject({ status: 'failed', code: 'invalid_credentials' })
      expect(jar.size).toBe(0)
    })

    it('leaves names the directory does not know (and wildcards) to the normal login', async () => {
      expect(await login.tryLdapLogin(SLUG, `nobody@${DOMAIN}`, 'x')).toEqual({ status: 'not_applicable' })
      expect(await login.tryLdapLogin(SLUG, '*', 'x')).toEqual({ status: 'not_applicable' })
      expect(await login.tryLdapLogin(SLUG, '*)(uid=*', 'x')).toEqual({ status: 'not_applicable' })
      expect(await login.tryLdapLogin(`no-such-org-${RUN}`, `alice@${DOMAIN}`, 'alice-pass-1')).toEqual({ status: 'not_applicable' })
      // bob left the directory.
      expect(await login.tryLdapLogin(SLUG, `bob@${DOMAIN}`, 'bob-pass-1')).toEqual({ status: 'not_applicable' })
    })

    it('refuses directory users without an account when provisioning is off', async () => {
      await directory.updateDirectoryConnection(ctx, 'ldap', { auto_provision: false })
      try {
        await person('dave', { cn: 'Dave', mail: `dave@${DOMAIN}`, userPassword: 'dave-pass-1' })
        expect(await login.tryLdapLogin(SLUG, `dave@${DOMAIN}`, 'dave-pass-1')).toMatchObject({ status: 'failed', code: 'sso_failed' })
        expect(await localUser(`dave@${DOMAIN}`)).toBeUndefined()
      } finally {
        await directory.updateDirectoryConnection(ctx, 'ldap', { auto_provision: true })
      }
      expect((await login.tryLdapLogin(SLUG, `dave@${DOMAIN}`, 'dave-pass-1')).status).toBe('signed_in')
    })

    it('is off unless the workspace enables it, and only with built-in auth', async () => {
      await directory.updateDirectoryConnection(ctx, 'ldap', { settings: { bind_login: false } })
      expect(await login.tryLdapLogin(SLUG, `alice@${DOMAIN}`, 'alice-pass-1')).toEqual({ status: 'not_applicable' })
      await directory.updateDirectoryConnection(ctx, 'ldap', { settings: { bind_login: true } })
      process.env.AUTH_PROVIDER = 'supabase'
      try {
        expect(await login.tryLdapLogin(SLUG, `alice@${DOMAIN}`, 'alice-pass-1')).toEqual({ status: 'not_applicable' })
      } finally {
        process.env.AUTH_PROVIDER = 'builtin'
      }
    })

    it('rate limits attempts per name', async () => {
      for (let i = 0; i < 20; i++) {
        expect((await login.tryLdapLogin(SLUG, `carol@${DOMAIN}`, 'wrong', { ip: `203.0.113.${100 + i}` })).status).toBe('failed')
      }
      expect(await login.tryLdapLogin(SLUG, `carol@${DOMAIN}`, 'carol-pass-1', { ip: '203.0.113.250' })).toMatchObject({ status: 'failed', code: 'rate_limited' })
    })
  })

  describe.skipIf(!LDAPS_URL || !CA)('TLS', () => {
    const tls = (extra: Record<string, unknown>) => directory.testDirectoryConnection(ctx, 'ldap', { settings: { ...settings(), ...extra } })

    it('connects over LDAPS and StartTLS when the certificate chains to the configured CA', async () => {
      const ldaps = await tls({ url: LDAPS_URL, ca_cert: CA, ...(TLS_NAME ? { tls_server_name: TLS_NAME } : {}) })
      expect(ldaps).toMatchObject({ ok: true, details: { encrypted: true } })
      expect(ldaps.details!.warnings.join(' ')).not.toMatch(/not encrypted/)
      const startTls = await tls({ start_tls: true, ca_cert: CA, ...(TLS_NAME ? { tls_server_name: TLS_NAME } : {}) })
      expect(startTls).toMatchObject({ ok: true, details: { encrypted: true } })
    })

    it('refuses an untrusted or mismatched certificate unless verification is off', async () => {
      const untrusted = await tls({ url: LDAPS_URL })
      expect(untrusted.ok).toBe(false)
      expect(untrusted.error).toMatch(/TLS|certificate/i)
      const wrongName = await tls({ url: LDAPS_URL, ca_cert: CA, tls_server_name: 'wrong.example.com' })
      expect(wrongName.ok).toBe(false)
      const unverified = await tls({ url: LDAPS_URL, tls_reject_unauthorized: false })
      expect(unverified.ok).toBe(true)
      expect(unverified.details!.warnings.join(' ')).toMatch(/verification is off/)
    })
  })
})
