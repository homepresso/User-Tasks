/**
 * Column sorting for the task lists (Task tracker, My team, My tasks, Home
 * My tasks). Pure and client-safe: the pages, the hook (hooks/use-list-sort)
 * and the tests share it, so every surface sorts the same way.
 *
 * A header click cycles ascending → descending → none (back to the list's
 * own order). Sorting is stable, empty values (no due date, no assignee) go
 * last in both directions, priority and status sort by meaning (critical
 * before low; queued / blocked before to do … completed), text sorts with
 * the locale collator (case-insensitive, numeric-aware).
 */

export type SortDir = 'asc' | 'desc'
export interface SortState<K extends string = string> { key: K; dir: SortDir }

/** The sortable task columns (each surface offers the ones it shows). */
export const TASK_SORT_KEYS = ['title', 'assignee', 'status', 'priority', 'due', 'progress', 'updated', 'created'] as const
export type TaskSortKey = (typeof TASK_SORT_KEYS)[number]

/** Next state for a header click: asc → desc → none; another column starts at asc. */
export function nextSort<K extends string>(current: SortState<K> | null, key: K): SortState<K> | null {
  if (!current || current.key !== key) return { key, dir: 'asc' }
  return current.dir === 'asc' ? { key, dir: 'desc' } : null
}

/** aria-sort for a column header. */
export function ariaSortFor(current: SortState | null, key: string): 'ascending' | 'descending' | 'none' {
  if (!current || current.key !== key) return 'none'
  return current.dir === 'asc' ? 'ascending' : 'descending'
}

const PRIORITY_RANK: Record<string, number> = { critical: 0, urgent: 0, high: 1, medium: 2, normal: 2, low: 3 }
const STATUS_RANK: Record<string, number> = { queued: 0, blocked: 1, in_progress: 2, todo: 3, draft: 4, completed: 5, cancelled: 6 }

export function priorityRank(priority: unknown): number | null {
  return typeof priority === 'string' && priority in PRIORITY_RANK ? PRIORITY_RANK[priority] : null
}

export function statusRank(status: unknown): number | null {
  return typeof status === 'string' && status in STATUS_RANK ? STATUS_RANK[status] : null
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

type Comparable = string | number | null

function isEmpty(v: Comparable): v is null {
  return v === null || v === '' || (typeof v === 'number' && Number.isNaN(v))
}

function compareValues(a: Comparable, b: Comparable): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return collator.compare(String(a), String(b))
}

function time(value: unknown): number | null {
  if (!value) return null
  const t = new Date(String(value)).getTime()
  return Number.isNaN(t) ? null : t
}

/* eslint-disable @typescript-eslint/no-explicit-any -- rows from several list reads */

/** The progress a task row shows: subtasks done when it has any, else its own progress (100 when closed). */
export function rowProgress(task: any): number {
  const total = Number(task.subtask_count ?? task.child_count ?? 0)
  const done = Number(task.completed_subtask_count ?? task.completed_child_count ?? 0)
  if (total > 0) return Math.round((done / total) * 100)
  if (task.progress_pct != null) return Math.round(Number(task.progress_pct) || 0)
  return task.status === 'completed' || task.status === 'cancelled' ? 100 : 0
}

/**
 * The value each task column sorts on, from any of the list rows (tracker,
 * My team, My tasks, Home). Unknown keys sort as empty.
 */
export function taskSortValue(task: any, key: string): Comparable {
  switch (key) {
    case 'title': return task.title ? String(task.title) : null
    case 'assignee': return task.assignee?.display_name || task.assignee?.email || task.assignee_name || null
    case 'status': return statusRank(task.display_status ?? (task.action ? 'queued' : task.status))
    case 'priority': return priorityRank(task.priority)
    case 'due': return time(task.due_date)
    case 'progress': return rowProgress(task)
    case 'updated': return time(task.updated_at ?? task.created_at)
    case 'created': return time(task.created_at)
    case 'assigned': return time(task.assigned_at ?? task.accepted_at ?? task.created_at)
    default: return null
  }
}

/**
 * Rows in `sort` order (a new array; stable). No sort: the rows as given.
 * Empty values go last whichever the direction.
 */
export function sortRows<T>(rows: readonly T[], sort: SortState | null, valueOf: (row: T, key: string) => Comparable = taskSortValue): T[] {
  if (!sort) return [...rows]
  const sign = sort.dir === 'desc' ? -1 : 1
  return rows
    .map((row, index) => ({ row, index, value: valueOf(row, sort.key) }))
    .sort((a, b) => {
      const ea = isEmpty(a.value)
      const eb = isEmpty(b.value)
      if (ea || eb) return ea === eb ? a.index - b.index : ea ? 1 : -1
      const c = compareValues(a.value as string | number, b.value as string | number)
      return c !== 0 ? c * sign : a.index - b.index
    })
    .map((entry) => entry.row)
}

/* ── Persistence (per user, per list) and the URL ── */

export function sortStorageKey(list: string, userId: string | null | undefined): string {
  return `usertasks:list-sort:${list}:${userId || 'anon'}`
}

/** "due" / "-due" (descending) ↔ SortState; anything else (or a key the list doesn't offer) → null. */
export function parseSortParam<K extends string>(value: string | null | undefined, keys: readonly K[]): SortState<K> | null {
  if (!value) return null
  const desc = value.startsWith('-')
  const key = (desc ? value.slice(1) : value) as K
  return keys.includes(key) ? { key, dir: desc ? 'desc' : 'asc' } : null
}

export function formatSortParam(sort: SortState | null): string | null {
  return sort ? `${sort.dir === 'desc' ? '-' : ''}${sort.key}` : null
}

export function readStoredSort<K extends string>(list: string, userId: string | null | undefined, keys: readonly K[]): SortState<K> | null | undefined {
  try {
    const raw = window.localStorage.getItem(sortStorageKey(list, userId))
    if (raw === null) return undefined
    return raw === '' ? null : parseSortParam(raw, keys)
  } catch {
    return undefined
  }
}

export function storeSort(list: string, userId: string | null | undefined, sort: SortState | null): void {
  try {
    window.localStorage.setItem(sortStorageKey(list, userId), formatSortParam(sort) ?? '')
  } catch {
    // Private mode / storage full: the choice just isn't remembered.
  }
}
