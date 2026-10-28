import type { InstanceConfig } from '@/lib/config'
import type { ProviderArea } from '@/lib/config/schema'
import type { SettingRow, SqlClient } from '../ops/instance-db'

/**
 * `usertasks-admin switch` building blocks. An area's switch is a plan:
 * pre-flight checks, an optional data backup, ordered steps (each
 * idempotent, so a failed run is fixed and simply re-run), the settings to
 * write at the end, and how to undo its data changes on `rollback`.
 */

export interface SwitchOptions {
  to: string
  dryRun: boolean
  yes: boolean
  /** Root directory for backups (each switch gets <root>/<switch id>). */
  backupRoot: string
  /** Provider options to write as `<area>.<option>` settings (plain). */
  set: Record<string, string>
  /** Provider options to write encrypted. */
  secret: Record<string, string>
  /** Area-specific flags (--target-url, --map, --bucket, …). */
  flags: Record<string, string | boolean | string[] | undefined>
  /** Skip the pg_dump backup (the config / table snapshots are always taken). */
  noDump: boolean
  actor: string
  /** Switch even when the area already uses the target provider. */
  force: boolean
  /** Stop after the pre-flight checks (Settings → Infrastructure "Test connection"). */
  preflightOnly?: boolean
  /**
   * Epoch ms: steps that support it (the database copy) pause once reached;
   * the switch goes back to `queued` and continues on the next run (chunked
   * background switches on serverless).
   */
  deadline?: number
}

/** Thrown by a step that stopped at the deadline with its progress saved: the switch pauses (status queued). */
export class SwitchPaused extends Error {
  constructor(message = 'time budget used: continues on the next run') {
    super(message)
    this.name = 'SwitchPaused'
  }
}

export type PreflightSeverity = 'ok' | 'warn' | 'error'

export interface PreflightCheck {
  name: string
  severity: PreflightSeverity
  detail: string
}

export interface StepRecord {
  id: string
  title: string
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped'
  detail?: string
  /** 0–1 while a long step runs (storage copy). */
  progress?: number
  started_at?: string
  finished_at?: string
}

export interface SwitchContext {
  db: SqlClient
  /** Connection string of `db` (pg_dump, second connections). */
  dbUrl: string
  area: ProviderArea
  from: string
  to: string
  options: SwitchOptions
  config: InstanceConfig
  /** Config as it will be after the switch (target provider + --set options). */
  targetConfig: InstanceConfig
  settingsBefore: SettingRow[]
  switchId: string
  backupDir: string
  log: (line: string) => void
  warn: (line: string) => void
  /** Environment changes to print (and record) instead of / in addition to settings. */
  envChanges: Record<string, string>
  /** Notes printed after a successful switch (redirect URIs, restarts). */
  notes: string[]
  /** Area data kept in the switch record for rollback (small; big data goes to backupDir). */
  rollbackData: Record<string, unknown>
  /** Close extra resources (second connections) at the end. */
  cleanup: Array<() => Promise<void>>
  /** Progress of the running step (0–1), persisted to the switch log every few seconds. */
  progress: (fraction: number) => void
  /** Save rollbackData in the switch record now (steps that resume from it, like the database copy). */
  persist: () => Promise<void>
}

export interface SwitchStep {
  id: string
  title: string
  run(ctx: SwitchContext): Promise<string | void>
  /** What the step would do (dry run); default: "would <title>". */
  plan?(ctx: SwitchContext): Promise<string | void>
}

export interface RollbackContext {
  db: SqlClient
  dbUrl: string
  record: SwitchRecordRow
  backupDir: string | null
  dryRun: boolean
  log: (line: string) => void
  warn: (line: string) => void
  envChanges: Record<string, string>
}

export interface AreaSwitch {
  area: ProviderArea
  /** Providers this area can switch to from `from` (null = any listed id). */
  supports(from: string, to: string): string | null
  preflight(ctx: SwitchContext): Promise<PreflightCheck[]>
  /** Data snapshot into ctx.backupDir (after the config snapshot, before any step). */
  backup?(ctx: SwitchContext): Promise<string[]>
  steps(ctx: SwitchContext): SwitchStep[]
  /**
   * Whether the provider id becomes the `providers.<area>` setting. The
   * database is bootstrap config (DATABASE_URL): always printed as env.
   */
  writesProviderSetting: boolean
  /** Switching to the provider already in use is meaningful (the database: a new server). */
  sameProviderAllowed?: boolean
  rollback?(ctx: RollbackContext): Promise<string[]>
}

/**
 * A switch queued from Settings → Infrastructure (migration 20261110000000):
 * the options the background runner passes to runSwitch. `secret` is the
 * JSON of the --secret values encrypted with lib/secret-crypto (never
 * stored in clear text, cleared once the switch has finished).
 */
export interface SwitchJob {
  set: Record<string, string>
  secret: string | null
  flags: SwitchOptions['flags']
  noDump: boolean
  force: boolean
}

export interface SwitchRecordRow {
  id: string
  /** settings: provider options changed without a switch (Settings → Infrastructure). */
  kind: 'switch' | 'rollback' | 'settings'
  area: ProviderArea
  from_provider: string | null
  to_provider: string
  /** queued / cancelled: background switches started from Settings → Infrastructure. */
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'rolled_back'
  rollback_of: string | null
  steps: StepRecord[]
  config_before: { settings: SettingRow[]; env: Record<string, string>; rollback?: Record<string, unknown>; backed_up_at?: string } | null
  config_after: { settings: SettingRow[]; env: Record<string, string> } | null
  env_changes: Record<string, string>
  backup_dir: string | null
  actor: string | null
  host: string | null
  error: string | null
  started_at: string
  finished_at: string | null
  /** Output lines of the run (newest last, capped). Absent before migration 20261110000000. */
  log?: string[]
  job?: SwitchJob | null
  cancel_requested_at?: string | null
}
