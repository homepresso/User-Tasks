/**
 * The form's "Submitted" page: an optional, presentable screen that replaces
 * the form once it is submitted — a success icon (curated Lucide icons, an
 * uploaded image or none) in a colour, a heading and a subheading with
 * {{placeholders}}, an optional summary of chosen answers and a short note,
 * and up to two buttons: "Submit another response" (a fresh form, URL
 * parameters kept) and "Close form" (back to the Home dashboard, or the
 * pane / dialog the form sits in).
 *
 * Stored on the form layout (`layout.submitted_page`), so versions,
 * export / import, packages, the API / MCP / CLI and config-as-code carry it
 * like the rest of the layout. Forms without it (every form made before it)
 * behave exactly as before.
 *
 * Precedence after a submitting button (applySubmittedPage), highest first:
 *   1. redirect     a button's (or After-submit rule's) Redirect wins
 *   2. close        an explicit Close form action
 *   3. button screen a button's own "Show success screen" action
 *   4. this page    the form's Submitted page, when it is on
 *   5. otherwise    stay on the form, cleared, with the message(s)
 * Messages (button messages, rule banners, table-change summaries) are kept
 * and shown on the page. The page is not used for task forms: completing a
 * task already moves on (a button's own success screen still is).
 *
 * Pure and isomorphic.
 */

import { isPlainObject } from '@/lib/utils/guards'
import { NAV_ITEMS } from '@/lib/constants'
import { interpolateButtonText, type ButtonEffects, type ButtonScope } from './buttons'
import { isHeaderImageUrl } from './header'

/** The curated success icons (Lucide names in components/forms/submitted-page-icon.tsx). */
export const SUBMITTED_PAGE_ICONS = [
  'check_circle', 'party', 'mail_sent', 'calendar_check', 'thumbs_up', 'clipboard_check', 'badge_check', 'send', 'heart', 'star', 'trophy', 'rocket',
] as const
export type SubmittedPageIconName = typeof SUBMITTED_PAGE_ICONS[number]
export type SubmittedPageIcon = SubmittedPageIconName | 'upload' | 'none'

export const SUBMITTED_PAGE_ICON_LABELS: Record<SubmittedPageIconName, string> = {
  check_circle: 'Check circle', party: 'Party', mail_sent: 'Mail sent', calendar_check: 'Calendar check', thumbs_up: 'Thumbs up',
  clipboard_check: 'Clipboard check', badge_check: 'Badge check', send: 'Sent', heart: 'Heart', star: 'Star', trophy: 'Trophy', rocket: 'Rocket',
}

/** Icon colour: the theme's success colour, its primary colour, or a #hex. */
export type SubmittedPageIconColor = 'success' | 'primary' | `#${string}`

export interface SubmittedPageButton {
  enabled: boolean
  label?: string
}

export interface SubmittedPageConfig {
  enabled: boolean
  icon: SubmittedPageIcon
  /** icon === 'upload': an uploaded image (the header image upload; storage ref / own URL). */
  icon_url?: string
  /** Text alternative for the uploaded image; absent = decorative. */
  icon_alt?: string
  icon_color?: SubmittedPageIconColor
  heading?: string
  subheading?: string
  /** A summary of these answers (field keys, in order). */
  summary_fields?: string[]
  /** A short note under the summary ({{placeholders}}). */
  note?: string
  submit_another: SubmittedPageButton
  close: SubmittedPageButton
}

export const SUBMITTED_PAGE_LIMITS = { heading: 160, subheading: 500, note: 1000, label: 60, summary: 12, alt: 200 } as const

export const SUBMITTED_PAGE_DEFAULTS = {
  heading: 'Thank you — your response was submitted',
  subheading: 'Your reference is {{submission_id}}.',
  submit_another: 'Submit another response',
  close: 'Close form',
} as const

/**
 * Where "Close form" goes on a form's own page: the person's Home dashboard
 * when the app has one, otherwise My Tasks. The one constant every surface reads.
 */
export const FORM_CLOSE_TARGET: string = (NAV_ITEMS as ReadonlyArray<{ href: string }>).some((item) => item.href === '/home') ? '/home' : '/tasks'

/** A new Submitted page (the designer's switch turned on). */
export function defaultSubmittedPage(): SubmittedPageConfig {
  return {
    enabled: true,
    icon: 'check_circle',
    icon_color: 'success',
    heading: SUBMITTED_PAGE_DEFAULTS.heading,
    subheading: SUBMITTED_PAGE_DEFAULTS.subheading,
    submit_another: { enabled: true },
    close: { enabled: true },
  }
}

