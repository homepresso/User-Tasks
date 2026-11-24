import { describe, expect, it } from 'vitest'
import { displayActionLabel, displayLabel, isPlaceholderLabel, resolveMenuLabels, urlLabel } from '@/lib/apps/labels'
import { applyAllFixes, applyCheckFix, dedupeMenu, menuChecks, pageChecks, type CheckApp } from '@/lib/apps/lint'
import { contentBudgetForRows, displayLayout, placeDense, rowsToShow } from '@/lib/apps/grid'
import { autoHeightCap, autoTitle, newWidget, widgetTitle } from '@/lib/apps/widgets'
import { widgetCsvRows } from '@/lib/apps/widget-csv'
import { normalisePageLayout, type AppMenuItem, type AppWidget } from '@/lib/apps/schema'
import { compileAppSpec, designWarnings } from '@/lib/apps/spec'
import { presentMenu, type ObjectFacts } from '@/lib/apps/governance'
import { formatDurationParts } from '@/lib/format/duration'
import { fieldPreview } from '@/lib/services/task-panel'

const FORM = '11111111-1111-4111-8111-111111111111'

const app: CheckApp = {
  nav: { style: 'tabs' },
  menu: [],
  pages: [{ slug: 'home', title: 'Home', icon: null }, { slug: 'insights', title: 'Insights', icon: 'ChartColumn' }],
}

const w = (raw: Record<string, unknown>): AppWidget => normalisePageLayout({ widgets: [raw] }).widgets[0]

describe('placeholder labels', () => {
  it('spots builder defaults and empty labels, not real ones', () => {
    for (const l of ['Link', 'link', ' Page ', 'New tile', '', 'Link ↗']) expect(isPlaceholderLabel(l)).toBe(true)
    for (const l of ['Handbook', 'New claim', 'Approvals']) expect(isPlaceholderLabel(l)).toBe(false)
  })
  it('names links after their last path segment, else the host', () => {
    expect(urlLabel('https://example.com/travel-policy')).toBe('Travel policy')
    expect(urlLabel('https://www.example.com/')).toBe('example.com')
    expect(urlLabel('/apps/ops/report.pdf')).toBe('Report')
    expect(urlLabel('mailto:help@example.com')).toBe('help@example.com')
  })
  it('shows the target’s name instead of a placeholder (pages, links, forms, tasks views)', () => {
    const ctx = { pages: app.pages, name: (k: string, id: string) => (k === 'form' && id === FORM ? 'Expense claim' : null) }
    expect(displayLabel({ kind: 'page', label: 'Page', page_slug: 'insights' } as never, ctx)).toBe('Insights')
    expect(displayLabel({ kind: 'url', label: 'Link', url: 'https://example.com/rota' } as never, ctx)).toBe('Rota')
    expect(displayLabel({ kind: 'form', label: 'Form', form_id: FORM } as never, ctx)).toBe('Expense claim')
    expect(displayLabel({ kind: 'tasks', label: 'Link', view: 'queue' } as never, ctx)).toBe('Queue')
    expect(displayLabel({ kind: 'url', label: 'Team rota', url: 'https://example.com/rota' } as never, ctx)).toBe('Team rota')
    expect(displayActionLabel('New submission', { kind: 'new_submission', form_id: FORM, open: 'modal' } as never, ctx)).toBe('New expense claim')
    // Unknown target: the label stays.
    expect(displayActionLabel('New submission', { kind: 'new_submission', form_id: FORM, open: 'modal' } as never, {})).toBe('New submission')
  })
  it('resolves placeholder labels in nested groups', () => {
    const menu = [{ kind: 'group', label: 'More', items: [{ kind: 'url', label: 'Link', url: 'https://example.com/handbook', new_tab: true }] }] as AppMenuItem[]
    const out = resolveMenuLabels(menu, {}) as Array<{ items: Array<{ label: string }> }>
    expect(out[0].items[0].label).toBe('Handbook')
  })
  it('the server never hands a viewer a placeholder when it knows the object’s name', () => {
    const facts: ObjectFacts = { can: () => true, formGrants: new Set([FORM]), exists: { form: new Set([FORM]), workflow: new Set(), data_table: new Set(), report: new Set() }, visibleReports: new Set(), names: new Map([[`form:${FORM}`, 'Expense claim']]) }
    const out = presentMenu([{ kind: 'form', label: 'Form', form_id: FORM, open: 'modal' } as AppMenuItem], facts, 'contributor')
    expect((out[0] as { label: string }).label).toBe('Expense claim')
  })
})

