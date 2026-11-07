/**
 * The task lists' status filter (Task tracker, My team, My tasks, Home My
 * tasks): by default every status EXCEPT the closed ones (Completed,
 * Cancelled); one "Show completed" switch brings those back. The Status
 * menu narrows the open statuses; nothing picked there = every open status.
 *
 * Pure and client-safe. State is { selected, showCompleted }; `statusesFor`
 * turns it into the status list a read takes (null = no status filter).
 * Persisted per user, per list (hooks/use-status-filter).
 */

export const CLOSED_TASK_STATUSES = ['completed', 'cancelled'] as const

export interface StatusFilterState {
  /** Open statuses picked in the Status menu ([] = every open status). */
  selected: string[]
  /** Show completed (and cancelled) tasks too. */
  showCompleted: boolean
}

export const DEFAULT_STATUS_FILTER: StatusFilterState = { selected: [], showCompleted: false }

export function isClosedStatus(status: string | null | undefined): boolean {
  return (CLOSED_TASK_STATUSES as readonly string[]).includes(String(status ?? ''))
}

/**
 * The statuses to ask the list read for. `openStatuses` are the list's open
 * statuses (its Status menu options). null = no status filter at all
 * (everything, completed included).
 */
export function statusesFor(state: StatusFilterState, openStatuses: readonly string[]): string[] | null {
  const picked = state.selected.filter((s) => openStatuses.includes(s))
  if (state.showCompleted) return picked.length ? [...picked, ...CLOSED_TASK_STATUSES] : null
  return picked.length ? picked : [...openStatuses]
}

/** Does a row with this status pass the filter? (client-side lists, and the tests) */
export function matchesStatus(status: string, state: StatusFilterState, openStatuses: readonly string[]): boolean {
  const statuses = statusesFor(state, openStatuses)
  return statuses === null || statuses.includes(status)
}

/** Anything other than the default (for "Clear filters" and the empty states). */
export function isStatusFiltered(state: StatusFilterState): boolean {
  return state.selected.length > 0 || state.showCompleted
}

export function statusFilterStorageKey(list: string, userId: string | null | undefined): string {
  return `usertasks:status-filter:${list}:${userId || 'anon'}`
}

export function parseStatusFilter(raw: unknown): StatusFilterState | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const selected = Array.isArray(value.selected) ? value.selected.filter((s): s is string => typeof s === 'string').slice(0, 20) : []
  return { selected: selected.filter((s) => !isClosedStatus(s)), showCompleted: value.showCompleted === true }
}

export function readStoredStatusFilter(list: string, userId: string | null | undefined): StatusFilterState | null {
  try {
    const raw = window.localStorage.getItem(statusFilterStorageKey(list, userId))
    return raw ? parseStatusFilter(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

export function storeStatusFilter(list: string, userId: string | null | undefined, state: StatusFilterState): void {
  try {
    window.localStorage.setItem(statusFilterStorageKey(list, userId), JSON.stringify(state))
  } catch {
    // Private mode / storage full: the choice just isn't remembered.
  }
}

/**
 * Lists that keep an explicit status list (My tasks' stored filter, where
 * [] = every status) ↔ the shared controls: the menu shows the open
 * statuses picked (none = all of them); Show completed adds the closed ones.
 */
export function explicitStatusView(status: readonly string[], openValues: readonly string[]): StatusFilterState {
  const showCompleted = status.length === 0 || status.some((s) => isClosedStatus(s))
  const open = status.filter((s) => openValues.includes(s))
  return { selected: open.length === openValues.length ? [] : open, showCompleted }
}

export function explicitStatusList(selected: readonly string[], showCompleted: boolean, openValues: readonly string[]): string[] {
  if (showCompleted) return selected.length ? [...selected, ...CLOSED_TASK_STATUSES] : []
  return selected.length ? [...selected] : [...openValues]
}
