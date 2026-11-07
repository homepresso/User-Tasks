'use client'

import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { Menu, X } from 'lucide-react'

export type NavLink = { href: string; label: string; external?: boolean }

/**
 * The public site's menu below the lg breakpoint: a button that opens every
 * page link in a panel under the header. Closes on a link click, Escape or a
 * click outside. The links are also in the server-rendered markup for
 * crawlers and no-JS visitors via the footer.
 */
export function MobileMenu({ links }: { links: NavLink[] }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    const onPointer = (event: PointerEvent) => { if (root.current && !root.current.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  return (
    <div ref={root} className="lg:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label="Menu"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-(color:--mkt-ink)/15 px-2.5 py-2 text-sm font-medium text-(color:--mkt-ink-soft) hover:border-(color:--mkt-ink)/30"
      >
        {open ? <X size={16} aria-hidden="true" /> : <Menu size={16} aria-hidden="true" />}
        <span className="hidden min-[420px]:inline" aria-hidden="true">Menu</span>
      </button>
      {open && (
        <div id={id} className="absolute inset-x-4 top-full z-50 mt-2 rounded-2xl border border-(color:--mkt-ink)/10 bg-(color:--mkt-paper) p-3 shadow-[0_20px_60px_rgba(27,25,22,0.18)] sm:inset-x-6">
          <ul className="grid grid-cols-2 gap-1">
            {links.map((link) => (
              <li key={link.href}>
                {link.external ? (
                  <a href={link.href} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2.5 text-sm font-medium text-(color:--mkt-ink-soft) hover:bg-(color:--mkt-ink)/[0.05]">{link.label}</a>
                ) : (
                  <Link href={link.href} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2.5 text-sm font-medium text-(color:--mkt-ink-soft) hover:bg-(color:--mkt-ink)/[0.05]">{link.label}</Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
