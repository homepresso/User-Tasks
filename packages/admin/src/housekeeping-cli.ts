import type pg from 'pg'
import { resolveInstanceConfig } from '@/lib/config'
import {
  HOUSEKEEPING_OPTIONS,
  HOUSEKEEPING_SPECS,
  describeHousekeepingValue,
  housekeepingKey,
  housekeepingOption,
  parseHousekeepingValue,
  type HousekeepingOption,
} from '@/lib/config/housekeeping'
import {
  bytesPerRow,
  formatBytes,
  housekeepingFindings,
  HousekeepingUnavailableError,
  sqlHousekeeping,
  type HousekeepingRunResult,
  type HousekeepingStatus,
} from '@/lib/admin/housekeeping'
import { decodeSettings, deleteSetting, encodeSetting, notifyConfigChanged, readSettingRows, upsertSettingRow } from './instance'

/**
 * usertasks-admin housekeeping show | set <option> <value> | run [--dry-run]
 *
 * The system-table purge (migration 20261109500000): settings in
 * instance_settings (`housekeeping.*`), the pass in the database.
 */

export type HousekeepingAction = 'show' | 'set' | 'run'

/** Extra names operators reach for. */
const ALIASES: Record<string, HousekeepingOption> = {
  interval: 'interval_minutes',
  frequency: 'interval_minutes',
  cron_history: 'cron_history_hours',
  run_history: 'cron_history_hours',
  http_response: 'http_response_minutes',
  http_responses: 'http_response_minutes',
  pg_net: 'http_response_minutes',
}

export function resolveHousekeepingOption(name: string): HousekeepingOption | null {
  const key = name.trim().toLowerCase().replace(/-/g, '_')
  return housekeepingOption(key) ?? ALIASES[key.replace(/^housekeeping\./, '')] ?? null
}

interface IO {
  out: (line: string) => void
  err: (line: string) => void
}

const RUN_PASSES = 10

/** Tables in the order the pass purges them. */
const PURGE_ORDER = [
  'cron.job_run_details', 'net._http_response', 'app_cache.entries',
  'app_auth.sessions', 'app_auth.tokens', 'app_auth.flow_states', 'app_auth.replay_cache', 'app_cron.housekeeping_runs',
]
const tableOrder = (table: string) => (PURGE_ORDER.indexOf(table) + PURGE_ORDER.length + 1) % (PURGE_ORDER.length + 1)

/** The one-line summary `usertasks-admin status` prints. */
export function housekeepingSummary(status: HousekeepingStatus): string {
  const s = status.settings
  const last = status.runs[0]
  const cron = status.tables.find((t) => t.table === 'cron.job_run_details')
  const parts = [s.enabled ? `on, every ${s.interval_minutes} min, run history ${describeHousekeepingValue('cron_history_hours', s.cron_history_hours)}` : 'OFF']
  parts.push(last ? `last pass ${Math.round((Date.now() - new Date(last.started_at).getTime()) / 60_000)} min ago (${last.status})` : 'no pass yet')
  if (cron?.installed) parts.push(`cron history ${formatBytes(cron.total_bytes)} / ~${(cron.rows ?? 0).toLocaleString('en-US')} rows`)
  return parts.join(' · ')
}

function printStatus(io: IO, status: HousekeepingStatus): void {
  const stored = new Map(status.stored.map((row) => [row.key, row]))
  io.out('Housekeeping settings')
  for (const option of HOUSEKEEPING_OPTIONS) {
    const value = status.settings[option]
    const row = stored.get(housekeepingKey(option))
    const shown = HOUSEKEEPING_SPECS[option].kind === 'boolean' ? describeHousekeepingValue(option, value) : `${value} (${describeHousekeepingValue(option, value)})`
    const source = row ? `setting, ${String(row.updated_at).slice(0, 16).replace('T', ' ')}` : 'default'
    io.out(`  ${option.padEnd(22)} ${shown.padEnd(18)} ${source}`)
  }
  if (status.pg_cron_jobs) {
    io.out(`pg_cron: ${status.pg_cron_jobs.length ? status.pg_cron_jobs.map((j) => `${j.jobname} ${j.schedule}${j.active ? '' : ' (inactive)'}`).join(', ') : 'no housekeeping jobs scheduled'}`)
  }
  io.out('Tables')
  for (const t of status.tables) {
    if (!t.installed) { io.out(`  ${t.table.padEnd(34)} not installed`); continue }
    const perRow = bytesPerRow(t)
    io.out(`  ${t.table.padEnd(34)} ${`~${(t.rows ?? 0).toLocaleString('en-US')} rows`.padEnd(16)} ${formatBytes(t.total_bytes).padEnd(9)} ${(perRow ? `${formatBytes(perRow)}/row` : '').padEnd(12)} ${t.purged_by}: ${t.rule}`)
  }
  io.out('Recent passes')
  if (!status.runs.length) io.out('  none yet')
  for (const r of status.runs.slice(0, 5)) {
    const total = Object.values(r.deleted).reduce((sum, n) => sum + Number(n || 0), 0)
    io.out(`  ${r.started_at.slice(0, 19).replace('T', ' ')}  ${r.trigger.padEnd(13)} ${r.status.padEnd(8)} ${String(total).padStart(7)} rows  ${r.duration_ms} ms${r.actor ? `  ${r.actor}` : ''}${r.more ? '  (more left)' : ''}`)
  }
  const warnings = housekeepingFindings(status).filter((f) => f.level === 'warn')
  for (const w of warnings) io.out(`WARN ${w.name}: ${w.detail}`)
}

