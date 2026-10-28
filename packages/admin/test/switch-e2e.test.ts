/**
 * End-to-end provider switches on a scratch copy of a Supabase install:
 *   storage  supabase → local → s3 (MinIO), then rolled back to supabase
 *   auth     supabase → builtin (the migrated user signs in with their old password), and back
 *   scheduler pg_cron → worker, and back (the pg_cron jobs return)
 *   realtime supabase → sse; then
 *   database the Supabase copy → a fresh plain PostgreSQL (row counts + RLS smoke)
 *
 * Opt-in (it needs a disposable Supabase-shaped database, never the shared
 * local stack's): ADMIN_E2E_SUPABASE_DB_URL — a copy of a Supabase database
 * in a separate supabase/postgres container (see docs/switching-providers.md
 * "Testing switches"), connected as `postgres`; SUPABASE_URL / keys of a
 * running stack for the Supabase Storage source (objects are written under a
 * unique `_e2e/` prefix and removed); ADMIN_E2E_PLAIN_ADMIN_URL — a plain
 * PostgreSQL server that may CREATE DATABASE; ADMIN_E2E_S3_ENDPOINT — MinIO
 * (minioadmin / minioadmin), optional.
 */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { runRollback, runSwitch, type EngineIO } from '../src/switch/engine'
import { SWITCH_PLANS } from '../src/switch/plans'
import { readSettingRows } from '../src/instance'
import type { ProviderArea } from '@/lib/config/schema'
import type { SwitchOptions } from '../src/switch/types'
import { resetRequest } from '../../../__tests__/helpers/next-headers-mock'

vi.mock('next/headers', () => import('../../../__tests__/helpers/next-headers-mock'))

const SUPA = process.env.ADMIN_E2E_SUPABASE_DB_URL
const PLAIN_ADMIN = process.env.ADMIN_E2E_PLAIN_ADMIN_URL
const S3 = process.env.ADMIN_E2E_S3_ENDPOINT
const DEMO_EMAIL = 'ada@northwind.example'
const DEMO_PASSWORD = 'demo-password-2026'
const REPO_MIGRATIONS = path.resolve(__dirname, '../../../supabase/migrations')

