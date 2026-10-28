/**
 * WorkspaceTheme — the one brand theme every member of a workspace sees.
 *
 * Shared by the renderer (lib/theme/to-css.ts), the service
 * (lib/services/workspace-theme.ts) and, later, the designer UI, REST, MCP and
 * config-as-code. Validation is strict on purpose: every value ends up in a
 * server-rendered <style> tag, so colours, lengths, shadows, font names and
 * URLs are each limited to a closed grammar (no `url()`, `var()`, quotes,
 * semicolons or braces can get through) and unknown keys are rejected.
 */

import { z } from 'zod'
import { isValidColor } from './colors'
import { FONT_FAMILY_RE, SYSTEM_FONT_STACKS, findCuratedFont } from './fonts'
import { getPublicConfig } from '@/lib/config/public'
import { isOwnStorageObject } from '@/lib/storage/refs'

export const WORKSPACE_THEME_SCHEMA_VERSION = 1

// ── primitives ──────────────────────────────────────────────────────────────

export const ColorSchema = z.string().trim().max(64).refine(isValidColor, {
  message: 'Colours must be #rgb, #rrggbb, #rrggbbaa, rgb(), rgba(), hsl() or hsla()',
})

const SHADOW_COLOR_RE = /(?:#[0-9a-f]{3,8}\b|rgba?\([^()]*\)|hsla?\([^()]*\))/gi
const SHADOW_TOKEN_RE = /^(?:inset|0|-?\d{1,3}(?:\.\d+)?(?:px|rem|em))$/

/** `none` or a comma list of box shadows made of lengths, `inset` and accepted colours. */
export function isValidShadow(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 300) return false
  const v = value.trim()
  if (v === 'none') return true
  if (/[;{}\\'"<>]|url\(|var\(|expression/i.test(v)) return false
  for (const layer of v.split(/,(?![^(]*\))/)) {
    const colors = layer.match(SHADOW_COLOR_RE) ?? []
    if (colors.length > 1 || colors.some((c) => !isValidColor(c))) return false
    const rest = layer.replace(SHADOW_COLOR_RE, ' ').trim().split(/\s+/).filter(Boolean)
    if (rest.length < 2 || rest.length > 5 || !rest.every((t) => SHADOW_TOKEN_RE.test(t))) return false
  }
  return true
}

export const ShadowSchema = z.string().trim().refine(isValidShadow, { message: 'Shadows must be `none` or lengths plus one colour per layer' })

/** Radius in px (9999 = pill). */
const Radius = z.number().int().min(0).max(9999)

const LetterSpacing = z.string().trim().regex(/^(?:normal|-?0(?:\.\d{1,3})?em)$/, 'Letter spacing must be `normal` or an em value between -1em and 1em')

const Weight = z.number().int().min(100).max(900).refine((w) => w % 100 === 0, { message: 'Font weights are multiples of 100' })

/**
 * An object in one of our own storage `buckets`: a `storage://` reference, the
 * app's /files route, a public base URL configured for the store, or a
 * (legacy) Supabase public URL on our Supabase origin. The tenant-folder
 * check needs the tenant id and is done by the service.
 */
export function isOwnStorageUrl(value: unknown, buckets: readonly string[], supabaseUrl?: string): value is string {
  if (typeof value !== 'string' || value.length > 500) return false
  const config = supabaseUrl === undefined ? undefined : { ...getPublicConfig(), supabaseUrl }
  return isOwnStorageObject(value, buckets, config)
}

const ImageUrl = z.string().refine((v) => isOwnStorageUrl(v, ['logos']), { message: 'Images must be uploads in this workspace’s logos storage' })
const FontUrl = z.string().refine((v) => isOwnStorageUrl(v, ['brand-fonts']) && /\.woff2(?:\?.*)?$/i.test(v), { message: 'Font files must be woff2 uploads in this workspace’s brand-fonts storage' })

// ── fonts ───────────────────────────────────────────────────────────────────

const FamilyName = z.string().trim().regex(FONT_FAMILY_RE, 'Font family names may contain letters, digits, spaces and hyphens only')

export const FontRefSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('google'),
    family: FamilyName.refine((f) => Boolean(findCuratedFont(f)), { message: 'Not one of the supported Google Fonts' }),
  }).strict(),
  z.object({
    source: z.literal('system'),
    family: z.enum(Object.keys(SYSTEM_FONT_STACKS) as [string, ...string[]]),
  }).strict(),
  z.object({
    source: z.literal('upload'),
    family: FamilyName,
    url: FontUrl,
  }).strict(),
])
export type FontRef = z.infer<typeof FontRefSchema>

// ── colours ─────────────────────────────────────────────────────────────────

const StatusSchema = z.object({
  todo: ColorSchema, todoBg: ColorSchema,
  progress: ColorSchema, progressBg: ColorSchema,
  blocked: ColorSchema, blockedBg: ColorSchema,
  done: ColorSchema, doneBg: ColorSchema,
  info: ColorSchema, infoBg: ColorSchema,
  warningBg: ColorSchema, dangerBg: ColorSchema, successBg: ColorSchema,
}).strict()

