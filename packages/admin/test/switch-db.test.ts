/**
 * usertasks-admin switch / rollback against real, plain PostgreSQL scratch
 * databases (the repository migration chain applied by the runner): dry run,
 * refusal without --yes, the switch record and settings, failures, env-managed
 * areas, rollback, and a full database switch into a second scratch
 * database (row counts + RLS smoke).
 *
 * Runs only with MIGRATION_TEST_ADMIN_URL (a role that may CREATE DATABASE on
 * a NON-Supabase server), like runner-db.test.ts.
 */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import pg from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { loadMigrations } from '../src/db/migrations'
import { migrate } from '../src/db/runner'
import { runRollback, runSwitch, type EngineIO } from '../src/switch/engine'
import { getRecord, listRecords } from '../src/switch/log'
import { SWITCH_PLANS } from '../src/switch/plans'
import type { AreaSwitch, SwitchOptions } from '../src/switch/types'
import { readSettingRows } from '../src/instance'

const ADMIN_URL = process.env.MIGRATION_TEST_ADMIN_URL
const REPO_MIGRATIONS = path.resolve(__dirname, '../../../supabase/migrations')

function dbUrl(name: string): string {
  const url = new URL(ADMIN_URL!)
  url.pathname = `/${name}`
  return url.toString()
}

