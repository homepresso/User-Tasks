/**
 * Form messages and prompts — the display side of the "Show a message" and
 * "Ask a question" actions (lib/forms/field-buttons.ts), shared by form rules
 * and in-form Buttons.
 *
 *   Show a message   style      banner (top of the form, sticky) | inline
 *                               (under the button / the form — the original
 *                               look; a message saved without a style keeps
 *                               rendering exactly as before)
 *                    tone       info | success | warning | error
 *                    duration   dismiss (a close button) | auto (2–60 s,
 *                               paused while hovered or focused) |
 *                               next_action | sticky (no close)
 *                    title      optional, above the text
 *
 *   Ask a question   the same text / title / tone, plus `prompt`:
 *                    display    banner (with buttons) | dialog (modal)
 *                    preset     ok | ok_cancel | yes_no | yes_no_cancel | custom
 *                    buttons    [{ value, label, style, then?, continue? }] —
 *                               each response's own actions ("If Yes → …")
 *                               and whether the actions after the question
 *                               run (Yes / OK do by default; No / Cancel /
 *                               closing the prompt stop them)
 *                    escape     the response Escape (and closing) gives
 *                    id         its name for the "Message answered" rule event
 *
 * Branch actions are one level deep (a question inside a branch is not
 * allowed). Server steps inside a branch are addressed by
 * { index, branch: { response, index } } and looked up in the SAVED form,
 * like top-level ones (findServerRuleAction / the button endpoint).
 *
 * Pure and isomorphic.
 */

import { isPlainObject } from '@/lib/utils/guards'

export type MessageTone = 'info' | 'success' | 'warning' | 'error'
export type MessageStyle = 'banner' | 'inline'
export type MessageDuration = 'dismiss' | 'auto' | 'next_action' | 'sticky'
export type PromptPreset = 'ok' | 'ok_cancel' | 'yes_no' | 'yes_no_cancel' | 'custom'
export type PromptDisplay = 'banner' | 'dialog'
export type PromptButtonStyle = 'primary' | 'secondary' | 'danger'

export const MESSAGE_TONES: MessageTone[] = ['info', 'success', 'warning', 'error']
export const MESSAGE_DURATIONS: MessageDuration[] = ['dismiss', 'auto', 'next_action', 'sticky']
export const PROMPT_PRESETS: PromptPreset[] = ['ok', 'ok_cancel', 'yes_no', 'yes_no_cancel', 'custom']

export const MESSAGE_TONE_LABELS: Record<MessageTone, string> = { info: 'Info', success: 'Success', warning: 'Warning', error: 'Error' }
export const MESSAGE_DURATION_LABELS: Record<MessageDuration, string> = {
  dismiss: 'Until dismissed',
  auto: 'Auto-hide after…',
  next_action: 'Until the next action',
  sticky: 'Stays (no close)',
}
export const PROMPT_PRESET_LABELS: Record<PromptPreset, string> = {
  ok: 'OK', ok_cancel: 'OK / Cancel', yes_no: 'Yes / No', yes_no_cancel: 'Yes / No / Cancel', custom: 'Custom buttons',
}

export const MESSAGE_LIMITS = { seconds: { min: 2, max: 60, default: 6 }, title: 120, buttons: 4, label: 40, branchActions: 12 } as const
/** Banners visible at once; older ones collapse into "N more". */
export const MAX_VISIBLE_BANNERS = 3
/** Auto-hide shorter than this fails WCAG 2.2.1 for many people (the checker warns). */
export const MIN_READABLE_SECONDS = 5

/** The response a closed prompt gives when Escape maps to nothing. */
export const DISMISSED_RESPONSE = 'dismissed'

const VALUE_RE = /^[a-z0-9_]{1,40}$/

export interface PromptButton<A = unknown> {
  value: string
  label: string
  style?: PromptButtonStyle
  /** Actions this response runs ("If Yes → …"). */
  then?: A[]
  /** Run the actions after the question too (default: OK / Yes). */
  continue?: boolean
}

export interface PromptConfig<A = unknown> {
  /** Its name for "Message answered" rules (event.message). */
  id?: string
  display: PromptDisplay
  preset: PromptPreset
  buttons: Array<PromptButton<A>>
  /** The response Escape / closing gives (default: cancel, else no; none → "dismissed"). */
  escape?: string
}

