/**
 * Pure helpers behind the Phase 2 app widgets and navigation: button styles
 * (theme tokens only) and shortcuts, menu search and badges, form embed
 * prefill, announcement dates, CSV export (formula injection), gauge
 * position, calendar grid.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/app/actions/apps', () => ({}))
vi.mock('@/app/actions/home', () => ({}))

import { buttonStyle, matchesShortcut } from '@/components/apps/widgets/action-buttons'
import { announcementLive, prefillQuery, toCsv } from '@/components/apps/widgets/content-widgets'
import { gaugePosition } from '@/components/apps/widgets/insight-widgets'
import { calendarDays } from '@/components/apps/widgets/task-widgets'
import { collectBadges, filterMenu } from '@/components/apps/nav-menu'
import { normaliseMenu } from '@/lib/apps/schema'

describe('buttons', () => {
  it('variant × colour use theme tokens only', () => {
    const css = [buttonStyle({ style: 'primary', color: 'app' }), buttonStyle({ style: 'outline', color: 'success' }), buttonStyle({ style: 'danger', color: 'theme' })]
    for (const c of css) for (const v of Object.values(c)) if (typeof v === 'string' && v.includes('#')) expect(['#fff', '#000'].some((x) => v.includes(x))).toBe(true)
    expect(css[0].background).toContain('--app-accent')
    expect(css[1].borderColor).toContain('--color-success')
    expect(css[2].background).toContain('--color-danger')
  })
  it('shortcuts match exactly (no Ctrl / Cmd chords)', () => {
    expect(matchesShortcut({ key: 'n', altKey: true, shiftKey: false, ctrlKey: false, metaKey: false }, 'alt+n')).toBe(true)
    expect(matchesShortcut({ key: 'n', altKey: false, shiftKey: false, ctrlKey: false, metaKey: false }, 'alt+n')).toBe(false)
    expect(matchesShortcut({ key: 'n', altKey: true, shiftKey: false, ctrlKey: true, metaKey: false }, 'alt+n')).toBe(false)
  })
})

describe('navigation helpers', () => {
  const menu = normaliseMenu([
    { kind: 'group', label: 'Admin', items: [{ kind: 'page', label: 'Pricing', page_slug: 'pricing', badge: 'queue' }, { kind: 'url', label: 'Docs', url: 'https://example.com' }] },
    { kind: 'tasks', label: 'My tasks', view: 'mine', badge: 'my_tasks' },
  ])
  it('menu search keeps groups with matches, opened', () => {
    const r = filterMenu(menu, 'pric')
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ kind: 'group', collapsed: false })
    expect((r[0] as { items: unknown[] }).items).toHaveLength(1)
    expect(filterMenu(menu, '')).toHaveLength(2)
  })
  it('badge sources are collected from nested entries', () => {
    expect(collectBadges(menu).sort()).toEqual(['my_tasks', 'queue'])
  })
})

describe('widgets', () => {
  it('form prefill from the viewer, page filters and fixed values', () => {
    expect(prefillQuery([{ field: 'name', from: 'me_name' }, { field: 'region', from: 'filter', filter: 'region' }, { field: 'src', from: 'value', value: 'app' }, { field: 'none', from: 'filter', filter: 'missing' }],
      { filters: { region: 'emea' }, me: { name: 'Sam' } })).toEqual({ name: 'Sam', region: 'emea', src: 'app' })
  })
  it('announcements show only between their dates', () => {
    expect(announcementLive({ starts_on: '2026-11-01', ends_on: '2026-11-30' }, '2026-11-21')).toBe(true)
    expect(announcementLive({ starts_on: '2026-12-01' }, '2026-11-21')).toBe(false)
    expect(announcementLive({ ends_on: '2026-11-20' }, '2026-11-21')).toBe(false)
  })
  it('CSV export escapes quotes and neutralises formulas', () => {
    const csv = toCsv([{ a: '=HYPERLINK("x")', b: 'plain, text', c: 3 }])
    expect(csv.split('\r\n')[0]).toBe('a,b,c')
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`)
    expect(csv).toContain('"plain, text"')
  })
  it('gauge position and tone', () => {
    expect(gaugePosition(50, { min: 0, max: 100, warn_at: 70, danger_at: 90, higher_is_better: false })).toEqual({ at: 0.5, tone: 'success' })
    expect(gaugePosition(95, { min: 0, max: 100, warn_at: 70, danger_at: 90, higher_is_better: false }).tone).toBe('danger')
    expect(gaugePosition(20, { min: 0, max: 100, warn_at: 40, danger_at: 10, higher_is_better: true }).tone).toBe('warning')
    expect(gaugePosition(500, { min: 0, max: 100, higher_is_better: true }).at).toBe(1)
  })
  it('calendar grid starts on Monday', () => {
    const days = calendarDays('2026-11', 'month')
    expect(days[0]).toBe('2026-10-26')
    expect(days.length % 7).toBe(0)
    expect(calendarDays('2026-11', 'week', new Date('2026-11-21T12:00:00Z'))).toHaveLength(7)
  })
})
