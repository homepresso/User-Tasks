/**
 * Form animations (Buttons & header → Appearance): how much a form moves
 * where a person fills it in — the card and fields entering, step / tab
 * changes, lazy parts, show / hide and section collapse, banners, errors,
 * buttons, the Submitted page and Data table rows.
 *
 * Styles:
 *  - none:       nothing moves (the form looks as it always did, minus the Submitted page's pop);
 *  - subtle:     the default — short fades and small rises, ~350 ms at most;
 *  - expressive: longer, springier movement; optional confetti on success-tone Submitted pages.
 *
 * Subtle is the default for new AND existing forms: it only fades and moves
 * by a few pixels, never changes the size or place of anything once settled,
 * and the Submitted page already animated. Only what differs from the
 * default is stored, in the layout's own key (`layout.animation`), so the
 * setting travels with versions, export, packages and the API.
 *
 * The motion itself is CSS (app/form-motion.css, keyed off
 * `data-form-motion`); this module holds the model and the small decisions
 * the components make (the level after reduced motion, the stagger, the
 * direction of travel, the confetti pieces). Pure and isomorphic.
 */

import { isPlainObject } from '@/lib/utils/guards'

export type FormMotionStyle = 'none' | 'subtle' | 'expressive'
export const FORM_MOTION_STYLES: FormMotionStyle[] = ['none', 'subtle', 'expressive']
export const DEFAULT_FORM_MOTION: FormMotionStyle = 'subtle'

export const FORM_MOTION_LABELS: Record<FormMotionStyle, string> = {
  none: 'None',
  subtle: 'Subtle',
  expressive: 'Expressive',
}

/** Stored shape: only what differs from the default (absent = subtle, no confetti). */
export interface FormAnimationConfig {
  style?: Exclude<FormMotionStyle, 'subtle'>
  /** Expressive: a light confetti burst on a success-tone Submitted page. */
  confetti?: true
}

export interface ResolvedFormAnimation {
  style: FormMotionStyle
  confetti: boolean
}

/**
 * What the CSS sees (`data-form-motion`): the style, or `reduced` when the
 * person prefers reduced motion (opacity-only fades, no movement, no
 * stagger, no confetti).
 */
export type FormMotionLevel = FormMotionStyle | 'reduced'

/** Stored `layout.animation` → its clean form (null when everything is default). */
export function normalizeFormAnimation(raw: unknown): FormAnimationConfig | null {
  if (!isPlainObject(raw)) return null
  const out: FormAnimationConfig = {}
  if (raw.style === 'none' || raw.style === 'expressive') out.style = raw.style
  if (raw.confetti === true) out.confetti = true
  return Object.keys(out).length ? out : null
}

/** The form's animation (default: subtle, no confetti) — old forms without the key included. */
export function formAnimation(layout: unknown): ResolvedFormAnimation {
  const config = isPlainObject(layout) ? normalizeFormAnimation(layout.animation) : null
  return { style: config?.style ?? DEFAULT_FORM_MOTION, confetti: config?.confetti === true }
}

/** The layout with the animation changed (the key is dropped when it is back to the default). */
export function withFormAnimation<T extends { animation?: FormAnimationConfig }>(layout: T, patch: Partial<ResolvedFormAnimation>): T {
  const current = formAnimation(layout)
  const style = patch.style ?? current.style
  const confetti = patch.confetti ?? current.confetti
  const next = normalizeFormAnimation({ style, confetti })
  const out = { ...layout }
  if (next) out.animation = next
  else delete out.animation
  return out
}

/** The level the CSS uses: none stays none; reduced motion turns any movement into opacity only. */
export function motionLevel(style: FormMotionStyle, prefersReducedMotion: boolean): FormMotionLevel {
  if (style === 'none') return 'none'
  return prefersReducedMotion ? 'reduced' : style
}

/** Whether anything moves (or fades) at this level. */
export function animates(level: FormMotionLevel): boolean {
  return level !== 'none'
}

/* ── Timing ──────────────────────────────────────────────────────────── */

/**
 * The numbers behind each style (the CSS custom properties in
 * app/form-motion.css mirror them). `staggerStep` × `staggerCap` +
 * `fieldMs` stays within `budgetMs`: the whole entrance is done by then.
 */
