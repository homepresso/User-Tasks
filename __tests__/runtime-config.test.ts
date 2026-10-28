/**
 * Runtime config (lib/config) and the provider seams (lib/providers):
 *  - bootstrap env parsing and precedence (unprefixed names win, NEXT_PUBLIC_*
 *    still honoured, empty = unset, processor secret `??` semantics);
 *  - getConfig precedence env > instance_settings > defaults;
 *  - instance_settings service: service-role client only, key/provider
 *    validation, secrets encrypted (round trip) and refused without a key,
 *    masked listing, TTL cache, unavailable table = defaults;
 *  - public config: exactly the browser-safe keys, no secrets, script escaping,
 *    GET /api/config/public;
 *  - CSP built per request matches today's header for the default config.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const createClientMock = vi.hoisted(() => vi.fn())
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }))
// The session (cookie) client must never be used by the instance settings service.
const sessionClientMock = vi.hoisted(() => vi.fn(async () => { throw new Error('session client used') }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: sessionClientMock,
  createClientWithUser: sessionClientMock,
  getCachedUser: sessionClientMock,
}))

const ENV_KEYS = [
  'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY', 'APP_URL', 'NEXT_PUBLIC_APP_URL', 'SSO_MICROSOFT', 'NEXT_PUBLIC_SSO_MICROSOFT',
  'DEPLOYMENT_MODE', 'WORKFLOW_PROCESSOR_SECRET', 'CRON_SECRET', 'ENCRYPTION_KEY', 'DATABASE_URL',
  'DB_PROVIDER', 'AUTH_PROVIDER', 'STORAGE_PROVIDER', 'REALTIME_PROVIDER', 'SCHEDULER_PROVIDER',
  'EMAIL_PROVIDER', 'SECRETS_PROVIDER', 'CACHE_PROVIDER', 'KMS_PROVIDER', 'EMAIL_FROM', 'RESEND_API_KEY',
  // Storage provider options (lib/providers/storage/options.ts) when the suite runs with STORAGE_PROVIDER=local/s3/….
  'STORAGE_LOCAL_ROOT', 'STORAGE_BUCKET', 'STORAGE_BUCKET_PREFIX', 'STORAGE_BUCKET_MAP', 'STORAGE_PUBLIC_BASE_URL',
  'S3_ENDPOINT', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_FORCE_PATH_STYLE',
]
const saved: Record<string, string | undefined> = {}
const TEST_KEY = Buffer.alloc(32, 7).toString('base64')

beforeEach(() => {
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k] }
  createClientMock.mockReset()
  sessionClientMock.mockClear()
})
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  vi.resetModules()
})

/** In-memory instance_settings table behind a supabase-js-shaped client. */
function fakeSettingsDb(initial: Array<{ key: string; value: unknown; secret: boolean }> = [], opts: { error?: string } = {}) {
  const rows = new Map(initial.map((r) => [r.key, { ...r, updated_at: null as string | null, updated_by: null as string | null }]))
  const calls = { select: 0, upsert: [] as unknown[], delete: [] as string[], tables: new Set<string>() }
  const client = {
    from(table: string) {
      calls.tables.add(table)
      const result = () => (opts.error ? { data: null, error: { message: opts.error } } : { data: [...rows.values()], error: null })
      return {
        select() {
          calls.select++
          const res = result()
          return Object.assign(Promise.resolve(res), { order: async () => res })
        },
        async upsert(row: { key: string; value: unknown; secret: boolean; updated_at: string; updated_by: string | null }) {
          calls.upsert.push(row)
          rows.set(row.key, row)
          return { error: null }
        },
        delete() {
          return { eq: async (_c: string, key: string) => { calls.delete.push(key); rows.delete(key); return { error: null } } }
        },
      }
    },
  }
  return { client, rows, calls }
}

function useServiceDb(client: unknown) {
  process.env.SUPABASE_URL = 'http://127.0.0.1:54321'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
  createClientMock.mockImplementation(() => client)
}

