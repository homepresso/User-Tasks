/**
 * App specs, server side (lib/services/app-spec.ts) on the in-memory store:
 *
 *  - plan → apply builds the expected app, pages, widgets, filters, rules
 *    and audience in one step, audited as the caller ("via Agent" kept);
 *  - permission refusals: creating without Build apps, editing an app you
 *    can only open, binding objects that don't exist / belong to another
 *    workspace / a private report of someone else, an API reference without
 *    View integrations, "allow app viewers" without Manage references, a
 *    "Start a workflow" rule without Start workflows, people of another
 *    workspace — all as plain-language plan errors, and apply refuses;
 *  - incremental edits keep what they don't touch;
 *  - a failing step leaves nothing behind (a new app is deleted again; an
 *    edit is undone: settings, page layouts, added and deleted pages);
 *  - the REST routes answer like the service.
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

import { writeAudit } from '@/lib/audit-log'
import { validateApiKey } from '@/lib/api-auth'
import type { ServiceContext } from '@/lib/services/context'
import * as apps from '@/lib/services/apps'
import { applyAppSpec, planAppSpec, describeAppObject } from '@/lib/services/app-spec'
import { searchForBuilder } from '@/lib/services/app-search'
import { POST as planRoute } from '@/app/api/v1/apps/spec/plan/route'
import { POST as applyRoute } from '@/app/api/v1/apps/spec/apply/route'
import { createMemorySupabase } from './fixtures/supabase-memory'
import { publishSeededApps } from './fixtures/app-drafts'

const T = 'tenant-a'
const OTHER = 'tenant-b'
const BUILDER = '0a000000-0000-4000-8000-000000000001'
const MEMBER = '0a000000-0000-4000-8000-000000000002'
const EDITOR = '0a000000-0000-4000-8000-000000000004'
const B_USER = '0a000000-0000-4000-8000-000000000009'
const TEAM = '0b000000-0000-4000-8000-000000000001'
const B_TEAM = '0b000000-0000-4000-8000-000000000009'
const ROLE = '0c000000-0000-4000-8000-000000000001'
const APP = '0d000000-0000-4000-8000-000000000001'
const FORM = '0e000000-0000-4000-8000-000000000001'
const B_FORM = '0e000000-0000-4000-8000-000000000009'
const WF = '0f000000-0000-4000-8000-000000000001'
const REPORT = '0f100000-0000-4000-8000-000000000001'
const PRIVATE_REPORT = '0f100000-0000-4000-8000-000000000002'
const REF = '0f200000-0000-4000-8000-000000000001'
const TABLE = '0f300000-0000-4000-8000-000000000001'
const STAMP = '2026-11-20T10:00:00.000Z'

function seed() {
  return createMemorySupabase({
    apps: [{ id: APP, tenant_id: T, slug: 'claims', name: 'Claims', subtitle: null, description: null, icon: null, color: null, menu: [], settings: {}, created_by: BUILDER, created_at: STAMP, updated_at: STAMP }],
    app_pages: [
      { id: 'p1', tenant_id: T, app_id: APP, slug: 'home', title: 'Home', icon: null, position: 0, layout: { widgets: [{ id: 'hello', type: 'heading', w: 12, h: 2, config: { text: 'Hi' } }, { id: 'mine', type: 'my_submissions', w: 6, h: 6, title: 'Mine', config: { form_id: FORM } }] }, filters: [], created_at: STAMP, updated_at: STAMP },
      { id: 'p2', tenant_id: T, app_id: APP, slug: 'team', title: 'Team', icon: null, position: 1, layout: { widgets: [] }, filters: [{ id: 'team', kind: 'team', label: 'Team', default: 'my_teams' }], created_at: STAMP, updated_at: STAMP },
    ],
    app_audience: [{ id: 'a1', tenant_id: T, app_id: APP, principal_type: 'team', principal_id: TEAM, app_role: 'viewer' }],
    app_editors: [{ id: 'e1', tenant_id: T, app_id: APP, user_id: EDITOR }],
    user_teams: [{ id: 'ut1', user_id: MEMBER, team_id: TEAM, 'team.tenant_id': T }],
    user_roles: [],
    users: [BUILDER, MEMBER, EDITOR].map((id) => ({ id, team_id: null, display_name: id === BUILDER ? 'Bea Builder' : id === EDITOR ? 'Ed Editor' : 'Mo Member', email: `${id.slice(-1)}@example.com` })),
    user_memberships: [BUILDER, MEMBER, EDITOR].map((user_id) => ({ user_id, tenant_id: T, is_active: true })).concat([{ user_id: B_USER, tenant_id: OTHER, is_active: true }]),
    teams: [{ id: TEAM, tenant_id: T, name: 'Finance' }, { id: B_TEAM, tenant_id: OTHER, name: 'Theirs' }],
    roles: [{ id: ROLE, tenant_id: T, name: 'Managers' }],
    forms: [{ id: FORM, tenant_id: T, name: 'Expense claim', created_by: BUILDER, fields: [{ key: 'amount', label: 'Amount', type: 'number', required: true }], layout: { params: [{ name: 'cost_centre', type: 'text', source: 'opener' }] } }, { id: B_FORM, tenant_id: OTHER, name: 'Their form', created_by: B_USER, fields: [], layout: {} }],
    workflows: [{ id: WF, tenant_id: T, name: 'Expense approval', created_by: BUILDER, trigger_type: 'form_submitted', trigger_config: { form_id: FORM }, is_active: true }],
    reports: [{ id: REPORT, tenant_id: T, name: 'Spend', created_by: BUILDER, is_shared: true }, { id: PRIVATE_REPORT, tenant_id: T, name: 'Private', created_by: MEMBER, is_shared: false }],
    integration_references: [{ id: REF, tenant_id: T, name: 'Exchange rates' }],
    custom_tables: [{ id: TABLE, tenant_id: T, name: 'Cost centres', created_by: BUILDER, columns: [{ key: 'code', name: 'Code', type: 'text' }], views: [] }],
    agents: [],
    object_permissions: [],
  }, { uuids: true })
}

type Db = ReturnType<typeof seed>
let db: Db
const ctx = (actorId: string, permissions: string[], via?: 'agent'): ServiceContext => ({
  db: db as any, supabase: db as any, tenantId: T, actorId, permissions: new Set(permissions),
  resourceScopes: { workflow_ids: [], table_ids: [] }, authKind: 'api_key', source: 'api', ...(via ? { via } : {}),
}) as ServiceContext
const VIEWS = ['forms.view', 'forms.submit', 'workflows.view', 'reports.view', 'data.view', 'team.view_members']
const BUILD = ['apps.view', 'apps.manage', ...VIEWS]

beforeEach(() => { db = seed(); publishSeededApps(db); vi.mocked(writeAudit).mockClear() })

const expenseDesk = () => ({
  app: { name: 'Expense desk', subtitle: 'Claims for the finance team', icon: 'Receipt', nav: { style: 'tabs' } },
  pages: [
    { title: 'Home', widgets: [
      { type: 'actions', config: { buttons: [{ label: 'New claim', action: { kind: 'new_submission', form_id: FORM, params: { cost_centre: { from: 'static', value: 'FIN' } } } }] } },
      { type: 'my_submissions', title: 'My claims', config: { form_id: FORM } },
    ] },
    { title: 'Approvals', min_role: 'contributor', filters: [{ id: 'period', kind: 'date_range', label: 'Period', default: { preset: '30d' } }], widgets: [
      { type: 'task_list', title: 'Waiting for my approval', config: { scope: 'queue', workflow_id: WF } },
      { type: 'sla_trend', title: 'SLA over time', config: { workflow_id: WF, date_range: { filter: 'period' } } },
    ], rules: [{ id: 'r1', name: 'Welcome', when: { type: 'page_loaded' }, then: [{ type: 'message', text: 'Hello {{sys.user.name}}' }] }] },
  ],
  audience: [{ type: 'team', id: TEAM, role: 'contributor' }],
})

describe('plan → apply a whole app', () => {
  it('plans with names on the card, then builds the app, its pages, widgets, filters, rules and audience — audited as the caller via the Agent', async () => {
    const plan = await planAppSpec(ctx(BUILDER, BUILD), expenseDesk())
    expect(plan.errors).toEqual([])
    expect(plan.valid).toBe(true)
    expect(plan.summary?.lines).toEqual(expect.arrayContaining(['Shared with: Team Finance (contributor)', 'Page rules: 1']))
    expect(plan.summary?.preview.rows.find((r) => r[1].startsWith('My submissions'))?.[1]).toBe('My submissions “My claims” (Expense claim)')
    // Planning writes nothing.
    expect(db.tables.apps).toHaveLength(1)

    const result = await applyAppSpec(ctx(BUILDER, BUILD, 'agent'), expenseDesk())
    expect(result).toMatchObject({ applied: true, mode: 'create', app: { slug: 'expense-desk', name: 'Expense desk' }, href: '/apps/expense-desk', builder_href: '/apps/expense-desk/home?edit=1' })
    const detail = await apps.getApp(ctx(BUILDER, BUILD), 'expense-desk')
    expect(detail.pages.map((p) => [p.slug, p.title])).toEqual([['home', 'Home'], ['approvals', 'Approvals']])
    expect(detail.nav.style).toBe('tabs')
    expect(detail.audience).toEqual([{ type: 'team', id: TEAM, role: 'contributor' }])
    expect(detail.editors).toEqual([BUILDER])
    const approvals = await apps.getPage(ctx(BUILDER, BUILD), 'expense-desk', 'approvals')
    expect(approvals.layout.widgets.map((w) => w.type)).toEqual(['task_list', 'sla_trend'])
    expect(approvals.layout.options).toEqual({ hidden: false, min_role: 'contributor' })
    expect(approvals.layout.rules?.[0]).toMatchObject({ id: 'r1', name: 'Welcome' })
    expect(approvals.filters[0].id).toBe('period')
    const audits = vi.mocked(writeAudit).mock.calls.map((c) => c[0] as any)
    expect(audits.some((a) => a.summary?.startsWith('Built app "Expense desk" from a spec'))).toBe(true)
    expect(audits.filter((a) => a.metadata?.agent === true || a.via === 'agent').length).toBeGreaterThan(0)
  })

  it('object details and builder search for the Agent', async () => {
    const form = await describeAppObject(ctx(BUILDER, BUILD), { kind: 'form', id: FORM })
    expect(form).toMatchObject({ name: 'Expense claim', fields: [{ key: 'amount', type: 'number', required: true }], params: [{ name: 'cost_centre' }] })
    const wf = await describeAppObject(ctx(BUILDER, BUILD), { kind: 'workflow', id: WF })
    expect(wf).toMatchObject({ trigger_type: 'form_submitted', start_form_id: FORM })
    const found = await searchForBuilder(ctx(BUILDER, BUILD), { kind: 'form', q: 'expense' })
    expect(found.items.map((i) => i.id)).toEqual([FORM])
    await expect(searchForBuilder(ctx(MEMBER, ['apps.view', ...VIEWS]), { kind: 'form' })).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe('governance', () => {
  it('creating needs Build apps; plan says so plainly and apply refuses', async () => {
    const plan = await planAppSpec(ctx(MEMBER, ['apps.view', ...VIEWS]), expenseDesk())
    expect(plan.valid).toBe(false)
    expect(plan.errors[0]).toMatch(/Creating an app needs Build apps/)
    await expect(applyAppSpec(ctx(MEMBER, ['apps.view', ...VIEWS]), expenseDesk())).rejects.toMatchObject({ code: 'forbidden' })
    expect(db.tables.apps).toHaveLength(1)
  })

  it('an app you can only open can\'t be changed; an editor without apps.manage can', async () => {
    const change = { app_id: 'claims', pages: [{ page: 'team', add_widgets: [{ type: 'team_workload', title: 'Load', config: { team: { filter: 'team' } } }] }] }
    expect((await planAppSpec(ctx(MEMBER, ['apps.view', ...VIEWS]), change)).errors[0]).toMatch(/can open “Claims” but not edit it/)
    await expect(applyAppSpec(ctx(MEMBER, ['apps.view', ...VIEWS]), change)).rejects.toMatchObject({ code: 'forbidden' })
    const r = await applyAppSpec(ctx(EDITOR, ['apps.view', ...VIEWS]), change)
    expect(r.mode).toBe('edit')
  })

  it('objects that don\'t exist, of another workspace, or a private report of someone else are refused', async () => {
    const spec = { app: { name: 'Bad' }, pages: [{ title: 'Home', widgets: [
      { type: 'my_submissions', title: 'Theirs', config: { form_id: B_FORM } },
      { type: 'table_view', title: 'Private', config: { kind: 'report', report_id: PRIVATE_REPORT } },
      { type: 'run_status', title: 'Runs', config: { workflow_id: '0f000000-0000-4000-8000-0000000000ff' } },
    ] }] }
    const plan = await planAppSpec(ctx(BUILDER, BUILD), spec)
    expect(plan.valid).toBe(false)
    expect(plan.errors).toEqual(expect.arrayContaining([
      expect.stringMatching(new RegExp(`the form ${B_FORM} does not exist in this workspace — pick one with apps_search \\(kind form\\)`)),
      expect.stringMatching(/the report .* is a private report of someone else/),
      expect.stringMatching(/the workflow .* does not exist in this workspace/),
    ]))
    await expect(applyAppSpec(ctx(BUILDER, BUILD), spec)).rejects.toMatchObject({ code: 'validation_error' })
    expect(db.tables.apps).toHaveLength(1)
  })

  it('binding objects you can\'t see (no View workflows) is refused', async () => {
    const spec = { app: { name: 'Runs' }, pages: [{ title: 'Home', widgets: [{ type: 'run_status', title: 'Runs', config: { workflow_id: WF } }] }] }
    const plan = await planAppSpec(ctx(BUILDER, ['apps.view', 'apps.manage', 'forms.view']), spec)
    expect(plan.errors[0]).toMatch(/you can't see workflows \(View workflows\)/)
  })

  it('API references: binding needs View integrations, letting viewers see the data needs Manage references', async () => {
    const card = (allow: boolean) => ({ app: { name: 'Rates' }, pages: [{ title: 'Home', widgets: [{ type: 'card_view', title: 'Rates', config: { source: 'reference', reference_id: REF, allow_viewers: allow, template: { title: 'code' } } }] }] })
    expect((await planAppSpec(ctx(BUILDER, BUILD), card(false))).errors[0]).toMatch(/binding an API reference needs View integrations/)
    expect((await planAppSpec(ctx(BUILDER, [...BUILD, 'integrations.view']), card(false))).valid).toBe(true)
    expect((await planAppSpec(ctx(BUILDER, [...BUILD, 'integrations.view']), card(true))).errors[0]).toMatch(/allow_viewers\) needs Manage references/)
    expect((await planAppSpec(ctx(BUILDER, [...BUILD, 'integrations.view', 'integrations.manage_references']), card(true))).valid).toBe(true)
  })

  it('a "Start a workflow" rule needs Start workflows; people and teams must be of this workspace', async () => {
    const spec = { app: { name: 'Go' }, pages: [{ title: 'Home', widgets: [{ type: 'heading', config: { text: 'Hi' } }], rules: [{ id: 'go', when: { type: 'page_loaded' }, then: [{ type: 'start_workflow', workflow_id: WF }] }] }] }
    expect((await planAppSpec(ctx(BUILDER, BUILD), spec)).errors[0]).toMatch(/"Start a workflow" needs Start workflows/)
    expect((await planAppSpec(ctx(BUILDER, [...BUILD, 'workflows.activate']), spec)).valid).toBe(true)
    const people = { app: { name: 'P' }, pages: [{ title: 'Home', widgets: [{ type: 'task_list', title: 'T', config: { assignee: B_USER, team: B_TEAM } }] }], audience: [{ type: 'role', id: '0c000000-0000-4000-8000-0000000000ff', role: 'viewer' }] }
    const errors = (await planAppSpec(ctx(BUILDER, BUILD), people)).errors
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringMatching(new RegExp(`no person with id ${B_USER} in this workspace`)),
      expect.stringMatching(new RegExp(`no team with id ${B_TEAM} in this workspace`)),
      expect.stringMatching(/no role with id .* in this workspace/),
    ]))
  })

  it('references already in the app pass for an editor who could not add them now', async () => {
    // The page already shows the form; an editor without forms permissions can still change other widgets.
    const r = await planAppSpec(ctx(EDITOR, ['apps.view']), { app_id: APP, pages: [{ page: 'home', update_widgets: [{ id: 'hello', config: { text: 'Welcome' } }] }] })
    expect(r.errors).toEqual([])
  })
})

describe('incremental edits', () => {
  it('"add a chart of overdue tasks to the Team page" changes only that page; the rest is kept', async () => {
    const r = await applyAppSpec(ctx(BUILDER, BUILD), { app_id: 'claims', pages: [{ page: 'team', add_widgets: [{ type: 'chart', title: 'Overdue tasks by person', config: { source: 'tasks', group_by: 'assignee', status: 'open', team: { filter: 'team' } } }] }] })
    expect(r.pages).toEqual([{ slug: 'team', title: 'Team', widgets: 1, created: false }])
    const team = await apps.getPage(ctx(BUILDER, BUILD), APP, 'team')
    expect(team.layout.widgets[0]).toMatchObject({ type: 'chart', title: 'Overdue tasks by person', w: 6, h: 7 })
    expect((await apps.getPage(ctx(BUILDER, BUILD), APP, 'home')).layout.widgets.map((w) => w.id)).toEqual(['hello', 'mine'])
    expect((await apps.getApp(ctx(BUILDER, BUILD), APP)).audience).toEqual([{ type: 'team', id: TEAM, role: 'viewer' }])
  })
})

describe('a failing step leaves nothing behind', () => {
  it('a new app is deleted again when a later page fails', async () => {
    let n = 0
    const failing = { createPage: (async (...args: Parameters<typeof apps.createPage>) => { if (++n === 1) throw new Error('disk full'); return apps.createPage(...args) }) as typeof apps.createPage }
    await expect(applyAppSpec(ctx(BUILDER, BUILD), expenseDesk(), failing)).rejects.toThrow(/^Nothing was created: disk full/)
    expect(db.tables.apps.map((a: any) => a.slug)).toEqual(['claims'])
    // (The database deletes the app's pages with it.)
  })

  it('an edit is undone: settings, changed layouts, added and deleted pages come back', async () => {
    const before = { app: await apps.getApp(ctx(BUILDER, BUILD), APP), pages: await apps.listPages(ctx(BUILDER, BUILD), APP) }
    const failing = { reorderPages: (async () => { throw new Error('timeout') }) as typeof apps.reorderPages }
    const spec = {
      app_id: APP, app: { name: 'Claims desk', subtitle: 'New' },
      pages: [{ page: 'home', remove_widgets: ['hello'] }, { title: 'Insights', widgets: [{ type: 'throughput', title: 'Throughput' }] }],
      delete_pages: ['team'], page_order: ['insights', 'home'],
    }
    await expect(applyAppSpec(ctx(BUILDER, BUILD), spec, failing)).rejects.toThrow(/^Nothing was changed: timeout/)
    const after = { app: await apps.getApp(ctx(BUILDER, BUILD), APP), pages: await apps.listPages(ctx(BUILDER, BUILD), APP) }
    expect(after.app.name).toBe('Claims')
    expect(after.app.subtitle).toBeNull()
    expect(after.pages.map((p) => [p.slug, p.title, p.layout.widgets.map((w) => w.id)])).toEqual(before.pages.map((p) => [p.slug, p.title, p.layout.widgets.map((w) => w.id)]))
    expect(after.pages.find((p) => p.slug === 'team')?.filters).toEqual(before.pages.find((p) => p.slug === 'team')?.filters)
  })
})

describe('REST', () => {
  const asKey = (permissions: string[]) => vi.mocked(validateApiKey).mockResolvedValue({ success: true, keyId: 'k1', tenantId: T, supabase: db, permissions, keyType: 'user', userId: BUILDER, scopes: { workflow_ids: [], table_ids: [] } } as any)
  const post = (path: string, body: unknown) => new NextRequest(`https://x.test/api/v1/apps/spec/${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

  it('POST /apps/spec/plan answers 200 with the errors; /apply builds', async () => {
    asKey(BUILD)
    const bad = await planRoute(post('plan', { app: { name: 'X' }, pages: [{ title: 'A', widgets: [{ type: 'nope' }] }] }))
    expect(bad.status).toBe(200)
    const body = (await bad.json()).data
    expect(body.valid).toBe(false)
    expect(body.errors[0]).toMatch(/unknown widget type "nope"/)
    const ok = await applyRoute(post('apply', expenseDesk()))
    expect(ok.status).toBe(200)
    expect((await ok.json()).data.app.slug).toBe('expense-desk')
  })

  it('apply with problems is a 400 listing them', async () => {
    asKey(BUILD)
    const res = await applyRoute(post('apply', { app: { name: 'X' }, pages: [{ title: 'A', widgets: [{ type: 'nope' }] }] }))
    expect(res.status).toBe(400)
    expect(JSON.stringify(await res.json())).toMatch(/unknown widget type/)
  })
})
