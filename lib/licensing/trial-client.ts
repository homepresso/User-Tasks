/**
 * Starting a self-serve trial from inside a self-hosted installation
 * (Settings → Extensions → "Start a 30-day trial"; the SharePoint add-in's
 * first-run page links here).
 *
 *   Online: the server posts the request (name, work email, company and a
 *   request code holding the farm id, this instance id and hostnames) to
 *   usertasks.com — USERTASKS_TRIAL_URL, default https://usertasks.com —
 *   and installs the licence it returns (Settings → Licence's install path:
 *   verified, stored, audited as `installed`).
 *
 *   Offline: when usertasks.com can't be reached (air-gapped, proxy, egress
 *   policy, timeout), the admin gets the request code to paste into
 *   usertasks.com/sharepoint/trial from any connected machine, and pastes the
 *   licence that comes back (the normal install).
 *
 * Instance admins only (the server actions check). No secrets are sent.
 */

import packageJson from '@/package.json'
import { encodeTrialRequest } from './trial-request'
import { normaliseFarmId } from './trial-policy'
import type { InstanceIdentity } from './types'
import type { InstallResult } from './admin'

export const TRIAL_URL_ENV = 'USERTASKS_TRIAL_URL'
export const DEFAULT_TRIAL_URL = 'https://usertasks.com'
const TIMEOUT_MS = 12_000

export interface TrialStartInput {
  extensionId: string
  farmId: string
  name: string
  email: string
  company: string
  acceptTerms: boolean
}

export type TrialStartResult =
  | { mode: 'online'; licenceId: string; expiresAt: string | null; existing: boolean; message: string }
  | { mode: 'offline'; requestCode: string; trialUrl: string; reason: string }
  | { mode: 'refused'; message: string; code: string; field?: string }

export interface TrialClientDeps {
  identity: () => Promise<InstanceIdentity>
  skuOf: (extensionId: string) => { sku: string; trial: boolean } | null
  fetch: typeof fetch
  install: (text: string, who: { actorId: string | null; actor: string }) => Promise<InstallResult>
  now: () => Date
  trialUrl: () => string
}

export function trialBaseUrl(env: Record<string, string | undefined> = process.env): string {
  const raw = env[TRIAL_URL_ENV]?.trim()
  if (!raw) return DEFAULT_TRIAL_URL
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' || url.hostname === 'localhost' ? url.origin : DEFAULT_TRIAL_URL
  } catch {
    return DEFAULT_TRIAL_URL
  }
}

/** The request code for the offline path (and the online request). */
export async function trialRequestCode(input: { extensionId: string; farmId: string }, deps: Pick<TrialClientDeps, 'identity' | 'skuOf' | 'now'>): Promise<string> {
  const product = deps.skuOf(input.extensionId)
  if (!product?.trial) throw new Error(`${input.extensionId} has no self-serve trial`)
  const farm = normaliseFarmId(input.farmId)
  if (!farm) throw new Error('Enter the farm ID: a GUID such as 3f2504e0-4f89-11d3-9a0c-0305e82c3301 ((Get-SPFarm).Id in SharePoint Management Shell)')
  const identity = await deps.identity()
  return encodeTrialRequest({ sku: product.sku, farm_id: farm, instance_id: identity.instanceId, hostnames: identity.hostnames, version: String(packageJson.version), created_at: deps.now().toISOString() })
}

export async function startTrial(input: TrialStartInput, who: { actorId: string | null; actor: string }, deps: TrialClientDeps): Promise<TrialStartResult> {
  const product = deps.skuOf(input.extensionId)
  if (!product?.trial) return { mode: 'refused', code: 'no_trial', message: `${input.extensionId} has no self-serve trial` }
  if (!normaliseFarmId(input.farmId)) return { mode: 'refused', code: 'validation_error', field: 'farm_id', message: 'Enter the farm ID: a GUID such as 3f2504e0-4f89-11d3-9a0c-0305e82c3301. In SharePoint Management Shell run (Get-SPFarm).Id.' }
  if (!input.acceptTerms) return { mode: 'refused', code: 'validation_error', field: 'accept_terms', message: 'Please accept the trial terms.' }
  const requestCode = await trialRequestCode(input, deps)
  const base = deps.trialUrl()
  const offline = (reason: string): TrialStartResult => ({ mode: 'offline', requestCode, trialUrl: `${base}/sharepoint/trial`, reason })

  let response: Response
  try {
    response = await deps.fetch(`${base}/api/public/trials/sharepoint`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': `UserTasks/${packageJson.version} (trial)` },
      body: JSON.stringify({ sku: product.sku, name: input.name, email: input.email, company: input.company, request_code: requestCode, accept_terms: true, source: 'product' }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'error',
    })
  } catch (error) {
    return offline(`usertasks.com could not be reached from this server (${error instanceof Error ? error.message : 'network error'})`)
  }
  let body: Record<string, unknown> = {}
  try { body = (await response.json()) as Record<string, unknown> } catch { /* not JSON: a proxy page */ }
  if (response.ok && body.licence && typeof body.licence === 'object') {
    const installed = await deps.install(JSON.stringify(body.licence), { actorId: who.actorId, actor: `${who.actor} (trial started online)` })
    return { mode: 'online', licenceId: installed.licence.licenceId ?? String(body.licence_id ?? ''), expiresAt: installed.licence.expiresAt, existing: body.existing === true, message: typeof body.message === 'string' ? body.message : 'Trial started.' }
  }
  if (typeof body.error === 'string' && response.status >= 400 && response.status < 500 && response.status !== 404 && response.status !== 429) {
    return { mode: 'refused', code: String(body.code ?? 'refused'), message: body.error, ...(typeof body.field === 'string' ? { field: body.field } : {}) }
  }
  if (response.status === 503 && body.code === 'trials_unavailable') return { mode: 'refused', code: 'trials_unavailable', message: String(body.error) }
  if (response.status === 429) return { mode: 'refused', code: 'rate_limited', message: typeof body.error === 'string' ? body.error : 'Too many trial requests. Try again later.' }
  return offline(`usertasks.com answered ${response.status}`)
}

export async function defaultTrialClientDeps(): Promise<TrialClientDeps> {
  const [{ licensingDeps }, { installLicence }, { getExtensionManifest }, { skuForExtension }, { TRIAL_SKUS }] = await Promise.all([
    import('./service'), import('./admin'), import('@/lib/extensions/registry'), import('@/lib/editions/catalog'), import('./trial-policy'),
  ])
  return {
    identity: () => licensingDeps.identity(),
    skuOf: (id) => {
      const m = getExtensionManifest(id)
      if (m?.licence.sku) return { sku: m.licence.sku, trial: Boolean(m.licence.trial) }
      // Not in this build: an Enterprise extension can still be trialled here
      // (the licence is installed now; `usertasks upgrade --edition enterprise` then uses it).
      const sku = skuForExtension(id)
      return sku && TRIAL_SKUS[sku] ? { sku, trial: true } : null
    },
    fetch: (...args) => fetch(...args),
    install: (text, who) => installLicence(text, who),
    now: () => licensingDeps.now(),
    trialUrl: () => trialBaseUrl(),
  }
}
