/**
 * Text styling (InfoPath's font formatting): a font size, a font family, a
 * text colour and bold / italic / underline on a control's label and on its
 * value — set in the form designer on any field (`field.text_style`), on a
 * List column (`column.text_style`: the header and the cells) and on the
 * controls inside a repeating section (they are fields). Conditional styling
 * (lib/forms/conditional-style.ts) takes the same size, font and colour.
 *
 *   text_style: { label?: TextStyle, value?: TextStyle }
 *   TextStyle:  { size?: 'xs'|'sm'|'base'|'lg'|'xl'|'2xl'|'<n>px' (8–48),
 *                 font?: a TEXT_FONTS key, color?: a tone token or #hex,
 *                 bold?: true, italic?: true, underline?: true }
 *
 * Never CSS from the author: every value is a token from a whitelist (sizes,
 * font keys, tone tokens) or matched by a strict regex (`<n>px`, `#rgb` /
 * `#rrggbb`), and only the CSS this module builds from them reaches a page —
 * custom properties read by app/conditional-style.css. Hex colours are kept
 * legible: the light-mode colour is nudged to WCAG AA on light cards, and a
 * separate dark-mode colour is worked out for dark cards (lib/theme/legibility
 * ensureContrast); tone tokens already meet AA in every theme, light and dark
 * (STYLE_TONE_TOKENS).
 *
 * Presentation only: the server normalises styles, never acts on them.
 * Pure and isomorphic.
 */

import { isPlainObject } from '@/lib/utils/guards'
import { ensureContrast } from '@/lib/theme/legibility'
import { parseColor } from '@/lib/theme/colors'

/* ── Sizes ───────────────────────────────────────────────────────────── */

export const TEXT_SIZE_PRESETS = ['xs', 'sm', 'base', 'lg', 'xl', '2xl'] as const
export type TextSizePreset = (typeof TEXT_SIZE_PRESETS)[number]
export const TEXT_SIZE_LABELS: Record<TextSizePreset, string> = { xs: 'Extra small', sm: 'Small', base: 'Normal', lg: 'Large', xl: 'Extra large', '2xl': 'Huge' }
const TEXT_SIZE_CSS: Record<TextSizePreset, string> = { xs: '0.75rem', sm: '0.875rem', base: '1rem', lg: '1.125rem', xl: '1.25rem', '2xl': '1.5rem' }
export const TEXT_SIZE_PX = { min: 8, max: 48 } as const
const PX_RE = /^(\d{1,2}(?:\.5)?)px$/

/** A stored size → a clean one (a preset, or `<n>px` within 8–48, halves allowed), or undefined. */
export function normalizeTextSize(raw: unknown): string | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw)) return normalizeTextSize(`${Math.round(raw * 2) / 2}px`)
  if (typeof raw !== 'string') return undefined
  const s = raw.trim().toLowerCase()
  if ((TEXT_SIZE_PRESETS as readonly string[]).includes(s)) return s
  const m = PX_RE.exec(s)
  if (!m) return undefined
  const n = Number(m[1])
  return n >= TEXT_SIZE_PX.min && n <= TEXT_SIZE_PX.max ? `${n}px` : undefined
}

/** A size's CSS length (the input is normalised first; undefined when it isn't a size). */
export function textSizeCss(size: unknown): string | undefined {
  const s = normalizeTextSize(size)
  if (!s) return undefined
  return (TEXT_SIZE_PRESETS as readonly string[]).includes(s) ? TEXT_SIZE_CSS[s as TextSizePreset] : s
}

/** An InfoPath / CSS point size (10pt, 10.5pt, 13px, small…) → a size token (`<n>px`), or undefined. */
export function sizeFromCss(css: string): string | undefined {
  const s = css.trim().toLowerCase()
  const m = /^(\d+(?:\.\d+)?)\s*(pt|px)$/.exec(s)
  if (m) {
    const px = m[2] === 'pt' ? Number(m[1]) * 4 / 3 : Number(m[1])
    return normalizeTextSize(`${Math.min(TEXT_SIZE_PX.max, Math.max(TEXT_SIZE_PX.min, Math.round(px * 2) / 2))}px`)
  }
  const named: Record<string, TextSizePreset> = { 'xx-small': 'xs', 'x-small': 'xs', small: 'sm', medium: 'base', large: 'lg', 'x-large': 'xl', 'xx-large': '2xl' }
  return named[s]
}

