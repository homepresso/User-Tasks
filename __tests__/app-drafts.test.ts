/**
 * App drafts and publishing (lib/services/app-versions.ts, lib/services/apps.ts
 * resolveContent, migration 20270123090000_app_drafts.sql) over the
 * in-memory store:
 *
 *  - the audience never sees draft changes: app header, menu, pages,
 *    widgets, rules, server rule actions, widget lookups, the Apps menu;
 *  - editors see the draft in the builder / API and in Preview (also as a
 *    viewer / contributor), the published version when using the app;
 *  - an app never published does not exist for its audience;
 *  - publish snapshots the draft as the next version (refused when nothing
 *    changed or the draft has problems), discard goes back, restore copies a
 *    version into the draft, compare explains the difference;
 *  - permissions (editors / apps.manage only) and audit;
 *  - the Agent's spec apply writes the draft (publish: true publishes);
 *  - packages export the published version (or the draft on request);
 *    installs publish, upgrades of an app with unpublished changes stay in
 *    the draft;
 *  - before the migration (no app_versions) every save is live.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/github-sync/enqueue', () => ({ recordAssetChange: vi.fn(async () => {}) }))

import { writeAudit } from '@/lib/audit-log'
import type { ServiceContext } from '@/lib/services/context'
import * as apps from '@/lib/services/apps'
import * as versions from '@/lib/services/app-versions'
import { applyAppSpec, planAppSpec } from '@/lib/services/app-spec'
import { publishImportedApps } from '@/lib/services/app-packages'
import { exportApps } from '@/lib/portability/apps'
import { resetAppDrafts, setAppDraftsAvailable } from '@/lib/services/app-published'
import { buildAppSnapshot, diffAppSnapshots, previewArgsOf, readSnapshot } from '@/lib/apps/versions'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createMemorySupabase } from './fixtures/supabase-memory'
import { publishSeededApps } from './fixtures/app-drafts'

const T = 'tenant-a'
const BUILDER = '0a000000-0000-4000-8000-000000000001'
const MEMBER = '0a000000-0000-4000-8000-000000000002'
const OUTSIDER = '0a000000-0000-4000-8000-000000000003'
const EDITOR = '0a000000-0000-4000-8000-000000000004'
const CONTRIB = '0a000000-0000-4000-8000-000000000005'
const TEAM = '0b000000-0000-4000-8000-000000000001'
const APP = '0d000000-0000-4000-8000-000000000001'
const P_HOME = '0e000000-0000-4000-8000-0000000000a1'
const P_ADMIN = '0e000000-0000-4000-8000-0000000000a2'
const STAMP = '2026-11-20T10:00:00.000Z'

const heading = (id: string, text: string) => ({ id, type: 'heading', w: 12, h: 2, config: { text } })
const rule = (id: string) => ({ id, when: { type: 'page_loaded' }, then: [{ type: 'message', text: `rule ${id}` }] })

function seed() {
  return createMemorySupabase({
    apps: [{ id: APP, tenant_id: T, slug: 'claims', name: 'Claims', subtitle: 'Desk', description: null, icon: 'Receipt', color: null, menu: [], settings: { rules: [rule('app_rule')] }, created_by: BUILDER, created_at: STAMP, updated_at: STAMP }],
    app_pages: [
      { id: P_HOME, tenant_id: T, app_id: APP, slug: 'home', title: 'Home', icon: null, position: 0, layout: { widgets: [heading('h1', 'Published hello')], rules: [rule('page_rule')] }, filters: [], created_at: STAMP, updated_at: STAMP },
      { id: P_ADMIN, tenant_id: T, app_id: APP, slug: 'admin', title: 'Admin', icon: null, position: 1, layout: { widgets: [], options: { hidden: false, min_role: 'contributor' } }, filters: [], created_at: STAMP, updated_at: STAMP },
    ],
    app_audience: [
      { id: 'a1', tenant_id: T, app_id: APP, principal_type: 'team', principal_id: TEAM, app_role: 'viewer' },
      { id: 'a2', tenant_id: T, app_id: APP, principal_type: 'user', principal_id: CONTRIB, app_role: 'contributor' },
    ],
    app_editors: [{ id: 'e1', tenant_id: T, app_id: APP, user_id: EDITOR }],
    user_teams: [{ id: 'ut1', user_id: MEMBER, team_id: TEAM, 'team.tenant_id': T }],
    user_roles: [],
    users: [BUILDER, MEMBER, OUTSIDER, EDITOR, CONTRIB].map((id) => ({ id, team_id: null, display_name: `User ${id.slice(-1)}`, email: `${id.slice(-1)}@example.com` })),
    user_memberships: [BUILDER, MEMBER, OUTSIDER, EDITOR, CONTRIB].map((user_id) => ({ user_id, tenant_id: T, is_active: true })),
    teams: [{ id: TEAM, tenant_id: T, name: 'Claims team' }],
    roles: [], forms: [], workflows: [], reports: [], custom_tables: [], agents: [], integration_references: [], object_permissions: [], tenants: [{ id: T, settings: {} }],
  }, { uuids: true })
}

type Db = ReturnType<typeof seed>
let db: Db
const ctx = (actorId: string, permissions: string[]): ServiceContext => ({
  db: db as any, supabase: db as any, tenantId: T, actorId, permissions: new Set(permissions),
  resourceScopes: { workflow_ids: [], table_ids: [] }, authKind: 'api_key', source: 'api',
}) as ServiceContext
const VIEW = ['apps.view']
const MANAGE = ['apps.view', 'apps.manage']
const member = () => ctx(MEMBER, VIEW)
const editor = () => ctx(EDITOR, VIEW)

beforeEach(() => {
  db = seed()
  publishSeededApps(db)
  vi.mocked(writeAudit).mockClear()
})

/** The editor changes the draft: header, menu, a page's widgets and rules, app rules, a new page. */
async function editDraft() {
  await apps.updateApp(editor(), APP, { name: 'Claims (draft)', rules: [rule('app_rule'), rule('draft_app_rule')] as any })
  await apps.updatePage(editor(), APP, 'home', { layout: { widgets: [heading('h1', 'Draft hello'), heading('h2', 'Only in the draft')], rules: [rule('page_rule'), rule('draft_page_rule')] } as any })
  await apps.createPage(editor(), APP, { title: 'Draft page' })
}

