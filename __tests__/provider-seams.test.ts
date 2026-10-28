/**
 * Provider seams (lib/providers):
 *  - every service-role / cookie / browser database client is created behind
 *    lib/providers/db (and the @supabase/ssr wrappers in lib/supabase): no new
 *    `createClient(url, SERVICE_ROLE_KEY)` elsewhere in app code;
 *  - Supabase URL/keys are read through lib/config, not process.env, so the
 *    runtime config (not build-time NEXT_PUBLIC_* inlining) decides them;
 *  - the browser client makes no queries, writes, RPC or storage calls (phases
 *    2 and 4): only the realtime hooks and auth flows listed, with a reason,
 *    in lib/providers/db/browser-allowlist.json import it;
 *  - getServiceDb keeps the old client semantics (anon fallback only on request);
 *  - ServiceContext carries `db` with the `supabase` alias;
 *  - the provider registry resolves today's defaults and refuses reserved ids.
 */
import { readFileSync, readdirSync, statSync } from 'fs'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createClientMock = vi.hoisted(() => vi.fn((url: string, key: string) => ({ url, key })))
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }))

const ROOT = path.resolve(__dirname, '..')
const SCAN_DIRS = ['app', 'lib', 'components', 'hooks', 'stores']

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

const files = SCAN_DIRS.flatMap((d) => sourceFiles(path.join(ROOT, d)))
  .concat([path.join(ROOT, 'proxy.ts'), path.join(ROOT, 'next.config.ts')])
  .map((f) => ({ rel: path.relative(ROOT, f), src: readFileSync(f, 'utf8') }))
  // Docs pages mention the variable names in prose.
  .filter((f) => !f.rel.startsWith(path.join('lib', 'docs', 'content')))

