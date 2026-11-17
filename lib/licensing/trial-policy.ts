/**
 * Trial-only signing keys: what a licence signed by a `kind: 'trial'` key
 * (./keyring.ts) must look like to be accepted.
 *
 * The main licence key is held offline by the vendor and never touches a
 * server. Self-serve trials are signed on usertasks.com with a SEPARATE key,
 * which is only trusted for:
 *   - `trial: true` licences;
 *   - a term of at most 30 days (expires_at − max(issued_at, not_before)),
 *     plus a small clock skew, that starts no later than "now" + skew (so a
 *     leaked trial key can't mint a licence that starts in 2030);
 *   - one allowed SKU (`sku`, default `sharepoint-se`; configurable per key
 *     with `trialSkus` and here in TRIAL_SKUS), granting only that SKU's
 *     extension and only that extension's limits;
 *   - bound to exactly one farm (`binding.farm_ids`, a GUID — SPFarm.Id / the
 *     OAuth realm), with at most one farm in its limits.
 * A licence from a trial key that breaks any rule gets the `trial_policy`
 * problem and is not valid (never installed, never granting anything).
 *
 * Pure: the caller passes `now`.
 */

import { DAY_MS } from './format'
import type { LicenceKey } from './keyring'
import type { LicenceDocument, LicenceProblem } from './types'

export const TRIAL_DAYS = 30
/** Allowed clock difference between the issuer and the verifier. */
export const TRIAL_CLOCK_SKEW_MS = 10 * 60 * 1000

export interface TrialSkuPolicy {
  /** The one extension a trial of this SKU grants. */
  extensionId: string
  /** Longest term in days. */
  maxTermDays: number
  /** What the trial must be bound to. */
  binding: 'farm'
  /** Limit key holding the number of farms (must be ≤ 1 when present). */
  farmLimitKey?: string
}

/** SKUs that can be trialled, and their rules. */
export const TRIAL_SKUS: Readonly<Record<string, TrialSkuPolicy>> = {
  'sharepoint-se': { extensionId: 'sharepoint', maxTermDays: TRIAL_DAYS, binding: 'farm', farmLimitKey: 'sharepoint.farms' },
}

/** SKUs a trial key may sign when its keyring entry names none. */
export const TRIAL_DEFAULT_SKUS: readonly string[] = ['sharepoint-se']

export const FARM_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** A farm id as typed or pasted (braces, upper case, spaces) → lower-case GUID, or null. */
export function normaliseFarmId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim().replace(/^realm:/i, '').replace(/^\{|\}$/g, '').trim().toLowerCase()
  return FARM_ID_PATTERN.test(v) ? v : null
}

function problem(message: string): LicenceProblem {
  return { code: 'trial_policy', message: `Not a valid trial licence: ${message}` }
}

/**
 * Check a licence signed with `key` against the trial rules. Null when the
 * key is not a trial key (no restrictions) or the licence keeps every rule.
 */
export function checkTrialPolicy(doc: LicenceDocument, key: LicenceKey | undefined, now: Date, skus: Readonly<Record<string, TrialSkuPolicy>> = TRIAL_SKUS): LicenceProblem | null {
  if (!key || key.kind !== 'trial') return null
  if (doc.trial !== true) return problem('the trial key only signs trial licences')
  const allowed = key.trialSkus ?? TRIAL_DEFAULT_SKUS
  const sku = doc.sku
  if (!sku || !allowed.includes(sku)) return problem(`SKU ${sku ? `"${sku}"` : '(none)'} is not allowed for trials`)
  const policy = skus[sku]
  if (!policy) return problem(`SKU "${sku}" has no trial rules`)
  if (doc.extensions.length !== 1 || doc.extensions[0].id !== policy.extensionId) return problem(`a ${sku} trial grants only the ${policy.extensionId} extension`)
  const grantLimits = doc.extensions[0].limits ?? {}
  for (const k of Object.keys(doc.limits ?? {})) if (!k.startsWith(`${policy.extensionId}.`)) return problem(`limit "${k}" is not a ${policy.extensionId} limit`)

  const issued = Date.parse(doc.issued_at)
  const notBefore = doc.not_before ? Date.parse(doc.not_before) : issued
  const expires = Date.parse(doc.expires_at)
  if (![issued, notBefore, expires].every(Number.isFinite)) return problem('dates are not readable')
  if (issued > now.getTime() + TRIAL_CLOCK_SKEW_MS) return problem('issued in the future')
  if (notBefore < issued - TRIAL_CLOCK_SKEW_MS) return problem('valid from before it was issued')
  const start = Math.max(issued, notBefore)
  if (expires <= start) return problem('expires before it starts')
  if (expires - start > policy.maxTermDays * DAY_MS + TRIAL_CLOCK_SKEW_MS) return problem(`longer than ${policy.maxTermDays} days`)

  if (policy.binding === 'farm') {
    const farms = doc.binding?.farm_ids ?? []
    if (farms.length !== 1 || !FARM_ID_PATTERN.test(farms[0])) return problem('must be bound to exactly one farm id')
    if (policy.farmLimitKey) {
      const short = policy.farmLimitKey.slice(policy.extensionId.length + 1)
      for (const v of [doc.limits?.[policy.farmLimitKey], grantLimits[short], grantLimits[policy.farmLimitKey]]) {
        if (typeof v === 'number' && v > 1) return problem('a trial covers one farm')
      }
    }
  }
  return null
}
