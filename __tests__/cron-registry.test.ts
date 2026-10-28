import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DAILY_CATCH_UP_MS,
  JOBS,
  describeCadence,
  dueJobs,
  floorToMinute,
  isDue,
  type JobContext,
  type Probe,
} from '@/lib/jobs/registry'

const at = (iso: string) => new Date(iso)

describe('isDue: interval cadences', () => {
  it('every minute is always due', () => {
    for (const iso of ['2026-10-25T00:00:00Z', '2026-10-25T13:37:00Z', '2026-10-25T23:59:59Z']) {
      expect(isDue({ every: 1 }, at(iso))).toBe(true)
    }
  })

  it('every 5 / 10 minutes fire on the UTC minute boundaries only', () => {
    const fiveDue: number[] = []
    const tenDue: number[] = []
    for (let m = 0; m < 60; m++) {
      const minute = at(`2026-10-25T07:${String(m).padStart(2, '0')}:00Z`)
      if (isDue({ every: 5 }, minute)) fiveDue.push(m)
      if (isDue({ every: 10 }, minute)) tenDue.push(m)
    }
    expect(fiveDue).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55])
    expect(tenDue).toEqual([0, 10, 20, 30, 40, 50])
  })

  it('uses the minute, not the second (a late request at :05:59 is still :05)', () => {
    expect(isDue({ every: 5 }, at('2026-10-25T07:05:59.999Z'))).toBe(true)
    expect(isDue({ every: 5 }, at('2026-10-25T07:06:00.000Z'))).toBe(false)
    expect(floorToMinute(at('2026-10-25T07:05:59.999Z')).toISOString()).toBe('2026-10-25T07:05:00.000Z')
  })

  it('rejects cadences that do not divide an hour', () => {
    expect(() => isDue({ every: 7 }, at('2026-10-25T07:00:00Z'))).toThrow(/divide 60/)
    expect(() => isDue({ every: 0 }, at('2026-10-25T07:00:00Z'))).toThrow()
  })
})

describe('isDue: daily cadences', () => {
  const daily = { daily: '03:30' }

  it('is due at the exact UTC minute without history', () => {
    expect(isDue(daily, at('2026-10-25T03:30:00Z'))).toBe(true)
    expect(isDue(daily, at('2026-10-25T03:30:45Z'))).toBe(true)
    expect(isDue(daily, at('2026-10-25T03:29:00Z'))).toBe(false)
    expect(isDue(daily, at('2026-10-25T03:31:00Z'))).toBe(false)
  })

  it('catches up a missed slot later that day when history says it has not run', () => {
    const late = at('2026-10-25T03:45:00Z')
    expect(isDue(daily, late, null)).toBe(true) // never ran
    expect(isDue(daily, late, at('2026-10-24T03:30:02Z'))).toBe(true) // ran yesterday
    expect(isDue(daily, late, at('2026-10-25T03:30:01Z'))).toBe(false) // ran today
    expect(isDue(daily, late, undefined)).toBe(false) // history unknown: exact minute only
  })

  it('stops catching up after the window and never runs before the slot', () => {
    const lastRun = at('2026-10-24T03:30:00Z')
    expect(isDue(daily, new Date(at('2026-10-25T03:30:00Z').getTime() + DAILY_CATCH_UP_MS - 60_000), lastRun)).toBe(true)
    expect(isDue(daily, new Date(at('2026-10-25T03:30:00Z').getTime() + DAILY_CATCH_UP_MS), lastRun)).toBe(false)
    expect(isDue(daily, at('2026-10-25T02:00:00Z'), lastRun)).toBe(false)
  })

  it('the exact slot is due even if it already ran today (a second tick in the same minute is stopped by the lock)', () => {
    expect(isDue(daily, at('2026-10-25T03:30:00Z'), at('2026-10-25T03:30:00Z'))).toBe(true)
  })

  it('rejects malformed times', () => {
    expect(() => isDue({ daily: '3:30' }, at('2026-10-25T03:30:00Z'))).toThrow(/HH:MM/)
    expect(() => isDue({ daily: '24:00' }, at('2026-10-25T03:30:00Z'))).toThrow()
  })
})

