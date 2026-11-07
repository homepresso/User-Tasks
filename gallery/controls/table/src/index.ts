/**
 * <ut-table> — an editable table (ARIA grid). One Tab stop for the grid
 * (roving focus); arrows move between cells, Enter / F2 / typing edits,
 * Enter commits and moves down, Escape cancels, Tab / Shift+Tab move between
 * cells and leave the grid at its ends, Delete clears a cell, Ctrl+Enter adds
 * a row. Value: an array of row objects keyed by column key (numbers as
 * numbers, checkboxes as booleans, dates as YYYY-MM-DD, selects as the
 * option text); null until the person edits.
 */
import { UtControl, css, define, html, nothing, svg, type PropertyValues } from '../../shared/base'
import {
  blankRow, cellError, editText, formatCell, formatMoney, formatNum, isBlank, normaliseColumns, parseCell, rowIsBlank,
  type Column, type Row,
} from './cells'

const MAX_ROWS = 200
const TRASH = svg`<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>`
const PLUS = svg`<path d="M5 12h14"/><path d="M12 5v14"/>`

interface Pos { r: number; c: number }
interface Editing extends Pos { draft: string; token: number }

export class UtTable extends UtControl {
  static properties = { active: { state: true }, editing: { state: true }, announce: { state: true } }
  static styles = [UtControl.styles, css`
    .scroller { position: relative; overflow-x: auto; border: 1px solid var(--_border); border-radius: var(--_radius); background: var(--_input-bg); max-width: 100%; }
    :host([invalid]) .scroller { border-color: var(--_error); }
    :host([disabled]) .scroller { opacity: 0.6; }
    table { border-collapse: separate; border-spacing: 0; width: 100%; min-width: max-content; color: var(--_input-text); font-variant-numeric: tabular-nums; }
    th, td { text-align: left; padding: 0; border-bottom: 1px solid var(--_border); border-right: 1px solid var(--_border); vertical-align: top; }
    th:last-child, td:last-child { border-right: 0; }
    tbody tr:last-child > * { border-bottom: 0; }
    thead th { background: var(--_surface); color: var(--_muted); font-weight: 600; font-size: 0.86em; padding: 8px 10px; white-space: nowrap; }
    thead th.num { text-align: right; }
    .req { color: var(--_error); margin-left: 2px; }
    th.rownum, td.rownum { width: 40px; min-width: 40px; text-align: center; color: var(--_muted); font-weight: 500; font-size: 0.86em; background: var(--_surface); }
    td.rownum, th.rownum[scope='row'] { padding: 10px 4px; }
    .cell { position: relative; min-height: 40px; padding: 10px; cursor: text; outline: none; }
    .cell.num { text-align: right; }
    .cell.check { cursor: default; display: flex; align-items: center; justify-content: center; padding: 6px; }
    td.focus-target:focus-visible, .cell:focus-visible { outline: 2px solid var(--_focus); outline-offset: -2px; border-radius: 2px; }
    td[data-r] { outline: none; }
    td[data-r]:focus-visible { box-shadow: inset 0 0 0 2px var(--_focus); }
    td.bad { background: color-mix(in srgb, var(--_error) 8%, transparent); }
    .val { display: block; min-height: 1.45em; white-space: pre-wrap; overflow-wrap: anywhere; }
    .err { display: flex; gap: 4px; align-items: flex-start; margin-top: 4px; color: var(--_error); font-size: 0.8em; line-height: 1.3; white-space: normal; text-align: left; }
    .err::before { content: '!'; flex: none; display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; border-radius: 50%;
      background: var(--_error); color: var(--_card); font-weight: 700; font-size: 10px; line-height: 1; }
    td.editing { box-shadow: inset 0 0 0 2px var(--_focus); }
    .editor { display: block; width: 100%; min-height: 40px; padding: 9px 10px; border: 0; margin: 0; background: var(--_input-bg); color: var(--_input-text); font: inherit;
      font-variant-numeric: tabular-nums; outline: none; border-radius: 0; }
    .editor.num { text-align: right; }
    .editor:focus { box-shadow: inset 0 0 0 2px var(--_focus); }
    select.editor { padding: 8px 6px; }
    input[type='checkbox'] { width: 20px; height: 20px; margin: 0; accent-color: var(--_primary); cursor: pointer; }
    input[type='checkbox']:focus-visible { outline: 2px solid var(--_focus); outline-offset: 2px; }
    td.actions { width: 48px; min-width: 48px; text-align: center; vertical-align: middle; }
    .icon-btn { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; margin: 4px;
      border-radius: 6px; color: var(--_muted); cursor: pointer; }
    .icon-btn:hover { color: var(--_error); background: color-mix(in srgb, var(--_error) 10%, transparent); }
    .icon-btn:focus-visible { outline: 2px solid var(--_focus); outline-offset: 0; }
    .icon-btn[aria-disabled='true'] { opacity: 0.35; cursor: default; }
    .icon-btn[aria-disabled='true']:hover { color: var(--_muted); background: none; }
    svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    tfoot td, tfoot th { background: var(--_surface); font-weight: 600; padding: 10px; border-top: 1px solid var(--_border); border-bottom: 0; }
    tfoot .num { text-align: right; }
    .empty { padding: 16px 12px; color: var(--_muted); text-align: center; }
    .bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 8px; }
    .add { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 14px; border-radius: var(--_radius);
      border: 1px solid var(--_border); background: var(--_card); color: var(--_text); font-weight: 600; cursor: pointer; }
    .add:hover { border-color: var(--_primary); color: var(--_primary-text); }
    .add:focus-visible { outline: 2px solid var(--_focus); outline-offset: 2px; }
    .add[aria-disabled='true'] { opacity: 0.5; cursor: default; }
    .hint { color: var(--_muted); font-size: 0.82em; }
    .ro td, .ro th { padding: 8px 10px; }
    .ro td.num { text-align: right; }
    .ro .rownum { padding: 8px 4px; text-align: center; }
    @media (max-width: 480px) { .hint { display: none; } }
  `]

