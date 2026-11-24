import { describe, expect, it } from 'vitest'
import {
  WIDGET_CONFIG_SCHEMAS, WIDGET_TYPES, appCreateSchema, menuItemSchema, normaliseMenu, normalisePageFilters, normalisePageLayout,
  pageLayoutSchema, slugFrom, uniqueSlug, widgetSchema, type PageFilter,
} from '@/lib/apps/schema'
import {
  WIDGET_CATALOG, appGridDefs, boundFilters, decodeFilterValue, encodeFilterValue, filterValuesFromParams, isDataWidget, newWidget,
  previousRange, resolveBindings, resolveDateRange, DATE_PRESET_LABELS,
} from '@/lib/apps/widgets'
import { clampItem, resizeWidget, spanFor } from '@/lib/home/layout'

const U1 = '11111111-1111-4111-8111-111111111111'
const F1 = '22222222-2222-4222-8222-222222222222'

describe('app config schemas', () => {
  it('every widget type has a catalogue entry, a default config and valid bounds', () => {
    expect(WIDGET_CATALOG.map((e) => e.type).sort()).toEqual([...WIDGET_TYPES].sort())
    for (const e of WIDGET_CATALOG) {
      expect(() => WIDGET_CONFIG_SCHEMAS[e.type].parse({})).not.toThrow()
      expect(e.minW).toBeLessThanOrEqual(e.w)
      expect(e.w).toBeLessThanOrEqual(e.maxW)
      expect(e.minH).toBeLessThanOrEqual(e.h)
      expect(e.h).toBeLessThanOrEqual(e.maxH)
      expect(e.maxW).toBeLessThanOrEqual(12)
    }
  })

  it('a widget picks its config schema by type and rejects unknown keys', () => {
    expect(widgetSchema.safeParse({ id: 'tasks-1', type: 'task_list', w: 6, h: 8, config: { scope: 'team', team: 'my_teams', limit: 5 } }).success).toBe(true)
    expect(widgetSchema.safeParse({ id: 'tasks-1', type: 'task_list', w: 6, h: 8, config: { scope: 'everyone' } }).success).toBe(false)
    expect(widgetSchema.safeParse({ id: 'tasks-1', type: 'task_list', w: 6, h: 8, config: { sql: 'select 1' } }).success).toBe(false)
    expect(widgetSchema.safeParse({ id: 'x', type: 'iframe', w: 6, h: 8, config: {} }).success).toBe(false)
  })

  it('inputs accept me / my_teams / ids / page-filter references only', () => {
    const tl = WIDGET_CONFIG_SCHEMAS.task_list
    expect(tl.safeParse({ assignee: 'me' }).success).toBe(true)
    expect(tl.safeParse({ assignee: U1 }).success).toBe(true)
    expect(tl.safeParse({ assignee: { filter: 'person' } }).success).toBe(true)
    expect(tl.safeParse({ assignee: 'bob' }).success).toBe(false)
    expect(tl.safeParse({ team: 'my_teams' }).success).toBe(true)
    expect(tl.safeParse({ date_range: { preset: '30d' } }).success).toBe(true)
    expect(tl.safeParse({ date_range: { preset: 'forever' } }).success).toBe(false)
  })

  it('buttons, links and images only take safe addresses', () => {
    const actions = WIDGET_CONFIG_SCHEMAS.actions
    expect(actions.safeParse({ buttons: [{ label: 'New', action: { kind: 'new_submission', form_id: F1, open: 'modal' } }] }).success).toBe(true)
    expect(actions.safeParse({ buttons: [{ label: 'Go', action: { kind: 'open_url', url: 'javascript:alert(1)' } }] }).success).toBe(false)
    expect(actions.safeParse({ buttons: [{ label: 'Go', action: { kind: 'open_url', url: '//evil.example' } }] }).success).toBe(false)
    expect(actions.safeParse({ buttons: [{ label: 'Go', action: { kind: 'open_url', url: '/tasks' } }] }).success).toBe(true)
    expect(WIDGET_CONFIG_SCHEMAS.image.safeParse({ url: 'http://insecure.example/a.png' }).success).toBe(false)
    expect(WIDGET_CONFIG_SCHEMAS.links.safeParse({ links: [{ label: 'x', url: 'data:text/html,hi' }] }).success).toBe(false)
    expect(menuItemSchema.safeParse({ kind: 'url', label: 'Docs', url: 'https://example.com' }).success).toBe(true)
  })

  it('a layout with duplicate widget ids is refused; a stored one drops bad widgets instead of failing', () => {
    const w = { id: 'a', type: 'heading', w: 12, h: 2, config: { text: 'Hi' } }
    expect(pageLayoutSchema.safeParse({ widgets: [w, w] }).success).toBe(false)
    const out = normalisePageLayout({ widgets: [w, w, { id: 'b', type: 'nope', w: 1, h: 1 }, { id: 'c', type: 'metric', w: 3, h: 3, config: { source: 'x' } }, { id: 'd', type: 'text', w: 4, h: 4 }] })
    expect(out.widgets.map((x) => x.id)).toEqual(['a', 'd'])
    expect(normalisePageLayout(null)).toEqual({ widgets: [] })
    expect(normalisePageLayout('junk')).toEqual({ widgets: [] })
  })

  it('filters and menus normalise (unique ids, valid kinds)', () => {
    expect(normalisePageFilters([{ id: 'p', kind: 'user', label: 'Person', default: 'me' }, { id: 'p', kind: 'team', label: 'T' }, { id: 'Bad id', kind: 'user', label: 'x' }]).map((f) => f.id)).toEqual(['p'])
    expect(normaliseMenu([{ kind: 'url', label: 'A', url: 'https://a.example' }, { kind: 'url', label: 'B', url: 'ftp://b' }])).toHaveLength(1)
  })

  it('app input: name required, slug and colour validated', () => {
    expect(appCreateSchema.safeParse({ name: 'Claims', subtitle: 'Team hub', color: '#2563eb' }).success).toBe(true)
    expect(appCreateSchema.safeParse({ name: '' }).success).toBe(false)
    expect(appCreateSchema.safeParse({ name: 'x', slug: 'Bad Slug' }).success).toBe(false)
    expect(appCreateSchema.safeParse({ name: 'x', color: 'red' }).success).toBe(false)
    expect(appCreateSchema.safeParse({ name: 'x', audience: [{ type: 'group', id: U1 }] }).success).toBe(false)
  })

  it('slugs from names, unique within the taken set', () => {
    expect(slugFrom('Customer Service Hub!')).toBe('customer-service-hub')
    expect(slugFrom('Café Ops')).toBe('cafe-ops')
    expect(slugFrom('!!!')).toBe('app')
    expect(uniqueSlug('hub', ['hub', 'hub-2'])).toBe('hub-3')
    expect(uniqueSlug('hub', [])).toBe('hub')
  })
})

