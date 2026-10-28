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
}

const OFF = /^(0|false|off|no|disabled)$/i

/** INFRA_UI_SWITCHING (default on) and, in the cloud edition, instance.allow_ui_switching (default off). */
export function switchingGate(input: { flag: string | undefined; deploymentMode: 'cloud' | 'self_hosted'; allowSetting: unknown }): SwitchingGate {
  if (input.flag !== undefined && OFF.test(input.flag.trim())) {
    return { enabled: false, reason: 'Changing providers from this page is turned off (INFRA_UI_SWITCHING=false). Use usertasks-admin on the server.' }
  }
  if (input.deploymentMode === 'cloud' && input.allowSetting !== true && input.allowSetting !== 'true') {
    return { enabled: false, reason: 'Cloud edition: changing providers from this page is locked. An operator unlocks it with `usertasks-admin ui-switching on` (instance.allow_ui_switching).' }
  }
  return { enabled: true, reason: null }
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
