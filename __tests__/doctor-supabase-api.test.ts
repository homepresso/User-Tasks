import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runDoctor, type DoctorReport, type DoctorSnapshot, type RpcClient, type SqlClient } from '@/lib/admin/doctor'
import { resolveInstanceConfig } from '@/lib/config'
import { HOUSEKEEPING_DEFAULTS } from '@/lib/config/housekeeping'

/**
 * The doctor (usertasks-admin doctor/status, Settings → Infrastructure) on
 * the three database setups:
 *  - Supabase provider, no DATABASE_URL (Vercel): the database, scheduler,
 *    realtime, secrets and KMS checks run through service-role RPCs, and
 *    nothing tells the reader to set DATABASE_URL;
 *  - postgres provider, no DATABASE_URL: a real failure;
 *  - Supabase provider with DATABASE_URL: the direct connection, no RPCs.
 */

const AREAS = ['db', 'scheduler', 'realtime', 'secrets', 'kms'] as const

const SNAPSHOT: DoctorSnapshot = {
  version_num: 170006,
  database: 'postgres',
  roles: ['anon', 'authenticated', 'service_role'],
  extensions: ['pg_cron', 'pg_net', 'pg_trgm', 'pgcrypto', 'plpgsql', 'supabase_vault'],
  auth_uid: true,
  notify_triggers: true,
  latest_migration: '29991231000000',
  publication_tables: 9,
  pg_cron: {
    installed: true,
    jobs: [
      { jobname: 'usertasks-cron-housekeeping', schedule: '30 3 * * *', active: true },
      { jobname: 'usertasks-housekeeping', schedule: '*/15 * * * *', active: true },
      { jobname: 'usertasks-tick', schedule: '* * * * *', active: true },
    ],
  },
  vault: { app_base_url: true, cron_secret: true },
  leader_pid: null,
  tick_acquired_at: new Date().toISOString(),
  failing_jobs: null,
  secret_settings: 0,
}

function fakeRpc(overrides: Record<string, { data?: unknown; error?: { message: string; code?: string } }> = {}) {
  const calls: Array<{ fn: string; args?: Record<string, unknown> }> = []
  const results: Record<string, { data?: unknown; error?: { message: string; code?: string } }> = {
    instance_doctor_snapshot: { data: SNAPSHOT },
    instance_housekeeping_status: {
      data: {
        settings: HOUSEKEEPING_DEFAULTS, stored: [], tables: [], pg_cron_jobs: null, checked_at: new Date().toISOString(),
        runs: [{ trigger: 'tick', actor: null, status: 'ok', started_at: new Date().toISOString(), finished_at: new Date().toISOString(), duration_ms: 5, deleted: {}, notes: {}, more: false }],
      },
    },
    app_kms_data_keys: { data: [] },
    ...overrides,
  }
  const rpc: RpcClient = {
    rpc(fn, args) {
      calls.push({ fn, args })
      const r = results[fn] ?? { error: { message: `Could not find the function public.${fn}`, code: 'PGRST202' } }
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null })
    },
  }
  return { rpc, calls }
}

const BANNED = /set DATABASE_URL|can't be found|cannot be found|No direct connection/i

function text(report: DoctorReport): string {
  return report.checks.map((c) => `${c.area}/${c.name}: ${c.status} ${c.detail}`).join('\n')
}

const saved = { ...process.env }
beforeEach(() => {
  for (const key of ['DB_PROVIDER', 'DATABASE_URL', 'SCHEDULER_PROVIDER', 'REALTIME_PROVIDER', 'SECRETS_PROVIDER', 'KMS_PROVIDER', 'MIGRATION_DATABASE_URL', 'REALTIME_DATABASE_URL']) delete process.env[key]
  process.env.CRON_SECRET = 'x'.repeat(32)
})
afterEach(() => { process.env = { ...saved } })