  declare active: Pos
  declare editing: Editing | null
  declare announce: string

  private focusWanted: 'cell' | 'editor' | 'add' | null = null
  private selectAll = true
  private tokens = 0

  constructor() {
    super()
    this.active = { r: 0, c: 0 }
    this.editing = null
    this.announce = ''
  }

  // ── model ────────────────────────────────────────────────────────────────

  get colDefs(): Column[] { return normaliseColumns(this.prop<unknown>('columns', null)) }
  get minRows(): number { return Math.round(this.numberProp('min_rows', 0, 0, MAX_ROWS)) }
  get maxRows(): number { return Math.max(this.minRows, Math.max(1, Math.round(this.numberProp('max_rows', 50, 1, MAX_ROWS)))) }
  get canAdd(): boolean { return this.boolProp('allow_add', true) }
  get canDelete(): boolean { return this.boolProp('allow_delete', true) }
  get currencyCode(): string {
    const c = this.textProp('currency', 'USD').toUpperCase()
    return /^[A-Z]{3}$/.test(c) ? c : 'USD'
  }

  /** Rows before the first edit: the designer's default rows, else min_rows blank rows. */
  initialRows(): Row[] {
    const cols = this.colDefs
    let raw = this.prop<unknown>('default_rows', null)
    if (typeof raw === 'string') { try { raw = JSON.parse(raw) } catch { raw = null } }
    if (Array.isArray(raw) && raw.length) {
      return raw.filter((r) => r && typeof r === 'object' && !Array.isArray(r)).slice(0, this.maxRows).map((r) => ({ ...blankRow(cols), ...(r as Row) }))
    }
    return Array.from({ length: this.minRows }, () => blankRow(cols))
  }

  get rows(): Row[] {
    const v = this.value
    if (Array.isArray(v)) return v.filter((r) => r && typeof r === 'object' && !Array.isArray(r)) as Row[]
    return this.initialRows()
  }

