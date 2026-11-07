/**
 * <ut-star-rating> — a star rating form control for UserTasks, built with Lit.
 *
 * The host (the UserTasks runtime, or the dev harness) sets the properties in
 * HOST_PROPERTIES plus the props declared in manifest.json (max, allow_clear,
 * size); the control dispatches ut-change, ut-blur, ut-validity and ut-resize.
 *
 * The value is a whole number of stars (1..max) or null when there is no
 * rating, so the form's own "required" check works on the server too.
 */
import { LitElement, css, html, nothing, svg, type PropertyValues } from 'lit'
import { HOST_PROPERTIES, applyTheme, emit, observeHeight, type ControlContext, type ControlTheme } from './ut-control'

const TAG = 'ut-star-rating'

/** Star size per `size` prop: every option is a target of at least 24 × 24 px (WCAG 2.5.8). */
const SIZES = { small: 24, medium: 32, large: 40 } as const
type StarSize = keyof typeof SIZES

const STAR = svg`<path d="M12 2.6l2.9 5.9 6.5.95-4.7 4.6 1.1 6.5L12 17.5l-5.8 3.05 1.1-6.5-4.7-4.6 6.5-.95L12 2.6z"/>`

/** Whole number of stars, 0 = no rating. */
function toRating(value: unknown, max: number): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0
  return Math.min(max, Math.max(0, Math.round(n)))
}

export class UtStarRating extends LitElement {
  static override shadowRootOptions = { ...LitElement.shadowRootOptions, delegatesFocus: true }

  static override properties = {
    ...HOST_PROPERTIES,
    // Declared props (manifest.json "props"): set one by one by the runtime.
    max: { type: Number },
    allow_clear: { type: Boolean, attribute: 'allow-clear' },
    size: { type: String },
    _hover: { state: true },
  }

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
  declare max: number | undefined
  declare allow_clear: boolean | undefined
  declare size: StarSize | undefined
  declare _hover: number

