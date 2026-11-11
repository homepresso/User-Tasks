/**
 * UserTasksControlMixin: the contract helpers for Lit (or any base class
 * that turns `static properties` into reactive accessors), without
 * importing Lit.
 *
 *   import { LitElement, html } from 'lit'
 *   import { UserTasksControlMixin } from '@user-tasks/form-control'
 *
 *   class StarRating extends UserTasksControlMixin(LitElement) {
 *     static properties = { max: { type: Number } }
 *     render() { return html`…${this.utLabel}…` }
 *   }
 *
 * The mixin adds the host properties (value, disabled, readonly, required,
 * invalid, error, props, theme, locale, context, label, description) to
 * `static properties` — merged with the base's — and the helpers
 * emitChange, emitBlur, setValidity, emitResize, request, prop, themeToken,
 * utLabel and utDescription. It declares no class fields, so Lit's
 * accessors are not shadowed.
 */
import { CONTROL_EVENTS, type ControlRequestKind, type ThemeToken } from './contract'
import {
  LIT_HOST_PROPERTIES,
  accessibleDescription,
  controlEventInit,
  dispatchRequest,
  resolveProp,
  resolveThemeToken,
  validityDetail,
  type LitLikePropertyDeclaration,
} from './core'
import type { UserTasksControlHost } from './element'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Constructor<T = HTMLElement> = new (...args: any[]) => T

/** What the mixin adds to the class (statics). */
export interface UserTasksControlStatics {
  properties: Record<string, LitLikePropertyDeclaration>
}

const LAST_VALIDITY = Symbol('ut-last-validity')

function computedToken(el: Element, name: ThemeToken): string | null {
  if (typeof getComputedStyle !== 'function') return null
  try {
    return getComputedStyle(el).getPropertyValue(`--${name}`)
  } catch {
    return null
  }
}

export function UserTasksControlMixin<TBase extends Constructor<HTMLElement>>(
  Base: TBase,
): TBase & Constructor<UserTasksControlHost> & UserTasksControlStatics {
  const inherited = ((Base as unknown as Partial<UserTasksControlStatics>).properties ?? {}) as Record<string, LitLikePropertyDeclaration>

  class UserTasksControl extends Base {
    static properties: Record<string, LitLikePropertyDeclaration> = { ...inherited, ...LIT_HOST_PROPERTIES }

    get #host(): UserTasksControlHost {
      return this as unknown as UserTasksControlHost
    }

    get utLabel(): string {
      const label = this.#host.label
      return typeof label === 'string' ? label : ''
    }

    get utDescription(): string | null {
      const host = this.#host
      return accessibleDescription(host.description ?? null, Boolean(host.invalid), host.error ?? null)
    }

    prop<T = unknown>(name: string, fallback?: T): T {
      const own = (this as unknown as Record<string, unknown>)[name]
      return resolveProp({ [name]: own }, this.#host.props, name, fallback)
    }

    emitChange(value: unknown): void {
      const next = value === undefined ? null : value
      this.#host.value = next
      this.dispatchEvent(new CustomEvent(CONTROL_EVENTS.change, controlEventInit({ value: next })))
    }

    emitBlur(): void {
      this.dispatchEvent(new CustomEvent(CONTROL_EVENTS.blur, controlEventInit({})))
    }

    setValidity(valid: boolean, message?: string): void {
      const detail = validityDetail(valid, message)
      const key = JSON.stringify(detail)
      const self = this as unknown as Record<symbol, string>
      if (self[LAST_VALIDITY] === key) return
      self[LAST_VALIDITY] = key
      this.dispatchEvent(new CustomEvent(CONTROL_EVENTS.validity, controlEventInit(detail)))
    }

    emitResize(height: number): void {
      if (!Number.isFinite(height) || height <= 0) return
      this.dispatchEvent(new CustomEvent(CONTROL_EVENTS.resize, controlEventInit({ height: Math.ceil(height) })))
    }

    request(kind: ControlRequestKind, payload: unknown): Promise<unknown> {
      return dispatchRequest(this, kind, payload)
    }

    themeToken(name: ThemeToken, fallback = ''): string {
      return resolveThemeToken(this.#host.theme ?? null, name, computedToken(this, name), fallback)
    }
  }

  return UserTasksControl as unknown as TBase & Constructor<UserTasksControlHost> & UserTasksControlStatics
}
