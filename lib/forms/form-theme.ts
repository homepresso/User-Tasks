/**
 * Form mini themes: a small set of overrides on top of the workspace theme
 * for one form — accent colour, background, text colour, corner radius, font
 * (from the workspace theme's curated list), density, label position and an
 * optional header (title, logo, banner colour).
 *
 * A form's `theme` is a reference:
 *   { source: 'workspace' }                        inherit (the default)
 *   { source: 'custom', overrides: {...} }          inline mini theme
 *   { source: 'saved', theme_id: '<uuid>' }         a reusable Form theme
 * The engine resolves a saved reference to its overrides when it creates the
 * task (task metadata `form_theme` always holds concrete overrides), so a
 * task keeps the look it was created with.
 *
 * Rendering reuses lib/theme: the overrides are laid onto the workspace
 * palette for the viewer's mode and run through `paletteVars`, whose
 * legibility pass raises any colour below its WCAG target — text is never
 * illegible, whatever was saved. `formThemeContrast` reports what the pass
 * would change so the editor can warn and offer an auto-fix, and the service
 * refuses a theme whose own text/background pair is below 3:1.
 *
 * Colours go through the theme's closed colour grammar (no url(), var(),
 * quotes…), so the values are safe inside a style attribute.
 */

import { z } from 'zod'
import { contrastRatio, withAlpha } from '@/lib/theme/colors'
import { AA_LARGE, AA_TEXT, ensureContrast, flatten, onColor, worstContrast } from '@/lib/theme/legibility'
import { parseColor } from '@/lib/theme/colors'
import { ColorSchema, isOwnStorageUrl, type ThemeMode, type ThemePalette } from '@/lib/theme/schema'
import { CURATED_FONTS, FONT_FAMILY_RE, SYSTEM_FONT_STACKS, findCuratedFont } from '@/lib/theme/fonts'
import { fontFamilyValue, paletteVars } from '@/lib/theme/to-css'
import { presetToWorkspaceTheme } from '@/lib/theme/presets'

export const FormThemeColorsSchema = z.object({
  /** Buttons, focus ring, links, selected options. */
  accent: ColorSchema.optional(),
  /** The form card background (inputs follow it). */
  background: ColorSchema.optional(),
  /** Labels and values. */
  text: ColorSchema.optional(),
  /** The page behind the form (standalone pages, the frame around a task form). */
  page: ColorSchema.optional(),
  /** Second page colour: a vertical gradient from `page` to it. */
  page_to: ColorSchema.optional(),
  /** Inputs, selects, the lookup box (default: the background). */
  input: ColorSchema.optional(),
  /** Borders of inputs and dividers (default: derived from the text). */
  border: ColorSchema.optional(),
  /** Primary buttons (default: the accent). */
  button: ColorSchema.optional(),
}).strict()

const FontSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('google'),
    family: z.string().trim().regex(FONT_FAMILY_RE).refine((f) => Boolean(findCuratedFont(f)), { message: 'Not one of the supported fonts' }),
  }).strict(),
  z.object({
    source: z.literal('system'),
    family: z.enum(Object.keys(SYSTEM_FONT_STACKS) as [string, ...string[]]),
  }).strict(),
])

const SafeText = (max: number) => z.string().trim().max(max).regex(/^[^<>{}]*$/, 'May not contain <, >, { or }')

export const FormThemeOverridesSchema = z.object({
  /** Built-in template the colours started from (informational). */
  base_preset: z.string().regex(/^[a-z0-9-]{1,40}$/).optional(),
  colors: z.object({
    light: FormThemeColorsSchema.optional(),
    /** Dark-mode colours; without them only the accent carries over (made legible). */
    dark: FormThemeColorsSchema.optional(),
  }).strict().optional(),
  /** Corner radius in px for the card, inputs and buttons. */
  radius: z.number().int().min(0).max(24).optional(),
  font: FontSchema.optional(),
  density: z.enum(['compact', 'comfortable']).optional(),
  label_position: z.enum(['top', 'left']).optional(),
  /** Where the form's buttons sit: left, right (default) or full width. */
  button_placement: z.enum(['left', 'right', 'full']).optional(),
  header: z.object({
    enabled: z.boolean(),
    title: SafeText(120).optional(),
    subtitle: SafeText(300).optional(),
    logo_url: z.string().max(500).refine((v) => isOwnStorageUrl(v, ['logos']), { message: 'Logos must be uploads in this workspace’s logos storage' }).optional(),
    banner_color: ColorSchema.optional(),
  }).strict().optional(),
}).strict()

