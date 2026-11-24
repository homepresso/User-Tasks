import type { InstanceConfig } from '@/lib/config'
import { PROVIDER_AREAS, PROVIDER_IDS, type ProviderArea } from '@/lib/config/schema'
import { isSecretRef } from '@/lib/config/secret-refs'
import {
  OPTION_ENV,
  parseFieldValue,
  providerFields,
  switchFlagFields,
  type ProviderField,
} from '@/lib/config/provider-forms'
import { ADDON_REQUIRED_CODE, addonRequiredMessage, isFreeProviderChange, isFreeSettingsChange } from '@/lib/infrastructure/addon'
import { AREA_LABELS, areaName } from './catalogue'
import type { InfrastructureViewer } from './instance-admins'
import { changedSettingKeys, loadInstanceConfig, type SettingRow, type SqlClient } from './ops/instance-db'
import { runSettingsChange, type EngineIO } from './switch/engine'
import { settingsPreflight } from './switch/settings-checks'
import { switchRunning, SwitchBusyError } from './switch/log'
import { isApiClient, NeedsDirectConnectionError } from './ops/service-sql'
import { setUiSwitching } from './switch/ui-lock'
import type { PreflightCheck, SwitchLogArea, SwitchOptions, SwitchRecordRow } from './switch/types'

/**
 * Settings → Infrastructure and the setup wizard, open-source part: the
 * changes core makes itself, free on every install
 * (lib/infrastructure/addon.ts):
 *
 *  - the current provider's settings for email and sign-in (SMTP relay,
 *    Resend key, identity providers), validated by the area's checks first
 *    and recorded in the switch log;
 *  - the email transport between SMTP, Resend and log-only (a
 *    configuration-only change);
 *  - the cloud edition's Unlock / Lock of changes from the page.
 *
 * Every other change — provider switches with their data copies, settings
 * of other areas, rollback, retry, cancel — is the Infrastructure add-on
 * (@usertasks-ext/infrastructure), which builds on the helpers exported
 * here. Core refuses those with ADDON_REQUIRED_CODE.
 *
 * Instance admins only, re-checked on every call; rate limited per user.
 * Secret values typed into a form are stored encrypted and never sent back.
 */

export {
  ALLOW_UI_SWITCHING_SETTING, BACKGROUND_AREAS, DIRECT_ONLY_SETTINGS_AREAS, DIRECT_ONLY_SWITCH_AREAS, applyMode, areaActionStates, backgroundRuntime, switchingGate,
  type ApplyMode, type AreaActionStates, type BackgroundRuntime, type SwitchAccess, type SwitchingGate,
} from './switch-runtime'
import { DIRECT_ONLY_SETTINGS_AREAS, DIRECT_ONLY_SWITCH_AREAS, needsDirectReason, type SwitchAccess, type SwitchingGate } from './switch-runtime'

