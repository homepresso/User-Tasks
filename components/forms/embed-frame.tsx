'use client'

import { createContext, useContext, useEffect, useRef } from 'react'
import { hostResizeMessages, postToHost } from '@/lib/embed/host-messages'

/** The embedded look: no page background, no outer padding, no full-viewport height. */
const EMBED_CSS = 'html,body{background:transparent!important;min-height:0!important}'
  + '[data-public-form-layout],[data-form-link-layout]{background:transparent!important;min-height:0!important;padding:0!important}'
  + '[data-form-canvas]{display:none!important}'

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
      const height = Math.ceil(el.getBoundingClientRect().height)
      if (height === last) return
      last = height
      // usertasks:resize, plus the add-in part message when the frame URL has a SenderId (lib/embed/host-messages.ts).
      for (const message of hostResizeMessages(height, window.location)) postToHost(message)
    }
    send()
    const observer = new ResizeObserver(send)
    observer.observe(el)
    return () => observer.disconnect()
  }, [embed, nested])
  return (
    <div ref={ref} data-embed-frame={embed ? 'embedded' : undefined} className={embed ? 'bg-transparent' : undefined}>
      {embed && <style>{trusted ? EMBED_CSS + TRUSTED_CSS : EMBED_CSS}</style>}
      <NestedEmbedFrame value={nested || embed}>{children}</NestedEmbedFrame>
    </div>
  )
}
