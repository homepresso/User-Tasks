/**
 * Licensing (lib/licensing): Ed25519 licence verification (good / bad /
 * tampered / unknown key id), binding, the expiry boundary (24-hour cutoff,
 * no grace period), the per-farm limit helper, cloud entitlement resolution,
 * the EntitlementPort for free / paid extensions, the daily notice job and
 * the env / secret licence sources.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  bindingMatches, checkLicenceSignature, decodeLicenceText, EXPIRY_CUTOFF_MS, featureGranted, licenceLimitsFor,
  LicenceFormatError, parseLicence, timingFor, warningThreshold,
} from '@/lib/licensing/format'
import {
  checkEntitlement, entitlementGrants, getLicenceStatus, invalidateLicenceCache, licenceGrants, licensingDeps,
  registerExtensionLicence, resolveDecision, verifyLicence, type LicensingDeps,
} from '@/lib/licensing/service'
import { checkLimit, checkUsageLimit, registerUsageCounter, unregisterUsageCounter, usageFor } from '@/lib/licensing/limits'
import { registerLicensingEntitlements } from '@/lib/licensing/entitlement-port-impl'
import { assertEntitled, LicenceDeniedError, LicenceExpiredError } from '@/lib/licensing/errors'
import { checkInstallable, activationRequest } from '@/lib/licensing/install'
import { ensureInstanceId, generateInstanceId, INSTANCE_ID_PATTERN, instanceHostnames } from '@/lib/licensing/instance'
import { envLicences, mergeLicence, removeLicence } from '@/lib/licensing/store'
import { noticeFor, runLicenceCheck, type Notices } from '@/lib/jobs/licence-check'
import { LICENCE_KEYRING } from '@/lib/licensing/keyring'
import type { EntitlementPort, TenantEntitlementRow } from '@/lib/licensing/types'
import { makeLicence, throwawayKey } from './helpers/licence-fixtures'

const KEY = throwawayKey('test-1')
const OTHER = throwawayKey('test-2')
const KEYRING = [KEY.entry]
const IDENTITY = { instanceId: 'inst_abcdefghijklmnopqrstuvwx', hostnames: ['usertasks.corp.example'] }
const EXPIRES = '2027-11-01T00:00:00.000Z'
const at = (iso: string) => new Date(iso)
const plus = (iso: string, ms: number) => new Date(Date.parse(iso) + ms)

describe('licence format and signature', () => {
  it('verifies a genuine licence from the keyring', () => {
    const doc = makeLicence(KEY.pem, 'test-1')
    expect(checkLicenceSignature(doc, KEYRING)).toBeNull()
    const v = verifyLicence({ source: 'setting', raw: JSON.stringify(doc, null, 2) }, IDENTITY, at('2027-01-01T00:00:00Z'), KEYRING)
    expect(v.valid).toBe(true)
    expect(v.problems).toEqual([])
    expect(v.timing?.state).toBe('active')
  })

  it('accepts base64 (environment variables) and key order does not matter', () => {
    const doc = makeLicence(KEY.pem, 'test-1')
    const b64 = Buffer.from(JSON.stringify(doc)).toString('base64')
    expect(parseLicence(b64).licence_id).toBe('lic_test_1')
    const reordered = Object.fromEntries(Object.entries(doc).reverse())
    expect(checkLicenceSignature(parseLicence(reordered), KEYRING)).toBeNull()
  })

  it('rejects a tampered licence', () => {
    const doc = makeLicence(KEY.pem, 'test-1')
    for (const tampered of [
      { ...doc, expires_at: '2099-01-01T00:00:00.000Z' },
      { ...doc, limits: { 'sharepoint.farms': 99 } },
      { ...doc, extensions: [{ id: 'sharepoint' }, { id: 'cases' }] },
      { ...doc, binding: { instance_ids: [] } },
    ]) {
      expect(checkLicenceSignature(tampered, KEYRING)?.code).toBe('bad_signature')
      expect(verifyLicence({ source: 'setting', raw: tampered }, IDENTITY, at('2027-01-01T00:00:00Z'), KEYRING).valid).toBe(false)
    }
  })

  it('rejects a bad signature value and a key-id mismatch', () => {
    const doc = makeLicence(KEY.pem, 'test-1')
    const forged = makeLicence(OTHER.pem, 'test-1') // signed by another key under our kid
    expect(checkLicenceSignature(forged, KEYRING)?.code).toBe('bad_signature')
    expect(checkLicenceSignature({ ...doc, signature: { ...doc.signature, value: Buffer.alloc(64).toString('base64') } }, KEYRING)?.code).toBe('bad_signature')
    expect(checkLicenceSignature({ ...doc, signature: { ...doc.signature, kid: 'test-2' } }, KEYRING)?.code).toBe('bad_signature')
  })

  it('rejects an unknown key id', () => {
    const doc = makeLicence(OTHER.pem, 'test-2')
    expect(checkLicenceSignature(doc, KEYRING)?.code).toBe('unknown_key')
    // …and the production keyring does not trust throwaway keys.
    expect(checkLicenceSignature(makeLicence(KEY.pem, 'test-1'), LICENCE_KEYRING)?.code).toBe('unknown_key')
  })

  it('reports malformed input', () => {
    expect(() => decodeLicenceText('')).toThrow(LicenceFormatError)
    expect(() => parseLicence('not a licence!')).toThrow(LicenceFormatError)
    expect(() => parseLicence({ kind: 'usertasks.licence', format: 2 })).toThrow(/Unsupported licence format/)
    expect(() => parseLicence({ kind: 'usertasks.package' })).toThrow(/Not a UserTasks licence/)
    const v = verifyLicence({ source: 'env', raw: '{"kind":"usertasks.licence","format":1}' }, IDENTITY, new Date(), KEYRING)
    expect(v.valid).toBe(false)
    expect(v.problems[0].code).toBe('malformed')
  })

  it('the production keyring holds public keys only', () => {
    for (const k of LICENCE_KEYRING) {
      expect(k.public_key).toMatch(/^MCowBQYDK2VwAyEA[A-Za-z0-9+/]{43}=$/) // ed25519 SPKI
      expect(JSON.stringify(k)).not.toMatch(/PRIVATE/)
    }
  })
})

describe('binding', () => {
  it('unbound licences match anywhere', () => {
    expect(bindingMatches({}, { instanceId: null, hostnames: [] })).toBe(true)
    expect(bindingMatches({ binding: { instance_ids: [], hostnames: [] } }, IDENTITY)).toBe(true)
  })

  it('matches the instance id or a hostname (exact or *.wildcard), case-insensitively', () => {
    expect(bindingMatches({ binding: { instance_ids: [IDENTITY.instanceId] } }, IDENTITY)).toBe(true)
    expect(bindingMatches({ binding: { hostnames: ['USERTASKS.corp.example'] } }, IDENTITY)).toBe(true)
    expect(bindingMatches({ binding: { hostnames: ['*.corp.example'] } }, IDENTITY)).toBe(true)
    expect(bindingMatches({ binding: { hostnames: ['*.corp.example'] } }, { instanceId: null, hostnames: ['corp.example'] })).toBe(false)
    expect(bindingMatches({ binding: { instance_ids: ['inst_other'], hostnames: ['other.example'] } }, IDENTITY)).toBe(false)
  })

  it('a licence for another installation is invalid', () => {
    const doc = makeLicence(KEY.pem, 'test-1', { binding: { instance_ids: ['inst_someoneelse0000000000000'] } })
    const v = verifyLicence({ source: 'setting', raw: doc }, IDENTITY, at('2027-01-01T00:00:00Z'), KEYRING)
    expect(v.valid).toBe(false)
    expect(v.problems.map((p) => p.code)).toContain('binding_mismatch')
  })

  it('instance ids and hostnames', async () => {
    expect(generateInstanceId()).toMatch(INSTANCE_ID_PATTERN)
    expect(generateInstanceId()).not.toBe(generateInstanceId())
    expect(instanceHostnames('https://UserTasks.Corp.example:8443/path')).toEqual(['usertasks.corp.example'])
    expect(instanceHostnames('usertasks.example')).toEqual(['usertasks.example'])
    expect(instanceHostnames(undefined)).toEqual([])
    // created once, never overwritten
    let stored: unknown
    const store = { read: async () => stored, insertIfAbsent: async (v: string) => { stored ??= v } }
    const first = await ensureInstanceId(store)
    expect(first).toMatch(INSTANCE_ID_PATTERN)
    expect(await ensureInstanceId(store)).toBe(first)
    expect(await ensureInstanceId(null)).toBeNull()
  })
})

describe('expiry: extensions stop 24 hours after expiry', () => {
  it('boundaries', () => {
    expect(timingFor(EXPIRES, plus(EXPIRES, -1)).state).toBe('expiring')
    const atExpiry = timingFor(EXPIRES, at(EXPIRES))
    expect(atExpiry).toMatchObject({ state: 'cutoff_pending', usable: true, daysLeft: 0, cutoffAt: '2027-11-02T00:00:00.000Z' })
    expect(timingFor(EXPIRES, plus(EXPIRES, 23 * 3600_000 + 59 * 60_000))).toMatchObject({ state: 'cutoff_pending', usable: true })
    expect(timingFor(EXPIRES, plus(EXPIRES, EXPIRY_CUTOFF_MS - 1)).usable).toBe(true)
    expect(timingFor(EXPIRES, plus(EXPIRES, EXPIRY_CUTOFF_MS))).toMatchObject({ state: 'expired', usable: false })
    expect(timingFor(EXPIRES, at('2027-01-01T00:00:00Z')).state).toBe('active')
    expect(timingFor(EXPIRES, at('2027-01-01T00:00:00Z'), '2027-02-01T00:00:00Z').state).toBe('not_yet_valid')
    expect(timingFor(null, new Date())).toMatchObject({ state: 'active', usable: true })
  })

  it('warning thresholds 30 / 14 / 7 / 1', () => {
    expect(warningThreshold(31)).toBeNull()
    expect(warningThreshold(30)).toBe(30)
    expect(warningThreshold(15)).toBe(30)
    expect(warningThreshold(14)).toBe(14)
    expect(warningThreshold(7)).toBe(7)
    expect(warningThreshold(1)).toBe(1)
    expect(warningThreshold(0)).toBe(1)
    expect(timingFor(EXPIRES, plus(EXPIRES, -30 * 86400_000)).state).toBe('expiring')
    expect(timingFor(EXPIRES, plus(EXPIRES, -31 * 86400_000)).state).toBe('active')
  })

  function decide(now: Date) {
    const doc = makeLicence(KEY.pem, 'test-1')
    const v = verifyLicence({ source: 'setting', raw: doc }, IDENTITY, now, KEYRING)
    return resolveDecision({ extensionId: 'sharepoint', grants: licenceGrants([v], 'sharepoint') })
  }

  it('decision at expiry, +23h59 and +24h', () => {
    expect(decide(at(EXPIRES))).toMatchObject({ allowed: true, state: 'licensed' })
    expect(decide(at(EXPIRES)).reason).toMatch(/stops at 2027-11-02 00:00 UTC/)
    expect(decide(plus(EXPIRES, 23 * 3600_000 + 59 * 60_000))).toMatchObject({ allowed: true, state: 'licensed' })
    const after = decide(plus(EXPIRES, EXPIRY_CUTOFF_MS))
    expect(after).toMatchObject({ allowed: false, state: 'expired' })
    expect(after.reason).toMatch(/retried/)
    expect(decide(plus(EXPIRES, -10 * 86400_000)).reason).toMatch(/expires in 10 days/)
  })

  it('in-flight steps get a retryable licence-expired error', () => {
    const decision = decide(plus(EXPIRES, EXPIRY_CUTOFF_MS))
    let caught: unknown
    try { assertEntitled('sharepoint', decision, 'connector') } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(LicenceExpiredError)
    expect(caught).toMatchObject({ code: 'extension_licence_expired', status: 402, retryable: true, extensionId: 'sharepoint' })
    let denied: unknown
    try { assertEntitled('cases', { allowed: false, state: 'unlicensed', reason: 'no' }) } catch (e) { denied = e }
    expect(denied).toBeInstanceOf(LicenceDeniedError)
    expect(denied).toMatchObject({ code: 'extension_not_licensed', status: 402, retryable: false })
    expect(() => assertEntitled('sharepoint', decide(at(EXPIRES)))).not.toThrow()
  })
})

describe('limits (SharePoint per farm)', () => {
  it('namespaces extension limits and keeps top-level ones', () => {
    const doc = makeLicence(KEY.pem, 'test-1', { limits: { 'sharepoint.active_users': 500, 'cases.seats': 3 } })
    expect(licenceLimitsFor(doc, 'sharepoint')).toEqual({ 'sharepoint.active_users': 500, 'sharepoint.farms': 2 })
  })

  it('checkLimit: usage vs limit', () => {
    const limits = { 'sharepoint.farms': 2 }
    expect(checkLimit({ limits, key: 'sharepoint.farms', usage: 1 })).toMatchObject({ allowed: true, limit: 2, remaining: 1 })
    const third = checkLimit({ limits, key: 'sharepoint.farms', usage: 2 })
    expect(third).toMatchObject({ allowed: false, limit: 2, usage: 2, remaining: 0 })
    expect(third.reason).toMatch(/2 of 2/)
    expect(checkLimit({ limits, key: 'sharepoint.farms', usage: 0, adding: 3 }).allowed).toBe(false)
    expect(checkLimit({ limits, key: 'sharepoint.farms', usage: 2, adding: 0 }).allowed).toBe(true)
    expect(checkLimit({ limits: {}, key: 'sharepoint.farms', usage: 50 })).toMatchObject({ allowed: true, limit: null })
    expect(checkLimit({ limits: {}, key: 'sharepoint.farms', usage: 0, missing: 'deny' }).allowed).toBe(false)
  })

  it('checkUsageLimit combines entitlement and limit', async () => {
    const count = async () => 2
    expect((await checkUsageLimit({ decision: { allowed: true, state: 'licensed', limits: { 'sharepoint.farms': 2 } }, key: 'sharepoint.farms', countUsage: count })).allowed).toBe(false)
    expect((await checkUsageLimit({ decision: { allowed: true, state: 'licensed', limits: { 'sharepoint.farms': 3 } }, key: 'sharepoint.farms', countUsage: count })).allowed).toBe(true)
    expect((await checkUsageLimit({ decision: { allowed: false, state: 'expired', reason: 'expired' }, key: 'sharepoint.farms', countUsage: count })).reason).toBe('expired')
    expect((await checkUsageLimit({ decision: { allowed: true, state: 'not_required' }, key: 'x', countUsage: count })).allowed).toBe(true)
  })

  it('usage counters', async () => {
    registerUsageCounter('sharepoint.farms', async () => 1)
    registerUsageCounter('sharepoint.broken', async () => { throw new Error('x') })
    expect(await usageFor(['sharepoint.farms', 'sharepoint.broken', 'sharepoint.none'])).toEqual({ 'sharepoint.farms': 1, 'sharepoint.broken': null, 'sharepoint.none': null })
    unregisterUsageCounter('sharepoint.farms')
    unregisterUsageCounter('sharepoint.broken')
  })
})

describe('decision rules and cloud entitlements', () => {
  const now = at('2027-01-01T00:00:00Z')
  const row = (over: Partial<TenantEntitlementRow> = {}): TenantEntitlementRow => ({ id: 'e1', tenant_id: 't1', extension_id: 'sharepoint', status: 'active', source: 'admin', features: [], limits: { farms: 1 }, ...over })

  it('features', () => {
    expect(featureGranted(undefined, 'x')).toBe(true)
    expect(featureGranted([], 'x')).toBe(true)
    expect(featureGranted(['*'], 'x')).toBe(true)
    expect(featureGranted(['a'], 'x')).toBe(false)
    expect(featureGranted(['a'], undefined)).toBe(true)
  })

  it('cloud rows: active, dated, suspended, other extension', () => {
    expect(resolveDecision({ extensionId: 'sharepoint', grants: entitlementGrants([row()], 'sharepoint', now) })).toMatchObject({ allowed: true, state: 'licensed', limits: { 'sharepoint.farms': 1 } })
    expect(resolveDecision({ extensionId: 'sharepoint', grants: entitlementGrants([row({ ends_at: '2026-12-30T00:00:00Z' })], 'sharepoint', now) })).toMatchObject({ allowed: false, state: 'expired' })
    expect(resolveDecision({ extensionId: 'sharepoint', grants: entitlementGrants([row({ ends_at: '2026-12-31T01:00:00Z' })], 'sharepoint', now) })).toMatchObject({ allowed: true })
    expect(resolveDecision({ extensionId: 'sharepoint', grants: entitlementGrants([row({ starts_at: '2027-02-01T00:00:00Z' })], 'sharepoint', now) }).reason).toMatch(/not valid yet/)
    const suspended = [row({ status: 'suspended' })]
    expect(resolveDecision({ extensionId: 'sharepoint', grants: entitlementGrants(suspended, 'sharepoint', now), inactiveRows: suspended })).toMatchObject({ allowed: false, state: 'unlicensed', reason: expect.stringMatching(/suspended/) })
    expect(resolveDecision({ extensionId: 'sharepoint', grants: entitlementGrants([row({ extension_id: 'cases' })], 'sharepoint', now) }).state).toBe('unlicensed')
    expect(resolveDecision({ extensionId: 'sharepoint', feature: 'importers', grants: entitlementGrants([row({ features: ['connector'] })], 'sharepoint', now) }).reason).toMatch(/does not include the "importers" feature/)
  })

  it('best grant wins; limits are the highest per key', () => {
    const doc = makeLicence(KEY.pem, 'test-1') // farms 2
    const v = verifyLicence({ source: 'setting', raw: doc }, IDENTITY, now, KEYRING)
    const grants = [...licenceGrants([v], 'sharepoint'), ...entitlementGrants([row({ limits: { 'sharepoint.farms': 5 }, ends_at: '2026-12-31T12:00:00Z' })], 'sharepoint', now)]
    expect(resolveDecision({ extensionId: 'sharepoint', grants })).toMatchObject({ allowed: true, limits: { 'sharepoint.farms': 5 } })
  })

  it('free extensions are not_required', () => {
    expect(resolveDecision({ extensionId: 'scanner', declaration: { tier: 'free' }, grants: [] })).toEqual({ allowed: true, state: 'not_required' })
  })
})

describe('EntitlementPort (service with injected sources)', () => {
  let saved: LicensingDeps
  let licences: unknown[]
  let rows: TenantEntitlementRow[]
  let audited: string[]
  let clock: Date

  beforeEach(() => {
    saved = { ...licensingDeps }
    licences = []
    rows = []
    audited = []
    clock = at('2027-01-01T00:00:00Z')
    Object.assign(licensingDeps, {
      now: () => clock,
      keyring: () => KEYRING,
      identity: async () => IDENTITY,
      licences: async () => licences.map((raw) => ({ source: 'setting' as const, raw })),
      tenantEntitlements: async (tenantId: string) => rows.filter((r) => r.tenant_id === tenantId),
      audit: async (e: { event: string; extensionId?: string | null }) => { audited.push(`${e.event}:${e.extensionId}`) },
      shouldAuditDenial: async () => true,
    } satisfies Partial<LicensingDeps>)
    invalidateLicenceCache()
  })
  afterEach(() => {
    Object.assign(licensingDeps, saved)
    invalidateLicenceCache()
    registerExtensionLicence('scanner', null)
    registerExtensionLicence('sharepoint', null)
  })

  it('wires into the framework and answers free / paid / unknown', async () => {
    let port: EntitlementPort | null = null
    registerLicensingEntitlements((p) => { port = p }, { declarations: { scanner: { tier: 'free' }, sharepoint: { tier: 'paid', sku: 'SP' } } })
    expect(port).not.toBeNull()
    expect(await port!.check({ tenantId: null, extensionId: 'scanner' })).toEqual({ allowed: true, state: 'not_required' })
    expect(await port!.check({ tenantId: null, extensionId: 'sharepoint' })).toMatchObject({ allowed: false, state: 'unlicensed' })
    // unknown extension → treated as paid (fail closed)
    expect(await port!.check({ tenantId: null, extensionId: 'mystery' })).toMatchObject({ allowed: false })
    licences = [makeLicence(KEY.pem, 'test-1')]
    invalidateLicenceCache()
    expect(await port!.check({ tenantId: 't1', extensionId: 'sharepoint', feature: 'connector' })).toMatchObject({ allowed: true, state: 'licensed', limits: { 'sharepoint.farms': 2 } })
    expect(await port!.check({ tenantId: 't1', extensionId: 'sharepoint', feature: 'addin' })).toMatchObject({ allowed: false })
  })

  it('cloud entitlement applies to its workspace only', async () => {
    rows = [{ tenant_id: 't1', extension_id: 'sharepoint', status: 'active', source: 'admin', limits: { farms: 1 } }]
    expect(await checkEntitlement({ tenantId: 't1', extensionId: 'sharepoint' })).toMatchObject({ allowed: true, limits: { 'sharepoint.farms': 1 } })
    expect(await checkEntitlement({ tenantId: 't2', extensionId: 'sharepoint' })).toMatchObject({ allowed: false })
    expect(await checkEntitlement({ tenantId: null, extensionId: 'sharepoint' })).toMatchObject({ allowed: false })
  })

  it('follows the injected clock across the cutoff and audits denials', async () => {
    licences = [makeLicence(KEY.pem, 'test-1')]
    clock = plus(EXPIRES, 23 * 3600_000)
    expect((await checkEntitlement({ tenantId: 't1', extensionId: 'sharepoint' })).allowed).toBe(true)
    clock = plus(EXPIRES, EXPIRY_CUTOFF_MS)
    expect(await checkEntitlement({ tenantId: 't1', extensionId: 'sharepoint' })).toMatchObject({ allowed: false, state: 'expired' })
    await new Promise((r) => setTimeout(r, 0))
    expect(audited).toContain('denied:sharepoint')
  })

  it('fails closed when a source throws', async () => {
    licensingDeps.licences = async () => { throw new Error('db down') }
    expect(await checkEntitlement({ tenantId: null, extensionId: 'sharepoint' })).toMatchObject({ allowed: false, reason: expect.stringMatching(/db down/) })
  })

  it('status: licences, extensions, warnings', async () => {
    licences = [makeLicence(KEY.pem, 'test-1'), makeLicence(OTHER.pem, 'test-2', { licence_id: 'lic_foreign' })]
    clock = plus(EXPIRES, -5 * 86400_000)
    const status = await getLicenceStatus({ fresh: true })
    expect(status.instance).toEqual(IDENTITY)
    expect(status.licences).toHaveLength(2)
    expect(status.extensions).toEqual([expect.objectContaining({ id: 'sharepoint', allowed: true, daysLeft: 5, limits: { 'sharepoint.farms': 2 } })])
    expect(status.warnings.map((w) => w.code).sort()).toEqual(['expiring', 'invalid'])
    expect(status.warnings.find((w) => w.code === 'expiring')?.level).toBe('warn')
  })

  it('daily job: one notice per threshold, emailed to instance admins', async () => {
    licences = [makeLicence(KEY.pem, 'test-1')]
    let notices: Notices = {}
    const sent: string[] = []
    const deps = {
      readNotices: async () => structuredClone(notices),
      writeNotices: async (n: Notices) => { notices = n },
      adminEmails: async () => ['ops@example.com'],
      sendEmail: async (_to: string[], subject: string) => { sent.push(subject); return true },
      appUrl: () => 'https://usertasks.corp.example',
    }
    clock = plus(EXPIRES, -20 * 86400_000)
    expect((await runLicenceCheck(deps)).notices).toEqual([{ licence_id: 'lic_test_1', notice: 'd30', emailed: 1 }])
    expect((await runLicenceCheck(deps)).notices).toEqual([]) // not twice
    clock = plus(EXPIRES, -6 * 86400_000)
    expect((await runLicenceCheck(deps)).notices[0].notice).toBe('d7')
    clock = plus(EXPIRES, 3600_000)
    expect((await runLicenceCheck(deps)).notices[0].notice).toBe('cutoff_pending')
    clock = plus(EXPIRES, EXPIRY_CUTOFF_MS)
    expect((await runLicenceCheck(deps)).notices[0].notice).toBe('expired')
    expect(sent).toHaveLength(4)
    expect(sent[3]).toMatch(/stopped/)
    expect(audited.filter((a) => a.startsWith('expir'))).toHaveLength(4)
    expect(noticeFor({ valid: false, timeState: 'expired', daysLeft: -1 })).toBeNull()
  })
})

describe('install checks, activation request, sources', () => {
  const now = at('2027-01-01T00:00:00Z')

  it('refuses invalid, foreign and expired licences; notes future ones', () => {
    expect(checkInstallable(JSON.stringify(makeLicence(KEY.pem, 'test-1')), IDENTITY, now, KEYRING).ok).toBe(true)
    expect(checkInstallable('garbage', IDENTITY, now, KEYRING).problems[0].code).toBe('malformed')
    expect(checkInstallable(JSON.stringify(makeLicence(OTHER.pem, 'test-2')), IDENTITY, now, KEYRING).problems[0].code).toBe('unknown_key')
    expect(checkInstallable(JSON.stringify(makeLicence(KEY.pem, 'test-1', { binding: { hostnames: ['other.example'] } })), IDENTITY, now, KEYRING).ok).toBe(false)
    expect(checkInstallable(JSON.stringify(makeLicence(KEY.pem, 'test-1', { expires_at: '2026-12-30T00:00:00Z' })), IDENTITY, now, KEYRING).problems[0].code).toBe('expired')
    const future = checkInstallable(JSON.stringify(makeLicence(KEY.pem, 'test-1', { not_before: '2027-06-01T00:00:00Z' })), IDENTITY, now, KEYRING)
    expect(future.ok).toBe(true)
    expect(future.notes[0]).toMatch(/Valid from/)
  })

  it('merge / remove keep other licences', () => {
    const a = makeLicence(KEY.pem, 'test-1', { licence_id: 'lic_a' })
    const b = makeLicence(KEY.pem, 'test-1', { licence_id: 'lic_b' })
    const one = mergeLicence([], a)
    expect(one.replaced).toBe(false)
    const two = mergeLicence(one.next, b)
    const replaced = mergeLicence(two.next, { ...a, expires_at: '2028-01-01T00:00:00Z' })
    expect(replaced.replaced).toBe(true)
    expect(replaced.next).toHaveLength(2)
    expect(removeLicence(replaced.next, 'lic_a')).toMatchObject({ removed: ['lic_a'], next: [b] })
    expect(removeLicence(replaced.next, 'lic_x').removed).toEqual([])
    expect(removeLicence(replaced.next).next).toEqual([])
  })

  it('activation request carries identity, no secrets', () => {
    const req = activationRequest({ identity: IDENTITY, installed: ['lic_a'], now, deploymentMode: 'self_hosted' })
    expect(req).toMatchObject({ kind: 'usertasks.licence_request', format: 1, instance_id: IDENTITY.instanceId, hostnames: IDENTITY.hostnames, installed_licences: ['lic_a'], deployment_mode: 'self_hosted' })
    expect(Object.keys(req).sort()).toEqual(['created_at', 'deployment_mode', 'format', 'hostnames', 'installed_licences', 'instance_id', 'kind', 'version'])
  })

  it('environment sources: inline, base64, secret reference, file, US spelling', async () => {
    const text = JSON.stringify(makeLicence(KEY.pem, 'test-1'))
    expect(await envLicences({ env: { USERTASKS_LICENCE: text } })).toEqual([{ source: 'env', raw: text }])
    expect(await envLicences({ env: { USERTASKS_LICENSE: 'abc' } })).toEqual([{ source: 'env', raw: 'abc' }])
    expect(await envLicences({ env: { USERTASKS_LICENCE: 'secret://usertasks/licence' }, resolveSecret: async (ref) => `resolved:${ref}` })).toEqual([{ source: 'env', raw: 'resolved:secret://usertasks/licence' }])
    expect(await envLicences({ env: { USERTASKS_LICENCE_FILE: '/run/secrets/licence' }, readFile: async () => text })).toEqual([{ source: 'env_file', raw: text }])
    const failed = await envLicences({ env: { USERTASKS_LICENCE_FILE: '/nope' }, readFile: async () => { throw new Error('ENOENT') } })
    expect(failed[0].error).toMatch(/ENOENT/)
    expect(verifyLicence(failed[0], IDENTITY, now, KEYRING).valid).toBe(false)
    expect(await envLicences({ env: {} })).toEqual([])
  })
})
