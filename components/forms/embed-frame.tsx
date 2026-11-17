'use client'

import { createContext, useContext, useEffect, useRef } from 'react'
import { hostResizeMessages, postToHost } from '@/lib/embed/host-messages'

/** The embedded look: no page background, no outer padding, no full-viewport height. */
const EMBED_CSS = 'html,body{background:transparent!important;min-height:0!important}'
  + '[data-public-form-layout],[data-form-link-layout]{background:transparent!important;min-height:0!important;padding:0!important}'
  + '[data-form-canvas]{display:none!important}'
  // Menus and lists keep their natural height (no inner scrollbar for short lists; about 13 rows before one shows):
  // the frame grows to fit them instead (floatingBottom below). Not the frame-limited "available height".
  + '[data-radix-popper-content-wrapper] [role=menu],[data-radix-popper-content-wrapper] [role=listbox]{max-height:30rem!important}'

/** Floating content (menus, selects, popovers) renders in portals outside the measured root. */
const FLOATING_SELECTOR = '[data-radix-popper-content-wrapper]'
/** Room under an open menu, so its shadow isn't cut by the frame edge. */
const FLOATING_MARGIN = 12

/** The lowest bottom edge of any open floating element, in page coordinates (0: none open). */
export function floatingBottom(doc: Document = document): number {
  let bottom = 0
  for (const el of Array.from(doc.querySelectorAll(FLOATING_SELECTOR))) {
    const r = el.getBoundingClientRect()
    if (r.height > 0) bottom = Math.max(bottom, r.bottom + (doc.defaultView?.scrollY ?? 0) + FLOATING_MARGIN)
  }
  return Math.ceil(bottom)
}

/**
 * The page body of a form link page. With `embed` (?embed=1, or opened in a
 * frame): a transparent page with no outer padding that tells its host page
 * how tall it is — `{ type: 'usertasks:resize', height, path }` posted to
 * the parent window on every size change, so the host can size the iframe
 * (the share dialog's optional resize script does). The height is not
 * sensitive, so it goes to any parent; the host checks the origin.
 */
/** Set inside an EmbedFrame: a nested one (e.g. the form inside /embed/f's host wrapper) leaves the reporting to the outer one. */
const NestedEmbedFrame = createContext(false)

/** Trusted embedding: the host sizes the frame to the page, so the page itself never scrolls (no scrollbar flash). */
const TRUSTED_CSS = 'html,body{overflow:hidden!important}'

export function EmbedFrame({ embed, trusted = false, children }: { embed: boolean; trusted?: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const nested = useContext(NestedEmbedFrame)
  useEffect(() => {
    if (!embed || nested || typeof window === 'undefined' || window.parent === window || !ref.current) return
    const el = ref.current
    let last = -1
    const send = () => {
      // The page, or an open menu / popover below it (portals render outside `el`): the frame grows to show
      // the whole menu, then shrinks back when it closes.
      const height = Math.max(Math.ceil(el.getBoundingClientRect().bottom + window.scrollY), floatingBottom())
      if (height === last) return
      last = height
      // usertasks:resize, plus the add-in part message when the frame URL has a SenderId (lib/embed/host-messages.ts).
      for (const message of hostResizeMessages(height, window.location)) postToHost(message)
    }
    send()
    const observer = new ResizeObserver(send)
    observer.observe(el)
    // Floating content comes and goes in body-level portals: watch for it, and size changes of what is open.
    const watched = new Set<Element>()
    const portals = new MutationObserver(() => {
      for (const node of Array.from(document.querySelectorAll(FLOATING_SELECTOR))) if (!watched.has(node)) { watched.add(node); observer.observe(node) }
      for (const node of Array.from(watched)) if (!node.isConnected) { watched.delete(node); observer.unobserve(node) }
      requestAnimationFrame(send)
    })
    portals.observe(document.body, { childList: true, subtree: true })
    return () => { observer.disconnect(); portals.disconnect() }
  }, [embed, nested])
  return (
    <div ref={ref} data-embed-frame={embed ? 'embedded' : undefined} className={embed ? 'bg-transparent' : undefined}>
      {embed && <style>{trusted ? EMBED_CSS + TRUSTED_CSS : EMBED_CSS}</style>}
      <NestedEmbedFrame value={nested || embed}>{children}</NestedEmbedFrame>
    </div>
  )
}
