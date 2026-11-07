/**
 * Recently visited pages for the ⌘K palette's "Recent" group, kept in this
 * browser (localStorage). The shell records each page once its title is known.
 */
export interface RecentPage {
  href: string
  title: string
  /** Where it lives ("Workflows"), shown as the secondary text. */
  area?: string
}

const KEY = 'usertasks.recent-pages'
const MAX = 8

export function readRecentPages(): RecentPage[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((r): r is RecentPage => typeof r?.href === 'string' && typeof r?.title === 'string').slice(0, MAX) : []
  } catch {
    return []
  }
}

export function recordRecentPage(page: RecentPage) {
  if (!page.href.startsWith('/') || !page.title) return
  try {
    const next = [page, ...readRecentPages().filter((r) => r.href !== page.href)].slice(0, MAX)
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch { /* storage unavailable */ }
}
