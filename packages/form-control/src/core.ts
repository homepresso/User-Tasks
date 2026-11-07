/**
 * Pure helpers shared by the base element and the Lit mixin. No DOM access
 * at import time, so they run (and are tested) anywhere.
 */
import {
  CONTROL_EVENTS,
  RESERVED_ELEMENT_PROPERTIES,
  THEME_TOKENS,
  type ControlContext,
  type ControlRequestKind,
  type ControlTheme,
  type LookupRequest,
  type LookupResult,
  type ThemeToken,
  type UploadRequest,
  type UploadResult,
} from './contract'

/** The properties the host sets on every control (besides each declared prop by name). */
export const HOST_PROPERTY_NAMES = [
  'value', 'disabled', 'readonly', 'required', 'invalid', 'error', 'props', 'theme', 'locale', 'context', 'label', 'description',
] as const
export type HostPropertyName = (typeof HOST_PROPERTY_NAMES)[number]

export interface HostProperties {
  value: unknown
  disabled: boolean
  readonly: boolean
  required: boolean
  invalid: boolean
  error: string | null
  props: Record<string, unknown>
  theme: ControlTheme | null
  locale: string
  context: ControlContext | null
  label: string
  description: string | null
}

export function defaultHostProperties(): HostProperties {
  return {
    value: null,
    disabled: false,
    readonly: false,
    required: false,
    invalid: false,
    error: null,
    props: {},
    theme: null,
    locale: 'en',
    context: null,
    label: '',
    description: null,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Normalise a value the host (or a careless caller) set, so a control never sees the wrong type. */
export function coerceHostProperty<K extends HostPropertyName>(name: K, value: unknown): HostProperties[K] {
  let out: unknown
  switch (name) {
    case 'disabled':
    case 'readonly':
    case 'required':
    case 'invalid':
      out = value === true || value === 'true' || value === ''
      break
    case 'error':
    case 'description':
      out = value == null || value === '' ? null : String(value)
      break
    case 'label':
      out = value == null ? '' : String(value)
      break
    case 'locale':
      out = typeof value === 'string' && value ? value : 'en'
      break
    case 'props':
      out = isRecord(value) ? value : {}
      break
    case 'theme':
      out = isRecord(value) && (value.mode === 'light' || value.mode === 'dark') ? { mode: value.mode, tokens: isRecord(value.tokens) ? value.tokens : {} } : null
      break
    case 'context':
      out = isRecord(value) ? value : null
      break
    default:
      out = value === undefined ? null : value
  }
  return out as HostProperties[K]
}

/** A declared prop's value: set by name (`el.max = 7`) wins over `props.max`, then the fallback. */
export function resolveProp<T>(own: Record<string, unknown>, props: Record<string, unknown> | null | undefined, name: string, fallback?: T): T {
  if (own[name] !== undefined) return own[name] as T
  if (props && props[name] !== undefined) return props[name] as T
  return fallback as T
}

/** Whether a manifest prop can be exposed as an element property. */
export function isDeclarablePropName(name: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(name) && !RESERVED_ELEMENT_PROPERTIES.has(name)
}

/** Init for a contract event: bubbling and composed, so it leaves the shadow root. */
export function controlEventInit<T>(detail: T): CustomEventInit<T> {
  return { detail, bubbles: true, composed: true }
}

/** `ut-validity` detail, with the message trimmed to what the bridge carries. */
export function validityDetail(valid: boolean, message?: string): { valid: boolean; message?: string } {
  if (valid) return { valid: true }
  const text = typeof message === 'string' ? message.slice(0, 500) : ''
  return text ? { valid: false, message: text } : { valid: false }
}

/** Accessible description: the help text, then the error while the field is invalid. */
export function accessibleDescription(description: string | null, invalid: boolean, error: string | null): string | null {
  const parts = [description, invalid ? error : null].filter((part): part is string => typeof part === 'string' && part.trim() !== '')
  return parts.length ? parts.join(' ') : null
}

/** A theme token from `theme.tokens`, else the computed CSS custom property, else the fallback. */
export function resolveThemeToken(theme: ControlTheme | null, name: ThemeToken, computed?: string | null, fallback = ''): string {
  const fromTheme = theme?.tokens?.[name]
  if (typeof fromTheme === 'string' && fromTheme) return fromTheme
  const css = computed?.trim()
  return css || fallback
}

export function isThemeToken(name: string): name is ThemeToken {
  return (THEME_TOKENS as readonly string[]).includes(name)
}

/** The `ut-request` detail; the host settles it with `resolve` / `reject`. */
export interface ControlRequestDetail<R = unknown> {
  kind: ControlRequestKind
  payload: unknown
  resolve: (result: R) => void
  reject: (error: Error) => void
}

export interface ControlRequestFn {
  (kind: 'lookup', payload: LookupRequest): Promise<LookupResult>
  (kind: 'upload', payload: UploadRequest): Promise<UploadResult>
}

/**
 * Dispatch `ut-request` from `target` and wait for the host. Rejects if
 * nobody answers within `timeoutMs` (default 30 s), so a control never hangs.
 */
export function dispatchRequest<R>(target: EventTarget, kind: ControlRequestKind, payload: unknown, timeoutMs = 30_000): Promise<R> {
  return new Promise<R>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => finish(() => reject(new Error(`${kind} request timed out`))), timeoutMs)
    function finish(fn: () => void) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }
    const detail: ControlRequestDetail<R> = {
      kind,
      payload,
      resolve: (result) => finish(() => resolve(result)),
      reject: (error) => finish(() => reject(error instanceof Error ? error : new Error(String(error)))),
    }
    target.dispatchEvent(new CustomEvent(CONTROL_EVENTS.request, controlEventInit(detail)))
  })
}

/** Lit-style property declarations for the host properties (structurally a Lit `PropertyDeclarations`). */
export interface LitLikePropertyDeclaration {
  attribute?: boolean | string
  type?: unknown
  reflect?: boolean
  state?: boolean
}

export const LIT_HOST_PROPERTIES: Readonly<Record<HostPropertyName, LitLikePropertyDeclaration>> = {
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