  /** Columns the roving focus visits: the data columns, then the delete button. */
  get navCols(): number { return this.colDefs.length + (this.canDelete && !this.locked ? 1 : 0) }

  validate(): string | null {
    const v = this.value
    if (!Array.isArray(v)) return null
    const rows = this.rows
    if (rows.length > this.maxRows) return `Remove rows: at most ${this.maxRows} are allowed`
    if (rows.length && rows.length < this.minRows) return `Add at least ${this.minRows} rows`
    const cols = this.colDefs
    const problems: string[] = []
    rows.forEach((row, r) => {
      for (const col of cols) {
        const problem = cellError(col, row[col.key])
        if (problem) problems.push(`Row ${r + 1}: ${problem}`)
      }
    })
    if (!problems.length) return null
    return problems.length === 1 ? problems[0] : `${problems[0]} (and ${problems.length - 1} more problem${problems.length === 2 ? '' : 's'})`
  }

  private emitRows(rows: Row[]) {
    const cols = this.colDefs
    // Every row carries every column key (blank = null, checkbox = false); other keys are kept.
    const clean = rows.slice(0, MAX_ROWS).map((row) => {
      const out: Row = { ...row }
      for (const c of cols) if (!(c.key in out) || out[c.key] === undefined) out[c.key] = c.type === 'checkbox' ? false : null
      return out
    })
    this.emitChange(clean)
  }

  private setCell(r: number, col: Column, next: unknown) {
    if (this.locked) return
    const rows = this.rows.map((row) => ({ ...row }))
    if (!rows[r]) return
    const prev = rows[r][col.key]
    if (prev === next || (col.type !== 'checkbox' && isBlank(prev) && isBlank(next))) return
    rows[r][col.key] = next
    this.emitRows(rows)
  }

  private addRow() {
    if (this.locked || !this.canAdd) return
    const rows = this.rows
    if (rows.length >= this.maxRows) { this.announce = `You can add up to ${this.maxRows} rows`; return }
    this.editing = null
    this.emitRows([...rows, blankRow(this.colDefs)])
    this.active = { r: rows.length, c: 0 }
    this.announce = `Row ${rows.length + 1} added`
    this.focusWanted = 'cell'
  }

  private deleteRow(r: number) {
    if (this.locked || !this.canDelete) return
    const rows = this.rows
    if (rows.length <= this.minRows) { this.announce = `At least ${this.minRows} row${this.minRows === 1 ? '' : 's'} required`; return }
    this.editing = null
    const next = rows.filter((_, i) => i !== r)
    this.emitRows(next)
    this.announce = `Row ${r + 1} deleted`
    if (next.length) {
      this.active = { r: Math.min(r, next.length - 1), c: this.active.c }
      this.focusWanted = 'cell'
    } else {
      this.active = { r: 0, c: 0 }
      this.focusWanted = 'add'
    }
  }

  // ── editing ──────────────────────────────────────────────────────────────

  private startEdit(r: number, c: number, initial?: string) {
    const col = this.colDefs[c]
    if (this.locked || !col || col.type === 'checkbox' || !this.rows[r]) return
    this.tokens += 1
    this.active = { r, c }
    this.editing = { r, c, draft: initial ?? editText(col, this.rows[r][col.key]), token: this.tokens }
    this.selectAll = initial === undefined
    this.focusWanted = 'editor'
  }

  private commit(move: 'down' | 'up' | 'next' | 'prev' | null, focus = true) {
    const e = this.editing
    if (!e) return
    const col = this.colDefs[e.c]
    this.editing = null
    if (col) this.setCell(e.r, col, parseCell(col, e.draft))
    if (move) this.move(e.r, e.c, move)
    if (focus) this.focusWanted = 'cell'
  }

  private cancel() {
    if (!this.editing) return
    this.editing = null
    this.focusWanted = 'cell'
  }