describe('doctor: Supabase provider without DATABASE_URL', () => {
  it('runs the database-backed checks through the service-role RPCs', async () => {
    const { rpc, calls } = fakeRpc()
    const report = await runDoctor({ config: resolveInstanceConfig(new Map()), sql: null, rpc, areas: [...AREAS] })
    const out = text(report)
    expect(out).not.toMatch(BANNED)
    const find = (area: string, name: string) => report.checks.find((c) => c.area === area && c.name === name)
    expect(find('db', 'connection')).toMatchObject({ status: 'ok', via: 'api' })
    expect(find('db', 'connection')!.detail).toMatch(/PostgreSQL 17 — database postgres, checked through the Supabase API/)
    expect(find('db', 'version')).toMatchObject({ status: 'ok' })
    expect(find('db', 'roles')).toMatchObject({ status: 'ok' })
    expect(find('db', 'extensions')).toMatchObject({ status: 'ok' })
    expect(find('db', 'auth.uid()')).toMatchObject({ status: 'ok' })
    expect(find('db', 'migrations')).toMatchObject({ status: 'ok', detail: 'up to date (29991231000000)' })
    expect(find('scheduler', 'pg_cron jobs')).toMatchObject({ status: 'ok', via: 'api' })
    expect(find('scheduler', 'vault')).toMatchObject({ status: 'ok' })
    expect(find('scheduler', 'last tick')).toMatchObject({ status: 'ok' })
    expect(find('scheduler', 'housekeeping')).toMatchObject({ status: 'ok', via: 'api' })
    expect(find('realtime', 'publication')).toMatchObject({ status: 'ok', detail: 'supabase_realtime publishes 9 tables', via: 'api' })
    expect(find('secrets', 'encryption key')).toMatchObject({ via: 'api' })
    // The tooltip explains DATABASE_URL is optional here.
    expect(find('db', 'connection')!.note).toMatch(/only needed by the postgres database provider/)
    expect(report.areas.db).toBe('ok')
    expect(report.areas.realtime).toBe('ok')
    // One snapshot per run, the scheduler lock key passed as a string (bigint > 2^53).
    expect(calls.filter((c) => c.fn === 'instance_doctor_snapshot')).toHaveLength(1)
    expect(calls.find((c) => c.fn === 'instance_doctor_snapshot')!.args).toEqual({ p_scheduler_lock_key: expect.any(String) })
    expect(calls.map((c) => c.fn)).toContain('instance_housekeeping_status')
  })

  it('reads the KMS data keys through app_kms_data_keys()', async () => {
    process.env.KMS_PROVIDER = 'env'
    const { rpc, calls } = fakeRpc()
    const report = await runDoctor({ config: resolveInstanceConfig(new Map()), sql: null, rpc, areas: ['kms'] })
    expect(text(report)).not.toMatch(BANNED)
    expect(calls.map((c) => c.fn)).toEqual(['app_kms_data_keys'])
    expect(report.checks[0]).toMatchObject({ area: 'kms', name: 'provider', via: 'api' })
  })

  it('reports pg_cron jobs and failing jobs from the snapshot like the direct path', async () => {
    const { rpc } = fakeRpc({
      instance_doctor_snapshot: { data: { ...SNAPSHOT, pg_cron: { installed: true, jobs: [SNAPSHOT.pg_cron.jobs[2]] }, failing_jobs: 'directory-sync', tick_acquired_at: null } },
    })
    const report = await runDoctor({ config: resolveInstanceConfig(new Map()), sql: null, rpc, areas: ['scheduler'] })
    expect(report.checks.find((c) => c.name === 'pg_cron jobs')).toMatchObject({ status: 'fail', detail: expect.stringContaining('usertasks-housekeeping') })
    expect(report.checks.find((c) => c.name === 'jobs')).toMatchObject({ status: 'warn', detail: 'last run failed: directory-sync' })
    expect(report.checks.find((c) => c.name === 'last tick')).toMatchObject({ status: 'warn' })
  })

  it('before migration 20261121000000: neutral, never a failure or a DATABASE_URL instruction', async () => {
    const { rpc } = fakeRpc({ instance_doctor_snapshot: { error: { message: 'Could not find the function public.instance_doctor_snapshot', code: 'PGRST202' } } })
    const report = await runDoctor({ config: resolveInstanceConfig(new Map()), sql: null, rpc, areas: [...AREAS] })
    expect(text(report)).not.toMatch(BANNED)
    expect(report.checks.find((c) => c.area === 'db')).toMatchObject({ name: 'connection', status: 'skip', detail: expect.stringMatching(/Checked through the Supabase API once migration 20261121000000 is applied/) })
    expect(report.checks.filter((c) => c.status === 'fail')).toEqual([])
    // Housekeeping has its own RPC and still reports.
    expect(report.checks.find((c) => c.area === 'scheduler' && c.name === 'housekeeping')).toMatchObject({ status: 'ok' })
  })

  it('without a service-role key: neutral rows that name the key, not DATABASE_URL', async () => {
    const report = await runDoctor({ config: resolveInstanceConfig(new Map()), sql: null, rpc: null, areas: ['db', 'realtime'] })
    expect(text(report)).not.toMatch(BANNED)
    expect(report.checks.every((c) => c.status === 'skip')).toBe(true)
    expect(report.checks[0].detail).toMatch(/SUPABASE_SERVICE_ROLE_KEY/)
  })

  it('DATABASE_URL set but unreachable: a warning, then the API checks', async () => {
    const { rpc } = fakeRpc()
    const report = await runDoctor({ config: resolveInstanceConfig(new Map()), sql: null, rpc, sqlError: 'connect ECONNREFUSED', areas: ['db'] })
    expect(report.checks[0]).toMatchObject({ name: 'direct connection', status: 'warn', detail: expect.stringContaining('ECONNREFUSED') })
    expect(report.checks.find((c) => c.name === 'connection')).toMatchObject({ status: 'ok', via: 'api' })
  })
})

