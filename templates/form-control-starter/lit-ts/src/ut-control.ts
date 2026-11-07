/**
 * The bits of the UserTasks form control contract this control uses, inline
 * so the starter has no dependency beyond Lit. (The @usertasks/form-control
 * package will offer the same as `UserTasksControlMixin` once published.)
 *
 * Full contract: https://usertasks.com/docs/tasks/custom-form-controls
 */
import type { PropertyDeclarations } from 'lit'

export type ThemeToken =
  | 'ut-primary' | 'ut-on-primary' | 'ut-primary-text' | 'ut-primary-light'
  | 'ut-text' | 'ut-muted-text' | 'ut-surface' | 'ut-card' | 'ut-border'
  | 'ut-input-bg' | 'ut-input-text' | 'ut-focus-ring' | 'ut-error' | 'ut-success'
  | 'ut-radius' | 'ut-font-family' | 'ut-font-size'

export interface ControlTheme {
  mode: 'light' | 'dark'
  tokens: Partial<Record<ThemeToken, string>>
}

export interface ControlContext {
  fields: Record<string, unknown>
  form_id?: string | null
  task_id?: string | null
  workflow_id?: string | null
  field_key: string
}

export type ControlRequestKind = 'lookup' | 'upload'
export interface LookupResult { items: Array<{ value: string; label: string; description?: string; data?: Record<string, unknown> }>; truncated?: boolean }
export interface UploadResult { id: string; name: string; size: number; type: string }

/**
 * The properties the host sets on every control. None are attributes: the
 * runtime sets properties. `disabled`, `readonly` and `invalid` are reflected
 * so styles can use :host([disabled]).
 */
export const HOST_PROPERTIES: PropertyDeclarations = {
  value: { attribute: false },
  disabled: { type: Boolean, reflect: true },
  readonly: { type: Boolean, reflect: true },
  required: { type: Boolean },
  invalid: { type: Boolean, reflect: true },
  error: { attribute: false },
  props: { attribute: false },
  theme: { attribute: false },
  locale: { attribute: false },
  context: { attribute: false },
  label: { attribute: false },
  description: { attribute: false },
}

/** Dispatch a contract event (bubbling and composed, so it leaves the shadow root). */
export function emit(el: HTMLElement, type: 'ut-change' | 'ut-blur' | 'ut-validity' | 'ut-resize', detail: object): void {
  el.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }))
}

/** Ask the host for a service; needs the matching manifest capability (lookup → lookup, upload → files). */
export function request(el: HTMLElement, kind: 'lookup', payload: { query: string }): Promise<LookupResult>
export function request(el: HTMLElement, kind: 'upload', payload: { name: string; type: string; bytes: ArrayBuffer }): Promise<UploadResult>
export function request(el: HTMLElement, kind: ControlRequestKind, payload: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    el.dispatchEvent(new CustomEvent('ut-request', { detail: { kind, payload, resolve, reject }, bubbles: true, composed: true }))
  })
}

/**
 * Copy theme tokens onto the element as CSS custom properties. The runtime
 * already sets them on :root; this keeps an inline (trusted) control right.
 */
export function applyTheme(el: HTMLElement, theme: ControlTheme | null | undefined): void {
  if (theme?.mode === 'dark') el.dataset.mode = 'dark'
  else delete el.dataset.mode
  for (const [name, value] of Object.entries(theme?.tokens ?? {})) {
    if (/^ut-[a-z-]+$/.test(name) && (typeof value === 'string' || typeof value === 'number')) el.style.setProperty(`--${name}`, String(value))
  }
}

/** Report the rendered height when it changes (the runtime measures too). */
export function observeHeight(el: HTMLElement): ResizeObserver | null {
  if (typeof ResizeObserver === 'undefined') return null
  let last = 0
  const observer = new ResizeObserver(() => {
    const height = Math.ceil(el.getBoundingClientRect().height)
    if (height > 0 && height !== last) {
      last = height
      emit(el, 'ut-resize', { height })
    }
  })
  observer.observe(el)
  return observer
}