describe('database client seam', () => {
  it('only lib/providers/db creates supabase-js clients in app code', () => {
    const offenders = files
      .filter((f) => /import\s*\{[^}]*\bcreateClient\b[^}]*\}\s*from\s*['"]@supabase\/supabase-js['"]/.test(f.src)
        || /import\(['"]@supabase\/supabase-js['"]\)/.test(f.src))
      .map((f) => f.rel)
    expect(offenders).toEqual([path.join('lib', 'providers', 'db', 'index.ts')])
  })

  it('the service-role key is read only through lib/config', () => {
    const offenders = files.filter((f) => /process\.env(\.|\[['"])SUPABASE_SERVICE_ROLE_KEY/.test(f.src)).map((f) => f.rel)
    expect(offenders).toEqual([])
  })

  it('Supabase URL/anon key/SSO flags are not read from build-time NEXT_PUBLIC_* outside lib/config/public', () => {
    const offenders = files
      .filter((f) => /process\.env\.NEXT_PUBLIC_(SUPABASE_URL|SUPABASE_ANON_KEY|SSO_MICROSOFT|APP_URL)/.test(f.src))
      .map((f) => f.rel)
    expect(offenders).toEqual([path.join('lib', 'config', 'public.ts')])
  })
})

describe('browser database client (phase 4: realtime and auth only)', () => {
  const allowlist = JSON.parse(readFileSync(path.join(ROOT, 'lib', 'providers', 'db', 'browser-allowlist.json'), 'utf8')) as {
    importers: Array<{ path: string; reason: string }>
  }
  const allowed = allowlist.importers.map((e) => e.path)
  const DEFINITIONS = [path.join('lib', 'supabase', 'client.ts'), path.join('lib', 'providers', 'db', 'browser.ts')]
  // Static and dynamic imports of the browser client.
  const IMPORT_RE = /(?:from\s*|import\(\s*)['"]@\/lib\/(?:supabase\/client|providers\/db\/browser)['"]/
  // Writes, RPCs and storage calls on a query builder / client (phase 2). delete() with
  // no argument (or an options object) is PostgREST's, unlike Set/Map.delete(key).
  const WRITE_RE = /\.(?:insert|upsert|update)\(|\.delete\(\s*(?:\{[^)]*\})?\s*\)|\.rpc\(|\.storage\b/
  // Reads (phase 4): a table query (`.from('table')`, not Array.from(x)) or a select.
  const READ_RE = /\.from\(\s*['"`]|\.select\(/
  const toPosix = (p: string) => p.split(path.sep).join('/')
  const importers = files
    .filter((f) => !DEFINITIONS.includes(f.rel) && !f.rel.startsWith('__tests__') && IMPORT_RE.test(f.src))
    .map((f) => ({ ...f, rel: toPosix(f.rel) }))

  it('no file that uses the browser client queries, writes, calls an RPC or touches storage with it', () => {
    const offenders = importers
      .flatMap((f) => f.src.split('\n').map((line, i) => ({ line, at: `${f.rel}:${i + 1}` })))
      .filter(({ line }) => WRITE_RE.test(line) || READ_RE.test(line))
      .map(({ at, line }) => `${at}  ${line.trim()}`)
    expect(offenders).toEqual([])
  })

  it('only allowlisted files import the browser client, each for realtime or auth (data goes through lib/server-read)', () => {
    const unlisted = importers.map((f) => f.rel).filter((rel) => !allowed.includes(rel))
    expect(unlisted).toEqual([])
    for (const entry of allowlist.importers) expect(entry.reason, entry.path).toMatch(/^(realtime|auth): \S/)
  })

  it('no client code calls an auth service (phase 9: sign-in, sign-out, resets and SSO are server actions)', () => {
    const AUTH_CALL = /\.auth\.(?:getUser|getSession|signIn\w*|signUp|signOut|onAuthStateChange|updateUser|resetPasswordForEmail|exchangeCodeForSession|setSession|refreshSession)\(/
    const clientFiles = files.filter((f) => /^\s*['"]use client['"]/m.test(f.src) || importers.some((i) => i.rel === toPosix(f.rel)))
    const offenders = clientFiles
      .flatMap((f) => f.src.split('\n').map((line, i) => ({ line, at: `${toPosix(f.rel)}:${i + 1}` })))
      .filter(({ line }) => AUTH_CALL.test(line))
      .map(({ at, line }) => `${at}  ${line.trim()}`)
    expect(offenders).toEqual([])
  })

  it('the allowlist has no stale entries', () => {
    const current = new Set(importers.map((f) => f.rel))
    expect(allowed.filter((rel) => !current.has(rel))).toEqual([])
  })

  it('the patterns catch the call shapes the browser used', () => {
    for (const sample of [
      "await supabase.from('tasks').update({ status })",
      '.insert({ tenant_id })', '.upsert(rows, { onConflict: "id" })', '.delete()', ".delete().eq('id', id)",
      "supabase.rpc('switch_tenant', {", "supabase.storage.from('logos')",
    ]) expect(WRITE_RE.test(sample), sample).toBe(true)
    for (const sample of ['next.delete(id)', 'selected.delete(row.id)', 'setRows(prev => prev)', 'queryClient.invalidateQueries()']) {
      expect(WRITE_RE.test(sample), sample).toBe(false)
    }
    for (const sample of ["supabase.from('tasks')", '.from("users")', ".select('id, name')", '(supabase as any).from(`agent_runs`)']) {
      expect(READ_RE.test(sample), sample).toBe(true)
    }
    for (const sample of ['Array.from(rows)', 'Array.from(new Set(ids))', 'setSelected(id)']) {
      expect(READ_RE.test(sample), sample).toBe(false)
    }
  })
})

describe('getServiceDb', () => {
  // DB_PROVIDER / DATABASE_URL too: these cases pin the provider they test,
  // so the suite also passes when it runs with DB_PROVIDER=postgres.
  const keys = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'DB_PROVIDER', 'DATABASE_URL']
  const saved: Record<string, string | undefined> = {}
  beforeEach(() => { for (const k of keys) { saved[k] = process.env[k]; delete process.env[k] } createClientMock.mockClear() })
  afterEach(() => { for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } })

  it('builds the same (url, key) client the call sites built', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
    const { getServiceDb } = await import('@/lib/providers/db')
    getServiceDb()
    expect(createClientMock).toHaveBeenLastCalledWith('http://127.0.0.1:54321', 'service')
    getServiceDb({ anonFallback: true })
    expect(createClientMock).toHaveBeenLastCalledWith('http://127.0.0.1:54321', 'service')
  })

  it('falls back to the anon key only when asked', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
    const { getServiceDb, hasServiceDb } = await import('@/lib/providers/db')
    expect(hasServiceDb()).toBe(false)
    getServiceDb({ anonFallback: true })
    expect(createClientMock).toHaveBeenLastCalledWith('http://127.0.0.1:54321', 'anon')
    getServiceDb()
    expect(createClientMock).toHaveBeenLastCalledWith('http://127.0.0.1:54321', undefined)
  })

  it('createServiceClient (lib/cron-auth) still refuses to run without the service key', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
    const { createServiceClient } = await import('@/lib/cron-auth')
    expect(() => createServiceClient()).toThrow('createServiceClient: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
    expect(createClientMock).not.toHaveBeenCalled()
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
    expect(createServiceClient()).toEqual({ url: 'http://127.0.0.1:54321', key: 'service' })
  })

  it('DB_PROVIDER=postgres keeps supabase-js clients but serves REST in-process', async () => {
    process.env.DB_PROVIDER = 'postgres'
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
    const { getServiceDb, hasServiceDb, activeDbProvider } = await import('@/lib/providers/db')
    expect(activeDbProvider()).toBe('postgres')
    expect(hasServiceDb()).toBe(false)
    process.env.DATABASE_URL = 'postgresql://u:p@127.0.0.1:1/db'
    expect(hasServiceDb()).toBe(true)
    getServiceDb()
    const [url, key, options] = createClientMock.mock.lastCall as unknown as [string, string, { global: { fetch: unknown } }]
    expect([url, key]).toEqual(['http://127.0.0.1:54321', 'service'])
    expect(typeof options.global.fetch).toBe('function')
    // No Supabase project at all: placeholders, REST still in-process.
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    getServiceDb()
    expect((createClientMock.mock.lastCall as unknown as string[]).slice(0, 2)).toEqual(['http://localhost', 'pg-query'])
  })
})

describe('ServiceContext.db', () => {
  it('context factories set db and keep the supabase alias; getDb falls back to supabase', async () => {
    const { fromMcpContext, getDb } = await import('@/lib/services/context')
    const client = { tag: 'mcp' }
    const ctx = fromMcpContext({ tenantId: 't', supabase: client } as never)
    expect(ctx.db).toBe(client)
    expect(ctx.supabase).toBe(client)
    expect(getDb(ctx)).toBe(client)
    const legacy = { supabase: client } as never
    expect(getDb(legacy)).toBe(client)
  })
})

describe('provider registry', () => {
  it('resolves today\'s defaults', async () => {
    const [{ resolveDbProvider }, { resolveAuthProvider }, { resolveStorageProvider }, { resolveRealtimeProvider }, { resolveSchedulerProvider }, { resolveEmailProvider }, { resolveSecretStore }] = await Promise.all([
      import('@/lib/providers/db/provider'),
      import('@/lib/providers/auth'),
      import('@/lib/providers/storage'),
      import('@/lib/providers/realtime'),
      import('@/lib/providers/scheduler'),
      import('@/lib/providers/email'),
      import('@/lib/providers/secrets'),
    ])
    expect([
      resolveDbProvider().id, resolveAuthProvider().id, resolveStorageProvider().id, resolveRealtimeProvider().id,
      resolveSchedulerProvider().id, resolveEmailProvider().id, resolveSecretStore().id,
    ]).toEqual(['supabase', 'supabase', 'supabase', 'supabase', 'pg_cron', 'resend', 'env'])
    expect(typeof resolveSchedulerProvider().onPrem).toBe('boolean')
  })

  it('refuses ids reserved for later phases instead of silently using the default', async () => {
    const { resolveEmailProvider } = await import('@/lib/providers/email')
    const { resolveDbProvider } = await import('@/lib/providers/db/provider')
    const { ProviderNotAvailableError } = await import('@/lib/providers/registry')
    const { resolveAuthProvider } = await import('@/lib/providers/auth')
    expect(() => resolveEmailProvider('nope' as never)).toThrow(ProviderNotAvailableError)
    // Phase 8: SMTP exists (on-prem capable).
    expect(resolveEmailProvider('smtp')).toMatchObject({ id: 'smtp', onPrem: true })
    // Phase 9: built-in, OIDC and SAML auth exist (on-prem capable).
    expect(resolveAuthProvider('builtin')).toMatchObject({ id: 'builtin', onPrem: true })
    expect(resolveAuthProvider('saml')).toMatchObject({ id: 'saml', onPrem: true })
    // Phase 3: the postgres db provider exists (on-prem capable).
    expect(resolveDbProvider('postgres')).toMatchObject({ id: 'postgres', onPrem: true })
  })

  it('the env secret store reads the environment and treats empty as unset', async () => {
    const { envSecretStore } = await import('@/lib/providers/secrets')
    process.env.__PROVIDER_SEAM_TEST = 'x'
    expect(await envSecretStore.get('__PROVIDER_SEAM_TEST')).toBe('x')
    process.env.__PROVIDER_SEAM_TEST = ''
    expect(await envSecretStore.get('__PROVIDER_SEAM_TEST')).toBeUndefined()
    delete process.env.__PROVIDER_SEAM_TEST
  })
})
