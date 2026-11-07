/**
 * The Chart.js glue for the gallery's chart-drawing controls (<ut-chart>,
 * <ut-saved-report>): tree-shaken registration, a theme-aware palette and a
 * config builder. Pure apart from Chart.register. saved-report keeps a copy
 * of this file (controls are built independently).
 */
import {
  ArcElement, BarController, BarElement, CategoryScale, Chart, DoughnutController, Filler, Legend, LineController,
  LineElement, LinearScale, PieController, PointElement, Tooltip,
  type ChartConfiguration, type ChartDataset,
} from 'chart.js'

Chart.register(BarController, LineController, PieController, DoughnutController, BarElement, LineElement, PointElement,
  ArcElement, CategoryScale, LinearScale, Legend, Tooltip, Filler)

export { Chart }

export type ChartKind = 'bar' | 'horizontal-bar' | 'line' | 'area' | 'pie' | 'doughnut'
export const CHART_KINDS: ChartKind[] = ['bar', 'horizontal-bar', 'line', 'area', 'pie', 'doughnut']

export interface Series {
  labels: string[]
  datasets: Array<{ label: string; data: number[] }>
}

export interface ThemeColours {
  primary: string
  text: string
  muted: string
  border: string
  card: string
  font: string
  dark: boolean
}

/** Companions to the theme's primary colour: distinct hues with ≥ 3:1 contrast on the card in each mode. */
const LIGHT_COMPANIONS = ['#c2570c', '#0f7b6c', '#a3367a', '#6d4fc2', '#8a6d00', '#0b6f9c', '#b42318', '#4d7c0f']
const DARK_COMPANIONS = ['#f6a052', '#4fd1b5', '#f17ec4', '#b49cff', '#e2c044', '#5cc4f2', '#ff8a7a', '#a6d96a']

export function palette(theme: ThemeColours, custom: string[], count: number): string[] {
  const base = custom.length ? custom : [theme.primary, ...(theme.dark ? DARK_COMPANIONS : LIGHT_COMPANIONS)]
  return Array.from({ length: Math.max(1, count) }, (_, i) => base[i % base.length])
}

