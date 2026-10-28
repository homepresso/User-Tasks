/**
 * Settings → Infrastructure provider changes against real, plain PostgreSQL
 * scratch databases (the repository migrations applied by the runner):
 *
 *  - the page's plan is the CLI's dry run, line for line;
 *  - a config-only switch applied from the page, then rolled back;
 *  - a provider settings change with a secret (stored encrypted, never sent
 *    back), then rolled back;
 *  - a background storage switch (queued, run by the runner) and its rollback;
 *  - a background switch resumed after its runner died, skipping done steps;
 *  - cancel (queued and between steps), refusal while a switch runs, and the
 *    cloud lock with `usertasks-admin ui-switching on`.
 *
 * Runs only with MIGRATION_TEST_ADMIN_URL (a role that may CREATE DATABASE on
 * a NON-Supabase server), like switch-db.test.ts.
 */
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { loadMigrations } from '../src/db/migrations'
import { migrate } from '../src/db/runner'
import { run } from '../src/cli'
import { readSettingRows, upsertSettingRow } from '../src/instance'
import { SWITCH_PLANS } from '../src/switch/plans'
import { getRecord, tryLockSwitches, unlockSwitches } from '../src/switch/log'
import { runSwitch } from '../src/switch/engine'
import { runQueuedSwitches } from '@/lib/admin/switch/jobs'
import { uiSwitchingGateFor } from '@/lib/admin/switch/gate'
import {
  applySwitchAs,
  cancelSwitchAs,
  loadWizardAs,
  previewSwitchAs,
  rollbackSwitchAs,
  saveProviderSettingsAs,
  switchRecordAs,
  type InfrastructureSwitchDeps,
} from '@/lib/admin/infrastructure-switching'
import type { AreaSwitch } from '../src/switch/types'

const ADMIN_URL = process.env.MIGRATION_TEST_ADMIN_URL
const REPO_MIGRATIONS = path.resolve(__dirname, '../../../supabase/migrations')
const ADMIN = { id: 'admin-user', email: 'ops@example.com' }
const SECRET = 'fake-resend-key-for-tests-only'

