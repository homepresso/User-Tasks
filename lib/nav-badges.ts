/**
 * Side menu / mobile menu count badges (My tasks, Task tracker).
 * The counts come from one read (home.navCounts → nav_task_counts); this
 * module is the pure part: which item shows which count, how the number is
 * written and what a screen reader hears. Client-safe.
 */

export interface NavCountsData { my_tasks: number; queue: number; tracker: number }

/**
 * The counts each menu item (href) adds up. My tasks is the unified list:
 * its badge is my open tasks plus the ones queued for me (the separate Task
 * queue item is gone; nav_task_counts still reports the two apart).
 */
export const NAV_BADGE_HREFS: Readonly<Record<string, ReadonlyArray<keyof NavCountsData>>> = {
  '/tasks': ['my_tasks', 'queue'],
  '/tasks/assigned': ['tracker'],
}

/** The count of a menu item, or 0 (no badge). */
export function navBadgeCount(counts: NavCountsData | null | undefined, href: string): number {
  const keys = NAV_BADGE_HREFS[href]
  if (!keys || !counts) return 0
  let total = 0
  for (const key of keys) {
    const n = Number(counts[key])
    if (Number.isFinite(n) && n > 0) total += Math.floor(n)
  }
  return total
}

/** The badge text: hidden (null) at 0, "99+" from 100. */
export function formatNavBadge(count: number | null | undefined): string | null {
  if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) return null
  return count > 99 ? '99+' : String(Math.floor(count))
}

/** The item's accessible name: "My tasks, 4 pending" (just the label at 0). */
export function navBadgeLabel(label: string, count: number | null | undefined): string {
  const text = formatNavBadge(count)
  return text ? `${label}, ${text} pending` : label
}
