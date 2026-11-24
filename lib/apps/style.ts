import { z } from 'zod'

/**
 * Widget styling (pure, isomorphic; __tests__/apps-style.test.ts): optional
 * overrides of the theme for one widget, a named preset of the app, or the
 * app's default widget style — inherited app default → preset → widget.
 *
 * Every value is typed and validated — colours are theme tokens
 * ("token:primary"), hex (#rgb, #rgba, #rrggbb, #rrggbbaa) or rgb() / rgba()
 * / hsl() / hsla() with numbers only; images are https:// or /path addresses
 * without quotes, parentheses or spaces. There is no raw CSS anywhere: the
 * runtime turns a style into CSS custom properties on the widget's container
 * (`styleVars`), so components keep using tokens (text-fg, bg-panel,
 * --theme-primary, --app-chart-n) and simply see the overridden values.
 *
 * Light / dark: each colour is one value, or { light, dark }. With only one
 * value, the other mode reuses it — except backgrounds and text, which are
 * derived (mixed towards the dark / light surface) so they stay readable.
 */

const NUM = '(?:\\d{1,3}(?:\\.\\d+)?)'
const ALPHA = '(?:0|1|0?\\.\\d+|\\d{1,3}%)'
const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const RGB_RE = new RegExp(`^rgba?\\(\\s*${NUM}\\s*,\\s*${NUM}\\s*,\\s*${NUM}\\s*(?:,\\s*${ALPHA}\\s*)?\\)$`, 'i')
const HSL_RE = new RegExp(`^hsla?\\(\\s*${NUM}(?:deg)?\\s*,\\s*${NUM}%\\s*,\\s*${NUM}%\\s*(?:,\\s*${ALPHA}\\s*)?\\)$`, 'i')

/** Theme tokens a colour may name (theme-aware: they follow light / dark and the workspace theme). */
export const COLOR_TOKENS = {
  primary: 'var(--theme-primary)', accent: 'var(--app-accent, var(--theme-primary))', success: 'var(--theme-success)', warning: 'var(--theme-warning)',
  danger: 'var(--theme-danger)', info: 'var(--theme-info, var(--theme-primary))', surface: 'var(--ds-bg-elevated)', subtle: 'var(--ds-bg-subtle)',
  text: 'var(--theme-card-text)', muted: 'var(--theme-muted-text)', border: 'var(--ds-border)',
  'chart-1': 'var(--tag-blue, #2563eb)', 'chart-2': 'var(--tag-violet, #7c3aed)', 'chart-3': 'var(--tag-teal, #0d9488)', 'chart-4': 'var(--tag-amber, #d97706)',
  'chart-5': 'var(--tag-rose, #e11d48)', 'chart-6': 'var(--tag-green, #16a34a)', 'chart-7': 'var(--tag-sky, #0284c7)', 'chart-8': 'var(--tag-orange, #ea580c)',
} as const
export type ColorToken = keyof typeof COLOR_TOKENS
export const COLOR_TOKEN_NAMES = Object.keys(COLOR_TOKENS) as ColorToken[]

/** Is this a safe colour value (a token, hex, rgb(a) or hsl(a) — nothing else)? */
export function isColor(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 60) return false
  if (v.startsWith('token:')) return Object.hasOwn(COLOR_TOKENS, v.slice(6))
  return HEX_RE.test(v) || RGB_RE.test(v) || HSL_RE.test(v)
}

export const colorSchema = z.string().max(60).refine(isColor, 'A theme token (token:primary), #hex, rgb(a)() or hsl(a)() colour')
export const themedColorSchema = z.union([colorSchema, z.object({ light: colorSchema, dark: colorSchema.nullable().optional() }).strict()])
export type ThemedColor = z.infer<typeof themedColorSchema>

