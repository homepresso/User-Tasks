/**
 * Apps as a package asset (lib/portability/apps.ts export, lib/services/app-packages.ts
 * install / upgrade) against an in-memory database holding two workspaces:
 * round trip with remapped ids, icons re-sanitised, audience never carried,
 * upgrade keeps the audience / editors / local pages, credentials never in a
 * package, dependency discovery (included / excluded), plans, and stable
 * GitHub-sync serialisation.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemorySupabase } from './fixtures/supabase-memory'

/* eslint-disable @typescript-eslint/no-explicit-any -- fixture rows and manifests */

const files = new Map<string, Uint8Array>()
let mem: ReturnType<typeof createMemorySupabase>
vi.mock('@/lib/services/_shared', async (orig) => ({
  ...(await orig() as object),
  serviceRoleClient: async () => mem,
  audit: vi.fn(async () => {}),
  syncChange: vi.fn(async () => {}),
}))
vi.mock('@/lib/services/apps', async (orig) => ({ ...(await orig() as object), refreshAppAccessIssues: vi.fn(async () => {}) }))
vi.mock('@/lib/providers/storage', () => ({
  getStorageProvider: async () => ({
    id: 'supabase',
    put: async (bucket: string, path: string, bytes: Uint8Array) => { files.set(`${bucket}/${path}`, bytes) },
    get: async (bucket: string, path: string) => (files.has(`${bucket}/${path}`) ? { body: new Blob([files.get(`${bucket}/${path}`)! as BlobPart]).stream(), contentType: 'image/svg+xml' } : null),
    publicUrl: (bucket: string, path: string) => `https://files.example/${bucket}/${path}`,
  }),
}))

const { exportApps, comparableAppAsset, isRetiredAppAsset, remapAppAsset } = await import('@/lib/portability/apps')
const { applyAppManifest } = await import('@/lib/services/app-packages')
const { buildManifestExport } = await import('@/lib/portability/export')
const { resolveDependencyClosure, scanAssetReferences } = await import('@/lib/portability/dependencies')
const { createEmptyAssetIdMaps } = await import('@/lib/portability/id-maps')
const { planManifest } = await import('@/lib/portability/plan')
const { scrubSecretsForExport } = await import('@/lib/portability/scrub')
const { findSecretLeaks, toPackageFiles, PACKAGE_SECTIONS } = await import('@/lib/packages/build')
const { planManifestFiles, SECTION_TO_DIR } = await import('@/lib/github-sync/layout')
const { PLAN_SECTIONS } = await import('@/lib/portability/plan')

