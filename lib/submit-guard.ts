/**
 * Framework-free guard against double submits (double click, double Enter,
 * a second click while a slow request is in flight).
 *
 * Why a synchronous flag: React 19 renders state set inside a form
 * `action={fn}` only when the action ends, so `disabled={saving}` never takes
 * effect while the action runs; and two clicks in the same frame both fire
 * before any re-render even with `useTransition`. The guard flips a plain
 * variable before the first `await`, so a second call is dropped immediately.
 *
 * Next.js `redirect()` throws an error whose digest starts with
 * `NEXT_REDIRECT`. That means the submit succeeded and the page is navigating
 * away, so the guard stays locked (no window for another submit) and the error
 * is rethrown for Next to handle.
 */

export interface SubmitGuard {
  /** True while a run is in flight (or after a redirect locked the guard). */
  readonly pending: boolean
  /**
   * Run `fn` unless another run is in flight. Returns `fn`'s result, or
   * `undefined` when the call was ignored.
   */
  run<T>(fn: () => T | Promise<T>): Promise<T | undefined>
  /** Unlock the guard explicitly (e.g. when a dialog that redirected is reopened). */
  reset(): void
}

export interface SubmitGuardOptions {
  /** Called whenever `pending` changes (the React hook mirrors it into state). */
  onPendingChange?: (pending: boolean) => void
}

/** True for the error Next.js throws from `redirect()` / `permanentRedirect()`. */
export function isRedirectError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const digest = (err as { digest?: unknown }).digest
  return typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT')
}

/**
 * `.catch(ignoreRedirect)` for guarded onClick handlers: a server action that
 * redirects rejects with NEXT_REDIRECT after Next has already started the
 * navigation, so the rejection is expected (the guard stays locked) and only
 * other errors propagate.
 */
export function ignoreRedirect(err: unknown): undefined {
  if (!isRedirectError(err)) throw err
  return undefined
}

export function createSubmitGuard(options: SubmitGuardOptions = {}): SubmitGuard {
  let pending = false

  function set(next: boolean) {
    if (pending === next) return
    pending = next
    options.onPendingChange?.(next)
  }

  return {
    get pending() {
      return pending
    },
    async run<T>(fn: () => T | Promise<T>): Promise<T | undefined> {
      if (pending) return undefined
      set(true)
      try {
        const result = await fn()
        set(false)
        return result
      } catch (err) {
        // A redirect means success + navigation: stay locked.
        if (!isRedirectError(err)) set(false)
        throw err
      }
    },
    reset() {
      set(false)
    },
  }
}
