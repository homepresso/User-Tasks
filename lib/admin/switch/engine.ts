import path from 'node:path'
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
import { pgDump, writeJson } from './backup'
import {
  cancelRequested, clearJobSecrets, flushProgress, getRecord, hasSwitchLog, hasSwitchLogExtras, insertRecord, newRecord, newSwitchId, readMirroredRecord, setRecordStatus,
  startQueuedRecord, tryLockSwitches, unlockSwitches, updateRecord,
} from './log'
import { SwitchPaused, type AreaSwitch, type PreflightCheck, type RollbackContext, type StepRecord, type SwitchContext, type SwitchOptions, type SwitchRecordRow, type SwitchStep } from './types'

/**
 * Switch / rollback runner shared by every area:
 *
 *   pre-flight → plan (dry run stops here; without --yes it refuses) →
 *   switch record (status running) → config snapshot + data backup →
 *   steps in order (each recorded) → settings / env changes → succeeded.
 *
 * A failed step leaves the provider setting untouched (it is written last),
 * records the failure and exits 1; steps are idempotent, so the fix is to
 * re-run the same command. `rollback <id>` restores the config snapshot and
 * asks the area to undo its data changes where it can.
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

function targetConfigFor(config: InstanceConfig, area: ProviderArea, to: string, options: SwitchOptions): InstanceConfig {
  const current = config.providers[area]
  return {
    ...config,
    providers: {
      ...config.providers,
      [area]: { area, id: to, source: 'settings', options: { ...current.options, ...options.set, ...options.secret } },
    },
  }
}

function printChecks(io: EngineIO, checks: PreflightCheck[]): void {
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

export interface RunSwitchParams {
  db: SqlClient
  dbUrl: string
  area: ProviderArea
  plan: AreaSwitch
  options: SwitchOptions
  io: EngineIO
  /**
   * Continue this record instead of starting a new one: a switch queued from
   * Settings → Infrastructure, or one whose runner was interrupted. Its id
   * and backup directory are kept, the backup is not taken again once it
   * was, and steps already done are skipped (each step is idempotent anyway).
   */
  resume?: SwitchRecordRow
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

const PROGRESS_FLUSH_MS = 2_000

