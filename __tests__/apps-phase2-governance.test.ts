/**
 * Apps and permissions, Phase 2 widgets, buttons and navigation (pure): an
 * app never grants access. New object-bound widgets are hidden (or degrade
 * to read-only) when the viewer may not use their objects; viewers never get
 * actions (form embed, start workflow, agent chat, Kanban drag, grid
 * editing); button / menu visibility rules narrow only; the nav bar and
 * app menu are filtered the same way (empty groups and stray headings go);
 * API reference data needs integration access or the designer's "allow app
 * viewers"; report targets need the report shared.
 */
import { describe, expect, it } from 'vitest'
import { appBindings, objectAllowed, presentLayout, presentMenu, visibleTo, widgetBindings, type ObjectFacts } from '@/lib/apps/governance'
import { WIDGET_CONFIG_SCHEMAS, normaliseMenu, normalisePageLayout, type AppMenuItem, type WidgetType } from '@/lib/apps/schema'

const FORM = '0f000000-0000-4000-8000-0000000000f1'
const WF = '0f000000-0000-4000-8000-0000000000a1'
const TABLE = '0f000000-0000-4000-8000-0000000000d1'
const REPORT = '0f000000-0000-4000-8000-0000000000e1'
const PRIVATE_REPORT = '0f000000-0000-4000-8000-0000000000e2'
const AGENT = '0f000000-0000-4000-8000-0000000000b1'
const REF = '0f000000-0000-4000-8000-0000000000c1'
const TEAM = '0e000000-0000-4000-8000-000000000001'

