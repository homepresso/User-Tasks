/**
 * OIDC sign-in (built-in sessions + an OIDC IdP from AUTH_SSO_PROVIDERS)
 * against a mock IdP (__tests__/helpers/mock-oidc-idp.ts) and the local
 * stack's database: authorization code + PKCE, state / nonce / browser
 * binding, ID token validation, JIT provisioning into the default
 * organisation with group → role mapping, linking by verified email, domain
 * allowlist, and open-redirect protection.
 *
 * Runs only against a LOCAL Supabase stack — set EVENT_STREAM_DB_URL, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/auth-oidc-db.test.ts
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Client } from 'pg'
import { dataApiProvider, dbCapabilities } from './helpers/db-capabilities'
import { jar, requestHeaders, resetRequest } from './helpers/next-headers-mock'
import { authorizeAtMockIdp, startMockOidcIdp, type MockOidcIdp } from './helpers/mock-oidc-idp'

vi.mock('next/headers', () => import('./helpers/next-headers-mock'))

const DB_URL = process.env.EVENT_STREAM_DB_URL
// The stack's PostgREST on a Supabase database; pg-query on plain Postgres.
const DATA_API = dataApiProvider(await dbCapabilities())
const API_URL = process.env.ENGINE_SMOKE_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.ENGINE_SMOKE_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const RUN = randomUUID().slice(0, 8)
const SLUG = `auth-oidc-${RUN}`
const DOMAIN = `oidc-${RUN}.test`
const ENV_KEYS = ['AUTH_PROVIDER', 'DB_PROVIDER', 'DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'APP_URL', 'AUTH_SSO_PROVIDERS', 'EMAIL_PROVIDER'] as const
const saved: Record<string, string | undefined> = {}

describe.skipIf(!DB_URL)('OIDC sign-in (mock IdP, local stack)', () => {
  const pg = new Client({ connectionString: DB_URL })
  let idp: MockOidcIdp
  let tenantId = ''
  let provider: import('@/lib/providers/auth').AuthProvider
  let flow: typeof import('@/lib/providers/auth/sso/flow')

  const configure = (overrides: Record<string, unknown> = {}) => {
    process.env.AUTH_SSO_PROVIDERS = JSON.stringify([{
      id: 'mock',
      type: 'oidc',
      name: 'Mock IdP',
      issuer: idp.issuer,
      clientId: 'usertasks-test',
      clientSecret: 'test-secret',
      allowedDomains: [DOMAIN],
      defaultOrg: SLUG,
      defaultRole: 'viewer',
      groupsClaim: 'groups',
      roleMapping: { 'UT-Admins': 'admin', 'ut-members': 'member' },
      ...overrides,
    }])
  }

  /** Start at the app, sign in at the IdP, come back to the callback route. */
  async function signInViaIdp(options: { redirect?: string; keepCookie?: boolean } = {}): Promise<string> {
    const url = await provider.startSso('mock', { redirect: options.redirect ?? '/tasks', org: null, origin: 'https://app.test' })
    const callback = await authorizeAtMockIdp(url)
    expect(callback.origin + callback.pathname).toBe('https://app.test/auth/sso/mock/callback')
    return flow.completeOidcCallback('mock', new Request(callback.toString()), { ip: '198.51.100.7', userAgent: 'vitest' })
  }

  async function userIdByEmail(email: string): Promise<string | null> {
    const { rows } = await pg.query<{ user_id: string }>('SELECT user_id FROM app_auth.credentials WHERE lower(email) = lower($1)', [email])
    return rows[0]?.user_id ?? null
  }

  beforeAll(async () => {
    for (const key of ENV_KEYS) saved[key] = process.env[key]
    idp = await startMockOidcIdp({ clientId: 'usertasks-test', clientSecret: 'test-secret' })
    Object.assign(process.env, {
      AUTH_PROVIDER: 'builtin',
      DB_PROVIDER: DATA_API,
      DATABASE_URL: DB_URL,
      ...(DATA_API === 'supabase' ? { SUPABASE_URL: API_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY } : {}),
      APP_URL: 'https://app.test',
      EMAIL_PROVIDER: 'console',
    })
    configure()
    await pg.connect()
    const { rows } = await pg.query<{ id: string }>(`INSERT INTO public.tenants (name, slug) VALUES ($1, $2) RETURNING id`, [`OIDC ${RUN}`, SLUG])
    tenantId = rows[0].id
    const auth = await import('@/lib/providers/auth')
    provider = auth.resolveAuthProvider('builtin')
    flow = await import('@/lib/providers/auth/sso/flow')
  }, 60_000)

  afterAll(async () => {
    const { rows } = await pg.query<{ user_id: string }>(`SELECT user_id FROM app_auth.credentials WHERE email LIKE $1`, [`%@${DOMAIN}`])
    const ids = rows.map((r) => r.user_id)
    if (ids.length) {
      await pg.query(`DELETE FROM public.user_roles WHERE user_id = ANY($1)`, [ids])
      await pg.query(`DELETE FROM public.user_memberships WHERE user_id = ANY($1)`, [ids])
      await pg.query(`DELETE FROM public.users WHERE id = ANY($1)`, [ids])
      await pg.query(`DELETE FROM public.tenants WHERE slug = ANY($1)`, [ids.map((id) => `personal-${id.slice(0, 8)}`)])
    }
    for (const table of ['user_roles', 'user_memberships', 'roles', 'workspace_themes']) {
      await pg.query(`DELETE FROM public.${table} WHERE tenant_id = $1`, [tenantId]).catch(() => undefined)
    }
    await pg.query(`DELETE FROM public.tenants WHERE id = $1`, [tenantId]).catch(() => undefined)
    await pg.end()
    await idp.close()
    const { closeAuthDb } = await import('@/lib/providers/auth/builtin/db')
    await closeAuthDb()
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  }, 60_000)

  beforeEach(async () => {
    resetRequest()
    configure()
    const { clearOidcCache } = await import('@/lib/providers/auth/sso/oidc')
    clearOidcCache()
  })

  it('offers the IdP on the login page by name only', async () => {
    const options = await provider.loginOptions()
    expect(options).toEqual({ provider: 'builtin', password: true, sso: [{ id: 'mock', name: 'Mock IdP', kind: 'oidc' }] })
    expect(JSON.stringify(options)).not.toContain('test-secret')
  })

  it('JIT-provisions a new user into the default organisation with the mapped role', async () => {
    const email = `new.admin@${DOMAIN}`
    idp.user = { sub: `sub-admin-${RUN}`, email, email_verified: true, name: 'New Admin', groups: ['ut-admins', 'other'] }
    const target = await signInViaIdp()
    expect(target).toBe('/tasks')
    const write = [...jar.entries()].find(([name]) => name === '__Host-ut_session')
    expect(write).toBeTruthy()
    const user = await provider.getSessionUser()
    expect(user?.email).toBe(email)

    const { rows } = await pg.query(
      `SELECT u.current_tenant_id, r.slug FROM public.users u
         JOIN public.user_roles ur ON ur.user_id = u.id AND ur.tenant_id = $2
         JOIN public.roles r ON r.id = ur.role_id
        WHERE u.id = $1`,
      [user!.id, tenantId],
    )
    expect(rows).toEqual([{ current_tenant_id: tenantId, slug: 'admin' }])
    const { rows: identity } = await pg.query('SELECT provider, subject FROM app_auth.identities WHERE user_id = $1', [user!.id])
    expect(identity).toEqual([{ provider: 'oidc:mock', subject: `sub-admin-${RUN}` }])
    const { rows: session } = await pg.query('SELECT method FROM app_auth.sessions WHERE user_id = $1', [user!.id])
    expect(session[0].method).toBe('oidc:mock')
  })

  it('signs a returning user into the same account and re-applies the role mapping', async () => {
    const email = `returning@${DOMAIN}`
    idp.user = { sub: `sub-ret-${RUN}`, email, email_verified: true, groups: [] }
    await signInViaIdp()
    const first = (await provider.getSessionUser())!.id
    resetRequest()
    idp.user = { ...idp.user, groups: ['UT-MEMBERS'] }
    await signInViaIdp()
    expect((await provider.getSessionUser())!.id).toBe(first)
    const { rows } = await pg.query(
      `SELECT r.slug FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id WHERE ur.user_id = $1 AND ur.tenant_id = $2`,
      [first, tenantId],
    )
    expect(rows).toEqual([{ slug: 'member' }])
  })

  it('links to an existing account by verified email', async () => {
    const email = `existing@${DOMAIN}`
    const { id } = await provider.admin.createUser({ email, password: 'existing-pass-1', emailConfirmed: true })
    idp.user = { sub: `sub-existing-${RUN}`, email, email_verified: true }
    await signInViaIdp()
    expect((await provider.getSessionUser())?.id).toBe(id)
    // Password sign-in still works for the same account.
    resetRequest()
    await expect(provider.signInWithPassword(email, 'existing-pass-1')).resolves.toMatchObject({ id })
  })

  it('refuses unverified emails, other domains, and unknown users when JIT is off', async () => {
    idp.user = { sub: `sub-unverified-${RUN}`, email: `unverified@${DOMAIN}`, email_verified: false }
    expect(await signInViaIdp()).toBe('/login?error=sso_failed')
    expect(await userIdByEmail(`unverified@${DOMAIN}`)).toBeNull()

    resetRequest()
    idp.user = { sub: `sub-outsider-${RUN}`, email: `someone@elsewhere-${RUN}.test`, email_verified: true }
    expect(await signInViaIdp()).toBe('/login?error=sso_failed')

    resetRequest()
    configure({ jit: false })
    idp.user = { sub: `sub-nojit-${RUN}`, email: `nojit@${DOMAIN}`, email_verified: true }
    expect(await signInViaIdp()).toBe('/login?error=sso_failed')
    expect(await userIdByEmail(`nojit@${DOMAIN}`)).toBeNull()
    expect(await provider.getSessionUser()).toBeNull()
  })

  it.each(['nonce', 'audience', 'issuer', 'expired', 'signature'] as const)('rejects an ID token with a bad %s', async (tamper) => {
    idp.user = { sub: `sub-tamper-${tamper}-${RUN}`, email: `tamper-${tamper}@${DOMAIN}`, email_verified: true }
    idp.tamper = tamper
    expect(await signInViaIdp()).toBe('/login?error=sso_failed')
    expect(await provider.getSessionUser()).toBeNull()
  })

  it('state is single-use and bound to the browser that started the flow (login CSRF)', async () => {
    idp.user = { sub: `sub-state-${RUN}`, email: `state@${DOMAIN}`, email_verified: true }
    const url = await provider.startSso('mock', { redirect: '/tasks', org: null, origin: 'https://app.test' })
    const callback = await authorizeAtMockIdp(url)

    // Another browser (no / different binding cookie) can't complete it…
    const binding = jar.get('__Host-ut_sso')!
    jar.set('__Host-ut_sso', 'not-the-right-browser')
    expect(await flow.completeOidcCallback('mock', new Request(callback.toString()), {})).toBe('/login?error=sso_failed')
    // …and the state is gone afterwards, so not even the right browser can replay it.
    jar.set('__Host-ut_sso', binding)
    expect(await flow.completeOidcCallback('mock', new Request(callback.toString()), {})).toBe('/login?error=sso_failed')
    expect(await provider.getSessionUser()).toBeNull()
  })

  it('PKCE: a code redeemed with another flow’s verifier is refused', async () => {
    idp.user = { sub: `sub-pkce-${RUN}`, email: `pkce@${DOMAIN}`, email_verified: true }
    const first = await authorizeAtMockIdp(await provider.startSso('mock', { redirect: '/tasks', org: null, origin: 'https://app.test' }))
    const second = await authorizeAtMockIdp(await provider.startSso('mock', { redirect: '/tasks', org: null, origin: 'https://app.test' }))
    // The browser holds the second flow's binding; splice the first flow's code into it.
    const spliced = new URL(second.toString())
    spliced.searchParams.set('code', first.searchParams.get('code')!)
    expect(await flow.completeOidcCallback('mock', new Request(spliced.toString()), {})).toBe('/login?error=sso_failed')
  })

  it('never redirects off-site after sign-in', async () => {
    const { startSsoAction } = await import('@/app/actions/auth')
    requestHeaders.set('host', 'app.test')
    idp.user = { sub: `sub-redirect-${RUN}`, email: `redirect@${DOMAIN}`, email_verified: true }
    for (const redirect of ['https://evil.example/x', '//evil.example', '/\\evil.example']) {
      resetRequest()
      requestHeaders.set('host', 'app.test')
      const started = await startSsoAction({ provider: 'mock', redirect })
      expect(started.ok).toBe(true)
      const callback = await authorizeAtMockIdp((started as { url: string }).url)
      expect(await flow.completeOidcCallback('mock', new Request(callback.toString()), {})).toBe('/tasks')
    }
  })

  it('an unknown IdP id is unavailable, not an error page', async () => {
    expect(await flow.completeOidcCallback('nope', new Request('https://app.test/auth/sso/nope/callback?state=x&code=y'), {})).toBe('/login?error=sso_unavailable')
  })
})
