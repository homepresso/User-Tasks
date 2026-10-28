import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setAuthDbForTests, type AuthDb } from '@/lib/providers/auth/builtin/db'
import { invalidateInstanceSettingsCache } from '@/lib/config/instance-settings'
import { resolveInstanceConfig } from '@/lib/config'
import {
  applyMode,
  applySwitchAs,
  backgroundRuntime,
  buildOptions,
  cancelSwitchAs,
  checkSecretRefAs,
  cliCommand,
  fieldViews,
  loadWizardAs,
  previewSwitchAs,
  providerAvailability,
  recentSwitchesAs,
  recordView,
  retrySwitchAs,
  rollbackSwitchAs,
  saveProviderSettingsAs,
  switchingGate,
  switchRecordAs,
  type InfrastructureSwitchDeps,
} from '@/lib/admin/infrastructure-switching'
import { SWITCH_PLANS } from '@/lib/admin/switch/plans'
import type { SqlClient } from '@/lib/admin/ops/instance-db'
import type { SwitchRecordRow } from '@/lib/admin/switch/types'

/**
 * Settings → Infrastructure provider changes (lib/admin/infrastructure-switching):
 * instance admins only on every action (a workspace owner, an unverified
 * address and no session are refused before the database is touched), the
 * page's switching gate (INFRA_UI_SWITCHING, the cloud lock), rate limits,
 * the schema → form mapping with secrets never sent back, the equivalent
 * CLI command without secret values, and refusal while a switch runs. The
 * engine runs for real against a fake connection; the database-backed
 * behaviour is in packages/admin/test/infra-ui-db.test.ts.
 */

const credentials = new Map<string, { email: string; email_confirmed_at: Date | null }>()
const fakeAuth: AuthDb = {
  async query(sql: string, params?: unknown[]) {
    if (sql.includes('FROM app_auth.credentials')) {
      const row = credentials.get(String(params?.[0]))
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 } as never
    }
    if (sql.includes('FROM app_auth.identities')) return { rows: [{ n: 0 }], rowCount: 1 } as never
    throw new Error(`unexpected query: ${sql}`)
  },
  transaction: (fn) => fn(fakeAuth),
}

const ADMIN = { id: 'admin-user', email: 'ops@example.com' }
const UNVERIFIED_ADMIN = { id: 'unverified-admin', email: 'ops@example.com' }
const TENANT_OWNER = { id: 'tenant-owner', email: 'owner@customer.com' }
const SECRET = 'fake-smtp-password-for-tests'

/** Just enough of Postgres for the engine's reads; writes are recorded. */
function fakeDb(state: { settings: Array<{ key: string; value: unknown; secret: boolean }>; busy?: boolean; queued?: number; records?: SwitchRecordRow[] }) {
  const writes: string[] = []
  let calls = 0
  const db: SqlClient = {
    async query(text: string) {
      calls++
      const sql = text.replace(/\s+/g, ' ')
      if (sql.includes('to_regclass')) return { rows: [{ ok: true }] as never }
      if (sql.includes('FROM public.instance_settings')) return { rows: state.settings as never }
      if (sql.includes('information_schema.columns')) return { rows: [{ n: 3 }] as never }
      if (sql.includes('FROM pg_locks')) return { rows: [{ busy: Boolean(state.busy) }] as never }
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ ok: !state.busy }] as never }
      if (sql.includes("WHERE status = 'queued'")) return { rows: [{ n: state.queued ?? 0 }] as never }
      if (sql.startsWith('SELECT id, kind')) return { rows: (state.records ?? []) as never }
      writes.push(sql)
      return { rows: [], rowCount: 0 }
    },
  }
  return { db, writes, calls: () => calls }
}

