import { afterAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { parseCommand, run, UsageError, type CliIO } from '../src/cli'
import { housekeepingSummary, resolveHousekeepingOption } from '../src/housekeeping-cli'
import { encodeSetting } from '../src/instance'
import { HOUSEKEEPING_DEFAULTS } from '@/lib/config/housekeeping'

/**
 * usertasks-admin housekeeping show | set | run, and its line in `status`.
 * The database cases run against EVENT_STREAM_DB_URL (local stack or plain
 * PostgreSQL) and put every setting they change back to its default.
 */

const DB_URL = process.env.EVENT_STREAM_DB_URL

function io(env: NodeJS.ProcessEnv = {}): CliIO & { lines: string[]; errors: string[] } {
  const lines: string[] = []
  const errors: string[] = []
  return { lines, errors, env, out: (l) => lines.push(l), err: (l) => errors.push(l) }
}

describe('usertasks-admin housekeeping: parsing', () => {
  it('parses show / set / run', () => {
    expect(parseCommand(['housekeeping'], {}).command).toEqual({ kind: 'housekeeping', action: 'show', args: [] })
    expect(parseCommand(['housekeeping', 'set', 'cron_history', '1d'], {}).command).toEqual({ kind: 'housekeeping', action: 'set', args: ['cron_history', '1d'] })
    const dry = parseCommand(['housekeeping', 'run', '--dry-run'], {})
    expect(dry.command).toEqual({ kind: 'housekeeping', action: 'run', args: [] })
    expect(dry.values['dry-run']).toBe(true)
  })

  it('rejects bad input', () => {
    for (const argv of [
      ['housekeeping', 'purge'],
      ['housekeeping', 'set', 'cron_history'],
      ['housekeeping', 'set', 'batch_size', '10'],
      ['housekeeping', 'show', 'extra'],
      ['housekeeping', 'show', '--dry-run'],
    ]) expect(() => parseCommand(argv, {}), argv.join(' ')).toThrow(UsageError)
  })

  it('resolves option names and aliases', () => {
    expect(resolveHousekeepingOption('housekeeping.enabled')).toBe('enabled')
    expect(resolveHousekeepingOption('interval')).toBe('interval_minutes')
    expect(resolveHousekeepingOption('cron-history')).toBe('cron_history_hours')
    expect(resolveHousekeepingOption('http_responses')).toBe('http_response_minutes')
    expect(resolveHousekeepingOption('nope')).toBeNull()
  })

  it('needs a database, and validates settings written through the generic path', async () => {
    const noDb = io({})
    expect(await run(['housekeeping', 'show'], noDb)).toBe(2)
    expect(noDb.errors.join('\n')).toMatch(/DATABASE_URL/)
    expect(() => encodeSetting('housekeeping.cron_history_hours', 0, false)).toThrow(/from 1 hour/)
    expect(() => encodeSetting('housekeeping.unknown', 1, false)).toThrow(/Unknown housekeeping setting/)
  })

  it('summarises for status', () => {
    const line = housekeepingSummary({
      settings: HOUSEKEEPING_DEFAULTS, stored: [], runs: [], pg_cron_jobs: null, checked_at: '',
      tables: [{ table: 'cron.job_run_details', installed: true, purged_by: 'housekeeping', rule: '', rows: 1200, dead_rows: 0, total_bytes: 600 * 1024 }],
    })
    expect(line).toBe('on, every 60 min, run history 1 day · no pass yet · cron history 600 kB / ~1,200 rows')
  })
})

/** run(), retried while another pass (a parallel DB test, the stack's pg_cron job) holds the pass lock. */
async function runPass(argv: string[], out: ReturnType<typeof io>): Promise<number> {
  for (let attempt = 0; ; attempt++) {
    out.lines.length = 0
    const code = await run(argv, out)
    const busy = out.lines.some((l) => l.includes('Skipped: busy') || l.includes('"reason": "busy"'))
    if (!busy || attempt >= 40) return code
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

describe.skipIf(!DB_URL)('usertasks-admin housekeeping (local DB)', () => {
  const env = { DATABASE_URL: DB_URL }
  const db = new Client({ connectionString: DB_URL })
  const stored = async (key: string) => {
    const { rows } = await db.query('SELECT value FROM public.instance_settings WHERE key = $1', [key])
    return rows[0]?.value
  }

  afterAll(async () => {
    await run(['housekeeping', 'set', 'cron_history_hours', 'default'], io(env))
    await run(['housekeeping', 'set', 'enabled', 'default'], io(env))
    await db.end().catch(() => undefined)
  })

  it('set writes validated values and `default` removes the row', async () => {
    await db.connect()
    const set = io(env)
    expect(await run(['housekeeping', 'set', 'cron_history', '2d'], set)).toBe(0)
    expect(set.lines.join('\n')).toMatch(/housekeeping.cron_history_hours = 48 \(2 days\)/)
    expect(await stored('housekeeping.cron_history_hours')).toBe(48)

    const bad = io(env)
    expect(await run(['housekeeping', 'set', 'cron_history', '91d'], bad)).toBe(2)
    expect(bad.errors.join('\n')).toMatch(/from 1 hour to 90 days/)
    expect(await stored('housekeeping.cron_history_hours')).toBe(48)

    expect(await run(['housekeeping', 'set', 'enabled', 'off'], io(env))).toBe(0)
    expect(await stored('housekeeping.enabled')).toBe(false)

    const show = io(env)
    expect(await run(['housekeeping', 'show', '--json'], show)).toBe(0)
    const status = JSON.parse(show.lines.join('\n'))
    expect(status.settings).toMatchObject({ enabled: false, cron_history_hours: 48 })
    expect(status.findings[0]).toMatchObject({ level: 'warn', name: 'housekeeping' })

    expect(await run(['housekeeping', 'set', 'enabled', 'default'], io(env))).toBe(0)
    expect(await stored('housekeeping.enabled')).toBeUndefined()
  })

  it('run --dry-run reports per table and records nothing; run records a cli pass', async () => {
    const count = async () => Number((await db.query('SELECT count(*) AS n FROM app_cron.housekeeping_runs')).rows[0].n)
    const before = await count()
    const dry = io(env)
    expect(await runPass(['housekeeping', 'run', '--dry-run'], dry)).toBe(0)
    expect(dry.lines.join('\n')).toMatch(/app_cache\.entries\s+\d+ to delete/)
    expect(dry.lines.at(-1)).toMatch(/^Dry run: /)
    expect(await count()).toBe(before)

    const real = io(env)
    expect(await runPass(['housekeeping', 'run', '--json', '--actor', 'cli-test'], real)).toBe(0)
    const result = JSON.parse(real.lines.join('\n'))
    expect(result).toMatchObject({ trigger: 'cli', actor: 'cli-test', passes: expect.any(Number) })
    expect(Object.keys(result.deleted)).toEqual(expect.arrayContaining(['cron.job_run_details', 'app_cache.entries', 'app_auth.sessions']))
    const { rows: [last] } = await db.query(`SELECT trigger, actor FROM app_cron.housekeeping_runs ORDER BY id DESC LIMIT 1`)
    expect(last).toEqual({ trigger: 'cli', actor: 'cli-test' })
  })

  it('status shows the housekeeping line', async () => {
    const status = io(env)
    await run(['status'], status)
    expect(status.lines.join('\n')).toMatch(/housekeeping\s+on, every \d+ min/)
  })
})
