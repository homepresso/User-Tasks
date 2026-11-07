/**
 * UserTasksControlElement: a plain HTMLElement base class with the contract
 * plumbing done — host properties with change callbacks, declared props,
 * the ut-* events, host requests and theme tokens.
 *
 *   class StarRating extends UserTasksControlElement {
 *     static controlProps = ['max']
 *     protected stateChanged(changed) { this.render() }
 *   }
 *   customElements.define('acme-star-rating', StarRating)
 */
import {
  CONTROL_EVENTS,
  type ControlContext,
  type ControlTheme,
  type LookupRequest,
  type LookupResult,
  type ThemeToken,
  type UploadRequest,
  type UploadResult,
  type FileRequest,
  type FileResult,
  type ReportRequest,
  type ReportResult,
  type TileRequest,
  type TileResult,
  type ControlRequestKind,
} from './contract'
import {
  HOST_PROPERTY_NAMES,
  accessibleDescription,
  coerceHostProperty,
  controlEventInit,
  defaultHostProperties,
  dispatchRequest,
  isDeclarablePropName,
  resolveProp,
  resolveThemeToken,
  validityDetail,
  type HostProperties,
  type HostPropertyName,
} from './core'

/** The helpers every control gets, from the base class or the mixin. */
export interface UserTasksControlHelpers {
  /** Accessible name: the host field's label. */
  readonly utLabel: string
  /** Accessible description: the help text, plus the error message while invalid. */
  readonly utDescription: string | null
  /** A declared prop: set by name wins over `props[name]`, then `fallback`. */
  prop<T = unknown>(name: string, fallback?: T): T
  /** `ut-change` — the user changed the value. */
  emitChange(value: unknown): void
  /** `ut-blur` — the user left the control. */
  emitBlur(): void
  /** `ut-validity` — only dispatched when validity or message changes. */
  setValidity(valid: boolean, message?: string): void
  /** `ut-resize` — optional; the runtime measures the element too. */
  emitResize(height: number): void
  /** `ut-request` — host services; needs the manifest capability (lookup → lookup, upload → files). */
  request(kind: 'lookup', payload: LookupRequest): Promise<LookupResult>
  request(kind: 'upload', payload: UploadRequest): Promise<UploadResult>
  request(kind: 'file', payload: FileRequest): Promise<FileResult>
  request(kind: 'report', payload: ReportRequest): Promise<ReportResult>
  request(kind: 'tile', payload: TileRequest): Promise<TileResult>
  /** A theme token's value (`theme.tokens`, else the `--ut-*` custom property), or `fallback`. */
  themeToken(name: ThemeToken, fallback?: string): string
}

/** Every control: the host properties plus the helpers. */
export interface UserTasksControlHost extends HostProperties, UserTasksControlHelpers {}

/** HTMLElement where it exists; a stand-in elsewhere so importing on a server does not throw. */
const BaseElement: typeof HTMLElement =
  typeof HTMLElement === 'undefined' ? (class {} as unknown as typeof HTMLElement) : HTMLElement

function computedToken(el: Element, name: ThemeToken): string | null {
  if (typeof getComputedStyle !== 'function') return null
  try {
    return getComputedStyle(el).getPropertyValue(`--${name}`)
  } catch {
    return null
  }
}

export class UserTasksControlElement extends BaseElement implements UserTasksControlHost {
  /** Declared prop names (manifest `props`) to expose as element properties, e.g. `['max', 'size']`. */
  static controlProps: readonly string[] = []

  #state: HostProperties = defaultHostProperties()
  #own: Record<string, unknown> = {}
  #changed = new Set<string>()
  #queued = false
  #lastValidity = ''

  constructor() {
    super()
    const ctor = this.constructor as typeof UserTasksControlElement
    // Properties set before the element was upgraded are own data properties
    // that would shadow the accessors: take them and re-apply below.
    const early: Array<[string, unknown]> = []
    for (const name of [...HOST_PROPERTY_NAMES, ...ctor.controlProps]) {
      if (Object.prototype.hasOwnProperty.call(this, name)) {
        early.push([name, (this as Record<string, unknown>)[name]])
        delete (this as Record<string, unknown>)[name]
      }
    }
    for (const name of ctor.controlProps) {
      if (!isDeclarablePropName(name) || name in this) continue
      Object.defineProperty(this, name, {
        configurable: true,
        enumerable: true,
        get: () => this.prop(name),
        set: (value: unknown) => {
          this.#own[name] = value
          this.#queue(name)
        },
      })
    }
    for (const [name, value] of early) (this as Record<string, unknown>)[name] = value
    // First render: everything is "changed".
    for (const name of HOST_PROPERTY_NAMES) this.#changed.add(name)
    this.#queue('props')
  }

