/**
 * The trial-only signing key (lib/licensing/trial-policy.ts, keyring kind
 * 'trial'): accepted only for trial licences of at most 30 days, an allowed
 * SKU, bound to exactly one farm; the main key is unrestricted; the issuer
 * refuses to sign without a matching trial key. Throwaway keys only.
 */
import { describe, expect, it } from 'vitest'
import { DAY_MS } from '@/lib/licensing/format'
import { verifyLicence, resolveDecision, licenceGrants } from '@/lib/licensing/service'
import { checkInstallable } from '@/lib/licensing/install'
import { checkTrialPolicy, normaliseFarmId, TRIAL_CLOCK_SKEW_MS } from '@/lib/licensing/trial-policy'
import { issueTrialLicence, trialLicenceBody, trialSigner } from '@/lib/licensing/trial-issuer'
import type { LicenceKey } from '@/lib/licensing/keyring'
import { makeLicence, throwawayKey } from './helpers/licence-fixtures'

const MAIN = throwawayKey('lic-test-1')
const TRIAL = throwawayKey('trial-1')
const TRIAL_ENTRY: LicenceKey = { ...TRIAL.entry, kind: 'trial', trialSkus: ['sharepoint-se'] }
const KEYRING: LicenceKey[] = [MAIN.entry, TRIAL_ENTRY]
const FARM = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
const OTHER_FARM = '9a7b1c2d-0000-4000-8000-00000000beef'
const NOW = new Date('2026-12-01T12:00:00.000Z')
const IDENTITY = { instanceId: 'inst_abcdefghijklmnopqrstuvwx', hostnames: ['usertasks.fabrikam.example'] }
const iso = (ms: number) => new Date(NOW.getTime() + ms).toISOString()

function trialDoc(overrides: Parameters<typeof makeLicence>[2] = {}, key = TRIAL) {
  return makeLicence(key.pem, key.entry.kid, {
    licence_id: 'lic_trial_test',
    customer: { name: 'Fabrikam Ltd' },
    issued_at: NOW.toISOString(),
    expires_at: iso(30 * DAY_MS),
    sku: 'sharepoint-se',
    trial: true,
    binding: { farm_ids: [FARM] },
    extensions: [{ id: 'sharepoint', limits: { farms: 1 } }],
    ...overrides,
  })
}

const verify = (doc: ReturnType<typeof trialDoc>, now = NOW) => verifyLicence({ source: 'setting', raw: doc }, IDENTITY, now, KEYRING)
const problems = (doc: ReturnType<typeof trialDoc>, now = NOW) => verify(doc, now).problems.map((p) => p.code)

describe('trial key restrictions', () => {
  it('accepts a 30-day sharepoint-se trial bound to one farm', () => {
    const v = verify(trialDoc())
    expect(v.valid).toBe(true)
    expect(v.problems).toEqual([])
  })

  it('accepts the clock skew but not more than 30 days', () => {
    expect(verify(trialDoc({ expires_at: iso(30 * DAY_MS + TRIAL_CLOCK_SKEW_MS - 1000) })).valid).toBe(true)
    expect(problems(trialDoc({ expires_at: iso(31 * DAY_MS) }))).toContain('trial_policy')
    expect(problems(trialDoc({ expires_at: iso(365 * DAY_MS) }))).toContain('trial_policy')
  })

  it('rejects a licence that is not marked trial', () => {
    expect(problems(trialDoc({ trial: false }))).toContain('trial_policy')
    expect(problems(trialDoc({ trial: undefined }))).toContain('trial_policy')
  })

  it('rejects other SKUs, missing SKUs and other extensions', () => {
    expect(problems(trialDoc({ sku: 'other-sku' }))).toContain('trial_policy')
    expect(problems(trialDoc({ sku: undefined }))).toContain('trial_policy')
    expect(problems(trialDoc({ extensions: [{ id: 'other-ext' }] }))).toContain('trial_policy')
    expect(problems(trialDoc({ extensions: [{ id: 'sharepoint' }, { id: 'other-ext' }] }))).toContain('trial_policy')
    expect(problems(trialDoc({ limits: { 'other.seats': 5 } }))).toContain('trial_policy')
  })

  it('honours the SKUs configured on the key', () => {
    const narrow: LicenceKey[] = [MAIN.entry, { ...TRIAL_ENTRY, trialSkus: ['something-else'] }]
    expect(verifyLicence({ source: 'setting', raw: trialDoc() }, IDENTITY, NOW, narrow).problems.map((p) => p.code)).toContain('trial_policy')
  })

  it('requires exactly one farm, and at most one farm in the limits', () => {
    expect(problems(trialDoc({ binding: {} }))).toContain('trial_policy')
    expect(problems(trialDoc({ binding: { farm_ids: [FARM, OTHER_FARM] } }))).toContain('trial_policy')
    expect(problems(trialDoc({ binding: { farm_ids: ['not-a-guid'] } }))).toContain('trial_policy')
    expect(problems(trialDoc({ extensions: [{ id: 'sharepoint', limits: { farms: 5 } }] }))).toContain('trial_policy')
    expect(problems(trialDoc({ limits: { 'sharepoint.farms': 3 } }))).toContain('trial_policy')
  })

  it('rejects licences issued in the future or valid before issue (a leaked key cannot mint a later trial)', () => {
    expect(problems(trialDoc({ issued_at: iso(400 * DAY_MS), expires_at: iso(420 * DAY_MS) }))).toContain('trial_policy')
    expect(problems(trialDoc({ not_before: iso(-5 * DAY_MS) }))).toContain('trial_policy')
    // A not_before later than issue counts the term from not_before.
    expect(problems(trialDoc({ not_before: iso(DAY_MS), expires_at: iso(31 * DAY_MS) }))).not.toContain('trial_policy')
    expect(problems(trialDoc({ not_before: iso(DAY_MS), expires_at: iso(32 * DAY_MS) }))).toContain('trial_policy')
  })

  it('never lets a bad trial-key licence install or grant anything', () => {
    const bad = trialDoc({ expires_at: iso(200 * DAY_MS) })
    const check = checkInstallable(JSON.stringify(bad), IDENTITY, NOW, KEYRING)
    expect(check.ok).toBe(false)
    expect(check.problems.map((p) => p.code)).toContain('trial_policy')
    expect(licenceGrants([verify(bad)], 'sharepoint')).toEqual([])
  })

  it('leaves the main key unrestricted (paid licences, long terms, trials signed offline)', () => {
    const paid = makeLicence(MAIN.pem, MAIN.entry.kid, { issued_at: NOW.toISOString(), expires_at: iso(365 * DAY_MS) })
    expect(verifyLicence({ source: 'setting', raw: paid }, IDENTITY, NOW, KEYRING).valid).toBe(true)
    expect(checkTrialPolicy(paid, MAIN.entry, NOW)).toBeNull()
  })

  it('a trial-key licence for another farm-bound kid still verifies only with its own key', () => {
    const forged = { ...trialDoc(), kid: MAIN.entry.kid, signature: { ...trialDoc().signature, kid: MAIN.entry.kid } }
    expect(problems(forged)).toContain('bad_signature')
  })

  it('decisions carry the trial facts and the farm binding', () => {
    const decision = resolveDecision({ extensionId: 'sharepoint', grants: licenceGrants([verify(trialDoc())], 'sharepoint') })
    expect(decision).toMatchObject({ allowed: true, state: 'licensed', trial: true, farmIds: [FARM], daysLeft: 30 })
    // An unbound paid licence next to it lifts the farm restriction.
    const paid = makeLicence(MAIN.pem, MAIN.entry.kid, { licence_id: 'lic_paid', issued_at: NOW.toISOString(), expires_at: iso(365 * DAY_MS) })
    const both = resolveDecision({ extensionId: 'sharepoint', grants: licenceGrants([verify(trialDoc()), verifyLicence({ source: 'setting', raw: paid }, IDENTITY, NOW, KEYRING)], 'sharepoint') })
    expect(both.farmIds).toBeUndefined()
    expect(both.trial).toBe(false)
  })

  it('normalises farm ids as people paste them', () => {
    expect(normaliseFarmId(` {${FARM.toUpperCase()}} `)).toBe(FARM)
    expect(normaliseFarmId(`realm:${FARM}`)).toBe(FARM)
    expect(normaliseFarmId('nope')).toBeNull()
  })
})

