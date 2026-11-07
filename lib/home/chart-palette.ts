/**
 * Series colours for the Home charts, taken from the workspace theme and
 * checked at runtime so a custom theme can never produce two series a reader
 * can't tell apart.
 *
 * Each chart asks for slots in order. A slot prefers its theme tokens (status
 * slots: --theme-success / --theme-danger / --theme-warning; others the
 * theme's chart series, then its status colours), and takes the first
 * candidate that (series slots try the theme's primary and accent first,
 * when they are colours rather than near-black or grey)
 *   - clears 3:1 against the card it sits on (WCAG, graphics), and
 *   - sits at least NORMAL_FLOOR (OKLab ΔE×100, unsimulated) and CVD_FLOOR
 *     (worst of protan / deutan, Machado 2009 severity 1) from every slot
 *     already chosen.
 * Two status slots (approved = success vs rejected = danger, on time vs
 * late) are only held to the normal-vision floor against each other, since
 * status colours always ship with an icon and a label; against every other
 * slot they need the CVD floor too (else the reference status step). When
 * no theme candidate passes, the slot takes the validated reference palette
 * (the dataviz default, light or dark steps by the card's lightness).
 *
 * The method's lightness band and chroma floor are not enforced: workspace
 * themes are often deliberately muted, and the theme's own legibility pass
 * (lib/theme/legibility.ts) already holds chart colours to 3:1 on cards.
 * A neutral slot (cancelled) is grey, held to 1.5:1 and the normal-vision
 * floor only: it reads apart by lightness and its label.
 * Every chart carries a legend, direct labels and a table view, so identity
 * is never colour alone.
 */

import { isDarkColor, parseColor } from '@/lib/theme/colors'

export const NORMAL_FLOOR = 15
export const CVD_FLOOR = 6
export const CONTRAST_MIN = 3

/** The dataviz reference categorical palette (validated, adjacent pairs, both modes). */
export const REFERENCE_SERIES = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
} as const
/** Reference status steps (good / warning / critical). */
export const REFERENCE_STATUS = { success: '#0ca30c', warning: '#fab219', danger: '#d03b3b' } as const

export interface ChartTheme {
  card: string
  /** The brand colours lead the series candidates when they are chromatic (not near-black / grey). */
  primary?: string
  accent?: string
  chart: string[]
  success: string
  warning: string
  danger: string
  muted: string
}

export type SlotRequest =
  | { role: 'success' | 'warning' | 'danger'; semantic?: boolean }
  | { role: 'series'; prefer?: number }
  | { role: 'neutral' }

/* ── colour maths (ported from the dataviz validator) ─────────────────── */

type Lin = [number, number, number]
const MACHADO = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
} as const

function toLin(color: string, card: string): Lin | null {
  const c = parseColor(color)
  if (!c) return null
  const bg = parseColor(card) ?? { r: 255, g: 255, b: 255, a: 1 }
  const mix = (f: number, b: number) => (f * c.a + b * (1 - c.a)) / 255
  const s2l = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return [s2l(mix(c.r, bg.r)), s2l(mix(c.g, bg.g)), s2l(mix(c.b, bg.b))]
}

