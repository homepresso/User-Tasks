/**
 * <ut-address> — an address search field (ARIA 1.2 combobox) over the
 * field's lookup source: the server calls the configured API reference
 * (e.g. Google Places API (New) Text Search, its key kept server-side in an
 * integration) or data table, and the control turns the chosen suggestion
 * into a structured address. "Enter the address manually" reveals street /
 * city / region / postcode / country inputs.
 *
 * Value (json): { formatted, street, city, region, postcode, country,
 * country_code, lat, lng, place_id } (strings or null; lat / lng numbers or
 * null), or null.
 */
import { UtControl, css, define, html, nothing, uid, type LookupResult, type PropertyValues } from '../../shared/base'
import { ADDRESS_PARTS, addressFromItem, coerceAddress, formatParts, type AddressPart, type AddressValue } from './parse'

interface Suggestion { address: AddressValue; label: string; secondary: string }

const PART_LABELS: Record<AddressPart, string> = { street: 'Street address', city: 'City / town', region: 'State / region', postcode: 'Postcode', country: 'Country' }
const PART_AUTOCOMPLETE: Record<AddressPart, string> = { street: 'address-line1', city: 'address-level2', region: 'address-level1', postcode: 'postal-code', country: 'country-name' }

function looksLikeJson(s: string): boolean {
  const t = s.trim()
  return t.startsWith('{') || t.startsWith('[')
}

export class UtAddress extends UtControl {
  static properties = {
    query: { state: true },
    open: { state: true },
    suggestions: { state: true },
    active: { state: true },
    loading: { state: true },
    notice: { state: true },
    noticeKind: { state: true },
    manual: { state: true },
    draft: { state: true },
    announcement: { state: true },
  }

  static styles = [UtControl.styles, css`
    .field { position: relative; display: flex; align-items: center; }
    .icon { position: absolute; left: 11px; width: 18px; height: 18px; color: var(--_muted); pointer-events: none; }
    input { font: inherit; width: 100%; min-height: 40px; padding: 0 12px; border-radius: var(--_radius); border: 1px solid var(--_border);
      background: var(--_input-bg); color: var(--_input-text); }
    input.search { padding-left: 36px; padding-right: 76px; }
    input::placeholder { color: var(--_muted); opacity: 1; }
    input:focus-visible { outline: 2px solid var(--_focus); outline-offset: 0; border-color: var(--_focus); }
    :host([invalid]) input.search { border-color: var(--_error); }
    :host([disabled]) input { opacity: 0.6; }
    .tail { position: absolute; right: 4px; display: flex; align-items: center; gap: 2px; }
    .clear { all: unset; box-sizing: border-box; width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center;
      border-radius: calc(var(--_radius) - 2px); color: var(--_muted); cursor: pointer; }
    .clear:hover { background: var(--_surface); color: var(--_text); }
    .clear:focus-visible { outline: 2px solid var(--_focus); outline-offset: -2px; }
    .clear svg { width: 16px; height: 16px; }
    .spin { width: 16px; height: 16px; margin: 0 8px; border-radius: 50%; border: 2px solid var(--_border); border-top-color: var(--_primary); animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .spin { animation: none; border-top-color: var(--_primary); border-right-color: var(--_primary); } }
    .popup { margin-top: 4px; border: 1px solid var(--_border); border-radius: var(--_radius); background: var(--_card);
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.08); overflow: hidden; }
    [role='listbox'] { list-style: none; margin: 0; padding: 4px; max-height: 280px; overflow-y: auto; }
    [role='option'] { display: flex; gap: 10px; align-items: flex-start; padding: 8px 10px; min-height: 40px; border-radius: calc(var(--_radius) - 2px); cursor: pointer; }
    [role='option'] svg { flex: none; width: 16px; height: 16px; margin-top: 2px; color: var(--_muted); }
    [role='option'][aria-selected='true'] { background: var(--_primary-light); outline: 1px solid var(--_primary); outline-offset: -1px; }
    [role='option']:hover { background: var(--_surface); }
    [role='option'][aria-selected='true']:hover { background: var(--_primary-light); }
    .opt-main { display: block; color: var(--_text); }
    .opt-sub { display: block; color: var(--_muted); font-size: 0.88em; }
    .notice { padding: 10px 12px; color: var(--_muted); font-size: 0.93em; }
    .notice.error { color: var(--_error); }
    .below { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: center; margin-top: 6px; }
    .link { all: unset; cursor: pointer; color: var(--_primary-text); text-decoration: underline; text-underline-offset: 2px; font-size: 0.93em;
      min-height: 28px; display: inline-flex; align-items: center; border-radius: 4px; }
    .link:focus-visible { outline: 2px solid var(--_focus); outline-offset: 2px; }
    .manual { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 12px; }
    .manual .wide { grid-column: 1 / -1; }
    .manual label { display: grid; gap: 4px; font-size: 0.93em; color: var(--_muted); }
    @media (max-width: 480px) { .manual { grid-template-columns: 1fr; } }
    dl.details { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; margin: 8px 0 0; padding: 10px 12px; font-size: 0.93em;
      border-radius: var(--_radius); background: var(--_surface); }
    dl.details dt { color: var(--_muted); }
    dl.details dd { margin: 0; color: var(--_text); overflow-wrap: anywhere; }
    .readonly { min-height: 24px; overflow-wrap: anywhere; }
    .empty { color: var(--_muted); }
  `]

