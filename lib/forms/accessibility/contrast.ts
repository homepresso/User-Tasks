/**
 * Colour rules of the form checker. Reuses the theme engine — no contrast
 * maths here:
 *   - what the form actually draws: the mini theme laid onto the workspace
 *     palette and run through the renderer's legibility pass
 *     (formThemeVars / paletteScopeVars), measured with contrastRatio;
 *   - what the author chose: formThemeContrast on the mini theme's own
 *     colours (the renderer silently raises those, so the form looks
 *     different from the design), auto-fixed with autoFixFormTheme.
 */

import {
  autoFixFormTheme, formThemeContrast, formThemeVars, paletteScopeVars,
  type FormThemeOverrides,
} from '@/lib/forms/form-theme'
import { contrastRatio } from '@/lib/theme/colors'
import { AA_LARGE, AA_TEXT } from '@/lib/theme/legibility'
import { defaultWorkspaceTheme } from '@/lib/theme/presets'
import type { ThemeMode, ThemePalette } from '@/lib/theme/schema'
import type { FormDefinition } from '@/lib/forms/definition'
import type { AccessibilityFinding, AccessibilityFix, CheckOptions } from './types'
import { levelOf } from './wcag'

const round = (n: number) => Math.round(n * 100) / 100

export interface ResolvedColours {
  mode: ThemeMode
  /** CSS custom properties the form scope sets (rendered colours). */
  vars: Record<string, string>
}

/** The workspace palettes (default theme for missing ones). */
export function palettesFor(opts: CheckOptions): Record<ThemeMode, ThemePalette> {
  const fallback = defaultWorkspaceTheme().colors
  return { light: opts.theme?.light ?? fallback.light, dark: opts.theme?.dark ?? fallback.dark }
}

/** The concrete mini theme: the form's custom overrides, or the caller's resolution of a saved one. */
export function overridesFor(def: FormDefinition, opts: CheckOptions): FormThemeOverrides | null | undefined {
  if (def.theme.source === 'custom') return def.theme.overrides
  if (def.theme.source === 'saved') return opts.theme?.overrides
  return null
}

/** Colours the form renders with in `mode` (what FormThemeScope sets). */
export function renderedColours(overrides: FormThemeOverrides | null | undefined, palette: ThemePalette, mode: ThemeMode): ResolvedColours {
  return { mode, vars: { ...paletteScopeVars(palette), ...formThemeVars(overrides ?? null, palette, mode) } }
}

interface PairSpec {
  rule: string
  pair: string
  what: string
  fg: (v: Record<string, string>) => string | undefined
  bg: (v: Record<string, string>) => string | undefined
  required: number
  wcag: string[]
}

const PAIRS: PairSpec[] = [
  { rule: 'contrast-text', pair: 'text/background', what: 'Values and headings', fg: (v) => v['--theme-card-text'], bg: (v) => v['--theme-card-bg'], required: AA_TEXT, wcag: ['1.4.3'] },
  { rule: 'contrast-text', pair: 'label/background', what: 'Labels and help text', fg: (v) => v['--theme-muted-text'], bg: (v) => v['--theme-card-bg'], required: AA_TEXT, wcag: ['1.4.3'] },
  { rule: 'contrast-text', pair: 'input text/input', what: 'Text typed into inputs', fg: (v) => v['--theme-topbar-text'], bg: (v) => v['--theme-input-bg'], required: AA_TEXT, wcag: ['1.4.3'] },
  { rule: 'contrast-text', pair: 'error/background', what: 'Error messages and required marks', fg: (v) => v['--status-blocked'], bg: (v) => v['--theme-card-bg'], required: AA_TEXT, wcag: ['1.4.3'] },
  { rule: 'contrast-placeholder', pair: 'placeholder/input', what: 'Placeholder text', fg: (v) => v['--form-placeholder'] ?? v['--theme-muted-text'], bg: (v) => v['--theme-input-bg'], required: AA_TEXT, wcag: ['1.4.3'] },
  { rule: 'contrast-non-text', pair: 'input border/background', what: 'Input borders', fg: (v) => v['--theme-input-border'], bg: (v) => v['--theme-card-bg'], required: AA_LARGE, wcag: ['1.4.11'] },
  { rule: 'contrast-focus', pair: 'focus ring/background', what: 'The focus ring', fg: (v) => v['--theme-primary'], bg: (v) => v['--theme-card-bg'], required: AA_LARGE, wcag: ['2.4.7', '1.4.11'] },
  { rule: 'contrast-button', pair: 'button text/button', what: 'Text on primary buttons', fg: (v) => v['--theme-on-primary'], bg: (v) => v['--theme-primary'], required: AA_TEXT, wcag: ['1.4.3'] },
]

export const CONTRAST_RULES = [...new Set(PAIRS.map((p) => p.rule)), 'contrast-theme'] as const

