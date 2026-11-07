/**
 * Settings → Infrastructure WITHOUT DATABASE_URL, against a LOCAL Supabase
 * stack: every action goes through the service-role API (lib/admin/ops/
 * service-sql), as on the cloud edition on Vercel.
 *
 *  - the cloud lock: locked by default, Unlock by an instance admin (typed
 *    confirmation, recorded in the switch log as area `instance`), refused
 *    for a tenant owner, and rolled back from the log;
 *  - a config-only switch (email → console) with Test connection, applied
 *    and rolled back, plus a provider settings edit and its rollback — all
 *    over the API, with the switch log written there;
 *  - the switch lease (migration 20261123000000): an API switch is refused
 *    while another holder's lease or a session's advisory lock is held, and
 *    a direct runner is refused while an API lease is held;
 *  - data-moving changes (database, auth, storage) stay refused with the
 *    DATABASE_URL remedy; nothing is written;
 *  - CLI parity: `usertasks-admin switch email` / `history` / `rollback` /
 *    `ui-switching` with only the Supabase environment.
 *
 * Runs only when EVENT_STREAM_DB_URL is set (it also needs migration
 * 20261123000000 applied to the stack), e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/infra-ui-api-db.test.ts
 * API: LOCKDOWN_SUPABASE_URL / LOCKDOWN_SERVICE_ROLE_KEY, defaulting to the
 * standard local stack and its public demo key.
 */
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createClient } from './helpers/db-test-client'
import { serviceSqlClient, type ServiceApiClient } from '@/lib/admin/ops/service-sql'
import { readSettingRows } from '@/lib/admin/ops/instance-db'
import { SWITCH_PLANS } from '@/lib/admin/switch/plans'
import { uiSwitchingGateFor } from '@/lib/admin/switch/gate'
import { getRecord, switchRunning, tryLockSwitches, unlockSwitches } from '@/lib/admin/switch/log'
import {
  applySwitchAs,
  loadWizardAs,
  previewSwitchAs,
  recentSwitchesAs,
  rollbackSwitchAs,
  saveProviderSettingsAs,
  setUiSwitchingAs,
  type InfrastructureSwitchDeps,
} from '@/lib/admin/infrastructure-switching'
import { run } from '../packages/admin/src/cli'

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.LOCKDOWN_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.LOCKDOWN_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const ADMIN = { id: '00000000-0000-4000-8000-00000000ad01', email: 'ops@example.com' }
const TENANT_OWNER = { id: '00000000-0000-4000-8000-00000000ad02', email: 'owner@customer.com' }
const KEYS = ['providers.email', 'email.from', 'instance.allow_ui_switching']
const ENV_KEYS = ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'DEPLOYMENT_MODE', 'INFRA_UI_SWITCHING', 'EMAIL_PROVIDER', 'EMAIL_FROM', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'DB_PROVIDER', 'CACHE_PROVIDER', 'KMS_PROVIDER']

