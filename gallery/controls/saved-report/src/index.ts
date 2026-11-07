/**
 * <ut-saved-report> — shows a saved report (chosen by the designer with the
 * `report_id` prop, run by the server with the permissions of the person
 * filling in the form) as a sortable, paginated table or a chart. With
 * `selectable`, picking a row makes that row object the field's value.
 */
import { UtControl, css, define, html, nothing, plainText, svg, uid, type PropertyValues, type ReportResult } from '../../shared/base'
import { Chart, buildConfig, fmt, readTheme, toNumber, type ChartKind, type Series } from './chart-kit'

type Row = Record<string, unknown>
type Column = ReportResult['columns'][number]

const NUMERIC_TYPE = /num|int|float|dec|double|real|money|currency|percent/i
const DATE_TYPE = /date|time|timestamp/i
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/
const CHART_VIS: Record<string, { kind: ChartKind; stacked?: boolean }> = {
  bar: { kind: 'bar' }, 'stacked-bar': { kind: 'bar', stacked: true }, 'horizontal-bar': { kind: 'horizontal-bar' },
  line: { kind: 'line' }, area: { kind: 'area' }, pie: { kind: 'pie' }, doughnut: { kind: 'doughnut' },
}
const NO_REPORT = 'Choose a report in the form designer (the Saved report property).'