describe('Settings → Infrastructure provider changes', () => {
  const saved: Record<string, string | undefined> = {}
  const keys = ['AUTH_PROVIDER', 'INSTANCE_ADMIN_EMAILS', 'DB_PROVIDER', 'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'DATABASE_URL',
    'EMAIL_PROVIDER', 'SMTP_HOST', 'SMTP_PASSWORD', 'EMAIL_FROM', 'DEPLOYMENT_MODE', 'INFRA_UI_SWITCHING', 'REALTIME_PROVIDER', 'STORAGE_PROVIDER', 'VERCEL', 'ENCRYPTION_KEY']
  let fake: ReturnType<typeof fakeDb>
  let deps: InfrastructureSwitchDeps
  let limited: Set<string>
  let kicks: number
  let gate: { enabled: boolean; reason: string | null }

  beforeAll(() => {
    for (const key of keys) saved[key] = process.env[key]
    for (const key of keys) delete process.env[key]
    process.env.AUTH_PROVIDER = 'builtin'
    process.env.INSTANCE_ADMIN_EMAILS = 'ops@example.com'
    process.env.ENCRYPTION_KEY = 'a'.repeat(64)
    invalidateInstanceSettingsCache()
    setAuthDbForTests(fakeAuth)
    credentials.set(ADMIN.id, { email: ADMIN.email, email_confirmed_at: new Date() })
    credentials.set(UNVERIFIED_ADMIN.id, { email: UNVERIFIED_ADMIN.email, email_confirmed_at: null })
    credentials.set(TENANT_OWNER.id, { email: TENANT_OWNER.email, email_confirmed_at: new Date() })
  })
  afterEach(() => rmSync(deps.backupRoot, { recursive: true, force: true }))
  afterAll(() => {
    setAuthDbForTests(null)
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
    invalidateInstanceSettingsCache()
  })

  beforeEach(async () => {
    const { viewerCanSeeInfrastructure } = await import('@/lib/admin/infrastructure')
    fake = fakeDb({ settings: [] })
    limited = new Set()
    kicks = 0
    gate = { enabled: true, reason: null }
    deps = {
      canView: viewerCanSeeInfrastructure,
      withDb: (fn) => fn(fake.db, 'postgres://fake'),
      rateLimit: async (key) => !limited.has(key.split(':')[1]),
      gate: async () => gate,
      runtime: () => ({ available: true, reason: null }),
      kick: () => { kicks++ },
      plans: SWITCH_PLANS,
      backupRoot: mkdtempSync(path.join(tmpdir(), 'ut-infra-ui-')),
      invalidate: () => undefined,
      checkSecretRef: async () => ({ ok: true, detail: 'found' }),
      env: {},
      log: () => undefined,
    }
  })

  const ID = '00000000-0000-4000-8000-000000000001'
  const actions = {
    loadWizard: (u: typeof ADMIN | null) => loadWizardAs(u, 'email', deps),
    test: (u: typeof ADMIN | null) => previewSwitchAs(u, { area: 'email', to: 'console', values: {} }, 'test', deps),
    plan: (u: typeof ADMIN | null) => previewSwitchAs(u, { area: 'email', to: 'console', values: {} }, 'plan', deps),
    apply: (u: typeof ADMIN | null) => applySwitchAs(u, { area: 'email', to: 'console', values: {} }, deps),
    settings: (u: typeof ADMIN | null) => saveProviderSettingsAs(u, { area: 'email', values: { from: 'a@example.com' } }, deps),
    record: (u: typeof ADMIN | null) => switchRecordAs(u, ID, deps),
    list: (u: typeof ADMIN | null) => recentSwitchesAs(u, deps),
    rollback: (u: typeof ADMIN | null) => rollbackSwitchAs(u, { id: ID, confirm: 'rollback' }, deps),
    cancel: (u: typeof ADMIN | null) => cancelSwitchAs(u, ID, deps),
    retry: (u: typeof ADMIN | null) => retrySwitchAs(u, ID, deps),
    checkRef: (u: typeof ADMIN | null) => checkSecretRefAs(u, 'secret://smtp_password', deps),
  }

  it.each(Object.keys(actions))('%s: a workspace owner, an unverified admin address and no session are refused before the database is touched', async (name) => {
    const action = actions[name as keyof typeof actions]
    for (const user of [TENANT_OWNER, UNVERIFIED_ADMIN, null]) {
      expect(await action(user)).toEqual({ ok: false, error: 'Only instance administrators can change infrastructure.' })
    }
    expect(fake.calls()).toBe(0)
  })

  it.each(Object.keys(actions))('%s: an instance admin gets through the access check', async (name) => {
    const res = await actions[name as keyof typeof actions](ADMIN)
    if (!res.ok) expect(res.error).not.toMatch(/instance administrators/)
    expect(fake.calls()).toBeGreaterThan(0)
  })

  it('rate limits per user and action', async () => {
    limited.add('apply')
    expect(await actions.apply(ADMIN)).toMatchObject({ ok: false, error: expect.stringMatching(/Too many requests/) })
    expect(fake.calls()).toBe(0)
    expect((await actions.plan(ADMIN)).ok).toBe(true)
  })

  it('the switching gate (off, or the cloud lock) refuses every change but still shows the wizard', async () => {
    gate = { enabled: false, reason: 'Cloud edition: locked' }
    for (const name of ['test', 'plan', 'apply', 'settings', 'rollback', 'retry'] as const) {
      expect(await actions[name](ADMIN)).toMatchObject({ ok: false, error: 'Cloud edition: locked' })
    }
    expect(fake.writes).toEqual([])
    const wizard = await actions.loadWizard(ADMIN)
    expect(wizard).toMatchObject({ ok: true, wizard: { gate: { enabled: false } } })
  })

  it('switchingGate: on by default, INFRA_UI_SWITCHING=false turns it off, cloud needs instance.allow_ui_switching', () => {
    expect(switchingGate({ flag: undefined, deploymentMode: 'self_hosted', allowSetting: undefined }).enabled).toBe(true)
    expect(switchingGate({ flag: 'false', deploymentMode: 'self_hosted', allowSetting: true }).enabled).toBe(false)
    expect(switchingGate({ flag: undefined, deploymentMode: 'cloud', allowSetting: undefined })).toMatchObject({ enabled: false, reason: expect.stringMatching(/ui-switching on/) })
    expect(switchingGate({ flag: undefined, deploymentMode: 'cloud', allowSetting: false }).enabled).toBe(false)
    expect(switchingGate({ flag: 'on', deploymentMode: 'cloud', allowSetting: true }).enabled).toBe(true)
  })

  it('refuses to apply while another switch runs or is queued (nothing written)', async () => {
    fake = fakeDb({ settings: [], busy: true })
    expect(await actions.apply(ADMIN)).toMatchObject({ ok: false, error: expect.stringMatching(/Another provider switch is queued or running/) })
    fake = fakeDb({ settings: [], queued: 1 })
    expect(await actions.apply(ADMIN)).toMatchObject({ ok: false, error: expect.stringMatching(/queued or running/) })
    expect(await actions.settings(ADMIN)).toMatchObject({ ok: false, error: expect.stringMatching(/queued or running/) })
    expect(fake.writes.filter((w) => /INSERT|UPDATE/.test(w) && w.includes('instance_settings'))).toEqual([])
  })

  it('data-moving switches need the typed confirmation, are queued on a long-running runtime and kick the runner', async () => {
    const input = { area: 'storage', to: 'local', values: { local_root: '/var/lib/usertasks/files' } }
    expect(await applySwitchAs(ADMIN, input, deps)).toMatchObject({ ok: false, error: 'Type local to confirm: this switch moves data.' })
    const res = await applySwitchAs(ADMIN, { ...input, confirm: 'local' }, deps)
    expect(res).toMatchObject({ ok: true, mode: 'background', record: { status: 'queued', background: true } })
    expect(kicks).toBe(1)
    expect(fake.writes.some((w) => w.startsWith('INSERT INTO public.instance_provider_switches'))).toBe(true)
  })

  it('on serverless a data-moving switch only returns the CLI command (nothing queued, no confirmation needed)', async () => {
    deps.runtime = () => ({ available: false, reason: 'Vercel functions stop when the request ends' })
    const res = await applySwitchAs(ADMIN, { area: 'storage', to: 's3', values: { endpoint: 'http://minio:9000', access_key_id: 'ut', secret_access_key: SECRET } }, deps)
    expect(res).toMatchObject({ ok: true, mode: 'cli', record: null })
    if (!res.ok) return
    expect(res.cli.command).toBe(`usertasks-admin switch storage --to s3 --set endpoint=http://minio:9000 --set access_key_id=ut --secret secret_access_key="$NEW_S3_SECRET_ACCESS_KEY" --yes`)
    expect(JSON.stringify(res)).not.toContain(SECRET)
    expect(fake.writes).toEqual([])
    expect(kicks).toBe(0)
  })

  it('on serverless the database switch is queued as a chunked job (target URL encrypted, never in the record view)', async () => {
    deps.runtime = () => ({ available: false, reason: 'Vercel functions stop when the request ends' })
    const input = { area: 'db', to: 'postgres', values: {}, flags: { 'target-url': 'postgres://app:fake-db-password@db.internal/ut' } }
    expect(await applySwitchAs(ADMIN, input, deps)).toMatchObject({ ok: false, error: 'Type postgres to confirm: this switch moves data.' })
    const res = await applySwitchAs(ADMIN, { ...input, confirm: 'postgres' }, deps)
    expect(res).toMatchObject({ ok: true, mode: 'chunked', record: { status: 'queued' } })
    expect(kicks).toBe(1)
    const insert = fake.writes.find((w) => w.startsWith('INSERT INTO public.instance_provider_switches'))
    expect(insert).toBeDefined()
    expect(JSON.stringify(res)).not.toContain('fake-db-password')
  })

  it('a config-only switch runs in the request through the engine (refused here: no switch log rows, but never half-written)', async () => {
    const res = await applySwitchAs(ADMIN, { area: 'email', to: 'console', values: {} }, deps)
    // The fake has no switch log row to read back; the engine still went through pre-flight, record and config.
    expect(res.ok).toBe(true)
    expect(fake.writes.some((w) => w.includes('INSERT INTO public.instance_settings') || w.includes('instance_settings (key'))).toBe(true)
  })

  it('rollback needs the typed confirmation', async () => {
    fake = fakeDb({ settings: [], records: [{ id: ID, kind: 'switch', area: 'email', from_provider: 'resend', to_provider: 'console', status: 'succeeded', rollback_of: null, steps: [], config_before: { settings: [], env: {} }, config_after: { settings: [], env: {} }, env_changes: {}, backup_dir: null, actor: 'x', host: 'h', error: null, started_at: new Date().toISOString(), finished_at: null }] })
    expect(await rollbackSwitchAs(ADMIN, { id: ID }, deps)).toMatchObject({ ok: false, error: 'Type rollback to confirm.' })
    expect((await rollbackSwitchAs(ADMIN, { id: ID, dryRun: true }, deps)).ok).toBe(true)
  })
})

