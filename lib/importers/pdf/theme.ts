/**
 * A form theme from a PDF's look (pure, client-safe): the brand colour
 * (header band, bands behind headings, heading colour, the logo's colour),
 * the page tint, the body text colour and the PDF's fonts mapped to the
 * closest family the theme system already serves (lib/fonts/google.ts —
 * fonts are never embedded from the PDF), with a sensible corner radius.
 *
 * Every colour is contrast-checked before it is used: the accent must carry
 * white button text and read as a link on the form background (WCAG AA
 * 4.5:1), the text colour must read on the background (4.5:1); a colour that
 * doesn't is moved to the nearest one that does (ensureContrast), and the
 * change is reported. The result passes the forms service's own check
 * (blockingFormThemeIssues).
 */

import { blockingFormThemeIssues, type FormThemeOverrides } from '@/lib/forms/form-theme'
import { contrastRatio, parseColor } from '@/lib/theme/colors'
import { AA_TEXT, ensureContrast } from '@/lib/theme/legibility'
import { findThemeFont } from '@/lib/theme/fonts'
import { fontFromCss, type TextFontValue } from '@/lib/forms/text-style'

/* ── fonts ───────────────────────────────────────────────────────────── */

export interface FontPick {
  /** The PDF's font name ("Calibri-Bold"). */
  pdf: string
  /** Its family ("Calibri"). */
  family: string
  /** The theme font: a Google family (served from this site) or a system stack. */
  theme: { source: 'google'; family: string } | { source: 'system'; family: 'System UI' | 'Serif' | 'Monospace' }
  /** A field text style's font (lib/forms/text-style.ts). */
  text?: TextFontValue
  /** "Calibri → Carlito (metric-compatible)". */
  label: string
  exact: boolean
}

/** Closest families the catalogue serves (first found wins), per PDF family (lower case, no spaces). */
const FONT_MAP: Array<[RegExp, string[], 'sans' | 'serif' | 'mono']> = [
  [/^(helvetica|arial|arialmt|helveticaneue|nimbussans|liberationsans|arimo)/, ['Arimo', 'Roboto'], 'sans'],
  [/^(times|timesnewroman|nimbusroman|liberationserif|tinos)/, ['Tinos', 'PT Serif'], 'serif'],
  [/^(courier|couriernew|nimbusmono|liberationmono|cousine)/, ['Cousine'], 'mono'],
  [/^calibri/, ['Carlito', 'Lato'], 'sans'],
  [/^cambria/, ['Caladea', 'PT Serif'], 'serif'],
  [/^georgia/, ['Gelasio'], 'serif'],
  [/^(verdana|tahoma|dejavusans)/, ['PT Sans', 'Noto Sans'], 'sans'],
  [/^(segoeui|segoe)/, ['Open Sans'], 'sans'],
  [/^myriad/, ['PT Sans', 'Source Sans 3'], 'sans'],
  [/^(minion|adobegaramond)/, ['Crimson Pro'], 'serif'],
  [/^(garamond|ebgaramond)/, ['EB Garamond'], 'serif'],
  [/^futura/, ['Jost'], 'sans'],
  [/^gillsans/, ['Cabin'], 'sans'],
  [/^frutiger/, ['Hind'], 'sans'],
  [/^univers/, ['Roboto'], 'sans'],
  [/^franklingothic/, ['Libre Franklin'], 'sans'],
  [/^centurygothic/, ['Questrial'], 'sans'],
  [/^(palatino|bookantiqua|baskerville)/, ['Libre Baskerville'], 'serif'],
  [/^trebuchet/, ['Fira Sans'], 'sans'],
  [/^(consolas|lucidaconsole|menlo|monaco)/, ['Cousine'], 'mono'],
]
const SYMBOL_FONTS = /^(symbol|zapfdingbats|wingdings|webdings|dingbats|marlett)/

/** "ABCDEF+OpenSans-SemiBoldItalic" → "OpenSans" (the family part of a PostScript name). */
export function pdfFontFamily(name: string): string {
  return String(name ?? '').replace(/^[A-Z]{6}\+/, '').split(/[-,]/)[0]
    .replace(/(PSMT|PS|MT|Std|Pro|LT|Com|Regular|Bold|Italic|Oblique|Semibold|SemiBold|Light|Medium|Black|Heavy|Book|Condensed|Narrow)+$/g, '')
    .trim()
}