const facts = (perms: string[]): ObjectFacts => ({
  can: (p) => perms.includes(p),
  formGrants: new Set([FORM]),
  exists: { form: new Set([FORM]), workflow: new Set([WF]), data_table: new Set([TABLE]), report: new Set([REPORT, PRIVATE_REPORT]), agent: new Set([AGENT]), reference: new Set([REF]) },
  visibleReports: new Set([REPORT]),
})
const w = (id: string, type: WidgetType, config: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({ id, type, w: 6, h: 6, config: WIDGET_CONFIG_SCHEMAS[type].parse(config), ...extra })
const ALL = ['tasks.view_own', 'tasks.complete', 'forms.submit', 'data.view', 'data.manage_rows', 'reports.view', 'workflows.view', 'workflows.activate', 'agents.view', 'agents.test', 'org.view']

const layout = normalisePageLayout({
  widgets: [
    w('form', 'form_embed', { form_id: FORM }),
    w('form-notice', 'form_embed', { form_id: FORM, unavailable: 'notice' }),
    w('start', 'start_workflow', { workflow_id: WF }),
    w('chat', 'agent_chat', { agent_id: AGENT }),
    w('board', 'kanban'),
    w('grid', 'data_grid', { table_id: TABLE, editable: true }),
    w('cards-ref', 'card_view', { source: 'reference', reference_id: REF }),
    w('cards-open', 'card_view', { source: 'reference', reference_id: REF, allow_viewers: true }),
    w('cards-report', 'card_view', { source: 'report', report_id: PRIVATE_REPORT }),
    w('org', 'org_chart'),
    w('failures', 'recent_failures', { workflow_id: WF }),
    w('tiles', 'tiles', { tiles: [{ label: 'Report', action: { kind: 'open_report', report_id: REPORT } }, { label: 'Private', action: { kind: 'open_report', report_id: PRIVATE_REPORT } }, { label: 'Start', action: { kind: 'start_workflow', workflow_id: WF } }] }),
    w('btns', 'actions', { buttons: [
      { label: 'Download', action: { kind: 'download_report', report_id: REPORT } },
      { label: 'Claim next', action: { kind: 'claim_next' } },
      { label: 'New row', action: { kind: 'open_record', table_id: TABLE } },
      { label: 'Team only', visibility: { teams: [TEAM] }, action: { kind: 'copy_link' } },
      { label: 'Editors only', visibility: { app_roles: ['editor'] }, action: { kind: 'copy_link' } },
    ] }),
    w('tabs', 'tabs', { tabs: [{ label: 'A', widgets: ['chat', 'board'] }] }),
  ],
})
const ids = (l: { widgets: Array<{ id: string }> }) => l.widgets.map((x) => x.id)
const find = (l: { widgets: Array<{ id: string; config: unknown }> }, id: string) => l.widgets.find((x) => x.id === id)?.config as Record<string, any>

describe('Phase 2 widgets as the viewer sees them', () => {
  it('a viewer (read-only) never gets action widgets, drag or editing — even with every permission', () => {
    const out = presentLayout(layout, facts([...ALL, 'integrations.view']), 'viewer')
    expect(ids(out)).not.toContain('form')
    expect(ids(out)).not.toContain('start')
    expect(ids(out)).not.toContain('chat')
    expect(find(out, 'form-notice').form_id).toBeNull()
    expect(find(out, 'board').allow_drag).toBe(false)
    expect(find(out, 'grid').editable).toBe(false)
    expect(find(out, 'tiles').tiles.map((t: any) => t.label)).toEqual(['Report'])
    expect(find(out, 'btns').buttons.map((b: any) => b.label)).toEqual(['Download'])
    // Containers lose children that were dropped.
    expect(find(out, 'tabs').tabs[0].widgets).toEqual(['board'])
  })

  it('a contributor gets actions only where the objects allow', () => {
    const out = presentLayout(layout, facts(ALL), 'contributor')
    expect(ids(out)).toEqual(expect.arrayContaining(['form', 'start', 'chat', 'board', 'grid', 'org', 'failures']))
    expect(find(out, 'board').allow_drag).toBe(true)
    expect(find(out, 'grid').editable).toBe(true)
    // No Manage rows: the grid stays, read-only; no Run agents: chat hidden; no Complete tasks: no drag.
    const less = presentLayout(layout, facts(ALL.filter((p) => !['data.manage_rows', 'agents.test', 'tasks.complete'].includes(p))), 'contributor')
    expect(find(less, 'grid').editable).toBe(false)
    expect(ids(less)).not.toContain('chat')
    expect(find(less, 'board').allow_drag).toBe(false)
    // A new record needs Manage rows.
    expect(find(less, 'btns').buttons.map((b: any) => b.label)).toEqual(['Download', 'Claim next'])
  })

  it('API reference cards: integration access, or the designer allowed app viewers', () => {
    const plain = presentLayout(layout, facts(ALL), 'contributor')
    expect(ids(plain)).not.toContain('cards-ref')
    expect(ids(plain)).toContain('cards-open')
    expect(ids(presentLayout(layout, facts([...ALL, 'integrations.view']), 'contributor'))).toContain('cards-ref')
    expect(objectAllowed(facts([]), 'reference', REF, 'view')).toEqual({ allowed: false, missing: 'viewers' })
    expect(objectAllowed(facts([]), 'reference', REF, 'view', { viewersAllowed: true })).toEqual({ allowed: true })
  })

  it('report targets need the report shared (or theirs); the org chart needs View org chart', () => {
    const out = presentLayout(layout, facts(ALL.filter((p) => p !== 'org.view')), 'contributor')
    expect(ids(out)).not.toContain('cards-report')
    expect(ids(out)).not.toContain('org')
    expect(find(out, 'tiles').tiles.map((t: any) => t.label)).toEqual(['Report', 'Start'])
  })

  it('visibility rules narrow by app role and team / role; editors see everything allowed', () => {
    const v = { app_roles: [] as Array<'viewer' | 'contributor' | 'editor'>, teams: [TEAM], roles: [] }
    expect(visibleTo(v, 'contributor', { teamIds: [TEAM], roleIds: [] })).toBe(true)
    expect(visibleTo(v, 'contributor', { teamIds: [], roleIds: [] })).toBe(false)
    expect(visibleTo(v, 'editor')).toBe(true)
    expect(visibleTo({ app_roles: ['editor'], teams: [], roles: [] }, 'contributor')).toBe(false)
    const inTeam = presentLayout(layout, facts(ALL), 'contributor', { teamIds: [TEAM], roleIds: [] })
    expect(find(inTeam, 'btns').buttons.map((b: any) => b.label)).toContain('Team only')
    expect(find(presentLayout(layout, facts(ALL), 'editor'), 'btns').buttons.map((b: any) => b.label)).toContain('Editors only')
  })

  it('the access analysis sees every new object-bound widget (actions vs data, optional editing)', () => {
    const b = appBindings([{ title: 'Home', layout }], [])
    const kinds = b.objects.map((o) => `${o.kind}:${o.need}:${o.action ? 'act' : 'data'}${o.optional ? ':opt' : ''}`)
    expect(kinds).toEqual(expect.arrayContaining(['form:submit:act', 'workflow:start:act', 'agent:use:act', 'data_table:view:data', 'data_table:edit:act:opt', 'reference:view:data', 'report:view:data', 'workflow:view:data']))
    expect(b.objects.find((o) => o.kind === 'reference' && o.viewersAllowed)).toBeTruthy()
    expect(b.sources.map((s) => s.source)).toEqual(expect.arrayContaining(['tasks', 'org']))
    expect(widgetBindings(layout.widgets.find((x) => x.id === 'btns')!).objects.map((o) => o.kind)).toEqual(['report', 'data_table'])
  })
})

describe('navigation (app menu and nav bar share the filter)', () => {
  const menu = normaliseMenu([
    { kind: 'group', label: 'Requests', items: [
      { kind: 'heading', label: 'Forms' },
      { kind: 'form', label: 'New claim', form_id: FORM },
      { kind: 'divider', label: '' },
      { kind: 'group', label: 'Reports', items: [{ kind: 'report', label: 'Private', report_id: PRIVATE_REPORT }] },
    ] },
    { kind: 'group', label: 'Admin', visibility: { app_roles: ['editor'], teams: [], roles: [] }, items: [{ kind: 'page', label: 'Pricing', page_slug: 'pricing' }] },
    { kind: 'workflow', label: 'Start', workflow_id: WF },
    { kind: 'tasks', label: 'My tasks', view: 'mine' },
    { kind: 'url', label: 'Help', url: 'https://example.com/help', new_tab: true },
  ]) as AppMenuItem[]
  const labels = (items: AppMenuItem[]): string[] => items.flatMap((m) => (m.kind === 'group' ? [m.label, ...labels(m.items as AppMenuItem[])] : 'label' in m ? [m.label || `(${m.kind})`] : []))

  it('viewers lose actions; groups left empty, stray dividers and headings with nothing under them are dropped', () => {
    expect(labels(presentMenu(menu, facts(ALL), 'viewer'))).toEqual(['My tasks', 'Help'])
  })
  it('contributors keep what the objects allow; editor-only groups need the editor role', () => {
    expect(labels(presentMenu(menu, facts(ALL), 'contributor'))).toEqual(['Requests', 'Forms', 'New claim', 'Start', 'My tasks', 'Help'])
    expect(labels(presentMenu(menu, facts(ALL), 'editor'))).toContain('Pricing')
    expect(labels(presentMenu(menu, facts([]), 'contributor'))).toEqual(['Help'])
  })
  it('the nav bar widget is filtered the same way when the page is sent', () => {
    const page = normalisePageLayout({ widgets: [w('bar', 'nav_bar', { items: menu })] })
    expect(labels(find(presentLayout(page, facts(ALL), 'viewer'), 'bar').items)).toEqual(['My tasks', 'Help'])
  })
})
