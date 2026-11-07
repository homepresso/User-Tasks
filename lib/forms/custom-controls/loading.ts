/**
 * Making custom form controls load like native fields (pure, testable):
 *
 *   - ControlReadyGate: a form part (one FormGrid) stays hidden — laid out,
 *     so the frames load — until every control in it reports ready, or
 *     READY_WAIT_MS passes; then it reveals at once and never hides again.
 *     A control still loading after the wait shows a skeleton shaped like a
 *     native input (never a spinner).
 *   - Height reservation: the frame starts at the height this control had
 *     last time for this field (remembered per tag@version, field and width
 *     bucket), else the manifest's default height — so revealing it does not
 *     move the form.
 *   - consistentThemeTokens: app tokens that contradict the control's mode
 *     (a form with a dark card inside a light workspace keeps the light
 *     workspace surface colour) are dropped, so the control's own light /
 *     dark fallbacks apply instead of white bars in a dark form.
 */

import { BRIDGE_LIMITS, type ControlSizeSpec, type ControlTheme } from './contract'
import { clampFrameHeight } from './bridge'

/** The longest a form waits for its controls before showing them (with skeletons). */
export const READY_WAIT_MS = 1500

type Timer = unknown

export interface ReadyGateOptions {
  maxWait?: number
  onReveal: () => void
  setTimer?: (fn: () => void, ms: number) => Timer
  clearTimer?: (timer: Timer) => void
  /** Runs a check after the current work (default: a 0 ms timer). */
  defer?: (fn: () => void) => void
}

export class ControlReadyGate {
  private pending = new Set<string>()
  private timer: Timer | null = null
  private done = false
  private readonly maxWait: number
  private readonly setTimer: (fn: () => void, ms: number) => Timer
  private readonly clearTimer: (timer: Timer) => void
  private readonly defer: (fn: () => void) => void

  constructor(private readonly options: ReadyGateOptions) {
    this.maxWait = options.maxWait ?? READY_WAIT_MS
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimer = options.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>))
    this.defer = options.defer ?? ((fn) => { this.setTimer(fn, 0) })
  }

  /** Whether the part has been revealed (it stays revealed). */
  get revealed(): boolean {
    return this.done
  }

  /** Whether anything is holding the reveal. */
  get waiting(): boolean {
    return !this.done && this.pending.size > 0
  }

  /** A control on screen that is not ready yet. Controls registering after the reveal don't hide the form again. */
  register(id: string): void {
    if (this.done) return
    this.pending.add(id)
    if (this.timer === null) this.timer = this.setTimer(() => this.reveal(), this.maxWait)
  }

  ready(id: string): void {
    if (!this.pending.delete(id)) return
    if (!this.done && this.pending.size === 0) this.reveal()
  }

  /**
   * A control that went away (hidden by a rule, another step) no longer holds
   * the reveal — judged a moment later, so a control that is mounted again at
   * once (React's development double mount, a key change) still holds it.
   */
  unregister(id: string): void {
    if (!this.pending.delete(id)) return
    this.defer(() => { if (!this.done && this.pending.size === 0) this.reveal() })
  }

  /** Nothing registered when the part first painted: reveal (forms without controls are never held). */
  settle(): void {
    if (!this.done && this.pending.size === 0) this.reveal()
  }

  reveal(): void {
    if (this.done) return
    this.done = true
    if (this.timer !== null) this.clearTimer(this.timer)
    this.timer = null
    this.pending.clear()
    this.options.onReveal()
  }

  dispose(): void {
    if (this.timer !== null) this.clearTimer(this.timer)
    this.timer = null
  }
}

// ── Height reservation ─────────────────────────────────────────────────────

export const HEIGHT_MEMORY_KEY = 'ut-control-heights'
const HEIGHT_MEMORY_ENTRIES = 300

/** Widths within ~80px lay out alike (a phone vs a desktop column differ). */
export function widthBucket(width: number): number {
  return Number.isFinite(width) && width > 0 ? Math.round(width / 80) : 0
}

export function heightMemoryId(tag: string, version: string, fieldKey: string, width: number): string {
  return `${tag}@${version}|${fieldKey}|${widthBucket(width)}`
}

interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }

function readMemory(storage: StorageLike | null | undefined): Record<string, number> {
  if (!storage) return {}
  try {
    const parsed = JSON.parse(storage.getItem(HEIGHT_MEMORY_KEY) ?? '{}') as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, number> : {}
  } catch {
    return {}
  }
}

/** The last height measured for this control and field at about this width, if any. */
export function rememberedHeight(storage: StorageLike | null | undefined, id: string): number | null {
  const h = readMemory(storage)[id]
  return typeof h === 'number' && Number.isFinite(h) && h >= BRIDGE_LIMITS.minHeight && h <= BRIDGE_LIMITS.maxHeight ? Math.round(h) : null
}

export function rememberHeight(storage: StorageLike | null | undefined, id: string, height: number): void {
  if (!storage || !Number.isFinite(height)) return
  const memory = readMemory(storage)
  if (memory[id] === Math.round(height)) return
  delete memory[id]
  memory[id] = Math.round(height)
  const keys = Object.keys(memory)
  for (const key of keys.slice(0, Math.max(0, keys.length - HEIGHT_MEMORY_ENTRIES))) delete memory[key]
  try { storage.setItem(HEIGHT_MEMORY_KEY, JSON.stringify(memory)) } catch { /* storage full or disabled */ }
}

/** The height to reserve before the control reports: remembered, else the manifest's default, inside its bounds. */
export function reservedHeight(size: ControlSizeSpec | undefined, remembered: number | null): number {
  return clampFrameHeight(remembered ?? size?.default_height ?? size?.min_height ?? 44, size)
}

// ── Theme tokens ───────────────────────────────────────────────────────────

/** Backgrounds: must be dark in dark mode, light in light mode. */
const BACKGROUND_TOKENS = ['ut-surface', 'ut-card', 'ut-input-bg', 'ut-primary-light'] as const
/** Foregrounds: the other way round. */
const FOREGROUND_TOKENS = ['ut-text', 'ut-muted-text', 'ut-input-text', 'ut-primary-text'] as const

/** Drop tokens that contradict the mode (the control's own light / dark fallback applies instead). */
export function consistentThemeTokens(theme: ControlTheme, isDark: (color: string) => boolean | null): ControlTheme {
  const dark = theme.mode === 'dark'
  const tokens = { ...theme.tokens }
  for (const token of BACKGROUND_TOKENS) {
    const v = tokens[token]
    const d = v ? isDark(v) : null
    if (d !== null && d !== dark) delete tokens[token]
  }
  for (const token of FOREGROUND_TOKENS) {
    const v = tokens[token]
    const d = v ? isDark(v) : null
    if (d !== null && d === dark) delete tokens[token]
  }
  return { mode: theme.mode, tokens }
}