export async function runSwitch({ db, dbUrl, area, plan, options, io: outer, resume }: RunSwitchParams): Promise<SwitchResult> {
  const name = areaName(area)
  // Every line also goes to the record's log (Settings → Infrastructure shows it live).
  const lines: string[] = resume?.log ? [...resume.log] : []
  const warnings: string[] = []
  const io: EngineIO = {
    log: (line) => { lines.push(line); outer.log(line) },
    warn: (line) => { lines.push(line); warnings.push(line); outer.warn(line) },
  }
  if (!(PROVIDER_IDS[area] as readonly string[]).includes(options.to)) {
    io.warn(`Unknown ${name} provider "${options.to}". Choose one of: ${PROVIDER_IDS[area].join(', ')}`)
    return { code: 2, switchId: null, preflight: [], record: null, plan: null }
  }
  const { config, rows: settingsBefore } = await loadInstanceConfig(db, io.warn)
  const from = resume?.from_provider ?? config.providers[area].id
  if (from === options.to && !options.force && !plan.sameProviderAllowed && !resume) {
    io.log(`${name} already uses ${from} (${config.providers[area].source}). Nothing to do (--force re-runs the switch steps).`)
    return { code: 0, switchId: null, preflight: [], record: null, plan: null }
  }
  const unsupported = plan.supports(from, options.to)
  if (unsupported) {
    io.warn(unsupported)
    return { code: 2, switchId: null, preflight: [], record: null, plan: null }
  }

  const switchId = resume?.id ?? newSwitchId()
  const ctx: SwitchContext = {
    db, dbUrl, area, from, to: options.to, options, config,
    targetConfig: targetConfigFor(config, area, options.to, options),
    settingsBefore,
    switchId,
    backupDir: resume?.backup_dir ?? path.resolve(/*turbopackIgnore: true*/ options.backupRoot, switchId),
    log: io.log,
    warn: io.warn,
    envChanges: {},
    notes: [],
    rollbackData: { ...(resume?.config_before?.rollback ?? {}) },
    cleanup: [],
    progress: () => undefined,
    persist: async () => undefined,
  }
  const mutating = !options.dryRun && !options.preflightOnly && options.yes
  let locked = false

  try {
    if (mutating) {
      locked = await tryLockSwitches(db)
      if (!locked) {
        io.warn('Another provider switch or rollback is running against this database: wait for it to finish (usertasks-admin history).')
        return { code: 2, switchId: null, preflight: [], record: null, plan: null }
      }
    }
    io.log(`Switch ${name}: ${from} → ${options.to}${options.dryRun ? ' (dry run)' : ''}`)
    io.log('Pre-flight:')
    const checks = await plan.preflight(ctx)
    if (!options.dryRun && !(await hasSwitchLog(db))) {
      checks.push({ name: 'switch log', severity: 'error', detail: 'instance_provider_switches missing: apply the migrations first (usertasks-admin db migrate)' })
    }
    printChecks(io, checks)
    const refuse = async (detail: string) => {
      // A queued switch that can't start says why in its record.
      if (resume && mutating) {
        Object.assign(resume, { status: 'failed', error: detail, finished_at: new Date().toISOString(), log: lines })
        await updateRecord(db, resume).catch(() => undefined)
      }
    }
    if (checks.some((c) => c.severity === 'error')) {
      io.warn('Pre-flight failed: nothing was changed.')
      await refuse(`Pre-flight failed: ${checks.filter((c) => c.severity === 'error').map((c) => `${c.name}: ${c.detail}`).join('; ')}`)
      return { code: 2, switchId: null, preflight: checks, record: null, plan: null }
    }
    if (options.preflightOnly) return { code: 0, switchId: null, preflight: checks, record: null, plan: null }

    const steps = plan.steps(ctx)
    let settings: ReturnType<typeof plannedSettings>
    try {
      settings = plannedSettings(ctx, plan)
    } catch (error) {
      io.warn((error as Error).message)
      await refuse((error as Error).message)
      return { code: 2, switchId: null, preflight: checks, record: null, plan: null }
    }
    for (const option of [...Object.keys(options.set), ...Object.keys(options.secret)]) {
      const envName = (await import('@/lib/config')).PROVIDER_OPTION_ENV[area]?.[option]
      if (envName && process.env[envName]) io.warn(`  note: ${envName} is set in the environment and overrides ${area}.${option}`)
    }

    io.log('Plan:')
    const summary: SwitchPlanSummary = {
      area, from, to: options.to, steps: [], backupDir: ctx.backupDir, warnings,
      settings: settings.rows.map((r) => ({ key: r.key, value: r.secret ? null : typeof r.value === 'string' ? r.value : JSON.stringify(r.value), secret: r.secret })),
      env: settings.env,
      dataMoving: DATA_MOVING_AREAS.includes(area),
    }
    for (const [i, step] of steps.entries()) {
      const detail = options.dryRun && step.plan ? await step.plan(ctx) : undefined
      summary.steps.push({ id: step.id, title: step.title, ...(detail ? { detail } : {}) })
      io.log(`  ${i + 1}. ${step.title}${detail ? ` — ${detail}` : ''}`)
    }
    const configLine = [
      ...settings.rows.map((r) => `${r.key} = ${r.secret ? '(encrypted)' : JSON.stringify(r.value)}`),
      ...Object.entries(settings.env).map(([k, v]) => `env ${k}=${v}`),
    ]
    summary.steps.push({ id: ENGINE_STEP_CONFIG, title: 'Apply config', detail: configLine.length ? configLine.join(', ') : 'nothing to write' })
    io.log(`  ${steps.length + 1}. Apply config: ${configLine.length ? configLine.join(', ') : 'nothing to write'}`)
    io.log(`Backup: ${ctx.backupDir}`)

    if (options.dryRun) {
      io.log('Dry run: nothing was changed.')
      return { code: 0, switchId: null, preflight: checks, record: null, plan: summary }
    }
    if (!options.yes) {
      io.warn('Refusing to switch without --yes (review the plan above, or run with --dry-run for details).')
      return { code: 2, switchId: null, preflight: checks, record: null, plan: summary }
    }

    const freshSteps = (): StepRecord[] => [...steps.map((s) => ({ id: s.id, title: s.title, status: 'pending' as const })), { id: ENGINE_STEP_CONFIG, title: 'Apply config', status: 'pending' }]
    let record: SwitchRecordRow
    if (resume) {
      record = resume
      const known = new Map((record.steps ?? []).map((s) => [s.id, s]))
      record.steps = freshSteps().map((s) => (known.get(s.id)?.status === 'done' ? known.get(s.id)! : s))
      record.status = 'running'
      record.error = null
      record.finished_at = null
      record.backup_dir = ctx.backupDir
      record.host = (await import('node:os')).hostname()
      record.config_before ??= { settings: settingsBefore, env: envProviderVars() }
      if (!record.config_before.backed_up_at) record.started_at = new Date().toISOString()
      record.log = lines
      writeJson(ctx.backupDir, 'config.json', record.config_before)
      await startQueuedRecord(db, record)
    } else {
      record = newRecord({
        id: switchId, kind: 'switch', area, from_provider: from, to_provider: options.to, actor: options.actor, backup_dir: ctx.backupDir,
        steps: freshSteps(),
        config_before: { settings: settingsBefore, env: envProviderVars() },
      })
      record.log = lines
      // Config snapshot first: everything after this can be undone from it.
      writeJson(ctx.backupDir, 'config.json', record.config_before)
      await insertRecord(db, record)
    }
    io.log(`Switch id: ${switchId}`)
    ctx.persist = () => {
      record.config_before = { ...record.config_before!, rollback: ctx.rollbackData }
      // One statement, issued synchronously (see flushProgress).
      return db.query('UPDATE public.instance_provider_switches SET config_before = $2::jsonb WHERE id = $1', [record.id, JSON.stringify(record.config_before)]).then(() => undefined)
    }

    let lastFlush = 0
    const withLog = await hasSwitchLogExtras(db)
    const run = async (rec: StepRecord, fn: () => Promise<string | void>) => {
      rec.status = 'running'
      rec.started_at = new Date().toISOString()
      delete rec.progress
      await updateRecord(db, record)
      ctx.progress = (fraction) => {
        rec.progress = Math.max(0, Math.min(1, fraction))
        if (Date.now() - lastFlush < PROGRESS_FLUSH_MS) return
        lastFlush = Date.now()
        flushProgress(db, record, withLog).catch(() => undefined)
      }
      try {
        const detail = await fn()
        rec.status = 'done'
        delete rec.progress
        if (detail) rec.detail = detail
      } catch (error) {
        if (error instanceof SwitchPaused) {
          rec.status = 'pending'
        } else {
          rec.status = 'failed'
          rec.detail = (error as Error).message
        }
        throw error
      } finally {
        ctx.progress = () => undefined
        rec.finished_at = new Date().toISOString()
        await updateRecord(db, record)
      }
    }
    class Cancelled extends Error {}
    const checkCancel = async () => {
      if (await cancelRequested(db, record.id)) throw new Cancelled('Cancelled before the next step (the provider setting was not changed).')
    }

    try {
      // Backups (a failed dump is a warning: the config / table snapshots are what rollback uses).
      if (record.config_before?.backed_up_at) {
        io.log(`  backup: taken ${record.config_before.backed_up_at} (resumed)`)
      } else {
        const backups: string[] = []
        if (plan.backup) backups.push(...(await plan.backup(ctx)))
        if (!options.noDump && (plan.area === 'db' || plan.area === 'auth' || plan.area === 'storage')) {
          const file = path.join(/*turbopackIgnore: true*/ ctx.backupDir, 'database.dump')
          const dump = await pgDump(dbUrl, file)
          if (dump.ok) backups.push(file)
          else io.warn(`  warning: pg_dump backup skipped (${dump.error}); set PG_DUMP or pass --no-dump`)
        }
        for (const file of backups) io.log(`  backup: ${file}`)
        record.config_before = { ...record.config_before!, ...(Object.keys(ctx.rollbackData).length ? { rollback: ctx.rollbackData } : {}), backed_up_at: new Date().toISOString() }
        await db.query('UPDATE public.instance_provider_switches SET config_before = $2::jsonb WHERE id = $1', [record.id, JSON.stringify(record.config_before)])
      }

      for (const [i, step] of steps.entries()) {
        if (record.steps[i].status === 'done') {
          io.log(`[${i + 1}/${steps.length + 1}] ${step.title}… done earlier`)
          continue
        }
        await checkCancel()
        io.log(`[${i + 1}/${steps.length + 1}] ${step.title}…`)
        await run(record.steps[i], async () => {
          const detail = await step.run(ctx)
          if (detail) io.log(`      ${detail}`)
          return detail
        })
      }

      await checkCancel()
      io.log(`[${steps.length + 1}/${steps.length + 1}] Apply config…`)
      await run(record.steps[steps.length], async () => {
        for (const row of settings.rows) await upsertSettingRow(db, row)
        if (settings.rows.length) {
          const warning = await notifyConfigChanged(db, [ctx.config, ctx.targetConfig])
          if (warning) io.warn(`  warning: ${warning}`)
        }
        Object.assign(ctx.envChanges, settings.env)
        return [
          settings.rows.length ? `wrote ${settings.rows.map((r) => r.key).join(', ')}` : '',
          Object.keys(ctx.envChanges).length ? `environment changes required: ${Object.keys(ctx.envChanges).join(', ')}` : '',
        ].filter(Boolean).join('; ') || 'nothing to write'
      })

      record.status = 'succeeded'
      record.config_after = { settings: await readSettingRows(db), env: envProviderVars() }
      record.env_changes = ctx.envChanges
      record.finished_at = new Date().toISOString()
    } catch (error) {
      if (error instanceof SwitchPaused) {
        record.status = 'queued'
        record.error = null
        io.log(`Paused: ${error.message}.`)
        await updateRecord(db, record).catch(() => undefined)
        return { code: 3, switchId, preflight: checks, record, plan: summary }
      }
      const cancelled = error instanceof Cancelled
      record.status = cancelled ? 'cancelled' : 'failed'
      record.error = (error as Error).message
      record.env_changes = ctx.envChanges
      record.finished_at = new Date().toISOString()
      for (const step of record.steps) if (cancelled && step.status === 'pending') step.status = 'skipped'
      if (cancelled) io.warn(`Switch cancelled: ${record.error}`)
      else {
        io.warn(`Switch failed: ${record.error}`)
        io.warn(`The ${name} provider setting was not changed. Fix the cause and re-run the same command (steps are idempotent),`)
      }
      io.warn(`${cancelled ? 'Undo' : 'or undo'} partial data changes with: usertasks-admin rollback ${switchId} --yes`)
      await updateRecord(db, record).catch(() => undefined)
      return { code: cancelled ? 2 : 1, switchId, preflight: checks, record, plan: summary }
    }

    io.log(`Switched ${name} to ${options.to}.`)
    if (Object.keys(ctx.envChanges).length) {
      io.log('Set these in the app environment and restart it:')
      for (const [k, v] of Object.entries(ctx.envChanges)) io.log(`  ${k}=${v}`)
    }
    for (const note of ctx.notes) io.log(note)
    io.log(`Rollback: usertasks-admin rollback ${switchId} --yes`)
    await updateRecord(db, record)
    await clearJobSecrets(db, record.id).catch(() => undefined)
    return { code: 0, switchId, preflight: checks, record, plan: summary }
  } finally {
    for (const close of ctx.cleanup) await close().catch(() => undefined)
    if (locked) await unlockSwitches(db)
  }
}

