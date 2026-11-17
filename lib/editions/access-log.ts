/**
 * The edition download access log (public.edition_pull_log, migration
 * 20270118090000_edition_pull_log): one row per pull-token request, issued
 * or refused. Service role only.
 *
 * Never logged: the token, the licence document, the IP address (a salted
 * hash only), credentials of any kind. A missing table (migration not
 * applied) or a failed insert never affects the response.
 */

export interface PullLogEntry {
  edition: string
  outcome: 'issued' | 'denied' | 'not_found' | 'error'
  code?: string | null
  licence_id?: string | null
  trial?: boolean | null
  purpose?: string | null
  requested_version?: string | null
  edition_version?: string | null
  token_id?: string | null
  token_expires_at?: string | null
  ip_hash?: string | null
  user_agent?: string | null
  instance_id?: string | null
}

let warned = false

export async function recordPullLog(entry: PullLogEntry): Promise<void> {
  try {
    const { hasServiceDb, getServiceDb } = await import('@/lib/providers/db')
    if (!hasServiceDb()) return
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- edition_pull_log is not in the generated types until the migration is applied */
    const db = getServiceDb() as any
    const { error } = await db.from('edition_pull_log').insert({ ...entry, user_agent: entry.user_agent?.slice(0, 200) ?? null })
    if (error && !warned) {
      warned = true
      console.warn(`[editions] edition_pull_log unavailable (apply migration 20270118090000_edition_pull_log): ${error.message}`)
    }
  } catch (error) {
    if (!warned) {
      warned = true
      console.warn(`[editions] access log failed: ${(error as Error).message}`)
    }
  }
}