export const COLOR_KEYS = [
  'background', 'border', 'title', 'text', 'muted', 'accent', 'header', 'kpi_value',
  'button_bg', 'button_text', 'button_border', 'table_header', 'table_stripe', 'table_hover',
  'tab_active', 'tab_inactive', 'nav_bg', 'nav_item', 'nav_active',
] as const
export type ColorKey = (typeof COLOR_KEYS)[number]
export const COLOR_LABELS: Record<ColorKey, string> = {
  background: 'Background', border: 'Border', title: 'Title text', text: 'Body text', muted: 'Muted text', accent: 'Accent (buttons, links, active)', header: 'Header bar',
  kpi_value: 'KPI value', button_bg: 'Button background', button_text: 'Button text', button_border: 'Button border', table_header: 'Table header',
  table_stripe: 'Table row stripe', table_hover: 'Table row hover', tab_active: 'Active tab', tab_inactive: 'Inactive tab', nav_bg: 'Nav bar background',
  nav_item: 'Nav item', nav_active: 'Active nav item',
}

export const PALETTE_PRESETS = {
  vivid: ['#2563eb', '#7c3aed', '#0d9488', '#d97706', '#e11d48', '#16a34a', '#0284c7', '#ea580c'],
  pastel: ['#93c5fd', '#c4b5fd', '#99f6e4', '#fde68a', '#fecdd3', '#bbf7d0', '#bae6fd', '#fed7aa'],
  warm: ['#b91c1c', '#ea580c', '#d97706', '#ca8a04', '#be185d', '#9a3412', '#f59e0b', '#fb7185'],
  cool: ['#1d4ed8', '#0369a1', '#0f766e', '#4338ca', '#0891b2', '#2563eb', '#14b8a6', '#6366f1'],
  mono: ['#1e3a8a', '#1e40af', '#1d4ed8', '#2563eb', '#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe'],
} as const
export type PalettePreset = keyof typeof PALETTE_PRESETS

const safeImage = z.string().max(2000).regex(/^(https:\/\/[^\s"'()\\<>]+|\/(?!\/)[^\s"'()\\<>]*)$/, 'An https:// address or a /path (no quotes, spaces or parentheses)')

export const widgetStyleSchema = z.object({
  /** A named style of the app (its presets) this widget starts from. */
  preset: z.string().trim().min(1).max(60).nullable().optional(),
  colors: z.object(Object.fromEntries(COLOR_KEYS.map((k) => [k, themedColorSchema.nullable().optional()])) as Record<ColorKey, z.ZodOptional<z.ZodNullable<typeof themedColorSchema>>>).strict().optional(),
  /** Chart series / category colours: a preset, or colours in order (up to 8). */
  palette: z.union([z.enum(Object.keys(PALETTE_PRESETS) as [PalettePreset, ...PalettePreset[]]), z.array(colorSchema).min(1).max(8)]).nullable().optional(),
  /** A colour per value: chart categories, status / badge values. */
  value_colors: z.array(z.object({ value: z.string().trim().min(1).max(80), color: colorSchema }).strict()).max(24).optional(),
  radius: z.enum(['none', 'sm', 'md', 'lg', 'xl']).nullable().optional(),
  border_width: z.number().int().min(0).max(4).nullable().optional(),
  border_style: z.enum(['solid', 'dashed', 'dotted', 'none']).nullable().optional(),
  shadow: z.enum(['none', 'sm', 'md', 'lg']).nullable().optional(),
  padding: z.enum(['compact', 'comfortable', 'spacious']).nullable().optional(),
  background_image: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('image'), url: safeImage, fit: z.enum(['cover', 'contain']).default('cover') }).strict(),
    z.object({ kind: z.literal('gradient'), from: colorSchema, to: colorSchema, angle: z.number().int().min(0).max(360).default(135) }).strict(),
  ]).nullable().optional(),
  title_size: z.enum(['sm', 'md', 'lg', 'xl']).nullable().optional(),
  title_weight: z.enum(['normal', 'medium', 'semibold', 'bold']).nullable().optional(),
  value_size: z.enum(['sm', 'md', 'lg', 'xl']).nullable().optional(),
  value_weight: z.enum(['normal', 'medium', 'semibold', 'bold']).nullable().optional(),
  align: z.enum(['left', 'center', 'right']).nullable().optional(),
}).strict()
export type WidgetStyle = z.output<typeof widgetStyleSchema>

export const MAX_STYLE_PRESETS = 30
export const appStyleSchema = z.object({
  /** Every widget of the app inherits this (overridable per widget). */
  default: widgetStyleSchema.nullable().optional(),
  presets: z.array(z.object({ name: z.string().trim().min(1).max(60), style: widgetStyleSchema }).strict()).max(MAX_STYLE_PRESETS).default([]),
}).strict()
export type AppStyle = z.output<typeof appStyleSchema>