describe('design checks', () => {
  const owner = [
    w({ id: 'nav', type: 'nav_bar', w: 12, h: 1, config: { edge: 'left', items: [
      { kind: 'page', label: 'Home', page_slug: 'home', icon: 'Bot' },
      { kind: 'page', label: 'Home', page_slug: 'home', icon: 'BriefcaseBusiness' },
      { kind: 'url', label: 'Link', url: 'https://example.com/handbook' },
    ] } }),
    w({ id: 'mine', type: 'task_list', w: 6, h: 5, config: { scope: 'mine' } }),
    w({ id: 'header', type: 'page_header', w: 12, h: 2, config: {} }),
    w({ id: 'one', type: 'task_list', title: 'Waiting for approval', height: 'fixed', w: 6, h: 9, config: { limit: 1 } }),
  ]

  it('finds what made the owner’s page look unfinished', () => {
    const codes = pageChecks(app, { title: 'Home', widgets: owner }).map((c) => c.code)
    expect(codes).toEqual(expect.arrayContaining(['placeholder_label', 'duplicate_nav', 'redundant_nav', 'icon_mismatch', 'header_not_first', 'missing_title', 'oversized_list']))
  })

  it('fixes each one safely', () => {
    const checks = pageChecks(app, { title: 'Home', widgets: owner })
    const header = checks.find((c) => c.code === 'header_not_first')!
    expect(applyCheckFix(owner, header, app).map((x) => x.id)).toEqual(['nav', 'header', 'mine', 'one'])
    const title = checks.find((c) => c.code === 'missing_title')!
    expect(applyCheckFix(owner, title, app).find((x) => x.id === 'mine')!.title).toBe('My tasks')
    const sized = applyCheckFix(owner, checks.find((c) => c.code === 'oversized_list')!, app).find((x) => x.id === 'one')!
    expect(sized.height).toBe('auto')
    const all = applyAllFixes(owner, app)
    const items = (all[0].config as { items: Array<{ kind: string; label: string; page_slug?: string; icon?: string | null }> }).items
    expect(items.map((i) => i.label)).toEqual(['Home', 'Insights', 'Handbook'])
    expect(items.filter((i) => i.kind === 'page').every((i) => !i.icon)).toBe(true)
    expect((all[0].config as { app_nav: string }).app_nav).toBe('hide')
    expect(pageChecks(app, { title: 'Home', widgets: all }).filter((c) => c.severity === 'warning' && c.code !== 'missing_title')).toEqual([])
  })

  it('keeps quiet about a tidy page', () => {
    const tidy = [w({ id: 'h', type: 'page_header', w: 12, h: 2, config: {} }), w({ id: 'l', type: 'task_list', title: 'My tasks', height: 'auto', w: 6, h: 6, config: {} })]
    expect(pageChecks(app, { title: 'Home', widgets: tidy })).toEqual([])
    expect(menuChecks({ ...app, menu: [{ kind: 'url', label: 'Policies', url: 'https://example.com/policies', new_tab: true }] as AppMenuItem[] })).toEqual([])
  })

  it('dedupes menus (the first of each target stays, groups included)', () => {
    const menu = [{ kind: 'page', label: 'Home', page_slug: 'home' }, { kind: 'group', label: 'More', items: [{ kind: 'page', label: 'Again', page_slug: 'home' }, { kind: 'tasks', label: 'Mine', view: 'mine' }] }] as AppMenuItem[]
    const out = dedupeMenu(menu) as Array<{ items?: unknown[] }>
    expect(out).toHaveLength(2)
    expect(out[1].items).toHaveLength(1)
  })

  it('the app spec compiler hands the same warnings to the Agent', () => {
    const r = compileAppSpec({ app: { name: 'Ops' }, pages: [{ title: 'Home', widgets: [{ type: 'task_list', title: 'Mine' }, { type: 'page_header' }] }] }, null)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.compiled.warnings.some((x) => /page header/.test(x))).toBe(true)
    // Lists from a spec follow their content by default.
    expect(r.compiled.doc.pages[0].layout.widgets[0].height).toBe('auto')
    expect(designWarnings(r.compiled.doc).length).toBeGreaterThan(0)
  })
})

