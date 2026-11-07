/**
 * <ut-rating> — a 1…N rating (stars, hearts or circles) as an ARIA
 * radiogroup with a roving tab stop: one Tab stop, arrows change the value,
 * Home / End jump, Delete clears (when allowed). Value: an integer 1…max, or
 * null for "not rated".
 */
import { UtControl, css, define, html, nothing, svg } from '../../shared/base'

const SIZES: Record<string, number> = { small: 24, medium: 32, large: 40 }
const SHAPES: Record<string, ReturnType<typeof svg>> = {
  star: svg`<path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5L2.6 9.4l6.5-.9z"/>`,
  heart: svg`<path d="M12 20.7l-1.4-1.3C5.4 14.7 2 11.6 2 7.9 2 4.9 4.4 2.6 7.3 2.6c1.7 0 3.3.8 4.7 2.1 1.4-1.3 3-2.1 4.7-2.1 2.9 0 5.3 2.3 5.3 5.3 0 3.7-3.4 6.8-8.6 11.5z"/>`,
  circle: svg`<circle cx="12" cy="12" r="9"/>`,
}

export class UtRating extends UtControl {
  static properties = { hover: { state: true } }
  static styles = [UtControl.styles, css`
    .row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-height: 32px; }
    .group { display: inline-flex; gap: 2px; border-radius: var(--_radius); }
    .opt { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
      border-radius: 6px; padding: 2px; min-width: 32px; min-height: 32px; color: var(--_border); }
    .opt svg { display: block; fill: currentColor; stroke: var(--_muted); stroke-width: 0.6; }
    .opt.on { color: var(--_symbol); }
    .opt.on svg { stroke: var(--_symbol); }
    .opt:focus-visible { outline: 2px solid var(--_focus); outline-offset: 1px; }
    :host([readonly]) .opt, :host([disabled]) .opt { cursor: default; }
    :host([disabled]) .group { opacity: 0.55; }
    :host([invalid]) .group { box-shadow: 0 0 0 1px var(--_error); }
    .caption { color: var(--_muted); font-size: 0.93em; }
  `]

  declare hover: number

  constructor() {
    super()
    this.hover = 0
  }

  get maxValue(): number { return Math.round(this.numberProp('max', 5, 2, 10)) }

  get current(): number {
    const v = typeof this.value === 'number' ? this.value : Number(this.value)
    return Number.isFinite(v) ? Math.min(this.maxValue, Math.max(0, Math.round(v))) : 0
  }

  labelFor(n: number): string {
    const labels = this.prop<unknown>('labels', [])
    const list = Array.isArray(labels) ? labels.map(String) : []
    return list[n - 1] ?? ''
  }

  validate(): string | null {
    const v = this.value
    if (v === null || v === undefined || v === '') return null
    return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= this.maxValue ? null : `Choose a rating from 1 to ${this.maxValue}`
  }

  private set(n: number) {
    if (this.locked) return
    const next = n <= 0 ? null : Math.min(this.maxValue, n)
    if (next === (this.current || null)) return
    this.emitChange(next)
  }

  private onClick(n: number) {
    if (this.locked) return
    if (n === this.current && this.boolProp('allow_clear', true)) this.set(0)
    else this.set(n)
    this.focusOption(n === this.current ? n : n)
  }

  private focusOption(n: number) {
    this.updateComplete.then(() => (this.renderRoot.querySelector(`[data-n="${Math.max(1, n)}"]`) as HTMLElement | null)?.focus())
  }

  private onKey(e: KeyboardEvent) {
    if (this.locked) return
    const cur = this.current
    let next: number | null = null
    switch (e.key) {
      case 'ArrowRight': case 'ArrowUp': next = Math.min(this.maxValue, cur + 1); break
      case 'ArrowLeft': case 'ArrowDown': next = Math.max(1, cur - 1); break
      case 'Home': next = 1; break
      case 'End': next = this.maxValue; break
      case 'Delete': case 'Backspace': if (this.boolProp('allow_clear', true)) { e.preventDefault(); this.set(0) } return
      case ' ': case 'Enter': {
        const n = Number((e.target as HTMLElement)?.dataset?.n)
        if (n) { e.preventDefault(); this.set(n) }
        return
      }
      default: return
    }
    e.preventDefault()
    this.set(next)
    this.focusOption(next)
  }

  render() {
    const max = this.maxValue
    const cur = this.current
    const shown = this.hover && !this.locked ? this.hover : cur
    const px = SIZES[this.textProp('size', 'medium')] ?? 32
    const shape = SHAPES[this.textProp('symbol', 'star')] ?? SHAPES.star
    const color = this.textProp('color', '')
    const caption = shown ? this.labelFor(shown) : ''
    const items = Array.from({ length: max }, (_, i) => i + 1)
    const tabbable = cur || 1
    return html`
      <div class="row" style=${color ? `--_symbol:${color}` : '--_symbol:var(--_primary)'}>
        <div class="group" role="radiogroup" aria-label=${this.utLabel || 'Rating'}
          aria-describedby=${this.utDescription ? 'desc' : nothing} aria-required=${this.required ? 'true' : 'false'}
          aria-invalid=${this.invalid ? 'true' : 'false'} aria-readonly=${this.readonly ? 'true' : 'false'} aria-disabled=${this.disabled ? 'true' : 'false'}
          @keydown=${this.onKey} @mouseleave=${() => { this.hover = 0 }} @focusout=${(e: FocusEvent) => { if (!this.renderRoot.contains(e.relatedTarget as Node)) this.emitBlur() }}>
          ${items.map((n) => html`<button type="button" class="opt ${n <= shown ? 'on' : ''}" role="radio" data-n=${n}
              aria-checked=${n === cur ? 'true' : 'false'} aria-label=${this.labelFor(n) ? `${n} of ${max}: ${this.labelFor(n)}` : `${n} of ${max}`}
              tabindex=${this.disabled ? -1 : n === tabbable ? 0 : -1}
              @click=${() => this.onClick(n)} @mouseenter=${() => { if (!this.locked) this.hover = n }}>
              <svg viewBox="0 0 24 24" width=${px} height=${px} aria-hidden="true">${shape}</svg>
            </button>`)}
        </div>
        ${caption ? html`<span class="caption" aria-hidden="true">${caption}</span>` : nothing}
        ${!cur && this.locked ? html`<span class="caption">Not rated</span>` : nothing}
      </div>
      ${this.utDescription ? html`<span id="desc" class="sr-only">${this.utDescription}</span>` : nothing}
    `
  }
}

define('ut-rating', UtRating)
