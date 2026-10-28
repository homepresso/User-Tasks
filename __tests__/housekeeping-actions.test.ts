import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setAuthDbForTests, type AuthDb } from '@/lib/providers/auth/builtin/db'
import { invalidateInstanceSettingsCache } from '@/lib/config/instance-settings'
import { HOUSEKEEPING_DEFAULTS } from '@/lib/config/housekeeping'
import { runHousekeepingAs, saveHousekeepingSettingsAs, type HousekeepingActionDeps } from '@/lib/admin/housekeeping-actions'
import type { HousekeepingClient, HousekeepingRunOptions, HousekeepingStatus } from '@/lib/admin/housekeeping'

/**
 * Settings → Infrastructure → Housekeeping actions: instance admins only,
 * with the page's own check (verified email on the instance admin list). A
 * workspace owner — every workspace permission, not on the list — is refused
 * and nothing is written or run. The built-in auth store is faked as in
 * admin-infrastructure-access.test.ts.
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

function fakeClient() {
  const settings = { ...HOUSEKEEPING_DEFAULTS }
  const runs: HousekeepingRunOptions[] = []
  const status = (): HousekeepingStatus => ({ settings: { ...settings }, stored: [], tables: [], runs: [], pg_cron_jobs: null, checked_at: new Date().toISOString() })
  const client: HousekeepingClient = {
    status: async () => status(),
    run: async (options) => {
      runs.push(options)
      return { status: 'ok', dry_run: options.dryRun, deleted: { 'cron.job_run_details': 7 }, notes: {}, more: false }
    },
  }
  return { client, settings, runs }
}

describe('housekeeping actions: instance admins only', () => {
  const saved: Record<string, string | undefined> = {}
  const keys = ['AUTH_PROVIDER', 'INSTANCE_ADMIN_EMAILS', 'DB_PROVIDER', 'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'DATABASE_URL']
  let fake: ReturnType<typeof fakeClient>
  let writes: Array<[string, unknown, string]>
  let deps: HousekeepingActionDeps

  beforeAll(() => {
    for (const key of keys) saved[key] = process.env[key]
    for (const key of keys) delete process.env[key]
    process.env.AUTH_PROVIDER = 'builtin'
    process.env.INSTANCE_ADMIN_EMAILS = 'ops@example.com'
    invalidateInstanceSettingsCache()
    setAuthDbForTests(fakeAuth)
    credentials.set(ADMIN.id, { email: ADMIN.email, email_confirmed_at: new Date() })
    credentials.set(UNVERIFIED_ADMIN.id, { email: UNVERIFIED_ADMIN.email, email_confirmed_at: null })
    credentials.set(TENANT_OWNER.id, { email: TENANT_OWNER.email, email_confirmed_at: new Date() })
  })
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
    fake = fakeClient()
    writes = []
    deps = {
      canView: viewerCanSeeInfrastructure,
      client: () => fake.client,
      writeSetting: async (key, value, updatedBy) => { writes.push([key, value, updatedBy]) },
      log: () => undefined,
    }
  })

  it('an instance admin saves only the changed settings, recorded with their id', async () => {
    const res = await saveHousekeepingSettingsAs(ADMIN, { enabled: true, interval_minutes: '30', cron_history_hours: '2d', http_response_minutes: 60 }, deps)
    expect(res.ok).toBe(true)
    expect(writes).toEqual([
      ['housekeeping.interval_minutes', 30, ADMIN.id],
      ['housekeeping.cron_history_hours', 48, ADMIN.id],
    ])
  })

  it('out-of-range values are refused per field and nothing is written', async () => {
    const res = await saveHousekeepingSettingsAs(ADMIN, { cron_history_hours: '0', http_response_minutes: '30d', interval_minutes: 7 }, deps)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(Object.keys(res.fieldErrors ?? {}).sort()).toEqual(['cron_history_hours', 'http_response_minutes', 'interval_minutes'])
    expect(writes).toEqual([])
    const unknown = await saveHousekeepingSettingsAs(ADMIN, { batch_size: 1 } as never, deps)
    expect(unknown).toMatchObject({ ok: false, error: expect.stringMatching(/batch_size/) })
  })

  it('an instance admin runs a pass (forced, attributed) or a dry run', async () => {
    const res = await runHousekeepingAs(ADMIN, {}, deps)
    expect(res).toMatchObject({ ok: true, result: { status: 'ok', deleted: { 'cron.job_run_details': 7 } } })
    await runHousekeepingAs(ADMIN, { dryRun: true }, deps)
    expect(fake.runs).toEqual([
      expect.objectContaining({ trigger: 'ui', force: true, dryRun: false, actor: ADMIN.email }),
      expect.objectContaining({ trigger: 'ui', force: true, dryRun: true }),
    ])
  })

  it('a workspace owner who is not an instance admin is refused: nothing written, nothing run', async () => {
    expect(await saveHousekeepingSettingsAs(TENANT_OWNER, { cron_history_hours: 48 }, deps)).toMatchObject({ ok: false, error: expect.stringMatching(/instance administrators/) })
    expect(await runHousekeepingAs(TENANT_OWNER, {}, deps)).toMatchObject({ ok: false })
    expect(writes).toEqual([])
    expect(fake.runs).toEqual([])
  })

  it('an unverified address on the list, or no session, is refused too', async () => {
    expect((await saveHousekeepingSettingsAs(UNVERIFIED_ADMIN, { cron_history_hours: 48 }, deps)).ok).toBe(false)
    expect((await runHousekeepingAs(null, {}, deps)).ok).toBe(false)
    expect(writes).toEqual([])
    expect(fake.runs).toEqual([])
  })
})

describe('housekeeping server actions', () => {
  it('use the session user and the infrastructure check', async () => {
    vi.resetModules()
    const session = { user: { id: TENANT_OWNER.id, email: TENANT_OWNER.email } as { id: string; email: string } | null }
    const setInstanceSetting = vi.fn()
    const rpc = vi.fn()
    vi.doMock('@/lib/providers/db/session', () => ({ getSessionDbWithUser: async () => ({ supabase: {}, user: session.user }) }))
    vi.doMock('@/lib/admin/infrastructure', () => ({ viewerCanSeeInfrastructure: async (user: { email?: string } | null) => user?.email === ADMIN.email }))
    vi.doMock('@/lib/providers/db', () => ({ getServiceDb: () => ({ rpc }) }))
    vi.doMock('@/lib/config/instance-settings', () => ({ setInstanceSetting }))
    try {
      const actions = await import('@/app/actions/housekeeping')
      expect(await actions.saveHousekeepingSettings({ cron_history_hours: 48 })).toMatchObject({ ok: false })
      expect(await actions.runHousekeepingNow()).toMatchObject({ ok: false })
      expect(setInstanceSetting).not.toHaveBeenCalled()
      expect(rpc).not.toHaveBeenCalled()

      session.user = { id: ADMIN.id, email: ADMIN.email }
      rpc.mockImplementation(async (fn: string) => ({
        data: fn === 'instance_housekeeping_status'
          ? { settings: HOUSEKEEPING_DEFAULTS, stored: [], tables: [], runs: [], pg_cron_jobs: null, checked_at: '' }
          : { status: 'ok', deleted: {}, notes: {}, more: false },
        error: null,
      }))
      expect(await actions.saveHousekeepingSettings({ cron_history_hours: 48 })).toMatchObject({ ok: true })
      expect(setInstanceSetting).toHaveBeenCalledWith('housekeeping.cron_history_hours', 48, { updatedBy: ADMIN.id })
      expect(await actions.runHousekeepingNow()).toMatchObject({ ok: true })
      expect(rpc).toHaveBeenCalledWith('instance_housekeeping_run', expect.objectContaining({ p_trigger: 'ui', p_force: true, p_actor: ADMIN.email }))
    } finally {
      vi.doUnmock('@/lib/providers/db/session')
      vi.doUnmock('@/lib/admin/infrastructure')
      vi.doUnmock('@/lib/providers/db')
      vi.doUnmock('@/lib/config/instance-settings')
      vi.resetModules()
    }
  })
})