/** The buttons a preset starts with (labels editable; values fixed). */
export function presetButtons(preset: PromptPreset): PromptButton[] {
  switch (preset) {
    case 'ok': return [{ value: 'ok', label: 'OK', style: 'primary', continue: true }]
    case 'ok_cancel': return [{ value: 'ok', label: 'OK', style: 'primary', continue: true }, { value: 'cancel', label: 'Cancel', style: 'secondary' }]
    case 'yes_no': return [{ value: 'yes', label: 'Yes', style: 'primary', continue: true }, { value: 'no', label: 'No', style: 'secondary' }]
    case 'yes_no_cancel': return [{ value: 'yes', label: 'Yes', style: 'primary', continue: true }, { value: 'no', label: 'No', style: 'secondary' }, { value: 'cancel', label: 'Cancel', style: 'secondary' }]
    case 'custom': return [{ value: 'ok', label: 'OK', style: 'primary', continue: true }]
  }
}

/** The default Escape response: Cancel, else No, else none (closing = "dismissed"). */
export function defaultEscape(buttons: Array<{ value: string }>): string | undefined {
  return buttons.find((b) => b.value === 'cancel')?.value ?? buttons.find((b) => b.value === 'no')?.value
}

/** What Escape / closing the prompt answers. */
export function escapeResponse(prompt: Pick<PromptConfig, 'escape' | 'buttons'>): string {
  if (prompt.escape === DISMISSED_RESPONSE) return DISMISSED_RESPONSE
  if (prompt.escape && prompt.buttons.some((b) => b.value === prompt.escape)) return prompt.escape
  return defaultEscape(prompt.buttons) ?? DISMISSED_RESPONSE
}

export function clampSeconds(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
  if (!Number.isFinite(n)) return MESSAGE_LIMITS.seconds.default
  return Math.min(MESSAGE_LIMITS.seconds.max, Math.max(MESSAGE_LIMITS.seconds.min, Math.round(n)))
}

function str(raw: unknown, max: number): string | undefined {
  if (typeof raw !== 'string') return undefined
  const s = raw.trim()
  return s ? s.slice(0, max) : undefined
}

/** Clean a prompt config; `normalizeBranch` cleans each response's actions (questions inside are dropped by the caller). */
export function normalizePromptConfig<A>(raw: unknown, normalizeBranch: (actions: unknown[]) => A[]): PromptConfig<A> {
  const r = isPlainObject(raw) ? raw : {}
  const preset: PromptPreset = PROMPT_PRESETS.includes(r.preset as PromptPreset) ? r.preset as PromptPreset : 'yes_no'
  const out: PromptConfig<A> = { display: r.display === 'dialog' ? 'dialog' : 'banner', preset, buttons: [] }
  const id = typeof r.id === 'string' && VALUE_RE.test(r.id) ? r.id : undefined
  if (id) out.id = id
  const defaults = presetButtons(preset)
  const given = Array.isArray(r.buttons) ? r.buttons.filter(isPlainObject) : []
  const seen = new Set<string>()
  if (preset === 'custom') {
    for (const b of given.slice(0, MESSAGE_LIMITS.buttons)) {
      const value = typeof b.value === 'string' && VALUE_RE.test(b.value) && b.value !== DISMISSED_RESPONSE ? b.value : null
      if (!value || seen.has(value)) continue
      seen.add(value)
      out.buttons.push(cleanButton(b, { value, label: value, style: 'secondary' }, normalizeBranch))
    }
    if (!out.buttons.length) out.buttons = defaults.map((d) => ({ ...d })) as Array<PromptButton<A>>
  } else {
    // Presets: the preset's values in its order; labels, styles, branches and "continue" from what was stored.
    out.buttons = defaults.map((d) => cleanButton(given.find((b) => b.value === d.value) ?? null, d, normalizeBranch))
  }
  if (typeof r.escape === 'string' && (r.escape === DISMISSED_RESPONSE || out.buttons.some((b) => b.value === r.escape))) out.escape = r.escape
  return out
}

