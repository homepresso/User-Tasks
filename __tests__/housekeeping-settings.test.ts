import { describe, expect, it } from 'vitest'
import {
  HOUSEKEEPING_DEFAULTS,
  HousekeepingSettingError,
  describeHousekeepingValue,
  housekeepingOption,
  parseDuration,
  parseHousekeepingValue,
  resolveHousekeepingSettings,
  validateHousekeepingSetting,
} from '@/lib/config/housekeeping'
import { INSTANCE_SETTING_KEY } from '@/lib/config/schema'
import { setInstanceSetting } from '@/lib/config/instance-settings'
import { bytesPerRow, formatBytes, housekeepingFindings, isBloated, type HousekeepingStatus } from '@/lib/admin/housekeeping'
import { JOBS, describeCadence } from '@/lib/jobs/registry'
import { PG_CRON_JOBS } from '@/lib/providers/scheduler/pg-cron'

/**
 * Instance housekeeping (migration 20261109500000): the `housekeeping.*`
 * settings' defaults and validation, the findings doctor / status / the
 * Infrastructure page report, and the scheduler wiring.
 */

describe('housekeeping settings', () => {
  it('defaults: on, hourly, 1 day of cron history, 1 hour of pg_net responses', () => {
    expect(HOUSEKEEPING_DEFAULTS).toEqual({ enabled: true, interval_minutes: 60, cron_history_hours: 24, http_response_minutes: 60 })
    expect(resolveHousekeepingSettings(new Map())).toEqual(HOUSEKEEPING_DEFAULTS)
  })

  it('housekeeping.* is an instance setting namespace', () => {
    expect(INSTANCE_SETTING_KEY.test('housekeeping.cron_history_hours')).toBe(true)
    expect(INSTANCE_SETTING_KEY.test('housekeeping.Bad')).toBe(false)
    expect(housekeepingOption('housekeeping.enabled')).toBe('enabled')
    expect(housekeepingOption('interval_minutes')).toBe('interval_minutes')
    expect(housekeepingOption('housekeeping.nope')).toBeNull()
  })

  it('parses what operators type', () => {
    expect(parseHousekeepingValue('enabled', 'off')).toBe(false)
    expect(parseHousekeepingValue('enabled', true)).toBe(true)
    expect(parseHousekeepingValue('cron_history_hours', '1d')).toBe(24)
    expect(parseHousekeepingValue('cron_history_hours', '90 days')).toBe(2160)
    expect(parseHousekeepingValue('cron_history_hours', '1h')).toBe(1)
    expect(parseHousekeepingValue('cron_history_hours', 48)).toBe(48)
    expect(parseHousekeepingValue('http_response_minutes', '2h')).toBe(120)
    expect(parseHousekeepingValue('interval_minutes', '15')).toBe(15)
    expect(parseDuration('90m', 'hours')).toBe(1.5)
  })

  it('enforces the ranges: cron history 1 hour – 90 days, responses 5 min – 7 days, fixed intervals', () => {
    const bad: Array<[Parameters<typeof parseHousekeepingValue>[0], unknown]> = [
      ['cron_history_hours', 0],
      ['cron_history_hours', '30m'],
      ['cron_history_hours', '91d'],
      ['cron_history_hours', '1.5'],
      ['cron_history_hours', 'soon'],
      ['http_response_minutes', '1m'],
      ['http_response_minutes', '8d'],
      ['interval_minutes', 7],
      ['interval_minutes', 1441],
      ['enabled', 'maybe'],
      ['cron_history_hours', null],
    ]
    for (const [option, value] of bad) expect(() => parseHousekeepingValue(option, value), `${option}=${value}`).toThrow(HousekeepingSettingError)
    expect(() => parseHousekeepingValue('cron_history_hours', '91d')).toThrow(/from 1 hour to 90 days/)
  })

  it('stored invalid values fall back to the default, like the SQL side', () => {
    const s = resolveHousekeepingSettings(new Map<string, unknown>([
      ['housekeeping.enabled', false],
      ['housekeeping.interval_minutes', 7],
      ['housekeeping.cron_history_hours', 12],
      ['housekeeping.http_response_minutes', 'junk'],
    ]))
    expect(s).toEqual({ enabled: false, interval_minutes: 60, cron_history_hours: 12, http_response_minutes: 60 })
  })

  it('instance_settings writes refuse unknown housekeeping keys and invalid values', async () => {
    expect(() => validateHousekeepingSetting('housekeeping.frobnicate', 1)).toThrow(/Unknown housekeeping setting/)
    expect(() => validateHousekeepingSetting('housekeeping.cron_history_hours', '1d')).toThrow(/store 24/)
    expect(() => validateHousekeepingSetting('housekeeping.cron_history_hours', 24)).not.toThrow()
    expect(() => validateHousekeepingSetting('instance.admin_emails', ['a@b.c'])).not.toThrow()
    // Validated before any database access.
    await expect(setInstanceSetting('housekeeping.cron_history_hours', 0)).rejects.toThrow(/from 1 hour to 90 days/)
  })

  it('describes values', () => {
    expect(describeHousekeepingValue('cron_history_hours', 24)).toBe('1 day')
    expect(describeHousekeepingValue('cron_history_hours', 36)).toBe('36 hours')
    expect(describeHousekeepingValue('http_response_minutes', 60)).toBe('1 hour')
    expect(describeHousekeepingValue('interval_minutes', 15)).toBe('15 minutes')
    expect(describeHousekeepingValue('enabled', false)).toBe('off')
  })
})