describe('doctor: postgres provider without DATABASE_URL', () => {
  it('fails the database area; the dependent checks say so neutrally', async () => {
    process.env.DB_PROVIDER = 'postgres'
    const { rpc, calls } = fakeRpc()
    const report = await runDoctor({ config: resolveInstanceConfig(new Map()), sql: null, rpc, areas: ['db', 'scheduler', 'realtime'] })
    expect(report.checks.find((c) => c.area === 'db')).toMatchObject({ name: 'connection', status: 'fail', detail: expect.stringMatching(/postgres database provider needs DATABASE_URL/) })
    expect(report.ok).toBe(false)
    expect(report.checks.find((c) => c.area === 'scheduler' && c.name === 'database')).toMatchObject({ status: 'skip', detail: expect.stringContaining('see Database') })
    // The Supabase API is never used for the postgres provider.
    expect(calls).toEqual([])
  })
})

describe('doctor: Supabase provider with DATABASE_URL', () => {
  it('uses the direct connection and no RPC', async () => {
    const queries: string[] = []
    const sql: SqlClient = {
      async query<R extends Record<string, unknown>>(q: string) {
        queries.push(q)
        let row: Record<string, unknown> = {}
        if (q.includes('server_version_num')) row = { version: 170006, user: 'postgres', db: 'postgres', superuser: false }
        else if (q.includes('FROM pg_roles r')) return { rows: ['anon', 'authenticated', 'service_role'].map((rolname) => ({ rolname, member: true })) as unknown as R[] }
        else if (q.includes('FROM pg_extension')) return { rows: ['pgcrypto', 'pg_trgm'].map((extname) => ({ extname })) as unknown as R[] }
        else if (q.includes("auth.uid()")) row = { uid: true }
        else if (q.includes('schema_migrations')) row = { latest: '29991231000000' }
        else if (q.includes('pg_publication_tables')) row = { tables: '7' }
        return { rows: [row] as R[] }
      },
    }
    const { rpc, calls } = fakeRpc()
    const report = await runDoctor({ config: resolveInstanceConfig(new Map()), sql, rpc, areas: ['db', 'realtime'] })
    expect(calls).toEqual([])
    expect(report.checks.find((c) => c.name === 'connection')).toMatchObject({ status: 'ok', detail: 'PostgreSQL 17 — database postgres as postgres' })
    expect(report.checks.find((c) => c.name === 'connection')!.via).toBeUndefined()
    expect(report.checks.find((c) => c.name === 'publication')).toMatchObject({ status: 'ok', detail: 'supabase_realtime publishes 7 tables' })
    expect(queries.length).toBeGreaterThan(0)
  })
})
