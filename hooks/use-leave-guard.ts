"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"

/**
 * Unsaved-changes guard for a full-page editor (the form designer page).
 * While `active`, a click on any in-app link (the sidebar, breadcrumbs, the
 * header's back arrow, a search result…) is held: the page shows its own
 * "Discard your changes?" prompt, and `leave()` then goes where the link
 * pointed. Links opening a new tab, downloads, modified clicks (⌘ / Ctrl /
 * Shift / Alt / middle button), other origins and same-page hash links pass
 * through. Reloading or closing the tab is the page's `beforeunload`.
 *
 * Every link counts, not only next/link: the listener runs in the document's
 * capture phase, before React's root listener sees the click.
 */

export interface LinkClick {
  href: string | null
  target?: string | null
  download?: boolean
  button?: number
  metaKey?: boolean
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
}

/** The in-app path a link click would navigate to (to hold it), or null to let it through. */
export function leaveTarget(click: LinkClick, current: string): string | null {
  if (!click.href) return null
  if ((click.button ?? 0) !== 0 || click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return null
  if (click.download) return null
  if (click.target && click.target !== "_self") return null
  let here: URL, to: URL
  try {
    here = new URL(current)
    to = new URL(click.href, here)
  } catch { return null }
  if (to.origin !== here.origin) return null
  if (to.protocol !== "http:" && to.protocol !== "https:") return null
  // The same page (a hash link, or the page itself): nothing is lost.
  if (to.pathname === here.pathname && to.search === here.search) return null
  return `${to.pathname}${to.search}${to.hash}`
}

export function useLeaveGuard(active: boolean) {
  const router = useRouter()
  const [pending, setPending] = useState<string | null>(null)

  useEffect(() => {
    if (!active) return
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented) return
      const anchor = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null
      if (!anchor) return
      const to = leaveTarget({
        href: anchor.getAttribute("href"), target: anchor.getAttribute("target"), download: anchor.hasAttribute("download"),
        button: e.button, metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey,
      }, window.location.href)
      if (!to) return
      e.preventDefault()
      e.stopPropagation()
      setPending(to)
    }
    document.addEventListener("click", onClick, true)
    return () => document.removeEventListener("click", onClick, true)
  }, [active])

  const stay = useCallback(() => setPending(null), [])
  const leave = useCallback(() => {
    const to = pending
    setPending(null)
    if (to) router.push(to)
  }, [pending, router])

  return { pending, stay, leave }
}
