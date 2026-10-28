/**
 * Legibility pass for a palette: the smallest colour changes that make every
 * text / UI pair the app draws meet its WCAG target.
 *
 * Applied twice: when a built-in preset is converted (so templates ship
 * legible) and when any theme is rendered (lib/theme/to-css.ts), so themes
 * saved before these checks existed — or a custom colour that slipped below a
 * target — still render readable text. A palette that already passes comes
 * back unchanged (same strings), so the pass is idempotent.
 *
 * Adjustments keep the hue and saturation and move lightness the shortest way
 * that reaches the target; translucent tints that flip polarity (a dark wash
 * on a light card, the old dark-OS quirk) are rebuilt as a light wash of their
 * base colour.
 */

import { composite, contrastRatio, parseColor, relativeLuminance, withAlpha, type Rgba } from './colors'
import type { ThemePalette, WorkspaceTheme } from './schema'

export const AA_TEXT = 4.5
export const AA_LARGE = 3

const INK = '#0F172A'
const WHITE = '#FFFFFF'
/** Margin so browser rounding (color-mix, sub-pixel blending) doesn't drop a fixed pair just under the target. */
const MARGIN = 0.1

type Chrome = Pick<WorkspaceTheme['chrome'], 'sidebar' | 'topbar'>

// ── colour helpers ──────────────────────────────────────────────────────────

const ratio = (a: Rgba, b: Rgba) => {
  const l1 = relativeLuminance(a)
  const l2 = relativeLuminance(b)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

const toHex = (c: Rgba) => `#${[c.r, c.g, c.b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('').toUpperCase()}`

/** Opaque colour of `value` laid over `under` (itself laid over white when translucent). */
export function flatten(value: string, under?: Rgba): Rgba | null {
  const c = parseColor(value)
  if (!c) return null
  const base = under ?? { r: 255, g: 255, b: 255, a: 1 }
  return c.a < 1 ? composite(c, base) : { ...c, a: 1 }
}

function rgbToHsl({ r, g, b }: Rgba): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255
  const max = Math.max(R, G, B), min = Math.min(R, G, B)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l * 100]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4
  return [h * 60, s * 100, l * 100]
}

function hslToRgba(h: number, s: number, l: number): Rgba {
  const S = s / 100, L = l / 100
  const k = (n: number) => (n + h / 30) % 12
  const a = S * Math.min(L, 1 - L)
  const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255), a: 1 }
}

/** Lowest contrast of `fg` (composited over each background) against the backgrounds. */
export function worstContrast(fg: Rgba, bgs: Rgba[]): number {
  return Math.min(...bgs.map((b) => ratio(fg.a < 1 ? composite(fg, b) : fg, b)))
}

/**
 * `fg` when it already reaches `required` on every background; otherwise the
 * nearest colour (same hue / saturation, lightness moved) that does, or the
 * better of ink / white when no lightness can.
 */
export function ensureContrast(fg: string, bgs: Array<Rgba | null>, required: number): string {
  const f = parseColor(fg)
  const backs = bgs.filter((b): b is Rgba => b !== null)
  if (!f || backs.length === 0) return fg
  if (worstContrast(f, backs) >= required) return fg
  const opaque = f.a < 1 ? composite(f, backs[0]) : f
  const [h, s, l] = rgbToHsl(opaque)
  const target = required + MARGIN
  let best: { c: Rgba; dist: number } | null = null
  for (const dir of [-1, 1]) {
    for (let L = l; L >= 0 && L <= 100; L += dir * 0.5) {
      const c = hslToRgba(h, s, L)
      if (worstContrast(c, backs) >= target) {
        const dist = Math.abs(L - l)
        if (!best || dist < best.dist) best = { c, dist }
        break
      }
    }
  }
  if (best) return toHex(best.c)
  const ink = parseColor(INK)!, white = parseColor(WHITE)!
  return worstContrast(ink, backs) >= worstContrast(white, backs) ? INK : WHITE
}

/** Best of white / ink text on every one of `fills`. */
export function onColor(...fills: Array<string | undefined>): string {
  const backs = fills.map((f) => (f ? flatten(f) : null)).filter((b): b is Rgba => b !== null)
  if (backs.length === 0) return WHITE
  return worstContrast(parseColor(INK)!, backs) > worstContrast(parseColor(WHITE)!, backs) ? INK : WHITE
}

/** A wash this far from its card (contrast ratio) is no longer a wash — e.g. a near-black tint on a white card. */
const MAX_WASH = 1.6

