import type { ActionResult } from '@/lib/action-result'
import { isServiceError } from '@/lib/services/context'

/**
 * Run a server action body and turn failures into `{ ok: false, error }`.
 * ServiceErrors (and plain Errors, which carry the database message as the
 * browser path did) keep their message; anything else is logged and gets
 * `fallback`. Not a server action itself: import it from 'use server' modules.
 */
export async function runAction<T>(label: string, fallback: string, fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (error) {
    if (isServiceError(error)) return { ok: false, error: error.message }
    console.error(`[${label}]`, error)
    if (error instanceof Error && error.message) return { ok: false, error: error.message }
    return { ok: false, error: fallback }
  }
}