function text(raw: unknown, max: number): string | undefined {
  if (typeof raw !== 'string') return undefined
  const s = raw.replace(/[<>]/g, '').trim()
  return s ? s.slice(0, max) : undefined
}

function button(raw: unknown, fallback: boolean): SubmittedPageButton {
  if (typeof raw === 'boolean') return { enabled: raw }
  if (!isPlainObject(raw)) return { enabled: fallback }
  const out: SubmittedPageButton = { enabled: raw.enabled !== false }
  const label = text(raw.label, SUBMITTED_PAGE_LIMITS.label)
  if (label) out.label = label
  return out
}

/** Stored `layout.submitted_page` → a clean config, or null (none: the form behaves as before). */
export function normalizeSubmittedPage(raw: unknown, fieldKeys?: Iterable<string>): SubmittedPageConfig | null {
  if (!isPlainObject(raw)) return null
  const iconRaw = raw.icon
  let icon: SubmittedPageIcon = iconRaw === 'upload' || iconRaw === 'none' || SUBMITTED_PAGE_ICONS.includes(iconRaw as SubmittedPageIconName) ? iconRaw as SubmittedPageIcon : 'check_circle'
  const out: SubmittedPageConfig = { enabled: raw.enabled === true, icon, submit_another: button(raw.submit_another, true), close: button(raw.close, true) }
  if (icon === 'upload') {
    if (isHeaderImageUrl(raw.icon_url)) out.icon_url = (raw.icon_url as string).trim()
    else out.icon = icon = 'check_circle'
  }
  if (icon === 'upload') {
    const alt = text(raw.icon_alt, SUBMITTED_PAGE_LIMITS.alt)
    if (alt) out.icon_alt = alt
  }
  if (icon !== 'none' && icon !== 'upload') {
    const c = raw.icon_color
    out.icon_color = c === 'primary' ? 'primary' : typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c.toUpperCase() as SubmittedPageIconColor : 'success'
  }
  const heading = text(raw.heading, SUBMITTED_PAGE_LIMITS.heading)
  if (heading) out.heading = heading
  const subheading = text(raw.subheading, SUBMITTED_PAGE_LIMITS.subheading)
  if (subheading) out.subheading = subheading
  if (Array.isArray(raw.summary_fields)) {
    const known = fieldKeys ? new Set(fieldKeys) : null
    const keys = [...new Set(raw.summary_fields.filter((k): k is string => typeof k === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,99}$/.test(k) && (!known || known.has(k))))].slice(0, SUBMITTED_PAGE_LIMITS.summary)
    if (keys.length) out.summary_fields = keys
  }
  const note = text(raw.note, SUBMITTED_PAGE_LIMITS.note)
  if (note) out.note = note
  return out
}

/** The layout's Submitted page when it is switched on (null otherwise). */
export function layoutSubmittedPage(layout: unknown): SubmittedPageConfig | null {
  if (!isPlainObject(layout)) return null
  const page = normalizeSubmittedPage(layout.submitted_page)
  return page?.enabled ? page : null
}

/** Where a Submitted page is drawn: a form's own page, a dialog (Run), an embedded pane, a task. */
export type SubmittedSurface = 'page' | 'dialog' | 'embedded' | 'task'

export type ScreenButton = NonNullable<NonNullable<ButtonEffects['success_screen']>['buttons']>[number]

export interface FieldLabelLike { key: string; label?: string; type?: string }

function summaryValue(field: FieldLabelLike, values: Record<string, unknown>, scope: ButtonScope): string {
  const v = values[field.key]
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  // A custom control whose output is HTML (rich text) has its plain text beside it.
  const text = values[`${field.key}_text`]
  if (field.type === 'custom' && typeof text === 'string') return text
  return interpolateButtonText(`{{${field.key}}}`, scope)
}

