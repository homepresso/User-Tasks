/**
 * The Database health check catches a split install: MIGRATION_, REALTIME_ or
 * SCHEDULER_DATABASE_URL reaching another database than DATABASE_URL (e.g.
 * after a database switch that only changed DATABASE_URL: live updates then
 * listen on the old database and the leader lock is taken there).
 */
import { describe, expect, it } from 'vitest'
import { companionDatabaseFindings, runDoctor, type DatabaseIdentity, type SqlClient } from '@/lib/admin/doctor'
import type { InstanceConfig } from '@/lib/config'

const NEW: DatabaseIdentity = { database: 'usertasks', address: '172.17.0.3', port: 5432, startedAt: '2026-11-24 00:40:00+00' }
const OLD: DatabaseIdentity = { database: 'usertasks', address: '172.17.0.2', port: 5432, startedAt: '2026-11-24 00:20:00+00' }

describe('companion database URLs', () => {
  it('ok when they reach the same database, fail when another (or none)', () => {
    const findings = companionDatabaseFindings(NEW, [
      { env: 'MIGRATION_DATABASE_URL', identity: { ...NEW } },
      { env: 'REALTIME_DATABASE_URL', identity: OLD },
      { env: 'SCHEDULER_DATABASE_URL', error: 'connect ECONNREFUSED' },
    ])
    expect(findings.map((f) => [f.name, f.status])).toEqual([['MIGRATION_DATABASE_URL', 'ok'], ['REALTIME_DATABASE_URL', 'fail'], ['SCHEDULER_DATABASE_URL', 'fail']])
    expect(findings[1].detail).toMatch(/172\.17\.0\.2:5432.*172\.17\.0\.3:5432.*live updates/)
    expect(findings[1].detail).toMatch(/after a database switch, change every \*_DATABASE_URL/)
    expect(findings[2].detail).toMatch(/does not connect: connect ECONNREFUSED/)
    // The same address after a restart of another server (containers) is still another database.
    expect(companionDatabaseFindings(NEW, [{ env: 'REALTIME_DATABASE_URL', identity: { ...NEW, startedAt: 'other' } }])[0].status).toBe('fail')
    expect(companionDatabaseFindings(NEW, [{ env: 'REALTIME_DATABASE_URL', identity: { ...NEW, database: 'other' } }])[0].status).toBe('fail')
  })

  it('runDoctor: one finding per companion URL that differs from DATABASE_URL, none when they are equal or unset', async () => {
    const sql: SqlClient = {
      async query(text: string) {
        if (/server_version_num/.test(text)) return { rows: [{ version: 170000, user: 'usertasks', db: 'usertasks', superuser: true }] as never[] }
        if (/inet_server_addr/.test(text)) return { rows: [{ ...NEW }] as never[] }
        return { rows: [] }
      },
    }
    const config = { providers: { db: { id: 'postgres' } }, bootstrap: { databaseUrl: 'postgres://u:p@new:5432/usertasks' } } as unknown as InstanceConfig
    const seen: string[] = []
    const report = await runDoctor({
      config, sql, areas: ['db'],
      companionUrls: { MIGRATION_DATABASE_URL: 'postgres://u:p@new:5432/usertasks', REALTIME_DATABASE_URL: 'postgres://u:p@old:5432/usertasks', SCHEDULER_DATABASE_URL: 'postgres://u:p@new-session:5432/usertasks' },
      identifyDatabase: async (url) => { seen.push(url); return url.includes('@old') ? OLD : NEW },
    })
    // MIGRATION_DATABASE_URL equals DATABASE_URL: not connected again.
    expect(seen).toEqual(['postgres://u:p@old:5432/usertasks', 'postgres://u:p@new-session:5432/usertasks'])
    const byName = Object.fromEntries(report.checks.map((c) => [c.name, c.status]))
    expect(byName).toMatchObject({ REALTIME_DATABASE_URL: 'fail', SCHEDULER_DATABASE_URL: 'ok' })
    expect(byName.MIGRATION_DATABASE_URL).toBeUndefined()
    expect(report.areas.db).toBe('fail')

    const none = await runDoctor({ config, sql, areas: ['db'], companionUrls: {}, identifyDatabase: async () => { throw new Error('not called') } })
    expect(none.checks.some((c) => c.name.endsWith('_DATABASE_URL'))).toBe(false)
  })
})
