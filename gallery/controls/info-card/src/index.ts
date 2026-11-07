/**
 * <ut-info-card> — a callout or key / value card that shows text with up to
 * six other form values ({{field1}} … {{field6}}, mapped as context). Plain
 * text only (never HTML), line breaks kept, numbers and ISO dates formatted
 * for the reader's locale. Display only: the value is never emitted.
 */
import { UtControl, css, define, formatNumber, html, nothing, plainText, svg, uid } from '../../shared/base'

const VARIANTS = ['info', 'success', 'warning', 'error', 'neutral'] as const
type Variant = (typeof VARIANTS)[number]
const PREFIX: Record<Variant, string> = { info: 'Information', success: 'Success', warning: 'Warning', error: 'Error', neutral: 'Note' }
const ICONS: Record<Variant, ReturnType<typeof svg>> = {
  info: svg`<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.01"/>`,
  success: svg`<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.8 2.8L16 10"/>`,
  warning: svg`<path d="M10.3 4.2L2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4M12 17v.01"/>`,
  error: svg`<circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/>`,
  neutral: svg`<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 13h8M8 17h5"/>`,
}
const FIELDS = ['field1', 'field2', 'field3', 'field4', 'field5', 'field6'] as const
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/

export class UtInfoCard extends UtControl {
  static styles = [UtControl.styles, css`
    /* No warning token in the theme yet: amber that passes 4.5:1 on the card in each mode (--ut-warning overrides). */
    :host { --_warning: var(--ut-warning, #a15c07); }
    :host([data-mode='dark']) { --_warning: var(--ut-warning, #f5b84a); }
    .card { display: flex; gap: 12px; align-items: flex-start; padding: 12px 14px; border-radius: var(--_radius);
      border: 1px solid var(--_tone-border); border-left: 4px solid var(--_tone); background: var(--_tone-bg); color: var(--_text); }
    .icon { flex: none; width: 20px; height: 20px; margin-top: 1px; color: var(--_tone); }
    .icon svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; display: block; }
    .content { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 4px; }
    .title { margin: 0; font-weight: 600; }
    .body { margin: 0; white-space: pre-line; overflow-wrap: anywhere; }
    dl { margin: 4px 0 0; display: grid; grid-template-columns: minmax(90px, max-content) 1fr; gap: 6px 16px; }
    dt { color: var(--_muted); }
    dd { margin: 0; font-weight: 500; overflow-wrap: anywhere; white-space: pre-line; }
    @media (max-width: 420px) { dl { grid-template-columns: 1fr; gap: 0; } dd { margin-bottom: 6px; } }
    .empty { color: var(--_muted); font-style: italic; }
    :host([disabled]) .card { opacity: 0.6; }
  `]

  private base = uid('info')

  get tone(): Variant {
    const v = this.textProp('variant', 'info') as Variant
    return VARIANTS.includes(v) ? v : 'info'
  }

  private formatValue(v: unknown): string {
    if (v === null || v === undefined || v === '') return ''
    const auto = this.textProp('format', 'auto') !== 'plain'
    if (!auto) return plainText(v)
    if (typeof v === 'boolean') return v ? 'Yes' : 'No'
    if (typeof v === 'number') return formatNumber(v, this.locale, { maximumFractionDigits: 2 })
    if (typeof v === 'string' && ISO_DATE.test(v.trim())) {
      const s = v.trim()
      const d = new Date(s.length === 10 ? `${s}T00:00:00` : s)
      if (!Number.isNaN(d.getTime())) {
        try {
          return new Intl.DateTimeFormat(this.locale || 'en', s.length === 10 ? { dateStyle: 'medium' } : { dateStyle: 'medium', timeStyle: 'short' }).format(d)
        } catch { return s }
      }
    }
    if (Array.isArray(v)) return v.map((x) => this.formatValue(x)).filter(Boolean).join(', ')
    if (typeof v === 'object') {
      const o = v as Record<string, unknown>
      for (const k of ['label', 'name', 'title', 'formatted']) if (typeof o[k] === 'string') return o[k] as string
    }
    return plainText(v)
  }

  private fill(template: string): string {
    return template.replace(/\{\{\s*(field[1-6])\s*\}\}/g, (_, k: string) => this.formatValue(this.contextValue(k)))
  }

  render() {
    const variant = this.tone
    const title = this.fill(this.textProp('card_title', ''))
    const rawBody = this.prop<unknown>('body', '')
    const body = typeof rawBody === 'string' ? this.fill(rawBody).replace(/\n{3,}/g, '\n\n').trim() : ''
    const keyValue = this.textProp('layout', 'callout') === 'key-value'
    const labels = (() => {
      const v = this.prop<unknown>('labels', [])
      return Array.isArray(v) ? v.map((x) => String(x ?? '').trim()) : []
    })()
    const pairs = keyValue ? FIELDS.map((k, i) => ({ label: labels[i] || '', value: this.formatValue(this.contextValue(k)), mapped: this.contextValue(k) !== null }))
      .filter((p) => p.label || p.mapped)
      .map((p, i) => ({ ...p, label: p.label || `Field ${i + 1}` })) : []
    const tones: Record<Variant, string> = {
      info: '--_tone:var(--_primary);--_tone-bg:var(--_primary-light);--_tone-border:color-mix(in srgb, var(--_primary) 35%, transparent)',
      success: '--_tone:var(--_success);--_tone-bg:color-mix(in srgb, var(--_success) 10%, var(--_card));--_tone-border:color-mix(in srgb, var(--_success) 35%, transparent)',
      warning: '--_tone:var(--_warning);--_tone-bg:color-mix(in srgb, var(--_warning) 10%, var(--_card));--_tone-border:color-mix(in srgb, var(--_warning) 45%, transparent)',
      error: '--_tone:var(--_error);--_tone-bg:color-mix(in srgb, var(--_error) 9%, var(--_card));--_tone-border:color-mix(in srgb, var(--_error) 35%, transparent)',
      neutral: '--_tone:var(--_muted);--_tone-bg:var(--_surface);--_tone-border:var(--_border)',
    }
    const style = tones[variant]
    const live = variant === 'warning' || variant === 'error'
    const hasContent = Boolean(title || body || pairs.length)
    return html`
      <div class="card" style=${style} role=${live ? 'status' : 'note'}
        aria-labelledby=${title ? `${this.base}-t` : nothing} aria-label=${title ? nothing : this.utLabel || PREFIX[variant]}
        aria-describedby=${this.utDescription ? `${this.base}-d` : nothing}>
        ${this.boolProp('show_icon', true) ? html`<span class="icon" aria-hidden="true"><svg viewBox="0 0 24 24">${ICONS[variant]}</svg></span>` : nothing}
        <div class="content">
          ${title ? html`<p class="title" id=${`${this.base}-t`}><span class="sr-only">${PREFIX[variant]}: </span>${title}</p>` : nothing}
          ${body ? html`<p class="body">${title ? nothing : html`<span class="sr-only">${PREFIX[variant]}: </span>`}${body}</p>` : nothing}
          ${pairs.length ? html`<dl>${pairs.map((p) => html`<dt>${p.label}</dt><dd>${p.value || '—'}</dd>`)}</dl>` : nothing}
          ${!hasContent ? html`<p class="body empty"><span class="sr-only">${PREFIX[variant]}: </span>Add a title or text in the form designer.</p>` : nothing}
        </div>
      </div>
      ${this.utDescription ? html`<span id=${`${this.base}-d`} class="sr-only">${this.utDescription}</span>` : nothing}
    `
  }
}

define('ut-info-card', UtInfoCard)
