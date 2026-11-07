import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-auth')>()
  return { ...actual, validateApiKey: vi.fn() }
})
vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/github-sync/enqueue', () => ({ recordAssetChange: vi.fn(async () => {}) }))
const session = vi.hoisted(() => ({ ctx: null as unknown, db: null as unknown }))
vi.mock('@/lib/cron-auth', () => ({ createServiceClient: () => session.db }))
vi.mock('@/lib/services/context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/context')>()
  return { ...actual, fromSession: vi.fn(async () => { if (!session.ctx) throw new actual.ServiceError('unauthorized', 'Not authenticated'); return session.ctx }) }
})

import { validateApiKey, type ApiKeySuccessResult } from '@/lib/api-auth'
import { GET as listControls, POST as createControl } from '@/app/api/v1/form-controls/route'
import { DELETE as deleteControl, GET as getControl, PATCH as patchControl } from '@/app/api/v1/form-controls/[id]/route'
import { GET as exportControl } from '@/app/api/v1/form-controls/[id]/export/route'
import { POST as importControl } from '@/app/api/v1/form-controls/import/route'
import { serveControlFrame, serveTrustedBundle } from '@/lib/services/form-control-frame'
import { updateFormControl } from '@/lib/services/form-controls'
import type { ServiceContext } from '@/lib/services/context'
import { createMemorySupabase } from './fixtures/supabase-memory'

const MANIFEST = JSON.parse(readFileSync('templates/form-control-starter/vanilla-js/manifest.json', 'utf8'))
const MODULE = readFileSync('templates/form-control-starter/vanilla-js/ut-star-rating.js', 'utf8')
const ALL = ['extensibility.view', 'extensibility.create', 'extensibility.edit', 'extensibility.delete', 'forms.view']
const mockedValidate = vi.mocked(validateApiKey)

function authAs(db: ReturnType<typeof createMemorySupabase>, tenantId = 'tenant-a', permissions = ALL) {
  mockedValidate.mockResolvedValue({
    success: true, tenantId, keyId: 'key-1', keyType: 'tenant', createdBy: 'u1', actingUserId: null,
    scopes: { workflow_ids: [], table_ids: [] }, permissions,
    supabase: db as unknown as ApiKeySuccessResult['supabase'], authKind: 'api_key', expiresAt: null,
  })
}
function req(path: string, init?: { method?: string; body?: unknown }) {
  return new NextRequest(`https://app.test/api/v1${path}`, {
    method: init?.method ?? 'GET',
    headers: { authorization: 'Bearer ut_test', 'content-type': 'application/json' },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  })
}
const params = (p: Record<string, string>) => ({ params: Promise.resolve(p) })
const sessionCtx = (db: unknown, tenantId: string): ServiceContext => ({ db: db as never, supabase: db as never, tenantId, actorId: 'u1', permissions: new Set(ALL), authKind: 'session', source: 'ui' })

let db: ReturnType<typeof createMemorySupabase>
beforeEach(async () => {
  mockedValidate.mockReset()
  session.ctx = null
  db = createMemorySupabase({ form_controls: [], form_control_versions: [], forms: [], form_versions: [], workflows: [], workflow_versions: [], tasks: [], deletion_queue: [] }, { uuids: true })
  session.db = db
  authAs(db)
  const res = await createControl(req('/form-controls', { method: 'POST', body: { module: MODULE, manifest: MANIFEST } }))
  expect(res.status).toBe(201)
})

