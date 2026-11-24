/**
 * Apps and permissions: an app never grants access by itself
 * (lib/apps/governance.ts, lib/services/apps.ts presentation). Buttons, menu
 * entries and widgets tied to a form / workflow / data table / report show
 * only when the viewer may use the object under the existing rules; viewers
 * (read-only app role) never get action buttons or Claim; contributors get
 * them only where the object allows; hidden items are removed server-side
 * (nothing about them is sent) and the actions stay authorised by their own
 * services.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/github-sync/enqueue', () => ({ recordAssetChange: vi.fn(async () => {}) }))

import { appRoleFor, canAct } from '@/lib/apps/access'
import { appBindings, objectAllowed, presentLayout, presentMenu, type ObjectFacts } from '@/lib/apps/governance'
import { normalisePageLayout } from '@/lib/apps/schema'
import type { ServiceContext } from '@/lib/services/context'
import * as apps from '@/lib/services/apps'
import { createMemorySupabase } from './fixtures/supabase-memory'
import { publishSeededApps } from './fixtures/app-drafts'

const T = 'tenant-a'
const FORM = '0f000000-0000-4000-8000-0000000000f1'
const FORM_NO_GRANT = '0f000000-0000-4000-8000-0000000000f2'
const WF = '0f000000-0000-4000-8000-0000000000a1'
const TABLE = '0f000000-0000-4000-8000-0000000000d1'
const REPORT_SHARED = '0f000000-0000-4000-8000-0000000000e1'
const REPORT_PRIVATE = '0f000000-0000-4000-8000-0000000000e2'
const FOREIGN_FORM = '0f000000-0000-4000-8000-0000000000f9'

const layout = normalisePageLayout({
  widgets: [
    { id: 'btns', type: 'actions', w: 12, h: 2, config: { buttons: [
      { label: 'New claim', action: { kind: 'new_submission', form_id: FORM, open: 'modal' } },
      { label: 'Secret form', action: { kind: 'new_submission', form_id: FORM_NO_GRANT, open: 'modal' } },
      { label: 'Run it', action: { kind: 'start_workflow', workflow_id: WF } },
      { label: 'Other tenant', action: { kind: 'new_submission', form_id: FOREIGN_FORM, open: 'modal' } },
      { label: 'Help', action: { kind: 'open_url', url: 'https://example.com/help' } },
    ] } },
    { id: 'tasks', type: 'task_list', w: 6, h: 8, config: { scope: 'queue', show_claim: true } },
    { id: 'rows', type: 'table_view', w: 12, h: 8, config: { kind: 'data_table', table_id: TABLE } },
    { id: 'shared', type: 'table_view', w: 12, h: 8, config: { kind: 'report', report_id: REPORT_SHARED } },
    { id: 'private', type: 'table_view', w: 12, h: 8, config: { kind: 'report', report_id: REPORT_PRIVATE } },
    { id: 'subs', type: 'recent', w: 6, h: 6, config: { source: 'submissions' } },
    { id: 'hello', type: 'heading', w: 12, h: 2, config: { text: 'Hello' } },
  ],
})
const menu = [
  { kind: 'form' as const, label: 'Claim form', form_id: FORM, open: 'modal' as const },
  { kind: 'url' as const, label: 'Policy', url: 'https://example.com/policy', new_tab: true },
]

const facts = (perms: string[], grants: string[] = [FORM]): ObjectFacts => ({
  can: (p) => perms.includes(p),
  formGrants: new Set(grants),
  exists: { form: new Set([FORM, FORM_NO_GRANT]), workflow: new Set([WF]), data_table: new Set([TABLE]), report: new Set([REPORT_SHARED, REPORT_PRIVATE]) },
  visibleReports: new Set([REPORT_SHARED]),
})
const ids = (l: { widgets: Array<{ id: string }> }) => l.widgets.map((w) => w.id)
const labels = (l: any) => (l.widgets.find((w: any) => w.id === 'btns')?.config.buttons ?? []).map((b: any) => b.label)
const MEMBER = ['apps.view', 'tasks.view_own', 'tasks.complete', 'forms.submit', 'data.view', 'reports.view']

describe('object rules (the existing ones)', () => {
  it('forms: Edit forms, or Submit forms plus a View / Submit grant; never another workspace’s form', () => {
    expect(objectAllowed(facts(['forms.submit']), 'form', FORM, 'submit')).toEqual({ allowed: true })
    expect(objectAllowed(facts(['forms.submit']), 'form', FORM_NO_GRANT, 'submit')).toEqual({ allowed: false, missing: 'grant' })
    expect(objectAllowed(facts([]), 'form', FORM, 'submit')).toEqual({ allowed: false, missing: 'permission', permission: 'forms.submit' })
    expect(objectAllowed(facts(['forms.edit']), 'form', FORM_NO_GRANT, 'submit')).toEqual({ allowed: true })
    expect(objectAllowed(facts(['forms.edit']), 'form', FOREIGN_FORM, 'submit')).toEqual({ allowed: false, missing: 'object' })
  })
  it('workflows need View and Start workflows; reports need sharing; tables View data', () => {
    expect(objectAllowed(facts(['workflows.view']), 'workflow', WF, 'start')).toMatchObject({ allowed: false, permission: 'workflows.activate' })
    expect(objectAllowed(facts(['workflows.view', 'workflows.activate']), 'workflow', WF, 'start').allowed).toBe(true)
    expect(objectAllowed(facts(['reports.view']), 'report', REPORT_PRIVATE, 'view')).toEqual({ allowed: false, missing: 'shared' })
    expect(objectAllowed(facts([]), 'data_table', TABLE, 'view')).toMatchObject({ permission: 'data.view' })
  })
})

describe('what a viewer is shown', () => {
  it('a viewer (read-only) never gets action buttons or Claim, even with every permission', () => {
    const out = presentLayout(layout, facts([...MEMBER, 'forms.edit', 'workflows.view', 'workflows.activate']), 'viewer')
    expect(labels(out)).toEqual(['Help'])
    expect((out.widgets.find((w) => w.id === 'tasks')!.config as any).show_claim).toBe(false)
    expect(presentMenu(menu, facts(MEMBER), 'viewer').map((m) => m.label)).toEqual(['Policy'])
  })

  it('a contributor gets only the buttons the objects allow', () => {
    const out = presentLayout(layout, facts(MEMBER), 'contributor')
    expect(labels(out)).toEqual(['New claim', 'Help'])
    expect((out.widgets.find((w) => w.id === 'tasks')!.config as any).show_claim).toBe(true)
    expect(presentMenu(menu, facts(MEMBER), 'contributor').map((m) => m.label)).toEqual(['Claim form', 'Policy'])
    expect(presentMenu(menu, facts(MEMBER, []), 'contributor').map((m) => m.label)).toEqual(['Policy'])
  })

  it('data widgets the viewer can’t read are dropped (no table, unshared report, no submissions / tasks access)', () => {
    expect(ids(presentLayout(layout, facts(MEMBER), 'contributor'))).toEqual(['btns', 'tasks', 'rows', 'shared', 'subs', 'hello'])
    expect(ids(presentLayout(layout, facts(['apps.view']), 'contributor'))).toEqual(['btns', 'hello'])
  })

  it('app roles: the widest audience entry wins; editors act; the role never widens object access', () => {
    const viewer = { userId: 'u1', teamIds: ['t1'], roleIds: ['r1'], can: (p: string) => p === 'apps.view' }
    expect(appRoleFor(viewer, { audience: [{ type: 'team', id: 't1', role: 'viewer' }, { type: 'role', id: 'r1', role: 'contributor' }], editors: [] })).toBe('contributor')
    expect(appRoleFor(viewer, { audience: [{ type: 'team', id: 't1', role: 'viewer' }], editors: [] })).toBe('viewer')
    expect(appRoleFor(viewer, { audience: [], editors: ['u1'] })).toBe('editor')
    expect(canAct('viewer')).toBe(false)
    expect(labels(presentLayout(layout, facts([]), 'editor'))).toEqual(['Help'])
  })

  it('bindings list every object a page and menu use, with action vs data', () => {
    const b = appBindings([{ title: 'Home', layout }], menu)
    expect(b.objects.filter((o) => o.action).map((o) => o.id)).toEqual([FORM, FORM, FORM_NO_GRANT, WF, FOREIGN_FORM])
    expect(b.objects.filter((o) => !o.action).map((o) => o.kind)).toEqual(['data_table', 'report', 'report'])
    expect(b.sources.map((s) => s.source).sort()).toEqual(['submissions', 'tasks'])
  })
})

describe('the server sends only what the viewer may use', () => {
  const VIEWER_U = '0a000000-0000-4000-8000-000000000011'
  const CONTRIB_U = '0a000000-0000-4000-8000-000000000012'
  const APP = '0d000000-0000-4000-8000-000000000011'
  let db: ReturnType<typeof createMemorySupabase>
  beforeEach(() => {
    db = createMemorySupabase({
      apps: [{ id: APP, tenant_id: T, slug: 'desk', name: 'Desk', menu, settings: {}, created_at: 'x', updated_at: 'x' }],
      app_pages: [{ id: 'p1', tenant_id: T, app_id: APP, slug: 'home', title: 'Home', position: 0, layout, filters: [], updated_at: 'x' }],
      app_audience: [
        { tenant_id: T, app_id: APP, principal_type: 'user', principal_id: VIEWER_U, app_role: 'viewer' },
        { tenant_id: T, app_id: APP, principal_type: 'user', principal_id: CONTRIB_U, app_role: 'contributor' },
      ],
      app_editors: [],
      forms: [{ id: FORM, tenant_id: T, name: 'Claim', created_by: null }, { id: FORM_NO_GRANT, tenant_id: T, name: 'Secret', created_by: null }, { id: FOREIGN_FORM, tenant_id: 'tenant-b', name: 'B form', created_by: null }],
      workflows: [{ id: WF, tenant_id: T, name: 'Flow', created_by: null }],
      custom_tables: [{ id: TABLE, tenant_id: T, name: 'Rows', created_by: null }],
      reports: [{ id: REPORT_SHARED, tenant_id: T, name: 'Shared', created_by: null, is_shared: true }, { id: REPORT_PRIVATE, tenant_id: T, name: 'Private', created_by: 'someone', is_shared: false }],
      object_permissions: [
        { tenant_id: T, object_type: 'form', object_id: FORM, user_id: VIEWER_U, team_id: null, role_id: null, can_view: true, can_execute: true },
        { tenant_id: T, object_type: 'form', object_id: FORM, user_id: CONTRIB_U, team_id: null, role_id: null, can_view: true, can_execute: true },
        // A grant in another workspace on our form id: never counts.
        { tenant_id: 'tenant-b', object_type: 'form', object_id: FORM_NO_GRANT, user_id: CONTRIB_U, team_id: null, role_id: null, can_view: true, can_execute: true },
      ],
      user_teams: [], user_roles: [], users: [{ id: VIEWER_U }, { id: CONTRIB_U }],
    })
    publishSeededApps(db)
  })
  const ctx = (actorId: string, perms: string[]): ServiceContext => ({
    db: db as any, supabase: db as any, tenantId: T, actorId, permissions: new Set(perms), resourceScopes: { workflow_ids: [], table_ids: [] }, authKind: 'api_key', source: 'api',
  })

  it('viewer: no action buttons, no form menu entry, Claim off — and the hidden form ids are not in the payload', async () => {
    const view = await apps.getAppPageView(ctx(VIEWER_U, MEMBER), 'desk', 'home')
    expect(view.app.app_role).toBe('viewer')
    expect(labels(view.page!.layout)).toEqual(['Help'])
    expect(view.app.menu.map((m) => m.label)).toEqual(['Policy'])
    expect(JSON.stringify(view)).not.toContain(FORM_NO_GRANT)
    expect(JSON.stringify(view)).not.toContain(FORM)
    expect(JSON.stringify(view)).not.toContain(REPORT_PRIVATE)
  })

  it('contributor: the granted form’s button and menu entry only; never another workspace’s grant', async () => {
    const view = await apps.getAppPageView(ctx(CONTRIB_U, MEMBER), 'desk', 'home')
    expect(view.app.app_role).toBe('contributor')
    expect(labels(view.page!.layout)).toEqual(['New claim', 'Help'])
    expect(view.app.menu.map((m) => m.label)).toEqual(['Claim form', 'Policy'])
    expect(JSON.stringify(view)).not.toContain(FORM_NO_GRANT)
    // The REST / MCP page read is presented the same way for non-editors.
    expect(labels((await apps.getPage(ctx(CONTRIB_U, MEMBER), 'desk', 'home')).layout)).toEqual(['New claim', 'Help'])
  })

  it('the builder (edit mode) is refused to non-editors', async () => {
    await expect(apps.getAppPageView(ctx(CONTRIB_U, MEMBER), 'desk', 'home', 'edit')).rejects.toMatchObject({ code: 'forbidden' })
  })
})