/* ── Fonts ───────────────────────────────────────────────────────────── */

/** The curated families: the theme's own (sans / serif / mono) and the common InfoPath fonts, each a safe web stack. */
export const TEXT_FONTS = {
  sans: { label: 'Sans serif (theme)', stack: 'var(--theme-font-sans, var(--font-sans)), ui-sans-serif, system-ui, sans-serif' },
  serif: { label: 'Serif', stack: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif' },
  mono: { label: 'Monospace', stack: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace' },
  calibri: { label: 'Calibri', stack: 'Calibri, Carlito, "Segoe UI", Arial, sans-serif' },
  segoe_ui: { label: 'Segoe UI', stack: '"Segoe UI", "Segoe UI Web (West European)", -apple-system, BlinkMacSystemFont, Roboto, Arial, sans-serif' },
  arial: { label: 'Arial', stack: 'Arial, "Helvetica Neue", Helvetica, "Liberation Sans", sans-serif' },
  verdana: { label: 'Verdana', stack: 'Verdana, "DejaVu Sans", Geneva, sans-serif' },
  tahoma: { label: 'Tahoma', stack: 'Tahoma, Verdana, "Segoe UI", "DejaVu Sans", sans-serif' },
  times_new_roman: { label: 'Times New Roman', stack: '"Times New Roman", Times, "Liberation Serif", serif' },
  georgia: { label: 'Georgia', stack: 'Georgia, "Times New Roman", Times, serif' },
  courier_new: { label: 'Courier New', stack: '"Courier New", Courier, "Liberation Mono", monospace' },
} as const
export type TextFont = keyof typeof TEXT_FONTS
export const TEXT_FONT_KEYS = Object.keys(TEXT_FONTS) as TextFont[]

/** A stored font → a key of TEXT_FONTS (its label or a family name as InfoPath writes it accepted), or undefined. */
export function normalizeTextFont(raw: unknown): TextFont | undefined {
  if (typeof raw !== 'string') return undefined
  const s = raw.trim().toLowerCase()
  if ((TEXT_FONT_KEYS as string[]).includes(s)) return s as TextFont
  return fontFromCss(s)
}

/** A CSS font-family list (InfoPath writes `FONT-FAMILY: Calibri` or `'Times New Roman', serif`) → the first family we carry, or undefined. */
export function fontFromCss(css: string): TextFont | undefined {
  const families = css.split(',').map((f) => f.trim().replace(/^['"]|['"]$/g, '').toLowerCase()).filter(Boolean)
  const by: Record<string, TextFont> = {
    calibri: 'calibri', carlito: 'calibri', 'segoe ui': 'segoe_ui', segoe: 'segoe_ui', arial: 'arial', helvetica: 'arial', 'arial narrow': 'arial', 'arial unicode ms': 'arial',
    verdana: 'verdana', tahoma: 'tahoma', 'ms sans serif': 'tahoma', 'microsoft sans serif': 'tahoma', 'times new roman': 'times_new_roman', times: 'times_new_roman',
    georgia: 'georgia', cambria: 'serif', garamond: 'serif', 'book antiqua': 'serif', 'courier new': 'courier_new', courier: 'courier_new', consolas: 'mono', 'lucida console': 'mono',
    'sans-serif': 'sans', serif: 'serif', monospace: 'mono', 'trebuchet ms': 'sans', 'century gothic': 'sans', 'franklin gothic': 'sans',
  }
  for (const f of families) if (by[f]) return by[f]
  return undefined
}

/* ── Colours ─────────────────────────────────────────────────────────── */

/** Theme colour tokens (AA in every built-in theme, light and dark). */
export const TEXT_COLOR_TOKENS = ['danger', 'warning', 'success', 'info', 'accent', 'neutral', 'muted'] as const
export type TextColorToken = (typeof TEXT_COLOR_TOKENS)[number]
export const TEXT_COLOR_LABELS: Record<TextColorToken, string> = {
  danger: 'Red (danger)', warning: 'Amber (warning)', success: 'Green (success)', info: 'Blue (info)', accent: 'Brand (accent)', neutral: 'Text colour', muted: 'Muted grey',
}
const TOKEN_CSS: Record<TextColorToken, string> = {
  danger: 'var(--theme-danger)', warning: 'var(--theme-warning)', success: 'var(--theme-success)', info: 'var(--status-info)',
  accent: 'var(--theme-primary-text)', neutral: 'var(--theme-card-text)', muted: 'var(--theme-muted-text)',
}
const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/

/** A stored colour → a tone token or a lower-case `#rrggbb`, or undefined (anything else — names, rgb(), url(), var() — dropped). */
export function normalizeTextColor(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const s = raw.trim().toLowerCase()
  if ((TEXT_COLOR_TOKENS as readonly string[]).includes(s)) return s
  if (!HEX_RE.test(s)) return undefined
  return s.length === 4 ? `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}` : s
}

/** A CSS colour as InfoPath writes it (#c00, red, rgb(…), windowtext) → `#rrggbb`, or undefined for the default text colour. */
export function colorFromCss(css: string): string | undefined {
  const named: Record<string, string> = { red: '#ff0000', green: '#008000', blue: '#0000ff', orange: '#ffa500', yellow: '#ffff00', purple: '#800080', gray: '#808080', grey: '#808080', white: '#ffffff', maroon: '#800000', navy: '#000080', teal: '#008080', olive: '#808000', lime: '#00ff00', fuchsia: '#ff00ff', silver: '#c0c0c0', darkred: '#8b0000', darkblue: '#00008b', darkgreen: '#006400' }
  let s = css.trim().toLowerCase()
  if (!s || ['windowtext', 'black', 'auto', 'inherit', 'initial', 'currentcolor'].includes(s)) return undefined
  if (named[s]) s = named[s]
  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(s)
  if (rgb) s = `#${[rgb[1], rgb[2], rgb[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('')}`
  const hex = normalizeTextColor(s)
  return hex && hex.startsWith('#') && hex !== '#000000' ? hex : undefined
}

/** Cards a hex colour is held to (light: white / near-white; dark: the built-in dark cards). */
const LIGHT_CARDS = ['#ffffff', '#f8fafc', '#f4efe4']
const DARK_CARDS = ['#0f172a', '#18181b', '#1e293b', '#262626']
const AA = 4.5

/** A colour's CSS for light and dark mode (a token: its theme variable in both; a hex: legible variants), or undefined. */
export function textColorCss(color: unknown): { light: string; dark: string } | undefined {
  const c = normalizeTextColor(color)
  if (!c) return undefined
  if (!c.startsWith('#')) { const v = TOKEN_CSS[c as TextColorToken]; return { light: v, dark: v } }
  const backs = (list: string[]) => list.map((b) => { const p = parseColor(b); return p ? { ...p, a: 1 } : null })
  const light = ensureContrast(c, backs(LIGHT_CARDS), AA).toLowerCase()
  const dark = ensureContrast(c, backs(DARK_CARDS), AA).toLowerCase()
  // ensureContrast only ever returns hex colours; checked again so nothing else can reach a style.
  return { light: HEX_RE.test(light) ? light : c, dark: HEX_RE.test(dark) ? dark : c }
}

/* ── Styles ──────────────────────────────────────────────────────────── */

export interface TextStyle {
  size?: string
  font?: TextFont
  color?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
}

/** A control's text styling: its label (a List column: the header) and its value (the cells). */
export interface ControlTextStyle {
  label?: TextStyle
  value?: TextStyle
}

/** A stored text style → a clean one (whitelisted values only), or undefined when it styles nothing. */
export function normalizeTextStyle(raw: unknown): TextStyle | undefined {
  if (!isPlainObject(raw)) return undefined
  const out: TextStyle = {}
  const size = normalizeTextSize(raw.size)
  if (size) out.size = size
  const font = normalizeTextFont(raw.font)
  if (font) out.font = font
  const color = normalizeTextColor(raw.color)
  if (color) out.color = color
  if (raw.bold === true) out.bold = true
  if (raw.italic === true) out.italic = true
  if (raw.underline === true) out.underline = true
  return Object.keys(out).length ? out : undefined
}

/** A stored control text style (`{ label?, value? }`) → a clean one, or undefined. */
export function normalizeControlTextStyle(raw: unknown): ControlTextStyle | undefined {
  if (!isPlainObject(raw)) return undefined
  const label = normalizeTextStyle(raw.label)
  const value = normalizeTextStyle(raw.value)
  if (!label && !value) return undefined
  return { ...(label ? { label } : {}), ...(value ? { value } : {}) }
}

/** A short description ("Large, Georgia, #c00000, bold"). */
export function describeTextStyle(style: TextStyle | null | undefined): string {
  if (!style) return 'default'
  const parts: string[] = []
  if (style.size) parts.push((TEXT_SIZE_PRESETS as readonly string[]).includes(style.size) ? TEXT_SIZE_LABELS[style.size as TextSizePreset] : style.size)
  if (style.font) parts.push(TEXT_FONTS[style.font].label)
  if (style.color) parts.push(style.color.startsWith('#') ? style.color : TEXT_COLOR_LABELS[style.color as TextColorToken] ?? style.color)
  if (style.bold) parts.push('bold')
  if (style.italic) parts.push('italic')
  if (style.underline) parts.push('underline')
  return parts.join(', ') || 'default'
}

/** Props that draw a text style: data attributes plus custom properties (spread on the element). */
export type TextStyleProps = Record<string, string | Record<string, string>> & { style?: Record<string, string> }

/**
 * The props that draw a text style (app/conditional-style.css reads them):
 * `data-<prefix>` and one attribute per property, the values as custom
 * properties in `style`. `prefix`: `ts` (static styles) or `cs` (conditional
 * styles — drawn after, so they win). Nothing for no style.
 */
export function textStyleProps(style: TextStyle | null | undefined, prefix: 'ts' | 'cs' = 'ts'): TextStyleProps {
  if (!style) return {}
  const out: TextStyleProps = {}
  const vars: Record<string, string> = {}
  const size = textSizeCss(style.size)
  if (size) { out[`data-${prefix}-size`] = ''; vars[`--${prefix}-size`] = size }
  const font = style.font && TEXT_FONTS[style.font] ? TEXT_FONTS[style.font].stack : undefined
  if (font) { out[`data-${prefix}-font`] = ''; vars[`--${prefix}-font`] = font }
  const color = textColorCss(style.color)
  if (color) { out[`data-${prefix}-color`] = ''; vars[`--${prefix}-color-light`] = color.light; vars[`--${prefix}-color-dark`] = color.dark }
  if (prefix === 'ts') {
    if (style.bold) out['data-ts-bold'] = ''
    if (style.italic) out['data-ts-italic'] = ''
    if (style.underline) out['data-ts-underline'] = ''
  }
  if (!Object.keys(out).length) return {}
  if (prefix === 'ts') out['data-ts'] = ''
  if (Object.keys(vars).length) out.style = vars
  return out
}

/** Props for a control's label / value (empty when the control has no text style). */
export function labelStyleProps(field: { text_style?: ControlTextStyle } | null | undefined): TextStyleProps {
  return textStyleProps(field?.text_style?.label)
}
export function valueStyleProps(field: { text_style?: ControlTextStyle } | null | undefined): TextStyleProps {
  return textStyleProps(field?.text_style?.value)
}

/** Two prop sets on one element: data attributes merged, the custom properties of both kept. */
export function mergeStyleProps(...sets: Array<Record<string, unknown> | null | undefined>): TextStyleProps {
  const out: TextStyleProps = {}
  let style: Record<string, string> | undefined
  for (const s of sets) {
    if (!s) continue
    for (const [k, v] of Object.entries(s)) {
      if (k === 'style') { if (isPlainObject(v)) style = { ...(style ?? {}), ...(v as Record<string, string>) } }
      else if (typeof v === 'string') out[k] = v
    }
  }
  if (style && Object.keys(style).length) out.style = style
  return out
}