describe.skipIf(!ADMIN_URL)('Settings → Infrastructure switching (plain PostgreSQL)', { timeout: 60_000 }, () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL })
  const created: string[] = []
  const dirs: string[] = []
  const clients: pg.Client[] = []
  const envBackup = { ...process.env }
  let url: string
  let db: pg.Client
  let deps: InfrastructureSwitchDeps
  let backupRoot: string

  const tmp = (prefix: string) => { const dir = mkdtempSync(path.join(tmpdir(), prefix)); dirs.push(dir); return dir }
  async function connect(target: string): Promise<pg.Client> {
    const client = new pg.Client({ connectionString: target })
    client.on('error', () => undefined)
    await client.connect()
    clients.push(client)
    return client
  }
  const setting = async (key: string) => (await readSettingRows(db)).find((r) => r.key === key)
  const quiet = { log: () => undefined, warn: () => undefined }

  beforeAll(async () => {
    await admin.connect()
    const { rows } = await admin.query(`SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin'`)
    if (rows.length) throw new Error('MIGRATION_TEST_ADMIN_URL must point at plain PostgreSQL, not a Supabase stack')
    const name = `ut_infraui_${randomUUID().slice(0, 8)}`
    await admin.query(`CREATE DATABASE ${name}`)
    created.push(name)
    const u = new URL(ADMIN_URL!)
    u.pathname = `/${name}`
    url = u.toString()
    db = await connect(url)
    await migrate(db, loadMigrations(REPO_MIGRATIONS))
    for (const key of Object.keys(process.env)) if (/_PROVIDER$|^SMTP_|^EMAIL_|^STORAGE_|^RESEND_|^DEPLOYMENT_MODE$|^INFRA_UI_|^VERCEL$/.test(key)) delete process.env[key]
    process.env.ENCRYPTION_KEY = 'b'.repeat(64)
    process.env.REALTIME_DATABASE_URL = url
  }, 180_000)
  afterAll(async () => {
    process.env = envBackup
    for (const c of clients) await c.end().catch(() => undefined)
    for (const name of created) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => undefined)
    await admin.end()
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  })
  beforeEach(() => {
    backupRoot = tmp('ut-infraui-backups-')
    deps = {
      canView: async (user) => user?.email === ADMIN.email,
      withDb: (fn) => fn(db, url),
      rateLimit: async () => true,
      gate: (client) => uiSwitchingGateFor(client),
      runtime: () => ({ available: true, reason: null }),
      kick: () => undefined,
      plans: SWITCH_PLANS,
      backupRoot,
      invalidate: () => undefined,
      checkSecretRef: async () => ({ ok: false, detail: 'not used' }),
      env: {},
      log: () => undefined,
    }
  })

  const normalise = (lines: string[]) => lines.map((l) => l.replace(/^Backup: .*$/, 'Backup: <dir>'))

  it("the page's plan is the CLI dry run, line for line", async () => {
    for (const [area, to, values, args] of [
      ['realtime', 'sse', {}, []],
      ['email', 'console', { from: 'UserTasks <noreply@example.com>' }, ['--set', 'from=UserTasks <noreply@example.com>']],
    ] as const) {
      const ui = await previewSwitchAs(ADMIN, { area, to, values }, 'plan', deps)
      expect(ui.ok).toBe(true)
      if (!ui.ok) return
      const out: string[] = []
      const code = await run(['switch', area, '--to', to, '--dry-run', '--db-url', url, '--backup-dir', backupRoot, ...args], { out: (l) => out.push(l), err: (l) => out.push(l), env: process.env })
      expect(code).toBe(0)
      expect(normalise(ui.lines)).toEqual(normalise(out))
      expect(ui.plan?.steps.at(-1)).toMatchObject({ id: 'config', title: 'Apply config' })
    }
    expect(await setting('providers.realtime')).toBeUndefined()
  })

  it('a config-only switch applied from the page and rolled back from the page', async () => {
    const res = await applySwitchAs(ADMIN, { area: 'realtime', to: 'sse', values: {} }, deps)
    expect(res).toMatchObject({ ok: true, mode: 'direct', record: { status: 'succeeded', kind: 'switch', toProvider: 'sse' } })
    expect((await setting('providers.realtime'))?.value).toBe('sse')
    if (!res.ok || !res.record) return
    const stored = await getRecord(db, res.record.id)
    expect(stored).toMatchObject({ actor: 'ops@example.com (Settings → Infrastructure)', status: 'succeeded' })
    expect(stored!.log!.join('\n')).toMatch(/Switched realtime to sse/)
    const back = await rollbackSwitchAs(ADMIN, { id: res.record.id, confirm: 'rollback' }, deps)
    expect(back).toMatchObject({ ok: true, done: true })
    expect(await setting('providers.realtime')).toBeUndefined()
    expect((await getRecord(db, res.record.id))!.status).toBe('rolled_back')
    // A tenant owner can't roll it back (or anything else).
    expect(await rollbackSwitchAs({ id: 'owner', email: 'owner@customer.com' }, { id: res.record.id, confirm: 'rollback' }, deps)).toMatchObject({ ok: false })
  })

  it('a settings change with a secret: stored encrypted, never sent back, recorded and rolled back', async () => {
    const test = await saveProviderSettingsAs(ADMIN, { area: 'email', values: { from: 'Ops <ops@example.com>', resend_api_key: SECRET }, dryRun: true }, deps)
    expect(test).toMatchObject({ ok: true, saved: false })
    expect(await setting('email.from')).toBeUndefined()
    const res = await saveProviderSettingsAs(ADMIN, { area: 'email', values: { from: 'Ops <ops@example.com>', resend_api_key: SECRET } }, deps)
    expect(res).toMatchObject({ ok: true, saved: true, record: { kind: 'settings', status: 'succeeded' } })
    const key = await setting('email.resend_api_key')
    expect(key?.secret).toBe(true)
    expect(String(key?.value)).not.toContain(SECRET)
    expect((await setting('email.from'))?.value).toBe('Ops <ops@example.com>')
    expect(JSON.stringify(res)).not.toContain(SECRET)
    const wizard = await loadWizardAs(ADMIN, 'email', deps)
    expect(wizard.ok).toBe(true)
    expect(JSON.stringify(wizard)).not.toContain(SECRET)
    if (!wizard.ok || !res.ok || !res.record) return
    expect(wizard.wizard.fields.resend.find((f) => f.option === 'resend_api_key')).toMatchObject({ configured: true, value: null })
    expect(res.record.changes).toEqual(expect.arrayContaining([{ key: 'email.resend_api_key', before: null, after: '(encrypted)', secret: true }]))
    const back = await rollbackSwitchAs(ADMIN, { id: res.record.id, confirm: 'rollback' }, deps)
    expect(back).toMatchObject({ ok: true, done: true })
    expect(await setting('email.from')).toBeUndefined()
    expect(await setting('email.resend_api_key')).toBeUndefined()
  })

  it('a storage switch is queued, run by the background runner with progress, and rolled back', async () => {
    const before = tmp('ut-infraui-files-a-')
    const after = tmp('ut-infraui-files-b-')
    await upsertSettingRow(db, { key: 'providers.storage', value: 'local', secret: false })
    await upsertSettingRow(db, { key: 'storage.local_root', value: before, secret: false })
    const { resolveStorageProvider } = await import('@/lib/providers/storage')
    await resolveStorageProvider('local', { local_root: before }).put('logos', 'acme/logo.txt', new TextEncoder().encode('logo'), { contentType: 'text/plain', upsert: true })

    const input = { area: 'storage', to: 'local', values: { local_root: after } }
    expect(await applySwitchAs(ADMIN, input, deps)).toMatchObject({ ok: false, error: expect.stringMatching(/Type local to confirm/) })
    const res = await applySwitchAs(ADMIN, { ...input, confirm: 'local' }, deps)
    expect(res).toMatchObject({ ok: true, mode: 'background', record: { status: 'queued' } })
    if (!res.ok || !res.record) return
    // Nothing runs in the request: the setting is unchanged until the runner has run.
    expect((await setting('storage.local_root'))?.value).toBe(before)
    // A second switch can't be queued meanwhile.
    expect(await applySwitchAs(ADMIN, { area: 'realtime', to: 'sse', values: {} }, deps)).toMatchObject({ ok: false, error: expect.stringMatching(/queued or running/) })

    const runner = await connect(url)
    const ran = await runQueuedSwitches(runner, { dbUrl: url, plans: SWITCH_PLANS, backupRoot, io: quiet })
    expect(ran.map((r) => r.result.code)).toEqual([0])
    const view = await switchRecordAs(ADMIN, res.record.id, deps)
    expect(view).toMatchObject({ ok: true, record: { status: 'succeeded', percent: 100, background: true } })
    if (!view.ok) return
    expect(view.record.steps.map((s) => [s.id, s.status])).toEqual([['copy', 'done'], ['rewrite', 'done'], ['verify', 'done'], ['config', 'done']])
    expect(view.record.log.join('\n')).toMatch(/Started by the background runner/)
    expect((await setting('storage.local_root'))?.value).toBe(after)
    expect(await resolveStorageProvider('local', { local_root: after }).head('logos', 'acme/logo.txt')).not.toBeNull()
    // The job's options are kept without the encrypted secret values once it succeeded.
    const { rows } = await db.query(`SELECT job FROM public.instance_provider_switches WHERE id = $1`, [res.record.id])
    expect(rows[0].job).not.toHaveProperty('secret')

    const back = await rollbackSwitchAs(ADMIN, { id: res.record.id, confirm: 'rollback' }, deps)
    expect(back).toMatchObject({ ok: true, done: true })
    expect((await setting('storage.local_root'))?.value).toBe(before)
    await db.query(`DELETE FROM public.instance_settings WHERE key IN ('providers.storage', 'storage.local_root')`)
  })

  it('a background switch whose runner died is resumed: done steps are skipped', async () => {
    const runs: Record<string, number> = { one: 0, two: 0 }
    let hang = true
    const plan: AreaSwitch = {
      area: 'email', writesProviderSetting: true, supports: () => null,
      preflight: async () => [{ name: 'fake', severity: 'ok', detail: 'ok' }],
      steps: () => [
        { id: 'one', title: 'Step one', run: async () => { runs.one++; return 'one done' } },
        { id: 'two', title: 'Step two', run: async () => { runs.two++; if (hang) await new Promise(() => undefined); return 'two done' } },
      ],
    }
    // email is config-only (it runs in the request from the page); queue a background run of this plan directly.
    const { enqueueSwitch } = await import('@/lib/admin/switch/jobs')
    const queued = await enqueueSwitch(db, { area: 'email', to: 'console', set: {}, secret: { resend_api_key: SECRET }, actor: 'test' })
    const { rows: stored } = await db.query(`SELECT job FROM public.instance_provider_switches WHERE id = $1`, [queued.id])
    expect(JSON.stringify(stored[0].job)).not.toContain(SECRET)

    const doomed = await connect(url)
    void runQueuedSwitches(doomed, { dbUrl: url, plans: { email: plan }, backupRoot, io: quiet })
    for (let i = 0; i < 100 && runs.two === 0; i++) await new Promise((r) => setTimeout(r, 50))
    expect(runs).toEqual({ one: 1, two: 1 })
    // While it "runs" the lock is held: nothing else may start.
    expect(await applySwitchAs(ADMIN, { area: 'realtime', to: 'sse', values: {} }, deps)).toMatchObject({ ok: false, error: expect.stringMatching(/queued or running/) })
    await doomed.end() // the process dies: its session (and the switch lock) is gone

    const view = await switchRecordAs(ADMIN, queued.id, deps)
    expect(view).toMatchObject({ ok: true, record: { status: 'running', interrupted: true } })
    hang = false
    const runner = await connect(url)
    const ran = await runQueuedSwitches(runner, { dbUrl: url, plans: { email: plan }, backupRoot, io: quiet })
    expect(ran.map((r) => [r.id, r.result.code])).toEqual([[queued.id, 0]])
    expect(runs).toEqual({ one: 1, two: 2 })
    const done = await getRecord(db, queued.id)
    expect(done!.status).toBe('succeeded')
    expect(done!.log!.join('\n')).toMatch(/Resuming after an interruption[\s\S]*Step one… done earlier/)
    expect((await setting('providers.email'))?.value).toBe('console')
    expect((await setting('email.resend_api_key'))?.secret).toBe(true)
    await rollbackSwitchAs(ADMIN, { id: queued.id, confirm: 'rollback' }, deps)
    expect(await setting('providers.email')).toBeUndefined()
  })

  it('cancel: a queued switch at once; a running one before its next step, without changing the provider', async () => {
    const { enqueueSwitch } = await import('@/lib/admin/switch/jobs')
    const queued = await enqueueSwitch(db, { area: 'email', to: 'console', set: {}, secret: {}, actor: 'test' })
    expect(await cancelSwitchAs(ADMIN, queued.id, deps)).toMatchObject({ ok: true, outcome: 'cancelled' })
    expect((await getRecord(db, queued.id))!.status).toBe('cancelled')

    let id = ''
    const plan: AreaSwitch = {
      area: 'email', writesProviderSetting: true, supports: () => null,
      preflight: async () => [],
      steps: () => [
        { id: 'one', title: 'Step one', run: async () => { await cancelSwitchAs(ADMIN, id, deps); return 'asked to cancel' } },
        { id: 'two', title: 'Step two', run: async () => { throw new Error('must not run') } },
      ],
    }
    const second = await enqueueSwitch(db, { area: 'email', to: 'console', set: {}, secret: {}, actor: 'test' })
    id = second.id
    const runner = await connect(url)
    const ran = await runQueuedSwitches(runner, { dbUrl: url, plans: { email: plan }, backupRoot, io: quiet })
    expect(ran.map((r) => r.result.code)).toEqual([2])
    const record = await getRecord(db, id)
    expect(record!.status).toBe('cancelled')
    expect(record!.steps.map((s) => s.status)).toEqual(['done', 'skipped', 'skipped'])
    expect(await setting('providers.email')).toBeUndefined()
  })

  it('refuses while another switch runs (CLI and page), whoever holds the lock', async () => {
    const other = await connect(url)
    expect(await tryLockSwitches(other)).toBe(true)
    try {
      const out: string[] = []
      const cli = await runSwitch({ db, dbUrl: url, area: 'realtime', plan: SWITCH_PLANS.realtime, options: { to: 'sse', dryRun: false, yes: true, backupRoot, set: {}, secret: {}, flags: {}, noDump: true, actor: 'cli', force: false }, io: { log: (l) => out.push(l), warn: (l) => out.push(l) } })
      expect(cli.code).toBe(2)
      expect(out.join('\n')).toMatch(/Another provider switch or rollback is running/)
      expect(await applySwitchAs(ADMIN, { area: 'realtime', to: 'sse', values: {} }, deps)).toMatchObject({ ok: false, error: expect.stringMatching(/queued or running/) })
      expect(await saveProviderSettingsAs(ADMIN, { area: 'email', values: { from: 'a@example.com' } }, deps)).toMatchObject({ ok: false })
      expect(await runQueuedSwitches(db, { dbUrl: url, plans: SWITCH_PLANS, backupRoot, io: quiet })).toEqual([])
    } finally {
      await unlockSwitches(other)
    }
    expect(await setting('providers.realtime')).toBeUndefined()
  })

  it('cloud edition: locked until `usertasks-admin ui-switching on`', async () => {
    process.env.DEPLOYMENT_MODE = 'cloud'
    try {
      expect(await uiSwitchingGateFor(db)).toMatchObject({ enabled: false })
      expect(await applySwitchAs(ADMIN, { area: 'realtime', to: 'sse', values: {} }, deps)).toMatchObject({ ok: false, error: expect.stringMatching(/Cloud edition/) })
      const out: string[] = []
      const io = { out: (l: string) => out.push(l), err: (l: string) => out.push(l), env: { ...process.env } }
      expect(await run(['ui-switching', 'on', '--db-url', url], io)).toBe(0)
      expect((await setting('instance.allow_ui_switching'))?.value).toBe(true)
      expect(await uiSwitchingGateFor(db)).toMatchObject({ enabled: true })
      process.env.INFRA_UI_SWITCHING = 'false'
      expect(await uiSwitchingGateFor(db)).toMatchObject({ enabled: false })
      delete process.env.INFRA_UI_SWITCHING
      expect(await run(['ui-switching', 'off', '--db-url', url], io)).toBe(0)
      expect(await uiSwitchingGateFor(db)).toMatchObject({ enabled: false })
      expect(out.join('\n')).toMatch(/instance.allow_ui_switching = false/)
    } finally {
      delete process.env.DEPLOYMENT_MODE
    }
  })
})
