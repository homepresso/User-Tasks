/**
 * SQL-level checks for supabase/migrations/20261121000000_instance_doctor_snapshot.sql:
 * public.instance_doctor_snapshot() is service_role only, reports the facts
 * the doctor reads over DATABASE_URL otherwise (never a secret value or a
 * cron command), and the doctor's Supabase-API path gives the same verdicts
 * as its direct path on the same database.
 *
 * Runs against the local Supabase stack or plain PostgreSQL — set
 * EVENT_STREAM_DB_URL. Everything runs inside one transaction that is rolled back.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { dbCapabilities } from './helpers/db-capabilities'
import { runDoctor, type RpcClient } from '@/lib/admin/doctor'
import { resolveInstanceConfig } from '@/lib/config'
import { SCHEDULER_LOCK_KEY } from '@/lib/scheduler/leader'

const DB_URL = process.env.EVENT_STREAM_DB_URL
const CAPS = await dbCapabilities()

describe.skipIf(!DB_URL)('instance_doctor_snapshot (local DB)', () => {
  const db = new Client({ connectionString: DB_URL })
  const saved = { ...process.env }

  /** PostgREST's view of an RPC, as the service role (named arguments, errors as { message, code }). */
  const serviceRpc: RpcClient = {
    async rpc(fn, args = {}) {
      const names = Object.keys(args)
      await db.query('SAVEPOINT rpc')
      try {
        await db.query('SET LOCAL ROLE service_role')
        const { rows } = await db.query(
          `SELECT to_jsonb(public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')})) AS r`,
          names.map((n) => args[n]),
        )
        await db.query('RELEASE SAVEPOINT rpc')
        return { data: rows[0].r, error: null }
      } catch (error) {
        await db.query('ROLLBACK TO SAVEPOINT rpc')
        return { data: null, error: { message: (error as Error).message, code: (error as { code?: string }).code } }
      } finally {
        await db.query('RESET ROLE').catch(() => undefined)
      }
    },
  }

  beforeAll(async () => {
    await db.connect()
    await db.query('BEGIN')
  })
  afterAll(async () => {
    await db.query('ROLLBACK')
    await db.end()
  })
  afterEach(() => { process.env = { ...saved } })

  it('is service_role only', async () => {
    for (const role of ['anon', 'authenticated']) {
      await db.query('SAVEPOINT g')
      await db.query(`SET LOCAL ROLE ${role}`)
      await expect(db.query('SELECT public.instance_doctor_snapshot()')).rejects.toMatchObject({ code: '42501' })
      await db.query('ROLLBACK TO SAVEPOINT g')
    }
    const { rows } = await db.query(`
      SELECT has_function_privilege('anon', 'public.instance_doctor_snapshot(bigint)', 'EXECUTE') AS anon,
             has_function_privilege('authenticated', 'public.instance_doctor_snapshot(bigint)', 'EXECUTE') AS authenticated,
             has_function_privilege('service_role', 'public.instance_doctor_snapshot(bigint)', 'EXECUTE') AS service_role,
             (SELECT prosecdef FROM pg_proc WHERE oid = 'public.instance_doctor_snapshot(bigint)'::regprocedure) AS definer`)
    expect(rows[0]).toEqual({ anon: false, authenticated: false, service_role: true, definer: true })
  })

  it('reports the database facts, without secret values or cron commands', async () => {
    const { data, error } = await serviceRpc.rpc('instance_doctor_snapshot', { p_scheduler_lock_key: SCHEDULER_LOCK_KEY })
    expect(error).toBeNull()
    const snap = data as Record<string, unknown>
    const { rows: [direct] } = await db.query(`SELECT current_setting('server_version_num')::int AS v, current_database() AS d,
      (SELECT count(*)::int FROM pg_publication_tables WHERE pubname = 'supabase_realtime') AS pub`)
    expect(snap).toMatchObject({ version_num: direct.v, database: direct.d, auth_uid: true })
    expect(snap.roles).toEqual(['anon', 'authenticated', 'service_role'])
    expect(snap.extensions).toEqual(expect.arrayContaining(['pgcrypto']))
    expect(typeof snap.latest_migration === 'string' || snap.latest_migration === null).toBe(true)
    if (CAPS?.supabase) expect(snap.publication_tables).toBe(direct.pub)
    expect(snap.pg_cron).toMatchObject({ installed: Boolean(CAPS?.pgCron) })
    expect(snap.vault === null || typeof snap.vault === 'object').toBe(true)
    expect(Number(snap.secret_settings)).toBeGreaterThanOrEqual(0)
    const json = JSON.stringify(snap)
    expect(json).not.toMatch(/invoke_endpoint|run_housekeeping|decrypted_secret/)
    for (const job of (snap.pg_cron as { jobs: object[] }).jobs) expect(Object.keys(job).sort()).toEqual(['active', 'jobname', 'schedule'])
  })

  it('the API path gives the direct path verdicts', async () => {
    for (const key of ['DB_PROVIDER', 'DATABASE_URL', 'SCHEDULER_PROVIDER', 'REALTIME_PROVIDER', 'KMS_PROVIDER']) delete process.env[key]
    process.env.CRON_SECRET = 'x'.repeat(32)
    if (!CAPS?.supabase) process.env.REALTIME_PROVIDER = 'supabase'
    const config = resolveInstanceConfig(new Map())
    const areas = ['db', 'scheduler', 'realtime'] as const
    const viaApi = await runDoctor({ config, sql: null, rpc: serviceRpc, areas: [...areas], listenUrl: null })
    const direct = await runDoctor({ config, sql: db, areas: [...areas], listenUrl: null })
    const verdict = (r: typeof viaApi) => Object.fromEntries(r.checks.filter((c) => !['auth', 'privileges'].includes(c.name)).map((c) => [`${c.area}/${c.name}`, c.status]))
    expect(viaApi.checks.filter((c) => c.area === 'db').every((c) => c.via === 'api')).toBe(true)
    expect(verdict(viaApi)).toEqual(verdict(direct))
    expect(JSON.stringify(viaApi)).not.toMatch(/set DATABASE_URL/i)
  })
})