function oklab([r, g, b]: Lin): Lin {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

function simulate([r, g, b]: Lin, kind: keyof typeof MACHADO): Lin {
  const M = MACHADO[kind]
  const cl = (v: number) => Math.max(0, Math.min(1, v))
  return [cl(M[0][0] * r + M[0][1] * g + M[0][2] * b), cl(M[1][0] * r + M[1][1] * g + M[1][2] * b), cl(M[2][0] * r + M[2][1] * g + M[2][2] * b)]
}

const dist = (a: Lin, b: Lin) => 100 * Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/** OKLab ΔE×100 between two colours (on the card), unsimulated and worst CVD (protan / deutan). */
export function separation(a: string, b: string, card = '#ffffff'): { normal: number; cvd: number } {
  const la = toLin(a, card)
  const lb = toLin(b, card)
  if (!la || !lb) return { normal: 0, cvd: 0 }
  return {
    normal: dist(oklab(la), oklab(lb)),
    cvd: Math.min(dist(oklab(simulate(la, 'protan')), oklab(simulate(lb, 'protan'))), dist(oklab(simulate(la, 'deutan')), oklab(simulate(lb, 'deutan')))),
  }
}

/** WCAG contrast of a (possibly translucent) colour on the card. */
export function contrastOn(color: string, card: string): number {
  const f = toLin(color, card)
  const b = toLin(card, '#ffffff')
  if (!f || !b) return 1
  const lum = ([r, g, bl]: Lin) => 0.2126 * r + 0.7152 * g + 0.0722 * bl
  const [hi, lo] = [lum(f), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/* ── slot resolution ──────────────────────────────────────────────────── */

/** OKLCH chroma of a colour (0 = grey). */
export function chroma(color: string): number {
  const l = toLin(color, '#ffffff')
  if (!l) return 0
  const [, a, b] = oklab(l)
  return Math.hypot(a, b)
}

/** Below this a brand colour reads as grey / near-black and is no series colour. */
export const BRAND_CHROMA_MIN = 0.06

function candidates(slot: SlotRequest, theme: ChartTheme, reference: readonly string[]): string[] {
  const brand = [theme.primary, theme.accent].filter((c): c is string => !!c && chroma(c) >= BRAND_CHROMA_MIN)
  const series = [...new Set([...brand, ...theme.chart.filter(Boolean)])]
  if (slot.role === 'series') {
    const start = Math.max(0, Math.min(slot.prefer ?? 0, Math.max(series.length - 1, 0)))
    return [...series.slice(start), ...series.slice(0, start), theme.warning, ...reference]
  }
  if (slot.role === 'neutral') return [theme.muted, series[series.length - 1] ?? theme.muted, '#8a8780', '#a8a6a0', '#6b6a66', '#c3c2b7', '#52514e']
  const ref = REFERENCE_STATUS[slot.role]
  return [theme[slot.role], ref]
}

export interface ResolvedSlot {
  color: string
  /** False when no candidate cleared the floors: the caller folds the series into "Other". */
  ok: boolean
}

/**
 * The colours for a chart's slots, in order (see the file comment for the
 * rules). Deterministic for a theme, so colours follow the entity. A slot
 * nothing can separate gets the best-effort candidate (farthest under CVD)
 * and ok: false — past that point a chart folds its tail into "Other"
 * rather than show colours readers can't tell apart.
 */
export function resolveSlotsDetailed(slots: SlotRequest[], theme: ChartTheme): ResolvedSlot[] {
  const reference = isDarkColor(theme.card) ? REFERENCE_SERIES.dark : REFERENCE_SERIES.light
  const chosen: string[] = []
  const semanticChosen: boolean[] = []
  const out: ResolvedSlot[] = []
  for (const slot of slots) {
    // Two status colours (approved / rejected) may sit close under CVD: their icons and labels carry them.
    const semantic = slot.role !== 'series' && slot.role !== 'neutral' && slot.semantic !== false
    const pool = [...candidates(slot, theme, reference), ...reference]
    const legible = (c: string) => !!parseColor(c) && !chosen.includes(c) && contrastOn(c, theme.card) >= (slot.role === 'neutral' ? 1.5 : CONTRAST_MIN)
    const ok = (c: string) => legible(c) && chosen.every((p, i) => {
      const d = separation(c, p, theme.card)
      // A neutral grey reads apart by lightness and its label; it is held to the normal-vision floor only.
      return d.normal >= NORMAL_FLOOR && ((semantic && semanticChosen[i]) || slot.role === 'neutral' || d.cvd >= CVD_FLOOR)
    })
    const pick = pool.find(ok)
    const worst = (c: string) => Math.min(...chosen.map((p) => { const d = separation(c, p, theme.card); return Math.min(d.cvd, d.normal) }))
    const color = pick ?? pool.filter(legible).sort((a, b) => worst(b) - worst(a))[0] ?? pool[0]
    chosen.push(color)
    semanticChosen.push(semantic)
    out.push({ color, ok: !!pick })
  }
  return out
}

export function resolveSlots(slots: SlotRequest[], theme: ChartTheme): string[] {
  return resolveSlotsDetailed(slots, theme).map((s) => s.color)
}
