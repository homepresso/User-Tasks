/**
 * <ut-likert> — a survey matrix: one row per statement, one column per point
 * of the scale (Strongly disagree … Strongly agree, satisfaction, frequency or
 * custom labels), optional N/A. Each statement is its own ARIA radiogroup
 * with a roving tab stop (Tab moves to the next statement, the arrow keys
 * choose within it). Wide: a matrix with a header row; narrow (phones): one
 * card per statement with labelled options.
 *
 * Value: { "<statement_slug>": 1…N (0 = N/A) }, or null when nothing is answered.
 */
import { UtControl, css, define, html, nothing, uid, type PropertyValues } from '../../shared/base'

const SCALES: Record<string, string[]> = {
  agree5: ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree'],
  agree7: ['Strongly disagree', 'Disagree', 'Somewhat disagree', 'Neutral', 'Somewhat agree', 'Agree', 'Strongly agree'],
  satisfaction5: ['Very dissatisfied', 'Dissatisfied', 'Neutral', 'Satisfied', 'Very satisfied'],
  frequency5: ['Never', 'Rarely', 'Sometimes', 'Often', 'Always'],
}
const DEFAULT_STATEMENTS = [
  'The request was handled quickly',
  'The staff were helpful and courteous',
  'I would recommend us to a colleague',
]

/** Stable keys: lowercase, non-alphanumerics → _, deduplicated with _2, _3 … */
export function statementKeys(statements: string[]): string[] {
  const seen = new Map<string, number>()
  return statements.map((s) => {
    const base = s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'statement'
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return n === 1 ? base : `${base}_${n}`
  })
}

interface Option { n: number; label: string }

export class UtLikert extends UtControl {
  static properties = { narrow: { state: true } }

  static styles = [UtControl.styles, css`
    .matrix { border: 1px solid var(--_border); border-radius: var(--_radius); background: var(--_card); }
    :host([invalid]) .matrix { border-color: var(--_error); }
    .row { display: grid; grid-template-columns: var(--_cols); align-items: stretch; border-top: 1px solid var(--_border); }
    .row:first-child { border-top: none; }
    .head { position: sticky; top: 0; z-index: 1; background: var(--_surface); border-radius: var(--_radius) var(--_radius) 0 0; }
    .head span { padding: 8px 4px; font-size: 0.82em; font-weight: 600; color: var(--_muted); text-align: center; display: flex; align-items: flex-end; justify-content: center; line-height: 1.2; }
    .head span.na, .opt.na { border-left: 1px dashed var(--_border); }
    .stmt { padding: 10px 12px; display: flex; align-items: center; color: var(--_text); }
    .group { display: contents; }
    .opt { all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 10px; min-height: 44px; min-width: 32px; }
    .opt:hover .dot { border-color: var(--_primary); }
    .opt:focus-visible { outline: none; }
    .opt:focus-visible .dot { outline: 2px solid var(--_focus); outline-offset: 3px; }
    .dot { flex: none; width: 20px; height: 20px; border-radius: 50%; border: 2px solid var(--_muted); background: var(--_input-bg); display: inline-flex; align-items: center; justify-content: center; }
    .opt[aria-checked='true'] .dot { border-color: var(--_primary); background: var(--_primary); }
    .opt[aria-checked='true'] .dot::after { content: ''; width: 8px; height: 8px; border-radius: 50%; background: var(--_on-primary); }
    .text { display: none; }
    .row.answered .stmt { font-weight: 500; }
    :host([readonly]) .opt, :host([disabled]) .opt { cursor: default; }
    :host([disabled]) .matrix { opacity: 0.55; }
    .foot { margin-top: 6px; font-size: 0.86em; color: var(--_muted); }

    /* Narrow: one card per statement. */
    .narrow.matrix { border: none; background: transparent; display: grid; gap: 10px; }
    .narrow .row.head { display: none; }
    .narrow .row { display: block; border: 1px solid var(--_border); border-radius: var(--_radius); background: var(--_card); padding: 4px 0 6px; }
    .narrow .stmt { font-weight: 600; padding: 8px 12px 4px; }
    .narrow .group { display: flex; flex-direction: column; }
    .narrow .opt { justify-content: flex-start; padding: 4px 12px; min-height: 40px; }
    .narrow .opt.na { border-left: none; border-top: 1px dashed var(--_border); margin-top: 4px; }
    .narrow .text { display: inline; }
    .narrow .opt[aria-checked='true'] .text { font-weight: 600; }
  `]