/**
 * A wash that has flipped polarity (the legacy dark-OS rule put near-black
 * tints on light cards) is rebuilt as a light wash of `base`, as strong as
 * `text` still reads on; subtle washes are returned unchanged.
 */
export function fixTint(tint: string, base: string, card: Rgba, text: Rgba): string {
  const over = flatten(tint, card)
  if (!over || ratio(over, card) <= MAX_WASH) return tint
  const b = parseColor(base)
  if (!b) return tint
  const hex = toHex(b)
  for (let a = 0.14; a > 0.035; a -= 0.02) {
    const candidate = withAlpha(hex, a)
    const flat = flatten(candidate, card)!
    if (ratio(flat, card) <= MAX_WASH && ratio(text, flat) >= AA_TEXT) return candidate
  }
  return withAlpha(hex, 0.04)
}

/** Opaque surfaces of a palette (cards sit on the surface; tints sit on cards). */
export function paletteSurfaces(p: ThemePalette) {
  const surface = flatten(p.surface)!
  const card = flatten(p.cardBg, surface)!
  const input = flatten(p.inputBg ?? p.cardBg, card)!
  return { surface, card, input }
}

/** Sidebar backgrounds text must read on: the solid colour plus any gradient stops. */
export function sidebarBackgrounds(p: Pick<ThemePalette, 'sidebar'>, chrome?: Chrome): Rgba[] {
  const solid = flatten(p.sidebar)!
  const sb = chrome?.sidebar
  const stops = sb && sb.style !== 'solid' && sb.gradient ? sb.gradient.stops.map((s) => flatten(s.color, solid)!).filter(Boolean) : []
  return [solid, ...stops]
}

export function topbarBackgrounds(p: Pick<ThemePalette, 'topbar'>, chrome?: Chrome): Rgba[] {
  const solid = flatten(p.topbar)!
  const tb = chrome?.topbar
  const stops = tb && tb.style !== 'solid' && tb.gradient ? tb.gradient.stops.map((s) => flatten(s.color, solid)!).filter(Boolean) : []
  return [solid, ...stops]
}

/** The 12% chip wash components mix from a colour (`color-mix(… 12%, transparent)`). */
const wash = (color: string) => { const c = parseColor(color); return c ? withAlpha(toHex(c), 0.12 * c.a) : color }

/** A wash laid over each background. */
const washOver = (wash: string, backs: Rgba[]): Rgba[] => backs.map((b) => flatten(wash, b)).filter((c): c is Rgba => c !== null)

const isTranslucent = (v: string) => (parseColor(v)?.a ?? 1) < 1

/**
 * Sidebar highlight (wordmark, active nav label): the primary, then the
 * accent, when it reaches AA on every sidebar background (gradient stops,
 * glows, the active wash); then the primary or accent nudged lighter /
 * darker when it reads on the plain sidebar at 3:1; otherwise the sidebar text.
 */
export function sidebarAccentFor(p: Pick<ThemePalette, 'primary' | 'accent' | 'sidebar' | 'sidebarText' | 'sidebarActive' | 'sidebarAccent'>, chrome?: Chrome): string {
  if (p.sidebarAccent) return p.sidebarAccent
  const backs = sidebarBackgrounds(p, chrome)
  // Decorated sidebars paint soft glows behind the items, and the active wash sits over all of it.
  const glows = chrome?.sidebar.decorations !== 'off' && chrome?.sidebar.glow1 ? washOver(chrome.sidebar.glow1, backs) : []
  const under = [...backs, ...glows]
  const all = [...under, ...washOver(p.sidebarActive, under)]
  // The active nav label is body-size text: AA. Primary first, then the accent — each as is, or nudged
  // lighter / darker (keeping its hue) when it already reads on the plain sidebar at 3:1.
  for (const candidate of [p.primary, p.accent]) {
    const c = parseColor(candidate)
    if (!c || isTranslucent(candidate)) continue
    if (worstContrast(c, all) >= AA_TEXT) return candidate
    if (worstContrast(c, [backs[0]]) < AA_LARGE) continue
    const shifted = ensureContrast(candidate, all, AA_TEXT)
    const sc = parseColor(shifted)
    if (sc && shifted !== '#FFFFFF' && shifted !== INK && worstContrast(sc, all) >= AA_TEXT) return shifted
  }
  return p.sidebarText
}

export interface LegibleChrome {
  /** Sidebar wordmark colour for this palette. */
  brandColor?: string
}

/**
 * Palette with every text / UI pair raised to its target. Unchanged values are
 * the same strings, so a passing palette round-trips exactly.
 */
