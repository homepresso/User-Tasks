import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { nextStableHeight, wholePx } from '@/components/home/activity/measure'

/**
 * Regression: the Home "Tasks completed" / "Time to complete" charts shook on
 * wide screens. The plot box was `overflow-auto` and sized by its content
 * (ResponsiveContainer minHeight): at fractional widths the chart overflowed
 * by a sub-pixel, a scrollbar appeared, the chart re-measured narrower, the
 * scrollbar went away, and round it went. Plots now sit in an absolutely
 * bounded, overflow-hidden box, and measurements settle after one pass.
 */
const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8')

describe('Home chart measurement', () => {
  it('rounds to whole pixels', () => {
    expect(wholePx(119.6)).toBe(120)
    expect(wholePx(120)).toBe(120)
    expect(wholePx(120.004)).toBe(120)
    expect(wholePx(Number.NaN)).toBe(0)
    expect(wholePx(-3)).toBe(0)
  })

  it('reports the first measurement, then ignores ±1px wobble', () => {
    let last: number | null = null
    const reported: number[] = []
    for (const px of [180.4, 181.2, 180.6, 181.9, 180.1, 181.4]) {
      const next = nextStableHeight(last, px)
      if (next !== null) { last = next; reported.push(next) }
    }
    expect(reported).toEqual([181])
  })

  it('still reports real changes (expanding, content growing)', () => {
    expect(nextStableHeight(181, 260)).toBe(260)
    expect(nextStableHeight(181, 178)).toBe(178)
    expect(nextStableHeight(null, 0)).toBeNull()
  })
})

describe('Home chart plot box', () => {
  it('bounds the plot instead of letting the chart size (or scroll) its own box', () => {
    const card = read('components/home/activity/chart-card.tsx')
    expect(card).toMatch(/relative mt-3 min-h-0 min-w-0 flex-1/)
    expect(card).toMatch(/role="figure" className="absolute inset-0 overflow-hidden"/)
    expect(card).not.toMatch(/min-h-0 flex-1 overflow-auto/)
  })

  it('charts use a debounced ResponsiveContainer without a content-driven min height', () => {
    const charts = read('components/home/activity/charts.tsx')
    expect(charts).not.toMatch(/minHeight=\{/)
    expect(charts).toMatch(/debounce: \d+/)
    expect(charts).toMatch(/minWidth: 0/)
  })

  it('the grid CSS lives with Home, not in globals', () => {
    expect(read('app/globals.css')).not.toMatch(/\.home-grid/)
    expect(read('components/home/home-grid.css')).toMatch(/\.home-grid-inner/)
    expect(read('app/(dashboard)/home/page.tsx')).toMatch(/home-grid\.css/)
  })
})
