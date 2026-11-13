/**
 * /api/v1/licence* (instance admin token only) and the Settings → Licence
 * actions (instance admins only):
 *  - off (404) without INSTANCE_ADMIN_TOKEN; no token → 401; any other token → 403;
 *  - status, install (refuses foreign / tampered licences), replace, remove;
 *  - activation request; entitlements validation;
 *  - every UI action re-checks instance-admin access.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const settings = new Map<string, unknown>()
vi.mock('@/lib/config/instance-settings', () => ({
  getInstanceSetting: async (key: string) => settings.get(key),
  setInstanceSetting: async (key: string, value: unknown) => { settings.set(key, value) },
  invalidateInstanceSettingsCache: () => undefined,
}))
vi.mock('@/lib/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rate-limit')>()
  return { ...actual, rateLimit: async (key: string, opts: { max: number; windowMs: number }) => actual.checkRateLimit(key, opts) }
})

import { GET, PUT, DELETE } from '@/app/api/v1/licence/route'
import { GET as REQUEST } from '@/app/api/v1/licence/request/route'
import { PUT as GRANT } from '@/app/api/v1/licence/entitlements/route'
import { invalidateLicenceCache, licensingDeps, type LicensingDeps } from '@/lib/licensing/service'
import { installLicenceAs, licenceBannerAs, licenceRequestAs, licenceStatusAs, removeLicenceAs, type LicenceUiDeps } from '@/lib/licensing/ui-actions'
import { makeLicence, throwawayKey } from './helpers/licence-fixtures'

const TOKEN = 'L'.repeat(48)
const KEY = throwawayKey('test-1')
const OTHER = throwawayKey('test-2')
const IDENTITY = { instanceId: 'inst_abcdefghijklmnopqrstuvwx', hostnames: ['usertasks.corp.example'] }
let saved: LicensingDeps
let events: string[]
let ip = 0
const savedToken = process.env.INSTANCE_ADMIN_TOKEN

beforeEach(() => {
  process.env.INSTANCE_ADMIN_TOKEN = TOKEN
  settings.clear()
  events = []
  saved = { ...licensingDeps }
  Object.assign(licensingDeps, {
    now: () => new Date('2027-01-01T00:00:00Z'),
    keyring: () => [KEY.entry],
    identity: async () => IDENTITY,
    licences: async () => ((settings.get('instance.licences') as unknown[]) ?? []).map((raw) => ({ source: 'setting' as const, raw })),
    tenantEntitlements: async () => [],
    audit: async (e: { event: string; licenceId?: string | null }) => { events.push(`${e.event}:${e.licenceId}`) },
  } satisfies Partial<LicensingDeps>)
  invalidateLicenceCache()
})
afterEach(() => {
  Object.assign(licensingDeps, saved)
  invalidateLicenceCache()
  if (savedToken === undefined) delete process.env.INSTANCE_ADMIN_TOKEN
  else process.env.INSTANCE_ADMIN_TOKEN = savedToken
})

function req(method: string, path: string, body?: unknown, auth: string | null = `Bearer ${TOKEN}`) {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-forwarded-for': `198.51.100.${++ip}` }
  if (auth) headers.authorization = auth
  return new NextRequest(`http://localhost/api/v1${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}

describe('/api/v1/licence authorisation', () => {
  it('404 when the instance admin API is off', async () => {
    delete process.env.INSTANCE_ADMIN_TOKEN
    expect((await GET(req('GET', '/licence'))).status).toBe(404)
    expect((await PUT(req('PUT', '/licence', { licence: 'x' }))).status).toBe(404)
  })

  it('401 without a token, 403 with any other token (workspace keys included)', async () => {
    expect((await GET(req('GET', '/licence', undefined, null))).status).toBe(401)
    expect((await GET(req('GET', '/licence', undefined, 'Bearer ut_live_workspacekey'))).status).toBe(403)
    expect((await PUT(req('PUT', '/licence', { licence: 'x' }, 'Bearer nope'))).status).toBe(403)
    expect((await DELETE(req('DELETE', '/licence?all=true', undefined, 'Bearer nope'))).status).toBe(403)
    expect((await REQUEST(req('GET', '/licence/request', undefined, null))).status).toBe(401)
    expect((await GRANT(req('PUT', '/licence/entitlements', {}, 'Bearer nope'))).status).toBe(403)
    expect(settings.size).toBe(0)
  })
})

describe('/api/v1/licence operations', () => {
  it('install, status, replace, remove', async () => {
    const doc = makeLicence(KEY.pem, 'test-1')
    const installed = await PUT(req('PUT', '/licence', { licence: JSON.stringify(doc) }))
    expect(installed.status).toBe(200)
    expect((await installed.json()).data).toMatchObject({ replaced: false, licence: { licenceId: 'lic_test_1', valid: true } })

    const status = await (await GET(req('GET', '/licence'))).json()
    expect(status.data.extensions).toEqual([expect.objectContaining({ id: 'sharepoint', allowed: true, limits: { 'sharepoint.farms': 2 } })])
    expect(status.data.usage).toEqual({ 'sharepoint.farms': null })

    const again = await (await PUT(req('PUT', '/licence', { licence: JSON.stringify(makeLicence(KEY.pem, 'test-1', { expires_at: '2028-01-01T00:00:00Z' })) }))).json()
    expect(again.data.replaced).toBe(true)
    expect(settings.get('instance.licences')).toHaveLength(1)

    expect((await DELETE(req('DELETE', '/licence'))).status).toBe(400)
    expect((await DELETE(req('DELETE', '/licence?licence_id=lic_nope'))).status).toBe(404)
    const removed = await (await DELETE(req('DELETE', '/licence?licence_id=lic_test_1'))).json()
    expect(removed.data.removed).toEqual(['lic_test_1'])
    expect(events).toEqual(['installed:lic_test_1', 'replaced:lic_test_1', 'removed:lic_test_1'])
  })

  it('refuses foreign, tampered and unknown-key licences', async () => {
    for (const bad of [
      makeLicence(OTHER.pem, 'test-2'),
      { ...makeLicence(KEY.pem, 'test-1'), expires_at: '2099-01-01T00:00:00Z' },
      makeLicence(KEY.pem, 'test-1', { binding: { instance_ids: ['inst_other000000000000000000'] } }),
    ]) {
      const res = await PUT(req('PUT', '/licence', { licence: JSON.stringify(bad) }))
      expect(res.status).toBe(400)
      expect((await res.json()).error).toMatch(/Licence not installed/)
    }
    expect(settings.get('instance.licences')).toBeUndefined()
  })

  it('activation request and entitlement validation', async () => {
    const res = await (await REQUEST(req('GET', '/licence/request'))).json()
    expect(res.data).toMatchObject({ kind: 'usertasks.licence_request', instance_id: IDENTITY.instanceId, hostnames: IDENTITY.hostnames })
    expect((await GRANT(req('PUT', '/licence/entitlements', { tenant_id: 'not-a-uuid', extension_id: 'sharepoint' }))).status).toBe(400)
  })
})

describe('Settings → Licence actions', () => {
  const calls: string[] = []
  const deps: LicenceUiDeps = {
    canView: async (user) => user?.email === 'admin@example.com',
    status: async () => { calls.push('status'); return {} as never },
    install: async () => { calls.push('install'); return {} as never },
    remove: async () => { calls.push('remove'); return { removed: [] } },
    request: async () => { calls.push('request'); return {} as never },
    warnings: async () => [{ level: 'warn', code: 'expiring', licenceId: 'lic', message: 'soon' }],
  }
  const admin = { id: '00000000-0000-4000-8000-000000000001', email: 'admin@example.com' }
  const member = { id: '00000000-0000-4000-8000-000000000002', email: 'owner@example.com' }

  it('everyone but instance admins is refused, and nothing runs', async () => {
    for (const user of [member, null]) {
      expect(await licenceStatusAs(user, deps)).toEqual({ ok: false, error: expect.stringMatching(/instance admins/) })
      expect((await installLicenceAs(user, 'x', deps)).ok).toBe(false)
      expect((await removeLicenceAs(user, 'lic', deps)).ok).toBe(false)
      expect((await licenceRequestAs(user, deps)).ok).toBe(false)
      expect(await licenceBannerAs(user, deps)).toEqual([])
    }
    expect(calls).toEqual([])
  })

  it('instance admins get through', async () => {
    expect((await licenceStatusAs(admin, deps)).ok).toBe(true)
    expect((await installLicenceAs(admin, 'x', deps)).ok).toBe(true)
    expect((await removeLicenceAs(admin, '', deps)).ok).toBe(false)
    expect((await removeLicenceAs(admin, 'lic', deps)).ok).toBe(true)
    expect(await licenceBannerAs(admin, deps)).toHaveLength(1)
    expect(calls).toEqual(['status', 'install', 'remove'])
  })
})