describe('housekeeping findings', () => {
  const now = Date.parse('2026-10-26T12:00:00Z')
  const status = (over: Partial<HousekeepingStatus> = {}): HousekeepingStatus => ({
    settings: { ...HOUSEKEEPING_DEFAULTS },
    stored: [],
    tables: [],
    runs: [{ trigger: 'pg_cron', actor: null, status: 'ok', started_at: '2026-10-26T11:30:00Z', finished_at: '2026-10-26T11:30:01Z', duration_ms: 12, deleted: { 'cron.job_run_details': 60 }, notes: {}, more: false }],
    pg_cron_jobs: null,
    checked_at: '2026-10-26T12:00:00Z',
    ...over,
  })

  it('a recent pass is ok; a late one, none, or disabled warns', () => {
    expect(housekeepingFindings(status(), now)).toEqual([{ level: 'ok', name: 'housekeeping', detail: expect.stringMatching(/30 min ago .*60 rows deleted/) }])
    const late = status({ runs: [{ ...status().runs[0], started_at: '2026-10-26T08:00:00Z' }] })
    expect(housekeepingFindings(late, now)[0]).toMatchObject({ level: 'warn', detail: expect.stringMatching(/is the scheduler running/) })
    expect(housekeepingFindings(status({ runs: [] }), now)[0]).toMatchObject({ level: 'warn', detail: expect.stringMatching(/no pass recorded/) })
    expect(housekeepingFindings(status({ settings: { ...HOUSEKEEPING_DEFAULTS, enabled: false } }), now)[0]).toMatchObject({ level: 'warn', detail: expect.stringMatching(/off/) })
  })

  it('warns about a bloated cron.job_run_details with the Supabase-owner hint', () => {
    // Production before housekeeping: 138 MB for ~18k rows.
    const table = { table: 'cron.job_run_details', installed: true, purged_by: 'housekeeping' as const, rule: '', rows: 180_000, dead_rows: 0, total_bytes: 1380 * 1024 * 1024 }
    expect(isBloated(table)).toBe(true)
    expect(formatBytes(bytesPerRow(table))).toBe('7.9 kB')
    const [, finding] = housekeepingFindings(status({ tables: [table] }), now)
    expect(finding).toMatchObject({ level: 'warn', name: 'cron.job_run_details' })
    expect(finding.detail).toMatch(/^bloated: 1.3 GB for ~180,000 rows/)
    expect(finding.detail).toMatch(/VACUUM FULL by its owner — ask Supabase support/)
    expect(finding.detail).toMatch(/housekeeping keeps the row count small/)
  })

  it('reports reusable free space after a purge without warning', () => {
    // Production after housekeeping: still 138 MB on disk, ~1.6k rows.
    const table = { table: 'cron.job_run_details', installed: true, purged_by: 'housekeeping' as const, rule: '', rows: 1_600, dead_rows: 0, total_bytes: 138 * 1024 * 1024 }
    const [, finding] = housekeepingFindings(status({ tables: [table] }), now)
    expect(finding).toMatchObject({ level: 'ok', name: 'cron.job_run_details' })
    expect(finding.detail).toMatch(/no action needed unless you want the disk space back/)
  })

  it('warns about many rows, but not about small, healthy or kept tables', () => {
    const base = { installed: true, purged_by: 'housekeeping' as const, rule: '', dead_rows: 0 }
    const findings = housekeepingFindings(status({
      tables: [
        { ...base, table: 'cron.job_run_details', rows: 150_000, total_bytes: 40 * 1024 * 1024 },
        { ...base, table: 'net._http_response', rows: 100, total_bytes: 64 * 1024 },
        { ...base, table: 'public.instance_provider_switches', purged_by: 'kept', rows: 1, total_bytes: 900 * 1024 * 1024 },
        { ...base, table: 'app_cache.entries', installed: false, rows: null, total_bytes: null },
      ],
    }), now)
    expect(findings.map((f) => f.name)).toEqual(['housekeeping', 'cron.job_run_details'])
    expect(findings[1].detail).not.toMatch(/bloated/)
  })
})

