/**
 * Conditional styling (InfoPath's conditional formatting): a field, a
 * section, a List row or a List cell takes a tone colour and an emphasis
 * while a condition holds.
 *
 *  - Form rules: the `set_style` action, in "Always" rules only — applied
 *    while the condition holds, undone when it stops (lib/forms/form-rules.ts
 *    alwaysRuleEffects().styles). Several rules on one target merge, the
 *    later rule winning per property.
 *  - Lists: `list.row_styles` (any nesting level) — a condition per row
 *    (`row.<column>`, `parent.<column>`, `form.<field>`, `user.*`) and the
 *    style of the whole row or of one column's cell
 *    (lib/forms/list-field.ts listRowStyles).
 *
 * Presentation only: the server normalises and validates styles but never
 * acts on them (a submission is judged the same with or without them).
 *
 * Authors pick theme tokens, never CSS: a tone (success / warning / danger /
 * info / neutral / accent) and switches. Each tone's text colour already
 * reaches WCAG AA on its own wash and on the card in every built-in theme,
 * light and dark (lib/theme/contrast.ts pairs, STYLE_TONE_TOKENS.pairs —
 * checked in __tests__/conditional-style.test.ts), and the legibility pass
 * keeps custom themes there too. Colour should never be the only signal:
 * `icon` puts a tone icon (with a spoken name) beside the label; bold helps.
 */

import { isPlainObject } from '@/lib/utils/guards'

export type StyleTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'accent'
export const STYLE_TONES: StyleTone[] = ['danger', 'warning', 'success', 'info', 'accent', 'neutral']

export const STYLE_TONE_LABELS: Record<StyleTone, string> = {
  danger: 'Danger (red)',
  warning: 'Warning (amber)',
  success: 'Success (green)',
  info: 'Info',
  accent: 'Accent (brand)',
  neutral: 'Neutral (grey)',
}

/** What the tone icon announces (the non-colour cue). */
export const STYLE_TONE_NAMES: Record<StyleTone, string> = {
  danger: 'Alert', warning: 'Warning', success: 'OK', info: 'Note', accent: 'Highlighted', neutral: 'Note',
}

/** The switches a style can turn on (each `true` or absent). */
export const STYLE_FLAGS = ['background', 'text', 'bold', 'italic', 'underline', 'strike', 'border', 'icon'] as const
export type StyleFlag = (typeof STYLE_FLAGS)[number]

export const STYLE_FLAG_LABELS: Record<StyleFlag, string> = {
  background: 'Shade the background',
  text: 'Colour the text',
  bold: 'Bold',
  italic: 'Italic',
  underline: 'Underline',
  strike: 'Strikethrough',
  border: 'Emphasise the border',
  icon: 'Tone icon beside the label',
}

/** Flags that draw in the tone's colour (they need a tone; neutral when none is given). */
const COLOURED: ReadonlySet<StyleFlag> = new Set(['background', 'text', 'border', 'icon'])

export interface ConditionalStyle {
  tone?: StyleTone
  /** A tinted background in the tone (its wash). */
  background?: boolean
  /** Text in the tone's text colour. */
  text?: boolean
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  /** An emphasised border in the tone. */
  border?: boolean
  /** A tone icon beside the label (so colour is not the only signal). */
  icon?: boolean
}

/**
 * Each tone's theme tokens (CSS custom properties, set per theme and mode by
 * lib/theme/to-css.ts and form themes) and the lib/theme/contrast.ts pairs
 * that guarantee them: text on the wash, text on the card.
 */