export function accessOf(db: SqlClient): SwitchAccess {
  return isApiClient(db) ? 'api' : 'direct'
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

export interface SwitchRecordView {
  id: string
  kind: SwitchRecordRow['kind']
  area: SwitchLogArea
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
    areaLabel: record.area === 'instance' ? 'Cloud lock' : AREA_LABELS[record.area] ?? record.area,
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

/** What the settings actions need (app: lib/admin/settings-deps; tests pass fakes). The add-on extends it. */
export interface InfrastructureSettingsDeps {
  canView: (user: InfrastructureViewer | null | undefined) => Promise<boolean>
  /** A connection to the app database for the call (throws NoDatabaseError without DATABASE_URL or the service-role key). */
  withDb: <T>(fn: (db: SqlClient, dbUrl: string) => Promise<T>) => Promise<T>
  /** true = allowed. */
  rateLimit: (key: string, max: number) => Promise<boolean>
  gate: (db: SqlClient) => Promise<SwitchingGate>
  /** Drop this process's cached settings / health after a change. */
  invalidate: () => void
  env?: Env
  log?: (line: string) => void
  /**
   * Egress guard for the hosts a test / change is about to contact (SSRF):
   * null when every host may be reached, else why not and the allowlist
   * entry that would allow it (lib/install/egress-server).
   */
  guardHosts?: (hosts: string[]) => Promise<{ error: string; allowEntry: string | null } | null>
}

export class NoDatabaseError extends Error {
  constructor() {
    super('Changing providers from this page needs DATABASE_URL, or on the Supabase database provider its service-role key (SUPABASE_SERVICE_ROLE_KEY): this deployment has neither. Add one to the app environment and redeploy.')
    this.name = 'NoDatabaseError'
  }
}

export type ActionResult<T> = ({ ok: true } & T) | { ok: false; error: string; code?: string; fieldErrors?: Record<string, string>; lines?: string[]; allowEntry?: string | null }

/** The new values of a change point only at hosts the egress policy allows (null), or the refusal. */
export async function guardChange(deps: InfrastructureSettingsDeps, change: ChangeInput, built: BuiltOptions): Promise<{ ok: false; error: string; allowEntry: string | null } | null> {
  if (!deps.guardHosts) return null
  const { hostsForOptions } = await import('@/lib/install/egress')
  const hosts = hostsForOptions(change.area, { ...built.set, ...built.secret }, built.flags as Record<string, unknown>)
  if (!hosts.length) return null
  const blocked = await deps.guardHosts(hosts)
  return blocked ? { ok: false, error: blocked.error, allowEntry: blocked.allowEntry } : null
}

export const DENIED = { ok: false as const, error: 'Only instance administrators can change infrastructure.' }
export const RATE_LIMITED = { ok: false as const, error: 'Too many requests: wait a minute and try again.' }

export function actorOf(user: InfrastructureViewer): string {
  return `${user.email ?? user.id} (Settings → Infrastructure)`
}

export function isArea(value: unknown): value is ProviderArea {
  return typeof value === 'string' && (PROVIDER_AREAS as readonly string[]).includes(value)
}

export function isProvider(area: ProviderArea, value: unknown): value is string {
  return typeof value === 'string' && (PROVIDER_IDS[area] as readonly string[]).includes(value)
}

export async function guard<T>(
  user: InfrastructureViewer | null | undefined,
  deps: InfrastructureSettingsDeps,
  limit: { key: string; max: number } | null,
  fn: (user: InfrastructureViewer) => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  if (!user || !(await deps.canView(user))) return DENIED
  if (limit && !(await deps.rateLimit(`infra:${limit.key}:${user.id}`, limit.max))) return RATE_LIMITED
  try {
    return await fn(user)
  } catch (error) {
    if (error instanceof NoDatabaseError || error instanceof SwitchBusyError || error instanceof NeedsDirectConnectionError) return { ok: false, error: error.message }
    ;(deps.log ?? console.error)(`[infrastructure] ${(error as Error).stack ?? error}`)
    return { ok: false, error: `Failed: ${(error as Error).message}` }
  }
}

export async function requireGate(db: SqlClient, deps: InfrastructureSettingsDeps): Promise<ActionResult<object> | null> {
  const gate = await deps.gate(db)
  return gate.enabled ? null : { ok: false, error: gate.reason ?? 'Changing providers from this page is turned off.' }
}

/** Refusal for a change this connection can't make (data-moving over the API), with the remedy. */
export function requireDirect(db: SqlClient, area: ProviderArea, what: 'switch' | 'settings'): ActionResult<object> | null {
  if (!isApiClient(db)) return null
  const list = what === 'switch' ? DIRECT_ONLY_SWITCH_AREAS : DIRECT_ONLY_SETTINGS_AREAS
  return list.includes(area) ? { ok: false, error: needsDirectReason(area, what, AREA_LABELS[area]) } : null
}

export function capture(): EngineIO & { lines: string[] } {
  const lines: string[] = []
  return { lines, log: (l) => lines.push(l), warn: (l) => lines.push(l) }
}

export function parseChange(input: unknown): ChangeInput | string {
  const raw = (input ?? {}) as Partial<ChangeInput>
  if (!isArea(raw.area)) return 'Unknown area'
  if (!isProvider(raw.area, raw.to)) return `Unknown ${areaName(raw.area)} provider`
  const values = raw.values && typeof raw.values === 'object' ? raw.values : {}
  const flags = raw.flags && typeof raw.flags === 'object' ? raw.flags : {}
  const clear = Array.isArray(raw.clear) ? raw.clear.filter((c): c is string => typeof c === 'string') : []
  return { area: raw.area, to: raw.to, values: values as Record<string, string>, flags: flags as Record<string, string | boolean>, clear }
}

export interface SettingsResult {
  preflight: PreflightCheck[]
  lines: string[]
  record: SwitchRecordView | null
  saved: boolean
  /** Pre-flight passed (false: nothing was saved; see preflight / lines). */
  passed: boolean
}


/** The add-on is needed for this change: core's refusal (the action, the API and the CLI give the same). */
export function addonRequired(what?: string): { ok: false; error: string; code: typeof ADDON_REQUIRED_CODE } {
  return { ok: false, error: addonRequiredMessage(what), code: ADDON_REQUIRED_CODE }
}

/**
 * Edit the current provider's options (free for email and sign-in), validated
 * by the area's pre-flight checks first and recorded for the switch log.
 * Other areas: the Infrastructure add-on (refused here).
 */
export async function saveProviderSettingsAs(user: InfrastructureViewer | null | undefined, input: unknown, deps: InfrastructureSettingsDeps): Promise<ActionResult<SettingsResult>> {
  const dryRun = (input as { dryRun?: unknown })?.dryRun === true
  return guard(user, deps, { key: dryRun ? 'test' : 'settings', max: dryRun ? 20 : 10 }, async (viewer) => {
    const raw = (input ?? {}) as Partial<ChangeInput>
    if (!isArea(raw.area)) return { ok: false, error: 'Unknown area' }
    const area = raw.area
    return deps.withDb(async (db) => {
      const { config } = await loadInstanceConfig(db)
      const preflight = settingsPreflight(area)
      if (!preflight || !isFreeSettingsChange(area, config.providers[area].id)) return addonRequired(`Changing the ${AREA_LABELS[area].toLowerCase()} settings`)
      const denied = await requireGate(db, deps)
      if (denied) return denied as ActionResult<SettingsResult>
      const direct = requireDirect(db, area, 'settings')
      if (direct) return direct as ActionResult<SettingsResult>
      const change = parseChange({ ...raw, to: config.providers[area].id })
      if (typeof change === 'string') return { ok: false, error: change }
      const built = buildOptions(change, config, 'settings', deps.env)
      if (Object.keys(built.errors).length) return { ok: false, error: 'Some values need attention.', fieldErrors: built.errors }
      const blocked = await guardChange(deps, change, built)
      if (blocked) return blocked
      if (!dryRun && !Object.keys(built.set).length && !Object.keys(built.secret).length && !built.unset.length) return { ok: false, error: 'Nothing changed.' }
      if (!dryRun && (await switchRunning(db))) return { ok: false, error: 'A provider switch is running: wait for it to finish.' }
      const io = capture()
      const result = await runSettingsChange({ db, area, preflight, set: built.set, secret: built.secret, unset: built.unset, actor: actorOf(viewer), dryRun, io })
      if (!dryRun) {
        deps.invalidate()
        ;(deps.log ?? console.info)(`[infrastructure] ${viewer.email ?? viewer.id} changed ${areaName(area)} settings: ${[...Object.keys(built.set), ...Object.keys(built.secret), ...built.unset.map((o) => `-${o}`)].join(', ')}${result.switchId ? ` (${result.switchId})` : ''}`)
      }
      return { ok: true, preflight: result.preflight, lines: io.lines, record: result.record ? recordView(result.record, false) : null, saved: !dryRun && result.code === 0, passed: result.code !== 2 }
    })
  })
}

/**
 * Change the email transport between the standard ones (SMTP / Microsoft 365
 * / Exchange, Resend, log-only): configuration only, free. Email APIs (SES,
 * Azure Communication Services, Microsoft Graph, Gmail) need the add-on.
 */
export async function changeEmailProviderAs(user: InfrastructureViewer | null | undefined, input: unknown, deps: InfrastructureSettingsDeps): Promise<ActionResult<{ lines: string[]; record: SwitchRecordView | null; preflight: PreflightCheck[] }>> {
  return guard(user, deps, { key: 'apply', max: 10 }, async (viewer) => {
    const change = parseChange({ ...((input ?? {}) as object), area: 'email' })
    if (typeof change === 'string') return { ok: false, error: change }
    if (!isFreeProviderChange('email', change.to)) return addonRequired(`Sending email through ${change.to}`)
    return deps.withDb(async (db) => {
      const denied = await requireGate(db, deps)
      if (denied) return denied as ActionResult<{ lines: string[]; record: SwitchRecordView | null; preflight: PreflightCheck[] }>
      const { config } = await loadInstanceConfig(db)
      // Validated as a switch: the target's required options must end up set.
      const built = buildOptions({ ...change, flags: {} }, config, 'switch', deps.env)
      if (Object.keys(built.errors).length) return { ok: false, error: 'Some values need attention.', fieldErrors: built.errors }
      const blocked = await guardChange(deps, change, built)
      if (blocked) return blocked
      if (await switchRunning(db)) return { ok: false, error: 'A provider switch is running: wait for it to finish.' }
      const io = capture()
      const result = await runSettingsChange({ db, area: 'email', preflight: settingsPreflight('email')!, to: change.to, set: built.set, secret: built.secret, unset: [], actor: actorOf(viewer), dryRun: false, io })
      deps.invalidate()
      ;(deps.log ?? console.info)(`[infrastructure] ${viewer.email ?? viewer.id} changed email ${config.providers.email.id} → ${change.to}: ${result.record?.status ?? `refused (${result.code})`}`)
      if (!result.record) return { ok: false, error: io.lines.filter((l) => /fail|refus|error|environment/i.test(l)).slice(-3).join(' ') || 'The change was refused (see the checks).', lines: io.lines }
      return { ok: true, lines: io.lines, record: recordView(result.record, false), preflight: result.preflight }
    })
  })
}

export interface UiLockActionResult {
  allowed: boolean
  changed: boolean
  record: SwitchRecordView | null
}

/**
 * Unlock (or lock again) provider changes from this page on the cloud
 * edition: sets `instance.allow_ui_switching` (over the direct connection or
 * the service-role API), after a typed confirmation (`unlock` / `lock`).
 * Instance admins only, rate limited, recorded in the switch log (area
 * `instance`) with who did it — and rolled back from there like any change.
 */
export async function setUiSwitchingAs(user: InfrastructureViewer | null | undefined, input: unknown, deps: InfrastructureSettingsDeps): Promise<ActionResult<UiLockActionResult>> {
  const raw = (input ?? {}) as { allow?: unknown; confirm?: unknown }
  return guard(user, deps, { key: 'unlock', max: 5 }, async (viewer) => {
    if (typeof raw.allow !== 'boolean') return { ok: false, error: 'Say whether to unlock or lock.' }
    const allow = raw.allow
    const phrase = allow ? 'unlock' : 'lock'
    if (String(raw.confirm ?? '').trim().toLowerCase() !== phrase) return { ok: false, error: `Type ${phrase} to confirm.` }
    return deps.withDb(async (db) => {
      const gate = await deps.gate(db)
      if (!gate.lockable) return { ok: false, error: 'Only the cloud edition locks provider changes from this page: there is nothing to unlock here.' }
      if (gate.code === 'flag-off') return { ok: false, error: gate.reason ?? 'INFRA_UI_SWITCHING=false turns changes from this page off.' }
      const result = await setUiSwitching(db, allow, actorOf(viewer), { userId: viewer.id })
      if (result.changed) {
        deps.invalidate()
        ;(deps.log ?? console.info)(`[infrastructure] ${viewer.email ?? viewer.id} ${allow ? 'unlocked' : 'locked'} provider changes from the page (${result.record?.id})`)
      }
      return { ok: true, allowed: result.allowed, changed: result.changed, record: result.record ? recordView(result.record, false) : null }
    })
  })
}

