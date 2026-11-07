'use client'

import { useEffect, useRef } from 'react'
import { resizeMessage } from '@/lib/forms/embed'

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
export function EmbedFrame({ embed, children }: { embed: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!embed || typeof window === 'undefined' || window.parent === window || !ref.current) return
    const el = ref.current
    let last = -1
    const send = () => {
      const height = Math.ceil(el.getBoundingClientRect().height)
      if (height === last) return
      last = height
      try { window.parent.postMessage(resizeMessage(height, window.location.pathname), '*') } catch { /* parent gone */ }
    }
    send()
    const observer = new ResizeObserver(send)
    observer.observe(el)
    return () => observer.disconnect()
  }, [embed])
  return (
    <div ref={ref} data-embed-frame={embed ? 'embedded' : undefined} className={embed ? 'bg-transparent' : undefined}>
      {embed && <style>{EMBED_CSS}</style>}
      {children}
    </div>
  )
}
