/**
 * Entitlement service: one decision per (workspace, extension, feature) from
 *   (a) installed licence files — instance-wide (self-hosted / air-gapped), and
 *   (b) cloud `tenant_entitlements` rows — per workspace (admin-managed now;
 *       a Stripe webhook can upsert rows later with source 'stripe').
 *
 * Decision rules (resolveDecision, pure):
 *   1. A free extension (manifest licence.tier 'free') → not_required.
 *   2. Grants = valid licences that include the extension + the workspace's
 *      active entitlement rows; only those granting the feature count.
 *   3. Any grant usable now → licensed (limits: the highest per key over the
 *      usable grants). Usable = from not_before until expiry + 24 hours.
 *   4. Otherwise a grant that ran out → expired (denied): the extension stops
 *      24 hours after expiry (owner decision; no grace period).
 *   5. Otherwise → unlicensed (denied).
 *
 * In-flight runs: a workflow step of the extension that runs after the cutoff
 * gets the expired decision, and the framework fails the step with
 * LicenceExpiredError (code extension_licence_expired, retryable: true). The
 * run's data is untouched: the engine parks the run, paused at that step, and
 * resuming it after renewal re-runs the step and continues.
 *
 * Caching: verified licences are kept in-process for LICENCE_CACHE_MS
 * (cleared on install / remove here; other processes pick changes up within
 * that time); workspace entitlement rows are cached through the cache
 * provider for ENTITLEMENT_CACHE_MS (shared with Redis / Postgres stores and
 * cleared on grant / revoke).
 */

import { LICENCE_KEYRING, type LicenceKey } from './keyring'
import {
  bindingMatches,
  checkLicenceSignature,
  featureGranted,
  licenceLimitsFor,
  LicenceFormatError,
  parseLicence,
  timingFor,
  warningThreshold,
} from './format'
import { envLicences, LICENCES_SETTING, storedLicences, type RawLicence } from './store'
import { getInstanceIdentity } from './instance'
import { recordLicenceEvent, shouldAuditDenial, type LicenceEvent } from './audit'
import type {
  EntitlementCheckInput,
  EntitlementDecision,
  ExtensionLicenceDeclaration,
  InstanceIdentity,
  LicenceDocument,
  LicenceProblem,
  LicenceTiming,
  TenantEntitlementRow,
  VerifiedLicence,
} from './types'

export const LICENCE_CACHE_MS = 60_000
export const ENTITLEMENT_CACHE_MS = 60_000

// ─── Dependencies (replaced in tests) ──────────────────────────────────────

export interface LicensingDeps {
  now: () => Date
  keyring: () => readonly LicenceKey[]
  identity: () => Promise<InstanceIdentity>
  /** Installed licences (setting + environment), unverified. */
  licences: () => Promise<RawLicence[]>
  /** A workspace's entitlement rows (every extension). */
  tenantEntitlements: (tenantId: string) => Promise<TenantEntitlementRow[]>
  /** The extension's manifest licence declaration (undefined: unknown → treated as paid). */
  licenceOf: (extensionId: string) => ExtensionLicenceDeclaration | null | undefined
  audit: (event: LicenceEvent) => Promise<void>
  shouldAuditDenial: (tenantId: string | null, extensionId: string, state: string) => Promise<boolean>
}

const declarations = new Map<string, ExtensionLicenceDeclaration>()

/** The framework registers each extension's manifest `licence` here (or passes licenceOf). */
export function registerExtensionLicence(extensionId: string, declaration: ExtensionLicenceDeclaration | null | undefined): void {
  if (declaration) declarations.set(extensionId, declaration)
  else declarations.delete(extensionId)
}

export const licensingDeps: LicensingDeps = {
  now: () => new Date(),
  keyring: () => LICENCE_KEYRING,
  identity: getInstanceIdentity,
  licences: defaultLicences,
  tenantEntitlements: defaultTenantEntitlements,
  licenceOf: (id) => declarations.get(id),
  audit: recordLicenceEvent,
  shouldAuditDenial,
}

async function defaultLicences(): Promise<RawLicence[]> {
  const out: RawLicence[] = []
  try {
    const { getInstanceSetting } = await import('@/lib/config/instance-settings')
    for (const raw of storedLicences(await getInstanceSetting(LICENCES_SETTING))) out.push({ source: 'setting', raw })
  } catch (error) {
    console.warn(`[licensing] stored licences unavailable: ${(error as Error).message}`)
  }
  out.push(...await envLicences())
  return out
}

let tableWarned = false