function cleanButton<A>(raw: Record<string, unknown> | null, d: PromptButton, normalizeBranch: (actions: unknown[]) => A[]): PromptButton<A> {
  const out: PromptButton<A> = { value: d.value, label: str(raw?.label, MESSAGE_LIMITS.label) ?? d.label }
  const style = raw?.style === 'primary' || raw?.style === 'secondary' || raw?.style === 'danger' ? raw.style : d.style
  if (style) out.style = style
  const then = Array.isArray(raw?.then) ? normalizeBranch(raw!.then as unknown[]).slice(0, MESSAGE_LIMITS.branchActions) : []
  if (then.length) out.then = then
  const cont = raw && typeof raw.continue === 'boolean' ? raw.continue : d.continue === true
  if (cont) out.continue = true
  return out
}

/** A prompt's response → its button (null: closed / unknown). */
export function promptButton<A>(prompt: PromptConfig<A>, response: string): PromptButton<A> | null {
  return prompt.buttons.find((b) => b.value === response) ?? null
}

/** The accessible name a prompt / banner gets (title, else the text without placeholders). */
export function accessibleName(title: string | undefined, text: string | undefined): string {
  const clean = (s: string | undefined) => (s ?? '').replace(/\{\{[^}]*\}\}/g, '').replace(/\s+/g, ' ').trim()
  return clean(title) || clean(text)
}

/** Banners: role=alert for warnings and errors (assertive), role=status otherwise (polite). */
export function bannerRole(tone: MessageTone | undefined): 'alert' | 'status' {
  return tone === 'warning' || tone === 'error' ? 'alert' : 'status'
}

/* ── The banner stack ───────────────────────────────────────────────── */

export interface BannerItem {
  id: number
  text: string
  title?: string
  tone: MessageTone
  duration: MessageDuration
  seconds?: number
}

/** The banners shown (newest MAX_VISIBLE_BANNERS, oldest first) and how many older ones are collapsed. */
export function visibleBanners<T>(items: T[], expanded = false): { shown: T[]; collapsed: number } {
  if (expanded || items.length <= MAX_VISIBLE_BANNERS) return { shown: items, collapsed: 0 }
  return { shown: items.slice(-MAX_VISIBLE_BANNERS), collapsed: items.length - MAX_VISIBLE_BANNERS }
}

/** Banners left after "the next action" (those that last until the next action go). */
export function afterNextAction<T extends { duration: MessageDuration }>(items: T[]): T[] {
  const kept = items.filter((b) => b.duration !== 'next_action')
  return kept.length === items.length ? items : kept
}

/* ── Auto-hide timer (pauses while hovered or focused: WCAG 2.2.1) ──── */

export interface TimerClock {
  now(): number
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

const realClock: TimerClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
}

/**
 * Counts down `ms` and calls `onExpire`; pause() for hover / focus (each
 * reason separately — the time left is kept until every reason resumes).
 */
export class AutoHideTimer {
  private remaining: number
  private startedAt: number | null = null
  private handle: unknown = null
  private reasons = new Set<string>()
  private done = false

  constructor(ms: number, private readonly onExpire: () => void, private readonly clock: TimerClock = realClock) {
    this.remaining = Math.max(0, ms)
  }

  start(): void {
    if (this.done || this.handle !== null || this.reasons.size) return
    this.startedAt = this.clock.now()
    this.handle = this.clock.setTimeout(() => { this.handle = null; this.done = true; this.onExpire() }, this.remaining)
  }

  pause(reason: string): void {
    this.reasons.add(reason)
    if (this.handle === null || this.startedAt === null) return
    this.clock.clearTimeout(this.handle)
    this.handle = null
    this.remaining = Math.max(0, this.remaining - (this.clock.now() - this.startedAt))
    this.startedAt = null
  }

  resume(reason: string): void {
    this.reasons.delete(reason)
    if (!this.reasons.size) this.start()
  }

  get paused(): boolean { return this.reasons.size > 0 }
  get left(): number { return this.startedAt === null ? this.remaining : Math.max(0, this.remaining - (this.clock.now() - this.startedAt)) }

  stop(): void {
    if (this.handle !== null) this.clock.clearTimeout(this.handle)
    this.handle = null
    this.done = true
  }
}