describe('schema → form mapping and secret handling', () => {
  const config = (settings: Record<string, unknown>) => resolveInstanceConfig(new Map(Object.entries(settings)))

  it('secret fields only say whether a value is set (or which secret:// reference): values never leave the server', () => {
    const views = fieldViews('email', 'smtp', config({ 'email.smtp_password': SECRET, 'email.smtp_host': 'smtp.example.com' }), {})
    const password = views.find((f) => f.option === 'smtp_password')!
    expect(password).toMatchObject({ secret: true, configured: true, value: null, ref: null })
    expect(JSON.stringify(views)).not.toContain(SECRET)
    expect(views.find((f) => f.option === 'smtp_host')).toMatchObject({ secret: false, value: 'smtp.example.com', envVar: 'SMTP_HOST', envPinned: false })
    const byRef = fieldViews('email', 'smtp', config({ 'email.smtp_password': 'secret://smtp_password' }), {})
    expect(byRef.find((f) => f.option === 'smtp_password')).toMatchObject({ configured: true, value: null, ref: 'secret://smtp_password' })
  })

  it('environment-pinned options are read-only (a secret from the environment is not sent either)', () => {
    const env = { SMTP_PASSWORD: SECRET, SMTP_HOST: 'relay.internal' }
    const prev = { ...process.env }
    Object.assign(process.env, env)
    try {
      const views = fieldViews('email', 'smtp', resolveInstanceConfig(new Map()), env)
      expect(views.find((f) => f.option === 'smtp_password')).toMatchObject({ envPinned: true, envVar: 'SMTP_PASSWORD', value: null, configured: true })
      expect(views.find((f) => f.option === 'smtp_host')).toMatchObject({ envPinned: true, value: 'relay.internal' })
      expect(JSON.stringify(views)).not.toContain(SECRET)
      const built = buildOptions({ area: 'email', to: 'smtp', values: { smtp_host: 'other.example.com' } }, resolveInstanceConfig(new Map()), 'switch', env)
      expect(built.errors.smtp_host).toMatch(/environment variable SMTP_HOST/)
    } finally {
      process.env = prev
    }
  })

  it('values become engine options like --set / --secret; references stay plain; required and typed fields are checked', () => {
    const built = buildOptions({ area: 'email', to: 'smtp', values: { smtp_host: ' smtp.example.com ', smtp_port: '587', smtp_password: SECRET, smtp_user: 'secret://smtp_user', smtp_secure: 'TRUE' } }, config({}), 'switch', {})
    expect(built.errors).toEqual({})
    expect(built.set).toEqual({ smtp_host: 'smtp.example.com', smtp_port: '587', smtp_user: 'secret://smtp_user', smtp_secure: 'true' })
    expect(built.secret).toEqual({ smtp_password: SECRET })
    const bad = buildOptions({ area: 'email', to: 'smtp', values: { smtp_port: 'abc', smtp_starttls: 'sometimes', nonsense: 'x', from: 'not an address' } }, config({}), 'switch', {})
    expect(Object.keys(bad.errors).sort()).toEqual(['from', 'nonsense', 'smtp_host', 'smtp_port', 'smtp_starttls'])
    expect(bad.errors.smtp_host).toMatch(/required/)
    const stored = buildOptions({ area: 'email', to: 'smtp', values: {} }, config({ 'email.smtp_host': 'smtp.example.com' }), 'switch', {})
    expect(stored.errors).toEqual({})
  })

  it('settings changes: clear options, refuse key-identity changes of the KMS, secret store options cannot be references', () => {
    const cleared = buildOptions({ area: 'email', to: 'smtp', values: {}, clear: ['reply_to', 'smtp_host'] }, config({ 'email.reply_to': 'x@example.com', 'email.smtp_host': 'h' }), 'settings', {})
    expect(cleared.unset).toEqual(['reply_to', 'smtp_host'])
    expect(cleared.errors.smtp_host).toMatch(/required/)
    const kms = buildOptions({ area: 'kms', to: 'aws_kms', values: { aws_kms_key_id: 'alias/new', refresh_seconds: '30' } }, config({ 'kms.aws_kms_key_id': 'alias/old' }), 'settings', {})
    expect(kms.errors.aws_kms_key_id).toMatch(/Change provider/)
    expect(kms.set).toEqual({ refresh_seconds: '30' })
    const secrets = buildOptions({ area: 'secrets', to: 'hashicorp_vault', values: { vault_addr: 'https://vault:8200', vault_token: 'secret://vault_token' } }, config({}), 'switch', {})
    expect(secrets.errors.vault_token).toMatch(/cannot be secret:\/\/ references/)
    const flags = buildOptions({ area: 'db', to: 'postgres', values: {}, flags: {} }, config({}), 'switch', {})
    expect(flags.errors['flag:target-host']).toMatch(/URL, or host, database and user/)
    const parts = buildOptions({ area: 'db', to: 'postgres', values: {}, flags: { 'target-host': 'db.internal', 'target-database': 'ut', 'target-user': 'app', 'target-password': 'fake-db-password', 'target-sslmode': 'verify-full', 'target-auth': 'gcp', 'prepare-only': true } }, config({}), 'switch', {})
    expect(parts.errors).toEqual({})
    const partsCli = cliCommand('db', 'postgres', parts)
    expect(partsCli.command).toBe('usertasks-admin switch database --to postgres --target-host db.internal --target-database ut --target-user app --target-sslmode verify-full --target-auth gcp --prepare-only --yes')
    expect(partsCli.env).toEqual(['TARGET_DATABASE_PASSWORD'])
    expect(buildOptions({ area: 'db', to: 'postgres', values: {}, flags: { 'target-url': 'postgres://x/y', 'target-auth': 'kerberos' } }, config({}), 'switch', {}).errors['flag:target-auth']).toMatch(/one of/)
  })

  it('the equivalent CLI command never contains a secret value or the target database URL', () => {
    const built = buildOptions({ area: 'db', to: 'postgres', values: {}, flags: { 'target-url': 'postgres://u:fake-password@db:5432/ut' } }, config({}), 'switch', {})
    const cli = cliCommand('db', 'postgres', built)
    expect(cli).toEqual({ command: 'usertasks-admin switch database --to postgres --target-url "$TARGET_DATABASE_URL" --yes', env: ['TARGET_DATABASE_URL'] })
    const email = cliCommand('email', 'smtp', buildOptions({ area: 'email', to: 'smtp', values: { smtp_host: 'h', from: 'UserTasks <no@x.io>', smtp_password: SECRET } }, config({}), 'switch', {}), { dryRun: true })
    expect(email.command).toBe(`usertasks-admin switch email --to smtp --set smtp_host=h --set 'from=UserTasks <no@x.io>' --secret smtp_password="$NEW_SMTP_PASSWORD" --dry-run`)
    expect(email.command).not.toContain(SECRET)
  })

  it('records sent to the page carry no secret material (job, ciphertext, config values)', () => {
    const record: SwitchRecordRow = {
      id: '00000000-0000-4000-8000-000000000002', kind: 'switch', area: 'email', from_provider: 'resend', to_provider: 'smtp', status: 'succeeded', rollback_of: null,
      steps: [{ id: 'config', title: 'Apply config', status: 'done' }],
      config_before: { settings: [{ key: 'email.from', value: 'a@x.io', secret: false }], env: {} },
      config_after: { settings: [{ key: 'email.from', value: 'b@x.io', secret: false }, { key: 'email.smtp_password', value: 'enc:v1:CIPHERTEXT', secret: true }], env: {} },
      env_changes: {}, backup_dir: '/b', actor: 'ops', host: 'h', error: null, started_at: new Date().toISOString(), finished_at: null,
      job: { set: {}, secret: 'enc:v1:JOBCIPHERTEXT', flags: {}, noDump: false, force: false },
    }
    const view = recordView(record, false)
    expect(view.changes).toEqual([
      { key: 'email.from', before: 'a@x.io', after: 'b@x.io', secret: false },
      { key: 'email.smtp_password', before: null, after: '(encrypted)', secret: true },
    ])
    expect(JSON.stringify(view)).not.toMatch(/CIPHERTEXT/)
    expect(view).toMatchObject({ percent: 100, canRollback: true, background: true })
  })

  it('apply modes and availability per deployment', () => {
    expect(backgroundRuntime({ VERCEL: '1' }).available).toBe(false)
    expect(backgroundRuntime({ VERCEL: '1', INFRA_UI_BACKGROUND_JOBS: 'on' }).available).toBe(true)
    expect(backgroundRuntime({}).available).toBe(true)
    const server = { available: true, reason: null }
    const lambda = { available: false, reason: 'x' }
    expect(applyMode('email', lambda)).toBe('direct')
    expect(applyMode('kms', server)).toBe('direct')
    expect(applyMode('storage', server)).toBe('background')
    expect(applyMode('db', lambda)).toBe('chunked')
    expect(applyMode('storage', lambda)).toBe('cli')
    expect(providerAvailability('realtime', 'supabase', { supabaseUrl: false, serverless: false })).toMatchObject({ available: false })
    expect(providerAvailability('scheduler', 'worker', { supabaseUrl: true, serverless: true })).toMatchObject({ available: false })
    expect(providerAvailability('storage', 'local', { supabaseUrl: true, serverless: false })).toMatchObject({ available: true })
  })
})