  declare narrow: boolean
  private ro: ResizeObserver | null = null
  private base = uid('likert')

  constructor() {
    super()
    this.narrow = false
  }

  connectedCallback(): void {
    super.connectedCallback()
    try {
      this.ro = new ResizeObserver(() => this.measure())
      this.ro.observe(this)
    } catch { /* no ResizeObserver: stay wide */ }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    this.ro?.disconnect()
    this.ro = null
  }

  private measure() {
    const width = this.getBoundingClientRect().width
    if (!width) return
    // A statement column of ~180px plus ≥ 56px per option, and never under 520px.
    const need = Math.max(520, 180 + this.options.length * 56)
    const narrow = width < need
    if (narrow !== this.narrow) this.narrow = narrow
  }

  protected updated(changed: PropertyValues): void {
    super.updated(changed)
    if (!changed.has('narrow')) this.measure()
  }

  get statementList(): string[] {
    const v = this.prop<unknown>('statements', DEFAULT_STATEMENTS)
    const list = Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean)
      : typeof v === 'string' ? v.split('\n').map((x) => x.trim()).filter(Boolean) : []
    return (list.length ? list : DEFAULT_STATEMENTS).slice(0, 100)
  }

  get keys(): string[] { return statementKeys(this.statementList) }

  get scaleLabels(): string[] {
    const scale = this.textProp('scale', 'agree5')
    if (scale === 'custom') {
      const raw = this.prop<unknown>('scale_labels', [])
      const list = Array.isArray(raw) ? raw.map((x) => String(x ?? '').trim()).filter(Boolean) : []
      if (list.length >= 2) return list.slice(0, 10)
    }
    return SCALES[scale] ?? SCALES.agree5
  }

  get options(): Option[] {
    const opts = this.scaleLabels.map((label, i) => ({ n: i + 1, label }))
    if (this.boolProp('show_na', false)) opts.push({ n: 0, label: 'N/A' })
    return opts
  }

  get answers(): Record<string, number> {
    const v = this.value
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
    const out: Record<string, number> = {}
    for (const [k, n] of Object.entries(v as Record<string, unknown>)) if (typeof n === 'number' && Number.isInteger(n)) out[k] = n
    return out
  }

  private remaining(): number {
    const a = this.answers
    return this.keys.filter((k) => a[k] === undefined).length
  }

  validate(): string | null {
    const v = this.value
    if (v !== null && v !== undefined) {
      if (typeof v !== 'object' || Array.isArray(v)) return 'Answer the statements'
      const max = this.scaleLabels.length
      const na = this.boolProp('show_na', false)
      for (const n of Object.values(v as Record<string, unknown>)) {
        if (typeof n !== 'number' || !Number.isInteger(n) || n > max || n < (na ? 0 : 1)) return `Choose a point from 1 to ${max}`
      }
    }
    if (this.boolProp('all_required', false)) {
      const left = this.remaining()
      if (left) return `Answer every statement (${left} left)`
    }
    return null
  }

  private choose(row: number, n: number) {
    if (this.locked) return
    const key = this.keys[row]
    const a = this.answers
    if (a[key] === n) return
    // Keep only the current statements' answers.
    const next: Record<string, number> = {}
    for (const k of this.keys) if (a[k] !== undefined) next[k] = a[k]
    next[key] = n
    this.emitChange(next)
  }

  private clear(row: number) {
    if (this.locked) return
    const key = this.keys[row]
    const a = this.answers
    if (a[key] === undefined) return
    const next: Record<string, number> = {}
    for (const k of this.keys) if (a[k] !== undefined && k !== key) next[k] = a[k]
    this.emitChange(Object.keys(next).length ? next : null)
  }

  private focusOpt(row: number, idx: number) {
    this.updateComplete.then(() => (this.renderRoot.querySelector(`[data-r="${row}"][data-i="${idx}"]`) as HTMLElement | null)?.focus())
  }

  private onKey(e: KeyboardEvent, row: number) {
    const target = e.target as HTMLElement
    const idx = Number(target?.dataset?.i ?? -1)
    if (idx < 0) return
    const opts = this.options
    let next: number | null = null
    switch (e.key) {
      case 'ArrowRight': case 'ArrowDown': next = (idx + 1) % opts.length; break
      case 'ArrowLeft': case 'ArrowUp': next = (idx - 1 + opts.length) % opts.length; break
      case 'Home': next = 0; break
      case 'End': next = opts.length - 1; break
      case ' ': case 'Enter': e.preventDefault(); this.choose(row, opts[idx].n); return
      case 'Delete': case 'Backspace': e.preventDefault(); this.clear(row); return
      default: return
    }
    e.preventDefault()
    if (this.disabled) return
    // Arrows choose (like native radios); read-only only moves focus.
    if (!this.locked) this.choose(row, opts[next].n)
    this.focusOpt(row, next)
  }

  render() {
    const statements = this.statementList
    const keys = this.keys
    const opts = this.options
    const answers = this.answers
    const total = statements.length
    const answered = keys.filter((k) => answers[k] !== undefined).length
    const scaleCols = opts.map(() => 'minmax(48px, 1fr)').join(' ')
    const cols = `minmax(160px, 2.2fr) ${scaleCols}`
    return html`
      <div class="matrix ${this.narrow ? 'narrow' : ''}" style=${`--_cols:${cols}`} role="group" aria-label=${this.utLabel || 'Survey'}
        aria-describedby=${this.utDescription ? `${this.base}-desc` : nothing}
        @focusout=${(e: FocusEvent) => { if (!this.renderRoot.contains(e.relatedTarget as Node)) this.emitBlur() }}>
        <div class="row head" aria-hidden="true">
          <span></span>${opts.map((o) => html`<span class=${o.n === 0 ? 'na' : ''}>${o.label}</span>`)}
        </div>
        ${statements.map((s, r) => {
          const chosen = answers[keys[r]]
          const tabIdx = Math.max(0, opts.findIndex((o) => o.n === chosen))
          return html`<div class="row ${chosen !== undefined ? 'answered' : ''}">
            <div class="stmt" id=${`${this.base}-s${r}`}>${s}</div>
            <div class="group" role="radiogroup" aria-labelledby=${`${this.base}-s${r}`}
              aria-required=${this.boolProp('all_required', false) || this.required ? 'true' : 'false'}
              aria-readonly=${this.readonly ? 'true' : 'false'} aria-disabled=${this.disabled ? 'true' : 'false'}
              aria-invalid=${this.invalid && chosen === undefined ? 'true' : 'false'}
              @keydown=${(e: KeyboardEvent) => this.onKey(e, r)}>
              ${opts.map((o, i) => html`<button type="button" role="radio" class="opt ${o.n === 0 ? 'na' : ''}" data-r=${r} data-i=${i}
                aria-checked=${chosen === o.n ? 'true' : 'false'} aria-label=${o.label}
                tabindex=${this.disabled ? -1 : i === tabIdx ? 0 : -1}
                @click=${() => { this.choose(r, o.n); this.focusOpt(r, i) }}>
                <span class="dot" aria-hidden="true"></span><span class="text" aria-hidden="true">${o.label}</span>
              </button>`)}
            </div>
          </div>`
        })}
      </div>
      ${total > 1 ? html`<div class="foot" aria-hidden="true">${answered} of ${total} answered</div>` : nothing}
      ${this.utDescription ? html`<span id=${`${this.base}-desc`} class="sr-only">${this.utDescription}</span>` : nothing}
    `
  }
}

define('ut-likert', UtLikert)