describe.skipIf(!SUPA || !PLAIN_ADMIN || !process.env.SUPABASE_URL)('provider switches end to end (scratch Supabase copy)', () => {
  const db = new pg.Client({ connectionString: SUPA })
  const root = mkdtempSync(path.join(tmpdir(), 'ut-e2e-'))
  const run = randomUUID().slice(0, 8)
  const prefix = `_e2e/${run}/`
  const savedEnv = { ...process.env }
  const ids: Partial<Record<string, string>> = {}
  let supabaseStorage: import('@/lib/providers/storage/types').StorageProvider
  let tenantId = ''
  let originalBranding: unknown

  const log = (): EngineIO & { text: () => string } => {
    const lines: string[] = []
    return { log: (l) => lines.push(l), warn: (l) => lines.push(l), text: () => lines.join('\n') }
  }
  const opts = (to: string, extra: Partial<SwitchOptions> = {}): SwitchOptions => ({
    to, dryRun: false, yes: true, backupRoot: path.join(root, 'backups'), set: {}, secret: {}, flags: {}, noDump: true, actor: 'e2e', force: false, ...extra,
  })
  const setting = async (key: string) => (await readSettingRows(db)).find((r) => r.key === key)?.value
  async function sw(area: ProviderArea, o: SwitchOptions) {
    const out = log()
    const result = await runSwitch({ db, dbUrl: SUPA!, area, plan: SWITCH_PLANS[area], options: o, io: out })
    expect(result.code, out.text()).toBe(0)
    return result
  }
  async function back(id: string) {
    const out = log()
    const result = await runRollback({ db, dbUrl: SUPA!, id, plans: SWITCH_PLANS, yes: true, dryRun: false, backupRoot: path.join(root, 'backups'), actor: 'e2e', io: out })
    expect(result.code, out.text()).toBe(0)
    return out.text()
  }

  beforeAll(async () => {
    await db.connect()
    for (const name of ['DB_PROVIDER', 'AUTH_PROVIDER', 'STORAGE_PROVIDER', 'REALTIME_PROVIDER', 'SCHEDULER_PROVIDER', 'EMAIL_PROVIDER', 'SECRETS_PROVIDER', 'STORAGE_LOCAL_ROOT', 'S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) delete process.env[name]
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
    process.env.CRON_SECRET = 'e2e-cron-secret'
    process.env.APP_URL = 'https://tasks.e2e.test'
    process.env.REALTIME_DATABASE_URL = SUPA
    const { rows } = await db.query(`SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') AS ok, current_database() AS name`)
    if (!rows[0].ok) throw new Error('ADMIN_E2E_SUPABASE_DB_URL must be a Supabase-shaped database copy')
    // Start from the copy's original state (an earlier interrupted run may have left changes).
    await db.query(`DELETE FROM public.instance_settings`)
    await db.query(`SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname LIKE 'usertasks-%'`)
    await db.query(`DELETE FROM app_auth.credentials WHERE migrated_from = 'supabase'`)
    // Two objects in Supabase Storage under a unique prefix; a tenant logo points at one.
    const { supabaseStorageProvider } = await import('@/lib/providers/storage')
    supabaseStorage = supabaseStorageProvider
    await supabaseStorage.put('logos', `${prefix}logo.png`, new TextEncoder().encode(`logo ${run}`), { contentType: 'image/png', upsert: true })
    await supabaseStorage.put('logos', `${prefix}nested/mark.svg`, new TextEncoder().encode(`<svg>${run}</svg>`), { contentType: 'image/svg+xml', upsert: true })
    const t = await db.query<{ id: string; branding: unknown }>(`INSERT INTO public.tenants (name, slug, branding) VALUES ($1, $2, $3) RETURNING id, branding`, [
      `E2E ${run}`, `e2e-${run}`, JSON.stringify({ logo_url: supabaseStorage.publicUrl('logos', `${prefix}logo.png`) }),
    ])
    tenantId = t.rows[0].id
    originalBranding = t.rows[0].branding
  }, 120_000)

  afterAll(async () => {
    await supabaseStorage?.delete('logos', [`${prefix}logo.png`, `${prefix}nested/mark.svg`]).catch(() => undefined)
    await db.query(`DELETE FROM public.tenants WHERE id = $1`, [tenantId]).catch(() => undefined)
    await db.query(`DELETE FROM public.instance_settings`).catch(() => undefined)
    await db.query(`SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname LIKE 'usertasks-%'`).catch(() => undefined)
    await db.end()
    const { closeAuthDb } = await import('@/lib/providers/auth/builtin/db')
    await closeAuthDb()
    process.env = savedEnv
    rmSync(root, { recursive: true, force: true })
  }, 60_000)

  it('storage: supabase → local (files copied, URLs become refs)', async () => {
    const localRoot = path.join(root, 'files')
    const result = await sw('storage', opts('local', { set: { local_root: localRoot }, flags: { bucket: ['logos'], prefix } }))
    ids.local = result.switchId!
    expect(readFileSync(path.join(localRoot, 'logos', prefix, 'logo.png'), 'utf8')).toBe(`logo ${run}`)
    expect(existsSync(path.join(localRoot, 'logos', prefix, 'nested', 'mark.svg'))).toBe(true)
    const { rows } = await db.query(`SELECT branding FROM public.tenants WHERE id = $1`, [tenantId])
    expect(rows[0].branding.logo_url).toBe(`storage://logos/${prefix}logo.png`)
    expect(await setting('providers.storage')).toBe('local')
    expect(await setting('storage.local_root')).toBe(localRoot)
    expect(result.record!.steps.find((s) => s.id === 'copy')!.detail).toMatch(/2 object\(s\), 2 copied/)
    // Re-running is a no-op copy (the setting is already local → nothing to do).
    const again = log()
    await runSwitch({ db, dbUrl: SUPA!, area: 'storage', plan: SWITCH_PLANS.storage, options: opts('local'), io: again })
    expect(again.text()).toMatch(/already uses local/)
  }, 120_000)

  it.skipIf(!S3)('storage: local → s3 (MinIO; secret option stored encrypted)', async () => {
    const result = await sw('storage', opts('s3', {
      set: { endpoint: S3!, force_path_style: 'true', region: 'us-east-1', access_key_id: 'minioadmin', bucket_prefix: `e2e-${run}-` },
      secret: { secret_access_key: 'minioadmin' },
      flags: { bucket: ['logos'], prefix },
    }))
    ids.s3 = result.switchId!
    const rows = await readSettingRows(db)
    const secret = rows.find((r) => r.key === 'storage.secret_access_key')!
    expect(secret.secret).toBe(true)
    expect(String(secret.value)).toMatch(/^enc:v1:/)
    const { resolveStorageProvider } = await import('@/lib/providers/storage')
    const s3 = resolveStorageProvider('s3', { endpoint: S3, force_path_style: 'true', region: 'us-east-1', access_key_id: 'minioadmin', secret_access_key: 'minioadmin', bucket_prefix: `e2e-${run}-` })
    expect((await s3.head('logos', `${prefix}logo.png`))?.size).toBe(`logo ${run}`.length)
    expect((await db.query(`SELECT branding FROM public.tenants WHERE id = $1`, [tenantId])).rows[0].branding.logo_url).toBe(`storage://logos/${prefix}logo.png`)
    const text = await back(ids.s3)
    expect(text).toMatch(/Rolled back storage to local/)
    expect(await setting('providers.storage')).toBe('local')
    expect(await setting('storage.secret_access_key')).toBeUndefined()
  }, 120_000)

  it('storage: rollback to supabase restores the original stored URLs', async () => {
    await back(ids.local!)
    expect(await setting('providers.storage')).toBeUndefined()
    expect(await setting('storage.local_root')).toBeUndefined()
    const { rows } = await db.query(`SELECT branding FROM public.tenants WHERE id = $1`, [tenantId])
    expect(rows[0].branding).toEqual(originalBranding)
  }, 60_000)

  it('auth: supabase → builtin, the migrated user signs in with their password; rollback', async () => {
    const result = await sw('auth', opts('builtin'))
    expect(result.record!.steps.find((s) => s.id === 'migrate-users')!.detail).toMatch(/users: \d+ found/)
    expect(await setting('providers.auth')).toBe('builtin')
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM app_auth.credentials c JOIN auth.users u ON u.id = c.user_id AND u.encrypted_password = c.password_hash`)
    expect(rows[0].n).toBeGreaterThan(0)

    process.env.DATABASE_URL = SUPA
    const { resolveAuthProvider } = await import('@/lib/providers/auth')
    const provider = resolveAuthProvider('builtin')
    resetRequest()
    const demo = await db.query<{ id: string }>(`SELECT id FROM auth.users WHERE email = $1`, [DEMO_EMAIL])
    if (demo.rows[0]) {
      await expect(provider.signInWithPassword(DEMO_EMAIL, 'wrong-password')).rejects.toMatchObject({ code: 'invalid_credentials' })
      await expect(provider.signInWithPassword(DEMO_EMAIL, DEMO_PASSWORD)).resolves.toMatchObject({ id: demo.rows[0].id })
      await db.query(`UPDATE app_auth.credentials SET failed_attempts = 0 WHERE user_id = $1`, [demo.rows[0].id])
    }
    ids.auth = result.switchId!
  }, 120_000)

  it('scheduler: pg_cron jobs → worker and back', async () => {
    const jobs = async () => (await db.query<{ jobname: string }>(`SELECT jobname FROM cron.job WHERE jobname LIKE 'usertasks-%' ORDER BY 1`)).rows.map((r) => r.jobname)
    const install = await sw('scheduler', opts('pg_cron', { force: true }))
    expect(await jobs()).toEqual(['usertasks-cron-housekeeping', 'usertasks-tick'])
    const toWorker = await sw('scheduler', opts('worker'))
    expect(await jobs()).toEqual([])
    expect(await setting('providers.scheduler')).toBe('worker')
    await back(toWorker.switchId!)
    expect(await jobs()).toEqual(['usertasks-cron-housekeeping', 'usertasks-tick'])
    // The forced install wrote the (default) provider explicitly; rolling it back removes the row and the jobs.
    expect(await setting('providers.scheduler')).toBe('pg_cron')
    await back(install.switchId!)
    expect(await jobs()).toEqual([])
    expect(await setting('providers.scheduler')).toBeUndefined()
    ids.worker = (await sw('scheduler', opts('worker'))).switchId!
  }, 120_000)

  it('database: the Supabase copy → plain PostgreSQL 16', async () => {
    await sw('realtime', opts('sse'))
    const admin = new pg.Client({ connectionString: PLAIN_ADMIN })
    await admin.connect()
    const name = `ut_e2e_${run}`
    await admin.query(`CREATE DATABASE ${name}`)
    try {
      const target = new URL(PLAIN_ADMIN!)
      target.pathname = `/${name}`
      const result = await sw('db', opts('postgres', { flags: { 'target-url': target.toString(), dir: REPO_MIGRATIONS } }))
      const steps = Object.fromEntries(result.record!.steps.map((s) => [s.id, s.detail]))
      expect(steps['verify-counts']).toMatch(/match/)
      expect(steps['rls-smoke']).toMatch(/identical|no users/)
      expect(result.record!.env_changes.DB_PROVIDER).toBe('postgres')
      const t = new pg.Client({ connectionString: target.toString() })
      await t.connect()
      const { rows } = await t.query(`SELECT (SELECT value FROM public.instance_settings WHERE key = 'providers.auth') AS auth, (SELECT count(*)::int FROM app_auth.credentials) AS creds`)
      expect(rows[0].auth).toBe('builtin')
      expect(rows[0].creds).toBeGreaterThan(0)
      await t.end()
      if (process.env.ADMIN_E2E_KEEP_TARGET) console.log(`kept target database ${target.toString().replace(/:[^:@/]+@/, ':****@')}`)
    } finally {
      if (!process.env.ADMIN_E2E_KEEP_TARGET) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => undefined)
      await admin.end()
    }
    // Back to Supabase Auth (built-in sessions revoked, credentials restored to the snapshot).
    await back(ids.worker!)
    const text = await back(ids.auth!)
    expect(text).toMatch(/removed \d+ copied account/)
    expect(await setting('providers.auth')).toBeUndefined()
  }, 300_000)
})