describe('/api/v1/form-controls', () => {
  it('uploads a control, lists it and gets it by tag', async () => {
    const list = await (await listControls(req('/form-controls'))).json()
    expect(list.data.form_controls).toHaveLength(1)
    expect(list.data.form_controls[0]).toMatchObject({ tag: 'ut-star-rating', latest_version: '1.0.0', enabled: true, trusted: false })
    const one = await (await getControl(req('/form-controls/ut-star-rating'), params({ id: 'ut-star-rating' }))).json()
    expect(one.data.form_control.versions[0].sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('keeps versions immutable (same bytes: unchanged; different bytes: 409) and adds new versions', async () => {
    const same = await (await createControl(req('/form-controls', { method: 'POST', body: { module: MODULE, manifest: MANIFEST } }))).json()
    expect(same.data.outcome).toBe('unchanged')
    const changed = await createControl(req('/form-controls', { method: 'POST', body: { module: `${MODULE}\n// v2`, manifest: MANIFEST } }))
    expect(changed.status).toBe(409)
    const v2 = await (await createControl(req('/form-controls', { method: 'POST', body: { module: `${MODULE}\n// v2`, manifest: { ...MANIFEST, version: '1.1.0' } } }))).json()
    expect(v2.data).toMatchObject({ outcome: 'version', version: '1.1.0', control: { latest_version: '1.1.0' } })
  })

  it('refuses another workspace (cross-tenant access denied)', async () => {
    authAs(db, 'tenant-b')
    expect((await getControl(req('/form-controls/ut-star-rating'), params({ id: 'ut-star-rating' }))).status).toBe(404)
    expect((await (await listControls(req('/form-controls'))).json()).data.form_controls).toHaveLength(0)
    expect((await deleteControl(req('/form-controls/ut-star-rating', { method: 'DELETE' }), params({ id: 'ut-star-rating' }))).status).toBe(404)
  })

  it('needs the extensibility permissions', async () => {
    authAs(db, 'tenant-a', ['forms.view'])
    expect((await createControl(req('/form-controls', { method: 'POST', body: { module: MODULE, manifest: { ...MANIFEST, version: '2.0.0' } } }))).status).toBe(403)
    expect((await patchControl(req('/form-controls/ut-star-rating', { method: 'PATCH', body: { enabled: false } }), params({ id: 'ut-star-rating' }))).status).toBe(403)
  })

  it('approves only hosts a manifest asks for; trusted needs an instance admin', async () => {
    const res = await patchControl(req('/form-controls/ut-star-rating', { method: 'PATCH', body: { approved_hosts: ['evil.example.com'] } }), params({ id: 'ut-star-rating' }))
    expect(res.status).toBe(400)
    const ctx = sessionCtx(db, 'tenant-a')
    await expect(updateFormControl(ctx, 'ut-star-rating', { trusted: true })).rejects.toThrow(/instance administrator/)
    expect((await updateFormControl(ctx, 'ut-star-rating', { trusted: true }, { instanceAdmin: true })).trusted).toBe(true)
  })

  it('refuses to delete a control a form uses, lists the usage, then deletes once unused', async () => {
    const field = { key: 'rating', label: 'Rating', type: 'custom', custom: { tag: 'ut-star-rating', version: '1.0.0', value_type: 'number' } }
    db.tables.forms.push({ id: 'f1', tenant_id: 'tenant-a', name: 'Feedback', version: 1, fields: [field] })
    const blocked = await deleteControl(req('/form-controls/ut-star-rating', { method: 'DELETE' }), params({ id: 'ut-star-rating' }))
    expect(blocked.status).toBe(409)
    expect(JSON.stringify(await blocked.json())).toContain('Feedback')
    db.tables.forms.length = 0
    expect((await deleteControl(req('/form-controls/ut-star-rating', { method: 'DELETE' }), params({ id: 'ut-star-rating' }))).status).toBe(200)
  })

  it('exports with modules and imports into another workspace (checksums verified)', async () => {
    const exported = await (await exportControl(req('/form-controls/ut-star-rating/export'), params({ id: 'ut-star-rating' }))).json()
    const payload = exported.data
    expect(payload.form_control.versions[0].bundle).toBe(MODULE)
    authAs(db, 'tenant-b')
    const imported = await importControl(req('/form-controls/import', { method: 'POST', body: payload }))
    expect(imported.status).toBe(201)
    expect((await imported.json()).data).toMatchObject({ outcome: 'created', added: ['1.0.0'] })
    payload.form_control.versions[0].bundle = `${MODULE}\n// tampered`
    expect((await importControl(req('/form-controls/import', { method: 'POST', body: payload }))).status).toBe(400)
  })
})

describe('frame route', () => {
  const frameReq = (path: string) => new Request(`https://app.test${path}`)

  it('serves the sandboxed document with its own CSP to a member', async () => {
    session.ctx = sessionCtx(db, 'tenant-a')
    const res = await serveControlFrame(frameReq('/form-controls/frame/ut-star-rating/1.0.0'), 'ut-star-rating', '1.0.0')
    expect(res.status).toBe(200)
    const csp = res.headers.get('content-security-policy') ?? ''
    expect(csp).toContain("connect-src 'none'")
    expect(csp).toContain('sandbox allow-scripts')
    expect(csp).toContain("frame-ancestors 'self'")
    expect(csp.match(/'sha256-/g)).toHaveLength(2)
    expect(res.headers.get('x-frame-options')).toBeNull()
    const html = await res.text()
    expect(html).toContain('customElements.whenDefined')
    expect(html).toContain('customElements.define(TAG, UtStarRating)')
  })

  it('refuses signed-out callers, other workspaces, unknown versions and disabled controls', async () => {
    expect((await serveControlFrame(frameReq('/x'), 'ut-star-rating', '1.0.0')).status).toBe(401)
    session.ctx = sessionCtx(db, 'tenant-b')
    expect((await serveControlFrame(frameReq('/x'), 'ut-star-rating', '1.0.0')).status).toBe(404)
    session.ctx = sessionCtx(db, 'tenant-a')
    expect((await serveControlFrame(frameReq('/x'), 'ut-star-rating', '9.9.9')).status).toBe(404)
    await updateFormControl(sessionCtx(db, 'tenant-a'), 'ut-star-rating', { enabled: false })
    const disabled = await serveControlFrame(frameReq('/x'), 'ut-star-rating', '1.0.0')
    expect(disabled.status).toBe(403)
    expect(disabled.headers.get('content-security-policy')).toContain('sandbox')
  })

  it('adds approved hosts to connect-src', async () => {
    db.tables.form_control_versions[0].manifest = { ...db.tables.form_control_versions[0].manifest, capabilities: ['network'], network: { allowed_hosts: ['api.example.com'] } }
    db.tables.form_controls[0].approved_hosts = ['api.example.com']
    session.ctx = sessionCtx(db, 'tenant-a')
    const res = await serveControlFrame(frameReq('/x'), 'ut-star-rating', '1.0.0')
    expect(res.headers.get('content-security-policy')).toContain('connect-src https://api.example.com')
  })

  it('refuses a stored module that no longer matches its checksum', async () => {
    db.tables.form_control_versions[0].bundle = `${MODULE}\n// edited in the database`
    session.ctx = sessionCtx(db, 'tenant-a')
    expect((await serveControlFrame(frameReq('/x'), 'ut-star-rating', '1.0.0')).status).toBe(500)
  })

  it('serves the module inline only for trusted controls', async () => {
    session.ctx = sessionCtx(db, 'tenant-a')
    expect((await serveTrustedBundle(frameReq('/x'), 'ut-star-rating', '1.0.0.js')).status).toBe(403)
    await updateFormControl(sessionCtx(db, 'tenant-a'), 'ut-star-rating', { trusted: true }, { instanceAdmin: true })
    const res = await serveTrustedBundle(frameReq('/x'), 'ut-star-rating', '1.0.0.js')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('javascript')
  })
})