  declare query: string
  declare open: boolean
  declare suggestions: Suggestion[]
  declare active: number
  declare loading: boolean
  declare notice: string
  declare noticeKind: 'info' | 'error' | ''
  declare manual: boolean
  declare draft: Record<AddressPart, string>
  declare announcement: string

  private ids = { input: uid('addr-in'), list: uid('addr-list'), opt: uid('addr-opt') }
  private timer: ReturnType<typeof setTimeout> | null = null
  private seq = 0
  private shownFor: string | null = null

  constructor() {
    super()
    this.query = ''
    this.open = false
    this.suggestions = []
    this.active = -1
    this.loading = false
    this.notice = ''
    this.noticeKind = ''
    this.manual = false
    this.draft = { street: '', city: '', region: '', postcode: '', country: '' }
    this.announcement = ''
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    if (this.timer) clearTimeout(this.timer)
  }

  private get address(): AddressValue | null { return coerceAddress(this.value) }
  private get minChars(): number { return Math.round(this.numberProp('min_chars', 3, 1, 20)) }

  /** Keep the input text in step with a value the host sets. */
  protected willUpdate(changed: PropertyValues): void {
    if (changed.has('value')) {
      const formatted = this.address?.formatted ?? ''
      if (formatted !== this.shownFor) {
        // A new value from outside (or our own selection): show it. Our own "clear while typing" keeps the text.
        if (formatted || !this.query || this.query === this.shownFor) this.query = formatted
        this.shownFor = formatted
      }
    }
  }

  validate(): string | null {
    const typed = this.query.trim()
    if (!this.manual && typed && typed !== (this.address?.formatted ?? '')) {
      return this.boolProp('allow_manual', true) ? 'Choose an address from the list (or enter it manually)' : 'Choose an address from the list'
    }
    const v = this.value
    if (v !== null && v !== undefined && !this.address) return 'The address could not be read'
    return null
  }

  // ── Search ───────────────────────────────────────────────────────────

