/**
 * Scheduler provider against a LOCAL Supabase Postgres (EVENT_STREAM_DB_URL):
 *
 *  - advisory-lock leader election with real sessions: two workers, one
 *    tick per minute, failover when the leader's session ends;
 *  - the pg_cron generator (lib/providers/scheduler/pg-cron.ts): installs
 *    exactly what migration 20261103100000 schedules, is idempotent, stores
 *    and updates the Vault secrets, and uninstalls. Runs inside one
 *    transaction that is rolled back, so the stack's own jobs are untouched.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { dbCapabilities } from './helpers/db-capabilities'
import { AdvisoryLockElector } from '@/lib/scheduler/leader'
import { SchedulerWorker } from '@/lib/scheduler/worker'
import { PG_CRON_JOBS, installPgCron, pgCronStatus, uninstallPgCron } from '@/lib/providers/scheduler/pg-cron'

const DB_URL = process.env.EVENT_STREAM_DB_URL
const CAPS = await dbCapabilities()
const T0 = Date.UTC(2026, 9, 25, 12, 0, 0)
const quiet = () => undefined

describe('pg_cron job specs', () => {
  it('match what the migrations schedule last, character for character', () => {
    // Consolidation (tick) then instance housekeeping (both housekeeping jobs).
    const migrations = ['20261103100000_cron_consolidation.sql', '20261109500000_instance_housekeeping.sql']
      .map((file) => readFileSync(path.join(process.cwd(), 'supabase/migrations', file), 'utf8'))
      .join('\n')
    for (const spec of PG_CRON_JOBS) {
      const at = migrations.lastIndexOf(`PERFORM cron.schedule('${spec.name}', `)
      expect(at, spec.name).toBeGreaterThan(-1)
      const call = migrations.slice(at, migrations.indexOf(');', at))
      expect(call).toContain(`PERFORM cron.schedule('${spec.name}', '${spec.schedule}',`)
      expect(call).toContain(`$$${spec.command}$$`)
    }
  })
})

describe.skipIf(!DB_URL)('advisory-lock leader election (local DB)', () => {
  // A key of its own so a worker running against the same stack is not disturbed.
  const lockKey = String(1_000_000 + Math.floor(Math.random() * 1_000_000))

  it('two workers: exactly one ticks each minute; the other takes over after the leader stops', async () => {
    const ticks: string[] = []
    const make = (name: string) =>
      new SchedulerWorker({
        elector: new AdvisoryLockElector({ connectionString: DB_URL!, lockKey, log: quiet }),
        tick: async () => void ticks.push(name),
        log: quiet,
      })
    const a = make('a')
    const b = make('b')
    try {
      for (let i = 0; i < 3; i++) {
        const at = new Date(T0 + i * 60_000 + 1_000)
        const outcomes = await Promise.all([a.runMinute(at), b.runMinute(at)])
        expect(outcomes.filter((o) => o === 'ticked')).toHaveLength(1)
        expect(outcomes.filter((o) => o === 'follower')).toHaveLength(1)
      }
      expect(new Set(ticks).size).toBe(1)
      const [leader, follower] = ticks[0] === 'a' ? [a, b] : [b, a]

      await leader.stop() // closes its session: the lock is released
      const outcome = await follower.runMinute(new Date(T0 + 3 * 60_000 + 1_000))
      expect(outcome).toBe('ticked')
      expect(ticks.at(-1)).not.toBe(ticks[0])
    } finally {
      await a.stop()
      await b.stop()
    }
  })

  it('a session killed by the server loses leadership', async () => {
    const one = new AdvisoryLockElector({ connectionString: DB_URL!, lockKey, log: quiet })
    const two = new AdvisoryLockElector({ connectionString: DB_URL!, lockKey, log: quiet })
    const admin = new Client({ connectionString: DB_URL })
    await admin.connect()
    try {
      expect(await one.isLeader()).toBe(true)
      expect(await two.isLeader()).toBe(false)
      expect(await one.isLeader()).toBe(true) // still connected = still leader
      await admin.query(
        `SELECT pg_terminate_backend(pid) FROM pg_locks
          WHERE locktype = 'advisory' AND granted
            AND ((classid::bigint << 32) | objid::bigint) = $1::bigint`,
        [lockKey],
      )
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(await two.isLeader()).toBe(true)
      expect(await one.isLeader()).toBe(false)
    } finally {
      await one.release()
      await two.release()
      await admin.end()
    }
  })
})

describe.skipIf(!DB_URL || !CAPS?.pgCron)('pg_cron generator (local DB)', () => {
  const db = new Client({ connectionString: DB_URL })

  beforeAll(async () => {
    await db.connect()
    await db.query('BEGIN')
    await db.query(`SELECT cron.schedule('usertasks-legacy-test', '*/7 * * * *', 'select 1')`)
    await db.query(`SELECT cron.schedule('other-app-test-job', '0 0 * * *', 'select 1')`)
  })

  afterAll(async () => {
    await db.query('ROLLBACK')
    await db.end()
  })

  const jobs = async () =>
    (await db.query<{ jobname: string; schedule: string; command: string }>(
      `SELECT jobname, schedule, command FROM cron.job WHERE jobname LIKE 'usertasks-%' ORDER BY jobname`,
    )).rows
  const vaultValue = async (name: string) =>
    (await db.query<{ v: string }>('SELECT decrypted_secret AS v FROM vault.decrypted_secrets WHERE name = $1', [name])).rows.map((r) => r.v)

  it('schedules exactly the migration\'s jobs, replacing stale usertasks-* jobs and leaving others alone', async () => {
    await installPgCron(db, { baseUrl: 'http://app.internal:3000/', secret: 'first-secret' }, { inTransaction: true })
    const rows = await jobs()
    expect(rows.map((r) => [r.jobname, r.schedule])).toEqual([
      ['usertasks-cron-housekeeping', '30 3 * * *'],
      ['usertasks-housekeeping', '*/15 * * * *'],
      ['usertasks-tick', '* * * * *'],
    ])
    for (const spec of PG_CRON_JOBS) expect(rows.find((r) => r.jobname === spec.name)?.command).toBe(spec.command)
    expect(rows.find((r) => r.jobname === 'usertasks-tick')?.command).toContain(`app_cron.invoke_endpoint('/api/cron/tick', 'POST'`)
    const other = await db.query(`SELECT 1 FROM cron.job WHERE jobname = 'other-app-test-job'`)
    expect(other.rowCount).toBe(1)
    expect(await vaultValue('app_base_url')).toEqual(['http://app.internal:3000'])
    expect(await vaultValue('cron_secret')).toEqual(['first-secret'])
  })

  it('is idempotent and updates the Vault secrets in place', async () => {
    const before = await jobs()
    const result = await installPgCron(db, { baseUrl: 'https://app.example.com', secret: 'second-secret' }, { inTransaction: true })
    expect(result.vault).toEqual({ app_base_url: 'updated', cron_secret: 'updated' })
    expect((await jobs()).map((r) => [r.jobname, r.schedule, r.command])).toEqual(before.map((r) => [r.jobname, r.schedule, r.command]))
    expect(await vaultValue('app_base_url')).toEqual(['https://app.example.com'])
    expect(await vaultValue('cron_secret')).toEqual(['second-secret'])
    // Without secrets: jobs only, Vault untouched.
    expect((await installPgCron(db, {}, { inTransaction: true })).vault).toEqual({})
    expect(await vaultValue('cron_secret')).toEqual(['second-secret'])
  })

  it('reports status without reading secret values, and uninstalls', async () => {
    const status = await pgCronStatus(db)
    expect(status.installed).toBe(true)
    expect(status.vault).toEqual({ app_base_url: true, cron_secret: true })
    expect(JSON.stringify(status)).not.toContain('second-secret')
    expect(await uninstallPgCron(db)).toEqual(['usertasks-cron-housekeeping', 'usertasks-housekeeping', 'usertasks-tick'])
    expect(await jobs()).toEqual([])
    expect((await pgCronStatus(db)).installed).toBe(false)
  })
})