export interface RunSettingsChangeParams {
  db: SqlClient
  area: ProviderArea
  plan: AreaSwitch
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
export async function runSettingsChange({ db, area, plan, set, secret, unset, actor, dryRun, io: outer }: RunSettingsChangeParams): Promise<SwitchResult> {
  const lines: string[] = []
  const io: EngineIO = { log: (l) => { lines.push(l); outer.log(l) }, warn: (l) => { lines.push(l); outer.warn(l) } }
  const { config, rows: settingsBefore } = await loadInstanceConfig(db, io.warn)
  const current = config.providers[area]
  const options: SwitchOptions = { to: current.id, dryRun, yes: !dryRun, backupRoot: '', set, secret, flags: {}, noDump: true, actor, force: true }
  const targetConfig = targetConfigFor(config, area, current.id, options)
  for (const option of unset) delete (targetConfig.providers[area] as { options: Record<string, unknown> }).options[option]
  const switchId = newSwitchId()
  const ctx: SwitchContext = {
    db, dbUrl: '', area, from: current.id, to: current.id, options, config, targetConfig, settingsBefore, switchId, backupDir: '',
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
    io.log(`Settings ${areaName(area)} (${current.id})${dryRun ? ' (check)' : ''}`)
    io.log('Pre-flight:')
    const checks = await plan.preflight(ctx)
    if (!dryRun && !(await hasSwitchLog(db))) checks.push({ name: 'switch log', severity: 'error', detail: 'instance_provider_switches missing: apply the migrations first (usertasks-admin db migrate)' })
    printChecks(io, checks)
    if (checks.some((c) => c.severity === 'error')) {
      io.warn('Pre-flight failed: nothing was changed.')
      return { code: 2, switchId: null, preflight: checks, record: null, plan: null }
    }
    let rows: SettingRow[]
    try {
      rows = plannedSettings(ctx, { writesProviderSetting: false }).rows
      for (const option of unset) validateSetting(`${area}.${option}`, '')
    } catch (error) {
      io.warn((error as Error).message)
      return { code: 2, switchId: null, preflight: checks, record: null, plan: null }
    }
    const summary: SwitchPlanSummary = {
      area, from: current.id, to: current.id, backupDir: '', env: {}, dataMoving: false, warnings: [],
      settings: rows.map((r) => ({ key: r.key, value: r.secret ? null : String(r.value), secret: r.secret })),
      steps: [{ id: ENGINE_STEP_CONFIG, title: 'Apply settings', detail: [...rows.map((r) => r.key), ...unset.map((o) => `remove ${area}.${o}`)].join(', ') || 'nothing to write' }],
    }
    if (dryRun) return { code: 0, switchId: null, preflight: checks, record: null, plan: summary }

    const record = newRecord({
      id: switchId, kind: 'settings', area, from_provider: current.id, to_provider: current.id, actor, backup_dir: null,
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

export interface RunRollbackParams {
  db: SqlClient
  dbUrl: string
  id: string
  plans: Partial<Record<ProviderArea, AreaSwitch>>
  yes: boolean
  dryRun: boolean
  backupRoot: string
  actor: string
  io: EngineIO
}

export async function runRollback({ db, dbUrl, id, plans, yes, dryRun, backupRoot, actor, io: outer }: RunRollbackParams): Promise<{ code: 0 | 1 | 2; record: SwitchRecordRow | null }> {
  const lines: string[] = []
  const io: EngineIO = { log: (l) => { lines.push(l); outer.log(l) }, warn: (l) => { lines.push(l); outer.warn(l) } }
  const logged = await hasSwitchLog(db)
  const record = (logged ? await getRecord(db, id) : null) ?? readMirroredRecord(path.resolve(/*turbopackIgnore: true*/ backupRoot, id))
  if (!record) {
    io.warn(`No switch ${id} in this database's switch log or in ${path.resolve(/*turbopackIgnore: true*/ backupRoot, id)}`)
    return { code: 2, record: null }
  }
  if (record.kind === 'rollback') { io.warn(`${id} is a rollback, not a switch`); return { code: 2, record } }
  if (record.status === 'rolled_back') { io.warn(`${id} was already rolled back`); return { code: 2, record } }
  if (record.status === 'queued') { io.warn(`${id} has not started yet: cancel it instead`); return { code: 2, record } }
  if (record.status === 'running') { io.warn(`${id} is still running (or was interrupted): re-run the switch, or pass the id again once it has stopped`); }

  const before = record.config_before?.settings ?? []
  const keys = record.config_after ? changedSettingKeys(before, record.config_after.settings) : []
  const current = await readSettingRows(db)
  const drifted = record.config_after ? changedSettingKeys(record.config_after.settings, current).filter((k) => keys.includes(k)) : []
  const name = areaName(record.area)
  io.log(`Rollback ${name} switch ${id}: ${record.to_provider} → ${record.from_provider}${dryRun ? ' (dry run)' : ''}`)
  io.log(`  settings to restore: ${keys.length ? keys.join(', ') : 'none'}`)
  if (drifted.length) io.warn(`  warning: changed since the switch (will be overwritten): ${drifted.join(', ')}`)

  const envChanges: Record<string, string> = {}
  for (const k of Object.keys(record.env_changes ?? {})) {
    const previous = record.config_before?.env?.[k]
    envChanges[k] = previous ?? '(unset)'
  }
  const backupDir = record.backup_dir && (await import('node:fs')).existsSync(record.backup_dir) ? record.backup_dir : null
  const plan = plans[record.area]
  const rctx: RollbackContext = { db, dbUrl, record, backupDir, dryRun, log: io.log, warn: io.warn, envChanges }
  if (dryRun) {
    if (plan?.rollback && record.kind === 'switch') for (const line of await plan.rollback(rctx)) io.log(`  ${line}`)
    io.log('Dry run: nothing was changed.')
    return { code: 0, record }
  }
  if (!yes) {
    io.warn('Refusing to roll back without --yes (or use --dry-run).')
    return { code: 2, record }
  }
  if (!(await tryLockSwitches(db))) {
    io.warn('Another provider switch or rollback is running against this database: wait for it to finish (usertasks-admin history).')
    return { code: 2, record }
  }
  try {
    const rollback = newRecord({
      id: newSwitchId(), kind: 'rollback', area: record.area, from_provider: record.to_provider, to_provider: record.from_provider ?? record.to_provider,
      actor, backup_dir: record.backup_dir, rollback_of: record.id,
      steps: [{ id: 'data', title: 'Undo data changes', status: 'pending' }, { id: 'config', title: 'Restore config', status: 'pending' }],
      config_before: { settings: current, env: envProviderVars() },
    })
    try {
      rollback.steps[0].status = 'running'
      const lines = plan?.rollback && record.kind === 'switch' ? await plan.rollback(rctx) : []
      for (const line of lines) io.log(`  ${line}`)
      rollback.steps[0] = { ...rollback.steps[0], status: 'done', detail: lines.join('; ') || 'nothing to undo' }
      const restored = await restoreSettings(db, before, keys)
      if (restored.length) {
        const warning = await notifyConfigChanged(db, [resolveInstanceConfig(decodeSettings(current)), resolveInstanceConfig(decodeSettings(before))])
        if (warning) io.warn(`  warning: ${warning}`)
      }
      rollback.steps[1] = { ...rollback.steps[1], status: 'done', detail: restored.length ? `restored ${restored.join(', ')}` : 'nothing to restore' }
      rollback.status = 'succeeded'
    } catch (error) {
      rollback.status = 'failed'
      rollback.error = (error as Error).message
    }
    rollback.env_changes = envChanges
    rollback.config_after = { settings: await readSettingRows(db), env: envProviderVars() }
    rollback.finished_at = new Date().toISOString()
    rollback.log = lines
    if (logged) {
      await insertRecord(db, rollback)
      await updateRecord(db, rollback)
      if (rollback.status === 'succeeded') await setRecordStatus(db, record.id, 'rolled_back')
    }
    if (rollback.status === 'failed') {
      io.warn(`Rollback failed: ${rollback.error}`)
      return { code: 1, record: rollback }
    }
    io.log(`Rolled back ${name} to ${record.from_provider}.`)
    if (Object.keys(envChanges).length) {
      io.log('Set these in the app environment and restart it:')
      for (const [k, v] of Object.entries(envChanges)) io.log(v === '(unset)' ? `  unset ${k}` : `  ${k}=${v}`)
    }
    return { code: 0, record: rollback }
  } finally {
    await unlockSwitches(db)
  }
}

/** Decoded current settings (helper for area plans). */
export async function currentSettings(db: SqlClient): Promise<Map<string, unknown>> {
  return decodeSettings(await readSettingRows(db))
}

export type { SwitchStep }
