/**
 * Self-serve trial issuing (lib/licensing/trial-service.ts) and its route
 * (POST /api/public/trials/sharepoint): validation, work email only, one per
 * farm (the same licence back) and per email domain, ended trials refused,
 * "not available yet" without the key or table, the team notification
 * (deliverChirp: sub-tab Trials, reply-to, new vs re-sent), the honeypot and
 * rate limit. Throwaway keys and fictional companies only.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const chirp = vi.hoisted(() => ({ calls: [] as any[], requests: [] as any[] }))
vi.mock('@/lib/contact/team-requests', () => ({
  notifyTeam: vi.fn(async (input: any) => { chirp.requests.push(input); chirp.calls.push(input.message); return { ok: true, id: 'r1', stored: true, delivered: { ok: true }, delivery: {} } }),
}))

import { DAY_MS } from '@/lib/licensing/format'
import { requestTrial, type TrialRow, type TrialServiceDeps, type TrialStore } from '@/lib/licensing/trial-service'
import { trialSigner } from '@/lib/licensing/trial-issuer'
import { encodeTrialRequest } from '@/lib/licensing/trial-request'
import { verifyLicence } from '@/lib/licensing/service'
import { notifyTrial, trialTeamFacts } from '@/lib/contact/trial-chirp'
import type { LicenceKey } from '@/lib/licensing/keyring'
import { throwawayKey } from './helpers/licence-fixtures'

const TRIAL = throwawayKey('trial-1')
const KEYRING: LicenceKey[] = [{ ...TRIAL.entry, kind: 'trial' }]
const FARM = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
const FARM_2 = '0b8e1a52-7c3d-4e5f-9a1b-2c3d4e5f6a7b'
const NOW = new Date('2026-12-01T12:00:00.000Z')
const INSTANCE = 'inst_abcdefghijklmnopqrstuvwx'

function memoryStore(): TrialStore & { rows: TrialRow[]; failNextInsertWith?: TrialRow } {
  const rows: TrialRow[] = []
  const store: any = {
    rows,
    ready: async () => true,
    matches: async (sku: string, farm: string, domain: string) => rows.filter((r) => r.sku === sku && (r.farm_id === farm || r.email_domain === domain)),
    insert: async (row: any) => {
      if (store.failNextInsertWith) { rows.push(store.failNextInsertWith); store.failNextInsertWith = undefined; return { ok: false, conflict: true } }
      if (rows.some((r) => r.sku === row.sku && (r.farm_id === row.farm_id || r.email_domain === row.email_domain))) return { ok: false, conflict: true }
      const stored = { ...row, id: `row-${rows.length + 1}`, resent_count: 0 }
      rows.push(stored)
      return { ok: true, row: stored }
    },
    markEmailed: async (id: string, at: string) => { const r = rows.find((x) => x.id === id); if (r) r.emailed_at = at },
    markResent: async (id: string) => { const r = rows.find((x) => x.id === id); if (r) r.resent_count = (r.resent_count ?? 0) + 1 },
    list: async () => [...rows],
  }
  return store
}

let store: ReturnType<typeof memoryStore>
let emails: any[]
let pending: Array<() => Promise<void>>
let now: Date

function deps(overrides: Partial<TrialServiceDeps> = {}): TrialServiceDeps {
  return {
    now: () => now,
    signer: () => trialSigner({ TRIAL_LICENCE_SIGNING_KEY: TRIAL.pem }, KEYRING),
    store: () => store,
    later: (fn) => { pending.push(fn) },
    sendLicenceEmail: async (input) => { emails.push(input); return true },
    notifyTeam: notifyTrial,
    ...overrides,
  }
}

async function flush() {
  while (pending.length) await pending.shift()!()
}

const form = (extra: Record<string, unknown> = {}) => ({ name: 'Alex Rivera', email: 'alex.rivera@fabrikam.example', company: 'Fabrikam Ltd', farm_id: FARM, accept_terms: true, ...extra })

beforeEach(() => {
  store = memoryStore()
  emails = []
  pending = []
  chirp.calls = []
  chirp.requests = []
  now = NOW
})

describe('trial endpoint: validation', () => {
  it.each([
    [{ name: '' }, 'name'],
    [{ email: 'not-an-email' }, 'email'],
    [{ company: ' ' }, 'company'],
    [{ farm_id: 'my farm' }, 'farm_id'],
    [{ accept_terms: false }, 'accept_terms'],
    [{ request_code: 'UTTRIAL1-garbage', farm_id: undefined }, 'request_code'],
  ])('refuses %j', async (patch, field) => {
    const out = await requestTrial(form(patch), deps())
    expect(out.status).toBe(400)
    expect((out.body as any).field).toBe(field)
    expect(store.rows).toHaveLength(0)
  })

  it.each(['someone@gmail.com', 'someone@outlook.com', 'someone@mailinator.com', 'someone@mail.yahoo.com'])('refuses free / disposable mail %s', async (email) => {
    const out = await requestTrial(form({ email }), deps())
    expect(out.status).toBe(400)
    expect((out.body as any).error).toMatch(/work email/)
  })
})

describe('trial endpoint: availability', () => {
  it('says trials are not available yet without the key', async () => {
    const out = await requestTrial(form(), deps({ signer: () => trialSigner({}, KEYRING) }))
    expect(out).toMatchObject({ status: 503, body: { code: 'trials_unavailable', error: expect.stringMatching(/aren't available yet/) } })
    expect(store.rows).toHaveLength(0)
  })

  it('says trials are not available yet when the key is not in the keyring', async () => {
    const out = await requestTrial(form(), deps({ signer: () => trialSigner({ TRIAL_LICENCE_SIGNING_KEY: TRIAL.pem }, []) }))
    expect(out.status).toBe(503)
  })

  it('says trials are not available yet before the migration', async () => {
    store.ready = async () => false
    expect((await requestTrial(form(), deps())).status).toBe(503)
  })
})

describe('trial endpoint: issuing', () => {
  it('issues a 30-day farm-bound licence, emails it and notifies the team after the response', async () => {
    const out = await requestTrial(form({ farm_id: FARM.toUpperCase() }), deps())
    expect(out.status).toBe(200)
    const body = out.body as any
    expect(body).toMatchObject({ existing: false, farm_id: FARM })
    expect(body.licence).toMatchObject({ trial: true, sku: 'sharepoint-se', binding: { farm_ids: [FARM] }, customer: { name: 'Fabrikam Ltd' } })
    expect(Date.parse(body.expires_at) - NOW.getTime()).toBe(30 * DAY_MS)
    expect(verifyLicence({ source: 'setting', raw: body.licence }, { instanceId: null, hostnames: [] }, NOW, KEYRING).valid).toBe(true)
    // Nothing sent before the response.
    expect(emails).toHaveLength(0)
    expect(chirp.calls).toHaveLength(0)
    await flush()
    expect(emails).toEqual([expect.objectContaining({ to: 'alex.rivera@fabrikam.example', resent: false, farmId: FARM })])
    expect(store.rows[0].emailed_at).toBeTruthy()
    expect(store.rows[0]).toMatchObject({ email_domain: 'fabrikam.example', source: 'website' })
  })

  it('notifies the team through notifyTeam (kind trial, facts) with every field (sub-tab Trials, reply-to the requester)', async () => {
    await requestTrial(form({ name: 'Alex <b>Rivera</b>' }), deps())
    await flush()
    expect(chirp.calls).toHaveLength(1)
    expect(chirp.requests[0]).toMatchObject({ kind: 'trial', name: 'Alex <b>Rivera</b>', email: 'alex.rivera@fabrikam.example', company: 'Fabrikam Ltd', logTag: 'sp-trial', facts: { farm_id: FARM, new_or_resent: 'new', sku: 'sharepoint-se', expires_at: '2026-12-31T12:00:00.000Z' } })
    const m = chirp.calls[0]
    expect(m).toMatchObject({ subTab: 'Trials', replyTo: 'alex.rivera@fabrikam.example' })
    expect(m.subTabColor).toMatch(/^#/)
    expect(m.subTabColor).not.toBe('#22C55E')
    expect(m.detail).toContain('Fabrikam Ltd')
    expect(m.detail).toContain('alex.rivera@fabrikam.example')
    expect(m.detail).toContain(FARM)
    expect(m.detail).toContain('2026-12-31')
    expect(m.detail).toContain('New trial issued')
    expect(m.detail).toContain('Alex &lt;b&gt;Rivera&lt;/b&gt;')
    expect(m.detail).not.toContain('<b>Rivera')
    expect(m.title).toBe('New SharePoint trial — Fabrikam Ltd')
    // The facts for the team_requests inbox (notifyTeam, once merged).
    expect(trialTeamFacts({ name: 'n', email: 'e@x.example', company: 'c', farmId: FARM, sku: 'sharepoint-se', licenceId: 'l', expiresAt: '2026-12-31T12:00:00.000Z', kind: 'new', source: 'website' })).toEqual({ farm_id: FARM, expires_at: '2026-12-31T12:00:00.000Z', new_or_resent: 'new', sku: 'sharepoint-se' })
  })

  it('a failing notification or email never fails the trial', async () => {
    const out = await requestTrial(form(), deps({ sendLicenceEmail: async () => { throw new Error('smtp down') }, notifyTeam: async () => { throw new Error('boom') } }))
    expect(out.status).toBe(200)
    await expect(flush()).rejects.toThrow('boom')
    expect(store.rows).toHaveLength(1)
  })

  it('binds to the instance when the request code carries it', async () => {
    const code = encodeTrialRequest({ sku: 'sharepoint-se', farm_id: FARM, instance_id: INSTANCE, hostnames: ['usertasks.fabrikam.example'], created_at: NOW.toISOString() })
    const out = await requestTrial(form({ farm_id: undefined, request_code: code, source: 'product' }), deps())
    expect(out.status).toBe(200)
    expect((out.body as any).licence.binding).toEqual({ farm_ids: [FARM], instance_ids: [INSTANCE] })
    expect(store.rows[0]).toMatchObject({ instance_id: INSTANCE, source: 'product' })
  })
})

describe('trial endpoint: one per farm and per domain', () => {
  it('returns the same licence for the same farm, re-sends it to the original requester and tells the team it was re-sent', async () => {
    const first = await requestTrial(form(), deps())
    await flush()
    chirp.calls = []
    emails = []
    now = new Date(NOW.getTime() + 3 * DAY_MS)
    const again = await requestTrial(form({ name: 'Sam Lee', email: 'sam.lee@contoso.example', company: 'Contoso' }), deps())
    expect(again.status).toBe(200)
    expect((again.body as any).existing).toBe(true)
    expect((again.body as any).licence_id).toBe((first.body as any).licence_id)
    expect((again.body as any).message).toMatch(/a•••@fabrikam\.example/)
    expect(store.rows).toHaveLength(1)
    await flush()
    expect(emails).toEqual([expect.objectContaining({ to: 'alex.rivera@fabrikam.example', resent: true })])
    expect(store.rows[0].resent_count).toBe(1)
    expect(chirp.calls[0].detail).toContain('Existing trial re-sent')
    expect(chirp.calls[0].replyTo).toBe('sam.lee@contoso.example')
    expect(chirp.requests.at(-1).facts.new_or_resent).toBe('resent')
  })

  it('refuses a second farm for the same company domain while its trial runs', async () => {
    await requestTrial(form(), deps())
    const out = await requestTrial(form({ email: 'jo@fabrikam.example', farm_id: FARM_2 }), deps())
    expect(out).toMatchObject({ status: 409, body: { code: 'trial_exists_for_domain' } })
    expect(store.rows).toHaveLength(1)
  })

  it('refuses a new trial once the farm or the company has had one', async () => {
    await requestTrial(form(), deps())
    now = new Date(NOW.getTime() + 40 * DAY_MS)
    expect(await requestTrial(form(), deps())).toMatchObject({ status: 409, body: { code: 'trial_used' } })
    expect(await requestTrial(form({ farm_id: FARM_2 }), deps())).toMatchObject({ status: 409, body: { code: 'trial_used' } })
    expect(await requestTrial(form({ email: 'x@northwind.example', farm_id: FARM }), deps())).toMatchObject({ status: 409, body: { code: 'trial_used' } })
  })

  it('answers a race (unique index) with the winner', async () => {
    const winner = await requestTrial(form(), deps())
    const row = { ...store.rows[0] }
    store.rows.length = 0
    store.failNextInsertWith = row
    const loser = await requestTrial(form({ email: 'pat@fabrikam.example' }), deps())
    expect(loser.status).toBe(200)
    expect((loser.body as any).licence_id).toBe((winner.body as any).licence_id)
  })
})

describe('trial route', () => {
  it('is cloud-only, rejects the honeypot, and rate limits per IP', async () => {
    vi.resetModules()
    const mode = { cloud: true }
    vi.doMock('@/lib/deployment', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/deployment')>()), isCloud: () => mode.cloud }))
    const requestTrialMock = vi.fn(async () => ({ status: 200, body: { ok: true } }))
    vi.doMock('@/lib/licensing/trial-service', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@/lib/licensing/trial-service')>()),
      requestTrial: requestTrialMock,
      defaultTrialDeps: async () => ({}),
    }))
    const { POST } = await import('@/app/api/public/trials/sharepoint/route')
    const { NextRequest } = await import('next/server')
    const post = (body: unknown, ip = '203.0.113.7') => POST(new NextRequest('https://usertasks.com/api/public/trials/sharepoint', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify(body) }))

    mode.cloud = false
    expect((await post(form())).status).toBe(404)
    mode.cloud = true
    expect((await post({ ...form(), website: 'http://spam.example' }, '203.0.113.8')).status).toBe(400)
    expect(requestTrialMock).not.toHaveBeenCalled()
    const statuses: number[] = []
    for (let i = 0; i < 6; i++) statuses.push((await post(form(), '203.0.113.9')).status)
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200])
    expect(statuses[5]).toBe(429)
    vi.doUnmock('@/lib/deployment')
    vi.doUnmock('@/lib/licensing/trial-service')
  })
})
