import { describe, expect, it, vi } from 'vitest'
import {
  WIZARD_STEP_IDS, checkAddress, idpFromForm, markStep, nextStep, parseInviteList, parseProgress, parseStoredIdps, stepAfter, stepBefore, summariseIdp, upsertIdp, idpRedirects,
} from '@/lib/setup/wizard-model'
import { supabaseMoves, signInSummary } from '@/lib/setup/wizard-data'
import { markStepAs, removeIdpAs, saveEmailAs, saveIdpAs, sendTestEmailAs, testIdpAs, type WizardDeps } from '@/lib/setup/wizard-server'
import { hostsForOptions, hostOfUrl } from '@/lib/install/egress'
import { resolveInstanceConfig, type InstanceConfig } from '@/lib/config'
import { runSetup, type SetupDeps } from '@/lib/setup/run'

const ADMIN = { id: '11111111-1111-1111-1111-111111111111', email: 'owner@example.com' }

describe('setup wizard model', () => {
  it('progress: parse tolerantly, mark, next step, finish', () => {
    expect(parseProgress(null)).toEqual({ steps: {}, finishedAt: null })
    expect(parseProgress('{"steps":{"email":"skipped","bogus":"done","team":"maybe"}}')).toEqual({ steps: { email: 'skipped' }, finishedAt: null })
    let p = parseProgress(undefined)
    expect(nextStep(p)).toBe('organisation')
    p = markStep(p, 'organisation', 'done')
    p = markStep(p, 'services', 'skipped')
    expect(nextStep(p)).toBe('sign-in')
    p = markStep(p, 'done', 'done', new Date('2026-11-14T00:00:00Z'))
    expect(p.finishedAt).toBe('2026-11-14T00:00:00.000Z')
    expect(markStep(p, 'done', 'done').finishedAt).toBe('2026-11-14T00:00:00.000Z')
    expect(stepAfter('team')).toBe('done')
    expect(stepAfter('done')).toBe('done')
    expect(stepBefore('organisation')).toBe('organisation')
    expect(WIZARD_STEP_IDS).toEqual(['account', 'organisation', 'services', 'sign-in', 'email', 'team', 'done'])
  })

  it('identity provider form: each kind builds a valid SSO entry, with plain errors', () => {
    const entra = idpFromForm({ kind: 'entra', id: 'entra', tenantId: 'contoso.onmicrosoft.com', clientId: 'cid', clientSecret: 's3cret', allowedDomains: 'contoso.com, fabrikam.com', defaultOrg: 'acme', defaultRole: 'member' })
    expect(entra.ok && entra.idp).toMatchObject({ id: 'entra', type: 'oidc', preset: 'entra', tenantId: 'contoso.onmicrosoft.com', clientSecret: 's3cret', allowedDomains: ['contoso.com', 'fabrikam.com'], defaultOrg: 'acme' })
    const adfs = idpFromForm({ kind: 'adfs', id: 'adfs', metadataUrl: 'https://adfs.example.com/FederationMetadata/2007-06/FederationMetadata.xml' })
    expect(adfs.ok && adfs.idp).toMatchObject({ type: 'saml', preset: 'adfs' })
    const kc = idpFromForm({ kind: 'keycloak', id: 'kc', baseUrl: 'http://localhost:8080', realm: 'usertasks', clientId: 'usertasks' })
    expect(kc.ok).toBe(true)
    const missing = idpFromForm({ kind: 'entra', id: 'Bad Id!' })
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(Object.keys(missing.errors).sort()).toEqual(['clientId', 'id', 'tenantId'])
    const badUrl = idpFromForm({ kind: 'oidc', id: 'x', issuer: 'not a url', clientId: 'c' })
    expect(!badUrl.ok && badUrl.errors.issuer).toBeTruthy()
  })

  it('editing keeps the stored client secret when the form leaves it blank; summaries never carry it', () => {
    const stored = { id: 'kc', type: 'oidc', preset: 'keycloak', baseUrl: 'https://sso.example.com', realm: 'r', clientId: 'c', clientSecret: 'stored-secret' }
    const edited = idpFromForm({ kind: 'keycloak', id: 'kc', baseUrl: 'https://sso.example.com', realm: 'r2', clientId: 'c' }, stored)
    expect(edited.ok && edited.raw.clientSecret).toBe('stored-secret')
    const summary = summariseIdp(stored)
    expect(JSON.stringify(summary)).not.toContain('stored-secret')
    expect(summary).toMatchObject({ kind: 'keycloak', hasSecret: true, where: 'https://sso.example.com (realm r)' })
    expect(summariseIdp({ ...stored, clientSecret: 'secret://kc' }).secretRef).toBe('secret://kc')
    expect(upsertIdp([stored, { id: 'b' }], { id: 'kc', x: 1 })).toEqual([{ id: 'kc', x: 1 }, { id: 'b' }])
    expect(parseStoredIdps('not json')).toEqual([])
    expect(parseStoredIdps(JSON.stringify([stored, 5, { noid: true }]))).toHaveLength(1)
    expect(idpRedirects('https://t.example.com/', { id: 'adfs', type: 'saml' }).map((r) => r.value)).toEqual(['https://t.example.com/auth/saml/adfs/metadata', 'https://t.example.com/auth/saml/adfs/acs'])
  })

  it('invite list and address check', () => {
    expect(parseInviteList('Ada@Example.com, grace@example.com\nada@example.com nope')).toEqual({ emails: ['ada@example.com', 'grace@example.com'], invalid: ['nope'] })
    expect(checkAddress(null, 'http://x').status).toBe('fail')
    expect(checkAddress('https://tasks.example.com', 'https://tasks.example.com/').status).toBe('ok')
    const mismatch = checkAddress('https://tasks.example.com', 'http://10.0.0.5:3000')
    expect(mismatch.status).toBe('warn')
    expect(mismatch.messages[0]).toMatch(/APP_URL is https:\/\/tasks\.example\.com/)
    expect(checkAddress('http://tasks.corp', 'http://tasks.corp').messages.join()).toMatch(/plain http/)
    expect(checkAddress('http://localhost:3490', 'http://localhost:3490').messages.join()).toMatch(/local address/)
  })

  it('moving off Supabase: in order, on the page only where it is safe, otherwise the commands', () => {
    const on = { enabled: true, block: null }
    const areas = (['db', 'auth', 'storage', 'realtime', 'email'] as const).map((area) => ({ area, label: area, onSupabase: area !== 'email', actions: { change: on, settings: on } }))
    const direct = supabaseMoves(areas, 'direct', true)
    expect(direct.map((m) => m.area)).toEqual(['storage', 'realtime', 'auth', 'db'])
    expect(direct.every((m) => m.how === 'page')).toBe(true)
    const serverless = supabaseMoves(areas, 'direct', false)
    expect(serverless.find((m) => m.area === 'db')).toMatchObject({ how: 'cli' })
    expect(serverless.find((m) => m.area === 'db')!.commands[0]).toMatch(/--dry-run$/)
    const locked = supabaseMoves(areas.map((a) => ({ ...a, actions: { change: { enabled: false, block: { kind: 'flag-off' as const, message: 'off' } }, settings: on } })), 'direct', true)
    expect(locked.every((m) => m.how === 'cli')).toBe(true)
  })

  it('sign-in summary refuses on Supabase Auth and when the environment pins the providers', () => {
    const config = resolveInstanceConfig(new Map<string, unknown>([['providers.auth', 'builtin'], ['auth.sso_providers', JSON.stringify([{ id: 'kc', type: 'oidc', preset: 'keycloak', baseUrl: 'https://kc', realm: 'r', clientId: 'c', clientSecret: 'x' }])]]))
    const s = signInSummary(config, false)
    expect(s.refusal).toBeNull()
    expect(s.idps[0]).toMatchObject({ id: 'kc', hasSecret: true })
    expect(JSON.stringify(s)).not.toContain('"x"')
    expect(signInSummary(config, true).refusal).toMatch(/AUTH_SSO_PROVIDERS/)
  })
})