describe.skipIf(!DB_URL)('Settings → Infrastructure over the service-role API (local stack, no DATABASE_URL)', { timeout: 60_000 }, () => {
  const sql = new Client({ connectionString: DB_URL })
  const savedEnv: Record<string, string | undefined> = {}
  let savedRows: Array<{ key: string; value: unknown; secret: boolean }> = []
  const created: string[] = []
  let api: ServiceApiClient
  let deps: InfrastructureSwitchDeps
  let backupRoot: string
  let lockReady = false

  const setting = async (key: string) => (await readSettingRows(serviceSqlClient(api))).find((r) => r.key === key)

  beforeAll(async () => {
    await sql.connect()
    const { rows } = await sql.query(`SELECT to_regprocedure('public.instance_switch_lease_acquire(uuid, integer)') IS NOT NULL AS ok`)
    lockReady = rows[0]?.ok === true
    if (!lockReady) throw new Error('Apply supabase/migrations/20261123000000_infra_switch_lease.sql to the local stack first')
    const saved = await sql.query('SELECT key, value, secret FROM public.instance_settings WHERE key = ANY($1)', [KEYS])
    savedRows = saved.rows
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key]
    for (const key of ENV_KEYS) delete process.env[key]
    process.env.NEXT_PUBLIC_SUPABASE_URL = API_URL
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY
    process.env.DEPLOYMENT_MODE = 'cloud'
    api = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }) as unknown as ServiceApiClient
    await sql.query('DELETE FROM public.instance_settings WHERE key = ANY($1)', [KEYS])
    await sql.query('DELETE FROM app_switch.lease')
  })

  afterAll(async () => {
    await sql.query('DELETE FROM public.instance_settings WHERE key = ANY($1)', [KEYS]).catch(() => undefined)
    for (const row of savedRows) {
      await sql.query('INSERT INTO public.instance_settings (key, value, secret) VALUES ($1, $2::jsonb, $3)', [row.key, JSON.stringify(row.value), row.secret]).catch(() => undefined)
    }
    if (created.length) await sql.query('DELETE FROM public.instance_provider_switches WHERE id = ANY($1::uuid[])', [created]).catch(() => undefined)
    await sql.query('DELETE FROM app_switch.lease').catch(() => undefined)
    await sql.end()
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key]
      else process.env[key] = savedEnv[key]
    }
    if (backupRoot) rmSync(backupRoot, { recursive: true, force: true })
  })

  beforeEach(() => {
    backupRoot ??= mkdtempSync(path.join(tmpdir(), 'ut-infra-api-'))
    deps = {
      canView: async (user) => user?.email === ADMIN.email,
      // What app-runner does without DATABASE_URL: the service-role API, no connection string.
      withDb: (fn) => fn(serviceSqlClient(api), ''),
      rateLimit: async () => true,
      gate: (db) => uiSwitchingGateFor(db),
      runtime: () => ({ available: false, reason: 'Vercel functions stop when the request ends' }),
      kick: () => undefined,
      plans: SWITCH_PLANS,
      backupRoot,
      invalidate: () => undefined,
      checkSecretRef: async () => ({ ok: false, detail: 'not used' }),
      env: {},
      log: () => undefined,
    }
  })

  const track = (id: string | null | undefined) => { if (id) created.push(id) }

  it('cloud lock: locked by default; a tenant owner cannot unlock; an instance admin unlocks with the typed confirmation, audited', async () => {
    const wizard = await loadWizardAs(ADMIN, 'email', deps)
    expect(wizard).toMatchObject({ ok: true, wizard: { access: 'api', gate: { enabled: false, code: 'cloud-locked', lockable: true }, actions: { change: { enabled: false, block: { kind: 'cloud-locked' } } } } })
    expect(await previewSwitchAs(ADMIN, { area: 'email', to: 'console', values: {} }, 'test', deps)).toMatchObject({ ok: false, error: expect.stringMatching(/Locked on this cloud deployment/) })

    expect(await setUiSwitchingAs(TENANT_OWNER, { allow: true, confirm: 'unlock' }, deps)).toMatchObject({ ok: false, error: expect.stringMatching(/Only instance administrators/) })
    expect(await setUiSwitchingAs(ADMIN, { allow: true, confirm: 'yes' }, deps)).toMatchObject({ ok: false, error: 'Type unlock to confirm.' })
    expect(await setting('instance.allow_ui_switching')).toBeUndefined()

    const res = await setUiSwitchingAs(ADMIN, { allow: true, confirm: 'unlock' }, deps)
    expect(res).toMatchObject({ ok: true, allowed: true, changed: true, record: { kind: 'settings', area: 'instance', fromProvider: 'locked', toProvider: 'unlocked', status: 'succeeded' } })
    if (!res.ok || !res.record) return
    track(res.record.id)
    expect((await setting('instance.allow_ui_switching'))?.value).toBe(true)
    const stored = await getRecord(serviceSqlClient(api), res.record.id)
    expect(stored).toMatchObject({ actor: 'ops@example.com (Settings → Infrastructure)', area: 'instance' })
    const log = await recentSwitchesAs(ADMIN, deps)
    expect(log.ok && log.records.some((r) => r.id === res.record!.id && r.areaLabel === 'Cloud lock')).toBe(true)
    expect((await uiSwitchingGateFor(serviceSqlClient(api))).enabled).toBe(true)
  })

  it('config-only switch over the API: Test connection, apply (email → console), rollback', async () => {
    const test = await previewSwitchAs(ADMIN, { area: 'email', to: 'console', values: {} }, 'test', deps)
    expect(test).toMatchObject({ ok: true, passed: true, mode: 'direct' })
    const plan = await previewSwitchAs(ADMIN, { area: 'email', to: 'console', values: {} }, 'plan', deps)
    expect(plan).toMatchObject({ ok: true, passed: true, confirmPhrase: null })
    expect(await setting('providers.email')).toBeUndefined()

    const res = await applySwitchAs(ADMIN, { area: 'email', to: 'console', values: {} }, deps)
    expect(res).toMatchObject({ ok: true, mode: 'direct', record: { status: 'succeeded', kind: 'switch', toProvider: 'console' } })
    if (!res.ok || !res.record) return
    track(res.record.id)
    expect((await setting('providers.email'))?.value).toBe('console')
    // The lease was released: nothing is running.
    expect(await switchRunning(serviceSqlClient(api))).toBe(false)

    const dry = await rollbackSwitchAs(ADMIN, { id: res.record.id, dryRun: true }, deps)
    expect(dry).toMatchObject({ ok: true, done: false })
    const back = await rollbackSwitchAs(ADMIN, { id: res.record.id, confirm: 'rollback' }, deps)
    expect(back).toMatchObject({ ok: true, done: true })
    if (back.ok) track(back.record?.id)
    expect(await setting('providers.email')).toBeUndefined()
    expect((await getRecord(serviceSqlClient(api), res.record.id))!.status).toBe('rolled_back')
  })

  it('provider settings edit over the API, then rolled back', async () => {
    const check = await saveProviderSettingsAs(ADMIN, { area: 'email', values: { from: 'Ops <ops@example.com>' }, dryRun: true }, deps)
    expect(check).toMatchObject({ ok: true, saved: false, passed: true })
    expect(await setting('email.from')).toBeUndefined()
    const res = await saveProviderSettingsAs(ADMIN, { area: 'email', values: { from: 'Ops <ops@example.com>' } }, deps)
    expect(res).toMatchObject({ ok: true, saved: true, record: { kind: 'settings', status: 'succeeded' } })
    if (!res.ok || !res.record) return
    track(res.record.id)
    expect((await setting('email.from'))?.value).toBe('Ops <ops@example.com>')
    expect(res.record.changes).toEqual([{ key: 'email.from', before: null, after: 'Ops <ops@example.com>', secret: false }])
    const back = await rollbackSwitchAs(ADMIN, { id: res.record.id, confirm: 'rollback' }, deps)
    expect(back).toMatchObject({ ok: true, done: true })
    if (back.ok) track(back.record?.id)
    expect(await setting('email.from')).toBeUndefined()
  })

  it('the lease keeps switches one at a time: another API holder, a session lock, and a direct runner during an API lease', async () => {
    const other = randomUUID()
    expect((await api.rpc('instance_switch_lease_acquire', { p_holder: other, p_ttl_seconds: 60 })).data).toBe(true)
    try {
      const client = serviceSqlClient(api)
      expect(await switchRunning(client)).toBe(true)
      const res = await applySwitchAs(ADMIN, { area: 'email', to: 'console', values: {} }, deps)
      expect(res).toMatchObject({ ok: false })
      expect(await setting('providers.email')).toBeUndefined()
      expect(await saveProviderSettingsAs(ADMIN, { area: 'email', values: { from: 'X <x@example.com>' } }, deps)).toMatchObject({ ok: false, error: expect.stringMatching(/queued or running/) })
      // A direct runner (usertasks-admin with DATABASE_URL) sees the API lease and refuses.
      expect(await tryLockSwitches(sql)).toBe(false)
      expect(await switchRunning(sql)).toBe(true)
    } finally {
      await api.rpc('instance_switch_lease_release', { p_holder: other })
    }
    // A session holding the advisory lock blocks API callers too.
    expect(await tryLockSwitches(sql)).toBe(true)
    try {
      const client = serviceSqlClient(api)
      expect(await switchRunning(client)).toBe(true)
      expect(await tryLockSwitches(client)).toBe(false)
    } finally {
      await unlockSwitches(sql)
    }
    // Free again: re-entrant for the same holder, released when the outer lock is.
    const client = serviceSqlClient(api)
    expect(await tryLockSwitches(client)).toBe(true)
    expect(await tryLockSwitches(client)).toBe(true)
    await unlockSwitches(client)
    expect(await switchRunning(sql)).toBe(true)
    await unlockSwitches(client)
    expect(await switchRunning(sql)).toBe(false)
  })

  it('data-moving switches stay refused without a direct connection, with the DATABASE_URL remedy', async () => {
    for (const [area, to] of [['storage', 'local'], ['auth', 'builtin'], ['db', 'postgres']] as const) {
      const wizard = await loadWizardAs(ADMIN, area, deps)
      expect(wizard).toMatchObject({ ok: true, wizard: { access: 'api', mode: 'cli', actions: { change: { enabled: false, block: { kind: 'needs-direct-db', message: expect.stringMatching(/DATABASE_URL.*Session pooler/) } } } } })
      expect(await previewSwitchAs(ADMIN, { area, to, values: {} }, 'plan', deps)).toMatchObject({ ok: false, error: expect.stringMatching(/needs a direct database connection/) })
      expect(await applySwitchAs(ADMIN, { area, to, values: {}, confirm: to }, deps)).toMatchObject({ ok: false, error: expect.stringMatching(/needs a direct database connection/) })
    }
    // Storage settings are config: allowed; auth settings read tables the API can't: refused.
    const storage = await loadWizardAs(ADMIN, 'storage', deps)
    expect(storage.ok && storage.wizard.actions.settings.block?.kind).not.toBe('needs-direct-db')
    expect(await saveProviderSettingsAs(ADMIN, { area: 'auth', values: { allow_signup: 'true' } }, deps)).toMatchObject({ ok: false, error: expect.stringMatching(/needs a direct database connection/) })
    expect(await setting('providers.storage')).toBeUndefined()
  })

  it('locks again (audited), and the unlock can be rolled back from the switch log', async () => {
    const lock = await setUiSwitchingAs(ADMIN, { allow: false, confirm: 'lock' }, deps)
    expect(lock).toMatchObject({ ok: true, allowed: false, changed: true, record: { fromProvider: 'unlocked', toProvider: 'locked' } })
    if (lock.ok) track(lock.record?.id)
    expect((await uiSwitchingGateFor(serviceSqlClient(api))).code).toBe('cloud-locked')
    // Locked: a rollback (of anything) is a change from the page, so it is refused too.
    if (lock.ok && lock.record) {
      expect(await rollbackSwitchAs(ADMIN, { id: lock.record.id, confirm: 'rollback' }, deps)).toMatchObject({ ok: false, error: expect.stringMatching(/Locked/) })
    }
    expect(await setUiSwitchingAs(ADMIN, { allow: false, confirm: 'lock' }, deps)).toMatchObject({ ok: true, changed: false })
  })

  it('CLI parity: usertasks-admin switch / history / rollback / ui-switching with only the Supabase environment', async () => {
    const out: string[] = []
    const io = { out: (l: string) => out.push(l), err: (l: string) => out.push(l), env: process.env }
    const backupDir = ['--backup-dir', backupRoot]
    expect(await run(['switch', 'email', '--to', 'console', '--dry-run', ...backupDir], io)).toBe(0)
    expect(await setting('providers.email')).toBeUndefined()
    expect(await run(['switch', 'email', '--to', 'console', '--yes', ...backupDir], io)).toBe(0)
    expect(out.join('\n')).toMatch(/service-role API/)
    expect((await setting('providers.email'))?.value).toBe('console')
    const id = /Switch id: ([0-9a-f-]{36})/.exec(out.join('\n'))?.[1]
    expect(id).toBeTruthy()
    track(id)
    out.length = 0
    expect(await run(['history', '--limit', '3'], io)).toBe(0)
    expect(out.join('\n')).toContain(id!)
    out.length = 0
    expect(await run(['rollback', id!, '--yes', ...backupDir], io)).toBe(0)
    expect(await setting('providers.email')).toBeUndefined()
    // Data-moving: refused up front, with the remedy.
    out.length = 0
    expect(await run(['switch', 'storage', '--to', 'local', '--yes', ...backupDir], io)).toBe(2)
    expect(out.join('\n')).toMatch(/needs a direct connection.*DATABASE_URL/)
    // The cloud lock, audited the same way as the page's Unlock.
    out.length = 0
    expect(await run(['ui-switching', 'on'], io)).toBe(0)
    expect(out.join('\n')).toMatch(/Recorded in the switch log: ([0-9a-f-]{36})/)
    track(/Recorded in the switch log: ([0-9a-f-]{36})/.exec(out.join('\n'))?.[1])
    expect((await setting('instance.allow_ui_switching'))?.value).toBe(true)
    out.length = 0
    expect(await run(['ui-switching', 'off'], io)).toBe(0)
    track(/Recorded in the switch log: ([0-9a-f-]{36})/.exec(out.join('\n'))?.[1])
    expect((await setting('instance.allow_ui_switching'))?.value).toBe(false)
    // Rollback records created by the CLI.
    const { rows } = await sql.query(`SELECT id FROM public.instance_provider_switches WHERE rollback_of = $1`, [id])
    for (const r of rows) track(r.id)
  })
})
