import type { InstanceConfig } from '@/lib/config'
import { PROVIDER_AREAS, PROVIDER_ENV, PROVIDER_IDS, type ProviderArea } from '@/lib/config/schema'
import { isSecretRef } from '@/lib/config/secret-refs'
import { SECRETS_OPTION_ENV } from '@/lib/providers/secrets/options'
import {
  OPTION_ENV,
  isSecretRefValue,
  parseFieldValue,
  providerFields,
  switchFlagFields,
  type ProviderField,
  type SwitchFlagField,
} from '@/lib/config/provider-forms'
import { AREA_LABELS, areaName, catalogueBadges, catalogueEntry, filterCatalogue, isDefaultProvider } from './catalogue'
import type { InfrastructureViewer } from './instance-admins'
import { changedSettingKeys, loadInstanceConfig, type SettingRow, type SqlClient } from './ops/instance-db'
import { DATA_MOVING_AREAS, runRollback, runSettingsChange, runSwitch, type EngineIO, type SwitchPlanSummary } from './switch/engine'
import { enqueueSwitch, requestCancel, requeueSwitch, switchBusy, SwitchBusyError } from './switch/jobs'
import { getRecord, listRecords, switchRunning } from './switch/log'
import type { AreaSwitch, PreflightCheck, SwitchOptions, SwitchRecordRow } from './switch/types'

/**
 * Settings → Infrastructure: change providers and provider settings from
 * the page. Everything runs through the same engine as `usertasks-admin
 * switch` / `rollback` (lib/admin/switch), with the same pre-flight checks,
 * backups, switch log and rollback:
 *
 *  - config-only switches (realtime, email, secrets, cache, scheduler, the
 *    KMS — whose switch only re-wraps the few data keys) run in the request;
 *  - data-moving switches (storage, auth, the database) are queued and run
 *    by a background runner on a long-running process (lib/admin/switch/jobs);
 *    on serverless the page shows the exact `usertasks-admin` command
 *    instead and follows the switch log while it runs.
 *
 * Instance admins only, re-checked on every call (the server actions in
 * app/actions/infrastructure.ts bind the real dependencies; tests pass
 * fakes). Rate limited per user. Secret values typed into the form are
 * passed to the engine like `--secret` (stored encrypted) and are never
 * sent back: the browser only learns whether a secret is set, or the
 * secret:// reference it points at.
 *
 * Switching from the page can be turned off with INFRA_UI_SWITCHING=false;
 * in the cloud edition it is off unless the `instance.allow_ui_switching`
 * setting is true (`usertasks-admin ui-switching on`), so a hosted
 * production instance is never switched by accident.
 */

export { ALLOW_UI_SWITCHING_SETTING, BACKGROUND_AREAS, applyMode, backgroundRuntime, switchingGate, type ApplyMode, type BackgroundRuntime, type SwitchingGate } from './switch-runtime'
import { applyMode, type ApplyMode, type BackgroundRuntime, type SwitchingGate } from './switch-runtime'

/** Whether a provider can run on this deployment (and why not). */
export function providerAvailability(area: ProviderArea, id: string, env: { supabaseUrl: boolean; serverless: boolean }): { available: boolean; reason: string | null } {
  const entry = catalogueEntry(area, id)
  if (!entry) return { available: false, reason: 'unknown provider' }
  if (entry.requiresSupabase && !env.supabaseUrl) return { available: false, reason: 'needs a Supabase project (SUPABASE_URL is not set)' }
  if (env.serverless && area === 'scheduler' && id === 'worker') return { available: false, reason: 'needs a long-running process: on serverless use pg_cron or an external cron' }
  if (env.serverless && area === 'storage' && id === 'local') return { available: false, reason: 'serverless file systems are not persistent' }
  return { available: true, reason: null }
}

// ── Form ↔ engine options ───────────────────────────────────────────────────

type Env = Record<string, string | undefined>

export interface FieldView extends ProviderField {
  /** Current value of a non-secret option (setting or environment). */
  value: string | null
  /** A secret option has a value (never sent). */
  configured: boolean
  /** A secret option's secret:// reference (a name, not a value). */
  ref: string | null
  /** Environment variable that can set the option. */
  envVar: string | null
  /** Set by that variable: read-only here. */
  envPinned: boolean
}

function optionText(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  return typeof value === 'string' ? value : JSON.stringify(value)
}

