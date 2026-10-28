/**
 * The automated database switch (lib/admin/switch/database.ts + db-copy.ts)
 * against plain PostgreSQL scratch databases:
 *
 *  - a target role without privileges: the pre-flight refuses and prints
 *    the one-time DBA SQL; once a DBA ran exactly that SQL the switch runs
 *    end to end as that (non-superuser) role — owner mode: foreign keys
 *    dropped for the copy and re-created, rows and checksums verified;
 *  - a chunked run (deadline per call, one-row batches) that pauses many
 *    times and resumes per table until done, through the background runner;
 *  - --prepare-only: bootstrap + migrations, no data, no environment change.
 *
 * Runs only with MIGRATION_TEST_ADMIN_URL (a role that may CREATE DATABASE
 * and CREATE ROLE on a NON-Supabase server).
 */
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadMigrations } from '../src/db/migrations'
import { migrate } from '../src/db/runner'
import { runSwitch, type EngineIO } from '../src/switch/engine'
import { getRecord } from '../src/switch/log'
import { SWITCH_PLANS } from '../src/switch/plans'
import type { SwitchOptions } from '../src/switch/types'
import { enqueueSwitch, runQueuedSwitches } from '@/lib/admin/switch/jobs'

const ADMIN_URL = process.env.MIGRATION_TEST_ADMIN_URL
const REPO_MIGRATIONS = path.resolve(__dirname, '../../../supabase/migrations')
const ROLE_PASSWORD = 'fake-test-password-not-secret'