/** "OpenSans" → "Open Sans" (CamelCase split). */
const spaced = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/\s+/g, ' ').trim()

/** A PDF font name → the closest theme font, or null (symbol fonts, nothing known). */
export function mapPdfFont(name: string): FontPick | null {
  const family = pdfFontFamily(name)
  const key = family.toLowerCase().replace(/[^a-z]/g, '')
  if (!key || SYMBOL_FONTS.test(key)) return null
  const human = spaced(family) || family
  // The family itself is in the catalogue (Roboto, Open Sans, Montserrat …).
  const direct = findThemeFont(human) ?? findThemeFont(family)
  if (direct) return { pdf: name, family: human, theme: { source: 'google', family: direct.family }, text: fontFromCss(direct.family), label: `${human} (the same family)`, exact: true }
  for (const [re, candidates, kind] of FONT_MAP) {
    if (!re.test(key)) continue
    const hit = candidates.map((c) => findThemeFont(c)).find(Boolean)
    const text = fontFromCss(human) ?? (hit ? fontFromCss(hit.family) : undefined)
    if (hit) return { pdf: name, family: human, theme: { source: 'google', family: hit.family }, ...(text ? { text } : {}), label: `${human} → ${hit.family}`, exact: false }
    const sys = kind === 'serif' ? 'Serif' : kind === 'mono' ? 'Monospace' : 'System UI'
    return { pdf: name, family: human, theme: { source: 'system', family: sys }, ...(text ? { text } : {}), label: `${human} → the system ${sys.toLowerCase()} font`, exact: false }
  }
  if (/serif|roman|times/i.test(name) && !/sans/i.test(name)) return { pdf: name, family: human, theme: { source: 'system', family: 'Serif' }, text: 'serif', label: `${human} → the system serif font`, exact: false }
  if (/mono|code|typewriter/i.test(name)) return { pdf: name, family: human, theme: { source: 'system', family: 'Monospace' }, text: 'mono', label: `${human} → the system monospace font`, exact: false }
  return null
}

/* ── colours ─────────────────────────────────────────────────────────── */

export interface Hsl { h: number; s: number; l: number }
export function hslOf(color: string): Hsl | null {
  const c = parseColor(color)
  if (!c) return null
  const r = c.r / 255, g = c.g / 255, b = c.b / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60
  return { h, s, l }
}

/** A brand-like colour: saturated enough, not near white / black. */
export function isBrandColor(color: string): boolean {
  const c = hslOf(color)
  return Boolean(c && c.s >= 0.22 && c.l >= 0.12 && c.l <= 0.86)
}

export const isNearWhite = (color: string) => { const c = hslOf(color); return Boolean(c && c.l >= 0.93) }
/** Paper white (a tint has to differ from it visibly). */
export const isWhite = (color: string) => distance(color, '#ffffff') < 10
export const isNearBlack = (color: string) => { const c = hslOf(color); return Boolean(c && c.l <= 0.16 && c.s < 0.35) }

function distance(a: string, b: string): number {
  const x = parseColor(a), y = parseColor(b)
  if (!x || !y) return 999
  return Math.hypot(x.r - y.r, x.g - y.g, x.b - y.b)
}

/** Weighted colour votes → the strongest cluster's representative (its heaviest member), or null. */
export function strongestColor(votes: Array<{ color: string; weight: number }>, accept: (c: string) => boolean = isBrandColor): string | null {
  const clusters: Array<{ color: string; best: number; weight: number }> = []
  for (const v of votes) {
    if (!v.weight || !accept(v.color)) continue
    const c = clusters.find((k) => distance(k.color, v.color) < 48)
    if (c) { c.weight += v.weight; if (v.weight > c.best) { c.best = v.weight; c.color = v.color } }
    else clusters.push({ color: v.color, best: v.weight, weight: v.weight })
  }
  clusters.sort((a, b) => b.weight - a.weight)
  return clusters[0]?.color ?? null
}

export interface ThemeInput {
  /** Brand colour votes: header band, heading bands, heading text, logo, saturated rules. */
  votes: Array<{ color: string; weight: number; source: string }>
  /** The header band's colour (page 1). */
  banner: string | null
  /** A light page-wide tint behind the content. */
  pageTint: string | null
  /** The body text's colour (most characters). */
  bodyText: string | null
  bodyFont: FontPick | null
  headingFont: FontPick | null
  /** Body text size in pt (reported; the theme has no base size). */
  baseSize: number | null
}