/** The screen the effects show for a Submitted page (placeholders filled). */
export function planSubmittedPage(page: SubmittedPageConfig, scope: ButtonScope, fields: FieldLabelLike[] = []): NonNullable<ButtonEffects['success_screen']> {
  const title = interpolateButtonText(page.heading ?? SUBMITTED_PAGE_DEFAULTS.heading, scope).trim() || 'Submitted'
  const screen: NonNullable<ButtonEffects['success_screen']> = { title, button: 'none', source: 'form' }
  const sub = interpolateButtonText(page.subheading, scope).trim()
  if (sub) screen.text = sub
  if (page.icon === 'upload' && page.icon_url) screen.icon = { kind: 'image', url: page.icon_url, ...(page.icon_alt ? { alt: page.icon_alt } : {}) }
  else if (page.icon !== 'none' && page.icon !== 'upload') screen.icon = { kind: 'icon', name: page.icon, color: page.icon_color ?? 'success' }
  if (page.summary_fields?.length) {
    const byKey = new Map(fields.map((f) => [f.key, f]))
    const rows = page.summary_fields.map((key) => byKey.get(key) ?? { key })
      .map((f) => ({ label: f.label || f.key, value: summaryValue(f, scope.values, scope) }))
      .filter((r) => r.value !== '')
    if (rows.length) screen.summary = rows
  }
  const note = interpolateButtonText(page.note, scope).trim()
  if (note) screen.note = note
  const buttons: ScreenButton[] = []
  if (page.submit_another.enabled) buttons.push({ kind: 'submit_another', label: page.submit_another.label ?? SUBMITTED_PAGE_DEFAULTS.submit_another })
  if (page.close.enabled) buttons.push({ kind: 'close', label: page.close.label ?? SUBMITTED_PAGE_DEFAULTS.close })
  // TODO(home-dashboard): a "Track progress" button linking to the run's progress
  // (/home/runs/<run id>) once Home's My submissions ships on main — the effects
  // only carry the short run reference today.
  screen.buttons = buttons
  if (buttons[0]) { screen.button = buttons[0].kind; screen.button_label = buttons[0].label }
  return screen
}

/**
 * The effects with the form's Submitted page applied (see the precedence in
 * the header). Unchanged when the page is off, for task forms, and when a
 * redirect, a close or a button's own success screen already decides.
 */
export function applySubmittedPage(effects: ButtonEffects, input: { layout: unknown; fields?: FieldLabelLike[]; scope: ButtonScope; surface?: SubmittedSurface }): ButtonEffects {
  if (input.surface === 'task') return effects
  if (effects.redirect || effects.close || effects.success_screen) return effects
  const page = layoutSubmittedPage(input.layout)
  if (!page) return effects
  return { ...effects, success_screen: planSubmittedPage(page, input.scope, input.fields) }
}

/** The buttons a success screen offers (a Submitted page's list, or an older screen's single button). */
export function screenButtons(screen: NonNullable<ButtonEffects['success_screen']>): ScreenButton[] {
  if (screen.buttons) return screen.buttons
  if (screen.button === 'none') return []
  const label = screen.button_label || (screen.button === 'submit_another' ? 'Submit another' : screen.button === 'close' ? 'Close' : 'Continue')
  if (screen.button === 'link') return screen.url ? [{ kind: 'link', label, url: screen.url }] : []
  return [{ kind: screen.button, label }]
}

/**
 * What a success-screen button does on a surface:
 *   submit_another → reset: fresh values, a new idempotency key, back on the
 *                    first step; the URL parameters (and the embedding
 *                    context's) are kept.
 *   close          → a form's own page goes to FORM_CLOSE_TARGET; a dialog,
 *                    an embedded pane or a task closes itself.
 *   link           → go to the (already vetted) address.
 */
export type ScreenButtonOutcome =
  | { kind: 'reset'; keepParams: true }
  | { kind: 'navigate'; href: string }
  | { kind: 'close_surface' }

export function screenButtonOutcome(button: ScreenButton, surface: SubmittedSurface): ScreenButtonOutcome {
  if (button.kind === 'submit_another') return { kind: 'reset', keepParams: true }
  if (button.kind === 'link' && button.url) return { kind: 'navigate', href: button.url }
  if (surface === 'page') return { kind: 'navigate', href: FORM_CLOSE_TARGET }
  return { kind: 'close_surface' }
}

/**
 * "Submit another": the next submission's values — empty answers with the
 * URL / embedding parameters and the form's other reserved context entries
 * (variables start again from their initial values) kept.
 */
export function freshSubmissionValues(previous: Record<string, unknown>, keep: readonly string[] = ['__form_params']): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of keep) if (Object.prototype.hasOwnProperty.call(previous, key)) out[key] = previous[key]
  return out
}

/** Designer problems of a Submitted page (shown under its settings; null when fine). */
export function submittedPageProblem(page: SubmittedPageConfig | null | undefined): string | null {
  if (!page?.enabled) return null
  if (!page.heading?.trim()) return 'The Submitted page needs a heading'
  if (page.icon === 'upload' && !page.icon_url) return 'Upload the success image, or pick an icon'
  return null
}
