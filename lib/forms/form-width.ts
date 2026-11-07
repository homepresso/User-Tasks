/**
 * Form width: how wide a form card may grow on the surfaces that show it
 * (the standalone page /f/<id>, a task's form, the Run and Save & Test
 * start-form panels, the designer's Preview at desktop width).
 *
 *   narrow   ~576px — short forms (a sign-up, a single question)
 *   normal   the surface's usual width (standalone pages ~768px, the task
 *            screen ~896px) — the default; existing forms are unchanged
 *   wide     ~1152px — Data tables, side-by-side columns
 *   full     the whole content area
 *   custom   a share of the available width, 40–100 % (`form_width_pct`),
 *            never under ~320px (min(100%, max(320px, pct%))); phones
 *            always get 100 %
 *
 * "Available width" is the surface's container: the page content area on
 * /f/ pages, the task column on the task screen, the form panel of the Save
 * & Test runner, the body of the Run dialog. A dialog cannot grow past its
 * own width, so wide / full change nothing there; narrow and custom do.
 *
 * Stored on the form theme as `form_width` (+ `form_width_pct` for custom;
 * lib/forms/form-theme.ts) beside the other presentation choices (density,
 * label position, button placement), so it travels with the theme reference
 * everywhere: task metadata `form_theme`, reusable forms and their versions,
 * saved Form themes, exports, packages, the REST API / MCP / CLI. A Data
 * table whose `data_table.full_width` is on raises the form to at least
 * `wide` (a custom % is the author's explicit choice and is kept).
 *
 * Inside the card a wide Data table still scrolls sideways (with a sticky
 * first column) when it does not fit: width only gives it more room.
 */

export type FormWidth = 'narrow' | 'normal' | 'wide' | 'full' | 'custom'
export const FORM_WIDTHS: FormWidth[] = ['narrow', 'normal', 'wide', 'full', 'custom']
export const FORM_WIDTH_LABELS: Record<FormWidth, string> = {
  narrow: 'Narrow',
  normal: 'Normal',
  wide: 'Wide',
  full: 'Full width',
  custom: 'Custom %',
}

export const FORM_WIDTH_PCT = { min: 40, max: 100, default: 90 } as const
/** The narrowest a custom-width card gets (unless its container is narrower). */
export const FORM_MIN_WIDTH_PX = 320

const RANK: Record<Exclude<FormWidth, 'custom'>, number> = { narrow: 0, normal: 1, wide: 2, full: 3 }

/** A stored width, or 'normal'. */
export function normalizeFormWidth(raw: unknown): FormWidth {
  return FORM_WIDTHS.includes(raw as FormWidth) ? raw as FormWidth : 'normal'
}

/** A custom width percentage: a whole number from 40 to 100 (anything unreadable → the default 90). */
export function clampFormWidthPct(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN
  if (!Number.isFinite(n)) return FORM_WIDTH_PCT.default
  return Math.round(Math.min(FORM_WIDTH_PCT.max, Math.max(FORM_WIDTH_PCT.min, n)))
}

interface FieldLike { type: string; data_table?: { full_width?: boolean } | null }
type WidthOverrides = { form_width?: unknown; form_width_pct?: unknown } | null | undefined

/** The width a form renders at: the theme's choice, at least `wide` when a Data table asks for full width (custom kept). */
export function resolveFormWidth(overrides: WidthOverrides, fields: FieldLike[] | null | undefined = []): FormWidth {
  const chosen = normalizeFormWidth(overrides?.form_width)
  if (chosen === 'custom') return chosen
  const wantsWide = (fields ?? []).some((f) => f.type === 'data_table' && f.data_table?.full_width === true)
  return wantsWide && RANK[chosen] < RANK.wide ? 'wide' : chosen
}

/** Custom width: 100 % on phones; from `sm` up, the percentage of the container, at least 320px, at most the container. */
const CUSTOM_CLASS = 'w-full max-w-none sm:w-[min(100%,max(320px,var(--form-width-pct)))]'

/**
 * The width class of a container that holds the form card. `normal` is
 * the surface's own class (it differs per surface), so `normal` never
 * changes how an existing form looks. `custom` also needs formWidthStyle.
 */
export function formWidthClass(width: FormWidth, normalClass: string): string {
  switch (width) {
    case 'narrow': return 'max-w-xl'
    case 'wide': return 'max-w-6xl'
    case 'full': return 'max-w-none'
    case 'custom': return CUSTOM_CLASS
    default: return normalClass
  }
}

/** The inline style a custom width needs (the percentage as a CSS variable); {} otherwise. */
export function formWidthStyle(overrides: WidthOverrides): Record<string, string> {
  if (normalizeFormWidth(overrides?.form_width) !== 'custom') return {}
  return { '--form-width-pct': `${clampFormWidthPct(overrides?.form_width_pct)}%` }
}

/** Shorthand: the container class for a form (theme overrides + fields) on a surface. */
export function formCardWidthClass(overrides: WidthOverrides, fields: FieldLike[] | null | undefined, normalClass = 'max-w-3xl'): string {
  return formWidthClass(resolveFormWidth(overrides, fields), normalClass)
}

/** Class + style for a form's container on a surface (custom widths need both). */
export function formCardWidth(overrides: WidthOverrides, fields: FieldLike[] | null | undefined, normalClass = 'max-w-3xl'): { className: string; style: Record<string, string>; width: FormWidth } {
  const width = resolveFormWidth(overrides, fields)
  return { className: formWidthClass(width, normalClass), style: formWidthStyle(overrides), width }
}