describe('the audience sees only the published version', () => {
  it('existing apps start published (version 1) with no unpublished changes', async () => {
    const app = await apps.getApp(editor(), APP)
    expect(app.content).toBe('draft')
    expect(app.publish_state).toMatchObject({ published_version: 1, has_draft_changes: false })
    expect((await apps.getApp(member(), APP)).content).toBe('published')
  })

  it('draft changes are invisible to viewers: header, pages, widgets, rules, the Apps menu', async () => {
    await editDraft()
    const viewer = member()
    const app = await apps.getApp(viewer, APP)
    expect(app.name).toBe('Claims')
    expect(app.version).toBe(1)
    expect(app.publish_state).toBeNull()
    expect(app.pages.map((p) => p.slug)).toEqual(['home'])
    expect(app.rules.map((r) => r.id)).toEqual(['app_rule'])
    const page = await apps.getPage(viewer, APP, 'home')
    expect(page.layout.widgets.map((w) => (w.config as any).text)).toEqual(['Published hello'])
    expect((page.layout.rules ?? []).map((r) => r.id)).toEqual(['page_rule'])
    expect((await apps.listPages(viewer, APP)).map((p) => p.slug)).toEqual(['home'])
    await expect(apps.getPage(viewer, APP, 'draft-page')).rejects.toMatchObject({ code: 'not_found' })
    const view = await apps.getAppPageView(viewer, 'claims', null, 'view')
    expect(view.page?.layout.widgets).toHaveLength(1)
    const [card] = await apps.listApps(viewer)
    expect(card).toMatchObject({ name: 'Claims', published: true, has_draft_changes: null })
    // Widget lookups (widget data, Kanban / grid writes) use the published page.
    await expect(apps.getPresentedPage(viewer, APP, 'home').then((p) => p.layout.widgets.find((w) => w.id === 'h2'))).resolves.toBeUndefined()
    // Asking for the draft is refused.
    await expect(apps.getApp(viewer, APP, { version: 'draft' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(apps.getPresentedPage(viewer, APP, 'home', { draft: true })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(apps.getAppPageView(viewer, 'claims', null, 'preview')).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('server rule actions load the PUBLISHED rule for viewers; editors previewing run the draft’s', async () => {
    await editDraft()
    await expect(apps.loadRuleForAction(member(), APP, 'home', 'draft_page_rule')).rejects.toMatchObject({ code: 'not_found' })
    await expect(apps.loadRuleForAction(member(), APP, null, 'draft_app_rule')).rejects.toMatchObject({ code: 'not_found' })
    await expect(apps.loadRuleForAction(member(), APP, 'home', 'page_rule')).resolves.toMatchObject({ rule: { id: 'page_rule' }, role: 'viewer' })
    // Editors using the app also get the published rule; with preview, the draft's.
    await expect(apps.loadRuleForAction(editor(), APP, 'home', 'draft_page_rule')).rejects.toMatchObject({ code: 'not_found' })
    await expect(apps.loadRuleForAction(editor(), APP, 'home', 'draft_page_rule', { draft: true })).resolves.toMatchObject({ rule: { id: 'draft_page_rule' } })
    await expect(apps.loadRuleForAction(member(), APP, 'home', 'draft_page_rule', { draft: true })).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('editors: draft in the builder and API, published when using the app, draft in Preview', async () => {
    await editDraft()
    expect((await apps.getApp(editor(), APP)).name).toBe('Claims (draft)')
    expect((await apps.getApp(editor(), APP, { version: 'published' })).name).toBe('Claims')
    expect((await apps.getAppPageView(editor(), 'claims', 'home', 'edit')).page?.layout.widgets).toHaveLength(2)
    expect((await apps.getAppPageView(editor(), 'claims', 'home', 'view')).page?.layout.widgets).toHaveLength(1)
    const preview = await apps.getAppPageView(editor(), 'claims', 'home', 'preview')
    expect(preview.app.content).toBe('draft')
    expect(preview.page?.layout.widgets).toHaveLength(2)
    expect(previewArgsOf(preview.app)).toEqual({ draft: true })
    // Apps I design shows the draft name; the Apps menu the published one.
    expect((await apps.listApps(editor(), { editable: true }))[0]).toMatchObject({ name: 'Claims (draft)', has_draft_changes: true })
    expect((await apps.listApps(editor()))[0]).toMatchObject({ name: 'Claims', has_draft_changes: true })
  })

  it('Preview as a viewer hides what a viewer can’t open (contributor-only pages)', async () => {
    const asEditor = await apps.getAppPageView(editor(), 'claims', null, 'preview')
    expect(asEditor.app.pages.map((p) => p.slug)).toEqual(['home', 'admin'])
    const asViewer = await apps.getAppPageView(editor(), 'claims', null, 'preview', { as_role: 'viewer' })
    expect(asViewer.app.app_role).toBe('viewer')
    expect(asViewer.app.pages.map((p) => p.slug)).toEqual(['home'])
    expect(previewArgsOf(asViewer.app)).toEqual({ draft: true, as_role: 'viewer' })
    await expect(apps.getAppPageView(editor(), 'claims', 'admin', 'preview', { as_role: 'viewer' })).rejects.toMatchObject({ code: 'not_found' })
    const asContrib = await apps.getAppPageView(editor(), 'claims', 'admin', 'preview', { as_role: 'contributor' })
    expect(asContrib.page?.slug).toBe('admin')
  })

  it('an app never published does not exist for its audience; its editors see it as Unpublished', async () => {
    const created = await apps.createApp(ctx(BUILDER, MANAGE), { name: 'Fresh', audience: [{ type: 'team', id: TEAM }] })
    expect(created.publish_state).toMatchObject({ published_version: null, has_draft_changes: true })
    expect((await apps.listApps(member())).map((a) => a.slug)).toEqual(['claims'])
    await expect(apps.getApp(member(), created.id)).rejects.toMatchObject({ code: 'not_found' })
    expect(await apps.getAppAccess(member(), created.id)).toBeNull()
    const mine = (await apps.listApps(ctx(BUILDER, MANAGE))).find((a) => a.id === created.id)
    expect(mine).toMatchObject({ published: false, published_version: null, has_draft_changes: true })
    // Using it, its editors get the draft (there is no published version yet).
    expect((await apps.getAppPageView(ctx(BUILDER, MANAGE), created.slug, null, 'view')).app.content).toBe('draft')
    await versions.publishApp(ctx(BUILDER, MANAGE), created.id)
    expect((await apps.listApps(member())).map((a) => a.slug).sort()).toEqual(['claims', 'fresh'])
  })
})

describe('publish, discard, restore, compare', () => {
  it('publish snapshots the draft as the next version; viewers switch; nothing-to-publish is refused', async () => {
    await editDraft()
    const result = await versions.publishApp(editor(), APP, { note: 'New page and widgets' })
    expect(result).toMatchObject({ version: 2, previous_version: 1, note: 'New page and widgets' })
    expect(result.diff?.lines.join('\n')).toMatch(/Added 1 page/)
    const app = db.tables.apps.find((a: any) => a.id === APP)
    expect(app).toMatchObject({ published_version: 2, has_draft_changes: false })
    expect(db.tables.app_versions.filter((v: any) => v.app_id === APP).map((v: any) => v.version)).toEqual([1, 2])
    const viewerApp = await apps.getApp(member(), APP)
    expect(viewerApp).toMatchObject({ name: 'Claims (draft)', version: 2 })
    expect((await apps.getPage(member(), APP, 'home')).layout.widgets).toHaveLength(2)
    await expect(versions.publishApp(editor(), APP)).rejects.toMatchObject({ code: 'conflict' })
    expect(vi.mocked(writeAudit).mock.calls.some(([a]: any) => a.action === 'publish' && a.objectId === APP && a.metadata?.version === 2)).toBe(true)
  })

  it('a draft with problems can’t be published', async () => {
    db.tables.app_pages = db.tables.app_pages.filter((p: any) => p.app_id !== APP)
    await expect(versions.publishApp(editor(), APP)).rejects.toMatchObject({ code: 'validation_error' })
  })

  it('discard writes the published version back into the draft', async () => {
    await editDraft()
    const out = await versions.discardAppDraft(editor(), APP)
    expect(out).toMatchObject({ discarded: true, version: 1 })
    const draft = await apps.getApp(editor(), APP)
    expect(draft.name).toBe('Claims')
    expect(draft.publish_state?.has_draft_changes).toBe(false)
    expect((await apps.listPages(editor(), APP)).map((p) => p.slug)).toEqual(['home', 'admin'])
    expect((await apps.getPage(editor(), APP, 'home')).layout.widgets.map((w) => w.id)).toEqual(['h1'])
    expect(vi.mocked(writeAudit).mock.calls.some(([a]: any) => a.action === 'discard_draft')).toBe(true)
  })

  it('restore copies a version into the draft; the audience keeps the published one', async () => {
    await editDraft()
    await versions.publishApp(editor(), APP)
    const restored = await versions.restoreAppVersion(editor(), APP, 1)
    expect(restored.restored_version).toBe(1)
    expect(restored.diff?.lines.join('\n')).toMatch(/Removed 1 page/)
    expect((await apps.getApp(editor(), APP)).name).toBe('Claims')
    expect((await apps.getApp(editor(), APP)).publish_state?.has_draft_changes).toBe(true)
    expect((await apps.getApp(member(), APP)).name).toBe('Claims (draft)')
    // Page ids survive a round trip (a page deleted in the draft comes back with its id).
    expect((await apps.listPages(editor(), APP)).map((p) => p.id)).toEqual([P_HOME, P_ADMIN])
    expect(vi.mocked(writeAudit).mock.calls.some(([a]: any) => a.action === 'restore')).toBe(true)
    await versions.publishApp(editor(), APP)
    expect((await versions.listAppVersions(editor(), APP)).versions.map((v) => [v.version, v.current])).toEqual([[3, true], [2, false], [1, false]])
  })

  it('compare: draft vs published by default, any two versions on request', async () => {
    await editDraft()
    const cmp = await versions.compareAppVersions(editor(), APP)
    expect(cmp.from).toMatchObject({ side: 'published', version: 1 })
    expect(cmp.to).toMatchObject({ side: 'draft', version: null })
    expect(cmp.diff.app.changed).toEqual(['name'])
    expect(cmp.diff.pages.added.map((p) => p.title)).toEqual(['Draft page'])
    expect(cmp.diff.pages.changed[0]).toMatchObject({ slug: 'home', widgets: { added: ['heading h2'], changed: ['heading h1'] }, rules: { added: ['draft_page_rule'] } })
    expect(cmp.diff.rules.added).toEqual(['draft_app_rule'])
    expect(cmp.diff.lines).toEqual(expect.arrayContaining([expect.stringMatching(/App name changed/), 'Added 1 page: “Draft page”', expect.stringMatching(/^Page “Home”: 1 widget added/), expect.stringMatching(/App rules: 1 added/)]))
    await versions.publishApp(editor(), APP)
    const between = await versions.compareAppVersions(editor(), APP, { from: 1, to: 2 })
    expect(between.diff.pages.added).toHaveLength(1)
    expect((await versions.compareAppVersions(editor(), APP, { from: 2, to: 'draft' })).diff.unchanged).toBe(true)
  })

  it('only editors (or apps.manage) publish, discard, restore and read versions', async () => {
    await editDraft()
    for (const call of [
      () => versions.publishApp(member(), APP), () => versions.discardAppDraft(member(), APP), () => versions.restoreAppVersion(member(), APP, 1),
      () => versions.listAppVersions(member(), APP), () => versions.compareAppVersions(member(), APP), () => versions.getAppVersion(member(), APP, 1),
    ]) await expect(call()).rejects.toMatchObject({ code: 'forbidden' })
    await expect(versions.publishApp(ctx(OUTSIDER, VIEW), APP)).rejects.toMatchObject({ code: 'not_found' })
    await expect(versions.publishApp(ctx(BUILDER, MANAGE), APP)).resolves.toMatchObject({ version: 2 })
  })
})

describe('the Agent and app specs write the draft', () => {
  const change = { app_id: 'claims', pages: [{ page: 'home', add_widgets: [{ type: 'heading', id: 'agent_h', config: { text: 'From the Agent' } }] }] }

  it('apply saves to the draft: the audience keeps the published page', async () => {
    const plan = await planAppSpec(ctx(EDITOR, VIEW), change)
    expect(plan.save_as).toBe('draft')
    expect(plan.summary?.lines.join('\n')).toMatch(/Saved as a draft/)
    const result = await applyAppSpec(ctx(EDITOR, VIEW), change)
    expect(result).toMatchObject({ saved_as: 'draft', version: null, preview_href: '/apps/claims/home?preview=1' })
    expect((await apps.getPage(member(), APP, 'home')).layout.widgets.map((w) => w.id)).toEqual(['h1'])
    expect((await apps.getPage(editor(), APP, 'home')).layout.widgets.map((w) => w.id)).toContain('agent_h')
  })

  it('publish: true publishes right after applying (with the note)', async () => {
    const plan = await planAppSpec(ctx(EDITOR, VIEW), { ...change, publish: true })
    expect(plan.save_as).toBe('publish')
    const result = await applyAppSpec(ctx(EDITOR, VIEW), { ...change, publish: true, publish_note: 'Agent heading' })
    expect(result).toMatchObject({ saved_as: 'published', version: 2 })
    expect((await apps.getPage(member(), APP, 'home')).layout.widgets.map((w) => w.id)).toContain('agent_h')
    expect(db.tables.app_versions.find((v: any) => v.version === 2)?.note).toBe('Agent heading')
  })

  it('a new app built from a spec starts unpublished', async () => {
    const result = await applyAppSpec(ctx(BUILDER, MANAGE), { app: { name: 'Spec app' }, pages: [{ title: 'Home', widgets: [{ type: 'heading', config: { text: 'Hi' } }] }], audience: [{ type: 'team', id: TEAM }] })
    expect(result.saved_as).toBe('draft')
    await expect(apps.getApp(member(), result.app.id)).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('packages and config-as-code', () => {
  it('export carries the published version by default, the draft on request', async () => {
    await editDraft()
    const [published] = await exportApps(db, T, [APP])
    expect(published.name).toBe('Claims')
    expect(published.pages.map((p: any) => p.slug)).toEqual(['home', 'admin'])
    const [draft] = await exportApps(db, T, [APP], { content: 'draft' })
    expect(draft.name).toBe('Claims (draft)')
    expect(draft.pages.map((p: any) => p.slug)).toContain('draft-page')
  })

  it('an install publishes; an upgrade of an app with unpublished changes stays in its draft', async () => {
    const fresh = await apps.createApp(ctx(BUILDER, MANAGE), { name: 'Installed' })
    expect(await publishImportedApps(ctx(BUILDER, MANAGE), [{ id: fresh.id, created: true }])).toEqual([])
    expect(db.tables.apps.find((a: any) => a.id === fresh.id)).toMatchObject({ published_version: 1, has_draft_changes: false })
    expect(db.tables.app_versions.find((v: any) => v.app_id === fresh.id)).toMatchObject({ source: 'import' })
    await editDraft()
    const warnings = await publishImportedApps(ctx(BUILDER, MANAGE), [{ id: APP, created: false, had_unpublished_changes: true }])
    expect(warnings[0]?.warning).toMatch(/unpublished changes/)
    expect(db.tables.apps.find((a: any) => a.id === APP)).toMatchObject({ published_version: 1, has_draft_changes: true })
    // Without unpublished changes the upgrade goes live.
    await publishImportedApps(ctx(BUILDER, MANAGE), [{ id: APP, created: false, had_unpublished_changes: false }])
    expect(db.tables.apps.find((a: any) => a.id === APP)?.published_version).toBe(2)
  })
})

describe('before the migration: no drafts', () => {
  it('every save is live and the draft endpoints answer 409', async () => {
    resetAppDrafts()
    setAppDraftsAvailable(false)
    try {
      for (const a of db.tables.apps) for (const k of ['published_version', 'published_at', 'published_by', 'has_draft_changes', 'draft_updated_at', 'draft_updated_by']) delete a[k]
      await apps.updateApp(editor(), APP, { name: 'Live rename' })
      expect((await apps.getApp(member(), APP))).toMatchObject({ name: 'Live rename', content: 'live', publish_state: null })
      expect((await apps.listApps(member()))[0]).toMatchObject({ published: true, has_draft_changes: null })
      await expect(versions.publishApp(editor(), APP)).rejects.toMatchObject({ code: 'conflict' })
      expect(db.tables.apps[0].has_draft_changes).toBeUndefined()
    } finally {
      resetAppDrafts()
    }
  })
})

describe('the snapshot model', () => {
  it('the migration’s SQL backfill builds the same snapshot keys as buildAppSnapshot', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20270123090000_app_drafts.sql'), 'utf8')
    const snap = buildAppSnapshot({ name: 'A', settings: { access_issues: 2, package: {}, rules: [] } }, [{ id: 'p', slug: 's', title: 'T', position: 0 }])
    for (const key of Object.keys(snap.app)) expect(sql).toContain(`'${key}'`)
    for (const key of Object.keys(snap.pages[0])) expect(sql).toContain(`'${key}'`)
    expect(snap.app.settings).toEqual({ rules: [] })
    expect(sql).toMatch(/- 'access_issues' - 'access_checked_at' - 'package'/)
  })

  it('diff of identical snapshots is unchanged; readSnapshot never throws', () => {
    const s = buildAppSnapshot({ name: 'A' }, [{ id: 'p', slug: 's', title: 'T', layout: { widgets: [heading('x', 'y')] } }])
    expect(diffAppSnapshots(s, readSnapshot(JSON.parse(JSON.stringify(s)))).unchanged).toBe(true)
    expect(readSnapshot(null)).toMatchObject({ app: { name: 'App' }, pages: [] })
  })
})