function printRun(io: IO, result: HousekeepingRunResult, passes: number): void {
  if (result.status === 'skipped') { io.out(`Skipped: ${result.reason}.`); return }
  const verb = result.dry_run ? 'to delete' : 'deleted'
  for (const [table, n] of Object.entries(result.deleted).sort(([a], [b]) => tableOrder(a) - tableOrder(b))) {
    const note = result.notes[table]
    const shown = note === 'not_installed' ? 'not applicable (not installed)'
      : note === 'no_privilege' ? 'not applicable (no privilege to delete)'
      : `${Number(n).toLocaleString('en-US')} ${verb}${note === 'lock_timeout' ? ' (stopped: lock timeout)' : note === 'budget' ? ' (stopped: time budget)' : ''}`
    io.out(`  ${table.padEnd(34)} ${shown}`)
  }
  const total = Object.values(result.deleted).reduce((sum, n) => sum + Number(n || 0), 0)
  io.out(`${result.dry_run ? 'Dry run' : 'Done'}: ${total.toLocaleString('en-US')} row(s) ${verb}${passes > 1 ? ` in ${passes} passes` : ''}, ${result.duration_ms ?? 0} ms${result.more ? ' — rows remain; the scheduled passes (or another run) continue' : ''}.`)
}

function sumRuns(results: HousekeepingRunResult[]): HousekeepingRunResult {
  const last = results[results.length - 1]
  const deleted: Record<string, number> = {}
  for (const r of results) for (const [table, n] of Object.entries(r.deleted)) deleted[table] = (deleted[table] ?? 0) + Number(n || 0)
  return { ...last, deleted, duration_ms: results.reduce((sum, r) => sum + (r.duration_ms ?? 0), 0) }
}

export async function runHousekeepingCommand(
  action: HousekeepingAction,
  args: string[],
  db: pg.Client,
  opts: { json?: boolean; dryRun?: boolean; actor: string },
  io: IO,
): Promise<number> {
  const hk = sqlHousekeeping(db)
  try {
    if (action === 'show') {
      const status = await hk.status()
      if (opts.json) io.out(JSON.stringify({ ...status, findings: housekeepingFindings(status) }, null, 2))
      else printStatus(io, status)
      return 0
    }

    if (action === 'set') {
      const [name, raw] = args
      const option = resolveHousekeepingOption(name ?? '')
      if (!option) { io.err(`Unknown housekeeping setting "${name}". Settings: ${HOUSEKEEPING_OPTIONS.join(', ')}`); return 2 }
      const key = housekeepingKey(option)
      const rows = await readSettingRows(db)
      if (raw === 'default') {
        await deleteSetting(db, key)
        io.out(`${key} reset to the default (${describeHousekeepingValue(option, HOUSEKEEPING_SPECS[option].default)}).`)
      } else {
        let value: boolean | number
        try {
          value = parseHousekeepingValue(option, raw)
        } catch (error) {
          io.err((error as Error).message)
          return 2
        }
        await upsertSettingRow(db, encodeSetting(key, value, false))
        io.out(`${key} = ${JSON.stringify(value)} (${describeHousekeepingValue(option, value)}).`)
      }
      // The pass reads the row itself; app processes only display the value.
      const warning = await notifyConfigChanged(db, [resolveInstanceConfig(decodeSettings(rows))])
      if (warning) io.err(`warning: ${warning}`)
      return 0
    }

    // run: consecutive passes (each its own short transaction) while rows remain.
    const results: HousekeepingRunResult[] = []
    for (let pass = 0; pass < (opts.dryRun ? 1 : RUN_PASSES); pass++) {
      const result = await hk.run({ trigger: 'cli', force: true, dryRun: opts.dryRun, actor: opts.actor, budgetMs: 60_000 })
      results.push(result)
      if (result.status === 'skipped' || !result.more || Object.values(result.notes).includes('lock_timeout')) break
    }
    const total = sumRuns(results)
    if (opts.json) io.out(JSON.stringify({ ...total, passes: results.length }, null, 2))
    else printRun(io, total, results.length)
    return total.status === 'skipped' ? 1 : 0
  } catch (error) {
    if (error instanceof HousekeepingUnavailableError) { io.err(`${error.message}: usertasks-admin db migrate`); return 1 }
    throw error
  }
}
