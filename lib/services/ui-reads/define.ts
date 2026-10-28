import { z } from 'zod'
import type { ServiceContext } from '../context'

/**
 * A named read the dashboard runs server-side (providers phase 4). The
 * browser no longer queries the database: client components call
 * serverRead(name, args) (lib/server-read.ts), which posts to
 * /api/internal/read, which runs the read here as the signed-in user.
 *
 *  - `args`  zod schema for the browser's arguments (validated server-side).
 *  - `perm`  permission(s) the page using it requires — any of them. Omit for
 *            reads every signed-in user's pages need (pickers, own profile).
 *  - `run`   the query, on the session client (getDb(ctx)): RLS applies
 *            exactly as it did to the browser query it replaces, including
 *            the unified "All organizations" view (no current tenant).
 */
export interface UiRead<S extends z.ZodType = z.ZodType, R = unknown> {
  args: S
  perm?: string | readonly string[]
  run: (ctx: ServiceContext, args: z.output<S>) => Promise<R>
}

export function defineRead<S extends z.ZodType, R>(def: UiRead<S, R>): UiRead<S, R> {
  return def
}

/** Args schema for reads that take none. */
export const NO_ARGS = z.object({}).optional()

/** A row id from the browser (uuid or other text key). */
export const id = z.string().min(1).max(200)

/** Throw the PostgREST error the browser query would have returned. */
export function check<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message)
  return result.data
}
