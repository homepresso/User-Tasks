/**
 * Server-side backstop for double submits: before inserting a named record
 * from a UI create dialog, look for one the same user created with the same
 * key fields in the last few seconds and reuse it instead of inserting again.
 *
 * The client guards (lib/submit-guard.ts) stop most repeats; this catches the
 * rest (two tabs, a retried request after a slow network, a stale button).
 * Matching is exact, so a deliberately repeated create after the window, or
 * with a different name, still creates a new record.
 *
 * Shared services apply it only for `ctx.source === 'ui'`: REST / MCP callers
 * expect POST to create, and they have their own retry semantics.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- generic query builder */

export const DUPLICATE_WINDOW_MS = 30_000

export interface RecentDuplicateOptions {
  /** Columns to return (default `id`). */
  select?: string
  /** Look-back window in ms (default 30 s). */
  windowMs?: number
  /** Timestamp column (default `created_at`). */
  createdAtColumn?: string
  /** Clock override for tests. */
  now?: number
}

/**
 * Newest row in `table` matching every `match` column (null → IS NULL) and
 * created within the window, or null. Best effort: a lookup error returns
 * null so the caller just creates the record as before.
 */
export async function findRecentDuplicate<T = Record<string, any>>(
  supabase: { from: (table: string) => any },
  table: string,
  match: Record<string, string | number | boolean | null | undefined>,
  options: RecentDuplicateOptions = {},
): Promise<T | null> {
  const since = new Date((options.now ?? Date.now()) - (options.windowMs ?? DUPLICATE_WINDOW_MS)).toISOString()
  const createdAt = options.createdAtColumn ?? 'created_at'
  try {
    let query = supabase.from(table).select(options.select ?? 'id')
    for (const [column, value] of Object.entries(match)) {
      if (value === undefined) continue
      query = value === null ? query.is(column, null) : query.eq(column, value)
    }
    const { data, error } = await query
      .gte(createdAt, since)
      .order(createdAt, { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error || !data) return null
    return data as T
  } catch {
    return null
  }
}
