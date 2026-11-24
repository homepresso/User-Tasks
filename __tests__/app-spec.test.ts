/**
 * App specs, the pure model (lib/apps/spec.ts): a whole app or a change to
 * one compiles to exact service inputs, and every problem comes back as a
 * plain-language line a model can act on (unknown widget types, invalid
 * settings with the allowed values, unknown settings with the list of real
 * ones, page filters a widget uses but the page lacks, broken page links,
 * container children, misplaced audience) — plus incremental edits (add
 * after / before, merge config, move, resize with clamping, remove) and the
 * confirmation card summary.
 */
import { describe, expect, it } from 'vitest'
import { APP_SPEC_EXAMPLE, appOutline, compileAppSpec, designWarnings, summariseSpec, type ExistingApp } from '@/lib/apps/spec'
import { BUILDER_SEARCH_KINDS } from '@/lib/apps/spec-input'
import { PICKER_KINDS } from '@/lib/services/app-search'
import { normalisePageLayout, type AppPage } from '@/lib/apps/schema'

/* eslint-disable @typescript-eslint/no-explicit-any */

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const example = () => JSON.parse(JSON.stringify(APP_SPEC_EXAMPLE).replace(/<expense claim form id>/g, ID(1)).replace(/<expense approval workflow id>/g, ID(2)).replace(/<finance team id>/g, ID(3)))

function errorsOf(spec: unknown, existing: ExistingApp | null = null): string[] {
  const r = compileAppSpec(spec, existing)
  if (r.ok) throw new Error('expected errors')
  return r.errors
}

function page(id: string, slug: string, title: string, widgets: any[], filters: any[] = [], position = 0): AppPage {
  return { id, app_id: 'app1', slug, title, icon: null, position, layout: normalisePageLayout({ widgets }), filters, updated_at: '2026-11-20T00:00:00Z' }
}

const EXISTING: ExistingApp = {
  id: 'app1', slug: 'team', name: 'Team hub', menu: [], audience: [], editors: [],
  pages: [
    page('p1', 'home', 'Home', [{ id: 'hello', type: 'heading', w: 12, h: 2, config: { text: 'Hi' } }, { id: 'tasks', type: 'task_list', w: 6, h: 8, title: 'My tasks', config: {} }]),
    page('p2', 'team', 'Team', [{ id: 'load', type: 'team_workload', w: 6, h: 7, title: 'Workload', config: { team: { filter: 'team' } } }], [{ id: 'team', kind: 'team', label: 'Team', default: 'my_teams' }], 1),
  ],
}

describe('a whole app', () => {
  it('the worked example compiles: app input, the home page first, defaults from the catalogue, the audience', () => {
    const r = compileAppSpec(example(), null)
    if (!r.ok) throw new Error(r.errors.join('\n'))
    const c = r.compiled
    expect(c.mode).toBe('create')
    expect(c.app).toMatchObject({ name: 'Expense desk', icon: 'Receipt', audience: [{ type: 'team', id: ID(3), role: 'contributor' }] })
    expect(c.pages.map((p) => [p.op, p.slug])).toEqual([['create', 'home'], ['create', 'approvals']])
    const approvals = c.pages[1].input
    expect(approvals.layout.options).toEqual({ hidden: false, min_role: 'contributor' })
    expect(approvals.filters).toEqual([{ id: 'period', kind: 'date_range', label: 'Period', default: { preset: '30d' } }])
    // Ids and defaults filled in; configs parsed by the widget's schema (defaults applied).
    expect(approvals.layout.widgets.map((w: any) => w.id)).toEqual(['task-list-1', 'sla-1', 'sla-trend-1'])
    expect(approvals.layout.widgets[0].config).toMatchObject({ scope: 'queue', workflow_id: ID(2), limit: 10 })
  })

  it('a widget without w / h gets the catalogue size; sizes outside the range are clamped with a warning', () => {
    const r = compileAppSpec({ app: { name: 'A' }, pages: [{ title: 'Home', widgets: [{ type: 'kanban', title: 'Board' }, { type: 'kpi', title: 'Open', w: 40, h: 1 }] }] }, null)
    if (!r.ok) throw new Error(r.errors.join('\n'))
    const [board, kpi] = r.compiled.pages[0].input.layout.widgets
    expect([board.w, board.h]).toEqual([12, 10])
    expect(kpi.w).toBeLessThanOrEqual(12)
    expect(r.compiled.warnings.some((w) => /adjusted to/.test(w))).toBe(true)
  })

  it('a template seeds a new page with its widgets and filters', () => {
    const r = compileAppSpec({ app: { name: 'Ops' }, pages: [{ title: 'SLA', template: 'operations_sla' }] }, null)
    if (!r.ok) throw new Error(r.errors.join('\n'))
    const input = r.compiled.pages[0].input
    expect(input.filters.map((f: any) => f.id)).toEqual(['workflow', 'period', 'status'])
    expect(input.layout.widgets.length).toBeGreaterThan(5)
  })

  it('the summary names the pages, widgets and audience; the preview lists every widget', () => {
    const r = compileAppSpec(example(), null)
    if (!r.ok) throw new Error()
    const s = summariseSpec(r.compiled, { appName: 'Expense desk', name: (_k, id) => (id === ID(1) ? 'Expense claim' : null), principal: (t, id) => (id === ID(3) ? 'Team Finance' : null) })
    expect(s.title).toBe('Build app “Expense desk”')
    expect(s.lines).toContain('Home page “Home” (/home): 3 widgets')
    expect(s.lines.some((l) => l.includes('Team Finance (contributor)'))).toBe(true)
    expect(s.preview.rows.find((r) => r[1].startsWith('My submissions'))?.[1]).toBe('My submissions “My claims” (Expense claim)')
    expect(s.preview.total).toBe(6)
  })
})