describe('bootstrap config', () => {
  it('prefers the unprefixed runtime names and still honours NEXT_PUBLIC_*', async () => {
    const { getBootstrapConfig } = await import('@/lib/config/bootstrap')
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://build.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-build'
    process.env.NEXT_PUBLIC_APP_URL = 'https://build.example'
    process.env.NEXT_PUBLIC_SSO_MICROSOFT = '1'
    let cfg = getBootstrapConfig()
    expect(cfg.supabase).toEqual({ url: 'https://build.supabase.co', anonKey: 'anon-build', serviceRoleKey: undefined })
    expect(cfg.appUrl).toBe('https://build.example')
    expect(cfg.ssoMicrosoft).toBe(true)

    process.env.SUPABASE_URL = 'https://runtime.supabase.co'
    process.env.SUPABASE_ANON_KEY = 'anon-runtime'
    process.env.APP_URL = 'https://runtime.example'
    process.env.SSO_MICROSOFT = '0'
    cfg = getBootstrapConfig()
    expect(cfg.supabase.url).toBe('https://runtime.supabase.co')
    expect(cfg.supabase.anonKey).toBe('anon-runtime')
    expect(cfg.appUrl).toBe('https://runtime.example')
    expect(cfg.ssoMicrosoft).toBe(false)
  })

  it('reads the environment on every call (no stale cache) and treats empty as unset', async () => {
    const { supabaseUrl, configuredAppUrl, appUrlOrLocalhost } = await import('@/lib/config/bootstrap')
    expect(supabaseUrl()).toBeUndefined()
    process.env.SUPABASE_URL = ''
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
    expect(supabaseUrl()).toBe('https://x.supabase.co')
    expect(configuredAppUrl()).toBeUndefined()
    expect(appUrlOrLocalhost()).toBe('http://localhost:3000')
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.test'
    expect(appUrlOrLocalhost()).toBe('https://app.test')
  })

  it('keeps the processor secret semantics (WORKFLOW_PROCESSOR_SECRET ?? CRON_SECRET)', async () => {
    const { processorSecret } = await import('@/lib/config/bootstrap')
    expect(processorSecret()).toBeUndefined()
    process.env.CRON_SECRET = 'cron'
    expect(processorSecret()).toBe('cron')
    process.env.WORKFLOW_PROCESSOR_SECRET = 'proc'
    expect(processorSecret()).toBe('proc')
    // An empty WORKFLOW_PROCESSOR_SECRET is a configured (empty) secret, as before: fail closed.
    process.env.WORKFLOW_PROCESSOR_SECRET = ''
    expect(processorSecret()).toBe('')
    const { isAuthorizedServiceCall } = await import('@/lib/cron-auth')
    expect(isAuthorizedServiceCall(new Request('http://x', { headers: { 'x-processor-secret': '' } }))).toBe(false)
  })

  it('normalises the deployment mode like before', async () => {
    const { getDeploymentMode } = await import('@/lib/deployment')
    expect(getDeploymentMode()).toBe('self_hosted')
    process.env.DEPLOYMENT_MODE = ' Cloud '
    expect(getDeploymentMode()).toBe('cloud')
    process.env.DEPLOYMENT_MODE = 'something'
    expect(getDeploymentMode()).toBe('self_hosted')
  })

  it('rejects an unknown provider id from the environment', async () => {
    const { getEnvProviderOverrides } = await import('@/lib/config/bootstrap')
    expect(getEnvProviderOverrides()).toEqual({})
    process.env.EMAIL_PROVIDER = ' SMTP '
    process.env.DB_PROVIDER = 'supabase'
    expect(getEnvProviderOverrides()).toEqual({ email: 'smtp', db: 'supabase' })
    process.env.STORAGE_PROVIDER = 'ftp'
    expect(() => getEnvProviderOverrides()).toThrow(/STORAGE_PROVIDER: unknown provider "ftp"/)
  })
})