  /** Next / previous position in reading order, or null past the ends. */
  private step(r: number, c: number, dir: 'next' | 'prev'): Pos | null {
    const n = this.navCols
    const i = r * n + c + (dir === 'next' ? 1 : -1)
    if (i < 0 || i >= this.rows.length * n) return null
    return { r: Math.floor(i / n), c: i % n }
  }

  private move(r: number, c: number, how: 'down' | 'up' | 'next' | 'prev') {
    const last = this.rows.length - 1
    if (how === 'down') this.active = { r: Math.min(last, r + 1), c }
    else if (how === 'up') this.active = { r: Math.max(0, r - 1), c }
    else {
      const p = this.step(r, c, how)
      if (p) this.active = p
    }
  }

  private go(r: number, c: number) {
    const rows = this.rows.length
    if (!rows) return
    this.active = { r: Math.max(0, Math.min(rows - 1, r)), c: Math.max(0, Math.min(this.navCols - 1, c)) }
    this.focusWanted = 'cell'
  }

  private posOf(el: Element | null): Pos | null {
    const t = el?.closest?.('[data-r]') as HTMLElement | null
    if (!t) return null
    return { r: Number(t.dataset.r), c: Number(t.dataset.c) }
  }

  // ── keyboard ─────────────────────────────────────────────────────────────

  private onGridKey(e: KeyboardEvent) {
    if (this.locked) return
    if (this.editing) { this.onEditorKey(e); return }
    const pos = this.posOf(e.target as Element)
    if (!pos) return
    const { r, c } = pos
    const col = this.colDefs[c] as Column | undefined
    const lastRow = this.rows.length - 1
    const lastCol = this.navCols - 1
    const mod = e.ctrlKey || e.metaKey
    const handled = () => { e.preventDefault(); e.stopPropagation() }
    switch (e.key) {
      case 'ArrowUp': handled(); this.go(r - 1, c); return
      case 'ArrowDown': handled(); this.go(r + 1, c); return
      case 'ArrowLeft': handled(); this.go(r, c - 1); return
      case 'ArrowRight': handled(); this.go(r, c + 1); return
      case 'Home': handled(); this.go(mod ? 0 : r, 0); return
      case 'End': handled(); this.go(mod ? lastRow : r, lastCol); return
      case 'PageUp': handled(); this.go(r - 5, c); return
      case 'PageDown': handled(); this.go(r + 5, c); return
      case 'Tab': {
        const p = this.step(r, c, e.shiftKey ? 'prev' : 'next')
        if (!p) return // leave the grid
        handled()
        this.go(p.r, p.c)
        return
      }
      case 'Enter':
        if (mod) { handled(); this.addRow(); return }
        if (!col) return // the delete button: native click
        handled()
        if (col.type === 'checkbox') this.setCell(r, col, this.rows[r]?.[col.key] !== true)
        else this.startEdit(r, c)
        return
      case 'F2':
        if (col && col.type !== 'checkbox') { handled(); this.startEdit(r, c) }
        return
      case 'Delete':
      case 'Backspace':
        if (col && !mod) { handled(); this.setCell(r, col, col.type === 'checkbox' ? false : null) }
        return
      case ' ':
        if (col && col.type !== 'checkbox') { handled(); this.startEdit(r, c) }
        return // checkbox / button: native
      default:
        if (col && e.key.length === 1 && !mod && !e.altKey && (col.type === 'text' || col.type === 'number' || col.type === 'currency')) {
          handled()
          this.startEdit(r, c, e.key)
        }
    }
  }

  private onEditorKey(e: KeyboardEvent) {
    const ed = this.editing
    if (!ed) return
    const handled = () => { e.preventDefault(); e.stopPropagation() }
    if (e.key === 'Escape') { handled(); this.cancel(); return }
    if (e.key === 'Enter') {
      handled()
      if (e.ctrlKey || e.metaKey) { this.commit(null); this.addRow(); return }
      this.commit(e.shiftKey ? 'up' : 'down')
      return
    }
    if (e.key === 'Tab') {
      const p = this.step(ed.r, ed.c, e.shiftKey ? 'prev' : 'next')
      if (!p) { this.commit(null, false); return } // let focus leave the grid
      handled()
      this.commit(e.shiftKey ? 'prev' : 'next')
    }
  }