  // ── Host properties ───────────────────────────────────────────────────────
  get value(): unknown { return this.#state.value }
  set value(v: unknown) { this.#set('value', v) }
  get disabled(): boolean { return this.#state.disabled }
  set disabled(v: boolean) { this.#set('disabled', v) }
  get readonly(): boolean { return this.#state.readonly }
  set readonly(v: boolean) { this.#set('readonly', v) }
  get required(): boolean { return this.#state.required }
  set required(v: boolean) { this.#set('required', v) }
  get invalid(): boolean { return this.#state.invalid }
  set invalid(v: boolean) { this.#set('invalid', v) }
  get error(): string | null { return this.#state.error }
  set error(v: string | null) { this.#set('error', v) }
  get props(): Record<string, unknown> { return this.#state.props }
  set props(v: Record<string, unknown>) { this.#set('props', v) }
  get theme(): ControlTheme | null { return this.#state.theme }
  set theme(v: ControlTheme | null) { this.#set('theme', v) }
  get locale(): string { return this.#state.locale }
  set locale(v: string) { this.#set('locale', v) }
  get context(): ControlContext | null { return this.#state.context }
  set context(v: ControlContext | null) { this.#set('context', v) }
  get label(): string { return this.#state.label }
  set label(v: string) { this.#set('label', v) }
  get description(): string | null { return this.#state.description }
  set description(v: string | null) { this.#set('description', v) }

  #set<K extends HostPropertyName>(name: K, value: unknown): void {
    const next = coerceHostProperty(name, value)
    if (Object.is(next, this.#state[name])) return
    this.#state[name] = next
    if (name === 'theme') this.#applyTheme()
    this.#queue(name)
  }

  #queue(name: string): void {
    this.#changed.add(name)
    if (this.#queued) return
    this.#queued = true
    queueMicrotask(() => {
      this.#queued = false
      const changed = new Set(this.#changed)
      this.#changed.clear()
      this.stateChanged(changed)
    })
  }

  /**
   * Called once per microtask after host properties or declared props
   * changed (names in `changed`; declared props by their own name). Render here.
   */
  protected stateChanged(_changed: ReadonlySet<string>): void {}

  /** Copies theme tokens onto the element (the runtime also sets them on :root). */
  #applyTheme(): void {
    const style = (this as unknown as HTMLElement).style
    const dataset = (this as unknown as HTMLElement).dataset
    if (!style || !dataset) return
    if (this.#state.theme?.mode === 'dark') dataset.mode = 'dark'
    else delete dataset.mode
    for (const [name, value] of Object.entries(this.#state.theme?.tokens ?? {})) {
      if (/^ut-[a-z-]+$/.test(name) && typeof value === 'string') style.setProperty(`--${name}`, value)
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  get utLabel(): string {
    return this.#state.label
  }

  get utDescription(): string | null {
    return accessibleDescription(this.#state.description, this.#state.invalid, this.#state.error)
  }

  prop<T = unknown>(name: string, fallback?: T): T {
    return resolveProp(this.#own, this.#state.props, name, fallback)
  }

  emitChange(value: unknown): void {
    this.#state.value = value === undefined ? null : value
    this.dispatchEvent(new CustomEvent(CONTROL_EVENTS.change, controlEventInit({ value: this.#state.value })))
  }

  emitBlur(): void {
    this.dispatchEvent(new CustomEvent(CONTROL_EVENTS.blur, controlEventInit({})))
  }

  setValidity(valid: boolean, message?: string): void {
    const detail = validityDetail(valid, message)
    const key = JSON.stringify(detail)
    if (key === this.#lastValidity) return
    this.#lastValidity = key
    this.dispatchEvent(new CustomEvent(CONTROL_EVENTS.validity, controlEventInit(detail)))
  }

  emitResize(height: number): void {
    if (!Number.isFinite(height) || height <= 0) return
    this.dispatchEvent(new CustomEvent(CONTROL_EVENTS.resize, controlEventInit({ height: Math.ceil(height) })))
  }

  request(kind: 'lookup', payload: LookupRequest): Promise<LookupResult>
  request(kind: 'upload', payload: UploadRequest): Promise<UploadResult>
  request(kind: 'file', payload: FileRequest): Promise<FileResult>
  request(kind: 'report', payload: ReportRequest): Promise<ReportResult>
  request(kind: 'tile', payload: TileRequest): Promise<TileResult>
  request(kind: ControlRequestKind, payload: unknown): Promise<unknown> {
    return dispatchRequest(this, kind, payload)
  }

  themeToken(name: ThemeToken, fallback = ''): string {
    return resolveThemeToken(this.#state.theme, name, computedToken(this as unknown as Element, name), fallback)
  }
}