describe('getConfig / getProviderConfig', () => {
  it('defaults to today\'s stack with nothing configured (no service key: no DB read)', async () => {
    const { getConfig } = await import('@/lib/config')
    const cfg = await getConfig()
    expect(Object.fromEntries(Object.entries(cfg.providers).map(([a, p]) => [a, [p.id, p.source]]))).toEqual({
      db: ['supabase', 'default'],
      auth: ['supabase', 'default'],
      storage: ['supabase', 'default'],
      realtime: ['supabase', 'default'],
      scheduler: ['pg_cron', 'default'],
      email: ['resend', 'default'],
      secrets: ['env', 'default'],
      cache: ['memory', 'default'],
      kms: ['env', 'default'],
    })
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('applies env > instance_settings > defaults, and env overrides provider options', async () => {
    const fake = fakeSettingsDb([
      { key: 'providers.email', value: 'console', secret: false },
      { key: 'providers.storage', value: 's3', secret: false },
      { key: 'providers.realtime', value: 'carrier-pigeon', secret: false }, // invalid → ignored
      { key: 'email.from', value: 'Ops <ops@db.test>', secret: false },
      { key: 'storage.bucket', value: 'files', secret: false },
    ])
    useServiceDb(fake.client)
    process.env.STORAGE_PROVIDER = 'local'
    process.env.EMAIL_FROM = 'Env <env@test>'
    const { getConfig, getProviderConfig } = await import('@/lib/config')
    const cfg = await getConfig()
    expect(cfg.providers.email).toEqual({ area: 'email', id: 'console', source: 'settings', options: { from: 'Env <env@test>' } })
    expect(cfg.providers.storage).toEqual({ area: 'storage', id: 'local', source: 'env', options: { bucket: 'files' } })
    expect(cfg.providers.realtime).toMatchObject({ id: 'supabase', source: 'default' })
    expect((await getProviderConfig('db')).id).toBe('supabase')
    expect([...fake.calls.tables]).toEqual(['instance_settings'])
  })

  it('falls back to env/defaults when instance_settings is unavailable (migration not applied)', async () => {
    const fake = fakeSettingsDb([], { error: 'relation "public.instance_settings" does not exist' })
    useServiceDb(fake.client)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    process.env.EMAIL_PROVIDER = 'resend'
    const { getConfig } = await import('@/lib/config')
    const cfg = await getConfig()
    expect(cfg.providers.email).toMatchObject({ id: 'resend', source: 'env' })
    expect(cfg.providers.db).toMatchObject({ id: 'supabase', source: 'default' })
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})

describe('instance_settings service', () => {
  it('uses only the service-role client, never the session client', async () => {
    const fake = fakeSettingsDb()
    useServiceDb(fake.client)
    const svc = await import('@/lib/config/instance-settings')
    await svc.setInstanceSetting('providers.email', 'resend', { updatedBy: '00000000-0000-4000-8000-000000000001' })
    await svc.listInstanceSettings()
    await svc.loadInstanceSettings()
    await svc.deleteInstanceSetting('providers.email')
    expect(createClientMock).toHaveBeenCalledWith('http://127.0.0.1:54321', 'service-role-key')
    expect(sessionClientMock).not.toHaveBeenCalled()
  })

  it('validates keys and provider ids', async () => {
    useServiceDb(fakeSettingsDb().client)
    const { setInstanceSetting } = await import('@/lib/config/instance-settings')
    await expect(setInstanceSetting('supabase.url', 'https://x')).rejects.toThrow(/Unknown instance setting key/)
    await expect(setInstanceSetting('providers.nope', 'x')).rejects.toThrow(/Unknown instance setting key/)
    await expect(setInstanceSetting('providers.db', 'mysql')).rejects.toThrow(/unknown provider/)
    await expect(setInstanceSetting('email.from', undefined)).rejects.toThrow(/value is required/)
    await expect(setInstanceSetting('providers.db', 'postgres')).resolves.toBeUndefined()
  })

  it('encrypts secrets at rest and decrypts them on read (round trip)', async () => {
    process.env.ENCRYPTION_KEY = TEST_KEY
    const fake = fakeSettingsDb()
    useServiceDb(fake.client)
    const svc = await import('@/lib/config/instance-settings')
    const secret = { apiKey: 're_live_123', region: 'eu' }
    await svc.setInstanceSetting('email.resend_api_key', secret, { secret: true })
    const stored = fake.rows.get('email.resend_api_key')!
    expect(stored.secret).toBe(true)
    expect(typeof stored.value).toBe('string')
    expect(stored.value as string).toMatch(/^enc:v1:/)
    expect(JSON.stringify(stored)).not.toContain('re_live_123')
    expect(await svc.getInstanceSetting('email.resend_api_key')).toEqual(secret)

    const listed = await svc.listInstanceSettings()
    expect(listed).toEqual([expect.objectContaining({ key: 'email.resend_api_key', secret: true, value: '********' })])
    expect(JSON.stringify(listed)).not.toContain('enc:v1:')
  })

  it('refuses to store a secret without ENCRYPTION_KEY (never plaintext)', async () => {
    const fake = fakeSettingsDb()
    useServiceDb(fake.client)
    const { setInstanceSetting } = await import('@/lib/config/instance-settings')
    await expect(setInstanceSetting('email.resend_api_key', 're_123', { secret: true })).rejects.toThrow(/ENCRYPTION_KEY must be set/)
    expect(fake.calls.upsert).toEqual([])
  })

  it('ignores a secret row that is not encrypted', async () => {
    useServiceDb(fakeSettingsDb([{ key: 'email.resend_api_key', value: 'plain', secret: true }]).client)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { getInstanceSetting } = await import('@/lib/config/instance-settings')
    expect(await getInstanceSetting('email.resend_api_key')).toBeUndefined()
    warn.mockRestore()
  })

  it('caches reads for the TTL and invalidates on write', async () => {
    vi.useFakeTimers()
    try {
      const fake = fakeSettingsDb([{ key: 'email.from', value: 'a@test', secret: false }])
      useServiceDb(fake.client)
      const svc = await import('@/lib/config/instance-settings')
      await svc.loadInstanceSettings()
      await svc.loadInstanceSettings()
      expect(fake.calls.select).toBe(1)
      await svc.setInstanceSetting('email.from', 'b@test')
      expect(await svc.getInstanceSetting('email.from')).toBe('b@test')
      expect(fake.calls.select).toBe(2)
      vi.advanceTimersByTime(svc.INSTANCE_SETTINGS_TTL_MS + 1)
      await svc.loadInstanceSettings()
      expect(fake.calls.select).toBe(3)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('public config', () => {
  function setAllSecrets() {
    process.env.SUPABASE_URL = 'https://abcd.supabase.co'
    process.env.SUPABASE_ANON_KEY = 'anon-public-key'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-SECRET'
    process.env.ENCRYPTION_KEY = TEST_KEY
    process.env.CRON_SECRET = 'cron-SECRET'
    process.env.WORKFLOW_PROCESSOR_SECRET = 'processor-SECRET'
    process.env.DATABASE_URL = 'postgres://user:db-SECRET@host/db'
    process.env.RESEND_API_KEY = 're_SECRET'
    process.env.APP_URL = 'https://app.example'
    process.env.SSO_MICROSOFT = '1'
  }

  it('contains exactly the browser-safe keys and no secrets', async () => {
    setAllSecrets()
    const { buildPublicConfig, publicConfigScript } = await import('@/lib/config/public')
    const cfg = buildPublicConfig()
    expect(cfg).toEqual({
      supabaseUrl: 'https://abcd.supabase.co',
      supabaseAnonKey: 'anon-public-key',
      appUrl: 'https://app.example',
      ssoMicrosoft: true,
    })
    const serialized = publicConfigScript(cfg)
    for (const secret of ['SECRET', TEST_KEY]) expect(serialized).not.toContain(secret)
  })

  it('escapes the inline script so values cannot break out of <script>', async () => {
    const { publicConfigScript } = await import('@/lib/config/public')
    const script = publicConfigScript({ supabaseUrl: '</script><script>alert(1)</script>', supabaseAnonKey: '\u2028', appUrl: '', ssoMicrosoft: false })
    expect(script).not.toMatch(/<|>|\u2028/)
    expect(script.startsWith('window.__USERTASKS_CONFIG__={')).toBe(true)
    const window: Record<string, unknown> = {}
    new Function('window', script)(window)
    expect((window.__USERTASKS_CONFIG__ as { supabaseUrl: string }).supabaseUrl).toBe('</script><script>alert(1)</script>')
  })

  it('prerendered pages refresh the inlined build values from the server in the background', async () => {
    const { publicConfigScript, isBuildPrerender } = await import('@/lib/config/public')
    const cfg = { supabaseUrl: 'https://build.supabase.co', supabaseAnonKey: 'k', appUrl: '', ssoMicrosoft: false }
    expect(publicConfigScript(cfg)).not.toContain('fetch(')
    const refreshing = publicConfigScript(cfg, { refresh: true })
    expect(refreshing).toContain("fetch('/api/config/public'")

    const window: Record<string, unknown> = {}
    const runtime = { supabaseUrl: 'https://runtime.supabase.co', supabaseAnonKey: 'k2', appUrl: '', ssoMicrosoft: true }
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => runtime }))
    new Function('window', 'fetch', refreshing)(window, fetchMock)
    expect((window.__USERTASKS_CONFIG__ as { supabaseUrl: string }).supabaseUrl).toBe('https://build.supabase.co')
    await new Promise((r) => setTimeout(r, 0))
    expect(window.__USERTASKS_CONFIG__).toEqual(runtime)

    const prev = process.env.NEXT_PHASE
    process.env.NEXT_PHASE = 'phase-production-build'
    expect(isBuildPrerender()).toBe(true)
    process.env.NEXT_PHASE = 'phase-production-server'
    expect(isBuildPrerender()).toBe(false)
    if (prev === undefined) delete process.env.NEXT_PHASE
    else process.env.NEXT_PHASE = prev
  })

  it('GET /api/config/public serves the same object (JSON and script forms) without secrets', async () => {
    setAllSecrets()
    const { GET } = await import('@/app/api/config/public/route')
    const json = await GET(new NextRequest('http://localhost/api/config/public'))
    expect(json.status).toBe(200)
    const body = await json.json()
    expect(Object.keys(body).sort()).toEqual(['appUrl', 'ssoMicrosoft', 'supabaseAnonKey', 'supabaseUrl'])
    expect(JSON.stringify(body)).not.toContain('SECRET')

    const js = await GET(new NextRequest('http://localhost/api/config/public?format=js'))
    expect(js.headers.get('content-type')).toContain('text/javascript')
    const text = await js.text()
    expect(text).toContain('"supabaseUrl":"https://abcd.supabase.co"')
    expect(text).not.toContain('SECRET')
  })

  it('the browser reads the injected runtime config, else the build-time values', async () => {
    const g = globalThis as { window?: { __USERTASKS_CONFIG__?: unknown } }
    g.window = {}
    try {
      const { getPublicConfig } = await import('@/lib/config/public')
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://build.supabase.co'
      expect(getPublicConfig().supabaseUrl).toBe('https://build.supabase.co')
      g.window.__USERTASKS_CONFIG__ = { supabaseUrl: 'https://runtime.supabase.co', supabaseAnonKey: 'k', appUrl: '', ssoMicrosoft: true }
      expect(getPublicConfig()).toMatchObject({ supabaseUrl: 'https://runtime.supabase.co', ssoMicrosoft: true })
      // A runtime without Supabase still decides the providers (no Supabase realtime client gets loaded).
      g.window.__USERTASKS_CONFIG__ = { supabaseUrl: '', supabaseAnonKey: '', appUrl: 'https://tasks.example', ssoMicrosoft: false, realtimeProvider: 'sse' }
      expect(getPublicConfig()).toMatchObject({ supabaseUrl: 'https://build.supabase.co', appUrl: 'https://tasks.example', realtimeProvider: 'sse' })
    } finally {
      delete g.window
    }
  })
})

describe('CSP per request', () => {
  // Today's header for a hosted project (next.config.ts before runtime config).
  const TODAY = "default-src 'self'; script-src 'self' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline' https:; img-src 'self' blob: data: https:; font-src 'self' data: https:; connect-src 'self' https://abcd.supabase.co wss://abcd.supabase.co; media-src 'self' blob: data:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"

  it('matches today\'s header for the default config (NEXT_PUBLIC_SUPABASE_URL only)', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abcd.supabase.co'
    const { contentSecurityPolicy, buildContentSecurityPolicy } = await import('@/lib/csp')
    expect(contentSecurityPolicy()).toBe(TODAY)
    expect(contentSecurityPolicy()).toBe(buildContentSecurityPolicy({ supabaseUrl: 'https://abcd.supabase.co', isDev: false }))
  })

  it('follows the runtime Supabase URL without a rebuild', async () => {
    const { contentSecurityPolicy } = await import('@/lib/csp')
    expect(contentSecurityPolicy()).toContain("connect-src 'self' https: wss:")
    process.env.SUPABASE_URL = 'https://other.supabase.co'
    expect(contentSecurityPolicy()).toContain("connect-src 'self' https://other.supabase.co wss://other.supabase.co")
  })

  it('proxy.ts sets the header on every proxied response', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abcd.supabase.co'
    const { proxy } = await import('@/proxy')
    const res = await proxy(new NextRequest('http://localhost/tasks'))
    expect(res.headers.get('content-security-policy')).toBe(TODAY)
  })
})