  private onEditorInput(e: Event) {
    if (!this.editing) return
    this.editing = { ...this.editing, draft: (e.target as HTMLInputElement | HTMLSelectElement).value }
  }

  private onEditorBlur(token: number) {
    // Focus left the editor (a click elsewhere): keep what was typed.
    if (this.editing && this.editing.token === token) this.commit(null, false)
  }

  private onCellClick(e: MouseEvent) {
    if (this.locked) return
    const target = e.target as HTMLElement
    if (target.closest('.editor, button, input[type="checkbox"]')) return
    const pos = this.posOf(target)
    if (!pos) return
    const col = this.colDefs[pos.c]
    if (!col) return
    if (this.editing) this.commit(null, false)
    this.active = pos
    if (col.type === 'checkbox') { this.focusWanted = 'cell'; return }
    this.startEdit(pos.r, pos.c)
  }

  private onFocusOut(e: FocusEvent) {
    if (!this.renderRoot.contains(e.relatedTarget as Node | null)) this.emitBlur()
  }

  protected updated(changed: PropertyValues): void {
    super.updated(changed)
    const want = this.focusWanted
    if (!want) return
    this.focusWanted = null
    const root = this.renderRoot
    if (want === 'add') { (root.querySelector('.add') as HTMLElement | null)?.focus(); return }
    if (want === 'editor') {
      const ed = root.querySelector('.editor') as HTMLInputElement | HTMLSelectElement | null
      if (!ed) return
      ed.focus()
      if (ed instanceof HTMLInputElement && ed.type === 'text') {
        if (this.selectAll) ed.select()
        else { const n = ed.value.length; try { ed.setSelectionRange(n, n) } catch { /* ignore */ } }
      }
      return
    }
    const { r, c } = this.active
    const target = root.querySelector(`[data-r="${r}"][data-c="${c}"]`) as HTMLElement | null
    target?.focus()
    target?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }

  // ── render ───────────────────────────────────────────────────────────────

  private totals(cols: Column[], rows: Row[]) {
    if (!this.boolProp('show_totals', false)) return null
    const sums = cols.map((c) => {
      if (c.type !== 'number' && c.type !== 'currency') return null
      return rows.reduce((s, row) => (typeof row[c.key] === 'number' && Number.isFinite(row[c.key] as number) ? s + (row[c.key] as number) : s), 0)
    })
    if (sums.every((s) => s === null)) return null
    return sums
  }

  private renderTotals(cols: Column[], rows: Row[], withActions: boolean) {
    const sums = this.totals(cols, rows)
    if (!sums) return nothing
    const firstNum = sums.findIndex((s) => s !== null)
    return html`<tfoot><tr>
      <th scope="row" class="rownum" aria-label="Total">Σ</th>
      ${cols.map((c, i) => {
        const s = sums[i]
        if (s !== null) return html`<td class="num"><span class="sr-only">Total ${c.label}: </span>${c.type === 'currency' ? formatMoney(s, this.locale, this.currencyCode) : formatNum(s, this.locale)}</td>`
        return html`<td>${i === 0 && firstNum > 0 ? 'Total' : ''}</td>`
      })}
      ${withActions ? html`<td></td>` : nothing}
    </tr></tfoot>`
  }

