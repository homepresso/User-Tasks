/**
 * <ut-progress> — shows progress as a bar, a ring or named steps, from two
 * mapped fields (context `current` and `total`) or fixed properties. Display
 * only: the value is never emitted. Bar / ring are an ARIA progressbar; steps
 * are an ordered list with aria-current="step".
 */
import { UtControl, css, define, formatNumber, html, nothing, plainText, svg, uid } from '../../shared/base'

function toNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.trim().replace(/[,\s%]/g, ''))
    return Number.isFinite(n) ? n : null
  }
  if (Array.isArray(v)) return v.length
  return null
}

export class UtProgress extends UtControl {
  static styles = [UtControl.styles, css`
    .wrap { container-type: inline-size; }
    .top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
    .label { color: var(--_text); }
    .pct { font-weight: 600; font-variant-numeric: tabular-nums; color: var(--_text); }
    .status { font-size: 0.86em; color: var(--_tone); font-weight: 600; }
    .track { height: 10px; border-radius: 999px; background: var(--_surface); box-shadow: inset 0 0 0 1px var(--_border); overflow: hidden; }
    .fill { height: 100%; border-radius: 999px; background: var(--_tone); transition: width 0.4s ease; min-width: 0; }
    .ring { display: flex; align-items: center; gap: 14px; }
    .ring svg { flex: none; }
    .ring .bg { stroke: var(--_surface); }
    .ring .edge { stroke: var(--_border); }
    .ring .fg { stroke: var(--_tone); transition: stroke-dashoffset 0.4s ease; }
    .ring text { fill: var(--_text); font-weight: 600; font-family: inherit; }
    .ring .side { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .steps-head { margin-bottom: 8px; color: var(--_text); }
    .steps-head strong { font-weight: 600; }
    ol { list-style: none; margin: 0; padding: 0; display: flex; }
    li { flex: 1 1 0; min-width: 0; position: relative; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 6px; padding: 0 4px; }
    li::before { content: ''; position: absolute; top: 13px; right: 50%; width: 100%; height: 2px; background: var(--_border); z-index: 0; }
    li:first-child::before { display: none; }
    li.done::before, li.current::before { background: var(--_tone); }
    .mark { position: relative; z-index: 1; width: 28px; height: 28px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
      font-size: 0.86em; font-weight: 600; border: 2px solid var(--_border); background: var(--_card); color: var(--_muted); }
    li.done .mark { background: var(--_tone); border-color: var(--_tone); color: var(--_on-primary); }
    li.current .mark { border-color: var(--_tone); color: var(--_text); box-shadow: 0 0 0 3px var(--_primary-light); }
    .mark svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
    .name { font-size: 0.86em; color: var(--_muted); overflow-wrap: anywhere; }
    li.current .name { color: var(--_text); font-weight: 600; }
    li.done .name { color: var(--_text); }
    @container (max-width: 460px) {
      ol { flex-direction: column; gap: 10px; }
      li { flex-direction: row; text-align: left; gap: 10px; padding: 0; }
      li::before { top: auto; bottom: 50%; right: auto; left: 13px; width: 2px; height: calc(100% + 10px); }
      .name { font-size: 0.93em; }
    }
    :host([disabled]) .wrap { opacity: 0.6; }
  `]

  private base = uid('progress')

