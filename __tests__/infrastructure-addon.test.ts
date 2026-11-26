/**
 * The Infrastructure add-on boundary (lib/infrastructure, lib/install/standard-stack):
 *
 *  - core RUNS any configuration: a separated configuration resolves and its
 *    providers load without the add-on or a licence, and nothing on the
 *    runtime path imports the add-on resolver;
 *  - core REFUSES changes off the standard stack itself (server side, not
 *    just hidden): settings of non-free areas, email APIs, every add-on action
 *    when the add-on is missing, unlicensed or expired past the 24-hour grace;
 *  - free changes stay free: email between SMTP / Resend / log-only;
 *  - the installer refuses a separated profile without an Infrastructure
 *    licence (checked offline against a throwaway key here), and accepts a
 *    re-run of what an install already runs.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/providers/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/providers/db')>()),
  getServiceDb: () => createFakeSupabase({}).client,
}))
vi.mock('@/lib/admin/infrastructure', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/admin/infrastructure')>()),
  viewerCanSeeInfrastructure: async (user: { email?: string | null } | null | undefined) => user?.email === 'admin@example.com',
}))

import { parseExtensionManifest } from '@/lib/extensions/manifest'
import { registerExtensionsForTest, resetExtensionsForTest } from '@/lib/extensions/testing'
import { wireLicensingEntitlements } from '@/lib/extensions/licensing-wiring'
import type { ExtensionDefinition, ServerExtension } from '@/lib/extensions/sdk'
import { invalidateLicenceCache, licensingDeps, type LicensingDeps } from '@/lib/licensing/service'
import { EXPIRY_CUTOFF_MS } from '@/lib/licensing/format'
import { resolveInstanceConfig } from '@/lib/config'
import { PROVIDER_ENV } from '@/lib/config/schema'
import { isFreeProviderChange, isFreeSettingsChange, INFRASTRUCTURE_PRICE, addonRequiredMessage } from '@/lib/infrastructure/addon'
import { __setInfrastructureAddonForTests, infrastructureAddon, infrastructureAddonView } from '@/lib/infrastructure/provider'
import { callInfrastructureAction } from '@/lib/infrastructure/dispatch'
import { checkInfrastructureLicenceText, infrastructureDecision } from '@/lib/infrastructure/licence-gate'
import { changeEmailProviderAs, saveProviderSettingsAs, type InfrastructureSettingsDeps } from '@/lib/admin/infrastructure-settings'
import { runProviderSwitchesJob } from '@/lib/jobs/provider-switches'
import { presetProfile, validateProfile, mergeProfileLayers, type Profile } from '@/lib/install/profile'
import { classifyProfile, envFingerprint, newSeparation } from '@/lib/install/standard-stack'
import { runInstallCommand, separationGate } from '@/packages/admin/src/install-cli'
import { makeLicence, throwawayKey } from './helpers/licence-fixtures'
import { createFakeSupabase } from './helpers/fake-supabase'

const KEY = throwawayKey('test-infra-1')
const EXPIRES = '2027-11-01T00:00:00.000Z'
const plus = (iso: string, ms: number) => new Date(Date.parse(iso) + ms)
const VALID = plus(EXPIRES, -30 * 86_400_000)
const IN_GRACE = plus(EXPIRES, 23 * 3600_000)
const PAST_CUTOFF = plus(EXPIRES, EXPIRY_CUTOFF_MS + 60_000)
const IDENTITY = { instanceId: 'inst_abcdefghijklmnopqrstuvwx', hostnames: ['tasks.example.com'] }

const infraLicence = (over: Parameters<typeof makeLicence>[2] = {}) => makeLicence(KEY.pem, 'test-infra-1', {
  licence_id: 'lic_infra_1', expires_at: EXPIRES, sku: 'infrastructure', extensions: [{ id: 'infrastructure', features: ['infrastructure-separation'] }], ...over,
})

const ADMIN = { id: 'u-admin', email: 'admin@example.com' }
const OWNER = { id: 'u-owner', email: 'owner@example.com' }

// ── A stand-in add-on registered like a build that includes it ─────────────

const calls: Array<{ name: string; input: unknown }> = []
// A minimal manifest shaped like the private add-on's (core tests never import the private package).
const definition = {
  manifest: parseExtensionManifest({
    manifest_version: 1, id: 'infrastructure', name: 'Infrastructure', version: '0.1.0', publisher: { id: 'usertasks', name: 'UserTasks' },
    engines: { usertasks: '>=0.0.0', extension_sdk: '^1.2.0' }, licence: { tier: 'paid', sku: 'infrastructure', features: ['infrastructure-separation'] },
    deployments: ['self_hosted', 'cloud'],
  }),
} as unknown as ExtensionDefinition
const server: ServerExtension = {
  id: 'infrastructure',
  infrastructure: {
    feature: 'infrastructure-separation',
    href: '/x/infrastructure',
    actions: { applySwitch: async ({ input }) => { calls.push({ name: 'applySwitch', input }); return { ok: true, applied: true } } },
    runQueued: async () => ({ started: true }),
  },
}

let clock = VALID
let licences: unknown[] = []
let saved: Partial<LicensingDeps> = {}

function useAddon() {
  registerExtensionsForTest({ definitions: [definition], servers: [server] })
  wireLicensingEntitlements()
  saved = { ...licensingDeps }
  Object.assign(licensingDeps, {
    now: () => clock,
    keyring: () => [KEY.entry],
    identity: async () => IDENTITY,
    licences: async () => licences.map((raw) => ({ source: 'setting' as const, raw })),
    tenantEntitlements: async () => [],
    audit: async () => {},
    shouldAuditDenial: async () => false,
  } satisfies Partial<LicensingDeps>)
  invalidateLicenceCache()
}

afterEach(() => {
  vi.unstubAllEnvs()
  if (Object.keys(saved).length) Object.assign(licensingDeps, saved)
  saved = {}
  invalidateLicenceCache()
  resetExtensionsForTest()
  __setInfrastructureAddonForTests(undefined)
  calls.length = 0
})

describe('the free / paid line', () => {
  it('email transports and sign-in settings are free; switches and other settings are not', () => {
    for (const to of ['smtp', 'resend', 'console']) expect(isFreeProviderChange('email', to)).toBe(true)
    for (const to of ['ses', 'azure_communication', 'microsoft_graph', 'gmail']) expect(isFreeProviderChange('email', to)).toBe(false)
    for (const area of ['db', 'auth', 'storage', 'realtime', 'scheduler', 'secrets', 'cache', 'kms'] as const) expect(isFreeProviderChange(area, 'anything')).toBe(false)
    expect(isFreeSettingsChange('email', 'smtp')).toBe(true)
    expect(isFreeSettingsChange('email', 'ses')).toBe(false)
    expect(isFreeSettingsChange('auth', 'builtin')).toBe(true)
    for (const area of ['db', 'storage', 'realtime', 'scheduler', 'secrets', 'cache', 'kms'] as const) expect(isFreeSettingsChange(area, 'x')).toBe(false)
    expect(INFRASTRUCTURE_PRICE).toBe('$9,000 USD per deployment per year')
  })
})

describe('add-on resolution and licence (instance-wide, 24-hour grace)', () => {
  it('missing from the build', async () => {
    expect((await infrastructureAddon()).state).toBe('missing')
  })

  it('installed without a licence, licensed, in the grace day, and expired', async () => {
    useAddon()
    licences = []
    const none = await infrastructureAddon()
    expect(none.state).toBe('unlicensed')
    expect(none.state === 'unlicensed' && none.reason).toMatch(/Infrastructure add-on/)

    licences = [infraLicence()]
    invalidateLicenceCache()
    expect((await infrastructureAddon()).state).toBe('ready')

    clock = IN_GRACE
    const grace = await infrastructureAddon()
    expect(grace.state).toBe('ready')
    expect(grace.state === 'ready' && grace.warning).toMatch(/stops at/)

    clock = PAST_CUTOFF
    const expired = await infrastructureAddon()
    expect(expired.state).toBe('unlicensed')
    expect(expired.state === 'unlicensed' && expired.reason).toMatch(/expired/)
  })

  it('pages say why it is unlicensed without repeating the whole refusal', async () => {
    useAddon()
    licences = []
    const view = await infrastructureAddonView()
    expect(view.state).toBe('unlicensed')
    expect(view.reason).toMatch(/not licensed/)
    expect(view.reason).not.toMatch(/needs the Infrastructure add-on/)
    // Server refusals keep the full message.
    const addon = await infrastructureAddon()
    expect(addon.state === 'unlicensed' && addon.reason).toMatch(/needs the Infrastructure add-on/)
  })

  it('a licence for another extension or without the feature does not count', async () => {
    useAddon()
    licences = [infraLicence({ extensions: [{ id: 'sharepoint' }] })]
    expect((await infrastructureAddon()).state).toBe('unlicensed')
    licences = [infraLicence({ extensions: [{ id: 'infrastructure', features: ['something-else'] }] })]
    invalidateLicenceCache()
    expect((await infrastructureAddon()).state).toBe('unlicensed')
  })
})

describe('core refuses add-on actions server side', () => {
  it('without the add-on, unlicensed, or expired: refused before the add-on runs', async () => {
    const missing = await callInfrastructureAction(ADMIN, 'applySwitch', { area: 'db', to: 'postgres' })
    expect(missing).toMatchObject({ ok: false, code: 'addon_required' })
    expect(missing.ok === false && missing.error).toMatch(/needs the Infrastructure add-on/)

    useAddon()
    licences = []
    expect(await callInfrastructureAction(ADMIN, 'applySwitch', {})).toMatchObject({ ok: false, code: 'addon_required' })
    licences = [infraLicence()]
    clock = PAST_CUTOFF
    invalidateLicenceCache()
    expect(await callInfrastructureAction(ADMIN, 'applySwitch', {})).toMatchObject({ ok: false, code: 'addon_required' })
    expect(calls).toEqual([])
  })

  it('with a licence the add-on action runs — for instance admins only', async () => {
    useAddon()
    licences = [infraLicence()]
    clock = VALID
    expect(await callInfrastructureAction(OWNER, 'applySwitch', {})).toMatchObject({ ok: false, error: expect.stringMatching(/instance administrators/) })
    expect(await callInfrastructureAction(null, 'applySwitch', {})).toMatchObject({ ok: false })
    expect(await callInfrastructureAction(ADMIN, 'applySwitch', { area: 'db' })).toEqual({ ok: true, applied: true })
    expect(await callInfrastructureAction(ADMIN, 'constructor', {})).toMatchObject({ ok: false, error: expect.stringMatching(/Unknown/) })
    expect(calls).toEqual([{ name: 'applySwitch', input: { area: 'db' } }])
  })

  it('the background switch job does nothing without a licensed add-on', async () => {
    const env = process.env.DATABASE_URL
    process.env.DATABASE_URL = 'postgres://x@127.0.0.1:1/none'
    try {
      expect(await runProviderSwitchesJob()).toEqual({ skipped: 'the Infrastructure add-on is not installed' })
      useAddon()
      licences = []
      expect(await runProviderSwitchesJob()).toEqual({ skipped: 'the Infrastructure add-on is not licensed' })
      licences = [infraLicence()]
      invalidateLicenceCache()
      expect(await runProviderSwitchesJob()).toEqual({ started: true })
    } finally {
      if (env === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = env
    }
  })

  it("core's own settings actions: non-free areas and email APIs are refused before touching the database", async () => {
    const touched: string[] = []
    const deps: InfrastructureSettingsDeps = {
      canView: async (u) => u?.email === ADMIN.email,
      withDb: async (fn) => {
        touched.push('db')
        const config = resolveInstanceConfig(new Map<string, unknown>([['providers.storage', 's3'], ['providers.email', 'ses']]))
        void config
        return fn({ query: async (text: string) => { touched.push(text); return { rows: [] } } } as never, 'postgres://fake')
      },
      rateLimit: async () => true,
      gate: async () => ({ enabled: true, reason: null }),
      invalidate: () => {},
    }
    const ses = await changeEmailProviderAs(ADMIN, { to: 'ses', values: {} }, deps)
    expect(ses).toMatchObject({ ok: false, code: 'addon_required' })
    expect(touched).toEqual([])
    const storage = await saveProviderSettingsAs(ADMIN, { area: 'storage', values: { bucket: 'x' } }, deps)
    expect(storage).toMatchObject({ ok: false, code: 'addon_required' })
    expect(storage.ok === false && storage.error).toMatch(/files|storage/i)
    expect(await saveProviderSettingsAs(OWNER, { area: 'email', values: {} }, deps)).toMatchObject({ ok: false, error: expect.stringMatching(/instance administrators/) })
  })
})

describe('a separated install keeps running without the add-on', () => {
  it('resolves and keeps every separated provider, licence or not', async () => {
    // These are stored settings: a provider env var (CI's DB suites set
    // STORAGE_PROVIDER, CACHE_PROVIDER, AUTH_PROVIDER…) would rightly win, so clear them.
    for (const name of Object.values(PROVIDER_ENV)) vi.stubEnv(name, '')
    const config = resolveInstanceConfig(new Map<string, unknown>([
      ['providers.auth', 'oidc'], ['providers.storage', 's3'], ['storage.endpoint', 'https://s3.example.com'], ['providers.email', 'ses'], ['providers.cache', 'redis'], ['cache.redis_url', 'redis://cache.example.com:6379'],
    ]))
    expect(config.providers.storage.id).toBe('s3')
    expect(config.providers.auth.id).toBe('oidc')
    expect(config.providers.email.id).toBe('ses')
    expect(config.providers.cache.id).toBe('redis')
    expect((await infrastructureAddon()).state).toBe('missing')
  })

  it('nothing on the runtime path consults the add-on (config, providers, middleware, workflow engine)', () => {
    const root = path.resolve(__dirname, '..')
    const files: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name)
        if (statSync(full).isDirectory()) walk(full)
        else if (/\.tsx?$/.test(name)) files.push(full)
      }
    }
    for (const dir of ['lib/config', 'lib/providers', 'lib/services']) walk(path.join(root, dir))
    files.push(path.join(root, 'proxy.ts'), path.join(root, 'instrumentation.ts'), path.join(root, 'lib/workflow-engine.ts'))
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      expect(text, path.relative(root, file)).not.toMatch(/@\/lib\/infrastructure\/(provider|dispatch|licence-gate)|@usertasks-ext\//)
    }
  })
})

// ── Installer ───────────────────────────────────────────────────────────────

function profileOf(layer: Record<string, unknown>): Profile {
  const result = validateProfile(mergeProfileLayers(layer, { app: { url: 'https://tasks.example.com' } }))
  if (!result.ok) throw new Error(JSON.stringify(result.errors))
  return result.profile
}

const SUPABASE = { supabase: { url: 'https://abc.supabase.co', anonKey: 'anon', serviceRoleKey: 'service' } }
const bundled = () => profileOf({ ...presetProfile('server'), email: { provider: 'smtp', options: { smtp_host: 'mail.example.com', from: 'UserTasks <t@example.com>' } } })
const own = () => profileOf({ ...presetProfile('existing'), database: { provider: 'postgres', hosting: 'own', url: 'postgresql://u:p@db.example.com:5432/usertasks?sslmode=require' }, storage: { provider: 's3', options: { endpoint: 'https://s3.example.com', region: 'us-east-1', access_key_id: 'k', secret_access_key: 's', bucket: 'b' } }, email: { provider: 'smtp', options: { smtp_host: 'mail.example.com', from: 'UserTasks <t@example.com>' } } })

describe('installer: standard stacks are free, separation needs a licence', () => {
  it('classifies the bundled stack, a Supabase project and the Windows preset as standard', () => {
    expect(classifyProfile(bundled())).toEqual({ stack: 'bundled', separated: [] })
    expect(classifyProfile(profileOf({ ...presetProfile('supabase'), ...SUPABASE, email: { provider: 'resend', options: { resend_api_key: 're_x' } } })).stack).toBe('supabase')
    const minio = profileOf({ ...presetProfile('server'), storage: { provider: 's3', options: { endpoint: 'http://minio:9000', region: 'us-east-1', access_key_id: 'u', secret_access_key: 's', force_path_style: 'true' } }, cache: { provider: 'redis', options: { redis_url: 'redis://valkey:6379' } } })
    expect(classifyProfile(minio).stack).toBe('bundled')
  })

  it('lists what moves off the stack', () => {
    const c = classifyProfile(own())
    expect(c.stack).toBeNull()
    expect(c.separated.map((s) => s.area).sort()).toEqual(['database', 'storage'])
    const sso = profileOf({ ...presetProfile('server'), auth: { provider: 'oidc', sso: [{ id: 'entra', type: 'oidc', preset: 'entra', tenantId: 't', clientId: 'c', clientSecret: 's' }] } })
    expect(classifyProfile(sso).separated.map((s) => s.area)).toEqual(['auth'])
    const ses = profileOf({ ...presetProfile('server'), email: { provider: 'ses', options: { from: 'a@b.co', ses_region: 'us-east-1' } } })
    expect(classifyProfile(ses).separated.map((s) => s.area)).toEqual(['email'])
  })

  it('a re-run with the services an install already uses adds no separation', () => {
    const profile = own()
    const env = { DB_PROVIDER: 'postgres', DATABASE_URL: 'postgresql://u:other@db.example.com:5432/usertasks?sslmode=require', STORAGE_PROVIDER: 's3', S3_ENDPOINT: 'https://s3.example.com' }
    expect(newSeparation(classifyProfile(profile), (area) => envFingerprint(area, env))).toEqual([])
    const moved = { ...env, DATABASE_URL: 'postgresql://u:p@old-db.example.com:5432/usertasks' }
    expect(newSeparation(classifyProfile(profile), (area) => envFingerprint(area, moved)).map((s) => s.area)).toEqual(['database'])
  })

  it('separationGate: refused without a licence, accepted with one, refused when expired, for another extension or another address', () => {
    const values = {} as never
    const none = separationGate(own(), () => null, values, { env: {} }, VALID, [KEY.entry])
    expect(none.ok).toBe(false)
    expect(none.error).toMatch(/Infrastructure add-on.*--licence/)

    const withLicence = (text: string, now = VALID) => separationGate(own(), () => null, values, { env: { USERTASKS_LICENCE: text } }, now, [KEY.entry])
    const good = withLicence(JSON.stringify(infraLicence()))
    expect(good).toMatchObject({ ok: true })
    expect(good.note).toMatch(/lic_infra_1/)
    expect(withLicence(JSON.stringify(infraLicence()), IN_GRACE).ok).toBe(true)
    expect(withLicence(JSON.stringify(infraLicence()), PAST_CUTOFF)).toMatchObject({ ok: false, error: expect.stringMatching(/expired/) })
    expect(withLicence(JSON.stringify(infraLicence({ extensions: [{ id: 'sharepoint' }] }))).ok).toBe(false)
    expect(withLicence(JSON.stringify(infraLicence({ binding: { hostnames: ['other.example.com'] } })))).toMatchObject({ ok: false, error: expect.stringMatching(/another installation/) })
    expect(withLicence(JSON.stringify(infraLicence({ binding: { hostnames: ['tasks.example.com'] } }))).ok).toBe(true)
    expect(withLicence(JSON.stringify(infraLicence({ binding: { instance_ids: ['inst_zzzzzzzzzzzzzzzzzzzzzzzz'] } })))).toMatchObject({ ok: false, error: expect.stringMatching(/instance id/) })
    const forged = { ...infraLicence(), expires_at: '2099-01-01T00:00:00.000Z' }
    expect(withLicence(JSON.stringify(forged))).toMatchObject({ ok: false, error: expect.stringMatching(/not accepted/) })
    // The bundled stack needs nothing.
    expect(separationGate(bundled(), () => null, values, { env: {} }, VALID, [KEY.entry]).ok).toBe(true)
  })

  it('the pinned keyring does not trust a throwaway key (no test key ever works in a real install)', () => {
    const check = checkInfrastructureLicenceText(JSON.stringify(infraLicence()), { appUrl: 'https://tasks.example.com', now: VALID })
    expect(check.ok).toBe(false)
    expect(check.reason).toMatch(/unknown key/)
    expect(infrastructureDecision([{ source: 'setting', raw: infraLicence() }], IDENTITY, VALID, [KEY.entry]).allowed).toBe(true)
  })

  it('usertasks-admin install profile validate / write refuse a separated profile without a licence (exit 1)', async () => {
    for (const verb of ['validate', 'write']) {
      const lines: string[] = []
      const errors: string[] = []
      const code = await runInstallCommand([
        'profile', verb, '--preset', 'existing', '--set', 'app.url=https://tasks.example.com',
        '--set', 'database.url=postgresql://u:p@db.example.com:5432/usertasks', '--set', 'storage.endpoint=https://s3.example.com',
        '--set', 'storage.access_key_id=k', '--set', 'storage.secret_access_key=s', '--set', 'email.smtp_host=mail.example.com', '--set', 'email.from=t@example.com',
      ], { out: (l) => lines.push(l), err: (l) => errors.push(l), env: {} as NodeJS.ProcessEnv })
      expect(code, verb).toBe(1)
      expect(errors.join('\n')).toMatch(/moves services off the standard stack: database \(your own PostgreSQL server\), files .*Infrastructure add-on/)
      expect(lines.join('\n')).not.toMatch(/DATABASE_URL=/)
    }
    const ok = await runInstallCommand(['profile', 'validate', '--preset', 'server', '--set', 'app.url=http://localhost:3000'], { out: () => {}, err: () => {}, env: {} as NodeJS.ProcessEnv })
    expect(ok).toBe(0)
  })

  it('the refusal message names the add-on and keeps the instance running', () => {
    expect(addonRequiredMessage()).toMatch(/keeps running on its current providers/)
  })
})