  private renderReadonly(cols: Column[], rows: Row[]) {
    const desc = this.utDescription
    return html`
      <div class="scroller">
        <table class="ro" aria-label=${this.utLabel || 'Table'} aria-describedby=${desc ? 'desc' : nothing}>
          <thead><tr><th class="rownum" scope="col"><span class="sr-only">Row</span>#</th>
            ${cols.map((c) => html`<th scope="col" class=${c.type === 'number' || c.type === 'currency' ? 'num' : ''} style=${c.width ? `min-width:${c.width}px` : ''}>${c.label}</th>`)}
          </tr></thead>
          <tbody>
            ${rows.length ? rows.map((row, r) => html`<tr><th scope="row" class="rownum">${r + 1}</th>
              ${cols.map((c) => html`<td class=${c.type === 'number' || c.type === 'currency' ? 'num' : ''}>${formatCell(c, row[c.key], this.locale, this.currencyCode)}</td>`)}
            </tr>`) : html`<tr><td class="empty" colspan=${cols.length + 1}>No rows</td></tr>`}
          </tbody>
          ${this.renderTotals(cols, rows, false)}
        </table>
      </div>
      ${desc ? html`<span id="desc" class="sr-only">${desc}</span>` : nothing}
    `
  }

  private renderCell(col: Column, c: number, row: Row, r: number, tabbable: boolean, showErrors: boolean) {
    const v = row[col.key]
    const problem = showErrors ? cellError(col, v) : null
    const errId = `e-${r}-${c}`
    const num = col.type === 'number' || col.type === 'currency'
    const ed = this.editing
    const name = `${col.label}, row ${r + 1}`
    if (col.type === 'checkbox') {
      return html`<td class=${problem ? 'bad' : ''}>
        <div class="cell check">
          <input type="checkbox" data-r=${r} data-c=${c} tabindex=${tabbable ? '0' : '-1'} .checked=${v === true}
            aria-label=${name} aria-invalid=${problem ? 'true' : 'false'} aria-describedby=${problem ? errId : nothing}
            aria-required=${col.required ? 'true' : nothing}
            @focus=${() => { this.active = { r, c } }}
            @change=${(e: Event) => this.setCell(r, col, (e.target as HTMLInputElement).checked)} />
        </div>
        ${problem ? html`<div class="err" id=${errId} style="padding:0 6px 6px">${problem}</div>` : nothing}
      </td>`
    }
    if (ed && ed.r === r && ed.c === c) {
      const token = ed.token
      let editor
      if (col.type === 'select') {
        editor = html`<select class="editor" aria-label=${name} @change=${this.onEditorInput} @blur=${() => this.onEditorBlur(token)}>
          <option value="" ?selected=${ed.draft === ''}>—</option>
          ${col.options.map((o) => html`<option value=${o} ?selected=${o === ed.draft}>${o}</option>`)}
          ${ed.draft && !col.options.includes(ed.draft) ? html`<option value=${ed.draft} selected>${ed.draft}</option>` : nothing}
        </select>`
      } else if (col.type === 'date') {
        editor = html`<input class="editor" type="date" aria-label=${name} .value=${ed.draft} @input=${this.onEditorInput} @change=${this.onEditorInput} @blur=${() => this.onEditorBlur(token)} />`
      } else {
        editor = html`<input class="editor ${num ? 'num' : ''}" type="text" inputmode=${num ? 'decimal' : 'text'} autocomplete="off"
          aria-label=${name} .value=${ed.draft} maxlength="2000" @input=${this.onEditorInput} @blur=${() => this.onEditorBlur(token)} />`
      }
      return html`<td class="editing">${editor}</td>`
    }
    const text = formatCell(col, v, this.locale, this.currencyCode)
    return html`<td class=${problem ? 'bad' : ''} data-r=${r} data-c=${c} tabindex=${tabbable ? '0' : '-1'}
        aria-invalid=${problem ? 'true' : nothing} aria-describedby=${problem ? errId : nothing} aria-required=${col.required ? 'true' : nothing}
        @focus=${() => { this.active = { r, c } }}>
      <div class="cell ${num ? 'num' : ''}"><span class="val">${text}</span>${problem ? html`<span class="err" id=${errId}>${problem}</span>` : nothing}</div>
    </td>`
  }

