/**
 * SAML sign-in (built-in sessions + a SAML IdP from AUTH_SSO_PROVIDERS) with a
 * test IdP that signs responses with a fixture key
 * (__tests__/helpers/saml-test-idp.ts), against the local stack's database:
 * SP-initiated (InResponseTo) and IdP-initiated sign-in, signed assertions
 * only, audience / time conditions with clock skew, assertion replay, JIT
 * provisioning and safe RelayState redirects; plus the SP metadata.
 *
 * Runs only against a LOCAL Supabase stack — set EVENT_STREAM_DB_URL, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/auth-saml-db.test.ts
 * Skipped when the optional @node-saml/node-saml package or the openssl CLI
 * (used to generate throwaway IdP keys) isn't available.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Client } from 'pg'
import { dataApiProvider, dbCapabilities } from './helpers/db-capabilities'
import { resetRequest } from './helpers/next-headers-mock'
import { buildSamlResponse, HAS_OPENSSL, IDP_CERT, OTHER_CERT, OTHER_KEY, readAuthnRequest } from './helpers/saml-test-idp'

vi.mock('next/headers', () => import('./helpers/next-headers-mock'))

const DB_URL = process.env.EVENT_STREAM_DB_URL
// The stack's PostgREST on a Supabase database; pg-query on plain Postgres.
const DATA_API = dataApiProvider(await dbCapabilities())
const HAS_NODE_SAML = existsSync(path.join(__dirname, '..', 'node_modules', '@node-saml', 'node-saml', 'package.json'))
const API_URL = process.env.ENGINE_SMOKE_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.ENGINE_SMOKE_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const RUN = randomUUID().slice(0, 8)
const SLUG = `auth-saml-${RUN}`
const DOMAIN = `saml-${RUN}.test`
const IDP_ISSUER = 'https://idp.example.test/saml'
const ACS = 'https://app.test/auth/saml/corp/acs'
const SP_ENTITY = 'https://app.test/auth/saml/corp/metadata'
const ENV_KEYS = ['AUTH_PROVIDER', 'DB_PROVIDER', 'DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'APP_URL', 'AUTH_SSO_PROVIDERS'] as const
const saved: Record<string, string | undefined> = {}

describe.skipIf(!DB_URL || !HAS_NODE_SAML || !HAS_OPENSSL)('SAML sign-in (test IdP, local stack)', () => {
  const pg = new Client({ connectionString: DB_URL })
  let tenantId = ''
  let provider: import('@/lib/providers/auth').AuthProvider
  let flow: typeof import('@/lib/providers/auth/sso/flow')

  const configure = (overrides: Record<string, unknown> = {}) => {
    process.env.AUTH_SSO_PROVIDERS = JSON.stringify([{
      id: 'corp',
      type: 'saml',
      preset: 'okta',
      name: 'Corp SSO',
      entryPoint: 'https://idp.example.test/sso',
      idpCert: IDP_CERT,
      idpIssuer: IDP_ISSUER,
      allowedDomains: [DOMAIN],
      defaultOrg: SLUG,
      roleMapping: { 'ut-admins': 'admin' },
      ...overrides,
    }])
  }

  const acs = (body: { SAMLResponse: string; RelayState?: string | null }) =>
    flow.completeSamlResponse('corp', body, new Request(ACS, { method: 'POST' }), { ip: '192.0.2.10', userAgent: 'vitest' })

  const user = (name: string) => ({ email: `${name}@${DOMAIN}` })

  beforeAll(async () => {
    for (const key of ENV_KEYS) saved[key] = process.env[key]
    Object.assign(process.env, {
      AUTH_PROVIDER: 'saml',
      DB_PROVIDER: DATA_API,
      DATABASE_URL: DB_URL,
      ...(DATA_API === 'supabase' ? { SUPABASE_URL: API_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY } : {}),
      APP_URL: 'https://app.test',
    })
    configure()
    await pg.connect()
    const { rows } = await pg.query<{ id: string }>(`INSERT INTO public.tenants (name, slug) VALUES ($1, $2) RETURNING id`, [`SAML ${RUN}`, SLUG])
    tenantId = rows[0].id
    provider = (await import('@/lib/providers/auth')).resolveAuthProvider('saml')
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
    const { closeAuthDb } = await import('@/lib/providers/auth/builtin/db')
    await closeAuthDb()
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  }, 60_000)

  beforeEach(() => {
    resetRequest()
    configure()
  })

  it('SAML-only mode: no password sign-in, the IdP is the only option', async () => {
    expect(await provider.loginOptions()).toEqual({ provider: 'saml', password: false, sso: [{ id: 'corp', name: 'Corp SSO', kind: 'saml' }] })
    await expect(provider.signInWithPassword('a@b.test', 'x')).rejects.toMatchObject({ code: 'not_supported' })
  })

  it('SP-initiated: AuthnRequest → signed response with InResponseTo → signed in, provisioned with the mapped role', async () => {
    const redirect = await provider.startSso('corp', { redirect: '/reports', org: null, origin: 'https://app.test' })
    expect(redirect.startsWith('https://idp.example.test/sso?')).toBe(true)
    const request = readAuthnRequest(redirect)
    expect(request.xml).toContain(`AssertionConsumerServiceURL="${ACS}"`)
    expect(request.xml).toContain(SP_ENTITY)

    const { email } = user('sp.initiated')
    const SAMLResponse = await buildSamlResponse({
      issuer: IDP_ISSUER, audience: SP_ENTITY, acsUrl: ACS, nameId: email, inResponseTo: request.id,
      attributes: { email, name: 'SP Initiated', groups: ['UT-Admins'] },
    })
    expect(await acs({ SAMLResponse, RelayState: request.relayState })).toBe('/reports')
    const signedIn = await provider.getSessionUser()
    expect(signedIn?.email).toBe(email)
    const { rows } = await pg.query(
      `SELECT r.slug FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id WHERE ur.user_id = $1 AND ur.tenant_id = $2`,
      [signedIn!.id, tenantId],
    )
    expect(rows).toEqual([{ slug: 'admin' }])

    // The same response again (replay) is refused, and so is the same request id.
    resetRequest()
    expect(await acs({ SAMLResponse, RelayState: request.relayState })).toBe('/login?error=sso_failed')
    const again = await buildSamlResponse({ issuer: IDP_ISSUER, audience: SP_ENTITY, acsUrl: ACS, nameId: email, inResponseTo: request.id, attributes: { email } })
    expect(await acs({ SAMLResponse: again })).toBe('/login?error=sso_failed')
    expect(await provider.getSessionUser()).toBeNull()
  })

  it('IdP-initiated: accepted when allowed; RelayState only redirects to local paths', async () => {
    const { email } = user('idp.initiated')
    const make = () => buildSamlResponse({ issuer: IDP_ISSUER, audience: SP_ENTITY, acsUrl: ACS, nameId: email, attributes: { email } })
    const first = await make()
    expect(await acs({ SAMLResponse: first, RelayState: '/data' })).toBe('/data')
    // Unsolicited responses have no request id to consume: the assertion id cache stops a replay.
    resetRequest()
    expect(await acs({ SAMLResponse: first, RelayState: '/data' })).toBe('/login?error=sso_failed')
    expect(await provider.getSessionUser()).toBeNull()
    resetRequest()
    expect(await acs({ SAMLResponse: await make(), RelayState: 'https://evil.example/' })).toBe('/tasks')
    resetRequest()
    expect(await acs({ SAMLResponse: await make(), RelayState: '//evil.example' })).toBe('/tasks')

    resetRequest()
    configure({ allowIdpInitiated: false })
    expect(await acs({ SAMLResponse: await make() })).toBe('/login?error=sso_failed')
  })

  it('refuses unknown InResponseTo, unsigned, wrongly signed and tampered responses', async () => {
    const { email } = user('bad')
    const base = { issuer: IDP_ISSUER, audience: SP_ENTITY, acsUrl: ACS, nameId: email, attributes: { email } }
    const cases = {
      unknownRequest: await buildSamlResponse({ ...base, inResponseTo: '_never-issued' }),
      unsigned: await buildSamlResponse({ ...base, sign: 'none' }),
      otherKey: await buildSamlResponse({ ...base, key: OTHER_KEY, cert: OTHER_CERT }),
      tampered: await buildSamlResponse({ ...base, mutate: (xml) => xml.replace(`>${email}<`, `>ceo@${DOMAIN}<`) }),
    }
    for (const [name, SAMLResponse] of Object.entries(cases)) {
      resetRequest()
      expect(await acs({ SAMLResponse }), name).toBe('/login?error=sso_failed')
      expect(await provider.getSessionUser(), name).toBeNull()
    }
  })

  it('checks audience and validity window with the configured clock skew', async () => {
    const { email } = user('timing')
    const base = { issuer: IDP_ISSUER, audience: SP_ENTITY, acsUrl: ACS, nameId: email, attributes: { email } }
    expect(await acs({ SAMLResponse: await buildSamlResponse({ ...base, audience: 'https://someone-else.test' }) })).toBe('/login?error=sso_failed')
    expect(await acs({ SAMLResponse: await buildSamlResponse({ ...base, notOnOrAfterSeconds: -600 }) })).toBe('/login?error=sso_failed')
    expect(await acs({ SAMLResponse: await buildSamlResponse({ ...base, notBeforeSeconds: 600 }) })).toBe('/login?error=sso_failed')
    // Expired 20 s ago: inside the default 60 s skew.
    expect(await acs({ SAMLResponse: await buildSamlResponse({ ...base, notOnOrAfterSeconds: -20 }) })).toBe('/tasks')
  })

  it('email from NameID, domain allowlist enforced', async () => {
    const outsider = `someone@elsewhere-${RUN}.test`
    expect(await acs({ SAMLResponse: await buildSamlResponse({ issuer: IDP_ISSUER, audience: SP_ENTITY, acsUrl: ACS, nameId: outsider }) })).toBe('/login?error=sso_failed')
    resetRequest()
    const { email } = user('nameid.only')
    expect(await acs({ SAMLResponse: await buildSamlResponse({ issuer: IDP_ISSUER, audience: SP_ENTITY, acsUrl: ACS, nameId: email }) })).toBe('/tasks')
    expect((await provider.getSessionUser())?.email).toBe(email)
  })

  it('without allowedDomains (or trustEmail) the IdP\'s email is not trusted: no JIT, no linking', async () => {
    configure({ allowedDomains: undefined })
    const { email } = user('untrusted')
    expect(await acs({ SAMLResponse: await buildSamlResponse({ issuer: IDP_ISSUER, audience: SP_ENTITY, acsUrl: ACS, nameId: email, attributes: { email } }) })).toBe('/login?error=sso_failed')
    expect(await provider.getSessionUser()).toBeNull()
    resetRequest()
    configure({ allowedDomains: undefined, trustEmail: true })
    expect(await acs({ SAMLResponse: await buildSamlResponse({ issuer: IDP_ISSUER, audience: SP_ENTITY, acsUrl: ACS, nameId: email, attributes: { email } }) })).toBe('/tasks')
  })

  it('serves SP metadata with the entity id and ACS URL', async () => {
    const { samlMetadataXml } = await import('@/lib/providers/auth/sso/saml')
    const { getSsoProvider } = await import('@/lib/providers/auth/sso/config')
    const idp = await getSsoProvider('corp')
    const xml = await samlMetadataXml(idp as never, 'https://app.test')
    expect(xml).toContain(`entityID="${SP_ENTITY}"`)
    expect(xml).toContain(`Location="${ACS}"`)
    expect(xml).toContain('WantAssertionsSigned="true"')
  })
})
