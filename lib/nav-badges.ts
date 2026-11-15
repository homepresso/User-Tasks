/**
 * Side menu / mobile menu count badges (My tasks, Task tracker).
 * The counts come from one read (home.navCounts → nav_task_counts); this
 * module is the pure part: which item shows which count, how the number is
 * written and what a screen reader hears. Client-safe.
 */

/** unread: tasks I haven't opened since they became mine (the accent count next to My tasks). */
export interface NavCountsData { my_tasks: number; queue: number; tracker: number; unread?: number }

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

/** Menu items that show an unread count beside their badge (My tasks). */
export const NAV_UNREAD_HREFS: ReadonlySet<string> = new Set(['/tasks'])

/** The unread count of a menu item, or 0. */
export function navUnreadCount(counts: NavCountsData | null | undefined, href: string): number {
  if (!counts || !NAV_UNREAD_HREFS.has(href)) return 0
  const n = Number(counts.unread)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

/** The item's accessible name with both counts: "My tasks, 4 pending, 2 unread". */
export function navBadgeLabelWithUnread(label: string, count: number | null | undefined, unread: number | null | undefined): string {
  const base = navBadgeLabel(label, count)
  const text = formatNavBadge(unread)
  return text ? `${base}, ${text} unread` : base
}
