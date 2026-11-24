/**
 * App builder service (lib/services/apps.ts): who can see, open and edit an
 * app (audience by user / team / role, editors, apps.manage), tenant pinning
 * (another workspace's apps never exist), principal validation, pages and
 * layout validation — plus the REST routes over it.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/github-sync/enqueue', () => ({ recordAssetChange: vi.fn(async () => {}) }))
vi.mock('@/lib/api-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-auth')>()
  return { ...actual, validateApiKey: vi.fn() }
})

import { validateApiKey } from '@/lib/api-auth'
import type { ServiceContext } from '@/lib/services/context'
import * as apps from '@/lib/services/apps'
import { GET as listRoute, POST as createRoute } from '@/app/api/v1/apps/route'
import { GET as getRoute, PATCH as patchRoute } from '@/app/api/v1/apps/[id]/route'
import { createMemorySupabase } from './fixtures/supabase-memory'
import { publishSeededApps } from './fixtures/app-drafts'

const T = 'tenant-a'
const OTHER = 'tenant-b'
const BUILDER = '0a000000-0000-4000-8000-000000000001'
const MEMBER = '0a000000-0000-4000-8000-000000000002'
const OUTSIDER = '0a000000-0000-4000-8000-000000000003'
const EDITOR = '0a000000-0000-4000-8000-000000000004'
const B_USER = '0a000000-0000-4000-8000-000000000009'
const TEAM = '0b000000-0000-4000-8000-000000000001'
const ROLE = '0c000000-0000-4000-8000-000000000001'
const APP = '0d000000-0000-4000-8000-000000000001'
const FOREIGN_APP = '0d000000-0000-4000-8000-000000000002'
const STAMP = '2026-11-20T10:00:00.000Z'

function seed() {
  return createMemorySupabase({
    apps: [
      { id: APP, tenant_id: T, slug: 'claims', name: 'Claims', subtitle: 'Desk', description: 'Claims desk', icon: 'Receipt', color: '#16a34a', menu: [], created_by: BUILDER, created_at: STAMP, updated_at: STAMP },
      { id: FOREIGN_APP, tenant_id: OTHER, slug: 'claims', name: 'Other claims', subtitle: null, description: null, icon: null, color: null, menu: [], created_by: B_USER, created_at: STAMP, updated_at: STAMP },
    ],
    app_pages: [
      { id: 'p1', tenant_id: T, app_id: APP, slug: 'home', title: 'Home', icon: null, position: 0, layout: { widgets: [{ id: 'h1', type: 'heading', w: 12, h: 2, config: { text: 'Hi' } }] }, filters: [], created_at: STAMP, updated_at: STAMP },
      { id: 'p9', tenant_id: OTHER, app_id: FOREIGN_APP, slug: 'home', title: 'Home', icon: null, position: 0, layout: { widgets: [] }, filters: [], created_at: STAMP, updated_at: STAMP },
    ],
    app_audience: [
      { id: 'a1', tenant_id: T, app_id: APP, principal_type: 'team', principal_id: TEAM },
      // The foreign app names our member: it must still never show up here.
      { id: 'a9', tenant_id: OTHER, app_id: FOREIGN_APP, principal_type: 'user', principal_id: MEMBER },
    ],
    app_editors: [{ id: 'e1', tenant_id: T, app_id: APP, user_id: EDITOR }],
    // Memory rows carry the embedded filter column literally (no joins in the fixture).
    user_teams: [{ id: 'ut1', user_id: MEMBER, team_id: TEAM, 'team.tenant_id': T }],
    user_roles: [{ id: 'ur1', tenant_id: T, user_id: OUTSIDER, role_id: 'some-other-role' }],
    users: [{ id: MEMBER, team_id: null }, { id: OUTSIDER, team_id: null }, { id: BUILDER, team_id: null }, { id: EDITOR, team_id: null }],
    user_memberships: [MEMBER, OUTSIDER, BUILDER, EDITOR].map((user_id) => ({ user_id, tenant_id: T, is_active: true })),
    teams: [{ id: TEAM, tenant_id: T, name: 'Claims team' }],
    roles: [{ id: ROLE, tenant_id: T, name: 'Agents' }],
  }, { uuids: true })
}

type Db = ReturnType<typeof seed>
let db: Db
const ctx = (actorId: string | null, permissions: string[] | null, tenantId = T): ServiceContext => ({
  db: db as any, supabase: db as any, tenantId, actorId, permissions: permissions ? new Set(permissions) : null,
  resourceScopes: { workflow_ids: [], table_ids: [] }, authKind: 'api_key', source: 'api',
})
const VIEW = ['apps.view']
const MANAGE = ['apps.view', 'apps.manage']

// The seeded apps are published (as migration 20270123090000 does to existing apps).
beforeEach(() => { db = seed(); publishSeededApps(db) })

describe('who sees which apps', () => {
  it('an audience member (through a team) sees and opens the app, without builder details', async () => {
    const list = await apps.listApps(ctx(MEMBER, VIEW))
    expect(list.map((a) => a.id)).toEqual([APP])
    expect(list[0]).toMatchObject({ access: 'view', in_audience: true, home_page: 'home', subtitle: 'Desk' })
    const detail = await apps.getApp(ctx(MEMBER, VIEW), 'claims')
    expect(detail.audience).toBeNull()
    expect(detail.editors).toBeNull()
    expect((await apps.getPage(ctx(MEMBER, VIEW), 'claims', 'home')).layout.widgets).toHaveLength(1)
  })

  it('a non-audience user sees nothing and gets 404 opening it', async () => {
    expect(await apps.listApps(ctx(OUTSIDER, VIEW))).toEqual([])
    await expect(apps.getApp(ctx(OUTSIDER, VIEW), APP)).rejects.toMatchObject({ code: 'not_found' })
    await expect(apps.getPage(ctx(OUTSIDER, VIEW), 'claims', 'home')).rejects.toMatchObject({ code: 'not_found' })
    expect(await apps.getAppAccess(ctx(OUTSIDER, VIEW), 'claims')).toBeNull()
  })

  it('an audience member without apps.view can’t open it', async () => {
    expect(await apps.listApps(ctx(MEMBER, []))).toEqual([])
    await expect(apps.getApp(ctx(MEMBER, []), APP)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('another workspace’s apps never exist — not by id, not by slug, not with apps.manage', async () => {
    expect((await apps.listApps(ctx(MEMBER, VIEW))).some((a) => a.id === FOREIGN_APP)).toBe(false)
    await expect(apps.getApp(ctx(BUILDER, MANAGE), FOREIGN_APP)).rejects.toMatchObject({ code: 'not_found' })
    const list = await apps.listApps(ctx(BUILDER, MANAGE))
    expect(list.map((a) => a.id)).toEqual([APP])
    await expect(apps.updateApp(ctx(BUILDER, MANAGE), FOREIGN_APP, { name: 'Hijack' })).rejects.toMatchObject({ code: 'not_found' })
    expect((db.tables.apps ?? []).find((a: any) => a.id === FOREIGN_APP)?.name).toBe('Other claims')
  })

  it('editors and apps.manage get edit access and the audience; editors without apps.view still edit', async () => {
    expect((await apps.getApp(ctx(EDITOR, []), APP))).toMatchObject({ access: 'edit', in_audience: false, app_role: 'editor', audience: [{ type: 'team', id: TEAM, role: 'viewer' }], editors: [EDITOR] })
    expect((await apps.listApps(ctx(BUILDER, MANAGE), { editable: true })).map((a) => a.id)).toEqual([APP])
    expect(await apps.listApps(ctx(MEMBER, VIEW), { editable: true })).toEqual([])
  })
})

describe('writing apps', () => {
  it('creating needs apps.manage; the creator becomes an editor and a Home page is added', async () => {
    await expect(apps.createApp(ctx(MEMBER, VIEW), { name: 'Mine' })).rejects.toMatchObject({ code: 'forbidden' })
    const created = await apps.createApp(ctx(BUILDER, MANAGE), { name: 'Claims', subtitle: 'Second', audience: [{ type: 'role', id: ROLE }] })
    expect(created.slug).toBe('claims-2')
    expect(created.editors).toEqual([BUILDER])
    expect(created.audience).toEqual([{ type: 'role', id: ROLE, role: 'viewer' }])
    expect(created.pages.map((p) => p.slug)).toEqual(['home'])
  })

  it('audience and editors must be people, teams and roles of this workspace', async () => {
    await expect(apps.updateApp(ctx(BUILDER, MANAGE), APP, { audience: [{ type: 'user', id: B_USER }] })).rejects.toMatchObject({ code: 'validation_error' })
    await expect(apps.updateApp(ctx(BUILDER, MANAGE), APP, { editors: [B_USER] })).rejects.toMatchObject({ code: 'validation_error' })
    await expect(apps.createApp(ctx(BUILDER, MANAGE), { name: 'X', audience: [{ type: 'team', id: ROLE }] })).rejects.toMatchObject({ code: 'validation_error' })
  })

  it('viewers can’t edit; editors can (but can’t remove themselves); only apps.manage deletes', async () => {
    await expect(apps.updateApp(ctx(MEMBER, VIEW), APP, { name: 'Renamed' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(apps.updatePage(ctx(MEMBER, VIEW), APP, 'home', { title: 'Mine' })).rejects.toMatchObject({ code: 'forbidden' })
    const updated = await apps.updateApp(ctx(EDITOR, VIEW), APP, { name: 'Claims hub', audience: [{ type: 'user', id: OUTSIDER }] })
    expect(updated.name).toBe('Claims hub')
    expect(await apps.getAppAccess(ctx(OUTSIDER, VIEW), APP)).toBe('view')
    expect(await apps.getAppAccess(ctx(MEMBER, VIEW), APP)).toBeNull()
    await expect(apps.updateApp(ctx(EDITOR, VIEW), APP, { editors: [] })).rejects.toMatchObject({ code: 'validation_error' })
    await expect(apps.deleteApp(ctx(EDITOR, VIEW), APP)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(apps.deleteApp(ctx(BUILDER, MANAGE), APP)).resolves.toMatchObject({ deleted: true })
  })

  it('pages: create with a unique slug, validate layouts, reorder, delete', async () => {
    const c = ctx(EDITOR, VIEW)
    const page = await apps.createPage(c, APP, { title: 'Home', layout: { widgets: [{ id: 'm1', type: 'metric', w: 3, h: 3, config: { source: 'tasks' } }] } as any })
    expect(page.slug).toBe('home-2')
    expect(page.position).toBe(1)
    await expect(apps.updatePage(c, APP, page.id, { layout: { widgets: [{ id: 'x', type: 'iframe', w: 3, h: 3, config: {} }] } as any })).rejects.toMatchObject({ code: 'validation_error' })
    await expect(apps.updatePage(c, APP, page.id, { layout: { widgets: [{ id: 'm1', type: 'metric', w: 3, h: 3, config: { source: 'everything' } }] } as any })).rejects.toMatchObject({ code: 'validation_error' })
    const order = await apps.reorderPages(c, APP, [page.id, 'home'])
    expect(order.map((p) => p.slug)).toEqual(['home-2', 'home'])
    await apps.deletePage(c, APP, 'home-2')
    expect((await apps.listPages(c, APP)).map((p) => p.slug)).toEqual(['home'])
  })

  it('the widget catalogue lists every type with a config schema', () => {
    const types = apps.listWidgetTypes()
    expect(types.map((t) => t.type)).toContain('task_list')
    expect(types.every((t) => t.config_schema && typeof t.config_schema === 'object')).toBe(true)
  })
})

describe('REST routes', () => {
  const mocked = vi.mocked(validateApiKey)
  const auth = (actingUserId: string | null, permissions: string[]) => ({
    success: true as const, tenantId: T, keyId: 'k', keyType: 'personal' as const, createdBy: actingUserId ?? BUILDER, actingUserId,
    scopes: { workflow_ids: [], table_ids: [] }, permissions, supabase: db as any, authKind: 'api_key' as const, expiresAt: null,
  })
  const req = (url: string, method = 'GET', body?: unknown) => new NextRequest(`https://app.test/api/v1${url}`, {
    method, headers: { authorization: 'Bearer t', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  })
  const params = (p: Record<string, string>) => ({ params: Promise.resolve(p) })

  it('GET /apps lists the caller’s apps; without apps.view it is 403', async () => {
    mocked.mockResolvedValue(auth(MEMBER, VIEW) as any)
    const ok = await listRoute(req('/apps'), params({}))
    expect(ok.status).toBe(200)
    expect((await ok.json()).data).toMatchObject({ total: 1, apps: [{ slug: 'claims' }] })
    mocked.mockResolvedValue(auth(MEMBER, []) as any)
    expect((await listRoute(req('/apps'), params({}))).status).toBe(403)
  })

  it('GET /apps/{id} 404s for a non-audience key holder; POST needs apps.manage; PATCH round-trips', async () => {
    mocked.mockResolvedValue(auth(OUTSIDER, VIEW) as any)
    expect((await getRoute(req(`/apps/${APP}`), params({ id: APP }))).status).toBe(404)
    expect((await createRoute(req('/apps', 'POST', { name: 'New' }), params({}))).status).toBe(403)
    mocked.mockResolvedValue(auth(BUILDER, MANAGE) as any)
    const got = await (await getRoute(req('/apps/claims'), params({ id: 'claims' }))).json()
    const patched = await patchRoute(req('/apps/claims', 'PATCH', got.data), params({ id: 'claims' }))
    expect(patched.status).toBe(200)
    expect((await patched.json()).data.app).toMatchObject({ slug: 'claims', name: 'Claims' })
  })
})
