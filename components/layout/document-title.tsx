"use client"

import { useEffect } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { useNotifications } from "@/hooks/use-notifications"
import { documentTitle, titlePartsFromCrumbs } from "@/lib/page-title"
import { useShellCrumbs } from "./topbar-breadcrumbs"
import { recordRecentPage } from "./recent-pages"

/**
 * Names the browser tab after the current trail ("Invoice approval ·
 * Workflows · UserTasks", "(3) …" with unread notifications) and records the
 * page for the palette's Recent group. Dashboard pages are mostly client
 * components, so the route (lib/page-title) and the page's PageHeader give
 * the title here; Next's own <title> (the layout's template) is kept in step.
 */
export function ShellDocumentTitle() {
  const crumbs = useShellCrumbs()
  const pathname = usePathname()
  const search = useSearchParams().toString()
  const { unreadCount } = useNotifications()
  const parts = titlePartsFromCrumbs(crumbs)
  const title = parts.length ? documentTitle(parts, unreadCount) : null

  useEffect(() => {
    if (!title) return
    const apply = () => { if (document.title !== title) document.title = title }
    apply()
    // Next updates <title> on navigation (metadata); put ours back after it.
    const observer = new MutationObserver(apply)
    observer.observe(document.head, { childList: true, subtree: true, characterData: true })
    return () => observer.disconnect()
  }, [title])

  const page = crumbs[crumbs.length - 1]?.label
  const area = crumbs.length > 1 ? crumbs[0].label : undefined
  useEffect(() => {
    if (page) recordRecentPage({ href: search ? `${pathname}?${search}` : pathname, title: page, area })
  }, [page, area, pathname, search])

  return null
}
