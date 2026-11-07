/**
 * Task tracker (/tasks/assigned) tabs. Following comes first; the others are
 * the tracker's scopes (ui-reads tasks.assigned). The last tab a person
 * picked is remembered per user in this browser; with no remembered tab,
 * Following opens when they follow something, else Assigned by me.
 */

export type TrackerScope = 'assigned_by_me' | 'team_members' | 'all'
export type TrackerTab = 'following' | TrackerScope

export const TRACKER_TABS: ReadonlyArray<{ value: TrackerTab; label: string }> = [
  { value: 'following', label: 'Following' },
  { value: 'assigned_by_me', label: 'Assigned by me' },
  { value: 'team_members', label: 'Team members' },
  { value: 'all', label: 'All tasks' },
]

const VALUES = new Set<string>(TRACKER_TABS.map((tab) => tab.value))

export function isTrackerTab(value: unknown): value is TrackerTab {
  return typeof value === 'string' && VALUES.has(value)
}

/** localStorage key of a person's last tab (per user, so a shared browser keeps each person's choice). */
export function trackerTabStorageKey(userId: string | null | undefined): string {
  return `usertasks:task-tracker-tab:${userId || 'anon'}`
}

/** The tab to open: the remembered one, else Following if they follow anything, else Assigned by me. */
export function defaultTrackerTab(stored: unknown, followedCount: number | null | undefined): TrackerTab {
  if (isTrackerTab(stored)) return stored
  return (followedCount ?? 0) > 0 ? 'following' : 'assigned_by_me'
}

export function readStoredTrackerTab(userId: string | null | undefined): TrackerTab | null {
  try {
    const value = window.localStorage.getItem(trackerTabStorageKey(userId))
    return isTrackerTab(value) ? value : null
  } catch {
    return null
  }
}

export function storeTrackerTab(userId: string | null | undefined, tab: TrackerTab): void {
  try {
    window.localStorage.setItem(trackerTabStorageKey(userId), tab)
  } catch {
    // Private mode / storage full: the choice just isn't remembered.
  }
}
