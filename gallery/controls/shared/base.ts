/**
 * The base every official gallery control extends: Lit + the
 * @usertasks/form-control mixin (packages/form-control, bundled from source),
 * the theme tokens with light and dark fallbacks, and the small helpers the
 * controls share (accessible name / description, validity, read-only).
 *
 *   class Rating extends UtControl {
 *     static properties = { ...UtControl.properties, hover: { state: true } }
 *     static styles = [UtControl.styles, css`…`]
 *     render() { … this.emitChange(3) … }
 *   }
 *   define('ut-rating', Rating)
 *
 * Rules (tsconfig has useDefineForClassFields: false, but keep to them):
 *  - never initialise a reactive property as a class field — set defaults in
 *    the constructor (a field would shadow Lit's accessor);
 *  - read designer props with `this.prop('name', fallback)` (the runtime
 *    sets both `props` and each prop by name) — and never define a getter
 *    or method with a prop's name (`prop()` reads `this[name]` first);
 *  - "no value" is null; emit with `this.emitChange(v)`;
 *  - honour `readonly` / `disabled` (no changes, no focusable editors);
 *  - the accessible name is `this.utLabel`, the description
 *    `this.utDescription` (help text + error), both from the host.
 */
import { LitElement, css, type CSSResultGroup, type PropertyValues } from 'lit'
import { UserTasksControlMixin } from '../../../packages/form-control/src/mixin'
import type { ControlContext, ControlTheme } from '../../../packages/form-control/src/contract'

export { html, css, svg, nothing } from 'lit'
export type { PropertyValues, TemplateResult } from 'lit'
export type {
  ControlContext, ControlTheme, LookupResult, UploadResult, FileResult, ReportResult,
} from '../../../packages/form-control/src/contract'

/** CSS custom properties every control uses: `--_x` resolves to the host's `--ut-x` token, else a light / dark fallback. */
export const tokenStyles = css`
  :host {
    --_primary: var(--ut-primary, #2f5fd0);
    --_on-primary: var(--ut-on-primary, #ffffff);
    --_primary-text: var(--ut-primary-text, #2a4fa8);
    --_primary-light: var(--ut-primary-light, #e7eefc);
    --_text: var(--ut-text, #1b1916);
    --_muted: var(--ut-muted-text, #5f5a50);
    --_surface: var(--ut-surface, #f5f3ee);
    --_card: var(--ut-card, #ffffff);
    --_border: var(--ut-border, #cfc9bb);
    --_input-bg: var(--ut-input-bg, #ffffff);
    --_input-text: var(--ut-input-text, #1b1916);
    --_focus: var(--ut-focus-ring, var(--_primary));
    --_error: var(--ut-error, #b42318);
    --_success: var(--ut-success, #2f7a4b);
    --_radius: var(--ut-radius, 8px);
    display: block;
    box-sizing: border-box;
    font-family: var(--ut-font-family, system-ui, -apple-system, 'Segoe UI', sans-serif);
    font-size: var(--ut-font-size, 14px);
    line-height: 1.45;
    color: var(--_text);
    -webkit-tap-highlight-color: transparent;
  }
  :host([data-mode='dark']) {
    --_primary: var(--ut-primary, #7ea2ff);
    --_on-primary: var(--ut-on-primary, #0d1220);
    --_primary-text: var(--ut-primary-text, #a9c0ff);
    --_primary-light: var(--ut-primary-light, #1d2740);
    --_text: var(--ut-text, #eceae4);
    --_muted: var(--ut-muted-text, #a8a397);
    --_surface: var(--ut-surface, #1c1b19);
    --_card: var(--ut-card, #262522);
    --_border: var(--ut-border, #4a473f);
    --_input-bg: var(--ut-input-bg, #1f1e1b);
    --_input-text: var(--ut-input-text, #eceae4);
    --_error: var(--ut-error, #f97066);
    --_success: var(--ut-success, #6fcf97);
  }
  :host([hidden]) { display: none; }
  *, *::before, *::after { box-sizing: border-box; }
  .sr-only {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden;
    clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
  }
  :focus-visible { outline: 2px solid var(--_focus); outline-offset: 2px; }
  button { font: inherit; color: inherit; }
  .muted { color: var(--_muted); }
  .error-text { color: var(--_error); }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { transition: none !important; animation: none !important; }
  }
`

export class UtControl extends UserTasksControlMixin(LitElement) {
  static styles: CSSResultGroup = tokenStyles

  /** Typed views of the host properties (the mixin declares them). */
  declare value: unknown
  declare disabled: boolean
  declare readonly: boolean
  declare required: boolean
  declare invalid: boolean
  declare error: string | null
  declare props: Record<string, unknown>
  declare theme: ControlTheme | null
  declare locale: string
  declare context: ControlContext | null
  declare label: string
  declare description: string | null

  constructor() {
    super()
    this.value = null
    this.disabled = false
    this.readonly = false
    this.required = false
    this.invalid = false
    this.error = null
    this.props = {}
    this.theme = null
    this.locale = 'en'
    this.context = null
    this.label = ''
    this.description = null
  }

  /** Read-only or disabled: show the value, change nothing. */
  get locked(): boolean {
    return Boolean(this.readonly || this.disabled)
  }

  /** A context value the designer mapped (`context.fields[name]`), else null. */
  contextValue<T = unknown>(name: string): T | null {
    const fields = this.context?.fields
    const v = fields && Object.prototype.hasOwnProperty.call(fields, name) ? fields[name] : null
    return (v === undefined ? null : v) as T | null
  }

  /** A string prop (trimmed; fallback when empty). */
  textProp(name: string, fallback = ''): string {
    const v = this.prop<unknown>(name, fallback)
    return typeof v === 'string' && v.trim() ? v.trim() : fallback
  }

  /** A number prop clamped to [min, max]. */
  numberProp(name: string, fallback: number, min = -Infinity, max = Infinity): number {
    const raw = this.prop<unknown>(name, fallback)
    const n = typeof raw === 'number' ? raw : Number(raw)
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
  }

  boolProp(name: string, fallback = false): boolean {
    const v = this.prop<unknown>(name, fallback)
    return typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : fallback
  }

  /** The control's own check of its value (null = valid). Required-ness is the form's job. */
  validate(): string | null {
    return null
  }

  protected updated(changed: PropertyValues): void {
    super.updated(changed)
    if (changed.has('theme')) {
      if (this.theme?.mode === 'dark') this.dataset.mode = 'dark'
      else delete this.dataset.mode
    }
    const problem = this.validate()
    this.setValidity(!problem, problem ?? undefined)
  }
}

/** customElements.define once (a second bundle on the page must not throw). */
export function define(tag: string, ctor: CustomElementConstructor): void {
  if (!customElements.get(tag)) customElements.define(tag, ctor)
}

/** Unique ids for aria wiring inside one shadow root. */
let seq = 0
export function uid(prefix = 'ut'): string {
  seq += 1
  return `${prefix}-${seq}`
}

/** Locale-aware number formatting with a safe fallback. */
export function formatNumber(n: number, locale: string, options?: Intl.NumberFormatOptions): string {
  try { return new Intl.NumberFormat(locale || 'en', options).format(n) } catch { return String(n) }
}

/** Plain text for a value of unknown shape (labels, cells). */
export function plainText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(plainText).join(', ')
  try { return JSON.stringify(value) } catch { return String(value) }
}