describe('infrastructure server actions', () => {
  it('use the session user (a tenant owner is refused)', async () => {
    vi.resetModules()
    vi.doMock('@/lib/providers/db/session', () => ({ getSessionDbWithUser: async () => ({ supabase: {}, user: { id: 'tenant-owner', email: 'owner@customer.com' } }) }))
    vi.doMock('@/lib/admin/infrastructure', () => ({
      viewerCanSeeInfrastructure: async (user: { email?: string } | null) => user?.email === 'ops@example.com',
      clearInfrastructureHealthCache: () => undefined,
    }))
    try {
      const actions = await import('@/app/actions/infrastructure')
      expect(await actions.applyProviderChange({ area: 'email', to: 'console', values: {} })).toMatchObject({ ok: false, error: expect.stringMatching(/instance administrators/) })
      expect(await actions.rollbackProviderSwitch({ id: '00000000-0000-4000-8000-000000000001', confirm: 'rollback' })).toMatchObject({ ok: false })
      expect(await actions.loadSwitchWizard('email')).toMatchObject({ ok: false })
      expect(await actions.canViewInfrastructureAction()).toBe(false)
    } finally {
      vi.doUnmock('@/lib/providers/db/session')
      vi.doUnmock('@/lib/admin/infrastructure')
      vi.resetModules()
    }
  })
})