async function defaultTenantEntitlements(tenantId: string): Promise<TenantEntitlementRow[]> {
  const key = `lic:ent:${tenantId}`
  let store: Awaited<ReturnType<typeof import('@/lib/providers/cache').getCacheStore>> | null = null
  try {
    const { getCacheStore } = await import('@/lib/providers/cache')
    store = await getCacheStore()
    const hit = await store.get(key)
    if (hit) return JSON.parse(hit) as TenantEntitlementRow[]
  } catch { /* no cache: read through */ }
  const { hasServiceDb, getServiceDb } = await import('@/lib/providers/db')
  if (!hasServiceDb()) return []
  const { data, error } = await getServiceDb().from('tenant_entitlements')
    .select('id, tenant_id, extension_id, edition, features, limits, status, source, starts_at, ends_at')
    .eq('tenant_id', tenantId)
  if (error) {
    if (!tableWarned) {
      tableWarned = true
      console.warn(`[licensing] tenant_entitlements unavailable (apply migration 20270112000100_licensing): ${error.message}`)
    }
    return []
  }
  const rows = (data ?? []) as TenantEntitlementRow[]
  await store?.set(key, JSON.stringify(rows), ENTITLEMENT_CACHE_MS).catch(() => undefined)
  return rows
}

/** Drop a workspace's cached entitlement rows (after grant / revoke). */
export async function invalidateTenantEntitlements(tenantId: string): Promise<void> {
  try {
    const { getCacheStore } = await import('@/lib/providers/cache')
    await (await getCacheStore()).delete(`lic:ent:${tenantId}`)
  } catch { /* expires on its own */ }
}

// ─── Verification ──────────────────────────────────────────────────────────

/** Verify one installed licence (pure apart from crypto). */
export function verifyLicence(entry: RawLicence, identity: InstanceIdentity, now: Date, keyring: readonly LicenceKey[]): VerifiedLicence {
  if (entry.error) return { source: entry.source, licence: null, valid: false, problems: [{ code: 'malformed', message: entry.error }], timing: null }
  let licence: LicenceDocument
  try {
    licence = parseLicence(entry.raw)
  } catch (error) {
    const message = error instanceof LicenceFormatError ? error.message : `The licence could not be read: ${(error as Error).message}`
    return { source: entry.source, licence: null, valid: false, problems: [{ code: /format \d|Unsupported/.test(message) ? 'unsupported_format' : 'malformed', message }], timing: null }
  }
  const problems: LicenceProblem[] = []
  const signature = checkLicenceSignature(licence, keyring)
  if (signature) problems.push(signature)
  if (!bindingMatches(licence, identity)) {
    problems.push({ code: 'binding_mismatch', message: `Issued for another installation (instance ${licence.binding?.instance_ids?.join(', ') || '-'}; hosts ${licence.binding?.hostnames?.join(', ') || '-'}); this one is ${identity.instanceId ?? 'unknown'} at ${identity.hostnames.join(', ') || 'no APP_URL'}` })
  }
  const timing = timingFor(licence.expires_at, now, licence.not_before)
  if (timing.state === 'not_yet_valid') problems.push({ code: 'not_yet_valid', message: `Valid from ${licence.not_before}` })
  if (timing.state === 'expired') problems.push({ code: 'expired', message: `Expired ${licence.expires_at}; licensed extensions stopped at ${timing.cutoffAt}` })
  // `valid` = genuine and for this installation; timing decides whether it is usable now.
  const valid = !problems.some((p) => p.code === 'bad_signature' || p.code === 'unknown_key' || p.code === 'binding_mismatch')
  return { source: entry.source, licence, valid, problems, timing }
}

let licenceMemo: { at: number; value: VerifiedLicence[] } | null = null

/** Installed licences, verified (cached for LICENCE_CACHE_MS). */
export async function loadVerifiedLicences(options: { fresh?: boolean } = {}): Promise<VerifiedLicence[]> {
  const nowMs = Date.now()
  if (!options.fresh && licenceMemo && nowMs - licenceMemo.at < LICENCE_CACHE_MS) {
    // Timing is recomputed against the (injectable) clock; signatures and binding are cached.
    const now = licensingDeps.now()
    return licenceMemo.value.map((v) => (v.licence ? { ...v, ...retime(v, now) } : v))
  }
  const [raw, identity] = await Promise.all([licensingDeps.licences(), licensingDeps.identity()])
  const now = licensingDeps.now()
  const keyring = licensingDeps.keyring()
  const value = raw.map((entry) => verifyLicence(entry, identity, now, keyring))
  licenceMemo = { at: nowMs, value }
  return value
}