  render() {
    const cols = this.colDefs
    const rows = this.rows
    if (this.locked) return this.renderReadonly(cols, rows)
    const desc = this.utDescription
    const withActions = this.canDelete
    const navCols = this.navCols
    const act = { r: Math.min(this.active.r, Math.max(0, rows.length - 1)), c: Math.min(this.active.c, navCols - 1) }
    const canRemove = rows.length > this.minRows
    const atMax = rows.length >= this.maxRows
    const showAllErrors = this.invalid
    return html`
      <div @focusout=${this.onFocusOut}>
        <div class="scroller">
          <table role="grid" aria-label=${this.utLabel || 'Table'} aria-describedby=${['hint', desc ? 'desc' : ''].filter(Boolean).join(' ')}
            aria-rowcount=${rows.length + 1} aria-colcount=${cols.length + 1 + (withActions ? 1 : 0)}
            @keydown=${this.onGridKey} @click=${this.onCellClick}>
            <thead><tr>
              <th class="rownum" scope="col"><span class="sr-only">Row</span><span aria-hidden="true">#</span></th>
              ${cols.map((c) => html`<th scope="col" class=${c.type === 'number' || c.type === 'currency' ? 'num' : ''} style=${c.width ? `min-width:${c.width}px` : ''}>
                ${c.label}${c.required ? html`<span class="req" aria-hidden="true">*</span><span class="sr-only"> (required)</span>` : nothing}</th>`)}
              ${withActions ? html`<th scope="col"><span class="sr-only">Actions</span></th>` : nothing}
            </tr></thead>
            <tbody>
              ${rows.length ? rows.map((row, r) => {
                const showErrors = showAllErrors || !rowIsBlank(row, cols)
                return html`<tr>
                  <th scope="row" class="rownum">${r + 1}</th>
                  ${cols.map((col, c) => this.renderCell(col, c, row, r, act.r === r && act.c === c, showErrors))}
                  ${withActions ? html`<td class="actions">
                    <button type="button" class="icon-btn" data-r=${r} data-c=${cols.length} tabindex=${act.r === r && act.c === cols.length ? '0' : '-1'}
                      aria-label=${`Delete row ${r + 1}`} title=${canRemove ? `Delete row ${r + 1}` : `At least ${this.minRows} rows required`}
                      aria-disabled=${canRemove ? 'false' : 'true'}
                      @focus=${() => { this.active = { r, c: cols.length } }}
                      @click=${() => { if (canRemove) this.deleteRow(r) }}><svg viewBox="0 0 24 24" aria-hidden="true">${TRASH}</svg></button>
                  </td>` : nothing}
                </tr>`
              }) : html`<tr><td class="empty" colspan=${cols.length + 1 + (withActions ? 1 : 0)}>No rows yet${this.canAdd ? ': use Add row to start.' : '.'}</td></tr>`}
            </tbody>
            ${this.renderTotals(cols, rows, withActions)}
          </table>
        </div>
        <div class="bar">
          ${this.canAdd ? html`<button type="button" class="add" aria-disabled=${atMax ? 'true' : 'false'} aria-keyshortcuts="Control+Enter"
              @click=${() => this.addRow()}><svg viewBox="0 0 24 24" aria-hidden="true">${PLUS}</svg>${atMax ? `Maximum of ${this.maxRows} rows` : 'Add row'}</button>` : nothing}
          <span class="hint" aria-hidden="true">Enter to edit · arrows to move${this.canAdd ? ' · Ctrl+Enter adds a row' : ''}</span>
        </div>
      </div>
      <span id="hint" class="sr-only">Arrow keys move between cells. Enter, F2 or typing edits a cell; Enter saves and moves down, Escape cancels. Delete clears a cell.${this.canAdd ? ' Control+Enter adds a row.' : ''}</span>
      ${desc ? html`<span id="desc" class="sr-only">${desc}</span>` : nothing}
      <span class="sr-only" aria-live="polite">${this.announce}</span>
    `
  }
}

define('ut-table', UtTable)