export function legiblePalette(input: ThemePalette, chrome?: Chrome): ThemePalette {
  const p: ThemePalette = { ...input, status: { ...input.status }, chart: [...input.chart] }
  const { surface, card, input: inputBg } = paletteSurfaces(p)

  // Body text first: everything else is checked against it.
  p.cardText = ensureContrast(p.cardText, [card, surface, inputBg], AA_TEXT)
  const text = flatten(p.cardText, card)!

  // Washes that flipped polarity (dark tint on a light card).
  p.primaryLight = fixTint(p.primaryLight, p.primary, card, text)
  p.accentLight = fixTint(p.accentLight, p.accent, card, text)
  p.rowHighlight = fixTint(p.rowHighlight, p.primary, card, text)
  p.rowHighlightStrong = fixTint(p.rowHighlightStrong, p.primary, card, text)
  const s = p.status
  s.todoBg = fixTint(s.todoBg, s.todo, card, text)
  s.progressBg = fixTint(s.progressBg, s.progress, card, text)
  s.blockedBg = fixTint(s.blockedBg, s.blocked, card, text)
  s.doneBg = fixTint(s.doneBg, s.done, card, text)
  s.infoBg = fixTint(s.infoBg, s.info, card, text)
  s.warningBg = fixTint(s.warningBg, p.warning, card, text)
  s.dangerBg = fixTint(s.dangerBg, p.danger, card, text)
  s.successBg = fixTint(s.successBg, p.success, card, text)

  const on = (tint: string) => flatten(tint, card)
  // Washes sit on cards and directly on the page surface (rows, chips): check both.
  const onS = (tint: string) => flatten(tint, surface)
  const rowStrong = on(p.rowHighlightStrong)
  const rowStrongS = onS(p.rowHighlightStrong)
  p.cardText = ensureContrast(p.cardText, [card, surface, on(p.primaryLight), onS(p.primaryLight), on(p.accentLight), onS(p.accentLight), rowStrong, rowStrongS], AA_TEXT)
  p.mutedText = ensureContrast(p.mutedText, [card, surface, on(p.rowHighlight), onS(p.rowHighlight), rowStrong, rowStrongS, inputBg, on(p.primaryLight), on(p.accentLight)], AA_TEXT)

  // Semantic text, alone on a card and on its own soft badge.
  s.todo = ensureContrast(s.todo, [card, on(s.todoBg), onS(s.todoBg)], AA_TEXT)
  s.progress = ensureContrast(s.progress, [card, on(s.progressBg), onS(s.progressBg)], AA_TEXT)
  s.blocked = ensureContrast(s.blocked, [card, on(s.blockedBg), onS(s.blockedBg)], AA_TEXT)
  s.done = ensureContrast(s.done, [card, on(s.doneBg), onS(s.doneBg)], AA_TEXT)
  s.info = ensureContrast(s.info, [card, on(s.infoBg), onS(s.infoBg)], AA_TEXT)
  p.success = ensureContrast(p.success, [card, surface, on(s.successBg), onS(s.successBg)], AA_TEXT)
  p.warning = ensureContrast(p.warning, [card, surface, on(s.warningBg), onS(s.warningBg)], AA_TEXT)
  p.danger = ensureContrast(p.danger, [card, surface, on(s.dangerBg), onS(s.dangerBg)], AA_TEXT)
  p.info = ensureContrast(p.info, [card, surface, on(s.infoBg), onS(s.infoBg)], AA_TEXT)

  // Text on primary fills (rest and hover). A stored colour that fails is replaced by the better of white / ink.
  if (p.onPrimary) {
    const fills = [flatten(p.primary, card), flatten(p.primaryHover, card)]
    const derived = onColor(p.primary)
    const c = parseColor(p.onPrimary)
    const backs = fills.filter((b): b is Rgba => b !== null)
    if (!c || worstContrast(c, backs) < Math.min(AA_TEXT, worstContrast(parseColor(derived)!, backs))) p.onPrimary = derived
  }
  // A primary so mid-toned that neither white nor ink reaches AA on it: move the fill (and its hover), not the text.
  const onP = parseColor(p.onPrimary ?? onColor(p.primary))!
  const fill = flatten(p.primary, card)
  if (fill && ratio(onP, fill) < AA_TEXT) p.primary = ensureContrast(p.primary, [onP], AA_TEXT)
  const hover = flatten(p.primaryHover, card)
  if (hover && ratio(onP, hover) < AA_TEXT) p.primaryHover = ensureContrast(p.primaryHover, [onP], AA_TEXT)

  // Inputs and focus.
  if (p.focusRing) p.focusRing = ensureContrast(p.focusRing, [surface, card], AA_LARGE)

  // Sidebar: text on the colour, every gradient stop, the active and hover washes.
  const sidebars = sidebarBackgrounds(p, chrome)
  const sideActive = washOver(p.sidebarActive, sidebars)
  const sideHover = chrome?.sidebar.hoverBg ? washOver(chrome.sidebar.hoverBg, sidebars) : []
  p.sidebarText = ensureContrast(p.sidebarText, [...sidebars, ...sideActive, ...sideHover], AA_TEXT)
  if (p.sidebarAccent) p.sidebarAccent = ensureContrast(p.sidebarAccent, [...sidebars, ...sideActive], AA_TEXT)

  p.topbarText = ensureContrast(p.topbarText, topbarBackgrounds(p, chrome), AA_TEXT)

  // Chart series are graphics: 3:1 against the card.
  p.chart = p.chart.map((c) => ensureContrast(c, [card], AA_LARGE))
  return p
}