function retime(v: VerifiedLicence, now: Date): Pick<VerifiedLicence, 'timing' | 'problems'> {
  const timing = timingFor(v.licence!.expires_at, now, v.licence!.not_before)
  const problems = v.problems.filter((p) => p.code !== 'expired' && p.code !== 'not_yet_valid')
  if (timing.state === 'not_yet_valid') problems.push({ code: 'not_yet_valid', message: `Valid from ${v.licence!.not_before}` })
  if (timing.state === 'expired') problems.push({ code: 'expired', message: `Expired ${v.licence!.expires_at}; licensed extensions stopped at ${timing.cutoffAt}` })
  return { timing, problems }
}

export function invalidateLicenceCache(): void {
  licenceMemo = null
}

// ─── Decision (pure) ───────────────────────────────────────────────────────

export interface Grant {
  source: 'licence' | 'tenant_entitlement'
  /** licence_id or the entitlement row id. */
  ref: string
  features: string[] | null
  limits: Record<string, number>
  timing: LicenceTiming
  trial?: boolean
}

/** Grants for one extension from verified licences (valid ones only). */
export function licenceGrants(licences: VerifiedLicence[], extensionId: string): Grant[] {
  const out: Grant[] = []
  for (const v of licences) {
    if (!v.valid || !v.licence || !v.timing) continue
    for (const grant of v.licence.extensions) {
      if (grant.id !== extensionId) continue
      out.push({ source: 'licence', ref: v.licence.licence_id, features: grant.features ?? null, limits: licenceLimitsFor(v.licence, extensionId), timing: v.timing, trial: v.licence.trial })
    }
  }
  return out
}

/** Grants for one extension from a workspace's entitlement rows (active ones only). */
export function entitlementGrants(rows: TenantEntitlementRow[], extensionId: string, now: Date): Grant[] {
  return rows
    .filter((row) => row.extension_id === extensionId && row.status === 'active')
    .map((row) => {
      const limits: Record<string, number> = {}
      for (const [key, value] of Object.entries(row.limits ?? {})) {
        if (typeof value === 'number' && Number.isFinite(value)) limits[key.startsWith(`${extensionId}.`) ? key : `${extensionId}.${key}`] = value
      }
      return { source: 'tenant_entitlement' as const, ref: String(row.id ?? row.extension_id), features: row.features ?? null, limits, timing: timingFor(row.ends_at ?? null, now, row.starts_at ?? null), trial: row.source === 'trial' }
    })
}

function cutoffMs(g: Grant): number {
  return g.timing.cutoffAt ? Date.parse(g.timing.cutoffAt) : Number.POSITIVE_INFINITY
}

function day(iso: string | null): string {
  return iso ? iso.replace('T', ' ').replace(/:\d\d(\.\d+)?Z$/, ' UTC') : ''
}

export function resolveDecision(input: { extensionId: string; feature?: string; declaration?: ExtensionLicenceDeclaration | null; grants: Grant[]; inactiveRows?: TenantEntitlementRow[] }): EntitlementDecision {
  const { extensionId, feature, declaration, grants } = input
  if (declaration?.tier === 'free') return { allowed: true, state: 'not_required' }
  const what = feature ? `${extensionId} (${feature})` : extensionId
  const featured = grants.filter((g) => featureGranted(g.features, feature))
  const usable = featured.filter((g) => g.timing.usable)
  if (usable.length) {
    const best = usable.reduce((a, b) => (cutoffMs(b) > cutoffMs(a) ? b : a))
    const limits: Record<string, number> = {}
    for (const g of usable) for (const [k, v] of Object.entries(g.limits)) limits[k] = Math.max(limits[k] ?? 0, v)
    let reason: string | undefined
    if (best.timing.state === 'cutoff_pending') reason = `The licence for ${what} expired at ${day(best.timing.expiresAt)}; the extension stops at ${day(best.timing.cutoffAt)} (24 hours after expiry). Renew the licence now.`
    else if (best.timing.state === 'expiring') reason = `The licence for ${what} expires in ${best.timing.daysLeft} day${best.timing.daysLeft === 1 ? '' : 's'} (${day(best.timing.expiresAt)}); the extension stops 24 hours later.`
    return { allowed: true, state: 'licensed', ...(reason ? { reason } : {}), limits }
  }
  const expired = featured.filter((g) => g.timing.state === 'expired')
  if (expired.length) {
    const last = expired.reduce((a, b) => (cutoffMs(b) > cutoffMs(a) ? b : a))
    return {
      allowed: false,
      state: 'expired',
      reason: `The licence for ${what} expired at ${day(last.timing.expiresAt)} and the extension stopped at ${day(last.timing.cutoffAt)} (24 hours after expiry). Install a renewed licence; steps that failed with "licence expired" can be retried afterwards.`,
    }
  }
  if (featured.some((g) => g.timing.state === 'not_yet_valid')) {
    return { allowed: false, state: 'unlicensed', reason: `The licence for ${what} is not valid yet.` }
  }
  if (feature && grants.some((g) => g.timing.usable)) {
    return { allowed: false, state: 'unlicensed', reason: `The licence for ${extensionId} does not include the "${feature}" feature.` }
  }
  if (input.inactiveRows?.some((r) => r.extension_id === extensionId && r.status === 'suspended')) {
    return { allowed: false, state: 'unlicensed', reason: `The ${extensionId} entitlement of this workspace is suspended.` }
  }
  return { allowed: false, state: 'unlicensed', reason: `${extensionId} is not licensed on this installation. An instance admin can install a licence in Settings → Licence (or usertasks-admin licence install).` }
}

