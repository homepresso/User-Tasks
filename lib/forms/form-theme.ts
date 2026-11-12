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
import { contrastRatio, isDarkColor, withAlpha } from '@/lib/theme/colors'
import { AA_LARGE, AA_TEXT, ensureContrast, flatten, onColor, worstContrast } from '@/lib/theme/legibility'
import { parseColor } from '@/lib/theme/colors'
import { ColorSchema, isOwnStorageUrl, type ThemeMode, type ThemePalette } from '@/lib/theme/schema'
import { CURATED_FONTS, FONT_FAMILY_RE, SYSTEM_FONT_STACKS, findCuratedFont } from '@/lib/theme/fonts'
import { fontFamilyValue, paletteVars } from '@/lib/theme/to-css'
import { presetToWorkspaceTheme } from '@/lib/theme/presets'
import { clampFormWidthPct } from './form-width'

/**
 * Each key carries its own help (`.meta({ description, when_unset })`): the
 * Agent's theme_reference tool (lib/theme/reference.ts) lists the accepted
 * settings from this schema, so the reference can't drift from what saves.
 */
const color = (description: string, whenUnset: string) => ColorSchema.optional().meta({ description, when_unset: whenUnset })

export const FormThemeColorsSchema = z.object({
  accent: color('Buttons, focus ring, links, selected options.', 'the workspace primary colour'),
  background: color('The form card background (inputs follow it).', 'the workspace card colour'),
  text: color('Labels and values.', 'the workspace text colour'),
  page: color('The page behind the form (standalone pages, the frame around a task form).', 'the app canvas'),
  page_to: color('Second page colour: a vertical gradient from `page` to it (needs `page`).', 'no gradient'),
  input: color('Inputs, selects, the lookup box.', 'the background'),
  border: color('Borders of inputs and dividers.', 'derived from the text'),
  button: color('Primary buttons.', 'the accent'),
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

/** Button corners: square (0), rounded (the corner radius, 8px by default) or pill (fully round). */
export const FORM_BUTTON_SHAPES = ['square', 'rounded', 'pill'] as const
/** Card elevation presets (FORM_SHADOWS): named levels only — never a raw box-shadow string. */
export const FORM_SHADOW_LEVELS = ['none', 'subtle', 'medium', 'strong'] as const
/** Input look: outlined (a border all round, the default), filled (a tinted fill with a bottom rule) or underline (a bottom rule only). */
export const FORM_FIELD_STYLES = ['outlined', 'filled', 'underline'] as const
/** Which palette the form shows: the workspace's (default), the viewer's OS setting, or always light / dark. */
export const FORM_APPEARANCES = ['workspace', 'system', 'light', 'dark'] as const

export const FormThemeOverridesSchema = z.object({
  base_preset: z.string().regex(/^[a-z0-9-]{1,40}$/).optional().meta({ description: 'Built-in template the colours started from (informational; see presets).', when_unset: 'none' }),
  colors: z.object({
    light: FormThemeColorsSchema.optional().meta({ description: 'Colours in light mode.', when_unset: 'the workspace light palette' }),
    dark: FormThemeColorsSchema.optional().meta({ description: 'Dark-mode palette: used when the form shows dark (the viewer is in dark mode, or appearance is dark).', when_unset: 'the workspace dark palette with the light accent carried over (made legible)' }),
  }).strict().optional().meta({ description: 'Colours per mode. Text is always kept legible (contrast raised where needed).', when_unset: 'the workspace palette' }),
  radius: z.number().int().min(0).max(24).optional().meta({ description: 'Corner radius in px for the card, inputs and buttons.', when_unset: 'the workspace radii' }),
  font: FontSchema.optional().meta({ description: 'Body font: a curated Google font or a system stack (see fonts).', when_unset: 'the workspace font' }),
  heading_font: FontSchema.optional().meta({ description: 'Heading / display font for the form title, section and page headings, separate from the body font (see fonts).', when_unset: 'the body font' }),
  button_shape: z.enum(FORM_BUTTON_SHAPES).optional().meta({ description: 'Shape of the form\'s buttons: square, rounded (the corner radius) or pill.', when_unset: 'the corner radius' }),
  shadow: z.enum(FORM_SHADOW_LEVELS).optional().meta({ description: 'Card elevation: none, subtle, medium or strong (tuned for light and dark).', when_unset: 'a subtle shadow on form pages, none inline' }),
  field_style: z.enum(FORM_FIELD_STYLES).optional().meta({ description: 'Input look: outlined, filled (tinted with a bottom rule) or underline (bottom rule only).', when_unset: 'outlined' }),
  appearance: z.enum(FORM_APPEARANCES).optional().meta({ description: 'Light / dark: workspace (follow the workspace theme), system (the viewer\'s OS setting), or always light / dark.', when_unset: 'workspace' }),
  density: z.enum(['compact', 'comfortable']).optional().meta({ description: 'Spacing between fields.', when_unset: 'comfortable' }),
  label_position: z.enum(['top', 'left']).optional().meta({ description: 'Labels above or left of the inputs.', when_unset: 'top' }),
  button_placement: z.enum(['left', 'right', 'full']).optional().meta({ description: 'Where the form\'s buttons sit.', when_unset: 'right' }),
  form_width: z.enum(['narrow', 'normal', 'wide', 'full', 'custom']).optional().meta({ description: 'How wide the form card may grow (custom: form_width_pct).', when_unset: 'normal' }),
  form_width_pct: z.number().finite().transform(clampFormWidthPct).optional().meta({ description: 'With form_width custom: the share of the available width, 40–100 % (clamped; never under ~320px, 100 % on phones).', when_unset: 'none' }),
  header: z.object({
    enabled: z.boolean().meta({ description: 'Show the theme header above the form.' }),
    title: SafeText(120).optional().meta({ description: 'Header title (plain text, ≤120).', when_unset: 'none' }),
    subtitle: SafeText(300).optional().meta({ description: 'Header subtitle (plain text, ≤300).', when_unset: 'none' }),
    logo_url: z.string().max(500).refine((v) => isOwnStorageUrl(v, ['logos']), { message: 'Logos must be uploads in this workspace’s logos storage' }).optional().meta({ description: 'A logo already uploaded in this workspace (the workspace logo from Settings → Theme).', when_unset: 'no logo' }),
    banner_color: color('Header banner colour (its text colour is picked for it).', 'no banner'),
  }).strict().optional().meta({ description: 'A simple header above the form. A form\'s own header (forms_update header: image, alignment) is drawn in its place when on.', when_unset: 'no header' }),
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
  // Conditional styling's tones (lib/forms/conditional-style.ts): text and washes judged on the form's own card.
  '--status-info', '--status-success-bg', '--status-warning-bg', '--status-danger-bg', '--status-info-bg',
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
  if (overrides.heading_font) vars['--form-heading-font'] = fontFamilyValue(overrides.heading_font, 'display')
  if (overrides.button_shape) vars['--form-button-radius'] = formButtonRadius(overrides)
  if (overrides.shadow) {
    const card = vars['--theme-card-bg'] ?? base.cardBg
    const dark = card ? isDarkColor(card) : mode === 'dark'
    vars['--form-card-shadow'] = FORM_SHADOWS[dark ? 'dark' : 'light'][overrides.shadow]
  }
  return vars
}

/**
 * Card elevation per level, for light and dark cards (dark ones need deeper
 * shadows and a top highlight to read). Fixed strings: the theme stores only
 * the level name, so no CSS from a payload ever reaches the page.
 */
export const FORM_SHADOWS: Record<ThemeMode, Record<(typeof FORM_SHADOW_LEVELS)[number], string>> = {
  light: {
    none: 'none',
    subtle: '0 1px 2px rgba(16,16,20,0.06), 0 1px 3px rgba(16,16,20,0.05)',
    medium: '0 6px 16px -4px rgba(16,16,20,0.12), 0 2px 6px -2px rgba(16,16,20,0.06)',
    strong: '0 18px 44px -10px rgba(16,16,20,0.24), 0 6px 16px -6px rgba(16,16,20,0.10)',
  },
  dark: {
    none: 'none',
    subtle: '0 1px 2px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.04)',
    medium: '0 10px 28px -6px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05)',
    strong: '0 26px 60px -12px rgba(0,0,0,0.78), inset 0 1px 0 rgba(255,255,255,0.06)',
  },
}

/** Radius of the form's buttons for its button_shape (rounded follows the corner radius, 8px by default). */
export function formButtonRadius(overrides: Pick<FormThemeOverrides, 'button_shape' | 'radius'>): string {
  if (overrides.button_shape === 'square') return '0px'
  if (overrides.button_shape === 'pill') return '9999px'
  return `${overrides.radius ?? 8}px`
}

/**
 * The palette a form shows (light / dark): forced by `appearance`, the
 * viewer's OS setting for `system`, otherwise the workspace's mode — which
 * itself follows the OS unless the workspace theme forces one.
 */
export function formAppearanceMode(overrides: Pick<FormThemeOverrides, 'appearance'> | null | undefined, workspaceMode: ThemeMode, osDark: boolean): ThemeMode {
  const a = overrides?.appearance
  if (a === 'light' || a === 'dark') return a
  if (a === 'system') return osDark ? 'dark' : 'light'
  return workspaceMode
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
  const families: string[] = []
  for (const font of [overrides?.font, overrides?.heading_font]) {
    if (!font || font.source !== 'google') continue
    const curated = findCuratedFont(font.family)
    if (!curated || curated.bundledVar || families.some((f) => f.startsWith(`family=${curated.family.replace(/ /g, '+')}:`))) continue
    const weights = [400, 500, 600].map((w) => curated.weights.reduce((best, c) => (Math.abs(c - w) < Math.abs(best - w) ? c : best), curated.weights[0]))
    families.push(`family=${curated.family.replace(/ /g, '+')}:wght@${[...new Set(weights)].sort((a, b) => a - b).join(';')}`)
  }
  return families.length ? `https://fonts.googleapis.com/css2?${families.join('&')}&display=swap` : null
}