/**
 * Tokens the renderer derives from a (legible) palette: text versions of the
 * brand colours (links, pills on their own wash), the focus ring, text on
 * primary fills and the sidebar highlight.
 */
export function derivedTokens(p: ThemePalette, chrome?: Chrome) {
  const { surface, card } = paletteSurfaces(p)
  const on = (tint: string) => flatten(tint, card)
  // Washes sit on cards and directly on the page surface (rows, chips): check both.
  const onS = (tint: string) => flatten(tint, surface)
  return {
    primaryText: ensureContrast(p.primary, [card, surface, on(p.primaryLight), onS(p.primaryLight), on(p.rowHighlight), onS(p.rowHighlight), on(wash(p.primary))], AA_TEXT),
    accentText: ensureContrast(p.accent, [card, surface, on(p.accentLight), onS(p.accentLight)], AA_TEXT),
    focusRing: ensureContrast(p.focusRing ?? p.primary, [surface, card], AA_LARGE),
    /** Chart series used as text (legend labels, metric chips): AA on the card. */
    chartText: p.chart.map((c) => ensureContrast(c, [card, surface, on(wash(c))], AA_TEXT)),
    onPrimary: p.onPrimary ?? onColor(p.primary),
    sidebarAccent: sidebarAccentFor(p, chrome),
    sidebarMuted: softText(p.sidebarText, sidebarBackgrounds(p, chrome)),
    topbarMuted: softText(p.topbarText, topbarBackgrounds(p, chrome)),
  }
}

/** Secondary text on the sidebar / top bar (section headings, dates): its text colour softened toward the background, still AA. */
function softText(textColor: string, backs: Rgba[]): string {
  const text = flatten(textColor, backs[0])
  if (!text) return textColor
  const soft = toHex(composite({ ...text, a: 0.72 }, backs[0]))
  return ensureContrast(soft, backs, AA_TEXT)
}

/** Sidebar wordmark colour that reads on this palette's sidebar (AA — the wordmark is 18px, below WCAG's large-text size). */
export function legibleBrandColor(brandColor: string, p: ThemePalette, chrome?: Chrome): string {
  return ensureContrast(brandColor, sidebarBackgrounds(p, chrome), AA_TEXT)
}

/** Status / semantic fills that carry white-or-ink text (destructive buttons, solid chips). */
export function onSemantic(p: ThemePalette) {
  // Fills may be translucent (some presets use a wash as the accent): judge them as painted on the card.
  const { card } = paletteSurfaces(p)
  const on = (fill: string) => {
    const flat = flatten(fill, card)
    return flat ? onColor(toHex(flat)) : WHITE
  }
  return {
    onAccent: on(p.accent),
    onDanger: on(p.danger),
    onSuccess: on(p.success),
    onWarning: on(p.warning),
    onInfo: on(p.status.info),
  }
}

export { contrastRatio }

const fillCache = new Map<string, string>()

/**
 * A fixed fill colour (designer node categories, branch chips, connector
 * brands) darkened or lightened just enough for `text` to read on it.
 * Non-literal values (`var(...)`) and unparseable input come back unchanged.
 */
export function readableFill(color: string, text: string = WHITE, required: number = AA_TEXT): string {
  const key = `${color}|${text}|${required}`
  const hit = fillCache.get(key)
  if (hit) return hit
  const t = parseColor(text)
  const c = parseColor(color)
  let out = color
  if (t && c && c.a === 1) {
    const fixed = ensureContrast(color, [t], required)
    out = fixed === INK || fixed === WHITE ? color : fixed
  }
  if (fillCache.size > 500) fillCache.clear()
  fillCache.set(key, out)
  return out
}
