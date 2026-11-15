/**
 * Unread tasks: the rule, as the database applies it (task_unread_ids in
 * supabase/migrations/20270115300000_task_reads.sql). Client-safe and pure:
 * the lists get `unread` from the server; this module states the rule for
 * tests and docs, and patches cached rows optimistically (mark read /
 * unread) until the refetch lands.
 *
 * A task is unread for a person when all of these hold:
 *  1. it is open: todo, in progress or blocked, and not deleted (completed,
 *     cancelled and draft tasks are never unread);
 *  2. the person holds it: its assignee, a collaborator or claim candidate
 *     (not declined), or a member of the assigned team of an unassigned
 *     team task;
 *  3. they have not opened it since it became theirs: no read, or the read
 *     is older than `since` — the task's routed_at (set when it is created,
 *     when the assignee or team changes — assign, reassign, delegate,
 *     escalate, claim, release — and when it comes back to work from
 *     completed / cancelled / draft: reopened, published, sent back), and
 *     for a collaborator the later of that and when they were added.
 *
 * Other edits (fields, comments, progress) don't make a task unread again,
 * so it stays read while its owner works on it.
 */

export const UNREAD_OPEN_STATUSES = ['todo', 'in_progress', 'blocked'] as const

export type TaskHolding =
  | { kind: 'assignee' }
  | { kind: 'team' }
  | { kind: 'collaborator'; addedAt: string | Date; declined?: boolean }
  | { kind: 'none' }

export interface UnreadInput {
  status: string
  deleted?: boolean
  /** How the person holds the task (none: they only see it — manager, assigner, follower, viewer). */
  holding: TaskHolding
  /** tasks.routed_at: when the task last reached its holders. */
  routedAt: string | Date
  /** task_reads.seen_at for this person, or null (never opened). */
  seenAt: string | Date | null | undefined
}

const ms = (value: string | Date) => (value instanceof Date ? value.getTime() : new Date(value).getTime())

export function isOpenForUnread(status: string): boolean {
  return (UNREAD_OPEN_STATUSES as readonly string[]).includes(status)
}

/** When the task became the person's (null: they don't hold it). */
export function unreadSince(holding: TaskHolding, routedAt: string | Date): number | null {
  switch (holding.kind) {
    case 'assignee':
    case 'team':
      return ms(routedAt)
    case 'collaborator':
      return holding.declined ? null : Math.max(ms(routedAt), ms(holding.addedAt))
    default:
      return null
  }
}

/** The rule (see the module comment). */
export function isTaskUnread(input: UnreadInput): boolean {
  if (input.deleted || !isOpenForUnread(input.status)) return false
  const since = unreadSince(input.holding, input.routedAt)
  if (since === null || !Number.isFinite(since)) return false
  if (input.seenAt === null || input.seenAt === undefined) return true
  return ms(input.seenAt) < since
}

/** Rows with `unread` set from the ids the server reported unread (absent ids: read). */
export function withUnreadFlags<T extends { id: string }>(rows: T[], unreadIds: ReadonlySet<string>): Array<T & { unread: boolean }> {
  return rows.map((row) => ({ ...row, unread: unreadIds.has(String(row.id)) }))
}

/** A row is shown as unread only while it is open (a cached row that was just completed loses the dot at once). */
export function showsUnread(row: { unread?: boolean | null; status?: string | null; display_status?: string | null }): boolean {
  if (!row.unread) return false
  return row.status ? isOpenForUnread(row.status) : true
}

/**
 * A cached list's data with `unread` set on the rows of these tasks ('all':
 * every row). Walks arrays and the { tasks } / { data } / { rows } wrappers
 * the task reads return; rows without an `unread` key are left alone (lists
 * that don't carry read state). Returns the same object when nothing changed.
 */
export function patchUnreadInData<T>(data: T, ids: ReadonlySet<string> | 'all', unread: boolean, depth = 0): T {
  if (depth > 3 || data === null || typeof data !== 'object') return data
  if (Array.isArray(data)) {
    let changed = false
    const next = data.map((item) => {
      if (item && typeof item === 'object' && !Array.isArray(item) && 'id' in item && 'unread' in item) {
        const row = item as { id: unknown; unread: unknown }
        if ((ids === 'all' || ids.has(String(row.id))) && row.unread !== unread) {
          changed = true
          return { ...item, unread }
        }
        return item
      }
      const patched = patchUnreadInData(item, ids, unread, depth + 1)
      if (patched !== item) changed = true
      return patched
    })
    return (changed ? next : data) as T
  }
  let changed = false
  const out: Record<string, unknown> = { ...(data as Record<string, unknown>) }
  for (const key of ['tasks', 'data', 'rows', 'pages']) {
    if (!(key in out)) continue
    const patched = patchUnreadInData(out[key], ids, unread, depth + 1)
    if (patched !== out[key]) { out[key] = patched; changed = true }
  }
  return (changed ? out : data) as T
}
