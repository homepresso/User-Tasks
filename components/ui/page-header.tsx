'use client'

import { ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { useInShellBreadcrumbs, usePageBreadcrumbs } from '@/lib/breadcrumbs-context'

/**
 * PageHeader (§3.5): one per page.
 *
 *   [breadcrumbs 12px muted › …]
 *   [icon?] [Title 22/600] [badge?]          [secondary] [secondary] [Primary] [⋯]
 *   [Description 14 muted, max 72ch]
 *   [Tabs]
 *
 * At most three visible actions; put the rest in a DropdownMenu (⋯).
 * Breadcrumbs replace free-floating back arrows (`Workflows › Invoice approval`).
 * Inside the dashboard shell they go to the top bar (and name the browser
 * tab) instead of rendering here; give them string labels.
 */
export interface Breadcrumb {
  label: ReactNode
  href?: string
}

export interface PageHeaderProps {
  title: ReactNode
  description?: ReactNode
  breadcrumbs?: Breadcrumb[]
  /** Status badge after the title. */
  badge?: ReactNode
  /** Right-aligned actions. */
  actions?: ReactNode
  /** <Tabs> under the header (they carry their own bottom hairline). */
  tabs?: ReactNode
  /** 32px icon tile — object detail pages only (data table, integration). */
  icon?: ReactNode
  /** Sticks to the top with a blurred background and a hairline once scrolled. */
  sticky?: boolean
  /**
   * Phones (< sm): keep the actions on the title row (pass compact, icon-sized
   * actions) and move the description under both. By default the actions
   * wrap onto their own row under the title.
   */
  inlineActions?: boolean
  className?: string
}

export function PageHeader({ title, description, breadcrumbs, badge, actions, tabs, icon, sticky = false, inlineActions = false, className }: PageHeaderProps) {
  const sentinel = useRef<HTMLDivElement>(null)
  const [stuck, setStuck] = useState(false)
  const textCrumbs = breadcrumbs?.length && breadcrumbs.every((b) => typeof b.label === 'string') ? (breadcrumbs as Array<{ label: string; href?: string }>) : null
  // In the shell, string breadcrumbs move to the top bar.
  const inTopBar = useInShellBreadcrumbs() && !!textCrumbs
  usePageBreadcrumbs(textCrumbs)
  useEffect(() => {
    if (!sticky || !sentinel.current || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting))
    io.observe(sentinel.current)
    return () => io.disconnect()
  }, [sticky])

  return (
    <>
      {sticky && <div ref={sentinel} aria-hidden="true" className="h-px" />}
      <header
        data-stuck={stuck || undefined}
        className={cn(
          'mb-6',
          sticky && 'sticky top-0 z-20 -mx-4 bg-bg/80 px-4 pt-2 md:-mx-6 md:px-6 backdrop-blur data-[stuck]:border-b data-[stuck]:border-border-subtle',
          className,
        )}
      >
        {!inTopBar && breadcrumbs && breadcrumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="mb-2">
            <ol className="flex min-w-0 items-center gap-1 text-xs text-fg-muted">
              {breadcrumbs.map((b, i) => (
                <Fragment key={i}>
                  {i > 0 && <ChevronRight className="size-3 shrink-0" aria-hidden="true" />}
                  <li className="min-w-0 truncate">
                    {b.href && i < breadcrumbs.length - 1 ? (
                      <Link href={b.href} className="hover:text-fg hover:underline">{b.label}</Link>
                    ) : (
                      <span aria-current={i === breadcrumbs.length - 1 ? 'page' : undefined}>{b.label}</span>
                    )}
                  </li>
                </Fragment>
              ))}
            </ol>
          </nav>
        )}
        {/* Phones (< sm): the title block takes the whole first row (the title
            wraps instead of truncating) and the actions wrap onto the row below. */}
        <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
          <div className={cn("flex min-w-0 flex-1 items-start gap-3", !(inlineActions && actions != null) && "max-sm:basis-full")}>
            {icon != null && (
              <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-subtle text-fg-muted [&>svg]:size-4" aria-hidden="true">{icon}</span>
            )}
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2 max-sm:flex-wrap">
                <h1 className="text-title text-fg max-sm:line-clamp-3 max-sm:[overflow-wrap:anywhere] sm:truncate">{title}</h1>
                {badge}
              </div>
              {description != null && <p className={cn("mt-1 max-w-[72ch] text-sm text-fg-muted", inlineActions && actions != null && "max-sm:hidden")}>{description}</p>}
            </div>
          </div>
          {actions != null && <div className="flex shrink-0 items-center gap-2 max-sm:min-w-0 max-sm:max-w-full max-sm:flex-wrap" data-page-header-actions>{actions}</div>}
        </div>
        {inlineActions && actions != null && description != null && <p className="mt-1 text-sm text-fg-muted sm:hidden">{description}</p>}
        {tabs != null && <div className="mt-4">{tabs}</div>}
      </header>
    </>
  )
}
