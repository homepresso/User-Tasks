/**
 * Trials inside a self-hosted installation: online activation (the server
 * asks usertasks.com and installs the licence), offline (request code to copy,
 * then paste), refusals passed through; the trial banner line and the
 * 7-day warnings (banner level + e-mail notices only from 7 days); resuming
 * runs a lapsed licence paused. Throwaway keys, fictional names.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */
import { describe, expect, it, vi } from 'vitest'
import { DAY_MS } from '@/lib/licensing/format'
import { checkInstallable } from '@/lib/licensing/install'
import { licenceWarnings, verifyLicence } from '@/lib/licensing/service'
import { startTrial, trialBaseUrl, trialRequestCode, type TrialClientDeps } from '@/lib/licensing/trial-client'
import { decodeTrialRequest } from '@/lib/licensing/trial-request'
import { issueTrialLicence, trialSigner } from '@/lib/licensing/trial-issuer'
import { noticeFor } from '@/lib/jobs/licence-check'
import { resumeLicencePausedRuns } from '@/lib/licensing/paused-runs'
import type { LicenceKey } from '@/lib/licensing/keyring'
import { throwawayKey } from './helpers/licence-fixtures'

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))

const TRIAL = throwawayKey('trial-1')
const KEYRING: LicenceKey[] = [{ ...TRIAL.entry, kind: 'trial' }]
const FARM = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
const NOW = new Date('2026-12-01T12:00:00.000Z')
const IDENTITY = { instanceId: 'inst_abcdefghijklmnopqrstuvwx', hostnames: ['usertasks.fabrikam.example'] }
const WHO = { actorId: '00000000-0000-4000-8000-000000000001', actor: 'admin@fabrikam.example' }
const INPUT = { extensionId: 'sharepoint', farmId: FARM, name: 'Alex Rivera', email: 'alex.rivera@fabrikam.example', company: 'Fabrikam Ltd', acceptTerms: true }

function issued() {
  const signer = trialSigner({ TRIAL_LICENCE_SIGNING_KEY: TRIAL.pem }, KEYRING)
  if (!signer.available) throw new Error(signer.reason)
  return issueTrialLicence(signer, { sku: 'sharepoint-se', farmId: FARM, instanceId: IDENTITY.instanceId, company: 'Fabrikam Ltd', now: NOW })
}

function deps(fetchImpl: (url: string, init: RequestInit) => Promise<Response>, installed: string[] = []): TrialClientDeps {
  return {
    identity: async () => IDENTITY,
    skuOf: (id) => (id === 'sharepoint' ? { sku: 'sharepoint-se', trial: true } : null),
    fetch: fetchImpl as any,
    install: async (text) => {
      const check = checkInstallable(text, IDENTITY, NOW, KEYRING)
      if (!check.ok) throw new Error(check.problems.map((p) => p.message).join('; '))
      installed.push(text)
      return { licence: check.summary!, replaced: false, notes: [] }
    },
    now: () => NOW,
    trialUrl: () => 'https://usertasks.com',
  }
}

