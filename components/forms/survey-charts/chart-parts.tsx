'use client'

/**
 * Building blocks of the survey charts: theme-resolved colours (the chart
 * palette resolver, components/home/activity/segmented-bar.tsx — validated
 * for contrast and colour-vision separation against the workspace's light /
 * dark card), a sequential ramp (one hue, light → dark), a diverging ramp
 * (two poles, a neutral grey middle), horizontal bars, a stacked bar with
 * 2px gaps and focusable parts (name, count and share on hover / focus) and
 * the legend. Text stays in text tokens; colour only marks identity.
 */

import { useState } from 'react'
import { useSlots } from '@/components/home/activity/segmented-bar'
import { floatingSurfaceClass } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

export const fmt = (n: number | null | undefined, places = 1) => (n == null ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: places }))
export const pct = (n: number, of: number) => (of ? (n / of) * 100 : 0)

/** Two series hues (the diverging poles: [negative, positive]) and the neutral grey, from the workspace theme. */
export function useSurveyColors() {
  const [positive, negative] = useSlots([{ role: 'series', prefer: 0 }, { role: 'series', prefer: 1 }])
  // The diverging midpoint is always a grey (never a hue): the theme's muted text toned toward the card.
  const neutral = 'color-mix(in srgb, var(--theme-muted-text) 60%, var(--theme-card-bg))'
  /** One hue, `n` steps light → dark (magnitude: counts per point). */
  const sequential = (n: number, hue = positive) => Array.from({ length: n }, (_, i) => `color-mix(in srgb, ${hue} ${Math.round(35 + (65 * (i + 1)) / Math.max(1, n))}%, var(--theme-card-bg))`)
  /** `n` points from the negative pole through grey (odd n) to the positive pole; stronger toward the ends. */
  const diverging = (n: number) => Array.from({ length: n }, (_, i) => {
    const mid = (n - 1) / 2
    if (n % 2 === 1 && i === mid) return neutral
    const strength = Math.abs(i - mid) / Math.max(0.5, mid)
    const hue = i < mid ? negative : positive
    return `color-mix(in srgb, ${hue} ${Math.round(45 + 55 * strength)}%, var(--theme-card-bg))`
  })
  return { positive, negative, neutral, sequential, diverging }
}

export interface Part { key: string; label: string; value: number; color: string }

/**
 * One whole split into parts: 12px tall, 2px surface gaps, 4px rounded
 * outer ends; every part focusable with its name, count and share.
 * `offset` (0–100) shifts the bar right (diverging bars centred on neutral).
 */
export function StackedBar({ parts, label, height = 12, offset = 0, width = 100 }: { parts: Part[]; label: string; height?: number; offset?: number; width?: number }) {
  const [active, setActive] = useState<string | null>(null)
  const total = parts.reduce((a, p) => a + p.value, 0)
  const shown = parts.filter((p) => p.value > 0)
  const current = shown.find((p) => p.key === active)
  return (
    <div className="relative w-full">
      <div className="flex gap-[2px]" style={{ marginLeft: `${offset}%`, width: `${width}%`, height }} role="list" aria-label={label}>
        {shown.map((p, i) => (
          <div key={p.key} role="listitem" tabIndex={0}
            aria-label={`${p.label}: ${p.value} (${fmt(pct(p.value, total), 0)}%)`}
            onPointerEnter={() => setActive(p.key)} onPointerLeave={() => setActive(null)} onFocus={() => setActive(p.key)} onBlur={() => setActive(null)}
            className={cn('min-w-[3px] hover:brightness-110', i === 0 && 'rounded-l', i === shown.length - 1 && 'rounded-r')}
            style={{ flexGrow: p.value, flexBasis: 0, backgroundColor: p.color }} data-part={p.key} />
        ))}
        {shown.length === 0 && <div className="flex-1 rounded bg-muted" aria-hidden />}
      </div>
      {current && (
        <div role="status" className={cn(floatingSurfaceClass, 'pointer-events-none absolute left-0 top-full z-20 mt-1 px-2 py-1 text-xs')}>
          <span className="num font-medium">{current.value}</span>
          <span className="text-fg-muted"> · {fmt(pct(current.value, total), 0)}% · {current.label}</span>
        </div>
      )}
    </div>
  )
}

export function Legend({ items }: { items: Array<{ label: string; color: string; value?: string }> }) {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1" aria-hidden data-survey-legend>
      {items.map((i) => (
        <li key={i.label} className="flex min-w-0 items-center gap-1.5 text-xs text-fg">
          <span className="inline-block size-2 shrink-0 rounded-full" style={{ backgroundColor: i.color }} />
          <span className="truncate">{i.label}</span>
          {i.value && <span className="num text-fg-muted">{i.value}</span>}
        </li>
      ))}
    </ul>
  )
}

/**
 * Horizontal bars, one per category (label, bar, count and share): the
 * default for counts. Bars scale to the largest; 4px rounded data ends.
 */
export function HBars({ rows, color, total, label, valueText }: {
  rows: Array<{ key: string; label: React.ReactNode; value: number; color?: string; text?: string }>
  color: string
  total: number
  label: string
  /** The value column (default: count · share). */
  valueText?: (value: number) => string
}) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <ul className="space-y-1.5" aria-label={label} data-survey-bars>
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(4rem,9rem)_1fr_auto] items-center gap-2 text-xs" title={`${typeof r.label === 'string' ? r.label : r.key}: ${r.value}`}>
          <span className="truncate text-fg">{r.label}</span>
          <span className="h-3 rounded-r bg-subtle" aria-hidden>
            <span className="block h-full rounded-r" style={{ width: `${(r.value / max) * 100}%`, minWidth: r.value ? 3 : 0, backgroundColor: r.color ?? color }} />
          </span>
          <span className="num min-w-14 text-right text-fg-muted">{r.text ?? (valueText ? valueText(r.value) : `${r.value} · ${fmt(pct(r.value, total), 0)}%`)}</span>
        </li>
      ))}
    </ul>
  )
}

/** Vertical columns (a distribution over a scale: NPS 0–10, slider histogram, responses per day). */
export function Columns({ rows, colors, label, height = 96, showLabels = true }: {
  rows: Array<{ key: string; label: string; value: number }>
  colors: string[] | string
  label: string
  height?: number
  showLabels?: boolean
}) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <div aria-label={label} role="list" data-survey-columns>
      <div className="flex items-end gap-[2px] border-b" style={{ height, borderColor: 'var(--ds-border)' }}>
        {rows.map((r, i) => (
          <div key={r.key} role="listitem" tabIndex={0} aria-label={`${r.label}: ${r.value}`} title={`${r.label}: ${r.value}`}
            className="min-w-[3px] flex-1 rounded-t hover:brightness-110"
            style={{ height: `${(r.value / max) * 100}%`, minHeight: r.value ? 3 : 0, backgroundColor: Array.isArray(colors) ? colors[i % colors.length] : colors }} />
        ))}
      </div>
      {showLabels && (
        <div className="mt-1 flex gap-[2px] text-center text-2xs text-fg-muted" aria-hidden>
          {rows.map((r) => <span key={r.key} className="num min-w-0 flex-1 truncate">{r.label}</span>)}
        </div>
      )}
    </div>
  )
}

/** A big number with a caption (CSAT %, NPS, an average). */
export function Hero({ value, caption, tone }: { value: string; caption: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <p className="num text-3xl font-semibold leading-none text-fg" style={tone ? { color: tone } : undefined}>{value}</p>
      <p className="mt-1 text-xs text-fg-muted">{caption}</p>
    </div>
  )
}
