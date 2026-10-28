/**
 * Result shape for server actions called from client components.
 *
 * A thrown error's message doesn't reach the browser in production builds
 * (Next.js replaces it with a generic digest), so actions whose failures the
 * UI shows return `{ error }` instead. Client-safe: no server imports.
 */

export type ActionFailure = { ok: false; error: string }
export type ActionResult<T = null> = { ok: true; data: T } | ActionFailure

/** The action's data, or throw its error (React Query fetchers). */
export function unwrapAction<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new Error(result.error)
  return result.data
}