describe('housekeeping scheduling', () => {
  it('the registry runs it every 15 minutes and daily for the worker / external schedulers', () => {
    const cadences = Object.fromEntries(JOBS.map((job) => [job.name, describeCadence(job.cadence)]))
    expect(cadences.housekeeping).toBe('every 15 min')
    expect(cadences['housekeeping-daily']).toBe('daily 03:30 UTC')
  })

  it('pg_cron runs the same SQL function itself', () => {
    expect(PG_CRON_JOBS.map((j) => [j.name, j.schedule, j.command])).toEqual([
      ['usertasks-tick', '* * * * *', expect.stringContaining('/api/cron/tick')],
      ['usertasks-housekeeping', '*/15 * * * *', 'select app_cron.run_housekeeping()'],
      ['usertasks-cron-housekeeping', '30 3 * * *', `select app_cron.run_housekeeping('pg_cron-daily', true, false, null, 120000, 400)`],
    ])
  })

  it('under pg_cron the registry job leaves the pass to the database', async () => {
    const saved = process.env.SCHEDULER_PROVIDER
    process.env.SCHEDULER_PROVIDER = 'pg_cron'
    try {
      const { runHousekeepingJob } = await import('@/lib/jobs/housekeeping')
      const rpc = () => { throw new Error('must not call the database') }
      expect(await runHousekeepingJob({ supabase: { rpc } as never })).toEqual({ skipped: expect.stringMatching(/pg_cron/) })
    } finally {
      if (saved === undefined) delete process.env.SCHEDULER_PROVIDER
      else process.env.SCHEDULER_PROVIDER = saved
    }
  })

  it('with the worker it asks the database for a pass (tick, daily = forced)', async () => {
    const saved = process.env.SCHEDULER_PROVIDER
    process.env.SCHEDULER_PROVIDER = 'worker'
    const calls: Array<[string, Record<string, unknown> | undefined]> = []
    const rpc = async (fn: string, args?: Record<string, unknown>) => {
      calls.push([fn, args])
      return { data: { status: 'ok', deleted: { 'cron.job_run_details': 3 }, notes: {}, more: false }, error: null }
    }
    try {
      const { runHousekeepingJob } = await import('@/lib/jobs/housekeeping')
      expect(await runHousekeepingJob({ supabase: { rpc } as never, budgetMs: 10_000 })).toMatchObject({ status: 'ok', deleted: { 'cron.job_run_details': 3 } })
      await runHousekeepingJob({ supabase: { rpc } as never, daily: true, budgetMs: 90_000 })
      expect(calls).toEqual([
        ['instance_housekeeping_run', { p_trigger: 'tick', p_force: false, p_dry_run: false, p_actor: null, p_budget_ms: 10_000 }],
        ['instance_housekeeping_run', { p_trigger: 'tick-daily', p_force: true, p_dry_run: false, p_actor: null, p_budget_ms: 45_000 }],
      ])
    } finally {
      if (saved === undefined) delete process.env.SCHEDULER_PROVIDER
      else process.env.SCHEDULER_PROVIDER = saved
    }
  })
})
