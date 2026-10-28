import {
  BLOAT_BYTES_PER_ROW,
  BLOAT_MIN_BYTES,
  CRON_HISTORY_WARN_BYTES,
  CRON_HISTORY_WARN_ROWS,
  HOUSEKEEPING_DEFAULTS,
  type HousekeepingSettings,
} from '@/lib/config/housekeeping'

/**
 * Instance housekeeping, the caller side: status and runs of
 * app_cron.run_housekeeping() (migration 20261109500000) through
 *  - a direct Postgres connection (usertasks-admin, doctor): sqlHousekeeping
 *  - the service-role REST client (job registry, Settings → Infrastructure):
 *    rpcHousekeeping
 * Both call the same service_role-only functions,
 * public.instance_housekeeping_status() / instance_housekeeping_run().
 */

export type HousekeepingTrigger = 'tick' | 'tick-daily' | 'cli' | 'ui'

export interface HousekeepingRunOptions {
  trigger: HousekeepingTrigger
  /** Ignore the interval (manual runs, the daily pass). */
  force?: boolean
  /** Count what would be deleted; nothing is deleted or recorded. */
  dryRun?: boolean
  actor?: string | null
  /** The pass stops starting batches after this long (1 s – 120 s). */
  budgetMs?: number
}

export type HousekeepingNote = 'not_installed' | 'no_privilege' | 'lock_timeout' | 'budget'

export interface HousekeepingRunResult {
  status: 'ok' | 'partial' | 'skipped'
  /** Why a pass was skipped: disabled, busy (another pass is running) or not_due. */
  reason?: 'disabled' | 'busy' | 'not_due'
  trigger?: string
  actor?: string | null
  dry_run?: boolean
  started_at?: string
  finished_at?: string
  duration_ms?: number
  /** Rows deleted (or, dry run, that would be) per table. */
  deleted: Record<string, number>
  notes: Record<string, HousekeepingNote>
  /** The budget ran out with rows left: the next pass continues. */
  more: boolean
  settings?: HousekeepingSettings
}

export interface HousekeepingTable {
  table: string
  installed: boolean
  /** Who purges it: this pass, the daily cleanup-logs job, or nobody (kept). */
  purged_by: 'housekeeping' | 'cleanup-logs' | 'kept'
  rule: string
  /** Estimated live rows (statistics). */
  rows: number | null
  dead_rows: number | null
  total_bytes: number | null
}

export interface HousekeepingStoredSetting {
  key: string
  value: unknown
  updated_at: string
  updated_by: string | null
}

export interface HousekeepingRun {
  trigger: string
  actor: string | null
  status: 'ok' | 'partial'
  started_at: string
  finished_at: string
  duration_ms: number
  deleted: Record<string, number>
  notes: Record<string, HousekeepingNote>
  more: boolean
}

export interface HousekeepingStatus {
  settings: HousekeepingSettings
  stored: HousekeepingStoredSetting[]
  tables: HousekeepingTable[]
  runs: HousekeepingRun[]
  /** usertasks-housekeeping / usertasks-cron-housekeeping; null without pg_cron. */
  pg_cron_jobs: Array<{ jobname: string; schedule: string; active: boolean }> | null
  checked_at: string
}

export interface HousekeepingClient {
  status(): Promise<HousekeepingStatus>
  run(options: HousekeepingRunOptions): Promise<HousekeepingRunResult>
}

/** Raised when the functions are missing (migration 20261109500000 not applied). */
export class HousekeepingUnavailableError extends Error {
  constructor(message = 'housekeeping is not installed in this database (apply migration 20261109500000_instance_housekeeping)') {
    super(message)
    this.name = 'HousekeepingUnavailableError'
  }
}

function runArgs(options: HousekeepingRunOptions) {
  return {
    p_trigger: options.trigger,
    p_force: options.force === true,
    p_dry_run: options.dryRun === true,
    p_actor: options.actor ?? null,
    p_budget_ms: Math.round(options.budgetMs ?? 20_000),
  }
}

function normaliseRun(raw: unknown): HousekeepingRunResult {
  const r = (raw ?? {}) as Partial<HousekeepingRunResult>
  return { ...r, status: r.status ?? 'ok', deleted: r.deleted ?? {}, notes: r.notes ?? {}, more: r.more === true } as HousekeepingRunResult
}

function normaliseStatus(raw: unknown): HousekeepingStatus {
  const s = (raw ?? {}) as Partial<HousekeepingStatus>
  return {
    settings: { ...HOUSEKEEPING_DEFAULTS, ...(s.settings ?? {}) },
    stored: s.stored ?? [],
    tables: s.tables ?? [],
    runs: s.runs ?? [],
    pg_cron_jobs: s.pg_cron_jobs ?? null,
    checked_at: s.checked_at ?? new Date().toISOString(),
  }
}

interface Sql {
  query<R extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: R[] }>
}

const MISSING_FUNCTION = '42883'