  private stepNames(): string[] {
    const v = this.prop<unknown>('steps', [])
    return Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 20) : []
  }

  /** current / total / percentage / tone from the context fields or the properties. */
  private model() {
    const appearance = this.textProp('appearance', 'bar')
    const steps = appearance === 'steps' ? this.stepNames() : []
    const rawCurrent = this.contextValue('current') ?? this.prop<unknown>('current_value', null)
    const rawTotal = this.contextValue('total') ?? this.prop<unknown>('total_value', null)
    let current = toNum(rawCurrent)
    if (steps.length && current === null && typeof rawCurrent === 'string') {
      const i = steps.findIndex((s) => s.toLowerCase() === rawCurrent.trim().toLowerCase())
      if (i >= 0) current = i + 1
    }
    let total = steps.length ? steps.length : toNum(rawTotal)
    if (total === null || total <= 0) total = 100
    const value = Math.max(0, Math.min(total, current ?? 0))
    const pct = Math.round((value / total) * 1000) / 10
    const warn = this.prop<unknown>('warn_below', null)
    const good = this.prop<unknown>('good_above', null)
    const warnN = toNum(warn)
    const goodN = toNum(good)
    const tone = warnN !== null && pct < warnN ? 'warn' : goodN !== null && pct >= goodN ? 'good' : 'normal'
    return { appearance, steps, value, total, pct, tone, hasCurrent: current !== null }
  }

  private labelText(m: ReturnType<UtProgress['model']>): string {
    const unit = this.textProp('unit', '')
    const fmtN = (n: number) => formatNumber(n, this.locale, { maximumFractionDigits: 2 })
    const tpl = this.textProp('label_template', m.appearance === 'steps' ? '' : '{{current}} of {{total}} {{unit}}')
    const step = m.steps[Math.max(0, Math.round(m.value) - 1)] ?? ''
    const vars: Record<string, string> = {
      current: fmtN(m.value), total: fmtN(m.total), unit, percent: `${fmtN(m.pct)}%`, remaining: fmtN(Math.max(0, m.total - m.value)), step,
    }
    // Plain text substitution only (Lit escapes the result).
    return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => vars[k] ?? '').replace(/\s+/g, ' ').trim()
  }

  render() {
    const m = this.model()
    const toneVar = m.tone === 'warn' ? 'var(--_error)' : m.tone === 'good' ? 'var(--_success)' : 'var(--_primary)'
    const showPct = this.boolProp('show_percentage', true)
    const label = this.labelText(m)
    const pctText = `${formatNumber(m.pct, this.locale, { maximumFractionDigits: 1 })}%`
    const statusText = m.tone === 'warn' ? 'Needs attention' : m.tone === 'good' ? 'On track' : ''
    const valueText = [label, pctText, statusText].filter(Boolean).join(', ')
    const name = this.utLabel || 'Progress'
    const desc = this.utDescription ? html`<span id=${`${this.base}-desc`} class="sr-only">${this.utDescription}</span>` : nothing
    const describedBy = this.utDescription ? `${this.base}-desc` : nothing
    const style = `--_tone:${toneVar}`

    if (m.appearance === 'steps' && m.steps.length) {
      const cur = Math.max(0, Math.min(m.steps.length, Math.round(m.value)))
      const head = cur ? `Step ${cur} of ${m.steps.length}: ${m.steps[cur - 1]}` : `Not started (${m.steps.length} steps)`
      return html`<div class="wrap" style=${style}>
        <div class="steps-head"><strong>${head}</strong>${label ? html` <span class="muted">· ${label}</span>` : nothing}</div>
        <ol aria-label=${`${name}: ${head}`} aria-describedby=${describedBy}>
          ${m.steps.map((s, i) => {
            const n = i + 1
            const state = n < cur ? 'done' : n === cur ? 'current' : 'todo'
            return html`<li class=${state} aria-current=${state === 'current' ? 'step' : nothing}>
              <span class="mark" aria-hidden="true">${state === 'done' ? html`<svg viewBox="0 0 24 24">${svg`<path d="M5 12.5l4.5 4.5L19 7.5"/>`}</svg>` : n}</span>
              <span class="name">${s}<span class="sr-only">${state === 'done' ? ', completed' : state === 'current' ? ', current step' : ', not started'}</span></span>
            </li>`
          })}
        </ol>${desc}</div>`
    }

    const aria = {
      max: plainText(m.total), now: plainText(m.value),
    }
    if (m.appearance === 'ring') {
      const r = 26
      const c = 2 * Math.PI * r
      return html`<div class="wrap ring" style=${style}>
        <svg width="68" height="68" viewBox="0 0 68 68" role="progressbar" aria-label=${name} aria-valuemin="0" aria-valuemax=${aria.max}
          aria-valuenow=${aria.now} aria-valuetext=${valueText} aria-describedby=${describedBy}>
          ${svg`<circle class="edge" cx="34" cy="34" r="${r + 5}" fill="none" stroke-width="1"/>
          <circle class="bg" cx="34" cy="34" r="${r}" fill="none" stroke-width="8"/>
          <circle class="fg" cx="34" cy="34" r="${r}" fill="none" stroke-width="8" stroke-linecap="round"
            stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - m.pct / 100)}" transform="rotate(-90 34 34)"/>
          ${showPct ? svg`<text x="34" y="34" text-anchor="middle" dominant-baseline="central" font-size="13">${Math.round(m.pct)}%</text>` : nothing}`}
        </svg>
        <div class="side" aria-hidden="true">
          ${label ? html`<span class="label">${label}</span>` : nothing}
          ${statusText ? html`<span class="status">${statusText}</span>` : nothing}
        </div>${desc}</div>`
    }
    return html`<div class="wrap" style=${style}>
      <div class="top" aria-hidden="true">
        <span class="label">${label}${statusText ? html` <span class="status">· ${statusText}</span>` : nothing}</span>
        ${showPct ? html`<span class="pct">${pctText}</span>` : nothing}
      </div>
      <div class="track" role="progressbar" aria-label=${name} aria-valuemin="0" aria-valuemax=${aria.max} aria-valuenow=${aria.now}
        aria-valuetext=${valueText} aria-describedby=${describedBy}>
        <div class="fill" style=${`width:${m.pct}%`}></div>
      </div>${desc}</div>`
  }
}

define('ut-progress', UtProgress)
