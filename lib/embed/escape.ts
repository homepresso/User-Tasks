'use client'

/**
 * The last line of the embedded designers' "never the full app inside the
 * host page" rule (lib/embed/designers.ts). A document load of an app page
 * in a frame from another site is refused by the browser (frame-ancestors
 * 'none'), but a client-side navigation from an /embed/ page into the app
 * (a router.push the embed didn't catch) would render the dashboard shell
 * inside the frame. The dashboard shell calls this first: when it runs in a
 * frame of another origin it replaces the page with the /embed/ equivalent
 * (launch parameters re-attached) or /embed/open (open in a new tab), and
 * renders nothing meanwhile. Same-origin frames and top-level pages are left
 * alone.
 */

import { useLayoutEffect, useState } from 'react'
import { EMBED_SESSION_KEY, embedPathFor, withEmbedParams } from './designers'

/** In a frame whose parent is another origin? */
export function framedByOtherOrigin(): boolean {
  if (typeof window === 'undefined' || window.self === window.top) return false
  try {
    return window.parent.location.origin !== window.location.origin
  } catch {
    return true
  }
}

/** Where a framed app page goes instead (pure). */
export function escapeTarget(path: string, carried: Record<string, string>): string {
  const mapped = embedPathFor(path)
  return mapped ? withEmbedParams(mapped, carried) : `/embed/open?to=${encodeURIComponent(path)}`
}

function storedLaunch(): Record<string, string> {
  try {
    const raw = sessionStorage.getItem(EMBED_SESSION_KEY)
    const value = raw ? JSON.parse(raw) as unknown : null
    if (!value || typeof value !== 'object') return {}
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'))
  } catch {
    return {}
  }
}

/** True while the page is being replaced (render nothing). */
export function useEmbedEscape(): boolean {
  const [escaping, setEscaping] = useState(false)
  useLayoutEffect(() => {
    if (!framedByOtherOrigin()) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hide the shell before the browser paints it
    setEscaping(true)
    window.location.replace(escapeTarget(`${window.location.pathname}${window.location.search}${window.location.hash}`, storedLaunch()))
  }, [])
  return escaping
}