describe('egress hosts of a provider change', () => {
  it('finds the hosts a test would contact', () => {
    expect(hostOfUrl('postgres://u:p@db.internal:5432/x')).toBe('db.internal')
    expect(hostOfUrl('smtp.example.com')).toBe('smtp.example.com')
    expect(hostsForOptions('email', { smtp_host: 'Mail.Internal', from: 'a@b.co' })).toEqual(['mail.internal'])
    expect(hostsForOptions('storage', { endpoint: 'http://minio:9000', bucket: 'b' })).toEqual(['minio'])
    expect(hostsForOptions('auth', { sso_providers: JSON.stringify([{ issuer: 'https://id.example.com/x' }, { baseUrl: 'http://localhost:8080' }, { domain: 'acme.okta.com' }]) })).toEqual(['id.example.com', 'localhost', 'acme.okta.com'])
    expect(hostsForOptions('db', {}, { 'target-url': 'postgres://u@10.0.0.9/x' })).toEqual(['10.0.0.9'])
    expect(hostsForOptions('cache', { redis_url: 'rediss://cache:6380' })).toEqual(['cache'])
  })
})

function config(settings: Record<string, unknown> = {}): InstanceConfig {
  return resolveInstanceConfig(new Map(Object.entries(settings)))
}

function deps(overrides: Partial<WizardDeps> = {}): WizardDeps & { written: Array<[string, unknown]>; saved: unknown[]; switched: unknown[] } {
  const written: Array<[string, unknown]> = []
  const saved: unknown[] = []
  const switched: unknown[] = []
  const store = new Map<string, unknown>()
  return {
    written, saved, switched,
    canView: async (u) => u?.email === ADMIN.email,
    rateLimit: async () => true,
    readSetting: async (k) => store.get(k),
    writeSetting: async (k, v) => { store.set(k, v); written.push([k, v]) },
    config: async () => config({ 'providers.auth': 'builtin', 'providers.email': 'console' }),
    checkHosts: async () => ({ ok: true }),
    checkIdp: async (idp) => ({ id: idp.id, type: idp.type, ok: true, detail: 'discovery OK', warnings: [] }),
    sendTestEmail: async (to) => [{ name: 'config', status: 'ok', detail: 'ok' }, { name: 'test send', status: 'ok', detail: `sent to ${to}` }],
    saveSettings: async (_u, input) => { saved.push(input); return { ok: true, saved: true, lines: [] } },
    applySwitch: async (_u, input) => { switched.push(input); return { ok: true, lines: ['switched'], mode: 'direct' } },
    appUrl: () => 'http://localhost:3490',
    ...overrides,
  }
}

