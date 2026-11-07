/**
 * <ut-star-rating> — a star rating form control for UserTasks.
 *
 * Plain custom element, no dependencies, no build step: this file IS the ES
 * module you upload (with manifest.json). It follows the UserTasks form
 * control contract (https://usertasks.com/docs/tasks/custom-form-controls):
 *
 *   the host sets   value, disabled, readonly, required, invalid, error,
 *                   props, theme, locale, context, label, description
 *                   and each declared prop by name (max, allow_clear, size)
 *   it dispatches   ut-change {value}, ut-blur {}, ut-validity {valid, message?},
 *                   ut-resize {height}  (bubbling, composed CustomEvents)
 *
 * The value is a whole number of stars (1..max) or null when there is no
 * rating, so the form's own "required" check works on the server too.
 */

const TAG = 'ut-star-rating'

/** Star size per `size` prop: every option is a target of at least 24 × 24 px (WCAG 2.5.8). */
const SIZES = { small: 24, medium: 32, large: 40 }
const DEFAULTS = { max: 5, allow_clear: false, size: 'medium' }
const DECLARED_PROPS = ['max', 'allow_clear', 'size']
const HOST_PROPS = ['value', 'disabled', 'readonly', 'required', 'invalid', 'error', 'props', 'theme', 'locale', 'context', 'label', 'description']

const STAR_PATH = 'M12 2.6l2.9 5.9 6.5.95-4.7 4.6 1.1 6.5L12 17.5l-5.8 3.05 1.1-6.5-4.7-4.6 6.5-.95L12 2.6z'