/** Per-button colours (Buttons widget). */
export const buttonColorsSchema = z.object({ bg: themedColorSchema.nullable().optional(), text: themedColorSchema.nullable().optional(), border: themedColorSchema.nullable().optional() }).strict()

export function normaliseAppStyle(raw: unknown): AppStyle {
  const p = appStyleSchema.safeParse(raw ?? {})
  return p.success ? p.data : { presets: [] }
}

/* ── Inheritance ─────────────────────────────────────────────────────── */

const isEmpty = (v: unknown) => v === null || v === undefined

/** b over a: scalars replace, colours merge per key, lists replace. */
export function mergeStyles(a: WidgetStyle | null | undefined, b: WidgetStyle | null | undefined): WidgetStyle {
  const out: Record<string, unknown> = { ...(a ?? {}) }
  for (const [k, v] of Object.entries(b ?? {})) {
    if (isEmpty(v)) continue
    if (k === 'colors') {
      const merged = { ...((a?.colors ?? {}) as Record<string, unknown>) }
      for (const [ck, cv] of Object.entries(v as Record<string, unknown>)) if (!isEmpty(cv)) merged[ck] = cv
      out.colors = merged
    } else out[k] = v
  }
  delete out.preset
  return out as WidgetStyle
}

/** The style a widget renders with: the app default, then its preset, then its own overrides. */
export function resolveWidgetStyle(app: AppStyle | null | undefined, widget: WidgetStyle | null | undefined): WidgetStyle {
  const preset = widget?.preset ? app?.presets.find((p) => p.name === widget.preset)?.style : null
  return mergeStyles(mergeStyles(app?.default ?? null, preset ?? null), widget ?? null)
}

export function isStyled(s: WidgetStyle | null | undefined): boolean {
  return !!s && Object.entries(s).some(([k, v]) => k !== 'preset' && !isEmpty(v) && !(k === 'colors' && !Object.values(v as object).some((x) => !isEmpty(x))) && !(Array.isArray(v) && !v.length))
}

/* ── Colours ─────────────────────────────────────────────────────────── */

/** A safe colour as a CSS value (tokens → their variable). */
export function cssColor(c: string): string {
  return c.startsWith('token:') ? COLOR_TOKENS[c.slice(6) as ColorToken] : c
}

/** Parse a literal colour to RGBA (0–255, alpha 0–1); tokens → null (can't be judged here). */
export function parseColor(c: string): { r: number; g: number; b: number; a: number } | null {
  if (!isColor(c) || c.startsWith('token:')) return null
  if (c.startsWith('#')) {
    let h = c.slice(1)
    if (h.length <= 4) h = h.split('').map((x) => x + x).join('')
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16)
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 }
  }
  const nums = (c.match(/[\d.]+%?/g) ?? []).map((x) => x)
  const alpha = (s: string | undefined) => (s === undefined ? 1 : s.endsWith('%') ? Number(s.slice(0, -1)) / 100 : Number(s))
  if (/^rgb/i.test(c)) return { r: Math.min(255, Number(nums[0])), g: Math.min(255, Number(nums[1])), b: Math.min(255, Number(nums[2])), a: alpha(nums[3]) }
  const h = (Number(nums[0]) % 360) / 360, s = Math.min(100, Number(nums[1].replace('%', ''))) / 100, l = Math.min(100, Number(nums[2].replace('%', ''))) / 100
  const f = (n: number) => { const k = (n + h * 12) % 12; const a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)) }
  return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255), a: alpha(nums[3]) }
}

export function toHex(c: { r: number; g: number; b: number }): string {
  return `#${[c.r, c.g, c.b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')}`
}

function luminance(c: { r: number; g: number; b: number }): number {
  const ch = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b)
}

/** WCAG contrast ratio of two literal colours (alpha composited over the background, the background over white); null for tokens. */
export function contrastRatio(fg: string, bg: string): number | null {
  const f = parseColor(fg), b0 = parseColor(bg)
  if (!f || !b0) return null
  const over = (top: { r: number; g: number; b: number; a: number }, under: { r: number; g: number; b: number }) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a) })
  const b = over(b0, { r: 255, g: 255, b: 255 })
  const l1 = luminance(over(f, b)), l2 = luminance(b)
  return Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100
}

