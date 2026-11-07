/**
 * Whether Settings → Infrastructure may change providers, and whether this
 * deployment can run a switch in the background (lib/admin/infrastructure-switching).
 * Kept apart from the engine so the tick's job registry can ask cheaply.
 */

import type { ProviderArea } from '@/lib/config/schema'

export const ALLOW_UI_SWITCHING_SETTING = 'instance.allow_ui_switching'

/**
 * direct: in the request · background: queued, run by this long-running process ·
 * chunked: queued, run in time-boxed chunks by the scheduler tick (serverless; the database copy) ·
 * cli: the page prints the usertasks-admin command.
 */
export type ApplyMode = 'direct' | 'background' | 'chunked' | 'cli'

/** Switches that can pause at a deadline and continue (chunked runs on serverless). */
export const CHUNKED_AREAS: readonly ProviderArea[] = ['db']

/** Switches that copy data and may take long: never inside a request. */
export const BACKGROUND_AREAS: readonly ProviderArea[] = ['storage', 'auth', 'db']

export interface SwitchingGate {
  enabled: boolean
  reason: string | null
  /** Why it is off: INFRA_UI_SWITCHING=false (the environment wins), or the cloud lock (an instance admin can unlock it). */
  code?: 'flag-off' | 'cloud-locked' | 'unavailable' | null
  /** The cloud edition: instance.allow_ui_switching decides (Unlock / Lock on the page). */
  lockable?: boolean
}

const OFF = /^(0|false|off|no|disabled)$/i

export const FLAG_OFF_REASON = 'Changing providers from this page is turned off by INFRA_UI_SWITCHING=false in the app environment: remove it (or set it to true) and redeploy, or use usertasks-admin on the server.'
export const CLOUD_LOCKED_SHORT = 'Locked on this cloud deployment. An instance admin can unlock it here.'
export const CLOUD_LOCKED_REASON = 'Locked on this cloud deployment, so a hosted production instance is never switched by accident. An instance admin can unlock it here (or run usertasks-admin ui-switching on).'

/** INFRA_UI_SWITCHING (default on) and, in the cloud edition, instance.allow_ui_switching (default off). */
export function switchingGate(input: { flag: string | undefined; deploymentMode: 'cloud' | 'self_hosted'; allowSetting: unknown }): SwitchingGate {
  const lockable = input.deploymentMode === 'cloud'
  if (input.flag !== undefined && OFF.test(input.flag.trim())) {
    return { enabled: false, reason: FLAG_OFF_REASON, code: 'flag-off', lockable }
  }
  if (lockable && input.allowSetting !== true && input.allowSetting !== 'true') {
    return { enabled: false, reason: CLOUD_LOCKED_REASON, code: 'cloud-locked', lockable }
  }
  return { enabled: true, reason: null, code: null, lockable }
}

/**
 * How the page reaches the instance: a direct connection (DATABASE_URL), the
 * Supabase service-role API (no DATABASE_URL: config-only changes), or
 * neither (nothing can change from the page).
 */
export type SwitchAccess = 'direct' | 'api' | 'none'

/** Changes that copy or convert data, or touch the database itself: a direct connection only. */
export const DIRECT_ONLY_SWITCH_AREAS: readonly ProviderArea[] = ['db', 'auth', 'storage']
/** Settings edits whose checks read tables the API can't see. */
export const DIRECT_ONLY_SETTINGS_AREAS: readonly ProviderArea[] = ['db', 'auth']

export type ActionBlockKind = 'flag-off' | 'cloud-locked' | 'needs-direct-db' | 'no-access' | 'no-settings' | 'unavailable'

export interface ActionState {
  enabled: boolean
  /** Why the button is disabled (null when enabled). */
  block: { kind: ActionBlockKind; message: string } | null
}

export interface AreaActionStates {
  change: ActionState
  settings: ActionState
}

export const NO_ACCESS_REASON = 'This deployment has neither DATABASE_URL nor the Supabase service-role key (SUPABASE_SERVICE_ROLE_KEY): add one to the app environment and redeploy.'

export function needsDirectReason(area: ProviderArea, what: 'switch' | 'settings', label: string): string {
  const action = what === 'settings' ? `Editing the ${label.toLowerCase()} settings` : area === 'db' ? 'Switching the database' : `Switching ${label.toLowerCase()} (it copies ${area === 'auth' ? 'user accounts' : 'stored files'})`
  return `${action} needs a direct database connection: add DATABASE_URL (Supabase → Project Settings → Database → Connection string, Session pooler) to the app environment and redeploy, or run usertasks-admin switch where DATABASE_URL is set.`
}

/**
 * What each area card's Change… / Settings buttons may do here, and why not.
 * The buttons are always shown; a disabled one says why and what to do.
 */
export function areaActionStates(input: { area: ProviderArea; label: string; providerLabel: string; hasSettings: boolean; gate: SwitchingGate; access: SwitchAccess }): AreaActionStates {
  const ok: ActionState = { enabled: true, block: null }
  const block = (kind: ActionBlockKind, message: string): ActionState => ({ enabled: false, block: { kind, message } })
  const common = (): ActionState | null => {
    if (input.access === 'none') return block('no-access', NO_ACCESS_REASON)
    if (input.gate.code === 'cloud-locked') return block('cloud-locked', CLOUD_LOCKED_SHORT)
    if (!input.gate.enabled) return block(input.gate.code ?? 'unavailable', input.gate.reason ?? 'Changing providers from this page is not available right now.')
    return null
  }
  const change = common() ?? (input.access === 'api' && DIRECT_ONLY_SWITCH_AREAS.includes(input.area) ? block('needs-direct-db', needsDirectReason(input.area, 'switch', input.label)) : ok)
  const settings = !input.hasSettings
    ? block('no-settings', `${input.providerLabel} has no settings to edit here: use Change… to pick another provider.`)
    : common() ?? (input.access === 'api' && DIRECT_ONLY_SETTINGS_AREAS.includes(input.area) ? block('needs-direct-db', needsDirectReason(input.area, 'settings', input.label)) : ok)
  return { change, settings }
}

export interface BackgroundRuntime {
  /** Long-running app process that can run a switch after the request returns. */
  available: boolean
  reason: string | null
}

/** Whether this deployment runs long-lived processes (not serverless). INFRA_UI_BACKGROUND_JOBS=on|off overrides. */
export function backgroundRuntime(env: Record<string, string | undefined> = process.env): BackgroundRuntime {
  const override = env.INFRA_UI_BACKGROUND_JOBS?.trim().toLowerCase()
  if (override === 'on' || override === 'true') return { available: true, reason: null }
  if (override === 'off' || override === 'false') return { available: false, reason: 'INFRA_UI_BACKGROUND_JOBS=off' }
  if (env.VERCEL) return { available: false, reason: 'Vercel functions stop when the request ends' }
  if (env.AWS_LAMBDA_FUNCTION_NAME) return { available: false, reason: 'AWS Lambda functions stop when the request ends' }
  if (env.NETLIFY) return { available: false, reason: 'Netlify functions stop when the request ends' }
  if (env.K_SERVICE && !env.K_CONFIGURATION_CPU_ALWAYS) return { available: false, reason: 'Cloud Run throttles the CPU after the response (set INFRA_UI_BACKGROUND_JOBS=on with always-allocated CPU)' }
  return { available: true, reason: null }
}

export function applyMode(area: ProviderArea, runtime: BackgroundRuntime): ApplyMode {
  if (!BACKGROUND_AREAS.includes(area)) return 'direct'
  if (runtime.available) return 'background'
  return CHUNKED_AREAS.includes(area) ? 'chunked' : 'cli'
}