export const PaletteSchema = z.object({
  primary: ColorSchema,
  primaryHover: ColorSchema,
  primaryLight: ColorSchema,
  /** Text on primary fills; derived from the primary (best of white / ink) when omitted. */
  onPrimary: ColorSchema.optional(),
  accent: ColorSchema,
  accentLight: ColorSchema,
  sidebar: ColorSchema,
  sidebarText: ColorSchema,
  sidebarActive: ColorSchema,
  sidebarBorder: ColorSchema,
  /** Wordmark / active item on the sidebar; derived (primary → accent → text, ≥3:1) when omitted. */
  sidebarAccent: ColorSchema.optional(),
  topbar: ColorSchema,
  topbarText: ColorSchema,
  surface: ColorSchema,
  surfaceBorder: ColorSchema,
  cardBg: ColorSchema,
  cardText: ColorSchema,
  mutedText: ColorSchema,
  success: ColorSchema,
  warning: ColorSchema,
  danger: ColorSchema,
  info: ColorSchema,
  status: StatusSchema,
  rowHighlight: ColorSchema,
  rowHighlightStrong: ColorSchema,
  /** Focus ring; the primary when omitted. */
  focusRing: ColorSchema.optional(),
  /** Form control background / border; card background / surface border when omitted. */
  inputBg: ColorSchema.optional(),
  inputBorder: ColorSchema.optional(),
  /** Modal backdrop. */
  overlay: ColorSchema,
  /** Chart series, in order. */
  chart: z.array(ColorSchema).min(6).max(10),
}).strict()
export type ThemePalette = z.infer<typeof PaletteSchema>

// ── chrome (sidebar / topbar / canvas backgrounds) ──────────────────────────

export const GradientSchema = z.object({
  angle: z.number().int().min(0).max(360),
  stops: z.array(z.object({ color: ColorSchema, at: z.number().min(0).max(100) }).strict()).min(2).max(3),
}).strict()

export const TextureSchema = z.object({
  pattern: z.literal('dots'),
  color: ColorSchema,
  /** Grid spacing in px. */
  size: z.number().int().min(8).max(64),
}).strict()

const BackgroundStyle = z.enum(['solid', 'gradient', 'texture'])

const SurfaceChrome = z.object({
  /** solid = the palette colour; gradient = `gradient`; texture = dots over the gradient (or the solid colour). */
  style: BackgroundStyle,
  gradient: GradientSchema.optional(),
  texture: TextureSchema.optional(),
}).strict()

export const SidebarChromeSchema = SurfaceChrome.extend({
  glow1: ColorSchema,
  glow2: ColorSchema,
  hoverBg: ColorSchema,
  brandColor: ColorSchema,
  /** Floating illustrations + glows: off, on (for dark sidebars), light (recoloured for light sidebars). */
  decorations: z.enum(['off', 'on', 'light']),
  /** Illustration colour for `light` decorations. */
  decorationColor: ColorSchema.optional(),
}).strict()

export const ChromeSchema = z.object({
  sidebar: SidebarChromeSchema,
  topbar: SurfaceChrome,
  /** Main content area: optional dot texture over the surface colour. */
  canvas: z.object({ texture: TextureSchema.optional() }).strict(),
}).strict()

// ── the theme ───────────────────────────────────────────────────────────────

/** Built-in canvas effects that the model can't express (kept as CSS keyed by name). */
export const DECORATION_PRESETS = ['dawn', 'nebula'] as const

export const WorkspaceThemeSchema = z.object({
  meta: z.object({
    name: z.string().trim().min(1).max(80).regex(/^[^<>{}]*$/, 'Name may not contain <, >, { or }'),
    /** Built-in template this theme started from (informational; THEMES id). */
    basePreset: z.string().regex(/^[a-z0-9-]{1,40}$/).optional(),
    /** auto = follow the OS light/dark setting; light/dark force one palette. */
    mode: z.enum(['auto', 'light', 'dark']),
    schemaVersion: z.literal(WORKSPACE_THEME_SCHEMA_VERSION),
    decorationPreset: z.enum(DECORATION_PRESETS).optional(),
  }).strict(),
  colors: z.object({ light: PaletteSchema, dark: PaletteSchema }).strict(),
  typography: z.object({
    sans: FontRefSchema,
    display: FontRefSchema,
    mono: FontRefSchema,
    weights: z.object({
      normal: Weight,
      medium: Weight,
      semibold: Weight,
      bold: Weight,
      /** Page-title weight; headings keep their own classes when omitted. */
      heading: Weight.optional(),
    }).strict(),
    /** Root font size in px — rem-based sizes scale with it (16 = browser default). */
    baseSize: z.number().min(12).max(20),
    /** Which family h1/h2 use. `sans` leaves headings alone. */
    headingFont: z.enum(['sans', 'display']),
    headingLetterSpacing: LetterSpacing,
    uppercaseLabels: z.boolean(),
  }).strict(),
  shape: z.object({
    cardRadius: Radius,
    buttonRadius: Radius,
    inputRadius: Radius,
    badgeRadius: Radius,
    dialogRadius: Radius,
  }).strict(),
  shadows: z.object({
    sm: ShadowSchema,
    md: ShadowSchema,
    lg: ShadowSchema,
    xl: ShadowSchema,
    card: ShadowSchema,
  }).strict(),
  layout: z.object({
    density: z.enum(['compact', 'comfortable', 'spacious']),
    sidebarWidth: z.number().int().min(200).max(360),
    topbarHeight: z.number().int().min(48).max(72),
  }).strict(),
  chrome: ChromeSchema,
  branding: z.object({
    logoLight: ImageUrl.optional(),
    logoDark: ImageUrl.optional(),
    favicon: ImageUrl.optional(),
    wordmark: z.string().trim().max(40).regex(/^[^<>{}]*$/).optional(),
  }).strict(),
}).strict()

export type WorkspaceTheme = z.infer<typeof WorkspaceThemeSchema>
export type ThemeMode = 'light' | 'dark'

/** Largest stored theme (bytes of JSON) the service accepts. */
export const MAX_THEME_BYTES = 64 * 1024

export function formatThemeIssues(error: z.ZodError): string {
  return error.issues.slice(0, 5).map((i) => `${i.path.join('.') || 'theme'}: ${i.message}`).join('; ')
}
