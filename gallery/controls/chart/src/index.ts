/**
 * <ut-chart> — a bar, line, area, pie or doughnut chart (Chart.js) of static
 * data, a mapped field (e.g. an editable table's rows), lookup results or a
 * saved report. The canvas is hidden from assistive technology; instead the
 * plot is one keyboard stop where the arrow keys walk the points (announced
 * as "Mar: 18 (Sales)") and a "Show data table" toggle renders the numbers
 * as a real table. When `selectable`, clicking a point or pressing Enter
 * makes it the value: { label, value, series }.
 */
import { UtControl, css, define, html, nothing, plainText, uid, type LookupResult, type PropertyValues, type ReportResult } from '../../shared/base'
import {
  CHART_KINDS, Chart, buildConfig, fmt, isEmpty, readTheme, rowsToSeries, toNumber,
  type Aggregate, type ChartKind, type Series,
} from './chart-kit'

type Row = Record<string, unknown>
interface Point { d: number; i: number }
interface Selected { label: string; value: number; series: string | null }

const NUMERIC_TYPE = /num|int|float|dec|double|real|money|currency|percent/i

function isRecord(v: unknown): v is Row {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function parseJson(v: unknown): unknown {
  if (typeof v !== 'string') return v
  try { return JSON.parse(v) } catch { return null }
}

export class UtChart extends UtControl {
  static properties = {
    series: { state: true },
    loading: { state: true },
    loadError: { state: true },
    active: { state: true },
    showTable: { state: true },
    announcement: { state: true },
  }

  static styles = [UtControl.styles, css`
    .wrap { display: flex; flex-direction: column; gap: 8px; }
    .bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; min-height: 32px; }
    .title { font-weight: 600; font-size: 1.05em; margin: 0; color: var(--_text); }
    .toggle { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; min-height: 32px;
      padding: 4px 10px; border-radius: var(--_radius); border: 1px solid var(--_border); background: var(--_input-bg); color: var(--_text); font-size: 0.93em; }
    .toggle:hover { background: var(--_surface); }
    .toggle:focus-visible { outline: 2px solid var(--_focus); outline-offset: 2px; }
    .toggle svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; }
    .plot { position: relative; width: 100%; border-radius: var(--_radius); }
    .plot:focus-visible { outline: 2px solid var(--_focus); outline-offset: 3px; }
    .plot canvas { display: block; }
    .state { display: flex; align-items: center; justify-content: center; text-align: center; padding: 16px; border: 1px dashed var(--_border);
      border-radius: var(--_radius); color: var(--_muted); background: var(--_surface); }
    .state.error { color: var(--_error); border-color: var(--_error); border-style: solid; }
    .skeleton { position: absolute; inset: 0; display: flex; align-items: flex-end; gap: 6%; padding: 16px 8%; }
    .skeleton span { flex: 1; background: var(--_surface); border-radius: 4px 4px 0 0; animation: pulse 1.2s ease-in-out infinite; }
    @keyframes pulse { 50% { opacity: 0.45; } }
    .hint { font-size: 0.86em; color: var(--_muted); }
    .selected { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 0.93em; }
    .chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; background: var(--_primary-light);
      color: var(--_text); border: 1px solid var(--_primary); }
    .link { all: unset; cursor: pointer; color: var(--_primary-text, var(--_primary)); text-decoration: underline; min-height: 24px; display: inline-flex; align-items: center; padding: 0 4px; border-radius: 4px; }
    .link:focus-visible { outline: 2px solid var(--_focus); }
    .table-wrap { overflow-x: auto; max-width: 100%; border: 1px solid var(--_border); border-radius: var(--_radius); }
    table { border-collapse: collapse; width: 100%; font-size: 0.93em; }
    caption { text-align: left; padding: 8px 10px; color: var(--_muted); caption-side: top; }
    th, td { padding: 6px 10px; border-top: 1px solid var(--_border); text-align: left; white-space: nowrap; }
    thead th { background: var(--_surface); font-weight: 600; border-top: none; }
    td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
    :host([disabled]) .wrap { opacity: 0.6; }
  `]

  declare series: Series | null
  declare loading: boolean
  declare loadError: string | null
  declare active: Point | null
  declare showTable: boolean
  declare announcement: string

  private chart: Chart | null = null
  private chartKey = ''
  private loadKey = ''
  private loadSeq = 0
  private ids = { hint: uid('chart-hint'), desc: uid('chart-desc'), title: uid('chart-title') }

  constructor() {
    super()
    this.series = null
    this.loading = false
    this.loadError = null
    this.active = null
    this.showTable = false
    this.announcement = ''
  }

  // ── props ────────────────────────────────────────────────────────────────
  get kind(): ChartKind {
    const k = this.textProp('chart_type', 'bar') as ChartKind
    return CHART_KINDS.includes(k) ? k : 'bar'
  }
  get radial(): boolean { return this.kind === 'pie' || this.kind === 'doughnut' }
  get sourceName(): string { return this.textProp('source', 'static') }
  get aggregateMode(): Aggregate {
    const a = this.textProp('aggregate', 'none')
    return (['none', 'sum', 'count', 'average'] as const).includes(a as Aggregate) ? a as Aggregate : 'none'
  }
  get canSelect(): boolean { return this.boolProp('selectable', false) && !this.locked }
  private listProp(name: string): string[] {
    const v = this.prop<unknown>(name, [])
    return Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean) : typeof v === 'string' ? v.split(/[\n,]/).map((x) => x.trim()).filter(Boolean) : []
  }

  // ── data ─────────────────────────────────────────────────────────────────
  /** Rows → series with label / value / series fields (defaults: first text, first number). */
  private fromRows(rows: Row[], opts: { labelDefault?: string; valueDefault?: string; numericKeys?: string[]; labels?: Record<string, string>; fallback?: boolean } = {}): Series {
    const sample = rows.find(isRecord) ?? {}
    const keys = Object.keys(sample).filter((k) => !k.startsWith('__'))
    const labelField = this.textProp('label_field', '') || opts.labelDefault || (keys.includes('label') ? 'label' : keys.find((k) => typeof sample[k] === 'string') ?? keys[0] ?? 'label')
    const numeric = opts.numericKeys ?? keys.filter((k) => k !== labelField && toNumber(sample[k]) !== null && typeof sample[k] !== 'boolean')
    const valueField = this.textProp('value_field', '') || opts.valueDefault || (keys.includes('value') ? 'value' : numeric[0] ?? 'value')
    const seriesFields = this.listProp('series_fields')
    const fields = (seriesFields.length ? seriesFields : [valueField]).map((key) => ({
      key,
      label: opts.labels?.[key] ?? (key === 'value' ? 'Value' : key),
      get: (r: Row) => (r[key] !== undefined && r[key] !== null ? r[key] : opts.fallback ? r.__value : undefined),
    }))
    const labelOf = (r: Row) => {
      const v = r[labelField] ?? (opts.fallback ? r.__label : undefined)
      return v === undefined || v === null || v === '' ? '—' : plainText(v)
    }
    return rowsToSeries(rows.filter(isRecord), labelOf, fields, this.aggregateMode)
  }

  private staticSeries(): Series | null {
    const data = parseJson(this.prop<unknown>('data', null))
    if (Array.isArray(data)) return this.fromRows(data as Row[], { labelDefault: 'label', valueDefault: 'value' })
    if (isRecord(data) && Array.isArray(data.labels) && Array.isArray(data.datasets)) {
      return {
        labels: data.labels.map(plainText),
        datasets: (data.datasets as unknown[]).filter(isRecord).map((d, i) => ({
          label: plainText(d.label) || `Series ${i + 1}`,
          data: Array.isArray(d.data) ? d.data.map((n) => toNumber(n) ?? 0) : [],
        })),
      }
    }
    return null
  }

  private contextSeries(): Series | null {
    const raw = parseJson(this.contextValue('data'))
    if (Array.isArray(raw)) return this.fromRows(raw as Row[])
    if (isRecord(raw) && Array.isArray(raw.rows)) return this.fromRows(raw.rows as Row[])
    return null
  }

  /** The series to draw: computed for static / context, loaded for lookup / report. */
  get currentSeries(): Series | null {
    const s = this.sourceName
    if (s === 'context') return this.contextSeries()
    if (s === 'lookup' || s === 'report') return this.series
    return this.staticSeries()
  }

  /** request() with any kind (the package's typed overloads only list lookup / upload). */
  private ask(kind: 'lookup' | 'report', payload: unknown): Promise<unknown> {
    return (this.request as unknown as (k: string, p: unknown) => Promise<unknown>).call(this, kind, payload)
  }

  private async load() {
    const seq = ++this.loadSeq
    const source = this.sourceName
    this.loading = true
    this.loadError = null
    try {
      let next: Series
      if (source === 'lookup') {
        const res = await this.ask('lookup', { query: this.textProp('lookup_query', '') }) as LookupResult
        const rows = (res?.items ?? []).map((item) => {
          const extra = (item as { fields?: Row }).fields ?? item.data ?? {}
          return { ...extra, __label: item.label, __value: toNumber(item.value) ?? 0 } as Row
        })
        next = this.fromRows(rows, { labelDefault: this.textProp('label_field', '') || '__label', valueDefault: this.textProp('value_field', '') || '__value', labels: { __value: 'Value' }, fallback: true })
      } else {
        const res = await this.ask('report', {}) as ReportResult
        const cols = res?.columns ?? []
        const rows = res?.rows ?? []
        const isNum = (key: string, type: string) => NUMERIC_TYPE.test(type) || (rows.length > 0 && rows.every((r) => r[key] === null || r[key] === undefined || typeof r[key] === 'number'))
        const numeric = cols.filter((c) => isNum(c.key, c.type)).map((c) => c.key)
        const text = cols.find((c) => !numeric.includes(c.key))?.key ?? cols[0]?.key
        const labels = Object.fromEntries(cols.map((c) => [c.key, c.label || c.key]))
        next = this.fromRows(rows, { labelDefault: text, valueDefault: numeric[0], numericKeys: numeric, labels })
        if (!this.textProp('chart_title', '') && res?.report?.name) this.reportName = res.report.name
      }
      if (seq !== this.loadSeq) return
      this.series = next
    } catch (e) {
      if (seq !== this.loadSeq) return
      this.series = null
      const msg = e instanceof Error ? e.message : String(e ?? '')
      this.loadError = msg && !/^No fixture/.test(msg) ? msg : source === 'report' ? 'The report could not be loaded. Check that a report is chosen in the form designer and shared with you.' : 'The lookup could not be loaded. Check the field\'s lookup source in the form designer.'
    } finally {
      if (seq === this.loadSeq) this.loading = false
    }
  }

  private reportName = ''

  protected willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed)
    const source = this.sourceName
    const key = source === 'lookup' ? `lookup:${this.textProp('lookup_query', '')}` : source === 'report' ? 'report' : ''
    if (key !== this.loadKey) {
      this.loadKey = key
      this.active = null
      if (key) void this.load()
      else { this.series = null; this.loadError = null; this.loading = false }
    }
  }

  // ── chart ────────────────────────────────────────────────────────────────
  protected updated(changed: PropertyValues): void {
    super.updated(changed)
    this.syncChart()
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    this.chart?.destroy()
    this.chart = null
    this.chartKey = ''
  }

  connectedCallback(): void {
    super.connectedCallback()
    if (!this.hasUpdated) return
    this.chartKey = ''
    this.requestUpdate()
  }

  private syncChart() {
    const canvas = this.renderRoot.querySelector('canvas')
    const series = this.currentSeries
    if (!canvas || isEmpty(series)) {
      if (this.chart) { this.chart.destroy(); this.chart = null; this.chartKey = '' }
      return
    }
    const dark = this.dataset.mode === 'dark' || this.theme?.mode === 'dark'
    const theme = readTheme(this, dark)
    const colours = this.listProp('colors').filter((c) => /^#[0-9a-f]{3,8}$/i.test(c) || /^(rgb|hsl)a?\(/i.test(c))
    const showLegend = this.boolProp('show_legend', true) && (this.radial || series!.datasets.length > 1)
    const key = JSON.stringify([this.kind, series, theme, colours, this.boolProp('stacked', false), showLegend, this.locale, this.canSelect])
    if (this.chart && this.chart.canvas === canvas && key === this.chartKey) return
    this.chart?.destroy()
    this.chartKey = key
    this.chart = new Chart(canvas, buildConfig({
      kind: this.kind, series: series!, theme, colours, stacked: this.boolProp('stacked', false), showLegend, locale: this.locale,
      onClick: this.boolProp('selectable', false) ? (d, i) => { this.moveTo({ d, i }, false); this.select() } : undefined,
    }))
    if (this.active) this.highlight(this.active)
  }

  private highlight(p: Point | null) {
    const chart = this.chart
    if (!chart) return
    try {
      if (!p) {
        chart.setActiveElements([])
        chart.tooltip?.setActiveElements([], { x: 0, y: 0 })
      } else {
        const el = chart.getDatasetMeta(p.d)?.data?.[p.i] as unknown as { x: number; y: number } | undefined
        const active = [{ datasetIndex: p.d, index: p.i }]
        chart.setActiveElements(active)
        chart.tooltip?.setActiveElements(active, { x: el?.x ?? 0, y: el?.y ?? 0 })
      }
      chart.update()
    } catch { /* a destroyed chart */ }
  }

  // ── points ───────────────────────────────────────────────────────────────
  private pointInfo(p: Point): Selected | null {
    const s = this.currentSeries
    const ds = s?.datasets[p.d]
    if (!s || !ds || p.i >= s.labels.length) return null
    const series = s.datasets.length > 1 ? ds.label : ds.label && ds.label !== 'Value' ? ds.label : null
    return { label: s.labels[p.i], value: ds.data[p.i] ?? 0, series }
  }

  private describe(sel: Selected): string {
    const showSeries = sel.series && !(this.radial && (this.currentSeries?.datasets.length ?? 0) <= 1)
    return `${sel.label}: ${fmt(sel.value, this.locale)}${showSeries ? ` (${sel.series})` : ''}`
  }

  private moveTo(p: Point, announce = true) {
    this.active = p
    this.highlight(p)
    const info = this.pointInfo(p)
    if (info && announce) {
      const s = this.currentSeries!
      const selected = this.isSelected(info) ? ', selected' : ''
      // Alternate a trailing space so the same text is announced again.
      this.announcement = `${this.describe(info)}${selected}, ${p.i + 1} of ${s.labels.length}${this.announcement.endsWith(' ') ? '' : ' '}`
    }
  }

  private isSelected(info: Selected): boolean {
    const v = this.value
    return isRecord(v) && v.label === info.label && v.value === info.value && (v.series ?? null) === info.series
  }

  private select() {
    if (!this.canSelect || !this.active) return
    const info = this.pointInfo(this.active)
    if (!info) return
    this.emitChange(info)
    this.announcement = `Selected ${this.describe(info)}`
  }

  private onKey(e: KeyboardEvent) {
    const s = this.currentSeries
    if (isEmpty(s)) return
    const n = s!.labels.length
    const sets = this.radial ? 1 : s!.datasets.length
    const cur = this.active ?? null
    const p: Point = cur ? { ...cur } : { d: 0, i: -1 }
    const horizontal = this.kind === 'horizontal-bar'
    const nextKey = horizontal ? 'ArrowDown' : 'ArrowRight'
    const prevKey = horizontal ? 'ArrowUp' : 'ArrowLeft'
    const seriesNext = horizontal ? 'ArrowRight' : 'ArrowUp'
    const seriesPrev = horizontal ? 'ArrowLeft' : 'ArrowDown'
    switch (e.key) {
      case nextKey: p.i = Math.min(n - 1, p.i + 1); break
      case prevKey: p.i = cur ? Math.max(0, p.i - 1) : 0; break
      case seriesNext: if (sets > 1) { p.d = cur ? (p.d + 1) % sets : 0; p.i = Math.max(0, p.i) } else p.i = Math.min(n - 1, p.i + 1); break
      case seriesPrev: if (sets > 1) { p.d = cur ? (p.d - 1 + sets) % sets : 0; p.i = Math.max(0, p.i) } else p.i = cur ? Math.max(0, p.i - 1) : 0; break
      case 'Home': p.i = 0; break
      case 'End': p.i = n - 1; break
      case 'Enter': case ' ':
        if (this.canSelect && cur) { e.preventDefault(); this.select() }
        return
      case 'Escape':
        if (cur) { e.preventDefault(); this.active = null; this.highlight(null) }
        return
      default: return
    }
    e.preventDefault()
    this.moveTo(p)
  }

  private clearSelection() {
    if (this.locked) return
    this.emitChange(null)
    this.announcement = 'Selection cleared'
  }

  validate(): string | null {
    const v = this.value
    if (v === null || v === undefined) return null
    return isRecord(v) && typeof v.label === 'string' && typeof v.value === 'number' ? null : 'Choose a point on the chart'
  }

  // ── render ───────────────────────────────────────────────────────────────
  private renderTable(s: Series, title: string) {
    const sets = s.datasets
    return html`<div class="table-wrap" tabindex="0" role="region" aria-label=${`${title} data`}>
      <table>
        <caption>${title}</caption>
        <thead><tr><th scope="col">${this.textProp('label_field', '') && !this.textProp('label_field', '').startsWith('__') ? this.textProp('label_field', '') : 'Label'}</th>
          ${sets.map((d) => html`<th scope="col" class="num">${d.label || 'Value'}</th>`)}</tr></thead>
        <tbody>${s.labels.map((l, i) => html`<tr><th scope="row">${l}</th>${sets.map((d) => html`<td class="num">${fmt(d.data[i] ?? 0, this.locale)}</td>`)}</tr>`)}</tbody>
      </table>
    </div>`
  }

  render() {
    const s = this.currentSeries
    const height = Math.round(this.numberProp('height', 280, 120, 1000))
    const title = this.textProp('chart_title', '') || this.reportName
    const name = title || this.utLabel || 'Chart'
    const empty = isEmpty(s)
    const points = empty ? 0 : s!.labels.length
    const sel = isRecord(this.value) && typeof this.value.label === 'string' ? this.value as unknown as Selected : null
    const keyHelp = `Use the arrow keys to move through the ${points} points${!this.radial && (s?.datasets.length ?? 0) > 1 ? ` and ${this.kind === 'horizontal-bar' ? 'Left / Right' : 'Up / Down'} to change series` : ''}${this.canSelect ? '; Enter selects a point' : ''}.`
    return html`
      <div class="wrap" aria-busy=${this.loading ? 'true' : 'false'}>
        ${title || !empty ? html`<div class="bar">
          ${title ? html`<p class="title" id=${this.ids.title}>${title}</p>` : html`<span></span>`}
          ${!empty ? html`<button type="button" class="toggle" aria-expanded=${this.showTable ? 'true' : 'false'} @click=${() => { this.showTable = !this.showTable }}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/></svg>
            ${this.showTable ? 'Hide data table' : 'Show data table'}</button>` : nothing}
        </div>` : nothing}
        ${this.loadError ? html`<div class="state error" role="alert" style=${`min-height:${Math.min(height, 120)}px`}>${this.loadError}</div>`
          : this.loading && empty ? html`<div class="plot" style=${`height:${height}px`}><div class="skeleton" aria-hidden="true">${[45, 70, 55, 85, 60].map((h) => html`<span style=${`height:${h}%`}></span>`)}</div><span class="sr-only">Loading chart…</span></div>`
          : empty ? html`<div class="state" style=${`min-height:${Math.min(height, 120)}px`}>No data to show yet.</div>`
          : html`<div class="plot" style=${`height:${height}px`} tabindex="0" role="group" aria-label=${`${name}: ${this.kind.replace('-', ' ')} chart, ${points} points`}
              aria-describedby=${`${this.ids.hint}${this.utDescription ? ` ${this.ids.desc}` : ''}`}
              @keydown=${this.onKey} @blur=${() => { this.active = null; this.highlight(null) }}
              @focusout=${(e: FocusEvent) => { if (!this.renderRoot.contains(e.relatedTarget as Node)) this.emitBlur() }}>
              <canvas aria-hidden="true"></canvas>
            </div>
            <span class="sr-only" id=${this.ids.hint}>${keyHelp}</span>`}
        ${sel ? html`<div class="selected"><span class="chip"><span class="sr-only">Selected point:</span><span aria-hidden="true">Selected:</span> ${this.describe(sel)}</span>
            ${!this.locked ? html`<button type="button" class="link" @click=${this.clearSelection}>Clear<span class="sr-only"> selection</span></button>` : nothing}</div>`
          : this.canSelect && !empty ? html`<div class="hint">Click a point, or focus the chart and press Enter, to select it.</div>` : nothing}
        ${this.showTable && !empty ? this.renderTable(s!, name) : nothing}
        <div class="sr-only" aria-live="polite" aria-atomic="true">${this.announcement}</div>
        ${this.utDescription ? html`<span id=${this.ids.desc} class="sr-only">${this.utDescription}</span>` : nothing}
      </div>
    `
  }
}

define('ut-chart', UtChart)