describe('display layout', () => {
  const def = () => ({ minH: 2, maxH: 30, minW: 2, maxW: 12 })
  it('places like CSS grid row dense', () => {
    expect(placeDense([{ id: 'a', w: 6, h: 8 }, { id: 'b', w: 6, h: 4 }, { id: 'c', w: 6, h: 4 }]).map((p) => [p.x, p.y])).toEqual([[0, 0], [6, 0], [6, 4]])
  })
  it('auto-height cards shrink to content and line up in a row', () => {
    const items = [{ id: 'mine', w: 6, h: 5 }, { id: 'one', w: 6, h: 9 }]
    const auto = new Map([['mine', { px: 214, cap: 5 }], ['one', { px: 140, cap: 9 }]])
    expect(displayLayout(items, def, { auto }).map((i) => i.h)).toEqual([5, 5])
    expect(displayLayout(items, def, { auto, equalRows: false }).map((i) => i.h)).toEqual([5, 3])
  })
  it('never grows a card that has another stacked under it (masonry stays)', () => {
    const items = [{ id: 'tall', w: 6, h: 8 }, { id: 's1', w: 6, h: 4 }, { id: 's2', w: 6, h: 4 }]
    const auto = new Map([['s1', { px: 150, cap: 4 }], ['s2', { px: 150, cap: 4 }]])
    const out = displayLayout(items, def, { auto })
    expect(out.find((i) => i.id === 's1')!.h).toBeLessThan(8)
  })
  it('shrinking never reorders the page (rows stay rows; the empty team queue lines up with its chart)', () => {
    const items = [{ id: 'mine', w: 6, h: 5 }, { id: 'approvals', w: 6, h: 9 }, { id: 'header', w: 12, h: 2 }, { id: 'queue', w: 6, h: 7 }, { id: 'donut', w: 6, h: 8 }, { id: 'all', w: 7, h: 8 }, { id: 'sla', w: 4, h: 5 }]
    const auto = new Map([['mine', { px: 214, cap: 5 }], ['approvals', { px: 140, cap: 9 }], ['queue', { px: 106, cap: 7 }], ['all', { px: 400, cap: 8 }], ['sla', { px: 134, cap: 5 }]])
    const out = displayLayout(items, def, { auto })
    const placed = placeDense(out)
    const at = (id: string) => placed.find((p) => p.id === id)!
    expect(out.map((i) => `${i.id}:${i.w}x${i.h}`)).toEqual(['mine:6x5', 'approvals:6x5', 'header:12x2', 'queue:6x8', 'donut:6x8', 'all:7x8', 'sla:5x8'])
    expect(at('sla').y).toBe(at('all').y)
  })
  it('tiles of different heights in one row line up (equal rows), unless turned off', () => {
    const items = [{ id: 'm1', w: 3, h: 2 }, { id: 'm2', w: 3, h: 2 }, { id: 'k', w: 3, h: 3 }, { id: 'g', w: 3, h: 3 }]
    expect(displayLayout(items, def).map((i) => i.h)).toEqual([3, 3, 3, 3])
    expect(displayLayout(items, def, { equalRows: false }).map((i) => i.h)).toEqual([2, 2, 3, 3])
  })
  it('stretches the last card of a short row to the right edge', () => {
    const out = displayLayout([{ id: 'a', w: 7, h: 8 }, { id: 'b', w: 4, h: 5 }], def)
    expect(out.map((i) => i.w)).toEqual([7, 5])
  })
  it('lists show whole rows and leave room for View all', () => {
    expect(contentBudgetForRows(5)).toBe(190)
    expect(rowsToShow(3, contentBudgetForRows(5))).toBe(3)
    expect(rowsToShow(17, contentBudgetForRows(5))).toBe(3)
    expect(rowsToShow(17, Number.POSITIVE_INFINITY)).toBe(17)
  })
})

