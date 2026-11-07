/**
 * <ut-slider> — a styled native <input type="range"> (native keyboard and
 * screen-reader support), with an optional value bubble, evenly spaced mark
 * labels and a number box for exact entry. Value: a number, or null until
 * the person moves the slider (a designer default is shown, not stored).
 */
import { UtControl, css, define, formatNumber, html, nothing } from '../../shared/base'

/** Decimal places of a step (0.25 → 2), so 0.1 + 0.2 never shows 0.30000000000000004. */
function decimals(n: number): number {
  if (!Number.isFinite(n)) return 0
  const s = String(n)
  if (s.includes('e-')) return Number(s.split('e-')[1]) || 0
  const i = s.indexOf('.')
  return i < 0 ? 0 : s.length - i - 1
}

export class UtSlider extends UtControl {
  static properties = { draft: { state: true } }
  static styles = [UtControl.styles, css`
    .wrap { display: flex; flex-direction: column; gap: 2px; }
    .row { display: flex; align-items: center; gap: 12px; }
    .track-area { position: relative; flex: 1; min-width: 0; }
    .track-area.has-bubble { padding-top: 30px; }
    .affix { align-self: flex-start; margin-top: -2px; }
    .has-bubble + .affix { margin-top: 28px; }
    input[type='range'] {
      -webkit-appearance: none; appearance: none; display: block; width: 100%; height: 32px; margin: 0;
      background: transparent; cursor: pointer; touch-action: pan-y;
    }
    input[type='range']:focus { outline: none; }
    input[type='range']:focus-visible { outline: none; }
    input[type='range']::-webkit-slider-runnable-track {
      height: 6px; border-radius: 999px; border: 1px solid var(--_border);
      background: linear-gradient(to right, var(--_fill) 0 var(--_pct), var(--_surface) var(--_pct) 100%);
    }
    input[type='range']::-moz-range-track {
      height: 6px; border-radius: 999px; border: 1px solid var(--_border); background: var(--_surface);
    }
    input[type='range']::-moz-range-progress { height: 6px; border-radius: 999px; background: var(--_fill); }
    input[type='range']::-webkit-slider-thumb {
      -webkit-appearance: none; appearance: none; width: 24px; height: 24px; margin-top: -10px; border-radius: 50%;
      background: var(--_thumb-bg); border: 2px solid var(--_primary); box-shadow: 0 1px 3px rgb(0 0 0 / 0.25);
      transition: transform 0.12s ease;
    }
    input[type='range']::-moz-range-thumb {
      width: 20px; height: 20px; border-radius: 50%; background: var(--_thumb-bg); border: 2px solid var(--_primary);
      box-shadow: 0 1px 3px rgb(0 0 0 / 0.25);
    }
    input[type='range']:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 3px var(--_card), 0 0 0 5px var(--_focus); }
    input[type='range']:focus-visible::-moz-range-thumb { box-shadow: 0 0 0 3px var(--_card), 0 0 0 5px var(--_focus); }
    input[type='range']:active::-webkit-slider-thumb { transform: scale(1.1); }
    .unset input[type='range']::-webkit-slider-thumb { border-style: dashed; border-color: var(--_muted); }
    .unset input[type='range']::-moz-range-thumb { border-style: dashed; border-color: var(--_muted); }
    :host([invalid]) input[type='range']::-webkit-slider-runnable-track { border-color: var(--_error); }
    :host([disabled]) .wrap { opacity: 0.55; }
    :host([readonly]) input[type='range'], :host([disabled]) input[type='range'] { cursor: default; }
    .bubble {
      position: absolute; top: 0; left: var(--_thumb-x); transform: translateX(calc(var(--_pct) * -1));
      padding: 2px 8px; border-radius: 6px; font-weight: 600; font-size: 0.93em; line-height: 20px; white-space: nowrap;
      background: var(--_primary); color: var(--_on-primary); font-variant-numeric: tabular-nums; pointer-events: none;
    }
    .unset .bubble { background: var(--_card); color: var(--_muted); border: 1px dashed var(--_border); font-weight: 500; line-height: 18px; }
    .ends, .marks { display: flex; justify-content: space-between; color: var(--_muted); font-size: 0.86em; }
    .marks { position: relative; height: 1.4em; margin: 0 12px; }
    .mark { position: absolute; top: 0; transform: translateX(-50%); white-space: nowrap; }
    .mark:first-child { transform: translateX(-12px); }
    .mark:last-child { transform: translateX(calc(-100% + 12px)); }
    .mark.on { color: var(--_text); font-weight: 600; }
    .ends { padding: 0 2px; }
    .number {
      width: 88px; flex: none; height: 36px; padding: 0 8px; border: 1px solid var(--_border); border-radius: var(--_radius);
      background: var(--_input-bg); color: var(--_input-text); font: inherit; font-variant-numeric: tabular-nums;
    }
    .number:focus-visible { outline: 2px solid var(--_focus); outline-offset: 1px; border-color: var(--_focus); }
    :host([invalid]) .number { border-color: var(--_error); }
    .affix { display: inline-flex; align-items: center; gap: 4px; color: var(--_muted); flex: none; }
    .row { align-items: flex-start; }
    .status { color: var(--_muted); font-size: 0.86em; }
    @media (max-width: 420px) { .number { width: 72px; } }
  `]