/** `#rrggbb` / `#rgb` / rgb() → the same colour at the given alpha (other formats unchanged). */
export function withAlpha(colour: string, alpha: number): string {
  const c = colour.trim()
  let m = /^#([0-9a-f]{3})$/i.exec(c)
  if (m) {
    const [r, g, b] = m[1].split('').map((x) => parseInt(x + x, 16))
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }
  m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(c)
  if (m) {
    const n = parseInt(m[1], 16)
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(c)
  if (m) return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${alpha})`
  return c
}

/** Resolved theme colours from the element's computed --_x variables. */
export function readTheme(el: Element, dark: boolean): ThemeColours {
  const cs = getComputedStyle(el)
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback
  return {
    primary: v('--_primary', dark ? '#7ea2ff' : '#2f5fd0'),
    text: v('--_text', dark ? '#eceae4' : '#1b1916'),
    muted: v('--_muted', dark ? '#a8a397' : '#5f5a50'),
    border: v('--_border', dark ? '#4a473f' : '#cfc9bb'),
    card: v('--_card', dark ? '#262522' : '#ffffff'),
    font: cs.fontFamily || 'system-ui, sans-serif',
    dark,
  }
}

export function reducedMotion(): boolean {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

export interface BuildOptions {
  kind: ChartKind
  series: Series
  theme: ThemeColours
  colours: string[]
  stacked: boolean
  showLegend: boolean
  locale: string
  onClick?: (datasetIndex: number, index: number) => void
}

export function buildConfig(o: BuildOptions): ChartConfiguration {
  const { kind, series, theme } = o
  const radial = kind === 'pie' || kind === 'doughnut'
  const horizontal = kind === 'horizontal-bar'
  const type = radial ? kind : kind === 'line' || kind === 'area' ? 'line' : 'bar'
  const colours = palette(theme, o.colours, radial ? series.labels.length : series.datasets.length)
  const datasets: ChartDataset[] = series.datasets.map((d, i) => {
    if (radial) {
      return { label: d.label, data: d.data, backgroundColor: colours, borderColor: theme.card, borderWidth: 2, hoverOffset: 6 } as ChartDataset
    }
    const c = colours[i % colours.length]
    if (type === 'line') {
      return {
        label: d.label, data: d.data, borderColor: c, backgroundColor: kind === 'area' ? withAlpha(c, 0.22) : c,
        fill: kind === 'area' ? (o.stacked && i > 0 ? '-1' : 'origin') : false, tension: 0.3, borderWidth: 2,
        pointRadius: 3, pointHoverRadius: 6, pointBackgroundColor: c, pointBorderColor: theme.card,
      } as ChartDataset
    }
    return { label: d.label, data: d.data, backgroundColor: c, borderColor: c, borderWidth: 0, borderRadius: 4, maxBarThickness: 48 } as ChartDataset
  })
  const tick = { color: theme.muted, font: { family: theme.font, size: 12 } }
  const numberTick = { ...tick, callback: (v: number | string) => (typeof v === 'number' ? fmt(v, o.locale) : v) }
  const grid = { color: withAlpha(theme.border, 0.6), drawTicks: false }
  const valueAxis = { beginAtZero: true, stacked: o.stacked, ticks: numberTick, grid, border: { display: false } }
  const categoryAxis = { stacked: o.stacked, ticks: tick, grid: { display: false }, border: { color: theme.border } }
  return {
    type,
    data: { labels: series.labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: reducedMotion() ? false : { duration: 350 },
      indexAxis: horizontal ? 'y' : 'x',
      ...(radial ? { cutout: kind === 'doughnut' ? '58%' : 0 } : {}),
      layout: { padding: 4 },
      interaction: radial ? { mode: 'nearest', intersect: true } : { mode: 'nearest', intersect: false, axis: horizontal ? 'y' : 'x' },
      scales: radial ? {} : horizontal ? { x: valueAxis, y: categoryAxis } : { x: categoryAxis, y: valueAxis },
      plugins: {
        legend: {
          display: o.showLegend,
          position: 'bottom',
          labels: { color: theme.text, font: { family: theme.font, size: 12 }, usePointStyle: true, boxWidth: 8, boxHeight: 8, padding: 14 },
        },
        tooltip: {
          backgroundColor: theme.dark ? '#f2f0ea' : '#1b1916', titleColor: theme.dark ? '#1b1916' : '#ffffff',
          bodyColor: theme.dark ? '#1b1916' : '#ffffff', titleFont: { family: theme.font }, bodyFont: { family: theme.font },
          padding: 8, cornerRadius: 6, displayColors: series.datasets.length > 1 || radial,
          callbacks: {
            label: (ctx) => {
              const raw = typeof ctx.raw === 'number' ? ctx.raw : Number(ctx.raw)
              const name = radial ? (series.datasets.length > 1 ? ctx.dataset.label ?? '' : '') : ctx.dataset.label ?? ''
              return `${name ? `${name}: ` : ''}${fmt(raw, o.locale)}`
            },
          },
        },
      },
      onClick: (_e, elements) => {
        const hit = elements[0]
        if (hit && o.onClick) o.onClick(hit.datasetIndex, hit.index)
      },
      onHover: (e, elements) => {
        const target = e.native?.target as HTMLElement | undefined
        if (target && o.onClick) target.style.cursor = elements.length ? 'pointer' : 'default'
      },
    },
  } as ChartConfiguration
}

export function fmt(n: number, locale: string): string {
  if (!Number.isFinite(n)) return '—'
  try { return new Intl.NumberFormat(locale || 'en', { maximumFractionDigits: 2 }).format(n) } catch { return String(n) }
}

export function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(/[,\s]/g, ''))
    return Number.isFinite(n) ? n : null
  }
  if (typeof v === 'boolean') return v ? 1 : 0
  return null
}

export type Aggregate = 'none' | 'sum' | 'count' | 'average'

/** Rows (objects) → series: one dataset per value field, optionally grouped by label. */
export function rowsToSeries(rows: Array<Record<string, unknown>>, labelOf: (r: Record<string, unknown>) => string,
  fields: Array<{ key: string; label: string; get: (r: Record<string, unknown>) => unknown }>, aggregate: Aggregate): Series {
  if (aggregate === 'count') {
    const counts = new Map<string, number>()
    for (const r of rows) counts.set(labelOf(r), (counts.get(labelOf(r)) ?? 0) + 1)
    return { labels: [...counts.keys()], datasets: [{ label: 'Count', data: [...counts.values()] }] }
  }
  if (aggregate === 'sum' || aggregate === 'average') {
    const order: string[] = []
    const acc = new Map<string, { sums: number[]; counts: number[] }>()
    for (const r of rows) {
      const l = labelOf(r)
      let a = acc.get(l)
      if (!a) { a = { sums: fields.map(() => 0), counts: fields.map(() => 0) }; acc.set(l, a); order.push(l) }
      fields.forEach((f, i) => {
        const n = toNumber(f.get(r))
        if (n !== null) { a!.sums[i] += n; a!.counts[i] += 1 }
      })
    }
    return {
      labels: order,
      datasets: fields.map((f, i) => ({
        label: f.label,
        data: order.map((l) => {
          const a = acc.get(l)!
          return aggregate === 'sum' ? a.sums[i] : a.counts[i] ? Math.round((a.sums[i] / a.counts[i]) * 100) / 100 : 0
        }),
      })),
    }
  }
  return {
    labels: rows.map(labelOf),
    datasets: fields.map((f) => ({ label: f.label, data: rows.map((r) => toNumber(f.get(r)) ?? 0) })),
  }
}

/** Number of points in a series (labels × datasets for cartesian, labels for radial). */
export function isEmpty(s: Series | null): boolean {
  return !s || !s.labels.length || !s.datasets.length
}