const PAIR_FOR_THEME_ISSUE: Record<string, string> = {
  'text/background': 'Text on the background',
  'muted/background': 'Labels and help text (derived from the text colour)',
  'accent/background': 'The accent (focus ring, selected options) on the background',
  'button text/accent': 'Button text on the accent',
}

/** Theme fix: the custom mini theme with every failing colour moved to its nearest passing value. */
function themeFix(def: FormDefinition, palettes: Record<ThemeMode, ThemePalette>): AccessibilityFix | undefined {
  if (def.theme.source !== 'custom') return undefined
  const fixed = autoFixFormTheme(def.theme.overrides, palettes)
  if (JSON.stringify(fixed) === JSON.stringify(def.theme.overrides)) return undefined
  return { kind: 'theme', label: 'Auto-fix contrast', patch: { theme: { source: 'custom', overrides: fixed } } }
}

export function contrastFindings(def: FormDefinition, opts: CheckOptions): AccessibilityFinding[] {
  const out: AccessibilityFinding[] = []
  const palettes = palettesFor(opts)
  const modes: ThemeMode[] = opts.modes?.length ? opts.modes : ['light', 'dark']
  const overrides = overridesFor(def, opts)
  if (def.theme.source === 'saved' && overrides === undefined) {
    out.push({
      id: 'contrast-theme:saved', rule: 'contrast-theme', severity: 'review', wcag: ['1.4.3', '1.4.11'], level: 'AA',
      message: 'The form uses a saved form theme whose colours were not available to the checker.',
      help: 'Open the form in the designer (or pass the resolved theme) to check its colours.',
    })
  }
  const fix = themeFix(def, palettes)
  for (const mode of modes) {
    const { vars } = renderedColours(overrides, palettes[mode], mode)
    for (const spec of PAIRS) {
      const fg = spec.fg(vars)
      const bg = spec.bg(vars)
      if (!fg || !bg) continue
      const ratio = contrastRatio(fg, bg, vars['--theme-card-bg'] ?? palettes[mode].cardBg)
      if (ratio === null || ratio >= spec.required) continue
      out.push({
        id: `${spec.rule}:${mode}:${spec.pair}`, rule: spec.rule, mode,
        severity: 'serious', wcag: spec.wcag, level: levelOf(spec.wcag),
        message: `${spec.what} in ${mode} mode: ${round(ratio)}:1 (${fg} on ${bg}), needs ${spec.required}:1.`,
        help: overrides ? 'Adjust the form theme colours, or use Auto-fix contrast.' : 'The workspace theme draws this pair; adjust it in Settings → Theme, or give the form a mini theme.',
        ...(fix ? { fix } : {}),
      })
    }
    // What the author chose (the renderer raises these, so the form doesn't look as designed).
    for (const issue of overrides ? formThemeContrast(overrides, palettes[mode], mode) : []) {
      const nonText = issue.pair === 'accent/background'
      const wcag = nonText ? ['1.4.11', '2.4.7'] : ['1.4.3']
      out.push({
        id: `contrast-theme:${mode}:${issue.pair}`, rule: 'contrast-theme', mode,
        severity: issue.blocking || issue.ratio < AA_LARGE ? 'serious' : 'moderate', wcag, level: levelOf(wcag),
        message: `${PAIR_FOR_THEME_ISSUE[issue.pair] ?? issue.pair} in ${mode} mode is ${issue.ratio}:1 in the form theme (needs ${issue.required}:1); it is drawn as ${issue.fixed} instead.`,
        help: 'The renderer raises colours below their target, so the form does not look as designed. Auto-fix contrast saves the nearest passing colours into the theme.',
        ...(fix ? { fix } : {}),
      })
    }
  }
  return out
}

/** Selected chips (multi-select) are told apart by their fill: it must reach 3:1 against the background. */
export function selectedStateFindings(def: FormDefinition, opts: CheckOptions): AccessibilityFinding[] {
  const chips = def.fields.filter((f) => f.type === 'multi_choice')
  if (!chips.length) return []
  const palettes = palettesFor(opts)
  const overrides = overridesFor(def, opts)
  const modes: ThemeMode[] = opts.modes?.length ? opts.modes : ['light', 'dark']
  const out: AccessibilityFinding[] = []
  for (const mode of modes) {
    const { vars } = renderedColours(overrides, palettes[mode], mode)
    const ratio = contrastRatio(vars['--theme-primary'], vars['--theme-card-bg'], palettes[mode].cardBg)
    if (ratio === null || ratio >= AA_LARGE) continue
    const wcag = ['1.4.1', '1.4.11']
    out.push({
      id: `color-only-state:${mode}`, rule: 'color-only-state', mode, severity: 'serious', wcag, level: levelOf(wcag),
      field_key: chips[0].key,
      message: `Selected multi-select options differ from unselected ones only by a fill of ${round(ratio)}:1 in ${mode} mode.`,
      help: 'The selected fill (the accent) needs 3:1 against the background so the state is visible without relying on colour perception.',
      ...(themeFix(def, palettes) ? { fix: themeFix(def, palettes) } : {}),
    })
  }
  return out
}