/** WCAG AA: 4.5 for body text, 3 for large text / UI parts. */
export function meetsAA(fg: string, bg: string, large = false): boolean | null {
  const r = contrastRatio(fg, bg)
  return r === null ? null : r >= (large ? 3 : 4.5)
}

/** Text / background pairs of a style that fail AA, per mode (literal colours only). */
export function contrastWarnings(style: WidgetStyle): string[] {
  const out: string[] = []
  const c = style.colors ?? {}
  for (const mode of ['light', 'dark'] as const) {
    const bg = c.background ? modeValue(c.background, mode, 'background') : mode === 'light' ? '#ffffff' : '#111827'
    for (const k of ['text', 'title', 'muted', 'kpi_value'] as const) {
      const fg = c[k] ? modeValue(c[k]!, mode, k) : null
      if (!fg || !bg) continue
      const ok = meetsAA(fg, bg, k === 'kpi_value' || k === 'title')
      if (ok === false) out.push(`${COLOR_LABELS[k]} on the background is hard to read in ${mode} mode (contrast ${contrastRatio(fg, bg)}:1, needs ${k === 'kpi_value' || k === 'title' ? 3 : 4.5}:1)`)
    }
    const bb = c.button_bg ? modeValue(c.button_bg, mode, 'button_bg') : null
    const bt = c.button_text ? modeValue(c.button_text, mode, 'button_text') : null
    if (bb && bt && meetsAA(bt, bb) === false) out.push(`Button text on the button background is hard to read in ${mode} mode (contrast ${contrastRatio(bt, bb)}:1)`)
  }
  return [...new Set(out)]
}

const BG_KEYS = new Set<ColorKey>(['background', 'header', 'table_header', 'table_stripe', 'table_hover', 'nav_bg'])
const TEXT_KEYS = new Set<ColorKey>(['title', 'text', 'muted', 'kpi_value', 'nav_item', 'tab_inactive'])

function mix(c: { r: number; g: number; b: number; a: number }, target: { r: number; g: number; b: number }, t: number): string {
  const v = { r: c.r * (1 - t) + target.r * t, g: c.g * (1 - t) + target.g * t, b: c.b * (1 - t) + target.b * t }
  return c.a < 1 ? `rgba(${Math.round(v.r)}, ${Math.round(v.g)}, ${Math.round(v.b)}, ${c.a})` : toHex(v)
}

/**
 * One mode's value of a colour. Only one value given: the other mode reuses
 * it, except light backgrounds / dark text in dark mode (and the reverse),
 * which are mixed towards the dark / light surface so they stay readable.
 */
export function modeValue(c: ThemedColor, mode: 'light' | 'dark', key?: ColorKey): string {
  if (typeof c !== 'string') return mode === 'light' ? c.light : c.dark ?? deriveFor(c.light, 'dark', key)
  return mode === 'light' ? c : deriveFor(c, 'dark', key)
}

function deriveFor(c: string, mode: 'dark' | 'light', key?: ColorKey): string {
  const p = parseColor(c)
  if (!p || !key) return c
  const lum = luminance(p)
  if (mode === 'dark' && BG_KEYS.has(key) && lum > 0.4) return mix(p, { r: 17, g: 24, b: 39 }, 0.82)
  if (mode === 'dark' && TEXT_KEYS.has(key) && lum < 0.2) return mix(p, { r: 249, g: 250, b: 251 }, 0.75)
  return c
}

/* ── CSS custom properties ───────────────────────────────────────────── */

/** The custom property each colour key sets (light / dark pairs are resolved by apps.css). */
export const COLOR_VAR: Record<ColorKey, string> = {
  background: 'bg', border: 'border', title: 'title', text: 'text', muted: 'muted', accent: 'accent', header: 'header', kpi_value: 'kpi',
  button_bg: 'btn-bg', button_text: 'btn-text', button_border: 'btn-border', table_header: 'th', table_stripe: 'stripe', table_hover: 'hover',
  tab_active: 'tab-on', tab_inactive: 'tab-off', nav_bg: 'nav-bg', nav_item: 'nav-item', nav_active: 'nav-active',
}