// ─── Check ─────────────────────────────────────────────────────────────────

export async function checkEntitlement(input: EntitlementCheckInput): Promise<EntitlementDecision> {
  const declaration = licensingDeps.licenceOf(input.extensionId)
  if (declaration?.tier === 'free') return { allowed: true, state: 'not_required' }
  let decision: EntitlementDecision
  try {
    const now = licensingDeps.now()
    const [licences, rows] = await Promise.all([
      loadVerifiedLicences(),
      input.tenantId ? licensingDeps.tenantEntitlements(input.tenantId).catch(() => []) : Promise.resolve([] as TenantEntitlementRow[]),
    ])
    const grants = [...licenceGrants(licences, input.extensionId), ...entitlementGrants(rows, input.extensionId, now)]
    decision = resolveDecision({ extensionId: input.extensionId, feature: input.feature, declaration, grants, inactiveRows: rows })
  } catch (error) {
    // Fail closed, with the reason.
    decision = { allowed: false, state: 'unlicensed', reason: `The licence could not be checked: ${(error as Error).message}` }
  }
  if (!decision.allowed) void auditDenial(input, decision)
  return decision
}

async function auditDenial(input: EntitlementCheckInput, decision: EntitlementDecision): Promise<void> {
  try {
    if (!(await licensingDeps.shouldAuditDenial(input.tenantId, input.extensionId, decision.state))) return
    await licensingDeps.audit({
      event: 'denied',
      extensionId: input.extensionId,
      tenantId: input.tenantId,
      actor: 'system',
      summary: `Denied ${input.extensionId}${input.feature ? ` (${input.feature})` : ''}: ${decision.state}`,
      detail: { state: decision.state, feature: input.feature ?? null, reason: decision.reason ?? null },
    })
  } catch { /* never throws */ }
}

// ─── Status (Settings → Licence, CLI, API) ─────────────────────────────────

export interface LicenceWarning {
  level: 'info' | 'warn' | 'error'
  code: 'expiring' | 'cutoff_pending' | 'expired' | 'invalid' | 'not_yet_valid'
  licenceId: string | null
  message: string
  /** Days left until expiry (expiring). */
  daysLeft?: number | null
  cutoffAt?: string | null
}

export interface ExtensionStatus {
  id: string
  state: EntitlementDecision['state']
  allowed: boolean
  licenceId: string | null
  features: string[] | null
  limits: Record<string, number>
  expiresAt: string | null
  cutoffAt: string | null
  daysLeft: number | null
  timeState: LicenceTiming['state'] | null
  trial: boolean
}

export interface LicenceSummary {
  licenceId: string | null
  source: VerifiedLicence['source']
  customer: string | null
  issuedAt: string | null
  expiresAt: string | null
  cutoffAt: string | null
  updatesUntil: string | null
  daysLeft: number | null
  timeState: LicenceTiming['state'] | null
  valid: boolean
  trial: boolean
  bound: { instanceIds: string[]; hostnames: string[] }
  extensions: Array<{ id: string; edition: string | null; features: string[] | null }>
  limits: Record<string, number>
  kid: string | null
  problems: LicenceProblem[]
}

export interface LicenceStatus {
  instance: InstanceIdentity
  now: string
  licences: LicenceSummary[]
  extensions: ExtensionStatus[]
  warnings: LicenceWarning[]
}