describe('widget catalogue and bindings', () => {
  const filters: PageFilter[] = [
    { id: 'person', kind: 'user', label: 'Person', default: 'me' },
    { id: 'period', kind: 'date_range', label: 'Period', default: { preset: '30d' } },
  ]

  it('new widgets get unique ids and their default size', () => {
    const a = newWidget('metric', [])
    const b = newWidget('metric', [a.id])
    expect(a.id).not.toBe(b.id)
    expect([a.w, a.h]).toEqual([3, 2])
    expect(isDataWidget('metric')).toBe(true)
    expect(isDataWidget('heading')).toBe(false)
  })

  it('page filters resolve into widget inputs (one filter drives several widgets)', () => {
    const config = WIDGET_CONFIG_SCHEMAS.task_list.parse({ assignee: { filter: 'person' }, date_range: { filter: 'period' } })
    expect(boundFilters(config as Record<string, unknown>).sort()).toEqual(['period', 'person'])
    const resolved = resolveBindings('task_list', config, { person: U1, period: { preset: '7d' } })
    expect(resolved.assignee).toBe(U1)
    expect(resolved.date_range).toEqual({ preset: '7d' })
    // A missing / empty filter means "any"; a value that doesn't fit the input is dropped, not trusted.
    expect(resolveBindings('task_list', config, {}).assignee).toBeNull()
    expect(resolveBindings('task_list', config, { person: 'not-a-user' }).assignee).toBeNull()
  })

  it('filter values round-trip through the URL', () => {
    expect(encodeFilterValue({ preset: '30d' })).toBe('30d')
    expect(decodeFilterValue('date_range', '30d')).toEqual({ preset: '30d' })
    expect(decodeFilterValue('date_range', '2026-01-01..2026-01-31')).toEqual({ from: '2026-01-01', to: '2026-01-31' })
    expect(decodeFilterValue('date_range', 'garbage')).toBeNull()
    const values = filterValuesFromParams(filters, (n) => (n === 'f.person' ? U1 : null))
    expect(values).toEqual({ person: U1, period: { preset: '30d' } })
  })

  it('date ranges and the previous period', () => {
    const now = new Date('2026-11-21T12:00:00Z')
    const r = resolveDateRange({ preset: '7d' }, now)
    expect(r.from?.toISOString()).toBe('2026-11-14T12:00:00.000Z')
    expect(resolveDateRange({ preset: 'this_month' }, now).from?.toISOString()).toBe('2026-11-01T00:00:00.000Z')
    expect(resolveDateRange({ from: '2026-11-01', to: '2026-11-02' }).to?.toISOString()).toBe('2026-11-03T00:00:00.000Z')
    expect(previousRange(r, now)?.from?.toISOString()).toBe('2026-11-07T12:00:00.000Z')
    expect(previousRange({ from: null, to: null }, now)).toBeNull()
  })

  it('calendar presets have both bounds; quarters are supported', () => {
    const now = new Date('2026-11-21T12:00:00Z')
    const iso = (r: { from: Date | null; to: Date | null }) => [r.from?.toISOString().slice(0, 10), r.to?.toISOString().slice(0, 10)]
    expect(iso(resolveDateRange({ preset: 'this_month' }, now))).toEqual(['2026-11-01', '2026-12-01'])
    expect(iso(resolveDateRange({ preset: 'this_quarter' }, now))).toEqual(['2026-10-01', '2027-01-01'])
    expect(iso(resolveDateRange({ preset: 'last_quarter' }, now))).toEqual(['2026-07-01', '2026-10-01'])
    expect(iso(resolveDateRange({ preset: 'this_year' }, now))).toEqual(['2026-01-01', '2027-01-01'])
    expect(iso(resolveDateRange({ preset: 'last_quarter' }, new Date('2026-02-03T00:00:00Z')))).toEqual(['2025-10-01', '2026-01-01'])
    expect(DATE_PRESET_LABELS.this_quarter).toBe('This quarter')
    expect(DATE_PRESET_LABELS.last_quarter).toBe('Last quarter')
    expect(decodeFilterValue('date_range', 'this_quarter')).toEqual({ preset: 'this_quarter' })
    expect(decodeFilterValue('date_range', 'last_quarter')).toEqual({ preset: 'last_quarter' })
    // A period in progress compares to-date with the same length before it.
    const month = resolveDateRange({ preset: 'this_month' }, now)
    expect(iso(previousRange(month, now)!)).toEqual(['2026-10-11', '2026-11-01'])
    // A finished quarter compares with the quarter's length before it.
    const lq = resolveDateRange({ preset: 'last_quarter' }, now)
    expect(previousRange(lq, now)!.to?.toISOString().slice(0, 10)).toBe('2026-07-01')
  })

  it('Home’s grid math works with an app page’s lookup', () => {
    const widgets = [newWidget('chart', []), newWidget('heading', [])]
    const defs = appGridDefs(widgets)
    // New data widgets start with a sensible title (lib/apps/widgets.ts autoTitle): the handle shows it.
    expect(widgets[0].title).toBe('Tasks per day')
    expect(defs(widgets[0].id)?.title).toBe('Tasks per day')
    expect(clampItem(widgets[0].id, 99, 0, defs)).toEqual({ id: widgets[0].id, w: 12, h: 4 })
    expect(spanFor({ id: widgets[0].id, w: 6, h: 7 }, 6, defs)).toBe(3)
    const resized = resizeWidget({ items: widgets }, widgets[1].id, 1, 1, defs)
    expect(resized.items[1]).toMatchObject({ w: 2, h: 1, type: 'heading' })
  })
})