describe('plain-language errors', () => {
  it('unknown widget types list the real ones; invalid values list the allowed ones; unknown settings list the real settings', () => {
    const errors = errorsOf({ app: { name: 'X' }, pages: [{ title: 'A', widgets: [{ type: 'barchart' }, { type: 'chart', title: 'C', config: { group_by: 'week', colour: 'red' } }] }] })
    expect(errors[0]).toMatch(/^Page 1 “A” › widget 1: unknown widget type "barchart" — use one of actions, task_list/)
    expect(errors).toContain('Page 1 “A” › widget 2 (chart) › group_by: use one of "time", "status", "workflow", "form", "assignee", "field"')
    expect(errors.find((e) => e.includes('"colour"'))).toMatch(/is not a setting of a chart widget — its settings are source, chart, group_by/)
  })

  it('id inputs say where ids come from; button kinds list the options', () => {
    const errors = errorsOf({ app: { name: 'X' }, pages: [{ title: 'A', widgets: [{ type: 'task_list', title: 'T', config: { assignee: 'Bob' } }, { type: 'actions', config: { buttons: [{ label: 'Go', action: { kind: 'submit_form' } }] } }] }] })
    expect(errors).toContain('Page 1 “A” › widget 1 (task_list) › assignee: use "me", a user id from apps_search, or { "filter": "<page filter id>" }')
    expect(errors.find((e) => e.includes('buttons.0.action.kind'))).toMatch(/unknown kind — use one of new_submission, start_workflow, open_page/)
  })

  it('a widget bound to a filter the page lacks, a link to a page that is not there, a section holding a missing widget', () => {
    const errors = errorsOf({ app: { name: 'X' }, pages: [{ title: 'A', widgets: [
      { type: 'chart', title: 'C', config: { date_range: { filter: 'period' } } },
      { type: 'actions', config: { buttons: [{ label: 'More', action: { kind: 'open_page', page_slug: 'reports' } }] } },
      { type: 'section', config: { widgets: ['ghost'] } },
    ] }] })
    expect(errors.some((e) => /uses the page filter "period", which this page doesn't have/.test(e))).toBe(true)
    expect(errors.some((e) => /links to the page "reports", which is not in the app — use the slug of one of its pages \(a\)/.test(e))).toBe(true)
    expect(errors.some((e) => /it holds "ghost", which is not a widget on this page/.test(e))).toBe(true)
  })

  it('audience inside app settings, a new app without a name or pages, an unknown template', () => {
    expect(errorsOf({ app: { audience: [] }, pages: [] })).toEqual(expect.arrayContaining([
      expect.stringMatching(/"audience" is not an app setting.*go at the top level/),
      expect.stringMatching(/^app.name: a new app needs a name/),
      expect.stringMatching(/a new app needs at least one page/),
    ]))
    expect(errorsOf({ app: { name: 'X' }, pages: [{ title: 'A', template: 'nope' }] })[0]).toMatch(/unknown template "nope" — use one of team_dashboard/)
  })

  it('a spec that changes nothing says so', () => {
    expect(errorsOf({ app_id: 'app1', pages: [{ page: 'home' }] }, EXISTING)).toEqual(['The spec changes nothing — say what to add or change'])
  })
})

describe('changing an existing app', () => {
  it('add after a widget, merge a config, resize, move, remove — only the changed page is written', () => {
    const r = compileAppSpec({ app_id: 'app1', pages: [{ page: 'home', add_widgets: [{ type: 'overdue_list', title: 'Overdue', at: 'start' }], update_widgets: [{ id: 'tasks', config: { scope: 'queue', limit: 20 }, w: 12, move: { at: 'end' } }], remove_widgets: ['hello'] }] }, EXISTING)
    if (!r.ok) throw new Error(r.errors.join('\n'))
    const [op] = r.compiled.pages
    expect(op).toMatchObject({ op: 'update', page_id: 'p1', changed: ['layout'] })
    const widgets = (op.input as any).layout.widgets
    expect(widgets.map((w: any) => w.id)).toEqual(['overdue-list-1', 'tasks'])
    expect(widgets[1]).toMatchObject({ w: 12, config: { scope: 'queue', limit: 20, show_claim: true } })
    expect(r.compiled.changes[0]).toMatchObject({ updated: ['tasks'], resized: ['tasks'], moved: ['tasks'], removed: ['hello'] })
    const s = summariseSpec(r.compiled, { appName: 'Team hub' })
    expect(s.lines[0]).toMatch(/^Page “Home”: add Overdue tasks “Overdue”; change “tasks”; resize “tasks”; move “tasks”; remove “hello”/)
    expect(s.warnings).toEqual(expect.arrayContaining(['Removes 1 widget']))
    // Drafts: the "saved as a draft" line is added by the service (it knows whether drafts are enabled).
    expect(s.warnings.join('\n')).not.toMatch(/no draft/)
  })

  it('"add a chart of overdue tasks to the Team page" — the new chart may use the page\'s filters', () => {
    const r = compileAppSpec({ app_id: 'team', pages: [{ page: 'team', add_widgets: [{ type: 'chart', title: 'Overdue by person', config: { source: 'tasks', group_by: 'assignee', status: 'open', team: { filter: 'team' } } }] }] }, EXISTING)
    if (!r.ok) throw new Error(r.errors.join('\n'))
    expect((r.compiled.pages[0].input as any).layout.widgets.map((w: any) => w.type)).toEqual(['team_workload', 'chart'])
  })

  it('pages: unknown page, new page, delete, order, a slug clash', () => {
    expect(errorsOf({ app_id: 'app1', pages: [{ page: 'nope', title: 'X' }] }, EXISTING)[0]).toMatch(/no page “nope” in this app/)
    expect(errorsOf({ app_id: 'app1', pages: [{ title: 'Other', slug: 'team' }] }, EXISTING)[0]).toMatch(/the slug "team" is already used/)
    const r = compileAppSpec({ app_id: 'app1', pages: [{ title: 'Insights', widgets: [{ type: 'throughput', title: 'Throughput' }] }], delete_pages: ['team'], page_order: ['insights', 'home'] }, EXISTING)
    if (!r.ok) throw new Error(r.errors.join('\n'))
    expect(r.compiled.pages.map((p) => [p.op, p.slug])).toEqual([['create', 'insights']])
    expect(r.compiled.deletes).toEqual([{ id: 'p2', slug: 'team', title: 'Team' }])
    expect(r.compiled.doc.pages.map((p) => p.slug)).toEqual(['insights', 'home'])
  })

  it('a widget id that is not on the page', () => {
    expect(errorsOf({ app_id: 'app1', pages: [{ page: 'home', update_widgets: [{ id: 'ghost', w: 4 }] }] }, EXISTING)[0]).toMatch(/no widget "ghost" on this page/)
  })
})

describe('design feedback and context', () => {
  it('warns about raw colours and untitled data widgets', () => {
    const r = compileAppSpec({ app: { name: 'X' }, pages: [{ title: 'A', widgets: [{ type: 'chart', style: { colors: { accent: '#ff0000' } } }] }] }, null)
    if (!r.ok) throw new Error(r.errors.join('\n'))
    const warnings = designWarnings(r.compiled.doc)
    expect(warnings.some((w) => /custom colours/.test(w))).toBe(true)
    expect(warnings.some((w) => /add a title/.test(w))).toBe(true)
  })

  it('the outline names the app id, pages, the open page and its widget ids', () => {
    const text = appOutline({ id: 'app1', slug: 'team', name: 'Team hub', pages: EXISTING.pages }, EXISTING.pages[0], true)
    expect(text).toContain('app_id app1')
    expect(text).toContain('Open page: “Home” (page "home")')
    expect(text).toContain('[id tasks, 6×8]')
  })

  it('the builder search kinds are the pickers\' kinds', () => {
    expect([...BUILDER_SEARCH_KINDS]).toEqual([...PICKER_KINDS])
  })
})

describe('reserved app slugs', () => {
  it('refuses addresses that collide with /api/v1/apps/<word> routes', async () => {
    const { appCreateSchema, RESERVED_APP_SLUGS } = await import('@/lib/apps/schema')
    for (const slug of RESERVED_APP_SLUGS) expect(appCreateSchema.safeParse({ name: 'X', slug }).success, slug).toBe(false)
    expect(appCreateSchema.safeParse({ name: 'X', slug: 'spec-desk' }).success).toBe(true)
  })
})