describe('trial issuer', () => {
  const env = (extra: Record<string, string> = {}) => ({ TRIAL_LICENCE_SIGNING_KEY: TRIAL.pem, ...extra })

  it('is unavailable without a key, without a trial key in the keyring, or with a mismatched key', () => {
    expect(trialSigner({}, KEYRING)).toMatchObject({ available: false })
    expect(trialSigner(env(), [MAIN.entry])).toMatchObject({ available: false })
    expect(trialSigner({ TRIAL_LICENCE_SIGNING_KEY: throwawayKey('x').pem }, KEYRING)).toMatchObject({ available: false })
  })

  it('never signs with a main licence key, even when given one', () => {
    const s = trialSigner({ TRIAL_LICENCE_SIGNING_KEY: MAIN.pem, TRIAL_LICENCE_KID: MAIN.entry.kid }, KEYRING)
    expect(s.available).toBe(false)
    if (!s.available) expect(s.reason).toMatch(/not a trial key/)
  })

  it('accepts a PEM with literal \\n', () => {
    expect(trialSigner({ TRIAL_LICENCE_SIGNING_KEY: TRIAL.pem.replace(/\n/g, '\\n') }, KEYRING).available).toBe(true)
  })

  it('issues a licence that verifies on the farm-bound installation', () => {
    const signer = trialSigner(env(), KEYRING)
    if (!signer.available) throw new Error(signer.reason)
    const doc = issueTrialLicence(signer, { sku: 'sharepoint-se', farmId: FARM.toUpperCase(), instanceId: IDENTITY.instanceId, company: 'Fabrikam Ltd', now: NOW }, KEYRING)
    expect(doc).toMatchObject({ trial: true, sku: 'sharepoint-se', kid: 'trial-1', binding: { farm_ids: [FARM], instance_ids: [IDENTITY.instanceId] } })
    expect(Date.parse(doc.expires_at) - Date.parse(doc.issued_at)).toBe(30 * DAY_MS)
    expect(verify(doc).valid).toBe(true)
    // Bound to the instance from the request code: another installation refuses it.
    expect(verifyLicence({ source: 'setting', raw: doc }, { instanceId: 'inst_zzzzzzzzzzzzzzzzzzzzzzzz', hostnames: [] }, NOW, KEYRING).valid).toBe(false)
  })

  it('builds an unsigned body without a farm only by refusing', () => {
    expect(() => trialLicenceBody({ sku: 'sharepoint-se', farmId: 'x', company: 'A', now: NOW })).toThrow(/GUID/)
    expect(() => trialLicenceBody({ sku: 'nope', farmId: FARM, company: 'A', now: NOW })).toThrow(/No trial/)
  })
})