const STYLES = `
:host {
  display: block;
  --_primary: var(--ut-primary, #2563eb);
  --_primary-light: var(--ut-primary-light, #dbeafe);
  --_muted: var(--ut-muted-text, #4b5563);
  --_focus: var(--ut-focus-ring, #2563eb);
  --_error: var(--ut-error, #b91c1c);
  --_radius: var(--ut-radius, 8px);
  --_star: 32px;
  color: var(--ut-text, #111827);
  font-family: var(--ut-font-family, system-ui, sans-serif);
  font-size: var(--ut-font-size, 14px);
}
:host([data-mode="dark"]) {
  color-scheme: dark;
  --_primary: var(--ut-primary, #60a5fa);
  --_primary-light: var(--ut-primary-light, #1e3a8a);
  --_muted: var(--ut-muted-text, #9ca3af);
  --_focus: var(--ut-focus-ring, #93c5fd);
  --_error: var(--ut-error, #f87171);
  color: var(--ut-text, #f3f4f6);
}
:host([hidden]) { display: none; }
.group {
  display: inline-flex;
  gap: 4px;
  padding: 4px;
  border-radius: var(--_radius);
}
:host([data-invalid]) .group { outline: 2px solid var(--_error); outline-offset: 0; }
.star {
  display: inline-grid;
  place-items: center;
  inline-size: var(--_star);
  block-size: var(--_star);
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
:host([data-readonly]) .star { cursor: default; }
:host([data-disabled]) .star { cursor: not-allowed; opacity: 0.5; }
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

function emit(el, type, detail) {
  el.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }))
}

/** Whole number of stars, 0 = no rating. */
function toRating(value, max) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0
  return Math.min(max, Math.max(0, Math.round(n)))
}

function starLabel(n) {
  return n === 1 ? '1 star' : `${n} stars`
}

class UtStarRating extends HTMLElement {
  #state = {
    value: null, disabled: false, readonly: false, required: false, invalid: false, error: null,
    props: {}, theme: null, locale: 'en', context: null, label: '', description: null,
  }
  /** Declared props set one by one (el.max = 7) win over the `props` object. */
  #own = {}
  #rating = 0
  #hover = 0
  #renderQueued = false
  #lastValidity = ''
  #lastHeight = 0
  #group
  #desc
  #err
  #stars = []
  #resize

  constructor() {
    super()
    const root = this.attachShadow({ mode: 'open', delegatesFocus: true })
    root.innerHTML = `<style>${STYLES}</style>
      <div class="group" part="group" role="radiogroup"></div>
      <span class="sr" id="desc"></span>
      <span class="sr" id="err"></span>`
    this.#group = root.querySelector('.group')
    this.#desc = root.getElementById('desc')
    this.#err = root.getElementById('err')

    this.#group.addEventListener('keydown', (event) => this.#onKeyDown(event))
    this.#group.addEventListener('click', (event) => {
      const star = event.target.closest?.('.star')
      if (!star) return
      const n = Number(star.dataset.n)
      this.#select(this.#prop('allow_clear') && n === this.#rating ? 0 : n, n)
    })
    this.#group.addEventListener('pointerover', (event) => {
      const star = event.target.closest?.('.star')
      if (star && this.#interactive()) this.#setHover(Number(star.dataset.n))
    })
    this.#group.addEventListener('pointerleave', () => this.#setHover(0))
    // ut-blur when focus leaves the control (not when it moves between stars).
    this.#group.addEventListener('focusout', (event) => {
      if (!event.relatedTarget || !root.contains(event.relatedTarget)) emit(this, 'ut-blur', {})
    })
  }

  connectedCallback() {
    // Properties set before the element was defined are own data properties
    // that shadow the accessors: re-apply them through the setters.
    for (const name of [...HOST_PROPS, ...DECLARED_PROPS]) {
      if (Object.prototype.hasOwnProperty.call(this, name)) {
        const value = this[name]
        delete this[name]
        this[name] = value
      }
    }
    this.#render()
    if (!this.#resize && typeof ResizeObserver !== 'undefined') {
      this.#resize = new ResizeObserver(() => {
        const height = Math.ceil(this.getBoundingClientRect().height)
        if (height > 0 && height !== this.#lastHeight) {
          this.#lastHeight = height
          emit(this, 'ut-resize', { height })
        }
      })
    }
    this.#resize?.observe(this)
  }

  disconnectedCallback() {
    this.#resize?.disconnect()
  }

  /** Focus the checked star (or the first one): used by the label and by Tab into the frame. */
  focus(options) {
    const target = this.#stars.find((star) => star.tabIndex === 0) ?? this.#stars[0]
    if (target) target.focus(options)
    else super.focus(options)
  }

  // ── Host properties ──────────────────────────────────────────────────────
  get value() { return toRating(this.#state.value, this.#prop('max')) || null }
  set value(v) { this.#state.value = v; this.#queue() }
  get disabled() { return this.#state.disabled }
  set disabled(v) { this.#state.disabled = Boolean(v); this.#queue() }
  get readonly() { return this.#state.readonly }
  set readonly(v) { this.#state.readonly = Boolean(v); this.#queue() }
  get required() { return this.#state.required }
  set required(v) { this.#state.required = Boolean(v); this.#queue() }
  get invalid() { return this.#state.invalid }
  set invalid(v) { this.#state.invalid = Boolean(v); this.#queue() }
  get error() { return this.#state.error }
  set error(v) { this.#state.error = v == null || v === '' ? null : String(v); this.#queue() }
  get props() { return this.#state.props }
  set props(v) { this.#state.props = v && typeof v === 'object' ? v : {}; this.#queue() }
  get theme() { return this.#state.theme }
  set theme(v) { this.#state.theme = v && typeof v === 'object' ? v : null; this.#applyTheme(); this.#queue() }
  get locale() { return this.#state.locale }
  set locale(v) { this.#state.locale = typeof v === 'string' && v ? v : 'en'; this.#queue() }
  get context() { return this.#state.context }
  set context(v) { this.#state.context = v ?? null }
  get label() { return this.#state.label }
  set label(v) { this.#state.label = v == null ? '' : String(v); this.#queue() }
  get description() { return this.#state.description }
  set description(v) { this.#state.description = v == null || v === '' ? null : String(v); this.#queue() }

  // ── Declared props (manifest.json "props") ───────────────────────────────
  get max() { return this.#prop('max') }
  set max(v) { this.#own.max = v; this.#queue() }
  get allow_clear() { return this.#prop('allow_clear') }
  set allow_clear(v) { this.#own.allow_clear = v; this.#queue() }
  get size() { return this.#prop('size') }
  set size(v) { this.#own.size = v; this.#queue() }

  #prop(name) {
    const raw = this.#own[name] !== undefined ? this.#own[name] : this.#state.props[name]
    if (name === 'max') {
      const n = Math.round(Number(raw))
      return Number.isFinite(n) && n >= 1 ? Math.min(10, n) : DEFAULTS.max
    }
    if (name === 'allow_clear') return raw === undefined ? DEFAULTS.allow_clear : raw === true || raw === 'true'
    if (name === 'size') return Object.prototype.hasOwnProperty.call(SIZES, raw) ? raw : DEFAULTS.size
    return raw
  }

  #interactive() {
    return !this.#state.disabled && !this.#state.readonly
  }

  #applyTheme() {
    const theme = this.#state.theme
    if (theme?.mode === 'dark') this.dataset.mode = 'dark'
    else delete this.dataset.mode
    // The runtime also sets these on :root; setting them here keeps the
    // control right when it is rendered inline (a trusted control).
    for (const [name, value] of Object.entries(theme?.tokens ?? {})) {
      if (/^ut-[a-z-]+$/.test(name) && (typeof value === 'string' || typeof value === 'number')) {
        this.style.setProperty(`--${name}`, String(value))
      }
    }
  }

  #queue() {
    if (this.#renderQueued) return
    this.#renderQueued = true
    queueMicrotask(() => {
      this.#renderQueued = false
      this.#render()
    })
  }

  /** A user choice: update, re-render, tell the host. */
  #select(rating, focusStar) {
    if (!this.#interactive()) return
    const max = this.#prop('max')
    const next = Math.min(max, Math.max(0, rating))
    if (next !== this.#rating) {
      this.#rating = next
      this.#state.value = next === 0 ? null : next
      this.#render()
      emit(this, 'ut-change', { value: this.value })
    }
    const star = this.#stars[(focusStar ?? next) - 1] ?? this.#stars[0]
    star?.focus()
  }

  #setHover(n) {
    if (n === this.#hover) return
    this.#hover = n
    this.#paint()
  }

  #onKeyDown(event) {
    if (!this.#interactive()) return
    const max = this.#prop('max')
    const rtl = getComputedStyle(this).direction === 'rtl'
    const current = this.#rating
    const focused = Number(this.shadowRoot.activeElement?.dataset?.n) || current || 1
    let next
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
        if (!this.#prop('allow_clear')) return
        event.preventDefault()
        this.#select(0, 1)
        return
      default:
        return
    }
    event.preventDefault()
    this.#select(Math.min(max, Math.max(1, next)))
  }

  #render() {
    const max = this.#prop('max')
    this.#rating = toRating(this.#state.value, max)

    if (this.#stars.length !== max) {
      const focusedIndex = this.#stars.indexOf(this.shadowRoot.activeElement)
      this.#group.replaceChildren()
      this.#stars = Array.from({ length: max }, (_, i) => {
        const star = document.createElement('span')
        star.className = 'star'
        star.dataset.n = String(i + 1)
        star.setAttribute('role', 'radio')
        star.setAttribute('aria-label', starLabel(i + 1))
        star.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${STAR_PATH}"/></svg>`
        this.#group.append(star)
        return star
      })
      if (focusedIndex >= 0) this.#stars[Math.min(focusedIndex, max - 1)].focus()
    }

    const s = this.#state
    this.toggleAttribute('data-disabled', s.disabled)
    this.toggleAttribute('data-readonly', s.readonly)
    this.toggleAttribute('data-invalid', s.invalid)
    this.#group.style.setProperty('--_star', `${SIZES[this.#prop('size')]}px`)

    // Accessible name and description come from the host field.
    this.#group.setAttribute('aria-label', s.label || 'Rating')
    this.#desc.textContent = s.description ?? ''
    this.#err.textContent = s.invalid && s.error ? s.error : ''
    const describedBy = [s.description ? 'desc' : '', s.invalid && s.error ? 'err' : ''].filter(Boolean).join(' ')
    if (describedBy) this.#group.setAttribute('aria-describedby', describedBy)
    else this.#group.removeAttribute('aria-describedby')
    this.#setAria('aria-required', s.required)
    this.#setAria('aria-invalid', s.invalid)
    this.#setAria('aria-readonly', s.readonly)
    this.#setAria('aria-disabled', s.disabled)

    const tabStop = this.#rating || 1
    this.#stars.forEach((star, i) => {
      const n = i + 1
      star.setAttribute('aria-checked', String(n === this.#rating))
      star.tabIndex = !s.disabled && n === tabStop ? 0 : -1
      if (s.disabled) star.setAttribute('aria-disabled', 'true')
      else star.removeAttribute('aria-disabled')
    })
    this.#paint()
    this.#reportValidity()
  }

  #paint() {
    const hover = this.#interactive() ? this.#hover : 0
    this.#stars.forEach((star, i) => {
      const n = i + 1
      star.classList.toggle('on', hover === 0 && n <= this.#rating)
      star.classList.toggle('preview', hover > 0 && n <= hover)
    })
  }

  #setAria(name, on) {
    if (on) this.#group.setAttribute(name, 'true')
    else this.#group.removeAttribute(name)
  }

  /** manifest validation.reports_validity: invalid when required and there is no rating. */
  #reportValidity() {
    const valid = !(this.#state.required && this.#rating === 0)
    const detail = valid ? { valid: true } : { valid: false, message: 'Choose a rating.' }
    const key = JSON.stringify(detail)
    if (key === this.#lastValidity) return
    this.#lastValidity = key
    emit(this, 'ut-validity', detail)
  }
}

if (!customElements.get(TAG)) customElements.define(TAG, UtStarRating)

export { UtStarRating }