describe('online activation', () => {
  it('posts a request code with the farm and instance and installs the returned licence', async () => {
    const installed: string[] = []
    let sent: any = null
    const doc = issued()
    const result = await startTrial(INPUT, WHO, deps(async (url, init) => {
      expect(url).toBe('https://usertasks.com/api/public/trials/sharepoint')
      sent = JSON.parse(String(init.body))
      return Response.json({ licence: doc, licence_id: doc.licence_id, existing: false, message: 'Your trial runs until December 31, 2026.' })
    }, installed))
    expect(result).toMatchObject({ mode: 'online', licenceId: doc.licence_id, existing: false })
    expect(installed).toHaveLength(1)
    expect(sent).toMatchObject({ sku: 'sharepoint-se', source: 'product', accept_terms: true, email: 'alex.rivera@fabrikam.example' })
    expect(decodeTrialRequest(sent.request_code)).toMatchObject({ farm_id: FARM, instance_id: IDENTITY.instanceId, hostnames: IDENTITY.hostnames })
  })

  it('passes refusals through (one per company, trials unavailable)', async () => {
    const refused = await startTrial(INPUT, WHO, deps(async () => Response.json({ error: 'Fabrikam Ltd already has a trial running', code: 'trial_exists_for_domain' }, { status: 409 })))
    expect(refused).toMatchObject({ mode: 'refused', code: 'trial_exists_for_domain' })
    const unavailable = await startTrial(INPUT, WHO, deps(async () => Response.json({ error: "Trials aren't available yet.", code: 'trials_unavailable' }, { status: 503 })))
    expect(unavailable).toMatchObject({ mode: 'refused', code: 'trials_unavailable' })
  })

  it('refuses before calling out without a farm id or terms', async () => {
    const fetchSpy = vi.fn()
    expect(await startTrial({ ...INPUT, farmId: 'x' }, WHO, deps(fetchSpy as any))).toMatchObject({ mode: 'refused', field: 'farm_id' })
    expect(await startTrial({ ...INPUT, acceptTerms: false }, WHO, deps(fetchSpy as any))).toMatchObject({ mode: 'refused', field: 'accept_terms' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('offline activation', () => {
  it('falls back to the request code when usertasks.com cannot be reached', async () => {
    const result = await startTrial(INPUT, WHO, deps(async () => { throw new TypeError('fetch failed') }))
    expect(result.mode).toBe('offline')
    if (result.mode !== 'offline') return
    expect(result.trialUrl).toBe('https://usertasks.com/sharepoint/trial')
    expect(decodeTrialRequest(result.requestCode)).toMatchObject({ farm_id: FARM, instance_id: IDENTITY.instanceId })
  })

  it('falls back on a proxy error page', async () => {
    const result = await startTrial(INPUT, WHO, deps(async () => new Response('<html>blocked</html>', { status: 502 })))
    expect(result.mode).toBe('offline')
  })

  it('the pasted licence installs on this installation only', async () => {
    const code = await trialRequestCode({ extensionId: 'sharepoint', farmId: FARM.toUpperCase() }, deps(async () => new Response()))
    expect(decodeTrialRequest(code)?.farm_id).toBe(FARM)
    const text = JSON.stringify(issued())
    expect(checkInstallable(text, IDENTITY, NOW, KEYRING).ok).toBe(true)
    expect(checkInstallable(text, { instanceId: 'inst_zzzzzzzzzzzzzzzzzzzzzzzz', hostnames: [] }, NOW, KEYRING).ok).toBe(false)
  })

  it('only https (or localhost) issuer URLs are used', () => {
    expect(trialBaseUrl({})).toBe('https://usertasks.com')
    expect(trialBaseUrl({ USERTASKS_TRIAL_URL: 'http://evil.example' })).toBe('https://usertasks.com')
    expect(trialBaseUrl({ USERTASKS_TRIAL_URL: 'http://localhost:3000/x' })).toBe('http://localhost:3000')
  })
})

describe('trial warnings', () => {
  const at = (days: number) => verifyLicence({ source: 'setting', raw: issued() }, IDENTITY, new Date(NOW.getTime() + days * DAY_MS), KEYRING)

  it('shows "Trial: N days left" from the start, warning from 7 days', () => {
    expect(licenceWarnings([at(1)])[0]).toMatchObject({ code: 'trial', level: 'info', daysLeft: 29 })
    expect(licenceWarnings([at(23)])[0]).toMatchObject({ code: 'trial', level: 'warn', daysLeft: 7 })
    expect(licenceWarnings([at(30.5)])[0]).toMatchObject({ code: 'cutoff_pending', level: 'error' })
    expect(licenceWarnings([at(32)])[0].message).toMatch(/Nothing was deleted/)
  })

  it('e-mails trial notices only from 7 days before the end', () => {
    const n = (days: number) => noticeFor({ valid: true, timeState: 'expiring', daysLeft: days, trial: true })
    expect(n(29)).toBeNull()
    expect(n(14)).toBeNull()
    expect(n(8)).toBeNull()
    expect(n(7)).toBe('d7')
    expect(n(1)).toBe('d1')
    // Paid licences keep 30 / 14.
    expect(noticeFor({ valid: true, timeState: 'expiring', daysLeft: 29 })).toBe('d30')
  })
})

describe('runs paused by a lapsed licence', () => {
  it('resumes them, audits each, and reports what is left', async () => {
    const runs = [{ id: 'run-1', workflow_id: 'wf-1' }, { id: 'run-2', workflow_id: 'wf-2' }]
    const resumed: string[] = []
    const query = (rows: any[], count: number) => {
      const q: any = { select: () => q, eq: () => q, not: () => q, order: () => q, limit: async () => ({ data: rows, error: null }), then: (r: any) => r({ count, error: null }) }
      return q
    }
    let calls = 0
    const db: any = { from: () => (calls++ === 0 ? query(runs, 2) : query([], 0)) }
    const out = await resumeLicencePausedRuns(db, { tenantId: 't1', extensionId: 'sharepoint' }, { resume: async (id) => { resumed.push(id); return { status: 'completed' } } })
    expect(resumed).toEqual(['run-1', 'run-2'])
    expect(out).toEqual({ resumed: 2, failed: 0, remaining: 0 })
  })
})
