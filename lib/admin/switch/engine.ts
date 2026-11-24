import { resolveInstanceConfig, type InstanceConfig } from '@/lib/config'
import { PROVIDER_ENV, PROVIDER_IDS, type ProviderArea } from '@/lib/config/schema'
import { areaName } from '@/lib/admin/catalogue'
import {
  changedSettingKeys,
  decodeSettings,
  deleteSetting,
  encodeSetting,
  envProviderVars,
  loadInstanceConfig,
  notifyConfigChanged,
  readSettingRows,
  restoreSettings,
  upsertSettingRow,
  validateSetting,
  type SettingRow,
  type SqlClient,
} from '../ops/instance-db'
import { hasSwitchLog, insertRecord, newRecord, newSwitchId, tryLockSwitches, unlockSwitches, updateRecord } from './log'
import type { AreaSwitch, PreflightCheck, SwitchContext, SwitchOptions, SwitchRecordRow, SwitchStep } from './types'

/**
 * The settings engine (open-source core) and the shared pieces of the
 * provider switch.
 *
 * Core changes the CURRENT provider's settings (runSettingsChange: the
 * area's pre-flight checks against the changed options, then the settings
 * rows, recorded as a `settings` row in the switch log) and, for the free
 * standard-stack changes only (email between SMTP, Resend and log-only:
 * lib/infrastructure/addon.ts), its provider id. Everything else that
 * changes providers — the switch runner with its data copies, backups,
 * background runs and rollback — is the Infrastructure add-on
 * (@usertasks-ext/infrastructure), built on the helpers exported here.
 */

export interface EngineIO {
  log: (line: string) => void
  warn: (line: string) => void
}

export interface SwitchResult {
  /** 0 done / dry run / nothing to do, 1 failed, 2 refused (pre-flight or --yes), 3 paused at the deadline (continues on the next run). */
  code: 0 | 1 | 2 | 3
  switchId: string | null
  preflight: PreflightCheck[]
  record: SwitchRecordRow | null
  /** The plan (dry run, refusal without --yes, and runs that got as far as planning). */
  plan: SwitchPlanSummary | null
}

export const ENGINE_STEP_CONFIG = 'config'

export function targetConfigFor(config: InstanceConfig, area: ProviderArea, to: string, options: SwitchOptions): InstanceConfig {
  const current = config.providers[area]
  return {
    ...config,
    providers: {
      ...config.providers,
      [area]: { area, id: to, source: 'settings', options: { ...current.options, ...options.set, ...options.secret } },
    },
  }
}

export function printChecks(io: EngineIO, checks: PreflightCheck[]): void {
  for (const check of checks) {
    const mark = check.severity === 'ok' ? 'ok  ' : check.severity === 'warn' ? 'warn' : 'FAIL'
    io.log(`  [${mark}] ${check.name}: ${check.detail}`)
  }
}

/** Settings rows the switch writes at the end. */
export function plannedSettings(ctx: Pick<SwitchContext, 'area' | 'to' | 'options' | 'config'>, plan: Pick<AreaSwitch, 'writesProviderSetting'>): { rows: SettingRow[]; env: Record<string, string> } {
  const rows: SettingRow[] = []
  const env: Record<string, string> = {}
  if (plan.writesProviderSetting) {
    if (ctx.config.providers[ctx.area].source === 'env') env[PROVIDER_ENV[ctx.area]] = ctx.to
    else rows.push(encodeSetting(`providers.${ctx.area}`, ctx.to, false))
  }
  for (const [option, value] of Object.entries(ctx.options.set)) rows.push(encodeSetting(`${ctx.area}.${option}`, value, false))
  for (const [option, value] of Object.entries(ctx.options.secret)) rows.push(encodeSetting(`${ctx.area}.${option}`, value, true))
  return { rows, env }
}

/** What a switch would do: the dry run as data (Settings → Infrastructure "Review plan"). */
export interface SwitchPlanSummary {
  area: ProviderArea
  from: string
  to: string
  steps: Array<{ id: string; title: string; detail?: string }>
  /** Settings the switch writes (secret values are never included). */
  settings: Array<{ key: string; value: string | null; secret: boolean }>
  env: Record<string, string>
  backupDir: string
  /** Copies or converts data (backups, a background run, typed confirmation). */
  dataMoving: boolean
  /** Lines printed as warnings (environment overrides, …). */
  warnings: string[]
}

/** Areas whose switch moves data (storage objects, accounts, the database, data keys). */
export const DATA_MOVING_AREAS: readonly ProviderArea[] = ['db', 'auth', 'storage', 'kms']


export interface RunSettingsChangeParams {
  db: SqlClient
  area: ProviderArea
  /** The area's pre-flight checks against the changed configuration (core: lib/admin/switch/settings-checks; the add-on passes its switch plans' checks). */
  preflight: AreaSwitch['preflight']
  /**
   * Also change the provider id (a configuration-only change: no data moves).
   * Core passes it only for free standard-stack changes (isFreeProviderChange);
   * recorded as a `switch` row.
   */
  to?: string
  /** Options to write (plain / encrypted) and to remove. */
  set: Record<string, string>
  secret: Record<string, string>
  unset: string[]
  actor: string
  /** Validate only (pre-flight against the changed options); nothing is written. */
  dryRun: boolean
  io: EngineIO
}

