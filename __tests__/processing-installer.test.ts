/**
 * Installer step for the Processing add-on: `processing.mode: workers` in an
 * install profile writes PROCESSING_MODE=workers and needs a Processing
 * licence (offline check, throwaway keys only). Web (or omitted) is free.
 * Expiry: accepted within 24 hours of expiry, refused after.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { EXPIRY_CUTOFF_MS } from '@/lib/licensing/format'
import { mergeProfileLayers, presetProfile, profileToConfig, validateProfile, type Profile } from '@/lib/install/profile'
import { processingGate } from '@/packages/admin/src/install-cli'
import { makeLicence, throwawayKey } from './helpers/licence-fixtures'

const KEY = throwawayKey('test-proc-1')
const EXPIRES = '2027-11-01T00:00:00.000Z'
const at = (ms: number) => new Date(Date.parse(EXPIRES) + ms)
const VALID = at(-30 * 86_400_000)
const licence = (over: Parameters<typeof makeLicence>[2] = {}) => JSON.stringify(makeLicence(KEY.pem, 'test-proc-1', {
  licence_id: 'lic_proc_1', expires_at: EXPIRES, sku: 'processing-tier', extensions: [{ id: 'processing', features: ['processing'] }], ...over,
}))

function profileOf(processing?: Record<string, unknown>): Profile {
  const result = validateProfile(mergeProfileLayers({ ...presetProfile('server'), ...(processing ? { processing } : {}) }, { app: { url: 'https://tasks.example.com' } }))
  if (!result.ok) throw new Error(JSON.stringify(result.errors))
  return result.profile
}

const gate = (profile: Profile, env: Record<string, string> = {}, now = VALID, values: Record<string, string> = {}) => processingGate(profile, values as never, { env }, now, [KEY.entry])

describe('installer: separate processing workers need the Processing licence', () => {
  it('web / omitted is free and writes nothing; workers writes PROCESSING_MODE with a note', () => {
    expect(gate(profileOf()).ok).toBe(true)
    expect(gate(profileOf({ mode: 'web' })).ok).toBe(true)
    expect(profileToConfig(profileOf()).env.PROCESSING_MODE).toBeUndefined()
    const config = profileToConfig(profileOf({ mode: 'workers', testRunsOnWorkers: true }))
    expect(config.env).toMatchObject({ PROCESSING_MODE: 'workers', PROCESSING_TEST_RUNS_ON_WORKERS: 'true' })
    expect(config.notes.join(' ')).toMatch(/worker\.cjs --processor/)
    expect(validateProfile(mergeProfileLayers({ ...presetProfile('server'), processing: { mode: 'turbo' } }, { app: { url: 'https://tasks.example.com' } })).ok).toBe(false)
  })

  it('workers: refused without a licence, accepted with one (also within 24 h of expiry), refused past the cutoff, for another extension or address, or forged', () => {
    const workers = profileOf({ mode: 'workers' })
    expect(gate(workers)).toMatchObject({ ok: false, error: expect.stringMatching(/Processing add-on.*--licence/) })
    const ok = gate(workers, { USERTASKS_LICENCE: licence() })
    expect(ok).toMatchObject({ ok: true, licenceText: expect.any(String) })
    expect(ok.note).toMatch(/lic_proc_1/)
    expect(gate(workers, { USERTASKS_LICENCE: licence() }, at(23 * 3600_000)).ok).toBe(true)
    expect(gate(workers, { USERTASKS_LICENCE: licence() }, at(EXPIRY_CUTOFF_MS + 60_000))).toMatchObject({ ok: false, error: expect.stringMatching(/expired/) })
    expect(gate(workers, { USERTASKS_LICENCE: licence({ extensions: [{ id: 'infrastructure', features: ['infrastructure-separation'] }] }) }).ok).toBe(false)
    expect(gate(workers, { USERTASKS_LICENCE: licence({ binding: { hostnames: ['other.example.com'] } }) })).toMatchObject({ ok: false, error: expect.stringMatching(/another installation/) })
    const forged = { ...JSON.parse(licence()), expires_at: '2099-01-01T00:00:00.000Z' }
    expect(gate(workers, { USERTASKS_LICENCE: JSON.stringify(forged) })).toMatchObject({ ok: false, error: expect.stringMatching(/not accepted/) })
  })

  it('the pinned keyring never trusts a throwaway key', () => {
    expect(processingGate(profileOf({ mode: 'workers' }), {} as never, { env: { USERTASKS_LICENCE: licence() } }, VALID).ok).toBe(false)
  })

  it('a re-run that already has PROCESSING_MODE=workers keeps it without a licence', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'proc-gate-'))
    const env = path.join(dir, '.env')
    writeFileSync(env, 'PROCESSING_MODE=workers\n')
    expect(gate(profileOf({ mode: 'workers' }), {}, VALID, { merge: env })).toMatchObject({ ok: true, note: expect.stringMatching(/already configured/) })
  })
})
