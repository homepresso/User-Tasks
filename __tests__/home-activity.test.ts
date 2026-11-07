/**
 * Home → My activity, pure parts: period parsing, duration / share
 * formatting, bucket labels, normalising the SQL payload, and the
 * theme-derived chart palette (runtime separation checks + fallback).
 */
import { describe, expect, it } from 'vitest'
import {
  bucketLabel, durationAxisUnit, formatShare, humaniseDuration, normaliseSubmissionStats, normaliseTaskStats, parseStatsPeriod,
} from '@/lib/home/activity'
import { contrastOn, CONTRAST_MIN, CVD_FLOOR, NORMAL_FLOOR, REFERENCE_SERIES, resolveSlots, resolveSlotsDetailed, separation, type ChartTheme } from '@/lib/home/chart-palette'
import { defaultWorkspaceTheme, presetToWorkspaceTheme, THEME_TEMPLATES } from '@/lib/theme/presets'

describe('periods', () => {
  it('accepts 7 / 30 / 90 in any spelling and defaults to 30', () => {
    expect(parseStatsPeriod('7d')).toBe(7)
    expect(parseStatsPeriod(90)).toBe(90)
    expect(parseStatsPeriod('30')).toBe(30)
    expect(parseStatsPeriod('45d')).toBe(30)
    expect(parseStatsPeriod(undefined)).toBe(30)
    expect(parseStatsPeriod('abc')).toBe(30)
  })
})

describe('formatting', () => {
  it('humanises durations', () => {
    expect(humaniseDuration(null)).toBe('—')
    expect(humaniseDuration(20, 'en')).toBe('< 1 m')
    expect(humaniseDuration(45 * 60, 'en')).toBe('45 m')
    expect(humaniseDuration(2 * 3600 + 15 * 60, 'en')).toBe('2 h 15 m')
    expect(humaniseDuration(3 * 3600, 'en')).toBe('3 h')
    expect(humaniseDuration(24 * 3600, 'en')).toBe('1 day')
    expect(humaniseDuration(28 * 3600, 'en')).toBe('1 day 4 h')
    expect(humaniseDuration(47.9 * 3600, 'en')).toBe('2 days')
    expect(humaniseDuration(3 * 86_400, 'en')).toBe('3 days')
    expect(humaniseDuration(3.5 * 86_400, 'en')).toBe('3.5 days')
    expect(humaniseDuration(12.4 * 86_400, 'en')).toBe('12 days')
    expect(humaniseDuration(3.5 * 86_400, 'de')).toBe('3,5 days')
  })

  it('formats shares and bucket labels in the locale', () => {
    expect(formatShare(0.7812, 'en')).toBe('78%')
    expect(formatShare(null)).toBe('—')
    expect(bucketLabel('2026-11-04', 'day', 'en-GB')).toBe('4 Nov')
    expect(bucketLabel('2026-11-02', 'week', 'en-GB', 'long')).toBe('Week of 2 Nov')
    expect(bucketLabel('2026-11-04', 'day', 'en-GB', 'long')).toBe('Wed 4 Nov')
  })

  it('picks a y-axis unit for durations', () => {
    expect(durationAxisUnit(90 * 60).unit).toBe('m')
    expect(durationAxisUnit(5 * 3600).unit).toBe('h')
    expect(durationAxisUnit(4 * 86_400).unit).toBe('d')
  })
})

describe('payload normalising', () => {
  it('coerces numerics and fills defaults', () => {
    const t = normaliseTaskStats({
      period: { days: 7, unit: 'day', timezone: 'UTC', start: '2026-10-29', end: '2026-11-04' },
      completed: { total: '3', buckets: [{ start: '2026-11-04', count: '3', median_s: '3600', p90_s: null }] },
      decisions: { total: 2, approved: 1, approval_rate: '0.5000', groups: [{ kind: 'approve', label: 'Approved', count: '1' }] },
    })
    expect(t.completed).toEqual({ total: 3, buckets: [{ start: '2026-11-04', count: 3, median_s: 3600, p90_s: null }] })
    expect(t.decisions.approval_rate).toBe(0.5)
    expect(t.decisions.rejected).toBe(0)
    expect(t.durations.pickup).toEqual({ count: 0, median_s: null, p90_s: null })
    expect(t.on_time.rate).toBeNull()
    expect(normaliseSubmissionStats({ total: '2', median_s: '60' })).toMatchObject({ total: 2, median_s: 60, p90_s: null, days: 30 })
  })
})