export type FormThemeOverrides = z.infer<typeof FormThemeOverridesSchema>
export type FormThemeColors = z.infer<typeof FormThemeColorsSchema>

export const FormThemeRefSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('workspace') }).strict(),
  z.object({ source: z.literal('custom'), overrides: FormThemeOverridesSchema }).strict(),
  z.object({ source: z.literal('saved'), theme_id: z.string().uuid() }).strict(),
])
export type FormThemeRef = z.infer<typeof FormThemeRefSchema>

export const WORKSPACE_THEME_REF: FormThemeRef = { source: 'workspace' }

/** Stored value → a valid reference (anything unreadable → inherit). */
export function parseFormThemeRef(raw: unknown): FormThemeRef {
  const parsed = FormThemeRefSchema.safeParse(raw)
  return parsed.success ? parsed.data : WORKSPACE_THEME_REF
}

/** Stored overrides → valid overrides, or null (inherit). */
export function parseFormThemeOverrides(raw: unknown): FormThemeOverrides | null {
  if (!raw || typeof raw !== 'object') return null
  const parsed = FormThemeOverridesSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

export function formatFormThemeIssues(error: z.ZodError): string {
  return error.issues.slice(0, 5).map((i) => `${i.path.join('.') || 'theme'}: ${i.message}`).join('; ')
}

/** Starting point from a built-in preset: its primary / card / text colours for both modes. */
export function overridesFromPreset(presetId: string): FormThemeOverrides | null {
  const theme = presetToWorkspaceTheme(presetId)
  if (!theme) return null
  const pick = (p: ThemePalette): FormThemeColors => ({ accent: p.primary, background: p.cardBg, text: p.cardText })
  return {
    base_preset: presetId,
    colors: { light: pick(theme.colors.light), dark: pick(theme.colors.dark) },
    radius: Math.min(24, theme.shape.inputRadius),
  }
}

/** The overrides' colours for one mode (dark falls back to the light accent only). */
export function colorsForMode(overrides: FormThemeOverrides | null | undefined, mode: ThemeMode): FormThemeColors {
  const light = overrides?.colors?.light ?? {}
  if (mode === 'light') return light
  const dark = overrides?.colors?.dark
  if (dark && Object.keys(dark).length) return dark
  return light.accent ? { accent: light.accent } : {}
}

/** Workspace palette with the mini theme's colours laid on (before the legibility pass). */
/**
 * A mid-tone background on which neither white nor ink reaches AA (with a
 * little headroom for the washes drawn on it — chips, the active
 * suggestion): nudged lighter / darker until one does. Others are unchanged.
 */
export function legibleFormBackground(color: string): string {
  const text = onColor(color)
  const ratio = contrastRatio(text, color) ?? 21
  return ratio >= 5 ? color : ensureContrast(color, [flatten(text)], 5)
}

export function overlayPalette(base: ThemePalette, input: FormThemeColors): ThemePalette {
  const colors: FormThemeColors = input.background ? { ...input, background: legibleFormBackground(input.background) } : input
  const p: ThemePalette = structuredClone(base)
  if (colors.background) {
    // Inside the form scope the card is the surface: text is judged (and
    // made legible) against the form background only.
    p.cardBg = colors.background
    p.inputBg = colors.background
    p.surface = colors.background
    p.rowHighlight = withAlpha(colors.text ?? base.cardText, 0.06)
    p.rowHighlightStrong = withAlpha(colors.text ?? base.cardText, 0.1)
  }
  if (colors.text) {
    p.cardText = colors.text
    p.mutedText = withAlpha(colors.text, 0.72)
    if (colors.background) p.surfaceBorder = withAlpha(colors.text, 0.18)
    p.inputBorder = withAlpha(colors.text, 0.28)
  }
  if (colors.accent) {
    p.primary = colors.accent
    p.primaryHover = colors.accent
    p.primaryLight = withAlpha(colors.accent, 0.12)
    p.focusRing = colors.accent
    p.onPrimary = undefined
  }
  if (colors.border) {
    p.surfaceBorder = colors.border
    p.inputBorder = colors.border
  }
  if (colors.button) {
    // Primary buttons get their own colour; the accent keeps focus and selection.
    p.primary = colors.button
    p.primaryHover = colors.button
    p.onPrimary = undefined
    if (!colors.accent) p.primaryLight = withAlpha(colors.button, 0.12)
  }
  if (colors.background && !colors.text) {
    // A new background with the workspace text: let the legibility pass pick.
    p.mutedText = base.mutedText
  }
  // Translucent derived colours can't be judged on their own: flatten them onto the card.
  const card = flatten(p.cardBg)
  if (card && p.mutedText.startsWith('rgba')) {
    const flat = flatten(p.mutedText, card)
    if (flat) p.mutedText = `#${[flat.r, flat.g, flat.b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')}`
  }
  return p
}

export interface FormThemeContrastIssue {
  pair: 'text/background' | 'muted/background' | 'accent/background' | 'button text/accent'
  ratio: number
  required: number
  /** Below 3:1 — practically invisible; saving is refused. */
  blocking: boolean
  /** Colour the renderer will use instead (and the auto-fix applies). */
  fixed: string
}

const round = (n: number) => Math.round(n * 100) / 100

/**
 * Contrast of the mini theme's own pairs for one mode, against the given
 * workspace palette for anything it doesn't override.
 */
export function formThemeContrast(overrides: FormThemeOverrides | null | undefined, base: ThemePalette, mode: ThemeMode): FormThemeContrastIssue[] {
  const colors = colorsForMode(overrides, mode)
  if (!colors.accent && !colors.background && !colors.text && !colors.input && !colors.border && !colors.button) return []
  const p = overlayPalette(base, colors)
  const bg = flatten(p.cardBg, flatten(p.surface) ?? undefined)
  const issues: FormThemeContrastIssue[] = []
  const check = (pair: FormThemeContrastIssue['pair'], fg: string, background: string, required: number, relevant: boolean) => {
    if (!relevant) return
    const ratio = contrastRatio(fg, background, p.surface)
    if (ratio === null || ratio >= required) return
    // Only the text / background pair blocks saving (blockingFormThemeIssues); the rest are raised when drawn.
    issues.push({ pair, ratio: round(ratio), required, blocking: pair === 'text/background' && ratio < AA_LARGE, fixed: ensureContrast(fg, [flatten(background, bg ?? undefined)], required) })
  }
  check('text/background', p.cardText, p.cardBg, AA_TEXT, Boolean(colors.text || colors.background))
  check('muted/background', p.mutedText, p.cardBg, AA_TEXT, Boolean(colors.text || colors.background))
  check('accent/background', p.primary, p.cardBg, AA_LARGE, Boolean(colors.accent || colors.background))
  if (colors.accent) {
    const on = onColor(p.primary)
    const ratio = contrastRatio(on, p.primary)
    if (ratio !== null && ratio < AA_TEXT) {
      issues.push({ pair: 'button text/accent', ratio: round(ratio), required: AA_TEXT, blocking: ratio < AA_LARGE, fixed: ensureContrast(p.primary, [flatten(on)], AA_TEXT) })
    }
  }
  return issues
}

/** Overrides with every failing colour replaced by its legible fix, for both modes (the editor's auto-fix). */
export function autoFixFormTheme(overrides: FormThemeOverrides, palettes: Record<ThemeMode, ThemePalette>): FormThemeOverrides {
  const next: FormThemeOverrides = structuredClone(overrides)
  for (const mode of ['light', 'dark'] as const) {
    const own = next.colors?.[mode]
    if (!own) continue
    for (const issue of formThemeContrast(next, palettes[mode], mode)) {
      if (issue.pair === 'accent/background' || issue.pair === 'button text/accent') own.accent = issue.fixed
    }
    // Text: strong enough that the muted shade derived from it (labels, help) passes too.
    const bg = own.background ?? palettes[mode].cardBg
    for (let target = AA_TEXT; target <= 15 && formThemeContrast(next, palettes[mode], mode).some((i) => i.pair === 'text/background' || i.pair === 'muted/background'); target += 1.5) {
      own.text = ensureContrast(own.text ?? palettes[mode].cardText, [flatten(bg)], target)
    }
  }
  return next
}

/**
 * Problems that block saving: a mode whose explicit text and background are
 * below 3:1 on each other (judged on the theme alone, so the service can check
 * it without the workspace palette).
 */
export function blockingFormThemeIssues(overrides: FormThemeOverrides | null | undefined): string[] {
  const out: string[] = []
  for (const mode of ['light', 'dark'] as const) {
    const c = overrides?.colors?.[mode]
    if (!c) continue
    if (c.text && c.background) {
      const ratio = contrastRatio(c.text, c.background)
      if (ratio !== null && ratio < AA_LARGE) out.push(`${mode} text on background is ${round(ratio)}:1 (needs at least 3:1)`)
    }
    if (c.accent && c.background) {
      const ratio = contrastRatio(c.accent, c.background)
      if (ratio !== null && ratio < 1.5) out.push(`${mode} accent is almost invisible on the background (${round(ratio)}:1)`)
    }
  }
  // Banner text is always picked (white / ink) for the banner colour, so it is never checked here.
  return out
}

export type CssVars = Record<string, string>

/**
 * CSS custom properties for a form card: the overrides on the workspace
 * palette for `mode`, made legible by the theme renderer. Empty when the
 * form inherits the workspace theme.
 */
/** Custom properties a form scope sets (what form controls read). */
const FORM_SCOPE_VARS = [
  '--theme-primary', '--theme-primary-hover', '--theme-on-primary', '--theme-primary-text', '--theme-primary-light',
  '--theme-card-bg', '--theme-card-text', '--theme-muted-text', '--theme-surface-border', '--theme-focus-ring',
  '--theme-input-bg', '--theme-input-border', '--status-blocked', '--theme-success', '--theme-warning',
]

function scopeVars(palette: ThemePalette, inputColor?: string): CssVars {
  // The legibility pass judges text against the card; inputs with their own
  // colour get their own text / placeholder / border tokens below.
  const all = paletteVars(palette)
  const vars: CssVars = {}
  for (const name of FORM_SCOPE_VARS) if (all[name]) vars[name] = all[name]
  // Inputs (components/ui/input) paint with the top-bar tokens: inside the form they follow the form.
  const card = flatten(all['--theme-card-bg'])
  const inputBg = inputColor ?? all['--theme-input-bg']
  const input = card ? flatten(inputBg, card) : null
  vars['--theme-input-bg'] = inputBg
  vars['--theme-topbar'] = inputBg
  vars['--theme-topbar-text'] = input ? ensureContrast(all['--theme-card-text'], [input], AA_TEXT) : all['--theme-card-text']
  // Placeholders (muted on the input) and input borders (UI components: 3:1, WCAG 1.4.11).
  vars['--form-placeholder'] = input ? ensureContrast(all['--theme-muted-text'], [input], AA_TEXT) : all['--theme-muted-text']
  if (card && input) {
    vars['--theme-input-border'] = ensureContrast(all['--theme-input-border'], [input], AA_LARGE)
    // Inputs (components/ui/input) draw their border with the surface border: inside a themed form it is the input border.
    vars['--theme-surface-border'] = vars['--theme-input-border']
  }
  // Danger buttons and the text on them.
  vars['--theme-danger'] = all['--theme-danger']
  vars['--theme-on-danger'] = all['--theme-on-danger']
  return vars
}

/**
 * The page behind the form: its colour (or a vertical gradient to
 * `page_to`) and a legible text colour for anything drawn on it. Without a
 * page colour the page is the card's colour, softened.
 */
function pageVars(colors: FormThemeColors, card: CssVars): CssVars {
  const out: CssVars = {}
  const page = colors.page
  if (!page) return out
  const stops = [flatten(page), colors.page_to ? flatten(colors.page_to) : null].filter((c): c is NonNullable<typeof c> => Boolean(c))
  out['--form-page-bg'] = page
  // A gradient whose ends need opposite text gets its text judged on the start colour (where text sits).
  if (stops.length > 1 && worstContrast(parseColor(ensureContrast(card['--theme-card-text'] ?? onColor(page), stops, AA_TEXT))!, stops) < AA_TEXT) stops.splice(1)
  out['--form-page-image'] = colors.page_to ? `linear-gradient(180deg, ${page}, ${colors.page_to})` : 'none'
  out['--form-page-text'] = ensureContrast(card['--theme-card-text'] ?? onColor(page), stops, AA_TEXT)
  return out
}

/** A whole palette as form-scope variables (the designer's light / dark preview of the workspace theme). */
export function paletteScopeVars(palette: ThemePalette): CssVars {
  return scopeVars(palette)
}

/**
 * CSS custom properties for a form card: the overrides on the workspace
 * palette for `mode`, made legible by the theme renderer. Empty when the
 * form inherits the workspace theme.
 */
export function formThemeVars(overrides: FormThemeOverrides | null | undefined, base: ThemePalette, mode: ThemeMode): CssVars {
  if (!overrides) return {}
  const colors = colorsForMode(overrides, mode)
  const own = colors.accent || colors.background || colors.text || colors.input || colors.border || colors.button
  const vars: CssVars = own ? scopeVars(overlayPalette(base, colors), colors.input) : {}
  Object.assign(vars, pageVars(colors, own ? vars : scopeVars(base)))
  if (overrides.radius !== undefined) {
    const px = `${overrides.radius}px`
    vars['--theme-border-radius'] = px
    vars['--theme-input-radius'] = px
    vars['--theme-button-radius'] = px
  }
  if (overrides.font) vars['--theme-font-sans'] = fontFamilyValue(overrides.font, 'sans')
  return vars
}

/** Header banner colours (banner + legible text on it). */
export function formHeaderColors(overrides: FormThemeOverrides | null | undefined): { background: string; text: string } | null {
  const color = overrides?.header?.enabled ? overrides.header.banner_color : undefined
  if (!color) return null
  // A mid-tone banner where neither white nor ink reaches AA: the banner moves, not the text.
  const text = onColor(color)
  const background = (contrastRatio(text, color) ?? 0) < AA_TEXT ? ensureContrast(color, [flatten(text)], AA_TEXT) : color
  return { background, text }
}

/** Fonts the mini theme can pick from (the workspace theme's curated list + system stacks). */
export const FORM_THEME_FONTS: Array<{ value: string; label: string }> = [
  ...Object.keys(SYSTEM_FONT_STACKS).map((family) => ({ value: `system:${family}`, label: `${family} (system)` })),
  ...CURATED_FONTS.filter((f) => f.category !== 'mono').map((f) => ({ value: `google:${f.family}`, label: f.family })),
]

/** Google Fonts stylesheet for a mini theme's font (null when bundled / system / none). */
export function formThemeFontHref(overrides: FormThemeOverrides | null | undefined): string | null {
  const font = overrides?.font
  if (!font || font.source !== 'google') return null
  const curated = findCuratedFont(font.family)
  if (!curated || curated.bundledVar) return null
  const weights = [400, 500, 600].map((w) => curated.weights.reduce((best, c) => (Math.abs(c - w) < Math.abs(best - w) ? c : best), curated.weights[0]))
  return `https://fonts.googleapis.com/css2?family=${curated.family.replace(/ /g, '+')}:wght@${[...new Set(weights)].sort((a, b) => a - b).join(';')}&display=swap`
}