/** Theme tokens a colour overrides inside the widget (what components read). */
const TOKEN_OVERRIDES: Partial<Record<ColorKey, string[]>> = {
  background: ['--theme-card-bg', '--color-panel'],
  border: ['--ds-border', '--color-border'],
  text: ['--theme-card-text', '--color-fg'],
  muted: ['--theme-muted-text', '--color-fg-muted'],
  accent: ['--theme-primary', '--color-primary', '--app-accent'],
}

const RADIUS = { none: '0px', sm: '4px', md: '8px', lg: '12px', xl: '20px' } as const
const SHADOW = { none: 'none', sm: 'var(--shadow-elev-1)', md: 'var(--shadow-elev-2)', lg: 'var(--shadow-elev-3)' } as const
const PADDING = { compact: '0.5rem', comfortable: '0.75rem', spacious: '1.25rem' } as const
const SIZE = { sm: '0.875', md: '1', lg: '1.25', xl: '1.5' } as const
const WEIGHT = { normal: '400', medium: '500', semibold: '600', bold: '700' } as const

export interface StyleCss {
  /** Custom properties and token overrides: set on the widget container (and its card). */
  vars: Record<string, string>
  /** The card's own box (background, border, radius, shadow, padding, image). */
  box: Record<string, string>
  /** Feature flags for apps.css (table / tab / nav / button rules), space-separated. */
  flags: string
  /** Value → colour (charts, badges). */
  valueColors: Record<string, string>
}

/** A resolved style → CSS custom properties and box properties (values are validated, so nothing here can inject CSS). */
export function styleCss(style: WidgetStyle | null | undefined): StyleCss {
  const vars: Record<string, string> = {}
  const box: Record<string, string> = {}
  const flags = new Set<string>()
  const s = style ?? {}
  for (const key of COLOR_KEYS) {
    const c = s.colors?.[key]
    if (!c || !(typeof c === 'string' ? isColor(c) : isColor(c.light))) continue
    const name = COLOR_VAR[key]
    vars[`--wl-${name}`] = cssColor(modeValue(c, 'light', key))
    vars[`--wd-${name}`] = cssColor(modeValue(c, 'dark', key))
    for (const token of TOKEN_OVERRIDES[key] ?? []) vars[token] = `var(--w-${name})`
    flags.add(name)
  }
  const palette = s.palette ? (typeof s.palette === 'string' ? [...PALETTE_PRESETS[s.palette]] : s.palette) : null
  if (palette) palette.forEach((c, i) => { if (isColor(c)) vars[`--app-chart-${i + 1}`] = cssColor(c) })
  if (s.colors?.background) box.background = 'var(--w-bg)'
  if (s.colors?.border) box.borderColor = 'var(--w-border)'
  if (s.radius) box.borderRadius = RADIUS[s.radius]
  if (s.border_width !== null && s.border_width !== undefined) box.borderWidth = `${s.border_width}px`
  if (s.border_style) box.borderStyle = s.border_style
  if (s.shadow) box.boxShadow = SHADOW[s.shadow]
  if (s.padding) box.padding = PADDING[s.padding]
  const bi = s.background_image
  if (bi?.kind === 'image' && widgetStyleSchema.shape.background_image.safeParse(bi).success) { box.backgroundImage = `url("${bi.url}")`; box.backgroundSize = bi.fit; box.backgroundPosition = 'center' }
  if (bi?.kind === 'gradient' && isColor(bi.from) && isColor(bi.to)) box.backgroundImage = `linear-gradient(${bi.angle}deg, ${cssColor(bi.from)}, ${cssColor(bi.to)})`
  if (s.title_size) vars['--w-title-size'] = `${SIZE[s.title_size]}rem`
  if (s.title_weight) vars['--w-title-weight'] = WEIGHT[s.title_weight]
  if (s.value_size) vars['--w-value-scale'] = SIZE[s.value_size]
  if (s.value_weight) vars['--w-value-weight'] = WEIGHT[s.value_weight]
  if (s.align) { vars['--w-align'] = s.align; flags.add('align') }
  const valueColors = Object.fromEntries((s.value_colors ?? []).filter((v) => isColor(v.color)).map((v) => [v.value.toLowerCase(), cssColor(v.color)]))
  return { vars, box, flags: [...flags].join(' '), valueColors }
}