describe('widget titles and sizing', () => {
  it('gives data widgets plain titles', () => {
    expect(autoTitle({ type: 'task_list', config: { scope: 'queue' } } as never)).toBe('Team queue')
    expect(autoTitle({ type: 'task_list', config: { scope: 'mine' } } as never)).toBe('My tasks')
    expect(autoTitle({ type: 'chart', config: { source: 'tasks', group_by: 'status' } } as never)).toBe('Tasks by status')
    expect(widgetTitle({ type: 'metric', config: {}, title: null } as never)).toBeNull()
    const list = newWidget('task_list', [])
    expect(list).toMatchObject({ title: 'My tasks', height: 'auto' })
  })
  it('caps auto height: explicit max, else the saved size for older widgets, never for charts', () => {
    expect(autoHeightCap({ type: 'task_list', h: 6, height: 'auto', max_h: 10 })).toBe(10)
    expect(autoHeightCap({ type: 'task_list', h: 9 })).toBe(9)
    expect(autoHeightCap({ type: 'task_list', h: 9, height: 'fixed' })).toBeNull()
    expect(autoHeightCap({ type: 'chart', h: 7, height: 'auto' })).toBeNull()
  })
})

describe('formatting and previews', () => {
  it('durations in two units', () => {
    expect(formatDurationParts(45 * 60_000)).toBe('45m')
    expect(formatDurationParts((3 * 60 + 20) * 60_000)).toBe('3h 20m')
    expect(formatDurationParts((2 * 24 + 4) * 3_600_000)).toBe('2d 4h')
    expect(formatDurationParts(-1)).toBe('—')
  })
  it('CSV rows from what a widget loaded', () => {
    expect(widgetCsvRows({ type: 'chart', points: [{ key: 'todo', label: 'Todo', value: 3 }], value_label: 'Tasks', group_by: 'status', interval: 'day', truncated: false } as never)).toEqual([{ group: 'Todo', Tasks: 3 }])
    expect(widgetCsvRows({ type: 'empty', reason: 'x' } as never)).toBeNull()
    const rows = widgetCsvRows({ type: 'task_list', total: 1, tasks: [{ id: 't', title: 'Approve PO', status: 'todo', priority: 'high', due_date: null, overdue: false, process: null, team: 'Ops', tags: ['a'] }] } as never)
    expect(rows?.[0]).toMatchObject({ title: 'Approve PO', team: 'Ops', tags: 'a' })
  })
  it('task quick view previews the form fields with values, never secrets', () => {
    const out = fieldPreview({
      fields: [{ key: 'amount', label: 'Amount', type: 'number' }, { key: 'api_password', label: 'Password', type: 'text' }, { key: 'note', label: 'Note', type: 'text' }, { key: 'h', label: 'Section', type: 'heading' }],
      template_values: { amount: 1250, api_password: 'hunter2', note: '' },
    })
    expect(out).toEqual([{ key: 'amount', label: 'Amount', type: 'number', value: 1250 }])
  })
})

describe('icons', () => {
  it('the spec rejects icons the app cannot draw, in plain language', () => {
    const bad = compileAppSpec({ app: { name: 'Ops', icon: 'Robot' }, pages: [{ title: 'Home', icon: 'house', widgets: [{ type: 'metric', title: 'Open', config: { icon: 'Sparkle' } }] }] }, null)
    expect(bad.ok).toBe(false)
    if (bad.ok) return
    expect(bad.errors.some((e) => e.startsWith('app.icon: "Robot" is not an icon'))).toBe(true)
    expect(bad.errors.some((e) => /write it as "House"/.test(e))).toBe(true)
    expect(bad.errors.some((e) => /metric .*icon: "Sparkle"/.test(e))).toBe(true)
    const ok = compileAppSpec({ app: { name: 'Ops', icon: 'CalendarDays' }, pages: [{ title: 'Home', icon: 'House', widgets: [{ type: 'metric', title: 'Open', config: { icon: 'ListChecks' } }] }] }, null)
    expect(ok.ok).toBe(true)
  })
  it('the builder draws every icon the spec accepts', async () => {
    const { APP_ICONS, WIDGET_ICONS } = await import('@/components/apps/app-icon')
    const { BUILTIN_ICON_NAMES } = await import('@/lib/apps/icon-names')
    expect([...new Set([...Object.keys(APP_ICONS), ...Object.keys(WIDGET_ICONS)])].sort()).toEqual([...BUILTIN_ICON_NAMES].sort())
  })
})