export const FORM_MOTION_TIMING: Record<'subtle' | 'expressive', { cardMs: number; fieldMs: number; staggerStep: number; staggerCap: number; budgetMs: number }> = {
  subtle: { cardMs: 240, fieldMs: 200, staggerStep: 24, staggerCap: 6, budgetMs: 360 },
  expressive: { cardMs: 420, fieldMs: 320, staggerStep: 40, staggerCap: 8, budgetMs: 660 },
}

/** Longer forms than this enter as one block: no per-field stagger. */
export const STAGGER_MAX_FIELDS = 20

/**
 * The stagger slot of the row at `position` (0-based) on load, or undefined
 * for no stagger: nothing moves, reduced motion, or a long form (more than
 * STAGGER_MAX_FIELDS fields). Later rows share the last slot, so the total
 * stays within the style's budget.
 */
export function staggerIndex(position: number, fieldCount: number, level: FormMotionLevel): number | undefined {
  if (level !== 'subtle' && level !== 'expressive') return undefined
  if (fieldCount > STAGGER_MAX_FIELDS) return undefined
  const cap = FORM_MOTION_TIMING[level].staggerCap
  return Math.max(0, Math.min(Math.floor(position), cap))
}

/** The entrance's total time in ms at this level for a form with `fieldCount` fields and `rows` rows. */
export function entranceMs(level: FormMotionLevel, fieldCount: number, rows: number): number {
  if (level === 'none') return 0
  if (level === 'reduced') return FORM_MOTION_TIMING.subtle.fieldMs
  const t = FORM_MOTION_TIMING[level]
  const last = staggerIndex(Math.max(0, rows - 1), fieldCount, level) ?? 0
  return Math.max(t.cardMs, last * t.staggerStep + t.fieldMs)
}

/* ── Steps / tabs ────────────────────────────────────────────────────── */

export type TravelDirection = 'forward' | 'back' | 'none'

/** Which way a step / tab change goes (by page order): forward slides in from the end, back from the start. */
export function travelDirection(order: string[], from: string | null | undefined, to: string | null | undefined): TravelDirection {
  if (!from || !to || from === to) return 'none'
  const a = order.indexOf(from)
  const b = order.indexOf(to)
  if (a < 0 || b < 0) return 'none'
  return b > a ? 'forward' : 'back'
}

/* ── Submitted page ──────────────────────────────────────────────────── */

/**
 * Confetti on a Submitted page: Expressive with confetti turned on, a
 * success-tone page (the form's own Submitted page with the success colour,
 * the default) and no reduced motion.
 */
export function showConfetti(animation: ResolvedFormAnimation, level: FormMotionLevel, screen: { source?: string; icon?: { kind: string; color?: string } | null } | null | undefined): boolean {
  if (!animation.confetti || level !== 'expressive' || !screen || screen.source !== 'form') return false
  const icon = screen.icon
  if (!icon) return true
  return icon.kind !== 'icon' || !icon.color || icon.color === 'success'
}

export interface ConfettiPiece {
  /** Horizontal start, % of the burst's width. */
  x: number
  /** Sideways drift in px. */
  dx: number
  /** Rise in px (negative: up). */
  dy: number
  /** Final rotation in degrees. */
  rotate: number
  delay: number
  /** 0–3: which theme colour (primary, success, warning, info). */
  color: number
  /** Width in px (height is 40 % of it… or a dot). */
  size: number
  round: boolean
}

/** A small, deterministic burst (no Math.random: the same on server and client). */
export function confettiPieces(count = 18, seed = 7): ConfettiPiece[] {
  let s = seed >>> 0 || 1
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
  const n = Math.max(0, Math.min(40, Math.floor(count)))
  return Array.from({ length: n }, (_, i) => {
    const spread = (i / Math.max(1, n - 1)) - 0.5
    return {
      x: Math.round(50 + spread * 30),
      dx: Math.round(spread * 220 + (rand() - 0.5) * 60),
      dy: Math.round(-60 - rand() * 90),
      rotate: Math.round((rand() - 0.5) * 540),
      delay: Math.round(rand() * 120),
      color: i % 4,
      size: 6 + Math.round(rand() * 4),
      round: rand() > 0.7,
    }
  })
}