export function summarise(v: VerifiedLicence): LicenceSummary {
  const l = v.licence
  const limits: Record<string, number> = {}
  if (l) for (const g of l.extensions) Object.assign(limits, licenceLimitsFor(l, g.id))
  return {
    licenceId: l?.licence_id ?? null,
    source: v.source,
    customer: l?.customer.name ?? null,
    issuedAt: l?.issued_at ?? null,
    expiresAt: v.timing?.expiresAt ?? null,
    cutoffAt: v.timing?.cutoffAt ?? null,
    updatesUntil: l?.updates_until ?? null,
    daysLeft: v.timing?.daysLeft ?? null,
    timeState: v.timing?.state ?? null,
    valid: v.valid,
    trial: l?.trial === true,
    bound: { instanceIds: l?.binding?.instance_ids ?? [], hostnames: l?.binding?.hostnames ?? [] },
    extensions: l?.extensions.map((g) => ({ id: g.id, edition: g.edition ?? null, features: g.features ?? null })) ?? [],
    limits,
    kid: l?.kid ?? null,
    problems: v.problems,
  }
}

/** Warnings for admins (banner, CLI, emails). */
export function licenceWarnings(licences: VerifiedLicence[]): LicenceWarning[] {
  const out: LicenceWarning[] = []
  for (const v of licences) {
    const id = v.licence?.licence_id ?? null
    const name = id ? `Licence ${id}` : 'A licence'
    if (!v.valid) {
      out.push({ level: 'error', code: 'invalid', licenceId: id, message: `${name} (${v.source}) is not valid: ${v.problems.map((p) => p.message).join('; ')}` })
      continue
    }
    const t = v.timing
    if (!t) continue
    const exts = v.licence!.extensions.map((g) => g.id).join(', ')
    if (t.state === 'expired') out.push({ level: 'error', code: 'expired', licenceId: id, cutoffAt: t.cutoffAt, message: `${name} expired at ${day(t.expiresAt)}: ${exts} stopped at ${day(t.cutoffAt)}.` })
    else if (t.state === 'cutoff_pending') out.push({ level: 'error', code: 'cutoff_pending', licenceId: id, cutoffAt: t.cutoffAt, message: `${name} expired at ${day(t.expiresAt)}: ${exts} stop at ${day(t.cutoffAt)} unless it is renewed.` })
    else if (t.state === 'expiring') out.push({ level: warningThreshold(t.daysLeft) !== null && (t.daysLeft ?? 99) <= 7 ? 'warn' : 'info', code: 'expiring', licenceId: id, daysLeft: t.daysLeft, cutoffAt: t.cutoffAt, message: `${name} expires in ${t.daysLeft} day${t.daysLeft === 1 ? '' : 's'} (${day(t.expiresAt)}); ${exts} stop 24 hours later unless it is renewed.` })
    else if (t.state === 'not_yet_valid') out.push({ level: 'info', code: 'not_yet_valid', licenceId: id, message: `${name} is installed and becomes valid at ${day(v.licence!.not_before ?? null)}.` })
  }
  return out
}

/** Instance-wide status: licences, the extensions they grant, warnings. */
export async function getLicenceStatus(options: { fresh?: boolean } = {}): Promise<LicenceStatus> {
  const [licences, instance] = await Promise.all([loadVerifiedLicences(options), licensingDeps.identity()])
  const now = licensingDeps.now()
  const ids = [...new Set(licences.flatMap((v) => (v.valid && v.licence ? v.licence.extensions.map((g) => g.id) : [])))].sort()
  const extensions: ExtensionStatus[] = ids.map((id) => {
    const grants = licenceGrants(licences, id)
    const decision = resolveDecision({ extensionId: id, declaration: licensingDeps.licenceOf(id), grants })
    const best = grants.reduce<Grant | null>((a, b) => (!a || cutoffMs(b) > cutoffMs(a) ? b : a), null)
    return {
      id,
      state: decision.state,
      allowed: decision.allowed,
      licenceId: best?.ref ?? null,
      features: best?.features ?? null,
      limits: decision.limits ?? best?.limits ?? {},
      expiresAt: best?.timing.expiresAt ?? null,
      cutoffAt: best?.timing.cutoffAt ?? null,
      daysLeft: best?.timing.daysLeft ?? null,
      timeState: best?.timing.state ?? null,
      trial: best?.trial === true,
    }
  })
  return { instance, now: now.toISOString(), licences: licences.map(summarise), extensions, warnings: licenceWarnings(licences) }
}
