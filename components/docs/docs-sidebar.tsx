'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Menu, X } from 'lucide-react'

export interface SidebarSection {
  title: string
  items: Array<{ title: string; href: string }>
}

function NavList({ sections, pathname, onNavigate }: { sections: SidebarSection[]; pathname: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Documentation" className="space-y-6 text-sm">
      <Link href="/docs" onClick={onNavigate} className={`block rounded-md px-3 py-1.5 ${pathname === '/docs' ? 'bg-(color:--mkt-primary)/[0.07] font-semibold text-(color:--mkt-ink)' : 'text-(color:--mkt-muted-strong) hover:text-(color:--mkt-ink)'}`}>
        Overview
      </Link>
      {sections.map((section) => (
        <div key={section.title}>
          <p className="mb-1.5 px-3 text-2xs font-semibold uppercase tracking-[0.14em] text-(color:--mkt-bronze)">{section.title}</p>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active = pathname === item.href
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={`block rounded-md px-3 py-1.5 leading-5 transition ${active ? 'bg-(color:--mkt-primary)/[0.07] font-semibold text-(color:--mkt-ink)' : 'text-(color:--mkt-muted-strong) hover:bg-(color:--mkt-ink)/[0.04] hover:text-(color:--mkt-ink)'}`}
                  >
                    {item.title}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}

/** Docs navigation: sticky sidebar on large screens, a drawer below that. */
export function DocsSidebar({ sections }: { sections: SidebarSection[] }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <aside className="hidden w-60 shrink-0 lg:block">
        <div className="sticky top-[73px] max-h-[calc(100vh-73px)] overflow-y-auto py-8 pr-3">
          <NavList sections={sections} pathname={pathname} />
        </div>
      </aside>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 left-4 z-40 inline-flex items-center gap-2 rounded-full bg-(color:--mkt-primary) px-4 py-2.5 text-sm font-semibold text-(color:--mkt-paper) shadow-lg lg:hidden"
        aria-label="Open documentation menu"
      >
        <Menu size={16} aria-hidden="true" /> Menu
      </button>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Documentation menu">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-(color:--mkt-ink)/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[85%] max-w-xs overflow-y-auto bg-(color:--mkt-paper) p-4 shadow-xl">
            <div className="mb-4 flex justify-end">
              <button type="button" onClick={() => setOpen(false)} className="rounded-md p-2 text-(color:--mkt-muted-strong)" aria-label="Close menu"><X size={18} /></button>
            </div>
            <NavList sections={sections} pathname={pathname} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  )
}