  #lastValidity = ''
  #resize: ResizeObserver | null = null

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
    this._hover = 0
  }

  static override styles = css`
    :host {
      display: block;
      --_primary: var(--ut-primary, #2563eb);
      --_primary-light: var(--ut-primary-light, #dbeafe);
      --_muted: var(--ut-muted-text, #4b5563);
      --_focus: var(--ut-focus-ring, #2563eb);
      --_error: var(--ut-error, #b91c1c);
      --_radius: var(--ut-radius, 8px);
      color: var(--ut-text, #111827);
      font-family: var(--ut-font-family, system-ui, sans-serif);
      font-size: var(--ut-font-size, 14px);
    }
    :host([data-mode='dark']) {
      color-scheme: dark;
      --_primary: var(--ut-primary, #60a5fa);
      --_primary-light: var(--ut-primary-light, #1e3a8a);
      --_muted: var(--ut-muted-text, #9ca3af);
      --_focus: var(--ut-focus-ring, #93c5fd);
      --_error: var(--ut-error, #f87171);
      color: var(--ut-text, #f3f4f6);
    }
    :host([hidden]) { display: none; }
    .group { display: inline-flex; gap: 4px; padding: 4px; border-radius: var(--_radius); }
    :host([invalid]) .group { outline: 2px solid var(--_error); }
    .star {
      display: inline-grid;
      place-items: center;
      inline-size: var(--_star, 32px);
      block-size: var(--_star, 32px);
      border-radius: calc(var(--_radius) / 2);
      color: var(--_muted);
      cursor: pointer;
      outline: none;
      -webkit-tap-highlight-color: transparent;
    }
    .star svg { inline-size: 100%; block-size: 100%; pointer-events: none; }
    .star path { fill: transparent; stroke: currentColor; stroke-width: 1.6; stroke-linejoin: round; }
    .star.preview { color: var(--_primary); }
    .star.preview path { fill: var(--_primary-light); }
    .star.on { color: var(--_primary); }
    .star.on path { fill: var(--_primary); }
    .star:focus-visible { outline: 2px solid var(--_focus); outline-offset: 2px; }
    :host([readonly]) .star { cursor: default; }
    :host([disabled]) .star { cursor: not-allowed; opacity: 0.5; }
    .sr {
      position: absolute; inline-size: 1px; block-size: 1px; margin: -1px; padding: 0;
      overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0;
    }
    @media (forced-colors: active) {
      .star { color: CanvasText; }
      .star.on, .star.preview { color: Highlight; }
      .star.on path { fill: Highlight; }
      .star:focus-visible { outline-color: Highlight; }
    }
  `

  // ── Effective props: a prop set by name wins over the `props` object ──────
  get #max(): number {
    const n = Math.round(Number(this.max ?? this.props?.max))
    return Number.isFinite(n) && n >= 1 ? Math.min(10, n) : 5
  }
  get #allowClear(): boolean {
    const raw = this.allow_clear ?? this.props?.allow_clear
    return raw === true || raw === 'true'
  }
  get #size(): StarSize {
    const raw = this.size ?? this.props?.size
    return typeof raw === 'string' && raw in SIZES ? (raw as StarSize) : 'medium'
  }
  get #rating(): number {
    return toRating(this.value, this.#max)
  }
  get #interactive(): boolean {
    return !this.disabled && !this.readonly
  }

  /** Focus the checked star (or the first): used by the label and by Tab into the frame. */
  override focus(options?: FocusOptions): void {
    const star = this.renderRoot.querySelector<HTMLElement>('.star[tabindex="0"]') ?? this.renderRoot.querySelector<HTMLElement>('.star')
    if (star) star.focus(options)
    else super.focus(options)
  }

  override connectedCallback(): void {
    super.connectedCallback()
    this.#resize = observeHeight(this)
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback()
    this.#resize?.disconnect()
    this.#resize = null
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('theme')) applyTheme(this, this.theme)
  }

  override updated(): void {
    this.#reportValidity()
  }

  override render() {
    const max = this.#max
    const rating = this.#rating
    const hover = this.#interactive ? this._hover : 0
    const tabStop = rating || 1
    const showError = this.invalid && !!this.error
    const describedBy = [this.description ? 'desc' : '', showError ? 'err' : ''].filter(Boolean).join(' ')

    return html`
      <div
        class="group"
        part="group"
        role="radiogroup"
        style="--_star: ${SIZES[this.#size]}px"
        aria-label=${this.label || 'Rating'}
        aria-describedby=${describedBy || nothing}
        aria-required=${this.required ? 'true' : nothing}
        aria-invalid=${this.invalid ? 'true' : nothing}
        aria-readonly=${this.readonly ? 'true' : nothing}
        aria-disabled=${this.disabled ? 'true' : nothing}
        @keydown=${this.#onKeyDown}
        @focusout=${this.#onFocusOut}
        @pointerleave=${() => (this._hover = 0)}
      >
        ${Array.from({ length: max }, (_, i) => {
          const n = i + 1
          const on = hover === 0 && n <= rating
          const preview = hover > 0 && n <= hover
          return html`<span
            class="star ${on ? 'on' : ''} ${preview ? 'preview' : ''}"
            data-n=${n}
            role="radio"
            aria-label=${n === 1 ? '1 star' : `${n} stars`}
            aria-checked=${n === rating ? 'true' : 'false'}
            aria-disabled=${this.disabled ? 'true' : nothing}
            tabindex=${!this.disabled && n === tabStop ? 0 : -1}
            @click=${() => this.#select(this.#allowClear && n === rating ? 0 : n, n)}
            @pointerenter=${() => { if (this.#interactive) this._hover = n }}
          ><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${STAR}</svg></span>`
        })}
      </div>
      <span class="sr" id="desc">${this.description ?? ''}</span>
      <span class="sr" id="err">${showError ? this.error : ''}</span>
    `
  }

  /** A user choice: update, tell the host, keep focus on the chosen star. */
  async #select(rating: number, focusStar?: number): Promise<void> {
    if (!this.#interactive) return
    const next = Math.min(this.#max, Math.max(0, rating))
    if (next !== this.#rating) {
      this.value = next === 0 ? null : next
      emit(this, 'ut-change', { value: this.value })
    }
    await this.updateComplete
    const stars = this.renderRoot.querySelectorAll<HTMLElement>('.star')
    ;(stars[(focusStar ?? next) - 1] ?? stars[0])?.focus()
  }

  #onKeyDown = (event: KeyboardEvent): void => {
    if (!this.#interactive) return
    const max = this.#max
    const rtl = getComputedStyle(this).direction === 'rtl'
    const current = this.#rating
    const focused = Number((this.renderRoot as ShadowRoot).activeElement?.getAttribute('data-n')) || current || 1
    let next: number
    switch (event.key) {
      case 'ArrowRight': next = rtl ? current - 1 : current + 1; break
      case 'ArrowLeft': next = rtl ? current + 1 : current - 1; break
      case 'ArrowUp': next = current + 1; break
      case 'ArrowDown': next = current - 1; break
      case 'Home': next = 1; break
      case 'End': next = max; break
      case ' ':
      case 'Enter': next = focused; break
      case 'Delete':
      case 'Backspace':
        if (!this.#allowClear) return
        event.preventDefault()
        void this.#select(0, 1)
        return
      default:
        return
    }
    event.preventDefault()
    void this.#select(Math.min(max, Math.max(1, next)))
  }

  /** ut-blur when focus leaves the control, not when it moves between stars. */
  #onFocusOut = (event: FocusEvent): void => {
    const to = event.relatedTarget as Node | null
    if (!to || !this.renderRoot.contains(to)) emit(this, 'ut-blur', {})
  }

  /** manifest validation.reports_validity: invalid when required and there is no rating. */
  #reportValidity(): void {
    const valid = !(this.required && this.#rating === 0)
    const detail = valid ? { valid: true } : { valid: false, message: 'Choose a rating.' }
    const key = JSON.stringify(detail)
    if (key === this.#lastValidity) return
    this.#lastValidity = key
    emit(this, 'ut-validity', detail)
  }
}

if (!customElements.get(TAG)) customElements.define(TAG, UtStarRating)

declare global {
  interface HTMLElementTagNameMap {
    'ut-star-rating': UtStarRating
  }
}