describe('setup wizard actions', () => {
  it('only instance admins; unknown steps refused', async () => {
    const d = deps()
    expect(await markStepAs({ id: 'x', email: 'someone@example.com' }, 'email', 'done', d)).toMatchObject({ ok: false, error: expect.stringMatching(/instance administrators/) })
    expect(await markStepAs(null, 'email', 'done', d)).toMatchObject({ ok: false })
    expect(await markStepAs(ADMIN, 'nope', 'done', d)).toMatchObject({ ok: false, error: 'Unknown step' })
    expect(await markStepAs(ADMIN, 'email', 'later', d)).toMatchObject({ ok: false })
    const res = await markStepAs(ADMIN, 'email', 'skipped', d)
    expect(res).toMatchObject({ ok: true, progress: { steps: { email: 'skipped' } } })
    expect(d.written[0][0]).toBe('instance.setup_wizard')
    for (const fn of [testIdpAs, saveIdpAs, removeIdpAs, saveEmailAs, sendTestEmailAs]) {
      expect(await fn({ id: 'x', email: 'intruder@example.com' }, {} as never, d)).toMatchObject({ ok: false, error: expect.stringMatching(/instance administrators/) })
    }
  })

  it('test identity provider: rate limited, egress-guarded with an allow suggestion, then the check result', async () => {
    const form = { kind: 'keycloak', id: 'kc', baseUrl: 'http://localhost:8080', realm: 'usertasks', clientId: 'usertasks' }
    expect(await testIdpAs(ADMIN, form, deps({ rateLimit: async () => false }))).toMatchObject({ ok: false, error: expect.stringMatching(/Too many/) })
    const blocked = await testIdpAs(ADMIN, form, deps({ checkHosts: async (hosts) => ({ ok: false, host: hosts[0], reason: 'Connection to localhost is not allowed: a loopback address (127.0.0.1) is blocked', allowEntry: '127.0.0.1/32' }) }))
    expect(blocked).toMatchObject({ ok: false, allowEntry: '127.0.0.1/32', error: expect.stringMatching(/^localhost can't be tested/) })
    const checkHosts = vi.fn(async () => ({ ok: true as const }))
    const ok = await testIdpAs(ADMIN, form, deps({ checkHosts }))
    expect(ok).toMatchObject({ ok: true, result: { ok: true, detail: 'discovery OK' } })
    expect(checkHosts).toHaveBeenCalledWith(['localhost'])
    const failing = await testIdpAs(ADMIN, form, deps({ checkIdp: async () => { throw new Error('discovery returned HTTP 404') } }))
    expect(failing).toMatchObject({ ok: true, result: { ok: false, detail: 'discovery returned HTTP 404' } })
    expect(await testIdpAs(ADMIN, { kind: 'entra', id: 'e' }, deps())).toMatchObject({ ok: false, fieldErrors: { tenantId: expect.any(String) } })
  })

  it('save identity provider: merged into auth.sso_providers through the settings engine; refused on Supabase Auth', async () => {
    const existing = [{ id: 'entra', type: 'oidc', preset: 'entra', tenantId: 't', clientId: 'c', clientSecret: 'keep-me' }]
    const d = deps({ config: async () => config({ 'providers.auth': 'builtin', 'auth.sso_providers': JSON.stringify(existing) }) })
    expect(await saveIdpAs(ADMIN, { kind: 'keycloak', id: 'kc', baseUrl: 'https://kc.example.com', realm: 'r', clientId: 'c', clientSecret: 'new' }, d)).toEqual({ ok: true, id: 'kc' })
    const input = d.saved[0] as { area: string; values: { sso_providers: string } }
    expect(input.area).toBe('auth')
    const list = JSON.parse(input.values.sso_providers)
    expect(list.map((x: { id: string }) => x.id)).toEqual(['entra', 'kc'])
    expect(list[0].clientSecret).toBe('keep-me')
    // Editing entra without a secret keeps it.
    await saveIdpAs(ADMIN, { kind: 'entra', id: 'entra', tenantId: 't2', clientId: 'c' }, d)
    expect(JSON.parse((d.saved[1] as typeof input).values.sso_providers)[0]).toMatchObject({ tenantId: 't2', clientSecret: 'keep-me' })
    const sb = deps({ config: async () => config({ 'providers.auth': 'supabase' }) })
    expect(await saveIdpAs(ADMIN, { kind: 'keycloak', id: 'kc', baseUrl: 'https://kc', realm: 'r', clientId: 'c' }, sb)).toMatchObject({ ok: false, error: expect.stringMatching(/Supabase Auth/) })
    // The engine's refusal (e.g. the egress guard) comes back as is, with its allow suggestion.
    const refused = deps({ saveSettings: async () => ({ ok: false, error: 'kc blocked', allowEntry: 'kc.internal' }) })
    expect(await saveIdpAs(ADMIN, { kind: 'keycloak', id: 'kc', baseUrl: 'https://kc.internal', realm: 'r', clientId: 'c' }, refused)).toEqual({ ok: false, error: 'kc blocked', allowEntry: 'kc.internal' })
  })

  it('remove identity provider: never the last one of OIDC-only sign-in; clearing the last one otherwise', async () => {
    const list = [{ id: 'kc', type: 'oidc', preset: 'keycloak', baseUrl: 'https://kc', realm: 'r', clientId: 'c' }]
    const oidcOnly = deps({ config: async () => config({ 'providers.auth': 'oidc', 'auth.sso_providers': JSON.stringify(list) }) })
    expect(await removeIdpAs(ADMIN, 'kc', oidcOnly)).toMatchObject({ ok: false, error: expect.stringMatching(/lock everyone out/) })
    const builtin = deps({ config: async () => config({ 'providers.auth': 'builtin', 'auth.sso_providers': JSON.stringify(list) }) })
    expect(await removeIdpAs(ADMIN, 'nope', builtin)).toMatchObject({ ok: false })
    expect(await removeIdpAs(ADMIN, 'kc', builtin)).toEqual({ ok: true })
    expect(builtin.saved[0]).toMatchObject({ area: 'auth', clear: ['sso_providers'] })
  })

  it('email: same provider is a settings change, another provider a switch with its defaults; env-pinned refused', async () => {
    const smtp = deps({ config: async () => config({ 'providers.email': 'smtp', 'email.smtp_host': 'old', 'email.from': 'a@b.co' }) })
    expect(await saveEmailAs(ADMIN, { choice: 'smtp', values: { smtp_host: 'mail.example.com', smtp_password: '' } }, smtp)).toMatchObject({ ok: true, switched: false })
    expect(smtp.saved[0]).toEqual({ area: 'email', values: { smtp_host: 'mail.example.com' }, dryRun: false })
    const console_ = deps()
    expect(await saveEmailAs(ADMIN, { choice: 'm365', values: { from: 'tasks@contoso.com', smtp_user: 'tasks@contoso.com', smtp_password: 'pw' } }, console_)).toMatchObject({ ok: true, switched: true })
    expect(console_.switched[0]).toMatchObject({ area: 'email', to: 'smtp', values: { smtp_host: 'smtp.office365.com', smtp_port: '587', smtp_starttls: 'required', smtp_user: 'tasks@contoso.com', smtp_password: 'pw' } })
    expect(await saveEmailAs(ADMIN, { choice: 'pigeon', values: {} }, console_)).toMatchObject({ ok: false })
    const pinned = deps({ config: async () => { const c = config(); c.providers.email = { ...c.providers.email, source: 'env' }; return c } })
    expect(await saveEmailAs(ADMIN, { choice: 'smtp', values: {} }, pinned)).toMatchObject({ ok: false, error: expect.stringMatching(/EMAIL_PROVIDER/) })
  })

  it('test email: validates the address, rate limited, egress-guarded on the mail server', async () => {
    expect(await sendTestEmailAs(ADMIN, 'nope', deps())).toMatchObject({ ok: false, fieldErrors: { to: expect.any(String) } })
    expect(await sendTestEmailAs(ADMIN, 'me@example.com', deps({ rateLimit: async () => false }))).toMatchObject({ ok: false, error: expect.stringMatching(/Too many/) })
    const checkHosts = vi.fn(async () => ({ ok: false as const, host: '127.0.0.1', reason: 'a loopback address (127.0.0.1) is blocked', allowEntry: '127.0.0.1/32' }))
    const smtp = deps({ checkHosts, config: async () => config({ 'providers.email': 'smtp', 'email.smtp_host': '127.0.0.1', 'email.from': 'a@b.co' }) })
    expect(await sendTestEmailAs(ADMIN, 'me@example.com', smtp)).toMatchObject({ ok: false, allowEntry: '127.0.0.1/32' })
    expect(checkHosts).toHaveBeenCalledWith(['127.0.0.1'])
    expect(await sendTestEmailAs(ADMIN, 'Me@Example.com', deps())).toMatchObject({ ok: true, checks: [{ name: 'config' }, { name: 'test send', detail: 'sent to me@example.com' }] })
  })
})

describe('first-run setup hands over to the wizard', () => {
  const input = { org: 'Acme Inc', slug: 'acme-inc', fullName: 'Ada', email: 'Ada@Example.com', password: 'correct horse', confirmPassword: 'correct horse', code: 'ABCD-EFGH-JKLM' }
  function setupDeps(extra: Partial<SetupDeps>): SetupDeps {
    let claimed = false
    const db = {
      from: (table: string) => {
        const q: Record<string, unknown> = {}
        const chain = () => q
        Object.assign(q, {
          select: chain, eq: chain, is: chain, limit: chain, maybeSingle: chain, single: chain, insert: chain, upsert: chain, update: chain, delete: chain, in: chain, neq: chain, order: chain,
          then: (resolve: (v: unknown) => void) => resolve({ data: table === 'instance_settings' ? (claimed ? [] : []) : [], error: null, count: 0 }),
        })
        return q
      },
    }
    void claimed
    return {
      db: db as never, ip: '127.0.0.1', rateLimit: async () => ({ ok: true }), env: { USERTASKS_SETUP_CODE: 'ABCD-EFGH-JKLM' },
      provision: async () => ({ ok: true, tenantId: 't1', userId: 'u1', slug: 'acme-inc' }) as never,
      signIn: async () => true, audit: async () => undefined, ...extra,
    }
  }

  it('grants instance admin and continues in the wizard; without the grant, onboarding as before', async () => {
    const grant = vi.fn(async () => true)
    const state = await import('@/lib/setup/state')
    vi.spyOn(state, 'isInstanceEmpty').mockResolvedValue(true)
    vi.spyOn(state, 'checkSetupCode').mockResolvedValue(true)
    vi.spyOn(state, 'claimSetup').mockResolvedValue('claim-1' as never)
    vi.spyOn(state, 'completeSetup').mockResolvedValue(undefined as never)
    expect(await runSetup(input, setupDeps({ grantInstanceAdmin: grant }))).toMatchObject({ ok: true, redirect: '/settings/setup?step=organisation' })
    expect(grant).toHaveBeenCalledWith('ada@example.com', 'u1')
    expect(await runSetup(input, setupDeps({ grantInstanceAdmin: async () => { throw new Error('db down') } }))).toMatchObject({ ok: true, redirect: '/onboarding' })
    vi.restoreAllMocks()
  })
})

describe('client-safe modules', () => {
  it('the wizard model, the install profile and the SSO schema import no server code (they reach client bundles)', async () => {
    const { readFileSync } = await import('node:fs')
    const imports = (file: string) => [...readFileSync(file, 'utf8').matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1])
    expect(imports('lib/providers/auth/sso/schema.ts')).toEqual(['zod'])
    for (const file of ['lib/setup/wizard-model.ts', 'lib/install/profile.ts']) {
      for (const dep of imports(file)) expect(dep, `${file} → ${dep}`).toMatch(/^(zod|@\/lib\/config\/(schema|provider-forms)|@\/lib\/providers\/auth\/sso\/schema)$/)
    }
  })
})