const id = (n: number) => `0a9e0000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const A = id(0xa0), B = id(0xb0)
const APP = id(1), PAGE_HOME = id(2), PAGE_DETAIL = id(3)
const FORM = id(10), WORKFLOW = id(11), TABLE = id(12), REPORT = id(13), INTEGRATION = id(14), REFERENCE = id(15), OTHER_APP = id(16)
const TEAM_A = id(20), USER_A = id(21), INSTALLER = id(30), ICON = id(40), BAD_ICON = id(41)
const FORM_B = id(110), WORKFLOW_B = id(111), TABLE_B = id(112), REPORT_B = id(113), REFERENCE_B = id(115)

const DIRTY_SVG = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" onload="alert(1)"><script>alert(2)</script><path d="M0 0h24v24H0z" fill="url(https://evil.example/x)"/></svg>'

function seed() {
  files.clear()
  files.set(`task-files/app-icons/${A}/${ICON}.svg`, new TextEncoder().encode(DIRTY_SVG))
  files.set(`task-files/app-icons/${A}/${BAD_ICON}.svg`, new TextEncoder().encode('<html>not an svg</html>'))
  mem = createMemorySupabase({
    tenants: [
      { id: A, settings: { apps: { icons: [{ id: ICON, token: `svg:${ICON}`, name: 'Rocket', tint: true }, { id: BAD_ICON, token: `svg:${BAD_ICON}`, name: 'Broken', tint: false }] } } },
      { id: B, settings: {} },
    ],
    apps: [
      {
        id: APP, tenant_id: A, slug: 'ops-hub', name: 'Ops hub', subtitle: 'Daily work', description: 'Requests and approvals', icon: `svg:${ICON}`, color: '#2563eb',
        menu: [
          { kind: 'form', label: 'New request', form_id: FORM, open: 'modal', icon: `svg:${BAD_ICON}` },
          { kind: 'url', label: 'Other app', url: '/apps/other-app' },
          { kind: 'report', label: 'Report', report_id: REPORT, visibility: { app_roles: [], teams: [TEAM_A], roles: [] } },
        ],
        settings: { nav: { style: 'sidebar' }, access_issues: 3, access_checked_at: '2026-11-01T00:00:00Z' },
      },
      { id: OTHER_APP, tenant_id: A, slug: 'other-app', name: 'Other app', menu: [], settings: {} },
      { id: id(99), tenant_id: B, slug: 'ops-hub', name: 'Existing app in B', menu: [], settings: {} },
    ],
    app_pages: [
      {
        id: PAGE_HOME, tenant_id: A, app_id: APP, slug: 'home', title: 'Home', icon: null, position: 0,
        filters: [{ id: 'wf', kind: 'workflow', label: 'Workflow', default: WORKFLOW }, { id: 'who', kind: 'user', label: 'Who', default: USER_A }],
        layout: { widgets: [
          { id: 'go', type: 'actions', w: 4, h: 2, config: { buttons: [{ label: 'Start', action: { kind: 'start_workflow', workflow_id: WORKFLOW } }, { label: 'Detail', action: { kind: 'open_page', page_slug: 'detail', filters: {} } }] } },
          { id: 'grid', type: 'data_grid', w: 12, h: 6, config: { table_id: TABLE } },
          { id: 'api', type: 'card_view', w: 6, h: 4, config: { source: 'reference', reference_id: REFERENCE, allow_viewers: true } },
          { id: 'embed', type: 'embed', w: 6, h: 4, config: { url: 'https://dash.example.com/x' } },
        ] },
      },
      { id: PAGE_DETAIL, tenant_id: A, app_id: APP, slug: 'detail', title: 'Detail', icon: null, position: 1, filters: [], layout: { widgets: [{ id: 'f', type: 'form_embed', w: 12, h: 6, config: { form_id: FORM } }], options: { hidden: true, min_role: 'viewer' } } },
      { id: id(98), tenant_id: A, app_id: OTHER_APP, slug: 'home', title: 'Home', position: 0, filters: [], layout: { widgets: [] } },
    ],
    app_audience: [{ id: id(50), tenant_id: A, app_id: APP, principal_type: 'team', principal_id: TEAM_A, app_role: 'viewer' }],
    app_editors: [{ id: id(51), tenant_id: A, app_id: APP, user_id: USER_A }],
    forms: [{ id: FORM, tenant_id: A, name: 'Request', fields: [{ key: 'title', label: 'Title', type: 'text' }], buttons: null }],
    workflows: [{ id: WORKFLOW, tenant_id: A, name: 'Approve request', trigger_type: 'manual', trigger_config: {}, nodes: [], edges: [] }],
    custom_tables: [{ id: TABLE, tenant_id: A, name: 'Requests', columns: [] }],
    reports: [{ id: REPORT, tenant_id: A, name: 'Throughput', config: {} }],
    integrations: [{ id: INTEGRATION, tenant_id: A, name: 'CRM', type: 'rest_api', config: { base_url: 'https://crm.example.com', auth_config: { type: 'bearer', token: 'super-secret-token' } }, is_active: true }],
    integration_references: [{ id: REFERENCE, tenant_id: A, integration_id: INTEGRATION, name: 'List accounts', request_config: { method: 'GET', path: '/accounts' }, inputs: [], outputs: [] }],
    tenant_connectors: [],
    teams: [{ id: TEAM_A, tenant_id: A, name: 'Ops' }],
    user_memberships: [{ user_id: INSTALLER, tenant_id: B, is_active: true }, { user_id: USER_A, tenant_id: A, is_active: true }],
    roles: [],
  }, { uuids: true })
}

const ctxB = (perms: string[] | null = null) => ({ supabase: mem as any, tenantId: B, actorId: INSTALLER, permissions: perms ? new Set(perms) : null, authKind: 'session', source: 'api' }) as any
const idMapsB = () => {
  const maps = createEmptyAssetIdMaps()
  Object.assign(maps.form, { [FORM]: FORM_B })
  Object.assign(maps.workflow, { [WORKFLOW]: WORKFLOW_B })
  Object.assign(maps.data_table, { [TABLE]: TABLE_B })
  Object.assign(maps.report, { [REPORT]: REPORT_B })
  Object.assign(maps.reference, { [REFERENCE]: REFERENCE_B })
  return maps
}

beforeEach(seed)

describe('export (the apps section)', () => {
  it('carries the app, its pages and used icons; never audience, editors or usage', async () => {
    const [asset] = await exportApps(mem, A, [APP])
    expect(asset).toMatchObject({ id: APP, slug: 'ops-hub', name: 'Ops hub', color: '#2563eb' })
    expect(asset.pages.map((p: any) => p.slug)).toEqual(['home', 'detail'])
    expect(asset.pages[1].layout.options).toEqual({ hidden: true, min_role: 'viewer' })
    expect(asset.settings).toEqual({ nav: { style: 'sidebar' } })
    expect(asset.icons.map((i: any) => i.id)).toEqual([ICON, BAD_ICON].sort())
    for (const key of ['audience', 'editors', 'tenant_id', 'created_by']) expect(asset).not.toHaveProperty(key)
    expect(JSON.stringify(asset)).not.toContain(USER_A === TEAM_A ? 'x' : 'app_audience')
  })

  it('is pinned to the workspace', async () => {
    expect(await exportApps(mem, B, [APP])).toEqual([])
  })

  it('is deterministic (same rows → same asset, icons and pages ordered)', async () => {
    const first = await exportApps(mem, A, [APP])
    mem.tables.app_pages.reverse()
    mem.tables.tenants[0].settings.apps.icons.reverse()
    expect(await exportApps(mem, A, [APP])).toEqual(first)
  })

  it('is told apart from the retired apps section', async () => {
    const [asset] = await exportApps(mem, A, [APP])
    expect(isRetiredAppAsset(asset)).toBe(false)
    expect(isRetiredAppAsset({ id: APP, name: 'Old', asset_links: [] })).toBe(true)
  })
})

describe('dependencies', () => {
  it('finds every object the app uses (and linked apps); people are not requirements', async () => {
    const [asset] = await exportApps(mem, A, [APP])
    const scanned = scanAssetReferences(asset)
    expect(scanned.people).toEqual([])
    expect(scanned.appSlugs).toEqual(['other-app'])
    const closure = await resolveDependencyClosure(mem, A, [{ type: 'app', id: APP }])
    const keys = closure.items.map((i) => `${i.type}:${i.id}`).sort()
    expect(keys).toEqual([`app:${APP}`, `app:${OTHER_APP}`, `data_table:${TABLE}`, `form:${FORM}`, `integration:${INTEGRATION}`, `report:${REPORT}`, `workflow:${WORKFLOW}`].sort())
    expect(closure.items.find((i) => i.type === 'form')?.required_by).toEqual({ type: 'app', id: APP })
  })

  it('stops at excluded items', async () => {
    const closure = await resolveDependencyClosure(mem, A, [{ type: 'app', id: APP }], { exclude: new Set([`report:${REPORT}`, `integration:${INTEGRATION}`, `app:${OTHER_APP}`]) })
    expect(closure.items.map((i) => i.type).sort()).toEqual(['app', 'data_table', 'form', 'workflow'])
  })

  it('never puts credentials in a package (integrations travel as definitions)', async () => {
    const assets = scrubSecretsForExport(await buildManifestExport(mem, A, { app: [APP], integration: [INTEGRATION], form: [FORM], workflow: [WORKFLOW], data_table: [TABLE], report: [REPORT] }))
    expect(assets.apps).toHaveLength(1)
    expect(assets.integrations[0].config.auth_config.token).toBe('__SECRET__')
    const laid = toPackageFiles({ header: { id: id(77), name: 'Ops hub', slug: 'ops-hub-app', version: '1.0.0', description: null, author: null, created_at: '2026-11-21T00:00:00Z', readme: null }, assets, data: {}, requirements: [], dependencies: [] })
    expect(laid.files.some((f) => f.path.startsWith('assets/apps/ops-hub-'))).toBe(true)
    expect(findSecretLeaks(laid.files)).toEqual([])
    expect(laid.files.map((f) => f.content).join('\n')).not.toContain('super-secret-token')
  })
})

describe('install into another workspace', () => {
  it('creates an equivalent app with remapped ids, a free slug, no audience and the installer as editor', async () => {
    const [asset] = await exportApps(mem, A, [APP])
    const result = await applyAppManifest(ctxB(), structuredClone(asset), null, idMapsB(), new Map([['other-app', 'other-app-b']]))
    expect(result.created).toBe(true)
    expect(result.slug).toBe('ops-hub-2')
    const app = mem.tables.apps.find((a) => a.id === result.id)!
    expect(app.tenant_id).toBe(B)
    expect(app.settings).toEqual({ nav: { style: 'sidebar' } })
    expect(mem.tables.app_audience.filter((a) => a.app_id === result.id)).toEqual([])
    expect(mem.tables.app_editors.filter((e) => e.app_id === result.id).map((e) => e.user_id)).toEqual([INSTALLER])
    const pages = mem.tables.app_pages.filter((p) => p.app_id === result.id)
    expect(pages.map((p) => p.slug).sort()).toEqual(['detail', 'home'])
    const text = JSON.stringify({ app, pages })
    for (const source of [FORM, WORKFLOW, TABLE, REPORT, REFERENCE, TEAM_A, USER_A, ICON, BAD_ICON]) expect(text).not.toContain(source)
    for (const local of [FORM_B, WORKFLOW_B, TABLE_B, REPORT_B, REFERENCE_B]) expect(text).toContain(local)
    expect(app.menu[1].url).toBe('/apps/other-app-b')
    // People not in this workspace are dropped (filter default, visibility team).
    const home = pages.find((p) => p.slug === 'home')!
    expect(home.filters[1].default).toBeNull()
    expect(app.menu[2].visibility.teams).toEqual([])
    expect(result.warnings.some((w) => /people, teams or roles/.test(w))).toBe(true)
  })

  it('re-sanitises uploaded icons into the library; a broken icon falls back to the default', async () => {
    const [asset] = await exportApps(mem, A, [APP])
    const result = await applyAppManifest(ctxB(), structuredClone(asset), null, idMapsB())
    const app = mem.tables.apps.find((a) => a.id === result.id)!
    const library = mem.tables.tenants.find((t) => t.id === B)!.settings.apps.icons
    expect(library).toHaveLength(1)
    expect(app.icon).toBe(`svg:${library[0].id}`)
    expect(library[0]).toMatchObject({ name: 'Rocket', tint: true })
    expect(library[0].sha256).toMatch(/^[0-9a-f]{64}$/)
    const stored = new TextDecoder().decode(files.get(`task-files/app-icons/${B}/${library[0].id}.svg`)!)
    expect(stored).toMatch(/^<svg/)
    expect(stored).not.toMatch(/script|onload|evil\.example|<\?xml/i)
    expect(app.menu[0].icon).toBeNull()
    expect(result.warnings.some((w) => /Broken.*not a safe SVG/.test(w))).toBe(true)
    // Installing again reuses the library icon (same markup).
    await applyAppManifest(ctxB(), structuredClone(asset), null, idMapsB())
    expect(mem.tables.tenants.find((t) => t.id === B)!.settings.apps.icons).toHaveLength(1)
  })

  it('keeps "Allow app viewers" on card views only for installers with Manage references', async () => {
    const [asset] = await exportApps(mem, A, [APP])
    const gated = await applyAppManifest(ctxB(['apps.manage']), structuredClone(asset), null, idMapsB())
    const card = (r: string) => mem.tables.app_pages.find((p) => p.app_id === r && p.slug === 'home')!.layout.widgets.find((w: any) => w.id === 'api')
    expect(card(gated.id).config.allow_viewers).toBe(false)
    expect(gated.warnings.some((w) => /Allow app viewers/.test(w))).toBe(true)
    const full = await applyAppManifest(ctxB(['apps.manage', 'integrations.manage_references']), structuredClone(asset), null, idMapsB())
    expect(card(full.id).config.allow_viewers).toBe(true)
  })

  it('upgrades in place: keeps the slug, audience, editors and pages added here; updates the package pages', async () => {
    const [asset] = await exportApps(mem, A, [APP])
    const first = await applyAppManifest(ctxB(), structuredClone(asset), null, idMapsB())
    // Installer shares it and adds a page of their own.
    mem.tables.app_audience.push({ id: id(60), tenant_id: B, app_id: first.id, principal_type: 'user', principal_id: INSTALLER, app_role: 'contributor' })
    mem.tables.app_pages.push({ id: id(61), tenant_id: B, app_id: first.id, slug: 'local-notes', title: 'Local notes', position: 5, filters: [], layout: { widgets: [] } })
    mem.tables.apps.find((a) => a.id === first.id)!.settings.access_issues = 1
    const next = structuredClone(asset)
    next.name = 'Ops hub 2'
    next.pages[0].title = 'Start here'
    const upgraded = await applyAppManifest(ctxB(), next, first.id, idMapsB())
    expect(upgraded).toMatchObject({ id: first.id, slug: 'ops-hub-2', created: false })
    const app = mem.tables.apps.find((a) => a.id === first.id)!
    expect(app.name).toBe('Ops hub 2')
    expect(app.settings.access_issues).toBe(1)
    expect(mem.tables.app_audience.filter((a) => a.app_id === first.id)).toHaveLength(1)
    expect(mem.tables.app_editors.filter((e) => e.app_id === first.id).map((e) => e.user_id)).toEqual([INSTALLER])
    const pages = mem.tables.app_pages.filter((p) => p.app_id === first.id)
    expect(pages.map((p) => p.slug).sort()).toEqual(['detail', 'home', 'local-notes'])
    expect(pages.find((p) => p.slug === 'home')!.title).toBe('Start here')
  })
})

describe('plans and serialisation', () => {
  it('an installed app compares unchanged against its package (icon ids, page ids, slug are local)', async () => {
    const [asset] = await exportApps(mem, A, [APP])
    const result = await applyAppManifest(ctxB(['apps.manage', 'integrations.manage_references']), structuredClone(asset), null, idMapsB(), new Map([['other-app', 'other-app']]))
    const [local] = await exportApps(mem, B, [result.id])
    const seed = idMapsB()
    seed.app[APP] = result.id
    // People dropped on install are settled by config apply (settleAppPlans); compare without them here.
    const withoutPeople = remapAppAsset(asset, createEmptyAssetIdMaps())
    withoutPeople.pages[0].filters[1].default = null
    withoutPeople.menu[2].visibility.teams = []
    const plan = planManifest({ incoming: { apps: [withoutPeople] }, current: { apps: [local] }, idSeed: seed })
    expect(plan.assets[0].diffs ?? []).toEqual([])
    expect(plan.assets[0]).toMatchObject({ section: 'apps', action: 'unchanged' })
    const changed = structuredClone(withoutPeople)
    changed.pages[1].title = 'Details'
    const diff = planManifest({ incoming: { apps: [changed] }, current: { apps: [local] }, idSeed: seed })
    expect(diff.assets[0].action).toBe('update')
    expect(diff.assets[0].diffs?.map((d) => d.path)).toEqual(['pages[0].title'])
  })

  it('compares icons by their markup, not their id', () => {
    const a = { id: APP, name: 'x', menu: [], settings: {}, icon: `svg:${ICON}`, pages: [], icons: [{ id: ICON, name: 'i', tint: false, svg: '<svg/>' }] }
    const b = { ...a, icon: `svg:${BAD_ICON}`, icons: [{ id: BAD_ICON, name: 'i', tint: false, svg: '<svg/>' }] }
    expect(comparableAppAsset(a)).toEqual(comparableAppAsset(b))
  })

  it('GitHub sync / config-as-code: apps get a stable file in apps/', async () => {
    const [asset] = await exportApps(mem, A, [APP])
    const strip = (content: string) => { const env = JSON.parse(content); delete env.exported_at; return env }
    const one = planManifestFiles({ apps: [asset] }, 'usertasks')
    const two = planManifestFiles({ apps: structuredClone([asset]) }, 'usertasks')
    expect(one.files.map((f) => f.path)).toEqual([`usertasks/apps/ops-hub-${APP.replace(/-/g, '').slice(0, 8)}.json`])
    expect(strip(one.files[0].content)).toEqual(strip(two.files[0].content))
    expect(strip(one.files[0].content)).toMatchObject({ asset_type: 'apps', id: APP })
    expect(SECTION_TO_DIR.some((s) => s.section === 'apps')).toBe(true)
    expect(PACKAGE_SECTIONS).toContain('apps')
    // Apps import after everything they use.
    const order = PLAN_SECTIONS.map((s) => s.section)
    for (const used of ['forms', 'workflows', 'data_tables', 'reports', 'references', 'agents']) expect(order.indexOf('apps')).toBeGreaterThan(order.indexOf(used))
  })
})