  /** Text in the number box while the person types (null = mirror the value). */
  declare draft: string | null

  constructor() {
    super()
    this.draft = null
  }

  get lo(): number { return this.numberProp('min', 0) }
  get hi(): number {
    const hi = this.numberProp('max', 100)
    return hi > this.lo ? hi : this.lo + 1
  }
  get stepSize(): number {
    const s = this.numberProp('step', 1)
    return s > 0 ? s : 1
  }
  get places(): number { return Math.max(decimals(this.stepSize), decimals(this.lo)) }

  /** The stored value, or null when not set yet. */
  get current(): number | null {
    const v = this.value
    if (v === null || v === undefined || v === '') return null
    const n = typeof v === 'number' ? v : Number(v)
    return Number.isFinite(n) ? n : null
  }

  /** What the slider shows: the value, else the designer default, else min. */
  get shown(): number {
    const v = this.current
    if (v !== null) return Math.min(this.hi, Math.max(this.lo, v))
    const d = this.prop<unknown>('default_value', null)
    const n = typeof d === 'number' ? d : d === null || d === '' ? NaN : Number(d)
    return Number.isFinite(n) ? Math.min(this.hi, Math.max(this.lo, n)) : this.lo
  }

  get markLabels(): string[] {
    const raw = this.prop<unknown>('marks', [])
    const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[\n,]/) : []
    return list.map((m) => String(m ?? '').trim()).filter(Boolean).slice(0, 12)
  }

  fmt(n: number): string {
    const p = Math.min(6, this.places)
    return `${this.textProp('value_prefix')}${formatNumber(n, this.locale, { minimumFractionDigits: p, maximumFractionDigits: p })}${this.textProp('value_suffix')}`
  }

  /** The mark label a value sits on (within half a step), if any. */
  markAt(n: number): string {
    const marks = this.markLabels
    if (marks.length < 2) return marks.length === 1 && Math.abs(n - this.lo) < 1e-9 ? marks[0] : ''
    const span = (this.hi - this.lo) / (marks.length - 1)
    const i = Math.round((n - this.lo) / span)
    return Math.abs(this.lo + i * span - n) <= this.stepSize / 2 + 1e-9 ? marks[i] ?? '' : ''
  }

  validate(): string | null {
    const v = this.value
    if (v === null || v === undefined || v === '') return null
    const range = `Choose a value from ${this.fmt(this.lo)} to ${this.fmt(this.hi)}`
    if (typeof v !== 'number' || !Number.isFinite(v)) return range
    if (v < this.lo - 1e-9 || v > this.hi + 1e-9) return range
    const steps = (v - this.lo) / this.stepSize
    if (Math.abs(steps - Math.round(steps)) > 1e-6) return `${range}, in steps of ${formatNumber(this.stepSize, this.locale, { maximumFractionDigits: 6 })}`
    return null
  }

  private snap(n: number): number {
    const k = Math.round((n - this.lo) / this.stepSize)
    const v = Math.min(this.hi, Math.max(this.lo, this.lo + k * this.stepSize))
    return Number(v.toFixed(Math.min(10, this.places)))
  }

  private onRange(e: Event) {
    if (this.locked) return
    const n = Number((e.target as HTMLInputElement).value)
    if (!Number.isFinite(n)) return
    this.draft = null
    if (n !== this.current) this.emitChange(this.snap(n))
  }

  private onRangeKey(e: KeyboardEvent) {
    // Enter or Space on an unset slider accepts the shown (default) value.
    if (this.locked || this.current !== null) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      this.emitChange(this.snap(this.shown))
    }
  }

  private onNumberInput(e: Event) {
    if (this.locked) return
    const text = (e.target as HTMLInputElement).value
    this.draft = text
    if (text.trim() === '') { this.emitChange(null); return }
    const n = Number(text)
    if (Number.isFinite(n)) this.emitChange(n)
  }

  private onNumberCommit() {
    this.draft = null
  }

  private onFocusOut(e: FocusEvent) {
    if (!this.renderRoot.contains(e.relatedTarget as Node | null)) this.emitBlur()
  }

  render() {
    const lo = this.lo
    const hi = this.hi
    const cur = this.current
    const shown = this.shown
    const unset = cur === null
    const pct = ((shown - lo) / (hi - lo)) * 100
    const marks = this.markLabels
    const showValue = this.boolProp('show_value', true)
    const showInput = this.boolProp('show_input', false) && !this.locked
    const onMark = this.markAt(shown)
    const text = this.fmt(shown)
    const valuetext = unset ? `Not set${this.locked ? '' : `, starts at ${text}`}` : onMark && onMark !== text ? `${text}, ${onMark}` : text
    const prefix = this.textProp('value_prefix')
    const suffix = this.textProp('value_suffix')
    const name = this.utLabel || 'Value'
    const style = `--_pct:${pct}%;--_thumb-x:calc(${pct}% + ${12 - pct * 0.24}px);--_fill:${unset ? 'var(--_surface)' : 'var(--_primary)'};--_thumb-bg:var(--_card)`
    return html`
      <div class="wrap ${unset ? 'unset' : ''}" style=${style} @focusout=${this.onFocusOut}>
        <div class="row">
          <div class="track-area ${showValue ? 'has-bubble' : ''}">
            ${showValue ? html`<span class="bubble" aria-hidden="true">${unset ? (this.locked ? 'Not set' : `${text} · not set`) : text}</span>` : nothing}
            <input type="range" min=${lo} max=${hi} step=${this.stepSize} .value=${String(shown)}
              aria-label=${name} aria-valuetext=${valuetext}
              aria-describedby=${this.utDescription ? 'desc' : nothing}
              aria-required=${this.required ? 'true' : 'false'} aria-invalid=${this.invalid ? 'true' : 'false'}
              aria-readonly=${this.readonly ? 'true' : nothing}
              ?disabled=${this.locked}
              @input=${this.onRange} @change=${this.onRange} @keydown=${this.onRangeKey} />
            ${marks.length ? html`<div class="marks" aria-hidden="true">
                ${marks.map((m, i) => html`<span class="mark ${m === onMark ? 'on' : ''}" style="left:${marks.length === 1 ? 0 : (i / (marks.length - 1)) * 100}%">${m}</span>`)}
              </div>` : html`<div class="ends" aria-hidden="true"><span>${this.fmt(lo)}</span><span>${this.fmt(hi)}</span></div>`}
          </div>
          ${showInput ? html`<span class="affix">
              ${prefix ? html`<span aria-hidden="true">${prefix}</span>` : nothing}
              <input class="number" type="number" inputmode="decimal" min=${lo} max=${hi} step=${this.stepSize}
                .value=${this.draft ?? (cur === null ? '' : String(cur))} placeholder=${unset ? String(shown) : ''}
                aria-label=${`${name}, exact value${prefix || suffix ? ` (${[prefix, suffix].filter(Boolean).join(' … ')})` : ''}`}
                aria-invalid=${this.invalid ? 'true' : 'false'}
                @input=${this.onNumberInput} @change=${this.onNumberCommit} @blur=${this.onNumberCommit} />
              ${suffix ? html`<span aria-hidden="true">${suffix}</span>` : nothing}
            </span>` : nothing}
        </div>
        ${unset && !showValue ? html`<span class="status" aria-hidden="true">${this.locked ? 'Not set' : 'Not set yet — move the slider to choose'}</span>` : nothing}
      </div>
      ${this.utDescription ? html`<span id="desc" class="sr-only">${this.utDescription}</span>` : nothing}
    `
  }
}

define('ut-slider', UtSlider)