  private onInput(e: Event) {
    if (this.locked) return
    this.query = (e.target as HTMLInputElement).value
    if (this.value !== null) this.emitChange(null)
    this.shownFor = ''
    this.schedule()
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer)
    const q = this.query.trim()
    if (q.length < this.minChars) {
      this.seq++
      this.loading = false
      this.open = false
      this.suggestions = []
      this.active = -1
      this.notice = ''
      return
    }
    const wait = Math.round(this.numberProp('debounce_ms', 350, 0, 2000))
    this.timer = setTimeout(() => void this.search(q), wait)
  }

  private async search(q: string) {
    const seq = ++this.seq
    this.loading = true
    const hint = this.textProp('country_hint', '')
    const query = (hint && !q.toLowerCase().includes(hint.toLowerCase()) ? `${q}, ${hint}` : q).slice(0, 500)
    try {
      const result = await this.request('lookup', { query }) as LookupResult
      if (seq !== this.seq) return
      const items = Array.isArray(result?.items) ? result.items : []
      const suggestions: Suggestion[] = []
      for (const item of items.slice(0, 20)) {
        const address = addressFromItem(item)
        if (!address) continue
        // A named place (a data table of sites: "Depot 7") keeps its name on top and the address below.
        const rawLabel = typeof (item as { label?: unknown }).label === 'string' ? String((item as { label?: string }).label).trim() : ''
        const label = rawLabel && !looksLikeJson(rawLabel) ? rawLabel : address.formatted
        const desc = typeof (item as { description?: unknown }).description === 'string' ? String((item as { description?: string }).description) : ''
        const secondary = label !== address.formatted ? address.formatted : desc && !looksLikeJson(desc) && desc !== label ? desc : ''
        if (!suggestions.some((s) => s.label === label && s.address.formatted === address.formatted)) suggestions.push({ address, label, secondary })
      }
      this.suggestions = suggestions
      this.active = -1
      this.open = true
      this.noticeKind = suggestions.length ? '' : 'info'
      this.notice = suggestions.length ? '' : 'No matches'
      this.announcement = suggestions.length
        ? `${suggestions.length} address${suggestions.length === 1 ? '' : 'es'} found. Use Up and Down to choose.`
        : 'No matches'
    } catch (error) {
      if (seq !== this.seq) return
      const detail = error instanceof Error && error.message ? error.message : ''
      this.suggestions = []
      this.active = -1
      this.open = true
      this.noticeKind = 'error'
      this.notice = `Address search is not available right now${detail ? ` (${detail})` : ''}.${this.boolProp('allow_manual', true) ? ' You can enter the address manually.' : ''}`
      this.announcement = this.notice
    } finally {
      if (seq === this.seq) this.loading = false
    }
  }

  private choose(index: number) {
    const s = this.suggestions[index]
    if (!s || this.locked) return
    this.query = s.address.formatted
    this.shownFor = s.address.formatted
    this.open = false
    this.active = -1
    this.suggestions = []
    this.announcement = `Selected ${s.address.formatted}`
    this.emitChange(s.address)
  }

  private close() {
    this.open = false
    this.active = -1
  }

  private onKey(e: KeyboardEvent) {
    if (this.locked) return
    const n = this.suggestions.length
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        if (!this.open) {
          if (n) this.open = true
          else if (this.query.trim().length >= this.minChars) void this.search(this.query.trim())
          return
        }
        if (n) this.active = this.active >= n - 1 ? 0 : this.active + 1
        break
      case 'ArrowUp':
        e.preventDefault()
        if (!this.open && n) this.open = true
        if (n) this.active = this.active <= 0 ? n - 1 : this.active - 1
        break
      case 'Enter':
        if (this.open && this.active >= 0) { e.preventDefault(); this.choose(this.active) }
        break
      case 'Escape':
        if (this.open) { e.preventDefault(); this.close() }
        else if (this.query) { e.preventDefault(); this.clear() }
        break
      case 'Tab':
        this.close()
        break
      default:
    }
    if (this.open && this.active >= 0) this.updateComplete.then(() => this.renderRoot.querySelector(`#${this.ids.opt}-${this.active}`)?.scrollIntoView({ block: 'nearest' }))
  }

  private clear() {
    if (this.locked) return
    if (this.timer) clearTimeout(this.timer)
    this.seq++
    this.query = ''
    this.shownFor = ''
    this.loading = false
    this.close()
    this.suggestions = []
    this.notice = ''
    this.announcement = 'Address cleared'
    if (this.value !== null) this.emitChange(null)
    this.updateComplete.then(() => this.renderRoot.querySelector<HTMLInputElement>('input.search')?.focus())
  }

  private onFocusOut(e: FocusEvent) {
    const next = e.relatedTarget as Node | null
    if (next && this.renderRoot.contains(next)) return
    this.close()
    this.emitBlur()
  }

  // ── Manual entry ─────────────────────────────────────────────────────

  private setManual(on: boolean) {
    if (this.locked) return
    this.manual = on
    this.close()
    if (on) {
      const a = this.address
      this.draft = {
        street: a?.street ?? '', city: a?.city ?? '', region: a?.region ?? '', postcode: a?.postcode ?? '', country: a?.country ?? '',
      }
      if (a && !ADDRESS_PARTS.some((p) => a[p])) this.draft = { ...this.draft, street: a.formatted }
      this.updateComplete.then(() => this.renderRoot.querySelector<HTMLInputElement>('#m-street')?.focus())
    } else {
      this.query = this.address?.formatted ?? ''
      this.shownFor = this.query
      this.updateComplete.then(() => this.renderRoot.querySelector<HTMLInputElement>('input.search')?.focus())
    }
  }

  private onManualInput(part: AddressPart, e: Event) {
    if (this.locked) return
    this.draft = { ...this.draft, [part]: (e.target as HTMLInputElement).value.slice(0, 200) }
    const parts = Object.fromEntries(ADDRESS_PARTS.map((p) => [p, this.draft[p].trim() || null])) as Record<AddressPart, string | null>
    const formatted = formatParts(parts)
    const prev = this.address
    const next: AddressValue | null = formatted
      ? { formatted: formatted.slice(0, 500), ...parts, country_code: null, lat: null, lng: null, place_id: null }
      : null
    // Keep the country code when the country is unchanged.
    if (next && prev?.country_code && prev.country === next.country) next.country_code = prev.country_code
    this.query = next?.formatted ?? ''
    this.shownFor = this.query
    this.emitChange(next)
  }

  // ── Render ───────────────────────────────────────────────────────────

  private renderDetails(a: AddressValue | null) {
    if (!a || !this.boolProp('show_details', false)) return nothing
    const rows: Array<[string, string | null]> = [
      ['Street', a.street], ['City', a.city], ['Region', a.region], ['Postcode', a.postcode],
      ['Country', a.country ? `${a.country}${a.country_code ? ` (${a.country_code})` : ''}` : a.country_code],
      ['Coordinates', a.lat !== null && a.lng !== null ? `${a.lat.toFixed(5)}, ${a.lng.toFixed(5)}` : null],
    ]
    const shown = rows.filter(([, v]) => v)
    if (!shown.length) return nothing
    return html`<dl class="details" aria-label="Address details">${shown.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>`
  }

  private renderManual() {
    return html`
      <div class="manual" role="group" aria-label=${`${this.utLabel || 'Address'}: manual entry`}>
        ${ADDRESS_PARTS.map((p) => html`
          <label class=${p === 'street' ? 'wide' : ''}>${PART_LABELS[p]}
            <input id=${`m-${p}`} type="text" autocomplete=${PART_AUTOCOMPLETE[p]} maxlength="200" .value=${this.draft[p]}
              ?disabled=${this.disabled} aria-required=${p === 'street' && this.required ? 'true' : 'false'} @input=${(e: Event) => this.onManualInput(p, e)}>
          </label>`)}
      </div>
      <div class="below">
        <button type="button" class="link" @click=${() => this.setManual(false)}>Search for the address instead</button>
      </div>`
  }

  private renderSearch() {
    const expanded = this.open && (this.suggestions.length > 0 || Boolean(this.notice))
    const activeId = this.open && this.active >= 0 ? `${this.ids.opt}-${this.active}` : ''
    const showClear = !this.disabled && (this.query || this.value !== null)
    return html`
      <div class="field">
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>
        </svg>
        <input id=${this.ids.input} class="search" type="text" role="combobox" autocomplete="off" spellcheck="false"
          .value=${this.query} placeholder=${this.textProp('placeholder', 'Start typing an address')}
          aria-label=${this.utLabel || 'Address'} aria-describedby=${this.utDescription ? 'desc' : nothing}
          aria-autocomplete="list" aria-expanded=${expanded ? 'true' : 'false'} aria-controls=${this.ids.list}
          aria-activedescendant=${activeId || nothing} aria-required=${this.required ? 'true' : 'false'}
          aria-invalid=${this.invalid || this.validate() ? 'true' : 'false'} aria-busy=${this.loading ? 'true' : 'false'}
          ?disabled=${this.disabled} ?readonly=${this.readonly}
          @input=${this.onInput} @keydown=${this.onKey}
          @focus=${() => { if (this.suggestions.length && !this.locked) this.open = true }}>
        <span class="tail">
          ${this.loading ? html`<span class="spin" role="presentation"></span>` : nothing}
          ${showClear ? html`<button type="button" class="clear" aria-label="Clear the address" @click=${this.clear}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>` : nothing}
        </span>
      </div>
      <div class="popup" ?hidden=${!expanded}>
        <ul role="listbox" id=${this.ids.list} aria-label=${`${this.utLabel || 'Address'} suggestions`} ?hidden=${!this.suggestions.length}>
          ${this.suggestions.map((s, i) => html`
            <li role="option" id=${`${this.ids.opt}-${i}`} aria-selected=${i === this.active ? 'true' : 'false'}
              @mousedown=${(e: Event) => e.preventDefault()} @click=${() => this.choose(i)} @mousemove=${() => { if (this.active !== i) this.active = i }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
              <span><span class="opt-main">${s.label}</span>${s.secondary ? html`<span class="opt-sub">${s.secondary}</span>` : nothing}</span>
            </li>`)}
        </ul>
        ${this.notice ? html`<div class="notice ${this.noticeKind === 'error' ? 'error' : ''}">${this.notice}</div>` : nothing}
      </div>
      ${this.boolProp('allow_manual', true) && !this.readonly ? html`
        <div class="below">
          <button type="button" class="link" ?disabled=${this.disabled} @click=${() => this.setManual(true)}>Enter the address manually</button>
        </div>` : nothing}`
  }

  render() {
    const a = this.address
    if (this.readonly) {
      return html`
        <div class="readonly" role="group" aria-label=${this.utLabel || 'Address'} aria-describedby=${this.utDescription ? 'desc' : nothing}>
          ${a ? a.formatted : html`<span class="empty">No address</span>`}
          ${this.renderDetails(a)}
        </div>
        ${this.utDescription ? html`<span id="desc" class="sr-only">${this.utDescription}</span>` : nothing}`
    }
    return html`
      <div @focusout=${this.onFocusOut}>
        ${this.manual ? this.renderManual() : this.renderSearch()}
        ${this.renderDetails(a)}
      </div>
      <div class="sr-only" aria-live="polite" aria-atomic="true">${this.announcement}</div>
      ${this.utDescription ? html`<span id="desc" class="sr-only">${this.utDescription}</span>` : nothing}
    `
  }
}

define('ut-address', UtAddress)