function isRecord(v: unknown): v is Row {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export class UtSavedReport extends UtControl {
  static properties = {
    result: { state: true },
    loading: { state: true },
    loadError: { state: true },
    sortKey: { state: true },
    sortDir: { state: true },
    pageIndex: { state: true },
    viewMode: { state: true },
    status: { state: true },
  }

  static styles = [UtControl.styles, css`
    .wrap { display: flex; flex-direction: column; gap: 10px; }
    .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px 12px; flex-wrap: wrap; }
    .titles { min-width: 0; flex: 1 1 200px; }
    .title { margin: 0; font-weight: 600; font-size: 1.05em; }
    .sub { margin: 2px 0 0; color: var(--_muted); font-size: 0.93em; }
    .tools { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
    .btn { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      min-height: 32px; min-width: 32px; padding: 4px 10px; border-radius: var(--_radius); border: 1px solid var(--_border);
      background: var(--_input-bg); color: var(--_text); font-size: 0.93em; }
    .btn:hover:not([disabled]) { background: var(--_surface); }
    .btn[disabled] { opacity: 0.5; cursor: default; }
    .btn:focus-visible, .sort:focus-visible, .pick:focus-visible { outline: 2px solid var(--_focus); outline-offset: 2px; }
    .btn svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .seg { display: inline-flex; border: 1px solid var(--_border); border-radius: var(--_radius); overflow: hidden; }
    .seg .btn { border: none; border-radius: 0; }
    .seg .btn[aria-pressed='true'] { background: var(--_primary-light); color: var(--_text); font-weight: 600; }
    .seg .btn + .btn { border-left: 1px solid var(--_border); }
    .spin { animation: spin 0.9s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .table-wrap { overflow-x: auto; max-width: 100%; border: 1px solid var(--_border); border-radius: var(--_radius); background: var(--_card); }
    table { border-collapse: collapse; width: 100%; font-size: 0.93em; }
    caption { text-align: left; }
    th, td { padding: 7px 10px; text-align: left; border-top: 1px solid var(--_border); white-space: nowrap; max-width: 320px; overflow: hidden; text-overflow: ellipsis; }
    thead th { background: var(--_surface); border-top: none; font-weight: 600; padding: 0; }
    thead th.plain { padding: 7px 10px; }
    .sort { all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; gap: 4px; width: 100%; min-height: 34px; padding: 6px 10px; }
    th.num .sort { justify-content: flex-end; }
    .arrow { width: 12px; height: 12px; opacity: 0.35; flex: none; fill: none; stroke: currentColor; stroke-width: 2.4; }
    th[aria-sort] .arrow.on { opacity: 1; }
    td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
    tbody tr:hover { background: var(--_surface); }
    tbody tr.sel { background: var(--_primary-light); }
    tbody tr.clickable { cursor: pointer; }
    td.pick-cell { width: 44px; padding: 2px 6px; }
    .pick { all: unset; box-sizing: border-box; cursor: pointer; width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; }
    .pick .dot { width: 18px; height: 18px; border-radius: 50%; border: 2px solid var(--_muted); display: inline-flex; align-items: center; justify-content: center; }
    .pick[aria-pressed='true'] .dot { border-color: var(--_primary); background: var(--_primary); }
    .pick[aria-pressed='true'] .dot::after { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--_on-primary); }
    .pager { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; color: var(--_muted); font-size: 0.93em; }
    .pager .btns { display: flex; gap: 6px; }
    .note { color: var(--_muted); font-size: 0.86em; }
    .state { padding: 18px 16px; border: 1px dashed var(--_border); border-radius: var(--_radius); background: var(--_surface); color: var(--_muted); text-align: center; }
    .state.error { color: var(--_error); border: 1px solid var(--_error); background: transparent; text-align: left; }
    .skel { display: grid; gap: 8px; padding: 12px; border: 1px solid var(--_border); border-radius: var(--_radius); }
    .skel span { height: 14px; border-radius: 4px; background: var(--_surface); animation: pulse 1.2s ease-in-out infinite; }
    @keyframes pulse { 50% { opacity: 0.45; } }
    .plot { position: relative; width: 100%; }
    .plot canvas { display: block; }
    :host([disabled]) .wrap { opacity: 0.6; }
  `]

  declare result: ReportResult | null
  declare loading: boolean
  declare loadError: string | null
  declare sortKey: string | null
  declare sortDir: 'ascending' | 'descending'
  declare pageIndex: number
  declare viewMode: 'table' | 'chart' | null
  declare status: string

  private chart: Chart | null = null
  private chartKey = ''
  private loadKey = ''
  private loadSeq = 0
  private ids = { desc: uid('rep-desc'), cap: uid('rep-cap') }

  constructor() {
    super()
    this.result = null
    this.loading = false
    this.loadError = null
    this.sortKey = null
    this.sortDir = 'ascending'
    this.pageIndex = 0
    this.viewMode = null
    this.status = ''
  }

  get reportId(): string { return this.textProp('report_id', '') }
  get maxRows(): number { return Math.round(this.numberProp('max_rows', 100, 1, 1000)) }
  get pageSize(): number { return Math.round(this.numberProp('page_size', 10, 1, 200)) }
  get canSelect(): boolean { return this.boolProp('selectable', false) && !this.locked }

  // ── loading ──────────────────────────────────────────────────────────────
  private ask(kind: 'report', payload: unknown): Promise<unknown> {
    return (this.request as unknown as (k: string, p: unknown) => Promise<unknown>).call(this, kind, payload)
  }

  async refresh() {
    const seq = ++this.loadSeq
    if (!this.reportId) { this.result = null; this.loadError = NO_REPORT; this.loading = false; return }
    this.loading = true
    this.loadError = null
    this.status = 'Loading report…'
    try {
      const res = await this.ask('report', { limit: this.maxRows }) as ReportResult
      if (seq !== this.loadSeq) return
      if (!res || !Array.isArray(res.rows) || !Array.isArray(res.columns)) throw new Error('The report returned no data.')
      this.result = res
      this.pageIndex = 0
      this.status = `Report loaded: ${res.rows.length} ${res.rows.length === 1 ? 'row' : 'rows'}`
    } catch (e) {
      if (seq !== this.loadSeq) return
      const msg = e instanceof Error ? e.message : String(e ?? '')
      this.result = null
      this.loadError = /report_id|no report|not set|not configured|choose a report|no fixture/i.test(msg) || !msg ? NO_REPORT : msg
      this.status = ''
    } finally {
      if (seq === this.loadSeq) this.loading = false
    }
  }

  protected willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed)
    const key = `${this.reportId}|${this.maxRows}`
    if (key !== this.loadKey) {
      this.loadKey = key
      void this.refresh()
    }
  }

  // ── data helpers ─────────────────────────────────────────────────────────
  private isNumeric(col: Column, rows: Row[]): boolean {
    if (NUMERIC_TYPE.test(col.type)) return true
    if (DATE_TYPE.test(col.type)) return false
    const vals = rows.map((r) => r[col.key]).filter((v) => v !== null && v !== undefined)
    return vals.length > 0 && vals.every((v) => typeof v === 'number')
  }

  private formatCell(v: unknown, col: Column): string {
    if (v === null || v === undefined || v === '') return '—'
    if (typeof v === 'boolean') return v ? 'Yes' : 'No'
    if (typeof v === 'number') return fmt(v, this.locale)
    if (typeof v === 'string' && (DATE_TYPE.test(col.type) || ISO_DATE.test(v)) && ISO_DATE.test(v)) {
      const d = new Date(v.length === 10 ? `${v}T00:00:00` : v)
      if (!Number.isNaN(d.getTime())) {
        try {
          return v.length === 10
            ? new Intl.DateTimeFormat(this.locale || 'en', { dateStyle: 'medium' }).format(d)
            : new Intl.DateTimeFormat(this.locale || 'en', { dateStyle: 'medium', timeStyle: 'short' }).format(d)
        } catch { return v }
      }
    }
    if (typeof v === 'string' && NUMERIC_TYPE.test(col.type) && toNumber(v) !== null) return fmt(toNumber(v)!, this.locale)
    return plainText(v)
  }

  private sortedRows(): Row[] {
    const rows = this.result?.rows ?? []
    const key = this.sortKey
    if (!key) return rows
    const dir = this.sortDir === 'ascending' ? 1 : -1
    const collator = new Intl.Collator(this.locale || 'en', { numeric: true, sensitivity: 'base' })
    return [...rows].sort((a, b) => {
      const x = a[key]
      const y = b[key]
      const xe = x === null || x === undefined || x === ''
      const ye = y === null || y === undefined || y === ''
      if (xe || ye) return xe && ye ? 0 : xe ? 1 : -1
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir
      return collator.compare(plainText(x), plainText(y)) * dir
    })
  }

  private sortBy(key: string, label: string) {
    if (this.sortKey === key) this.sortDir = this.sortDir === 'ascending' ? 'descending' : 'ascending'
    else { this.sortKey = key; this.sortDir = 'ascending' }
    this.pageIndex = 0
    this.status = `Sorted by ${label}, ${this.sortDir}`
  }

  private goPage(delta: number) {
    const total = this.result?.rows.length ?? 0
    const pages = Math.max(1, Math.ceil(total / this.pageSize))
    this.pageIndex = Math.min(pages - 1, Math.max(0, this.pageIndex + delta))
    this.status = this.rangeText()
  }

  private rangeText(): string {
    const total = this.result?.rows.length ?? 0
    const start = this.pageIndex * this.pageSize
    const end = Math.min(total, start + this.pageSize)
    return `Rows ${fmt(start + 1, this.locale)}-${fmt(end, this.locale)} of ${fmt(total, this.locale)}`
  }

  get effectiveView(): 'table' | 'chart' {
    if (this.viewMode) return this.viewMode
    const v = this.textProp('view', 'auto')
    if (v === 'table' || v === 'chart') return v
    return CHART_VIS[this.result?.report?.visualization ?? ''] ? 'chart' : 'table'
  }

  private chartSeries(): { series: Series; kind: ChartKind; stacked: boolean } | null {
    const r = this.result
    if (!r || !r.rows.length) return null
    const numeric = r.columns.filter((c) => this.isNumeric(c, r.rows))
    const labelCol = r.columns.find((c) => !numeric.includes(c)) ?? r.columns[0]
    const vis = CHART_VIS[r.report?.visualization ?? ''] ?? { kind: 'bar' as ChartKind }
    const valueCols = numeric.filter((c) => c !== labelCol)
    if (!labelCol || !valueCols.length) return null
    const used = vis.kind === 'pie' || vis.kind === 'doughnut' ? valueCols.slice(0, 1) : valueCols.slice(0, 8)
    return {
      kind: vis.kind,
      stacked: Boolean(vis.stacked),
      series: {
        labels: r.rows.map((row) => this.formatCell(row[labelCol.key], labelCol)),
        datasets: used.map((c) => ({ label: c.label || c.key, data: r.rows.map((row) => toNumber(row[c.key]) ?? 0) })),
      },
    }
  }

  // ── selection ────────────────────────────────────────────────────────────
  private isSelected(row: Row): boolean {
    const v = this.value
    if (!isRecord(v)) return false
    try { return JSON.stringify(v) === JSON.stringify(row) } catch { return false }
  }

  private pick(row: Row) {
    if (!this.canSelect) return
    if (this.isSelected(row)) { this.emitChange(null); this.status = 'Row unselected' }
    else { this.emitChange(row); this.status = 'Row selected' }
  }

  validate(): string | null {
    const v = this.value
    if (v === null || v === undefined) return null
    return isRecord(v) ? null : 'Choose a row of the report'
  }

  // ── chart lifecycle ──────────────────────────────────────────────────────
  protected updated(changed: PropertyValues): void {
    super.updated(changed)
    const canvas = this.renderRoot.querySelector('canvas')
    const spec = this.effectiveView === 'chart' ? this.chartSeries() : null
    if (!canvas || !spec) {
      if (this.chart) { this.chart.destroy(); this.chart = null; this.chartKey = '' }
      return
    }
    const dark = this.dataset.mode === 'dark' || this.theme?.mode === 'dark'
    const theme = readTheme(this, dark)
    const showLegend = spec.kind === 'pie' || spec.kind === 'doughnut' || spec.series.datasets.length > 1
    const key = JSON.stringify([spec, theme, this.locale])
    if (this.chart && this.chart.canvas === canvas && key === this.chartKey) return
    this.chart?.destroy()
    this.chartKey = key
    this.chart = new Chart(canvas, buildConfig({ kind: spec.kind, series: spec.series, theme, colours: [], stacked: spec.stacked, showLegend, locale: this.locale }))
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    this.chart?.destroy()
    this.chart = null
    this.chartKey = ''
  }

  connectedCallback(): void {
    super.connectedCallback()
    if (this.hasUpdated) { this.chartKey = ''; this.requestUpdate() }
  }

  // ── render ───────────────────────────────────────────────────────────────
  private icon(name: 'refresh' | 'table' | 'chart' | 'prev' | 'next') {
    const paths = {
      refresh: svg`<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>`,
      table: svg`<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/>`,
      chart: svg`<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>`,
      prev: svg`<path d="M15 18l-6-6 6-6"/>`,
      next: svg`<path d="M9 18l6-6-6-6"/>`,
    }
    return html`<svg viewBox="0 0 24 24" aria-hidden="true" class=${name === 'refresh' && this.loading ? 'spin' : ''}>${paths[name]}</svg>`
  }

  private renderTable(r: ReportResult, name: string) {
    const rows = this.sortedRows()
    const size = this.pageSize
    const pages = Math.max(1, Math.ceil(rows.length / size))
    const pageIndex = Math.min(this.pageIndex, pages - 1)
    const slice = rows.slice(pageIndex * size, pageIndex * size + size)
    const numeric = new Set(r.columns.filter((c) => this.isNumeric(c, r.rows)).map((c) => c.key))
    const select = this.boolProp('selectable', false)
    const first = r.columns[0]
    const arrow = (on: boolean, dir: string) => html`<svg class="arrow ${on ? 'on' : ''}" viewBox="0 0 24 24" aria-hidden="true">${!on ? svg`<path d="M8 9l4-4 4 4M8 15l4 4 4-4"/>` : dir === 'ascending' ? svg`<path d="M6 15l6-6 6 6"/>` : svg`<path d="M6 9l6 6 6-6"/>`}</svg>`
    return html`
      <div class="table-wrap" tabindex="0" role="region" aria-labelledby=${this.ids.cap} aria-describedby=${this.utDescription ? this.ids.desc : nothing}>
        <table>
          <caption id=${this.ids.cap} class="sr-only">${name}${this.sortKey ? `, sorted by ${r.columns.find((c) => c.key === this.sortKey)?.label ?? this.sortKey} ${this.sortDir}` : ''}</caption>
          <thead><tr>
            ${select ? html`<th scope="col" class="plain"><span class="sr-only">Selected</span></th>` : nothing}
            ${r.columns.map((c) => {
              const on = this.sortKey === c.key
              return html`<th scope="col" class=${numeric.has(c.key) ? 'num' : ''} aria-sort=${on ? this.sortDir : nothing}>
                <button type="button" class="sort" @click=${() => this.sortBy(c.key, c.label || c.key)}>${c.label || c.key}${arrow(on, this.sortDir)}</button></th>`
            })}
          </tr></thead>
          <tbody>
            ${slice.map((row) => {
              const sel = this.isSelected(row)
              const rowName = first ? this.formatCell(row[first.key], first) : 'row'
              return html`<tr class="${sel ? 'sel' : ''} ${this.canSelect ? 'clickable' : ''}" @click=${(e: Event) => { if (!(e.target as HTMLElement).closest('button')) this.pick(row) }}>
                ${select ? html`<td class="pick-cell">${this.locked
                  ? html`${sel ? html`<span class="pick" aria-hidden="true"><span class="dot" style="border-color:var(--_primary);background:var(--_primary)"></span></span><span class="sr-only">Selected</span>` : nothing}`
                  : html`<button type="button" class="pick" aria-pressed=${sel ? 'true' : 'false'} aria-label=${`Select ${rowName}`} @click=${() => this.pick(row)}><span class="dot"></span></button>`}</td>` : nothing}
                ${r.columns.map((c) => html`<td class=${numeric.has(c.key) ? 'num' : ''}>${this.formatCell(row[c.key], c)}</td>`)}
              </tr>`
            })}
          </tbody>
        </table>
      </div>
      ${rows.length > size ? html`<div class="pager">
        <span>${this.rangeText()}</span>
        <span class="btns">
          <button type="button" class="btn" ?disabled=${pageIndex === 0} @click=${() => this.goPage(-1)}>${this.icon('prev')}Previous</button>
          <button type="button" class="btn" ?disabled=${pageIndex >= pages - 1} @click=${() => this.goPage(1)}>Next${this.icon('next')}</button>
        </span>
      </div>` : nothing}`
  }

  private renderChart(name: string) {
    const spec = this.chartSeries()
    if (!spec) return html`<div class="state">This report has no numeric column to chart. Switch to the table.</div>`
    const height = Math.round(this.numberProp('height', 280, 120, 1000))
    const s = spec.series
    const summary = s.labels.slice(0, 20).map((l, i) => `${l} ${s.datasets.map((d) => fmt(d.data[i] ?? 0, this.locale)).join(' / ')}`).join(', ')
    return html`<div class="plot" style=${`height:${height}px`} role="img" aria-describedby=${this.utDescription ? this.ids.desc : nothing}
        aria-label=${`${spec.kind.replace('-', ' ')} chart of ${name}: ${summary}${s.labels.length > 20 ? ', …' : ''}. Switch to Table for every value.`}>
      <canvas aria-hidden="true"></canvas></div>`
  }

  render() {
    const r = this.result
    const name = r?.report?.name || this.utLabel || 'Report'
    const showTitle = this.boolProp('show_title', true)
    const view = this.effectiveView
    const hasRows = Boolean(r && r.rows.length)
    return html`
      <div class="wrap" aria-busy=${this.loading ? 'true' : 'false'}
        @focusout=${(e: FocusEvent) => { if (!this.renderRoot.contains(e.relatedTarget as Node)) this.emitBlur() }}>
        <div class="head">
          <div class="titles">
            ${showTitle && r ? html`<p class="title">${r.report.name}</p>${r.report.description ? html`<p class="sub">${r.report.description}</p>` : nothing}` : nothing}
          </div>
          <div class="tools">
            ${hasRows ? html`<div class="seg" role="group" aria-label="View">
              <button type="button" class="btn" aria-pressed=${view === 'table' ? 'true' : 'false'} @click=${() => { this.viewMode = 'table' }}>${this.icon('table')}Table</button>
              <button type="button" class="btn" aria-pressed=${view === 'chart' ? 'true' : 'false'} @click=${() => { this.viewMode = 'chart' }}>${this.icon('chart')}Chart</button>
            </div>` : nothing}
            ${this.reportId ? html`<button type="button" class="btn" ?disabled=${this.loading} @click=${() => this.refresh()} aria-label="Refresh report">${this.icon('refresh')}<span aria-hidden="true">Refresh</span></button>` : nothing}
          </div>
        </div>
        ${this.loadError ? html`<div class="state ${this.loadError === NO_REPORT ? '' : 'error'}" role=${this.loadError === NO_REPORT ? 'status' : 'alert'}>${this.loadError}</div>`
          : this.loading && !r ? html`<div class="skel" aria-hidden="true">${[90, 70, 80, 60].map((w) => html`<span style=${`width:${w}%`}></span>`)}</div><span class="sr-only">Loading report…</span>`
          : !r ? nothing
          : !r.rows.length ? html`<div class="state" role="status">This report has no rows${this.reportId ? ' for you right now' : ''}.</div>`
          : view === 'chart' ? this.renderChart(name) : this.renderTable(r, name)}
        ${r && r.truncated ? html`<div class="note">Showing first ${fmt(r.rows.length, this.locale)} of ${fmt(r.total, this.locale)} rows. Open the report in Reports for everything.</div>` : nothing}
        ${this.canSelect && hasRows && view === 'table' && !this.value ? html`<div class="note">Select a row to use it in this form.</div>` : nothing}
        <div class="sr-only" aria-live="polite">${this.status}</div>
        ${this.utDescription ? html`<span id=${this.ids.desc} class="sr-only">${this.utDescription}</span>` : nothing}
      </div>
    `
  }
}

define('ut-saved-report', UtSavedReport)