const themeOf = (p: ReturnType<typeof defaultWorkspaceTheme>['colors']['light']): ChartTheme =>
  ({ card: p.cardBg, primary: p.primary, accent: p.accent, chart: p.chart, success: p.success, warning: p.warning, danger: p.danger, muted: p.mutedText })

/** Every series slot clears contrast, and the normal-vision + CVD floors against the others. */
function expectSeparated(colors: string[], theme: ChartTheme, semantic: number[] = []) {
  for (const c of colors) expect(contrastOn(c, theme.card)).toBeGreaterThanOrEqual(CONTRAST_MIN - 1e-6)
  for (let i = 0; i < colors.length; i++) {
    for (let j = 0; j < i; j++) {
      const d = separation(colors[i], colors[j], theme.card)
      expect(d.normal).toBeGreaterThanOrEqual(NORMAL_FLOOR)
      if (!(semantic.includes(i) && semantic.includes(j))) expect(d.cvd).toBeGreaterThanOrEqual(CVD_FLOOR)
    }
  }
}

describe('chart palette', () => {
  const light = themeOf(defaultWorkspaceTheme().colors.light)

  it('takes the theme\'s own colours when they separate', () => {
    // Basecamp's primary is near-black: the first series is the theme's first chart colour.
    const [first] = resolveSlots([{ role: 'series', prefer: 0 }], light)
    expect(first).toBe(light.chart[0])
    // A chromatic brand colour leads.
    const blue = themeOf(presetToWorkspaceTheme('corporate-blue')!.colors.light)
    expect(resolveSlots([{ role: 'series', prefer: 0 }], blue)[0]).toBe(blue.primary)
    const [ok, late] = resolveSlots([{ role: 'success' }, { role: 'danger' }], light)
    expect(ok).toBe(light.success)
    expect(late).toBe(light.danger)
  })

  it('keeps every slot it calls ok apart, for every built-in theme, light and dark', () => {
    const decisionSlots = [{ role: 'success' as const }, { role: 'danger' as const }, { role: 'warning' as const, semantic: false },
      { role: 'series' as const, prefer: 2 }, { role: 'series' as const, prefer: 3 }]
    for (const tpl of THEME_TEMPLATES) {
      const wt = presetToWorkspaceTheme(tpl.id)!
      for (const mode of ['light', 'dark'] as const) {
        const theme = themeOf(wt.colors[mode])
        const resolved = resolveSlotsDetailed(decisionSlots, theme)
        // Approved, rejected, sent back and the first custom outcome always get colours of their own.
        expect(resolved.slice(0, 4).every((s) => s.ok)).toBe(true)
        const firstFail = resolved.findIndex((s) => !s.ok)
        expectSeparated(resolved.slice(0, firstFail === -1 ? undefined : firstFail).map((s) => s.color), theme, [0, 1])
        expectSeparated(resolveSlots([{ role: 'series', prefer: 2 }, { role: 'series', prefer: 0 }], theme), theme)
        expectSeparated(resolveSlots([{ role: 'success' }, { role: 'danger' }, { role: 'series', prefer: 0 }], theme), theme, [0, 1])
      }
    }
  })

  it('falls back to the validated reference palette when a custom theme\'s colours collide', () => {
    const muddy: ChartTheme = { card: '#ffffff', chart: Array(6).fill('#777777'), success: '#777777', warning: '#787878', danger: '#767676', muted: '#777777' }
    const colors = resolveSlots([{ role: 'series' }, { role: 'series' }, { role: 'series' }], muddy)
    expect(colors[0]).toBe('#777777')
    expect(REFERENCE_SERIES.light as readonly string[]).toContain(colors[1])
    expectSeparated(colors, muddy)
    const dark: ChartTheme = { ...muddy, card: '#101010', chart: Array(6).fill('#101010'), warning: '#141414' }
    const darkColors = resolveSlots([{ role: 'series' }, { role: 'series' }], dark)
    expect(REFERENCE_SERIES.dark as readonly string[]).toContain(darkColors[0])
  })
})