describe('JOBS registry', () => {
  it('has unique names, valid cadences and positive budgets', () => {
    const names = JOBS.map((job) => job.name)
    expect(new Set(names).size).toBe(names.length)
    for (const job of JOBS) {
      expect(() => isDue(job.cadence, at('2026-10-25T00:00:00Z'))).not.toThrow()
      expect(job.budgetMs).toBeGreaterThan(0)
      expect(job.budgetMs).toBeLessThanOrEqual(50_000)
    }
  })

  it('keeps the cadence of the 14 pg_cron jobs it replaces', () => {
    expect(Object.fromEntries(JOBS.map((job) => [job.name, describeCadence(job.cadence)]))).toEqual({
      'process-schedules': 'every minute',
      'process-workflows': 'every minute',
      'process-agents': 'every minute',
      'github-sync-push': 'every minute',
      'github-sync-deploy': 'every minute',
      'ship-events': 'every minute',
      // Background jobs (lib/user-jobs), not a pg_cron job before the registry.
      'user-jobs': 'every minute',
      'provider-switches': 'every minute',
      'process-sla': 'every 5 min',
      'process-reminders': 'every 5 min',
      'process-escalations': 'every 5 min',
      'process-deletions': 'every 10 min',
      'directory-sync': 'every 10 min',
      'oauth-refresh': 'every 10 min',
      'cache-sweep': 'every 10 min',
      'user-jobs-cleanup': 'every 15 min',
      'housekeeping': 'every 15 min',
      'process-retention': 'daily 03:00 UTC',
      'cleanup-logs': 'daily 04:00 UTC',
      'housekeeping-daily': 'daily 03:30 UTC',
    })
  })

  it("every job's standalone endpoint still exists", () => {
    for (const job of JOBS) {
      expect(existsSync(path.join(process.cwd(), 'app', job.endpoint, 'route.ts')), job.endpoint).toBe(true)
    }
  })

  it('due sets at typical minutes', () => {
    const names = (iso: string, history?: Map<string, Date | null>) => dueJobs(at(iso), history).map((job) => job.name)
    expect(names('2026-10-25T07:01:00Z')).toEqual([
      'process-schedules', 'process-workflows', 'process-agents', 'github-sync-push', 'github-sync-deploy', 'ship-events', 'provider-switches', 'user-jobs',
    ])
    expect(names('2026-10-25T07:05:00Z')).toHaveLength(11)
    expect(names('2026-10-25T07:10:00Z')).toHaveLength(15)
    expect(names('2026-10-25T03:00:00Z')).toContain('process-retention')
    expect(names('2026-10-25T04:00:00Z')).toContain('cleanup-logs')
    expect(names('2026-10-25T04:00:00Z')).not.toContain('process-retention')
    // History: retention ran yesterday only → caught up at 04:00.
    const history = new Map<string, Date | null>([['process-retention', at('2026-10-24T03:00:00Z')], ['cleanup-logs', at('2026-10-24T04:00:00Z')]])
    expect(names('2026-10-25T04:00:00Z', history)).toEqual(expect.arrayContaining(['process-retention', 'cleanup-logs']))
  })
})

describe('isEnabled', () => {
  const ctx = (probe: Probe): JobContext => ({
    supabase: {} as JobContext['supabase'],
    minute: at('2026-10-25T07:00:00Z'),
    deadline: Date.now() + 10_000,
    probe: async () => probe,
  })
  const job = (name: string) => JOBS.find((j) => j.name === name)!

  it.each([
    ['process-schedules', 'schedules'],
    ['process-workflows', 'workflow_queue'],
    ['process-agents', 'agent_queue'],
    ['github-sync-push', 'github_sync'],
    ['github-sync-deploy', 'github_deployments'],
    ['ship-events', 'log_destinations'],
    ['process-sla', 'sla'],
    ['process-reminders', 'reminders'],
    ['process-escalations', 'escalations'],
    ['process-deletions', 'deletions'],
    ['directory-sync', 'directory_sync'],
    ['oauth-refresh', 'oauth_connectors'],
  ])('%s is skipped when probe.%s is false', async (name, key) => {
    expect(await job(name).isEnabled(ctx({ [key]: false }))).toBe(false)
    expect(await job(name).isEnabled(ctx({ [key]: true }))).toBe(true)
  })

  it('unknown probe keys (RPC missing or failed) count as enabled', async () => {
    for (const j of JOBS) expect(await j.isEnabled(ctx({}))).toBe(true)
  })

  it('daily jobs always run', async () => {
    const allFalse = Object.fromEntries(['schedules', 'workflow_queue', 'sla'].map((k) => [k, false]))
    expect(await job('process-retention').isEnabled(ctx(allFalse))).toBe(true)
    expect(await job('cleanup-logs').isEnabled(ctx(allFalse))).toBe(true)
  })
})