export const STYLE_TONE_TOKENS: Record<StyleTone, { text: string; wash: string; line: string; pairs: { onWash: string; onCard: string } }> = {
  success: { text: '--theme-success', wash: '--status-success-bg', line: '--theme-success', pairs: { onWash: 'success/status.successBg', onCard: 'success/cardBg' } },
  warning: { text: '--theme-warning', wash: '--status-warning-bg', line: '--theme-warning', pairs: { onWash: 'warning/status.warningBg', onCard: 'warning/cardBg' } },
  danger: { text: '--theme-danger', wash: '--status-danger-bg', line: '--theme-danger', pairs: { onWash: 'danger/status.dangerBg', onCard: 'danger/cardBg' } },
  info: { text: '--status-info', wash: '--status-info-bg', line: '--status-info', pairs: { onWash: 'status.info/status.infoBg', onCard: 'status.info/cardBg' } },
  neutral: { text: '--theme-card-text', wash: '--ds-bg-muted', line: '--theme-muted-text', pairs: { onWash: 'cardText/ds.bgMuted', onCard: 'cardText/cardBg' } },
  accent: { text: '--theme-primary-text', wash: '--theme-primary-light', line: '--theme-primary-text', pairs: { onWash: 'primaryText/primaryLight', onCard: 'primaryText/cardBg' } },
}

/** A stored style → a clean one (unknown tones and properties dropped), or null when it styles nothing. */
export function normalizeConditionalStyle(raw: unknown): ConditionalStyle | null {
  if (!isPlainObject(raw)) return null
  const out: ConditionalStyle = {}
  const tone = typeof raw.tone === 'string' ? raw.tone.trim().toLowerCase() : ''
  if ((STYLE_TONES as string[]).includes(tone)) out.tone = tone as StyleTone
  for (const flag of STYLE_FLAGS) if (raw[flag] === true) out[flag] = true
  if (!STYLE_FLAGS.some((f) => out[f])) {
    // A tone alone: shade and colour in it (what "make it red" means).
    if (!out.tone) return null
    out.background = true
    out.text = true
  }
  if (!out.tone && STYLE_FLAGS.some((f) => out[f] && COLOURED.has(f))) out.tone = 'neutral'
  return out
}

/** Styles merged in order: a later style wins per property (a tone replaces a tone; switches add up). */
export function mergeStyles(...styles: Array<ConditionalStyle | null | undefined>): ConditionalStyle | null {
  let out: ConditionalStyle | null = null
  for (const s of styles) if (s) out = { ...(out ?? {}), ...s }
  return out
}

/** A short description ("Danger: background, text, bold"). */
export function describeStyle(style: ConditionalStyle | null | undefined): string {
  if (!style) return 'no style'
  const flags = STYLE_FLAGS.filter((f) => style[f]).map((f) => (f === 'background' ? 'shaded' : f === 'text' ? 'coloured text' : f === 'border' ? 'border' : f === 'icon' ? 'icon' : f === 'strike' ? 'strikethrough' : f))
  const tone = style.tone ? STYLE_TONE_LABELS[style.tone].replace(/ \(.*\)$/, '') : ''
  return [tone, flags.join(', ')].filter(Boolean).join(': ') || 'no style'
}

/**
 * The attributes that draw a style (app/conditional-style.css reads them):
 * `data-cs` and the tone, then one attribute per switch. Nothing for no style.
 */
export function styleAttributes(style: ConditionalStyle | null | undefined): Record<string, string> {
  if (!style) return {}
  const out: Record<string, string> = { 'data-cs': '', 'data-cs-tone': style.tone ?? 'neutral' }
  for (const flag of STYLE_FLAGS) if (style[flag]) out[`data-cs-${flag}`] = ''
  const deco = [style.underline ? 'underline' : '', style.strike ? 'line-through' : ''].filter(Boolean).join('-')
  if (deco) out['data-cs-deco'] = deco
  return out
}

/* ── List row styles ─────────────────────────────────────────────────── */

/** A List's row style: while `if` holds for a row, the row (or `column`'s cell) takes `style`. */
export interface ListRowStyle<G = unknown> {
  if: G
  style: ConditionalStyle
  /** Style this column's cell only (absent: the whole row). */
  column?: string
}

export const ROW_STYLE_LIMIT = 20

/** What a row's styles came to: the whole row's, and each styled cell's. */
export interface RowStyleResult {
  row: ConditionalStyle | null
  cells: Record<string, ConditionalStyle>
}

export const NO_ROW_STYLE: RowStyleResult = Object.freeze({ row: null, cells: Object.freeze({}) as Record<string, ConditionalStyle> }) as RowStyleResult