describe.skipIf(!ADMIN_URL)('usertasks-admin switch (plain PostgreSQL)', () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL })
  const created: string[] = []
  const dirs: string[] = []
  const clients: pg.Client[] = []
  let sourceUrl: string
  let db: pg.Client
  const envBackup = { ...process.env }

  async function scratchDb(migrated: boolean): Promise<string> {
    const name = `ut_switch_${randomUUID().slice(0, 8)}`
    await admin.query(`CREATE DATABASE ${name}`)
    created.push(name)
    const url = dbUrl(name)
    if (migrated) {
      const c = await connect(url)
      await migrate(c, loadMigrations(REPO_MIGRATIONS))
    }
    return url
  }
  async function connect(url: string): Promise<pg.Client> {
    const client = new pg.Client({ connectionString: url })
    await client.connect()
    clients.push(client)
    return client
  }
  function capture(): EngineIO & { lines: string[]; errors: string[]; text: () => string } {
    const lines: string[] = []
    const errors: string[] = []
    return { lines, errors, log: (l) => lines.push(l), warn: (l) => errors.push(l), text: () => [...lines, ...errors].join('\n') }
  }
  function options(to: string, extra: Partial<SwitchOptions> = {}): SwitchOptions {
    const root = mkdtempSync(path.join(tmpdir(), 'ut-switch-'))
    dirs.push(root)
    return { to, dryRun: false, yes: true, backupRoot: root, set: {}, secret: {}, flags: {}, noDump: true, actor: 'test', force: false, ...extra }
  }
  const setting = async (key: string) => (await readSettingRows(db)).find((r) => r.key === key)?.value

  beforeAll(async () => {
    await admin.connect()
    const { rows } = await admin.query(`SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin'`)
    if (rows.length) throw new Error('MIGRATION_TEST_ADMIN_URL must point at plain PostgreSQL, not a Supabase stack')
    sourceUrl = await scratchDb(true)
    db = await connect(sourceUrl)
    for (const name of ['REALTIME_PROVIDER', 'EMAIL_PROVIDER', 'SCHEDULER_PROVIDER', 'AUTH_PROVIDER', 'STORAGE_PROVIDER', 'SECRETS_PROVIDER', 'DB_PROVIDER', 'AUTH_SSO_PROVIDERS', 'CACHE_PROVIDER', 'CACHE_REDIS_URL']) delete process.env[name]
    process.env.REALTIME_DATABASE_URL = sourceUrl
  }, 180_000)
  afterEach(() => {
    delete process.env.EMAIL_PROVIDER
  })
  afterAll(async () => {
    process.env = envBackup
    for (const c of clients) await c.end().catch(() => undefined)
    for (const name of created) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => undefined)
    await admin.end()
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  })

  it('dry run and refusal without --yes change nothing; --yes switches, records and is idempotent; rollback restores', async () => {
    const dry = capture()
    const planned = await runSwitch({ db, dbUrl: sourceUrl, area: 'realtime', plan: SWITCH_PLANS.realtime, options: options('sse', { dryRun: true, yes: false }), io: dry })
    expect(planned.code).toBe(0)
    expect(dry.text()).toMatch(/LISTEN\/NOTIFY round trip OK/)
    expect(dry.text()).toMatch(/providers\.realtime = "sse"/)
    expect(dry.text()).toMatch(/Dry run: nothing was changed/)
    expect(await setting('providers.realtime')).toBeUndefined()
    expect(await listRecords(db)).toEqual([])

    const refused = capture()
    expect((await runSwitch({ db, dbUrl: sourceUrl, area: 'realtime', plan: SWITCH_PLANS.realtime, options: options('sse', { yes: false }), io: refused })).code).toBe(2)
    expect(refused.errors.join('\n')).toMatch(/without --yes/)
    expect(await setting('providers.realtime')).toBeUndefined()

    const opts = options('sse')
    const done = await runSwitch({ db, dbUrl: sourceUrl, area: 'realtime', plan: SWITCH_PLANS.realtime, options: opts, io: capture() })
    expect(done.code).toBe(0)
    expect(await setting('providers.realtime')).toBe('sse')
    const record = await getRecord(db, done.switchId!)
    expect(record).toMatchObject({ kind: 'switch', area: 'realtime', from_provider: 'supabase', to_provider: 'sse', status: 'succeeded', actor: 'test' })
    expect(record!.steps.at(-1)).toMatchObject({ id: 'config', status: 'done' })
    // Config snapshot and mirrored record in a private backup directory.
    const dir = path.join(opts.backupRoot, done.switchId!)
    expect(JSON.parse(readFileSync(path.join(dir, 'config.json'), 'utf8')).settings).toEqual([])
    expect(JSON.parse(readFileSync(path.join(dir, 'switch.json'), 'utf8')).status).toBe('succeeded')
    if (process.platform !== 'win32') expect(statSync(dir).mode & 0o777).toBe(0o700)

    const again = capture()
    expect((await runSwitch({ db, dbUrl: sourceUrl, area: 'realtime', plan: SWITCH_PLANS.realtime, options: options('sse'), io: again })).code).toBe(0)
    expect(again.text()).toMatch(/already uses sse/)

    const noYes = capture()
    expect((await runRollback({ db, dbUrl: sourceUrl, id: done.switchId!, plans: SWITCH_PLANS, yes: false, dryRun: false, backupRoot: opts.backupRoot, actor: 'test', io: noYes })).code).toBe(2)
    expect(await setting('providers.realtime')).toBe('sse')

    const rolled = await runRollback({ db, dbUrl: sourceUrl, id: done.switchId!, plans: SWITCH_PLANS, yes: true, dryRun: false, backupRoot: opts.backupRoot, actor: 'test', io: capture() })
    expect(rolled.code).toBe(0)
    expect(await setting('providers.realtime')).toBeUndefined()
    expect((await getRecord(db, done.switchId!))!.status).toBe('rolled_back')
    expect(rolled.record).toMatchObject({ kind: 'rollback', rollback_of: done.switchId, status: 'succeeded' })
    const twice = capture()
    expect((await runRollback({ db, dbUrl: sourceUrl, id: done.switchId!, plans: SWITCH_PLANS, yes: true, dryRun: false, backupRoot: opts.backupRoot, actor: 'test', io: twice })).code).toBe(2)
    expect(twice.errors.join('\n')).toMatch(/already rolled back/)
  })

  it('a failing step records the failure and leaves the provider setting alone; rollback undoes partial data', async () => {
    await db.query('CREATE TABLE IF NOT EXISTS public.ut_switch_marks (id text PRIMARY KEY)')
    let attempts = 0
    const flaky: AreaSwitch = {
      area: 'email',
      writesProviderSetting: true,
      supports: () => null,
      preflight: async () => [{ name: 'fake', severity: 'ok', detail: 'fine' }],
      steps: (ctx) => [
        { id: 'mark', title: 'Write a mark', run: async () => { await ctx.db.query(`INSERT INTO public.ut_switch_marks VALUES ('m') ON CONFLICT DO NOTHING`); return 'marked' } },
        { id: 'boom', title: 'Fail once', run: async () => { if (attempts++ === 0) throw new Error('target unreachable') } },
      ],
      rollback: async (ctx) => { await ctx.db.query('DELETE FROM public.ut_switch_marks'); return ['marks removed'] },
    }
    const first = capture()
    const failed = await runSwitch({ db, dbUrl: sourceUrl, area: 'email', plan: flaky, options: options('console'), io: first })
    expect(failed.code).toBe(1)
    expect(first.errors.join('\n')).toMatch(/target unreachable[\s\S]*re-run the same command/)
    expect(await setting('providers.email')).toBeUndefined()
    const record = await getRecord(db, failed.switchId!)
    expect(record!.status).toBe('failed')
    expect(record!.steps.map((s) => s.status)).toEqual(['done', 'failed', 'pending'])

    // Re-run: idempotent steps, then the setting.
    const second = await runSwitch({ db, dbUrl: sourceUrl, area: 'email', plan: flaky, options: options('console'), io: capture() })
    expect(second.code).toBe(0)
    expect(await setting('providers.email')).toBe('console')

    // Rolling back the failed run only undoes its data (it never wrote config).
    const undo = await runRollback({ db, dbUrl: sourceUrl, id: failed.switchId!, plans: { email: flaky }, yes: true, dryRun: false, backupRoot: '/nonexistent', actor: 'test', io: capture() })
    expect(undo.code).toBe(0)
    expect((await db.query('SELECT count(*)::int AS n FROM public.ut_switch_marks')).rows[0].n).toBe(0)
    expect(await setting('providers.email')).toBe('console')
    await runRollback({ db, dbUrl: sourceUrl, id: second.switchId!, plans: { email: flaky }, yes: true, dryRun: false, backupRoot: '/nonexistent', actor: 'test', io: capture() })
    expect(await setting('providers.email')).toBeUndefined()
  })

  it('env-managed areas get environment changes instead of a setting', async () => {
    process.env.EMAIL_PROVIDER = 'resend'
    const out = capture()
    const result = await runSwitch({ db, dbUrl: sourceUrl, area: 'email', plan: SWITCH_PLANS.email, options: options('console'), io: out })
    expect(result.code).toBe(0)
    expect(await setting('providers.email')).toBeUndefined()
    expect(result.record!.env_changes).toEqual({ EMAIL_PROVIDER: 'console' })
    expect(out.text()).toMatch(/EMAIL_PROVIDER=console/)
    const back = capture()
    await runRollback({ db, dbUrl: sourceUrl, id: result.switchId!, plans: SWITCH_PLANS, yes: true, dryRun: false, backupRoot: '/nonexistent', actor: 'test', io: back })
    expect(back.text()).toMatch(/EMAIL_PROVIDER=resend/)
  })

  it('pre-flight errors refuse the switch (auth to OIDC without an IdP; unknown provider)', async () => {
    const out = capture()
    expect((await runSwitch({ db, dbUrl: sourceUrl, area: 'auth', plan: SWITCH_PLANS.auth, options: options('oidc'), io: out })).code).toBe(2)
    expect(out.text()).toMatch(/no OIDC identity provider is configured/)
    expect(await setting('providers.auth')).toBeUndefined()
    const unknown = capture()
    expect((await runSwitch({ db, dbUrl: sourceUrl, area: 'storage', plan: SWITCH_PLANS.storage, options: options('floppy'), io: unknown })).code).toBe(2)
  })

  it('cache: memory → postgres after a probe round trip (and a config invalidation), refused for an unreachable redis, rolled back', async () => {
    const out = capture()
    const result = await runSwitch({ db, dbUrl: sourceUrl, area: 'cache', plan: SWITCH_PLANS.cache, options: options('postgres'), io: out })
    expect(result.code).toBe(0)
    expect(out.text()).toMatch(/rate-limit window counted across calls/)
    expect(await setting('providers.cache')).toBe('postgres')
    // Running apps are told through the new store's config generation.
    const { rows } = await db.query(`SELECT value FROM app_cache.entries WHERE key LIKE '%gen:config'`)
    expect(Number(rows[0]?.value)).toBeGreaterThanOrEqual(1)

    const unreachable = capture()
    const refused = await runSwitch({ db, dbUrl: sourceUrl, area: 'cache', plan: SWITCH_PLANS.cache, options: options('redis', { set: { redis_url: 'redis://127.0.0.1:9', redis_command_timeout_ms: '500' } }), io: unreachable })
    expect(refused.code).toBe(2)
    expect(unreachable.text()).toMatch(/127\.0\.0\.1:9/)
    expect(await setting('providers.cache')).toBe('postgres')

    const back = await runRollback({ db, dbUrl: sourceUrl, id: result.switchId!, plans: SWITCH_PLANS, yes: true, dryRun: false, backupRoot: '/nonexistent', actor: 'test', io: capture() })
    expect(back.code).toBe(0)
    expect(await setting('providers.cache')).toBeUndefined()
  })

  it('scheduler: pg_cron → worker without pg_cron installed, and back via rollback', async () => {
    const result = await runSwitch({ db, dbUrl: sourceUrl, area: 'scheduler', plan: SWITCH_PLANS.scheduler, options: options('worker'), io: capture() })
    expect(result.code).toBe(0)
    expect(await setting('providers.scheduler')).toBe('worker')
    expect(result.record!.steps.find((s) => s.id === 'uninstall-pg-cron')!.detail).toMatch(/none were scheduled/)
    const back = await runRollback({ db, dbUrl: sourceUrl, id: result.switchId!, plans: SWITCH_PLANS, yes: true, dryRun: false, backupRoot: '/nonexistent', actor: 'test', io: capture() })
    expect(back.code).toBe(0)
    expect(await setting('providers.scheduler')).toBeUndefined()
  })

  it('database: copies into a fresh PostgreSQL, verifies counts and RLS, records in both, prints the env', async () => {
    const tenant = randomUUID()
    const user = randomUUID()
    await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Switch A', $2)`, [tenant, `switch-${tenant.slice(0, 8)}`])
    await db.query(`INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`, [user, `${user}@switch.test`])
    await db.query(`UPDATE public.users SET tenant_id = $2, current_tenant_id = $2 WHERE id = $1`, [user, tenant])
    await db.query(`INSERT INTO public.notifications (user_id, tenant_id, type, title) VALUES ($1, $2, 'task_assigned', 'n1'), ($1, $2, 'task_assigned', 'n2')`, [user, tenant])

    // A plain-Postgres install moving servers: no Supabase-only provider left.
    Object.assign(process.env, { DB_PROVIDER: 'postgres', AUTH_PROVIDER: 'builtin', REALTIME_PROVIDER: 'sse', SCHEDULER_PROVIDER: 'worker', STORAGE_PROVIDER: 'local' })
    const targetUrl = await scratchDb(false)
    const opts = options('postgres', { flags: { 'target-url': targetUrl, dir: REPO_MIGRATIONS }, noDump: false })
    const out = capture()
    const result = await runSwitch({ db, dbUrl: sourceUrl, area: 'db', plan: SWITCH_PLANS.db, options: opts, io: out })
    expect(result.code, out.text()).toBe(0)
    const steps = Object.fromEntries(result.record!.steps.map((s) => [s.id, s]))
    expect(steps['migrate-target'].detail).toMatch(/applied \d+ migration/)
    expect(steps['verify-counts'].detail).toMatch(/table\(s\) match/)
    expect(steps['rls-smoke'].detail).toMatch(/identical/)
    expect(result.record!.env_changes).toMatchObject({ DB_PROVIDER: 'postgres' })
    expect(out.text()).toMatch(/DB_PROVIDER=postgres/)
    // pg_dump of the source when the local pg_dump can talk to the server (else a warning).
    const dump = path.join(opts.backupRoot, result.switchId!, 'database.dump')
    if (!out.errors.some((l) => /pg_dump backup skipped/.test(l))) expect(existsSync(dump)).toBe(true)

    const target = await connect(targetUrl)
    const counts = await target.query(`SELECT (SELECT count(*)::int FROM public.notifications WHERE tenant_id = $1) AS n, (SELECT count(*)::int FROM public.users WHERE id = $2) AS u`, [tenant, user])
    expect(counts.rows[0]).toEqual({ n: 2, u: 1 })
    expect((await getRecord(target, result.switchId!))!.status).toBe('succeeded')
    // Sequences moved on: a new row in the target doesn't collide.
    await target.query(`INSERT INTO public.notifications (user_id, tenant_id, type, title) VALUES ($1, $2, 'task_assigned', 'n3')`, [user, tenant])

    // Re-running replaces the target's rows (idempotent), still verifying.
    const rerun = await runSwitch({ db, dbUrl: sourceUrl, area: 'db', plan: SWITCH_PLANS.db, options: { ...opts, noDump: true }, io: capture() })
    expect(rerun.code).toBe(0)
    expect((await target.query(`SELECT count(*)::int AS n FROM public.notifications WHERE tenant_id = $1`, [tenant])).rows[0].n).toBe(2)

    const back = capture()
    expect((await runRollback({ db, dbUrl: sourceUrl, id: result.switchId!, plans: SWITCH_PLANS, yes: true, dryRun: false, backupRoot: opts.backupRoot, actor: 'test', io: back })).code).toBe(0)
    expect(back.text()).toMatch(/DB_PROVIDER=postgres/)
    expect(back.text()).toMatch(/not copied back/)
  }, 180_000)
})
