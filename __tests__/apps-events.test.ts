/**
 * App events → actions (lib/apps/events.ts): the one place widget events
 * (row / card / segment / button clicks, form submitted, tab and filter
 * changes) become actions (open a target in a mode, set a filter, navigate,
 * …) — the seam Phase 3 app rules plug into. Plus tab targets and their
 * governance.
 */
import { describe, expect, it } from 'vitest'
import { APP_EVENT_TYPES, buttonActions, clickActions, defaultActions, fillFilterTemplates, nextFilterValue } from '@/lib/apps/events'
import { presentLayout, widgetBindings, type ObjectFacts } from '@/lib/apps/governance'
import { WIDGET_CONFIG_SCHEMAS, normalisePageLayout } from '@/lib/apps/schema'

const FORM = '0f000000-0000-4000-8000-0000000000f1'
const REPORT = '0f000000-0000-4000-8000-0000000000e1'
const TABLE = '0f000000-0000-4000-8000-0000000000d1'

describe('events → actions', () => {
  it('click-through sets a filter (toggling) or opens a page with it set', () => {
    expect(clickActions({ filter: 'person' }, 'u1')).toEqual([{ kind: 'set_filter', filter: 'person', value: 'u1', toggle: true }])
    expect(clickActions({ filter: 'period', page: 'detail' }, { from: '2026-11-01', to: '2026-11-07' })).toEqual([{ kind: 'navigate', page: 'detail', filters: { period: '2026-11-01..2026-11-07' } }])
    expect(clickActions(null, 'x')).toEqual([])
    const set = { kind: 'set_filter' as const, filter: 'p', value: 'u1', toggle: true }
    expect(nextFilterValue(set, 'u1')).toBeNull()
    expect(nextFilterValue(set, 'u2')).toBe('u1')
  })
  it('buttons open targets in their mode, pass filter values, or run their action', () => {
    expect(buttonActions({ type: 'button_click', widget: 'b', index: 0, label: 'Pricing', action: { kind: 'open_page', page_slug: 'pricing', filters: { region: '{{filter:region}}', empty: '{{filter:none}}' } }, mode: { mode: 'panel_right', width: 'lg', motion: 'auto' } }, { region: 'emea' }))
      .toEqual([{ kind: 'open_target', target: { t: 'page', slug: 'pricing', filters: { region: 'emea' } }, mode: { mode: 'panel_right', width: 'lg', motion: 'auto' }, title: 'Pricing' }])
    expect(buttonActions({ type: 'button_click', widget: 'b', index: 2, label: 'Next', action: { kind: 'claim_next', team: 'my_teams' } })).toEqual([{ kind: 'claim_next', widget: 'b', index: 2 }])
    expect(buttonActions({ type: 'button_click', widget: 'b', index: 0, label: 'F', action: { kind: 'new_submission', form_id: FORM, open: 'modal' } })[0]).toMatchObject({ kind: 'open_target', target: { t: 'form', id: FORM }, mode: { mode: 'modal' } })
    expect(fillFilterTemplates({ a: '{{filter:x}}' }, {})).toBeUndefined()
  })
  it('every event type has a mapping (tab changes do nothing by default)', () => {
    expect(APP_EVENT_TYPES).toHaveLength(7)
    expect(defaultActions({ type: 'tab_changed', widget: 't', tab: 1 })).toEqual([])
    expect(defaultActions({ type: 'filter_changed', widget: '', filter: 'f', value: 'v' })).toEqual([{ kind: 'set_filter', filter: 'f', value: 'v' }])
    expect(defaultActions({ type: 'form_submitted', widget: 'f', form: FORM, then: { kind: 'navigate', page: 'thanks' } })).toEqual([{ kind: 'navigate', page: 'thanks' }])
    expect(defaultActions({ type: 'card_click', widget: 'c', value: 'x', click: { filter: 'k' } })[0]).toMatchObject({ kind: 'set_filter' })
  })
})

describe('tab targets', () => {
  const tabs = normalisePageLayout({ widgets: [{ id: 'tabs', type: 'tabs', w: 12, h: 8, config: WIDGET_CONFIG_SCHEMAS.tabs.parse({ style: 'pills', tabs: [
    { label: 'Request', target: { kind: 'form', form_id: FORM } },
    { label: 'Report', icon: 'ChartPie', badge: 'queue', target: { kind: 'report', report_id: REPORT } },
    { label: 'Vendors', target: { kind: 'table', table_id: TABLE } },
    { label: 'Site', target: { kind: 'url', url: 'https://maps.example.com' } },
    { label: 'Widgets', widgets: [] },
  ] }) }] })
  const facts = (perms: string[], shared = true): ObjectFacts => ({ can: (p) => perms.includes(p), formGrants: new Set([FORM]), exists: { form: new Set([FORM]), workflow: new Set(), data_table: new Set([TABLE]), report: new Set([REPORT]) }, visibleReports: new Set(shared ? [REPORT] : []) })
  const labels = (l: ReturnType<typeof presentLayout>) => ((l.widgets[0]?.config as { tabs: Array<{ label: string }> })?.tabs ?? []).map((t) => t.label)
  it('defaults and validation', () => {
    expect(WIDGET_CONFIG_SCHEMAS.tabs.parse({})).toMatchObject({ style: 'underline', lazy: true, remember: true })
    expect(WIDGET_CONFIG_SCHEMAS.tabs.safeParse({ tabs: [{ label: 'x', target: { kind: 'url', url: 'http://x' } }] }).success).toBe(false)
  })
  it('tabs whose target the viewer can’t use are hidden; viewers get no form tab', () => {
    expect(labels(presentLayout(tabs, facts(['forms.submit', 'reports.view', 'data.view']), 'contributor'))).toEqual(['Request', 'Report', 'Vendors', 'Site', 'Widgets'])
    expect(labels(presentLayout(tabs, facts(['forms.submit', 'reports.view', 'data.view']), 'viewer'))).toEqual(['Report', 'Vendors', 'Site', 'Widgets'])
    expect(labels(presentLayout(tabs, facts(['forms.submit'], false), 'contributor'))).toEqual(['Request', 'Site', 'Widgets'])
  })
  it('the access analysis sees tab targets', () => {
    expect(widgetBindings(tabs.widgets[0]).objects.map((o) => `${o.kind}:${o.need}`)).toEqual(['form:submit', 'report:view', 'data_table:view'])
  })
})