export function fieldViews(area: ProviderArea, id: string, config: InstanceConfig, env: Env = process.env): FieldView[] {
  const options = config.providers[area].options
  return providerFields(area, id).map((field) => {
    const envVar = OPTION_ENV[area]?.[field.option] ?? null
    const envPinned = Boolean(envVar && env[envVar] !== undefined && env[envVar] !== '')
    const raw = optionText(options[field.option])
    if (field.secret) {
      return { ...field, value: null, configured: raw !== null, ref: raw !== null && isSecretRef(raw) ? raw.trim() : null, envVar, envPinned }
    }
    return { ...field, value: raw, configured: raw !== null, ref: null, envVar, envPinned }
  })
}

export interface ChangeInput {
  area: ProviderArea
  /** Target provider (a switch) — the current one for a settings change. */
  to: string
  /** Changed fields only: option → typed value. A secret's value or secret:// reference. */
  values: Record<string, string>
  /** Options to remove (settings changes only). */
  clear?: string[]
  /** Switch flags (--target-url, --map, --bucket, …). */
  flags?: Record<string, string | boolean>
}

export interface BuiltOptions {
  set: Record<string, string>
  secret: Record<string, string>
  unset: string[]
  flags: SwitchOptions['flags']
  errors: Record<string, string>
}

/**
 * Validate the form against the target provider's fields and turn it into
 * engine options: plain values → set, secret values → secret (encrypted at
 * rest), secret:// references → set. Environment-pinned options can't be
 * changed here; required options must end up with a value.
 */
export function buildOptions(input: ChangeInput, config: InstanceConfig, kind: 'switch' | 'settings', env: Env = process.env): BuiltOptions {
  const out: BuiltOptions = { set: {}, secret: {}, unset: [], flags: {}, errors: {} }
  const views = new Map(fieldViews(input.area, input.to, config, env).map((f) => [f.option, f]))
  for (const [option, raw] of Object.entries(input.values ?? {})) {
    const field = views.get(option)
    if (!field) { out.errors[option] = `${option} is not an option of ${input.to}`; continue }
    if (typeof raw !== 'string') { out.errors[option] = `${field.label} must be text`; continue }
    if (raw.trim() === '') continue
    if (field.envPinned) { out.errors[option] = `${field.label} is set by the environment variable ${field.envVar}; change it there`; continue }
    if (kind === 'settings' && field.switchOnly) { out.errors[option] = `${field.label} changes which key protects the data keys: use Change provider (it re-wraps them)`; continue }
    const parsed = parseFieldValue(field, raw)
    if (!parsed.ok) { out.errors[option] = parsed.error; continue }
    if (parsed.ref && input.area === 'secrets') { out.errors[option] = 'Secret store options cannot be secret:// references (the store must be reachable first)'; continue }
    if (field.secret && !parsed.ref) out.secret[option] = parsed.value
    else out.set[option] = parsed.value
  }
  for (const option of input.clear ?? []) {
    const field = views.get(option)
    if (kind !== 'settings') { out.errors[option] = 'Options can only be cleared when editing settings'; continue }
    if (!field) { out.errors[option] = `${option} is not an option of ${input.to}`; continue }
    if (field.envPinned) { out.errors[option] = `${field.label} is set by the environment variable ${field.envVar}; change it there`; continue }
    if (field.switchOnly) { out.errors[option] = `${field.label} can only be changed with Change provider`; continue }
    if (option in out.set || option in out.secret) continue
    if (field.configured) out.unset.push(option)
  }
  for (const field of views.values()) {
    if (!field.required) continue
    const given = field.option in out.set || field.option in out.secret
    const cleared = out.unset.includes(field.option)
    // A switch must end up with every required option; a settings change only may not remove one.
    const missing = kind === 'switch' ? !given && !field.configured : !given && cleared
    if (missing) out.errors[field.option] ??= `${field.label} is required for ${input.to}`
  }
  if (kind === 'switch') {
    const flags = new Map(switchFlagFields(input.area).map((f) => [f.flag, f]))
    for (const [flag, value] of Object.entries(input.flags ?? {})) {
      const field = flags.get(flag)
      if (!field) { out.errors[`flag:${flag}`] = `Unknown option ${flag}`; continue }
      if (field.kind === 'boolean') { if (value === true || value === 'true') out.flags[flag] = true; continue }
      const text = String(value ?? '').trim()
      if (!text) continue
      if (field.kind === 'list') { out.flags[flag] = text.split(',').map((s) => s.trim()).filter(Boolean); continue }
      const parsed = parseFieldValue({ label: field.label, kind: field.kind, choices: field.choices }, text)
      if (!parsed.ok) out.errors[`flag:${flag}`] = parsed.error
      else out.flags[flag] = parsed.value
    }
    for (const field of flags.values()) if (field.required && out.flags[field.flag] === undefined) out.errors[`flag:${field.flag}`] = `${field.label} is required`
    if (input.area === 'db' && out.flags['target-url'] === undefined) {
      for (const f of ['target-host', 'target-database', 'target-user']) {
        if (out.flags[f] === undefined) out.errors[`flag:${f}`] = 'Give the target database URL, or host, database and user'
      }
    }
  }
  return out
}