/** Over a direct connection (the role must own the functions or be service_role). */
export function sqlHousekeeping(sql: Sql): HousekeepingClient {
  const guard = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn()
    } catch (error) {
      if ((error as { code?: string }).code === MISSING_FUNCTION) throw new HousekeepingUnavailableError()
      throw error
    }
  }
  return {
    status: () => guard(async () => {
      const { rows } = await sql.query<{ s: unknown }>('SELECT public.instance_housekeeping_status() AS s')
      return normaliseStatus(rows[0]?.s)
    }),
    run: (options) => guard(async () => {
      const a = runArgs(options)
      const { rows } = await sql.query<{ r: unknown }>(
        'SELECT public.instance_housekeeping_run($1, $2, $3, $4, $5) AS r',
        [a.p_trigger, a.p_force, a.p_dry_run, a.p_actor, a.p_budget_ms],
      )
      return normaliseRun(rows[0]?.r)
    }),
  }
}

interface RpcClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>
}

/** Over the service-role REST client. */
export function rpcHousekeeping(db: RpcClient): HousekeepingClient {
  const call = async (fn: string, args?: Record<string, unknown>) => {
    const { data, error } = await db.rpc(fn, args)
    if (error) {
      if (error.code === 'PGRST202' || error.code === MISSING_FUNCTION) throw new HousekeepingUnavailableError()
      throw new Error(error.message)
    }
    return data
  }
  return {
    status: async () => normaliseStatus(await call('instance_housekeeping_status')),
    run: async (options) => normaliseRun(await call('instance_housekeeping_run', runArgs(options))),
  }
}

// ── Reporting ───────────────────────────────────────────────────────────────

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['kB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++ }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

/** Bytes on disk per live row, or null when unknown / empty. */
export function bytesPerRow(table: Pick<HousekeepingTable, 'rows' | 'total_bytes'>): number | null {
  if (!table.total_bytes || !table.rows || table.rows <= 0) return null
  return Math.round(table.total_bytes / table.rows)
}

export function isBloated(table: Pick<HousekeepingTable, 'rows' | 'total_bytes'>): boolean {
  const perRow = bytesPerRow(table)
  return (table.total_bytes ?? 0) >= BLOAT_MIN_BYTES && (perRow === null || perRow >= BLOAT_BYTES_PER_ROW)
}

export interface HousekeepingFinding {
  level: 'ok' | 'warn'
  name: string
  detail: string
}

const SUPABASE_OWNED = new Set(['cron.job_run_details', 'net._http_response'])

/**
 * What doctor / status / the Infrastructure page say about housekeeping:
 * the last pass, and each purged table that is big, has many rows or is
 * mostly dead space.
 */
export function housekeepingFindings(status: HousekeepingStatus, now = Date.now()): HousekeepingFinding[] {
  const findings: HousekeepingFinding[] = []
  const { settings } = status
  const last = status.runs[0]
  if (!settings.enabled) {
    findings.push({ level: 'warn', name: 'housekeeping', detail: 'scheduled housekeeping is off (housekeeping.enabled=false): system tables grow until it is turned back on or run by hand' })
  } else if (!last) {
    findings.push({ level: 'warn', name: 'housekeeping', detail: `no pass recorded yet (runs every ${settings.interval_minutes} min)` })
  } else {
    const ageMin = (now - new Date(last.started_at).getTime()) / 60_000
    const late = ageMin > settings.interval_minutes * 2 + 15
    const deleted = Object.values(last.deleted).reduce((sum, n) => sum + Number(n || 0), 0)
    findings.push({
      level: late || last.status !== 'ok' ? 'warn' : 'ok',
      name: 'housekeeping',
      detail: `last pass ${Math.round(ageMin)} min ago (${last.trigger}, ${last.status}, ${deleted} row${deleted === 1 ? '' : 's'} deleted)`
        + (late ? `; expected every ${settings.interval_minutes} min — is the scheduler running?` : '')
        + (last.more ? '; rows remain for the next pass' : ''),
    })
  }

  for (const table of status.tables) {
    if (!table.installed || table.purged_by === 'kept') continue
    const big = (table.total_bytes ?? 0) >= CRON_HISTORY_WARN_BYTES
    const many = (table.rows ?? 0) >= CRON_HISTORY_WARN_ROWS
    const bloated = isBloated(table)
    if (!big && !many && !bloated) continue
    const perRow = bytesPerRow(table)
    const size = `${formatBytes(table.total_bytes)} for ~${(table.rows ?? 0).toLocaleString('en-US')} rows${perRow ? ` (${formatBytes(perRow)}/row)` : ''}`
    let hint = table.purged_by === 'housekeeping'
      ? 'housekeeping keeps the row count small and autovacuum reuses the space'
      : 'purged by the daily cleanup-logs job'
    if (bloated) {
      hint += SUPABASE_OWNED.has(table.table)
        ? '; the table is owned by the platform (supabase_admin on Supabase): returning the space to the OS needs VACUUM FULL by its owner — ask Supabase support'
        : '; returning the space to the OS needs VACUUM FULL (or pg_repack) by the table owner'
    }
    // Free space left by earlier purges of a housekeeping-managed table is
    // reused by new rows, so it only costs disk: report it, don't warn.
    const reusedSpaceOnly = bloated && !many && table.purged_by === 'housekeeping'
    if (reusedSpaceOnly) hint += '; no action needed unless you want the disk space back'
    findings.push({ level: reusedSpaceOnly ? 'ok' : 'warn', name: table.table, detail: `${bloated ? 'bloated: ' : ''}${size}; ${hint}` })
  }
  return findings
}