export interface DerivedTheme {
  overrides: FormThemeOverrides
  /** For the report: what was chosen, from where. */
  chosen: string[]
  /** Colours moved for contrast ("accent #8fb3ff → #2f62d9 for 4.5:1 on white"). */
  adjusted: string[]
  /** Nothing distinctive found: the workspace theme suits it as well. */
  plain: boolean
}

const hex = (c: string) => c.toLowerCase()

/** The theme for a PDF (null when there is nothing to carry: no colour, no known font). */
export function deriveTheme(input: ThemeInput): DerivedTheme | null {
  const chosen: string[] = []
  const adjusted: string[] = []
  const light: NonNullable<NonNullable<FormThemeOverrides['colors']>['light']> = {}
  const white = parseColor('#ffffff')!
  // Background: a page-wide light tint (a cream / grey page), else the workspace card.
  const tint = input.pageTint && !isWhite(input.pageTint) && (hslOf(input.pageTint)?.l ?? 0) >= 0.8 ? hex(input.pageTint) : null
  if (tint) { light.background = tint; chosen.push(`background ${tint} (the page tint)`) }
  const bg = parseColor(tint ?? '#ffffff') ?? white
  const brand = strongestColor(input.votes)
  if (brand) {
    const source = input.votes.filter((v) => distance(v.color, brand) < 48).sort((a, b) => b.weight - a.weight)[0]?.source ?? 'the PDF'
    // Buttons carry white text and links sit on the background: both need AA.
    const fixed = ensureContrast(ensureContrast(brand, [white], AA_TEXT), [bg], AA_TEXT)
    light.accent = hex(fixed)
    chosen.push(`accent ${hex(fixed)} (from ${source})`)
    if (hex(fixed) !== hex(brand)) adjusted.push(`accent ${hex(brand)} → ${hex(fixed)} so white button text and links reach ${AA_TEXT}:1`)
  }
  if (input.bodyText && !isNearBlack(input.bodyText)) {
    const fixed = ensureContrast(input.bodyText, [bg], AA_TEXT)
    light.text = hex(fixed)
    chosen.push(`text ${hex(fixed)} (the body text)`)
    if (hex(fixed) !== hex(input.bodyText)) adjusted.push(`text ${hex(input.bodyText)} → ${hex(fixed)} for ${AA_TEXT}:1 on the background`)
  }
  const overrides: FormThemeOverrides = {}
  if (Object.keys(light).length) overrides.colors = { light }
  if (input.bodyFont) { overrides.font = input.bodyFont.theme as FormThemeOverrides['font']; chosen.push(`font ${input.bodyFont.label}`) }
  if (input.headingFont && (!input.bodyFont || input.headingFont.theme.family !== input.bodyFont.theme.family)) {
    overrides.heading_font = input.headingFont.theme as FormThemeOverrides['heading_font']
    chosen.push(`heading font ${input.headingFont.label}`)
  }
  if (input.banner) {
    overrides.header = { enabled: false, banner_color: hex(input.banner) }
    chosen.push(`header banner ${hex(input.banner)} (the PDF's header band)`)
  }
  const distinctive = Boolean(overrides.colors || overrides.header || (input.bodyFont && !/^(Arimo|Roboto)$/.test(input.bodyFont.theme.family)) || overrides.heading_font)
  // Black text in Helvetica / Arial on white: the workspace theme suits it as well as a copy would.
  if (!distinctive) return null
  // PDF boxes are square-cornered: a small radius keeps that feel without looking dated.
  overrides.radius = 4
  overrides.field_style = 'outlined'
  if (input.baseSize) chosen.push(`body text ${Math.round(input.baseSize * 10) / 10} pt in the PDF (sizes follow the theme)`)
  // Belt and braces: the service refuses a theme its own check blocks.
  if (blockingFormThemeIssues(overrides).length && overrides.colors?.light) {
    delete overrides.colors.light.text
    if (overrides.colors.light.background && light.accent && (contrastRatio(light.accent, overrides.colors.light.background) ?? 21) < 1.5) delete overrides.colors.light.background
  }
  return { overrides, chosen, adjusted, plain: !distinctive }
}
