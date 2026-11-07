"use client"

import { Fragment } from "react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { ChevronRight } from "lucide-react"
import { useBreadcrumbOverride } from "@/lib/breadcrumbs-context"
import { routeBreadcrumbs, type Crumb } from "@/lib/page-title"

/** The current trail: the page's own (PageHeader / usePageBreadcrumbs), else the route's. */
export function useShellCrumbs(): Crumb[] {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const override = useBreadcrumbOverride()
  return override && override.length ? override : routeBreadcrumbs(pathname, searchParams)
}

/** Top-bar breadcrumbs (`Workflows › Invoice approval`). Phones show the current page only. */
export function TopbarBreadcrumbs() {
  const crumbs = useShellCrumbs()
  if (crumbs.length === 0) return <div className="min-w-0 flex-1" />
  return (
    <nav aria-label="Breadcrumb" className="min-w-0 flex-1" data-topbar-breadcrumbs>
      <ol className="flex min-w-0 items-center gap-1 text-ui">
        {crumbs.map((crumb, i) => {
          const last = i === crumbs.length - 1
          return (
            <Fragment key={`${i}:${crumb.label}`}>
              {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-fg-subtle max-md:hidden" aria-hidden />}
              <li className={last ? "min-w-0 truncate font-medium text-fg" : "min-w-0 shrink truncate text-fg-muted max-md:hidden"}>
                {!last && crumb.href ? (
                  <Link href={crumb.href} className="rounded-sm hover:text-fg hover:underline underline-offset-2">{crumb.label}</Link>
                ) : (
                  <span aria-current={last ? "page" : undefined}>{crumb.label}</span>
                )}
              </li>
            </Fragment>
          )
        })}
      </ol>
    </nav>
  )
}