// ── The equivalent CLI command ──────────────────────────────────────────────

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`
}

/** Environment variable a secret value is passed through in the printed command (never the value itself). */
export function secretPlaceholder(area: ProviderArea, option: string): string {
  const name = OPTION_ENV[area]?.[option] ?? `${area}_${option}`.toUpperCase()
  return `NEW_${name.replace(/[^A-Z0-9_]/gi, '_').toUpperCase()}`
}

export interface CliCommand {
  command: string
  /** Environment variables the command reads (secret values: set them first, e.g. from your secret manager). */
  env: string[]
}

/**
 * `usertasks-admin switch …` for the same change. Secret values never appear:
 * they are read from environment variables (`--secret smtp_password="$NEW_SMTP_PASSWORD"`);
 * secret:// references are not secret and are passed as they are.
 */
export function cliCommand(area: ProviderArea, to: string, built: BuiltOptions, extra: { dryRun?: boolean } = {}): CliCommand {
  const parts = ['usertasks-admin', 'switch', areaName(area), '--to', to]
  const env: string[] = []
  for (const [option, value] of Object.entries(built.set)) parts.push('--set', shellQuote(`${option}=${value}`))
  for (const option of Object.keys(built.secret)) {
    const name = secretPlaceholder(area, option)
    env.push(name)
    parts.push('--secret', `${option}="$${name}"`)
  }
  for (const [flag, value] of Object.entries(built.flags)) {
    const field = switchFlagFields(area).find((f) => f.flag === flag)
    if (value === true) parts.push(`--${flag}`)
    else if (typeof value === 'string' && isSecretRefValue(value)) parts.push(`--${flag}`, value)
    else if (flag === 'target-password') env.push('TARGET_DATABASE_PASSWORD') // read from the environment by the CLI
    else if (field?.secret) {
      const name = flag === 'target-url' ? 'TARGET_DATABASE_URL' : `SWITCH_${flag.replace(/-/g, '_').toUpperCase()}`
      env.push(name)
      parts.push(`--${flag}`, `"$${name}"`)
    } else if (flag === 'target-ca' && typeof value === 'string' && value.includes('-----BEGIN')) {
      env.push('TARGET_DATABASE_CA_FILE')
      parts.push('--target-ca', '"$TARGET_DATABASE_CA_FILE"')
    } else if (Array.isArray(value)) for (const item of value) parts.push(`--${flag}`, shellQuote(item))
    else if (typeof value === 'string') parts.push(`--${flag}`, shellQuote(value))
  }
  parts.push(extra.dryRun ? '--dry-run' : '--yes')
  return { command: parts.join(' '), env }
}

// ── Views sent to the page ──────────────────────────────────────────────────

export interface ProviderChoice {
  id: string
  label: string
  badges: string[]
  capabilities: string[]
  switch: 'data' | 'config' | 'none'
  current: boolean
  isDefault: boolean
  available: boolean
  reason: string | null
}

export interface WizardData {
  area: ProviderArea
  name: string
  label: string
  current: { id: string; label: string; source: string; envVar: string | null }
  providers: ProviderChoice[]
  fields: Record<string, FieldView[]>
  flags: SwitchFlagField[]
  mode: ApplyMode
  runtime: BackgroundRuntime
  gate: SwitchingGate
  busy: boolean
  /** Names in the db secret store (secret:// picker), when that is the secret store. */
  secretNames: string[]
  secretsProvider: string
}

export interface SwitchRecordView {
  id: string
  kind: SwitchRecordRow['kind']
  area: ProviderArea
  areaLabel: string
  fromProvider: string | null
  toProvider: string
  status: SwitchRecordRow['status']
  steps: Array<{ id: string; title: string; status: string; detail?: string; progress?: number }>
  log: string[]
  error: string | null
  actor: string | null
  startedAt: string
  finishedAt: string | null
  envChanges: Record<string, string>
  /** Settings the change wrote (secret values never included). */
  changes: Array<{ key: string; before: string | null; after: string | null; secret: boolean }>
  percent: number
  /** Queued from the page (the background runner owns it). */
  background: boolean
  /** status running but nobody holds the switch lock: the runner died (a background switch resumes). */
  interrupted: boolean
  /** Queued again after a time-boxed chunk (continues on the next run). */
  paused: boolean
  cancelRequested: boolean
  canCancel: boolean
  canRollback: boolean
  canRetry: boolean
}

function settingText(row: SettingRow | undefined): string | null {
  if (!row) return null
  if (row.secret) return '(encrypted)'
  return typeof row.value === 'string' ? row.value : JSON.stringify(row.value)
}

export function recordView(record: SwitchRecordRow, runningNow: boolean): SwitchRecordView {
  const steps = (record.steps ?? []).map((s) => ({ id: s.id, title: s.title, status: s.status, ...(s.detail ? { detail: s.detail } : {}), ...(typeof s.progress === 'number' ? { progress: s.progress } : {}) }))
  const total = steps.length || 1
  const done = steps.filter((s) => s.status === 'done' || s.status === 'skipped').length
  const partial = steps.find((s) => s.status === 'running')?.progress ?? 0
  const finished = ['succeeded', 'rolled_back'].includes(record.status)
  const before = record.config_before?.settings ?? []
  const after = record.config_after?.settings ?? []
  const keys = record.config_after ? changedSettingKeys(before, after) : []
  const byKey = (rows: SettingRow[]) => new Map(rows.map((r) => [r.key, r]))
  const b = byKey(before)
  const a = byKey(after)
  const background = Boolean(record.job)
  const interrupted = record.status === 'running' && !runningNow
  return {
    id: record.id,
    kind: record.kind,
    area: record.area,
    areaLabel: AREA_LABELS[record.area] ?? record.area,
    fromProvider: record.from_provider,
    toProvider: record.to_provider,
    status: record.status,
    steps,
    log: (record.log ?? []).slice(-200),
    error: record.error,
    actor: record.actor,
    startedAt: record.started_at,
    finishedAt: record.finished_at,
    envChanges: record.env_changes ?? {},
    changes: keys.map((key) => ({ key, before: settingText(b.get(key)), after: settingText(a.get(key)), secret: Boolean(b.get(key)?.secret || a.get(key)?.secret) })),
    percent: finished ? 100 : Math.round(((done + partial) / total) * 100),
    background,
    interrupted,
    paused: record.status === 'queued' && steps.some((s) => s.status === 'done' || typeof s.progress === 'number'),
    cancelRequested: Boolean(record.cancel_requested_at),
    canCancel: record.status === 'queued' || (record.status === 'running' && !record.cancel_requested_at),
    canRollback: record.kind !== 'rollback' && ['succeeded', 'failed', 'cancelled'].includes(record.status),
    canRetry: background && ['failed', 'cancelled'].includes(record.status),
  }
}

// ── Actions ─────────────────────────────────────────────────────────────────

export interface InfrastructureSwitchDeps {
  canView: (user: InfrastructureViewer | null | undefined) => Promise<boolean>
  /** A direct connection to the app database for the call (throws NoDatabaseError without DATABASE_URL). */
  withDb: <T>(fn: (db: SqlClient, dbUrl: string) => Promise<T>) => Promise<T>
  /** true = allowed. */
  rateLimit: (key: string, max: number) => Promise<boolean>
  gate: (db: SqlClient) => Promise<SwitchingGate>
  runtime: () => BackgroundRuntime
  /** Start the background runner in this process (after a switch was queued). */
  kick: () => void
  plans: Record<ProviderArea, AreaSwitch>
  backupRoot: string
  /** Drop this process's cached settings / health after a change. */
  invalidate: () => void
  /** Resolve a secret:// reference through the configured store (never returns the value). */
  checkSecretRef: (config: InstanceConfig, ref: string) => Promise<{ ok: boolean; detail: string }>
  env?: Env
  log?: (line: string) => void
}

export class NoDatabaseError extends Error {
  constructor() {
    super('Changing providers from this page uses a direct PostgreSQL connection (DATABASE_URL), which this deployment does not have (the Supabase provider does not otherwise need one). Use usertasks-admin switch where DATABASE_URL is set.')
    this.name = 'NoDatabaseError'
  }
}

export type ActionResult<T> = ({ ok: true } & T) | { ok: false; error: string; fieldErrors?: Record<string, string>; lines?: string[] }

const DENIED = { ok: false as const, error: 'Only instance administrators can change infrastructure.' }
const RATE_LIMITED = { ok: false as const, error: 'Too many requests: wait a minute and try again.' }

function actorOf(user: InfrastructureViewer): string {
  return `${user.email ?? user.id} (Settings → Infrastructure)`
}

function isArea(value: unknown): value is ProviderArea {
  return typeof value === 'string' && (PROVIDER_AREAS as readonly string[]).includes(value)
}

function isProvider(area: ProviderArea, value: unknown): value is string {
  return typeof value === 'string' && (PROVIDER_IDS[area] as readonly string[]).includes(value)
}

async function guard<T>(
  user: InfrastructureViewer | null | undefined,
  deps: InfrastructureSwitchDeps,
  limit: { key: string; max: number } | null,
  fn: (user: InfrastructureViewer) => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  if (!user || !(await deps.canView(user))) return DENIED
  if (limit && !(await deps.rateLimit(`infra:${limit.key}:${user.id}`, limit.max))) return RATE_LIMITED
  try {
    return await fn(user)
  } catch (error) {
    if (error instanceof NoDatabaseError || error instanceof SwitchBusyError) return { ok: false, error: error.message }
    ;(deps.log ?? console.error)(`[infrastructure] ${(error as Error).stack ?? error}`)
    return { ok: false, error: `Failed: ${(error as Error).message}` }
  }
}

async function requireGate(db: SqlClient, deps: InfrastructureSwitchDeps): Promise<ActionResult<object> | null> {
  const gate = await deps.gate(db)
  return gate.enabled ? null : { ok: false, error: gate.reason ?? 'Changing providers from this page is turned off.' }
}

function capture(): EngineIO & { lines: string[] } {
  const lines: string[] = []
  return { lines, log: (l) => lines.push(l), warn: (l) => lines.push(l) }
}

function secretNames(rows: SettingRow[]): string[] {
  return rows.filter((r) => r.key.startsWith('secrets.') && !(r.key.slice('secrets.'.length) in SECRETS_OPTION_ENV)).map((r) => r.key.slice('secrets.'.length)).sort()
}

export async function loadWizardAs(user: InfrastructureViewer | null | undefined, areaInput: unknown, deps: InfrastructureSwitchDeps): Promise<ActionResult<{ wizard: WizardData }>> {
  return guard(user, deps, { key: 'read', max: 120 }, async () => {
    if (!isArea(areaInput)) return { ok: false, error: 'Unknown area' }
    const area = areaInput
    return deps.withDb(async (db) => {
      const env = deps.env ?? process.env
      const { config, rows } = await loadInstanceConfig(db)
      const current = config.providers[area]
      const runtime = deps.runtime()
      const serverless = !runtime.available
      const providers: ProviderChoice[] = filterCatalogue({ area }).map((entry) => ({
        id: entry.id, label: entry.label, badges: catalogueBadges(entry), capabilities: entry.capabilities, switch: entry.switch,
        current: entry.id === current.id, isDefault: isDefaultProvider(area, entry.id),
        ...providerAvailability(area, entry.id, { supabaseUrl: Boolean(config.bootstrap.supabase.url), serverless }),
      }))
      const fields = Object.fromEntries(providers.map((p) => [p.id, fieldViews(area, p.id, config, env)]))
      const entry = catalogueEntry(area, current.id)
      return {
        ok: true,
        wizard: {
          area, name: areaName(area), label: AREA_LABELS[area],
          current: { id: current.id, label: entry?.label ?? current.id, source: current.source, envVar: current.source === 'env' ? PROVIDER_ENV[area] : null },
          providers, fields, flags: switchFlagFields(area), mode: applyMode(area, runtime), runtime,
          gate: await deps.gate(db), busy: await switchBusy(db),
          secretNames: config.providers.secrets.id === 'db' ? secretNames(rows) : [],
          secretsProvider: config.providers.secrets.id,
        },
      }
    })
  })
}

function parseChange(input: unknown): ChangeInput | string {
  const raw = (input ?? {}) as Partial<ChangeInput>
  if (!isArea(raw.area)) return 'Unknown area'
  if (!isProvider(raw.area, raw.to)) return `Unknown ${areaName(raw.area)} provider`
  const values = raw.values && typeof raw.values === 'object' ? raw.values : {}
  const flags = raw.flags && typeof raw.flags === 'object' ? raw.flags : {}
  const clear = Array.isArray(raw.clear) ? raw.clear.filter((c): c is string => typeof c === 'string') : []
  return { area: raw.area, to: raw.to, values: values as Record<string, string>, flags: flags as Record<string, string | boolean>, clear }
}

export interface PlanResult {
  preflight: PreflightCheck[]
  plan: SwitchPlanSummary | null
  /** The engine's output, exactly as `usertasks-admin switch --dry-run` prints it. */
  lines: string[]
  mode: ApplyMode
  cli: CliCommand
  /** Typed confirmation needed to apply (data-moving switches): the target provider id. */
  confirmPhrase: string | null
  passed: boolean
}

/**
 * Test connection (pre-flight only) or Review plan (the full dry run) for a
 * proposed switch. Nothing is saved; the proposed options exist only in the
 * engine's target config for the call.
 */
export async function previewSwitchAs(user: InfrastructureViewer | null | undefined, input: unknown, what: 'test' | 'plan', deps: InfrastructureSwitchDeps): Promise<ActionResult<PlanResult>> {
  return guard(user, deps, { key: what, max: 20 }, async (viewer) => {
    const change = parseChange(input)
    if (typeof change === 'string') return { ok: false, error: change }
    return deps.withDb(async (db, dbUrl) => {
      const denied = await requireGate(db, deps)
      if (denied) return denied as ActionResult<PlanResult>
      const { config } = await loadInstanceConfig(db)
      const built = buildOptions(change, config, 'switch', deps.env)
      if (Object.keys(built.errors).length) return { ok: false, error: 'Some values need attention.', fieldErrors: built.errors }
      const io = capture()
      const options: SwitchOptions = {
        // Test connection is the pre-flight alone, run as for real (email sends its test message); nothing is written either way.
        to: change.to, dryRun: what === 'plan', yes: false, backupRoot: deps.backupRoot, set: built.set, secret: built.secret,
        flags: built.flags, noDump: false, actor: actorOf(viewer), force: change.to === config.providers[change.area].id, preflightOnly: what === 'test',
      }
      const result = await runSwitch({ db, dbUrl, area: change.area, plan: deps.plans[change.area], options, io })
      const mode = applyMode(change.area, deps.runtime())
      return {
        ok: true,
        preflight: result.preflight,
        plan: result.plan,
        lines: io.lines,
        mode,
        cli: cliCommand(change.area, change.to, built),
        confirmPhrase: DATA_MOVING_AREAS.includes(change.area) ? change.to : null,
        passed: result.code === 0,
      }
    })
  })
}

export interface ApplyResult {
  mode: ApplyMode
  record: SwitchRecordView | null
  lines: string[]
  cli: CliCommand
}

/** Apply a switch: run it (config-only), queue it (data-moving, long-running runtime) or hand back the CLI command. */
export async function applySwitchAs(user: InfrastructureViewer | null | undefined, input: unknown, deps: InfrastructureSwitchDeps): Promise<ActionResult<ApplyResult>> {
  return guard(user, deps, { key: 'apply', max: 10 }, async (viewer) => {
    const change = parseChange(input)
    if (typeof change === 'string') return { ok: false, error: change }
    const confirm = String((input as { confirm?: unknown })?.confirm ?? '').trim()
    return deps.withDb(async (db, dbUrl) => {
      const denied = await requireGate(db, deps)
      if (denied) return denied as ActionResult<ApplyResult>
      const { config } = await loadInstanceConfig(db)
      const built = buildOptions(change, config, 'switch', deps.env)
      if (Object.keys(built.errors).length) return { ok: false, error: 'Some values need attention.', fieldErrors: built.errors }
      const mode = applyMode(change.area, deps.runtime())
      const cli = cliCommand(change.area, change.to, built)
      if (mode === 'cli') return { ok: true, mode, record: null, lines: [], cli }
      if (DATA_MOVING_AREAS.includes(change.area) && confirm !== change.to) {
        return { ok: false, error: `Type ${change.to} to confirm: this switch moves data.` }
      }
      if (await switchBusy(db)) throw new SwitchBusyError()
      const force = change.to === config.providers[change.area].id
      if (mode === 'background' || mode === 'chunked') {
        const secretFlagNames = new Set(switchFlagFields(change.area).filter((f) => f.secret).map((f) => f.flag))
        const flags = Object.fromEntries(Object.entries(built.flags).filter(([k]) => !secretFlagNames.has(k)))
        const secretFlags = Object.fromEntries(Object.entries(built.flags).filter(([k, v]) => secretFlagNames.has(k) && typeof v === 'string')) as Record<string, string>
        // The database switch only reads the source: no pg_dump of it (and none needed on serverless).
        const record = await enqueueSwitch(db, { area: change.area, to: change.to, set: built.set, secret: built.secret, flags, secretFlags, force, actor: actorOf(viewer), noDump: change.area === 'db' })
        ;(deps.log ?? console.info)(`[infrastructure] ${viewer.email ?? viewer.id} queued ${areaName(change.area)} switch ${record.from_provider} → ${change.to} (${record.id})`)
        deps.kick()
        return { ok: true, mode, record: recordView(record, false), lines: record.log ?? [], cli }
      }
      const io = capture()
      const result = await runSwitch({
        db, dbUrl, area: change.area, plan: deps.plans[change.area], io,
        options: { to: change.to, dryRun: false, yes: true, backupRoot: deps.backupRoot, set: built.set, secret: built.secret, flags: built.flags, noDump: true, actor: actorOf(viewer), force },
      })
      deps.invalidate()
      ;(deps.log ?? console.info)(`[infrastructure] ${viewer.email ?? viewer.id} switched ${areaName(change.area)} → ${change.to}: ${result.record?.status ?? `refused (${result.code})`}${result.switchId ? ` (${result.switchId})` : ''}`)
      if (!result.record) return { ok: false, error: io.lines.filter((l) => /fail|refus|another|error/i.test(l)).slice(-3).join(' ') || 'The switch was refused (see the plan).', lines: io.lines }
      return { ok: true, mode, record: recordView(result.record, false), lines: io.lines, cli }
    })
  })
}

export interface SettingsResult {
  preflight: PreflightCheck[]
  lines: string[]
  record: SwitchRecordView | null
  saved: boolean
  /** Pre-flight passed (false: nothing was saved; see preflight / lines). */
  passed: boolean
}

/** Edit the current provider's options (validated by the area's pre-flight checks first; recorded for rollback). */
export async function saveProviderSettingsAs(user: InfrastructureViewer | null | undefined, input: unknown, deps: InfrastructureSwitchDeps): Promise<ActionResult<SettingsResult>> {
  const dryRun = (input as { dryRun?: unknown })?.dryRun === true
  return guard(user, deps, { key: dryRun ? 'test' : 'settings', max: dryRun ? 20 : 10 }, async (viewer) => {
    const raw = (input ?? {}) as Partial<ChangeInput>
    if (!isArea(raw.area)) return { ok: false, error: 'Unknown area' }
    const area = raw.area
    return deps.withDb(async (db) => {
      const denied = await requireGate(db, deps)
      if (denied) return denied as ActionResult<SettingsResult>
      const { config } = await loadInstanceConfig(db)
      const change = parseChange({ ...raw, to: config.providers[area].id })
      if (typeof change === 'string') return { ok: false, error: change }
      const built = buildOptions(change, config, 'settings', deps.env)
      if (Object.keys(built.errors).length) return { ok: false, error: 'Some values need attention.', fieldErrors: built.errors }
      if (!dryRun && !Object.keys(built.set).length && !Object.keys(built.secret).length && !built.unset.length) return { ok: false, error: 'Nothing changed.' }
      if (!dryRun && (await switchBusy(db))) throw new SwitchBusyError()
      const io = capture()
      const result = await runSettingsChange({ db, area, plan: deps.plans[area], set: built.set, secret: built.secret, unset: built.unset, actor: actorOf(viewer), dryRun, io })
      if (!dryRun) {
        deps.invalidate()
        ;(deps.log ?? console.info)(`[infrastructure] ${viewer.email ?? viewer.id} changed ${areaName(area)} settings: ${[...Object.keys(built.set), ...Object.keys(built.secret), ...built.unset.map((o) => `-${o}`)].join(', ')}${result.switchId ? ` (${result.switchId})` : ''}`)
      }
      return { ok: true, preflight: result.preflight, lines: io.lines, record: result.record ? recordView(result.record, false) : null, saved: !dryRun && result.code === 0, passed: result.code !== 2 }
    })
  })
}

export async function switchRecordAs(user: InfrastructureViewer | null | undefined, id: unknown, deps: InfrastructureSwitchDeps): Promise<ActionResult<{ record: SwitchRecordView }>> {
  return guard(user, deps, { key: 'read', max: 240 }, async () => {
    if (typeof id !== 'string') return { ok: false, error: 'Unknown switch' }
    return deps.withDb(async (db) => {
      const record = await getRecord(db, id)
      if (!record) return { ok: false, error: 'Unknown switch' }
      return { ok: true, record: recordView(record, await switchRunning(db)) }
    })
  })
}

export async function recentSwitchesAs(user: InfrastructureViewer | null | undefined, deps: InfrastructureSwitchDeps): Promise<ActionResult<{ records: SwitchRecordView[]; busy: boolean }>> {
  return guard(user, deps, { key: 'read', max: 240 }, async () => deps.withDb(async (db) => {
    const running = await switchRunning(db)
    const records = (await listRecords(db, 15)).map((r) => recordView(r, running))
    return { ok: true, records, busy: running || records.some((r) => r.status === 'queued') }
  }))
}

export async function rollbackSwitchAs(user: InfrastructureViewer | null | undefined, input: unknown, deps: InfrastructureSwitchDeps): Promise<ActionResult<{ lines: string[]; record: SwitchRecordView | null; done: boolean }>> {
  const raw = (input ?? {}) as { id?: unknown; dryRun?: unknown; confirm?: unknown }
  const dryRun = raw.dryRun === true
  return guard(user, deps, { key: dryRun ? 'test' : 'rollback', max: dryRun ? 20 : 10 }, async (viewer) => {
    if (typeof raw.id !== 'string') return { ok: false, error: 'Unknown switch' }
    const id = raw.id
    return deps.withDb(async (db, dbUrl) => {
      const denied = await requireGate(db, deps)
      if (denied) return denied as ActionResult<{ lines: string[]; record: SwitchRecordView | null; done: boolean }>
      const original = await getRecord(db, id)
      if (!original) return { ok: false, error: 'Unknown switch' }
      if (!dryRun && String(raw.confirm ?? '').trim() !== 'rollback') return { ok: false, error: 'Type rollback to confirm.' }
      if (!dryRun && (await switchBusy(db))) throw new SwitchBusyError()
      const io = capture()
      const result = await runRollback({ db, dbUrl, id, plans: deps.plans, yes: !dryRun, dryRun, backupRoot: deps.backupRoot, actor: actorOf(viewer), io })
      if (!dryRun) {
        deps.invalidate()
        ;(deps.log ?? console.info)(`[infrastructure] ${viewer.email ?? viewer.id} rolled back ${id}: ${result.code === 0 ? 'done' : `code ${result.code}`}`)
      }
      if (result.code === 2) return { ok: false, error: io.lines.slice(-2).join(' ') || 'Rollback refused.' }
      return { ok: true, lines: io.lines, done: !dryRun && result.code === 0, record: result.record && !dryRun ? recordView(result.record, false) : null }
    })
  })
}

export async function cancelSwitchAs(user: InfrastructureViewer | null | undefined, id: unknown, deps: InfrastructureSwitchDeps): Promise<ActionResult<{ outcome: 'cancelled' | 'requested' | 'not-running' }>> {
  return guard(user, deps, { key: 'cancel', max: 20 }, async (viewer) => {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: 'Unknown switch' }
    return deps.withDb(async (db) => {
      const outcome = await requestCancel(db, id, viewer.email ?? viewer.id)
      ;(deps.log ?? console.info)(`[infrastructure] ${viewer.email ?? viewer.id} cancel ${id}: ${outcome}`)
      return { ok: true, outcome }
    })
  })
}

export async function retrySwitchAs(user: InfrastructureViewer | null | undefined, id: unknown, deps: InfrastructureSwitchDeps): Promise<ActionResult<{ queued: boolean }>> {
  return guard(user, deps, { key: 'apply', max: 10 }, async (viewer) => {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: 'Unknown switch' }
    return deps.withDb(async (db) => {
      const denied = await requireGate(db, deps)
      if (denied) return denied as ActionResult<{ queued: boolean }>
      const original = await getRecord(db, id)
      if (original && applyMode(original.area, deps.runtime()) === 'cli') return { ok: false, error: 'No long-running process to run it: re-run the switch with usertasks-admin.' }
      const queued = await requeueSwitch(db, id)
      if (!queued) return { ok: false, error: 'This switch cannot be retried from here: start it again with Change….' }
      ;(deps.log ?? console.info)(`[infrastructure] ${viewer.email ?? viewer.id} retried ${id}`)
      deps.kick()
      return { ok: true, queued }
    })
  })
}

/** Validate a secret:// reference against the configured secret store (the value is never returned). */
export async function checkSecretRefAs(user: InfrastructureViewer | null | undefined, ref: unknown, deps: InfrastructureSwitchDeps): Promise<ActionResult<{ found: boolean; detail: string }>> {
  return guard(user, deps, { key: 'test', max: 30 }, async () => {
    if (typeof ref !== 'string' || !isSecretRefValue(ref)) return { ok: false, error: 'Not a secret reference (secret://<name>)' }
    return deps.withDb(async (db) => {
      const { config } = await loadInstanceConfig(db)
      const result = await deps.checkSecretRef(config, ref.trim())
      return { ok: true, found: result.ok, detail: result.detail }
    })
  })
}