/**
 * Change the current provider's options without switching provider
 * (Settings → Infrastructure "Edit settings"). The area's pre-flight checks
 * run against the changed options first — the same validation as a switch —
 * and the change is recorded as a `settings` row in the switch log, so
 * `rollback <id>` restores the previous values.
 */
export async function runSettingsChange({ db, area, preflight, to, set, secret, unset, actor, dryRun, io: outer }: RunSettingsChangeParams): Promise<SwitchResult> {
  const lines: string[] = []
  const io: EngineIO = { log: (l) => { lines.push(l); outer.log(l) }, warn: (l) => { lines.push(l); outer.warn(l) } }
  const { config, rows: settingsBefore } = await loadInstanceConfig(db, io.warn)
  const current = config.providers[area]
  const target = to ?? current.id
  const switching = target !== current.id
  if (switching && current.source === 'env') {
    io.warn(`The ${areaName(area)} provider is set by ${PROVIDER_ENV[area]} in the environment: change it there (or remove it so the settings can manage it) and restart.`)
    return { code: 2, switchId: null, preflight: [], record: null, plan: null }
  }
  const options: SwitchOptions = { to: target, dryRun, yes: !dryRun, backupRoot: '', set, secret, flags: {}, noDump: true, actor, force: true }
  const targetConfig = targetConfigFor(config, area, target, options)
  for (const option of unset) delete (targetConfig.providers[area] as { options: Record<string, unknown> }).options[option]
  const switchId = newSwitchId()
  const ctx: SwitchContext = {
    db, dbUrl: '', area, from: current.id, to: target, options, config, targetConfig, settingsBefore, switchId, backupDir: '',
    log: io.log, warn: io.warn, envChanges: {}, notes: [], rollbackData: {}, cleanup: [], progress: () => undefined, persist: async () => undefined,
  }
  let locked = false
  try {
    if (!dryRun) {
      locked = await tryLockSwitches(db)
      if (!locked) {
        io.warn('Another provider switch or rollback is running against this database: wait for it to finish.')
        return { code: 2, switchId: null, preflight: [], record: null, plan: null }
      }
    }
    io.log(switching ? `Change ${areaName(area)}: ${current.id} → ${target} (configuration only)${dryRun ? ' (check)' : ''}` : `Settings ${areaName(area)} (${current.id})${dryRun ? ' (check)' : ''}`)
    io.log('Pre-flight:')
    const checks = await preflight(ctx)
    if (!dryRun && !(await hasSwitchLog(db))) checks.push({ name: 'switch log', severity: 'error', detail: 'instance_provider_switches missing: apply the migrations first (usertasks-admin db migrate)' })
    printChecks(io, checks)
    if (checks.some((c) => c.severity === 'error')) {
      io.warn('Pre-flight failed: nothing was changed.')
      return { code: 2, switchId: null, preflight: checks, record: null, plan: null }
    }
    let rows: SettingRow[]
    try {
      rows = plannedSettings(ctx, { writesProviderSetting: switching }).rows
      for (const option of unset) validateSetting(`${area}.${option}`, '')
    } catch (error) {
      io.warn((error as Error).message)
      return { code: 2, switchId: null, preflight: checks, record: null, plan: null }
    }
    const summary: SwitchPlanSummary = {
      area, from: current.id, to: target, backupDir: '', env: {}, dataMoving: false, warnings: [],
      settings: rows.map((r) => ({ key: r.key, value: r.secret ? null : String(r.value), secret: r.secret })),
      steps: [{ id: ENGINE_STEP_CONFIG, title: 'Apply settings', detail: [...rows.map((r) => r.key), ...unset.map((o) => `remove ${area}.${o}`)].join(', ') || 'nothing to write' }],
    }
    if (dryRun) return { code: 0, switchId: null, preflight: checks, record: null, plan: summary }

    const record = newRecord({
      id: switchId, kind: switching ? 'switch' : 'settings', area, from_provider: current.id, to_provider: target, actor, backup_dir: null,
      steps: [{ id: ENGINE_STEP_CONFIG, title: 'Apply settings', status: 'running', started_at: new Date().toISOString() }],
      config_before: { settings: settingsBefore, env: envProviderVars() },
    })
    record.log = lines
    await insertRecord(db, record)
    try {
      for (const row of rows) await upsertSettingRow(db, row)
      for (const option of unset) await deleteSetting(db, `${area}.${option}`)
      const warning = await notifyConfigChanged(db, [config, targetConfig])
      if (warning) io.warn(`  warning: ${warning}`)
      record.steps[0] = { ...record.steps[0], status: 'done', finished_at: new Date().toISOString(), detail: summary.steps[0].detail }
      record.status = 'succeeded'
      io.log(`Saved ${summary.steps[0].detail}.`)
    } catch (error) {
      record.steps[0] = { ...record.steps[0], status: 'failed', finished_at: new Date().toISOString(), detail: (error as Error).message }
      record.status = 'failed'
      record.error = (error as Error).message
      io.warn(`Saving failed: ${record.error}`)
    }
    record.config_after = { settings: await readSettingRows(db), env: envProviderVars() }
    record.finished_at = new Date().toISOString()
    await updateRecord(db, record)
    return { code: record.status === 'succeeded' ? 0 : 1, switchId, preflight: checks, record, plan: summary }
  } finally {
    if (locked) await unlockSwitches(db)
  }
}

/** Decoded current settings (helper for area plans). */
export async function currentSettings(db: SqlClient): Promise<Map<string, unknown>> {
  return decodeSettings(await readSettingRows(db))
}

export type { SwitchStep }