describe.skipIf(!ADMIN_URL)('automated database switch (plain PostgreSQL)', { timeout: 240_000 }, () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL })
  const created: string[] = []
  const roles: string[] = []
  const clients: pg.Client[] = []
  const dirs: string[] = []
  const envBackup = { ...process.env }
  let sourceUrl: string
  let db: pg.Client

  const urlFor = (name: string, user?: string, password?: string) => {
    const u = new URL(ADMIN_URL!)
    u.pathname = `/${name}`
    if (user) { u.username = user; u.password = password ?? '' }
    return u.toString()
  }
  async function scratchDb(): Promise<string> {
    const name = `ut_dbauto_${randomUUID().slice(0, 8)}`
    await admin.query(`CREATE DATABASE ${name}`)
    created.push(name)
    return name
  }
  async function connect(url: string): Promise<pg.Client> {
    const client = new pg.Client({ connectionString: url })
    client.on('error', () => undefined)
    await client.connect()
    clients.push(client)
    return client
  }
  function capture(): EngineIO & { lines: string[]; text: () => string } {
    const lines: string[] = []
    return { lines, log: (l) => lines.push(l), warn: (l) => lines.push(l), text: () => lines.join('\n') }
  }
  function options(flags: SwitchOptions['flags'], extra: Partial<SwitchOptions> = {}): SwitchOptions {
    const root = mkdtempSync(path.join(tmpdir(), 'ut-dbauto-'))
    dirs.push(root)
    return { to: 'postgres', dryRun: false, yes: true, backupRoot: root, set: {}, secret: {}, flags: { dir: REPO_MIGRATIONS, ...flags }, noDump: true, actor: 'test', force: false, ...extra }
  }

  beforeAll(async () => {
    await admin.connect()
    const { rows } = await admin.query(`SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin'`)
    if (rows.length) throw new Error('MIGRATION_TEST_ADMIN_URL must point at plain PostgreSQL, not a Supabase stack')
    const name = await scratchDb()
    sourceUrl = urlFor(name)
    db = await connect(sourceUrl)
    await migrate(db, loadMigrations(REPO_MIGRATIONS))
    // Some data across a few foreign keys.
    const tenant = randomUUID()
    const user = randomUUID()
    await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Auto A', $2)`, [tenant, `auto-${tenant.slice(0, 8)}`])
    await db.query(`INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`, [user, `${user}@auto.test`])
    await db.query(`UPDATE public.users SET tenant_id = $2, current_tenant_id = $2 WHERE id = $1`, [user, tenant])
    await db.query(`INSERT INTO public.notifications (user_id, tenant_id, type, title) SELECT $1, $2, 'task_assigned', 'n' || g FROM generate_series(1, 7) g`, [user, tenant])
    for (const key of Object.keys(process.env)) if (/_PROVIDER$|^DATABASE_AUTH$/.test(key)) delete process.env[key]
    process.env.ENCRYPTION_KEY = 'd'.repeat(64) // queued jobs encrypt the target URL
    Object.assign(process.env, { DB_PROVIDER: 'postgres', AUTH_PROVIDER: 'builtin', REALTIME_PROVIDER: 'sse', SCHEDULER_PROVIDER: 'worker', STORAGE_PROVIDER: 'local' })
  }, 240_000)
  afterAll(async () => {
    process.env = envBackup
    for (const c of clients) await c.end().catch(() => undefined)
    for (const name of created) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => undefined)
    for (const role of roles) {
      for (const name of created) await admin.query(`REVOKE ALL ON DATABASE ${name} FROM ${role}`).catch(() => undefined)
      await admin.query(`DROP OWNED BY ${role}`).catch(() => undefined)
      await admin.query(`DROP ROLE IF EXISTS ${role}`).catch(() => undefined)
    }
    await admin.end()
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  })

  it('a target role without privileges: refused with the DBA SQL; after running it, the switch runs end to end in owner mode', async () => {
    const role = `ut_dbauto_${randomUUID().slice(0, 6)}`
    roles.push(role)
    await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${ROLE_PASSWORD}' NOSUPERUSER NOCREATEROLE NOCREATEDB`)
    const name = await scratchDb()
    const host = new URL(ADMIN_URL!)
    const flags = { 'target-host': host.hostname, 'target-port': host.port || '5432', 'target-database': name, 'target-user': role, 'target-password': ROLE_PASSWORD }

    const refused = capture()
    const first = await runSwitch({ db, dbUrl: sourceUrl, area: 'db', plan: SWITCH_PLANS.db, options: options(flags, { dryRun: true }), io: refused })
    expect(first.code, refused.text()).toBe(2)
    expect(refused.text()).toMatch(/database owner: .* does not own/)
    expect(refused.text()).not.toContain(ROLE_PASSWORD)
    const dba = first.preflight.find((c) => c.name === 'dba sql')!
    expect(dba.detail).toContain(`ALTER DATABASE "${name}" OWNER TO "${role}";`)

    // The DBA runs exactly the printed SQL on the target database.
    const asAdmin = await connect(urlFor(name))
    for (const line of dba.detail.split('\n').filter((l) => /^(GRANT|CREATE|ALTER)\b/.test(l))) await asAdmin.query(line)

    const out = capture()
    const result = await runSwitch({ db, dbUrl: sourceUrl, area: 'db', plan: SWITCH_PLANS.db, options: options(flags), io: out })
    expect(result.code, out.text()).toBe(0)
    const steps = Object.fromEntries(result.record!.steps.map((s) => [s.id, s.detail]))
    expect(steps['copy-data']).toMatch(/owner mode/)
    expect(steps['constraints']).toMatch(/[1-9]\d* foreign key\(s\) re-created/)
    expect(steps['verify-counts']).toMatch(/match \(rows and checksums\)/)
    expect(result.record!.env_changes).toMatchObject({ DB_PROVIDER: 'postgres' })
    expect(JSON.stringify(result.record)).not.toContain(ROLE_PASSWORD)

    const target = await connect(urlFor(name, role, ROLE_PASSWORD))
    expect((await target.query(`SELECT count(*)::int AS n FROM public.notifications`)).rows[0].n).toBe(7)
    const fks = await target.query(`SELECT count(*)::int AS n FROM pg_constraint k JOIN pg_namespace n ON n.oid = k.connamespace WHERE k.contype = 'f' AND n.nspname = 'public'`)
    expect(fks.rows[0].n).toBeGreaterThan(10)
    const triggersOff = await target.query(`SELECT count(*)::int AS n FROM pg_trigger WHERE NOT tgisinternal AND tgenabled = 'D'`)
    expect(triggersOff.rows[0].n).toBe(0)
  })

  it('a chunked background run pauses at each deadline and resumes per table until it is done', async () => {
    const name = await scratchDb()
    const job = await enqueueSwitch(db, { area: 'db', to: 'postgres', set: {}, secret: {}, flags: { dir: REPO_MIGRATIONS, 'copy-batch': '1' }, secretFlags: { 'target-url': urlFor(name) }, noDump: true, actor: 'test' })
    const { rows: stored } = await db.query(`SELECT job FROM public.instance_provider_switches WHERE id = $1`, [job.id])
    expect(JSON.stringify(stored[0].job)).not.toContain(name) // the target URL travels encrypted
    const backupRoot = mkdtempSync(path.join(tmpdir(), 'ut-dbauto-chunks-'))
    dirs.push(backupRoot)
    const codes: number[] = []
    for (let i = 0; i < 400; i++) {
      const runner = await connect(sourceUrl)
      // A runner per chunk, like a serverless invocation; each gets ~nothing of a budget.
      const ran = await runQueuedSwitches(runner, { dbUrl: sourceUrl, plans: SWITCH_PLANS, backupRoot, deadline: Date.now() + 1, areas: ['db'], limit: 1, io: { log: () => undefined, warn: () => undefined } })
      await runner.end()
      if (!ran.length) break
      codes.push(ran[0].result.code)
      if (ran[0].result.code !== 3) break
      const paused = await getRecord(db, job.id)
      expect(paused!.status).toBe('queued')
    }
    expect(codes.filter((c) => c === 3).length).toBeGreaterThan(5)
    expect(codes.at(-1)).toBe(0)
    const done = await getRecord(db, job.id)
    expect(done!.status).toBe('succeeded')
    expect(done!.log!.join('\n')).toMatch(/Paused: time budget used/)
    const target = await connect(urlFor(name))
    expect((await target.query(`SELECT count(*)::int AS n FROM public.notifications`)).rows[0].n).toBe(7)
    const [a, b] = await Promise.all([
      db.query(`SELECT count(*)::int AS n FROM public.tenants`),
      target.query(`SELECT count(*)::int AS n FROM public.tenants`),
    ])
    expect(b.rows[0].n).toBe(a.rows[0].n)
  })

  it('--prepare-only: bootstrap and migrations, no data, no environment change', async () => {
    const name = await scratchDb()
    const out = capture()
    const result = await runSwitch({ db, dbUrl: sourceUrl, area: 'db', plan: SWITCH_PLANS.db, options: options({ 'target-url': urlFor(name), 'prepare-only': true }), io: out })
    expect(result.code, out.text()).toBe(0)
    expect(result.record!.steps.map((s) => s.id)).toEqual(['migrate-target', 'config'])
    expect(result.record!.env_changes).toEqual({})
    const target = await connect(urlFor(name))
    expect((await target.query(`SELECT count(*)::int AS n FROM supabase_migrations.schema_migrations`)).rows[0].n).toBe(loadMigrations(REPO_MIGRATIONS).length)
    expect((await target.query(`SELECT count(*)::int AS n FROM public.notifications`)).rows[0].n).toBe(0)
    expect(out.text()).toMatch(/The target is prepared/)
  })
})
